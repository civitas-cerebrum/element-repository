import { test, expect } from '@playwright/test';
import { PlatformElement } from '../src/types';
import { ElementChain } from '../src/types/ElementChain';
import { isFatalDriverError } from '../src/utils/driverErrors';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

/** A raw WebdriverIO-like element; every read answers with its own name. */
function row(name: string, overrides: Record<string, any> = {}): any {
  return {
    elementId: `id-${name}`,
    click: async () => {},
    getText: async () => `text-${name}`,
    getAttribute: async (attr: string) => `${attr}-${name}`,
    getValue: async () => `value-${name}`,
    getTagName: async () => `tag-${name}`,
    isDisplayed: async () => true,
    isExisting: async () => true,
    isEnabled: async () => true,
    isSelected: async () => true,
    waitForExist: async () => {},
    waitForDisplayed: async () => {},
    ...overrides,
  };
}

/** W3C `performActions` / `releaseActions` that count performed swipes. */
function touchActions(onPerform: () => void): any {
  return {
    performActions: async () => { onPerform(); },
    releaseActions: async () => {},
  };
}

/**
 * A virtualised list: rows 0..2 exist at first; each swipe loads two more.
 * Only the last loaded row is "displayed" unless `allDisplayed` is set.
 */
function lazyListDriver() {
  const state = { swipes: 0, $$calls: 0 };
  const rowsNow = () => {
    const n = 3 + 2 * state.swipes;
    return Array.from({ length: n }, (_, i) => row(`r${i}`, { isDisplayed: async () => i >= n - 2 }));
  };
  const driver: any = {
    $: async () => rowsNow()[0],
    $$: async () => { state.$$calls++; return rowsNow(); },
    pause: async () => {},
    getWindowSize: async () => ({ width: 400, height: 800 }),
    ...touchActions(() => { state.swipes++; }),
  };
  return { driver, state };
}

/** `$$` returns nothing until `delayMs` has passed, then rows a and b. */
function lateListDriver(delayMs: number): any {
  const start = Date.now();
  const rows = [row('a'), row('b')];
  return {
    $: async () => rows[0],
    $$: async () => (Date.now() - start >= delayMs ? rows : []),
    pause: async () => {},
    getElementRect: async (id: string) => (id === 'id-b' ? { x: 1, y: 2, width: 3, height: 4 } : null),
    getElementCSSValue: async (id: string, prop: string) => `${prop}@${id}`,
    takeElementScreenshot: async (id: string) => Buffer.from(`png@${id}`).toString('base64'),
  };
}

// ===========================================================================
// 1. scrollIntoView on an indexed element re-resolves every check
// ===========================================================================

test.describe('scrollIntoView on nth(i) of a lazy list', () => {
  test('swipes until the i-th row is loaded and displayed, re-resolving each time', async () => {
    const { driver, state } = lazyListDriver();
    // Row 6 exists after two swipes (3 + 2 + 2 = 7 rows) and is displayed then.
    await new PlatformElement(driver, '~row').nth(6).scrollIntoView();
    expect(state.swipes).toBe(2);
    expect(state.$$calls).toBe(3); // fast path + one per swipe
  });

  test('through ElementChain.scrollIntoView as well', async () => {
    const { driver, state } = lazyListDriver();
    const el = new PlatformElement(driver, '~row', undefined, 1000).nth(4);
    await new ElementChain(el, 1000).scrollIntoView();
    expect(state.swipes).toBe(1);
  });

  test('an already displayed indexed row needs no swipe', async () => {
    const { driver, state } = lazyListDriver();
    await new PlatformElement(driver, '~row').nth(2).scrollIntoView();
    expect(state.swipes).toBe(0);
  });

  test('default (unindexed) path re-queries every iteration instead of keeping a stale handle', async () => {
    let swipes = 0;
    let queries = 0;
    const driver: any = {
      // Each lookup is a snapshot: displayed only when queried after the 2nd swipe.
      $: async () => { queries++; const shown = swipes >= 2; return row('x', { isDisplayed: async () => shown }); },
      pause: async () => {},
      getWindowSize: async () => ({ width: 400, height: 800 }),
      ...touchActions(() => { swipes++; }),
    };
    await new PlatformElement(driver, '~x').scrollIntoView();
    expect(swipes).toBe(2);
    expect(queries).toBe(3);
  });
});

// ===========================================================================
// 2. Reads on an indexed element wait for the match
// ===========================================================================

test.describe('reads on nth(i) wait for the match like the default path', () => {
  const reads: Array<[string, (el: PlatformElement) => Promise<unknown>, unknown]> = [
    ['textContent', el => el.textContent(), 'text-b'],
    ['getAttribute', el => el.getAttribute('name'), 'name-b'],
    ['isEnabled', el => el.isEnabled(), true],
    ['isChecked', el => el.isChecked(), true],
    ['inputValue', el => el.inputValue(), 'value-b'],
    ['getCssProperty', el => el.getCssProperty('color'), 'color@id-b'],
    ['getTagName', el => el.getTagName(), 'tag-b'],
    ['boundingBox', el => el.boundingBox(), { x: 1, y: 2, width: 3, height: 4 }],
    ['screenshot', async el => (await el.screenshot()).toString(), 'png@id-b'],
  ];
  for (const [name, read, expected] of reads) {
    test(`${name}: the list appears after 300 ms, nth(1) waits and reads the second row`, async () => {
      const el = new PlatformElement(lateListDriver(300), '~row', undefined, 3000).nth(1) as PlatformElement;
      expect(await read(el)).toEqual(expected);
    });
  }

  test('a read gives up after the default timeout with the out-of-range error', async () => {
    const el = new PlatformElement(lateListDriver(60_000), '~row', undefined, 300).nth(1);
    const start = Date.now();
    await expect(el.textContent()).rejects.toThrow(/nth\(1\): no element at that index for "~row" \(found 0\)/);
    expect(Date.now() - start).toBeGreaterThanOrEqual(250);
  });

  test('getTagName surfaces the driver error instead of returning an empty string', async () => {
    const driver: any = { $: async () => row('x', { getTagName: async () => { throw new Error('no such element'); } }) };
    await expect(new PlatformElement(driver, '~x').getTagName()).rejects.toThrow('no such element');
  });
});

// ===========================================================================
// 3. A gesture on a missing element reports "not found", not a driver error
// ===========================================================================

test.describe('gestures on a missing element', () => {
  for (const [name, run] of [
    ['longPress', (el: PlatformElement) => el.longPress({ timeout: 100 })],
    ['tapAt', (el: PlatformElement) => el.tapAt({ x: 1, y: 1 }, { timeout: 100 })],
    ['pinch', (el: PlatformElement) => el.pinch({ timeout: 100 })],
    ['zoom', (el: PlatformElement) => el.zoom({ timeout: 100 })],
  ] as const) {
    test(`${name} throws "${name}: element ... not found within N ms"`, async () => {
      let rectCalls = 0;
      const driver: any = {
        // WebdriverIO resolves a missing element to an object without elementId.
        $: async () => ({ elementId: undefined, waitForExist: async () => { throw new Error('still not existing'); } }),
        getElementRect: async () => { rectCalls++; throw new Error('Malformed type for "elementId" parameter'); },
        getWindowSize: async () => ({ width: 400, height: 800 }),
      };
      await expect(run(new PlatformElement(driver, '~gone'))).rejects.toThrow(
        new RegExp(`^${name}: element "~gone" not found within 100 ms$`),
      );
      expect(rectCalls).toBe(0);
    });
  }
});

// ===========================================================================
// 4. Polling stops at once on a fatal driver error
// ===========================================================================

test.describe('polling on an indexed element and fatal driver errors', () => {
  test('isFatalDriverError is shared and classifies invalid selector as fatal, stale element as not', () => {
    expect(isFatalDriverError(Object.assign(new Error('bad'), { name: 'invalid selector' }))).toBe(true);
    expect(isFatalDriverError(new Error('stale element reference'))).toBe(false);
  });

  test('waitFor on nth(1) rethrows an invalid-selector error without polling to the deadline', async () => {
    let calls = 0;
    const driver: any = {
      $$: async () => { calls++; throw Object.assign(new Error('selector is malformed'), { name: 'invalid selector' }); },
    };
    const start = Date.now();
    await expect(new PlatformElement(driver, '~row').nth(1).waitFor({ state: 'attached', timeout: 2000 }))
      .rejects.toThrow('selector is malformed');
    expect(calls).toBe(1);
    expect(Date.now() - start).toBeLessThan(1000);
  });

  test('a transient error is still polled through', async () => {
    let calls = 0;
    const rows = [row('a'), row('b')];
    const driver: any = {
      $$: async () => { if (++calls < 3) throw new Error('stale element reference'); return rows; },
    };
    await new PlatformElement(driver, '~row').nth(1).waitFor({ state: 'attached', timeout: 3000 });
    expect(calls).toBe(3);
  });
});

// ===========================================================================
// 5. nth(k) on an already indexed element follows Playwright
// ===========================================================================

test.describe('nth(k) on an already indexed or resolved element', () => {
  const rows = () => [row('a'), row('b'), row('c')];
  const driver = (): any => ({ $: async () => rows()[0], $$: async () => rows(), pause: async () => {} });

  test('does not throw at construction; the result matches nothing', async () => {
    const second = new PlatformElement(driver(), '~row', undefined, 1000).nth(1);
    const none = second.nth(1);
    expect(none).not.toBe(second);
    expect(await none.count()).toBe(0);
    expect(await none.exists()).toBe(false);
    expect(await none.isVisible()).toBe(false);
    expect(await none.all()).toEqual([]);
  });

  test('actions on it fail at use time with a clear not-found error, without waiting the timeout', async () => {
    const none = new PlatformElement(driver(), '~row', undefined, 30_000).nth(1).nth(2);
    const start = Date.now();
    await expect(none.click()).rejects.toThrow(/nth\(2\).*"~row".*matches nothing/);
    await expect(none.textContent()).rejects.toThrow(/matches nothing/);
    await expect(none.waitFor({ state: 'visible', timeout: 30_000 })).rejects.toThrow(/matches nothing/);
    await none.waitFor({ state: 'detached', timeout: 30_000 });
    await none.waitFor({ state: 'hidden', timeout: 30_000 });
    await expect(none.scrollIntoView()).rejects.toThrow(/matches nothing/);
    expect(Date.now() - start).toBeLessThan(2000);
  });

  test('a resolved element (from all()) behaves the same', async () => {
    const [first] = await new PlatformElement(driver(), '~row').all();
    expect(first.nth(0)).toBe(first);
    expect(first.nth(-1)).toBe(first);
    expect(await first.nth(3).count()).toBe(0);
  });

  test('nth(k) of a no-match element still matches nothing; its nth(0) is itself', () => {
    const none = new PlatformElement(driver(), '~row').nth(1).nth(1);
    expect(none.nth(0)).toBe(none);
    expect(none.first()).toBe(none);
    expect(none.nth(-1)).toBe(none);
  });
});

// ===========================================================================
// 7. locateChild is scoped under the parent and honours its index
// ===========================================================================

test.describe('locateChild', () => {
  /** Parent rows whose `$` / `$$` answer with children named after the parent. */
  function parentRow(name: string, log: string[]): any {
    const kids = [row(`${name}/k0`), row(`${name}/k1`)];
    return row(name, {
      $: async (sel: string, opts: any) => { log.push(`${name}.$(${sel},${JSON.stringify(opts)})`); return kids[0]; },
      $$: async (sel: string) => { log.push(`${name}.$$(${sel})`); return kids; },
    });
  }

  test('queries the child under the parent match picked by nth', async () => {
    const log: string[] = [];
    const parents = [parentRow('p0', log), parentRow('p1', log)];
    const driver: any = {
      $: async () => { throw new Error('child must not be looked up on the driver'); },
      $$: async () => parents,
      pause: async () => {},
    };
    const child = new PlatformElement(driver, '~row', undefined, 1000).nth(1).locateChild('~label');
    expect(await child.textContent()).toBe('text-p1/k0');
    expect(await child.count()).toBe(2);
    expect(await child.nth(1).textContent()).toBe('text-p1/k1');
    expect(log).toContain('p1.$$(~label)');
    expect(log.some(l => l.startsWith('p0.'))).toBe(false);
  });

  test('an unindexed parent scopes the child through the parent element', async () => {
    const log: string[] = [];
    const parent = parentRow('p', log);
    const driver: any = { $: async () => parent, $$: async () => [parent], pause: async () => {} };
    const child = new PlatformElement(driver, '~card').locateChild('~title');
    expect(await child.textContent()).toBe('text-p/k0');
    // A child is polled: its first match is picked from `$$` under the parent.
    expect(log).toEqual(['p.$$(~title)']);
  });

  test('a child of a missing indexed parent waits, then fails with a not-found error; count is 0', async () => {
    const driver: any = { $$: async () => [row('only')], pause: async () => {} };
    const child = new PlatformElement(driver, '~row', undefined, 200).nth(3).locateChild('~label');
    expect(await child.count()).toBe(0);
    expect(await child.exists()).toBe(false);
    await expect(child.click()).rejects.toThrow(/nth\(3\)/);
  });
});

// ===========================================================================
// 8. Errors at the public boundary of a polled element
// ===========================================================================

test.describe('polled element errors', () => {
  const fatal = () => Object.assign(new Error('invalid session id'), { name: 'invalid session id' });

  test('a polled gesture that never finds its match names the method and the element', async () => {
    const driver: any = { $$: async () => [row('only')], pause: async () => {} };
    await expect(new PlatformElement(driver, '~row').nth(3).longPress({ timeout: 200 }))
      .rejects.toThrow(/^longPress: nth\(3\) of "~row" not found within 200 ms: nth\(3\): no element at that index for "~row" \(found 1\)$/);
    await expect(new PlatformElement(driver, '~row').nth(3).tapAt({ x: 1, y: 1 }, { timeout: 200 }))
      .rejects.toThrow(/^tapAt: nth\(3\) of "~row" not found within 200 ms/);
  });

  test('count() and isVisible() rethrow a fatal driver error on an indexed element', async () => {
    const driver: any = { $$: async () => { throw fatal(); }, pause: async () => {} };
    const el = new PlatformElement(driver, '~row').nth(1);
    await expect(el.count()).rejects.toThrow(/invalid session id/);
    await expect(el.isVisible()).rejects.toThrow(/invalid session id/);
  });

  test('count() and isVisible() rethrow a fatal driver error on a child', async () => {
    const parent = row('p', { $$: async () => { throw fatal(); } });
    const driver: any = { $: async () => parent, $$: async () => [parent], pause: async () => {} };
    const child = new PlatformElement(driver, '~card').locateChild('~title');
    await expect(child.count()).rejects.toThrow(/invalid session id/);
    await expect(child.isVisible()).rejects.toThrow(/invalid session id/);
  });

  test('waitFor hidden and detached rethrow a fatal driver error on a child', async () => {
    const parent = row('p', { $$: async () => { throw fatal(); } });
    const driver: any = { $: async () => parent, $$: async () => [parent], pause: async () => {} };
    const child = new PlatformElement(driver, '~card').locateChild('~title');
    await expect(child.waitFor({ state: 'hidden', timeout: 200 })).rejects.toThrow(/invalid session id/);
    await expect(child.waitFor({ state: 'detached', timeout: 200 })).rejects.toThrow(/invalid session id/);
  });

  test('waitFor hidden and detached rethrow a fatal driver error on an indexed element', async () => {
    const driver: any = { $$: async () => { throw fatal(); }, pause: async () => {} };
    const el = new PlatformElement(driver, '~row').nth(1);
    await expect(el.waitFor({ state: 'hidden', timeout: 200 })).rejects.toThrow(/invalid session id/);
    await expect(el.waitFor({ state: 'detached', timeout: 200 })).rejects.toThrow(/invalid session id/);
  });

  test('exists() rethrows a fatal driver error on a child, an indexed element and a plain element', async () => {
    const parent = row('p', { $$: async () => { throw fatal(); } });
    const childDriver: any = { $: async () => parent, $$: async () => [parent], pause: async () => {} };
    await expect(new PlatformElement(childDriver, '~card').locateChild('~title').exists())
      .rejects.toThrow(/invalid session id/);
    const failing: any = {
      $: async () => { throw fatal(); },
      $$: async () => { throw fatal(); },
      pause: async () => {},
    };
    await expect(new PlatformElement(failing, '~row').nth(1).exists()).rejects.toThrow(/invalid session id/);
    await expect(new PlatformElement(failing, '~row').exists()).rejects.toThrow(/invalid session id/);
  });

  test('exists() is false for a missing match when the error is not fatal', async () => {
    const driver: any = { $: async () => { throw new Error('no such element'); }, $$: async () => [], pause: async () => {} };
    expect(await new PlatformElement(driver, '~row').exists()).toBe(false);
    expect(await new PlatformElement(driver, '~row').nth(2).exists()).toBe(false);
  });

  test('a not-found action, read, wait or scroll throws a plain Error, never the internal class', async () => {
    const driver: any = {
      $$: async () => [row('only')],
      pause: async () => {},
      getWindowSize: async () => ({ width: 400, height: 800 }),
    };
    const el = new PlatformElement(driver, '~row', undefined, 200).nth(3);
    const errors = [
      await el.click().then(() => null, e => e),
      await el.textContent().then(() => null, e => e),
      await el.waitFor({ state: 'attached', timeout: 200 }).then(() => null, e => e),
      await el.nth(1).click().then(() => null, e => e),
      await el.nth(1).scrollIntoView().then(() => null, e => e),
    ];
    for (const err of errors) {
      expect(err).toBeInstanceOf(Error);
      expect(err.constructor).toBe(Error);
      expect(err.name).toBe('Error');
    }
    expect(errors[0].message).toMatch(/nth\(3\): no element at that index/);
    expect(errors[3].message).toMatch(/matches nothing/);
  });

  test('a child of a missing parent: plain Error naming the parent; count 0, isVisible false', async () => {
    // A WebdriverIO lazy element for a missing match has no elementId, and
    // `$` / `$$` on it would wait; the child must never call them.
    const missing: any = {
      $: async () => { throw new Error('must not query a missing parent'); },
      $$: async () => { throw new Error('must not query a missing parent'); },
    };
    const driver: any = { $: async () => missing, pause: async () => {} };
    const child = new PlatformElement(driver, '~card', undefined, 200).locateChild('~title');
    expect(await child.count()).toBe(0);
    expect(await child.isVisible()).toBe(false);
    expect(await child.exists()).toBe(false);
    const err = await child.click().then(() => null, e => e);
    expect(err.constructor).toBe(Error);
    expect(err.message).toBe('parent "~card" not found');
  });
});
