/** Discriminator for {@link Element} implementations. */
export enum ElementType {
  WEB = 'web',
  PLATFORM = 'platform',
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

  // ── Interaction ──────────────────────────────────────────────

  /** Clicks the element. */
  click(): Promise<void>;

  /**
   * Clears the input and fills it with the given text.
   * @param text - The value to type into the element.
   */
  fill(text: string): Promise<void>;

  /** Clears the element's value. */
  clear(): Promise<void>;

  /** Checks a checkbox or radio button if it is not already checked. */
  check(): Promise<void>;

  /** Unchecks a checkbox if it is currently checked. */
  uncheck(): Promise<void>;

  /** Hovers over the element. */
  hover(): Promise<void>;

  /** Double-clicks the element. */
  doubleClick(): Promise<void>;

  /** Scrolls the element into the visible area of the viewport. */
  scrollIntoView(): Promise<void>;

  /**
   * Types text one character at a time.
   * @param text  - The characters to type.
   * @param delay - Optional millisecond delay between keystrokes.
   */
  pressSequentially(text: string, delay?: number): Promise<void>;

  /**
   * Sets the value of a file input.
   * @param filePath - Absolute or relative path to the file.
   * @throws On platform elements where file input is unsupported.
   */
  setInputFiles(filePath: string): Promise<void>;

  /**
   * Dispatches a DOM event on the element.
   * @param event - The event type to dispatch (e.g. `"change"`).
   * @throws On platform elements where DOM events are unsupported.
   */
  dispatchEvent(event: string): Promise<void>;

  // ── State ────────────────────────────────────────────────────

  /** Returns `true` if the element is visible in the viewport. */
  isVisible(): Promise<boolean>;

  /** Returns `true` if the element is enabled (not disabled). */
  isEnabled(): Promise<boolean>;

  /** Returns `true` if a checkbox or radio button is checked/selected. */
  isChecked(): Promise<boolean>;

  // ── Extraction ───────────────────────────────────────────────

  /** Returns the text content of the element, or `null` if empty. */
  textContent(): Promise<string | null>;

  /**
   * Returns the value of the given HTML attribute, or `null` if absent.
   * @param name - Attribute name.
   */
  getAttribute(name: string): Promise<string | null>;

  /** Returns the current value of an `<input>`, `<textarea>`, or `<select>`. */
  inputValue(): Promise<string>;

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
