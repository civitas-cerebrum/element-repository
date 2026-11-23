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
 * default {@link SWIPE_MOVE_MS}), finger up. Coordinates are rounded to
 * integers. Pass the result to `driver.performActions`, or use
 * {@link performTouchSwipe}, which also releases the actions.
 */
export function buildTouchSwipe(from: TouchPoint, to: TouchPoint, options?: TouchSwipeOptions): TouchPointerSource[] {
  return touchPointers([[
    { type: 'pointerMove', duration: 0, origin: 'viewport', x: Math.round(from.x), y: Math.round(from.y) },
    { type: 'pointerDown', button: 0 },
    { type: 'pause', duration: options?.holdMs ?? SWIPE_HOLD_MS },
    { type: 'pointerMove', duration: options?.moveMs ?? SWIPE_MOVE_MS, origin: 'viewport', x: Math.round(to.x), y: Math.round(to.y) },
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
