import {
  Element, ElementType, ElementActionOptions, ClickOptions, ScrollIntoViewOptions, SwipeDirection, SwipeOptions,
  LongPressOptions, TapOffset, TapAtOptions, PinchOptions, ZoomOptions,
} from './Element';
import { checkLongPressDuration, checkTapOffset } from '../utils/gestureChecks';
import { ElementChain } from './ElementChain';
import { PlatformNotSupportedError } from './errors';
import { isFatalDriverError } from '../utils/driverErrors';
import type { Platform } from '../enum/Platform';
import { SWIPE_SETTLE_MS, performTouchActions, performTouchSwipe, touchPointers } from '../utils/touch';
import { detectDriverPlatform, readPlatformText } from '../utils/platformText';

/** Extra construction options for {@link PlatformElement}. */
export interface PlatformElementOptions {
  /**
   * Act on this match of the selector, as {@link PlatformElement.nth} does.
   * Zero-based; negative values count from the end (`-1` is the last).
   */
  index?: number;
  /**
   * The platform the element belongs to. It decides platform-specific
   * behaviour (how text is read, how keys are typed) and is named in
   * errors such as {@link PlatformNotSupportedError}. When omitted it is
   * read from the driver's capabilities or WebdriverIO's `isIOS` /
   * `isAndroid` flags.
   */
  platform?: Platform;
}

/** Message of an unknown thrown value, for appending a cause to an error. */
function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * A lookup found no match. Polled through until the deadline, unless
 * `final` says no amount of waiting can produce one (an element made by
 * `nth(k)` on an element that is already a single match). Internal: it
 * never reaches callers (see {@link toPublicError}).
 */
class NoMatchError extends Error {
  constructor(message: string, readonly final = false) {
    super(message);
    this.name = 'NoMatchError';
  }
}

/**
 * `err` as callers see it: an internal {@link NoMatchError} becomes a plain
 * `Error` with the same message (or `message` when given), the original as
 * its `cause`; any other error is returned unchanged.
 */
function toPublicError(err: unknown, message?: string): unknown {
  if (!(err instanceof NoMatchError)) return err;
  return new Error(message ?? err.message, { cause: err });
}

/**
 * WebDriverIO-backed {@link Element} implementation for mobile and desktop platforms.
 *
 * Uses the WebDriverIO `$` / `$$` commands to locate native elements via Appium selectors.
 * Methods that have no native equivalent ({@link setInputFiles}, {@link dispatchEvent})
 * throw {@link PlatformNotSupportedError} naming the element's platform.
 */
export class PlatformElement implements Element {
  readonly _type = ElementType.PLATFORM;

  /** Zero-based match index set by {@link first} / {@link nth}; negative counts from the end. */
  private readonly index?: number;
  /** Platform given at construction, if any (see {@link platformName}). */
  private readonly platform?: Platform;
  /** The element {@link locateChild} was called on; lookups run under its match. */
  private parent?: PlatformElement;
  /**
   * Set by {@link nth} with an index other than 0 / -1 on an element that is
   * already a single match: like Playwright, such an element matches nothing.
   */
  private matchesNothing = false;

  /**
   * @param driver          - The WebDriverIO browser/driver instance.
   * @param selector        - Appium-compatible selector string.
   * @param resolvedElement - Optional already-resolved raw WebDriverIO element
   * (e.g. from `$$`). When set, {@link findOne} returns
   * it directly instead of re-querying the driver.
   * @param defaultTimeout  - Default timeout in ms inherited from the repository.
   * @param options         - `index`: act on that match of `selector` (as
   * {@link nth} does); `platform`: the platform this
   * element belongs to (see {@link PlatformElementOptions.platform}).
   */
  constructor(
    public readonly driver: any,
    public readonly selector: string,
    public readonly resolvedElement?: any,
    private readonly defaultTimeout?: number,
    options?: PlatformElementOptions,
  ) {
    this.index = options?.index;
    this.platform = options?.platform;
  }

  /** {@inheritDoc Element.action} */
  action(timeout?: number): ElementChain {
    return new ElementChain(this, timeout ?? this.defaultTimeout);
  }

  /** Poll interval while waiting for an indexed match to appear, in ms. */
  private static readonly INDEX_POLL_MS = 200;

  /**
   * A new element on the same driver and platform, keeping this element's
   * parent unless `parent` is given.
   */
  private derive(options: { selector?: string; index?: number; parent?: PlatformElement; matchesNothing?: boolean; resolved?: any }): PlatformElement {
    const el = new PlatformElement(
      this.driver, options.selector ?? this.selector, options.resolved, this.defaultTimeout,
      { index: options.index, platform: this.platform },
    );
    el.parent = options.parent ?? this.parent;
    el.matchesNothing = options.matchesNothing ?? false;
    return el;
  }

  /**
   * True when this element has no lazy WebdriverIO element of its own and is
   * looked up by polling `$$`: it picks a match by position (index 0, from
   * {@link first} / `nth(0)`, uses `$`, which already returns the first
   * match and keeps WebdriverIO's own waiting), matches nothing, or is a
   * child made by {@link locateChild} (WebdriverIO's lazy child of a
   * missing parent would wait `waitforTimeout` on every call, so a child is
   * polled against the element's own timeout instead).
   */
  private get polled(): boolean {
    if (this.resolvedElement) return false;
    return this.matchesNothing || (this.index !== undefined && this.index !== 0) || !!this.parent;
  }

  /**
   * Where this element's selector is searched: the parent's match, else the
   * driver. A missing parent match throws a {@link NoMatchError} at once:
   * `$` / `$$` on WebdriverIO's lazy element for a missing parent would wait
   * `waitforTimeout` and then throw WebdriverIO's own error.
   */
  private async searchContext(): Promise<any> {
    if (!this.parent) return this.driver;
    const parent = await this.parent.findOne();
    if (!parent?.elementId) throw new NoMatchError(`parent ${this.parent.describe()} not found`);
    return parent;
  }

  /**
   * Returns the underlying raw element.
   * If a {@link resolvedElement} was provided (e.g. from {@link all}), it is
   * returned directly; a polled element (see {@link polled}) picks its match
   * from `$$` now (throwing when there is none); otherwise `$` is queried
   * on the driver, or on the parent's match for a child.
   */
  private async findOne(): Promise<any> {
    if (this.resolvedElement) return this.resolvedElement;
    if (this.polled) return this.resolveNow();
    // WebdriverIO's `$` is strict by default and throws when the selector
    // matches more than once; this element means "the first match", so opt
    // out.
    return (await this.searchContext()).$(this.selector, { strict: false });
  }

  /** How errors name this element: `nth(i) of "<selector>"`, plus its parent. */
  private describe(): string {
    const own = this.index === undefined ? `"${this.selector}"` : `nth(${this.index}) of "${this.selector}"`;
    return this.parent ? `${own} inside ${this.parent.describe()}` : own;
  }

  /**
   * Picks this element's match from `$$` now (index 0 when unindexed), or
   * throws a {@link NoMatchError} naming the index and the matches found.
   */
  private async resolveNow(): Promise<any> {
    if (this.matchesNothing) {
      throw new NoMatchError(
        `nth(${this.index}): "${this.selector}" is already a single match, so this index matches nothing`, true,
      );
    }
    const raws = await this.queryAll();
    const index = this.index ?? 0;
    const i = index < 0 ? raws.length + index : index;
    if (i >= 0 && i < raws.length) return raws[i];
    if (this.index === undefined) throw new NoMatchError(`no element matches ${this.describe()}`);
    throw new NoMatchError(`nth(${index}): no element at that index for "${this.selector}" (found ${raws.length})`);
  }

  /** All matches of the selector (under the parent's match for a child), as a plain array. */
  private async queryAll(): Promise<any[]> {
    return Array.from((await (await this.searchContext()).$$(this.selector)) ?? []);
  }

  /**
   * Locates all matching elements using `$$`. An element made by
   * {@link first} / {@link nth} yields at most its own match; a child of a
   * missing parent match yields none.
   */
  private async findAll(): Promise<any[]> {
    if (this.matchesNothing) return [];
    if (this.resolvedElement || this.index === undefined) {
      try { return await this.queryAll(); }
      catch (err) { if (err instanceof NoMatchError) return []; throw err; }
    }
    try { return [await this.resolveNow()]; }
    catch (err) { if (isFatalDriverError(err)) throw err; return []; }
  }

  /**
   * Polls `check` until it returns true or `timeout` ms pass. On timeout,
   * throws the last error `check` raised, or `onTimeout()`. A fatal driver
   * error (see `isFatalDriverError`, shared with the repository's strategy
   * resolver) or a final {@link NoMatchError} is rethrown at once. A
   * {@link NoMatchError} leaves as a plain `Error` (see {@link toPublicError}).
   */
  private async pollUntil(check: () => Promise<boolean>, timeout: number, onTimeout: () => Error): Promise<void> {
    const deadline = Date.now() + timeout;
    let lastError: unknown;
    for (;;) {
      try {
        if (await check()) return;
        lastError = undefined;
      } catch (err) {
        if (isFatalDriverError(err) || (err instanceof NoMatchError && err.final)) throw toPublicError(err);
        lastError = err;
      }
      const remaining = deadline - Date.now();
      if (remaining <= 0) break;
      await new Promise(resolve => setTimeout(resolve, Math.min(PlatformElement.INDEX_POLL_MS, remaining)));
    }
    throw toPublicError(lastError instanceof Error ? lastError : onTimeout());
  }

  /**
   * The platform this element runs on: the constructor's `platform`, else
   * the driver's `platformName` capability, else WebdriverIO's `isIOS` /
   * `isAndroid` flags; `undefined` when none of those tells. Every
   * platform-specific decision of this element uses this one answer.
   */
  private resolvePlatform(): Platform | undefined {
    return this.platform ?? detectDriverPlatform(this.driver);
  }

  /**
   * The platform named in error messages: {@link resolvePlatform}, else the
   * selector's prefix (`-ios ...`). When nothing tells, it says
   * `'android'`; that is a guess used only for the message text (the
   * operations that raise it are unsupported on every Appium platform) and
   * never for behaviour. Elements built by the repository always carry the
   * page platform, so the guess only applies to elements constructed
   * directly without one, on a driver that reports no platform.
   */
  private platformName(): Platform {
    const known = this.resolvePlatform();
    if (known) return known;
    if (this.selector.startsWith('-ios')) return 'ios';
    return 'android';
  }

  // ── Interaction ──────────────────────────────────────────────

  /**
   * Waits for the underlying Appium element to exist before any action fires.
   * Gives each action a predictable presence-detection preamble so failures
   * surface as "element never attached" rather than an opaque driver error.
   * With `method` (a gesture), a polled element that never appears fails
   * with `<method>: <element> not found within N ms: <reason>`.
   */
  private async ensureAttached(timeout?: number, method?: string): Promise<any> {
    if (this.polled) {
      // No lazy WebdriverIO element exists for "the i-th match" or a child:
      // poll `$$` until it is there, and fail with the not-found error otherwise.
      const ms = timeout ?? this.defaultTimeout ?? 30000;
      let el: any;
      try {
        await this.pollUntil(
          async () => { el = await this.resolveNow(); return true; },
          ms,
          () => new NoMatchError(`${this.describe()}: no matching element`),
        );
      } catch (err) {
        const notFound = err instanceof NoMatchError || (err as { cause?: unknown })?.cause instanceof NoMatchError;
        if (method && notFound) {
          throw new Error(`${method}: ${this.describe()} not found within ${ms} ms: ${errorText(err)}`, { cause: err });
        }
        throw toPublicError(err);
      }
      return el;
    }
    const el = await this.findOne();
    try { await el.waitForExist({ timeout: timeout ?? this.defaultTimeout ?? 30000 }); }
    catch { /* swallow — downstream action call will surface a clearer error */ }
    return el;
  }

  /**
   * {@inheritDoc Element.click}
   *
   * Platform: always the plain WebDriver element click, which never
   * scrolls; `withoutScrolling` changes nothing.
   */
  async click(options?: ClickOptions): Promise<Element> {
    const el = await this.ensureAttached(options?.timeout);
    await el.click();
    return this;
  }

  async fill(text: string, options?: ElementActionOptions): Promise<Element> {
    const el = await this.ensureAttached(options?.timeout);
    await el.clearValue();
    await el.setValue(text);
    return this;
  }

  async clear(options?: ElementActionOptions): Promise<Element> {
    const el = await this.ensureAttached(options?.timeout);
    await el.clearValue();
    return this;
  }

  async check(options?: ElementActionOptions): Promise<Element> {
    const el = await this.ensureAttached(options?.timeout);
    if (!(await el.isSelected())) await el.click();
    return this;
  }

  async uncheck(options?: ElementActionOptions): Promise<Element> {
    const el = await this.ensureAttached(options?.timeout);
    if (await el.isSelected()) await el.click();
    return this;
  }

  async hover(options?: ElementActionOptions): Promise<Element> {
    const el = await this.ensureAttached(options?.timeout);
    await el.moveTo();
    return this;
  }

  async doubleClick(options?: ElementActionOptions): Promise<Element> {
    const el = await this.ensureAttached(options?.timeout);
    await el.doubleClick();
    return this;
  }

  async scrollIntoView(options?: ScrollIntoViewOptions): Promise<Element> {
    // Deliberately skip `ensureAttached` here — the whole point of
    // scrollIntoView is to handle the "not in the viewport (and maybe
    // not in the a11y tree) yet" case. On virtualised lists
    // (RecyclerView / UITableView / LazyColumn / SwiftUI List),
    // off-window items only exist in the tree after they've been
    // recycled in. Waiting up to defaultTimeout for attach here would
    // burn 30s on the happy scroll-and-find path before a single
    // swipe runs. Instead, every check (the fast path and each swipe)
    // looks the element up again and asks isDisplayed(): rows loaded by a
    // swipe only show up in a fresh query, and an indexed match that does
    // not exist yet is simply "not shown yet" rather than an error.
    const started = Date.now();
    if (this.matchesNothing) await this.resolveNow().catch(err => { throw toPublicError(err); }); // can never match
    const shownNow = async (): Promise<boolean> => {
      try { return !!(await (await this.findOne()).isDisplayed()); }
      catch (err) { if (isFatalDriverError(err)) throw err; return false; }
    };
    // Fast path — already on-screen.
    if (await shownNow()) return this;

    // Best-effort keyboard dismiss cascade. See earlier history — the
    // swipe gesture starts near y=75% which is inside the soft keyboard
    // on forms; dismiss first so touches reach the content underneath.
    // Bare `hideKeyboard()` → `mobile: hideKeyboard {pressKey, return}`
    // → `mobile: hideKeyboard {tapOutside}`, stopping at the first that
    // actually dismisses. No-op if the driver doesn't expose the APIs
    // (web) or if all strategies fail (swipe proceeds anyway).
    try {
      const drv = this.driver as {
        isKeyboardShown?: () => Promise<boolean>;
        hideKeyboard?: () => Promise<void>;
        execute?: (script: string, args: Record<string, unknown>) => Promise<unknown>;
      };
      if (typeof drv.isKeyboardShown === 'function' && await drv.isKeyboardShown()) {
        const strategies: Array<() => Promise<void>> = [
          async () => { if (drv.hideKeyboard) await drv.hideKeyboard(); },
          async () => { if (drv.execute) await drv.execute('mobile: hideKeyboard', { strategy: 'pressKey', key: 'return' }); },
          async () => { if (drv.execute) await drv.execute('mobile: hideKeyboard', { strategy: 'tapOutside' }); },
        ];
        for (const attempt of strategies) {
          await attempt().catch(() => { /* try next */ });
          await this.driver.pause(300);
          const stillShown = await drv.isKeyboardShown!().catch(() => false);
          if (!stillShown) break;
        }
      }
    } catch { /* no-op — proceed to swipe regardless */ }

    const windowSize = await this.driver.getWindowSize();
    const cx = Math.round(windowSize.width / 2);
    const cy = Math.round(windowSize.height / 2);
    // 25% → 75% covers 50% of viewport per swipe. Wider (e.g. 15%/85%)
    // starts inside platform system-gesture zones; narrower reduces
    // per-swipe travel.
    const yNear = Math.round(windowSize.height * 0.25);
    const yFar = Math.round(windowSize.height * 0.75);
    const xNear = Math.round(windowSize.width * 0.25);
    const xFar = Math.round(windowSize.width * 0.75);
    const maxSwipesPerDirection = 20;
    // Only an explicit timeout bounds the sweep; without one, the swipe cap does.
    const deadline = options?.timeout === undefined ? undefined : started + options.timeout;

    const swipeXY = async (fromX: number, fromY: number, toX: number, toY: number): Promise<void> => {
      await performTouchSwipe(this.driver, { x: fromX, y: fromY }, { x: toX, y: toY });
      await this.driver.pause(SWIPE_SETTLE_MS);
    };

    const direction = options?.direction ?? 'down';

    // Direction → swipe geometry:
    //   'down'  — swipe up (yFar→yNear) reveals content BELOW
    //   'up'    — swipe down (yNear→yFar) reveals content ABOVE
    //   'right' — swipe left (xFar→xNear) reveals content to the RIGHT
    //   'left'  — swipe right (xNear→xFar) reveals content to the LEFT
    const [fromX, fromY, toX, toY] = (() => {
      switch (direction) {
        case 'up':    return [cx, yNear, cx, yFar];
        case 'left':  return [xNear, cy, xFar, cy];
        case 'right': return [xFar, cy, xNear, cy];
        case 'down':  default: return [cx, yFar, cx, yNear];
      }
    })();

    for (let i = 0; i < maxSwipesPerDirection; i++) {
      if (deadline !== undefined && Date.now() >= deadline) {
        throw new Error(
          `scrollIntoView: element not visible within the ${options!.timeout} ms timeout ` +
          `(${i} of at most ${maxSwipesPerDirection} swipes made, direction=${direction})`,
        );
      }
      await swipeXY(fromX, fromY, toX, toY);
      if (await shownNow()) return this;
    }

    throw new Error(
      `scrollIntoView: element not visible after ${maxSwipesPerDirection} swipes, the swipe limit (direction=${direction})`,
    );
  }

  /**
   * Swipes from the element centre. Coordinates are native-context
   * viewport coordinates (the same space as `getElementRect` and
   * `getWindowSize`). The start point must be inside the window, or this
   * throws (`call scrollIntoView first`). The end point is clamped to the
   * window (`[0, width-1]` x `[0, height-1]`), so the swipe may travel less
   * than `distance` near an edge; when the start point is on the edge the
   * swipe moves toward, so the finger could not move at all, this throws
   * (`nothing to swipe`) instead of sending a press.
   */
  async swipe(direction: SwipeDirection, options?: SwipeOptions): Promise<Element> {
    const el = await this.ensureAttached(options?.timeout);
    const rect = await this.readRect(el).catch(() => null);
    const windowSize = await this.driver.getWindowSize();
    // Origin: element center when the element has a rect; fall back to
    // viewport center so a missing rect (iOS XCUITest returns null for
    // some off-screen elements) still lets the gesture dispatch.
    const cx = rect ? Math.round(rect.x + rect.width / 2) : Math.round(windowSize.width / 2);
    const cy = rect ? Math.round(rect.y + rect.height / 2) : Math.round(windowSize.height / 2);
    // Default distance: ~50% of viewport dim in the relevant axis.
    const horizontal = direction === 'left' || direction === 'right';
    const defaultDistance = horizontal
      ? Math.round(windowSize.width * 0.5)
      : Math.round(windowSize.height * 0.5);
    const distance = options?.distance ?? defaultDistance;
    const sign = (direction === 'left' || direction === 'up') ? -1 : 1;
    // An off-window start (XCUITest reports rects for off-screen elements)
    // would make the clamped end point reverse the swipe; reject it.
    if (!(cx >= 0 && cx < windowSize.width && cy >= 0 && cy < windowSize.height)) {
      throw new Error(
        `swipe: element centre (${cx}, ${cy}) is outside the window (${windowSize.width}x${windowSize.height}); ` +
        'call scrollIntoView first',
      );
    }
    // The end point is clamped to the window (the start point is not
    // moved), so a long swipe stops at the edge instead of sending
    // negative or off-window coordinates.
    const toX = horizontal ? PlatformElement.clampToAxis(cx + distance * sign, windowSize.width) : cx;
    const toY = horizontal ? cy : PlatformElement.clampToAxis(cy + distance * sign, windowSize.height);
    // A start on the edge the swipe moves toward leaves the finger in place:
    // that is a long press, not a swipe. Only the clamp is checked here; a
    // `distance` that itself rounds to no movement is sent as given.
    const from = horizontal ? cx : cy;
    const moved = ((horizontal ? toX : toY) - from) * sign > 0;
    const wanted = (Math.round(from + distance * sign) - from) * sign > 0;
    if (!moved && wanted) {
      throw new Error(
        `swipe: the start point (${cx}, ${cy}) is at the window edge (${windowSize.width}x${windowSize.height}) ` +
        `for a '${direction}' swipe; nothing to swipe`,
      );
    }
    await performTouchSwipe(this.driver, { x: cx, y: cy }, { x: toX, y: toY });
    await this.driver.pause(SWIPE_SETTLE_MS);
    return this;
  }

  /** Rounds `value` and clamps it to `[0, size - 1]` (one window axis). */
  private static clampToAxis(value: number, size: number): number {
    return Math.min(Math.max(Math.round(value), 0), size - 1);
  }

  // ── Touch gestures (W3C actions) ─────────────────────────────

  /**
   * Reads a raw element's rect with the W3C protocol command
   * `getElementRect(elementId)` (WebdriverIO elements have no `getRect()`).
   * Coordinates are native-context viewport coordinates.
   */
  private async readRect(el: any): Promise<{ x: number; y: number; width: number; height: number } | null> {
    return (await this.driver.getElementRect(el?.elementId)) ?? null;
  }

  /**
   * Reads the element's rect for a gesture, throwing a clear error when the
   * driver has none (unlike swipe, a gesture aimed at the element must not
   * silently land somewhere else). The driver's error, if any, is appended.
   */
  private async gestureRect(method: string, timeout?: number): Promise<{ x: number; y: number; width: number; height: number }> {
    let el = await this.ensureAttached(timeout, method);
    // WebdriverIO resolves a missing element to an object without an
    // `elementId` and does not fill it in when the element appears later;
    // look it up once more, and report "not found" rather than sending the
    // rect command a missing id.
    if (!el?.elementId && !this.resolvedElement) el = await this.findOne().catch(() => null);
    if (!el?.elementId) {
      throw new Error(`${method}: element "${this.selector}" not found within ${timeout ?? this.defaultTimeout ?? 30000} ms`);
    }
    let rect: { x: number; y: number; width: number; height: number } | null;
    try {
      rect = await this.readRect(el);
    } catch (err) {
      throw new Error(`${method}: could not read the element bounds for "${this.selector}": ${errorText(err)}`);
    }
    if (!rect || ![rect.x, rect.y, rect.width, rect.height].every(Number.isFinite)) {
      throw new Error(`${method}: could not read the element bounds for "${this.selector}": the driver returned no rect`);
    }
    return rect;
  }

  /**
   * Throws unless the point lies inside the window (`0 <= x < width`,
   * `0 <= y < height`). A gesture aimed off-screen would land on whatever
   * the driver clips it to, or fail with an opaque driver error.
   */
  private static assertInWindow(method: string, x: number, y: number, win: { width: number; height: number }): void {
    if (!(x >= 0 && x < win.width && y >= 0 && y < win.height)) {
      throw new Error(
        `${method}: element is outside the window (point (${x}, ${y}) is not inside ${win.width}x${win.height}); ` +
        'call scrollIntoView first',
      );
    }
  }

  /**
   * Sends one W3C touch pointer per finger with `performActions` and always
   * releases them (see {@link performTouchActions}).
   */
  private async performTouch(fingers: Array<Array<Record<string, unknown>>>): Promise<void> {
    await performTouchActions(this.driver, touchPointers(fingers));
  }

  /** {@inheritDoc Element.longPress} */
  async longPress(options?: LongPressOptions): Promise<Element> {
    const duration = checkLongPressDuration(options?.duration);
    const rect = await this.gestureRect('longPress', options?.timeout);
    const x = Math.round(rect.x + rect.width / 2);
    const y = Math.round(rect.y + rect.height / 2);
    PlatformElement.assertInWindow('longPress', x, y, await this.driver.getWindowSize());
    await this.performTouch([[
      { type: 'pointerMove', duration: 0, origin: 'viewport', x, y },
      { type: 'pointerDown', button: 0 },
      { type: 'pause', duration },
      { type: 'pointerUp', button: 0 },
    ]]);
    return this;
  }

  /** {@inheritDoc Element.tapAt} */
  async tapAt(offset: TapOffset, options?: TapAtOptions): Promise<Element> {
    const rect = await this.gestureRect('tapAt', options?.timeout);
    checkTapOffset(offset, rect.width, rect.height);
    const x = Math.round(rect.x + offset.x);
    const y = Math.round(rect.y + offset.y);
    PlatformElement.assertInWindow('tapAt', x, y, await this.driver.getWindowSize());
    await this.performTouch([[
      { type: 'pointerMove', duration: 0, origin: 'viewport', x, y },
      { type: 'pointerDown', button: 0 },
      { type: 'pause', duration: PlatformElement.TAP_HOLD_MS },
      { type: 'pointerUp', button: 0 },
    ]]);
    return this;
  }

  /** {@inheritDoc Element.pinch} */
  async pinch(options?: PinchOptions): Promise<Element> {
    const scale = options?.scale ?? 0.5;
    if (!Number.isFinite(scale) || scale <= 0 || scale >= 1) {
      throw new Error(`pinch: scale must be a finite number between 0 and 1 (exclusive), got ${options?.scale}`);
    }
    await this.twoFingerGesture('pinch', scale, options?.timeout);
    return this;
  }

  /** {@inheritDoc Element.zoom} */
  async zoom(options?: ZoomOptions): Promise<Element> {
    const scale = options?.scale ?? 2;
    if (!Number.isFinite(scale) || scale <= 1) {
      throw new Error(`zoom: scale must be a finite number greater than 1, got ${options?.scale}`);
    }
    await this.twoFingerGesture('zoom', scale, options?.timeout);
    return this;
  }

  /** Hold time between down and up for a tap, in ms. */
  private static readonly TAP_HOLD_MS = 50;
  /** Duration of the finger travel in a pinch / zoom, in ms. */
  private static readonly TWO_FINGER_MOVE_MS = 500;
  /** Smallest distance from the centre to either finger, in px. */
  private static readonly MIN_HALF_GAP = 10;
  /** Hold after both fingers touch down, before they move, in ms. */
  private static readonly TWO_FINGER_SETTLE_MS = 100;

  /**
   * Two touch pointers on the horizontal axis through the element centre,
   * in native-context viewport coordinates.
   *
   * The wider half-gap is 40% of the element width; the narrower one is
   * that times `scale` (pinch) or divided by it (zoom), never below
   * {@link MIN_HALF_GAP}. Because of that minimum, a small element or a
   * large zoom scale can put the outer finger positions past the element.
   *
   * The element centre must be inside the window. Only the outer finger
   * positions (pinch start, zoom end) are clamped to the window; when an
   * inner position is off-window, or clamping would leave a finger without
   * movement, the gesture throws instead of silently degrading.
   */
  private async twoFingerGesture(method: 'pinch' | 'zoom', scale: number, timeout?: number): Promise<void> {
    const rect = await this.gestureRect(method, timeout);
    const windowSize = await this.driver.getWindowSize();
    const cx = rect.x + rect.width / 2;
    const y = Math.round(rect.y + rect.height / 2);
    PlatformElement.assertInWindow(method, Math.round(cx), y, windowSize);
    const wide = Math.round(rect.width * 0.4);
    const min = PlatformElement.MIN_HALF_GAP;

    let startGap: number;
    let endGap: number;
    if (method === 'zoom') {
      startGap = Math.max(min, Math.round(wide / scale));
      endGap = Math.round(startGap * scale);
    } else {
      endGap = Math.round(wide * scale);
      startGap = wide;
      if (endGap < min) { endGap = min; startGap = Math.round(min / scale); }
    }
    const innerGap = method === 'zoom' ? startGap : endGap;
    const outerGap = method === 'zoom' ? endGap : startGap;

    const tooClose = () => new Error(
      `${method}: the element centre (${Math.round(cx)}, ${y}) is too close to the window edge ` +
      `(${windowSize.width}x${windowSize.height}) for a two-finger gesture; scroll it further into view or use a scale closer to 1`,
    );
    const fingerPath = (sign: -1 | 1) => {
      const inner = Math.round(cx + sign * innerGap);
      if (inner < 0 || inner >= windowSize.width) throw tooClose();
      const outer = PlatformElement.clampToAxis(cx + sign * outerGap, windowSize.width);
      if ((outer - inner) * sign <= 0) throw tooClose();
      const [from, to] = method === 'zoom' ? [inner, outer] : [outer, inner];
      return [
        { type: 'pointerMove', duration: 0, origin: 'viewport', x: from, y },
        { type: 'pointerDown', button: 0 },
        { type: 'pause', duration: PlatformElement.TWO_FINGER_SETTLE_MS },
        { type: 'pointerMove', duration: PlatformElement.TWO_FINGER_MOVE_MS, origin: 'viewport', x: to, y },
        { type: 'pointerUp', button: 0 },
      ];
    };
    await this.performTouch([fingerPath(-1), fingerPath(1)]);
  }

  async pressSequentially(text: string, delay: number = 50, options?: ElementActionOptions): Promise<Element> {
    const el = await this.ensureAttached(options?.timeout);
    if (this.isAndroid()) {
      // Android UiAutomator2: per-char `el.addValue(char)` reliably drops
      // leading characters because each call re-seeds the IME compose buffer
      // and TextWatchers reset the selection. Focus the element, then send
      // keys through the system IME via `driver.keys()` — that path
      // appends cleanly.
      try { await el.click(); } catch { /* element may already be focused */ }
      for (const char of text) {
        await this.driver.keys(char);
        if (delay > 0) await this.driver.pause(delay);
      }
      return this;
    }
    for (const char of text) {
      await el.addValue(char);
      if (delay > 0) await this.driver.pause(delay);
    }
    return this;
  }

  async setInputFiles(_filePath: string | string[], _options?: ElementActionOptions): Promise<Element> {
    throw new PlatformNotSupportedError('setInputFiles', this.platformName());
  }

  async dispatchEvent(_event: string): Promise<Element> {
    throw new PlatformNotSupportedError('dispatchEvent', this.platformName());
  }

  // ── State ────────────────────────────────────────────────────

  /**
   * The raw element a read acts on. The default path returns WebdriverIO's
   * lazy element, whose commands wait (implicit wait); a polled element
   * (see {@link polled}) has no lazy element, so it polls `$$` for its
   * match up to the element's default timeout, as an action does.
   */
  private async readTarget(): Promise<any> {
    return this.polled ? this.ensureAttached() : this.findOne();
  }

  async isVisible(): Promise<boolean> {
    if (this.polled) {
      // Like Playwright, a missing match is simply not visible.
      try { return await (await this.resolveNow()).isDisplayed(); }
      catch (err) { if (isFatalDriverError(err)) throw err; return false; }
    }
    return (await this.findOne()).isDisplayed();
  }
  async isEnabled(): Promise<boolean> { return (await this.readTarget()).isEnabled(); }
  async isChecked(): Promise<boolean> { return (await this.readTarget()).isSelected(); }

  // ── Extraction ───────────────────────────────────────────────

  async raw(): Promise<string | null> { return this.selector; }

  /** {@inheritDoc Element.textContent} */
  async textContent(): Promise<string | null> {
    return (await this.rawText())?.trim() ?? null;
  }

  /** {@inheritDoc Element.rawText} */
  async rawText(): Promise<string | null> {
    return readPlatformText(await this.readTarget(), this.resolvePlatform());
  }

  async getAttribute(name: string): Promise<string | null> {
    return (await this.readTarget()).getAttribute(name);
  }

  async inputValue(): Promise<string> {
    const el = await this.readTarget();
    if (this.isAndroid()) {
      // UiAutomator2 doesn't expose a `value` attribute — `text` is the
      // equivalent. When the EditText is empty, `text` returns the hint
      // string (UiAutomator2's `showing-hint` / `showingHintText` attribute
      // names are listed as supported but `getAttribute` on them returns
      // "unknown attribute" on uiautomator2 6.7.8 — a driver bug). Detect
      // the empty-field case by comparing `text` to `hint`: when they
      // match, the field is empty and the hint is being rendered as text.
      const [text, hint] = await Promise.all([
        el.getAttribute('text').catch(() => null),
        el.getAttribute('hint').catch(() => null),
      ]);
      if (text && hint && text === hint) return '';
      return text ?? '';
    }
    // XCUITest reports the placeholder as the element value when the
    // UITextField is empty. Always fetch placeholder + value in parallel
    // so we can normalize an empty field to '' no matter which path
    // (`getValue()` or `getAttribute('value')`) produced the raw value.
    const [rawValue, placeholder] = await Promise.all([
      (async () => { try { return await el.getValue(); } catch { return (await el.getAttribute('value')) ?? ''; } })(),
      el.getAttribute('placeholderValue').catch(() => null),
    ]);
    if (placeholder !== null && rawValue === placeholder) return '';
    return rawValue ?? '';
  }

  /** True when this element runs on Android (UiAutomator2); see {@link resolvePlatform}. */
  private isAndroid(): boolean {
    return this.resolvePlatform() === 'android';
  }

  /**
   * Reads a computed CSS value via the driver's CSS accessor. Works in
   * hybrid web contexts; throws on pure native contexts where there's no CSS.
   */
  async getCssProperty(property: string): Promise<string> {
    const el = await this.readTarget();
    // Protocol command (WebdriverIO elements have no getCSSValue()).
    try { return await this.driver.getElementCSSValue(el?.elementId, property); }
    catch (err) { throw new Error(`getCssProperty("${property}") requires a web or hybrid context: ${errorText(err)}`); }
  }

  /**
   * The element's tag name (on native contexts, the element class such as
   * `XCUIElementTypeButton`). Like the web element, a missing element is an
   * error, not an empty string.
   */
  async getTagName(): Promise<string> {
    return (await this.readTarget()).getTagName();
  }

  async exists(): Promise<boolean> {
    try { return await (await this.findOne()).isExisting(); }
    catch (err) { if (isFatalDriverError(err)) throw err; return false; }
  }

  async dragTo(
    target: Element,
    options?: { timeout?: number; sourcePosition?: { x: number; y: number }; targetPosition?: { x: number; y: number } },
  ): Promise<Element> {
    const src = await this.ensureAttached(options?.timeout);
    const targetPlatform = target as PlatformElement;
    const targetEl = await targetPlatform.ensureAttached(options?.timeout);
    try { await src.dragAndDrop(targetEl); }
    catch { throw new Error('dragTo() failed — the underlying driver may not support drag on this platform'); }
    return this;
  }

  async boundingBox(): Promise<{ x: number; y: number; width: number; height: number } | null> {
    const el = await this.readTarget();
    try {
      const rect = await this.readRect(el);
      if (!rect) return null;
      return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
    } catch (err) {
      throw new Error(`boundingBox() could not read the element rect: ${errorText(err)}`);
    }
  }

  async screenshot(_options?: { path?: string }): Promise<Buffer> {
    const el = await this.readTarget();
    try {
      // Protocol command; it needs the element id as its argument.
      const raw = await this.driver.takeElementScreenshot(el?.elementId);
      return Buffer.from(raw as string, 'base64');
    } catch (err) {
      throw new Error(`screenshot() is not supported on this platform driver: ${errorText(err)}`);
    }
  }

  // ── Querying ─────────────────────────────────────────────────

  /**
   * An element for `selector` searched inside this element's match
   * (WebdriverIO `parent.$(selector)` / `parent.$$(selector)`), honouring
   * this element's index. Lazy: the parent is looked up when the child is
   * used. The child is polled like an indexed element: actions and reads
   * wait up to their timeout for the parent and the child, then fail with a
   * not-found error naming the missing one; a child of a missing parent has
   * `count()` 0 and `isVisible()` / `exists()` false.
   */
  locateChild(selector: string): Element {
    return this.derive({ selector, parent: this });
  }

  /**
   * Number of matches. For an element made by {@link first} / {@link nth}
   * this is 1 when its match exists and 0 otherwise, as in Playwright.
   */
  async count(): Promise<number> { return (await this.findAll()).length; }

  async all(): Promise<Element[]> {
    const elements = await this.findAll();
    return elements.map(el => this.derive({ resolved: el }));
  }

  /** The first match: same as `nth(0)`. */
  first(): Element { return this.nth(0); }

  /**
   * The match at `index` (zero-based; negative counts from the end, so
   * `nth(-1)` is the last). Lazy, like Playwright: the match is looked up
   * with `$$` when an action runs, and actions wait up to their timeout
   * for it to appear before failing with an out-of-range error.
   *
   * On an element that is already a single match (made by `first` / `nth`
   * or resolved from `all()`), `nth(0)`, `nth(-1)` and `first()` return
   * the element itself, and any other index returns an element that, as in
   * Playwright, matches nothing: `count()` is 0, `exists()` and
   * `isVisible()` are false, and actions and reads fail at once with a
   * "matches nothing" error.
   *
   * @throws When `index` is not an integer.
   */
  nth(index: number): Element {
    if (!Number.isInteger(index)) throw new Error(`nth: index must be an integer, got ${index}`);
    if (this.resolvedElement || this.index !== undefined || this.matchesNothing) {
      if (index === 0 || index === -1) return this;
      return this.derive({ index, matchesNothing: true });
    }
    return this.derive({ index });
  }

  /**
   * Text filtering is not available on platform elements (WebdriverIO has
   * no lazy text filter; use the TEXT selection strategy of the repository
   * instead). An empty filter returns this element; any criterion throws
   * {@link PlatformNotSupportedError} naming the platform (see
   * {@link platformName} for how it is determined).
   */
  filter(options: { hasText?: string | RegExp }): Element {
    const criteria = Object.values(options ?? {}).filter(v => v !== undefined);
    if (criteria.length === 0) return this;
    throw new PlatformNotSupportedError('filter', this.platformName());
  }

  // ── Waiting ──────────────────────────────────────────────────

  async waitFor(options?: { state?: string; timeout?: number }): Promise<void> {
    const timeout = options?.timeout ?? 30000;
    if (this.polled) return this.waitForPolled(options?.state ?? 'visible', timeout);
    const el = await this.findOne();
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

  /** {@link waitFor} for a polled element (see {@link polled}): polls `$$`. */
  private async waitForPolled(state: string, timeout: number): Promise<void> {
    // A missing match counts as absent / not shown; a fatal driver error
    // (dead session, invalid selector) must not pass as "hidden" or "detached".
    const present = async () => {
      try { await this.resolveNow(); return true; }
      catch (err) { if (isFatalDriverError(err)) throw err; return false; }
    };
    const shown = async () => {
      try { return !!(await (await this.resolveNow()).isDisplayed()); }
      catch (err) { if (isFatalDriverError(err)) throw err; return false; }
    };
    const timedOut = (what: string) => () =>
      new Error(`${this.describe()} did not become ${what} within ${timeout} ms`);
    switch (state) {
      case 'attached':
        return this.pollUntil(async () => { await this.resolveNow(); return true; }, timeout, timedOut('attached'));
      case 'detached':
        return this.pollUntil(async () => !(await present()), timeout, timedOut('detached'));
      case 'hidden':
        return this.pollUntil(async () => !(await shown()), timeout, timedOut('hidden'));
      case 'visible':
      default:
        return this.pollUntil(
          async () => { const el = await this.resolveNow(); return !!(await el.isDisplayed()); },
          timeout,
          timedOut('visible'),
        );
    }
  }
}
