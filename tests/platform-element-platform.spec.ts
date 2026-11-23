import { test, expect } from '@playwright/test';
import {
  ElementRepository, PlatformElement, PlatformNotSupportedError, SelectionStrategy, StrategyResolver, Element,
} from '../src';

// The driver reports no platform (no capabilities, no isIOS / isAndroid) and
// the selector has no `-ios` prefix, so without the page's platform being
// passed in, PlatformElement would fall back to naming 'android'.

function mockRaw(id: string): any {
  return {
    elementId: id,
    waitForExist: async () => {},
    waitForDisplayed: async () => {},
    isDisplayed: async () => true,
    isExisting: async () => true,
    getText: async () => 'row',
    getTagName: async () => 'XCUIElementTypeCell',
    getAttribute: async (name: string) => (name === 'label' ? 'row' : 'v'),
  };
}

function bareDriver(): any {
  const raws = [mockRaw('a'), mockRaw('b')];
  return {
    $: async () => raws[0],
    $$: async () => raws,
    pause: async () => {},
  };
}

const pages = {
  pages: [{ name: 'ListPage', platform: 'ios', elements: [{ elementName: 'row', selector: { 'accessibility id': 'row' } }] }],
};

function expectIosFilterError(el: Element): void {
  let caught: unknown;
  try { el.filter({ hasText: 'x' }); } catch (err) { caught = err; }
  expect(caught).toBeInstanceOf(PlatformNotSupportedError);
  expect((caught as PlatformNotSupportedError).platform).toBe('ios');
  expect((caught as PlatformNotSupportedError).method).toBe('filter');
}

test.describe('elements built by the repository carry the page platform', () => {
  const cases: Array<[string, Parameters<ElementRepository['get']>[2]]> = [
    ['default resolution', undefined],
    ['ALL', { strategy: SelectionStrategy.ALL }],
    ['INDEX', { strategy: SelectionStrategy.INDEX, index: 1 }],
    ['RANDOM', { strategy: SelectionStrategy.RANDOM }],
    ['TEXT', { strategy: SelectionStrategy.TEXT, value: 'row' }],
    ['ATTRIBUTE', { strategy: SelectionStrategy.ATTRIBUTE, attribute: 'name', value: 'v' }],
  ];
  for (const [label, options] of cases) {
    test(`${label}: filter() names the page platform`, async () => {
      const repo = new ElementRepository(bareDriver(), pages, { platform: 'ios', timeout: 1000 });
      const el = await repo.get('row', 'ListPage', options);
      expect(el).toBeInstanceOf(PlatformElement);
      expectIosFilterError(el);
    });
  }

  test('without an active platform, the page platform is still used', async () => {
    const repo = new ElementRepository(bareDriver(), pages, 1000);
    expectIosFilterError(await repo.get('row', 'ListPage'));
  });

  test('children made by all() / nth() / locateChild() keep it', async () => {
    const repo = new ElementRepository(bareDriver(), pages, { platform: 'ios', timeout: 1000 });
    const el = await repo.get('row', 'ListPage', { strategy: SelectionStrategy.ALL });
    expectIosFilterError((await el.all())[1]);
    expectIosFilterError(el.nth(1));
    expectIosFilterError(el.locateChild('~child'));
  });

  test('fromMobileSelector passes the given platform through', async () => {
    const el = await StrategyResolver.fromMobileSelector(bareDriver(), 'android=new UiSelector()', 1000, undefined, 'ios');
    expectIosFilterError(el);
  });
});

test.describe('web-only methods on PlatformElement throw PlatformNotSupportedError', () => {
  for (const method of ['dispatchEvent', 'setInputFiles'] as const) {
    test(`${method} names the method and the platform`, async () => {
      const el = new PlatformElement(bareDriver(), '~row', undefined, 1000, { platform: 'ios' });
      const call = method === 'dispatchEvent' ? el.dispatchEvent('click') : el.setInputFiles('/tmp/file.txt');
      const err = await call.then(() => null, (e: unknown) => e);
      expect(err).toBeInstanceOf(PlatformNotSupportedError);
      expect((err as PlatformNotSupportedError).method).toBe(method);
      expect((err as PlatformNotSupportedError).platform).toBe('ios');
      expect((err as Error).message).toBe(`"${method}" is not supported on platform "ios".`);
    });
  }

  test('the platform is read from the driver when not given', async () => {
    const driver = { ...bareDriver(), capabilities: { platformName: 'Android' } };
    const err = await new PlatformElement(driver, '~row').dispatchEvent('click').then(() => null, (e: unknown) => e);
    expect(err).toBeInstanceOf(PlatformNotSupportedError);
    expect((err as PlatformNotSupportedError).platform).toBe('android');
    expect((err as Error).message).toBe('"dispatchEvent" is not supported on platform "android".');
  });
});
