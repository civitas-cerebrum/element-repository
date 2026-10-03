import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { ElementRepository } from '../src/repo/ElementRepository';
import { PageRepository } from '../src/schema/repository';
import { WebElement } from '../src/types';

/**
 * Entry-level schema keys `provisional` and `list`: typed, validated at
 * construction (and by the static `validate`), exposed through
 * `getElementMeta` / `getProvisional`, and inert for resolution.
 */

const mockPage = {
  locator: (s: string) => {
    const loc: any = { selector: s, waitFor: async () => {} };
    loc.first = () => loc;
    return loc;
  },
  waitForSelector: async () => { },
} as any;

const data: PageRepository = {
  pages: [
    {
      name: 'BasketPage',
      elements: [
        { elementName: 'rows', list: true, selector: { css: "[data-testid='basket-row']" } },
        { elementName: 'discountLine', provisional: true, selector: { css: "[data-testid='discount']" } },
        { elementName: 'both', provisional: true, list: true, selector: { css: '.both' } },
        { elementName: 'plain', selector: { css: '.plain' } },
      ],
    },
    {
      name: 'CheckoutPage',
      elements: [
        { elementName: 'payButton', provisional: true, selector: { css: '.pay' } },
        { elementName: 'explicitFalse', provisional: false, list: false, selector: { css: '.no' } },
      ],
    },
  ],
};

test.describe('Entry flags — provisional / list', () => {

  test('TC_FLAGS_001: getElementMeta applies defaults', async () => {
    const repo = new ElementRepository(mockPage, data);
    expect(repo.getElementMeta('rows', 'BasketPage')).toEqual({ provisional: false, list: true });
    expect(repo.getElementMeta('discountLine', 'BasketPage')).toEqual({ provisional: true, list: false });
    expect(repo.getElementMeta('both', 'BasketPage')).toEqual({ provisional: true, list: true });
    expect(repo.getElementMeta('plain', 'BasketPage')).toEqual({ provisional: false, list: false });
    expect(repo.getElementMeta('explicitFalse', 'CheckoutPage')).toEqual({ provisional: false, list: false });
  });

  test('TC_FLAGS_002: getElementMeta throws for unknown page / element', async () => {
    const repo = new ElementRepository(mockPage, data);
    expect(() => repo.getElementMeta('rows', 'NoSuchPage')).toThrow("ElementRepository: Page 'NoSuchPage' not found.");
    expect(() => repo.getElementMeta('nope', 'BasketPage')).toThrow("ElementRepository: Element 'nope' not found on page 'BasketPage'.");
  });

  test('TC_FLAGS_003: getProvisional lists provisional entries in repository order', async () => {
    const repo = new ElementRepository(mockPage, data);
    expect(repo.getProvisional()).toEqual([
      { pageName: 'BasketPage', elementName: 'discountLine' },
      { pageName: 'BasketPage', elementName: 'both' },
      { pageName: 'CheckoutPage', elementName: 'payButton' },
    ]);
    expect(new ElementRepository(mockPage, { pages: [] }).getProvisional()).toEqual([]);
  });

  test('TC_FLAGS_004: non-boolean flags are rejected at construction, naming every offender', async () => {
    const bad = {
      pages: [{
        name: 'BasketPage',
        elements: [
          { elementName: 'rows', list: 'true', selector: { css: '.rows' } },
          { elementName: 'line', provisional: 1, selector: { css: '.line' } },
          { elementName: 'fine', list: true, selector: { css: '.fine' } },
        ],
      }, {
        name: 'CheckoutPage',
        elements: [
          { elementName: 'total', list: null, selector: { css: '.total' } },
        ],
      }],
    } as unknown as PageRepository;
    expect(() => new ElementRepository(mockPage, bad)).toThrow(
      `ElementRepository: invalid repository — 'BasketPage.rows' has "list": "true" (expected true or false); ` +
      `'BasketPage.line' has "provisional": 1 (expected true or false); ` +
      `'CheckoutPage.total' has "list": null (expected true or false).`,
    );
    expect(() => ElementRepository.validate(bad)).toThrow(/'BasketPage\.rows' has "list": "true"/);
    expect(() => ElementRepository.validate(data)).not.toThrow();
  });

  test('TC_FLAGS_006: validate tolerates a repository without pages or a page without elements', async () => {
    expect(() => ElementRepository.validate({} as unknown as PageRepository)).not.toThrow();
    expect(() => ElementRepository.validate({ pages: [{ name: 'EmptyPage' }] } as unknown as PageRepository)).not.toThrow();
    expect(() => new ElementRepository(mockPage, { pages: [{ name: 'EmptyPage', elements: [] }] })).not.toThrow();
  });

  test('TC_FLAGS_007: a repository loaded from a JSON file path is validated too', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'entry-flags-'));
    try {
      const badFile = path.join(dir, 'bad.json');
      fs.writeFileSync(badFile, JSON.stringify({
        pages: [{ name: 'BasketPage', elements: [{ elementName: 'rows', list: 'true', selector: { css: '.rows' } }] }],
      }));
      expect(() => new ElementRepository(mockPage, badFile)).toThrow(
        `ElementRepository: invalid repository — 'BasketPage.rows' has "list": "true" (expected true or false).`,
      );

      const goodFile = path.join(dir, 'good.json');
      fs.writeFileSync(goodFile, JSON.stringify(data));
      const repo = new ElementRepository(mockPage, goodFile);
      expect(repo.getElementMeta('both', 'BasketPage')).toEqual({ provisional: true, list: true });
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('TC_FLAGS_008: validate names an offender that is only on a later page', async () => {
    const bad = {
      pages: [
        { name: 'FirstPage', elements: [{ elementName: 'ok', list: true, selector: { css: '.ok' } }] },
        { name: 'SecondPage', elements: [
          { elementName: 'fine', provisional: false, selector: { css: '.fine' } },
          { elementName: 'broken', provisional: 'yes', selector: { css: '.broken' } },
        ] },
      ],
    } as unknown as PageRepository;
    expect(() => ElementRepository.validate(bad)).toThrow(
      `ElementRepository: invalid repository — 'SecondPage.broken' has "provisional": "yes" (expected true or false).`,
    );
  });

  test('TC_FLAGS_005: flags do not change resolution', async () => {
    const repo = new ElementRepository(mockPage, data);
    const listed = await repo.get('rows', 'BasketPage');
    const provisional = await repo.get('discountLine', 'BasketPage');
    expect(((listed as WebElement).locator as any).selector).toBe("css=[data-testid='basket-row']");
    expect(((provisional as WebElement).locator as any).selector).toBe("css=[data-testid='discount']");
    expect(repo.getSelector('rows', 'BasketPage')).toBe("css=[data-testid='basket-row']");
  });
});
