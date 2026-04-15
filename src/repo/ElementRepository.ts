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

  /** The Playwright `Page` or WebDriverIO `Browser`/`Driver` instance. */
  public get driver(): any {
    return this._driver;
  }

  /** Updates the default timeout for all subsequent element retrievals. */
  public setDefaultTimeout(timeout: number): void {
    this.defaultTimeout = timeout;
  }

  /**
   * Returns the platform string for the given page, or `'web'` if not specified.
   */
  public getPagePlatform(pageName: string): string {
    const page = this.findPage(pageName);
    if (!page) throw new Error(`ElementRepository: Page '${pageName}' not found.`);
    return page.platform ?? 'web';
  }

  // ══════════════════════════════════════════════════════════════
  // Element Resolution
  // ══════════════════════════════════════════════════════════════

  private async resolveElement(elementName: string, pageName: string, options?: ElementResolutionOptions): Promise<Element> {
    const pageObj = this.findPage(pageName);
    if (!pageObj) throw new Error(`ElementRepository: Page '${pageName}' not found.`);

    // Try enhanced resolution first (role+name, regex text, iframe)
    const enhanced = EnhancedResolver.resolve(
      this._driver, pageObj, elementName, this.getFormattersForPlatform(pageObj.platform ?? 'web'),
    );

    if (enhanced !== null) {
      if (EnhancedResolver.isWebPlatform(pageObj)) {
        return StrategyResolver.fromLocator(enhanced, elementName, pageName, this.defaultTimeout, options);
      } else {
        return StrategyResolver.fromMobileSelector(this._driver, enhanced as string, this.defaultTimeout, options);
      }
    }

    // Standard resolution path
    const selector = this.getSelector(elementName, pageName);
    return StrategyResolver.fromSelector(this._driver, selector, pageObj, elementName, pageName, this.defaultTimeout, options);
  }

  // ══════════════════════════════════════════════════════════════
  // Public Query API
  // ══════════════════════════════════════════════════════════════

  /** Retrieves a single Element based on the externalized JSON mapping. */
  public async get(elementName: string, pageName: string, options?: ElementResolutionOptions): Promise<Element> {
    return this.resolveElement(elementName, pageName, options);
  }

  /** Retrieves an array of Elements matching the mapped selector. */
  public async getAll(elementName: string, pageName: string): Promise<Element[]> {
    const el = await this.resolveElement(elementName, pageName, { strategy: SelectionStrategy.ALL });
    return el.all();
  }

  /** Randomly selects one element from a list of elements matching the given selector. */
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
   * Matching: exact match first, then contains fallback.
   */
  public async getByText(elementName: string, pageName: string, desiredText: string, strict: boolean = false): Promise<Element | null> {
    const allElements = await this.getAll(elementName, pageName);

    for (const element of allElements) {
      const text = await element.textContent();
      if (text?.trim() === desiredText) return element;
    }

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
   * Matching: when `exact` is unset, tries exact then contains. When set, uses only that mode.
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

    if (exact !== undefined) {
      for (const element of allElements) {
        const attrValue = await element.getAttribute(attribute);
        if (attrValue === null) continue;
        if (exact ? attrValue === value : attrValue.includes(value)) return element;
      }
    } else {
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

  /** Returns the nth matching element from a list of elements. */
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

  /** Returns the first visible element matching the selector. */
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

  /** Filters elements by their ARIA role attribute and returns the first match. */
  public async getByRole(elementName: string, pageName: string, role: string, strict: boolean = false): Promise<Element | null> {
    return this.getByAttribute(elementName, pageName, 'role', role, { exact: true, strict });
  }

  // ══════════════════════════════════════════════════════════════
  // Selector Access
  // ══════════════════════════════════════════════════════════════

  /**
   * Returns the raw selector strategy and value without platform-specific formatting.
   * Skips enhanced keys (objects) and returns the first plain string value.
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

    for (const key of Object.keys(selector)) {
      if (typeof selector[key] === 'string') {
        return { strategy: key, value: selector[key] as string };
      }
    }

    const strategy = Object.keys(selector)[0] as string;
    const value = selector[strategy];
    return { strategy, value: typeof value === 'string' ? value : JSON.stringify(value) };
  }

  /**
   * Returns a platform-appropriate selector string based on the page's platform field.
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

  private findPage(pageName: string): PageObject | undefined {
    return this.pageData.pages.find((p) => p.name === pageName);
  }

  private getFormattersForPlatform(platform: string): Record<string, SelectorFormatter> {
    if (platform === 'web') return WEB_FORMATTERS;
    if (platform === 'android') return ANDROID_FORMATTERS;
    if (platform === 'ios') return IOS_FORMATTERS;
    return APPIUM_FORMATTERS;
  }
}
