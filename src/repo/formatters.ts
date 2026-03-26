/** Converts a raw selector value into a platform-specific selector string. */
export type SelectorFormatter = (value: string) => string;

/** Playwright selector formatters keyed by strategy name (lowercase). */
export const WEB_FORMATTERS: Record<string, SelectorFormatter> = {
  css:         (v) => `css=${v}`,
  xpath:       (v) => `xpath=${v}`,
  id:          (v) => `#${v}`,
  text:        (v) => `text=${v}`,
  testid:      (v) => `[data-testid='${v}']`,
  role:        (v) => `[role='${v}']`,
  placeholder: (v) => `[placeholder='${v}']`,
  label:       (v) => `[aria-label='${v}']`,
};

/**
 * Base Appium selector formatters shared across all non-web platforms.
 * Does not include `text` — that is platform-specific and added by
 * {@link ANDROID_FORMATTERS} and {@link IOS_FORMATTERS}.
 */
export const APPIUM_FORMATTERS: Record<string, SelectorFormatter> = {
  'accessibility id': (v) => `~${v}`,
  xpath:              (v) => v,
  id:                 (v) => `#${v}`,
  uiautomator:        (v) => `android=${v}`,
  predicate:          (v) => `-ios predicate string:${v}`,
  'class chain':      (v) => `-ios class chain:${v}`,
  'class name':       (v) => v,
};

/** Android-specific formatters — extends {@link APPIUM_FORMATTERS} with UiSelector text lookup. */
export const ANDROID_FORMATTERS: Record<string, SelectorFormatter> = {
  ...APPIUM_FORMATTERS,
  text: (v) => `android=new UiSelector().text("${v}")`,
};

/** iOS-specific formatters — extends {@link APPIUM_FORMATTERS} with predicate-based text lookup. */
export const IOS_FORMATTERS: Record<string, SelectorFormatter> = {
  ...APPIUM_FORMATTERS,
  text: (v) => `-ios predicate string:label == "${v}"`,
};
