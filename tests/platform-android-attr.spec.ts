import { test, expect } from '@playwright/test';
import { PlatformElement } from '../src/types';
import { StrategyResolver } from '../src/repo/StrategyResolver';
import { androidAttribute } from '../src/utils/androidAttr';

// ---------------------------------------------------------------------------
// Mocks shaped like UiAutomator2: a missing attribute reads as the string
// "null", never as null.
// ---------------------------------------------------------------------------

function androidElement(id: string, attrs: Record<string, string>): any {
  return {
    elementId: id,
    getAttribute: async (name: string) => (name in attrs ? attrs[name] : 'null'),
    waitForExist: async () => true,
  };
}

function driverFor(...els: any[]): any {
  return { capabilities: {}, $: async () => els[0], $$: async () => els };
}

function android(el: any, selector = 'id=row'): PlatformElement {
  return new PlatformElement(driverFor(el), selector, undefined, 1000, { platform: 'android' });
}

function iosElement(attrs: Record<string, string | null>): any {
  return {
    elementId: 'ios-el',
    getAttribute: async (name: string) => (name in attrs ? attrs[name] : null),
    waitForExist: async () => true,
  };
}

test.describe('androidAttribute', () => {
  test('null, undefined and the string "null" are missing', () => {
    expect(androidAttribute(null)).toBeNull();
    expect(androidAttribute(undefined)).toBeNull();
    expect(androidAttribute('null')).toBeNull();
  });

  test('any other value is returned as a string', () => {
    expect(androidAttribute('')).toBe('');
    expect(androidAttribute('Nullable')).toBe('Nullable');
    expect(androidAttribute(true)).toBe('true');
  });
});

test.describe('PlatformElement.getAttribute on android', () => {
  test('a missing attribute (the string "null") returns null', async () => {
    expect(await android(androidElement('a', {})).getAttribute('content-desc')).toBeNull();
  });

  test('a present attribute is returned unchanged', async () => {
    expect(await android(androidElement('a', { 'content-desc': 'Settings' })).getAttribute('content-desc')).toBe('Settings');
  });

  test('ios returns the string "null" unchanged (only UiAutomator2 uses it for missing)', async () => {
    const el = new PlatformElement(driverFor(iosElement({ label: 'null' })), '~x', undefined, 1000, { platform: 'ios' });
    expect(await el.getAttribute('label')).toBe('null');
  });
});

test.describe('StrategyResolver.filterByAttribute on android', () => {
  function rows(): PlatformElement[] {
    const plain = androidElement('plain', {});
    const described = androidElement('described', { 'content-desc': 'Full rules' });
    return [plain, described].map(el => new PlatformElement(driverFor(plain, described), 'id=row', el, 1000, { platform: 'android' }));
  }

  test('contains: an element without the attribute never matches ("ul" is in "null")', async () => {
    const match = await StrategyResolver.filterByAttribute(rows(), 'content-desc', 'ul', false);
    expect(match).not.toBeNull();
    expect((match as PlatformElement).resolvedElement.elementId).toBe('described');
  });

  test('exact "null": a missing attribute does not match', async () => {
    expect(await StrategyResolver.filterByAttribute(rows(), 'content-desc', 'null', true)).toBeNull();
  });

  test('default (exact then contains): a missing attribute matches neither', async () => {
    expect(await StrategyResolver.filterByAttribute(rows(), 'content-desc', 'null')).toBeNull();
    const match = await StrategyResolver.filterByAttribute(rows(), 'content-desc', 'ul');
    expect((match as PlatformElement).resolvedElement.elementId).toBe('described');
  });
});

test.describe('PlatformElement.inputValue on android', () => {
  test('a field holding the text "null" with no hint (hint reads "null") is not empty', async () => {
    expect(await android(androidElement('f', { text: 'null' })).inputValue()).toBe('null');
  });

  test('an empty field showing its hint reads as empty', async () => {
    expect(await android(androidElement('f', { text: 'Search', hint: 'Search' })).inputValue()).toBe('');
  });

  test('a filled field with a hint returns its text', async () => {
    expect(await android(androidElement('f', { text: 'apples', hint: 'Search' })).inputValue()).toBe('apples');
  });
});
