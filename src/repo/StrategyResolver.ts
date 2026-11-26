import { PageObject } from '../schema/repository';
import { Element, WebElement, PlatformElement } from '../types';
import { ElementResolutionOptions, SelectionStrategy } from '../enum/Options';
import { pickRandomIndex } from '../utils/math';
import { EnhancedResolver } from './EnhancedResolver';
import { isFatalDriverError } from '../utils/driverErrors';
import type { Platform } from '../enum/Platform';
import { detectDriverPlatform, readPlatformText } from '../utils/platformText';

/**
 * Creates platform-appropriate Element wrappers and applies selection
 * strategies (FIRST, INDEX, RANDOM, TEXT, ATTRIBUTE, ALL).
 *
 * This module handles the mechanical work of constructing {@link WebElement}
 * or {@link PlatformElement} instances from a locator/selector and applying
 * the requested strategy on top. All methods are stateless and static.
 *
 * A strategy the switch does not handle throws — it never silently resolves
 * `.first()`. A silent first-match fallback masks the caller's intent (the
 * filter is ignored, the test keeps passing while the wrong element ranks
 * first) and surfaces as an unrelated failure far downstream.
 */
const ATTACH_PROBE_TIMEOUT_MS = 2_000;

/** Poll interval for the platform TEXT lookup while waiting for a match. */
const TEXT_POLL_INTERVAL_MS = 250;

/** `<name>: <message>` for a named driver error, the bare message for a plain `Error`. */
function describeError(err: unknown): string {
  if (err && typeof err === 'object') {
    const { name, message } = err as { name?: unknown; message?: unknown };
    const msg = typeof message === 'string' ? message : String(err);
    return typeof name === 'string' && name && name !== 'Error' ? `${name}: ${msg}` : msg;
  }
  return String(err);
}

/** Strategies `fromLocator` / `fromSelector` handle — used in the unhandled-strategy error. */
const HANDLED_STRATEGIES = [
  SelectionStrategy.INDEX,
  SelectionStrategy.RANDOM,
  SelectionStrategy.TEXT,
  SelectionStrategy.ATTRIBUTE,
  SelectionStrategy.ALL,
].join(', ');

function unhandledStrategyError(strategy: string, elementName: string, pageName: string, handled: string = HANDLED_STRATEGIES): Error {
  return new Error(
    `Unhandled selection strategy '${strategy}' for '${elementName}' on '${pageName}'. ` +
    `Handled strategies: ${handled}. ` +
    `Refusing to silently fall back to the first matching element — ` +
    `omit the strategy to resolve the first match explicitly.`,
  );
}

export class StrategyResolver {

  /**
   * Creates an Element from a Playwright Locator (web enhanced path)
   * and applies the requested selection strategy.
   *
   * Used when the {@link EnhancedResolver} produces a Playwright Locator
   * for web-platform enhanced selectors (role+name, regex text, iframe).
   *
   * @param locator The Playwright Locator produced by enhanced resolution.
   * @param elementName The element name (used for error messages).
   * @param pageName The page name (used for error messages).
   * @param timeout The wait timeout in milliseconds.
   * @param options Optional element resolution options (strategy, index, value).
   * @returns A promise that resolves to the located Element.
   */
  static async fromLocator(
    locator: any,
    elementName: string,
    pageName: string,
    timeout: number,
    options?: ElementResolutionOptions,
  ): Promise<Element> {
    const desc = `enhanced:${elementName}@${pageName}`;

    if (options?.strategy) {
      switch (options.strategy) {
        case SelectionStrategy.INDEX: {
          if (options.index === undefined || options.index === null) {
            throw new Error('options.index is required when using SelectionStrategy.INDEX');
          }
          const base = new WebElement(locator, desc, timeout);
          const all = await base.all();
          if (options.index < 0 || options.index >= all.length) {
            throw new Error(`Index ${options.index} out of bounds for '${elementName}' on '${pageName}' (found ${all.length} elements).`);
          }
          return all[options.index];
        }
        case SelectionStrategy.RANDOM: {
          const base = new WebElement(locator, desc, timeout);
          // Wait for at least one element to be visible before sampling so that
          // `clickRandom` / `getRandom` compose with Playwright's standard
          // auto-wait semantics instead of throwing immediately on 0 matches.
          // Full `timeout` is intentional here — RANDOM is load-bearing (the
          // result feeds into a sample) and gets the caller's full budget.
          // Contrast with the ATTACH_PROBE_TIMEOUT_MS cap on ALL/TEXT/default
          // paths, which gate a best-effort probe whose failure is swallowed.
          // Use .first() to avoid Playwright strict-mode violations on locators
          // that match multiple elements (e.g. a list of size labels).
          try {
            await base.first().waitFor({ state: 'visible', timeout });
          } catch {
            throw new Error(`No elements found for '${elementName}' on '${pageName}'`);
          }
          const all = await base.all();
          if (all.length === 0) {
            throw new Error(`No elements found for '${elementName}' on '${pageName}'`);
          }
          return all[pickRandomIndex(all.length)];
        }
        case SelectionStrategy.ALL: {
          const element = new WebElement(locator, desc, timeout);
          await element.waitFor({ state: 'attached', timeout: Math.min(timeout, ATTACH_PROBE_TIMEOUT_MS) }).catch(() => {});
          return element;
        }
        case SelectionStrategy.TEXT: {
          if (!options.value?.trim()) {
            throw new Error('options.value is required when using SelectionStrategy.TEXT');
          }
          const filtered = locator.filter({ hasText: options.value });
          const element = new WebElement(filtered.first(), desc, timeout);
          await element.waitFor({ state: 'attached', timeout: Math.min(timeout, ATTACH_PROBE_TIMEOUT_MS) }).catch(() => {});
          return element;
        }
        case SelectionStrategy.ATTRIBUTE: {
          const base = new WebElement(locator, desc, timeout);
          return StrategyResolver.resolveByAttribute(base, elementName, pageName, timeout, options);
        }
        default:
          throw unhandledStrategyError(options.strategy, elementName, pageName);
      }
    }

    const element = new WebElement(locator.first(), desc, timeout);
    await element.waitFor({ state: 'attached', timeout: Math.min(timeout, ATTACH_PROBE_TIMEOUT_MS) }).catch(() => {});
    return element;
  }

  /**
   * Creates an Element from a selector string and applies the requested
   * selection strategy. Branches on platform to produce {@link WebElement}
   * (Playwright) or {@link PlatformElement} (WebDriverIO/Appium).
   *
   * Used for the standard resolution path when no enhanced selector is needed.
   *
   * @param driver The Playwright `Page` or WebDriverIO `Browser`/`Driver` instance.
   * @param selector The formatted selector string (e.g. `css=button.primary`, `#submit`).
   * @param pageObj The page definition from the JSON repository (used for platform detection).
   * @param elementName The element name (used for error messages).
   * @param pageName The page name (used for error messages).
   * @param timeout The wait timeout in milliseconds.
   * @param options Optional element resolution options (strategy, index, value).
   * @returns A promise that resolves to the located Element.
   */
  static async fromSelector(
    driver: any,
    selector: string,
    pageObj: PageObject,
    elementName: string,
    pageName: string,
    timeout: number,
    options?: ElementResolutionOptions,
  ): Promise<Element> {
    const isWeb = EnhancedResolver.isWebPlatform(pageObj);
    // The page's platform, so platform elements name it in their errors.
    const platform = pageObj.platform;

    if (options?.strategy) {
      switch (options.strategy) {
        case SelectionStrategy.INDEX: {
          if (options.index === undefined || options.index === null) {
            throw new Error('options.index is required when using SelectionStrategy.INDEX');
          }
          const base = isWeb
            ? new WebElement(driver.locator(selector), selector, timeout)
            : new PlatformElement(driver, selector, undefined, timeout, { platform });
          const all = await base.all();
          if (options.index < 0 || options.index >= all.length) {
            throw new Error(`Index ${options.index} out of bounds for '${elementName}' on '${pageName}' (found ${all.length} elements).`);
          }
          return all[options.index];
        }
        case SelectionStrategy.RANDOM: {
          const base = isWeb
            ? new WebElement(driver.locator(selector), selector, timeout)
            : new PlatformElement(driver, selector, undefined, timeout, { platform });
          
          // Wait for at least one element to be visible before sampling. Full
          // `timeout` is intentional — see the matching block in `fromLocator`
          // for the rationale (RANDOM is load-bearing, not a swallowed probe).
          // Use .first() to avoid Playwright strict-mode violations on locators
          // that match multiple elements (e.g. a list of size labels).
          try {
            await base.first().waitFor({ state: 'visible', timeout });
          } catch {
            throw new Error(`No elements found for '${elementName}' on '${pageName}'`);
          }
          const all = await base.all();
          if (all.length === 0) {
            throw new Error(`No elements found for '${elementName}' on '${pageName}'`);
          }
          return all[pickRandomIndex(all.length)];
        }
        case SelectionStrategy.TEXT: {
          if (!options.value?.trim()) {
            throw new Error('options.value is required when using SelectionStrategy.TEXT');
          }
          if (!isWeb) {
            return StrategyResolver.resolvePlatformByText(driver, selector, elementName, pageName, timeout, options.value, platform);
          }
          const filtered = driver.locator(selector).filter({ hasText: options.value });
          const element = new WebElement(filtered.first(), selector, timeout);
          await element.waitFor({ state: 'attached', timeout: Math.min(timeout, ATTACH_PROBE_TIMEOUT_MS) }).catch(() => {});
          return element;
        }
        case SelectionStrategy.ALL: {
          const element = isWeb
            ? new WebElement(driver.locator(selector), selector, timeout)
            : new PlatformElement(driver, selector, undefined, timeout, { platform });
          await element.waitFor({ state: 'attached', timeout: Math.min(timeout, ATTACH_PROBE_TIMEOUT_MS) }).catch(() => {});
          return element;
        }
        case SelectionStrategy.ATTRIBUTE: {
          const base = isWeb
            ? new WebElement(driver.locator(selector), selector, timeout)
            : new PlatformElement(driver, selector, undefined, timeout, { platform });
          return StrategyResolver.resolveByAttribute(base, elementName, pageName, timeout, options);
        }
        default:
          throw unhandledStrategyError(options.strategy, elementName, pageName);
      }
    }

    const base = isWeb
      ? new WebElement(driver.locator(selector), selector, timeout)
      : new PlatformElement(driver, selector, undefined, timeout, { platform });
    const element = base.first();
    await element.waitFor({ state: 'attached', timeout: Math.min(timeout, ATTACH_PROBE_TIMEOUT_MS) }).catch(() => {});
    return element;
  }

  /**
   * Creates a {@link PlatformElement} from a mobile selector string produced
   * by the {@link EnhancedResolver} (e.g., a UiSelector or iOS predicate string).
   *
   * @param driver The WebDriverIO `Browser`/`Driver` instance.
   * @param selector The platform-native selector string (e.g. `android=new UiSelector()...`).
   * @param timeout The wait timeout in milliseconds.
   * @param options Optional element resolution options (only ALL strategy is supported).
   * @param platform The page's platform, named by the element's errors
   * (read from the driver when omitted).
   * @returns A promise that resolves to the located Element.
   */
  static async fromMobileSelector(
    driver: any,
    selector: string,
    timeout: number,
    options?: ElementResolutionOptions,
    platform?: Platform,
  ): Promise<Element> {
    const base = new PlatformElement(driver, selector, undefined, timeout, { platform });

    if (options?.strategy === SelectionStrategy.ALL) {
      await base.waitFor({ state: 'attached', timeout }).catch(() => {});
      return base;
    }

    if (options?.strategy) {
      // Platform-native enhanced selectors (UiSelector / iOS predicate strings)
      // cannot express the other strategies — fail loud instead of silently
      // resolving the first match with the requested filter ignored.
      throw unhandledStrategyError(options.strategy, `mobile:${selector}`, 'enhanced-selector path', SelectionStrategy.ALL);
    }

    const element = base.first();
    await element.waitFor({ state: 'attached', timeout }).catch(() => {});
    return element;
  }

  /**
   * Applies the TEXT strategy on a platform (WebDriverIO/Appium) page.
   *
   * There is no lazy text filter in WebDriverIO, so the match is picked
   * eagerly: all matches of `selector` are fetched with `driver.$$`, each
   * one's text is read with the same rule as
   * {@link PlatformElement.textContent} (see `readPlatformText`: on iOS the
   * `label`, else `value`; `value` first for text inputs; on Android
   * `getText()`; on both, for an element with no text of its own, its
   * descendants' text joined with single spaces; elsewhere `getText()`),
   * and the chosen raw element is wrapped in a {@link PlatformElement}.
   *
   * The text compared is the element's OWN text as the driver reports it,
   * not the text of its descendants as Playwright's `filter({ hasText })`
   * uses on web, with one exception: on iOS and Android an element whose
   * own text is empty is read as a container, by its descendants' text (a
   * list row whose title and subtitle are child TextViews, an iOS Cell
   * whose text is a child StaticText). The selector should therefore
   * target the text-bearing element itself (the label or cell title), or a
   * container without text of its own. A container row costs extra driver
   * round trips (the descendant query and one read per text-bearing
   * descendant), and a selector matching a large container reads every
   * text inside it.
   *
   * An exact (trimmed) match is preferred; otherwise the first
   * case-insensitive, whitespace-normalised "contains" match is taken.
   *
   * The returned element is bound to the chosen match for single-element
   * actions, but `all()` / `count()` on it re-query `selector` and return
   * every match, not only the text-matching one.
   *
   * Because the result is picked eagerly it is load-bearing, like ATTRIBUTE
   * and RANDOM: the lookup polls until a match appears or the caller's full
   * `timeout` elapses, rather than the swallowed 2 s attach probe of the web
   * path. Each poll is one pass: one `$$` query, then the text of every
   * match it returned (an exact match ends the pass early). A started pass
   * always reads every match, so a small budget still finds a match late in
   * a slow list; the deadline only decides whether another pass starts. A
   * long list's last pass may therefore overrun the timeout by up to one
   * pass. With no match it throws the same not-found error as
   * `ElementRepository.getByText`.
   *
   * Driver errors: see {@link isFatalDriverError}. A fatal error (invalid
   * selector, invalid or dead session) is rethrown at once. Any other error
   * is treated as a transient missing/stale element: the lookup keeps
   * polling, and the last such error is appended to the final not-found
   * message as `(last driver error: <name>: <message>)`.
   */
  private static async resolvePlatformByText(
    driver: any,
    selector: string,
    elementName: string,
    pageName: string,
    timeout: number,
    value: string,
    platform?: Platform,
  ): Promise<Element> {
    const normalise = (s: string) => s.replace(/\s+/g, ' ').trim().toLowerCase();
    const wanted = value.trim();
    const wantedNorm = normalise(value);
    const deadline = Date.now() + timeout;
    const textPlatform = platform ?? detectDriverPlatform(driver);
    let lastError: unknown;

    const remember = (err: unknown) => {
      if (isFatalDriverError(err)) throw err;
      lastError = err;
    };

    for (;;) {
      let raws: any[] = [];
      try { raws = Array.from((await driver.$$(selector)) ?? []); } catch (err) { remember(err); raws = []; }

      // A started pass reads every match (the deadline is checked only
      // between passes). An exact match wins, so the first one ends the
      // reads; otherwise the texts read are kept for the "contains" fallback.
      const texts: Array<string | null> = [];
      let index = -1;
      for (const raw of raws) {
        let text: string | null;
        try { text = ((await readPlatformText(raw, textPlatform)) ?? '').trim(); } catch (err) { remember(err); text = null; }
        texts.push(text);
        if (text !== null && text === wanted) { index = texts.length - 1; break; }
      }

      if (index < 0) index = texts.findIndex(t => t !== null && normalise(t).includes(wantedNorm));
      if (index >= 0) return new PlatformElement(driver, selector, raws[index], timeout, { platform });

      const remaining = deadline - Date.now();
      if (remaining <= 0) break;
      await new Promise(resolve => setTimeout(resolve, Math.min(TEXT_POLL_INTERVAL_MS, remaining)));
    }

    const suffix = lastError === undefined ? '' : ` (last driver error: ${describeError(lastError)})`;
    throw new Error(`Element '${elementName}' on '${pageName}' with text "${value}" not found.${suffix}`);
  }

  /**
   * Applies the ATTRIBUTE strategy on top of an already-constructed base
   * Element: waits for at least one match, then filters the full element
   * list by attribute value via {@link filterByAttribute}.
   *
   * ATTRIBUTE is load-bearing (the result feeds a targeted action), so the
   * initial wait gets the caller's full timeout budget — same contract as
   * RANDOM, not the swallowed 2s attach probe of the ALL/TEXT/default paths.
   *
   * @param base The base Element matching the un-filtered selector.
   * @param elementName The element name (used for error messages).
   * @param pageName The page name (used for error messages).
   * @param timeout The wait timeout in milliseconds.
   * @param options Resolution options; `attribute` and `value` are required.
   * @returns A promise that resolves to the matched Element.
   * @throws Error when `attribute`/`value` are missing, no elements attach
   *   within the timeout, or no element matches the attribute filter.
   */
  private static async resolveByAttribute(
    base: Element,
    elementName: string,
    pageName: string,
    timeout: number,
    options: ElementResolutionOptions,
  ): Promise<Element> {
    if (!options.attribute) {
      throw new Error('options.attribute is required when using SelectionStrategy.ATTRIBUTE');
    }
    if (options.value === undefined || options.value === null) {
      throw new Error('options.value is required when using SelectionStrategy.ATTRIBUTE');
    }

    // Use .first() to avoid Playwright strict-mode violations on locators
    // that match multiple elements. 'attached' rather than 'visible' —
    // attribute filters legitimately target non-visible elements.
    try {
      await base.first().waitFor({ state: 'attached', timeout });
    } catch {
      throw new Error(`No elements found for '${elementName}' on '${pageName}'`);
    }

    const all = await base.all();
    const match = await StrategyResolver.filterByAttribute(all, options.attribute, options.value);
    if (!match) {
      throw new Error(
        `Element '${elementName}' on '${pageName}' with attribute [${options.attribute}] matching "${options.value}" not found.`,
      );
    }
    return match;
  }

  /**
   * Filters an element list by an HTML attribute value.
   *
   * Matching strategy: when `exact` is not specified, first attempts an exact
   * match, then falls back to a contains match. When `exact` is explicitly
   * set, only that matching mode is used.
   *
   * Single source of truth for attribute filtering — used by both the
   * ATTRIBUTE selection strategy here and `ElementRepository.getByAttribute`.
   *
   * @param elements The elements to filter.
   * @param attribute The HTML attribute name to filter by.
   * @param value The attribute value to match against.
   * @param exact If true, requires an exact match; if false, a contains match; if omitted, exact-then-contains.
   * @returns A promise that resolves to the first matched Element, or null when nothing matches.
   */
  static async filterByAttribute(
    elements: Element[],
    attribute: string,
    value: string,
    exact?: boolean,
  ): Promise<Element | null> {
    // When exact is explicitly set, use only that matching mode
    if (exact !== undefined) {
      for (const element of elements) {
        const attrValue = await element.getAttribute(attribute);
        if (attrValue === null) continue;
        if (exact ? attrValue === value : attrValue.includes(value)) return element;
      }
      return null;
    }

    // Default: try exact match first, then fall back to contains
    for (const element of elements) {
      const attrValue = await element.getAttribute(attribute);
      if (attrValue === value) return element;
    }
    for (const element of elements) {
      const attrValue = await element.getAttribute(attribute);
      if (attrValue !== null && attrValue.includes(value)) return element;
    }
    return null;
  }
}
