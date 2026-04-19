import { Locator } from '@playwright/test';
import { Element, ElementType, ElementActionOptions, ScrollIntoViewOptions, SwipeDirection, SwipeOptions } from './Element';
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
   * @param locator - The Playwright locator this element wraps. Exposed
   *                  publicly as a deliberate **escape hatch**: consumer
   *                  packages (element-interactions, singularity-engine)
   *                  may reach through this to compose Playwright-specific
   *                  expectations (`expect(element.locator).toHaveText(...)`)
   *                  that the shared `Element` contract doesn't cover. Prefer
   *                  the `Element` methods and `selector` for everything else.
   * @param selector - The original selector string used to create this element,
   *                   in Playwright-native form (e.g. `css=button.primary`).
   *                   May be `undefined` when the element was constructed from
   *                   a pre-built locator.
   * @param defaultTimeout - Default timeout in ms inherited from the repository.
   */
  constructor(
    public readonly locator: Locator,
    public readonly selector?: string,
    private readonly defaultTimeout?: number,
  ) {}

  /** {@inheritDoc Element.action} */
  action(timeout?: number): ElementChain {
    return new ElementChain(this, timeout ?? this.defaultTimeout);
  }

  // ── Interaction ──────────────────────────────────────────────

  /**
   * Waits for the element to be attached to the DOM before any action
   * fires. Resolves quickly in the common case; gives every action a
   * predictable presence-detection preamble, so failures are "element
   * never attached" rather than opaque action errors.
   */
  private async ensureAttached(timeout?: number): Promise<void> {
    await this.locator.waitFor({ state: 'attached', timeout });
  }

  /** {@inheritDoc Element.click} */
  async click(options?: ElementActionOptions): Promise<Element> {
    await this.ensureAttached(options?.timeout);
    await this.locator.click({ timeout: options?.timeout });
    return this;
  }

  /** {@inheritDoc Element.fill} */
  async fill(text: string, options?: ElementActionOptions): Promise<Element> {
    await this.ensureAttached(options?.timeout);
    await this.locator.fill(text, { timeout: options?.timeout });
    return this;
  }

  /** {@inheritDoc Element.clear} */
  async clear(options?: ElementActionOptions): Promise<Element> {
    await this.ensureAttached(options?.timeout);
    await this.locator.clear({ timeout: options?.timeout });
    return this;
  }

  /** {@inheritDoc Element.check} */
  async check(options?: ElementActionOptions): Promise<Element> {
    await this.ensureAttached(options?.timeout);
    await this.locator.check({ timeout: options?.timeout });
    return this;
  }

  /** {@inheritDoc Element.uncheck} */
  async uncheck(options?: ElementActionOptions): Promise<Element> {
    await this.ensureAttached(options?.timeout);
    await this.locator.uncheck({ timeout: options?.timeout });
    return this;
  }

  /** {@inheritDoc Element.hover} */
  async hover(options?: ElementActionOptions): Promise<Element> {
    await this.ensureAttached(options?.timeout);
    await this.locator.hover({ timeout: options?.timeout });
    return this;
  }

  /** {@inheritDoc Element.doubleClick} */
  async doubleClick(options?: ElementActionOptions): Promise<Element> {
    await this.ensureAttached(options?.timeout);
    await this.locator.dblclick({ timeout: options?.timeout });
    return this;
  }

  /** {@inheritDoc Element.rightClick} */
  async rightClick(options?: ElementActionOptions): Promise<Element> {
    await this.ensureAttached(options?.timeout);
    await this.locator.click({ button: 'right', timeout: options?.timeout });
    return this;
  }

  /** {@inheritDoc Element.scrollIntoView} */
  async scrollIntoView(options?: ScrollIntoViewOptions): Promise<Element> {
    // Playwright's native `scrollIntoViewIfNeeded` handles any direction
    // transparently — the browser scrolls the nearest scrollable
    // ancestor by whatever distance is needed. The `direction` option
    // is accepted for API symmetry with {@link PlatformElement.scrollIntoView}
    // but doesn't affect the Playwright path.
    await this.ensureAttached(options?.timeout);
    await this.locator.scrollIntoViewIfNeeded({ timeout: options?.timeout });
    return this;
  }

  /** {@inheritDoc Element.swipe} */
  async swipe(direction: SwipeDirection, options?: SwipeOptions): Promise<Element> {
    await this.ensureAttached(options?.timeout);
    const box = await this.locator.boundingBox();
    if (!box) throw new Error('swipe: element has no bounding box (not rendered)');
    const page = this.locator.page();
    const viewport = page.viewportSize();
    const cx = Math.round(box.x + box.width / 2);
    const cy = Math.round(box.y + box.height / 2);
    const horizontal = direction === 'left' || direction === 'right';
    const defaultDistance = horizontal
      ? Math.round((viewport?.width ?? 1024) * 0.5)
      : Math.round((viewport?.height ?? 768) * 0.5);
    const distance = options?.distance ?? defaultDistance;
    const sign = (direction === 'left' || direction === 'up') ? -1 : 1;
    const toX = horizontal ? cx + distance * sign : cx;
    const toY = horizontal ? cy : cy + distance * sign;
    // Playwright's mouse API emulates a single-pointer drag. On touch
    // contexts (hasTouch viewports) the browser treats this as a swipe;
    // on desktop it's a held-drag. Works for both because the browser's
    // scroll containers respond to drag events equivalently.
    await page.mouse.move(cx, cy);
    await page.mouse.down();
    await page.mouse.move(toX, toY, { steps: 10 });
    await page.mouse.up();
    return this;
  }

  /** {@inheritDoc Element.pressSequentially} */
  async pressSequentially(text: string, delay?: number, options?: ElementActionOptions): Promise<Element> {
    await this.ensureAttached(options?.timeout);
    await this.locator.pressSequentially(text, { delay, timeout: options?.timeout });
    return this;
  }

  /** {@inheritDoc Element.setInputFiles} */
  async setInputFiles(filePath: string, options?: ElementActionOptions): Promise<Element> {
    await this.ensureAttached(options?.timeout);
    await this.locator.setInputFiles(filePath, { timeout: options?.timeout });
    return this;
  }

  /** {@inheritDoc Element.dispatchEvent} */
  async dispatchEvent(event: string): Promise<Element> {
    await this.ensureAttached();
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

  /** {@inheritDoc Element.exists} */
  async exists(): Promise<boolean> {
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
    await this.ensureAttached(options?.timeout);
    const targetLocator = (target as WebElement).locator;
    await targetLocator.waitFor({ state: 'attached', timeout: options?.timeout });
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
    await this.ensureAttached(options?.timeout);
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
