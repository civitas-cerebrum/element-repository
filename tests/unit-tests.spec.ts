import { test, expect } from '@playwright/test';
import { Page as PlaywrightPage } from 'playwright-core';

import { ElementRepository } from '../src/ElementRepository';

// 1. Test with an explicit type alias to simulate version-agnostic casting
const repo = new ElementRepository('./tests/locators.json');

test.describe('Type Compatibility Tests', () => {

  test('TC_001: Should accept an explicitly typed Page from @playwright/test', async ({ page }) => {
    // Explicitly casting to show that the repo accepts the local project's Page type
    const typedPage: PlaywrightPage = page;
    
    await typedPage.goto('https://example.com');

    // The 'heading' variable should correctly infer as the local project's 'Locator' type
    const heading = await repo.get(typedPage, 'ExamplePage', 'main-heading');
    
    await expect(heading).toBeVisible();
    console.log('✅ Explicit type test passed');
  });

  test('TC_002: Should work with a Wrapped Page (Dependency Injection)', async ({ page }) => {
    /**
     * This simulates a common pattern where teams wrap the Page object
     * inside a custom class. Because of our 'MinimalPage' interface,
     * the repository will still be compatible!
     */
    class CustomPageWrapper {
      constructor(public page: PlaywrightPage) {}
      
      // Mirroring the Playwright API
      locator(selector: string) { return this.page.locator(selector); }
      async waitForSelector(selector: string, options?: any) { 
        return this.page.waitForSelector(selector, options); 
      }
    }

    const wrapped = new CustomPageWrapper(page);
    await page.goto('https://example.com');

    // Repo accepts 'wrapped' because it has the necessary methods (Structural Typing)
    const heading = await repo.get(wrapped, 'ExamplePage', 'main-heading');
    
    await expect(heading).toBeVisible();
    console.log('✅ Wrapped/Structural typing test passed');
  });
});