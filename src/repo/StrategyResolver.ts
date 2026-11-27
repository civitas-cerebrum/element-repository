import { PageObject } from '../schema/repository';
import { Element, WebElement, PlatformElement, isWeb } from '../types';
import { ElementResolutionOptions, SelectionStrategy } from '../enum/Options';
import { pickRandomIndex } from '../utils/math';
import { EnhancedResolver } from './EnhancedResolver';
import { isFatalDriverError } from '../utils/driverErrors';
import { ElementNotFoundError, TextNotFoundError } from '../types/errors';
import type { Platform } from '../enum/Platform';
import { detectDriverPlatform, readPlatformText } from '../utils/platformText';
import {
  abortableSleep, argumentError, raceAbort, rethrowAbort, throwIfAborted, type AbortContext,
} from '../utils/abort';
import { bindLookupSignal, runLookup } from '../utils/lookupSignal';
import {
  normaliseText, pickTextTokens, narrowedTextQueries, runNarrowedQueries, pickFromHits, snapshotConfirmedComplete,
  fullPassTruncation, type TextVerdict, type NarrowedPick, type SnapshotState,
} from '../utils/textNarrowing';

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

/** Strategies `fromLocator` / `fromSelector` handle — used in the unhandled-strategy error. */
const HANDLED_STRATEGIES = [
  SelectionStrategy.INDEX,
  SelectionStrategy.RANDOM,
  SelectionStrategy.TEXT,
  SelectionStrategy.ATTRIBUTE,
  SelectionStrategy.ALL,
].join(', ');

/** Poll interval of the RANDOM / ATTRIBUTE wait between attempts that hit a driver error, or between platform polls. */
const MATCH_POLL_INTERVAL_MS = 250;

/**
 * A `.catch()` handler for a best-effort attach probe: an abort and a fatal
 * driver error ({@link isFatalDriverError}: dead session, invalid selector,
 * ...) are thrown as they are; any other error is swallowed (the lazy element
 * is returned and its action reports its own error).
 */
function ignoreProbeError(err: unknown): void {
  rethrowAbort(err);
  if (isFatalDriverError(err)) throw err;
}

/**
 * True for a wait that ran out of time on web: Playwright's `TimeoutError`,
 * or its `Timeout <n>ms exceeded` message.
 */
function isWaitTimeout(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const { name, message } = err as { name?: unknown; message?: unknown };
  return name === 'TimeoutError' || (typeof message === 'string' && /Timeout \d+ms exceeded/.test(message));
}

function unhandledStrategyError(strategy: string, elementName: string, pageName: string, handled: string = HANDLED_STRATEGIES): Error {
  return argumentError(
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
   * @param options Optional element resolution options (strategy, index,
   * value, and the lookup's `signal`; see `LookupOptions`).
   * @returns A promise that resolves to the located Element.
   */
  static async fromLocator(
    locator: any,
    elementName: string,
    pageName: string,
    timeout: number,
    options?: ElementResolutionOptions,
  ): Promise<Element> {
    const signal = options?.signal;
    return runLookup(signal, { elementName, pageName }, () => StrategyResolver.locatorLookup(locator, elementName, pageName, timeout, options));
  }

  /** Body of {@link fromLocator}; the elements it builds carry the lookup signal. */
  private static async locatorLookup(
    locator: any,
    elementName: string,
    pageName: string,
    timeout: number,
    options?: ElementResolutionOptions,
  ): Promise<Element> {
    const desc = `enhanced:${elementName}@${pageName}`;
    const signal = options?.signal;
    const web = (l: any) => bindLookupSignal(new WebElement(l, desc, timeout), signal);

    if (options?.strategy) {
      switch (options.strategy) {
        case SelectionStrategy.INDEX: {
          if (options.index === undefined || options.index === null) {
            throw argumentError('options.index is required when using SelectionStrategy.INDEX');
          }
          const base = web(locator);
          const all = await base.all();
          if (options.index < 0 || options.index >= all.length) {
            throw new Error(`Index ${options.index} out of bounds for '${elementName}' on '${pageName}' (found ${all.length} elements).`);
          }
          return all[options.index];
        }
        case SelectionStrategy.RANDOM: {
          const base = web(locator);
          // Wait for at least one element to be visible before sampling so that
          // `clickRandom` / `getRandom` compose with Playwright's standard
          // auto-wait semantics instead of throwing immediately on 0 matches.
          // Full `timeout` is intentional here — RANDOM is load-bearing (the
          // result feeds into a sample) and gets the caller's full budget.
          // Contrast with the ATTACH_PROBE_TIMEOUT_MS cap on ALL/TEXT/default
          // paths, which gate a best-effort probe whose failure is swallowed.
          // Use .first() to avoid Playwright strict-mode violations on locators
          // that match multiple elements (e.g. a list of size labels).
          return StrategyResolver.pickRandom(base, elementName, pageName, timeout, signal);
        }
        case SelectionStrategy.ALL: {
          const element = web(locator);
          await element.waitFor({ state: 'attached', timeout: Math.min(timeout, ATTACH_PROBE_TIMEOUT_MS) }).catch(ignoreProbeError);
          return element;
        }
        case SelectionStrategy.TEXT: {
          if (!options.value?.trim()) {
            throw argumentError('options.value is required when using SelectionStrategy.TEXT');
          }
          const filtered = locator.filter({ hasText: options.value });
          const element = web(filtered.first());
          await element.waitFor({ state: 'attached', timeout: Math.min(timeout, ATTACH_PROBE_TIMEOUT_MS) }).catch(ignoreProbeError);
          return element;
        }
        case SelectionStrategy.ATTRIBUTE: {
          const base = web(locator);
          return StrategyResolver.resolveByAttribute(base, elementName, pageName, timeout, options);
        }
        default:
          throw unhandledStrategyError(options.strategy, elementName, pageName);
      }
    }

    const element = web(locator.first());
    await element.waitFor({ state: 'attached', timeout: Math.min(timeout, ATTACH_PROBE_TIMEOUT_MS) }).catch(ignoreProbeError);
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
   * @param options Optional element resolution options (strategy, index,
   * value, and the lookup's `signal`; see `LookupOptions`).
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
    return runLookup(
      options?.signal, { elementName, pageName },
      () => StrategyResolver.selectorLookup(driver, selector, pageObj, elementName, pageName, timeout, options),
    );
  }

  /** Body of {@link fromSelector}; the elements it builds carry the lookup signal. */
  private static async selectorLookup(
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
    const signal = options?.signal;
    // The un-filtered base element for `selector`, carrying the lookup signal.
    const make = (): Element => bindLookupSignal(
      isWeb
        ? new WebElement(driver.locator(selector), selector, timeout)
        : new PlatformElement(driver, selector, undefined, timeout, { platform }),
      signal,
    );

    if (options?.strategy) {
      switch (options.strategy) {
        case SelectionStrategy.INDEX: {
          if (options.index === undefined || options.index === null) {
            throw argumentError('options.index is required when using SelectionStrategy.INDEX');
          }
          const base = make();
          const all = await base.all();
          if (options.index < 0 || options.index >= all.length) {
            throw new Error(`Index ${options.index} out of bounds for '${elementName}' on '${pageName}' (found ${all.length} elements).`);
          }
          return all[options.index];
        }
        case SelectionStrategy.RANDOM: {
          const base = make();

          // Wait for at least one element to be visible before sampling. Full
          // `timeout` is intentional — see the matching block in `fromLocator`
          // for the rationale (RANDOM is load-bearing, not a swallowed probe).
          // Use .first() to avoid Playwright strict-mode violations on locators
          // that match multiple elements (e.g. a list of size labels).
          return StrategyResolver.pickRandom(base, elementName, pageName, timeout, signal);
        }
        case SelectionStrategy.TEXT: {
          if (!options.value?.trim()) {
            throw argumentError('options.value is required when using SelectionStrategy.TEXT');
          }
          if (!isWeb) {
            return StrategyResolver.resolvePlatformByText(
              driver, selector, elementName, pageName, timeout, options.value, platform, signal,
              options.requireFullPass === true,
            );
          }
          const filtered = driver.locator(selector).filter({ hasText: options.value });
          const element = bindLookupSignal(new WebElement(filtered.first(), selector, timeout), signal);
          await element.waitFor({ state: 'attached', timeout: Math.min(timeout, ATTACH_PROBE_TIMEOUT_MS) }).catch(ignoreProbeError);
          return element;
        }
        case SelectionStrategy.ALL: {
          const element = make();
          await element.waitFor({ state: 'attached', timeout: Math.min(timeout, ATTACH_PROBE_TIMEOUT_MS) }).catch(ignoreProbeError);
          return element;
        }
        case SelectionStrategy.ATTRIBUTE: {
          const base = make();
          return StrategyResolver.resolveByAttribute(base, elementName, pageName, timeout, options);
        }
        default:
          throw unhandledStrategyError(options.strategy, elementName, pageName);
      }
    }

    const element = make().first();
    await element.waitFor({ state: 'attached', timeout: Math.min(timeout, ATTACH_PROBE_TIMEOUT_MS) }).catch(ignoreProbeError);
    return element;
  }

  /**
   * Creates a {@link PlatformElement} from a mobile selector string produced
   * by the {@link EnhancedResolver} (e.g., a UiSelector or iOS predicate string).
   *
   * @param driver The WebDriverIO `Browser`/`Driver` instance.
   * @param selector The platform-native selector string (e.g. `android=new UiSelector()...`).
   * @param timeout The wait timeout in milliseconds.
   * @param options Optional element resolution options (only ALL strategy
   * is supported; the lookup's `signal`, see `LookupOptions`).
   * @param platform The page's platform, named by the element's errors
   * (read from the driver when omitted).
   * @param elementName The repository entry's element name, named by an abort error.
   * @param pageName The repository entry's page name, named by an abort error.
   * @returns A promise that resolves to the located Element.
   */
  static async fromMobileSelector(
    driver: any,
    selector: string,
    timeout: number,
    options?: ElementResolutionOptions,
    platform?: Platform,
    elementName?: string,
    pageName?: string,
  ): Promise<Element> {
    return runLookup(
      options?.signal, { elementName, pageName },
      () => StrategyResolver.mobileLookup(driver, selector, timeout, options, platform),
    );
  }

  /** Body of {@link fromMobileSelector}; the elements it builds carry the lookup signal. */
  private static async mobileLookup(
    driver: any,
    selector: string,
    timeout: number,
    options?: ElementResolutionOptions,
    platform?: Platform,
  ): Promise<Element> {
    const base = bindLookupSignal(new PlatformElement(driver, selector, undefined, timeout, { platform }), options?.signal);

    if (options?.strategy === SelectionStrategy.ALL) {
      await base.waitFor({ state: 'attached', timeout }).catch(ignoreProbeError);
      return base;
    }

    if (options?.strategy) {
      // Platform-native enhanced selectors (UiSelector / iOS predicate strings)
      // cannot express the other strategies — fail loud instead of silently
      // resolving the first match with the requested filter ignored.
      throw unhandledStrategyError(options.strategy, `mobile:${selector}`, 'enhanced-selector path', SelectionStrategy.ALL);
    }

    const element = base.first();
    await element.waitFor({ state: 'attached', timeout }).catch(ignoreProbeError);
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
   * Narrowing: on iOS and Android, a poll first asks the driver only for
   * the matches whose text could match (see `textNarrowing`): the distinct
   * words of the value (normalised as above) the query can carry, the
   * longest four, are looked for, case-insensitively, all in each match's
   * own text or all in its descendants' text. Android sends ONE XPath
   * (`(<base>)[(contains(...) and ...) or (.//*[...contains(...)] and
   * ...)]`), iOS TWO disjoint queries (a class chain or predicate string
   * for own `label` or own `value` holding every word, a class chain for a
   * match whose StaticText descendant holds the longest word). The rule
   * above is applied only to those hits, in the order the driver returned them; on Android that is exactly
   * the full pass's answer. On iOS, when the winning hits (the exact ones,
   * else the contains ones) come from both queries, their relative order is
   * unknown, so that poll runs the full pass. No hit is a clean miss for
   * the poll, and polling goes on. A hit costs one or two queries plus the
   * hits' reads, a miss one or two queries, instead of reading every match.
   * The lookup is not narrowed (every poll is the full pass below) when the
   * platform is neither, the selector kind cannot be composed onto (only
   * XPath on Android, a full resource id, an accessibility id, a class
   * name, an iOS class chain or predicate string), or no word of the value
   * is safe for the query. When a narrowed query fails, a lost session or
   * connection (`isSessionLostError`) is thrown; any other error
   * (also `invalid selector` / `invalid argument`) makes this poll and every
   * later one a full pass; it is not reported in the not-found message or
   * `lastDriverError` (the full passes' own errors are, as before). On iOS
   * a `value CONTAINS` on a non-string value (a switch, a slider) may make
   * WebDriverAgent fail the narrowed query this way: the lookup is then
   * slower, but its answer is the same.
   *
   * Confirming a narrowed miss: the narrowed queries run on the driver's
   * snapshot, which UiAutomator2 and WebDriverAgent cut off at
   * `snapshotMaxDepth` (default 70 and 50), while the full pass's text
   * reads start again at each match. So when the last poll's narrowed
   * queries miss, the lookup reads `snapshotMaxDepth` (one `getSettings()`)
   * and runs one depth query (see `depthSentinelQuery`). Nothing that deep:
   * the miss is final (`missBasis: 'narrowed'`). Something that deep, or
   * either call failing (a lost session is thrown; other errors are not
   * reported): ONE full pass runs; a match is returned, else the
   * `TextNotFoundError` has `missBasis: 'full-pass'` and that pass's
   * `cleanMiss` / `lastDriverError`. That pass may overrun the timeout by
   * one pass. With `requireFullPass`, the full pass always runs first.
   * Earlier polls are never confirmed: per lookup there is at most one
   * settings read, one depth query and one confirming pass.
   *
   * `snapshotTruncated` on the error: `false` for a narrowed miss (the
   * snapshot was confirmed complete). For a miss of a full pass (the
   * confirming one, or the last poll's when the lookup was not narrowed),
   * the depth check (one settings read and one depth query) runs after that
   * pass unless it ran before it, and the flag is `true` when it found the
   * cut-off level and the pass's own find runs on the snapshot (any iOS
   * selector; an Android XPath): a match below the cut-off can then be
   * missed even by the full pass. An Android accessibility id, resource id
   * (the full or the short `id=` form), class name or UiAutomator selector
   * is found on the live hierarchy, so its full pass's miss
   * stands: `false`, with no check. Absent when the check could not run
   * (or on a platform other than iOS and Android).
   *
   * Because the result is picked eagerly it is load-bearing, like ATTRIBUTE
   * and RANDOM: the lookup polls until a match appears or the caller's full
   * `timeout` elapses, rather than the swallowed 2 s attach probe of the web
   * path. A full pass is one `$$` query, then the text of every
   * match it returned (an exact match ends the pass early). A started pass
   * always reads every match, so a small budget still finds a match late in
   * a slow list; the deadline only decides whether another pass starts. A
   * long list's last pass may therefore overrun the timeout by up to one
   * pass. With no match it throws a {@link TextNotFoundError} with the same
   * message as `ElementRepository.getByText`.
   *
   * Driver errors: see {@link isFatalDriverError}. A fatal error (invalid
   * selector, invalid or dead session) is rethrown at once. Any other error
   * is treated as a transient missing/stale element: the lookup keeps
   * polling, and the last such error is appended to the final not-found
   * message as `(last driver error: <name>: <message>)` and kept in
   * `lastDriverError`; `cleanMiss` is `false` when the final pass hit one.
   *
   * With `signal` (see `LookupOptions`), the signal is checked at the top of
   * every pass, before each query and before each text read; an abort is
   * thrown at once (never kept as `lastDriverError`, never polled through),
   * and the sleep between passes wakes on it.
   */
  private static async resolvePlatformByText(
    driver: any,
    selector: string,
    elementName: string,
    pageName: string,
    timeout: number,
    value: string,
    platform?: Platform,
    signal?: AbortSignal,
    requireFullPass = false,
  ): Promise<Element> {
    const ctx: AbortContext = { elementName, pageName };
    const check = () => throwIfAborted(signal, ctx);
    const wanted = value.trim();
    const wantedNorm = normaliseText(value);
    const deadline = Date.now() + timeout;
    const textPlatform = platform ?? detectDriverPlatform(driver);
    let lastError: unknown;
    // The pass being run and the last pass that hit a non-fatal driver
    // error: the final pass is a clean miss when they differ.
    let pass = 0;
    let lastErrorPass = 0;

    const remember = (err: unknown) => {
      rethrowAbort(err);
      if (isFatalDriverError(err)) throw err;
      lastError = err;
      lastErrorPass = pass;
    };

    /** A match's text under the rule, trimmed, or `null` when the read failed (non-fatally). */
    const readText = async (raw: any): Promise<string | null> => {
      check();
      try { return ((await readPlatformText(raw, textPlatform, signal)) ?? '').trim(); } catch (err) { remember(err); return null; }
    };

    // The full pass: every match of the selector. A started pass reads
    // every match (the deadline is checked only between passes). An exact
    // match wins, so the first one ends the reads; otherwise the texts read
    // are kept for the "contains" fallback.
    const fullPass = async (): Promise<any> => {
      let raws: any[] = [];
      check();
      try { raws = Array.from((await driver.$$(selector)) ?? []); } catch (err) { remember(err); raws = []; }
      const texts: Array<string | null> = [];
      let index = -1;
      for (const raw of raws) {
        const text = await readText(raw);
        texts.push(text);
        if (text !== null && text === wanted) { index = texts.length - 1; break; }
      }
      if (index < 0) index = texts.findIndex(t => t !== null && normaliseText(t).includes(wantedNorm));
      return index >= 0 ? raws[index] : undefined;
    };

    // Narrowed passes (see textNarrowing): the same rule, applied only to
    // the hits of queries that hold every match whose text could match.
    // `null` = not narrowed: the selector kind, the platform or every word
    // of the value is not narrowable, or a narrowed query failed before.
    let queries = narrowedTextQueries(selector, textPlatform, pickTextTokens(value, textPlatform));
    const judge = async (raw: any): Promise<TextVerdict> => {
      const text = await readText(raw);
      if (text === null) return 'none';
      if (text === wanted) return 'exact';
      return normaliseText(text).includes(wantedNorm) ? 'contains' : 'none';
    };

    // True when the last poll's miss came from the narrowed queries alone.
    let narrowedMiss = false;
    for (;;) {
      check();
      pass++;
      let picked: NarrowedPick | undefined;
      if (queries) {
        const hits = await runNarrowedQueries(driver, queries, signal);
        if ('error' in hits) {
          // The driver could not run a narrowed query: this poll and every
          // later one read the full match list. The error belongs to a
          // query the caller never wrote, so it is not reported: the full
          // passes' own errors are, and decide whether the miss is clean.
          queries = null;
        } else {
          picked = await pickFromHits(hits.lists, judge);
        }
      }
      const raw = picked === undefined || picked === 'ambiguous'
        ? await fullPass()
        : picked?.raw;
      if (raw !== undefined) return new PlatformElement(driver, selector, raw, timeout, { platform });
      narrowedMiss = picked === null;

      const remaining = deadline - Date.now();
      if (remaining <= 0) break;
      await abortableSleep(Math.min(TEXT_POLL_INTERVAL_MS, remaining), signal, ctx);
    }

    // A narrowed miss ends the lookup only over a snapshot confirmed not
    // cut off at snapshotMaxDepth; otherwise one full pass decides. A miss
    // of a full pass gets the depth check after it (unless one ran before
    // it), so snapshotTruncated says whether that pass could be affected.
    let missBasis: 'full-pass' | 'narrowed' = 'full-pass';
    let snapshot: SnapshotState | undefined;
    let snapshotTruncated: boolean | undefined;
    if (narrowedMiss && !requireFullPass) {
      snapshot = await snapshotConfirmedComplete(driver, textPlatform, signal);
      if (snapshot === 'complete') {
        missBasis = 'narrowed';
        snapshotTruncated = false;
      }
    }
    if (missBasis === 'full-pass') {
      if (narrowedMiss) {
        check();
        pass++;
        const raw = await fullPass();
        if (raw !== undefined) return new PlatformElement(driver, selector, raw, timeout, { platform });
      }
      snapshotTruncated = await fullPassTruncation(driver, selector, textPlatform, signal, snapshot);
    }

    check();
    throw new TextNotFoundError({
      elementName, pageName, text: value, lastDriverError: lastError, cleanMiss: lastErrorPass !== pass, missBasis,
      snapshotTruncated,
    });
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
      throw argumentError('options.attribute is required when using SelectionStrategy.ATTRIBUTE');
    }
    if (options.value === undefined || options.value === null) {
      throw argumentError('options.value is required when using SelectionStrategy.ATTRIBUTE');
    }

    // 'attached' rather than 'visible' — attribute filters legitimately
    // target non-visible elements.
    const all = await StrategyResolver.awaitMatches(base, 'attached', elementName, pageName, timeout, 'attribute', options.signal);
    const match = await StrategyResolver.filterByAttribute(all, options.attribute, options.value, undefined, options.signal);
    if (!match) {
      // The reads that filter throw their own errors, so a miss here is clean.
      throw new ElementNotFoundError({
        elementName, pageName, strategy: 'attribute',
        message: `Element '${elementName}' on '${pageName}' with attribute [${options.attribute}] matching "${options.value}" not found.`,
      });
    }
    return match;
  }

  /**
   * The RANDOM strategy: waits for the first match to be visible (see
   * {@link awaitMatches}), then picks one of all the matches at random.
   * Throws an {@link ElementNotFoundError} (`strategy: 'random'`) when none
   * is there.
   */
  private static async pickRandom(
    base: Element, elementName: string, pageName: string, timeout: number, signal: AbortSignal | undefined,
  ): Promise<Element> {
    const all = await StrategyResolver.awaitMatches(base, 'visible', elementName, pageName, timeout, 'random', signal);
    if (all.length === 0) throw new ElementNotFoundError({ elementName, pageName, strategy: 'random' });
    return all[pickRandomIndex(all.length)];
  }

  /**
   * The load-bearing wait of RANDOM (`visible`) and ATTRIBUTE (`attached`):
   * waits up to the caller's full `timeout` for the first match of `base` to
   * reach `state` and returns every match.
   *
   * Driver errors (see {@link isFatalDriverError}): an abort and a fatal
   * error (dead session, invalid selector, ...) are thrown as they are, at
   * once. Any other error is not a miss: the wait goes on until the
   * deadline. When the deadline passes with no match, an
   * {@link ElementNotFoundError} is thrown whose `lastDriverError` (also its
   * `cause` and the message suffix ` (last driver error: ...)`) is the last
   * such error of any poll, and whose `cleanMiss` is `false` when the final
   * poll hit one.
   *
   * - Platform: polls `all()` (one `$$`) every 250 ms; for `visible`, the
   *   first match's `isDisplayed()` is read too. No match, or a first match
   *   not shown, is a clean poll.
   * - Web: Playwright's `waitFor` on the first match (Playwright retries
   *   inside it); its timeout is the clean miss; any other non-fatal error
   *   is retried after 250 ms with the time left. On success the matches
   *   are read with `all()`, whose errors are thrown as they are.
   */
  private static async awaitMatches(
    base: Element,
    state: 'visible' | 'attached',
    elementName: string,
    pageName: string,
    timeout: number,
    strategy: 'random' | 'attribute',
    signal: AbortSignal | undefined,
  ): Promise<Element[]> {
    const ctx: AbortContext = { elementName, pageName };
    const deadline = Date.now() + timeout;
    let lastError: unknown;
    let finalFailed = false;
    const remember = (err: unknown) => {
      rethrowAbort(err);
      if (isFatalDriverError(err)) throw err;
      lastError = err;
      finalFailed = true;
    };
    const miss = () => new ElementNotFoundError({
      elementName, pageName, strategy, lastDriverError: lastError, cleanMiss: !finalFailed,
    });

    if (isWeb(base)) {
      // Use .first() to avoid Playwright strict-mode violations on locators
      // that match multiple elements (e.g. a list of size labels).
      for (let attempt = 0; ; attempt++) {
        const remaining = attempt === 0 ? timeout : deadline - Date.now();
        try {
          await base.first().waitFor({ state, timeout: remaining });
        } catch (err) {
          rethrowAbort(err);
          if (isFatalDriverError(err)) throw err;
          if (isWaitTimeout(err)) { finalFailed = false; throw miss(); }
          remember(err);
          const left = deadline - Date.now();
          if (left <= 0) throw miss();
          await abortableSleep(Math.min(MATCH_POLL_INTERVAL_MS, left), signal, ctx);
          continue;
        }
        return base.all();
      }
    }

    for (;;) {
      throwIfAborted(signal, ctx);
      finalFailed = false;
      try {
        const all = await base.all();
        if (all.length > 0 && (state === 'attached' || await all[0].isVisible())) return all;
      } catch (err) {
        remember(err);
      }
      const left = deadline - Date.now();
      if (left <= 0) throw miss();
      await abortableSleep(Math.min(MATCH_POLL_INTERVAL_MS, left), signal, ctx);
    }
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
   * @param signal Optional abort signal: checked before every read (a web
   * read, which auto-waits, is raced against it); once aborted, a
   * `LookupAbortedError` is thrown.
   * @returns A promise that resolves to the first matched Element, or null when nothing matches.
   */
  static async filterByAttribute(
    elements: Element[],
    attribute: string,
    value: string,
    exact?: boolean,
    signal?: AbortSignal,
  ): Promise<Element | null> {
    const read = (element: Element): Promise<string | null> => {
      throwIfAborted(signal);
      const pending = element.getAttribute(attribute);
      return isWeb(element) ? raceAbort(pending, signal) : pending;
    };
    // When exact is explicitly set, use only that matching mode
    if (exact !== undefined) {
      for (const element of elements) {
        const attrValue = await read(element);
        if (attrValue === null) continue;
        if (exact ? attrValue === value : attrValue.includes(value)) return element;
      }
      return null;
    }

    // Default: try exact match first, then fall back to contains
    for (const element of elements) {
      const attrValue = await read(element);
      if (attrValue === value) return element;
    }
    for (const element of elements) {
      const attrValue = await read(element);
      if (attrValue !== null && attrValue.includes(value)) return element;
    }
    return null;
  }
}
