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
  test('with a container: at the container\'s vertical centre, from 85% to 15% of its width', async () => {
    const { driver, swipes } = fakeDriver({ '~carousel': CAROUSEL });
    const err = await sweep(el(driver, '~product-name-2'), { direction: 'right', container: el(driver, '~carousel') });
    expect(err.message).toBe('scrollIntoView: element not visible after 2 swipes, the swipe limit (direction=right)');
    // Carousel y 113-314: centre y 213.5 -> 214. Width 393: 85% = 334, 15% = 59.
    expect(swipes).toEqual([
      { from: { x: 334, y: 214 }, to: { x: 59, y: 214 } },
      { from: { x: 334, y: 214 }, to: { x: 59, y: 214 } },
    ]);
  });

  test('with a container, direction left: the same row the other way', async () => {
    const { driver, swipes } = fakeDriver({ '~carousel': CAROUSEL });
    await sweep(el(driver, '~product-name-0'), { direction: 'left', container: el(driver, '~carousel') });
    expect(swipes[0]).toEqual({ from: { x: 59, y: 214 }, to: { x: 334, y: 214 } });
  });

  test('a narrower container: the sweep stays inside its width', async () => {
    const { driver, swipes } = fakeDriver({ '~strip': { x: 40, y: 600, width: 200, height: 80 } });
    await sweep(el(driver, '~chip-9'), { direction: 'right', container: el(driver, '~strip') });
    // x 40-240: 85% = 210, 15% = 70; centre y 640.
    expect(swipes[0]).toEqual({ from: { x: 210, y: 640 }, to: { x: 70, y: 640 } });
  });

  test('a container partly above the window: only its visible part counts', async () => {
    const { driver, swipes } = fakeDriver({ '~carousel': { ...CAROUSEL, y: -50 } });
    await sweep(el(driver, '~product-name-2'), { direction: 'right', container: el(driver, '~carousel') });
    // Visible y 0-151: centre 75.5, inside the top edge band (10% of 852 =
    // 85.2), moved down to the band: y 85.
    expect(swipes[0]).toEqual({ from: { x: 334, y: 85 }, to: { x: 59, y: 85 } });
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
      { from: { x: 334, y: 170 }, to: { x: 59, y: 170 } },
      { from: { x: 334, y: 170 }, to: { x: 59, y: 170 } },
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
    expect(swipes[0]).toEqual({ from: { x: 334, y: 426 }, to: { x: 59, y: 426 } });
  });

  test('a target whose row is outside the window: the window centre', async () => {
    const { driver, swipes } = fakeDriver({ '~product-name-2': { x: 806, y: 1200, width: 300, height: 40 } });
    await sweep(el(driver, '~product-name-2'), { direction: 'right' });
    expect(swipes[0]).toEqual({ from: { x: 334, y: 426 }, to: { x: 59, y: 426 } });
  });

  test('a target with an empty rect counts as not placed: the window centre', async () => {
    const { driver, swipes } = fakeDriver({ '~product-name-2': { x: 0, y: 0, width: 0, height: 0 } });
    await sweep(el(driver, '~product-name-2'), { direction: 'right' });
    expect(swipes[0]).toEqual({ from: { x: 334, y: 426 }, to: { x: 59, y: 426 } });
  });
});

test.describe('scrollIntoView: the sweep stays out of the window edge bands', () => {
  test('a target row in the top band: the line moves down to 10% of the window', async () => {
    const { driver, swipes } = fakeDriver({ '~tab-9': { x: 900, y: 20, width: 80, height: 20 } });
    await sweep(el(driver, '~tab-9'), { direction: 'right' });
    // Centre y 30 < 85.2 (10% of 852).
    expect(swipes[0]).toEqual({ from: { x: 334, y: 85 }, to: { x: 59, y: 85 } });
  });

  test('a target row in the bottom band: the line moves up to 90% of the window', async () => {
    const { driver, swipes } = fakeDriver({ '~tab-9': { x: 900, y: 820, width: 80, height: 20 } });
    await sweep(el(driver, '~tab-9'), { direction: 'right' });
    // Centre y 830 > 766.8 (90% of 852).
    expect(swipes[0]).toEqual({ from: { x: 334, y: 767 }, to: { x: 59, y: 767 } });
  });

  test('a container reaching into a band: its points are moved inside the band and the container', async () => {
    // A bottom sheet y 600-852: 85% = 814.2 is in the bottom band, moved to
    // 766.8 -> 767; 15% = 637.8 -> 638.
    const { driver, swipes } = fakeDriver({ '~sheet': { x: 0, y: 600, width: 393, height: 252 } });
    await sweep(el(driver, '~row-9'), { direction: 'down', container: el(driver, '~sheet') });
    expect(swipes[0]).toEqual({ from: { x: 197, y: 767 }, to: { x: 197, y: 638 } });
  });

  test('a container wholly inside a band: the sweep stays inside the container', async () => {
    // A strip x 0-30 lies inside the left band (39.3): its own 85% / 15%.
    const { driver, swipes } = fakeDriver({ '~strip': { x: 0, y: 300, width: 30, height: 200 } });
    await sweep(el(driver, '~chip-9'), { direction: 'right', container: el(driver, '~strip') });
    expect(swipes[0]).toEqual({ from: { x: 26, y: 400 }, to: { x: 5, y: 400 } });
  });

  test('every point is a whole pixel inside the window', async () => {
    const { driver, swipes } = fakeDriver({ '~edge': { x: 380.4, y: 0, width: 40, height: 852 } });
    await sweep(el(driver, '~row-9'), { direction: 'up', container: el(driver, '~edge') });
    for (const p of [swipes[0].from, swipes[0].to]) {
      expect(Number.isInteger(p.x) && Number.isInteger(p.y)).toBe(true);
      expect(p.x >= 0 && p.x <= WINDOW.width - 1 && p.y >= 0 && p.y <= WINDOW.height - 1).toBe(true);
    }
  });
});

test.describe('scrollIntoView: the sweep swipe is a drag that lifts a still finger', () => {
  test('each swipe: down, 50 ms hold, 300 ms move, 200 ms hold at the end, up', async () => {
    const sent: any[] = [];
    const { driver } = fakeDriver({ '~carousel': CAROUSEL });
    const perform = driver.performActions;
    driver.performActions = async (sources: any[]) => { sent.push(sources); return perform(sources); };
    await sweep(el(driver, '~product-name-2'), { direction: 'right', container: el(driver, '~carousel'), maxSwipes: 1 });
    expect(sent).toEqual([[{
      type: 'pointer',
      id: 'finger1',
      parameters: { pointerType: 'touch' },
      actions: [
        { type: 'pointerMove', duration: 0, origin: 'viewport', x: 334, y: 214 },
        { type: 'pointerDown', button: 0 },
        { type: 'pause', duration: 50 },
        { type: 'pointerMove', duration: 300, origin: 'viewport', x: 59, y: 214 },
        { type: 'pause', duration: 200 },
        { type: 'pointerUp', button: 0 },
      ],
    }]]);
  });

  test('a paging carousel as wide as its container: one drag passes half a page', async () => {
    // The iOS test app's carousel: x 16-377 (361 wide). The drag must pass
    // 180.5 pt for the page to advance on release.
    const { driver, swipes } = fakeDriver({ '~carousel': { x: 16, y: 113, width: 361, height: 201 } });
    await sweep(el(driver, '~product-name-2'), { direction: 'right', container: el(driver, '~carousel'), maxSwipes: 1 });
    expect(swipes[0]).toEqual({ from: { x: 323, y: 214 }, to: { x: 70, y: 214 } });
    expect(swipes[0].from.x - swipes[0].to.x).toBeGreaterThan(361 / 2);
  });

  test('a long list without a container: one drag is shorter than the list\'s visible part', async () => {
    // A 1080x2424 Android window whose list shows y 578-2382 (1804 px):
    // the drag (85% -> 15% of the window) must not move the list further
    // than it shows, or a row between two views is never on screen.
    const { driver, swipes } = fakeDriver({});
    driver.getWindowSize = async () => ({ width: 1080, height: 2424 });
    await sweep(el(driver, '~long-list-item-40'), { direction: 'down', maxSwipes: 1 });
    expect(swipes[0]).toEqual({ from: { x: 540, y: 2060 }, to: { x: 540, y: 364 } });
    expect(swipes[0].from.y - swipes[0].to.y).toBeLessThan(2382 - 578);
  });
});

test.describe('scrollIntoView up / down: the column the sweep runs along', () => {
  const LIST: Rect = { x: 20, y: 100, width: 200, height: 600 };

  test('with a container: at its horizontal centre, from 85% to 15% of its height', async () => {
    const { driver, swipes } = fakeDriver({ '~list': LIST });
    await sweep(el(driver, '~row-40'), { direction: 'down', container: el(driver, '~list') });
    // x 20-220: centre 120. y 100-700: 85% = 610, 15% = 190.
    expect(swipes[0]).toEqual({ from: { x: 120, y: 610 }, to: { x: 120, y: 190 } });
  });

  test('with a container, direction up: the same column the other way', async () => {
    const { driver, swipes } = fakeDriver({ '~list': LIST });
    await sweep(el(driver, '~row-0'), { direction: 'up', container: el(driver, '~list') });
    expect(swipes[0]).toEqual({ from: { x: 120, y: 190 }, to: { x: 120, y: 610 } });
  });

  test('a container taller than the window: clamped to the window', async () => {
    const { driver, swipes } = fakeDriver({ '~list': { x: 0, y: 0, width: 393, height: 3000 } });
    await sweep(el(driver, '~row-40'), { direction: 'down', container: el(driver, '~list') });
    expect(swipes[0]).toEqual({ from: { x: 197, y: 724 }, to: { x: 197, y: 128 } });
  });

  test('without a container, a target in the tree: at the target\'s own horizontal centre', async () => {
    const { driver, swipes } = fakeDriver({ '~row-40': { x: 250, y: 1200, width: 100, height: 50 } });
    await sweep(el(driver, '~row-40'), { direction: 'down' });
    expect(swipes[0]).toEqual({ from: { x: 300, y: 724 }, to: { x: 300, y: 128 } });
  });

  test('without a container, a target not in the tree: the window\'s horizontal centre', async () => {
    const { driver, swipes } = fakeDriver({});
    await sweep(el(driver, '~row-40'), { direction: 'down' });
    expect(swipes[0]).toEqual({ from: { x: 197, y: 724 }, to: { x: 197, y: 128 } });
  });
});

test.describe('scrollIntoView container option', () => {
  test('a platform element from another copy of the package is taken as the container', async () => {
    // Two copies of the package (a consumer's and a dependency's) have two
    // PlatformElement classes: `instanceof` fails across them, the element
    // type does not. Model the other copy's class by its own prototype.
    const { driver, swipes } = fakeDriver({ '~carousel': CAROUSEL });
    const proto = Object.create(Object.getPrototypeOf(PlatformElement.prototype));
    Object.defineProperties(proto, Object.getOwnPropertyDescriptors(PlatformElement.prototype));
    const twin = Object.assign(Object.create(proto), el(driver, '~carousel'));
    expect(twin instanceof PlatformElement).toBe(false);
    await sweep(el(driver, '~product-name-2'), { direction: 'right', container: twin, maxSwipes: 1 });
    expect(swipes).toEqual([{ from: { x: 334, y: 214 }, to: { x: 59, y: 214 } }]);
  });

  test('a container that is not a platform element is refused before any swipe', async () => {
    const { driver, swipes } = fakeDriver({});
    for (const bad of [{} as any, 'carousel' as any, { _type: 'web' } as any, null as any]) {
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
    expect(swipes).toEqual([{ from: { x: 334, y: 214 }, to: { x: 59, y: 214 } }]);
  });
});
