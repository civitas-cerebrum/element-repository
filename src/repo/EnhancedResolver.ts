import { PageObject, RegexPattern, SelectorValue } from '../schema/repository';
import { SelectorFormatter } from './formatters';

/**
 * Resolves enhanced selector types that go beyond simple strategy-to-value
 * mappings: role + accessible name, regex text patterns, and iframe scoping.
 *
 * For web (Playwright): returns a Locator object.
 * For mobile (Appium): returns a selector string.
 * Returns `null` when the selector uses only standard types.
 */
export class EnhancedResolver {

  /**
   * Maps ARIA roles to Android widget class names for UiSelector queries.
   *
   * Used when resolving `{ "role": "button", "name": "Log in" }` on Android
   * to produce `android=new UiSelector().className("android.widget.Button").text("Log in")`.
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
   *
   * Used when resolving `{ "role": "button", "name": "Log in" }` on iOS
   * to produce `-ios predicate string:type == 'XCUIElementTypeButton' AND label == 'Log in'`.
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

  /**
   * Returns `true` when the given selector value is a regex pattern object
   * (i.e., `{ regex: string; flags?: string }`).
   * @param value The selector value to check.
   * @returns `true` if the value is a {@link RegexPattern}.
   */
  static isRegex(value: SelectorValue): value is RegexPattern {
    return typeof value === 'object' && value !== null && 'regex' in value;
  }

  /**
   * Returns `true` when the given page uses the `'web'` platform (Playwright).
   * Defaults to `'web'` when no platform is specified.
   * @param page The page object from the JSON repository.
   * @returns `true` if the page targets the web platform.
   */
  static isWebPlatform(page: PageObject): boolean {
    return (page.platform ?? 'web') === 'web';
  }

  /**
   * Attempts to resolve an enhanced selector for the given element.
   *
   * Enhanced selectors include:
   * - **Role + accessible name:** `{ "role": "button", "name": "Log in" }`
   * - **Regex text patterns:** `{ "text": { "regex": "pattern", "flags": "i" } }`
   * - **Iframe-scoped pages:** Pages with a `"frame"` property
   *
   * @param driver The Playwright `Page` or WebDriverIO `Browser`/`Driver` instance.
   * @param pageObj The page definition from the JSON repository.
   * @param elementName The specific element name to look up within the page.
   * @param formatters The selector formatter lookup table for the page's platform.
   * @returns A Playwright Locator (web), a selector string (mobile), or `null` if standard resolution should be used.
   */
  static resolve(
    driver: any,
    pageObj: PageObject,
    elementName: string,
    formatters: Record<string, SelectorFormatter>,
  ): any | null {
    const elementDef = pageObj.elements.find(e => e.elementName === elementName);
    if (!elementDef) return null;

    const selector = elementDef.selector;
    const hasFrame = pageObj.frame !== undefined;
    const hasRoleWithName = selector.role !== undefined && selector.name !== undefined;
    const hasRegexText = selector.text !== undefined && EnhancedResolver.isRegex(selector.text);

    if (!hasFrame && !hasRoleWithName && !hasRegexText) return null;

    const platform = pageObj.platform ?? 'web';

    // ── Web (Playwright) ──────────────────────────────────────────
    if (EnhancedResolver.isWebPlatform(pageObj)) {
      let scope: any = driver;
      if (hasFrame) {
        scope = EnhancedResolver.resolveFrameScope(driver, pageObj);
      }

      if (hasRoleWithName) {
        return EnhancedResolver.resolveRoleForWeb(scope, selector);
      }

      if (hasRegexText) {
        const textSpec = selector.text as RegexPattern;
        return scope.locator(`text=/${textSpec.regex}/${textSpec.flags ?? ''}`);
      }

      // Frame-scoped with standard selector — build locator inside frame
      if (hasFrame) {
        const strategy = Object.keys(selector)[0];
        const value = selector[strategy] as string;
        const formatter = formatters[strategy.toLowerCase()];
        const formatted = formatter ? formatter(value) : value;
        return scope.locator(formatted);
      }

      return null;
    }

    // ── Non-web (Appium: Android / iOS) ───────────────────────────
    // Frames don't exist in native apps — skip frame logic
    if (hasRoleWithName) {
      return EnhancedResolver.resolveRoleForMobile(platform, selector);
    }

    if (hasRegexText) {
      return EnhancedResolver.resolveRegexTextForMobile(platform, selector);
    }

    return null;
  }

  // ── Web helpers ─────────────────────────────────────────────────

  /**
   * Resolves a role + accessible name selector for web using Playwright's
   * `getByRole()` API. Supports both plain string names and regex patterns.
   * @param scope The Playwright Page or FrameLocator to query within.
   * @param selector The raw selector object from the element definition.
   * @returns A Playwright Locator targeting the matching role element.
   */
  private static resolveRoleForWeb(scope: any, selector: Record<string, SelectorValue>): any {
    const role = selector.role as string;
    const nameValue = selector.name;
    const roleOptions: Record<string, any> = {};

    if (typeof nameValue === 'string') {
      roleOptions.name = nameValue;
    } else if (EnhancedResolver.isRegex(nameValue)) {
      roleOptions.name = new RegExp(nameValue.regex, nameValue.flags);
    }

    if (selector.exact !== undefined) {
      roleOptions.exact = String(selector.exact) === 'true';
    }

    return scope.getByRole(role, roleOptions);
  }

  /**
   * Resolves the FrameLocator scope for a frame-scoped page definition.
   * Supports single frames, frame disambiguation (first/last/index), and
   * nested frame chains (array of frame selectors).
   * @param driver The Playwright Page instance.
   * @param pageObj The page definition containing the `frame` property.
   * @returns A Playwright FrameLocator scoped to the target iframe.
   */
  static resolveFrameScope(driver: any, pageObj: PageObject): any {
    const frameSpec = pageObj.frame!;

    if (Array.isArray(frameSpec)) {
      // Nested frames: chain frameLocator calls
      let scope: any = driver;
      for (const frame of frameSpec) {
        const sel = frame.css ?? (frame.xpath ? `xpath=${frame.xpath}` : '');
        scope = scope.frameLocator(sel);
      }
      return scope;
    }

    // Single frame
    const sel = frameSpec.css ?? (frameSpec.xpath ? `xpath=${frameSpec.xpath}` : '');
    let frameLocator = driver.frameLocator(sel);

    // Frame disambiguation
    if (pageObj.frameIndex !== undefined) {
      const idx = pageObj.frameIndex;
      if (idx === 'first') frameLocator = frameLocator.first();
      else if (idx === 'last') frameLocator = frameLocator.last();
      else if (typeof idx === 'number') frameLocator = frameLocator.nth(idx);
    }

    return frameLocator;
  }

  // ── Mobile helpers ──────────────────────────────────────────────

  /**
   * Resolves a role + name selector for Android or iOS using platform-native
   * locator strategies.
   *
   * - **Android:** `android=new UiSelector().className("...").text("...")`
   * - **iOS:** `-ios predicate string:type == '...' AND label == '...'`
   *
   * @param platform The platform string (`'android'` or `'ios'`).
   * @param selector The raw selector object from the element definition.
   * @returns A platform-native selector string, or `null` if the role is not mapped.
   */
  private static resolveRoleForMobile(
    platform: string,
    selector: Record<string, SelectorValue>,
  ): string | null {
    const role = selector.role as string;
    const nameValue = selector.name;
    const nameStr = typeof nameValue === 'string' ? nameValue : null;
    const nameRegex = EnhancedResolver.isRegex(nameValue) ? nameValue : null;

    if (platform === 'android') {
      const className = EnhancedResolver.ROLE_TO_ANDROID_CLASS[role];
      if (!className) return null;
      let uiSelector = `new UiSelector().className("${className}")`;
      if (nameStr) uiSelector += `.text("${nameStr}")`;
      else if (nameRegex) uiSelector += `.textMatches("${nameRegex.regex}")`;
      return `android=${uiSelector}`;
    }

    if (platform === 'ios') {
      const iosType = EnhancedResolver.ROLE_TO_IOS_TYPE[role];
      if (!iosType) return null;
      let predicate = `type == '${iosType}'`;
      if (nameStr) predicate += ` AND label == '${nameStr}'`;
      else if (nameRegex) predicate += ` AND label MATCHES '${nameRegex.regex}'`;
      return `-ios predicate string:${predicate}`;
    }

    return null;
  }

  /**
   * Resolves a regex text selector for Android or iOS.
   *
   * - **Android:** `android=new UiSelector().textMatches("pattern")`
   * - **iOS:** `-ios predicate string:label MATCHES 'pattern'`
   *
   * @param platform The platform string (`'android'` or `'ios'`).
   * @param selector The raw selector object from the element definition.
   * @returns A platform-native selector string, or `null` if the platform is not supported.
   */
  private static resolveRegexTextForMobile(
    platform: string,
    selector: Record<string, SelectorValue>,
  ): string | null {
    const textSpec = selector.text as RegexPattern;

    if (platform === 'android') {
      return `android=new UiSelector().textMatches("${textSpec.regex}")`;
    }

    if (platform === 'ios') {
      return `-ios predicate string:label MATCHES '${textSpec.regex}'`;
    }

    return null;
  }
}
