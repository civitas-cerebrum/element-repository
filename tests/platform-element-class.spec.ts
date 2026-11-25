import { test, expect } from '@playwright/test';
import { PlatformElement } from '../src/types';
import { readElementClass } from '../src/utils/platformClass';

// ---------------------------------------------------------------------------
// Mocks shaped like the real drivers
// ---------------------------------------------------------------------------

/**
 * A UiAutomator2 element, as a real device answers: `getTagName()` returns
 * the content-desc when one is set and `null` otherwise, never the class;
 * the `class` / `className` attribute always holds the class; a missing
 * attribute reads as the string "null". `reads` records every driver call.
 */
function androidElement(className: string, contentDesc: string | null, reads: string[] = []): any {
  return {
    elementId: 'android-el',
    getTagName: async () => { reads.push('getTagName'); return contentDesc; },
    getAttribute: async (name: string) => {
      reads.push(`attr:${name}`);
      if (name === 'class' || name === 'className') return className;
      if (name === 'content-desc') return contentDesc ?? 'null';
      return 'null';
    },
    waitForExist: async () => true,
  };
}

/** An XCUITest element: `getTagName()` returns its XCUIElementType. */
function iosElement(type: string, reads: string[] = []): any {
  return {
    elementId: 'ios-el',
    getTagName: async () => { reads.push('getTagName'); return type; },
    getAttribute: async (name: string) => { reads.push(`attr:${name}`); return name === 'type' ? type : null; },
    waitForExist: async () => true,
  };
}

function driverFor(el: any): any {
  return { capabilities: {}, $: async () => el, $$: async () => [el] };
}

// ---------------------------------------------------------------------------
// readElementClass
// ---------------------------------------------------------------------------

test.describe('readElementClass', () => {
  test('android: reads the class attribute, never getTagName (the content-desc when set)', async () => {
    const reads: string[] = [];
    const el = androidElement('android.widget.RadioButton', 'radio-yes', reads);
    expect(await readElementClass(el, 'android')).toBe('android.widget.RadioButton');
    expect(reads).toEqual(['attr:class']);
  });

  test('android: an element without a content-desc reads the same class', async () => {
    expect(await readElementClass(androidElement('android.widget.Switch', null), 'android')).toBe('android.widget.Switch');
  });

  test('android: a missing class attribute (null or the string "null") reads as an empty string', async () => {
    expect(await readElementClass({ getTagName: async () => 'desc', getAttribute: async () => null }, 'android')).toBe('');
    expect(await readElementClass({ getTagName: async () => 'desc', getAttribute: async () => 'null' }, 'android')).toBe('');
  });

  test('ios: reads getTagName (the XCUIElementType)', async () => {
    const reads: string[] = [];
    expect(await readElementClass(iosElement('XCUIElementTypeSwitch', reads), 'ios')).toBe('XCUIElementTypeSwitch');
    expect(reads).toEqual(['getTagName']);
  });

  test('other or unknown platforms: getTagName', async () => {
    expect(await readElementClass(iosElement('Button'), 'windows')).toBe('Button');
    expect(await readElementClass(iosElement('Button'), undefined)).toBe('Button');
  });

  test('driver errors are not caught', async () => {
    const el = { getAttribute: async () => { throw new Error('session gone'); } };
    await expect(readElementClass(el, 'android')).rejects.toThrow('session gone');
  });
});

// ---------------------------------------------------------------------------
// PlatformElement.getTagName
// ---------------------------------------------------------------------------

test.describe('PlatformElement.getTagName', () => {
  test('android: returns the class, not the content-desc UiAutomator2 reports as the tag name', async () => {
    const el = new PlatformElement(
      driverFor(androidElement('android.widget.RadioButton', 'radio-yes')), '~radio-yes', undefined, 1000, { platform: 'android' },
    );
    expect(await el.getTagName()).toBe('android.widget.RadioButton');
  });

  test('android: an element without a content-desc returns its class, not null', async () => {
    const el = new PlatformElement(
      driverFor(androidElement('android.widget.TextView', null)), 'id=status', undefined, 1000, { platform: 'android' },
    );
    expect(await el.getTagName()).toBe('android.widget.TextView');
  });

  test('ios: returns the XCUIElementType', async () => {
    const el = new PlatformElement(driverFor(iosElement('XCUIElementTypeButton')), '~ok', undefined, 1000, { platform: 'ios' });
    expect(await el.getTagName()).toBe('XCUIElementTypeButton');
  });
});
