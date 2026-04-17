import { Locator } from '@playwright/test';
import { Element, ElementType, ElementActionOptions } from './Element';
import { ElementChain } from './ElementChain';

/**
 * Playwright-backed {@link Element} implementation.
 *
 * Every method delegates directly to the underlying Playwright {@link Locator},
 * making this a thin, type-safe wrapper that conforms to the shared Element interface.
 */
export class WebElement implements Element {
  readonly _type = ElementType.WEB;

  /**
   * @param locator - The Playwright locator this element wraps.
   * @param selector - The original selector string used to create this element.
   * @param defaultTimeout - Default timeout in ms inherited from the repository.
   */
  constructor(
    public readonly locator: Locator,
    private readonly selector?: string,
    private readonly defaultTimeout?: number,
  ) {}

  /** {@inheritDoc Element.action} */
  action(timeout?: number): ElementChain {
    return new ElementChain(this, timeout ?? this.defaultTimeout);
  }

  // ── Interaction ──────────────────────────────────────────────

  /** {@inheritDoc Element.click} */
  async click(options?: ElementActionOptions): Promise<Element> {
    await this.locator.click({ timeout: options?.timeout });
    return this;
  }

  /** {@inheritDoc Element.fill} */
  async fill(text: string, options?: ElementActionOptions): Promise<Element> {
    await this.locator.fill(text, { timeout: options?.timeout });
    return this;
  }

  /** {@inheritDoc Element.clear} */
  async clear(options?: ElementActionOptions): Promise<Element> {
    await this.locator.clear({ timeout: options?.timeout });
    return this;
  }

  /** {@inheritDoc Element.check} */
  async check(options?: ElementActionOptions): Promise<Element> {
    await this.locator.check({ timeout: options?.timeout });
    return this;
  }

  /** {@inheritDoc Element.uncheck} */
  async uncheck(options?: ElementActionOptions): Promise<Element> {
    await this.locator.uncheck({ timeout: options?.timeout });
    return this;
  }

  /** {@inheritDoc Element.hover} */
  async hover(options?: ElementActionOptions): Promise<Element> {
    await this.locator.hover({ timeout: options?.timeout });
    return this;
  }

  /** {@inheritDoc Element.doubleClick} */
  async doubleClick(options?: ElementActionOptions): Promise<Element> {
    await this.locator.dblclick({ timeout: options?.timeout });
    return this;
  }

  /** {@inheritDoc Element.rightClick} */
  async rightClick(options?: ElementActionOptions): Promise<Element> {
    await this.locator.click({ button: 'right', timeout: options?.timeout });
    return this;
  }

  /** {@inheritDoc Element.scrollIntoView} */
  async scrollIntoView(options?: ElementActionOptions): Promise<Element> {
    await this.locator.scrollIntoViewIfNeeded({ timeout: options?.timeout });
    return this;
  }

  /** {@inheritDoc Element.pressSequentially} */
  async pressSequentially(text: string, delay?: number, options?: ElementActionOptions): Promise<Element> {
    await this.locator.pressSequentially(text, { delay, timeout: options?.timeout });
    return this;
  }

  /** {@inheritDoc Element.setInputFiles} */
  async setInputFiles(filePath: string, options?: ElementActionOptions): Promise<Element> {
    await this.locator.setInputFiles(filePath, { timeout: options?.timeout });
    return this;
  }

  /** {@inheritDoc Element.dispatchEvent} */
  async dispatchEvent(event: string): Promise<Element> {
    await this.locator.dispatchEvent(event);
    return this;
  }

  // ── State ────────────────────────────────────────────────────

  /** {@inheritDoc Element.isVisible} */
  async isVisible(): Promise<boolean> { return this.locator.isVisible(); }

  /** {@inheritDoc Element.isEnabled} */
  async isEnabled(): Promise<boolean> { return this.locator.isEnabled(); }

  /** {@inheritDoc Element.isChecked} */
  async isChecked(): Promise<boolean> { return this.locator.isChecked(); }

  // ── Extraction ───────────────────────────────────────────────

  /** {@inheritDoc Element.raw} */
  async raw(): Promise<string | null> { return this.selector ?? this.locator.toString(); }

  /** {@inheritDoc Element.textContent} */
  async textContent(): Promise<string | null> { return this.locator.textContent(); }

  /** {@inheritDoc Element.getAttribute} */
  async getAttribute(name: string): Promise<string | null> { return this.locator.getAttribute(name); }

  /** {@inheritDoc Element.inputValue} */
  async inputValue(): Promise<string> { return this.locator.inputValue(); }

  /** {@inheritDoc Element.getCssProperty} */
  async getCssProperty(property: string): Promise<string> {
    return this.locator.evaluate(
      (el, prop) => window.getComputedStyle(el as globalThis.Element).getPropertyValue(prop),
      property,
    );
  }

  /** {@inheritDoc Element.getAllAttributes} */
  async getAllAttributes(): Promise<Record<string, string>> {
    return this.locator.evaluate((el: globalThis.Element) => {
      const out: Record<string, string> = {};
      for (const attr of Array.from(el.attributes)) out[attr.name] = attr.value;
      return out;
    });
  }

  /** {@inheritDoc Element.boundingBox} */
  async boundingBox(): Promise<{ x: number; y: number; width: number; height: number } | null> {
    return this.locator.boundingBox();
  }

  /** {@inheritDoc Element.screenshot} */
  async screenshot(options?: { path?: string }): Promise<Buffer> {
    return await this.locator.screenshot({ path: options?.path }) as Buffer;
  }

  /** {@inheritDoc Element.getTagName} */
  async getTagName(): Promise<string> {
    return this.locator.evaluate((el: globalThis.Element) => el.tagName.toLowerCase());
  }

  /** {@inheritDoc Element.isExisting} */
  async isExisting(): Promise<boolean> {
    return (await this.locator.count()) > 0;
  }

  /** {@inheritDoc Element.dragTo} */
  async dragTo(
    target: Element,
    options?: {
      timeout?: number;
      sourcePosition?: { x: number; y: number };
      targetPosition?: { x: number; y: number };
    },
  ): Promise<Element> {
    const targetLocator = (target as WebElement).locator;
    await this.locator.dragTo(targetLocator, {
      timeout: options?.timeout,
      sourcePosition: options?.sourcePosition,
      targetPosition: options?.targetPosition,
    });
    return this;
  }

  /** {@inheritDoc Element.selectOption} */
  async selectOption(
    values:
      | string
      | string[]
      | { value?: string; label?: string; index?: number }
      | Array<{ value?: string; label?: string; index?: number }>,
    options?: ElementActionOptions,
  ): Promise<string[]> {
    return this.locator.selectOption(values as Parameters<Locator['selectOption']>[0], {
      timeout: options?.timeout,
    });
  }

  // ── Querying ─────────────────────────────────────────────────

  /** {@inheritDoc Element.locateChild} */
  locateChild(childSelector: string): Element { return new WebElement(this.locator.locator(childSelector), childSelector, this.defaultTimeout); }

  /** {@inheritDoc Element.count} */
  async count(): Promise<number> { return this.locator.count(); }

  /** {@inheritDoc Element.all} */
  async all(): Promise<Element[]> { return (await this.locator.all()).map(l => new WebElement(l, this.selector, this.defaultTimeout)); }

  /** {@inheritDoc Element.first} */
  first(): Element { return new WebElement(this.locator.first(), this.selector, this.defaultTimeout); }

  /** {@inheritDoc Element.nth} */
  nth(index: number): Element { return new WebElement(this.locator.nth(index), this.selector, this.defaultTimeout); }

  /** {@inheritDoc Element.filter} */
  filter(options: { hasText?: string | RegExp }): Element { return new WebElement(this.locator.filter(options), this.selector, this.defaultTimeout); }

  // ── Waiting ──────────────────────────────────────────────────

  /** {@inheritDoc Element.waitFor} */
  async waitFor(options?: { state?: string; timeout?: number }): Promise<void> {
    await this.locator.waitFor({ state: options?.state as any, timeout: options?.timeout });
  }
}
