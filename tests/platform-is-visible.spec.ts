import { test, expect } from '@playwright/test';
import { PlatformElement } from '../src/types';

// ---------------------------------------------------------------------------
// PlatformElement.isVisible() on polled elements (indexed, child, matches
// nothing): a real no-match is false, a stale element is re-resolved once,
// any other non-fatal driver error is rethrown so the caller's poll retries.
// ---------------------------------------------------------------------------

function driverError(message: string, name = 'unknown error'): Error {
  const err = new Error(message);
  err.name = name;
  return err;
}

const STALE = () => driverError('The element reference is stale; either its node document is not the active document', 'stale element reference');

function row(id: string, overrides: Record<string, any> = {}): any {
  return {
    elementId: id,
    isDisplayed: async () => true,
    isExisting: async () => true,
    ...overrides,
  };
}

/**
 * A driver whose `$$('~item')` answers with `answers[n]` on its n-th call
 * (an Error is thrown), then with the last answer for every later call.
 */
function scriptedDriver(answers: Array<any[] | Error>) {
  const state = { $$calls: 0 };
  const driver: any = {
    $: async () => row('first'),
    $$: async () => {
      const answer = answers[Math.min(state.$$calls, answers.length - 1)];
      state.$$calls++;
      if (answer instanceof Error) throw answer;
      return answer;
    },
    pause: async () => {},
  };
  return { driver, state };
}

const two = () => [row('a'), row('b')];
const item = (driver: any) => new PlatformElement(driver, '~item', undefined, 1000, { platform: 'android' });

test.describe('isVisible on an indexed element', () => {
  test('the reported case: a stale element reference on the first lookup is re-resolved once -> true', async () => {
    const { driver, state } = scriptedDriver([STALE(), two()]);
    expect(await item(driver).nth(1).isVisible()).toBe(true);
    expect(state.$$calls).toBe(2);
  });

  test('an unknown error once is rethrown, not read as not visible', async () => {
    const err = driverError('An unknown server-side error occurred while processing the command.');
    const { driver, state } = scriptedDriver([err, two()]);
    await expect(item(driver).nth(1).isVisible()).rejects.toBe(err);
    expect(state.$$calls).toBe(1);
  });

  test('a second stale element reference in a row is rethrown', async () => {
    const second = STALE();
    const { driver, state } = scriptedDriver([STALE(), second, two()]);
    await expect(item(driver).nth(1).isVisible()).rejects.toBe(second);
    expect(state.$$calls).toBe(2);
  });

  test('a stale element reference from isDisplayed itself is re-resolved once -> its answer', async () => {
    let reads = 0;
    const flaky = row('b', { isDisplayed: async () => { if (reads++ === 0) throw STALE(); return true; } });
    const { driver, state } = scriptedDriver([[row('a'), flaky]]);
    expect(await item(driver).nth(1).isVisible()).toBe(true);
    expect(state.$$calls).toBe(2);
  });

  test('an element that is not displayed is still false', async () => {
    const { driver } = scriptedDriver([[row('a'), row('b', { isDisplayed: async () => false })]]);
    expect(await item(driver).nth(1).isVisible()).toBe(false);
  });

  test('an out-of-range index (a real no-match) is false', async () => {
    const { driver } = scriptedDriver([two()]);
    expect(await item(driver).nth(5).isVisible()).toBe(false);
  });

  test('a W3C "no such element" answer is false', async () => {
    for (const err of [
      driverError('An element could not be located on the page using the given search parameters.', 'no such element'),
      driverError('no such element: Unable to locate element'),
      driverError(`Can't call isDisplayed on element with selector "~item" because element wasn't found`),
    ]) {
      const { driver } = scriptedDriver([err]);
      expect(await item(driver).nth(1).isVisible()).toBe(false);
    }
  });

  test('an index on an element that is already a single match matches nothing: false', async () => {
    const { driver } = scriptedDriver([two()]);
    expect(await item(driver).nth(1).nth(2).isVisible()).toBe(false);
  });

  test('a fatal driver error is still rethrown', async () => {
    const dead = driverError('A session is either terminated or not started', 'invalid session id');
    const { driver } = scriptedDriver([dead]);
    await expect(item(driver).nth(1).isVisible()).rejects.toBe(dead);
  });
});

test.describe('isVisible on a child (locateChild)', () => {
  function parentDriver(childAnswers: Array<any[] | Error>) {
    const state = { childCalls: 0 };
    const parent = row('parent', {
      $$: async () => {
        const answer = childAnswers[Math.min(state.childCalls, childAnswers.length - 1)];
        state.childCalls++;
        if (answer instanceof Error) throw answer;
        return answer;
      },
    });
    const driver: any = { $: async () => parent, $$: async () => [parent], pause: async () => {} };
    return { driver, state };
  }
  const child = (driver: any) => new PlatformElement(driver, '~list', undefined, 1000, { platform: 'ios' }).locateChild('~label');

  test('a stale element reference once is re-resolved -> true', async () => {
    const { driver, state } = parentDriver([STALE(), [row('label')]]);
    expect(await child(driver).isVisible()).toBe(true);
    expect(state.childCalls).toBe(2);
  });

  test('an unknown error is rethrown', async () => {
    const err = driverError('An unknown server-side error occurred while processing the command.');
    const { driver } = parentDriver([err, [row('label')]]);
    await expect(child(driver).isVisible()).rejects.toBe(err);
  });

  test('no child match is false', async () => {
    const { driver } = parentDriver([[]]);
    expect(await child(driver).isVisible()).toBe(false);
  });

  test('a missing parent is false', async () => {
    const driver: any = { $: async () => ({ elementId: undefined }), $$: async () => [], pause: async () => {} };
    expect(await child(driver).isVisible()).toBe(false);
  });
});

test.describe('isVisible on a non-polled element (unchanged)', () => {
  test('a driver error of isDisplayed is rethrown, never read as not visible', async () => {
    const err = driverError('An unknown server-side error occurred while processing the command.');
    const driver: any = { $: async () => row('a', { isDisplayed: async () => { throw err; } }), $$: async () => [] };
    await expect(item(driver).isVisible()).rejects.toBe(err);
  });

  test('a lazy element that answers not displayed is false', async () => {
    const driver: any = { $: async () => row('a', { isDisplayed: async () => false }), $$: async () => [] };
    expect(await item(driver).isVisible()).toBe(false);
  });
});

test.describe('isVisible: a "no such element" mention deep inside another error', () => {
  test('an unknown error whose text mentions "no such element" deep inside is rethrown, not false', async () => {
    const err = driverError('An unknown server-side error occurred while processing the command. Original error: lookup failed after a no such element: retry');
    const { driver } = scriptedDriver([err, two()]);
    await expect(item(driver).nth(1).isVisible()).rejects.toBe(err);
  });
});

test.describe('waitFor hidden / detached on a polled element: a transient error is not "gone"', () => {
  const UNKNOWN = () => driverError('An unknown server-side error occurred while processing the command.');

  for (const state of ['hidden', 'detached'] as const) {
    test(`an unknown error once during waitFor('${state}') on a shown nth(1) does not resolve early`, async () => {
      // One transient error, then the element is shown again for good.
      const { driver, state: calls } = scriptedDriver([UNKNOWN(), two()]);
      await expect(item(driver).nth(1).waitFor({ state, timeout: 300 })).rejects.toThrow();
      expect(calls.$$calls).toBeGreaterThan(1);
    });

    test(`an unknown error during waitFor('${state}') resolves only once the element is truly gone`, async () => {
      const { driver, state: calls } = scriptedDriver([UNKNOWN(), two(), UNKNOWN(), [row('a')]]);
      await item(driver).nth(1).waitFor({ state, timeout: 5000 });
      expect(calls.$$calls).toBe(4);
    });

    test(`a stale element reference during waitFor('${state}') is not "gone" either`, async () => {
      const { driver } = scriptedDriver([STALE(), two()]);
      await expect(item(driver).nth(1).waitFor({ state, timeout: 300 })).rejects.toThrow();
    });
  }

  test(`waitFor('hidden') resolves when the element is present but not displayed`, async () => {
    const { driver } = scriptedDriver([UNKNOWN(), [row('a'), row('b', { isDisplayed: async () => false })]]);
    await item(driver).nth(1).waitFor({ state: 'hidden', timeout: 5000 });
  });

  test(`waitFor('visible') keeps polling through an unknown error`, async () => {
    const { driver, state: calls } = scriptedDriver([UNKNOWN(), [row('a')], two()]);
    await item(driver).nth(1).waitFor({ state: 'visible', timeout: 5000 });
    expect(calls.$$calls).toBe(3);
  });
});
