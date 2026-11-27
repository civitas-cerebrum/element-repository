import type { Platform } from '../enum/Platform';
import { readElementClass } from './platformClass';
import { readPlatformAttribute } from './platformAttr';
import { settleAll, throwIfAborted } from './abort';

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
 * returned by UiAutomator2 in document order. An empty input reports its
 * hint as its `text` with `showing-hint="true"`; it is left out, since the
 * hint is not text the field holds.
 */
export const ANDROID_DESCENDANT_TEXT_XPATH = ".//*[@text!='' and not(@showing-hint='true')]";

/**
 * Element-scoped class chain for the descendants of an iOS element that
 * carry visible text: its `XCUIElementTypeStaticText` descendants at any
 * depth, which WebDriverAgent returns in document order. Static text is
 * the leaf that holds the words, so a nested container's own (merged)
 * label is not read a second time; a button's or input's own label / value
 * is not read (a static text inside a button is). Descendants are not
 * filtered by visibility, so off-screen static text is read too.
 */
export const IOS_DESCENDANT_TEXT_SELECTOR = '-ios class chain:**/XCUIElementTypeStaticText';

/**
 * XCUITest element types that hold no static text descendants: an empty
 * label / value on one of them is its text, with no descendant query.
 */
export const IOS_LEAF_TEXT_TYPES: ReadonlySet<string> = new Set([
  'XCUIElementTypeStaticText',
  'XCUIElementTypeImage',
]);

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
 *   the user reads as the row's text. When neither attribute has text and
 *   the element is not a text input, it is taken as a container whose
 *   visible text sits in its descendants (a custom dropdown option, a Cell
 *   with no label of its own and a child StaticText): the text of its
 *   static text descendants ({@link IOS_DESCENDANT_TEXT_SELECTOR}), each
 *   read by `label`, else `value`, in document order, each trimmed,
 *   whitespace-only ones skipped, joined with single spaces. Descendants
 *   are not filtered by visibility, and a button's or input's own label /
 *   value is not read (only static text). A static text or image element
 *   ({@link IOS_LEAF_TEXT_TYPES}) has no text descendants, so no query is
 *   made for it. Every static text inside is read, so a selector matching
 *   a large container (a bare `XCUIElementTypeOther`) reads every text
 *   under it. When no descendant has text, the empty attribute (if any) is
 *   returned.
 * - `android`: WebdriverIO `getText()`. When that has no text (empty or
 *   whitespace only), the element is taken as a container whose visible
 *   text sits in its descendants (a list row whose title and subtitle are
 *   child TextViews): the text of every descendant with a non-empty `text`
 *   attribute that is not showing a hint, in document order, each trimmed,
 *   whitespace-only ones skipped, joined with single spaces. Descendants
 *   are not filtered by `displayed`, which keeps the read to one query plus
 *   the text reads. When no descendant has text, the element's own text is
 *   returned. Every descendant is read, so a selector matching a large
 *   container (a whole list or screen) reads every text inside it. A
 *   descendant is read by its own `text` and its text-bearing children are
 *   read again on their own, so when a descendant's `text` already repeats
 *   its children's text (a node that merges its children's text, as some
 *   Compose layouts report), that text appears twice. Rare: a TextView has
 *   no children.
 * - every other platform (and an unknown one): WebdriverIO `getText()`.
 *
 * One rule on both platforms: an element's text is its own, else its
 * descendants'.
 *
 * On iOS the element type and `label` are read first; `value` is read only
 * for a text input or when the label has no text, so a typical row costs
 * two driver round trips rather than three. An element with neither costs
 * one more query plus a `label` read per static text descendant (and a
 * `value` read for one whose label is empty), issued together. On Android an element with its
 * own text costs one round trip; a container without one costs one more
 * query ({@link ANDROID_DESCENDANT_TEXT_XPATH}) plus one `getText()` per
 * descendant that has text (issued together).
 *
 * The iOS attributes are read with `readPlatformAttribute` (a name the
 * driver does not know reads as missing). Other driver errors are not caught.
 *
 * With `signal`, the signal is checked before every driver call and a
 * `LookupAbortedError` is thrown once it is aborted; the reads issued
 * together are all waited for, then the signal is checked, then the first
 * failure among them is thrown, so no read is left running.
 *
 * @param el - A raw WebdriverIO element.
 * @param platform - The element's platform, if known.
 * @param signal - The lookup's signal, if any.
 */
export async function readPlatformText(el: any, platform: Platform | undefined, signal?: AbortSignal): Promise<string | null> {
  // With a signal, every driver call is preceded by a check, and the reads
  // issued together are all waited for before the first failure is thrown.
  const call = (run: () => Promise<any>): Promise<any> => { throwIfAborted(signal); return run(); };
  if (platform === 'android') {
    const own = (await call(() => el.getText())) ?? null;
    if (hasText(own)) return own;
    const descendants = Array.from((await call(() => el.$$(ANDROID_DESCENDANT_TEXT_XPATH))) ?? []);
    const texts: unknown[] = await settleAll(descendants.map((d: any) => () => d.getText()), signal);
    const joined = texts.filter(hasText).map(t => t.trim()).join(' ');
    return joined !== '' ? joined : own;
  }
  if (platform !== 'ios') return (await call(() => el.getText())) ?? null;
  const [type, label] = await settleAll<string | null>(
    [() => readElementClass(el, platform), () => readPlatformAttribute(el, 'label', platform)], signal,
  ) as [string, string | null];
  const isInput = IOS_TEXT_INPUT_TYPES.has(type);
  if (!isInput && hasText(label)) return label;
  const value = await call(() => readPlatformAttribute(el, 'value', platform));
  const order = isInput ? [value, label] : [label, value];
  const withText = order.find(hasText);
  if (withText !== undefined) return withText;
  const own = order.find(s => typeof s === 'string') ?? null;
  if (isInput || IOS_LEAF_TEXT_TYPES.has(type)) return own;
  const descendants = Array.from((await call(() => el.$$(IOS_DESCENDANT_TEXT_SELECTOR))) ?? []);
  const texts = await settleAll(descendants.map((d: any) => async () => {
    const descendantLabel = await readPlatformAttribute(d, 'label', platform);
    return hasText(descendantLabel) ? descendantLabel : call(() => readPlatformAttribute(d, 'value', platform));
  }), signal);
  const joined = texts.filter(hasText).map(t => t.trim()).join(' ');
  return joined !== '' ? joined : own;
}
