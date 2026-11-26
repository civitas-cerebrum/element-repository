/**
 * Soft keyboard dismissal on Appium drivers, shared by `PlatformElement`
 * (before a `scrollIntoView` sweep) and consumer packages.
 */
import type { Platform } from '../enum/Platform';
import { isFatalDriverError } from './driverErrors';
import { detectDriverPlatform } from './platformText';
import { performTouchSwipe } from './touch';

/** Pause after each dismissal step before the keyboard is checked again, in ms (the keyboard's hide animation). */
export const KEYBOARD_SETTLE_MS = 300;

/**
 * Key names of the key the iOS step "keys" taps: the default return key
 * (identifier `Return`, label `return`) and the Done key, in both
 * spellings. WebDriverAgent taps a key (or keyboard button) whose
 * identifier or label equals one of them exactly. A non-default return key
 * (Go, Search, Send, Next, Join, ...) is not in the list: on such a field
 * WebDriverAgent refuses this step and the drag step runs.
 */
export const IOS_DISMISS_KEYS: readonly string[] = Object.freeze(['return', 'Return', 'done', 'Done']);

/** Options of {@link dismissKeyboard}. */
export interface DismissKeyboardOptions {
  /**
   * Upper bound in ms for the whole call. No new step starts once it has
   * passed (a step already running is not cut short), and the call throws
   * the "still shown" error. Default: no time bound; the steps bound it.
   */
  timeout?: number;
}

/** The "still shown" outcome of {@link dismissKeyboard}. */
export class KeyboardStillShownError extends Error {
  /** The names of the steps that ran, in order. */
  readonly steps: readonly string[];
  constructor(message: string, steps: readonly string[]) {
    super(message);
    this.name = 'KeyboardStillShownError';
    this.steps = steps;
  }
}

/** A step that decided not to send its gesture: it failed without touching the screen. */
class StepRefused extends Error {}

interface Step {
  name: string;
  /** False when the driver has no command for the step: it is skipped. */
  available: boolean;
  run: () => Promise<unknown>;
  /** True for an error that says the driver did not run the step: the step is skipped. */
  skipsOn: (err: unknown) => boolean;
}

const UNSUPPORTED_NAMES = new Set([
  'unknown command', 'UnknownCommandError', 'unknown method', 'UnknownMethodError',
  'unsupported operation', 'UnsupportedOperationError', 'NotYetImplementedError', 'NotImplementedError',
]);
const UNSUPPORTED_MESSAGE = /unknown (mobile )?(command|method)|unsupported operation|not (yet )?(been )?implemented/i;

/** True when the driver's answer says it has no such command or method (it did not run it). */
function isUnsupported(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const { name, message } = err as { name?: unknown; message?: unknown };
  return (typeof name === 'string' && UNSUPPORTED_NAMES.has(name))
    || (typeof message === 'string' && UNSUPPORTED_MESSAGE.test(message));
}

/** True for the driver's "invalid argument" answer (a W3C actions body it will not perform). */
function isInvalidArgument(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const { name } = err as { name?: unknown };
  return name === 'invalid argument' || name === 'InvalidArgumentError';
}

function messageOf(err: unknown): string {
  const text = err instanceof Error ? err.message : String(err);
  return text.split('\n')[0].trim();
}

async function pause(driver: any, ms: number): Promise<void> {
  if (typeof driver?.pause === 'function') await driver.pause(ms);
  else await new Promise(resolve => setTimeout(resolve, ms));
}

const clamp = (value: number, min: number, max: number): number => Math.min(Math.max(value, min), max);

/** Distance of the drag's start above the keyboard's top edge, in pt. */
const DRAG_START_ABOVE_KEYBOARD = 30;
/** Distance of the drag's end above the window's bottom edge, in pt. */
const DRAG_END_ABOVE_BOTTOM = 10;

/**
 * iOS step 3: a drag from just above the keyboard down onto it, the gesture
 * a user makes to pull the keyboard away. It dismisses the keyboard of a
 * scroll view whose `keyboardDismissMode` is `interactive` or `onDrag` (and
 * SwiftUI `scrollDismissesKeyboard`). It starts 30 pt above the keyboard's
 * top edge on the window's vertical centre line and ends 10 pt above the
 * window's bottom, moving the whole time, so it never ends as a tap on what
 * is under its start point. It is refused, sending nothing, unless its
 * start is above its end and the centre line crosses the keyboard (not a
 * floating keyboard off the centre); its points are clamped into the window.
 */
async function dragOntoKeyboard(driver: any): Promise<void> {
  const keyboard = await driver.$('-ios class chain:**/XCUIElementTypeKeyboard', { strict: false });
  if (!keyboard?.elementId) throw new StepRefused('the keyboard element was not found');
  const rect = await driver.getElementRect(keyboard.elementId);
  const size = await driver.getWindowSize();
  const x = Math.round(size.width / 2);
  const startY = Math.round(rect.y - DRAG_START_ABOVE_KEYBOARD);
  const endY = Math.round(size.height - DRAG_END_ABOVE_BOTTOM);
  if (!(startY < endY)) {
    throw new StepRefused(
      `the drag start y ${startY} (${DRAG_START_ABOVE_KEYBOARD} pt above the keyboard's top ${Math.round(rect.y)}) ` +
      `is not above its end y ${endY} (${DRAG_END_ABOVE_BOTTOM} pt above the window's bottom)`,
    );
  }
  if (!(x >= rect.x && x <= rect.x + rect.width)) {
    throw new StepRefused(
      `the window's centre x ${x} is outside the keyboard's x range ${Math.round(rect.x)}-${Math.round(rect.x + rect.width)}`,
    );
  }
  const maxX = Math.max(0, Math.round(size.width) - 1);
  const maxY = Math.max(0, Math.round(size.height) - 1);
  const from = { x: clamp(x, 0, maxX), y: clamp(startY, 0, maxY) };
  const to = { x: from.x, y: clamp(endY, 0, maxY) };
  await performTouchSwipe(driver, from, to, { holdMs: 50, moveMs: 300 });
}

/**
 * The platform's dismissal steps, in the order they run. Each entry is
 * self-contained, so the order can be changed by moving entries.
 */
function stepsFor(driver: any, platform: Platform | undefined): Step[] {
  const canExecute = typeof driver?.execute === 'function';
  if (platform === 'ios') {
    return [
      {
        name: 'mobile: hideKeyboard',
        available: canExecute,
        run: () => driver.execute('mobile: hideKeyboard', {}),
        skipsOn: isUnsupported,
      },
      {
        name: `mobile: hideKeyboard { keys: [${IOS_DISMISS_KEYS.map(k => `'${k}'`).join(', ')}] }`,
        available: canExecute,
        run: () => driver.execute('mobile: hideKeyboard', { keys: [...IOS_DISMISS_KEYS] }),
        skipsOn: isUnsupported,
      },
      {
        name: 'a drag from above the keyboard down onto it',
        available: typeof driver?.performActions === 'function' && typeof driver?.$ === 'function',
        run: () => dragOntoKeyboard(driver),
        skipsOn: err => isUnsupported(err) || isInvalidArgument(err),
      },
    ];
  }
  // Android and every other platform: the commands the platform element has
  // always sent, unchanged.
  return [
    {
      name: 'hideKeyboard()',
      available: typeof driver?.hideKeyboard === 'function',
      run: () => driver.hideKeyboard(),
      skipsOn: isUnsupported,
    },
    {
      name: "mobile: hideKeyboard { strategy: 'pressKey', key: 'return' }",
      available: canExecute,
      run: () => driver.execute('mobile: hideKeyboard', { strategy: 'pressKey', key: 'return' }),
      skipsOn: isUnsupported,
    },
    {
      name: "mobile: hideKeyboard { strategy: 'tapOutside' }",
      available: canExecute,
      run: () => driver.execute('mobile: hideKeyboard', { strategy: 'tapOutside' }),
      skipsOn: isUnsupported,
    },
  ];
}

/**
 * Hides the soft keyboard, if one is shown, with the platform's dismissal
 * steps, and says whether it had to.
 *
 * 1. It asks `driver.isKeyboardShown()`. No keyboard: returns `false` at
 *    once, sending nothing else. A driver without `isKeyboardShown`, or one
 *    whose answer is any error that is not fatal (`unknown command`,
 *    `unknown method`, `unsupported operation`, "not (yet) implemented" or
 *    anything else: it cannot tell), also returns `false` without sending
 *    anything. A fatal error of that first check ({@link isFatalDriverError}:
 *    dead session, lost connection, ..., but not the unsupported answers
 *    above) is thrown.
 * 2. Otherwise it runs the steps below in order. After each step it waits
 *    {@link KEYBOARD_SETTLE_MS} and asks `isKeyboardShown()` again, and
 *    returns `true` as soon as the keyboard is gone. A step whose command
 *    the driver does not have is skipped.
 *    - iOS (XCUITest):
 *      1. `mobile: hideKeyboard` with no keys. XCUITest adds the key name
 *         `done` itself; on an iPad WebDriverAgent also taps the keyboard's
 *         hide key.
 *      2. `mobile: hideKeyboard` with `keys` {@link IOS_DISMISS_KEYS}
 *         (`return`, `Return`, `done`, `Done`): WebDriverAgent taps the
 *         keyboard key whose identifier or label is one of them. A text
 *         field that dismisses on Return (or submits on it) does so here. A
 *         field with another return key (Go, Search, Send, Next, Join, ...)
 *         has no such key: WebDriverAgent refuses the step and the drag runs.
 *      3. A drag from 30 pt above the keyboard's top edge down to 10 pt
 *         above the window's bottom, on the window's vertical centre line
 *         (50 ms hold, 300 ms move, no tap). It dismisses the keyboard of a
 *         scroll view with interactive / on-drag keyboard dismissal. It is
 *         a real drag on whatever is under its start point: a scroll view
 *         may scroll or bounce with it, a list scrolled to its top may
 *         trigger pull-to-refresh, a picker wheel may turn and a map may
 *         pan; a button or slider under it sees a cancelled touch, not a
 *         tap. It is refused (the step fails, nothing is sent) unless its
 *         start lies above its end and the centre line crosses the
 *         keyboard's x range; its points are clamped into the window.
 *    - Android, and any other platform: WebdriverIO `hideKeyboard()`, then
 *      `mobile: hideKeyboard` with `{ strategy: 'pressKey', key: 'return' }`,
 *      then with `{ strategy: 'tapOutside' }` (the commands the platform
 *      element's pre-scroll dismissal has always sent).
 * 3. A step the driver answers as unsupported (`unknown command`, `unknown
 *    method`, `unsupported operation`, "not (yet) implemented"; for the drag
 *    also `invalid argument`) is skipped: no pause, no re-check, the next
 *    step runs. Any other step error that is not fatal (for example
 *    WebDriverAgent's HTTP 500 "Did not know how to dismiss the keyboard")
 *    moves on to the next step after the pause and re-check. A fatal driver
 *    error ({@link isFatalDriverError}: dead session, lost connection, ...)
 *    of a step or of a re-check is thrown at once. A re-check that fails
 *    with an error that is not fatal counts as "still shown".
 * 4. When the keyboard is still shown after the last step, or
 *    `options.timeout` ms have passed before a step, it throws a
 *    {@link KeyboardStillShownError}:
 *    `dismissKeyboard: the keyboard is still shown after <steps tried>`
 *    (each skipped step followed by `(skipped: <error>)`, each failed step
 *    by `(failed: <error>)`, and the timeout when that ended the call).
 *
 * @param driver A WebdriverIO browser on an Appium session.
 * @param platform The platform; by default read from the driver's
 *   `platformName` capability, else WebdriverIO's `isIOS` / `isAndroid`.
 *   Only `'ios'` selects the iOS steps.
 * @param options `{ timeout? }`, see {@link DismissKeyboardOptions}.
 * @returns `true` when a keyboard was shown and is now gone, `false` when
 *   none was shown or the driver cannot tell.
 */
export async function dismissKeyboard(driver: any, platform?: Platform, options?: DismissKeyboardOptions): Promise<boolean> {
  const timeout = options?.timeout;
  if (timeout !== undefined && !(typeof timeout === 'number' && Number.isFinite(timeout) && timeout >= 0)) {
    throw new Error(`dismissKeyboard: options.timeout must be a non-negative number of ms, got ${String(timeout)}`);
  }
  const started = Date.now();
  if (typeof driver?.isKeyboardShown !== 'function') return false;
  try {
    if (!(await driver.isKeyboardShown())) return false;
  } catch (err) {
    // Only a fatal error is thrown; anything else means "cannot tell".
    if (!isUnsupported(err) && isFatalDriverError(err)) throw err;
    return false;
  }

  const tried: string[] = [];
  const names: string[] = [];
  const fail = (reason?: string): never => {
    const list = tried.length > 0 ? tried.join(', ') : 'no step';
    throw new KeyboardStillShownError(
      `dismissKeyboard: the keyboard is still shown after ${list}${reason ? ` (${reason})` : ''}`,
      names,
    );
  };

  for (const step of stepsFor(driver, platform ?? detectDriverPlatform(driver))) {
    if (!step.available) continue;
    if (timeout !== undefined && Date.now() - started >= timeout) fail(`timeout ${timeout} ms`);
    names.push(step.name);
    let failure: string | undefined;
    try {
      await step.run();
    } catch (err) {
      if (err instanceof StepRefused) {
        tried.push(`${step.name} (failed: ${err.message})`);
        continue;
      }
      if (step.skipsOn(err)) {
        tried.push(`${step.name} (skipped: ${messageOf(err)})`);
        continue;
      }
      if (isFatalDriverError(err)) throw err;
      failure = messageOf(err);
    }
    tried.push(failure === undefined ? step.name : `${step.name} (failed: ${failure})`);
    await pause(driver, KEYBOARD_SETTLE_MS);
    let shown: boolean;
    try {
      shown = !!(await driver.isKeyboardShown());
    } catch (err) {
      if (!isUnsupported(err) && isFatalDriverError(err)) throw err;
      shown = true;
    }
    if (!shown) return true;
  }
  return fail();
}
