import { test, expect } from '@playwright/test';
import * as root from '../src';
import { ElementNotFoundError, ElementRepository, SelectionStrategy, TextNotFoundError, isFatalDriverError } from '../src';
import { ElementNotFoundError as TypesElementNotFoundError } from '../src/types';
import { StrategyResolver } from '../src/repo/StrategyResolver';

/**
 * RANDOM / ATTRIBUTE no-matches are typed, and a driver error is never read
 * as "nothing matched": a fatal one is thrown as is, at once; a transient one
 * is polled through and, when it lasts to the deadline, named on the miss.
 */

function namedError(name: string, message: string): Error {
  const e = new Error(message);
  e.name = name;
  return e;
}

const fatal = () => namedError('invalid session id', 'A session is either terminated or not started');
const transient = () => namedError('unknown error', 'boom');

type Mode = 'ok' | 'once' | 'always';

interface Behaviour {
  /** What `$$` does: answer, throw `error` on the first call only, or on every call. */
  $$?: Mode;
  /** What `$` does (the attach probe of the lazy paths). */
  $?: Mode;
  error?: () => Error;
  /** Raw elements `$$` answers with. */
  rows?: number;
}

function raw(i: number): any {
  return {
    elementId: `e${i}`,
    selector: `row${i}`,
    getText: async () => `Row ${i}`,
    getTagName: async () => 'android.widget.TextView',
    getAttribute: async (name: string) => (name === 'resource-id' ? `id/${i}` : null),
    isDisplayed: async () => true,
    isExisting: async () => true,
    waitForExist: async () => true,
    waitForDisplayed: async () => true,
  };
}

function driver(b: Behaviour = {}): { driver: any; calls: string[] } {
  const calls: string[] = [];
  const make = b.error ?? transient;
  const rows = Array.from({ length: b.rows ?? 3 }, (_, i) => raw(i));
  const thrower = (mode: Mode | undefined) => {
    let thrown = false;
    return () => {
      if (mode === 'always' || (mode === 'once' && !thrown)) { thrown = true; throw make(); }
    };
  };
  const $$gate = thrower(b.$$);
  const $gate = thrower(b.$);
  const d: any = {
    capabilities: { platformName: 'Android' },
    $$: async (sel: string) => { calls.push(`$$:${sel}`); $$gate(); return rows; },
    $: async (sel: string) => { calls.push(`$:${sel}`); $gate(); return rows[0] ?? { selector: sel, waitForExist: async () => { throw new Error('still not existing'); } }; },
  };
  return { driver: d, calls };
}

const pages = {
  pages: [{
    name: 'List',
    platform: 'android',
    elements: [
      { elementName: 'rows', selector: { accessibilityId: 'row' } },
      { elementName: 'chain', selector: { accessibilityId: 'a', fallback: { accessibilityId: 'b' } } },
    ],
  }],
} as any;

function repo(d: any, timeout = 600): ElementRepository {
  return new ElementRepository(d, pages, { platform: 'android', defaultTimeout: timeout });
}

const random = { strategy: SelectionStrategy.RANDOM } as const;
const attribute = { strategy: SelectionStrategy.ATTRIBUTE, attribute: 'resource-id', value: 'id/1' } as const;

async function settle<T>(p: Promise<T>): Promise<{ value?: T; error?: unknown; ms: number }> {
  const start = Date.now();
  try { return { value: await p, ms: Date.now() - start }; } catch (error) { return { error, ms: Date.now() - start }; }
}

test.describe('ElementNotFoundError', () => {
  test('carries its fields and the canonical message; exported from the root and types', () => {
    const err = new ElementNotFoundError({ elementName: 'rows', pageName: 'List', strategy: 'random' });
    expect(err.message).toBe(`No elements found for 'rows' on 'List'`);
    expect(err.name).toBe('ElementNotFoundError');
    expect(err.elementName).toBe('rows');
    expect(err.pageName).toBe('List');
    expect(err.strategy).toBe('random');
    expect(err.cleanMiss).toBe(true);
    expect(err.lastDriverError).toBeUndefined();
    expect(err.cause).toBeUndefined();
    expect(err).toBeInstanceOf(Error);
    expect(root.ElementNotFoundError).toBe(ElementNotFoundError);
    expect(TypesElementNotFoundError).toBe(ElementNotFoundError);
  });

  test('a driver error is the suffix, the cause and lastDriverError; cleanMiss defaults to false', () => {
    const cause = transient();
    const err = new ElementNotFoundError({ elementName: 'rows', pageName: 'List', strategy: 'attribute', lastDriverError: cause });
    expect(err.message).toBe(`No elements found for 'rows' on 'List' (last driver error: unknown error: boom)`);
    expect(err.lastDriverError).toBe(cause);
    expect(err.cause).toBe(cause);
    expect(err.cleanMiss).toBe(false);
    const plain = new ElementNotFoundError({ elementName: 'rows', pageName: 'List', strategy: 'random', lastDriverError: new Error('flaky'), cleanMiss: true });
    expect(plain.message).toBe(`No elements found for 'rows' on 'List' (last driver error: flaky)`);
    expect(plain.cleanMiss).toBe(true);
  });

  test('is not a fatal driver error, and TextNotFoundError is unchanged', () => {
    expect(isFatalDriverError(new ElementNotFoundError({ elementName: 'a', pageName: 'b', strategy: 'random' }))).toBe(false);
    const text = new TextNotFoundError({ elementName: 'a', pageName: 'b', text: 't' });
    expect(text).toBeInstanceOf(TextNotFoundError);
    expect(text.name).toBe('TextNotFoundError');
  });
});

for (const [label, options] of [['RANDOM', random], ['ATTRIBUTE', attribute]] as const) {
  const strategy = label.toLowerCase();

  test.describe(`${label} strategy on a platform page`, () => {
    test('a fatal driver error on every query is thrown as is, at once', async () => {
      const err = fatal();
      const { driver: d, calls } = driver({ $$: 'always', error: () => err });
      const out = await settle(repo(d, 5_000).get('rows', 'List', options));
      expect(out.error).toBe(err);
      expect(out.ms).toBeLessThan(1_000);
      expect(calls.filter(c => c.startsWith('$$'))).toHaveLength(1);
    });

    test('a fatal driver error on the first query only is still thrown at once', async () => {
      const err = fatal();
      const { driver: d } = driver({ $$: 'once', error: () => err });
      const out = await settle(repo(d, 5_000).get('rows', 'List', options));
      expect(out.error).toBe(err);
      expect(out.ms).toBeLessThan(1_000);
    });

    test('a transient driver error once is polled through', async () => {
      const { driver: d, calls } = driver({ $$: 'once' });
      const out = await settle(repo(d, 5_000).get('rows', 'List', options));
      expect(out.error).toBeUndefined();
      expect(out.value).toBeDefined();
      if (label === 'ATTRIBUTE') expect(await out.value!.getAttribute('resource-id')).toBe('id/1');
      expect(calls.filter(c => c.startsWith('$$')).length).toBeGreaterThanOrEqual(2);
    });

    test('a transient driver error to the deadline is a typed miss naming it', async () => {
      const { driver: d, calls } = driver({ $$: 'always' });
      const out = await settle(repo(d, 600).get('rows', 'List', options));
      const err = out.error as ElementNotFoundError;
      expect(err).toBeInstanceOf(ElementNotFoundError);
      expect(err.message).toBe(`No elements found for 'rows' on 'List' (last driver error: unknown error: boom)`);
      expect(err.cleanMiss).toBe(false);
      expect(err.strategy).toBe(strategy);
      expect((err.lastDriverError as Error).name).toBe('unknown error');
      expect(err.cause).toBe(err.lastDriverError);
      expect(out.ms).toBeGreaterThanOrEqual(550);
      expect(calls.filter(c => c.startsWith('$$')).length).toBeGreaterThanOrEqual(2);
    });

    test('no match within the timeout is a clean typed miss with the canonical message', async () => {
      const { driver: d } = driver({ rows: 0 });
      const out = await settle(repo(d, 400).get('rows', 'List', options));
      const err = out.error as ElementNotFoundError;
      expect(err).toBeInstanceOf(ElementNotFoundError);
      expect(err.message).toBe(`No elements found for 'rows' on 'List'`);
      expect(err.cleanMiss).toBe(true);
      expect(err.lastDriverError).toBeUndefined();
      expect(err.strategy).toBe(strategy);
      expect(err.elementName).toBe('rows');
      expect(err.pageName).toBe('List');
    });

    test('a transient error early and a clean final poll: clean miss that still names the error', async () => {
      // Throws on the first `$$`, then answers with no rows.
      let n = 0;
      const d: any = {
        capabilities: { platformName: 'Android' },
        $$: async () => { if (n++ === 0) throw transient(); return []; },
        $: async () => raw(0),
      };
      const err = (await settle(repo(d, 500).get('rows', 'List', options))).error as ElementNotFoundError;
      expect(err).toBeInstanceOf(ElementNotFoundError);
      expect(err.cleanMiss).toBe(true);
      expect(err.message).toBe(`No elements found for 'rows' on 'List' (last driver error: unknown error: boom)`);
    });
  });
}

test.describe('ATTRIBUTE filter miss', () => {
  test('is a typed clean miss with the attribute message unchanged', async () => {
    const { driver: d } = driver();
    const err = (await settle(repo(d).get('rows', 'List', { ...attribute, value: 'zulu' }))).error as ElementNotFoundError;
    expect(err).toBeInstanceOf(ElementNotFoundError);
    expect(err.message).toBe(`Element 'rows' on 'List' with attribute [resource-id] matching "zulu" not found.`);
    expect(err.cleanMiss).toBe(true);
    expect(err.strategy).toBe('attribute');
  });
});

test.describe('getRandom', () => {
  test('a fatal driver error is thrown as is, strict or not', async () => {
    for (const strict of [true, false]) {
      const err = fatal();
      const { driver: d } = driver({ $$: 'always', error: () => err });
      const out = await settle(repo(d, 5_000).getRandom('rows', 'List', strict));
      expect(out.error).toBe(err);
      expect(out.ms).toBeLessThan(1_000);
    }
  });

  test('strict: a lasting transient error is the typed miss naming it', async () => {
    const { driver: d } = driver({ $$: 'always' });
    const err = (await settle(repo(d).getRandom('rows', 'List', true))).error as ElementNotFoundError;
    expect(err).toBeInstanceOf(ElementNotFoundError);
    expect(err.cleanMiss).toBe(false);
    expect(err.message).toBe(`No elements found for 'rows' on 'List' (last driver error: unknown error: boom)`);
  });

  test('strict: a clean miss keeps the canonical message, now typed', async () => {
    const { driver: d } = driver({ rows: 0 });
    const err = (await settle(repo(d, 300).getRandom('rows', 'List', true))).error as ElementNotFoundError;
    expect(err).toBeInstanceOf(ElementNotFoundError);
    expect(err.message).toBe(`No elements found for 'rows' on 'List'`);
    expect(err.cleanMiss).toBe(true);
  });

  test('non-strict: a miss (clean or not) warns with the miss message and returns null', async () => {
    const warn = console.warn;
    const warned: string[] = [];
    console.warn = (m: string) => { warned.push(m); };
    try {
      expect(await repo(driver({ rows: 0 }).driver, 300).getRandom('rows', 'List')).toBeNull();
      expect(await repo(driver({ $$: 'always' }).driver, 300).getRandom('rows', 'List')).toBeNull();
    } finally {
      console.warn = warn;
    }
    expect(warned).toEqual([
      `No elements found for 'rows' on 'List'`,
      `No elements found for 'rows' on 'List' (last driver error: unknown error: boom)`,
    ]);
  });

  test('a transient error once is polled through', async () => {
    const { driver: d } = driver({ $$: 'once' });
    expect(await repo(d, 5_000).getRandom('rows', 'List', true)).not.toBeNull();
  });
});

test.describe('the other paths: a fatal driver error is never a miss', () => {
  const err = fatal();
  const fatal$$ = () => driver({ $$: 'always', error: () => err }).driver;
  const fatal$ = () => driver({ $: 'always', error: () => err }).driver;

  test('INDEX: a driver error is thrown as is, not as out of bounds', async () => {
    expect((await settle(repo(fatal$$()).get('rows', 'List', { strategy: SelectionStrategy.INDEX, index: 1 }))).error).toBe(err);
    const t = transient();
    const d = driver({ $$: 'always', error: () => t }).driver;
    expect((await settle(repo(d).get('rows', 'List', { strategy: SelectionStrategy.INDEX, index: 1 }))).error).toBe(t);
  });

  test('getVisible, getByIndex, getByAttribute, getByRole, getAll: a fatal query error is thrown as is', async () => {
    for (const run of [
      (r: ElementRepository) => r.getVisible('rows', 'List', false),
      (r: ElementRepository) => r.getByIndex('rows', 'List', 0, false),
      (r: ElementRepository) => r.getByAttribute('rows', 'List', 'resource-id', 'id/1'),
      (r: ElementRepository) => r.getByRole('rows', 'List', 'button'),
      (r: ElementRepository) => r.getAll('rows', 'List'),
    ]) {
      expect((await settle(run(repo(fatal$$())))).error).toBe(err);
      expect((await settle(run(repo(fatal$())))).error).toBe(err);
    }
  });

  test('ALL and the default lookup: a fatal error of the attach probe is thrown, not swallowed', async () => {
    expect((await settle(repo(fatal$()).get('rows', 'List', { strategy: SelectionStrategy.ALL }))).error).toBe(err);
    expect((await settle(repo(fatal$()).get('rows', 'List'))).error).toBe(err);
    // A transient probe error stays best-effort: the lazy element is returned.
    const d = driver({ $: 'always' }).driver;
    expect((await settle(repo(d).get('rows', 'List', { strategy: SelectionStrategy.ALL }))).error).toBeUndefined();
    expect((await settle(repo(d).get('rows', 'List'))).error).toBeUndefined();
  });

  test('fromMobileSelector: a fatal error of the attach probe is thrown', async () => {
    const out = await settle(StrategyResolver.fromMobileSelector(fatal$(), 'android=new UiSelector()', 300));
    expect(out.error).toBe(err);
    const all = await settle(StrategyResolver.fromMobileSelector(fatal$(), 'android=new UiSelector()', 300, { strategy: SelectionStrategy.ALL }));
    expect(all.error).toBe(err);
    const ok = await settle(StrategyResolver.fromMobileSelector(driver({ $: 'always' }).driver, 'android=new UiSelector()', 300));
    expect(ok.error).toBeUndefined();
  });

  test('a fallback chain: a lost session is thrown at once, the fallback is not walked', async () => {
    const { driver: d, calls } = driver({ $: 'always', $$: 'always', error: () => err });
    const out = await settle(repo(d, 5_000).get('chain', 'List'));
    expect(out.error).toBe(err);
    expect(calls.some(c => c.endsWith('~b'))).toBe(false);
  });

  test('a fallback chain: a lost session in the fallback walk is thrown, not the primary miss', async () => {
    const d: any = {
      capabilities: { platformName: 'Android' },
      $$: async (sel: string) => { if (sel.endsWith('~b')) throw err; return []; },
      $: async (sel: string) => {
        if (sel.endsWith('~b')) throw err;
        return { selector: sel, waitForExist: async () => { throw new Error('still not existing'); } };
      },
    };
    const out = await settle(repo(d, 300).get('chain', 'List', random));
    expect(out.error).toBe(err);
  });
});

// ── Web paths ────────────────────────────────────────────────────────

const webPages = { pages: [{ name: 'Web', elements: [{ elementName: 'btn', selector: { css: 'button' } }] }] } as any;

function webPage(waitFor: (opts: any) => Promise<void>, count = 2): { page: any; waits: any[] } {
  const waits: any[] = [];
  const child = (i: number): any => {
    const loc: any = {
      getAttribute: async (name: string) => (name === 'data-id' ? `id${i}` : null),
      waitFor: async () => {}, first: () => loc, all: async () => [loc],
    };
    return loc;
  };
  const base: any = {
    first: () => base,
    filter: () => base,
    all: async () => Array.from({ length: count }, (_, i) => child(i)),
    waitFor: async (opts: any) => { waits.push(opts); return waitFor(opts); },
  };
  return { page: { locator: () => base }, waits };
}

const webRandom = { strategy: SelectionStrategy.RANDOM } as const;
const webAttribute = { strategy: SelectionStrategy.ATTRIBUTE, attribute: 'data-id', value: 'id1' } as const;

for (const [label, options] of [['RANDOM', webRandom], ['ATTRIBUTE', webAttribute]] as const) {
  test.describe(`${label} strategy on a web page`, () => {
    test('a Playwright timeout is the clean typed miss with the canonical message', async () => {
      const timeout = Object.assign(new Error('locator.waitFor: Timeout 300ms exceeded.'), { name: 'TimeoutError' });
      const { page } = webPage(async () => { throw timeout; });
      const err = (await settle(new ElementRepository(page, webPages, 300).get('btn', 'Web', options))).error as ElementNotFoundError;
      expect(err).toBeInstanceOf(ElementNotFoundError);
      expect(err.message).toBe(`No elements found for 'btn' on 'Web'`);
      expect(err.cleanMiss).toBe(true);
    });

    test('a fatal error of the wait is thrown as is', async () => {
      const e = fatal();
      const { page } = webPage(async () => { throw e; });
      const out = await settle(new ElementRepository(page, webPages, 5_000).get('btn', 'Web', options));
      expect(out.error).toBe(e);
      expect(out.ms).toBeLessThan(1_000);
    });

    // Playwright's waitFor retries inside itself; what escapes it other than
    // its timeout is permanent (closed page, unparsable selector, ...).
    for (const message of [
      'locator.waitFor: Target page, context or browser has been closed',
      'locator.waitFor: Unexpected token "[" while parsing css selector "button[[[". Did you mean to CSS.escape it?',
      'locator.waitFor: Unknown engine "nope" while parsing selector nope=x',
      `locator.waitFor: SyntaxError: Failed to execute 'evaluate' on 'Document': The string '//[' is not a valid XPath expression.`,
      'boom',
    ]) {
      test(`a non-timeout error of the wait is thrown as is, at once, after one wait: ${message.slice(0, 48)}`, async () => {
        const e = new Error(message);
        const { page, waits } = webPage(async () => { throw e; });
        const out = await settle(new ElementRepository(page, webPages, 5_000).get('btn', 'Web', options));
        expect(out.error).toBe(e);
        expect(out.ms).toBeLessThan(1_000);
        expect(waits).toHaveLength(1);
        expect(waits[0].timeout).toBe(5_000);
      });
    }

    test('every wait gets a timeout above 0, whatever the wait threw', async () => {
      for (const thrown of [transient(), fatal(), Object.assign(new Error('Timeout 1ms exceeded.'), { name: 'TimeoutError' })]) {
        const { page, waits } = webPage(async () => { throw thrown; });
        await settle(new ElementRepository(page, webPages, 300).get('btn', 'Web', options));
        expect(waits.length).toBeGreaterThan(0);
        for (const w of waits) expect(w.timeout).toBeGreaterThan(0);
      }
    });

    test('a real closed page: the Playwright error is thrown as is, at once', async ({ browser }) => {
      const context = await browser.newContext();
      const page = await context.newPage();
      await page.setContent('<button data-id="id1">b</button>');
      await page.close();
      const out = await settle(new ElementRepository(page, webPages, 5_000).get('btn', 'Web', options));
      await context.close();
      expect(out.error).not.toBeInstanceOf(ElementNotFoundError);
      expect((out.error as Error).message).toContain('Target page, context or browser has been closed');
      expect(out.ms).toBeLessThan(1_000);
    });
  });
}
