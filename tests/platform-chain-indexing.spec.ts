import { test, expect } from '@playwright/test';
import { PlatformElement, WebElement, ElementType } from '../src/types';
import { ElementChain } from '../src/types/ElementChain';
import { PlatformNotSupportedError } from '../src/types/errors';

// ---------------------------------------------------------------------------
// Spies and mocks
// ---------------------------------------------------------------------------

function spyElement(log: any[], type: ElementType): any {
  const record = (name: string) => async (...args: any[]) => { log.push([name, ...args]); };
  return {
    _type: type,
    waitFor: record('waitFor'),
    scrollIntoView: record('scrollIntoView'),
    swipe: record('swipe'),
    click: record('click'),
    dispatchEvent: record('dispatchEvent'),
    isVisible: async () => { log.push(['isVisible']); return true; },
  };
}

function rawElement(name: string, log: string[], overrides: Record<string, any> = {}): any {
  return {
    elementId: `id-${name}`,
    click: async () => { log.push(`click:${name}`); },
    getText: async () => `text-${name}`,
    isDisplayed: async () => true,
    isExisting: async () => true,
    waitForExist: async () => { log.push(`waitForExist:${name}`); },
    waitForDisplayed: async () => {},
    ...overrides,
  };
}

function listDriver(names: string[], log: string[], extra: Record<string, any> = {}): any {
  const raws = names.map(n => rawElement(n, log));
  return {
    $: async () => raws[0] ?? rawElement('missing', log),
    $$: async () => raws,
    pause: async () => {},
    ...extra,
  };
}

// ===========================================================================
// a. ElementChain.scrollIntoView
// ===========================================================================

test.describe('ElementChain.scrollIntoView', () => {
  test('on a platform element: no attached wait, and the chain timeout is not forwarded', async () => {
    const log: any[] = [];
    await new ElementChain(spyElement(log, ElementType.PLATFORM), 4000).scrollIntoView({ direction: 'up' });
    expect(log).toEqual([['scrollIntoView', { direction: 'up' }]]);
    expect(log[0][1]).not.toHaveProperty('timeout');
  });

  test('on a web element: no chain-level wait either, and no chain timeout; the element applies its own default', async () => {
    const log: any[] = [];
    await new ElementChain(spyElement(log, ElementType.WEB), 4000).scrollIntoView({ direction: 'left' });
    expect(log).toEqual([['scrollIntoView', { direction: 'left' }]]);
    expect(log[0][1]).not.toHaveProperty('timeout');
  });

  test('an explicit option timeout and maxSwipes are forwarded as given', async () => {
    const log: any[] = [];
    await new ElementChain(spyElement(log, ElementType.PLATFORM), 4000).scrollIntoView({ timeout: 50, maxSwipes: 3 });
    expect(log).toEqual([['scrollIntoView', { timeout: 50, maxSwipes: 3 }]]);
  });

  test('a platform sweep through a chain is bounded by the swipe limit, not by the chain timeout', async () => {
    const log: string[] = [];
    const raw = rawElement('row', log, { isDisplayed: async () => false });
    const driver = {
      $: async () => raw,
      $$: async () => [raw],
      pause: async () => {},
      getWindowSize: async () => ({ width: 1000, height: 2000 }),
      performActions: async () => { log.push('swipe'); await new Promise(r => setTimeout(r, 5)); },
      releaseActions: async () => {},
    };
    await expect(new PlatformElement(driver, '~row').action(20).scrollIntoView())
      .rejects.toThrow('scrollIntoView: element not visible after 20 swipes, the swipe limit (direction=down)');
    expect(log.filter(l => l === 'swipe')).toHaveLength(20);
  });

  test('a web element through a chain scrolls with its repository default timeout', async () => {
    const calls: string[] = [];
    const locator: any = {
      waitFor: async (o: any) => { calls.push(`waitFor:${o.state}:${o.timeout}`); },
      scrollIntoViewIfNeeded: async (o: any) => { calls.push(`scroll:${o.timeout}`); },
    };
    await new WebElement(locator, undefined, 7000).action().scrollIntoView();
    expect(calls).toEqual(['waitFor:attached:7000', 'scroll:7000']);
  });

  test('a real PlatformElement off-screen in a lazy list is swiped to without waiting for attached', async () => {
    const log: string[] = [];
    let shown = false;
    const raw = rawElement('row', log, {
      isDisplayed: async () => shown,
      waitForExist: async () => { log.push('waitForExist'); throw new Error('not attached yet'); },
    });
    const driver = {
      $: async () => raw,
      $$: async () => [raw],
      pause: async () => {},
      getWindowSize: async () => ({ width: 1000, height: 2000 }),
      performActions: async () => { log.push('swipe'); shown = true; },
      releaseActions: async () => { log.push('release'); },
    };
    await new PlatformElement(driver, '~row').action(60000).scrollIntoView({ direction: 'down' });
    expect(log).toEqual(['swipe', 'release']);
  });
});

// ===========================================================================
// b. ElementChain.swipe
// ===========================================================================

test.describe('ElementChain.swipe', () => {
  test('on a platform element: delegates direction and options with the chain timeout', async () => {
    const log: any[] = [];
    await new ElementChain(spyElement(log, ElementType.PLATFORM), 4000).swipe('left', { distance: 120 });
    expect(log).toEqual([['swipe', 'left', { distance: 120, timeout: 4000 }]]);
  });

  test('on a web element: no chain-level wait; the element waits for itself', async () => {
    const log: any[] = [];
    await new ElementChain(spyElement(log, ElementType.WEB), 4000).swipe('down');
    expect(log).toEqual([['swipe', 'down', { timeout: 4000 }]]);
  });

  test('an explicit option timeout wins over the chain timeout', async () => {
    const log: any[] = [];
    await new ElementChain(spyElement(log, ElementType.PLATFORM), 4000).swipe('up', { timeout: 10 });
    expect(log).toEqual([['swipe', 'up', { timeout: 10 }]]);
  });
});

// ===========================================================================
// c. click({ withoutScrolling }) on platform elements
// ===========================================================================

test.describe('ElementChain click without scrolling', () => {
  for (const type of [ElementType.PLATFORM, ElementType.WEB]) {
    test(`${type}: click({ withoutScrolling }) waits for attached, then passes the option to the element click`, async () => {
      const log: any[] = [];
      await new ElementChain(spyElement(log, type), 4000).click({ withoutScrolling: true });
      expect(log).toEqual([
        ['waitFor', { state: 'attached', timeout: 4000 }],
        ['click', { timeout: 4000, withoutScrolling: true }],
      ]);
    });

    test(`${type}: clickIfPresent({ withoutScrolling }) passes the option to the element click`, async () => {
      const log: any[] = [];
      await new ElementChain(spyElement(log, type), 4000).clickIfPresent({ withoutScrolling: true });
      expect(log).toEqual([['isVisible'], ['click', { timeout: 4000, withoutScrolling: true }]]);
    });
  }

  test('clickIfPresent without the option clicks normally', async () => {
    const log: any[] = [];
    await new ElementChain(spyElement(log, ElementType.WEB), 4000).clickIfPresent();
    expect(log).toEqual([['isVisible'], ['click', { timeout: 4000 }]]);
  });

  test('the chain does not branch on the backend', () => {
    const source = require('fs').readFileSync(require('path').join(__dirname, '../src/types/ElementChain.ts'), 'utf-8');
    expect(source).not.toMatch(/isPlatform|isWeb|ElementType/);
  });

  test('a real PlatformElement clicks through the chain without throwing', async () => {
    const log: string[] = [];
    const driver = listDriver(['a'], log);
    await new PlatformElement(driver, '~a').action(1000).click({ withoutScrolling: true });
    expect(log).toContain('click:a');
  });
});

// ===========================================================================
// d. PlatformElement first / nth / filter
// ===========================================================================

test.describe('PlatformElement indexing', () => {
  test('nth(i) acts on the i-th match', async () => {
    const log: string[] = [];
    const el = new PlatformElement(listDriver(['a', 'b', 'c'], log), '~row', undefined, 1000);
    await el.nth(1).click();
    expect(log.filter(l => l.startsWith('click'))).toEqual(['click:b']);
    expect(await el.nth(2).textContent()).toBe('text-c');
  });

  test('nth(-1) is the last match, nth(-2) the one before', async () => {
    const log: string[] = [];
    const el = new PlatformElement(listDriver(['a', 'b', 'c'], log), '~row', undefined, 1000);
    await el.nth(-1).click();
    await el.nth(-2).click();
    expect(log.filter(l => l.startsWith('click'))).toEqual(['click:c', 'click:b']);
  });

  test('first() acts on the first match', async () => {
    const log: string[] = [];
    const el = new PlatformElement(listDriver(['a', 'b', 'c'], log), '~row', undefined, 1000);
    await el.first().click();
    expect(log.filter(l => l.startsWith('click'))).toEqual(['click:a']);
  });

  test('first() and nth() return new elements, not the same instance', () => {
    const el = new PlatformElement(listDriver(['a'], []), '~row');
    expect(el.first()).not.toBe(el);
    expect(el.nth(0)).not.toBe(el);
    expect(el.first()).toBeInstanceOf(PlatformElement);
  });

  test('an out-of-range index fails the action with a clear error after the timeout', async () => {
    const log: string[] = [];
    const el = new PlatformElement(listDriver(['a', 'b', 'c'], log), '~row', undefined, 300);
    await expect(el.nth(5).click()).rejects.toThrow(/nth\(5\): no element at that index for "~row" \(found 3\)/);
    await expect(el.nth(-4).click({ timeout: 100 })).rejects.toThrow(/nth\(-4\).*found 3/);
    expect(log.filter(l => l.startsWith('click'))).toEqual([]);
  });

  test('a lazy list: nth waits until the match appears', async () => {
    const log: string[] = [];
    const a = rawElement('a', log);
    const b = rawElement('b', log);
    let calls = 0;
    const driver = { $: async () => a, $$: async () => (++calls < 3 ? [a] : [a, b]), pause: async () => {} };
    await new PlatformElement(driver, '~row', undefined, 5000).nth(1).click();
    expect(log.filter(l => l.startsWith('click'))).toEqual(['click:b']);
    expect(calls).toBeGreaterThanOrEqual(3);
  });

  test('count and all are narrowed to the indexed match', async () => {
    const el = new PlatformElement(listDriver(['a', 'b', 'c'], []), '~row', undefined, 1000);
    expect(await el.count()).toBe(3);
    expect(await el.nth(1).count()).toBe(1);
    expect(await el.nth(7).count()).toBe(0);
    expect(await el.first().count()).toBe(1);
    const all = await el.nth(1).all();
    expect(all).toHaveLength(1);
    expect(await all[0].textContent()).toBe('text-b');
  });

  test('isVisible and exists are false for an out-of-range index', async () => {
    const el = new PlatformElement(listDriver(['a'], []), '~row', undefined, 1000);
    expect(await el.nth(3).isVisible()).toBe(false);
    expect(await el.nth(3).exists()).toBe(false);
    expect(await el.nth(0).exists()).toBe(true);
  });

  test('waitFor on an indexed element polls the list', async () => {
    const a = rawElement('a', []);
    const b = rawElement('b', []);
    let calls = 0;
    const driver = { $: async () => a, $$: async () => (++calls < 2 ? [a] : [a, b]), pause: async () => {} };
    const el = new PlatformElement(driver, '~row').nth(1);
    await el.waitFor({ state: 'attached', timeout: 3000 });
    await el.waitFor({ state: 'visible', timeout: 3000 });
    await expect(new PlatformElement(listDriver(['a'], []), '~row').nth(1).waitFor({ state: 'attached', timeout: 200 }))
      .rejects.toThrow(/nth\(1\)/);
    await new PlatformElement(listDriver(['a'], []), '~row').nth(1).waitFor({ state: 'detached', timeout: 200 });
  });

  test('nth rejects a non-integer index', () => {
    const el = new PlatformElement(listDriver(['a'], []), '~row');
    expect(() => el.nth(1.5)).toThrow(/nth: index must be an integer/);
  });

  test('nth on an already indexed or resolved element follows Playwright: 0 and -1 are itself, others match nothing', async () => {
    const log: string[] = [];
    const el = new PlatformElement(listDriver(['a', 'b', 'c'], log), '~row', undefined, 1000);
    const second = el.nth(1);
    expect(second.nth(0)).toBe(second);
    expect(second.first()).toBe(second);
    expect(second.nth(-1)).toBe(second);
    expect(await second.nth(1).count()).toBe(0);
    await expect(second.nth(1).click()).rejects.toThrow(/nth\(1\).*single.*matches nothing/);
    const resolved = new PlatformElement(listDriver(['a'], log), '~row', rawElement('r', log));
    expect(resolved.first()).toBe(resolved);
  });
});

test.describe('PlatformElement.filter', () => {
  for (const [platformName, expected] of [['iOS', 'ios'], ['Android', 'android']] as const) {
    test(`throws PlatformNotSupportedError naming the driver platform (${platformName})`, () => {
      const driver = { ...listDriver(['a'], []), capabilities: { platformName } };
      const el = new PlatformElement(driver, '~row');
      let error: unknown;
      try { el.filter({ hasText: 'x' }); } catch (e) { error = e; }
      expect(error).toBeInstanceOf(PlatformNotSupportedError);
      expect((error as Error).message).toBe(`"filter" is not supported on platform "${expected}".`);
      expect((error as PlatformNotSupportedError).method).toBe('filter');
      expect((error as PlatformNotSupportedError).platform).toBe(expected);
    });
  }

  test('uses the WebdriverIO isIOS flag when capabilities carry no platform name', () => {
    const driver = { ...listDriver(['a'], []), isIOS: true };
    expect(() => new PlatformElement(driver, '~row').filter({ hasText: /x/ })).toThrow('"filter" is not supported on platform "ios".');
  });

  test('an empty filter is a no-op', () => {
    const el = new PlatformElement(listDriver(['a'], []), '~row');
    expect(el.filter({})).toBe(el);
  });
});
