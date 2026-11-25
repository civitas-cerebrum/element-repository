import type { Platform } from '../enum/Platform';

/**
 * The platform an Appium driver runs, from its `platformName` capability,
 * else WebdriverIO's `isIOS` / `isAndroid` flags; `undefined` when none of
 * those tells.
 */
export function detectDriverPlatform(driver: any): Platform | undefined {
  const caps = (driver?.capabilities ?? {}) as Record<string, unknown>;
  const raw = String(caps.platformName ?? caps['appium:platformName'] ?? '').toLowerCase().replace(/\s+/g, '');
  if (raw === 'ios' || raw === 'android' || raw === 'windows') return raw;
  if (raw === 'mac' || raw === 'macos') return 'macos';
  if (driver?.isIOS === true) return 'ios';
  if (driver?.isAndroid === true) return 'android';
  return undefined;
}

/**
 * XCUITest element types whose `value` is the text the user typed, so it
 * is read before the `label`.
 */
export const IOS_TEXT_INPUT_TYPES: ReadonlySet<string> = new Set([
  'XCUIElementTypeTextField',
  'XCUIElementTypeSecureTextField',
  'XCUIElementTypeTextView',
  'XCUIElementTypeSearchField',
]);

/**
 * Relative XPath for the descendants of an Android element that carry text,
 * returned by UiAutomator2 in document order.
 */
export const ANDROID_DESCENDANT_TEXT_XPATH = ".//*[@text!='']";

/** True when `s` is a string with something other than whitespace. */
function hasText(s: unknown): s is string {
  return typeof s === 'string' && s.trim() !== '';
}

/**
 * The visible text of a raw WebdriverIO element, untrimmed, or `null` when
 * the driver reports none. One rule for every platform text read: the
 * element's text accessors and the repository's text lookups.
 *
 * - `ios`: the `label` attribute, else `value`. For text inputs
 *   ({@link IOS_TEXT_INPUT_TYPES}) `value` comes first, then `label`.
 *   XCUITest's own `getText()` returns `value` before `label`, so a
 *   Settings row with a badge reads as the badge count; the label is what
 *   the user reads as the row's text. When neither attribute has text, the
 *   empty one (if any) is returned.
 * - `android`: WebdriverIO `getText()`. When that has no text (empty or
 *   whitespace only), the element is taken as a container whose visible
 *   text sits in its descendants (a list row whose title and subtitle are
 *   child TextViews): the text of every descendant with a non-empty `text`
 *   attribute, in document order, each trimmed, whitespace-only ones
 *   skipped, joined with single spaces. Descendants are not filtered by
 *   `displayed`, which keeps the read to one query plus the text reads.
 *   When no descendant has text, the element's own text is returned.
 * - every other platform (and an unknown one): WebdriverIO `getText()`.
 *
 * On iOS the element type and `label` are read first; `value` is read only
 * for a text input or when the label has no text, so a typical row costs
 * two driver round trips rather than three. On Android an element with its
 * own text costs one round trip; a container without one costs one more
 * query ({@link ANDROID_DESCENDANT_TEXT_XPATH}) plus one `getText()` per
 * descendant that has text (issued together).
 *
 * Driver errors are not caught.
 *
 * @param el - A raw WebdriverIO element.
 * @param platform - The element's platform, if known.
 */
export async function readPlatformText(el: any, platform: Platform | undefined): Promise<string | null> {
  if (platform === 'android') {
    const own = (await el.getText()) ?? null;
    if (hasText(own)) return own;
    const descendants = Array.from((await el.$$(ANDROID_DESCENDANT_TEXT_XPATH)) ?? []);
    const texts = await Promise.all(descendants.map((d: any) => d.getText()));
    const joined = texts.filter(hasText).map(t => t.trim()).join(' ');
    return joined !== '' ? joined : own;
  }
  if (platform !== 'ios') return (await el.getText()) ?? null;
  const [type, label] = await Promise.all([el.getTagName(), el.getAttribute('label')]);
  const isInput = IOS_TEXT_INPUT_TYPES.has(type);
  if (!isInput && hasText(label)) return label;
  const value = await el.getAttribute('value');
  const order = IOS_TEXT_INPUT_TYPES.has(type) ? [value, label] : [label, value];
  const withText = order.find(hasText);
  if (withText !== undefined) return withText;
  return order.find(s => typeof s === 'string') ?? null;
}
