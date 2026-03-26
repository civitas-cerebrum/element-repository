import { test, expect } from '@playwright/test';
import { ElementRepository } from '../src/ElementRepository';
import { WebElement } from '../src/types';

const repo = new ElementRepository('./tests/locators.json');

const BASE_URL = 'https://civitas-cerebrum.github.io/vue-test-app/buttons';

test.describe('Live element location — ButtonsPage', () => {

  test.beforeEach(async ({ page }) => {
    await page.goto(BASE_URL);
  });

  // =========================================================================
  // get() — locates a single element by testid
  // =========================================================================

  test('get() returns a visible, interactable WebElement', async ({ page }) => {
    const el = await repo.get(page, 'ButtonsPage', 'primaryButton');

    expect(el).toBeInstanceOf(WebElement);
    expect(await el.isVisible()).toBe(true);
    expect(await el.textContent()).toBe('Primary');
  });

  test('get() locates element by css selector', async ({ page }) => {
    const el = await repo.get(page, 'ButtonsPage', 'pageHeading');

    expect(el).toBeInstanceOf(WebElement);
    expect(await el.textContent()).toBe('Buttons');
  });

  // =========================================================================
  // getAll() — returns all matching elements
  // =========================================================================

  test('getAll() returns all 10 buttons', async ({ page }) => {
    const elements = await repo.getAll(page, 'ButtonsPage', 'allVariantButtons');

    expect(elements.length).toBe(10);
    for (const el of elements) {
      expect(el).toBeInstanceOf(WebElement);
    }
  });

  // =========================================================================
  // getByText() — finds an element by its text content
  // =========================================================================

  test('getByText() finds the Danger button by text', async ({ page }) => {
    const el = await repo.getByText(page, 'ButtonsPage', 'allVariantButtons', 'Danger');

    expect(el).not.toBeNull();
    expect(await el!.textContent()).toBe('Danger');
  });

  test('getByText() returns null for non-existent text (strict=false)', async ({ page }) => {
    const el = await repo.getByText(page, 'ButtonsPage', 'allVariantButtons', 'NonExistent');

    expect(el).toBeNull();
  });

  test('getByText() throws for non-existent text (strict=true)', async ({ page }) => {
    await expect(
      repo.getByText(page, 'ButtonsPage', 'allVariantButtons', 'NonExistent', true)
    ).rejects.toThrow('not found');
  });

  // =========================================================================
  // getByIndex() — returns the nth element
  // =========================================================================

  test('getByIndex() returns the correct element at index 0', async ({ page }) => {
    const el = await repo.getByIndex(page, 'ButtonsPage', 'allVariantButtons', 0);

    expect(el).not.toBeNull();
    expect(await el!.textContent()).toBe('Primary');
  });

  test('getByIndex() returns the correct element at index 2', async ({ page }) => {
    const el = await repo.getByIndex(page, 'ButtonsPage', 'allVariantButtons', 2);

    expect(el).not.toBeNull();
    expect(await el!.textContent()).toBe('Danger');
  });

  test('getByIndex() returns null for out-of-bounds index', async ({ page }) => {
    const el = await repo.getByIndex(page, 'ButtonsPage', 'allVariantButtons', 99);

    expect(el).toBeNull();
  });

  // =========================================================================
  // getVisible() — returns the first visible matching element
  // =========================================================================

  test('getVisible() returns a visible element', async ({ page }) => {
    const el = await repo.getVisible(page, 'ButtonsPage', 'allVariantButtons');

    expect(el).not.toBeNull();
    expect(await el!.isVisible()).toBe(true);
  });

  // =========================================================================
  // getRandom() — picks a random element from matches
  // =========================================================================

  test('getRandom() returns one of the buttons', async ({ page }) => {
    const el = await repo.getRandom(page, 'ButtonsPage', 'allVariantButtons');

    expect(el).not.toBeNull();
    expect(el).toBeInstanceOf(WebElement);
    expect(await el!.isVisible()).toBe(true);
  });

  // =========================================================================
  // getByAttribute() — filters by HTML attribute
  // =========================================================================

  test('getByAttribute() finds button by data-testid', async ({ page }) => {
    const el = await repo.getByAttribute(
      page, 'ButtonsPage', 'allVariantButtons', 'data-testid', 'btn-danger'
    );

    expect(el).not.toBeNull();
    expect(await el!.textContent()).toBe('Danger');
  });

  test('getByAttribute() partial match with exact=false', async ({ page }) => {
    const el = await repo.getByAttribute(
      page, 'ButtonsPage', 'allVariantButtons', 'class', 'btn-ghost', { exact: false }
    );

    expect(el).not.toBeNull();
    expect(await el!.textContent()).toBe('Ghost');
  });

  // =========================================================================
  // getSelector() — returns the formatted selector string
  // =========================================================================

  test('getSelector() returns testid-formatted selector', () => {
    const selector = repo.getSelector('ButtonsPage', 'primaryButton');
    expect(selector).toBe("[data-testid='btn-primary']");
  });

  test('getSelector() returns css-formatted selector', () => {
    const selector = repo.getSelector('ButtonsPage', 'allVariantButtons');
    expect(selector).toBe('css=button.btn');
  });

  // =========================================================================
  // getSelectorRaw() — returns strategy and value
  // =========================================================================

  test('getSelectorRaw() returns raw strategy and value', () => {
    const raw = repo.getSelectorRaw('ButtonsPage', 'primaryButton');
    expect(raw.strategy).toBe('testid');
    expect(raw.value).toBe('btn-primary');
  });

  // =========================================================================
  // Element interaction — click updates result text
  // =========================================================================

  test('clicking a located element updates the page state', async ({ page }) => {
    const btn = await repo.get(page, 'ButtonsPage', 'secondaryButton');
    await btn.click();

    const result = await repo.get(page, 'ButtonsPage', 'resultText');
    expect(await result.textContent()).toBe('Secondary');
  });

  // =========================================================================
  // Disabled element state
  // =========================================================================

  test('get() locates disabled element and reports correct state', async ({ page }) => {
    const el = await repo.get(page, 'ButtonsPage', 'disabledButton');

    expect(await el.isVisible()).toBe(true);
    expect(await el.isEnabled()).toBe(false);
  });
});
