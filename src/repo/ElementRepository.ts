import * as fs from 'fs';
import * as path from 'path';

import { PageRepository, PageObject } from '../schema/repository';
import { pickRandomIndex } from '../utils/math';
import { Element, WebElement, PlatformElement } from '../types';
import {
  SelectorFormatter,
  WEB_FORMATTERS, APPIUM_FORMATTERS, ANDROID_FORMATTERS, IOS_FORMATTERS,
} from './formatters';

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
  private platform: string;

  /**
   * Initializes the repository with a path to a JSON file.
   * @param filePath Path to the JSON file (relative to the project root).
   * @param defaultTimeout Default wait timeout in milliseconds (defaults to 15000).
   * @param platform The platform to filter pages by (defaults to 'web').
   */
  constructor(filePath: string, defaultTimeout?: number, platform?: string);

  /**
   * Initializes the repository with pre-parsed JSON data.
   * @param data The parsed JSON object matching the PageObjectSchema.
   * @param defaultTimeout Default wait timeout in milliseconds (defaults to 15000).
   * @param platform The platform to filter pages by (defaults to 'web').
   */
  constructor(data: PageRepository, defaultTimeout?: number, platform?: string);

  constructor(dataOrPath: string | PageRepository, defaultTimeout: number = 15000, platform: string = 'web') {
    if (typeof dataOrPath === 'string') {
      const absolutePath = path.resolve(process.cwd(), dataOrPath);
      const rawData = fs.readFileSync(absolutePath, 'utf-8');
      this.pageData = JSON.parse(rawData);
    } else {
      this.pageData = dataOrPath;
    }
    this.defaultTimeout = defaultTimeout;
    this.platform = platform;
  }

  /**
   * Finds a page by name filtered by the current platform.
   * Pages without a `platform` field default to 'web'.
   * @param pageName The name of the page block in the JSON repository.
   * @returns The matching PageObject, or undefined if not found.
   */
  private findPage(pageName: string): PageObject | undefined {
    return this.pageData.pages.find(
      (p) => p.name === pageName && (p.platform ?? 'web') === this.platform
    );
  }

  /** Returns `true` when the repository is configured for the `'web'` platform. */
  private isWebPlatform(): boolean {
    return this.platform === 'web';
  }

  /**
   * Updates the default timeout for all subsequent element retrievals.
   * @param timeout The new timeout in milliseconds.
   */
  public setDefaultTimeout(timeout: number): void {
    this.defaultTimeout = timeout;
  }

  /**
   * Creates the platform-appropriate Element wrapper and waits for it to
   * be attached in the DOM / exist in the view hierarchy.
   *
   * This is the **only** place that branches on {@link isWebPlatform} for
   * element construction, keeping every public API method platform-agnostic.
   *
   * @param page        The page (Playwright) or driver (WebDriverIO) instance.
   * @param pageName    The name of the page block in the JSON repository.
   * @param elementName The specific element name to look up.
   * @returns A promise that resolves to the located Element.
   */
  private async resolveElement(page: any, pageName: string, elementName: string): Promise<Element> {
    const selector = this.getSelector(pageName, elementName);
    const element = this.isWebPlatform()
      ? new WebElement(page.locator(selector))
      : new PlatformElement(page, selector);
    await element.waitFor({ state: 'attached', timeout: this.defaultTimeout }).catch(() => {});
    return element;
  }

  /**
   * Retrieves a single Element based on the externalized JSON mapping.
   * @param page The page/driver instance.
   * @param pageName The name of the page block in the JSON repository.
   * @param elementName The specific element name to look up.
   * @returns A promise that resolves to an Element.
   */
  public async get(page: any, pageName: string, elementName: string): Promise<Element> {
    return this.resolveElement(page, pageName, elementName);
  }

  /**
   * Retrieves an array of Elements matching the mapped selector.
   * @param page The page/driver instance.
   * @param pageName The name of the page block in the JSON repository.
   * @param elementName The specific element name to look up.
   * @returns A promise that resolves to an array of Elements.
   */
  public async getAll(page: any, pageName: string, elementName: string): Promise<Element[]> {
    const el = await this.resolveElement(page, pageName, elementName);
    return el.all();
  }

  /**
   * Randomly selects one element from a list of elements matching the given selector.
   * @param page The page/driver instance.
   * @param pageName The name of the page block in the JSON repository.
   * @param elementName The specific element name to look up.
   * @param strict If true, throws an error if no elements are found. Defaults to false.
   * @returns A promise that resolves to a randomly selected Element, or null if none are found.
   */
  public async getRandom(page: any, pageName: string, elementName: string, strict: boolean = false): Promise<Element | null> {
    const allElements = await this.getAll(page, pageName, elementName);
    if (allElements.length === 0) {
      const msg = `No elements found for '${elementName}' on '${pageName}'`;
      if (strict) throw new Error(msg);
      console.warn(msg);
      return null;
    }
    return allElements[pickRandomIndex(allElements.length)];
  }

  /**
   * Filters an element list and returns the first element that contains the specified text.
   * @param page The page/driver instance.
   * @param pageName The name of the page block in the JSON repository.
   * @param elementName The specific element name to look up.
   * @param desiredText The string of text to search for within the elements.
   * @param strict If true, throws an error if the element is not found. Defaults to false.
   * @returns A promise that resolves to the matched Element, or null if not found.
   */
  public async getByText(page: any, pageName: string, elementName: string, desiredText: string, strict: boolean = false): Promise<Element | null> {
    const allElements = await this.getAll(page, pageName, elementName);
    for (const element of allElements) {
      const text = await element.textContent();
      if (text?.trim() === desiredText) return element;
    }
    const msg = `Element '${elementName}' on '${pageName}' with text "${desiredText}" not found.`;
    if (strict) throw new Error(msg);
    console.warn(msg);
    return null;
  }

  /**
   * Filters elements by a specific HTML attribute value.
   * @param page The page/driver instance.
   * @param pageName The name of the page block in the JSON repository.
   * @param elementName The specific element name to look up.
   * @param attribute The HTML attribute name to filter by.
   * @param value The attribute value to match against.
   * @param options Optional configuration.
   * @param options.exact If true (default), requires an exact attribute match. If false, matches when the attribute contains the value.
   * @param options.strict If true, throws an error when no matching element is found. Defaults to false.
   * @returns A promise that resolves to the matched Element, or null if not found.
   */
  public async getByAttribute(
    page: any,
    pageName: string,
    elementName: string,
    attribute: string,
    value: string,
    options: { exact?: boolean; strict?: boolean } = {}
  ): Promise<Element | null> {
    const { exact = true, strict = false } = options;
    const allElements = await this.getAll(page, pageName, elementName);

    for (const element of allElements) {
      const attrValue = await element.getAttribute(attribute);
      if (attrValue === null) continue;

      const matches = exact ? attrValue === value : attrValue.includes(value);
      if (matches) return element;
    }

    const matchType = exact ? 'equal to' : 'containing';
    const msg = `Element '${elementName}' on '${pageName}' with attribute [${attribute}] ${matchType} "${value}" not found.`;
    if (strict) throw new Error(msg);
    console.warn(msg);
    return null;
  }

  /**
   * Returns the nth matching element from a list of elements.
   * @param page The page/driver instance.
   * @param pageName The name of the page block in the JSON repository.
   * @param elementName The specific element name to look up.
   * @param index The zero-based index of the element to retrieve.
   * @param strict If true, throws an error if the index is out of bounds. Defaults to false.
   * @returns A promise that resolves to the Element at the given index, or null if out of bounds.
   */
  public async getByIndex(
    page: any,
    pageName: string,
    elementName: string,
    index: number,
    strict: boolean = false
  ): Promise<Element | null> {
    const allElements = await this.getAll(page, pageName, elementName);
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
   * @param page The page/driver instance.
   * @param pageName The name of the page block in the JSON repository.
   * @param elementName The specific element name to look up.
   * @param strict If true, throws an error if no visible element is found. Defaults to false.
   * @returns A promise that resolves to a visible Element, or null if none are visible.
   */
  public async getVisible(
    page: any,
    pageName: string,
    elementName: string,
    strict: boolean = false
  ): Promise<Element | null> {
    const allElements = await this.getAll(page, pageName, elementName);

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
   * @param page The page/driver instance.
   * @param pageName The name of the page block in the JSON repository.
   * @param elementName The specific element name to look up.
   * @param role The ARIA role value to filter by (e.g., 'button', 'link', 'tab').
   * @param strict If true, throws an error if no matching element is found. Defaults to false.
   * @returns A promise that resolves to the matched Element, or null if not found.
   */
  public async getByRole(
    page: any,
    pageName: string,
    elementName: string,
    role: string,
    strict: boolean = false
  ): Promise<Element | null> {
    return this.getByAttribute(page, pageName, elementName, 'role', role, { exact: true, strict });
  }

  /**
   * Returns the raw selector strategy and value without Playwright-specific formatting.
   * @param pageName The name of the page block in the JSON repository.
   * @param elementName The specific element name to look up.
   * @returns An object with `strategy` (e.g. 'css', 'xpath', 'id') and `value` (the raw selector value).
   * @throws Error if the page, element, or selector is not found.
   */
  public getSelectorRaw(pageName: string, elementName: string): { strategy: string; value: string } {
    const page = this.findPage(pageName);
    if (!page) throw new Error(`ElementRepository: Page '${pageName}' not found for platform '${this.platform}'.`);

    const element = page.elements.find((e) => e.elementName === elementName);
    if (!element) throw new Error(`ElementRepository: Element '${elementName}' not found on page '${pageName}'.`);

    const selector = element.selector;
    if (!selector || Object.keys(selector).length === 0) {
      throw new Error(`ElementRepository: Invalid selector for '${elementName}'.`);
    }

    const strategy = Object.keys(selector)[0] as string;
    const value = selector[strategy] as string;

    return { strategy, value };
  }

  /**
   * Returns a platform-appropriate selector string based on the repository's configured platform.
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
   * @param pageName The name of the page block in the JSON repository.
   * @param elementName The specific element name to look up.
   * @returns A selector string formatted for Playwright (web) or Appium (non-web).
   * @throws Error if the page, element, or selector is not found.
   */
  public getSelector(pageName: string, elementName: string): string {
    const { strategy, value } = this.getSelectorRaw(pageName, elementName);
    const formatters = this.getFormatters();
    const formatter = formatters[strategy.toLowerCase()];
    return formatter ? formatter(value) : value;
  }

  /**
   * Returns the {@link SelectorFormatter} lookup table for the current platform.
   * Falls back to the base {@link APPIUM_FORMATTERS} for unrecognised non-web platforms.
   */
  private getFormatters(): Record<string, SelectorFormatter> {
    if (this.isWebPlatform()) return WEB_FORMATTERS;
    if (this.platform === 'android') return ANDROID_FORMATTERS;
    if (this.platform === 'ios') return IOS_FORMATTERS;
    return APPIUM_FORMATTERS;
  }
}
