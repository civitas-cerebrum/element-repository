import type { Platform } from '../enum/Platform';

/**
 * XCUITest element types that report their on/off state in `value`
 * ("1" / "0") rather than `selected`.
 */
export const IOS_VALUE_STATE_TYPES: ReadonlySet<string> = new Set([
  'XCUIElementTypeSwitch',
  'XCUIElementTypeToggle',
]);

/**
 * Whether a raw WebdriverIO element is checked (on, ticked, chosen). One
 * rule for `isChecked()`, `check()` and `uncheck()` of a platform element.
 *
 * - `android`: the `checked` attribute is `"true"`. UiAutomator2 reports a
 *   CheckBox, Switch or RadioButton's state in `checked`; its `selected`
 *   (what WebdriverIO `isSelected()` returns) stays `"false"` whatever the
 *   state. An element that is not checkable reads as unchecked.
 * - `ios`: for a switch or toggle ({@link IOS_VALUE_STATE_TYPES}) the
 *   `value` attribute is `"1"` or `"true"`; for any other type (a segment,
 *   a tab, a button) WebdriverIO `isSelected()`. Assumption: XCUITest
 *   reports an off switch as `value` `"0"` with `selected` false, and an on
 *   switch as `value` `"1"`. Other types are never read from `value`: a
 *   plain row can carry a value of its own, such as a badge count `"1"`.
 * - any other platform (and an unknown one): WebdriverIO `isSelected()`.
 *
 * Cost: one driver round trip on Android and on other platforms, two on
 * iOS (the element type, then `value` or `selected`).
 *
 * Driver errors are not caught.
 *
 * @param el - A raw WebdriverIO element.
 * @param platform - The element's platform, if known.
 */
export async function readPlatformChecked(el: any, platform: Platform | undefined): Promise<boolean> {
  if (platform === 'android') return (await el.getAttribute('checked')) === 'true';
  if (platform === 'ios' && IOS_VALUE_STATE_TYPES.has(await el.getTagName())) {
    const value = String((await el.getAttribute('value')) ?? '').trim().toLowerCase();
    return value === '1' || value === 'true';
  }
  return (await el.isSelected()) === true;
}
