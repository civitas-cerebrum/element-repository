import { Element, ElementType, ElementActionOptions } from './Element';
import { ElementChain } from './ElementChain';

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
   * (e.g. from `$$`). When set, {@link findOne} returns
   * it directly instead of re-querying the driver.
   */
  constructor(
    public readonly driver: any,
    public readonly selector: string,
    public readonly resolvedElement?: any,
    private readonly defaultTimeout?: number,
  ) {}

  /** {@inheritDoc Element.action} */
  action(timeout?: number): ElementChain {
    return new ElementChain(this, timeout ?? this.defaultTimeout);
  }

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

  // ── Interaction ──────────────────────────────────────────────

  async click(_options?: ElementActionOptions): Promise<Element> {
    await (await this.findOne()).click();
    return this;
  }

  async fill(text: string, _options?: ElementActionOptions): Promise<Element> {
    const el = await this.findOne();
    await el.clearValue();
    await el.setValue(text);
    return this;
  }

  async clear(_options?: ElementActionOptions): Promise<Element> {
    await (await this.findOne()).clearValue();
    return this;
  }

  async check(_options?: ElementActionOptions): Promise<Element> {
    const el = await this.findOne();
    if (!(await el.isSelected())) await el.click();
    return this;
  }

  async uncheck(_options?: ElementActionOptions): Promise<Element> {
    const el = await this.findOne();
    if (await el.isSelected()) await el.click();
    return this;
  }

  async hover(_options?: ElementActionOptions): Promise<Element> {
    await (await this.findOne()).moveTo();
    return this;
  }

  async rightClick(_options?: ElementActionOptions): Promise<Element> {
    throw new Error('rightClick() is not supported on platform elements — use long-press gestures');
  }

  async doubleClick(_options?: ElementActionOptions): Promise<Element> {
    await (await this.findOne()).doubleClick();
    return this;
  }

  async scrollIntoView(_options?: ElementActionOptions): Promise<Element> {
    const el = await this.findOne();
    await this.driver.execute('mobile: scroll', { element: el.elementId, toVisible: true });
    return this;
  }

  async pressSequentially(text: string, delay: number = 50, _options?: ElementActionOptions): Promise<Element> {
    const el = await this.findOne();
    for (const char of text) {
      await el.addValue(char);
      if (delay > 0) await this.driver.pause(delay);
    }
    return this;
  }

  async setInputFiles(_filePath: string, _options?: ElementActionOptions): Promise<Element> {
    throw new Error('setInputFiles is not supported on platform elements.');
  }

  async dispatchEvent(_event: string): Promise<Element> {
    throw new Error('dispatchEvent is not supported on platform elements.');
  }

  // ── State ────────────────────────────────────────────────────

  async isVisible(): Promise<boolean> { return (await this.findOne()).isDisplayed(); }
  async isEnabled(): Promise<boolean> { return (await this.findOne()).isEnabled(); }
  async isChecked(): Promise<boolean> { return (await this.findOne()).isSelected(); }

  // ── Extraction ───────────────────────────────────────────────

  async raw(): Promise<string | null> { return this.selector; }

  async textContent(): Promise<string | null> {
    const text = await (await this.findOne()).getText();
    return text?.trim() ?? null;
  }

  async getAttribute(name: string): Promise<string | null> {
    return (await this.findOne()).getAttribute(name);
  }

  async inputValue(): Promise<string> {
    const el = await this.findOne();
    try { return await el.getValue(); } catch { return (await el.getAttribute('value')) ?? ''; }
  }

  async getCssProperty(property: string): Promise<string> {
    const el = await this.findOne();
    try { return await el.getCSSValue(property); }
    catch { throw new Error(`getCssProperty("${property}") is not supported on this platform driver`); }
  }

  async getAllAttributes(): Promise<Record<string, string>> {
    throw new Error('getAllAttributes() is not supported on platform elements — use getAttribute(name) for known keys');
  }

  async boundingBox(): Promise<{ x: number; y: number; width: number; height: number } | null> {
    const el = await this.findOne();
    try {
      const rect = await el.getRect();
      if (!rect) return null;
      return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
    } catch {
      throw new Error('boundingBox() is not supported on this platform driver');
    }
  }

  async screenshot(_options?: { path?: string }): Promise<Buffer> {
    const el = await this.findOne();
    try {
      const raw = await el.takeElementScreenshot();
      return Buffer.from(raw as string, 'base64');
    } catch {
      throw new Error('screenshot() is not supported on this platform driver');
    }
  }

  async dragTo(_target: Element, _options?: { timeout?: number; sourcePosition?: { x: number; y: number }; targetPosition?: { x: number; y: number } }): Promise<Element> {
    throw new Error('dragTo() is not supported on platform elements — use touch gestures through the platform driver directly');
  }

  async selectOption(_values: unknown, _options?: ElementActionOptions): Promise<string[]> {
    throw new Error('selectOption() is not supported on platform elements — use platform-specific picker interactions');
  }

  // ── Querying ─────────────────────────────────────────────────

  locateChild(selector: string): Element {
    return new PlatformElement(this.driver, selector, undefined, this.defaultTimeout);
  }

  async count(): Promise<number> { return (await this.findAll()).length; }

  async all(): Promise<Element[]> {
    const elements = await this.findAll();
    return elements.map(el => new PlatformElement(this.driver, this.selector, el, this.defaultTimeout));
  }

  first(): Element { return this; }
  nth(_index: number): Element { return this; }
  filter(_options: { hasText?: string | RegExp }): Element { return this; }

  // ── Waiting ──────────────────────────────────────────────────

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
