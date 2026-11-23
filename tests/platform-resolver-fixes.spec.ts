import { test, expect } from '@playwright/test';
import { ElementRepository } from '../src/repo/ElementRepository';
import { StrategyResolver } from '../src/repo/StrategyResolver';
import {
  WEB_FORMATTERS, APPIUM_FORMATTERS, ANDROID_FORMATTERS, IOS_FORMATTERS,
} from '../src/repo/formatters';
import { PlatformElement } from '../src/types';
import { SelectionStrategy } from '../src/enum/Options';

// ---------------------------------------------------------------------------
// Mock WebdriverIO driver. `locator` is a Playwright-only API: touching it on
// a platform page is the bug under test, so the getter throws.
// ---------------------------------------------------------------------------

function mockNativeElement(text: string | null, id: string): any {
  return {
    elementId: id,
    getText: async () => {
      if (text === null) throw new Error('stale element');
      return text;
    },
    getAttribute: async (_n: string) => null,
    waitForExist: async (_opts?: any) => {},
    waitForDisplayed: async (_opts?: any) => {},
    isDisplayed: async () => true,
    click: async () => {},
  };
}

function mockPlatformDriver(texts: Array<string | null>): { driver: any; selectors: string[] } {
  const elements = texts.map((t, i) => mockNativeElement(t, `el-${i}`));
  const selectors: string[] = [];
  const driver: any = {
    $: async (sel: string) => {
      selectors.push(sel);
      return elements[0] ?? mockNativeElement('', 'missing');
    },
    $$: async (sel: string) => {
      selectors.push(sel);
      return elements;
    },
    pause: async (_ms: number) => {},
  };
  Object.defineProperty(driver, 'locator', {
    get() { throw new Error('driver.locator must not be called on a platform page'); },
  });
  return { driver, selectors };
}

const androidPage = { name: 'Settings', platform: 'android', elements: [] } as any;
const iosPage = { name: 'Settings', platform: 'ios', elements: [] } as any;

// ===========================================================================
// SelectionStrategy.TEXT on platform pages
// ===========================================================================

for (const page of [androidPage, iosPage]) {
  test.describe(`TEXT strategy on ${page.platform}`, () => {
    test('never touches driver.locator and returns a PlatformElement', async () => {
      const { driver, selectors } = mockPlatformDriver(['General', 'Wi-Fi', 'Bluetooth']);
      const el = await StrategyResolver.fromSelector(
        driver, '~row', page, 'row', 'Settings', 300,
        { strategy: SelectionStrategy.TEXT, value: 'Wi-Fi' },
      );
      expect(el).toBeInstanceOf(PlatformElement);
      expect((el as PlatformElement).resolvedElement.elementId).toBe('el-1');
      expect(await el.textContent()).toBe('Wi-Fi');
      expect(selectors.every(s => s === '~row')).toBe(true);
    });

    test('exact match wins over an earlier partial match', async () => {
      const { driver } = mockPlatformDriver(['Wi-Fi Assist', 'Wi-Fi']);
      const el = await StrategyResolver.fromSelector(
        driver, '~row', page, 'row', 'Settings', 300,
        { strategy: SelectionStrategy.TEXT, value: 'Wi-Fi' },
      );
      expect((el as PlatformElement).resolvedElement.elementId).toBe('el-1');
    });

    test('partial match (contains, case-insensitive, whitespace-normalised) like web hasText', async () => {
      const { driver } = mockPlatformDriver(['General', '  Personal   Hotspot  ', 'Battery']);
      const el = await StrategyResolver.fromSelector(
        driver, '~row', page, 'row', 'Settings', 300,
        { strategy: SelectionStrategy.TEXT, value: 'personal hotspot' },
      );
      expect((el as PlatformElement).resolvedElement.elementId).toBe('el-1');
    });

    test('skips elements whose text cannot be read', async () => {
      const { driver } = mockPlatformDriver([null, 'Battery']);
      const el = await StrategyResolver.fromSelector(
        driver, '~row', page, 'row', 'Settings', 300,
        { strategy: SelectionStrategy.TEXT, value: 'Battery' },
      );
      expect((el as PlatformElement).resolvedElement.elementId).toBe('el-1');
    });

    test('no match throws the not-found error', async () => {
      const { driver } = mockPlatformDriver(['General', 'Battery']);
      await expect(StrategyResolver.fromSelector(
        driver, '~row', page, 'row', 'Settings', 300,
        { strategy: SelectionStrategy.TEXT, value: 'Privacy' },
      )).rejects.toThrow(`Element 'row' on 'Settings' with text "Privacy" not found.`);
    });

    test('missing value still throws the required-value error', async () => {
      const { driver } = mockPlatformDriver(['General']);
      await expect(StrategyResolver.fromSelector(
        driver, '~row', page, 'row', 'Settings', 300,
        { strategy: SelectionStrategy.TEXT },
      )).rejects.toThrow('options.value is required');
    });
  });
}

test('TEXT through ElementRepository.get on an android page uses $$ only', async () => {
  const { driver } = mockPlatformDriver(['Network', 'Display']);
  const repo = new ElementRepository(driver, {
    pages: [{
      name: 'Settings', platform: 'android',
      elements: [{ elementName: 'row', selector: { id: 'title' } }],
    }],
  } as any);
  const el = await repo.get('row', 'Settings', { strategy: SelectionStrategy.TEXT, value: 'Display', timeout: 300 });
  expect(el).toBeInstanceOf(PlatformElement);
  expect((el as PlatformElement).resolvedElement.elementId).toBe('el-1');
  expect((el as PlatformElement).selector).toBe('id=title');
});

test('TEXT waits for a late match within the timeout', async () => {
  let calls = 0;
  const late = mockNativeElement('Done', 'late');
  const driver: any = {
    $: async () => late,
    $$: async () => (++calls < 3 ? [] : [late]),
  };
  Object.defineProperty(driver, 'locator', { get() { throw new Error('locator touched'); } });
  const el = await StrategyResolver.fromSelector(
    driver, '~done', androidPage, 'done', 'Settings', 2_000,
    { strategy: SelectionStrategy.TEXT, value: 'Done' },
  );
  expect((el as PlatformElement).resolvedElement.elementId).toBe('late');
});

// ===========================================================================
// `id` formatter per platform
// ===========================================================================

test.describe('id formatter', () => {
  test('web keeps CSS #id', () => {
    expect(WEB_FORMATTERS.id('submit')).toBe('#submit');
  });

  test('android uses the Appium id (resource-id) strategy', () => {
    expect(ANDROID_FORMATTERS.id('submit')).toBe('id=submit');
    expect(ANDROID_FORMATTERS.id('com.example:id/submit')).toBe('id=com.example:id/submit');
  });

  test('ios uses a name predicate, with quotes and backslashes escaped', () => {
    expect(IOS_FORMATTERS.id('submit')).toBe('-ios predicate string:name == "submit"');
    expect(IOS_FORMATTERS.id('say "hi" \\ bye')).toBe('-ios predicate string:name == "say \\"hi\\" \\\\ bye"');
  });

  test('base appium table (other appium platforms) uses accessibility id', () => {
    expect(APPIUM_FORMATTERS.id('submit')).toBe('~submit');
  });

  test('no platform table emits CSS #id', () => {
    for (const table of [APPIUM_FORMATTERS, ANDROID_FORMATTERS, IOS_FORMATTERS]) {
      expect(table.id('x').startsWith('#')).toBe(false);
    }
  });

  test('repository getSelector picks the right id formatter per platform', () => {
    const repo = new ElementRepository({} as any, {
      pages: [
        { name: 'W', elements: [{ elementName: 'e', selector: { id: 'v' } }] },
        { name: 'A', platform: 'android', elements: [{ elementName: 'e', selector: { id: 'v' } }] },
        { name: 'I', platform: 'ios', elements: [{ elementName: 'e', selector: { id: 'v' } }] },
        { name: 'M', platform: 'macos', elements: [{ elementName: 'e', selector: { id: 'v' } }] },
      ],
    } as any);
    expect(repo.getSelector('e', 'W')).toBe('#v');
    expect(repo.getSelector('e', 'A')).toBe('id=v');
    expect(repo.getSelector('e', 'I')).toBe('-ios predicate string:name == "v"');
    expect(repo.getSelector('e', 'M')).toBe('~v');
  });
});
