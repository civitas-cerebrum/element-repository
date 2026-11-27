import { test, expect } from '@playwright/test';
import { PlatformElement } from '../src/types';
import { StrategyResolver } from '../src/repo/StrategyResolver';
import { isFatalDriverError } from '../src/utils/driverErrors';
import { isUnknownAttributeError, readPlatformAttribute } from '../src/utils/platformAttr';

// ---------------------------------------------------------------------------
// Errors shaped exactly as WebdriverIO 10 builds them from the drivers'
// answers to `GET /element/<id>/attribute/<name>` for a name the driver does
// not know (`name` = the W3C error code, `message` = the driver's message plus
// WebdriverIO's ` when running ...` suffix).
// ---------------------------------------------------------------------------

/** UiAutomator2: HTTP 404, error "unknown command". */
function uiautomator2UnknownAttribute(name: string, id = '00000000-0000-0000-ffff-ffff00000051'): Error {
  const err = new Error(
    `WebDriverError: '${name}' attribute is unknown for the element. Only the following attributes are supported: ` +
    '[checkable, checked, {class,className}, clickable, {content-desc,contentDescription}, enabled, focusable, ' +
    'focused, {long-clickable,longClickable}, package, password, {resource-id,resourceId}, scrollable, ' +
    'selection-start, selection-end, selected, {text,name}, hint, extras, bounds, displayed] ' +
    `when running "element/${id}/attribute/${name}" with method "GET"`,
  );
  err.name = 'unknown command';
  return err;
}

/** XCUITest (WebDriverAgent): HTTP 500, error "unknown error". */
function xcuitestUnknownAttribute(name: string, id = 'A1B2C3D4-0000-0000-0000-000000000000'): Error {
  const err = new Error(
    `The attribute '${name}' is unknown. Valid attribute names are: (\n    UID,\n    accessibilityContainer,\n` +
    '    accessible,\n    enabled,\n    frame,\n    label,\n    name,\n    placeholderValue,\n    rect,\n' +
    `    selected,\n    type,\n    value,\n    visible\n) when running "element/${id}/attribute/${name}" with method "GET"`,
  );
  err.name = 'unknown error';
  return err;
}

/** A dead session, as WebdriverIO reports it. */
function deadSession(): Error {
  const err = new Error('A session is either terminated or not started');
  err.name = 'invalid session id';
  return err;
}

const ANDROID_KNOWN = new Set(['checkable', 'checked', 'class', 'content-desc', 'resource-id', 'text', 'hint', 'enabled', 'selected']);
const IOS_KNOWN = new Set(['label', 'value', 'name', 'type', 'enabled', 'selected', 'placeholderValue', 'visible']);

/**
 * A raw element answering like UiAutomator2: a known attribute the element
 * lacks reads as the string "null"; an unknown name throws the driver error.
 */
function androidElement(id: string, attrs: Record<string, string>, fail?: () => Error): any {
  return {
    elementId: id,
    getAttribute: async (name: string) => {
      if (fail) throw fail();
      if (!ANDROID_KNOWN.has(name)) throw uiautomator2UnknownAttribute(name);
      return name in attrs ? attrs[name] : 'null';
    },
    getText: async () => attrs.text ?? '',
    $$: async () => [],
    waitForExist: async () => true,
  };
}

/** A raw element answering like XCUITest: an unknown name throws the driver error. */
function iosElement(id: string, attrs: Record<string, string | null>, fail?: () => Error): any {
  let calls = 0;
  return {
    elementId: id,
    get calls() { return calls; },
    getAttribute: async (name: string) => {
      calls++;
      if (fail) throw fail();
      if (!IOS_KNOWN.has(name)) throw xcuitestUnknownAttribute(name);
      return name in attrs ? attrs[name] : null;
    },
    getTagName: async () => attrs.type ?? 'XCUIElementTypeButton',
    waitForExist: async () => true,
  };
}

function driverFor(...els: any[]): any {
  return { capabilities: {}, $: async () => els[0], $$: async () => els };
}

function on(platform: 'android' | 'ios', el: any, selector = '~row'): PlatformElement {
  return new PlatformElement(driverFor(el), selector, undefined, 1000, { platform });
}

test.describe('isUnknownAttributeError', () => {
  test('recognises the UiAutomator2 error for the name asked for, on android only', () => {
    const err = uiautomator2UnknownAttribute('data-never-reported');
    expect(isUnknownAttributeError(err, 'data-never-reported', 'android')).toBe(true);
    expect(isUnknownAttributeError(err, 'other', 'android')).toBe(false);
    expect(isUnknownAttributeError(err, 'data-never-reported', 'ios')).toBe(false);
  });

  test('recognises the XCUITest error for the name asked for, on ios only', () => {
    const err = xcuitestUnknownAttribute('data-never-reported');
    expect(isUnknownAttributeError(err, 'data-never-reported', 'ios')).toBe(true);
    expect(isUnknownAttributeError(err, 'other', 'ios')).toBe(false);
    expect(isUnknownAttributeError(err, 'data-never-reported', 'android')).toBe(false);
  });

  test('no other error is an unknown attribute', () => {
    expect(isUnknownAttributeError(deadSession(), 'x', 'android')).toBe(false);
    expect(isUnknownAttributeError(new Error('no such element'), 'x', 'ios')).toBe(false);
    expect(isUnknownAttributeError('x attribute is unknown for the element', 'x', 'android')).toBe(false);
    expect(isUnknownAttributeError(xcuitestUnknownAttribute('x'), 'x', undefined)).toBe(false);
  });

  test('the classifier is unchanged: unknown command and dead sessions stay fatal', () => {
    // getAttribute maps the unknown-attribute answer to null before any
    // classification; for every other command "unknown command" still fails at once.
    expect(isFatalDriverError(uiautomator2UnknownAttribute('x'))).toBe(true);
    const otherCommand = new Error('Method has not yet been implemented');
    otherCommand.name = 'unknown command';
    expect(isFatalDriverError(otherCommand)).toBe(true);
    expect(isFatalDriverError(deadSession())).toBe(true);
  });
});

test.describe('readPlatformAttribute', () => {
  test('android: unknown name and the string "null" both read as null', async () => {
    const el = androidElement('a', { 'content-desc': 'Settings' });
    expect(await readPlatformAttribute(el, 'data-never-reported', 'android')).toBeNull();
    expect(await readPlatformAttribute(el, 'hint', 'android')).toBeNull();
    expect(await readPlatformAttribute(el, 'content-desc', 'android')).toBe('Settings');
  });

  test('ios: unknown name reads as null; the string "null" is a value', async () => {
    const el = iosElement('i', { label: 'null' });
    expect(await readPlatformAttribute(el, 'data-never-reported', 'ios')).toBeNull();
    expect(await readPlatformAttribute(el, 'label', 'ios')).toBe('null');
  });

  test('another platform passes the driver error through', async () => {
    const el = iosElement('i', {});
    await expect(readPlatformAttribute(el, 'data-never-reported', 'windows')).rejects.toThrow(/is unknown/);
  });

  test('any other driver error is rethrown', async () => {
    await expect(readPlatformAttribute(androidElement('a', {}, deadSession), 'x', 'android')).rejects.toThrow(/terminated/);
    await expect(readPlatformAttribute(iosElement('i', {}, deadSession), 'x', 'ios')).rejects.toThrow(/terminated/);
  });
});

test.describe('PlatformElement.getAttribute with a name the driver does not know', () => {
  test('android: returns null instead of throwing the fatal "unknown command" error', async () => {
    expect(await on('android', androidElement('a', {})).getAttribute('data-never-reported')).toBeNull();
  });

  test('ios: returns null on the first read instead of failing every poll', async () => {
    const raw = iosElement('i', {});
    expect(await on('ios', raw).getAttribute('data-never-reported')).toBeNull();
    expect(raw.calls).toBe(1);
  });

  test('known attributes still read as before', async () => {
    expect(await on('android', androidElement('a', { 'content-desc': 'Go' })).getAttribute('content-desc')).toBe('Go');
    expect(await on('android', androidElement('a', {})).getAttribute('content-desc')).toBeNull();
    expect(await on('ios', iosElement('i', { label: 'Wi-Fi' })).getAttribute('label')).toBe('Wi-Fi');
  });

  test('a dead session still fails at once', async () => {
    await expect(on('android', androidElement('a', {}, deadSession)).getAttribute('x')).rejects.toThrow(/terminated/);
    await expect(on('ios', iosElement('i', {}, deadSession)).getAttribute('x')).rejects.toThrow(/terminated/);
  });

  test('an indexed element reads null too, without polling to its timeout', async () => {
    const raw = iosElement('i', {});
    const started = Date.now();
    expect(await new PlatformElement(driverFor(raw, raw), '~row', undefined, 5000, { platform: 'ios' }).nth(1)
      .getAttribute('data-never-reported')).toBeNull();
    expect(Date.now() - started).toBeLessThan(1000);
  });
});

test.describe('StrategyResolver.filterByAttribute with a name the driver does not know', () => {
  for (const platform of ['android', 'ios'] as const) {
    test(`${platform}: elements lacking the attribute never match, and nothing throws`, async () => {
      const make = platform === 'android'
        ? (id: string) => androidElement(id, {})
        : (id: string) => iosElement(id, {});
      const raws = [make('p'), make('q')];
      const els = raws.map(r => new PlatformElement(driverFor(...raws), '~row', r, 1000, { platform }));
      expect(await StrategyResolver.filterByAttribute(els, 'data-never-reported', 'x')).toBeNull();
      expect(await StrategyResolver.filterByAttribute(els, 'data-never-reported', 'x', true)).toBeNull();
      expect(await StrategyResolver.filterByAttribute(els, 'data-never-reported', 'x', false)).toBeNull();
    });
  }
});

test.describe('internal attribute reads use the same mapping', () => {
  test('android check(): an unknown checkable / class read does not refuse or throw', async () => {
    let checked = 'false';
    let clicks = 0;
    const raw = {
      elementId: 'c',
      getAttribute: async (name: string) => {
        if (name === 'checked') return checked;
        throw uiautomator2UnknownAttribute(name);
      },
      isEnabled: async () => true,
      click: async () => { clicks++; checked = 'true'; },
      waitForExist: async () => true,
    };
    await on('android', raw).check();
    expect(clicks).toBe(1);
  });

  test('android getTagName(): an unknown class reads as ""', async () => {
    const raw = { elementId: 'c', getAttribute: async (name: string) => { throw uiautomator2UnknownAttribute(name); }, waitForExist: async () => true };
    expect(await on('android', raw).getTagName()).toBe('');
  });

  test('ios textContent(): an unknown label falls back to value', async () => {
    const raw = {
      elementId: 'i',
      getTagName: async () => 'XCUIElementTypeStaticText',
      getAttribute: async (name: string) => {
        if (name === 'value') return 'Fallback';
        throw xcuitestUnknownAttribute(name);
      },
      waitForExist: async () => true,
    };
    expect(await on('ios', raw).textContent()).toBe('Fallback');
  });
});
