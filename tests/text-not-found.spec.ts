import { test, expect } from '@playwright/test';
import * as root from '../src';
import { TextNotFoundError } from '../src';
import { TextNotFoundError as TypesTextNotFoundError } from '../src/types';
import { ElementRepository } from '../src/repo/ElementRepository';
import { StrategyResolver } from '../src/repo/StrategyResolver';
import { SelectionStrategy } from '../src/enum/Options';

function namedError(name: string, message: string): Error {
  const e = new Error(message);
  e.name = name;
  return e;
}

function row(text: string, id: string): any {
  return {
    elementId: id,
    getText: async () => text,
    getTagName: async () => 'android.widget.TextView',
    getAttribute: async () => null,
    isDisplayed: async () => true,
  };
}

function listDriver($$: () => Promise<any[]>): any {
  const driver: any = { $: async () => row('', 'missing'), $$ };
  Object.defineProperty(driver, 'locator', { get() { throw new Error('locator touched'); } });
  return driver;
}

const androidPage = { name: 'Settings', platform: 'android', elements: [] } as any;

async function textLookupError(driver: any, timeout: number): Promise<unknown> {
  return StrategyResolver.fromSelector(
    driver, '~row', androidPage, 'row', 'Settings', timeout,
    { strategy: SelectionStrategy.TEXT, value: 'Wi-Fi' },
  ).then(() => null, (e: unknown) => e);
}

test.describe('TextNotFoundError', () => {
  test('carries its fields, its name and the not-found message', () => {
    const err = new TextNotFoundError({ elementName: 'row', pageName: 'Settings', text: 'Wi-Fi' });
    expect(err.message).toBe(`Element 'row' on 'Settings' with text "Wi-Fi" not found.`);
    expect(err.name).toBe('TextNotFoundError');
    expect(err.elementName).toBe('row');
    expect(err.pageName).toBe('Settings');
    expect(err.text).toBe('Wi-Fi');
    expect(err.lastDriverError).toBeUndefined();
    expect(err.cleanMiss).toBe(true);
    expect(err).toBeInstanceOf(TextNotFoundError);
    expect(err).toBeInstanceOf(Error);
  });

  test('a driver error is appended as the last driver error suffix', () => {
    const cause = namedError('stale element reference', 'gone');
    const err = new TextNotFoundError({
      elementName: 'row', pageName: 'Settings', text: 'Wi-Fi', lastDriverError: cause, cleanMiss: false,
    });
    expect(err.message).toBe(
      `Element 'row' on 'Settings' with text "Wi-Fi" not found. (last driver error: stale element reference: gone)`,
    );
    expect(err.lastDriverError).toBe(cause);
    expect(err.cleanMiss).toBe(false);
  });

  test('a plain Error in the suffix shows its bare message', () => {
    const err = new TextNotFoundError({
      elementName: 'row', pageName: 'Settings', text: 'Wi-Fi', lastDriverError: new Error('boom'), cleanMiss: false,
    });
    expect(err.message.endsWith(' (last driver error: boom)')).toBe(true);
  });

  test('is exported from the package root and from types as the same class', () => {
    expect(root.TextNotFoundError).toBe(TextNotFoundError);
    expect(TypesTextNotFoundError).toBe(TextNotFoundError);
  });
});

test.describe('TEXT strategy throws TextNotFoundError', () => {
  test('a clean miss: cleanMiss true, no lastDriverError, the exact message', async () => {
    const driver = listDriver(async () => [row('General', 'a')]);
    const err = await textLookupError(driver, 300);
    expect(err).toBeInstanceOf(TextNotFoundError);
    const e = err as TextNotFoundError;
    expect(e.message).toBe(`Element 'row' on 'Settings' with text "Wi-Fi" not found.`);
    expect(e.cleanMiss).toBe(true);
    expect(e.lastDriverError).toBeUndefined();
    expect(e.elementName).toBe('row');
    expect(e.pageName).toBe('Settings');
    expect(e.text).toBe('Wi-Fi');
  });

  test('a driver error in the final pass: cleanMiss false, lastDriverError set, suffix kept', async () => {
    let calls = 0;
    const driver = listDriver(async () => { calls++; throw namedError('stale element reference', `stale #${calls}`); });
    const err = await textLookupError(driver, 600);
    expect(err).toBeInstanceOf(TextNotFoundError);
    const e = err as TextNotFoundError;
    expect(e.cleanMiss).toBe(false);
    expect((e.lastDriverError as Error).message).toBe(`stale #${calls}`);
    expect(e.message).toBe(
      `Element 'row' on 'Settings' with text "Wi-Fi" not found. (last driver error: stale element reference: stale #${calls})`,
    );
  });

  test('a driver error in a text read of the final pass is not a clean miss', async () => {
    const stale = { ...row('x', 'a'), getText: async () => { throw namedError('stale element reference', 'row gone'); } };
    const driver = listDriver(async () => [stale]);
    const e = await textLookupError(driver, 300) as TextNotFoundError;
    expect(e).toBeInstanceOf(TextNotFoundError);
    expect(e.cleanMiss).toBe(false);
    expect((e.lastDriverError as Error).message).toBe('row gone');
  });

  test('an error in an earlier pass only: cleanMiss true, lastDriverError and suffix kept', async () => {
    let calls = 0;
    const driver = listDriver(async () => {
      calls++;
      if (calls === 1) throw namedError('stale element reference', 'first pass');
      return [row('General', 'a')];
    });
    const e = await textLookupError(driver, 600) as TextNotFoundError;
    expect(calls).toBeGreaterThan(1);
    expect(e).toBeInstanceOf(TextNotFoundError);
    expect(e.cleanMiss).toBe(true);
    expect((e.lastDriverError as Error).message).toBe('first pass');
    expect(e.message).toBe(
      `Element 'row' on 'Settings' with text "Wi-Fi" not found. (last driver error: stale element reference: first pass)`,
    );
  });

  test('a fatal driver error is still rethrown unchanged', async () => {
    const fatal = namedError('invalid selector', 'bad');
    const driver = listDriver(async () => { throw fatal; });
    expect(await textLookupError(driver, 600)).toBe(fatal);
  });
});

test.describe('getByText strict throws TextNotFoundError', () => {
  test('web: strict miss is a clean TextNotFoundError with the same message', async () => {
    const other = { textContent: async () => 'Other' };
    const base = { all: async () => [other], first: () => base, nth: () => base, waitFor: async () => {} };
    const page = { locator: () => base };
    const repo = new ElementRepository(page, {
      pages: [{ name: 'TestPage', elements: [{ elementName: 'button', selector: { css: 'button' } }] }],
    });
    const err = await repo.getByText('button', 'TestPage', 'Nonexistent', true).then(() => null, (e: unknown) => e);
    expect(err).toBeInstanceOf(TextNotFoundError);
    const e = err as TextNotFoundError;
    expect(e.message).toBe(`Element 'button' on 'TestPage' with text "Nonexistent" not found.`);
    expect(e.cleanMiss).toBe(true);
    expect(e.lastDriverError).toBeUndefined();
  });
});
