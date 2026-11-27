/**
 * Soft keyboard dismissal on Appium drivers, shared by `PlatformElement`
 * (before a `scrollIntoView` sweep) and consumer packages.
 */
import type { Platform } from '../enum/Platform';
import { isFatalDriverError } from './driverErrors';
import { detectDriverPlatform } from './platformText';
import { isPlatform } from '../types/Element';
import type { Element } from '../types/Element';

/** Pause after each dismissal step before the keyboard is checked again, in ms (the keyboard's hide animation). */
export const KEYBOARD_SETTLE_MS = 300;

/**
 * Upper bound in ms of the iOS `tapElement` step: how long it waits for the
 * element to be shown, and then for the click, together. A `tapElement`
 * that is not shown within it (or within what is left of `options.timeout`,
 * when that is less) fails the step at once, leaving time for the
 * `mobile: hideKeyboard` steps.
 */
export const TAP_ELEMENT_WAIT_MS = 2000;

/**
 * Key names of the iOS "keys" step: the standard names of the keyboard's
 * action (return) key, in both spellings: Done, Return, Go, Search, Send and
 * Join. WebDriverAgent searches only the keyboard's own keys and buttons for
 * an identifier or label equal to one of them exactly, and taps every match
 * in element-tree order (not in the order of this list) until the keyboard
 * is gone. Tapping one may run the field's action: submit a form, start a
 * search, send a message. Next is deliberately not in the list: it moves the
 * focus to the next field and keeps the keyboard up.
 */
export const IOS_DISMISS_KEYS: readonly string[] = Object.freeze([
  'done', 'Done', 'return', 'Return', 'go', 'Go', 'search', 'Search', 'send', 'Send', 'join', 'Join',
]);

/** Options of {@link dismissKeyboard}. */
export interface DismissKeyboardOptions {
  /**
   * Upper bound in ms for the whole call. No new step starts once it has
   * passed (a step already running is not cut short), and the call throws
   * the "still shown" error. Default: no time bound; the steps bound it.
   */
  timeout?: number;
  /**
   * iOS only: a neutral element on the screen that does nothing when
   * tapped, such as a title label, named by the caller. When given, it is
   * tapped first (an element click) and the keyboard is checked again,
   * before any `mobile: hideKeyboard`, so a screen that ends editing on a
   * tap outside the field dismisses its keyboard without pressing the
   * keyboard's action key (which may submit a form or run a search). It
   * must be on screen and NOT covered by the keyboard (the screen title or
   * a navigation-bar label, say); otherwise its tap may land on a key.
   * It must be a platform
   * element (`isPlatform`), else the call throws before anything is sent.
   * The step waits for it to be shown at most {@link TAP_ELEMENT_WAIT_MS}
   * (or what is left of `timeout`, when that is less), then clicks it; one
   * not shown within that is a failed step, not fatal, and is not clicked.
   * The library never taps a coordinate of its own choosing. Android
   * ignores it.
   */
  tapElement?: Element;
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

/** A step that failed without performing its action (nothing reached the screen): no pause or re-check follows. */
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

function messageOf(err: unknown): string {
  const text = err instanceof Error ? err.message : String(err);
  return text.split('\n')[0].trim();
}

async function pause(driver: any, ms: number): Promise<void> {
  if (typeof driver?.pause === 'function') await driver.pause(ms);
  else await new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * iOS step "tap": an element click on the caller's neutral `tapElement`.
 * It first waits for the element to be shown, at most
 * {@link TAP_ELEMENT_WAIT_MS} or `timeLeft` when that is less (at least
 * 1 ms), through the element's own bounded wait, so a missing element costs
 * that bound and not the element's default timeout or WebdriverIO's implicit
 * wait. Not shown: the step fails at once, with no click, pause or re-check.
 * Shown: it is clicked with what is left of that bound. A click that fails
 * with an error that is not fatal did not tap: the step fails the same way.
 */
async function tapNeutralElement(tapElement: Element, timeLeft: number | undefined): Promise<void> {
  const started = Date.now();
  const bound = Math.max(1, Math.min(TAP_ELEMENT_WAIT_MS, timeLeft ?? TAP_ELEMENT_WAIT_MS));
  try {
    await tapElement.waitFor({ state: 'visible', timeout: bound });
    await tapElement.click({ timeout: Math.max(1, bound - (Date.now() - started)) });
  } catch (err) {
    if (isFatalDriverError(err)) throw err;
    throw new StepRefused(messageOf(err));
  }
}

/**
 * The platform's dismissal steps, in the order they run. Each entry is
 * self-contained, so the order can be changed by moving entries.
 *
 * iOS never sends a gesture of its own (no drag, no coordinate tap): a drag
 * from above the keyboard was tried and dropped. On the iOS simulator it
 * never dismissed the keyboard of a form, and its start point lands on the
 * keyboard's input assistant bar (the "Passwords" button above a login
 * form's keyboard), a control no step may press.
 */
function stepsFor(
  driver: any, platform: Platform | undefined, tapElement: Element | undefined, timeLeft: () => number | undefined,
): Step[] {
  const canExecute = typeof driver?.execute === 'function';
  if (platform === 'ios') {
    const steps: Step[] = [];
    if (tapElement !== undefined) {
      steps.push({
        name: `a tap on options.tapElement "${tapElement.selector}"`,
        available: true,
        run: () => tapNeutralElement(tapElement, timeLeft()),
        skipsOn: () => false,
      });
    }
    steps.push(
      {
        // Before the keys step: on an iPad this taps the keyboard's hide
        // key, where the keys step would press the action key instead. On
        // an iPhone keyboard without a Done key WebDriverAgent refuses it
        // after about 3.5 s (iOS simulator): that is its cost.
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
    );
    return steps;
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
 *    - iOS (XCUITest). The library sends no gesture of its own here: no
 *      drag, no tap at a coordinate.
 *      1. Only with `options.tapElement`: an element click on that neutral
 *         element (a title label, ...), which dismisses the keyboard of a
 *         screen that ends editing on a tap outside the field, without
 *         pressing the keyboard's action key. It must be on screen and not
 *         covered by the keyboard, else the tap may land on a key. The step
 *         waits at most {@link TAP_ELEMENT_WAIT_MS} (or what is left of
 *         `options.timeout`, when less) for it to be shown, then clicks it.
 *         Not shown (or any other error that is not fatal): the step fails,
 *         with no click, pause or re-check.
 *      2. `mobile: hideKeyboard` with no keys. XCUITest adds the key name
 *         `done` itself; on an iPad WebDriverAgent also taps the keyboard's
 *         hide key. On an iPhone keyboard without a Done key WebDriverAgent
 *         refuses it ("Did not know how to dismiss the keyboard") after
 *         about 3.5 s (iOS simulator): that is the cost of this step. It
 *         stays before step 3 because on an iPad step 3 would press the
 *         action key instead of the hide key.
 *      3. `mobile: hideKeyboard` with `keys` {@link IOS_DISMISS_KEYS} (the
 *         action-key names done, return, go, search, send and join, each
 *         lower-case and capitalised): WebDriverAgent taps the keyboard key
 *         whose identifier or label is one of them (searching the keyboard's
 *         own keys and buttons only, every match in element-tree order until
 *         the keyboard is gone). **This presses the
 *         keyboard's action key, which can submit a form, run a search or
 *         send a message**; a caller who must not trigger the field's
 *         action passes `options.tapElement`. Next is not in the list (it
 *         moves the focus and keeps the keyboard up).
 *    - Android, and any other platform: WebdriverIO `hideKeyboard()`, then
 *      `mobile: hideKeyboard` with `{ strategy: 'pressKey', key: 'return' }`,
 *      then with `{ strategy: 'tapOutside' }` (the commands the platform
 *      element's pre-scroll dismissal has always sent). `tapElement` is
 *      ignored.
 *
 *    Verified on the iOS SIMULATOR only (a login form whose keyboard has a
 *    Return key and no Done key: the bare call was refused, the keys step
 *    dismissed it and the text was kept); real iPhone verification is
 *    pending. The Android steps are unchanged and covered by unit tests.
 * 3. A step the driver answers as unsupported (`unknown command`, `unknown
 *    method`, `unsupported operation`, "not (yet) implemented") is skipped:
 *    no pause or re-check, the next step runs. A step that fails without
 *    performing its action (a `tapElement` not found) is named as failed,
 *    also with no pause or re-check. Any other step error that is not fatal
 *    (for example WebDriverAgent's "Did not know how to dismiss the
 *    keyboard") moves on to the next step after the pause and re-check. A
 *    fatal driver error ({@link isFatalDriverError}: dead session, lost
 *    connection, ...) of a step or of a re-check is thrown at once. A
 *    re-check that fails with an error that is not fatal counts as "still
 *    shown".
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
 * @param options `{ timeout?, tapElement? }`, see {@link DismissKeyboardOptions}.
 *   A `tapElement` that is not a platform element throws before anything
 *   is sent.
 * @returns `true` when a keyboard was shown and is now gone, `false` when
 *   none was shown or the driver cannot tell.
 */
export async function dismissKeyboard(driver: any, platform?: Platform, options?: DismissKeyboardOptions): Promise<boolean> {
  const timeout = options?.timeout;
  if (timeout !== undefined && !(typeof timeout === 'number' && Number.isFinite(timeout) && timeout >= 0)) {
    throw new Error(`dismissKeyboard: options.timeout must be a non-negative number of ms, got ${String(timeout)}`);
  }
  const tapElement = options?.tapElement;
  if (tapElement !== undefined && !(tapElement && typeof tapElement === 'object' && isPlatform(tapElement))) {
    throw new Error('dismissKeyboard: options.tapElement must be a platform element');
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

  const timeLeft = (): number | undefined => (timeout === undefined ? undefined : Math.max(0, timeout - (Date.now() - started)));
  for (const step of stepsFor(driver, platform ?? detectDriverPlatform(driver), tapElement, timeLeft)) {
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
