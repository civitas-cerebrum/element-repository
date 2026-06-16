import { PageObject } from '../schema/repository';
import { Element, WebElement, PlatformElement } from '../types';
import { ElementResolutionOptions, SelectionStrategy } from '../enum/Options';
import { pickRandomIndex } from '../utils/math';
import { EnhancedResolver } from './EnhancedResolver';

/**
 * Creates platform-appropriate Element wrappers and applies selection
 * strategies (FIRST, INDEX, RANDOM, TEXT, ALL).
 *
 * This module handles the mechanical work of constructing {@link WebElement}
 * or {@link PlatformElement} instances from a locator/selector and applying
 * the requested strategy on top. All methods are stateless and static.
 */
const ATTACH_PROBE_TIMEOUT_MS = 2_000;

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
          if (!options.value) {
            throw new Error('options.value is required when using SelectionStrategy.TEXT');
          }
          const filtered = locator.filter({ hasText: options.value });
          const element = new WebElement(filtered.first(), desc, timeout);
          await element.waitFor({ state: 'attached', timeout: Math.min(timeout, ATTACH_PROBE_TIMEOUT_MS) }).catch(() => {});
          return element;
        }
        default:
          break;
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

    if (options?.strategy) {
      switch (options.strategy) {
        case SelectionStrategy.INDEX: {
          if (options.index === undefined || options.index === null) {
            throw new Error('options.index is required when using SelectionStrategy.INDEX');
          }
          const base = isWeb
            ? new WebElement(driver.locator(selector), selector, timeout)
            : new PlatformElement(driver, selector, undefined, timeout);
          const all = await base.all();
          if (options.index < 0 || options.index >= all.length) {
            throw new Error(`Index ${options.index} out of bounds for '${elementName}' on '${pageName}' (found ${all.length} elements).`);
          }
          return all[options.index];
        }
        case SelectionStrategy.RANDOM: {
          const base = isWeb
            ? new WebElement(driver.locator(selector), selector, timeout)
            : new PlatformElement(driver, selector, undefined, timeout);
          
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
          if (!options.value) {
            throw new Error('options.value is required when using SelectionStrategy.TEXT');
          }
          const baseLocator = driver.locator(selector);
          const filtered = baseLocator.filter({ hasText: options.value });
          const element = isWeb
            ? new WebElement(filtered.first(), selector, timeout)
            : new PlatformElement(driver, selector, undefined, timeout);
          await element.waitFor({ state: 'attached', timeout: Math.min(timeout, ATTACH_PROBE_TIMEOUT_MS) }).catch(() => {});
          return element;
        }
        case SelectionStrategy.ALL: {
          const element = isWeb
            ? new WebElement(driver.locator(selector), selector, timeout)
            : new PlatformElement(driver, selector, undefined, timeout);
          await element.waitFor({ state: 'attached', timeout: Math.min(timeout, ATTACH_PROBE_TIMEOUT_MS) }).catch(() => {});
          return element;
        }
        default:
          break;
      }
    }

    const base = isWeb
      ? new WebElement(driver.locator(selector), selector, timeout)
      : new PlatformElement(driver, selector, undefined, timeout);
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
   * @returns A promise that resolves to the located Element.
   */
  static async fromMobileSelector(
    driver: any,
    selector: string,
    timeout: number,
    options?: ElementResolutionOptions,
  ): Promise<Element> {
    const base = new PlatformElement(driver, selector, undefined, timeout);

    if (options?.strategy === SelectionStrategy.ALL) {
      await base.waitFor({ state: 'attached', timeout }).catch(() => {});
      return base;
    }

    const element = base.first();
    await element.waitFor({ state: 'attached', timeout }).catch(() => {});
    return element;
  }
}
