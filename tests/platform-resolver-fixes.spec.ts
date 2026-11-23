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

// ===========================================================================
// Platform TEXT: driver errors, deadline, empty value
// ===========================================================================

function namedError(name: string, message: string): Error {
  const e = new Error(message);
  e.name = name;
  return e;
}

function listDriver($$: () => Promise<any[]>): any {
  const driver: any = {
    $: async () => mockNativeElement('', 'missing'),
    $$,
  };
  Object.defineProperty(driver, 'locator', { get() { throw new Error('locator touched'); } });
  return driver;
}

test.describe('TEXT on platform pages — driver errors', () => {
  const fatal: Array<[string, Error]> = [
    ['invalid selector (name)', namedError('invalid selector', 'Unable to locate using the given strategy')],
    ['InvalidSelectorError', namedError('InvalidSelectorError', 'bad xpath')],
    ['invalid session id (name)', namedError('invalid session id', 'gone')],
    ['session not created (message)', new Error('session not created: device is locked')],
    ['dead session (message)', new Error('A session is either terminated or not started')],
    ['invalid argument (name)', namedError('invalid argument', 'bad value')],
    ['unknown command (name)', namedError('unknown command', 'not implemented')],
    ['unsupported operation (name)', namedError('unsupported operation', 'nope')],
    ['no such window (name)', namedError('no such window', 'window closed')],
    ['InvalidSelectorStrategy (message)', new Error('InvalidSelectorStrategy: foo is not supported')],
    ['InvalidSelectorMatch (message)', new Error('InvalidSelectorMatch: selector is malformed')],
    ['selector needs to be typeof (message)', new Error('selector needs to be typeof `string` or `function`')],
    ['instrumentation process is not running (message)', new Error('The instrumentation process is not running (probably crashed)')],
    ['ECONNRESET (message)', new Error('socket hang up: ECONNRESET')],
    ['ENOTFOUND (message)', new Error('getaddrinfo ENOTFOUND appium-server')],
    ['EPIPE (message)', new Error('write EPIPE')],
  ];

  for (const [label, err] of fatal) {
    test(`$$ throwing ${label} is rethrown immediately`, async () => {
      const driver = listDriver(async () => { throw err; });
      const started = Date.now();
      await expect(StrategyResolver.fromSelector(
        driver, '~row', androidPage, 'row', 'Settings', 5_000,
        { strategy: SelectionStrategy.TEXT, value: 'Wi-Fi' },
      )).rejects.toBe(err);
      expect(Date.now() - started).toBeLessThan(1_000);
    });
  }

  test('getText throwing an invalid-session error is rethrown immediately', async () => {
    const err = namedError('InvalidSessionIdError', 'invalid session id');
    const el = { ...mockNativeElement('x', 'a'), getText: async () => { throw err; } };
    const driver = listDriver(async () => [el]);
    const started = Date.now();
    await expect(StrategyResolver.fromSelector(
      driver, '~row', iosPage, 'row', 'Settings', 5_000,
      { strategy: SelectionStrategy.TEXT, value: 'Wi-Fi' },
    )).rejects.toBe(err);
    expect(Date.now() - started).toBeLessThan(1_000);
  });

  test('missing/stale errors keep polling and the last one is appended to not-found', async () => {
    let calls = 0;
    const driver = listDriver(async () => { calls++; throw namedError('stale element reference', `stale #${calls}`); });
    const err = await StrategyResolver.fromSelector(
      driver, '~row', androidPage, 'row', 'Settings', 600,
      { strategy: SelectionStrategy.TEXT, value: 'Wi-Fi' },
    ).then(() => null, (e: Error) => e);
    expect(err).not.toBeNull();
    expect(calls).toBeGreaterThan(1);
    expect(err!.message).toContain(`Element 'row' on 'Settings' with text "Wi-Fi" not found.`);
    expect(err!.message).toContain(`(last driver error: stale element reference: stale #${calls})`);
  });

  test('a stale getText error is appended to not-found', async () => {
    const { driver } = mockPlatformDriver([null]);
    await expect(StrategyResolver.fromSelector(
      driver, '~row', androidPage, 'row', 'Settings', 300,
      { strategy: SelectionStrategy.TEXT, value: 'Wi-Fi' },
    )).rejects.toThrow(/not found\. \(last driver error: .*stale element\)$/);
  });

  test('without driver errors the not-found message has no suffix', async () => {
    const { driver } = mockPlatformDriver(['General']);
    await expect(StrategyResolver.fromSelector(
      driver, '~row', androidPage, 'row', 'Settings', 300,
      { strategy: SelectionStrategy.TEXT, value: 'Wi-Fi' },
    )).rejects.toThrow(/^Element 'row' on 'Settings' with text "Wi-Fi" not found\.$/);
  });
});

test('TEXT deadline is checked inside the getText sweep of a long list', async () => {
  const slow = Array.from({ length: 60 }, (_, i) => ({
    ...mockNativeElement(`row ${i}`, `el-${i}`),
    getText: async () => { await new Promise(r => setTimeout(r, 50)); return `row ${i}`; },
  }));
  const driver = listDriver(async () => slow);
  const started = Date.now();
  await expect(StrategyResolver.fromSelector(
    driver, '~row', androidPage, 'row', 'Settings', 300,
    { strategy: SelectionStrategy.TEXT, value: 'nope' },
  )).rejects.toThrow('not found');
  // A full sweep is 60 x 50 ms = 3 s; the deadline must cut it short.
  expect(Date.now() - started).toBeLessThan(1_000);
});

test('TEXT still finds a match deep in a long list within the deadline', async () => {
  const many = Array.from({ length: 60 }, (_, i) => mockNativeElement(`row ${i}`, `el-${i}`));
  const driver = listDriver(async () => many);
  const el = await StrategyResolver.fromSelector(
    driver, '~row', androidPage, 'row', 'Settings', 300,
    { strategy: SelectionStrategy.TEXT, value: 'row 42' },
  );
  expect((el as PlatformElement).resolvedElement.elementId).toBe('el-42');
});

for (const page of [androidPage, iosPage, { name: 'Settings', elements: [] } as any]) {
  test(`TEXT with a whitespace-only value throws the required-value error (${page.platform ?? 'web'})`, async () => {
    const { driver } = mockPlatformDriver(['General']);
    await expect(StrategyResolver.fromSelector(
      driver, '~row', page, 'row', 'Settings', 300,
      { strategy: SelectionStrategy.TEXT, value: '   ' },
    )).rejects.toThrow('options.value is required when using SelectionStrategy.TEXT');
  });
}

test('TEXT with a whitespace-only value on the locator path throws the required-value error', async () => {
  await expect(StrategyResolver.fromLocator(
    {} as any, 'row', 'Settings', 300,
    { strategy: SelectionStrategy.TEXT, value: ' \t ' },
  )).rejects.toThrow('options.value is required when using SelectionStrategy.TEXT');
});

test('all() on a TEXT-resolved platform element re-queries the selector and returns every match', async () => {
  const { driver } = mockPlatformDriver(['General', 'Wi-Fi', 'Bluetooth']);
  const el = await StrategyResolver.fromSelector(
    driver, '~row', androidPage, 'row', 'Settings', 300,
    { strategy: SelectionStrategy.TEXT, value: 'Wi-Fi' },
  );
  expect(await el.all()).toHaveLength(3);
});

// ===========================================================================
// Fallback chain with TEXT on a platform page
// ===========================================================================

test.describe('TEXT on a platform page walks the fallback chain', () => {
  function selectorDriver(bySelector: Record<string, Array<string | null>>): { driver: any; queried: string[] } {
    const queried: string[] = [];
    const lists: Record<string, any[]> = {};
    for (const [sel, texts] of Object.entries(bySelector)) {
      lists[sel] = texts.map((t, i) => mockNativeElement(t, `${sel}#${i}`));
    }
    const driver: any = {
      $: async (sel: string) => (lists[sel] ?? [])[0] ?? mockNativeElement('', 'missing'),
      $$: async (sel: string) => { queried.push(sel); return lists[sel] ?? []; },
    };
    Object.defineProperty(driver, 'locator', { get() { throw new Error('locator touched'); } });
    return { driver, queried };
  }

  const repoFor = (driver: any) => new ElementRepository(driver, {
    pages: [{
      name: 'Settings', platform: 'android',
      elements: [{
        elementName: 'row',
        selector: { id: 'title', fallback: { 'accessibility id': 'row', fallback: { xpath: '//row' } } },
      }],
    }],
  } as any);

  test('primary has no text match, fallback does → resolves to the fallback', async () => {
    const { driver, queried } = selectorDriver({ 'id=title': ['General'], '~row': ['General', 'Display'] });
    const el = await repoFor(driver).get('row', 'Settings', { strategy: SelectionStrategy.TEXT, value: 'Display', timeout: 300 });
    expect(el).toBeInstanceOf(PlatformElement);
    expect((el as PlatformElement).resolvedElement.elementId).toBe('~row#1');
    expect((el as PlatformElement).selector).toBe('~row');
    expect(queried).toContain('id=title');
    expect(queried).not.toContain('//row');
  });

  test('match only at the end of the chain → resolves to the terminal fallback', async () => {
    const { driver } = selectorDriver({ 'id=title': [], '~row': ['General'], '//row': ['Display'] });
    const el = await repoFor(driver).get('row', 'Settings', { strategy: SelectionStrategy.TEXT, value: 'Display', timeout: 300 });
    expect((el as PlatformElement).resolvedElement.elementId).toBe('//row#0');
  });

  test('primary matches → the fallback is never queried', async () => {
    const { driver, queried } = selectorDriver({ 'id=title': ['Display'], '~row': ['Display'] });
    const el = await repoFor(driver).get('row', 'Settings', { strategy: SelectionStrategy.TEXT, value: 'Display', timeout: 300 });
    expect((el as PlatformElement).resolvedElement.elementId).toBe('id=title#0');
    expect(queried).not.toContain('~row');
  });

  test('no node matches → the primary\'s not-found error', async () => {
    const { driver, queried } = selectorDriver({ 'id=title': ['General'], '~row': ['General'], '//row': ['General'] });
    await expect(
      repoFor(driver).get('row', 'Settings', { strategy: SelectionStrategy.TEXT, value: 'Display', timeout: 300 }),
    ).rejects.toThrow(/^Element 'row' on 'Settings' with text "Display" not found\.$/);
    expect(queried).toEqual(expect.arrayContaining(['id=title', '~row', '//row']));
  });

  test('an entry without fallback still throws straight away', async () => {
    const { driver, queried } = selectorDriver({ 'id=title': ['General'] });
    const repo = new ElementRepository(driver, {
      pages: [{ name: 'Settings', platform: 'android', elements: [{ elementName: 'row', selector: { id: 'title' } }] }],
    } as any);
    await expect(
      repo.get('row', 'Settings', { strategy: SelectionStrategy.TEXT, value: 'Display', timeout: 300 }),
    ).rejects.toThrow(`Element 'row' on 'Settings' with text "Display" not found.`);
    expect(new Set(queried)).toEqual(new Set(['id=title']));
  });
});

// ===========================================================================
// `text` formatter escaping
// ===========================================================================

test.describe('text formatter escaping', () => {
  test('android UiSelector text escapes double quotes only', () => {
    expect(ANDROID_FORMATTERS.text('Submit')).toBe('android=new UiSelector().text("Submit")');
    // UiAutomator2's UiSelector parser decodes `\"` but never `\\`, so a
    // backslash is sent as-is (a doubled one would be matched literally).
    expect(ANDROID_FORMATTERS.text('say "hi" \\ bye')).toBe('android=new UiSelector().text("say \\"hi\\" \\ bye")');
    expect(ANDROID_FORMATTERS.text('C:\\dir')).toBe('android=new UiSelector().text("C:\\dir")');
  });

  test('ios label predicate', () => {
    expect(IOS_FORMATTERS.text('Submit')).toBe('-ios predicate string:label == "Submit"');
    expect(IOS_FORMATTERS.text('say "hi" \\ bye')).toBe('-ios predicate string:label == "say \\"hi\\" \\\\ bye"');
  });
});
