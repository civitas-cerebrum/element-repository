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
