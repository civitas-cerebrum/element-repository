import { test, expect } from '@playwright/test';
import { ElementRepository } from '../src/repo/ElementRepository';
import { StrategyResolver } from '../src/repo/StrategyResolver';
import {
  WEB_FORMATTERS, APPIUM_FORMATTERS, ANDROID_FORMATTERS, IOS_FORMATTERS,
} from '../src/repo/formatters';
import { PlatformElement } from '../src/types';
import { SelectionStrategy } from '../src/enum/Options';
import { answerNarrowed, queriedBases, wasQueried } from './support/narrowedQueries';

// ---------------------------------------------------------------------------
// Mock WebdriverIO driver. `locator` is a Playwright-only API: touching it on
// a platform page is the bug under test, so the getter throws.
// ---------------------------------------------------------------------------

// The text is both what `getText()` returns (Android) and the iOS `label`
// attribute; `value` is empty, so either platform's text rule reads `text`.
function mockNativeElement(text: string | null, id: string): any {
  const read = async () => {
    if (text === null) throw new Error('stale element');
    return text;
  };
  return {
    elementId: id,
    // What the server sees when it evaluates a narrowed text query.
    __fields: { text, label: text, type: 'XCUIElementTypeCell' },
    getText: read,
    getTagName: async () => 'XCUIElementTypeCell',
    getAttribute: async (name: string) => (name === 'label' ? read() : null),
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
    // Every selector matches the same elements; a narrowed text query
    // gets the subset the server would return.
    $$: async (sel: string) => {
      selectors.push(sel);
      return answerNarrowed(sel, () => elements) ?? elements;
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
      // Every query is the entry's selector or a narrowed query of it.
      expect(selectors.every(s => queriedBases(s).includes('~row'))).toBe(true);
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

  test('a text read throwing an invalid-session error is rethrown immediately', async () => {
    const err = namedError('InvalidSessionIdError', 'invalid session id');
    const fail = async () => { throw err; };
    const el = { ...mockNativeElement('x', 'a'), getText: fail, getAttribute: fail, getTagName: fail };
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
    // The server found the row by its text (it is a narrowed hit), then it went stale.
    const stale = { ...mockNativeElement(null, 'el-0'), __fields: { text: 'Wi-Fi' } };
    const driver = listDriver(async () => [stale]);
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

/** `count` rows whose text read takes `readMs`, counting the reads of each row. */
function slowRows(count: number, readMs: number) {
  const reads = Array.from({ length: count }, () => 0);
  const rows = Array.from({ length: count }, (_, i) => ({
    ...mockNativeElement(`row ${i}`, `el-${i}`),
    getText: async () => { reads[i]++; await new Promise(r => setTimeout(r, readMs)); return `row ${i}`; },
  }));
  return { rows, reads };
}

test('TEXT reads a started pass to its end: the deadline only decides whether another pass starts', async () => {
  const { rows, reads } = slowRows(12, 50);
  let passes = 0;
  const driver = listDriver(async () => { passes++; return rows; });
  // A complete snapshot: nothing at the cut-off depth, so the narrowed miss
  // is not confirmed by another pass.
  const listAll = driver.$$;
  driver.getSettings = async () => ({});
  driver.$$ = async (sel: string) => (sel.startsWith('(//*[count(ancestor::*)') ? [] : listAll(sel));
  const started = Date.now();
  await expect(StrategyResolver.fromSelector(
    driver, '~row', androidPage, 'row', 'Settings', 100,
    { strategy: SelectionStrategy.TEXT, value: 'nope' },
  )).rejects.toThrow(`Element 'row' on 'Settings' with text "nope" not found.`);
  const elapsed = Date.now() - started;
  // One pass is 12 x 50 ms = 600 ms, past the 100 ms deadline: every row is
  // read once, and no second pass starts.
  expect(passes).toBe(1);
  expect(reads).toEqual(Array.from({ length: 12 }, () => 1));
  expect(elapsed).toBeGreaterThanOrEqual(550);
  // The overrun is at most one pass.
  expect(elapsed).toBeLessThan(100 + 600 + 500);
});

test('TEXT with a small budget finds a match late in a slow pass', async () => {
  const { rows, reads } = slowRows(12, 50);
  const driver = listDriver(async () => rows);
  const exact = await StrategyResolver.fromSelector(
    driver, '~row', androidPage, 'row', 'Settings', 100,
    { strategy: SelectionStrategy.TEXT, value: 'row 10' },
  );
  expect((exact as PlatformElement).resolvedElement.elementId).toBe('el-10');
  // The exact match ends the pass: row 11 is not read.
  expect(reads[11]).toBe(0);

  const contains = await StrategyResolver.fromSelector(
    driver, '~row', androidPage, 'row', 'Settings', 100,
    { strategy: SelectionStrategy.TEXT, value: 'ROW 1' },
  );
  // No exact match: the whole pass is read, then the first "contains" match wins.
  expect((contains as PlatformElement).resolvedElement.elementId).toBe('el-1');
  expect(reads[11]).toBe(1);
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
      $$: async (sel: string) => { queried.push(sel); return answerNarrowed(sel, base => lists[base]) ?? lists[sel] ?? []; },
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
    expect(wasQueried(queried, '//row')).toBe(false);
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
    expect(wasQueried(queried, '~row')).toBe(false);
  });

  test('no node matches → the primary\'s not-found error', async () => {
    const { driver, queried } = selectorDriver({ 'id=title': ['General'], '~row': ['General'], '//row': ['General'] });
    await expect(
      repoFor(driver).get('row', 'Settings', { strategy: SelectionStrategy.TEXT, value: 'Display', timeout: 300 }),
    ).rejects.toThrow(/^Element 'row' on 'Settings' with text "Display" not found\.$/);
    for (const base of ['id=title', '~row', '//row']) expect(wasQueried(queried, base)).toBe(true);
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

  test('android UiSelector text: a value containing a backslash-quote is expressible', () => {
    expect(ANDROID_FORMATTERS.text('a\\"b')).toBe('android=new UiSelector().text("a\\\\"b")');
  });

  test('android UiSelector text: a value ending in a backslash throws, pointing to xpath', () => {
    expect(() => ANDROID_FORMATTERS.text('C:\\dir\\')).toThrow(/ends in a backslash.*use an xpath selector/);
  });

  test('ios label predicate', () => {
    expect(IOS_FORMATTERS.text('Submit')).toBe('-ios predicate string:label == "Submit"');
    expect(IOS_FORMATTERS.text('say "hi" \\ bye')).toBe('-ios predicate string:label == "say \\"hi\\" \\\\ bye"');
  });
});
