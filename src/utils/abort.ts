/**
 * Cancellation helpers for lookups (`LookupOptions.signal`) and
 * `Element.waitFor({ signal })`. Not part of the package's public API.
 *
 * The rule they serve: once the signal is aborted, no further driver call
 * starts. A call already running is not interrupted (WebDriver has no way
 * to cancel it); it may finish and its result is dropped. Only Playwright
 * waits, which can run for their whole timeout, are raced
 * ({@link raceAbort}).
 */
import { LookupAbortedError, LookupAbortedErrorInit } from '../types/errors';

/** What an abort error names: the lookup's entry, or the operation. */
export type AbortContext = Omit<LookupAbortedErrorInit, 'reason'>;

/** The {@link LookupAbortedError} for `signal` (aborted) in `ctx`. */
export function abortError(signal: AbortSignal, ctx: AbortContext = {}): LookupAbortedError {
  return new LookupAbortedError({ ...ctx, reason: signal.reason });
}

/** True for an abort error of this package. */
export function isLookupAborted(err: unknown): err is LookupAbortedError {
  return err instanceof LookupAbortedError;
}

/** Throws a {@link LookupAbortedError} when `signal` is aborted. No-op without a signal. */
export function throwIfAborted(signal: AbortSignal | undefined, ctx?: AbortContext): void {
  if (signal?.aborted) throw abortError(signal, ctx);
}

/** Rethrows `err` when it is an abort error; returns otherwise. */
export function rethrowAbort(err: unknown): void {
  if (isLookupAborted(err)) throw err;
}

/** A `.catch()` handler for a best-effort wait: swallows every error but an abort. */
export function ignoreUnlessAborted(err: unknown): void {
  rethrowAbort(err);
}

/**
 * `err` named for `ctx` when it is an abort error (the same `reason`), or
 * `err` unchanged.
 */
export function relabelAbort(err: unknown, ctx: AbortContext): unknown {
  if (!isLookupAborted(err)) return err;
  if (err.elementName === ctx.elementName && err.pageName === ctx.pageName && err.operation === ctx.operation) return err;
  return new LookupAbortedError({ ...ctx, reason: err.reason });
}

/**
 * Sleeps `ms`, waking at once with a {@link LookupAbortedError} when
 * `signal` is aborted. Its abort listener is removed when the sleep ends
 * normally, so a long-lived signal collects no listeners.
 */
export function abortableSleep(ms: number, signal: AbortSignal | undefined, ctx?: AbortContext): Promise<void> {
  if (!signal) return new Promise(resolve => setTimeout(resolve, ms));
  if (signal.aborted) return Promise.reject(abortError(signal, ctx));
  return new Promise((resolve, reject) => {
    const onAbort = () => { clearTimeout(timer); reject(abortError(signal, ctx)); };
    const timer = setTimeout(() => { signal.removeEventListener('abort', onAbort); resolve(); }, ms);
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

/**
 * `promise`, or a {@link LookupAbortedError} as soon as `signal` is
 * aborted, whichever comes first. For waits that cannot be cancelled and
 * may run long (Playwright's auto-waits) only: the abandoned promise keeps
 * running, its outcome is dropped (a `.catch` is attached so its rejection
 * is not unhandled). The listener is removed when `promise` settles first.
 */
export function raceAbort<T>(promise: Promise<T>, signal: AbortSignal | undefined, ctx?: AbortContext): Promise<T> {
  if (!signal) return promise;
  if (signal.aborted) {
    promise.catch(() => {});
    return Promise.reject(abortError(signal, ctx));
  }
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => { promise.catch(() => {}); reject(abortError(signal, ctx)); };
    signal.addEventListener('abort', onAbort, { once: true });
    promise.then(
      value => { signal.removeEventListener('abort', onAbort); resolve(value); },
      err => { signal.removeEventListener('abort', onAbort); reject(err); },
    );
  });
}

/**
 * Runs `thunks` together, like `Promise.all`. With a signal, every one is
 * waited for (none is left running), the signal is checked, and then the
 * first rejection is rethrown. The signal is checked before they start.
 */
export async function settleAll<T>(thunks: Array<() => Promise<T>>, signal: AbortSignal | undefined): Promise<T[]> {
  if (!signal) return Promise.all(thunks.map(run => run()));
  throwIfAborted(signal);
  const results = await Promise.allSettled(thunks.map(run => run()));
  throwIfAborted(signal);
  const failed = results.find((r): r is PromiseRejectedResult => r.status === 'rejected');
  if (failed) throw failed.reason;
  return results.map(r => (r as PromiseFulfilledResult<T>).value);
}

/**
 * Errors that say the call itself is wrong (an unknown page or element, a
 * missing strategy argument): a lookup throws them as they are, even with
 * an aborted signal, since they come before the signal is looked at.
 */
const ARGUMENT_ERRORS = new WeakSet<object>();

/** An `Error` with `message`, marked as an argument / repository error (see {@link isArgumentError}). */
export function argumentError(message: string): Error {
  const err = new Error(message);
  ARGUMENT_ERRORS.add(err);
  return err;
}

/** True for an error made by {@link argumentError}. */
export function isArgumentError(err: unknown): boolean {
  return !!err && typeof err === 'object' && ARGUMENT_ERRORS.has(err);
}
