import {
  Element, ElementType, ElementActionOptions, ScrollIntoViewOptions, SwipeDirection, SwipeOptions,
  LongPressOptions, TapOffset, PinchOptions, ZoomOptions,
} from './Element';
import { checkLongPressDuration, checkTapOffset } from './gestureChecks';
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

  /**
   * Waits for the underlying Appium element to exist before any action fires.
   * Gives each action a predictable presence-detection preamble so failures
   * surface as "element never attached" rather than an opaque driver error.
   */
  private async ensureAttached(timeout?: number): Promise<any> {
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

  async swipe(direction: SwipeDirection, options?: SwipeOptions): Promise<Element> {
    const el = await this.ensureAttached(options?.timeout);
    const rect = await el.getRect().catch(() => null);
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
   * Reads the element's rect for a gesture, throwing a clear error when the
   * driver has none (unlike swipe, a gesture aimed at the element must not
   * silently land somewhere else).
   */
  private async gestureRect(method: string, timeout?: number): Promise<{ x: number; y: number; width: number; height: number }> {
    const el = await this.ensureAttached(timeout);
    const rect = await Promise.resolve().then(() => el.getRect()).catch(() => null);
    if (!rect || ![rect.x, rect.y, rect.width, rect.height].every(Number.isFinite)) {
      throw new Error(`${method}: could not read the element bounds for "${this.selector}"`);
    }
    return rect;
  }

  /**
   * Sends W3C pointer actions through the protocol-level `performActions`
   * command (present in WebdriverIO 9 and 10) and always releases them,
   * even on failure. A release error never masks the original one.
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

  /**
   * Two touch pointers on the horizontal axis through the element centre.
   * The wider half-gap is 40% of the element width; the narrower one is
   * that times `scale` (pinch) or divided by it (zoom), never below
   * {@link MIN_HALF_GAP}. Coordinates are clamped to the window.
   */
  private async twoFingerGesture(method: 'pinch' | 'zoom', scale: number, timeout?: number): Promise<void> {
    const rect = await this.gestureRect(method, timeout);
    const windowSize = await this.driver.getWindowSize();
    const cx = rect.x + rect.width / 2;
    const cy = rect.y + rect.height / 2;
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

    const clampX = (v: number) => Math.min(Math.max(Math.round(v), 0), windowSize.width - 1);
    const y = Math.min(Math.max(Math.round(cy), 0), windowSize.height - 1);
    const fingerPath = (sign: -1 | 1) => [
      { type: 'pointerMove', duration: 0, origin: 'viewport', x: clampX(cx + sign * startGap), y },
      { type: 'pointerDown', button: 0 },
      { type: 'pointerMove', duration: PlatformElement.TWO_FINGER_MOVE_MS, origin: 'viewport', x: clampX(cx + sign * endGap), y },
      { type: 'pointerUp', button: 0 },
    ];
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
    try { return await el.getCSSValue(property); }
    catch { throw new Error(`getCssProperty("${property}") requires a web or hybrid context`); }
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
