import { test, expect } from '@playwright/test';
import { dismissKeyboard, KeyboardStillShownError, KEYBOARD_SETTLE_MS, IOS_DISMISS_KEYS } from '../src';
import { PlatformElement } from '../src/types';

// ---------------------------------------------------------------------------
// dismissKeyboard: hides a shown soft keyboard with the platform's steps,
// re-checking after each one. Mock drivers model WebDriverAgent, which
// answers `mobile: hideKeyboard` with HTTP 500 "Did not know how to dismiss
// the keyboard" when it finds no key it knows (a keyboard without a Done
// key), and UiAutomator2.
// ---------------------------------------------------------------------------

const WDA_REFUSAL = 'Did not know how to dismiss the keyboard. Try to dismiss it in the way supported by your application under test.';
const WINDOW = { width: 393, height: 852 };
const KEYBOARD_RECT = { x: 0, y: 516, width: 393, height: 336 };

/** An error as WebdriverIO raises it for a driver answer: `name` is the W3C error code. */
function driverError(message: string, name = 'unknown error'): Error {
  const err = new Error(message);
  err.name = name;
  return err;
}

type Call = string;
type Outcome = 'dismiss' | 'refuse' | 'noop' | Error;

/**
 * A fake Appium driver with a keyboard that is shown until a step whose
 * outcome is `dismiss` runs. `outcomes` maps a call name (`bare`, `keys`,
 * `drag`, `hideKeyboard`, `pressKey`, `tapOutside`) to what it does:
 * `refuse` throws WebDriverAgent's refusal, `noop` succeeds but leaves the
 * keyboard up, an Error is thrown as given. Unlisted calls are `noop`.
 */
function fakeDriver(options: {
  shown?: boolean;
  outcomes?: Partial<Record<string, Outcome>>;
  caps?: Record<string, unknown>;
  isKeyboardShown?: () => Promise<boolean>;
  omit?: string[];
}) {
  let shown = options.shown ?? true;
  const calls: Call[] = [];
  const executes: Array<[string, unknown]> = [];
  const pauses: number[] = [];
  const actions: any[] = [];
  const act = async (name: string) => {
    calls.push(name);
    const outcome = options.outcomes?.[name] ?? 'noop';
    if (outcome instanceof Error) throw outcome;
    if (outcome === 'refuse') throw driverError(WDA_REFUSAL);
    if (outcome === 'dismiss') shown = false;
  };
  const driver: Record<string, any> = {
    capabilities: options.caps ?? {},
    isKeyboardShown: options.isKeyboardShown ?? (async () => { calls.push('isKeyboardShown'); return shown; }),
    hideKeyboard: () => act('hideKeyboard'),
    execute: async (script: string, args: any) => {
      executes.push([script, args]);
      if (script !== 'mobile: hideKeyboard') throw new Error(`unexpected script ${script}`);
      if (args?.keys) return act('keys');
      if (args?.strategy === 'pressKey') return act('pressKey');
      if (args?.strategy === 'tapOutside') return act('tapOutside');
      return act('bare');
    },
    $: async (selector: string) => {
      calls.push(`$ ${selector}`);
      return { elementId: 'kb-1' };
    },
    getElementRect: async () => KEYBOARD_RECT,
    getWindowSize: async () => WINDOW,
    performActions: async (sources: any[]) => { actions.push(sources); await act('drag'); },
    releaseActions: async () => { calls.push('releaseActions'); },
    pause: async (ms: number) => { pauses.push(ms); },
  };
  for (const key of options.omit ?? []) delete driver[key];
  return { driver, calls, executes, pauses, actions, isShown: () => shown };
}

const dismissing = (calls: Call[]) => calls.filter(c => c !== 'isKeyboardShown' && !c.startsWith('$ ') && c !== 'releaseActions');

test.describe('dismissKeyboard: no keyboard', () => {
  test('no keyboard shown: false at once, nothing but the check is sent', async () => {
    const { driver, calls, executes, pauses } = fakeDriver({ shown: false });
    expect(await dismissKeyboard(driver, 'ios')).toBe(false);
    expect(calls).toEqual(['isKeyboardShown']);
    expect(executes).toEqual([]);
    expect(pauses).toEqual([]);
  });

  test('no keyboard shown on android: false, no hideKeyboard', async () => {
    const { driver, calls } = fakeDriver({ shown: false });
    expect(await dismissKeyboard(driver, 'android')).toBe(false);
    expect(calls).toEqual(['isKeyboardShown']);
  });

  test('a driver without isKeyboardShown cannot tell: false, nothing sent', async () => {
    const { driver, calls, executes } = fakeDriver({ omit: ['isKeyboardShown'] });
    expect(await dismissKeyboard(driver, 'ios')).toBe(false);
    expect(calls).toEqual([]);
    expect(executes).toEqual([]);
  });

  test('isKeyboardShown answered "unknown command" or "not implemented": false, nothing sent', async () => {
    for (const err of [
      driverError('The requested resource could not be found', 'unknown command'),
      driverError('Method has not yet been implemented'),
    ]) {
      const { driver, calls, executes } = fakeDriver({ isKeyboardShown: async () => { throw err; } });
      expect(await dismissKeyboard(driver, 'ios')).toBe(false);
      expect(calls).toEqual([]);
      expect(executes).toEqual([]);
    }
  });

  test('any other error of the first check is thrown, before any step', async () => {
    const dead = driverError('A session is either terminated or not started', 'invalid session id');
    const { driver, executes } = fakeDriver({ isKeyboardShown: async () => { throw dead; } });
    await expect(dismissKeyboard(driver, 'ios')).rejects.toBe(dead);
    expect(executes).toEqual([]);

    const odd = driverError('something odd');
    const second = fakeDriver({ isKeyboardShown: async () => { throw odd; } });
    await expect(dismissKeyboard(second.driver, 'ios')).rejects.toBe(odd);
    expect(second.executes).toEqual([]);
  });
});

test.describe('dismissKeyboard: iOS steps', () => {
  test('the bare call dismisses: true after one step', async () => {
    const { driver, calls, executes, pauses } = fakeDriver({ outcomes: { bare: 'dismiss' } });
    expect(await dismissKeyboard(driver, 'ios')).toBe(true);
    expect(executes).toEqual([['mobile: hideKeyboard', {}]]);
    expect(calls).toEqual(['isKeyboardShown', 'bare', 'isKeyboardShown']);
    expect(pauses).toEqual([KEYBOARD_SETTLE_MS]);
  });

  test('WebDriverAgent refuses the bare call (HTTP 500), the keys succeed: true, no drag', async () => {
    const { driver, calls, executes, actions } = fakeDriver({ outcomes: { bare: 'refuse', keys: 'dismiss' } });
    expect(await dismissKeyboard(driver, 'ios')).toBe(true);
    expect(executes).toEqual([
      ['mobile: hideKeyboard', {}],
      ['mobile: hideKeyboard', { keys: ['return', 'Return', 'done', 'Done'] }],
    ]);
    expect(IOS_DISMISS_KEYS).toEqual(['return', 'Return', 'done', 'Done']);
    expect(dismissing(calls)).toEqual(['bare', 'keys']);
    expect(actions).toEqual([]);
  });

  test('bare and keys refused, the drag onto the keyboard dismisses: true', async () => {
    const { driver, calls, actions } = fakeDriver({ outcomes: { bare: 'refuse', keys: 'refuse', drag: 'dismiss' } });
    expect(await dismissKeyboard(driver, 'ios')).toBe(true);
    expect(dismissing(calls)).toEqual(['bare', 'keys', 'drag']);
    expect(calls).toContain('$ -ios class chain:**/XCUIElementTypeKeyboard');
    expect(calls).toContain('releaseActions');
    // From 30 pt above the keyboard's top (516) to 10 pt above the window's
    // bottom (852), on the centre line (393 / 2 -> 197), moving, never a tap.
    expect(actions).toHaveLength(1);
    expect(actions[0][0].actions).toEqual([
      { type: 'pointerMove', duration: 0, origin: 'viewport', x: 197, y: 486 },
      { type: 'pointerDown', button: 0 },
      { type: 'pause', duration: 50 },
      { type: 'pointerMove', duration: 300, origin: 'viewport', x: 197, y: 842 },
      { type: 'pointerUp', button: 0 },
    ]);
  });

  test('a step that succeeds but leaves the keyboard up moves on to the next', async () => {
    const { driver, calls } = fakeDriver({ outcomes: { bare: 'noop', keys: 'noop', drag: 'dismiss' } });
    expect(await dismissKeyboard(driver, 'ios')).toBe(true);
    expect(dismissing(calls)).toEqual(['bare', 'keys', 'drag']);
  });

  test('nothing works: throws "still shown" naming every step and its error', async () => {
    const { driver, calls, pauses } = fakeDriver({ outcomes: { bare: 'refuse', keys: 'refuse', drag: 'noop' } });
    const err = await dismissKeyboard(driver, 'ios').then(() => null, (e: unknown) => e);
    expect(err).toBeInstanceOf(KeyboardStillShownError);
    expect((err as Error).message).toBe(
      'dismissKeyboard: the keyboard is still shown after ' +
      `mobile: hideKeyboard (failed: ${WDA_REFUSAL}), ` +
      `mobile: hideKeyboard { keys: ['return', 'Return', 'done', 'Done'] } (failed: ${WDA_REFUSAL}), ` +
      'a drag from above the keyboard down onto it',
    );
    expect((err as KeyboardStillShownError).steps).toEqual([
      'mobile: hideKeyboard',
      "mobile: hideKeyboard { keys: ['return', 'Return', 'done', 'Done'] }",
      'a drag from above the keyboard down onto it',
    ]);
    expect(dismissing(calls)).toEqual(['bare', 'keys', 'drag']);
    expect(pauses).toEqual([KEYBOARD_SETTLE_MS, KEYBOARD_SETTLE_MS, KEYBOARD_SETTLE_MS]);
  });

  test('a keyboard element that cannot be found fails the drag step, not the call: still shown', async () => {
    const { driver } = fakeDriver({ outcomes: { bare: 'refuse', keys: 'refuse' } });
    driver.$ = async () => ({ selector: 'gone' });
    await expect(dismissKeyboard(driver, 'ios')).rejects.toThrow(
      /, a drag from above the keyboard down onto it \(failed: the keyboard element was not found\)$/,
    );
  });

  test('a fatal driver error of a step is thrown at once: no further step', async () => {
    const dead = driverError('A session is either terminated or not started', 'invalid session id');
    const { driver, calls } = fakeDriver({ outcomes: { bare: dead } });
    await expect(dismissKeyboard(driver, 'ios')).rejects.toBe(dead);
    expect(dismissing(calls)).toEqual(['bare']);
  });

  test('a fatal driver error of the keys step is thrown at once: no drag', async () => {
    const lost = driverError('connect ECONNREFUSED <appium-server>');
    const { driver, calls, actions } = fakeDriver({ outcomes: { bare: 'refuse', keys: lost } });
    await expect(dismissKeyboard(driver, 'ios')).rejects.toBe(lost);
    expect(dismissing(calls)).toEqual(['bare', 'keys']);
    expect(actions).toEqual([]);
  });

  test('a fatal error of a re-check is thrown; a non-fatal one counts as still shown', async () => {
    let checks = 0;
    const dead = driverError('A session is either terminated or not started', 'invalid session id');
    const fatal = fakeDriver({ isKeyboardShown: async () => { if (checks++ === 0) return true; throw dead; } });
    await expect(dismissKeyboard(fatal.driver, 'ios')).rejects.toBe(dead);
    expect(fatal.executes).toHaveLength(1);

    let reads = 0;
    const flaky = fakeDriver({});
    flaky.driver.isKeyboardShown = async () => {
      reads++;
      if (reads === 1) return true;
      if (reads === 2) throw driverError('stale element reference', 'stale element reference');
      return false;
    };
    expect(await dismissKeyboard(flaky.driver, 'ios')).toBe(true);
    expect(flaky.executes).toHaveLength(2);
  });

  test('the platform is read from the driver when not given', async () => {
    const { driver, executes } = fakeDriver({ caps: { platformName: 'iOS' }, outcomes: { bare: 'refuse', keys: 'dismiss' } });
    expect(await dismissKeyboard(driver)).toBe(true);
    expect(executes.map(e => e[1])).toEqual([{}, { keys: ['return', 'Return', 'done', 'Done'] }]);
  });
});

test.describe('dismissKeyboard: timeout', () => {
  test('timeout 0: no step starts, throws "still shown" with the timeout', async () => {
    const { driver, executes } = fakeDriver({});
    await expect(dismissKeyboard(driver, 'ios', { timeout: 0 }))
      .rejects.toThrow('dismissKeyboard: the keyboard is still shown after no step (timeout 0 ms)');
    expect(executes).toEqual([]);
  });

  test('no new step starts once the timeout has passed', async () => {
    const { driver, executes } = fakeDriver({});
    driver.pause = async () => { await new Promise(r => setTimeout(r, 60)); };
    await expect(dismissKeyboard(driver, 'ios', { timeout: 30 }))
      .rejects.toThrow('dismissKeyboard: the keyboard is still shown after mobile: hideKeyboard (timeout 30 ms)');
    expect(executes).toHaveLength(1);
  });

  test('an invalid timeout is refused before anything is sent', async () => {
    for (const timeout of [-1, Number.NaN, Infinity, '100' as unknown as number]) {
      const { driver, calls } = fakeDriver({});
      await expect(dismissKeyboard(driver, 'ios', { timeout })).rejects.toThrow(/options\.timeout must be a non-negative number/);
      expect(calls).toEqual([]);
    }
  });
});

test.describe('dismissKeyboard: Android steps (unchanged commands)', () => {
  test('hideKeyboard() dismisses: true, no mobile: command', async () => {
    const { driver, calls, executes } = fakeDriver({ outcomes: { hideKeyboard: 'dismiss' } });
    expect(await dismissKeyboard(driver, 'android')).toBe(true);
    expect(dismissing(calls)).toEqual(['hideKeyboard']);
    expect(executes).toEqual([]);
  });

  test('hideKeyboard() fails (not fatal): the mobile: hideKeyboard steps follow in order', async () => {
    const { driver, calls, executes } = fakeDriver({
      outcomes: { hideKeyboard: driverError('The software keyboard cannot be hidden'), pressKey: 'noop', tapOutside: 'dismiss' },
    });
    expect(await dismissKeyboard(driver, 'android')).toBe(true);
    expect(dismissing(calls)).toEqual(['hideKeyboard', 'pressKey', 'tapOutside']);
    expect(executes).toEqual([
      ['mobile: hideKeyboard', { strategy: 'pressKey', key: 'return' }],
      ['mobile: hideKeyboard', { strategy: 'tapOutside' }],
    ]);
  });

  test('nothing works: throws "still shown" naming the Android steps; no drag, no keys', async () => {
    const { driver, actions } = fakeDriver({ caps: { platformName: 'Android' } });
    await expect(dismissKeyboard(driver)).rejects.toThrow(
      "dismissKeyboard: the keyboard is still shown after hideKeyboard(), mobile: hideKeyboard { strategy: 'pressKey', key: 'return' }, mobile: hideKeyboard { strategy: 'tapOutside' }",
    );
    expect(actions).toEqual([]);
  });

  test('a driver without hideKeyboard skips that step', async () => {
    const { driver, calls } = fakeDriver({ omit: ['hideKeyboard'], outcomes: { pressKey: 'dismiss' } });
    expect(await dismissKeyboard(driver, 'android')).toBe(true);
    expect(dismissing(calls)).toEqual(['pressKey']);
  });

  test('a fatal error of hideKeyboard() is thrown at once', async () => {
    const gone = driverError('instrumentation process is not running (probably crashed)');
    const { driver, executes } = fakeDriver({ outcomes: { hideKeyboard: gone } });
    await expect(dismissKeyboard(driver, 'android')).rejects.toBe(gone);
    expect(executes).toEqual([]);
  });
});

test.describe('PlatformElement.scrollIntoView dismisses the keyboard first', () => {
  /** A target that is never displayed, so the sweep runs to its swipe limit after the dismissal. */
  function sweepDriver(outcomes: Partial<Record<string, Outcome>>) {
    const fake = fakeDriver({ outcomes });
    const swipes: number[] = [];
    fake.driver.$ = async (selector: string) => (selector.includes('XCUIElementTypeKeyboard')
      ? { elementId: 'kb-1' }
      : { selector, isDisplayed: async () => false, waitForExist: async () => false });
    fake.driver.$$ = async () => [];
    const performActions = fake.driver.performActions;
    fake.driver.performActions = async (sources: any[]) => {
      // The dismissal drag ends near the window bottom; sweep swipes do not.
      if (sources[0].actions[3].y === WINDOW.height - 10) return performActions(sources);
      swipes.push(1);
    };
    return { ...fake, swipes };
  }
  const target = (driver: any) => new PlatformElement(driver, '~row-40', undefined, 200, { platform: 'ios' });

  test('the keyboard is dismissed, then the sweep runs', async () => {
    const { driver, calls, swipes } = sweepDriver({ bare: 'refuse', keys: 'dismiss' });
    await expect(target(driver).scrollIntoView({ maxSwipes: 2 })).rejects.toThrow(/after 2 swipes, the swipe limit/);
    expect(dismissing(calls)).toEqual(['bare', 'keys']);
    expect(swipes).toHaveLength(2);
  });

  test('a keyboard still shown after every step does not fail the call: the sweep runs anyway', async () => {
    const { driver, calls, swipes, isShown } = sweepDriver({ bare: 'refuse', keys: 'refuse', drag: 'noop' });
    await expect(target(driver).scrollIntoView({ maxSwipes: 2 })).rejects.toThrow(/after 2 swipes, the swipe limit/);
    expect(dismissing(calls)).toEqual(['bare', 'keys', 'drag']);
    expect(isShown()).toBe(true);
    expect(swipes).toHaveLength(2);
  });

  test('a fatal driver error of the dismissal is thrown, before any swipe', async () => {
    const dead = driverError('A session is either terminated or not started', 'invalid session id');
    const { driver, swipes } = sweepDriver({ bare: dead });
    await expect(target(driver).scrollIntoView({ maxSwipes: 2 })).rejects.toThrow(/terminated or not started/);
    expect(swipes).toEqual([]);
  });
});
