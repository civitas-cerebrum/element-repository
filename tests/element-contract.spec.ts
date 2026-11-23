import { test, expect } from '@playwright/test';
import { PlatformElement, WebElement, Element, isWeb, isPlatform } from '../src';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

function rawElement(log: string[], overrides: Record<string, any> = {}): any {
  return {
    elementId: 'id-1',
    click: async () => { log.push('click'); },
    addValue: async (c: string) => { log.push(`addValue:${c}`); },
    isDisplayed: async () => false,
    isExisting: async () => true,
    waitForExist: async () => {},
    waitForDisplayed: async () => {},
    getAttribute: async () => null,
    getValue: async () => '',
    ...overrides,
  };
}

function swipeDriver(log: string[], raw: any, extra: Record<string, any> = {}): any {
  return {
    $: async () => raw,
    $$: async () => [raw],
    pause: async () => {},
    getWindowSize: async () => ({ width: 1000, height: 2000 }),
    performActions: async () => { log.push('swipe'); },
    releaseActions: async () => {},
    keys: async (c: string) => { log.push(`keys:${c}`); },
    ...extra,
  };
}

// ---------------------------------------------------------------------------
// click({ withoutScrolling })
// ---------------------------------------------------------------------------

test.describe('Element.click withoutScrolling', () => {
  test('web: waits for attached, then dispatches a DOM click instead of a scrolling click', async () => {
    const calls: any[] = [];
    const locator: any = {
      waitFor: async (o: any) => { calls.push(['waitFor', o.state]); },
      dispatchEvent: async (e: string, _init: any, o: any) => { calls.push(['dispatchEvent', e, o.timeout]); },
      click: async () => { calls.push(['click']); },
    };
    const el = new WebElement(locator);
    expect(await el.click({ withoutScrolling: true, timeout: 700 })).toBe(el);
    expect(calls).toEqual([['waitFor', 'attached'], ['dispatchEvent', 'click', 700]]);
  });

  test('platform: a plain element click; the option changes nothing', async () => {
    const log: string[] = [];
    const el = new PlatformElement(swipeDriver(log, rawElement(log)), '~a');
    expect(await el.click({ withoutScrolling: true })).toBe(el);
    expect(log).toEqual(['click']);
  });
});

// ---------------------------------------------------------------------------
// WebElement.swipe waits for visible itself
// ---------------------------------------------------------------------------

test('WebElement.swipe waits for the element to be visible before reading its box', async () => {
  const calls: string[] = [];
  const locator: any = {
    waitFor: async (o: any) => { calls.push(`waitFor:${o.state}:${o.timeout}`); },
    boundingBox: async () => { calls.push('box'); return { x: 0, y: 0, width: 10, height: 10 }; },
    page: () => ({
      viewportSize: () => ({ width: 100, height: 100 }),
      mouse: { move: async () => {}, down: async () => {}, up: async () => {} },
    }),
  };
  await new WebElement(locator).swipe('up', { timeout: 321 });
  expect(calls).toEqual(['waitFor:visible:321', 'box']);
});

// ---------------------------------------------------------------------------
// PlatformElement.scrollIntoView timeout
// ---------------------------------------------------------------------------

test.describe('PlatformElement.scrollIntoView bounds', () => {
  test('without a timeout only the 20-swipe limit applies, and the error says so', async () => {
    const log: string[] = [];
    const el = new PlatformElement(swipeDriver(log, rawElement(log)), '~row');
    await expect(el.scrollIntoView()).rejects.toThrow(
      'scrollIntoView: element not visible after 20 swipes, the swipe limit (direction=down)',
    );
    expect(log.filter(l => l === 'swipe')).toHaveLength(20);
  });

  test('a timeout stops the sweep before the swipe limit, and the error names the timeout', async () => {
    const log: string[] = [];
    const driver = swipeDriver(log, rawElement(log), {
      performActions: async () => { log.push('swipe'); await new Promise(r => setTimeout(r, 40)); },
    });
    const el = new PlatformElement(driver, '~row');
    const started = Date.now();
    const err = await el.scrollIntoView({ direction: 'up', timeout: 150 }).then(() => null, (e: Error) => e);
    expect(err?.message).toMatch(
      /^scrollIntoView: element not visible within the 150 ms timeout \(\d+ of at most 20 swipes made, direction=up\)$/,
    );
    const swipes = log.filter(l => l === 'swipe').length;
    expect(swipes).toBeGreaterThan(0);
    expect(swipes).toBeLessThan(20);
    // No swipe starts after the deadline: at most one swipe past it.
    expect(Date.now() - started).toBeLessThan(150 + 200);
  });

  test('a timeout of 0 checks the screen once and makes no swipe', async () => {
    const log: string[] = [];
    const el = new PlatformElement(swipeDriver(log, rawElement(log)), '~row');
    await expect(el.scrollIntoView({ timeout: 0 })).rejects.toThrow(/within the 0 ms timeout \(0 of at most 20/);
    expect(log).not.toContain('swipe');
  });

  test('a visible element returns at once whatever the timeout', async () => {
    const log: string[] = [];
    const el = new PlatformElement(swipeDriver(log, rawElement(log, { isDisplayed: async () => true })), '~row');
    expect(await el.scrollIntoView({ timeout: 0 })).toBe(el);
    expect(log).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// One platform answer: the constructor platform drives behaviour
// ---------------------------------------------------------------------------

test.describe('PlatformElement platform detection', () => {
  test('pressSequentially follows the constructor platform when the driver reports none', async () => {
    const log: string[] = [];
    const el = new PlatformElement(swipeDriver(log, rawElement(log)), '~field', undefined, 1000, { platform: 'android' });
    await el.pressSequentially('ab', 0);
    expect(log).toEqual(['click', 'keys:a', 'keys:b']);
  });

  test('the constructor platform wins over the driver capabilities', async () => {
    const log: string[] = [];
    const driver = { ...swipeDriver(log, rawElement(log)), capabilities: { platformName: 'Android' } };
    const el = new PlatformElement(driver, '~field', undefined, 1000, { platform: 'ios' });
    await el.pressSequentially('ab', 0);
    expect(log).toEqual(['addValue:a', 'addValue:b']);
  });

  test('isAndroid falls back to WebdriverIO isAndroid', async () => {
    const log: string[] = [];
    const driver = { ...swipeDriver(log, rawElement(log)), isAndroid: true };
    await new PlatformElement(driver, '~field').pressSequentially('a', 0);
    expect(log).toEqual(['click', 'keys:a']);
  });

  test('an unknown platform is not treated as android for behaviour', async () => {
    const log: string[] = [];
    await new PlatformElement(swipeDriver(log, rawElement(log)), '~field').pressSequentially('a', 0);
    expect(log).toEqual(['addValue:a']);
  });
});

// ---------------------------------------------------------------------------
// Gestures chain like every other interaction
// ---------------------------------------------------------------------------

test('gesture chain steps run in order and the chain resolves to the element', async () => {
  const order: string[] = [];
  const step = (name: string) => async () => { order.push(name); return fake; };
  const fake: any = {
    waitFor: async () => {},
    longPress: step('longPress'),
    tapAt: step('tapAt'),
    pinch: step('pinch'),
    zoom: step('zoom'),
  };
  const { ElementChain } = await import('../src/types/ElementChain');
  const result = await new ElementChain(fake, 100).longPress().tapAt({ x: 1, y: 1 }).pinch().zoom();
  expect(result).toBe(fake);
  expect(order).toEqual(['longPress', 'tapAt', 'pinch', 'zoom']);
});

// ---------------------------------------------------------------------------
// isWeb / isPlatform narrow the type
// ---------------------------------------------------------------------------

test('isWeb and isPlatform are type guards', () => {
  const web: Element = new WebElement({} as any, 'css=a');
  const native: Element = new PlatformElement({}, '~a');
  if (isWeb(web)) {
    // The narrowing itself is type-checked in platform-types.check.ts.
    expect(web.locator).toBeDefined();
  } else {
    throw new Error('expected a web element');
  }
  if (isPlatform(native)) {
    expect(native.driver).toBeDefined();
  } else {
    throw new Error('expected a platform element');
  }
  expect(isPlatform(web)).toBe(false);
  expect(isWeb(native)).toBe(false);
});
