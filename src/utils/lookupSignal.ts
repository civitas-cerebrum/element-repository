/**
 * The lookup signal carried by the elements a lookup builds for itself.
 * Not part of the package's public API.
 *
 * A lookup (`ElementRepository` getters, `StrategyResolver`) hands its
 * `signal` to the `WebElement` / `PlatformElement` instances it creates, so
 * their own driver calls (the attach waits, `all()`, the text, attribute and
 * visibility reads) honour it. Elements derived from them inside the lookup
 * (`first()`, `nth()`, `all()`, ...) inherit it. Before an element is
 * returned to the caller the signal is taken off again: a kept element must
 * not fail forever once the lookup's signal fires (an `AbortSignal.timeout`
 * always does, eventually).
 */
import { ElementType } from '../types/Element';
import { isFatalDriverError } from './driverErrors';
import { AbortContext, abortError, isArgumentError, isLookupAborted, relabelAbort, throwIfAborted } from './abort';

/** The internal fields this module reads and writes (private on the element classes). */
interface Carrier {
  _type?: unknown;
  lookupSignal?: AbortSignal;
  parent?: Carrier;
}

function isElement(value: unknown): value is Carrier {
  if (!value || typeof value !== 'object') return false;
  const type = (value as Carrier)._type;
  return type === ElementType.WEB || type === ElementType.PLATFORM;
}

/** Gives `el` the lookup's `signal` (no-op without one) and returns it. */
export function bindLookupSignal<T>(el: T, signal: AbortSignal | undefined): T {
  if (signal && isElement(el)) el.lookupSignal = signal;
  return el;
}

/**
 * Takes the lookup signal off `value`: an element (and the parents it is
 * searched under), or each element of an array. Anything else is returned
 * unchanged.
 */
export function releaseLookupSignal<T>(value: T): T {
  if (Array.isArray(value)) {
    for (const item of value) releaseLookupSignal(item);
    return value;
  }
  for (let el: Carrier | undefined = isElement(value) ? value : undefined; el; el = el.parent) {
    delete el.lookupSignal;
  }
  return value;
}

/**
 * Runs a lookup `body` under `signal` and applies the cancellation rules.
 * Without a signal it is `body()` unchanged. With one:
 *
 * - the result is dropped when the signal was aborted by the time `body`
 *   ended (an abort wins over a found element and over `null`, a
 *   non-strict miss): the lookup rejects with the abort error;
 * - an abort error from inside is named for `ctx`;
 * - any other error after the abort becomes the abort error (an abort wins
 *   over not-found), except a fatal driver error, thrown as is, and an
 *   argument / repository error, which comes before the signal check;
 * - the elements returned have the lookup signal taken off.
 */
export async function runLookup<T>(signal: AbortSignal | undefined, ctx: AbortContext, body: () => Promise<T>): Promise<T> {
  if (!signal) return body();
  let result: T;
  try {
    result = await body();
  } catch (err) {
    if (isLookupAborted(err)) throw relabelAbort(err, ctx);
    if (signal.aborted && !isFatalDriverError(err) && !isArgumentError(err)) throw abortError(signal, ctx);
    throw err;
  }
  throwIfAborted(signal, ctx);
  return releaseLookupSignal(result);
}
