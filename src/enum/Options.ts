import type { LookupAbortedError } from '../types/errors';

export enum SelectionStrategy {
    INDEX = 'index',
    TEXT = 'text',
    VALUE = 'value',
    ATTRIBUTE = 'attribute',
    RANDOM = 'random',
    ALL = 'all'
}

/**
 * Options every `ElementRepository` getter takes as its trailing argument.
 */
export interface LookupOptions {
  /**
   * Cancels the lookup. Once the signal is aborted, the lookup starts no
   * further driver call (a call already running may finish; its result is
   * dropped) and rejects with a {@link LookupAbortedError} whose `cause` is
   * `signal.reason`. It covers every driver call the lookup makes: the
   * selector queries, the text / attribute / visibility reads of the
   * text, attribute and visible getters, the attach waits, the fallback
   * chain and the sleeps between polls, which wake at once.
   *
   * The signal belongs to the lookup call only: an element the lookup
   * returns does not carry it, so a kept element keeps working after the
   * signal fires. An abort wins over not-found: a non-strict getter
   * rejects rather than returning `null`. Repository and argument errors
   * (an unknown page or element, a missing `index`) are thrown before the
   * signal is looked at; a fatal driver error seen before the abort is
   * thrown as is.
   *
   * For a hard time limit pass `AbortSignal.timeout(ms)`, or
   * `AbortSignal.any([signal, AbortSignal.timeout(ms)])` to combine it with
   * your own. On web, Playwright's waits cannot be cancelled: the lookup
   * rejects at once, and the abandoned wait ends on its own timeout in the
   * background.
   */
  signal?: AbortSignal;
  /**
   * Text lookups only: the platform `TEXT` strategy and `getByText` (other
   * getters ignore it). When `true`, a miss of the narrowed text queries is
   * always confirmed by one full pass over every match, so a
   * `TextNotFoundError` always has `missBasis: 'full-pass'` and a
   * non-strict `getByText` returns `null` only after a full pass. Without
   * it, a narrowed miss over a snapshot confirmed complete is final
   * (`missBasis: 'narrowed'`). Defaults to `false`.
   */
  requireFullPass?: boolean;
}

/**
 * Configuration options for resolving an element. Takes the lookup's
 * `signal` too (see {@link LookupOptions}).
 */
export interface ElementResolutionOptions extends LookupOptions {
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