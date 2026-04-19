import type { ElementChain } from './ElementChain';

/** Discriminator for {@link Element} implementations. */
export enum ElementType {
  WEB = 'web',
  PLATFORM = 'platform',
}

/** Optional timeout configuration for element actions. */
export interface ElementActionOptions {
  timeout?: number;
}

/** Direction of a {@link Element.swipe} gesture. */
export type SwipeDirection = 'up' | 'down' | 'left' | 'right';

/**
 * Options for {@link Element.scrollIntoView}. When no direction is given,
 * the sweep is single-direction downward — cheap, predictable, appropriate
 * when the caller knows the target is below. Each named direction does a
 * targeted single-axis, single-direction sweep:
 *
 *   `'down'`  (default) — swipes up to reveal content below.
 *   `'up'`              — swipes down to reveal content above.
 *   `'left'`            — swipes right to reveal content to the left.
 *   `'right'`           — swipes left to reveal content to the right.
 *   `'both'`            — bidirectional vertical (down-then-up); opt-in
 *                         when target position is unknown along the y-axis.
 *
 * There's no bidirectional-horizontal option; if you need one, call
 * scrollIntoView twice with `'left'` then `'right'`.
 */
export interface ScrollIntoViewOptions extends ElementActionOptions {
  direction?: 'down' | 'up' | 'left' | 'right' | 'both';
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

  /** Clicks the element. */
  click(options?: ElementActionOptions): Promise<Element>;

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
   * By default performs a single-direction downward sweep (reveals
   * content below the current viewport). Pass
   * `{ direction: 'both' }` for a bidirectional vertical sweep,
   * `{ direction: 'up' }` for a reverse sweep, or
   * `{ direction: 'horizontal' }` for a left-then-right sweep on
   * horizontal lists / carousels.
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
   * toward the given direction for the requested distance. On web,
   * delegates to the driver's native mouse/touch wheel emulation where
   * available; throws on backends that don't support programmatic
   * swipes.
   *
   * @param direction - 'up' | 'down' | 'left' | 'right'.
   * @param options - Optional distance (default ~50% of viewport dim).
   */
  swipe(direction: SwipeDirection, options?: SwipeOptions): Promise<Element>;

  /**
   * Types text one character at a time.
   * @param text  - The characters to type.
   * @param delay - Optional millisecond delay between keystrokes.
   */
  pressSequentially(text: string, delay?: number, options?: ElementActionOptions): Promise<Element>;

  /**
   * Sets the value of a file input.
   * @param filePath - Absolute or relative path to the file.
   * @throws On platform elements where file input is unsupported.
   */
  setInputFiles(filePath: string, options?: ElementActionOptions): Promise<Element>;

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

  /** Returns the text content of the element, or `null` if empty. */
  textContent(): Promise<string | null>;

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
export function isWeb(el: Element): boolean {
  return el._type === ElementType.WEB;
}

/**
 * Type guard that narrows an {@link Element} to a {@link PlatformElement}.
 * @param el - The element to check.
 */
export function isPlatform(el: Element): boolean {
  return el._type === ElementType.PLATFORM;
}
