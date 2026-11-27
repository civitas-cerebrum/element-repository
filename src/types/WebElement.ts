import { Locator } from '@playwright/test';
import {
  Element, ElementType, ElementActionOptions, ClickOptions, ScrollIntoViewOptions, SwipeDirection, SwipeOptions,
  LongPressOptions, TapOffset, TapAtOptions, PinchOptions, ZoomOptions,
} from './Element';
import { ElementChain } from './ElementChain';
import { PlatformNotSupportedError } from './errors';
import { checkLongPressDuration, checkMaxSwipes, checkTapOffset } from '../utils/gestureChecks';
import { raceAbort, relabelAbort, throwIfAborted } from '../utils/abort';

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

  /**
   * The signal of the lookup that built this element for its own use (see
   * `utils/lookupSignal`): the reads a lookup makes check it, and the
   * auto-waiting ones are raced against it. Never set on an element handed
   * to the caller. Inherited by derived elements.
   */
  private lookupSignal?: AbortSignal;

  /** A new element on `locator`, keeping this element's timeout and lookup signal. */
  private derive(locator: Locator, selector: string | undefined = this.selector): WebElement {
    const el = new WebElement(locator, selector, this.defaultTimeout);
    if (this.lookupSignal) el.lookupSignal = this.lookupSignal;
    return el;
  }

  /** How abort errors name this element: `"<selector>"`, else the locator. */
  private describe(): string {
    return `"${this.selector ?? String(this.locator)}"`;
  }

  /**
   * `run()` under the lookup signal, if any: checked before; an
   * auto-waiting Playwright call (`race`) is raced against it, a quick one
   * is checked again after (its result dropped on an abort).
   */
  private async underLookup<T>(run: () => Promise<T>, race: boolean): Promise<T> {
    const signal = this.lookupSignal;
    if (!signal) return run();
    throwIfAborted(signal);
    if (race) return raceAbort(run(), signal);
    const result = await run();
    throwIfAborted(signal);
    return result;
  }

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

  /**
   * {@inheritDoc Element.click}
   *
   * Web: with `withoutScrolling`, dispatches a DOM `click` event instead of
   * Playwright's scrolling, actionability-checked click.
   */
  async click(options?: ClickOptions): Promise<Element> {
    await this.ensureAttached(options?.timeout);
    if (options?.withoutScrolling) await this.locator.dispatchEvent('click', undefined, { timeout: options?.timeout });
    else await this.locator.click({ timeout: options?.timeout });
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
    // but doesn't affect the Playwright path; nor do `container`, which is
    // ignored, and `maxSwipes`, which is only validated. Without a timeout the element's default applies,
    // as it did when an action chain passed its timeout down.
    checkMaxSwipes(options?.maxSwipes);
    const timeout = options?.timeout ?? this.defaultTimeout;
    await this.ensureAttached(timeout);
    await this.locator.scrollIntoViewIfNeeded({ timeout });
    return this;
  }

  /**
   * {@inheritDoc Element.swipe}
   *
   * Web: waits for the element to be visible first, since the mouse drag
   * starts at its centre.
   */
  async swipe(direction: SwipeDirection, options?: SwipeOptions): Promise<Element> {
    await this.locator.waitFor({ state: 'visible', timeout: options?.timeout });
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

  /**
   * {@inheritDoc Element.longPress}
   *
   * Web: scrolls the element into view, runs Playwright's actionability
   * and hit-target checks by hovering its centre (so an element covered by
   * another one fails instead of the press landing on the cover), then
   * holds the primary button for `duration` ms (rounded to whole ms) and
   * releases.
   */
  async longPress(options?: LongPressOptions): Promise<Element> {
    const duration = checkLongPressDuration(options?.duration);
    const timeout = options?.timeout;
    await this.ensureAttached(timeout);
    await this.locator.scrollIntoViewIfNeeded({ timeout });
    const before = await this.locator.boundingBox({ timeout });
    if (!before) throw new Error('longPress: could not read the element bounds (not rendered)');
    await this.locator.hover({ timeout, position: { x: before.width / 2, y: before.height / 2 } });
    // Re-read after hover: actionability may have scrolled the page.
    const box = await this.locator.boundingBox({ timeout });
    if (!box) throw new Error('longPress: could not read the element bounds (not rendered)');
    const page = this.locator.page();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    try {
      await page.waitForTimeout(duration);
    } finally {
      await page.mouse.up();
    }
    return this;
  }

  /**
   * {@inheritDoc Element.tapAt}
   *
   * Web: clicks at `offset` via Playwright's `click({ position })`, after
   * checking the offset lies within the element's bounding box.
   */
  async tapAt(offset: TapOffset, options?: TapAtOptions): Promise<Element> {
    await this.ensureAttached(options?.timeout);
    const box = await this.locator.boundingBox({ timeout: options?.timeout });
    if (!box) throw new Error('tapAt: could not read the element bounds (not rendered)');
    checkTapOffset(offset, box.width, box.height);
    await this.locator.click({ position: { x: offset.x, y: offset.y }, timeout: options?.timeout });
    return this;
  }

  /** Not supported on web: throws {@link PlatformNotSupportedError}. */
  async pinch(_options?: PinchOptions): Promise<Element> {
    throw new PlatformNotSupportedError('pinch', 'web');
  }

  /** Not supported on web: throws {@link PlatformNotSupportedError}. */
  async zoom(_options?: ZoomOptions): Promise<Element> {
    throw new PlatformNotSupportedError('zoom', 'web');
  }

  /** {@inheritDoc Element.pressSequentially} */
  async pressSequentially(text: string, delay?: number, options?: ElementActionOptions): Promise<Element> {
    await this.ensureAttached(options?.timeout);
    await this.locator.pressSequentially(text, { delay, timeout: options?.timeout });
    return this;
  }

  /** {@inheritDoc Element.setInputFiles} */
  async setInputFiles(filePath: string | string[], options?: ElementActionOptions): Promise<Element> {
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

  /**
   * Simulates dropping one or more files onto this element by dispatching
   * `dragenter`, `dragover`, and `drop` events carrying a `DataTransfer`
   * object populated with synthetic `File` entries.
   *
   * Web-only — not part of the cross-platform `Element` interface.
   *
   * @param filenames - File name(s) to include in the DataTransfer (basename only;
   *                    no real file content is read — the drop zone receives the
   *                    name and type via `event.dataTransfer.files`).
   * @param options   - Optional `mimeType` (default `'application/octet-stream'`)
   *                    and `timeout` for the pre-drop attachment check.
   */
  async dropFiles(
    filenames: string[],
    options?: { mimeType?: string } & ElementActionOptions,
  ): Promise<Element> {
    await this.ensureAttached(options?.timeout);
    const mimeType = options?.mimeType ?? 'application/octet-stream';
    const dataTransfer = await this.locator.page().evaluateHandle(
      ([names, mime]: [string[], string]) => {
        const dt = new DataTransfer();
        for (const name of names) dt.items.add(new File(['x'], name, { type: mime }));
        return dt;
      },
      [filenames, mimeType] as [string[], string],
    );
    await this.locator.dispatchEvent('dragenter', { dataTransfer });
    await this.locator.dispatchEvent('dragover', { dataTransfer });
    await this.locator.dispatchEvent('drop', { dataTransfer });
    return this;
  }

  // ── State ────────────────────────────────────────────────────

  /** {@inheritDoc Element.isVisible} */
  async isVisible(): Promise<boolean> { return this.underLookup(() => this.locator.isVisible(), false); }

  /** {@inheritDoc Element.isEnabled} */
  async isEnabled(): Promise<boolean> { return this.locator.isEnabled(); }

  /** {@inheritDoc Element.isChecked} */
  async isChecked(): Promise<boolean> { return this.locator.isChecked(); }

  // ── Extraction ───────────────────────────────────────────────

  /** {@inheritDoc Element.raw} */
  async raw(): Promise<string | null> { return this.selector ?? this.locator.toString(); }

  /** {@inheritDoc Element.textContent} */
  async textContent(): Promise<string | null> { return this.underLookup(() => this.locator.textContent(), true); }

  /** {@inheritDoc Element.rawText} */
  async rawText(): Promise<string | null> { return this.locator.textContent(); }

  /** {@inheritDoc Element.getAttribute} */
  async getAttribute(name: string): Promise<string | null> {
    return this.underLookup(() => this.locator.getAttribute(name), true);
  }

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
  locateChild(childSelector: string): Element { return this.derive(this.locator.locator(childSelector), childSelector); }

  /** {@inheritDoc Element.count} */
  async count(): Promise<number> { return this.underLookup(() => this.locator.count(), false); }

  /** {@inheritDoc Element.all} */
  async all(): Promise<Element[]> {
    return (await this.underLookup(() => this.locator.all(), false)).map(l => this.derive(l));
  }

  /** {@inheritDoc Element.first} */
  first(): Element { return this.derive(this.locator.first()); }

  /** {@inheritDoc Element.nth} */
  nth(index: number): Element { return this.derive(this.locator.nth(index)); }

  /** {@inheritDoc Element.filter} */
  filter(options: { hasText?: string | RegExp }): Element { return this.derive(this.locator.filter(options)); }

  // ── Waiting ──────────────────────────────────────────────────

  /**
   * {@inheritDoc Element.waitFor}
   *
   * Web: with `signal`, the signal is checked first (an aborted one rejects
   * without calling Playwright), then Playwright's `locator.waitFor` is
   * raced against it: the call rejects as soon as the signal is aborted,
   * while the abandoned wait runs on to its own timeout in the browser.
   */
  async waitFor(options?: { state?: string; timeout?: number; signal?: AbortSignal }): Promise<void> {
    const signal = options?.signal ?? this.lookupSignal;
    const wait = () => this.locator.waitFor({ state: options?.state as any, timeout: options?.timeout });
    if (!signal) {
      await wait();
      return;
    }
    const ctx = { operation: `waitFor on ${this.describe()}` };
    try {
      throwIfAborted(signal, ctx);
      await raceAbort(wait(), signal, ctx);
    } catch (err) {
      throw relabelAbort(err, ctx);
    }
  }
}
