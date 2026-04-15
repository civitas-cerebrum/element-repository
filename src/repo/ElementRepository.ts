import * as fs from 'fs';
import * as path from 'path';

import { PageRepository, PageObject, RegexPattern, SelectorValue } from '../schema/repository';
import { pickRandomIndex } from '../utils/math';
import { Element, WebElement, PlatformElement } from '../types';
import {
  SelectorFormatter,
  WEB_FORMATTERS, APPIUM_FORMATTERS, ANDROID_FORMATTERS, IOS_FORMATTERS,
} from './formatters';
import { ElementResolutionOptions, SelectionStrategy } from '../enum/Options';

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
   * Finds a page by name.
   * @param pageName The name of the page block in the JSON repository.
   * @returns The matching PageObject, or undefined if not found.
   */
  private findPage(pageName: string): PageObject | undefined {
    return this.pageData.pages.find((p) => p.name === pageName);
  }

  /** Returns `true` when the given page is configured for the `'web'` platform. */
  private static isWebPlatform(page: PageObject): boolean {
    return (page.platform ?? 'web') === 'web';
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
   * @param elementName The specific element name to look up.
   * @param pageName    The name of the page block in the JSON repository.
   * @param options     Optional element resolution options.
   * @returns A promise that resolves to the located Element.
   */
  /** Returns `true` when the given selector value is a regex pattern object. */
  private static isRegex(value: SelectorValue): value is RegexPattern {
    return typeof value === 'object' && value !== null && 'regex' in value;
  }

  /**
   * Returns a Playwright locator for enhanced selector types (role+name, regex text,
   * iframe-scoped). Returns `null` when the selector uses only standard types.
   */
  /**
   * Maps ARIA roles to Android class names for UiSelector queries.
   */
  private static readonly ROLE_TO_ANDROID_CLASS: Record<string, string> = {
    button: 'android.widget.Button',
    textbox: 'android.widget.EditText',
    switch: 'android.widget.Switch',
    checkbox: 'android.widget.CheckBox',
    radio: 'android.widget.RadioButton',
    link: 'android.widget.TextView',
    dialog: 'android.app.Dialog',
    combobox: 'android.widget.Spinner',
    slider: 'android.widget.SeekBar',
    tab: 'android.widget.TabWidget',
    img: 'android.widget.ImageView',
  };

  /**
   * Maps ARIA roles to iOS element types for predicate string queries.
   */
  private static readonly ROLE_TO_IOS_TYPE: Record<string, string> = {
    button: 'XCUIElementTypeButton',
    textbox: 'XCUIElementTypeTextField',
    switch: 'XCUIElementTypeSwitch',
    checkbox: 'XCUIElementTypeButton',
    radio: 'XCUIElementTypeButton',
    link: 'XCUIElementTypeLink',
    dialog: 'XCUIElementTypeAlert',
    combobox: 'XCUIElementTypePicker',
    slider: 'XCUIElementTypeSlider',
    tab: 'XCUIElementTypeTab',
    img: 'XCUIElementTypeImage',
  };

  private resolveEnhancedLocator(elementName: string, pageName: string): any | null {
    const pageObj = this.findPage(pageName);
    if (!pageObj) return null;

    const elementDef = pageObj.elements.find(e => e.elementName === elementName);
    if (!elementDef) return null;

    const selector = elementDef.selector;
    const hasFrame = pageObj.frame !== undefined;
    const hasRoleWithName = selector.role !== undefined && selector.name !== undefined;
    const hasRegexText = selector.text !== undefined && ElementRepository.isRegex(selector.text);

    // Only use enhanced resolution when needed
    if (!hasFrame && !hasRoleWithName && !hasRegexText) return null;

    const platform = pageObj.platform ?? 'web';

    // ── Web (Playwright) ──────────────────────────────────────────
    if (ElementRepository.isWebPlatform(pageObj)) {
      let scope: any = this._driver;
      if (hasFrame) {
        scope = this.resolveFrameScope(pageObj);
      }

      if (hasRoleWithName) {
        const role = selector.role as string;
        const nameValue = selector.name;
        const roleOptions: Record<string, any> = {};
        if (typeof nameValue === 'string') {
          roleOptions.name = nameValue;
        } else if (ElementRepository.isRegex(nameValue)) {
          roleOptions.name = new RegExp(nameValue.regex, nameValue.flags);
        }
        if (selector.exact !== undefined) {
          roleOptions.exact = String(selector.exact) === 'true';
        }
        return scope.getByRole(role, roleOptions);
      }

      if (hasRegexText) {
        const textSpec = selector.text as RegexPattern;
        return scope.locator(`text=/${textSpec.regex}/${textSpec.flags ?? ''}`);
      }

      if (hasFrame) {
        const strategy = Object.keys(selector)[0];
        const value = selector[strategy] as string;
        const formatters = this.getFormattersForPlatform('web');
        const formatter = formatters[strategy.toLowerCase()];
        const formatted = formatter ? formatter(value) : value;
        return scope.locator(formatted);
      }

      return null;
    }

    // ── Non-web (Appium: Android / iOS) ───────────────────────────
    // Frames don't exist in native apps — skip frame logic
    if (hasRoleWithName) {
      return this.resolveRoleForMobile(platform, selector);
    }

    if (hasRegexText) {
      return this.resolveRegexTextForMobile(platform, selector);
    }

    return null;
  }

  /**
   * Resolves a role + name selector for Android or iOS using platform-native locator strategies.
   * Returns a selector string that the PlatformElement can use.
   */
  private resolveRoleForMobile(platform: string, selector: Record<string, SelectorValue>): string | null {
    const role = selector.role as string;
    const nameValue = selector.name;
    const nameStr = typeof nameValue === 'string' ? nameValue : null;
    const nameRegex = ElementRepository.isRegex(nameValue) ? nameValue : null;

    if (platform === 'android') {
      const className = ElementRepository.ROLE_TO_ANDROID_CLASS[role];
      if (!className) return null;

      let uiSelector = `new UiSelector().className("${className}")`;
      if (nameStr) {
        uiSelector += `.text("${nameStr}")`;
      } else if (nameRegex) {
        uiSelector += `.textMatches("${nameRegex.regex}")`;
      }
      return `android=${uiSelector}`;
    }

    if (platform === 'ios') {
      const iosType = ElementRepository.ROLE_TO_IOS_TYPE[role];
      if (!iosType) return null;

      let predicate = `type == '${iosType}'`;
      if (nameStr) {
        predicate += ` AND label == '${nameStr}'`;
      } else if (nameRegex) {
        predicate += ` AND label MATCHES '${nameRegex.regex}'`;
      }
      return `-ios predicate string:${predicate}`;
    }

    return null;
  }

  /**
   * Resolves a regex text selector for Android or iOS.
   * Returns a selector string that the PlatformElement can use.
   */
  private resolveRegexTextForMobile(platform: string, selector: Record<string, SelectorValue>): string | null {
    const textSpec = selector.text as RegexPattern;

    if (platform === 'android') {
      return `android=new UiSelector().textMatches("${textSpec.regex}")`;
    }

    if (platform === 'ios') {
      return `-ios predicate string:label MATCHES '${textSpec.regex}'`;
    }

    return null;
  }

  /**
   * Resolves the FrameLocator scope for a frame-scoped page.
   * Supports single frames, frame disambiguation, and nested frames.
   */
  private resolveFrameScope(pageObj: PageObject): any {
    const frameSpec = pageObj.frame!;

    if (Array.isArray(frameSpec)) {
      // Nested frames: chain frameLocator calls
      let scope: any = this._driver;
      for (const frame of frameSpec) {
        const sel = frame.css ?? (frame.xpath ? `xpath=${frame.xpath}` : '');
        scope = scope.frameLocator(sel);
      }
      return scope;
    }

    // Single frame
    const sel = frameSpec.css ?? (frameSpec.xpath ? `xpath=${frameSpec.xpath}` : '');
    let frameLocator = this._driver.frameLocator(sel);

    // Frame disambiguation
    if (pageObj.frameIndex !== undefined) {
      const idx = pageObj.frameIndex;
      if (idx === 'first') frameLocator = frameLocator.first();
      else if (idx === 'last') frameLocator = frameLocator.last();
      else if (typeof idx === 'number') frameLocator = frameLocator.nth(idx);
    }

    return frameLocator;
  }

  private async resolveElement(elementName: string, pageName: string, options?: ElementResolutionOptions): Promise<Element> {
    const pageObj = this.findPage(pageName);

    // Try enhanced resolution first (role+name, regex text, iframe)
    const enhanced = this.resolveEnhancedLocator(elementName, pageName);
    if (enhanced !== null) {
      // For web: enhanced is a Playwright Locator object
      // For mobile: enhanced is a selector string
      if (ElementRepository.isWebPlatform(pageObj!)) {
        const selectorDesc = `enhanced:${elementName}@${pageName}`;

        if (options?.strategy) {
          switch (options.strategy) {
            case SelectionStrategy.INDEX: {
              if (options.index === undefined || options.index === null) {
                throw new Error('options.index is required when using SelectionStrategy.INDEX');
              }
              const baseElement = new WebElement(enhanced, selectorDesc, this.defaultTimeout);
              const allElements = await baseElement.all();
              if (options.index < 0 || options.index >= allElements.length) {
                throw new Error(`Index ${options.index} out of bounds for '${elementName}' on '${pageName}' (found ${allElements.length} elements).`);
              }
              return allElements[options.index];
            }
            case SelectionStrategy.RANDOM: {
              const baseElement = new WebElement(enhanced, selectorDesc, this.defaultTimeout);
              const allElements = await baseElement.all();
              if (allElements.length === 0) {
                throw new Error(`No elements found for '${elementName}' on '${pageName}'`);
              }
              return allElements[pickRandomIndex(allElements.length)];
            }
            case SelectionStrategy.ALL: {
              const element = new WebElement(enhanced, selectorDesc, this.defaultTimeout);
              await element.waitFor({ state: 'attached', timeout: this.defaultTimeout }).catch(() => {});
              return element;
            }
            case SelectionStrategy.TEXT: {
              if (!options.value) {
                throw new Error('options.value is required when using SelectionStrategy.TEXT');
              }
              const filtered = enhanced.filter({ hasText: options.value });
              const element = new WebElement(filtered.first(), selectorDesc, this.defaultTimeout);
              await element.waitFor({ state: 'attached', timeout: this.defaultTimeout }).catch(() => {});
              return element;
            }
            default:
              break;
          }
        }

        const element = new WebElement(enhanced.first(), selectorDesc, this.defaultTimeout);
        await element.waitFor({ state: 'attached', timeout: this.defaultTimeout }).catch(() => {});
        return element;
      } else {
        // Mobile: enhanced is a selector string — use it as the selector
        // and fall through to the standard resolution path below
        const mobileSelector = enhanced as string;
        const baseElement = new PlatformElement(this._driver, mobileSelector, undefined, this.defaultTimeout);

        if (options?.strategy === SelectionStrategy.ALL) {
          await baseElement.waitFor({ state: 'attached', timeout: this.defaultTimeout }).catch(() => {});
          return baseElement;
        }

        const element = baseElement.first();
        await element.waitFor({ state: 'attached', timeout: this.defaultTimeout }).catch(() => {});
        return element;
      }
    }

    // Standard resolution path
    const selector = this.getSelector(elementName, pageName);

    // When a strategy is specified, handle it before the default path
    if (options?.strategy) {
      switch (options.strategy) {
        case SelectionStrategy.INDEX: {
          if (options.index === undefined || options.index === null) {
            throw new Error('options.index is required when using SelectionStrategy.INDEX');
          }
          const baseElement = ElementRepository.isWebPlatform(pageObj!)
            ? new WebElement(this._driver.locator(selector), selector, this.defaultTimeout)
            : new PlatformElement(this._driver, selector, undefined, this.defaultTimeout);
          const allElements = await baseElement.all();
          if (options.index < 0 || options.index >= allElements.length) {
            throw new Error(`Index ${options.index} out of bounds for '${elementName}' on '${pageName}' (found ${allElements.length} elements).`);
          }
          return allElements[options.index];
        }
        case SelectionStrategy.RANDOM: {
          const baseElement = ElementRepository.isWebPlatform(pageObj!)
            ? new WebElement(this._driver.locator(selector), selector, this.defaultTimeout)
            : new PlatformElement(this._driver, selector, undefined, this.defaultTimeout);
          const allElements = await baseElement.all();
          if (allElements.length === 0) {
            throw new Error(`No elements found for '${elementName}' on '${pageName}'`);
          }
          return allElements[pickRandomIndex(allElements.length)];
        }
        case SelectionStrategy.TEXT: {
          if (!options.value) {
            throw new Error('options.value is required when using SelectionStrategy.TEXT');
          }
          const baseLocator = this._driver.locator(selector);
          const filtered = baseLocator.filter({ hasText: options.value });
          const element = ElementRepository.isWebPlatform(pageObj!)
            ? new WebElement(filtered.first(), selector, this.defaultTimeout)
            : new PlatformElement(this._driver, selector, undefined, this.defaultTimeout);
          await element.waitFor({ state: 'attached', timeout: this.defaultTimeout }).catch(() => {});
          return element;
        }
        case SelectionStrategy.ALL: {
          const element = ElementRepository.isWebPlatform(pageObj!)
            ? new WebElement(this._driver.locator(selector), selector, this.defaultTimeout)
            : new PlatformElement(this._driver, selector, undefined, this.defaultTimeout);
          await element.waitFor({ state: 'attached', timeout: this.defaultTimeout }).catch(() => {});
          return element;
        }
        default:
          break;
      }
    }

    const baseElement = ElementRepository.isWebPlatform(pageObj!)
      ? new WebElement(this._driver.locator(selector), selector, this.defaultTimeout)
      : new PlatformElement(this._driver, selector, undefined, this.defaultTimeout);
    const element = baseElement.first();
    await element.waitFor({ state: 'attached', timeout: this.defaultTimeout }).catch(() => {});
    return element;
  }

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

        const matches = exact ? attrValue === value : attrValue.includes(value);
        if (matches) return element;
      }
    } else {
      // Default: try exact match first, then fall back to contains
      for (const element of allElements) {
        const attrValue = await element.getAttribute(attribute);
        if (attrValue === null) continue;
        if (attrValue === value) return element;
      }

      for (const element of allElements) {
        const attrValue = await element.getAttribute(attribute);
        if (attrValue === null) continue;
        if (attrValue.includes(value)) return element;
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
  public async getByIndex(
    elementName: string,
    pageName: string,
    index: number,
    strict: boolean = false
  ): Promise<Element | null> {
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
  public async getVisible(
    elementName: string,
    pageName: string,
    strict: boolean = false
  ): Promise<Element | null> {
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
  public async getByRole(
    elementName: string,
    pageName: string,
    role: string,
    strict: boolean = false
  ): Promise<Element | null> {
    return this.getByAttribute(elementName, pageName, 'role', role, { exact: true, strict });
  }

  /**
   * Returns the raw selector strategy and value without Playwright-specific formatting.
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

  /**
   * Returns the {@link SelectorFormatter} lookup table for the given platform.
   * Falls back to the base {@link APPIUM_FORMATTERS} for unrecognised non-web platforms.
   */
  private getFormattersForPlatform(platform: string): Record<string, SelectorFormatter> {
    if (platform === 'web') return WEB_FORMATTERS;
    if (platform === 'android') return ANDROID_FORMATTERS;
    if (platform === 'ios') return IOS_FORMATTERS;
    return APPIUM_FORMATTERS;
  }
}
