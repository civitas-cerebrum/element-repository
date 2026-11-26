/**
 * W3C touch actions shared by the platform (Appium) gestures, exported so a
 * consumer's screen-level swipe sends exactly the same sequence as
 * `Element.swipe` / `Element.scrollIntoView`.
 *
 * Coordinates are native-context viewport coordinates (the space of the
 * element rect and the window size).
 */

/** A point in native-context viewport coordinates. */
export interface TouchPoint {
  x: number;
  y: number;
}

/**
 * One W3C action of a touch pointer source, as the platform gestures send
 * them: a move to a point over `duration` ms (`origin: 'viewport'` for
 * absolute coordinates), finger down or up, or a pause of `duration` ms.
 */
export type TouchAction =
  | { type: 'pointerMove'; x: number; y: number; duration?: number; origin?: 'viewport' | 'pointer' }
  | { type: 'pointerDown'; button: number }
  | { type: 'pointerUp'; button: number }
  | { type: 'pause'; duration: number };

/** Timings of {@link buildTouchSwipe} / {@link performTouchSwipe}, in ms. */
export interface TouchSwipeOptions {
  /** Hold after `pointerDown` before the finger moves. Default {@link SWIPE_HOLD_MS}. */
  holdMs?: number;
  /** Duration of the move from the start to the end point. Default {@link SWIPE_MOVE_MS}. */
  moveMs?: number;
  /**
   * Hold at the end point before the finger lifts. Default `0`: no pause is
   * sent and the finger lifts as soon as it arrives. A hold longer than the
   * platforms' velocity window (about 100 ms) lifts a still finger, so the
   * content stops where the finger left it instead of flinging on.
   */
  releaseHoldMs?: number;
}

/** A W3C pointer input source, as sent to the `performActions` command. */
export interface TouchPointerSource {
  type: 'pointer';
  id: string;
  parameters: { pointerType: 'touch' };
  actions: TouchAction[];
}

/** Finger hold after `pointerDown` before a swipe moves, in ms, so the press registers as a drag start rather than a flick. */
export const SWIPE_HOLD_MS = 100;

/** Duration of a swipe's travel from the start to the end point, in ms. */
export const SWIPE_MOVE_MS = 600;

/** Pause after a swipe so the content settles (scroll momentum, lazy rows) before the next read, in ms. */
export const SWIPE_SETTLE_MS = 200;

/**
 * Hold after `pointerDown` before a `scrollIntoView` sweep swipe moves, in
 * ms: enough for the press to land before the move, far below a long press
 * (about 500 ms on both platforms).
 */
export const SWEEP_HOLD_MS = 50;

/**
 * Duration of a `scrollIntoView` sweep swipe's travel, in ms. The travel is
 * a drag: the speed does not decide how far the content moves, since the
 * finger stops ({@link SWEEP_RELEASE_HOLD_MS}) before it lifts.
 */
export const SWEEP_MOVE_MS = 300;

/**
 * Hold at the end point of a `scrollIntoView` sweep swipe before the finger
 * lifts, in ms. Longer than the window over which Android's VelocityTracker
 * and UIKit's scroll views measure the lift velocity (about 100 ms), so the
 * finger lifts still: a free-scrolling list stops where the finger left it
 * (no fling past a short target), and a paging scroller settles on the page
 * the drag reached, which is the next one once the drag passed half a page.
 */
export const SWEEP_RELEASE_HOLD_MS = 200;

/**
 * Where a `scrollIntoView` sweep swipe starts and ends along the scroll
 * axis, as fractions of the swept area (the container, else the window):
 * from 85% to 15% (or back), a drag of 70% of the area. Over half the area,
 * so a paging scroller as wide as the area passes its half-page threshold;
 * under the area, so a free-scrolling list keeps 30% of the previous view on
 * screen after each swipe and cannot pass a target.
 */
export const SWEEP_START_FRACTION = 0.85;

/** The end fraction of a sweep swipe; see {@link SWEEP_START_FRACTION}. */
export const SWEEP_END_FRACTION = 0.15;

/**
 * The window edge bands a `scrollIntoView` sweep swipe stays out of, as a
 * fraction of the window on each axis: its points lie between 10% and 90%
 * of the window (system gestures start at the edges: the status bar, the
 * home indicator, Android's back gesture).
 */
export const SWEEP_EDGE_BAND = 0.1;

/**
 * Wraps per-finger action lists as W3C touch pointer sources named
 * `finger1`, `finger2`, ... in order.
 */
export function touchPointers(fingers: TouchAction[][]): TouchPointerSource[] {
  return fingers.map((actions, i) => ({
    type: 'pointer',
    id: `finger${i + 1}`,
    parameters: { pointerType: 'touch' },
    actions,
  }));
}

/**
 * The action sequence of a one-finger swipe from `from` to `to`: an instant
 * move to the start point, finger down, a hold (`options.holdMs`, default
 * {@link SWIPE_HOLD_MS}), a move to the end point (`options.moveMs`,
 * default {@link SWIPE_MOVE_MS}), a hold at the end point when
 * `options.releaseHoldMs` is above 0, finger up. Coordinates are rounded to
 * integers. Pass the result to `driver.performActions`, or use
 * {@link performTouchSwipe}, which also releases the actions.
 */
export function buildTouchSwipe(from: TouchPoint, to: TouchPoint, options?: TouchSwipeOptions): TouchPointerSource[] {
  return touchPointers([[
    { type: 'pointerMove', duration: 0, origin: 'viewport', x: Math.round(from.x), y: Math.round(from.y) },
    { type: 'pointerDown', button: 0 },
    { type: 'pause', duration: options?.holdMs ?? SWIPE_HOLD_MS },
    { type: 'pointerMove', duration: options?.moveMs ?? SWIPE_MOVE_MS, origin: 'viewport', x: Math.round(to.x), y: Math.round(to.y) },
    ...(options?.releaseHoldMs ? [{ type: 'pause' as const, duration: options.releaseHoldMs }] : []),
    { type: 'pointerUp', button: 0 },
  ]]);
}

/**
 * Sends W3C pointer sources with the protocol command `performActions` and
 * always calls `releaseActions` afterwards, even on failure. A release
 * error never masks the gesture's own error; when the gesture succeeded, a
 * release error is thrown.
 *
 * @param driver - A WebdriverIO browser with `performActions` / `releaseActions`.
 */
export async function performTouchActions(driver: any, sources: TouchPointerSource[]): Promise<void> {
  let failed = false;
  try {
    await driver.performActions(sources);
  } catch (err) {
    failed = true;
    throw err;
  } finally {
    try { await driver.releaseActions(); }
    catch (releaseErr) { if (!failed) throw releaseErr; }
  }
}

/**
 * Sends the swipe of {@link buildTouchSwipe} (with the same `options`)
 * through {@link performTouchActions}. It does not pause afterwards; wait
 * {@link SWIPE_SETTLE_MS} before reading the screen if the content scrolls.
 *
 * @param driver - A WebdriverIO browser with `performActions` / `releaseActions`.
 */
export async function performTouchSwipe(driver: any, from: TouchPoint, to: TouchPoint, options?: TouchSwipeOptions): Promise<void> {
  await performTouchActions(driver, buildTouchSwipe(from, to, options));
}
