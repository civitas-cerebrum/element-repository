import * as fs from 'fs';
import * as path from 'path';

import { PageRepository, PageObject } from '../schema/repository';
import { pickRandomIndex } from '../utils/math';
import { Element } from '../types';
import {
  SelectorFormatter,
  WEB_FORMATTERS, APPIUM_FORMATTERS, ANDROID_FORMATTERS, IOS_FORMATTERS,
} from './formatters';
import { ElementResolutionOptions, SelectionStrategy } from '../enum/Options';
import { EnhancedResolver } from './EnhancedResolver';
import { StrategyResolver } from './StrategyResolver';

/**
 * Platform-agnostic element lookup engine backed by a JSON repository.
 *
 * Maps human-readable page/element names to platform-specific selectors and
 * returns unified {@link Element} wrappers (either {@link WebElement} for
 * Playwright or {@link PlatformElement} for WebDriverIO/Appium). Every
 * element is automatically waited for before it is returned.
 */
export class ElementRepository {
  private pageData: PageRepository;
  private defaultTimeout: number;

  /**
   * The Playwright `Page` or WebDriverIO `Browser`/`Driver` instance used for
   * element interactions.
   */
  private _driver: any;

  /**
   * Initializes the repository with a driver and a path to a JSON file.
   * @param driver The Playwright `Page` or WebDriverIO `Browser`/`Driver` instance.
   * @param filePath Path to the JSON file (relative to the project root).
   * @param defaultTimeout Default wait timeout in milliseconds (defaults to 15000).
   */
  constructor(driver: any, filePath: string, defaultTimeout?: number);

  /**
   * Initializes the repository with a driver and pre-parsed JSON data.
   * @param driver The Playwright `Page` or WebDriverIO `Browser`/`Driver` instance.
   * @param data The parsed JSON object matching the PageObjectSchema.
   * @param defaultTimeout Default wait timeout in milliseconds (defaults to 15000).
   */
  constructor(driver: any, data: PageRepository, defaultTimeout?: number);

  constructor(driver: any, dataOrPath: string | PageRepository, defaultTimeout: number = 15000) {
    this._driver = driver;
    if (typeof dataOrPath === 'string') {
      const absolutePath = path.resolve(process.cwd(), dataOrPath);
      const rawData = fs.readFileSync(absolutePath, 'utf-8');
      this.pageData = JSON.parse(rawData);
    } else {
      this.pageData = dataOrPath;
    }
    this.defaultTimeout = defaultTimeout;
  }

  /**
   * The Playwright `Page` or WebDriverIO `Browser`/`Driver` instance provided
   * at construction time.
   */
  public get driver(): any {
    return this._driver;
  }

  /**
   * Updates the default timeout for all subsequent element retrievals.
   * @param timeout The new timeout in milliseconds.
   */
  public setDefaultTimeout(timeout: number): void {
    this.defaultTimeout = timeout;
  }

  /**
   * Returns the platform string for the given page, or `'web'` if not specified.
   * @param pageName The name of the page block in the JSON repository.
   * @returns The platform string (e.g. `'web'`, `'android'`, `'ios'`).
   * @throws Error if the page is not found.
   */
  public getPagePlatform(pageName: string): string {
    const page = this.findPage(pageName);
    if (!page) throw new Error(`ElementRepository: Page '${pageName}' not found.`);
    return page.platform ?? 'web';
  }

  // ══════════════════════════════════════════════════════════════
  // Element Resolution
  // ══════════════════════════════════════════════════════════════

  /**
   * Creates the platform-appropriate Element wrapper and waits for it to
   * be attached in the DOM / exist in the view hierarchy.
   *
   * Resolution order:
   * 1. Enhanced selectors (role+name, regex text, iframe) via {@link EnhancedResolver}
   * 2. Standard selectors (css, xpath, id, text, etc.) via {@link StrategyResolver}
   *
   * @param elementName The specific element name to look up.
   * @param pageName The name of the page block in the JSON repository.
   * @param options Optional element resolution options (strategy, index, value, etc.).
   * @returns A promise that resolves to the located Element.
   * @throws Error if the page is not found.
   */
  private async resolveElement(elementName: string, pageName: string, options?: ElementResolutionOptions): Promise<Element> {
    const pageObj = this.findPage(pageName);
    if (!pageObj) throw new Error(`ElementRepository: Page '${pageName}' not found.`);

    const elementDef = pageObj.elements.find((e) => e.elementName === elementName);
    if (!elementDef) throw new Error(`ElementRepository: Element '${elementName}' not found on page '${pageName}'.`);

    // Walk the fallback chain: resolve from the primary selector entry; if it
    // matches zero elements within the probe timeout, walk into
    // `selector.fallback` recursively. The primary is always attempted even
    // without a fallback — backwards-compatible with pre-0.1.6 behaviour.
    return this.resolveWithFallback(pageObj, elementName, elementDef.selector, pageName, options);
  }

  /**
   * Resolves `selector` for `elementName`; walks `selector.fallback`
   * recursively when the primary does not attach within the probe timeout.
   * Returns the resolved `Element` (matched or terminal fallback).
   *
   * **Probe timeout = `this.defaultTimeout`** (the repository's configured
   * element timeout — 15s by default, user-overridable via the
   * `ElementRepository` constructor). This matches the single-selector
   * resolution budget: an element that would have appeared within the
   * standard element timeout still has the full budget to do so before
   * fallback kicks in. On slow-loading pages (SPA hydration, XHR-gated
   * content), the primary is never walked past prematurely.
   *
   * **No-fallback path is unchanged** — elements without a `fallback` key
   * skip the probe entirely and return the lazy locator, preserving
   * pre-0.1.6 behaviour where the full element timeout is applied at
   * action time (`element.click()`, `element.fill()`, etc.).
   *
   * Trade-off: an N-step fallback chain where no node matches can take up
   * to `N × defaultTimeout` before returning the terminal element. In
   * practice fallbacks are defined to cover real DOM variants, so the
   * first or second level matches on pages where the primary doesn't.
   */
  private async resolveWithFallback(
    pageObj: PageObject,
    elementName: string,
    selector: { [key: string]: unknown },
    pageName: string,
    options: ElementResolutionOptions | undefined,
  ): Promise<Element> {
    const element = await this.resolveFromSingleSelector(pageObj, elementName, selector, pageName, options);

    const fallback = (selector as { fallback?: Record<string, unknown> }).fallback;
    if (!fallback) {
      // No fallback — return the lazy locator. The full element timeout
      // applies at action time via `element.waitFor(...)`, preserving the
      // pre-fallback-chain behaviour exactly.
      return element;
    }

    // Wait for the primary to attach, using the repo's configured element
    // timeout as the probe budget. `waitFor` resolves the moment the
    // element appears — the timeout only caps the wait, it does not delay
    // the common (primary-attaches-quickly) case. Throws on timeout or
    // detachment, which triggers the fallback walk.
    try {
      await element.waitFor({ state: 'attached', timeout: this.defaultTimeout });
      return element;
    } catch {
      return this.resolveWithFallback(pageObj, elementName, fallback, pageName, options);
    }
  }

  /**
   * Resolves a single `selector` entry (one node of the fallback chain) into
   * an `Element` using the existing enhanced / standard resolution paths. Does
   * not look at `selector.fallback` — that walk is owned by `resolveWithFallback`.
   */
  private async resolveFromSingleSelector(
    pageObj: PageObject,
    elementName: string,
    selector: { [key: string]: unknown },
    pageName: string,
    options: ElementResolutionOptions | undefined,
  ): Promise<Element> {
    // Try enhanced resolution first (role+name, regex text, iframe), feeding
    // it a synthetic element definition that exposes only the current node of
    // the fallback chain so the resolver doesn't accidentally see a nested
    // fallback key.
    const syntheticPage: PageObject = {
      ...pageObj,
      elements: [{ elementName, selector: this.stripFallback(selector) as PageObject['elements'][number]['selector'] }],
    };

    const enhanced = EnhancedResolver.resolve(
      this._driver, syntheticPage, elementName, this.getFormattersForPlatform(pageObj.platform ?? 'web'),
    );

    if (enhanced !== null) {
      if (EnhancedResolver.isWebPlatform(pageObj)) {
        return StrategyResolver.fromLocator(enhanced, elementName, pageName, this.defaultTimeout, options);
      } else {
        return StrategyResolver.fromMobileSelector(this._driver, enhanced as string, this.defaultTimeout, options);
      }
    }

    // Standard resolution path — format via platform selector formatter.
    const formatted = this.formatSingleSelector(pageObj, selector);
    return StrategyResolver.fromSelector(this._driver, formatted, pageObj, elementName, pageName, this.defaultTimeout, options);
  }

  /** Returns a copy of `selector` with the `fallback` key stripped. */
  private stripFallback(selector: { [key: string]: unknown }): { [key: string]: unknown } {
    const copy: { [key: string]: unknown } = {};
    for (const key of Object.keys(selector)) {
      if (key !== 'fallback') copy[key] = selector[key];
    }
    return copy;
  }

  /**
   * Platform-formats the first string-valued strategy of a single selector
   * node. Mirrors `getSelector` but operates on an arbitrary selector object
   * instead of a repo lookup — used by the fallback walker.
   */
  private formatSingleSelector(pageObj: PageObject, selector: { [key: string]: unknown }): string {
    const stripped = this.stripFallback(selector);
    for (const key of Object.keys(stripped)) {
      if (typeof stripped[key] === 'string') {
        const formatters = this.getFormattersForPlatform(pageObj.platform ?? 'web');
        const formatter = formatters[key.toLowerCase()];
        return formatter ? formatter(stripped[key] as string) : (stripped[key] as string);
      }
    }
    // No plain-string strategy — fall back to the first key (enhanced
    // selectors would have been picked up earlier).
    const firstKey = Object.keys(stripped)[0];
    const value = stripped[firstKey];
    return typeof value === 'string' ? value : JSON.stringify(value);
  }

  // ══════════════════════════════════════════════════════════════
  // Public Query API
  // ══════════════════════════════════════════════════════════════

  /**
   * Retrieves a single Element based on the externalized JSON mapping.
   * @param elementName The specific element name to look up.
   * @param pageName The name of the page block in the JSON repository.
   * @param options Optional element resolution options.
   * @returns A promise that resolves to an Element.
   */
  public async get(elementName: string, pageName: string, options?: ElementResolutionOptions): Promise<Element> {
    return this.resolveElement(elementName, pageName, options);
  }

  /**
   * Retrieves an array of Elements matching the mapped selector.
   * @param elementName The specific element name to look up.
   * @param pageName The name of the page block in the JSON repository.
   * @returns A promise that resolves to an array of Elements.
   */
  public async getAll(elementName: string, pageName: string): Promise<Element[]> {
    const el = await this.resolveElement(elementName, pageName, { strategy: SelectionStrategy.ALL });
    return el.all();
  }

  /**
   * Randomly selects one element from a list of elements matching the given selector.
   * @param elementName The specific element name to look up.
   * @param pageName The name of the page block in the JSON repository.
   * @param strict If true, throws an error if no elements are found. Defaults to false.
   * @returns A promise that resolves to a randomly selected Element, or null if none are found.
   */
  public async getRandom(elementName: string, pageName: string, strict: boolean = false): Promise<Element | null> {
    const allElements = await this.getAll(elementName, pageName);
    if (allElements.length === 0) {
      const msg = `No elements found for '${elementName}' on '${pageName}'`;
      if (strict) throw new Error(msg);
      console.warn(msg);
      return null;
    }
    return allElements[pickRandomIndex(allElements.length)];
  }

  /**
   * Filters an element list and returns the first element matching the specified text.
   *
   * Matching strategy: first attempts an exact match (trimmed), then falls back
   * to a contains match if no exact match is found.
   *
   * @param elementName The specific element name to look up.
   * @param pageName The name of the page block in the JSON repository.
   * @param desiredText The string of text to search for within the elements.
   * @param strict If true, throws an error if the element is not found. Defaults to false.
   * @returns A promise that resolves to the matched Element, or null if not found.
   */
  public async getByText(elementName: string, pageName: string, desiredText: string, strict: boolean = false): Promise<Element | null> {
    const allElements = await this.getAll(elementName, pageName);

    // First pass: exact match
    for (const element of allElements) {
      const text = await element.textContent();
      if (text?.trim() === desiredText) return element;
    }

    // Second pass: contains match
    for (const element of allElements) {
      const text = await element.textContent();
      if (text?.trim().includes(desiredText)) return element;
    }

    const msg = `Element '${elementName}' on '${pageName}' with text "${desiredText}" not found.`;
    if (strict) throw new Error(msg);
    console.warn(msg);
    return null;
  }

  /**
   * Filters elements by a specific HTML attribute value.
   *
   * Matching strategy: when `exact` is not specified, first attempts an exact
   * match, then falls back to a contains match. When `exact` is explicitly set,
   * only that matching mode is used.
   *
   * @param elementName The specific element name to look up.
   * @param pageName The name of the page block in the JSON repository.
   * @param attribute The HTML attribute name to filter by.
   * @param value The attribute value to match against.
   * @param options Optional configuration.
   * @param options.exact If true, requires an exact attribute match. If false, matches when the attribute contains the value. If omitted, tries exact first then falls back to contains.
   * @param options.strict If true, throws an error when no matching element is found. Defaults to false.
   * @returns A promise that resolves to the matched Element, or null if not found.
   */
  public async getByAttribute(
    elementName: string,
    pageName: string,
    attribute: string,
    value: string,
    options: { exact?: boolean; strict?: boolean } = {}
  ): Promise<Element | null> {
    const { exact, strict = false } = options;
    const allElements = await this.getAll(elementName, pageName);

    // When exact is explicitly set, use only that matching mode
    if (exact !== undefined) {
      for (const element of allElements) {
        const attrValue = await element.getAttribute(attribute);
        if (attrValue === null) continue;
        if (exact ? attrValue === value : attrValue.includes(value)) return element;
      }
    } else {
      // Default: try exact match first, then fall back to contains
      for (const element of allElements) {
        const attrValue = await element.getAttribute(attribute);
        if (attrValue === value) return element;
      }
      for (const element of allElements) {
        const attrValue = await element.getAttribute(attribute);
        if (attrValue !== null && attrValue.includes(value)) return element;
      }
    }

    const matchType = exact === true ? 'equal to' : exact === false ? 'containing' : 'matching';
    const msg = `Element '${elementName}' on '${pageName}' with attribute [${attribute}] ${matchType} "${value}" not found.`;
    if (strict) throw new Error(msg);
    console.warn(msg);
    return null;
  }

  /**
   * Returns the nth matching element from a list of elements.
   * @param elementName The specific element name to look up.
   * @param pageName The name of the page block in the JSON repository.
   * @param index The zero-based index of the element to retrieve.
   * @param strict If true, throws an error if the index is out of bounds. Defaults to false.
   * @returns A promise that resolves to the Element at the given index, or null if out of bounds.
   */
  public async getByIndex(elementName: string, pageName: string, index: number, strict: boolean = false): Promise<Element | null> {
    const allElements = await this.getAll(elementName, pageName);
    if (index < 0 || index >= allElements.length) {
      const msg = `Index ${index} out of bounds for '${elementName}' on '${pageName}' (found ${allElements.length} elements).`;
      if (strict) throw new Error(msg);
      console.warn(msg);
      return null;
    }
    return allElements[index];
  }

  /**
   * Returns the first visible element matching the selector.
   * @param elementName The specific element name to look up.
   * @param pageName The name of the page block in the JSON repository.
   * @param strict If true, throws an error if no visible element is found. Defaults to false.
   * @returns A promise that resolves to a visible Element, or null if none are visible.
   */
  public async getVisible(elementName: string, pageName: string, strict: boolean = false): Promise<Element | null> {
    const allElements = await this.getAll(elementName, pageName);
    for (const element of allElements) {
      if (await element.isVisible()) return element;
    }
    const msg = `No visible elements found for '${elementName}' on '${pageName}'.`;
    if (strict) throw new Error(msg);
    console.warn(msg);
    return null;
  }

  /**
   * Filters elements by their ARIA role attribute and returns the first match.
   * @param elementName The specific element name to look up.
   * @param pageName The name of the page block in the JSON repository.
   * @param role The ARIA role value to filter by (e.g., 'button', 'link', 'tab').
   * @param strict If true, throws an error if no matching element is found. Defaults to false.
   * @returns A promise that resolves to the matched Element, or null if not found.
   */
  public async getByRole(elementName: string, pageName: string, role: string, strict: boolean = false): Promise<Element | null> {
    return this.getByAttribute(elementName, pageName, 'role', role, { exact: true, strict });
  }

  // ══════════════════════════════════════════════════════════════
  // Selector Access
  // ══════════════════════════════════════════════════════════════

  /**
   * Returns the raw selector strategy and value without Playwright-specific formatting.
   * Skips enhanced keys (object values like regex patterns) and returns the first
   * key with a plain string value.
   * @param elementName The specific element name to look up.
   * @param pageName The name of the page block in the JSON repository.
   * @returns An object with `strategy` (e.g. 'css', 'xpath', 'id') and `value` (the raw selector value).
   * @throws Error if the page, element, or selector is not found.
   */
  public getSelectorRaw(elementName: string, pageName: string): { strategy: string; value: string } {
    const page = this.findPage(pageName);
    if (!page) throw new Error(`ElementRepository: Page '${pageName}' not found.`);

    const element = page.elements.find((e) => e.elementName === elementName);
    if (!element) throw new Error(`ElementRepository: Element '${elementName}' not found on page '${pageName}'.`);

    const selector = element.selector;
    if (!selector || Object.keys(selector).length === 0) {
      throw new Error(`ElementRepository: Invalid selector for '${elementName}'.`);
    }

    // Find the first key with a plain string value (skip enhanced keys like 'name' with objects)
    for (const key of Object.keys(selector)) {
      if (typeof selector[key] === 'string') {
        return { strategy: key, value: selector[key] as string };
      }
    }

    // Fallback: return first key (may be an object for enhanced selectors resolved elsewhere)
    const strategy = Object.keys(selector)[0] as string;
    const value = selector[strategy];
    return { strategy, value: typeof value === 'string' ? value : JSON.stringify(value) };
  }

  /**
   * Returns a platform-appropriate selector string based on the page's platform field.
   *
   * **Web (Playwright) selector keys:** css, xpath, id, text, testid, role, placeholder, label
   *
   * **Non-web (Appium) selector keys:** accessibility id, xpath, id, css, uiautomator,
   * predicate, class chain, class name, tag name, name, android data matcher,
   * android view matcher, android view tag, text
   *
   * All space-separated keys also accept camelCase aliases (e.g., `accessibilityId`,
   * `androidUIAutomator`, `iOSNsPredicateString`, `iOSClassChain`, `className`,
   * `tagName`, `androidDataMatcher`, `androidViewMatcher`, `androidViewTag`).
   *
   * @param elementName The specific element name to look up.
   * @param pageName The name of the page block in the JSON repository.
   * @returns A selector string formatted for Playwright (web) or Appium (non-web).
   * @throws Error if the page, element, or selector is not found.
   */
  public getSelector(elementName: string, pageName: string): string {
    const { strategy, value } = this.getSelectorRaw(elementName, pageName);
    const page = this.findPage(pageName)!;
    const formatters = this.getFormattersForPlatform(page.platform ?? 'web');
    const formatter = formatters[strategy.toLowerCase()];
    return formatter ? formatter(value) : value;
  }

  // ══════════════════════════════════════════════════════════════
  // Internal Helpers
  // ══════════════════════════════════════════════════════════════

  /**
   * Finds a page by name.
   * @param pageName The name of the page block in the JSON repository.
   * @returns The matching PageObject, or undefined if not found.
   */
  private findPage(pageName: string): PageObject | undefined {
    return this.pageData.pages.find((p) => p.name === pageName);
  }

  /**
   * Returns the {@link SelectorFormatter} lookup table for the given platform.
   * Falls back to the base {@link APPIUM_FORMATTERS} for unrecognised non-web platforms.
   * @param platform The platform string (e.g. `'web'`, `'android'`, `'ios'`).
   * @returns The formatter record for the specified platform.
   */
  private getFormattersForPlatform(platform: string): Record<string, SelectorFormatter> {
    if (platform === 'web') return WEB_FORMATTERS;
    if (platform === 'android') return ANDROID_FORMATTERS;
    if (platform === 'ios') return IOS_FORMATTERS;
    return APPIUM_FORMATTERS;
  }
}
