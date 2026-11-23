import { test, expect } from '@playwright/test';
import { WebElement, PlatformElement } from '../src/types';
import { ElementChain } from '../src/types/ElementChain';
import { PlatformNotSupportedError } from '../src/types/errors';

// ---------------------------------------------------------------------------
// Mock WebdriverIO element + driver that records W3C actions
// ---------------------------------------------------------------------------

const RECT = { x: 100, y: 200, width: 200, height: 100 };
const WINDOW = { width: 1000, height: 2000 };

function createMockWdioElement(overrides: Record<string, any> = {}): any {
  return {
    click: async () => {},
    isDisplayed: async () => true,
    waitForExist: async (_opts?: any) => {},
    waitForDisplayed: async (_opts?: any) => {},
    // No getRect: WebdriverIO 10 elements have none. The rect comes from
    // the protocol command driver.getElementRect(elementId).
    elementId: 'mock-elem-id',
    ...overrides,
  };
}

interface Recorder {
  performed: any[][];
  released: number;
  calls: string[];
  rectIds: string[];
}

function createRecordingDriver(
  elementOverrides: Record<string, any> = {},
  driverOverrides: Record<string, any> = {},
): { driver: any; rec: Recorder } {
  const rec: Recorder = { performed: [], released: 0, calls: [], rectIds: [] };
  const mockEl = createMockWdioElement(elementOverrides);
  const driver = {
    $: async () => mockEl,
    $$: async () => [mockEl],
    pause: async () => {},
    getWindowSize: async () => ({ ...WINDOW }),
    getElementRect: async (id: string) => { rec.rectIds.push(id); return { ...RECT }; },
    performActions: async (actions: any[]) => { rec.calls.push('performActions'); rec.performed.push(actions); },
    releaseActions: async () => { rec.calls.push('releaseActions'); rec.released++; },
    ...driverOverrides,
  };
  return { driver, rec };
}

function touch(id: string, actions: any[]) {
  return { type: 'pointer', id, parameters: { pointerType: 'touch' }, actions };
}

function finger(id: string, from: { x: number; y: number }, to: { x: number; y: number }) {
  return touch(id, [
    { type: 'pointerMove', duration: 0, origin: 'viewport', x: from.x, y: from.y },
    { type: 'pointerDown', button: 0 },
    { type: 'pause', duration: 100 },
    { type: 'pointerMove', duration: 500, origin: 'viewport', x: to.x, y: to.y },
    { type: 'pointerUp', button: 0 },
  ]);
}

// ===========================================================================
// PlatformElement.longPress
// ===========================================================================

test.describe('PlatformElement.longPress', () => {
  test('holds one touch pointer on the element centre for the default 1000 ms', async () => {
    const { driver, rec } = createRecordingDriver();
    const el = new PlatformElement(driver, '~card');
    const result = await el.longPress();
    expect(result).toBe(el);
    expect(rec.performed).toEqual([[
      touch('finger1', [
        { type: 'pointerMove', duration: 0, origin: 'viewport', x: 200, y: 250 },
        { type: 'pointerDown', button: 0 },
        { type: 'pause', duration: 1000 },
        { type: 'pointerUp', button: 0 },
      ]),
    ]]);
    expect(rec.calls).toEqual(['performActions', 'releaseActions']);
  });

  test('uses the supplied duration', async () => {
    const { driver, rec } = createRecordingDriver();
    await new PlatformElement(driver, '~card').longPress({ duration: 2500 });
    expect(rec.performed[0][0].actions[2]).toEqual({ type: 'pause', duration: 2500 });
  });

  test('rejects a negative or non-finite duration without sending actions', async () => {
    const { driver, rec } = createRecordingDriver();
    const el = new PlatformElement(driver, '~card');
    await expect(el.longPress({ duration: -1 })).rejects.toThrow(/longPress.*duration/);
    await expect(el.longPress({ duration: Number.NaN })).rejects.toThrow(/longPress.*duration/);
    expect(rec.performed).toHaveLength(0);
  });

  test('releases actions even when performActions fails, and surfaces the original error', async () => {
    const { driver, rec } = createRecordingDriver({}, {
      performActions: async () => { throw new Error('driver exploded'); },
    });
    await expect(new PlatformElement(driver, '~card').longPress()).rejects.toThrow('driver exploded');
    expect(rec.released).toBe(1);
  });

  test('a failing releaseActions does not mask the original error', async () => {
    const { driver } = createRecordingDriver({}, {
      performActions: async () => { throw new Error('perform failed'); },
      releaseActions: async () => { throw new Error('release failed'); },
    });
    await expect(new PlatformElement(driver, '~card').longPress()).rejects.toThrow('perform failed');
  });

  test('throws a clear error when the element has no rect', async () => {
    const { driver, rec } = createRecordingDriver({}, { getElementRect: async () => null });
    await expect(new PlatformElement(driver, '~card').longPress()).rejects.toThrow(/longPress.*bounds/);
    expect(rec.performed).toHaveLength(0);
  });

  test('reads the rect through driver.getElementRect with the element id', async () => {
    const { driver, rec } = createRecordingDriver();
    await new PlatformElement(driver, '~card').longPress({ duration: 10 });
    expect(rec.rectIds).toEqual(['mock-elem-id']);
  });

  test('rounds a fractional duration to an integer pause', async () => {
    const { driver, rec } = createRecordingDriver();
    await new PlatformElement(driver, '~card').longPress({ duration: 1500.6 });
    expect(rec.performed[0][0].actions[2]).toEqual({ type: 'pause', duration: 1501 });
  });

  test('throws when the element centre is outside the window, without sending actions', async () => {
    const { driver, rec } = createRecordingDriver({}, {
      getElementRect: async () => ({ x: 100, y: 2500, width: 200, height: 100 }),
    });
    await expect(new PlatformElement(driver, '~card').longPress())
      .rejects.toThrow(/longPress: element is outside the window.*scrollIntoView/);
    expect(rec.performed).toHaveLength(0);
  });

  test('a release failure after a successful gesture is thrown', async () => {
    const { driver } = createRecordingDriver({}, {
      releaseActions: async () => { throw new Error('release failed'); },
    });
    await expect(new PlatformElement(driver, '~card').longPress({ duration: 10 })).rejects.toThrow('release failed');
  });

  test('waits for the element to exist with the given timeout', async () => {
    let waitedWith: any;
    const { driver } = createRecordingDriver({ waitForExist: async (opts: any) => { waitedWith = opts; } });
    await new PlatformElement(driver, '~card').longPress({ duration: 500, timeout: 1234 });
    expect(waitedWith).toEqual({ timeout: 1234 });
  });
});

// ===========================================================================
// PlatformElement.tapAt
// ===========================================================================

test.describe('PlatformElement.tapAt', () => {
  test('taps at an offset from the element top-left corner', async () => {
    const { driver, rec } = createRecordingDriver();
    const el = new PlatformElement(driver, '~card');
    const result = await el.tapAt({ x: 10, y: 20 });
    expect(result).toBe(el);
    expect(rec.performed).toEqual([[
      touch('finger1', [
        { type: 'pointerMove', duration: 0, origin: 'viewport', x: 110, y: 220 },
        { type: 'pointerDown', button: 0 },
        { type: 'pause', duration: 50 },
        { type: 'pointerUp', button: 0 },
      ]),
    ]]);
    expect(rec.calls).toEqual(['performActions', 'releaseActions']);
  });

  test('accepts the top-left corner and the last pixel inside the element', async () => {
    const { driver, rec } = createRecordingDriver();
    const el = new PlatformElement(driver, '~card');
    await el.tapAt({ x: 0, y: 0 });
    await el.tapAt({ x: 199, y: 99 });
    expect(rec.performed[0][0].actions[0]).toMatchObject({ x: 100, y: 200 });
    expect(rec.performed[1][0].actions[0]).toMatchObject({ x: 299, y: 299 });
  });

  test('throws when the tap point is outside the window, without sending actions', async () => {
    const { driver, rec } = createRecordingDriver({}, {
      getElementRect: async () => ({ x: 100, y: 1950, width: 200, height: 100 }),
    });
    // 1950 + 60 = 2010 is below the 2000 px window.
    await expect(new PlatformElement(driver, '~card').tapAt({ x: 10, y: 60 }))
      .rejects.toThrow(/tapAt: element is outside the window.*scrollIntoView/);
    expect(rec.performed).toHaveLength(0);
  });

  test('a point on the window edge (x == window width) is outside', async () => {
    const { driver, rec } = createRecordingDriver({}, {
      getElementRect: async () => ({ x: 900, y: 0, width: 200, height: 100 }),
    });
    await expect(new PlatformElement(driver, '~card').tapAt({ x: 100, y: 10 }))
      .rejects.toThrow(/tapAt: element is outside the window/);
    expect(rec.performed).toHaveLength(0);
  });

  test('rounds fractional coordinates to integers', async () => {
    const { driver, rec } = createRecordingDriver();
    await new PlatformElement(driver, '~card').tapAt({ x: 10.6, y: 20.4 });
    expect(rec.performed[0][0].actions[0]).toMatchObject({ x: 111, y: 220 });
  });

  for (const offset of [
    { x: -1, y: 10 },
    { x: 10, y: -1 },
    { x: 200, y: 10 },
    { x: 10, y: 100 },
    { x: 201, y: 10 },
    { x: 10, y: 101 },
    { x: Number.NaN, y: 10 },
  ]) {
    test(`rejects offset ${JSON.stringify(offset)} outside the element bounds`, async () => {
      const { driver, rec } = createRecordingDriver();
      await expect(new PlatformElement(driver, '~card').tapAt(offset))
        .rejects.toThrow(/tapAt: offset .* outside the element bounds \(200x100\)/);
      expect(rec.performed).toHaveLength(0);
      expect(rec.released).toBe(0);
    });
  }

  test('releases actions when performActions fails', async () => {
    const { driver, rec } = createRecordingDriver({}, {
      performActions: async () => { throw new Error('boom'); },
    });
    await expect(new PlatformElement(driver, '~card').tapAt({ x: 1, y: 1 })).rejects.toThrow('boom');
    expect(rec.released).toBe(1);
  });

  test('a rect read failure names the method and appends the cause', async () => {
    const { driver } = createRecordingDriver({}, { getElementRect: async () => { throw new Error('stale element'); } });
    await expect(new PlatformElement(driver, '~card').tapAt({ x: 1, y: 1 }))
      .rejects.toThrow(/tapAt: could not read the element bounds for "~card": stale element/);
  });
});

// ===========================================================================
// PlatformElement.zoom / pinch
// ===========================================================================
// RECT centre is (200, 250). The outer half-span is 40% of the element
// width (80 px); the inner half-span is outer * scale (pinch) or
// outer / scale (zoom), never below 10 px.

test.describe('PlatformElement.zoom', () => {
  test('moves two touch pointers apart from the centre with the default scale 2', async () => {
    const { driver, rec } = createRecordingDriver();
    const el = new PlatformElement(driver, '~map');
    const result = await el.zoom();
    expect(result).toBe(el);
    expect(rec.performed).toEqual([[
      finger('finger1', { x: 160, y: 250 }, { x: 120, y: 250 }),
      finger('finger2', { x: 240, y: 250 }, { x: 280, y: 250 }),
    ]]);
    expect(rec.calls).toEqual(['performActions', 'releaseActions']);
  });

  test('uses the supplied scale', async () => {
    const { driver, rec } = createRecordingDriver();
    await new PlatformElement(driver, '~map').zoom({ scale: 4 });
    expect(rec.performed[0]).toEqual([
      finger('finger1', { x: 180, y: 250 }, { x: 120, y: 250 }),
      finger('finger2', { x: 220, y: 250 }, { x: 280, y: 250 }),
    ]);
  });

  test('keeps a 10 px minimum half-gap and scales the end from it', async () => {
    const { driver, rec } = createRecordingDriver();
    await new PlatformElement(driver, '~map').zoom({ scale: 20 });
    // 80/20 = 4 -> raised to 10; end = 10 * 20 = 200.
    expect(rec.performed[0]).toEqual([
      finger('finger1', { x: 190, y: 250 }, { x: 0, y: 250 }),
      finger('finger2', { x: 210, y: 250 }, { x: 400, y: 250 }),
    ]);
  });

  test('clamps only the outer finger positions to the window', async () => {
    const { driver, rec } = createRecordingDriver({}, {
      getElementRect: async () => ({ x: 850, y: 200, width: 200, height: 100 }),
    });
    await new PlatformElement(driver, '~map').zoom();
    // Centre (950, 250): inner 40 px each side, outer 80 px -> right end 1030, clamped to 999.
    expect(rec.performed[0]).toEqual([
      finger('finger1', { x: 910, y: 250 }, { x: 870, y: 250 }),
      finger('finger2', { x: 990, y: 250 }, { x: 999, y: 250 }),
    ]);
  });

  test('throws when clamping would leave a finger without movement', async () => {
    const { driver, rec } = createRecordingDriver({}, {
      getElementRect: async () => ({ x: 900, y: 200, width: 196, height: 100 }),
    });
    // Centre (998, 250): the right inner finger (998 + 39 = 1037) is already off the window.
    await expect(new PlatformElement(driver, '~map').zoom())
      .rejects.toThrow(/zoom: .*too close to the window edge/);
    expect(rec.performed).toHaveLength(0);
  });

  test('throws when the element centre is outside the window', async () => {
    const { driver, rec } = createRecordingDriver({}, {
      getElementRect: async () => ({ x: 900, y: 1950, width: 200, height: 100 }),
    });
    await expect(new PlatformElement(driver, '~map').zoom())
      .rejects.toThrow(/zoom: element is outside the window.*scrollIntoView/);
    expect(rec.performed).toHaveLength(0);
  });

  test('each finger pauses 100 ms after touching down and both lists have equal length', async () => {
    const { driver, rec } = createRecordingDriver();
    await new PlatformElement(driver, '~map').zoom();
    const [a, b] = rec.performed[0];
    expect(a.actions).toHaveLength(b.actions.length);
    expect(a.actions[2]).toEqual({ type: 'pause', duration: 100 });
    expect(b.actions[2]).toEqual({ type: 'pause', duration: 100 });
    for (const step of [...a.actions, ...b.actions]) {
      if ('duration' in step) expect(Number.isInteger(step.duration)).toBe(true);
    }
  });

  for (const scale of [1, 0.5, 0, -2, Number.NaN, Number.POSITIVE_INFINITY]) {
    test(`rejects scale ${scale}`, async () => {
      const { driver, rec } = createRecordingDriver();
      await expect(new PlatformElement(driver, '~map').zoom({ scale }))
        .rejects.toThrow(/zoom: scale must be a finite number greater than 1/);
      expect(rec.performed).toHaveLength(0);
    });
  }

  test('releases actions when performActions fails', async () => {
    const { driver, rec } = createRecordingDriver({}, {
      performActions: async () => { throw new Error('nope'); },
    });
    await expect(new PlatformElement(driver, '~map').zoom()).rejects.toThrow('nope');
    expect(rec.released).toBe(1);
  });

  test('throws a clear error when the element has no rect', async () => {
    const { driver } = createRecordingDriver({}, { getElementRect: async () => null });
    await expect(new PlatformElement(driver, '~map').zoom()).rejects.toThrow(/zoom.*bounds/);
  });
});

test.describe('PlatformElement.pinch', () => {
  test('moves two touch pointers together with the default scale 0.5', async () => {
    const { driver, rec } = createRecordingDriver();
    const el = new PlatformElement(driver, '~map');
    const result = await el.pinch();
    expect(result).toBe(el);
    expect(rec.performed).toEqual([[
      finger('finger1', { x: 120, y: 250 }, { x: 160, y: 250 }),
      finger('finger2', { x: 280, y: 250 }, { x: 240, y: 250 }),
    ]]);
    expect(rec.calls).toEqual(['performActions', 'releaseActions']);
  });

  test('uses the supplied scale', async () => {
    const { driver, rec } = createRecordingDriver();
    await new PlatformElement(driver, '~map').pinch({ scale: 0.25 });
    expect(rec.performed[0]).toEqual([
      finger('finger1', { x: 120, y: 250 }, { x: 180, y: 250 }),
      finger('finger2', { x: 280, y: 250 }, { x: 220, y: 250 }),
    ]);
  });

  test('keeps a 10 px minimum half-gap at the end of the pinch', async () => {
    const { driver, rec } = createRecordingDriver({}, { getElementRect: async () => ({ x: 100, y: 100, width: 20, height: 20 }) });
    await new PlatformElement(driver, '~dot').pinch();
    // Centre (110, 110). outer 8 * 0.5 = 4 -> end raised to 10, start = 10 / 0.5 = 20.
    expect(rec.performed[0]).toEqual([
      finger('finger1', { x: 90, y: 110 }, { x: 100, y: 110 }),
      finger('finger2', { x: 130, y: 110 }, { x: 120, y: 110 }),
    ]);
  });

  test('throws when the element centre is outside the window', async () => {
    const { driver, rec } = createRecordingDriver({}, {
      getElementRect: async () => ({ x: -300, y: 200, width: 200, height: 100 }),
    });
    await expect(new PlatformElement(driver, '~map').pinch())
      .rejects.toThrow(/pinch: element is outside the window.*scrollIntoView/);
    expect(rec.performed).toHaveLength(0);
  });

  test('clamps the outer (start) finger positions to the window', async () => {
    const { driver, rec } = createRecordingDriver({}, {
      getElementRect: async () => ({ x: -50, y: 200, width: 200, height: 100 }),
    });
    await new PlatformElement(driver, '~map').pinch();
    // Centre (50, 250): start 80 px each side -> left start -30 clamped to 0; end 40 px each side.
    expect(rec.performed[0]).toEqual([
      finger('finger1', { x: 0, y: 250 }, { x: 10, y: 250 }),
      finger('finger2', { x: 130, y: 250 }, { x: 90, y: 250 }),
    ]);
  });

  for (const scale of [0, 1, 1.5, -0.5, Number.NaN]) {
    test(`rejects scale ${scale}`, async () => {
      const { driver, rec } = createRecordingDriver();
      await expect(new PlatformElement(driver, '~map').pinch({ scale }))
        .rejects.toThrow(/pinch: scale must be a finite number between 0 and 1 \(exclusive\)/);
      expect(rec.performed).toHaveLength(0);
    });
  }

  test('releases actions when performActions fails', async () => {
    const { driver, rec } = createRecordingDriver({}, {
      performActions: async () => { throw new Error('nope'); },
    });
    await expect(new PlatformElement(driver, '~map').pinch()).rejects.toThrow('nope');
    expect(rec.released).toBe(1);
  });
});

// ===========================================================================
// WebElement (real Playwright page)
// ===========================================================================

const GESTURE_PAGE = `<!doctype html>
<style>body { margin: 0 } #pad { position: absolute; left: 50px; top: 40px; width: 200px; height: 100px; background: #ccc }</style>
<div id="pad"></div>
<script>
  window.events = [];
  const pad = document.getElementById('pad');
  for (const type of ['mousedown', 'mouseup', 'click']) {
    pad.addEventListener(type, e => window.events.push({ type, x: e.clientX, y: e.clientY, t: performance.now() }));
  }
</script>`;

const RECORD_SCRIPT = `<script>
  window.events = [];
  for (const id of ['pad', 'cover']) {
    const node = document.getElementById(id);
    if (!node) continue;
    for (const type of ['mousedown', 'mouseup']) node.addEventListener(type, () => window.events.push({ id, type }));
  }
</script>`;

const BELOW_FOLD_PAGE = `<!doctype html>
<style>body { margin: 0 } #pad { position: absolute; left: 50px; top: 3000px; width: 200px; height: 100px; background: #ccc }</style>
<div style="height: 4000px"></div><div id="pad"></div>${RECORD_SCRIPT}`;

const OVERLAY_PAGE = `<!doctype html>
<style>body { margin: 0 } #pad { position: absolute; left: 50px; top: 40px; width: 200px; height: 100px; background: #ccc }
#cover { position: fixed; inset: 0; background: rgba(0,0,0,.3) }</style>
<div id="pad"></div><div id="cover"></div>${RECORD_SCRIPT}`;

test.describe('WebElement gestures', () => {
  test('longPress holds the mouse button on the element centre for the duration', async ({ page }) => {
    await page.setContent(GESTURE_PAGE);
    const el = new WebElement(page.locator('#pad'), '#pad');
    const result = await el.longPress({ duration: 300 });
    expect(result).toBe(el);
    const events = await page.evaluate(() => (window as any).events);
    const down = events.find((e: any) => e.type === 'mousedown');
    const up = events.find((e: any) => e.type === 'mouseup');
    expect(down).toMatchObject({ x: 150, y: 90 });
    expect(up).toMatchObject({ x: 150, y: 90 });
    expect(up.t - down.t).toBeGreaterThanOrEqual(250);
  });

  test('longPress scrolls an element below the fold into view and presses it', async ({ page }) => {
    await page.setViewportSize({ width: 800, height: 600 });
    await page.setContent(BELOW_FOLD_PAGE);
    const el = new WebElement(page.locator('#pad'), '#pad');
    await el.longPress({ duration: 50 });
    const events = await page.evaluate(() => (window as any).events);
    expect(events.map((e: any) => e.type)).toEqual(expect.arrayContaining(['mousedown', 'mouseup']));
  });

  test('longPress on an element under an overlay fails clearly and presses nothing', async ({ page }) => {
    await page.setContent(OVERLAY_PAGE);
    const el = new WebElement(page.locator('#pad'), '#pad');
    await expect(el.longPress({ duration: 50, timeout: 1000 })).rejects.toThrow(/intercepts pointer events|Timeout/);
    const events = await page.evaluate(() => (window as any).events);
    expect(events).toEqual([]);
  });

  test('longPress accepts a fractional duration', async ({ page }) => {
    await page.setContent(GESTURE_PAGE);
    const el = new WebElement(page.locator('#pad'), '#pad');
    await el.longPress({ duration: 20.7 });
    const events = await page.evaluate(() => (window as any).events);
    expect(events.map((e: any) => e.type)).toEqual(expect.arrayContaining(['mousedown', 'mouseup']));
  });

  test('longPress rejects an invalid duration', async ({ page }) => {
    await page.setContent(GESTURE_PAGE);
    const el = new WebElement(page.locator('#pad'), '#pad');
    await expect(el.longPress({ duration: -5 })).rejects.toThrow(/longPress.*duration/);
  });

  test('tapAt clicks at the offset from the element top-left corner', async ({ page }) => {
    await page.setContent(GESTURE_PAGE);
    const el = new WebElement(page.locator('#pad'), '#pad');
    const result = await el.tapAt({ x: 10, y: 20 });
    expect(result).toBe(el);
    const events = await page.evaluate(() => (window as any).events);
    expect(events.find((e: any) => e.type === 'click')).toMatchObject({ x: 60, y: 60 });
  });

  test('tapAt rejects an offset on the far edge (upper bound is exclusive)', async ({ page }) => {
    await page.setContent(GESTURE_PAGE);
    const el = new WebElement(page.locator('#pad'), '#pad');
    await expect(el.tapAt({ x: 200, y: 20 })).rejects.toThrow(/tapAt: offset .* outside the element bounds \(200x100\)/);
  });

  test('tapAt rejects an offset outside the element bounds', async ({ page }) => {
    await page.setContent(GESTURE_PAGE);
    const el = new WebElement(page.locator('#pad'), '#pad');
    await expect(el.tapAt({ x: 250, y: 20 })).rejects.toThrow(/tapAt: offset .* outside the element bounds \(200x100\)/);
    const events = await page.evaluate(() => (window as any).events);
    expect(events).toHaveLength(0);
  });

  for (const method of ['pinch', 'zoom'] as const) {
    test(`${method} throws PlatformNotSupportedError on web`, async ({ page }) => {
      await page.setContent(GESTURE_PAGE);
      const el = new WebElement(page.locator('#pad'), '#pad');
      const error = await el[method]().then(() => null, (e: unknown) => e);
      expect(error).toBeInstanceOf(PlatformNotSupportedError);
      expect((error as Error).message).toBe(`"${method}" is not supported on platform "web".`);
      expect((error as PlatformNotSupportedError).method).toBe(method);
      expect((error as PlatformNotSupportedError).platform).toBe('web');
    });
  }
});

// ===========================================================================
// ElementChain forwarding
// ===========================================================================

function createSpyElement(log: any[]): any {
  return {
    waitFor: async (opts: any) => { log.push(['waitFor', opts]); },
    longPress: async (...args: any[]) => { log.push(['longPress', ...args]); },
    tapAt: async (...args: any[]) => { log.push(['tapAt', ...args]); },
    pinch: async (...args: any[]) => { log.push(['pinch', ...args]); },
    zoom: async (...args: any[]) => { log.push(['zoom', ...args]); },
  };
}

test.describe('ElementChain gesture forwarding', () => {
  test('longPress waits for visible, then forwards the duration with the chain timeout', async () => {
    const log: any[] = [];
    await new ElementChain(createSpyElement(log), 4000).longPress({ duration: 1500 });
    expect(log).toEqual([
      ['waitFor', { state: 'visible', timeout: 4000 }],
      ['longPress', { duration: 1500, timeout: 4000 }],
    ]);
  });

  test('tapAt waits for visible, then forwards the offset', async () => {
    const log: any[] = [];
    await new ElementChain(createSpyElement(log), 4000).tapAt({ x: 3, y: 4 });
    expect(log).toEqual([
      ['waitFor', { state: 'visible', timeout: 4000 }],
      ['tapAt', { x: 3, y: 4 }, { timeout: 4000 }],
    ]);
  });

  test('pinch and zoom wait for visible, then forward their options with the chain timeout', async () => {
    const log: any[] = [];
    await new ElementChain(createSpyElement(log), 4000).pinch({ scale: 0.3 }).zoom({ scale: 3 });
    expect(log).toEqual([
      ['waitFor', { state: 'visible', timeout: 4000 }],
      ['pinch', { scale: 0.3, timeout: 4000 }],
      ['waitFor', { state: 'visible', timeout: 4000 }],
      ['zoom', { scale: 3, timeout: 4000 }],
    ]);
  });

  test('an explicit option timeout wins over the chain timeout', async () => {
    const log: any[] = [];
    await new ElementChain(createSpyElement(log), 4000).zoom({ timeout: 100 });
    expect(log).toEqual([
      ['waitFor', { state: 'visible', timeout: 100 }],
      ['zoom', { timeout: 100 }],
    ]);
  });

  test('chain forwards to a real PlatformElement and sends the W3C sequence', async () => {
    const { driver, rec } = createRecordingDriver();
    await new PlatformElement(driver, '~card').action(2000).longPress({ duration: 700 });
    expect(rec.performed[0][0].actions[2]).toEqual({ type: 'pause', duration: 700 });
    expect(rec.released).toBe(1);
  });
});
