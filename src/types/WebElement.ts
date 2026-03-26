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

  async click(): Promise<void> { await this.locator.click(); }
  async fill(text: string): Promise<void> { await this.locator.fill(text); }
  async clear(): Promise<void> { await this.locator.clear(); }
  async check(): Promise<void> { await this.locator.check(); }
  async uncheck(): Promise<void> { await this.locator.uncheck(); }
  async hover(): Promise<void> { await this.locator.hover(); }
  async doubleClick(): Promise<void> { await this.locator.dblclick(); }
  async scrollIntoView(): Promise<void> { await this.locator.scrollIntoViewIfNeeded(); }
  async pressSequentially(text: string, delay?: number): Promise<void> {
    await this.locator.pressSequentially(text, { delay });
  }
  async setInputFiles(filePath: string): Promise<void> { await this.locator.setInputFiles(filePath); }
  async dispatchEvent(event: string): Promise<void> { await this.locator.dispatchEvent(event); }

  async isVisible(): Promise<boolean> { return this.locator.isVisible(); }
  async isEnabled(): Promise<boolean> { return this.locator.isEnabled(); }
  async isChecked(): Promise<boolean> { return this.locator.isChecked(); }

  async textContent(): Promise<string | null> { return this.locator.textContent(); }
  async getAttribute(name: string): Promise<string | null> { return this.locator.getAttribute(name); }
  async inputValue(): Promise<string> { return this.locator.inputValue(); }

  locateChild(selector: string): Element { return new WebElement(this.locator.locator(selector)); }
  async count(): Promise<number> { return this.locator.count(); }
  async all(): Promise<Element[]> { return (await this.locator.all()).map(l => new WebElement(l)); }
  first(): Element { return new WebElement(this.locator.first()); }
  nth(index: number): Element { return new WebElement(this.locator.nth(index)); }
  filter(options: { hasText?: string | RegExp }): Element { return new WebElement(this.locator.filter(options)); }

  async waitFor(options?: { state?: string; timeout?: number }): Promise<void> {
    await this.locator.waitFor({ state: options?.state as any, timeout: options?.timeout });
  }
}
