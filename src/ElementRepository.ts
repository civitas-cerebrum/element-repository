import * as fs from 'fs';
import * as path from 'path';

import { PageRepository, PageObject } from './schema/repository';
import { pickRandomIndex } from './utils/math';
import { Element, WebElement, PlatformElement } from './types';

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
   * Retrieves a single Element based on the externalized JSON mapping.
   * @param page The page/driver instance.
   * @param pageName The name of the page block in the JSON repository.
   * @param elementName The specific element name to look up.
   * @returns A promise that resolves to an Element.
   */
  public async get(page: any, pageName: string, elementName: string): Promise<Element> {
    if (this.isWebPlatform()) {
      const selector = this.getSelector(pageName, elementName);
      await page.waitForSelector(selector, { timeout: this.defaultTimeout }).catch(() => {});
      return new WebElement(page.locator(selector));
    }
    const selector = this.getSelector(pageName, elementName);
    return new PlatformElement(page, selector);
  }

  /**
   * Retrieves an array of Elements matching the mapped selector.
   * @param page The page/driver instance.
   * @param pageName The name of the page block in the JSON repository.
   * @param elementName The specific element name to look up.
   * @returns A promise that resolves to an array of Elements.
   */
  public async getAll(page: any, pageName: string, elementName: string): Promise<Element[]> {
    if (this.isWebPlatform()) {
      const el = await this.get(page, pageName, elementName);
      return el.all();
    }
    const selector = this.getSelector(pageName, elementName);
    const elements: any[] = await page.$$(selector);
    return elements.map(rawEl => new PlatformElement(page, selector, rawEl));
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
    if (this.isWebPlatform()) {
      const baseEl = await this.get(page, pageName, elementName);
      const count = await baseEl.count();
      if (count === 0) {
        const msg = `No elements found for '${elementName}' on '${pageName}'`;
        if (strict) throw new Error(msg);
        console.warn(msg);
        return null;
      }
      const index = pickRandomIndex(count);
      const randomEl = baseEl.nth(index);
      await randomEl.waitFor({ state: 'attached', timeout: this.defaultTimeout });
      await randomEl.waitFor({ state: 'visible', timeout: this.defaultTimeout });
      return randomEl;
    }
    const selector = this.getSelector(pageName, elementName);
    const elements: any[] = await page.$$(selector);
    if (elements.length === 0) {
      const msg = `No elements found for '${elementName}' on '${pageName}'`;
      if (strict) throw new Error(msg);
      console.warn(msg);
      return null;
    }
    const randomIndex = Math.floor(Math.random() * elements.length);
    return new PlatformElement(page, selector, elements[randomIndex]);
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
    if (this.isWebPlatform()) {
      const baseEl = await this.get(page, pageName, elementName);
      const filtered = baseEl.filter({ hasText: desiredText }).first();
      if ((await filtered.count()) === 0) {
        const msg = `Element '${elementName}' on '${pageName}' with text "${desiredText}" not found.`;
        if (strict) throw new Error(msg);
        console.warn(msg);
        return null;
      }
      return filtered;
    }
    const selector = this.getSelector(pageName, elementName);
    const elements: any[] = await page.$$(selector);
    for (const el of elements) {
      const elText: string = await el.getText();
      if (elText.trim() === desiredText) {
        return new PlatformElement(page, selector, el);
      }
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
    if (this.isWebPlatform()) {
      const baseEl = await this.get(page, pageName, elementName);
      const count = await baseEl.count();
      if (index < 0 || index >= count) {
        const msg = `Index ${index} out of bounds for '${elementName}' on '${pageName}' (found ${count} elements).`;
        if (strict) throw new Error(msg);
        console.warn(msg);
        return null;
      }
      return baseEl.nth(index);
    }
    const selector = this.getSelector(pageName, elementName);
    const elements: any[] = await page.$$(selector);
    if (index < 0 || index >= elements.length) {
      const msg = `Index ${index} out of bounds for '${elementName}' on '${pageName}' (found ${elements.length} elements).`;
      if (strict) throw new Error(msg);
      console.warn(msg);
      return null;
    }
    return new PlatformElement(page, selector, elements[index]);
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
   * predicate, class chain, class name, text
   *
   * @param pageName The name of the page block in the JSON repository.
   * @param elementName The specific element name to look up.
   * @returns A selector string formatted for Playwright (web) or Appium (non-web).
   * @throws Error if the page, element, or selector is not found.
   */
  public getSelector(pageName: string, elementName: string): string {
    const { strategy, value } = this.getSelectorRaw(pageName, elementName);

    if (this.isWebPlatform()) {
      switch (strategy.toLowerCase()) {
        case 'xpath': return `xpath=${value}`;
        case 'text': return `text=${value}`;
        case 'id': return `#${value}`;
        case 'css': return `css=${value}`;
        case 'testid': return `[data-testid='${value}']`;
        case 'role': return `[role='${value}']`;
        case 'placeholder': return `[placeholder='${value}']`;
        case 'label': return `[aria-label='${value}']`;
        default: return value;
      }
    }

    // Non-web (Appium) formatting
    switch (strategy) {
      case 'accessibility id':
        return `~${value}`;
      case 'xpath':
        return value;
      case 'id':
        return `#${value}`;
      case 'css':
        return `css=${value}`;
      case 'uiautomator':
        return `android=${value}`;
      case 'predicate':
        return `-ios predicate string:${value}`;
      case 'class chain':
        return `-ios class chain:${value}`;
      case 'class name':
        return value;
      case 'text':
        if (this.platform === 'android') return `android=new UiSelector().text("${value}")`;
        if (this.platform === 'ios') return `-ios predicate string:label == "${value}"`;
        return value;
      default:
        return value;
    }
  }
}
