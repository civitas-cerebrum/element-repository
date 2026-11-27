/**
 * Classification of WebDriver / WebdriverIO errors for polling lookups,
 * shared by the repository's strategy resolver and `PlatformElement`.
 */

/**
 * Error names that say the session is gone. WebdriverIO sets `error.name`
 * to the W3C WebDriver error code (`invalid session id`, ...); the
 * class-style names cover drivers and wrappers that name errors after their
 * class.
 */
const SESSION_LOST_ERROR_NAMES = [
  'invalid session id', 'InvalidSessionIdError',
  'session not created', 'SessionNotCreatedError',
];

/**
 * Messages that say the session or the connection to the driver is gone.
 * The transport errors listed are the only ones treated as fatal; others
 * (`fetch failed`, `socket hang up`, `ETIMEDOUT`, `UND_ERR_*`) are polled
 * through like any unrecognised error, by both rules below.
 */
const SESSION_LOST_ERROR_MESSAGES = [
  /invalid session id/i,
  /session not created/i,
  /session is either terminated or not started/i,
  /ECONNREFUSED/,
  /ECONNRESET|ENOTFOUND|EPIPE/,
  /instrumentation process is not running/i,
];

/**
 * WebDriver / WebdriverIO error names that no amount of polling can fix:
 * the session-lost names, and the ones that say the query is wrong or the
 * driver cannot do it.
 */
const FATAL_DRIVER_ERROR_NAMES = new Set([
  ...SESSION_LOST_ERROR_NAMES,
  'invalid selector', 'InvalidSelectorError',
  'invalid argument', 'unknown command', 'unsupported operation', 'no such window',
]);

/** Well-known messages of the same fatal conditions, for errors without a useful `name`. */
const FATAL_DRIVER_ERROR_MESSAGES = [
  ...SESSION_LOST_ERROR_MESSAGES,
  /invalid selector/i,
  /InvalidSelector(Strategy|Match)/,
  /selector needs to be typeof/,
];

function matches(err: unknown, names: ReadonlySet<string>, messages: RegExp[]): boolean {
  if (!err || typeof err !== 'object') return false;
  const { name, message } = err as { name?: unknown; message?: unknown };
  if (typeof name === 'string' && names.has(name)) return true;
  return typeof message === 'string' && messages.some(re => re.test(message));
}

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
 *
 * A driver's answer that it does not know an attribute name (UiAutomator2
 * names it `unknown command`) never reaches this rule from a platform
 * element: `getAttribute` reads it as a missing attribute (`null`) first.
 */
export function isFatalDriverError(err: unknown): boolean {
  return matches(err, FATAL_DRIVER_ERROR_NAMES, FATAL_DRIVER_ERROR_MESSAGES);
}

const SESSION_LOST_NAME_SET = new Set(SESSION_LOST_ERROR_NAMES);

/**
 * True when `err` says the session or the connection to the driver is gone
 * (invalid session id, session not created, terminated / not started
 * session, UiAutomator2 instrumentation not running, connection refused /
 * reset / host not found / broken pipe): a subset of
 * {@link isFatalDriverError}, built from the same lists, so the two agree on
 * every session and transport error. A narrowed text lookup rethrows only
 * these from its composed query; any other error of that query, including
 * the ones `isFatalDriverError` calls fatal (`invalid selector`, `invalid
 * argument`, `unknown command`, ...), means the driver could not run the
 * composed query, and the lookup reads the full match list instead.
 */
export function isSessionLostError(err: unknown): boolean {
  return matches(err, SESSION_LOST_NAME_SET, SESSION_LOST_ERROR_MESSAGES);
}
