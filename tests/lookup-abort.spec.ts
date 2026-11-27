import { test, expect } from '@playwright/test';
import { getEventListeners } from 'events';
import * as root from '../src';
import { ElementRepository, LookupAbortedError, PlatformElement, WebElement, SelectionStrategy, isFatalDriverError } from '../src';
import type { LookupOptions, LookupAbortedErrorInit, ElementResolutionOptions } from '../src';
import { isSessionLostError } from '../src/utils/driverErrors';
import { readPlatformText } from '../src/utils/platformText';
import { settleAll } from '../src/utils/abort';
import { StrategyResolver } from '../src/repo/StrategyResolver';

/**
 * Cancellable lookups: a mock Appium driver whose commands take real time
 * (120 ms per `$$` / `$`, 15 ms per element read), so a lookup can be
 * aborted in the middle and the wire inspected: which commands started
 * after the abort, and which were still running.
 */

interface Call { name: string; start: number; end?: number; afterAbort: boolean }

class Wire {
  readonly calls: Call[] = [];
  signal?: AbortSignal;
  onEnd?: (call: Call) => void;
  constructor(readonly queryMs = 120, readonly readMs = 15) {}

  async cmd<T>(name: string, ms: number, fn: () => T): Promise<T> {
    const call: Call = { name, start: Date.now(), afterAbort: this.signal?.aborted === true };
    this.calls.push(call);
    await new Promise(resolve => setTimeout(resolve, ms));
    call.end = Date.now();
    this.onEnd?.(call);
    return fn();
  }

  inFlight(): Call[] { return this.calls.filter(c => c.end === undefined); }
  startedAfterAbort(): Call[] { return this.calls.filter(c => c.afterAbort); }
}

function rawEl(wire: Wire, i: number, text: string): any {
  return {
    elementId: `e${i}`,
    getText: () => wire.cmd(`getText#${i}`, wire.readMs, () => text),
    getAttribute: (name: string) => wire.cmd(`getAttribute#${i}`, wire.readMs, () => (name === 'resource-id' ? `id/${i}` : null)),
    getTagName: () => wire.cmd(`getTagName#${i}`, wire.readMs, () => 'android.widget.TextView'),
    isDisplayed: () => wire.cmd(`isDisplayed#${i}`, wire.readMs, () => false),
    isExisting: () => wire.cmd(`isExisting#${i}`, wire.readMs, () => true),
    waitForExist: () => wire.cmd(`waitForExist#${i}`, wire.readMs, () => true),
    $$: (sel: string) => wire.cmd(`child$$:${sel}`, wire.queryMs, () => []),
  };
}

/** An Android driver whose every selector matches `texts` (none when `empty`). */
function mockDriver(wire: Wire, texts: string[] = Array.from({ length: 16 }, (_, i) => `Item ${i}`)): any {
  const raws = texts.map((t, i) => rawEl(wire, i, t));
  return {
    capabilities: { platformName: 'Android' },
    $$: (sel: string) => wire.cmd(`$$:${sel}`, wire.queryMs, () => raws),
    $: (sel: string) => wire.cmd(`$:${sel}`, wire.queryMs, () => raws[0] ?? { selector: sel }),
  };
}

const pages = {
  pages: [{
    name: 'List',
    platform: 'android',
    elements: [
      // Not narrowable: every text lookup reads every match.
      { elementName: 'rows', selector: { uiautomator: 'new UiSelector().className("row")' } },
      // Narrowable on Android: the text lookups send a composed XPath.
      { elementName: 'xrows', selector: { xpath: '//row' } },
      {
        elementName: 'chain',
        selector: { uiautomator: 'a', fallback: { uiautomator: 'b', fallback: { uiautomator: 'c' } } },
      },
    ],
  }],
} as any;

function repo(driver: any): ElementRepository {
  return new ElementRepository(driver, pages, { platform: 'android', defaultTimeout: 60_000 });
}

interface Outcome { error: unknown; settledAt: number; abortedAt: number }

/** Starts `run`, aborts after `afterMs`, and reports how the lookup ended. */
async function abortAfter(wire: Wire, afterMs: number, run: (signal: AbortSignal) => Promise<unknown>): Promise<Outcome> {
  const controller = new AbortController();
  wire.signal = controller.signal;
  let abortedAt = 0;
  const timer = setTimeout(() => { abortedAt = Date.now(); controller.abort(); }, afterMs);
  let error: unknown;
  try {
    await run(controller.signal);
    error = new Error('the lookup resolved');
  } catch (err) {
    error = err;
  }
  clearTimeout(timer);
  return { error, settledAt: Date.now(), abortedAt };
}

/** The shared assertions: a typed rejection within one command latency, nothing started after, nothing running. */
async function expectCleanAbort(wire: Wire, outcome: Outcome, elementName = 'rows'): Promise<void> {
  expect(outcome.error).toBeInstanceOf(LookupAbortedError);
  const err = outcome.error as LookupAbortedError;
  expect(err.name).toBe('AbortError');
  expect(err.message).toMatch(new RegExp(`^Lookup of '${elementName}' on 'List' aborted\\. \\(reason: `));
  expect(outcome.abortedAt).toBeGreaterThan(0);
  expect(outcome.settledAt - outcome.abortedAt).toBeLessThanOrEqual(wire.queryMs + 80);
  expect(wire.startedAfterAbort()).toEqual([]);
  await new Promise(resolve => setTimeout(resolve, 50));
  expect(wire.inFlight()).toEqual([]);
}

test.describe('LookupAbortedError', () => {
  test('carries name, cause, fields and the lookup message', () => {
    const reason = new Error('stop');
    const err = new LookupAbortedError({ elementName: 'rows', pageName: 'List', reason });
    expect(err).toBeInstanceOf(LookupAbortedError);
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe('AbortError');
    expect(err.cause).toBe(reason);
    expect(err.reason).toBe(reason);
    expect(err.elementName).toBe('rows');
    expect(err.pageName).toBe('List');
    expect(err.message).toBe(`Lookup of 'rows' on 'List' aborted. (reason: stop)`);
  });

  test('the waitFor message, and no suffix without a reason', () => {
    const err = new LookupAbortedError({ operation: 'waitFor on "~row"', reason: undefined });
    expect(err.message).toBe('waitFor on "~row" aborted.');
    expect(err.operation).toBe('waitFor on "~row"');
    const named = new LookupAbortedError({ operation: 'waitFor on "~row"', reason: new DOMException('This operation was aborted', 'AbortError') });
    expect(named.message).toBe('waitFor on "~row" aborted. (reason: AbortError: This operation was aborted)');
  });

  test('is exported from the package root with its types', () => {
    expect(root.LookupAbortedError).toBe(LookupAbortedError);
    const init: LookupAbortedErrorInit = { reason: 1 };
    const options: LookupOptions = { signal: new AbortController().signal };
    const resolution: ElementResolutionOptions = { strategy: SelectionStrategy.ALL, signal: options.signal };
    expect(init.reason).toBe(1);
    expect(resolution.signal).toBe(options.signal);
  });

  test('is never a fatal or session-lost driver error, whatever its reason says', () => {
    expect(isFatalDriverError(new LookupAbortedError({ reason: new Error('ECONNRESET') }))).toBe(false);
    expect(isSessionLostError(new LookupAbortedError({ reason: new Error('invalid session id') }))).toBe(false);
    expect(isFatalDriverError(new Error('ECONNRESET'))).toBe(true);
  });
});

test.describe('aborting a lookup', () => {
  test('TEXT get with a long timeout: rejects at once, no command after the abort', async () => {
    const wire = new Wire();
    const outcome = await abortAfter(wire, 200, signal =>
      repo(mockDriver(wire)).get('rows', 'List', { strategy: SelectionStrategy.TEXT, value: 'Wanted', timeout: 60_000, signal }));
    await expectCleanAbort(wire, outcome);
  });

  test('a three-node fallback chain: the abort never walks on to the next node', async () => {
    const wire = new Wire();
    const outcome = await abortAfter(wire, 200, signal =>
      repo(mockDriver(wire, [])).get('chain', 'List', { timeout: 60_000, signal }));
    await expectCleanAbort(wire, outcome, 'chain');
    expect(wire.calls.every(c => c.name.endsWith('android=a'))).toBe(true);
  });

  test('a fallback chain aborted during a later node rejects with the abort, not the primary error', async () => {
    const wire = new Wire();
    // Each node's single TEXT pass takes ~360 ms: the abort lands in node b.
    const outcome = await abortAfter(wire, 500, signal =>
      repo(mockDriver(wire)).get('chain', 'List', { strategy: SelectionStrategy.TEXT, value: 'Wanted', timeout: 1, signal }));
    await expectCleanAbort(wire, outcome, 'chain');
    expect(wire.calls.some(c => c.name.endsWith('android=b'))).toBe(true);
    expect(wire.calls.some(c => c.name.endsWith('android=c'))).toBe(false);
  });

  test('ALL strategy and getAll', async () => {
    const wire = new Wire();
    const outcome = await abortAfter(wire, 200, signal =>
      repo(mockDriver(wire, [])).get('rows', 'List', { strategy: SelectionStrategy.ALL, signal }));
    await expectCleanAbort(wire, outcome);

    const wire2 = new Wire();
    const outcome2 = await abortAfter(wire2, 200, signal => repo(mockDriver(wire2, [])).getAll('rows', 'List', { signal }));
    await expectCleanAbort(wire2, outcome2);
  });

  test('ATTRIBUTE strategy and getByAttribute', async () => {
    const wire = new Wire();
    const outcome = await abortAfter(wire, 300, signal =>
      repo(mockDriver(wire)).get('rows', 'List', { strategy: SelectionStrategy.ATTRIBUTE, attribute: 'resource-id', value: 'nope', signal }));
    await expectCleanAbort(wire, outcome);

    const wire2 = new Wire();
    const outcome2 = await abortAfter(wire2, 300, signal =>
      repo(mockDriver(wire2)).getByAttribute('rows', 'List', 'resource-id', 'nope', { signal }));
    await expectCleanAbort(wire2, outcome2);
  });

  test('getByText, full pass and narrowed', async () => {
    const wire = new Wire();
    const outcome = await abortAfter(wire, 300, signal => repo(mockDriver(wire)).getByText('rows', 'List', 'Wanted', false, { signal }));
    await expectCleanAbort(wire, outcome);
    expect(wire.calls.some(c => c.name.startsWith('getText#'))).toBe(true);

    const wire2 = new Wire();
    const outcome2 = await abortAfter(wire2, 300, signal => repo(mockDriver(wire2)).getByText('xrows', 'List', 'Wanted', false, { signal }));
    await expectCleanAbort(wire2, outcome2, 'xrows');
    expect(wire2.calls.some(c => c.name.includes('contains('))).toBe(true);
  });

  test('a narrowed TEXT get', async () => {
    const wire = new Wire();
    const outcome = await abortAfter(wire, 200, signal =>
      repo(mockDriver(wire)).get('xrows', 'List', { strategy: SelectionStrategy.TEXT, value: 'Wanted', timeout: 60_000, signal }));
    await expectCleanAbort(wire, outcome, 'xrows');
  });

  test('getVisible, getByIndex, getRandom and getByRole', async () => {
    const wire = new Wire();
    const outcome = await abortAfter(wire, 300, signal => repo(mockDriver(wire)).getVisible('rows', 'List', false, { signal }));
    await expectCleanAbort(wire, outcome);

    const wire2 = new Wire();
    const outcome2 = await abortAfter(wire2, 100, signal => repo(mockDriver(wire2, [])).getByIndex('rows', 'List', 3, false, { signal }));
    await expectCleanAbort(wire2, outcome2);

    const wire3 = new Wire();
    const outcome3 = await abortAfter(wire3, 200, signal => repo(mockDriver(wire3, [])).getRandom('rows', 'List', false, { signal }));
    await expectCleanAbort(wire3, outcome3);

    const wire4 = new Wire();
    const outcome4 = await abortAfter(wire4, 300, signal => repo(mockDriver(wire4)).getByRole('rows', 'List', 'button', false, { signal }));
    await expectCleanAbort(wire4, outcome4);
  });

  test('an already aborted signal makes no driver call', async () => {
    const wire = new Wire();
    const signal = AbortSignal.abort(new Error('gone'));
    const r = repo(mockDriver(wire));
    const runs: Array<() => Promise<unknown>> = [
      () => r.get('rows', 'List', { signal }),
      () => r.get('rows', 'List', { strategy: SelectionStrategy.TEXT, value: 'Wanted', signal }),
      () => r.get('chain', 'List', { signal }),
      () => r.getAll('rows', 'List', { signal }),
      () => r.getRandom('rows', 'List', false, { signal }),
      () => r.getByText('xrows', 'List', 'Wanted', false, { signal }),
      () => r.getByIndex('rows', 'List', 0, false, { signal }),
      () => r.getVisible('rows', 'List', false, { signal }),
      () => r.getByRole('rows', 'List', 'button', false, { signal }),
      () => r.getByAttribute('rows', 'List', 'resource-id', 'id/1', { signal }),
    ];
    for (const run of runs) {
      const err = await run().then(() => null, e => e);
      expect(err).toBeInstanceOf(LookupAbortedError);
      expect((err as Error).message).toContain('(reason: gone)');
    }
    expect(wire.calls).toEqual([]);
  });

  test('repository and argument errors come before the signal check', async () => {
    const wire = new Wire();
    const signal = AbortSignal.abort();
    const r = repo(mockDriver(wire));
    await expect(r.get('missing', 'List', { signal })).rejects.toThrow(`Element 'missing' not found on page 'List'`);
    await expect(r.getAll('rows', 'Nowhere', { signal })).rejects.toThrow(`page 'Nowhere' has no entry for platform 'android'`);
    await expect(r.get('rows', 'List', { strategy: SelectionStrategy.INDEX, signal })).rejects.toThrow('options.index is required');
    expect(wire.calls).toEqual([]);
  });

  test('an argument error on an entry with a fallback comes before an aborted signal', async () => {
    const wire = new Wire();
    const signal = AbortSignal.abort();
    const r = repo(mockDriver(wire));
    await expect(r.get('chain', 'List', { strategy: SelectionStrategy.INDEX, signal })).rejects.toThrow('options.index is required');
    await expect(r.get('chain', 'List', { strategy: SelectionStrategy.TEXT, signal })).rejects.toThrow('options.value is required');
    await expect(r.get('chain', 'List', { strategy: SelectionStrategy.ATTRIBUTE, value: 'x', signal }))
      .rejects.toThrow('options.attribute is required');
    await expect(r.get('chain', 'List', { strategy: 'bogus' as SelectionStrategy, signal }))
      .rejects.toThrow(`Unhandled selection strategy 'bogus'`);
    expect(wire.calls).toEqual([]);
  });

  test('an argument error on an entry with a fallback, under a live signal, ends as it does without one', async () => {
    const wire = new Wire(1, 1);
    const r = repo(mockDriver(wire));
    const withSignal = await r.get('chain', 'List', { strategy: SelectionStrategy.INDEX, signal: new AbortController().signal }).then(() => null, e => e);
    const without = await r.get('chain', 'List', { strategy: SelectionStrategy.INDEX }).then(() => null, e => e);
    expect(without).toBeInstanceOf(Error);
    expect((withSignal as Error).message).toBe((without as Error).message);
  });

  test('getRandom throws an argument error before an aborted signal; without a signal it stays a non-strict miss', async () => {
    const wire = new Wire();
    const r = repo(mockDriver(wire));
    await expect(r.getRandom('missing', 'List', false, { signal: AbortSignal.abort() }))
      .rejects.toThrow(`Element 'missing' not found on page 'List'`);
    await expect(r.getRandom('missing', 'List', true, { signal: AbortSignal.abort() }))
      .rejects.toThrow(`Element 'missing' not found on page 'List'`);
    const warn = console.warn;
    console.warn = () => {};
    try {
      expect(await r.getRandom('missing', 'List', false)).toBeNull();
      expect(await r.getRandom('missing', 'List', false, { signal: new AbortController().signal })).toBeNull();
    } finally {
      console.warn = warn;
    }
    expect(wire.calls).toEqual([]);
  });

  test('an abort during the sleep between TEXT passes wakes the lookup at once', async () => {
    const wire = new Wire();
    const controller = new AbortController();
    wire.signal = controller.signal;
    let abortedAt = 0;
    wire.onEnd = call => {
      if (call.name.startsWith('getText#') && abortedAt === 0) {
        setTimeout(() => { abortedAt = Date.now(); controller.abort(); }, 30);
      }
    };
    const err = await repo(mockDriver(wire, ['Other']))
      .get('rows', 'List', { strategy: SelectionStrategy.TEXT, value: 'Wanted', timeout: 60_000, signal: controller.signal })
      .then(() => null, e => e);
    const settledAt = Date.now();
    expect(err).toBeInstanceOf(LookupAbortedError);
    // The poll interval is 250 ms; the abort came 30 ms into it.
    expect(settledAt - abortedAt).toBeLessThan(100);
    expect(wire.inFlight()).toEqual([]);
    expect(wire.startedAfterAbort()).toEqual([]);
  });

  test('non-strict getters reject instead of returning null', async () => {
    for (const run of [
      (r: ElementRepository, signal: AbortSignal) => r.getByText('rows', 'List', 'Wanted', false, { signal }),
      (r: ElementRepository, signal: AbortSignal) => r.getVisible('rows', 'List', false, { signal }),
      (r: ElementRepository, signal: AbortSignal) => r.getByAttribute('rows', 'List', 'resource-id', 'nope', { signal }),
    ]) {
      const wire = new Wire(20, 20);
      // Aborted during the reads: the miss would be computed after the abort.
      const outcome = await abortAfter(wire, 90, signal => run(repo(mockDriver(wire, ['a', 'b', 'c'])), signal));
      expect(outcome.error).toBeInstanceOf(LookupAbortedError);
    }
  });

  test('a fatal driver error seen before the abort is thrown as is', async () => {
    const fatal = Object.assign(new Error('session gone'), { name: 'invalid session id' });
    const driver = { capabilities: { platformName: 'Android' }, $$: async () => { throw fatal; }, $: async () => { throw fatal; } };
    const controller = new AbortController();
    const err = await repo(driver)
      .get('rows', 'List', { strategy: SelectionStrategy.TEXT, value: 'Wanted', timeout: 60_000, signal: controller.signal })
      .then(() => null, e => e);
    expect(err).toBe(fatal);
  });

  test('an element returned by a lookup does not carry the signal', async () => {
    const wire = new Wire(5, 5);
    const controller = new AbortController();
    const r = repo(mockDriver(wire, ['Wanted', 'Other']));
    const found = await r.get('rows', 'List', { strategy: SelectionStrategy.TEXT, value: 'Wanted', signal: controller.signal });
    const all = await r.getAll('rows', 'List', { signal: controller.signal });
    const byText = await r.getByText('rows', 'List', 'Other', true, { signal: controller.signal });
    const timed = await r.getAll('rows', 'List', { signal: AbortSignal.timeout(500) });
    controller.abort();
    await new Promise(resolve => setTimeout(resolve, 600));
    expect(await found.textContent()).toBe('Wanted');
    expect(await all[1].textContent()).toBe('Other');
    expect(await byText!.textContent()).toBe('Other');
    expect(await timed[0].textContent()).toBe('Wanted');
    await found.waitFor({ state: 'attached', timeout: 1000 });
  });

  test('no abort listener is left on a long-lived signal', async () => {
    const wire = new Wire(1, 1);
    const controller = new AbortController();
    const r = repo(mockDriver(wire, ['Wanted', 'Other']));
    for (let i = 0; i < 20; i++) {
      await r.get('rows', 'List', { strategy: SelectionStrategy.TEXT, value: 'Wanted', signal: controller.signal });
      await r.getByText('xrows', 'List', 'Other', true, { signal: controller.signal });
      await r.getAll('rows', 'List', { signal: controller.signal });
    }
    // A TEXT lookup that sleeps between passes, then finds its match.
    let passes = 0;
    const driver = {
      capabilities: { platformName: 'Android' },
      $$: async () => (++passes < 3 ? [] : [rawEl(wire, 0, 'Wanted')]),
    };
    await repo(driver).get('rows', 'List', { strategy: SelectionStrategy.TEXT, value: 'Wanted', signal: controller.signal });
    expect(getEventListeners(controller.signal, 'abort')).toHaveLength(0);
  });
});

test.describe('platform text reads under a signal', () => {
  /** An Android row with no text of its own and child texts read with the given latencies. */
  function container(wire: Wire, latencies: number[], failAt?: number): any {
    const children = latencies.map((ms, i) => ({
      getText: () => wire.cmd(`child#${i}`, ms, () => {
        if (i === failAt) throw new Error(`child ${i} failed`);
        return `t${i}`;
      }),
    }));
    return {
      getText: () => wire.cmd('own', 5, () => ''),
      $$: () => wire.cmd('children', 5, () => children),
    };
  }

  test('android: the reads issued together are all waited for, then the abort is thrown', async () => {
    const wire = new Wire();
    const controller = new AbortController();
    wire.signal = controller.signal;
    setTimeout(() => controller.abort(), 40);
    const err = await readPlatformText(container(wire, [15, 60, 100]), 'android', controller.signal).then(() => null, e => e);
    expect(err).toBeInstanceOf(LookupAbortedError);
    expect(wire.inFlight()).toEqual([]);
    expect(wire.startedAfterAbort()).toEqual([]);
  });

  test('android: a failing read is thrown only once its siblings ended', async () => {
    const wire = new Wire();
    const err = await readPlatformText(container(wire, [5, 80], 0), 'android', new AbortController().signal).then(() => null, e => e);
    expect((err as Error).message).toBe('child 0 failed');
    expect(wire.inFlight()).toEqual([]);
    // Without a signal the reads keep Promise.all's behaviour: the failure comes first.
    const plain = new Wire();
    const early = await readPlatformText(container(plain, [5, 80], 0), 'android').then(() => null, e => e);
    expect((early as Error).message).toBe('child 0 failed');
    expect(plain.inFlight().map(c => c.name)).toEqual(['child#1']);
  });

  test('ios: no driver call once aborted; without a signal the text is unchanged', async () => {
    const wire = new Wire(1, 1);
    const cell: any = {
      getTagName: () => wire.cmd('type', 1, () => 'XCUIElementTypeCell'),
      getAttribute: (name: string) => wire.cmd(name, 1, () => (name === 'label' ? 'Wi-Fi' : null)),
    };
    expect(await readPlatformText(cell, 'ios')).toBe('Wi-Fi');
    expect(await readPlatformText(cell, 'ios', new AbortController().signal)).toBe('Wi-Fi');
    const before = wire.calls.length;
    await expect(readPlatformText(cell, 'ios', AbortSignal.abort())).rejects.toBeInstanceOf(LookupAbortedError);
    expect(wire.calls.length).toBe(before);
  });
});

test.describe('waitFor({ signal })', () => {
  test('platform element: rejects with the waitFor message, nothing left running', async () => {
    for (const make of [
      (d: any) => new PlatformElement(d, '~row', undefined, 1000) as any,
      (d: any) => new PlatformElement(d, '~row', undefined, 1000).nth(2) as any,
    ]) {
      const wire = new Wire();
      const outcome = await abortAfter(wire, 200, signal => make(mockDriver(wire, [])).waitFor({ state: 'attached', timeout: 60_000, signal }));
      expect(outcome.error).toBeInstanceOf(LookupAbortedError);
      expect((outcome.error as Error).message).toMatch(/^waitFor on (nth\(2\) of )?"~row" aborted\. \(reason: /);
      expect(outcome.settledAt - outcome.abortedAt).toBeLessThanOrEqual(wire.queryMs + 80);
      expect(wire.startedAfterAbort()).toEqual([]);
      await new Promise(resolve => setTimeout(resolve, 50));
      expect(wire.inFlight()).toEqual([]);
    }
  });

  test('platform element: an already aborted signal makes no call; without one waitFor is unchanged', async () => {
    const wire = new Wire(1, 1);
    const el = new PlatformElement(mockDriver(wire), '~row', undefined, 1000);
    await expect(el.waitFor({ state: 'visible', signal: AbortSignal.abort() })).rejects.toBeInstanceOf(LookupAbortedError);
    expect(wire.calls).toEqual([]);
    const shown = { isDisplayed: async () => true, waitForDisplayed: async () => true, elementId: 'x' };
    let waited = 0;
    const plain = new PlatformElement({ $: async () => ({ ...shown, waitForDisplayed: async () => { waited++; } }) }, '~row');
    await plain.waitFor({ state: 'visible', timeout: 10 });
    expect(waited).toBe(1);
  });

  test('platform element: a signal that never fires still finds the element', async () => {
    const wire = new Wire(1, 1);
    const el = new PlatformElement(mockDriver(wire), '~row', undefined, 1000);
    await el.waitFor({ state: 'attached', timeout: 1000, signal: new AbortController().signal });
    await expect(el.waitFor({ state: 'visible', timeout: 50, signal: new AbortController().signal }))
      .rejects.toThrow('did not become visible within 50 ms');
  });

  test('web element: throwIfAborted, then the Playwright wait raced', async () => {
    let started = 0;
    const locator: any = {
      waitFor: () => { started++; return new Promise(resolve => setTimeout(resolve, 2000)); },
      toString: () => 'locator(#row)',
    };
    const el = new WebElement(locator, '#row');
    await expect(el.waitFor({ state: 'attached', signal: AbortSignal.abort() })).rejects.toBeInstanceOf(LookupAbortedError);
    expect(started).toBe(0);

    const controller = new AbortController();
    const begun = Date.now();
    setTimeout(() => controller.abort(), 100);
    const err = await el.waitFor({ state: 'attached', timeout: 2000, signal: controller.signal }).then(() => null, e => e);
    expect(err).toBeInstanceOf(LookupAbortedError);
    expect((err as Error).message).toMatch(/^waitFor on "#row" aborted\. \(reason: /);
    expect(Date.now() - begun).toBeLessThan(1000);
    expect(started).toBe(1);
    expect(getEventListeners(controller.signal, 'abort')).toHaveLength(0);

    const done = new AbortController();
    const quick = new WebElement({ waitFor: async () => undefined } as any, '#row');
    await quick.waitFor({ signal: done.signal });
    expect(getEventListeners(done.signal, 'abort')).toHaveLength(0);
  });

  test('a web lookup is raced: the attach probe does not hold the abort', async () => {
    const slowLocator: any = {
      first() { return slowLocator; },
      filter() { return slowLocator; },
      waitFor: () => new Promise(resolve => setTimeout(resolve, 1500)),
      all: async () => [],
      count: async () => 0,
    };
    const driver = { locator: () => slowLocator };
    const r = new ElementRepository(driver, { pages: [{ name: 'Web', elements: [{ elementName: 'row', selector: { css: '.row' } }] }] } as any);
    const controller = new AbortController();
    const begun = Date.now();
    setTimeout(() => controller.abort(), 100);
    const err = await r.get('row', 'Web', { strategy: SelectionStrategy.RANDOM, signal: controller.signal }).then(() => null, e => e);
    expect(err).toBeInstanceOf(LookupAbortedError);
    expect((err as Error).message).toMatch(/^Lookup of 'row' on 'Web' aborted\./);
    expect(Date.now() - begun).toBeLessThan(1000);
  });
});

test.describe('settleAll and direct resolver calls', () => {
  test('settleAll throws a fatal driver error seen with the abort as is', async () => {
    const fatal = Object.assign(new Error('session gone'), { name: 'invalid session id' });
    const controller = new AbortController();
    const err = await settleAll<unknown>([
      async () => { throw new Error('not found'); },
      async () => { await new Promise(resolve => setTimeout(resolve, 5)); throw fatal; },
      async () => { await new Promise(resolve => setTimeout(resolve, 10)); controller.abort(); return 1; },
    ], controller.signal).then(() => null, e => e);
    expect(err).toBe(fatal);
  });

  test('settleAll throws the abort over a non-fatal rejection', async () => {
    const controller = new AbortController();
    const err = await settleAll<unknown>([
      async () => { throw new Error('not found'); },
      async () => { await new Promise(resolve => setTimeout(resolve, 5)); controller.abort(); return 1; },
    ], controller.signal).then(() => null, e => e);
    expect(err).toBeInstanceOf(LookupAbortedError);
  });

  test('fromMobileSelector names the element and page in its abort error when given', async () => {
    const wire = new Wire();
    const signal = AbortSignal.abort();
    const named = await StrategyResolver
      .fromMobileSelector(mockDriver(wire), 'android=new UiSelector()', 1000, { signal }, 'android', 'rows', 'List')
      .then(() => null, e => e);
    expect(named).toBeInstanceOf(LookupAbortedError);
    expect((named as Error).message).toMatch(/^Lookup of 'rows' on 'List' aborted\./);
    expect(wire.calls).toEqual([]);
  });
});
