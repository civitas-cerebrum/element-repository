import { test, expect } from '@playwright/test';
import { dismissKeyboard, KeyboardStillShownError, KEYBOARD_SETTLE_MS, IOS_DISMISS_KEYS, TAP_ELEMENT_WAIT_MS } from '../src';
import { PlatformElement } from '../src/types';

// ---------------------------------------------------------------------------
// dismissKeyboard: hides a shown soft keyboard with the platform's steps,
// re-checking after each one. Mock drivers model WebDriverAgent, which
// answers `mobile: hideKeyboard` with "Did not know how to dismiss the
// keyboard" when it finds no key it knows (a keyboard without a Done key),
// and UiAutomator2.
// ---------------------------------------------------------------------------

const WDA_REFUSAL = 'Did not know how to dismiss the keyboard. Try to dismiss it in the way supported by your application under test.';
/** The key names of the iOS keys step, in order. */
const KEYS = ['done', 'Done', 'return', 'Return', 'go', 'Go', 'search', 'Search', 'send', 'Send', 'join', 'Join'];
const KEYS_STEP = `mobile: hideKeyboard { keys: [${KEYS.map(k => `'${k}'`).join(', ')}] }`;
/** The selector of a neutral label the caller names as `tapElement`. */
const TAP_SELECTOR = '~login-title';
/** A selector the fake driver finds nothing for. */
const MISSING_SELECTOR = '~gone';
/** WebdriverIO's error for a visible wait on an element that never appears. */
const notDisplayed = (ms: number | undefined) => `element ("${MISSING_SELECTOR}") still not displayed after ${ms}ms`;

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
 * outcome is `dismiss` runs. `outcomes` maps a call name (`tap`, `bare`,
 * `keys`, `hideKeyboard`, `pressKey`, `tapOutside`) to what it does:
 * `refuse` throws WebDriverAgent's refusal, `noop` succeeds but leaves the
 * keyboard up, an Error is thrown as given. Unlisted calls are `noop`.
 * `tap` is a click on the element {@link TAP_SELECTOR} finds; the element
 * {@link MISSING_SELECTOR} finds does not exist. With `slowMissing`, the
 * waits on that missing element take their whole timeout in real time, as
 * WebdriverIO's do; otherwise they fail at once.
 */
function fakeDriver(options: {
  shown?: boolean;
  outcomes?: Partial<Record<string, Outcome>>;
  caps?: Record<string, unknown>;
  isKeyboardShown?: () => Promise<boolean>;
  omit?: string[];
  slowMissing?: boolean;
}) {
  let shown = options.shown ?? true;
  const calls: Call[] = [];
  const executes: Array<[string, unknown]> = [];
  const pauses: number[] = [];
  const actions: any[] = [];
  const finds: string[] = [];
  const waits: Array<number | undefined> = [];
  const displayWaits: Array<number | undefined> = [];
  const sleep = async (ms: number | undefined) => {
    if (options.slowMissing && ms !== undefined) await new Promise(resolve => setTimeout(resolve, ms));
  };
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
      finds.push(selector);
      if (selector === TAP_SELECTOR) {
        return {
          elementId: 'title-1',
          waitForExist: async (o?: { timeout?: number }) => { waits.push(o?.timeout); return true; },
          waitForDisplayed: async (o?: { timeout?: number }) => { displayWaits.push(o?.timeout); return true; },
          click: () => act('tap'),
        };
      }
      return {
        selector,
        waitForExist: async (o?: { timeout?: number }) => {
          waits.push(o?.timeout); await sleep(o?.timeout); throw new Error('element still not existing');
        },
        waitForDisplayed: async (o?: { timeout?: number }) => {
          displayWaits.push(o?.timeout); await sleep(o?.timeout); throw new Error(notDisplayed(o?.timeout));
        },
        click: async () => {
          calls.push('missing click');
          throw new Error(`Can't call click on element with selector "${MISSING_SELECTOR}" because element wasn't found`);
        },
      };
    },
    performActions: async (sources: any[]) => { actions.push(sources); },
    releaseActions: async () => { calls.push('releaseActions'); },
    pause: async (ms: number) => { pauses.push(ms); },
  };
  for (const key of options.omit ?? []) delete driver[key];
  return { driver, calls, executes, pauses, actions, finds, waits, displayWaits, isShown: () => shown };
}

const dismissing = (calls: Call[]) => calls.filter(c => c !== 'isKeyboardShown' && c !== 'releaseActions');

/** A platform element on the fake driver, as a caller names it for `tapElement`. */
const label = (driver: any, selector = TAP_SELECTOR) => new PlatformElement(driver, selector, undefined, 200, { platform: 'ios' });

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

  test('a fatal error of the first check is thrown, before any step', async () => {
    for (const err of [
      driverError('A session is either terminated or not started', 'invalid session id'),
      driverError('connect ECONNREFUSED <appium-server>'),
    ]) {
      const { driver, executes } = fakeDriver({ isKeyboardShown: async () => { throw err; } });
      await expect(dismissKeyboard(driver, 'ios')).rejects.toBe(err);
      expect(executes).toEqual([]);
    }
  });

  test('a non-fatal error of the first check means "cannot tell": false, nothing sent', async () => {
    for (const err of [
      driverError('something odd'),
      driverError('Unknown mobile command "mobile: isKeyboardShown"', 'unknown method'),
      driverError('Operation not supported', 'unsupported operation'),
    ]) {
      const { driver, calls, executes, pauses } = fakeDriver({ isKeyboardShown: async () => { throw err; } });
      expect(await dismissKeyboard(driver, 'ios')).toBe(false);
      expect(calls).toEqual([]);
      expect(executes).toEqual([]);
      expect(pauses).toEqual([]);
    }
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

  test('WebDriverAgent refuses the bare call, the keys succeed: true, nothing else sent', async () => {
    const { driver, calls, executes, actions, finds } = fakeDriver({ outcomes: { bare: 'refuse', keys: 'dismiss' } });
    expect(await dismissKeyboard(driver, 'ios')).toBe(true);
    expect(executes).toEqual([
      ['mobile: hideKeyboard', {}],
      ['mobile: hideKeyboard', { keys: KEYS }],
    ]);
    expect(dismissing(calls)).toEqual(['bare', 'keys']);
    expect(actions).toEqual([]);
    expect(finds).toEqual([]);
  });

  test('IOS_DISMISS_KEYS: the standard action-key names in both cases, never Next', () => {
    expect(IOS_DISMISS_KEYS).toEqual(KEYS);
    expect(Object.isFrozen(IOS_DISMISS_KEYS)).toBe(true);
    expect(IOS_DISMISS_KEYS).not.toContain('next');
    expect(IOS_DISMISS_KEYS).not.toContain('Next');
  });

  test('the keys step sends a copy of the list: a caller cannot change what is sent next time', async () => {
    const { driver, executes } = fakeDriver({ outcomes: { bare: 'refuse', keys: 'noop' } });
    await dismissKeyboard(driver, 'ios').catch(() => {});
    const sent = (executes[1][1] as { keys: string[] }).keys;
    expect(sent).not.toBe(IOS_DISMISS_KEYS);
    expect(sent).toEqual(KEYS);
  });

  test('nothing works: throws "still shown" naming the two hideKeyboard steps; no drag or keyboard lookup is ever sent', async () => {
    const { driver, calls, pauses, actions, finds } = fakeDriver({ outcomes: { bare: 'refuse', keys: 'refuse' } });
    const err = await dismissKeyboard(driver, 'ios').then(() => null, (e: unknown) => e);
    expect(err).toBeInstanceOf(KeyboardStillShownError);
    expect((err as Error).message).toBe(
      'dismissKeyboard: the keyboard is still shown after ' +
      `mobile: hideKeyboard (failed: ${WDA_REFUSAL}), ` +
      `${KEYS_STEP} (failed: ${WDA_REFUSAL})`,
    );
    expect((err as KeyboardStillShownError).steps).toEqual(['mobile: hideKeyboard', KEYS_STEP]);
    expect(dismissing(calls)).toEqual(['bare', 'keys']);
    expect(pauses).toEqual([KEYBOARD_SETTLE_MS, KEYBOARD_SETTLE_MS]);
    expect(actions).toEqual([]);
    expect(finds).toEqual([]);
  });

  test('a step that succeeds but leaves the keyboard up moves on to the next', async () => {
    const { driver, calls } = fakeDriver({ outcomes: { bare: 'noop', keys: 'dismiss' } });
    expect(await dismissKeyboard(driver, 'ios')).toBe(true);
    expect(dismissing(calls)).toEqual(['bare', 'keys']);
  });

  test('a fatal driver error of a step is thrown at once: no further step', async () => {
    const dead = driverError('A session is either terminated or not started', 'invalid session id');
    const { driver, calls } = fakeDriver({ outcomes: { bare: dead } });
    await expect(dismissKeyboard(driver, 'ios')).rejects.toBe(dead);
    expect(dismissing(calls)).toEqual(['bare']);
  });

  test('a fatal driver error of the keys step is thrown at once', async () => {
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

  test('a step answered "unknown method" is skipped, not fatal: the next step runs at once', async () => {
    const unknown = driverError('Unknown mobile command "mobile: hideKeyboard"', 'unknown method');
    const { driver, calls, pauses } = fakeDriver({ outcomes: { bare: unknown, keys: 'dismiss' } });
    expect(await dismissKeyboard(driver, 'ios')).toBe(true);
    // No settle pause or re-check after a step the driver did not run.
    expect(calls).toEqual(['isKeyboardShown', 'bare', 'keys', 'isKeyboardShown']);
    expect(pauses).toEqual([KEYBOARD_SETTLE_MS]);
  });

  test('every unsupported spelling skips the step', async () => {
    for (const err of [
      driverError('The requested resource could not be found', 'unknown command'),
      driverError('Method has not yet been implemented'),
      driverError('Operation not supported', 'unsupported operation'),
      driverError('not here', 'NotImplementedError'),
    ]) {
      const { driver, calls } = fakeDriver({ outcomes: { bare: err, keys: 'dismiss' } });
      expect(await dismissKeyboard(driver, 'ios')).toBe(true);
      expect(dismissing(calls)).toEqual(['bare', 'keys']);
    }
  });

  test('"invalid argument" of a hideKeyboard step is not a skip: it is fatal', async () => {
    const bad = driverError('bad keys', 'invalid argument');
    const { driver, calls } = fakeDriver({ outcomes: { bare: 'refuse', keys: bad } });
    await expect(dismissKeyboard(driver, 'ios')).rejects.toBe(bad);
    expect(dismissing(calls)).toEqual(['bare', 'keys']);
  });

  test('the platform is read from the driver when not given', async () => {
    const { driver, executes } = fakeDriver({ caps: { platformName: 'iOS' }, outcomes: { bare: 'refuse', keys: 'dismiss' } });
    expect(await dismissKeyboard(driver)).toBe(true);
    expect(executes.map(e => e[1])).toEqual([{}, { keys: KEYS }]);
  });
});

test.describe('dismissKeyboard: iOS tapElement', () => {
  const TAP_STEP = `a tap on options.tapElement "${TAP_SELECTOR}"`;

  test('tapElement is tapped first; it dismisses: true, no hideKeyboard is sent', async () => {
    const { driver, calls, executes, pauses, actions } = fakeDriver({ outcomes: { tap: 'dismiss' } });
    expect(await dismissKeyboard(driver, 'ios', { tapElement: label(driver) })).toBe(true);
    expect(calls).toEqual(['isKeyboardShown', 'tap', 'isKeyboardShown']);
    expect(executes).toEqual([]);
    expect(actions).toEqual([]);
    expect(pauses).toEqual([KEYBOARD_SETTLE_MS]);
  });

  test('the tap leaves the keyboard up: the bare call, then the keys, in that order', async () => {
    const { driver, calls, executes } = fakeDriver({ outcomes: { tap: 'noop', bare: 'refuse', keys: 'dismiss' } });
    expect(await dismissKeyboard(driver, 'ios', { tapElement: label(driver) })).toBe(true);
    expect(dismissing(calls)).toEqual(['tap', 'bare', 'keys']);
    expect(executes.map(e => e[1])).toEqual([{}, { keys: KEYS }]);
  });

  test('a tapElement that is not found is a failed step, not fatal: no click, no pause or re-check, the next step runs', async () => {
    const { driver, calls, pauses } = fakeDriver({ outcomes: { bare: 'refuse', keys: 'dismiss' } });
    expect(await dismissKeyboard(driver, 'ios', { tapElement: label(driver, MISSING_SELECTOR) })).toBe(true);
    expect(calls).toEqual(['isKeyboardShown', 'bare', 'isKeyboardShown', 'keys', 'isKeyboardShown']);
    expect(pauses).toEqual([KEYBOARD_SETTLE_MS, KEYBOARD_SETTLE_MS]);
  });

  test('the failed tap is named in the still-shown error', async () => {
    const { driver } = fakeDriver({ outcomes: { bare: 'refuse', keys: 'refuse' } });
    const err = await dismissKeyboard(driver, 'ios', { tapElement: label(driver, MISSING_SELECTOR) }).then(() => null, (e: unknown) => e);
    expect(err).toBeInstanceOf(KeyboardStillShownError);
    expect((err as Error).message).toBe(
      'dismissKeyboard: the keyboard is still shown after ' +
      `a tap on options.tapElement "${MISSING_SELECTOR}" (failed: ${notDisplayed(TAP_ELEMENT_WAIT_MS)}), ` +
      `mobile: hideKeyboard (failed: ${WDA_REFUSAL}), ` +
      `${KEYS_STEP} (failed: ${WDA_REFUSAL})`,
    );
    expect((err as KeyboardStillShownError).steps).toEqual([
      `a tap on options.tapElement "${MISSING_SELECTOR}"`, 'mobile: hideKeyboard', KEYS_STEP,
    ]);
  });

  test('a tap that runs but leaves the keyboard up is named without a failure', async () => {
    const { driver } = fakeDriver({ outcomes: { bare: 'refuse', keys: 'refuse' } });
    await expect(dismissKeyboard(driver, 'ios', { tapElement: label(driver) })).rejects.toThrow(
      `dismissKeyboard: the keyboard is still shown after ${TAP_STEP}, mobile: hideKeyboard (failed: `,
    );
  });

  test('a fatal driver error of the tap is thrown at once: no further step', async () => {
    const dead = driverError('A session is either terminated or not started', 'invalid session id');
    const { driver, calls, executes } = fakeDriver({ outcomes: { tap: dead } });
    await expect(dismissKeyboard(driver, 'ios', { tapElement: label(driver) })).rejects.toBe(dead);
    expect(dismissing(calls)).toEqual(['tap']);
    expect(executes).toEqual([]);
  });

  test('TAP_ELEMENT_WAIT_MS is 2000', () => {
    expect(TAP_ELEMENT_WAIT_MS).toBe(2000);
  });

  test('without options.timeout, the tap waits for its element at most TAP_ELEMENT_WAIT_MS, not the element\'s default timeout', async () => {
    const { driver, waits, displayWaits } = fakeDriver({ outcomes: { tap: 'dismiss' } });
    const title = new PlatformElement(driver, TAP_SELECTOR, undefined, 30000, { platform: 'ios' });
    expect(await dismissKeyboard(driver, 'ios', { tapElement: title })).toBe(true);
    expect(displayWaits).toEqual([TAP_ELEMENT_WAIT_MS]);
    // The click gets what is left of that bound, never the element's 30 s.
    expect(waits).toHaveLength(1);
    expect(waits[0]).toBeGreaterThan(0);
    expect(waits[0]).toBeLessThanOrEqual(TAP_ELEMENT_WAIT_MS);
  });

  test('with an options.timeout shorter than TAP_ELEMENT_WAIT_MS, the tap waits at most the time left', async () => {
    const { driver, displayWaits } = fakeDriver({ outcomes: { bare: 'dismiss' } });
    expect(await dismissKeyboard(driver, 'ios', { tapElement: label(driver, MISSING_SELECTOR), timeout: 500 })).toBe(true);
    expect(displayWaits).toHaveLength(1);
    expect(displayWaits[0]).toBeGreaterThan(0);
    expect(displayWaits[0]).toBeLessThanOrEqual(500);
  });

  test('timeout 5000 and a missing tapElement: the tap costs at most TAP_ELEMENT_WAIT_MS and both hideKeyboard steps are still sent', async () => {
    const { driver, calls, executes } = fakeDriver({ outcomes: { bare: 'refuse', keys: 'refuse' }, slowMissing: true });
    const title = new PlatformElement(driver, MISSING_SELECTOR, undefined, 30000, { platform: 'ios' });
    const started = Date.now();
    const err = await dismissKeyboard(driver, 'ios', { tapElement: title, timeout: 5000 }).then(() => null, (e: unknown) => e);
    const elapsed = Date.now() - started;
    expect(err).toBeInstanceOf(KeyboardStillShownError);
    expect((err as KeyboardStillShownError).steps).toEqual([
      `a tap on options.tapElement "${MISSING_SELECTOR}"`, 'mobile: hideKeyboard', KEYS_STEP,
    ]);
    expect((err as Error).message).not.toContain('timeout 5000 ms');
    expect(executes.map(e => e[1])).toEqual([{}, { keys: KEYS }]);
    expect(calls).not.toContain('missing click');
    expect(elapsed).toBeGreaterThanOrEqual(TAP_ELEMENT_WAIT_MS - 50);
    expect(elapsed).toBeLessThan(TAP_ELEMENT_WAIT_MS + 1500);
  });

  test('a fatal driver error of the presence wait is thrown at once: no click, no further step', async () => {
    const dead = driverError('A session is either terminated or not started', 'invalid session id');
    const { driver, calls, executes } = fakeDriver({});
    const title = label(driver);
    (title as any).waitFor = async () => { throw dead; };
    await expect(dismissKeyboard(driver, 'ios', { tapElement: title })).rejects.toBe(dead);
    expect(dismissing(calls)).toEqual([]);
    expect(executes).toEqual([]);
  });

  test('a tapElement that is not a platform element is refused before anything is sent', async () => {
    for (const tapElement of [
      { _type: 'web', click: async () => {} },
      { click: async () => {} },
      null,
      'title',
    ]) {
      const { driver, calls, executes } = fakeDriver({});
      await expect(dismissKeyboard(driver, 'ios', { tapElement: tapElement as any }))
        .rejects.toThrow('dismissKeyboard: options.tapElement must be a platform element');
      expect(calls).toEqual([]);
      expect(executes).toEqual([]);
    }
  });

  test('no keyboard shown: the tapElement is not tapped', async () => {
    const { driver, calls } = fakeDriver({ shown: false });
    expect(await dismissKeyboard(driver, 'ios', { tapElement: label(driver) })).toBe(false);
    expect(calls).toEqual(['isKeyboardShown']);
  });

  test('Android ignores tapElement: its steps are unchanged', async () => {
    const { driver, calls } = fakeDriver({ outcomes: { hideKeyboard: 'dismiss' } });
    expect(await dismissKeyboard(driver, 'android', { tapElement: label(driver) })).toBe(true);
    expect(dismissing(calls)).toEqual(['hideKeyboard']);
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

  test('hideKeyboard() answered 404 "unknown command" (no legacy route) is skipped: the mobile: steps follow', async () => {
    const legacy = driverError('The requested resource could not be found, or a request was received using an HTTP method that is not supported by the mapped resource', 'unknown command');
    const { driver, calls, pauses } = fakeDriver({ outcomes: { hideKeyboard: legacy, pressKey: 'dismiss' } });
    expect(await dismissKeyboard(driver, 'android')).toBe(true);
    expect(dismissing(calls)).toEqual(['hideKeyboard', 'pressKey']);
    expect(pauses).toEqual([KEYBOARD_SETTLE_MS]);
  });

  test('a skipped step is named as skipped in the still-shown error', async () => {
    const legacy = driverError('The requested resource could not be found', 'unknown command');
    const { driver } = fakeDriver({ outcomes: { hideKeyboard: legacy } });
    const err = await dismissKeyboard(driver, 'android').then(() => null, (e: unknown) => e);
    expect(err).toBeInstanceOf(KeyboardStillShownError);
    expect((err as Error).message).toBe(
      'dismissKeyboard: the keyboard is still shown after hideKeyboard() (skipped: The requested resource could not be found), ' +
      "mobile: hideKeyboard { strategy: 'pressKey', key: 'return' }, mobile: hideKeyboard { strategy: 'tapOutside' }",
    );
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
    fake.driver.$ = async (selector: string) => ({ selector, isDisplayed: async () => false, waitForExist: async () => false });
    fake.driver.$$ = async () => [];
    fake.driver.getWindowSize = async () => ({ width: 393, height: 852 });
    fake.driver.getElementRect = async () => ({ x: 0, y: 0, width: 393, height: 852 });
    fake.driver.performActions = async () => { swipes.push(1); };
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
    const { driver, calls, swipes, isShown } = sweepDriver({ bare: 'refuse', keys: 'refuse' });
    await expect(target(driver).scrollIntoView({ maxSwipes: 2 })).rejects.toThrow(/after 2 swipes, the swipe limit/);
    expect(dismissing(calls)).toEqual(['bare', 'keys']);
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
