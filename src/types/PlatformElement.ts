import { Element, ElementType } from './Element';

/**
 * WebDriverIO-backed {@link Element} implementation for mobile and desktop platforms.
 *
 * Uses the WebDriverIO `$` / `$$` commands to locate native elements via Appium selectors.
 * Methods that have no native equivalent (e.g. {@link setInputFiles}, {@link dispatchEvent})
 * throw at runtime.
 */
export class PlatformElement implements Element {
  readonly _type = ElementType.PLATFORM;

  /**
   * @param driver          - The WebDriverIO browser/driver instance.
   * @param selector        - Appium-compatible selector string.
   * @param resolvedElement - Optional already-resolved raw WebDriverIO element
   *                          (e.g. from `$$`). When set, {@link findOne} returns
   *                          it directly instead of re-querying the driver.
   */
  constructor(
    public readonly driver: any,
    public readonly selector: string,
    public readonly resolvedElement?: any,
  ) {}

  /**
   * Returns the underlying raw element.
   * If a {@link resolvedElement} was provided (e.g. from {@link all}), it is
   * returned directly; otherwise the driver is queried via `$`.
   */
  private async findOne(): Promise<any> {
    if (this.resolvedElement) return this.resolvedElement;
    return this.driver.$(this.selector);
  }

  /** Locates all matching elements using `$$`. */
  private async findAll(): Promise<any[]> {
    return this.driver.$$(this.selector);
  }

  async click(): Promise<void> { await (await this.findOne()).click(); }

  /**
   * Clears the field and sets the given text.
   * Uses `clearValue` + `setValue` under the hood.
   */
  async fill(text: string): Promise<void> {
    const el = await this.findOne();
    await el.clearValue();
    await el.setValue(text);
  }

  async clear(): Promise<void> { await (await this.findOne()).clearValue(); }

  /** Checks the element if it is not already selected. */
  async check(): Promise<void> {
    const el = await this.findOne();
    if (!(await el.isSelected())) await el.click();
  }

  /** Unchecks the element if it is currently selected. */
  async uncheck(): Promise<void> {
    const el = await this.findOne();
    if (await el.isSelected()) await el.click();
  }

  /** Moves the pointer to the element via `moveTo`. */
  async hover(): Promise<void> {
    const el = await this.findOne();
    await el.moveTo();
  }

  async doubleClick(): Promise<void> { await (await this.findOne()).doubleClick(); }

  /** Scrolls the element into view using the `mobile: scroll` Appium command. */
  async scrollIntoView(): Promise<void> {
    const el = await this.findOne();
    await this.driver.execute('mobile: scroll', { element: el.elementId, toVisible: true });
  }

  /**
   * Types text character-by-character using `addValue`.
   * @param text  - The characters to type.
   * @param delay - Millisecond pause between keystrokes (default 50).
   */
  async pressSequentially(text: string, delay: number = 50): Promise<void> {
    const el = await this.findOne();
    for (const char of text) {
      await el.addValue(char);
      if (delay > 0) await this.driver.pause(delay);
    }
  }

  /**
   * Not supported on platform elements.
   * @throws Always throws an `Error`.
   */
  async setInputFiles(_filePath: string): Promise<void> {
    throw new Error('setInputFiles is not supported on platform elements.');
  }

  /**
   * Not supported on platform elements.
   * @throws Always throws an `Error`.
   */
  async dispatchEvent(_event: string): Promise<void> {
    throw new Error('dispatchEvent is not supported on platform elements.');
  }

  async isVisible(): Promise<boolean> { return (await this.findOne()).isDisplayed(); }
  async isEnabled(): Promise<boolean> { return (await this.findOne()).isEnabled(); }
  async isChecked(): Promise<boolean> { return (await this.findOne()).isSelected(); }

  /** Returns trimmed text content, or `null` if empty. */
  async textContent(): Promise<string | null> {
    const text = await (await this.findOne()).getText();
    return text?.trim() ?? null;
  }

  async getAttribute(name: string): Promise<string | null> {
    return (await this.findOne()).getAttribute(name);
  }

  /** Returns the input value via `getValue`, falling back to the `value` attribute. */
  async inputValue(): Promise<string> {
    const el = await this.findOne();
    try { return await el.getValue(); } catch { return (await el.getAttribute('value')) ?? ''; }
  }

  locateChild(selector: string): Element {
    return new PlatformElement(this.driver, selector);
  }

  async count(): Promise<number> { return (await this.findAll()).length; }

  async all(): Promise<Element[]> {
    const elements = await this.findAll();
    return elements.map(el => new PlatformElement(this.driver, this.selector, el));
  }

  /** Returns `this` — platform elements don't support index-based narrowing. */
  first(): Element { return this; }

  /** Returns `this` — platform elements don't support index-based narrowing. */
  nth(_index: number): Element { return this; }

  /** Returns `this` — platform elements don't support text-based filtering. */
  filter(_options: { hasText?: string | RegExp }): Element { return this; }

  /**
   * Waits for the element to reach the specified state.
   * Supports `"visible"` (default), `"hidden"`, `"attached"`, and `"detached"`.
   * @param options - State and timeout configuration.
   */
  async waitFor(options?: { state?: string; timeout?: number }): Promise<void> {
    const el = await this.findOne();
    const timeout = options?.timeout ?? 30000;
    switch (options?.state) {
      case 'hidden':
        await el.waitForDisplayed({ timeout, reverse: true });
        break;
      case 'detached':
        await el.waitForExist({ timeout, reverse: true });
        break;
      case 'attached':
        await el.waitForExist({ timeout });
        break;
      case 'visible':
      default:
        await el.waitForDisplayed({ timeout });
        break;
    }
  }
}
