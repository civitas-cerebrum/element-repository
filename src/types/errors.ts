import { Platform } from '../enum/Platform';

/**
 * Thrown when an operation exists in the API but cannot be performed on the
 * given platform (for example a touch-only gesture on `web`).
 *
 * Message: `"<method>" is not supported on platform "<platform>".`
 *
 * This is the single definition of the class; other packages re-export it so
 * that `instanceof` checks work across package boundaries.
 */
export class PlatformNotSupportedError extends Error {
  /** The method or step that is not supported. */
  readonly method: string;
  /** The platform it was called on. */
  readonly platform: Platform;

  /**
   * @param method The method or step name, e.g. `'pinch'`.
   * @param platform The platform it was called on, e.g. `'web'`.
   */
  constructor(method: string, platform: Platform) {
    super(`"${method}" is not supported on platform "${platform}".`);
    this.name = 'PlatformNotSupportedError';
    this.method = method;
    this.platform = platform;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/** `<name>: <message>` for a named driver error, the bare message for a plain `Error`. */
export function describeDriverError(err: unknown): string {
  if (err && typeof err === 'object') {
    const { name, message } = err as { name?: unknown; message?: unknown };
    const msg = typeof message === 'string' ? message : String(err);
    return typeof name === 'string' && name && name !== 'Error' ? `${name}: ${msg}` : msg;
  }
  return String(err);
}

/** What an {@link ElementNotFoundError} reports. */
export interface ElementNotFoundErrorInit {
  /** The element name of the repository entry. */
  elementName: string;
  /** The page name of the repository entry. */
  pageName: string;
  /** The selection strategy whose lookup found nothing, e.g. `'random'` or `'attribute'`. */
  strategy: 'random' | 'attribute' | (string & {});
  /** The last non-fatal driver error of the lookup, if one happened in any poll. Becomes the `cause`. */
  lastDriverError?: unknown;
  /**
   * `true` when the final poll ran without a driver error, so the miss is a
   * real "nothing matched". Defaults to `lastDriverError === undefined`.
   */
  cleanMiss?: boolean;
  /**
   * The message before the driver-error suffix. Defaults to
   * `No elements found for '<elementName>' on '<pageName>'`.
   */
  message?: string;
}

/**
 * Thrown when a `RANDOM` or `ATTRIBUTE` lookup finds no element (the
 * selection strategies, and `ElementRepository.getRandom(..., strict = true)`).
 *
 * Message: `No elements found for '<elementName>' on '<pageName>'` when no
 * element appeared within the timeout (the `ATTRIBUTE` filter miss keeps its
 * own text: `Element '<elementName>' on '<pageName>' with attribute [<attr>]
 * matching "<value>" not found.`), followed by ` (last driver error:
 * <name>: <message>)` when a non-fatal driver error happened during the
 * lookup (`lastDriverError`, also the `cause`).
 *
 * `cleanMiss` is `true` when the final poll ran without a driver error and
 * `false` when the final poll hit one; `lastDriverError` may be set while
 * `cleanMiss` is `true`, when only an earlier poll failed. A fatal driver
 * error (`isFatalDriverError`) is never wrapped in this error: it is thrown
 * as it is. On web, no error of the wait other than Playwright's timeout is
 * wrapped either (a web miss is always clean).
 *
 * `TextNotFoundError` (the `TEXT` strategy, `getByText`) is a separate class
 * and does not extend this one.
 *
 * This is the single definition of the class; other packages re-export it so
 * that `instanceof` checks work across package boundaries.
 */
export class ElementNotFoundError extends Error {
  /** The element name of the repository entry. */
  readonly elementName: string;
  /** The page name of the repository entry. */
  readonly pageName: string;
  /** The selection strategy whose lookup found nothing. */
  readonly strategy: string;
  /** `true` when the final poll ran without a driver error. */
  readonly cleanMiss: boolean;
  /** The last non-fatal driver error of the lookup, if any (also the `cause`). */
  readonly lastDriverError?: unknown;

  /** @param init The entry, the strategy and the driver-error state of the lookup. */
  constructor(init: ElementNotFoundErrorInit) {
    const { elementName, pageName, lastDriverError } = init;
    const base = init.message ?? `No elements found for '${elementName}' on '${pageName}'`;
    const suffix = lastDriverError === undefined ? '' : ` (last driver error: ${describeDriverError(lastDriverError)})`;
    super(`${base}${suffix}`, lastDriverError === undefined ? undefined : { cause: lastDriverError });
    this.name = 'ElementNotFoundError';
    this.elementName = elementName;
    this.pageName = pageName;
    this.strategy = init.strategy;
    if (lastDriverError !== undefined) this.lastDriverError = lastDriverError;
    this.cleanMiss = init.cleanMiss ?? lastDriverError === undefined;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/** What a {@link TextNotFoundError} reports. */
export interface TextNotFoundErrorInit {
  /** The element name of the repository entry. */
  elementName: string;
  /** The page name of the repository entry. */
  pageName: string;
  /** The text that was looked for (as the caller passed it). */
  text: string;
  /** The last non-fatal driver error of the lookup, if one happened in any pass. */
  lastDriverError?: unknown;
  /**
   * `true` when the final pass ran without a driver error, so the miss is a
   * real "no element has this text". Defaults to `lastDriverError === undefined`.
   */
  cleanMiss?: boolean;
  /**
   * What established the miss: `'full-pass'` (every match of the selector
   * was compared) or `'narrowed'` (narrowed queries over a driver snapshot
   * confirmed complete). Defaults to `'full-pass'`.
   */
  missBasis?: 'full-pass' | 'narrowed';
  /**
   * Whether the driver's snapshot was cut off at `snapshotMaxDepth` where
   * it could hide a match: `true`, the depth query found the cut-off level
   * and the lookup's queries ran on that snapshot; `false`, the snapshot was
   * confirmed complete, or the full pass's find does not read it; absent,
   * not checked. Left out by default.
   */
  snapshotTruncated?: boolean;
}

/**
 * Thrown when a lookup by text finds no element: the platform `TEXT`
 * selection strategy and `ElementRepository.getByText(..., strict = true)`.
 *
 * Message: `Element '<elementName>' on '<pageName>' with text "<text>" not found.`,
 * followed by ` (last driver error: <name>: <message>)` when a non-fatal
 * driver error happened during the lookup (`lastDriverError`).
 *
 * `cleanMiss` tells a real miss from one that may come from a transient
 * driver error: `true` when the final pass read every candidate without a
 * driver error, `false` when the final pass hit one. `lastDriverError` may be
 * set while `cleanMiss` is `true`, when only an earlier pass failed.
 *
 * `missBasis` says what established the miss: `'full-pass'`, every match of
 * the selector was compared; `'narrowed'`, only the hits of the narrowed
 * text queries were, over a driver snapshot confirmed not cut off at
 * `snapshotMaxDepth` (see the README's absence guarantee).
 *
 * The miss means the rule matched nothing among the elements the driver's
 * snapshot holds. `snapshotTruncated` is `true` when that snapshot was cut
 * off at `snapshotMaxDepth` and the miss was established on it (any iOS
 * selector; an Android XPath): a match below the cut-off can be missed even
 * by the full pass (raise `appium:snapshotMaxDepth`). `false` when the
 * snapshot was confirmed complete or the full pass's find does not read it;
 * absent when not checked. Proven absence is
 * `cleanMiss && snapshotTruncated !== true`; a full pass alone is not proof.
 * `requireFullPass: true` (see `LookupOptions`) forces a full pass behind
 * every miss and still reports `snapshotTruncated`.
 *
 * This is the single definition of the class; other packages re-export it so
 * that `instanceof` checks work across package boundaries.
 */
export class TextNotFoundError extends Error {
  /** The element name of the repository entry. */
  readonly elementName: string;
  /** The page name of the repository entry. */
  readonly pageName: string;
  /** The text that was looked for. */
  readonly text: string;
  /** The last non-fatal driver error of the lookup, if any. */
  readonly lastDriverError?: unknown;
  /** `true` when the final pass ran without a driver error. */
  readonly cleanMiss: boolean;
  /** What established the miss: a full pass, or narrowed queries over a snapshot confirmed complete. */
  readonly missBasis: 'full-pass' | 'narrowed';
  /**
   * `true`: the snapshot the miss was established on was cut off at
   * `snapshotMaxDepth`, so a match below the cut-off can be missed;
   * `false`: the miss is not affected by a cut-off; absent: not checked.
   */
  readonly snapshotTruncated?: boolean;

  /** @param init The entry, the text and the driver-error state of the lookup. */
  constructor(init: TextNotFoundErrorInit) {
    const { elementName, pageName, text, lastDriverError } = init;
    const suffix = lastDriverError === undefined ? '' : ` (last driver error: ${describeDriverError(lastDriverError)})`;
    super(`Element '${elementName}' on '${pageName}' with text "${text}" not found.${suffix}`);
    this.name = 'TextNotFoundError';
    this.elementName = elementName;
    this.pageName = pageName;
    this.text = text;
    if (lastDriverError !== undefined) this.lastDriverError = lastDriverError;
    this.cleanMiss = init.cleanMiss ?? lastDriverError === undefined;
    this.missBasis = init.missBasis ?? 'full-pass';
    if (init.snapshotTruncated !== undefined) this.snapshotTruncated = init.snapshotTruncated;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/** What a {@link LookupAbortedError} reports. */
export interface LookupAbortedErrorInit {
  /** The element name of the repository entry, for a repository lookup. */
  elementName?: string;
  /** The page name of the repository entry, for a repository lookup. */
  pageName?: string;
  /**
   * What was aborted when it is not a repository lookup, as the message
   * names it, e.g. `waitFor on "~row"`.
   */
  operation?: string;
  /** Why it was aborted: the signal's `reason`. Becomes the error's `cause`. */
  reason: unknown;
}

/**
 * Thrown when a lookup's `signal` (see `LookupOptions`) or the `signal` of
 * `Element.waitFor` is aborted. Its `name` is `'AbortError'`, like the
 * platform's own abort errors, and its `cause` is the signal's `reason`.
 *
 * Messages:
 * - a repository lookup: `Lookup of '<elementName>' on '<pageName>' aborted.`
 * - `waitFor`: `waitFor on <element> aborted.` (`<element>` as the
 *   element's errors name it, e.g. `"~row"` or `nth(2) of "~row"`)
 *
 * followed by ` (reason: <name>: <message>)` when a reason was given.
 *
 * It is never a fatal driver error (`isFatalDriverError` is `false` for it,
 * whatever its reason says), never kept as a `lastDriverError` and never
 * retried.
 *
 * This is the single definition of the class; other packages re-export it so
 * that `instanceof` checks work across package boundaries.
 */
export class LookupAbortedError extends Error {
  /** The element name of the repository entry, for a repository lookup. */
  readonly elementName?: string;
  /** The page name of the repository entry, for a repository lookup. */
  readonly pageName?: string;
  /** What was aborted when it is not a repository lookup. */
  readonly operation?: string;
  /** The signal's `reason` (also the `cause`). */
  readonly reason: unknown;

  /** @param init What was aborted, and why. */
  constructor(init: LookupAbortedErrorInit) {
    const { elementName, pageName, operation, reason } = init;
    const what = elementName !== undefined || pageName !== undefined
      ? `Lookup of '${elementName ?? ''}' on '${pageName ?? ''}'`
      : operation ?? 'Lookup';
    const suffix = reason === undefined ? '' : ` (reason: ${describeDriverError(reason)})`;
    super(`${what} aborted.${suffix}`, { cause: reason });
    this.name = 'AbortError';
    if (elementName !== undefined) this.elementName = elementName;
    if (pageName !== undefined) this.pageName = pageName;
    if (operation !== undefined) this.operation = operation;
    this.reason = reason;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}
