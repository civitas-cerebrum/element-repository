export enum SelectionStrategy {
    INDEX = 'index',
    TEXT = 'text',
    VALUE = 'value',
    ATTRIBUTE = 'attribute',
    RANDOM = 'random',
    ALL = 'all'
}

/**
 * Configuration options for resolving an element.
 */
export interface ElementResolutionOptions {
  /** The selection strategy to use. Defaults to FIRST to prevent strict mode errors. */
  strategy?: SelectionStrategy;
  /** The specific text or attribute value to match. */
  value?: string;
  /** The specific attribute name to check (Required if strategy is ATTRIBUTE). */
  attribute?: string;
  /** The zero-based index of the element to select (Required if strategy is INDEX). */
  index?: number;
  /**
   * Per-call override for the attach-wait timeout, in milliseconds. Controls
   * how long the resolver will wait for the element to become attached to the
   * DOM / app tree before returning the lazy wrapper. When omitted, falls back
   * to the repository's configured `defaultTimeout` (15s by default).
   *
   * Also governs the fallback-walk probe: each node of a `fallback` chain is
   * probed with this timeout before walking to the next level.
   *
   * Useful for fast non-throwing visibility probes (`isVisible({ timeout: 500 })`)
   * so a missing element doesn't burn the full 15s default before the caller's
   * own shorter wait gets a chance to run.
   */
  timeout?: number;
}