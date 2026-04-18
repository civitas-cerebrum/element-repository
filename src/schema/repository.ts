/** A regex pattern with optional flags, used for text or accessible-name matching. */
export interface RegexPattern {
  regex: string;
  flags?: string;
}

/** A selector value: either a plain string or a regex pattern object. */
export type SelectorValue = string | RegexPattern;

/**
 * Strategy-to-value mapping for a single selector (e.g. `{ css: "button.primary" }`).
 *
 * An optional `fallback` field chains another `Selector` to try when the
 * primary resolves to zero elements. Chains are recursive —
 * `selector.fallback.fallback.fallback` is legal. Used to consolidate
 * per-country / per-brand / per-variant DOM differences into a single entry.
 *
 * @example
 * // CSS primary, role+name fallback
 * { css: "[data-qa='login-button']",
 *   fallback: { role: "button", name: { regex: "Log in|Anmelden", flags: "i" } } }
 */
export interface Selector {
  /** A recursive fallback selector tried when the primary matches zero elements. */
  fallback?: Selector;
  /** Strategy-to-value entries (css, xpath, id, text, role, name, testid, etc.). */
  [key: string]: SelectorValue | Selector | undefined;
}

/** A named element within a page, paired with its locator strategy. */
export interface ElementDefinition {
  elementName: string;
  selector: Selector;
}

/** A frame selector using css or xpath to locate the iframe. */
export interface FrameSelector {
  css?: string;
  xpath?: string;
}

/**
 * A page block in the JSON repository.
 * Groups related elements under a name and an optional platform discriminator.
 *
 * When `frame` is specified, all elements on this page are resolved inside
 * the given iframe. Supports single frames, frame disambiguation via
 * `frameIndex`, and nested frames (array of FrameSelector).
 */
export interface PageObject {
  name: string;
  platform?: string;
  /** Iframe scope — elements on this page live inside this frame. */
  frame?: FrameSelector | FrameSelector[];
  /** Disambiguate when multiple frames match: `'first'`, `'last'`, or a zero-based index. */
  frameIndex?: 'first' | 'last' | number;
  elements: ElementDefinition[];
}

/** Top-level shape of the JSON element repository file. */
export interface PageRepository {
  pages: PageObject[];
}
