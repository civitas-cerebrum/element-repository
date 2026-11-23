/**
 * Classification of WebDriver / WebdriverIO errors for polling lookups,
 * shared by the repository's strategy resolver and `PlatformElement`.
 */

/**
 * WebDriver / WebdriverIO error names that no amount of polling can fix.
 * WebdriverIO sets `error.name` to the W3C WebDriver error code (`invalid
 * selector`, `invalid session id`, ...); the class-style names cover drivers
 * and wrappers that name errors after their class.
 */
const FATAL_DRIVER_ERROR_NAMES = new Set([
  'invalid selector', 'InvalidSelectorError',
  'invalid session id', 'InvalidSessionIdError',
  'session not created', 'SessionNotCreatedError',
  'invalid argument', 'unknown command', 'unsupported operation', 'no such window',
]);

/** Well-known messages of the same fatal conditions, for errors without a useful `name`. */
const FATAL_DRIVER_ERROR_MESSAGES = [
  /invalid selector/i,
  /invalid session id/i,
  /session not created/i,
  /session is either terminated or not started/i,
  /ECONNREFUSED/,
  /ECONNRESET|ENOTFOUND|EPIPE/,
  /InvalidSelector(Strategy|Match)/,
  /selector needs to be typeof/,
  /instrumentation process is not running/i,
];

/**
 * The rule for driver errors during a polling lookup: an error is FATAL when
 * it says the query itself is wrong (invalid selector, invalid argument, a
 * selector strategy or shape WebdriverIO rejects), the driver cannot do it
 * (unknown command, unsupported operation), or the session, window or
 * connection is gone (invalid session id, session not created, terminated /
 * not started session, no such window, UiAutomator2 instrumentation not
 * running, connection refused / reset / host not found / broken pipe).
 * Fatal errors are rethrown at
 * once. Every other error — `no such element`, `stale element reference`
 * and anything unrecognised — is treated as a transient missing/stale
 * element and polled through until the deadline.
 */
export function isFatalDriverError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const { name, message } = err as { name?: unknown; message?: unknown };
  if (typeof name === 'string' && FATAL_DRIVER_ERROR_NAMES.has(name)) return true;
  return typeof message === 'string' && FATAL_DRIVER_ERROR_MESSAGES.some(re => re.test(message));
}
