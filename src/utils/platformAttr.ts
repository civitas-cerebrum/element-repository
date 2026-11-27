import type { Platform } from '../enum/Platform';
import { androidAttribute } from './androidAttr';

/**
 * True when `err` is the driver's answer that it does not know the
 * attribute `name` at all, on `platform`:
 *
 * - `android` (UiAutomator2): `'<name>' attribute is unknown for the
 *   element. Only the following attributes are supported: [...]`
 *   (WebDriver error `unknown command`, which {@link isFatalDriverError}
 *   classes as fatal for every other command).
 * - `ios` (XCUITest / WebDriverAgent): `The attribute '<name>' is unknown.
 *   Valid attribute names are: (...)` (HTTP 500, WebDriver error
 *   `unknown error`, retried by a polling caller until its timeout).
 *
 * Only the error for the very name asked for counts, and only on the
 * platform whose driver words it that way; every other error (and every
 * error on another or an unknown platform) is not an unknown attribute.
 *
 * @param err - The value a raw element's `getAttribute(name)` threw.
 * @param name - The attribute name that was asked for.
 * @param platform - The element's platform, if known.
 */
export function isUnknownAttributeError(err: unknown, name: string, platform: Platform | undefined): boolean {
  if (!err || typeof err !== 'object') return false;
  const message = (err as { message?: unknown }).message;
  if (typeof message !== 'string') return false;
  if (platform === 'android') return message.includes(`'${name}' attribute is unknown for the element`);
  if (platform === 'ios') return message.includes(`The attribute '${name}' is unknown`);
  return false;
}

/**
 * Reads the attribute `name` of a raw WebdriverIO element with `null` for
 * an attribute the element does not have. One rule for the public
 * `getAttribute()` (and so `getByAttribute` / the `ATTRIBUTE` strategy) and
 * the element's own attribute reads (the checked state, the class, the
 * input hint, the iOS label and value).
 *
 * - An attribute name the driver does not know at all reads as `null`
 *   (see {@link isUnknownAttributeError}): no element has it.
 * - `android`: the string `"null"`, which UiAutomator2 sends for an
 *   attribute the element lacks, reads as `null` (see {@link androidAttribute}).
 * - every other value, and every other driver error, is passed through.
 *
 * @param el - A raw WebdriverIO element.
 * @param name - The attribute name.
 * @param platform - The element's platform, if known.
 */
export async function readPlatformAttribute(el: any, name: string, platform: Platform | undefined): Promise<string | null> {
  let value: unknown;
  try {
    value = await el.getAttribute(name);
  } catch (err) {
    if (isUnknownAttributeError(err, name, platform)) return null;
    throw err;
  }
  if (platform === 'android') return androidAttribute(value);
  return (value ?? null) as string | null;
}
