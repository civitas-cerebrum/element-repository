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
