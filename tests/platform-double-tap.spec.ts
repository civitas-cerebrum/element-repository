import { test, expect } from '@playwright/test';
import { PlatformElement } from '../src/types';
import { ElementChain } from '../src/types/ElementChain';

// ---------------------------------------------------------------------------
// doubleClick on platform elements: a real double tap on the element.
// iOS sends XCUITest's own double tap (`mobile: doubleTap` on the element);
// Android UiAutomator2's (`mobile: doubleClickGesture` on the element).
// WebdriverIO's desktop double-click (a mouse pointer: move, down, up,
// pause 10 ms, down, up) is taken by XCUITest as ONE tap, and its 10 ms gap
// is below Android's 40 ms minimum between the taps of a double tap.
// ---------------------------------------------------------------------------

interface Calls { execute: Array<[string, unknown]>; doubleClick: number; actions: number }

function rawElement(calls: Calls, elementId: string | null = 'el-1'): any {
  return {
    elementId,
    waitForExist: async () => true,
    waitForDisplayed: async () => true,
    isDisplayed: async () => true,
    doubleClick: async () => { calls.doubleClick++; },
  };
}

function driverFor(raw: any, calls: Calls, caps: Record<string, unknown> = {}): any {
  return {
    capabilities: caps,
    $: async () => raw,
    $$: async () => (raw?.elementId ? [raw] : []),
    execute: async (script: string, args: unknown) => { calls.execute.push([script, args]); return null; },
    performActions: async () => { calls.actions++; },
    releaseActions: async () => {},
  };
}

const fresh = (): Calls => ({ execute: [], doubleClick: 0, actions: 0 });

test.describe('PlatformElement.doubleClick', () => {
  test('ios: one `mobile: doubleTap` on the element id, no pointer actions, no WebdriverIO doubleClick', async () => {
    const calls = fresh();
    const el = new PlatformElement(driverFor(rawElement(calls), calls), '~increment', undefined, 1000, { platform: 'ios' });
    expect(await el.doubleClick()).toBe(el);
    expect(calls.execute).toEqual([['mobile: doubleTap', { elementId: 'el-1' }]]);
    expect(calls.doubleClick).toBe(0);
    expect(calls.actions).toBe(0);
  });

  test('ios is also detected from the driver capabilities', async () => {
    const calls = fresh();
    const el = new PlatformElement(driverFor(rawElement(calls), calls, { platformName: 'iOS' }), '~increment');
    await el.doubleClick();
    expect(calls.execute).toEqual([['mobile: doubleTap', { elementId: 'el-1' }]]);
  });

  test('ios: an indexed match double-taps that match', async () => {
    const calls = fresh();
    const first = rawElement(calls, 'el-1');
    const second = rawElement(calls, 'el-2');
    const driver = { ...driverFor(first, calls), $$: async () => [first, second] };
    await new PlatformElement(driver, '~row', undefined, 1000, { platform: 'ios' }).nth(1).doubleClick();
    expect(calls.execute).toEqual([['mobile: doubleTap', { elementId: 'el-2' }]]);
  });

  test('ios: a missing element fails naming the method, without sending a double tap', async () => {
    const calls = fresh();
    const el = new PlatformElement(driverFor(rawElement(calls, null), calls), '~gone', undefined, 50, { platform: 'ios' });
    await expect(el.doubleClick()).rejects.toThrow('doubleClick: "~gone" not found within 50 ms');
    expect(calls.execute).toEqual([]);
  });

  test('ios: the driver error is passed through', async () => {
    const calls = fresh();
    const driver = { ...driverFor(rawElement(calls), calls), execute: async () => { throw new Error('element is not hittable'); } };
    await expect(new PlatformElement(driver, '~x', undefined, 1000, { platform: 'ios' }).doubleClick())
      .rejects.toThrow('element is not hittable');
  });

  test('android: one `mobile: doubleClickGesture` on the element id, no pointer actions, no WebdriverIO doubleClick', async () => {
    const calls = fresh();
    const el = new PlatformElement(driverFor(rawElement(calls), calls), 'id=increment', undefined, 1000, { platform: 'android' });
    expect(await el.doubleClick()).toBe(el);
    expect(calls.execute).toEqual([['mobile: doubleClickGesture', { elementId: 'el-1' }]]);
    expect(calls.doubleClick).toBe(0);
    expect(calls.actions).toBe(0);
  });

  test('android is also detected from the driver capabilities', async () => {
    const calls = fresh();
    await new PlatformElement(driverFor(rawElement(calls), calls, { platformName: 'Android' }), 'id=increment').doubleClick();
    expect(calls.execute).toEqual([['mobile: doubleClickGesture', { elementId: 'el-1' }]]);
  });

  test('android: an indexed match double-taps that match', async () => {
    const calls = fresh();
    const first = rawElement(calls, 'el-1');
    const second = rawElement(calls, 'el-2');
    const driver = { ...driverFor(first, calls), $$: async () => [first, second] };
    await new PlatformElement(driver, 'id=row', undefined, 1000, { platform: 'android' }).nth(1).doubleClick();
    expect(calls.execute).toEqual([['mobile: doubleClickGesture', { elementId: 'el-2' }]]);
  });

  test('android: a missing element fails naming the method, without sending a double tap', async () => {
    const calls = fresh();
    const el = new PlatformElement(driverFor(rawElement(calls, null), calls), 'id=gone', undefined, 50, { platform: 'android' });
    await expect(el.doubleClick()).rejects.toThrow('doubleClick: "id=gone" not found within 50 ms');
    expect(calls.execute).toEqual([]);
    expect(calls.doubleClick).toBe(0);
  });

  test('android: the driver error is passed through', async () => {
    const calls = fresh();
    const driver = { ...driverFor(rawElement(calls), calls), execute: async () => { throw new Error('stale element reference'); } };
    await expect(new PlatformElement(driver, 'id=x', undefined, 1000, { platform: 'android' }).doubleClick())
      .rejects.toThrow('stale element reference');
  });

  test('another or an unknown platform keeps WebdriverIO doubleClick', async () => {
    for (const platform of ['windows', undefined] as const) {
      const calls = fresh();
      await new PlatformElement(driverFor(rawElement(calls), calls), '~x', undefined, 1000, { platform }).doubleClick();
      expect(calls.doubleClick).toBe(1);
      expect(calls.execute).toEqual([]);
    }
  });

  test('ElementChain.doubleClick reaches the ios double tap', async () => {
    const calls = fresh();
    const el = new PlatformElement(driverFor(rawElement(calls), calls), '~increment', undefined, 1000, { platform: 'ios' });
    await new ElementChain(el, 1000).doubleClick();
    expect(calls.execute).toEqual([['mobile: doubleTap', { elementId: 'el-1' }]]);
  });
});
