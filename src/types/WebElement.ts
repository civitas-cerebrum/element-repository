import { Locator } from '@playwright/test';
import { Element, ElementType } from './Element';

/**
 * Playwright-backed {@link Element} implementation.
 *
 * Every method delegates directly to the underlying Playwright {@link Locator},
 * making this a thin, type-safe wrapper that conforms to the shared Element interface.
 */
export class WebElement implements Element {
  readonly _type = ElementType.WEB;

  /** @param locator - The Playwright locator this element wraps. */
  constructor(public readonly locator: Locator) {}

  /** {@inheritDoc Element.click} */
  async click(): Promise<void> { await this.locator.click(); }

  /**
   * {@inheritDoc Element.fill}
   * @param text - The value to type into the element.
   */
  async fill(text: string): Promise<void> { await this.locator.fill(text); }

  /** {@inheritDoc Element.clear} */
  async clear(): Promise<void> { await this.locator.clear(); }

  /** {@inheritDoc Element.check} */
  async check(): Promise<void> { await this.locator.check(); }

  /** {@inheritDoc Element.uncheck} */
  async uncheck(): Promise<void> { await this.locator.uncheck(); }

  /** {@inheritDoc Element.hover} */
  async hover(): Promise<void> { await this.locator.hover(); }

  /** {@inheritDoc Element.doubleClick} */
  async doubleClick(): Promise<void> { await this.locator.dblclick(); }

  /** {@inheritDoc Element.scrollIntoView} */
  async scrollIntoView(): Promise<void> { await this.locator.scrollIntoViewIfNeeded(); }

  /**
   * {@inheritDoc Element.pressSequentially}
   * @param text  - The characters to type.
   * @param delay - Optional millisecond delay between keystrokes.
   */
  async pressSequentially(text: string, delay?: number): Promise<void> {
    await this.locator.pressSequentially(text, { delay });
  }

  /**
   * {@inheritDoc Element.setInputFiles}
   * @param filePath - Absolute or relative path to the file.
   */
  async setInputFiles(filePath: string): Promise<void> { await this.locator.setInputFiles(filePath); }

  /**
   * {@inheritDoc Element.dispatchEvent}
   * @param event - The event type to dispatch (e.g. `"change"`).
   */
  async dispatchEvent(event: string): Promise<void> { await this.locator.dispatchEvent(event); }

  /** {@inheritDoc Element.isVisible} */
  async isVisible(): Promise<boolean> { return this.locator.isVisible(); }

  /** {@inheritDoc Element.isEnabled} */
  async isEnabled(): Promise<boolean> { return this.locator.isEnabled(); }

  /** {@inheritDoc Element.isChecked} */
  async isChecked(): Promise<boolean> { return this.locator.isChecked(); }

  /** {@inheritDoc Element.textContent} */
  async textContent(): Promise<string | null> { return this.locator.textContent(); }

  /**
   * {@inheritDoc Element.getAttribute}
   * @param name - Attribute name.
   */
  async getAttribute(name: string): Promise<string | null> { return this.locator.getAttribute(name); }

  /** {@inheritDoc Element.inputValue} */
  async inputValue(): Promise<string> { return this.locator.inputValue(); }

  /**
   * {@inheritDoc Element.locateChild}
   * @param selector - CSS or Playwright selector for the descendant.
   */
  locateChild(selector: string): Element { return new WebElement(this.locator.locator(selector)); }

  /** {@inheritDoc Element.count} */
  async count(): Promise<number> { return this.locator.count(); }

  /** {@inheritDoc Element.all} */
  async all(): Promise<Element[]> { return (await this.locator.all()).map(l => new WebElement(l)); }

  /** {@inheritDoc Element.first} */
  first(): Element { return new WebElement(this.locator.first()); }

  /**
   * {@inheritDoc Element.nth}
   * @param index - Zero-based position.
   */
  nth(index: number): Element { return new WebElement(this.locator.nth(index)); }

  /**
   * {@inheritDoc Element.filter}
   * @param options - Filter criteria.
   */
  filter(options: { hasText?: string | RegExp }): Element { return new WebElement(this.locator.filter(options)); }

  /**
   * {@inheritDoc Element.waitFor}
   * @param options - Optional state and timeout configuration.
   */
  async waitFor(options?: { state?: string; timeout?: number }): Promise<void> {
    await this.locator.waitFor({ state: options?.state as any, timeout: options?.timeout });
  }
}
