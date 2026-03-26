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
 *
 * Supports both space-separated keys (`accessibility id`) and camelCase
 * aliases (`accessibilityid`).  All keys are **lowercase** because
 * {@link ElementRepository.getSelector} normalises with `toLowerCase()`
 * before lookup.
 *
 * Does not include `text` — that is platform-specific and added by
 * {@link ANDROID_FORMATTERS} and {@link IOS_FORMATTERS}.
 */
export const APPIUM_FORMATTERS: Record<string, SelectorFormatter> = {
  // ── identity / accessibility ──────────────────────────────────
  'accessibility id': (v) => `~${v}`,
  accessibilityid:    (v) => `~${v}`,

  // ── generic locators ──────────────────────────────────────────
  xpath:              (v) => v,
  id:                 (v) => `#${v}`,
  name:               (v) => v,

  // ── class-based ───────────────────────────────────────────────
  'class name':       (v) => v,
  classname:          (v) => v,
  'tag name':         (v) => v,
  tagname:            (v) => v,

  // ── Android-specific ──────────────────────────────────────────
  uiautomator:            (v) => `android=${v}`,
  androiduiautomator:     (v) => `android=${v}`,
  'android data matcher': (v) => `-android datamatcher:${v}`,
  androiddatamatcher:     (v) => `-android datamatcher:${v}`,
  'android view matcher': (v) => `-android viewmatcher:${v}`,
  androidviewmatcher:     (v) => `-android viewmatcher:${v}`,
  'android view tag':     (v) => `-android viewtag:${v}`,
  androidviewtag:         (v) => `-android viewtag:${v}`,

  // ── iOS-specific ──────────────────────────────────────────────
  predicate:              (v) => `-ios predicate string:${v}`,
  iosnspredicatestring:   (v) => `-ios predicate string:${v}`,
  'class chain':          (v) => `-ios class chain:${v}`,
  iosclasschain:          (v) => `-ios class chain:${v}`,
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
