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
 * Key names (identifier or label, matched exactly by WebDriverAgent) of the
 * key the iOS step "keys" taps: the default return key (identifier `Return`,
 * label `return`) and the Done key, in both spellings.
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

interface Step {
  name: string;
  /** False when the driver has no command for the step: it is skipped. */
  available: boolean;
  run: () => Promise<unknown>;
}

const UNSUPPORTED_NAMES = new Set([
  'unknown command', 'UnknownCommandError', 'unknown method', 'UnknownMethodError',
  'unsupported operation', 'UnsupportedOperationError', 'NotYetImplementedError', 'NotImplementedError',
]);
const UNSUPPORTED_MESSAGE = /unknown command|not (yet )?(been )?implemented/i;

/** True when the driver's answer says it has no such command (it cannot tell whether a keyboard is shown). */
function isUnsupported(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const { name, message } = err as { name?: unknown; message?: unknown };
  return (typeof name === 'string' && UNSUPPORTED_NAMES.has(name))
    || (typeof message === 'string' && UNSUPPORTED_MESSAGE.test(message));
}

function messageOf(err: unknown): string {
  const text = err instanceof Error ? err.message : String(err);
  return text.split('\n')[0].trim();
}

async function pause(driver: any, ms: number): Promise<void> {
  if (typeof driver?.pause === 'function') await driver.pause(ms);
  else await new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * iOS step 3: a drag from just above the keyboard down onto it, the gesture
 * a user makes to pull the keyboard away. It dismisses the keyboard of a
 * scroll view whose `keyboardDismissMode` is `interactive` or `onDrag` (and
 * SwiftUI `scrollDismissesKeyboard`). It starts 30 pt above the keyboard's
 * top edge on the window's vertical centre line and ends 10 pt above the
 * window's bottom, moving the whole time, so it never ends as a tap on what
 * is under its start point.
 */
async function dragOntoKeyboard(driver: any): Promise<void> {
  const keyboard = await driver.$('-ios class chain:**/XCUIElementTypeKeyboard');
  if (!keyboard?.elementId) throw new Error('the keyboard element was not found');
  const rect = await driver.getElementRect(keyboard.elementId);
  const size = await driver.getWindowSize();
  const x = Math.round(size.width / 2);
  const from = { x, y: Math.max(1, Math.round(rect.y - 30)) };
  const to = { x, y: Math.max(from.y + 1, Math.round(size.height - 10)) };
  await performTouchSwipe(driver, from, to, { holdMs: 50, moveMs: 300 });
}

function stepsFor(driver: any, platform: Platform | undefined): Step[] {
  const canExecute = typeof driver?.execute === 'function';
  if (platform === 'ios') {
    return [
      { name: 'mobile: hideKeyboard', available: canExecute, run: () => driver.execute('mobile: hideKeyboard', {}) },
      {
        name: `mobile: hideKeyboard { keys: [${IOS_DISMISS_KEYS.map(k => `'${k}'`).join(', ')}] }`,
        available: canExecute,
        run: () => driver.execute('mobile: hideKeyboard', { keys: [...IOS_DISMISS_KEYS] }),
      },
      {
        name: 'a drag from above the keyboard down onto it',
        available: typeof driver?.performActions === 'function' && typeof driver?.$ === 'function',
        run: () => dragOntoKeyboard(driver),
      },
    ];
  }
  // Android and every other platform: the commands the platform element has
  // always sent, unchanged.
  return [
    { name: 'hideKeyboard()', available: typeof driver?.hideKeyboard === 'function', run: () => driver.hideKeyboard() },
    {
      name: "mobile: hideKeyboard { strategy: 'pressKey', key: 'return' }",
      available: canExecute,
      run: () => driver.execute('mobile: hideKeyboard', { strategy: 'pressKey', key: 'return' }),
    },
    {
      name: "mobile: hideKeyboard { strategy: 'tapOutside' }",
      available: canExecute,
      run: () => driver.execute('mobile: hideKeyboard', { strategy: 'tapOutside' }),
    },
  ];
}

/**
 * Hides the soft keyboard, if one is shown, with the platform's dismissal
 * steps, and says whether it had to.
 *
 * 1. It asks `driver.isKeyboardShown()`. No keyboard: returns `false` at
 *    once, sending nothing else. A driver without `isKeyboardShown`, or one
 *    that answers it with `unknown command` / `unknown method` /
 *    `unsupported operation` / "not (yet) implemented" (a driver that
 *    cannot tell), also returns `false`
 *    without sending anything. Any other error of that first check is
 *    thrown.
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
 *         field that dismisses on Return (or submits on it) does so here.
 *      3. A drag from 30 pt above the keyboard's top edge down to 10 pt
 *         above the window's bottom, on the window's vertical centre line
 *         (50 ms hold, 300 ms move, no tap). It dismisses the keyboard of a
 *         scroll view with interactive / on-drag keyboard dismissal; such a
 *         scroll view may also scroll (or bounce) with the drag.
 *    - Android, and any other platform: WebdriverIO `hideKeyboard()`, then
 *      `mobile: hideKeyboard` with `{ strategy: 'pressKey', key: 'return' }`,
 *      then with `{ strategy: 'tapOutside' }` (the commands the platform
 *      element's pre-scroll dismissal has always sent).
 * 3. A step error that is not fatal (for example WebDriverAgent's HTTP 500
 *    "Did not know how to dismiss the keyboard") moves on to the next step.
 *    A fatal driver error ({@link isFatalDriverError}: dead session, lost
 *    connection, unknown command, ...) of a step or of a re-check is thrown
 *    at once. A re-check that fails with a non-fatal error counts as "still
 *    shown".
 * 4. When the keyboard is still shown after the last step, or
 *    `options.timeout` ms have passed before a step, it throws a
 *    {@link KeyboardStillShownError}:
 *    `dismissKeyboard: the keyboard is still shown after <steps tried>`
 *    (each failed step followed by its error, and the timeout when that
 *    ended the call).
 *
 * @param driver A WebdriverIO browser on an Appium session.
 * @param platform The platform; by default read from the driver's
 *   `platformName` capability, else WebdriverIO's `isIOS` / `isAndroid`.
 *   Only `'ios'` selects the iOS steps.
 * @param options `{ timeout? }`, see {@link DismissKeyboardOptions}.
 * @returns `true` when a keyboard was shown and is now gone, `false` when
 *   none was shown.
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
    if (isUnsupported(err)) return false;
    throw err;
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
      if (isFatalDriverError(err)) throw err;
      failure = messageOf(err);
    }
    tried.push(failure === undefined ? step.name : `${step.name} (failed: ${failure})`);
    await pause(driver, KEYBOARD_SETTLE_MS);
    let shown: boolean;
    try {
      shown = !!(await driver.isKeyboardShown());
    } catch (err) {
      if (isFatalDriverError(err)) throw err;
      shown = true;
    }
    if (!shown) return true;
  }
  return fail();
}
