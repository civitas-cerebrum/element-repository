import { test, expect } from '@playwright/test';
import { PlatformElement, WebElement } from '../src/types';
import { ElementChain } from '../src/types/ElementChain';

// ---------------------------------------------------------------------------
// Where a scrollIntoView sweep swipes. An 852-pt window (393 wide) with a
// horizontal paging carousel at y 113-314, as on the iOS test app's
// Product Carousel screen. A left / right sweep must run along a row that
// crosses the scroller: the container's (when given), else the target's
// own row (when the target is in the element tree), else the window centre.
// ---------------------------------------------------------------------------

type Rect = { x: number; y: number; width: number; height: number };

const WINDOW = { width: 393, height: 852 };
const CAROUSEL: Rect = { x: 0, y: 113, width: 393, height: 201 };

interface Swipe { from: { x: number; y: number }; to: { x: number; y: number } }

/**
 * A fake Appium driver: `rects` maps a selector to the rect of its one
 * match (a selector without a rect is not in the element tree, so `$`
 * answers with an element that has no id, as WebdriverIO does). Nothing is
 * ever displayed, so the sweep runs to its swipe limit.
 */
function fakeDriver(rects: Record<string, Rect | (() => Rect)>) {
  const swipes: Swipe[] = [];
  const rectReads: string[] = [];
  const raw = (selector: string) => (selector in rects
    ? { elementId: selector, isDisplayed: async () => false, waitForExist: async () => true, waitForDisplayed: async () => true }
    : { selector, isDisplayed: async () => { throw new Error(`no such element: ${selector}`); }, waitForExist: async () => false });
  const driver = {
    capabilities: { platformName: 'iOS' },
    $: async (selector: string) => raw(selector),
    $$: async (selector: string) => (selector in rects ? [raw(selector)] : []),
    getWindowSize: async () => WINDOW,
    getElementRect: async (id: string) => {
      rectReads.push(id);
      const r = rects[id];
      if (!r) throw new Error(`no such element: ${id}`);
      return typeof r === 'function' ? r() : r;
    },
    pause: async () => {},
    performActions: async (sources: any[]) => {
      const a = sources[0].actions;
      swipes.push({ from: { x: a[0].x, y: a[0].y }, to: { x: a[3].x, y: a[3].y } });
    },
    releaseActions: async () => {},
  };
  return { driver, swipes, rectReads };
}

const el = (driver: any, selector: string) => new PlatformElement(driver, selector, undefined, 200, { platform: 'ios' });

async function sweep(target: PlatformElement, options: Parameters<PlatformElement['scrollIntoView']>[0]): Promise<Error> {
  const err = await target.scrollIntoView({ maxSwipes: 2, ...options }).then(() => null, (e: Error) => e);
  expect(err).not.toBeNull();
  return err!;
}

test.describe('scrollIntoView left / right: the row the sweep runs along', () => {
  test('with a container: at the container\'s vertical centre, from 75% to 25% of its width', async () => {
    const { driver, swipes } = fakeDriver({ '~carousel': CAROUSEL });
    const err = await sweep(el(driver, '~product-name-2'), { direction: 'right', container: el(driver, '~carousel') });
    expect(err.message).toBe('scrollIntoView: element not visible after 2 swipes, the swipe limit (direction=right)');
    // Carousel y 113-314: centre y 213.5 -> 214. Width 393: 75% = 295, 25% = 98.
    expect(swipes).toEqual([
      { from: { x: 295, y: 214 }, to: { x: 98, y: 214 } },
      { from: { x: 295, y: 214 }, to: { x: 98, y: 214 } },
    ]);
  });

  test('with a container, direction left: the same row the other way', async () => {
    const { driver, swipes } = fakeDriver({ '~carousel': CAROUSEL });
    await sweep(el(driver, '~product-name-0'), { direction: 'left', container: el(driver, '~carousel') });
    expect(swipes[0]).toEqual({ from: { x: 98, y: 214 }, to: { x: 295, y: 214 } });
  });

  test('a narrower container: the sweep stays inside its width', async () => {
    const { driver, swipes } = fakeDriver({ '~strip': { x: 40, y: 600, width: 200, height: 80 } });
    await sweep(el(driver, '~chip-9'), { direction: 'right', container: el(driver, '~strip') });
    // x 40-240: 75% = 190, 25% = 90; centre y 640.
    expect(swipes[0]).toEqual({ from: { x: 190, y: 640 }, to: { x: 90, y: 640 } });
  });

  test('a container partly above the window: only its visible part counts', async () => {
    const { driver, swipes } = fakeDriver({ '~carousel': { ...CAROUSEL, y: -50 } });
    await sweep(el(driver, '~product-name-2'), { direction: 'right', container: el(driver, '~carousel') });
    // Visible y 0-151: centre 75.5 -> 76.
    expect(swipes[0]).toEqual({ from: { x: 295, y: 76 }, to: { x: 98, y: 76 } });
  });

  test('a container wholly outside the window fails before any swipe', async () => {
    const { driver, swipes } = fakeDriver({ '~carousel': { ...CAROUSEL, y: 900 } });
    const err = await sweep(el(driver, '~product-name-2'), { direction: 'right', container: el(driver, '~carousel') });
    expect(err.message).toBe('scrollIntoView: the container "~carousel" is outside the window (393x852); scroll it into view first');
    expect(swipes).toEqual([]);
  });

  test('a container that is not found fails naming it, before any swipe', async () => {
    const { driver, swipes } = fakeDriver({});
    const err = await sweep(el(driver, '~product-name-2'), { direction: 'right', container: el(driver, '~carousel') });
    expect(err.message).toMatch(/^scrollIntoView \(container\): "~carousel" not found within \d+ ms/);
    expect(swipes).toEqual([]);
  });

  test('without a container, a target in the tree: at the target\'s own vertical centre', async () => {
    // Slide 2 sits off-screen to the right, inside the carousel.
    const { driver, swipes } = fakeDriver({ '~product-name-2': { x: 806, y: 150, width: 300, height: 40 } });
    await sweep(el(driver, '~product-name-2'), { direction: 'right' });
    expect(swipes).toEqual([
      { from: { x: 295, y: 170 }, to: { x: 98, y: 170 } },
      { from: { x: 295, y: 170 }, to: { x: 98, y: 170 } },
    ]);
  });

  test('the target\'s row is read again before every swipe', async () => {
    let y = 150;
    const { driver, swipes } = fakeDriver({ '~product-name-2': () => ({ x: 806, y: (y += 100) - 100, width: 300, height: 40 }) });
    await sweep(el(driver, '~product-name-2'), { direction: 'right' });
    expect(swipes.map(s => s.from.y)).toEqual([170, 270]);
  });

  test('without a container, a target not in the tree: the window\'s vertical centre (a container is needed)', async () => {
    const { driver, swipes } = fakeDriver({});
    await sweep(el(driver, '~product-name-2'), { direction: 'right' });
    expect(swipes[0]).toEqual({ from: { x: 295, y: 426 }, to: { x: 98, y: 426 } });
  });

  test('a target whose row is outside the window: the window centre', async () => {
    const { driver, swipes } = fakeDriver({ '~product-name-2': { x: 806, y: 1200, width: 300, height: 40 } });
    await sweep(el(driver, '~product-name-2'), { direction: 'right' });
    expect(swipes[0]).toEqual({ from: { x: 295, y: 426 }, to: { x: 98, y: 426 } });
  });

  test('a target with an empty rect counts as not placed: the window centre', async () => {
    const { driver, swipes } = fakeDriver({ '~product-name-2': { x: 0, y: 0, width: 0, height: 0 } });
    await sweep(el(driver, '~product-name-2'), { direction: 'right' });
    expect(swipes[0]).toEqual({ from: { x: 295, y: 426 }, to: { x: 98, y: 426 } });
  });
});

test.describe('scrollIntoView up / down: the column the sweep runs along', () => {
  const LIST: Rect = { x: 20, y: 100, width: 200, height: 600 };

  test('with a container: at its horizontal centre, from 75% to 25% of its height', async () => {
    const { driver, swipes } = fakeDriver({ '~list': LIST });
    await sweep(el(driver, '~row-40'), { direction: 'down', container: el(driver, '~list') });
    // x 20-220: centre 120. y 100-700: 75% = 550, 25% = 250.
    expect(swipes[0]).toEqual({ from: { x: 120, y: 550 }, to: { x: 120, y: 250 } });
  });

  test('with a container, direction up: the same column the other way', async () => {
    const { driver, swipes } = fakeDriver({ '~list': LIST });
    await sweep(el(driver, '~row-0'), { direction: 'up', container: el(driver, '~list') });
    expect(swipes[0]).toEqual({ from: { x: 120, y: 250 }, to: { x: 120, y: 550 } });
  });

  test('a container taller than the window: clamped to the window', async () => {
    const { driver, swipes } = fakeDriver({ '~list': { x: 0, y: 0, width: 393, height: 3000 } });
    await sweep(el(driver, '~row-40'), { direction: 'down', container: el(driver, '~list') });
    expect(swipes[0]).toEqual({ from: { x: 197, y: 639 }, to: { x: 197, y: 213 } });
  });

  test('without a container, a target in the tree: at the target\'s own horizontal centre', async () => {
    const { driver, swipes } = fakeDriver({ '~row-40': { x: 250, y: 1200, width: 100, height: 50 } });
    await sweep(el(driver, '~row-40'), { direction: 'down' });
    expect(swipes[0]).toEqual({ from: { x: 300, y: 639 }, to: { x: 300, y: 213 } });
  });

  test('without a container, a target not in the tree: the window\'s horizontal centre', async () => {
    const { driver, swipes } = fakeDriver({});
    await sweep(el(driver, '~row-40'), { direction: 'down' });
    expect(swipes[0]).toEqual({ from: { x: 197, y: 639 }, to: { x: 197, y: 213 } });
  });
});

test.describe('scrollIntoView container option', () => {
  test('a container that is not a platform element is refused before any swipe', async () => {
    const { driver, swipes } = fakeDriver({});
    for (const bad of [{} as any, 'carousel' as any, { _type: 'web' } as any]) {
      const err = await sweep(el(driver, '~x'), { direction: 'right', container: bad });
      expect(err.message).toBe('scrollIntoView: options.container must be a platform element (the scrollable ancestor)');
    }
    expect(swipes).toEqual([]);
  });

  test('an already visible target returns without reading the container', async () => {
    const reads: string[] = [];
    const driver: any = {
      capabilities: {},
      $: async () => ({ elementId: 't', isDisplayed: async () => true }),
      getElementRect: async (id: string) => { reads.push(id); return CAROUSEL; },
    };
    const target = new PlatformElement(driver, '~t', undefined, 200, { platform: 'ios' });
    expect(await target.scrollIntoView({ direction: 'right', container: new PlatformElement(driver, '~c') })).toBe(target);
    expect(reads).toEqual([]);
  });

  test('web ignores the container', async () => {
    const calls: string[] = [];
    const locator: any = {
      waitFor: async (o: any) => { calls.push(`waitFor:${o.state}`); },
      scrollIntoViewIfNeeded: async () => { calls.push('scroll'); },
    };
    await new WebElement(locator, undefined, 100).scrollIntoView({ container: {} as any });
    expect(calls).toEqual(['waitFor:attached', 'scroll']);
  });

  test('ElementChain passes the container on as given', async () => {
    const { driver, swipes } = fakeDriver({ '~carousel': CAROUSEL });
    const err = await new ElementChain(el(driver, '~product-name-2'), 50)
      .scrollIntoView({ direction: 'right', container: el(driver, '~carousel'), maxSwipes: 1 })
      .then(() => null, (e: Error) => e);
    expect(err?.message).toMatch(/after 1 swipes/);
    expect(swipes).toEqual([{ from: { x: 295, y: 214 }, to: { x: 98, y: 214 } }]);
  });
});
