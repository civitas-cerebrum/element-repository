import {
  Element, ElementType, ElementActionOptions, ClickOptions, ScrollIntoViewOptions, SwipeDirection, SwipeOptions,
  LongPressOptions, TapOffset, TapAtOptions, PinchOptions, ZoomOptions,
} from './Element';
import { checkLongPressDuration, checkMaxSwipes, checkTapOffset } from '../utils/gestureChecks';
import { ElementChain } from './ElementChain';
import { PlatformNotSupportedError } from './errors';
import { isFatalDriverError } from '../utils/driverErrors';
import type { Platform } from '../enum/Platform';
import {
  SWEEP_EDGE_BAND, SWEEP_END_FRACTION, SWEEP_HOLD_MS, SWEEP_MOVE_MS, SWEEP_RELEASE_HOLD_MS, SWEEP_START_FRACTION,
  SWIPE_SETTLE_MS, TouchAction, performTouchActions, performTouchSwipe, touchPointers,
} from '../utils/touch';
import { detectDriverPlatform, readPlatformText } from '../utils/platformText';
import { readPlatformChecked } from '../utils/platformChecked';
import { readElementClass } from '../utils/platformClass';
import { readPlatformAttribute } from '../utils/platformAttr';

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
    return this.matchesNothing || this.indexed || !!this.parent;
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

  /**
   * True when this element was given an index other than the first match:
   * only then do errors name the index. The repository hands out
   * `first()` (index 0) for a plain lookup, which is the same element as
   * the unindexed one, so it is named by its selector alone.
   */
  private get indexed(): boolean {
    return this.index !== undefined && this.index !== 0;
  }

  /**
   * How errors name this element: `"<selector>"`, or `nth(i) of "<selector>"`
   * for an index other than 0 (see {@link indexed}), plus its parent.
   */
  private describe(): string {
    const own = this.indexed ? `nth(${this.index}) of "${this.selector}"` : `"${this.selector}"`;
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
    if (!this.indexed) throw new NoMatchError(`no element matches ${this.describe()}`);
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
   * With `method` (a gesture or a read), a polled element that never
   * appears fails with `<method>: <element> not found within N ms: <reason>`;
   * an element that matches nothing (see {@link nth}) fails at once with
   * `<method>: <element> not found: <reason>`, as no wait could find it.
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
          const within = this.matchesNothing ? '' : ` within ${ms} ms`;
          throw new Error(`${method}: ${this.describe()} not found${within}: ${errorText(err)}`, { cause: err });
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

  /**
   * {@inheritDoc Element.check}
   *
   * Platform: the state is read with the platform rule of
   * {@link isChecked}. An element that is already checked is not clicked.
   * Otherwise, on Android, an element whose `checkable` attribute is
   * `"false"` fails at once with `check: "<selector>" is not checkable`.
   * The element must then be enabled: like Playwright's actionability
   * check, `isEnabled()` is polled within the action's `timeout`, and a
   * control still disabled when it runs out fails with
   * `check: "<selector>" is disabled`, without a click. The element is
   * clicked once, then the state is polled until it reads checked, within
   * the same `timeout` (measured from the start of the call; at least one
   * read after the click). If it still reads unchecked, throws
   * `check: "<selector>" is still unchecked after clicking`.
   */
  async check(options?: ElementActionOptions): Promise<Element> {
    return this.setChecked(true, 'check', options?.timeout);
  }

  /**
   * {@inheritDoc Element.uncheck}
   *
   * Platform: as {@link check}, the other way round. A checked radio button
   * cannot be unchecked by clicking it, so on Android `uncheck()` on a
   * checked `android.widget.RadioButton` fails at once, without a click,
   * with `uncheck: "<selector>" is a radio button; select another option
   * instead`. (XCUITest has no radio button type; an iOS control that
   * stays checked after the click fails with `is still checked after
   * clicking`.)
   */
  async uncheck(options?: ElementActionOptions): Promise<Element> {
    return this.setChecked(false, 'uncheck', options?.timeout);
  }

  /** UiAutomator2 class of a radio button: clicking a checked one never unchecks it. */
  private static readonly ANDROID_RADIO_CLASS = 'android.widget.RadioButton';

  /**
   * Shared body of {@link check} / {@link uncheck}: click only when the
   * state differs and the element can take the click, then confirm the
   * new state. On iOS the element type is read once per call; on Android
   * the class is read (see {@link readElementClass}) only for `uncheck()`.
   */
  private async setChecked(wanted: boolean, method: string, timeout?: number): Promise<Element> {
    const ms = timeout ?? this.defaultTimeout ?? 30000;
    const deadline = Date.now() + ms;
    const el = await this.ensureAttached(ms);
    const platform = this.resolvePlatform();
    const iosType: string | undefined = platform === 'ios' ? await readElementClass(el, platform) : undefined;
    const isWanted = async () => (await readPlatformChecked(el, platform, iosType)) === wanted;
    if (await isWanted()) return this;
    if (platform === 'android') {
      // An attribute the driver cannot read, or reports missing ("null"), is
      // unknown, not a refusal: only checkable "false" refuses.
      const [checkable, cls] = await Promise.all([
        readPlatformAttribute(el, 'checkable', platform).catch(() => null),
        wanted ? null : readElementClass(el, platform).catch(() => null),
      ]);
      if (checkable === 'false') throw new Error(`${method}: ${this.describe()} is not checkable`);
      if (cls === PlatformElement.ANDROID_RADIO_CLASS) {
        throw new Error(`${method}: ${this.describe()} is a radio button; select another option instead`);
      }
    }
    await this.pollUntil(
      async () => (await el.isEnabled()) === true,
      Math.max(0, deadline - Date.now()),
      () => new Error(`${method}: ${this.describe()} is disabled`),
    );
    await el.click();
    const still = wanted ? 'unchecked' : 'checked';
    await this.pollUntil(
      isWanted,
      Math.max(0, deadline - Date.now()),
      () => new Error(`${method}: ${this.describe()} is still ${still} after clicking`),
    );
    return this;
  }

  async hover(options?: ElementActionOptions): Promise<Element> {
    const el = await this.ensureAttached(options?.timeout);
    await el.moveTo();
    return this;
  }

  /**
   * {@inheritDoc Element.doubleClick}
   *
   * Platform: on iOS, XCUITest's own double tap on the element
   * (`mobile: doubleTap` with its `elementId`), which taps the element's
   * hit point twice. WebdriverIO's `doubleClick()` sends the desktop
   * sequence (a `mouse` pointer: move, down, up, pause 10 ms, down, up),
   * which XCUITest takes as one tap. A missing element fails with
   * `doubleClick: "<selector>" not found within N ms` before anything is
   * sent. On Android (and every other platform) WebdriverIO's
   * `doubleClick()` on the element centre is kept: UiAutomator2 takes it
   * as two clicks.
   */
  async doubleClick(options?: ElementActionOptions): Promise<Element> {
    if (this.resolvePlatform() === 'ios') {
      const el = await this.attachedWithId('doubleClick', options?.timeout);
      await this.driver.execute('mobile: doubleTap', { elementId: el.elementId });
      return this;
    }
    const el = await this.ensureAttached(options?.timeout);
    await el.doubleClick();
    return this;
  }

  /**
   * {@inheritDoc Element.scrollIntoView}
   *
   * Platform: makes up to `options.maxSwipes` swipes (default 20). Only
   * `options.timeout` bounds the sweep in time; this element's default
   * timeout does not. Each swipe runs along one line across the scroller
   * (see {@link sweepPath}): inside `options.container` when given, else
   * along the target's own row / column while it is in the element tree,
   * else along the window's centre line.
   */
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
    const maxSwipesPerDirection = checkMaxSwipes(options?.maxSwipes);
    const container = options?.container;
    if (container !== undefined && !(container instanceof PlatformElement)) {
      throw new Error('scrollIntoView: options.container must be a platform element (the scrollable ancestor)');
    }
    if (this.matchesNothing) await this.resolveNow().catch(err => { throw toPublicError(err); }); // can never match
    // The match the latest check found (none when the lookup failed): the
    // next swipe reads its rect for the sweep line, without a second lookup.
    let found: any = null;
    const shownNow = async (): Promise<boolean> => {
      found = null;
      try { found = await this.findOne(); return !!(await found.isDisplayed()); }
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
    // Only a timeout given to this call bounds the sweep in time; without
    // one, the swipe limit alone does (a swipe takes ~3 s on a real device,
    // so a default element or chain timeout would cut a sweep short).
    const deadline = options?.timeout === undefined ? undefined : started + options.timeout;
    const direction = options?.direction ?? 'down';
    // The container's rect is read once: the scroller itself does not move
    // while its content scrolls.
    const area = container
      ? PlatformElement.visiblePart(
        await container.gestureRect('scrollIntoView (container)', options?.timeout), windowSize,
        () => new Error(
          `scrollIntoView: the container ${container.describe()} is outside the window ` +
          `(${windowSize.width}x${windowSize.height}); scroll it into view first`,
        ),
      )
      : undefined;

    for (let i = 0; i < maxSwipesPerDirection; i++) {
      if (deadline !== undefined && Date.now() >= deadline) {
        throw new Error(
          `scrollIntoView: element not visible within the ${options!.timeout} ms timeout ` +
          `(${i} of at most ${maxSwipesPerDirection} swipes made, direction=${direction})`,
        );
      }
      const { from, to } = await this.sweepPath(direction, windowSize, area, found);
      await performTouchSwipe(this.driver, from, to, PlatformElement.SWEEP_TIMING);
      await this.driver.pause(SWIPE_SETTLE_MS);
      if (await shownNow()) return this;
    }

    throw new Error(
      `scrollIntoView: element not visible after ${maxSwipesPerDirection} swipes, the swipe limit (direction=${direction})`,
    );
  }

  /**
   * The touch timing of a sweep swipe: a drag (short hold, quick move) that
   * holds still before the finger lifts, so the content moves as far as the
   * finger did, with no fling (see {@link sweepPath}).
   */
  private static readonly SWEEP_TIMING = {
    holdMs: SWEEP_HOLD_MS, moveMs: SWEEP_MOVE_MS, releaseHoldMs: SWEEP_RELEASE_HOLD_MS,
  } as const;

  /**
   * The part of `rect` inside the window, or `onOutside()` thrown when no
   * part of it is.
   */
  private static visiblePart(
    rect: { x: number; y: number; width: number; height: number },
    win: { width: number; height: number },
    onOutside: () => Error,
  ): { x: number; y: number; width: number; height: number } {
    const left = Math.max(0, rect.x);
    const top = Math.max(0, rect.y);
    const right = Math.min(win.width, rect.x + rect.width);
    const bottom = Math.min(win.height, rect.y + rect.height);
    if (!(right > left && bottom > top)) throw onOutside();
    return { x: left, y: top, width: right - left, height: bottom - top };
  }

  /**
   * One swipe of a {@link scrollIntoView} sweep, in native-context viewport
   * coordinates. It travels along the scroll axis from
   * {@link SWEEP_START_FRACTION} (85%) to {@link SWEEP_END_FRACTION} (15%)
   * of the swept area (or back, for `'up'` / `'left'`), along a line across
   * that axis:
   *
   * - with a container (`area`, its part inside the window): the area is
   *   the container; the line is its centre (vertical centre for left /
   *   right, horizontal centre for up / down);
   * - otherwise the area is the window, and the line is the target's own
   *   centre on the cross axis, its rect read now from `target` (the match
   *   the latest visibility check found), while it is in the element tree
   *   with a non-empty rect whose centre lies inside the window on that
   *   axis; else the window's centre.
   *
   * Every point is then kept out of the window's edge bands
   * ({@link SWEEP_EDGE_BAND}: between 10% and 90% of the window on each
   * axis), within the area: a point in a band is moved to the band's inner
   * edge, unless the area lies wholly inside the band, where it stays in the
   * area. Points are rounded and clamped to `[0, size - 1]`.
   *
   * 85% → 15% is a drag of 70% of the area: over half, so a paging
   * scroller as wide as the area passes its half-page threshold, and short
   * of the whole, so a free-scrolling one keeps part of the last view on
   * screen. The finger lifts still ({@link SWEEP_RELEASE_HOLD_MS}), so the
   * content moves as far as the drag and no further.
   *
   * Direction → swipe geometry:
   *   'down'  — swipe up (85%→15%) reveals content BELOW
   *   'up'    — swipe down (15%→85%) reveals content ABOVE
   *   'right' — swipe left (85%→15%) reveals content to the RIGHT
   *   'left'  — swipe right (15%→85%) reveals content to the LEFT
   */
  private async sweepPath(
    direction: 'down' | 'up' | 'left' | 'right',
    windowSize: { width: number; height: number },
    area?: { x: number; y: number; width: number; height: number },
    target?: any,
  ): Promise<{ from: { x: number; y: number }; to: { x: number; y: number } }> {
    const horizontal = direction === 'left' || direction === 'right';
    const box = area ?? { x: 0, y: 0, width: windowSize.width, height: windowSize.height };
    const [alongSize, crossSize] = horizontal ? [windowSize.width, windowSize.height] : [windowSize.height, windowSize.width];
    const [alongLo, alongExtent] = horizontal ? [box.x, box.width] : [box.y, box.height];
    const [crossLo, crossExtent] = horizontal ? [box.y, box.height] : [box.x, box.width];
    let line = crossLo + crossExtent / 2;
    if (!area) {
      const own = await this.placedRect(target);
      if (own) {
        const centre = horizontal ? own.y + own.height / 2 : own.x + own.width / 2;
        if (centre >= 0 && centre < crossSize) line = centre;
      }
    }
    const alongIn = PlatformElement.sweepBand(alongLo, alongLo + alongExtent, alongSize);
    const crossIn = PlatformElement.sweepBand(crossLo, crossLo + crossExtent, crossSize);
    const at = (fraction: number) => alongIn(alongLo + alongExtent * fraction);
    const forward = direction !== 'up' && direction !== 'left';
    const [start, end] = forward
      ? [at(SWEEP_START_FRACTION), at(SWEEP_END_FRACTION)]
      : [at(SWEEP_END_FRACTION), at(SWEEP_START_FRACTION)];
    const across = PlatformElement.clampToAxis(crossIn(line), crossSize);
    const point = (along: number) => {
      const a = PlatformElement.clampToAxis(along, alongSize);
      return horizontal ? { x: a, y: across } : { x: across, y: a };
    };
    return { from: point(start), to: point(end) };
  }

  /**
   * A clamp into the part of `[lo, hi]` (an area on one window axis of
   * `size`) that lies outside the window's edge bands
   * ({@link SWEEP_EDGE_BAND} of `size` at each end); into `[lo, hi]` itself
   * when the area lies wholly inside a band.
   */
  private static sweepBand(lo: number, hi: number, size: number): (value: number) => number {
    const inLo = Math.max(lo, size * SWEEP_EDGE_BAND);
    const inHi = Math.min(hi, size * (1 - SWEEP_EDGE_BAND));
    const [min, max] = inLo <= inHi ? [inLo, inHi] : [lo, hi];
    return value => Math.min(Math.max(value, min), max);
  }

  /**
   * The rect of a raw element `el` when it has an id and a finite,
   * non-empty rect; `null` otherwise (no match, no id, no rect). A fatal
   * driver error is thrown.
   */
  private async placedRect(el: any): Promise<{ x: number; y: number; width: number; height: number } | null> {
    try {
      if (!el?.elementId) return null;
      const rect = await this.readRect(el);
      if (!rect || ![rect.x, rect.y, rect.width, rect.height].every(Number.isFinite)) return null;
      return rect.width > 0 && rect.height > 0 ? rect : null;
    } catch (err) {
      if (isFatalDriverError(err)) throw err;
      return null;
    }
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
   * The attached raw element with its `elementId`, for a command that takes
   * the id. WebdriverIO resolves a missing element to an object without an
   * `elementId` and does not fill it in when the element appears later; it
   * is looked up once more, and a still missing one fails with
   * `<method>: <element> not found within N ms` rather than sending the
   * command a missing id.
   */
  private async attachedWithId(method: string, timeout?: number): Promise<any> {
    let el = await this.ensureAttached(timeout, method);
    if (!el?.elementId && !this.resolvedElement) el = await this.findOne().catch(() => null);
    if (!el?.elementId) {
      throw new Error(`${method}: ${this.describe()} not found within ${timeout ?? this.defaultTimeout ?? 30000} ms`);
    }
    return el;
  }

  /**
   * Reads the element's rect for a gesture, throwing a clear error when the
   * driver has none (unlike swipe, a gesture aimed at the element must not
   * silently land somewhere else). The driver's error, if any, is appended.
   */
  private async gestureRect(method: string, timeout?: number): Promise<{ x: number; y: number; width: number; height: number }> {
    const el = await this.attachedWithId(method, timeout);
    let rect: { x: number; y: number; width: number; height: number } | null;
    try {
      rect = await this.readRect(el);
    } catch (err) {
      throw new Error(`${method}: could not read the element bounds for ${this.describe()}: ${errorText(err)}`);
    }
    if (!rect || ![rect.x, rect.y, rect.width, rect.height].every(Number.isFinite)) {
      throw new Error(`${method}: could not read the element bounds for ${this.describe()}: the driver returned no rect`);
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
  private async performTouch(fingers: TouchAction[][]): Promise<void> {
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
    const fingerPath = (sign: -1 | 1): TouchAction[] => {
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
   * match up to the element's default timeout, as an action does. With
   * `method`, a polled element that never appears fails with
   * `<method>: <element> not found within N ms: <reason>` (without
   * `within N ms` for an element that matches nothing).
   */
  private async readTarget(method?: string): Promise<any> {
    return this.polled ? this.ensureAttached(undefined, method) : this.findOne();
  }

  /**
   * Runs `fn` on the element a read acts on (see {@link readTarget}), so a
   * missing element fails naming the public method:
   * `<method>: <element> not found within N ms: <reason>`. On the default
   * path WebdriverIO's own error for a command on an element that never
   * appeared ("Can't call getText on element with selector ... because
   * element wasn't found") becomes the reason, N being WebdriverIO's
   * `waitforTimeout` (left out when the driver does not report it), and
   * the original error the `cause`. Any other error is rethrown unchanged.
   */
  private async read<T>(method: string, fn: (el: any) => Promise<T>): Promise<T> {
    const el = await this.readTarget(method);
    try {
      return await fn(el);
    } catch (err) {
      if (!(err instanceof Error) || !PlatformElement.WDIO_NOT_FOUND.test(err.message)) throw err;
      const ms = this.driver?.options?.waitforTimeout;
      const within = typeof ms === 'number' ? ` within ${ms} ms` : '';
      throw new Error(`${method}: ${this.describe()} not found${within}: ${err.message}`, { cause: err });
    }
  }

  /** WebdriverIO's error for a command on a lazy element that never appeared. */
  private static readonly WDIO_NOT_FOUND = /^Can't call \w+ on .*wasn't found$/;

  async isVisible(): Promise<boolean> {
    if (this.polled) {
      // Like Playwright, a missing match is simply not visible.
      try { return await (await this.resolveNow()).isDisplayed(); }
      catch (err) { if (isFatalDriverError(err)) throw err; return false; }
    }
    return (await this.findOne()).isDisplayed();
  }
  async isEnabled(): Promise<boolean> { return this.read('isEnabled', el => el.isEnabled()); }
  /**
   * {@inheritDoc Element.isChecked}
   *
   * Platform: Android reads the `checked` attribute; iOS reads `value`
   * ("1" = on) for a switch and `selected` for any other type; other
   * platforms use WebdriverIO `isSelected()`. See {@link readPlatformChecked}.
   */
  async isChecked(): Promise<boolean> {
    return this.read('isChecked', el => readPlatformChecked(el, this.resolvePlatform()));
  }

  // ── Extraction ───────────────────────────────────────────────

  async raw(): Promise<string | null> { return this.selector; }

  /** {@inheritDoc Element.textContent} */
  async textContent(): Promise<string | null> {
    return (await this.read('textContent', el => readPlatformText(el, this.resolvePlatform())))?.trim() ?? null;
  }

  /** {@inheritDoc Element.rawText} */
  async rawText(): Promise<string | null> {
    return this.read('rawText', el => readPlatformText(el, this.resolvePlatform()));
  }

  /**
   * {@inheritDoc Element.getAttribute}
   *
   * Platform: an attribute name the driver does not know at all returns
   * `null`, like an attribute the element lacks: UiAutomator2 answers it
   * with `'<name>' attribute is unknown for the element` (WebDriver error
   * `unknown command`, otherwise fatal) and XCUITest with `The attribute
   * '<name>' is unknown` (HTTP 500). Only that answer, for that name, is
   * mapped; any other driver error (a dead session, a missing element) is
   * thrown as before. See {@link readPlatformAttribute}.
   *
   * On Android a missing attribute returns `null`: UiAutomator2 answers it
   * with the string `"null"`, which is mapped (see `androidAttribute`).
   * An attribute whose real value is the text `null` is indistinguishable
   * from a missing one (UiAutomator2 sends the same string), so it also
   * reads as `null`; `inputValue()` still returns `"null"` for a field
   * holding that text.
   */
  async getAttribute(name: string): Promise<string | null> {
    return this.read('getAttribute', el => readPlatformAttribute(el, name, this.resolvePlatform()));
  }

  async inputValue(): Promise<string> {
    return this.read('inputValue', el => this.readInputValue(el));
  }

  /** Body of {@link inputValue} on its resolved element. */
  private async readInputValue(el: any): Promise<string> {
    if (this.isAndroid()) {
      // UiAutomator2 doesn't expose a `value` attribute — `text` is the
      // equivalent. When the EditText is empty, `text` returns the hint
      // string (UiAutomator2's `showing-hint` / `showingHintText` attribute
      // names are listed as supported but `getAttribute` on them returns
      // "unknown attribute" on uiautomator2 6.7.8 — a driver bug). Detect
      // the empty-field case by comparing `text` to `hint`: when they
      // match, the field is empty and the hint is being rendered as text.
      // A field without a hint reads hint as "null" (see
      // `androidAttribute`); that is no hint, so typing the text
      // "null" is not taken for an empty field.
      const [text, hint] = await Promise.all([
        el.getAttribute('text').catch(() => null),
        readPlatformAttribute(el, 'hint', 'android').catch(() => null),
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
      readPlatformAttribute(el, 'placeholderValue', this.resolvePlatform()).catch(() => null),
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
   * The element's tag name: on native contexts, the element class, read
   * with {@link readElementClass}. On iOS that is the XCUIElementType
   * (`XCUIElementTypeButton`); on Android the `class` attribute
   * (`android.widget.Button`), not UiAutomator2's own tag name, which is
   * the content-desc when one is set. Like the web element, a missing
   * element is an error, not an empty string.
   */
  async getTagName(): Promise<string> {
    return this.read('getTagName', el => readElementClass(el, this.resolvePlatform()));
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
