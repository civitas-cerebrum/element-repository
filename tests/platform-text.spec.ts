import { test, expect } from '@playwright/test';
import { PlatformElement, WebElement } from '../src/types';
import { ElementRepository } from '../src/repo/ElementRepository';
import { SelectionStrategy } from '../src/enum/Options';
import { readPlatformText } from '../src/utils/platformText';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

interface NativeFields {
  type?: string;
  label?: string | null;
  value?: string | null;
  text?: string | null;
}

/** A raw WebdriverIO element whose `getText()` behaves like XCUITest's (value before label). */
function nativeElement(id: string, fields: NativeFields): any {
  const xcuiText = fields.text !== undefined ? fields.text : (fields.value || fields.label || '');
  return {
    elementId: id,
    getTagName: async () => fields.type ?? 'XCUIElementTypeCell',
    getAttribute: async (name: string) => (name === 'label' ? fields.label ?? null : name === 'value' ? fields.value ?? null : null),
    getText: async () => xcuiText,
    isDisplayed: async () => true,
    isExisting: async () => true,
    waitForExist: async () => true,
    waitForDisplayed: async () => true,
  };
}

function driverOf(raws: any[], capabilities: Record<string, unknown> = {}): any {
  return {
    capabilities,
    $: async () => raws[0],
    $$: async () => raws,
    pause: async () => {},
  };
}

// ---------------------------------------------------------------------------
// The rule
// ---------------------------------------------------------------------------

test.describe('readPlatformText', () => {
  test('ios: a row reads its label, not the badge value XCUITest getText() returns', async () => {
    const row = nativeElement('a', { label: 'General', value: '1' });
    expect(await row.getText()).toBe('1');
    expect(await readPlatformText(row, 'ios')).toBe('General');
  });

  test('ios: falls back to value when the label is empty', async () => {
    expect(await readPlatformText(nativeElement('a', { label: '', value: 'On' }), 'ios')).toBe('On');
    expect(await readPlatformText(nativeElement('a', { label: null, value: 'On' }), 'ios')).toBe('On');
  });

  for (const type of ['XCUIElementTypeTextField', 'XCUIElementTypeSecureTextField', 'XCUIElementTypeTextView', 'XCUIElementTypeSearchField']) {
    test(`ios: a ${type} reads value first, then label`, async () => {
      expect(await readPlatformText(nativeElement('a', { type, label: 'Name', value: 'typed' }), 'ios')).toBe('typed');
      expect(await readPlatformText(nativeElement('a', { type, label: 'Name', value: '' }), 'ios')).toBe('Name');
    });
  }

  test('ios: no text in either attribute returns the empty one, or null when both are absent', async () => {
    expect(await readPlatformText(nativeElement('a', { label: '', value: null }), 'ios')).toBe('');
    expect(await readPlatformText(nativeElement('a', { label: null, value: null }), 'ios')).toBeNull();
  });

  test('ios: the text is not trimmed', async () => {
    expect(await readPlatformText(nativeElement('a', { label: '  General ' }), 'ios')).toBe('  General ');
  });

  test('android and unknown platforms read getText()', async () => {
    const el = nativeElement('a', { label: 'L', value: 'V', text: ' Shown ' });
    expect(await readPlatformText(el, 'android')).toBe(' Shown ');
    expect(await readPlatformText(el, undefined)).toBe(' Shown ');
  });
});

// ---------------------------------------------------------------------------
// PlatformElement.textContent / rawText
// ---------------------------------------------------------------------------

test.describe('PlatformElement text', () => {
  test('ios (from the constructor platform): textContent is the trimmed label, rawText the untrimmed one', async () => {
    const driver = driverOf([nativeElement('a', { label: ' General ', value: '1' })]);
    const el = new PlatformElement(driver, '~row', undefined, 1000, { platform: 'ios' });
    expect(await el.textContent()).toBe('General');
    expect(await el.rawText()).toBe(' General ');
  });

  test('ios (from the driver capabilities) uses the same rule', async () => {
    const driver = driverOf([nativeElement('a', { label: 'General', value: '1' })], { platformName: 'iOS' });
    expect(await new PlatformElement(driver, '~row').textContent()).toBe('General');
  });

  test('ios (from WebdriverIO isIOS) uses the same rule', async () => {
    const driver = { ...driverOf([nativeElement('a', { label: 'General', value: '1' })]), isIOS: true };
    expect(await new PlatformElement(driver, '~row').textContent()).toBe('General');
  });

  test('android keeps getText()', async () => {
    const driver = driverOf([nativeElement('a', { label: 'L', value: 'V', text: ' Wi-Fi ' })], { platformName: 'Android' });
    const el = new PlatformElement(driver, '~row', undefined, 1000, { platform: 'android' });
    expect(await el.textContent()).toBe('Wi-Fi');
    expect(await el.rawText()).toBe(' Wi-Fi ');
  });

  test('null text stays null in both accessors', async () => {
    const driver = driverOf([nativeElement('a', { text: null })]);
    const el = new PlatformElement(driver, '~row', undefined, 1000, { platform: 'android' });
    expect(await el.textContent()).toBeNull();
    expect(await el.rawText()).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// WebElement.rawText
// ---------------------------------------------------------------------------

test.describe('WebElement.rawText', () => {
  test('returns the Playwright text content unchanged, as textContent does', async () => {
    const locator: any = { textContent: async () => '  Hello \n' };
    const el = new WebElement(locator);
    expect(await el.rawText()).toBe('  Hello \n');
    expect(await el.textContent()).toBe('  Hello \n');
  });
});

// ---------------------------------------------------------------------------
// TEXT strategy and getByText use the same rule
// ---------------------------------------------------------------------------

const IOS_PAGES = {
  pages: [
    {
      name: 'Settings',
      platform: 'ios',
      elements: [{ elementName: 'rows', selector: { 'accessibility id': 'row' } }],
    },
  ],
};

function settingsRows(): any[] {
  return [
    nativeElement('wifi', { label: 'Wi-Fi', value: 'Home' }),
    nativeElement('general', { label: 'General', value: '1' }),
  ];
}

test.describe('platform text lookups on ios', () => {
  test('the TEXT strategy matches the label, not the value getText() returns', async () => {
    const rows = settingsRows();
    const repo = new ElementRepository(driverOf(rows), IOS_PAGES, { platform: 'ios', timeout: 500 });
    const el = await repo.get('rows', 'Settings', { strategy: SelectionStrategy.TEXT, value: 'General' });
    expect((el as PlatformElement).resolvedElement).toBe(rows[1]);
  });

  test('the TEXT strategy no longer matches a badge value', async () => {
    const repo = new ElementRepository(driverOf(settingsRows()), IOS_PAGES, { platform: 'ios', timeout: 300 });
    await expect(repo.get('rows', 'Settings', { strategy: SelectionStrategy.TEXT, value: '1' }))
      .rejects.toThrow(/with text "1" not found/);
  });

  test('getByText matches the label', async () => {
    const rows = settingsRows();
    const repo = new ElementRepository(driverOf(rows), IOS_PAGES, { platform: 'ios', timeout: 500 });
    const el = await repo.getByText('rows', 'Settings', 'General', true);
    expect(await el!.textContent()).toBe('General');
  });
});

// ---------------------------------------------------------------------------
// Driver round trips of an iOS text read
// ---------------------------------------------------------------------------

/** A {@link nativeElement} that records each driver read as `<id>:tag`, `<id>:label`, `<id>:value` or `<id>:text`. */
function countingElement(id: string, fields: NativeFields, reads: string[]): any {
  const el = nativeElement(id, fields);
  return {
    ...el,
    getTagName: async () => { reads.push(`${id}:tag`); return el.getTagName(); },
    getAttribute: async (name: string) => { reads.push(`${id}:${name}`); return el.getAttribute(name); },
    getText: async () => { reads.push(`${id}:text`); return el.getText(); },
  };
}

test.describe('readPlatformText round trips on ios', () => {
  test('a row with a label: type and label only (2 reads)', async () => {
    const reads: string[] = [];
    expect(await readPlatformText(countingElement('a', { label: 'General', value: '1' }, reads), 'ios')).toBe('General');
    expect(reads.sort()).toEqual(['a:label', 'a:tag']);
  });

  test('a text input: type, label and value (3 reads)', async () => {
    const reads: string[] = [];
    const el = countingElement('a', { type: 'XCUIElementTypeTextField', label: 'Name', value: 'typed' }, reads);
    expect(await readPlatformText(el, 'ios')).toBe('typed');
    expect(reads.sort()).toEqual(['a:label', 'a:tag', 'a:value']);
  });

  for (const label of ['', '   ', null]) {
    test(`a row whose label is ${JSON.stringify(label)} also reads value (3 reads)`, async () => {
      const reads: string[] = [];
      expect(await readPlatformText(countingElement('a', { label, value: 'On' }, reads), 'ios')).toBe('On');
      expect(reads.sort()).toEqual(['a:label', 'a:tag', 'a:value']);
    });
  }

  test('results are unchanged when neither attribute has text', async () => {
    const reads: string[] = [];
    expect(await readPlatformText(countingElement('a', { label: '  ', value: '' }, reads), 'ios')).toBe('  ');
    expect(await readPlatformText(countingElement('b', { label: null, value: '' }, reads), 'ios')).toBe('');
    expect(await readPlatformText(countingElement('c', { label: null, value: null }, reads), 'ios')).toBeNull();
    const input = { type: 'XCUIElementTypeSearchField' };
    expect(await readPlatformText(countingElement('d', { ...input, label: '', value: ' ' }, reads), 'ios')).toBe(' ');
    expect(await readPlatformText(countingElement('e', { ...input, label: '', value: null }, reads), 'ios')).toBe('');
  });

  test('android: one getText() read', async () => {
    const reads: string[] = [];
    expect(await readPlatformText(countingElement('a', { text: 'Wi-Fi' }, reads), 'android')).toBe('Wi-Fi');
    expect(reads).toEqual(['a:text']);
  });
});

test.describe('platform text lookups stop reading early', () => {
  function rows(reads: string[]): any[] {
    return [
      countingElement('wifi', { label: 'Wi-Fi', value: 'Home' }, reads),
      countingElement('general-tab', { label: 'General settings', value: '' }, reads),
      countingElement('general', { label: 'General', value: '1' }, reads),
      countingElement('privacy', { label: 'Privacy', value: '' }, reads),
    ];
  }

  test('the TEXT strategy stops at the first exact match, and exact still wins over an earlier contains match', async () => {
    const reads: string[] = [];
    const raws = rows(reads);
    const repo = new ElementRepository(driverOf(raws), IOS_PAGES, { platform: 'ios', timeout: 500 });
    const el = await repo.get('rows', 'Settings', { strategy: SelectionStrategy.TEXT, value: 'General' });
    expect((el as PlatformElement).resolvedElement).toBe(raws[2]);
    expect(reads.some(r => r.startsWith('privacy:'))).toBe(false);
  });

  test('the TEXT strategy falls back to the first contains match after reading every row once', async () => {
    const reads: string[] = [];
    const raws = rows(reads);
    const repo = new ElementRepository(driverOf(raws), IOS_PAGES, { platform: 'ios', timeout: 500 });
    const el = await repo.get('rows', 'Settings', { strategy: SelectionStrategy.TEXT, value: 'general' });
    expect((el as PlatformElement).resolvedElement).toBe(raws[1]);
    expect(reads.filter(r => r.endsWith(':label'))).toEqual(['wifi:label', 'general-tab:label', 'general:label', 'privacy:label']);
  });

  test('getByText reads each row once for both the exact and the contains pass', async () => {
    const reads: string[] = [];
    const repo = new ElementRepository(driverOf(rows(reads)), IOS_PAGES, { platform: 'ios', timeout: 500 });
    const contains = await repo.getByText('rows', 'Settings', 'Priv', true);
    expect(reads.filter(r => r.endsWith(':label'))).toEqual(['wifi:label', 'general-tab:label', 'general:label', 'privacy:label']);
    expect(await contains!.textContent()).toBe('Privacy');
  });

  test('getByText stops reading at the first exact match, and exact still wins over an earlier contains match', async () => {
    const reads: string[] = [];
    const repo = new ElementRepository(driverOf(rows(reads)), IOS_PAGES, { platform: 'ios', timeout: 500 });
    const el = await repo.getByText('rows', 'Settings', 'General', true);
    expect(reads.filter(r => r.endsWith(':label'))).toEqual(['wifi:label', 'general-tab:label', 'general:label']);
    expect(await el!.textContent()).toBe('General');
  });
});
