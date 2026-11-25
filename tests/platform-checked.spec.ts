import { test, expect } from '@playwright/test';
import { PlatformElement } from '../src/types';
import { readPlatformChecked } from '../src/utils/platformChecked';

// ---------------------------------------------------------------------------
// Mocks shaped like the real drivers
// ---------------------------------------------------------------------------

/**
 * A UiAutomator2 CheckBox / Switch / RadioButton. Its state is the `checked`
 * attribute; `selected` stays "false" whatever the state, as on a real
 * device. A click toggles it, except that a checked radio button stays
 * checked. As UiAutomator2 does, `getTagName()` returns the content-desc
 * when one is set and `null` otherwise, never the class; only the `class` /
 * `className` attribute holds the class; a missing attribute reads as the
 * string "null".
 */
function androidControl(
  className: string,
  checked: boolean,
  opts: {
    radio?: boolean; ignoresClicks?: boolean; flipAfterMs?: number; checkable?: string; disabled?: boolean;
    enableAfterMs?: number; contentDesc?: string;
  } = {},
) {
  const state = { checked, clicks: 0, enabled: !opts.disabled };
  if (opts.enableAfterMs !== undefined) setTimeout(() => { state.enabled = true; }, opts.enableAfterMs);
  const el: any = {
    elementId: 'android-control',
    getTagName: async () => opts.contentDesc ?? null,
    getAttribute: async (name: string) => {
      if (name === 'class' || name === 'className') return className;
      if (name === 'content-desc') return opts.contentDesc ?? 'null';
      if (name === 'checked') return String(state.checked);
      if (name === 'selected') return 'false';
      // A real device answers the string "null" for an attribute it lacks.
      if (name === 'checkable') return 'checkable' in opts ? (opts.checkable ?? 'null') : 'true';
      if (name === 'enabled') return String(state.enabled);
      return 'null';
    },
    isSelected: async () => false,
    isEnabled: async () => state.enabled,
    click: async () => {
      state.clicks++;
      if (opts.ignoresClicks || !state.enabled) return;
      const next = opts.radio ? true : !state.checked;
      if (opts.flipAfterMs) setTimeout(() => { state.checked = next; }, opts.flipAfterMs);
      else state.checked = next;
    },
    isDisplayed: async () => true,
    waitForExist: async () => true,
  };
  return { el, state };
}

/**
 * An XCUITest element. A switch reports its state as `value` "1" / "0" and
 * is never `selected`; any other type (a segment, a tab, a button) reports
 * `selected`. A click toggles the state.
 */
function iosControl(type: string, on: boolean) {
  const isSwitch = type === 'XCUIElementTypeSwitch' || type === 'XCUIElementTypeToggle';
  const state = { on, clicks: 0, tagReads: 0 };
  const el: any = {
    elementId: 'ios-control',
    getTagName: async () => { state.tagReads++; return type; },
    getAttribute: async (name: string) => {
      if (name === 'type') return type;
      // A non-switch row can carry a value of its own (a badge count), which
      // says nothing about its state.
      if (name === 'value') return isSwitch ? (state.on ? '1' : '0') : '1';
      if (name === 'selected') return String(!isSwitch && state.on);
      return null;
    },
    isSelected: async () => !isSwitch && state.on,
    isEnabled: async () => true,
    click: async () => { state.clicks++; state.on = !state.on; },
    isDisplayed: async () => true,
    waitForExist: async () => true,
  };
  return { el, state };
}

function driverFor(el: any, capabilities: Record<string, unknown> = {}): any {
  return { capabilities, $: async () => el, $$: async () => [el], pause: async () => {} };
}

// ---------------------------------------------------------------------------
// The rule
// ---------------------------------------------------------------------------

test.describe('readPlatformChecked', () => {
  test('android: reads the checked attribute, not selected', async () => {
    expect(await readPlatformChecked(androidControl('android.widget.Switch', true).el, 'android')).toBe(true);
    expect(await readPlatformChecked(androidControl('android.widget.Switch', false).el, 'android')).toBe(false);
  });

  for (const type of ['XCUIElementTypeSwitch', 'XCUIElementTypeToggle']) {
    test(`ios: a ${type} reads value "1" / "0"`, async () => {
      expect(await readPlatformChecked(iosControl(type, true).el, 'ios')).toBe(true);
      expect(await readPlatformChecked(iosControl(type, false).el, 'ios')).toBe(false);
    });
  }

  test('ios: a switch whose value is "true" is checked; any other value is not', async () => {
    const withValue = (value: string | null): any => ({
      getTagName: async () => 'XCUIElementTypeSwitch',
      getAttribute: async (name: string) => (name === 'value' ? value : null),
      isSelected: async () => false,
    });
    expect(await readPlatformChecked(withValue('true'), 'ios')).toBe(true);
    expect(await readPlatformChecked(withValue('false'), 'ios')).toBe(false);
    expect(await readPlatformChecked(withValue(''), 'ios')).toBe(false);
    expect(await readPlatformChecked(withValue(null), 'ios')).toBe(false);
  });

  test('ios: a button with value "1" that is not selected is not checked', async () => {
    const { el } = iosControl('XCUIElementTypeButton', false);
    expect(await el.getAttribute('value')).toBe('1');
    expect(await readPlatformChecked(el, 'ios')).toBe(false);
  });

  test('ios: any other type reads selected', async () => {
    expect(await readPlatformChecked(iosControl('XCUIElementTypeButton', true).el, 'ios')).toBe(true);
    expect(await readPlatformChecked(iosControl('XCUIElementTypeButton', false).el, 'ios')).toBe(false);
  });

  test('ios: a type given by the caller is used instead of reading it', async () => {
    const { el, state } = iosControl('XCUIElementTypeSwitch', true);
    expect(await readPlatformChecked(el, 'ios', 'XCUIElementTypeSwitch')).toBe(true);
    expect(await readPlatformChecked(el, 'ios', 'XCUIElementTypeButton')).toBe(false);
    expect(state.tagReads).toBe(0);
  });

  test('unknown platform: WebdriverIO isSelected()', async () => {
    const el: any = { isSelected: async () => true, getAttribute: async () => 'false' };
    expect(await readPlatformChecked(el, undefined)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// PlatformElement.isChecked / check / uncheck on Android
// ---------------------------------------------------------------------------

test.describe('PlatformElement checked state on android', () => {
  test('isChecked is true for a switch that is on (checked="true", selected="false")', async () => {
    const { el } = androidControl('android.widget.Switch', true);
    const element = new PlatformElement(driverFor(el), '~toggle-on', undefined, 1000, { platform: 'android' });
    expect(await element.isChecked()).toBe(true);
  });

  test('the platform can come from the driver capabilities', async () => {
    const { el } = androidControl('android.widget.CheckBox', true);
    const element = new PlatformElement(driverFor(el, { platformName: 'Android' }), '~checkbox-checked');
    expect(await element.isChecked()).toBe(true);
  });

  test('check() on a checked switch does not click it', async () => {
    const { el, state } = androidControl('android.widget.Switch', true);
    await new PlatformElement(driverFor(el), '~toggle-on', undefined, 1000, { platform: 'android' }).check();
    expect(state.clicks).toBe(0);
    expect(state.checked).toBe(true);
  });

  test('check() on an unchecked checkbox clicks once and leaves it checked', async () => {
    const { el, state } = androidControl('android.widget.CheckBox', false);
    await new PlatformElement(driverFor(el), '~checkbox-unchecked', undefined, 1000, { platform: 'android' }).check();
    expect(state.clicks).toBe(1);
    expect(state.checked).toBe(true);
  });

  test('uncheck() on a checked switch clicks once and leaves it unchecked', async () => {
    const { el, state } = androidControl('android.widget.Switch', true);
    await new PlatformElement(driverFor(el), '~toggle-on', undefined, 1000, { platform: 'android' }).uncheck();
    expect(state.clicks).toBe(1);
    expect(state.checked).toBe(false);
  });

  test('uncheck() on an unchecked switch does not click it', async () => {
    const { el, state } = androidControl('android.widget.Switch', false);
    await new PlatformElement(driverFor(el), '~toggle-off', undefined, 1000, { platform: 'android' }).uncheck();
    expect(state.clicks).toBe(0);
  });

  test('check() on a radio button clicks once and leaves it checked', async () => {
    const { el, state } = androidControl('android.widget.RadioButton', false, { radio: true });
    await new PlatformElement(driverFor(el), '~radio-yes', undefined, 1000, { platform: 'android' }).check();
    expect(state.clicks).toBe(1);
    expect(state.checked).toBe(true);
  });

  test('check() waits for a state change that lands after the click', async () => {
    const { el, state } = androidControl('android.widget.Switch', false, { flipAfterMs: 300 });
    await new PlatformElement(driverFor(el), '~toggle-off', undefined, 2000, { platform: 'android' }).check();
    expect(state.clicks).toBe(1);
    expect(state.checked).toBe(true);
  });

  test('check() throws when the control is still unchecked after the click', async () => {
    const { el, state } = androidControl('android.widget.Switch', false, { ignoresClicks: true });
    const element = new PlatformElement(driverFor(el), '~toggle-disabled', undefined, 5000, { platform: 'android' });
    await expect(element.check({ timeout: 300 }))
      .rejects.toThrow('check: "~toggle-disabled" is still unchecked after clicking');
    expect(state.clicks).toBe(1);
  });

  test('uncheck() on a checked radio button fails at once without clicking it', async () => {
    const { el, state } = androidControl('android.widget.RadioButton', true, { radio: true, contentDesc: 'radio-yes' });
    const element = new PlatformElement(driverFor(el), '~radio-yes', undefined, 5000, { platform: 'android' });
    const start = Date.now();
    await expect(element.uncheck({ timeout: 3000 }))
      .rejects.toThrow('uncheck: "~radio-yes" is a radio button; select another option instead');
    expect(Date.now() - start).toBeLessThan(1000);
    expect(state.clicks).toBe(0);
    expect(state.checked).toBe(true);
  });

  test('a radio is recognised by its class attribute, not by getTagName (which is its content-desc)', async () => {
    const { el, state } = androidControl('android.widget.RadioButton', true, { radio: true, contentDesc: 'radio-yes' });
    expect(await el.getTagName()).toBe('radio-yes');
    const element = new PlatformElement(driverFor(el), '~radio-yes', undefined, 5000, { platform: 'android' });
    await expect(element.uncheck({ timeout: 300 })).rejects.toThrow('is a radio button');
    expect(state.clicks).toBe(0);
  });

  test('uncheck() on an unchecked radio button does nothing', async () => {
    const { el, state } = androidControl('android.widget.RadioButton', false, { radio: true });
    await new PlatformElement(driverFor(el), '~radio-no', undefined, 1000, { platform: 'android' }).uncheck();
    expect(state.clicks).toBe(0);
  });

  for (const method of ['check', 'uncheck'] as const) {
    test(`${method}() on an element that is not checkable fails at once without clicking it`, async () => {
      const { el, state } = androidControl('android.widget.Button', method === 'uncheck', { checkable: 'false' });
      const element = new PlatformElement(driverFor(el), '~plain-button', undefined, 5000, { platform: 'android' });
      const start = Date.now();
      await expect(element[method]({ timeout: 3000 })).rejects.toThrow(`${method}: "~plain-button" is not checkable`);
      expect(Date.now() - start).toBeLessThan(1000);
      expect(state.clicks).toBe(0);
    });
  }

  test('check() on a control with no checkable attribute still clicks', async () => {
    const { el, state } = androidControl('android.view.View', false, { checkable: null as any });
    await new PlatformElement(driverFor(el), '~custom', undefined, 1000, { platform: 'android' }).check();
    expect(state.clicks).toBe(1);
    expect(state.checked).toBe(true);
  });

  test('check() on a disabled control waits for it to be enabled, then throws without clicking', async () => {
    const { el, state } = androidControl('android.widget.Switch', false, { disabled: true });
    const element = new PlatformElement(driverFor(el), '~toggle-disabled', undefined, 5000, { platform: 'android' });
    const start = Date.now();
    await expect(element.check({ timeout: 400 })).rejects.toThrow('check: "~toggle-disabled" is disabled');
    expect(Date.now() - start).toBeGreaterThanOrEqual(350);
    expect(state.clicks).toBe(0);
  });

  test('check() on a control that becomes enabled within the timeout clicks it', async () => {
    const { el, state } = androidControl('android.widget.Switch', false, { disabled: true, enableAfterMs: 250 });
    await new PlatformElement(driverFor(el), '~toggle-later', undefined, 2000, { platform: 'android' }).check();
    expect(state.clicks).toBe(1);
    expect(state.checked).toBe(true);
  });

  test('check() on a disabled control that is already checked does nothing', async () => {
    const { el, state } = androidControl('android.widget.Switch', true, { disabled: true });
    await new PlatformElement(driverFor(el), '~toggle-on-disabled', undefined, 1000, { platform: 'android' }).check();
    expect(state.clicks).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// PlatformElement.isChecked / check / uncheck on iOS
// ---------------------------------------------------------------------------

test.describe('PlatformElement checked state on ios', () => {
  test('isChecked reads a switch value', async () => {
    const on = new PlatformElement(driverFor(iosControl('XCUIElementTypeSwitch', true).el), '~wifi', undefined, 1000, { platform: 'ios' });
    const off = new PlatformElement(driverFor(iosControl('XCUIElementTypeSwitch', false).el), '~wifi', undefined, 1000, { platform: 'ios' });
    expect(await on.isChecked()).toBe(true);
    expect(await off.isChecked()).toBe(false);
  });

  test('check() on a switch that is on does not click it; uncheck() turns it off', async () => {
    const { el, state } = iosControl('XCUIElementTypeSwitch', true);
    const element = new PlatformElement(driverFor(el), '~wifi', undefined, 1000, { platform: 'ios' });
    await element.check();
    expect(state.clicks).toBe(0);
    await element.uncheck();
    expect(state.clicks).toBe(1);
    expect(state.on).toBe(false);
  });

  test('check() on a switch that is off turns it on', async () => {
    const { el, state } = iosControl('XCUIElementTypeSwitch', false);
    await new PlatformElement(driverFor(el, { platformName: 'iOS' }), '~wifi', undefined, 1000).check();
    expect(state.clicks).toBe(1);
    expect(state.on).toBe(true);
  });

  test('check() and uncheck() read the element type once per call', async () => {
    const { el, state } = iosControl('XCUIElementTypeSwitch', false);
    const element = new PlatformElement(driverFor(el), '~wifi', undefined, 1000, { platform: 'ios' });
    await element.check();
    expect(state.tagReads).toBe(1);
    await element.uncheck();
    expect(state.tagReads).toBe(2);
    expect(state.on).toBe(false);
  });

  test('a selected button reads as checked', async () => {
    const { el, state } = iosControl('XCUIElementTypeButton', true);
    const element = new PlatformElement(driverFor(el), '~segment', undefined, 1000, { platform: 'ios' });
    expect(await element.isChecked()).toBe(true);
    await element.check();
    expect(state.clicks).toBe(0);
  });
});
