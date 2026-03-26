import { Locator } from '@playwright/test';

export enum ElementType {
  WEB = 'web',
  PLATFORM = 'platform',
}

export interface Element {
  readonly _type: ElementType;

  // Interaction
  click(): Promise<void>;
  fill(text: string): Promise<void>;
  clear(): Promise<void>;
  check(): Promise<void>;
  uncheck(): Promise<void>;
  hover(): Promise<void>;
  doubleClick(): Promise<void>;
  scrollIntoView(): Promise<void>;
  pressSequentially(text: string, delay?: number): Promise<void>;
  setInputFiles(filePath: string): Promise<void>;
  dispatchEvent(event: string): Promise<void>;

  // State
  isVisible(): Promise<boolean>;
  isEnabled(): Promise<boolean>;
  isChecked(): Promise<boolean>;

  // Extraction
  textContent(): Promise<string | null>;
  getAttribute(name: string): Promise<string | null>;
  inputValue(): Promise<string>;

  // Querying
  locateChild(selector: string): Element;
  count(): Promise<number>;
  all(): Promise<Element[]>;
  first(): Element;
  nth(index: number): Element;
  filter(options: { hasText?: string | RegExp }): Element;

  // Waiting
  waitFor(options?: { state?: string; timeout?: number }): Promise<void>;
}

export class WebElement implements Element {
  readonly _type = ElementType.WEB;
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

export class PlatformElement implements Element {
  readonly _type = ElementType.PLATFORM;

  constructor(
    public readonly driver: any,
    public readonly selector: string,
    public readonly parentElement?: any,
  ) {}

  private async findOne(): Promise<any> {
    if (this.parentElement) return this.parentElement.$(this.selector);
    return this.driver.$(this.selector);
  }

  private async findAll(): Promise<any[]> {
    if (this.parentElement) return this.parentElement.$$(this.selector);
    return this.driver.$$(this.selector);
  }

  async click(): Promise<void> { await (await this.findOne()).click(); }
  async fill(text: string): Promise<void> {
    const el = await this.findOne();
    await el.clearValue();
    await el.setValue(text);
  }
  async clear(): Promise<void> { await (await this.findOne()).clearValue(); }
  async check(): Promise<void> {
    const el = await this.findOne();
    if (!(await el.isSelected())) await el.click();
  }
  async uncheck(): Promise<void> {
    const el = await this.findOne();
    if (await el.isSelected()) await el.click();
  }
  async hover(): Promise<void> {
    const el = await this.findOne();
    await el.moveTo();
  }
  async doubleClick(): Promise<void> { await (await this.findOne()).doubleClick(); }
  async scrollIntoView(): Promise<void> {
    const el = await this.findOne();
    await this.driver.execute('mobile: scroll', { element: el.elementId, toVisible: true });
  }
  async pressSequentially(text: string, delay: number = 50): Promise<void> {
    const el = await this.findOne();
    for (const char of text) {
      await el.addValue(char);
      if (delay > 0) await this.driver.pause(delay);
    }
  }
  async setInputFiles(_filePath: string): Promise<void> {
    throw new Error('setInputFiles is not supported on platform elements.');
  }
  async dispatchEvent(_event: string): Promise<void> {
    throw new Error('dispatchEvent is not supported on platform elements.');
  }

  async isVisible(): Promise<boolean> { return (await this.findOne()).isDisplayed(); }
  async isEnabled(): Promise<boolean> { return (await this.findOne()).isEnabled(); }
  async isChecked(): Promise<boolean> { return (await this.findOne()).isSelected(); }

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

  locateChild(selector: string): Element {
    return new PlatformElement(this.driver, selector);
  }
  async count(): Promise<number> { return (await this.findAll()).length; }
  async all(): Promise<Element[]> {
    const elements = await this.findAll();
    return elements.map(el => new PlatformElement(this.driver, this.selector, el));
  }
  first(): Element { return this; }
  nth(_index: number): Element { return this; }
  filter(_options: { hasText?: string | RegExp }): Element { return this; }

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

export function isWeb(el: Element): el is WebElement {
  return el._type === ElementType.WEB;
}

export function isPlatform(el: Element): el is PlatformElement {
  return el._type === ElementType.PLATFORM;
}
