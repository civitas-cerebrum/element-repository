import {
  Element, ElementType, ElementActionOptions, ScrollIntoViewOptions, SwipeDirection, SwipeOptions,
  LongPressOptions, TapOffset, PinchOptions, ZoomOptions,
} from './Element';
import { checkLongPressDuration, checkTapOffset } from './gestureChecks';
import { ElementChain } from './ElementChain';
import { PlatformNotSupportedError } from '../errors';
import type { Platform } from '../platform';

/** Extra construction options for {@link PlatformElement}. */
export interface PlatformElementOptions {
  /**
   * Act on this match of the selector, as {@link PlatformElement.nth} does.
   * Zero-based; negative values count from the end (`-1` is the last).
   */
  index?: number;
  /**
   * The platform the element belongs to. Used in error messages such as
   * {@link PlatformNotSupportedError}; read from the driver when omitted.
   */
  platform?: Platform;
}

/** Message of an unknown thrown value, for appending a cause to an error. */
function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * WebDriverIO-backed {@link Element} implementation for mobile and desktop platforms.
 *
 * Uses the WebDriverIO `$` / `$$` commands to locate native elements via Appium selectors.
 * Methods that have no native equivalent (e.g. {@link setInputFiles}, {@link dispatchEvent})
 * throw at runtime.
 */
export class PlatformElement implements Element {
  readonly _type = ElementType.PLATFORM;

  /** Zero-based match index set by {@link first} / {@link nth}; negative counts from the end. */
  private readonly index?: number;
  /** Platform given at construction, if any (see {@link platformName}). */
  private readonly platform?: Platform;

  /**
   * @param driver          - The WebDriverIO browser/driver instance.
   * @param selector        - Appium-compatible selector string.
   * @param resolvedElement - Optional already-resolved raw WebDriverIO element
   * (e.g. from `$$`). When set, {@link findOne} returns
   * it directly instead of re-querying the driver.
   * @param defaultTimeout  - Default timeout in ms inherited from the repository.
   * @param options         - `index`: act on that match of `selector` (as
   * {@link nth} does); `platform`: the platform this
   * element belongs to, used in error messages.
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
   * True when this element picks a match by position from `$$`. Index 0
   * (from {@link first} / `nth(0)`) uses `$`, which already returns the
   * first match and keeps WebdriverIO's own waiting.
   */
  private get byIndex(): boolean {
    return !this.resolvedElement && this.index !== undefined && this.index !== 0;
  }

  /**
   * Returns the underlying raw element.
   * If a {@link resolvedElement} was provided (e.g. from {@link all}), it is
   * returned directly; an element made by {@link nth} picks its match from
   * `$$` (throwing when there is none); otherwise the driver is queried via `$`.
   */
  private async findOne(): Promise<any> {
    if (this.resolvedElement) return this.resolvedElement;
    if (this.byIndex) return this.resolveIndexed();
    // WebdriverIO 10's `$` is strict by default and throws when the selector
    // matches more than once; this element means "the first match", so opt
    // out. WebdriverIO 9's `$` takes no options and ignores the argument.
    return this.driver.$(this.selector, { strict: false });
  }

  /** Picks the indexed match from `$$`, or throws a clear out-of-range error. */
  private async resolveIndexed(): Promise<any> {
    const raws = await this.queryAll();
    const index = this.index ?? 0;
    const i = index < 0 ? raws.length + index : index;
    if (i >= 0 && i < raws.length) return raws[i];
    throw new Error(`nth(${index}): no element at that index for "${this.selector}" (found ${raws.length})`);
  }

  /** All matches of the selector, as a plain array. */
  private async queryAll(): Promise<any[]> {
    return Array.from((await this.driver.$$(this.selector)) ?? []);
  }

  /**
   * Locates all matching elements using `$$`. An element made by
   * {@link first} / {@link nth} yields at most its own match.
   */
  private async findAll(): Promise<any[]> {
    if (this.resolvedElement || this.index === undefined) return this.queryAll();
    try { return [await this.resolveIndexed()]; } catch { return []; }
  }

  /**
   * Polls `check` until it returns true or `timeout` ms pass. On timeout,
   * throws the last error `check` raised, or `onTimeout()`.
   */
  private async pollUntil(check: () => Promise<boolean>, timeout: number, onTimeout: () => Error): Promise<void> {
    const deadline = Date.now() + timeout;
    let lastError: unknown;
    for (;;) {
      try {
        if (await check()) return;
        lastError = undefined;
      } catch (err) { lastError = err; }
      const remaining = deadline - Date.now();
      if (remaining <= 0) break;
      await new Promise(resolve => setTimeout(resolve, Math.min(PlatformElement.INDEX_POLL_MS, remaining)));
    }
    throw lastError instanceof Error ? lastError : onTimeout();
  }

  /**
   * The platform this element runs on, for error messages: the
   * constructor's `platform`, else the driver's `platformName` capability
   * or WebdriverIO's `isIOS` / `isAndroid` flags, else the selector's
   * prefix (`-ios ...` / `android=`). When none of those tells, it falls
   * back to `'android'`.
   */
  private platformName(): Platform {
    if (this.platform) return this.platform;
    const caps = (this.driver?.capabilities ?? {}) as Record<string, unknown>;
    const raw = String(caps.platformName ?? caps['appium:platformName'] ?? '').toLowerCase().replace(/\s+/g, '');
    if (raw === 'ios' || raw === 'android' || raw === 'windows') return raw;
    if (raw === 'mac' || raw === 'macos') return 'macos';
    if (this.driver?.isIOS === true) return 'ios';
    if (this.driver?.isAndroid === true) return 'android';
    if (this.selector.startsWith('-ios')) return 'ios';
    return 'android';
  }

  // ── Interaction ──────────────────────────────────────────────

  /**
   * Waits for the underlying Appium element to exist before any action fires.
   * Gives each action a predictable presence-detection preamble so failures
   * surface as "element never attached" rather than an opaque driver error.
   */
  private async ensureAttached(timeout?: number): Promise<any> {
    if (this.byIndex) {
      // No lazy WebdriverIO element exists for "the i-th match": poll `$$`
      // until it is there, and fail with the out-of-range error otherwise.
      let el: any;
      await this.pollUntil(
        async () => { el = await this.resolveIndexed(); return true; },
        timeout ?? this.defaultTimeout ?? 30000,
        () => new Error(`nth(${this.index}): no element at that index for "${this.selector}"`),
      );
      return el;
    }
    const el = await this.findOne();
    try { await el.waitForExist({ timeout: timeout ?? this.defaultTimeout ?? 30000 }); }
    catch { /* swallow — downstream action call will surface a clearer error */ }
    return el;
  }

  async click(options?: ElementActionOptions): Promise<Element> {
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
    // swipe runs. Instead, resolve the lazy locator and let the
    // per-iteration isDisplayed() drive the loop.
    const el = await this.findOne();
    // Fast path — already on-screen.
    if (await el.isDisplayed().catch(() => false)) return this;

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

    const swipeXY = async (fromX: number, fromY: number, toX: number, toY: number): Promise<void> => {
      await this.driver.action('pointer', { parameters: { pointerType: 'touch' } })
        .move({ x: fromX, y: fromY })
        .down()
        .move({ x: toX, y: toY, duration: 300 })
        .up()
        .perform();
      await this.driver.pause(200);
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
      await swipeXY(fromX, fromY, toX, toY);
      if (await el.isDisplayed().catch(() => false)) return this;
    }

    throw new Error(`scrollIntoView: element not visible after ${maxSwipesPerDirection} swipes (direction=${direction})`);
  }

  /**
   * Swipes from the element centre. Coordinates are native-context
   * viewport coordinates (the same space as `getElementRect` and
   * `getWindowSize`).
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
    const toX = horizontal ? cx + distance * sign : cx;
    const toY = horizontal ? cy : cy + distance * sign;
    await this.driver.action('pointer', { parameters: { pointerType: 'touch' } })
      .move({ x: cx, y: cy })
      .down()
      .move({ x: toX, y: toY, duration: 300 })
      .up()
      .perform();
    await this.driver.pause(200);
    return this;
  }

  // ── Touch gestures (W3C actions) ─────────────────────────────

  /**
   * Reads a raw element's rect with the W3C protocol command
   * `getElementRect(elementId)` (WebdriverIO 9 and 10 elements have no
   * `getRect()`). Coordinates are native-context viewport coordinates.
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
    const el = await this.ensureAttached(timeout);
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
   * Sends W3C pointer actions through the protocol-level `performActions`
   * command (present in WebdriverIO 9 and 10) and always releases them,
   * even on failure. A release error never masks the original one; when
   * the gesture itself succeeded, a release error is thrown.
   */
  private async performTouch(sources: Array<Array<Record<string, unknown>>>): Promise<void> {
    const actions = sources.map((steps, i) => ({
      type: 'pointer',
      id: `finger${i + 1}`,
      parameters: { pointerType: 'touch' },
      actions: steps,
    }));
    let failed = false;
    try {
      await this.driver.performActions(actions);
    } catch (err) {
      failed = true;
      throw err;
    } finally {
      try { await this.driver.releaseActions(); }
      catch (releaseErr) { if (!failed) throw releaseErr; }
    }
  }

  /** {@inheritDoc Element.longPress} */
  async longPress(options?: LongPressOptions): Promise<void> {
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
  }

  /** {@inheritDoc Element.tapAt} */
  async tapAt(offset: TapOffset, options?: ElementActionOptions): Promise<void> {
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
  }

  /** {@inheritDoc Element.pinch} */
  async pinch(options?: PinchOptions): Promise<void> {
    const scale = options?.scale ?? 0.5;
    if (!Number.isFinite(scale) || scale <= 0 || scale >= 1) {
      throw new Error(`pinch: scale must be a finite number between 0 and 1 (exclusive), got ${options?.scale}`);
    }
    await this.twoFingerGesture('pinch', scale, options?.timeout);
  }

  /** {@inheritDoc Element.zoom} */
  async zoom(options?: ZoomOptions): Promise<void> {
    const scale = options?.scale ?? 2;
    if (!Number.isFinite(scale) || scale <= 1) {
      throw new Error(`zoom: scale must be a finite number greater than 1, got ${options?.scale}`);
    }
    await this.twoFingerGesture('zoom', scale, options?.timeout);
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
      const outer = Math.min(Math.max(Math.round(cx + sign * outerGap), 0), windowSize.width - 1);
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
    throw new Error('setInputFiles is not supported on platform elements.');
  }

  async dispatchEvent(_event: string): Promise<Element> {
    throw new Error('dispatchEvent is not supported on platform elements.');
  }

  // ── State ────────────────────────────────────────────────────

  async isVisible(): Promise<boolean> {
    if (this.byIndex) {
      // Like Playwright, a missing nth match is simply not visible.
      try { return await (await this.resolveIndexed()).isDisplayed(); } catch { return false; }
    }
    return (await this.findOne()).isDisplayed();
  }
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

  /** Returns true when the underlying driver is Android (UiAutomator2). */
  private isAndroid(): boolean {
    const platform = (this.driver.capabilities as Record<string, unknown> | undefined)
      ?.platformName;
    return typeof platform === 'string' && platform.toLowerCase() === 'android';
  }

  /**
   * Reads a computed CSS value via the driver's CSS accessor. Works in
   * hybrid web contexts; throws on pure native contexts where there's no CSS.
   */
  async getCssProperty(property: string): Promise<string> {
    const el = await this.findOne();
    // Protocol command (WebdriverIO 9/10 elements have no getCSSValue()).
    try { return await this.driver.getElementCSSValue(el?.elementId, property); }
    catch (err) { throw new Error(`getCssProperty("${property}") requires a web or hybrid context: ${errorText(err)}`); }
  }

  async getTagName(): Promise<string> {
    const el = await this.findOne();
    try { return await el.getTagName(); } catch { return ''; }
  }

  async exists(): Promise<boolean> {
    try { return await (await this.findOne()).isExisting(); } catch { return false; }
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
    const el = await this.findOne();
    try {
      const rect = await this.readRect(el);
      if (!rect) return null;
      return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
    } catch (err) {
      throw new Error(`boundingBox() could not read the element rect: ${errorText(err)}`);
    }
  }

  async screenshot(_options?: { path?: string }): Promise<Buffer> {
    const el = await this.findOne();
    try {
      // Protocol command; it needs the element id as its argument.
      const raw = await this.driver.takeElementScreenshot(el?.elementId);
      return Buffer.from(raw as string, 'base64');
    } catch (err) {
      throw new Error(`screenshot() is not supported on this platform driver: ${errorText(err)}`);
    }
  }

  // ── Querying ─────────────────────────────────────────────────

  locateChild(selector: string): Element {
    return new PlatformElement(this.driver, selector, undefined, this.defaultTimeout, { platform: this.platform });
  }

  /**
   * Number of matches. For an element made by {@link first} / {@link nth}
   * this is 1 when its match exists and 0 otherwise, as in Playwright.
   */
  async count(): Promise<number> { return (await this.findAll()).length; }

  async all(): Promise<Element[]> {
    const elements = await this.findAll();
    return elements.map(el => new PlatformElement(this.driver, this.selector, el, this.defaultTimeout, { platform: this.platform }));
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
   * the element itself and any other index throws.
   *
   * @throws When `index` is not an integer.
   */
  nth(index: number): Element {
    if (!Number.isInteger(index)) throw new Error(`nth: index must be an integer, got ${index}`);
    if (this.resolvedElement || this.index !== undefined) {
      if (index === 0 || index === -1) return this;
      throw new Error(`nth(${index}): out of range, "${this.selector}" is already a single match`);
    }
    return new PlatformElement(this.driver, this.selector, undefined, this.defaultTimeout, { index, platform: this.platform });
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
    if (this.byIndex) return this.waitForIndexed(options?.state ?? 'visible', timeout);
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

  /** {@link waitFor} for an element made by {@link nth}: polls `$$`. */
  private async waitForIndexed(state: string, timeout: number): Promise<void> {
    const present = async () => { try { await this.resolveIndexed(); return true; } catch { return false; } };
    const shown = async () => { try { return !!(await (await this.resolveIndexed()).isDisplayed()); } catch { return false; } };
    const timedOut = (what: string) => () =>
      new Error(`nth(${this.index}) of "${this.selector}" did not become ${what} within ${timeout} ms`);
    switch (state) {
      case 'attached':
        return this.pollUntil(async () => { await this.resolveIndexed(); return true; }, timeout, timedOut('attached'));
      case 'detached':
        return this.pollUntil(async () => !(await present()), timeout, timedOut('detached'));
      case 'hidden':
        return this.pollUntil(async () => !(await shown()), timeout, timedOut('hidden'));
      case 'visible':
      default:
        return this.pollUntil(
          async () => { const el = await this.resolveIndexed(); return !!(await el.isDisplayed()); },
          timeout,
          timedOut('visible'),
        );
    }
  }
}
