import { test, expect } from '@playwright/test';
import { ElementRepository } from '../src/repo/ElementRepository';
import { WebElement } from '../src/types';

const BASE_URL = 'https://civitas-cerebrum.github.io/vue-test-app/buttons';

test.describe('Live element location — ButtonsPage', () => {

  test.beforeEach(async ({ page }) => {
    await page.goto(BASE_URL);
  });

  // =========================================================================
  // get() — locates a single element by testid
  // =========================================================================

  test('get() returns a visible, interactable WebElement', async ({ page }) => {
    const repo = new ElementRepository(page, './tests/locators.json');
    const el = await repo.get('primaryButton', 'ButtonsPage');

    expect(el).toBeInstanceOf(WebElement);
    expect(await el.isVisible()).toBe(true);
    expect(await el.textContent()).toBe('Primary');
  });

  test('get() locates element by css selector', async ({ page }) => {
    const repo = new ElementRepository(page, './tests/locators.json');
    const el = await repo.get('pageHeading', 'ButtonsPage');

    expect(el).toBeInstanceOf(WebElement);
    expect(await el.textContent()).toBe('Buttons');
  });

  // =========================================================================
  // getAll() — returns all matching elements
  // =========================================================================

  test('getAll() returns all 10 buttons', async ({ page }) => {
    const repo = new ElementRepository(page, './tests/locators.json');
    const elements = await repo.getAll('allVariantButtons', 'ButtonsPage');

    expect(elements.length).toBe(10);
    for (const el of elements) {
      expect(el).toBeInstanceOf(WebElement);
    }
  });

  // =========================================================================
  // getByText() — finds an element by its text content
  // =========================================================================

  test('getByText() finds the Danger button by text', async ({ page }) => {
    const repo = new ElementRepository(page, './tests/locators.json');
    const el = await repo.getByText('allVariantButtons', 'ButtonsPage', 'Danger');

    expect(el).not.toBeNull();
    expect(await el!.textContent()).toBe('Danger');
  });

  test('getByText() returns null for non-existent text (strict=false)', async ({ page }) => {
    const repo = new ElementRepository(page, './tests/locators.json');
    const el = await repo.getByText('allVariantButtons', 'ButtonsPage', 'NonExistent');

    expect(el).toBeNull();
  });

  test('getByText() throws for non-existent text (strict=true)', async ({ page }) => {
    const repo = new ElementRepository(page, './tests/locators.json');
    await expect(
      repo.getByText('allVariantButtons', 'ButtonsPage', 'NonExistent', true)
    ).rejects.toThrow('not found');
  });

  // =========================================================================
  // getByIndex() — returns the nth element
  // =========================================================================

  test('getByIndex() returns the correct element at index 0', async ({ page }) => {
    const repo = new ElementRepository(page, './tests/locators.json');
    const el = await repo.getByIndex('allVariantButtons', 'ButtonsPage', 0);

    expect(el).not.toBeNull();
    expect(await el!.textContent()).toBe('Primary');
  });

  test('getByIndex() returns the correct element at index 2', async ({ page }) => {
    const repo = new ElementRepository(page, './tests/locators.json');
    const el = await repo.getByIndex('allVariantButtons', 'ButtonsPage', 2);

    expect(el).not.toBeNull();
    expect(await el!.textContent()).toBe('Danger');
  });

  test('getByIndex() returns null for out-of-bounds index', async ({ page }) => {
    const repo = new ElementRepository(page, './tests/locators.json');
    const el = await repo.getByIndex('allVariantButtons', 'ButtonsPage', 99);

    expect(el).toBeNull();
  });

  // =========================================================================
  // getVisible() — returns the first visible matching element
  // =========================================================================

  test('getVisible() returns a visible element', async ({ page }) => {
    const repo = new ElementRepository(page, './tests/locators.json');
    const el = await repo.getVisible('allVariantButtons', 'ButtonsPage');

    expect(el).not.toBeNull();
    expect(await el!.isVisible()).toBe(true);
  });

  // =========================================================================
  // getRandom() — picks a random element from matches
  // =========================================================================

  test('getRandom() returns one of the buttons', async ({ page }) => {
    const repo = new ElementRepository(page, './tests/locators.json');
    const el = await repo.getRandom('allVariantButtons', 'ButtonsPage');

    expect(el).not.toBeNull();
    expect(el).toBeInstanceOf(WebElement);
    expect(await el!.isVisible()).toBe(true);
  });

  // =========================================================================
  // getByAttribute() — filters by HTML attribute
  // =========================================================================

  test('getByAttribute() finds button by data-testid', async ({ page }) => {
    const repo = new ElementRepository(page, './tests/locators.json');
    const el = await repo.getByAttribute(
      'allVariantButtons', 'ButtonsPage', 'data-testid', 'btn-danger'
    );

    expect(el).not.toBeNull();
    expect(await el!.textContent()).toBe('Danger');
  });

  test('getByAttribute() partial match with exact=false', async ({ page }) => {
    const repo = new ElementRepository(page, './tests/locators.json');
    const el = await repo.getByAttribute(
      'allVariantButtons', 'ButtonsPage', 'class', 'btn-ghost', { exact: false }
    );

    expect(el).not.toBeNull();
    expect(await el!.textContent()).toBe('Ghost');
  });

  // =========================================================================
  // getSelector() — returns the formatted selector string
  // =========================================================================

  test('getSelector() returns testid-formatted selector', () => {
    const repo = new ElementRepository({} as any, './tests/locators.json');
    const selector = repo.getSelector('primaryButton', 'ButtonsPage');
    expect(selector).toBe("[data-testid='btn-primary']");
  });

  test('getSelector() returns css-formatted selector', () => {
    const repo = new ElementRepository({} as any, './tests/locators.json');
    const selector = repo.getSelector('allVariantButtons', 'ButtonsPage');
    expect(selector).toBe('css=button.btn');
  });

  // =========================================================================
  // getSelectorRaw() — returns strategy and value
  // =========================================================================

  test('getSelectorRaw() returns raw strategy and value', () => {
    const repo = new ElementRepository({} as any, './tests/locators.json');
    const raw = repo.getSelectorRaw('primaryButton', 'ButtonsPage');
    expect(raw.strategy).toBe('testid');
    expect(raw.value).toBe('btn-primary');
  });

  // =========================================================================
  // Element interaction — click updates result text
  // =========================================================================

  test('clicking a located element updates the page state', async ({ page }) => {
    const repo = new ElementRepository(page, './tests/locators.json');
    const btn = await repo.get('secondaryButton', 'ButtonsPage');
    await btn.click();

    const result = await repo.get('resultText', 'ButtonsPage');
    expect(await result.textContent()).toBe('Secondary');
  });

  // =========================================================================
  // Disabled element state
  // =========================================================================

  test('get() locates disabled element and reports correct state', async ({ page }) => {
    const repo = new ElementRepository(page, './tests/locators.json');
    const el = await repo.get('disabledButton', 'ButtonsPage');

    expect(await el.isVisible()).toBe(true);
    expect(await el.isEnabled()).toBe(false);
  });
});
