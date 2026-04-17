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

/**
 * Platform-agnostic element abstraction.
 *
 * Provides a unified API for interacting with UI elements regardless of
 * whether the underlying driver is Playwright (web) or WebDriverIO (mobile/desktop).
 */
export interface Element {
  /** Discriminator indicating the concrete implementation type. */
  readonly _type: ElementType;

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
   * await element.action().verifyPresence().verifyText('Submit')
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

  /** Scrolls the element into the visible area of the viewport. */
  scrollIntoView(options?: ElementActionOptions): Promise<Element>;

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
   * Returns the element's attributes as a plain object.
   * On web, iterates the DOM `attributes` collection.
   * On platform elements, returns the standard Appium attribute set
   * (`text`, `content-desc`, `resource-id`, `class`, `enabled`, `displayed`,
   * `bounds`) — keys absent on a given platform are omitted.
   */
  getAllAttributes(): Promise<Record<string, string>>;

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
