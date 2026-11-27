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
    Object.setPrototypeOf(this, new.target.prototype);
  }
}
