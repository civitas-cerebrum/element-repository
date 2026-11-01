import { test, expect } from '@playwright/test';
import { ElementRepository } from '../src/repo/ElementRepository';
import { SelectionStrategy } from '../src/enum/Options';

/**
 * A `fallback` chain is walked only when a node does not attach. A primary
 * that matches SEVERAL elements is attached: the walk must stop on it, under
 * every strategy. The attach probe used to wait on the whole match set, which
 * Playwright's strict mode rejects for more than one element, so the ALL
 * strategy (and `getAll()`) silently walked past a multi-match primary onto
 * its fallback. Uses page.setContent() — no server.
 */

const PAGE = `
    <ul>
        <li class="row">one</li>
        <li class="row">two</li>
        <li class="row">three</li>
    </ul>
    <p class="legacy-row">legacy</p>
`;

const REPOSITORY = {
    pages: [
        {
            name: 'ListPage',
            elements: [
                // Primary matches 3 elements; the fallback matches 1.
                { elementName: 'rows', selector: { css: 'li.row', fallback: { css: 'p.legacy-row' } } },
                // Primary matches nothing: the fallback must still be used.
                { elementName: 'missingRows', selector: { css: 'li.missing', fallback: { css: 'p.legacy-row' } } },
            ],
        },
    ],
};

test.describe('fallback chain — multi-match primary', () => {

    test.beforeEach(async ({ page }) => {
        await page.setContent(PAGE);
    });

    test('getAll() returns every match of a multi-match primary, not the fallback', async ({ page }) => {
        const repo = new ElementRepository(page, REPOSITORY, 1000);
        const all = await repo.getAll('rows', 'ListPage');
        expect(await Promise.all(all.map((el) => el.textContent()))).toEqual(['one', 'two', 'three']);
    });

    test('the ALL strategy resolves the multi-match primary', async ({ page }) => {
        const repo = new ElementRepository(page, REPOSITORY, 1000);
        const el = await repo.get('rows', 'ListPage', { strategy: SelectionStrategy.ALL });
        expect(await el.count()).toBe(3);
        expect(await el.first().textContent()).toBe('one');
    });

    test('the default strategy resolves the multi-match primary', async ({ page }) => {
        const repo = new ElementRepository(page, REPOSITORY, 1000);
        const el = await repo.get('rows', 'ListPage');
        expect(await el.textContent()).toBe('one');
    });

    test('an absent primary still walks to the fallback, under ALL and the default', async ({ page }) => {
        const repo = new ElementRepository(page, REPOSITORY, 300);
        const all = await repo.getAll('missingRows', 'ListPage');
        expect(await Promise.all(all.map((el) => el.textContent()))).toEqual(['legacy']);
        const one = await repo.get('missingRows', 'ListPage');
        expect(await one.textContent()).toBe('legacy');
    });
});
