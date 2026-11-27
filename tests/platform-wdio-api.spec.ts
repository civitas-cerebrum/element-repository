import { test, expect } from '@playwright/test';
import { PlatformElement } from '../src/types';

// The mock element only carries what a WebdriverIO 10 element really has
// for these paths: an `elementId`. Rect, CSS value and element screenshot are
// protocol commands on the driver that take the element id, so calling a
// non-existent element method (getRect, getCSSValue, takeElementScreenshot
// without an id) fails these tests.

function mockElement(): any {
  return {
    elementId: 'el-7',
    waitForExist: async () => {},
    isDisplayed: async () => true,
  };
}

function mockDriver(overrides: Record<string, any> = {}): { driver: any; ids: string[] } {
  const ids: string[] = [];
  const el = mockElement();
  const driver = {
    $: async () => el,
    $$: async () => [el],
    pause: async () => {},
    getWindowSize: async () => ({ width: 1000, height: 2000 }),
    getElementRect: async (id: string) => { ids.push(id); return { x: 1, y: 2, width: 3, height: 4 }; },
    getElementCSSValue: async (id: string, prop: string) => { ids.push(id); return `${prop}-value`; },
    takeElementScreenshot: async (id: string) => { ids.push(id); return Buffer.from('png').toString('base64'); },
    ...overrides,
  };
  return { driver, ids };
}

test.describe('PlatformElement uses WebdriverIO protocol commands with the element id', () => {
  test('boundingBox reads driver.getElementRect(elementId)', async () => {
    const { driver, ids } = mockDriver();
    expect(await new PlatformElement(driver, '~x').boundingBox()).toEqual({ x: 1, y: 2, width: 3, height: 4 });
    expect(ids).toEqual(['el-7']);
  });

  test('boundingBox returns null when the driver has no rect', async () => {
    const { driver } = mockDriver({ getElementRect: async () => null });
    expect(await new PlatformElement(driver, '~x').boundingBox()).toBeNull();
  });

  test('boundingBox failure appends the cause', async () => {
    const { driver } = mockDriver({ getElementRect: async () => { throw new Error('no such element'); } });
    await expect(new PlatformElement(driver, '~x').boundingBox()).rejects.toThrow(/boundingBox.*no such element/);
  });

  test('getCssProperty reads driver.getElementCSSValue(elementId, property)', async () => {
    const { driver, ids } = mockDriver();
    expect(await new PlatformElement(driver, '~x').getCssProperty('color')).toBe('color-value');
    expect(ids).toEqual(['el-7']);
  });

  test('screenshot reads driver.takeElementScreenshot(elementId)', async () => {
    const { driver, ids } = mockDriver();
    const buf = await new PlatformElement(driver, '~x').screenshot();
    expect(buf.toString()).toBe('png');
    expect(ids).toEqual(['el-7']);
  });
});

// WebdriverIO 10's `$` is strict by default: with several matches it throws
// unless the call passes `{ strict: false }`. This mock behaves the same way.
test.describe('PlatformElement opts out of WebdriverIO 10 strict `$`', () => {
  function strictDriver(): { driver: any; options: unknown[] } {
    const options: unknown[] = [];
    const matches = [mockElement(), { ...mockElement(), elementId: 'el-8' }];
    const driver = {
      $: async (_sel: string, opts?: { strict?: boolean }) => {
        options.push(opts);
        if (opts?.strict !== false) throw new Error('strict mode violation: resolved to 2 elements, expected 1.');
        return matches[0];
      },
      $$: async () => matches,
      pause: async () => {},
      getWindowSize: async () => ({ width: 1000, height: 2000 }),
      getElementRect: async (id: string) => ({ x: id === 'el-7' ? 1 : 9, y: 2, width: 3, height: 4 }),
    };
    return { driver, options };
  }

  test('a plain element passes { strict: false } and acts on the first match', async () => {
    const { driver, options } = strictDriver();
    expect(await new PlatformElement(driver, '~x').boundingBox()).toEqual({ x: 1, y: 2, width: 3, height: 4 });
    expect(options).toEqual([{ strict: false }]);
  });

  test('first() passes { strict: false } and acts on the first match', async () => {
    const { driver, options } = strictDriver();
    expect(await new PlatformElement(driver, '~x').first().boundingBox()).toEqual({ x: 1, y: 2, width: 3, height: 4 });
    expect(options).toEqual([{ strict: false }]);
  });
});
