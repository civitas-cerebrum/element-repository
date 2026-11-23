import type { ElementChain } from './ElementChain';
import type { WebElement } from './WebElement';
import type { PlatformElement } from './PlatformElement';

/** Discriminator for {@link Element} implementations. */
export enum ElementType {
  WEB = 'web',
  PLATFORM = 'platform',
}

/** Optional timeout configuration for element actions. */
export interface ElementActionOptions {
  timeout?: number;
}

/**
 * Options for {@link Element.click}.
 */
export interface ClickOptions extends ElementActionOptions {
  /**
   * Click without scrolling the element into view first.
   *
   * Web: dispatches a DOM `click` event on the element (no scrolling, no
   * actionability checks), after waiting for it to be attached.
   * Platform (Appium): the option changes nothing. A platform element click
   * is always the plain WebDriver element click, which taps the element
   * where it is and never scrolls.
   */
  withoutScrolling?: boolean;
}

/** Direction of a {@link Element.swipe} gesture. */
export type SwipeDirection = 'up' | 'down' | 'left' | 'right';

/**
 * Options for {@link Element.scrollIntoView}. The sweep is always
 * single-axis, single-direction — the caller tells us where to look.
 * No implicit bidirectional fallback; if you don't know the target
 * position, chain two calls in different directions.
 *
 *   `'down'`  (default) — swipes up to reveal content below.
 *   `'up'`              — swipes down to reveal content above.
 *   `'left'`            — swipes right to reveal content to the left.
 *   `'right'`           — swipes left to reveal content to the right.
 */
export interface ScrollIntoViewOptions extends ElementActionOptions {
  direction?: 'down' | 'up' | 'left' | 'right';
  /**
   * Platform (Appium): the most swipes the sweep makes before giving up.
   * A positive integer; default 20. Web: ignored (the browser scrolls in
   * one step), but still validated.
   */
  maxSwipes?: number;
}

/** Options for {@link Element.swipe}. */
export interface SwipeOptions extends ElementActionOptions {
  /**
   * Gesture distance in CSS pixels. When omitted, defaults to ~50% of the
   * relevant viewport dimension in the chosen direction, which is a
   * reasonable "single screen swipe" on typical phone / desktop sizes.
   */
  distance?: number;
}

/** Options for {@link Element.longPress}. */
export interface LongPressOptions extends ElementActionOptions {
  /** How long to hold the press, in ms. Default `1000`. */
  duration?: number;
}

/**
 * Offset for {@link Element.tapAt}, in CSS pixels (device-independent
 * points on Appium) measured from the element's top-left corner. Both
 * values must lie within the element's bounds: `0 <= x < width` and
 * `0 <= y < height` (the far edges belong to the next pixel outside).
 */
export interface TapOffset {
  x: number;
  y: number;
}

/** Options for {@link Element.tapAt}. */
export interface TapAtOptions extends ElementActionOptions {}

/** Options for {@link Element.pinch}. */
export interface PinchOptions extends ElementActionOptions {
  /**
   * Ratio of the final finger distance to the starting distance. Must be
   * between 0 and 1 (exclusive). Default `0.5` (fingers end at half the
   * distance they started at).
   */
  scale?: number;
}

/** Options for {@link Element.zoom}. */
export interface ZoomOptions extends ElementActionOptions {
  /**
   * Ratio of the final finger distance to the starting distance. Must be
   * greater than 1. Default `2` (fingers end twice as far apart).
   */
  scale?: number;
}

/**
 * Platform-agnostic element abstraction.
 *
 * Provides a unified API for interacting with UI elements regardless of
 * whether the underlying driver is Playwright (web) or WebDriverIO (mobile/desktop).
 */
export interface Element {
  /** Discriminator indicating the concrete implementation type. */
  readonly _type: ElementType;

  /**
   * The raw selector string this element was resolved from. Returned in
   * platform-native form (e.g., `css=<value>` on Playwright,
   * `~<accessibility id>` on Appium). Absent when the element was
   * constructed from a pre-built locator rather than a string selector.
   *
   * Consumers use this when they need to compose platform-specific queries
   * (e.g., Playwright's `expect(page.locator(selector))` or Appium's
   * `driver.$(selector)`) without reaching through implementation-specific
   * properties.
   */
  readonly selector?: string;

  // ── Fluent chain ────────────────────────────────────────────

  /**
   * Returns a fluent {@link ElementChain} builder for sequencing actions.
   * The optional timeout applies to all wait and action calls in the chain.
   *
   * @param timeout - Timeout in ms for all operations in this chain.
   *
   * @example
   * ```ts
   * await element.action(5000).waitForState('visible').click()
   * await element.action().fill('hello').click()
   * const text = await element.action().getText()
   * ```
   */
  action(timeout?: number): ElementChain;

  // ── Interaction ──────────────────────────────────────────────

  /**
   * Clicks the element. See {@link ClickOptions.withoutScrolling} for a
   * click that does not scroll.
   */
  click(options?: ClickOptions): Promise<Element>;

  /**
   * Clears the input and fills it with the given text.
   * @param text - The value to type into the element.
   */
  fill(text: string, options?: ElementActionOptions): Promise<Element>;

  /** Clears the element's value. */
  clear(options?: ElementActionOptions): Promise<Element>;

  /** Checks a checkbox or radio button if it is not already checked. */
  check(options?: ElementActionOptions): Promise<Element>;

  /** Unchecks a checkbox if it is currently checked. */
  uncheck(options?: ElementActionOptions): Promise<Element>;

  /** Hovers over the element. */
  hover(options?: ElementActionOptions): Promise<Element>;

  /** Double-clicks the element. */
  doubleClick(options?: ElementActionOptions): Promise<Element>;

  /**
   * Scrolls the element into the visible area of the viewport.
   *
   * On platform (Appium) elements this sweeps the screen in ONE
   * direction until the element is displayed, giving up after a set
   * number of swipes. `direction` names where the target is relative to
   * the current view: `'down'` (default) reveals content below,
   * `'up'` content above, `'left'` / `'right'` content to that side of a
   * horizontal list or carousel. There is no bidirectional mode; if the
   * target's position is unknown, call it twice with different
   * directions.
   *
   * On platform elements the sweep makes up to `options.maxSwipes` swipes
   * (default 20; each about 100 ms hold + 600 ms move + 200 ms settle of
   * gesture time, around 3 s on a real device). The sweep is time-bounded
   * only by a timeout given to this call: with `options.timeout` it also
   * stops once that many ms have passed (no new swipe starts after the
   * deadline, so the call can overrun it by at most one swipe). Without
   * one, only the swipe limit applies: neither the element's default
   * timeout nor an {@link Element.action} chain timeout bounds the sweep.
   * The error names the bound that was hit.
   *
   * On web elements the browser scrolls whatever is needed, `direction`
   * and `maxSwipes` are ignored (`maxSwipes` is still validated), and the
   * Playwright timeout is `options.timeout`, else the element's default
   * timeout.
   *
   * @throws Error when `options.maxSwipes` is given and is not a positive
   *   integer.
   */
  scrollIntoView(options?: ScrollIntoViewOptions): Promise<Element>;

  /**
   * Performs a swipe gesture originating at the element's center. Used
   * for user-driven horizontal / vertical swipes where the caller knows
   * the intent (e.g., advancing a horizontal carousel by one page,
   * dismissing a card by flicking right). Distinct from
   * {@link Element.scrollIntoView}, which sweeps a scrollable container
   * until a target becomes visible.
   *
   * On mobile, dispatches a W3C pointer action from the element's center
   * toward the given direction for the requested distance, in
   * native-context viewport coordinates (the space of the element rect
   * and the window size; a webview context's CSS pixels may differ). On web,
   * delegates to the driver's native mouse/touch wheel emulation where
   * available; throws on backends that don't support programmatic
   * swipes.
   *
   * On platform elements the start point (the element centre, or the
   * window centre when the driver reports no rect) must be inside the
   * window; it is never moved. The end point is clamped to the window
   * (`[0, width-1]` x `[0, height-1]`), so near an edge the swipe travels
   * less than `distance`.
   *
   * @throws (platform) `swipe: element centre (x, y) is outside the window
   *         (WxH); call scrollIntoView first` when the start point is off
   *         the window, and `swipe: the start point (x, y) is at the window
   *         edge (WxH) for a '<direction>' swipe; nothing to swipe` when the
   *         start point lies on the edge the swipe moves toward, so the
   *         finger could not move. Nothing is sent in either case.
   *
   * @param direction - 'up' | 'down' | 'left' | 'right'.
   * @param options - Optional distance (default ~50% of viewport dim) and
   *                  `timeout` for waiting until the element is attached.
   */
  swipe(direction: SwipeDirection, options?: SwipeOptions): Promise<Element>;

  /**
   * Presses and holds on the element's centre, then releases.
   *
   * On platform (Appium) elements, dispatches a single W3C touch pointer
   * in native-context viewport coordinates: down, pause for `duration`,
   * up. The element centre must be inside the window; call
   * {@link Element.scrollIntoView} first for an off-screen element. On web
   * elements, scrolls the element into view, checks that it (not a cover
   * over it) receives the pointer, then holds the primary mouse button
   * for `duration`.
   *
   * The pointer is always released. If the gesture failed, that error is
   * thrown; if only the release failed, the release error is thrown.
   *
   * @param options - `duration` in ms (default `1000`, rounded to whole
   *                  ms); `timeout` for waiting until the element is
   *                  attached (web: also actionable).
   * @throws When `duration` is negative or not finite, the element has no
   *         bounds, or (platform) its centre is outside the window.
   */
  longPress(options?: LongPressOptions): Promise<Element>;

  /**
   * Taps a point inside the element, given as an offset from the
   * element's top-left corner.
   *
   * On platform (Appium) elements, dispatches a W3C touch tap at that
   * point in native-context viewport coordinates; the point must be
   * inside the window (call {@link Element.scrollIntoView} first). The
   * pointer is always released, as for {@link Element.longPress}. On web
   * elements, clicks at that position.
   *
   * @param offset  - `{ x, y }` from the top-left corner;
   *                  `0 <= x < width` and `0 <= y < height`.
   * @param options - `timeout` for waiting until the element is attached.
   * @throws When the offset lies outside the element's bounds, or
   *         (platform) the point is outside the window.
   */
  tapAt(offset: TapOffset, options?: TapAtOptions): Promise<Element>;

  /**
   * Two-finger pinch centred on the element: the fingers start apart on
   * the horizontal axis and move toward each other.
   *
   * Platform (Appium) elements only, dispatched as two W3C touch pointers
   * in native-context viewport coordinates. The fingers start 40% of the
   * element width from the centre; they never end closer than 10 px to
   * it, so on a small element or a small `scale` the start positions can
   * lie past the element. Those outer positions are clamped to the window.
   * Throws when the element centre is outside the window, or when the
   * centre is so close to the window edge that a finger would not move.
   * The pointers are always released, as for {@link Element.longPress}.
   * Web elements throw `PlatformNotSupportedError`.
   *
   * @param options - `scale` in (0, 1), default `0.5`; `timeout` for
   *                  waiting until the element is attached.
   */
  pinch(options?: PinchOptions): Promise<Element>;

  /**
   * Two-finger zoom (spread) centred on the element: the fingers start
   * close together on the horizontal axis and move apart.
   *
   * Platform (Appium) elements only, dispatched as two W3C touch pointers
   * in native-context viewport coordinates. The fingers end 40% of the
   * element width from the centre, but start no closer than 10 px to it,
   * so a large `scale` can carry the end positions past the element.
   * Those outer positions are clamped to the window. Throws when the
   * element centre is outside the window, or when the centre is so close
   * to the window edge that a finger would not move. The pointers are
   * always released, as for {@link Element.longPress}.
   * Web elements throw `PlatformNotSupportedError`.
   *
   * @param options - `scale` greater than 1, default `2`; `timeout` for
   *                  waiting until the element is attached.
   */
  zoom(options?: ZoomOptions): Promise<Element>;

  /**
   * Types text one character at a time.
   * @param text  - The characters to type.
   * @param delay - Optional millisecond delay between keystrokes.
   */
  pressSequentially(text: string, delay?: number, options?: ElementActionOptions): Promise<Element>;

  /**
   * Sets the value of a file input.
   * @param filePath - One path, or an array of paths for a `multiple` input.
   *                   Absolute or relative to the working directory.
   * @throws On platform elements where file input is unsupported.
   */
  setInputFiles(filePath: string | string[], options?: ElementActionOptions): Promise<Element>;

  /**
   * Dispatches a DOM event on the element.
   * @param event - The event type to dispatch (e.g. `"change"`).
   * @throws On platform elements where DOM events are unsupported.
   */
  dispatchEvent(event: string): Promise<Element>;

  // ── State ────────────────────────────────────────────────────

  /** Returns `true` if the element is visible in the viewport. */
  isVisible(): Promise<boolean>;

  /** Returns `true` if the element is enabled (not disabled). */
  isEnabled(): Promise<boolean>;

  /** Returns `true` if a checkbox or radio button is checked/selected. */
  isChecked(): Promise<boolean>;

  // ── Extraction ───────────────────────────────────────────────

  /** Returns the raw underlying selector string. */
  raw(): Promise<string | null>;

  /**
   * Returns the text of the element, or `null` when there is none.
   *
   * Web: the DOM `textContent` as Playwright returns it (not trimmed).
   * Platform: the visible text, trimmed. On iOS that is the `label`
   * attribute, else `value`; for text inputs (text field, secure text
   * field, text view, search field) `value` comes first, then `label`.
   * XCUITest's own `getText()` returns `value` first, so a row with a badge
   * would read as the badge. Other platforms use the driver's `getText()`.
   */
  textContent(): Promise<string | null>;

  /**
   * Returns the element's text as {@link textContent} reads it, but never
   * trimmed, or `null` when there is none.
   */
  rawText(): Promise<string | null>;

  /**
   * Returns the value of the given HTML attribute, or `null` if absent.
   * @param name - Attribute name.
   */
  getAttribute(name: string): Promise<string | null>;

  /** Returns the current value of an `<input>`, `<textarea>`, or `<select>`. */
  inputValue(): Promise<string>;

  /**
   * Returns the computed/effective value of a style property.
   * On web, delegates to `getComputedStyle()`; on platform elements,
   * delegates to the driver's CSS-value accessor (hybrid web contexts).
   */
  getCssProperty(property: string): Promise<string>;

  /**
   * Returns the element's bounding box in CSS pixels, or `null` if the element
   * is not rendered. Coordinates are relative to the viewport.
   */
  boundingBox(): Promise<{ x: number; y: number; width: number; height: number } | null>;

  /**
   * Captures a screenshot of the element.
   * @param options - Optional. `path` to save to disk; returned buffer always.
   */
  screenshot(options?: { path?: string }): Promise<Buffer>;

  /** Returns the element's tag/class name (e.g. `"button"`, `"android.widget.Button"`). */
  getTagName(): Promise<string>;

  /** Returns `true` if the element exists in the DOM / element tree (regardless of visibility). */
  exists(): Promise<boolean>;

  /**
   * Drags this element onto another element.
   * Web uses HTML5 drag-and-drop; platform drivers use touch-based drag.
   */
  dragTo(
    target: Element,
    options?: {
      timeout?: number;
      sourcePosition?: { x: number; y: number };
      targetPosition?: { x: number; y: number };
    },
  ): Promise<Element>;

  // ── Querying ─────────────────────────────────────────────────

  /**
   * Locates a descendant element matching the given selector.
   * @param selector - CSS or platform-specific selector.
   */
  locateChild(selector: string): Element;

  /** Returns the number of elements matched by this locator. */
  count(): Promise<number>;

  /** Resolves to an array of all matched elements. */
  all(): Promise<Element[]>;

  /** Returns the first matched element. */
  first(): Element;

  /**
   * Returns the element at the given zero-based index.
   * @param index - Zero-based position.
   */
  nth(index: number): Element;

  /**
   * Filters matched elements by text content.
   * @param options - Filter criteria.
   */
  filter(options: { hasText?: string | RegExp }): Element;

  // ── Waiting ──────────────────────────────────────────────────

  /**
   * Waits for the element to reach the specified state.
   * @param options - Optional state (`"visible"`, `"hidden"`, `"attached"`, `"detached"`) and timeout in ms.
   */
  waitFor(options?: { state?: string; timeout?: number }): Promise<void>;
}

/**
 * Type guard that narrows an {@link Element} to a {@link WebElement}.
 * @param el - The element to check.
 */
export function isWeb(el: Element): el is WebElement {
  return el._type === ElementType.WEB;
}

/**
 * Type guard that narrows an {@link Element} to a {@link PlatformElement}.
 * @param el - The element to check.
 */
export function isPlatform(el: Element): el is PlatformElement {
  return el._type === ElementType.PLATFORM;
}
