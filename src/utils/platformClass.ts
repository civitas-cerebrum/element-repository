import type { Platform } from '../enum/Platform';
import { androidAttribute } from './androidAttr';

/**
 * The class (element type) of a raw WebdriverIO element: the one read for
 * every decision that depends on what kind of element it is, and for
 * `PlatformElement.getTagName()`.
 *
 * - `android`: the `class` attribute (`android.widget.RadioButton`).
 *   UiAutomator2's `getTagName()` is not used: it returns the element's
 *   content-desc when one is set and `null` otherwise, never the class, so
 *   an element found by accessibility id would report its id. A missing attribute (`null`, or the
 *   string `"null"` UiAutomator2 returns for an attribute it lacks; see
 *   `androidAttribute`) reads as `''`.
 * - `ios`: WebdriverIO `getTagName()`, which XCUITest answers with the
 *   element type (`XCUIElementTypeSwitch`).
 * - every other platform (and an unknown one): WebdriverIO `getTagName()`.
 *
 * One driver round trip. Driver errors are not caught.
 *
 * @param el - A raw WebdriverIO element.
 * @param platform - The element's platform, if known.
 */
export async function readElementClass(el: any, platform: Platform | undefined): Promise<string> {
  if (platform === 'android') {
    return androidAttribute(await el.getAttribute('class')) ?? '';
  }
  return el.getTagName();
}
