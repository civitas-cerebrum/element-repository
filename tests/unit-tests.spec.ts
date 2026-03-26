import { test, expect } from '@playwright/test';
import { ElementRepository } from '../src/ElementRepository';
import { WebElement } from '../src/types';

test.describe('Type Compatibility Tests', () => {

  test('TC_001: Should format selectors correctly', async () => {
    const mockData = {
      pages: [{
        name: 'LoginPage',
        elements: [{ elementName: 'Submit', selector: { xpath: '//button' } }]
      }]
    };

    const repo = new ElementRepository(mockData);

    const mockPage = {
      locator: (s: string) => ({ selector: s }),
      waitForSelector: async () => { }
    } as any;

    await test.step('Retrieve and validate selector formatting', async () => {
      const element = await repo.get(mockPage, 'LoginPage', 'Submit');
      const locator = (element as WebElement).locator as any;

      expect(locator.selector).toBe('xpath=//button');

      console.log('--------------------------------------------------');
      console.log('✅ TEST PASSED: TC_001: Should format selectors correctly');
      console.log(`👉 Found Page: "LoginPage"`);
      console.log(`👉 Element: "Submit"`);
      console.log(`👉 Resulting Selector: "${(element as WebElement).locator as any}"`);
      console.log('--------------------------------------------------');
    });
  });

  test('TC_004: Filter pages by platform', async () => {
    const mockData = {
      pages: [
        {
          name: 'LoginPage',
          platform: 'web',
          elements: [{ elementName: 'submitButton', selector: { css: 'button.web-submit' } }]
        },
        {
          name: 'LoginPage',
          platform: 'android',
          elements: [{ elementName: 'submitButton', selector: { xpath: '//android.widget.Button[@text="Submit"]' } }]
        },
        {
          name: 'LoginPage',
          platform: 'ios',
          elements: [{ elementName: 'submitButton', selector: { xpath: '//XCUIElementTypeButton[@name="Submit"]' } }]
        }
      ]
    };

    await test.step('Web platform returns web selector', () => {
      const webRepo = new ElementRepository(mockData, undefined, 'web');
      expect(webRepo.getSelector('LoginPage', 'submitButton')).toBe('css=button.web-submit');
    });

    await test.step('Android platform returns android selector', () => {
      const androidRepo = new ElementRepository(mockData, undefined, 'android');
      expect(androidRepo.getSelector('LoginPage', 'submitButton')).toBe('//android.widget.Button[@text="Submit"]');
    });

    await test.step('iOS platform returns ios selector', () => {
      const iosRepo = new ElementRepository(mockData, undefined, 'ios');
      expect(iosRepo.getSelector('LoginPage', 'submitButton')).toBe('//XCUIElementTypeButton[@name="Submit"]');
    });
  });

  test('TC_005: Pages without platform field default to web', async () => {
    const mockData = {
      pages: [
        {
          name: 'HomePage',
          elements: [{ elementName: 'logo', selector: { css: 'img.logo' } }]
        }
      ]
    };

    await test.step('Default platform (web) finds page without platform field', () => {
      const webRepo = new ElementRepository(mockData);
      expect(webRepo.getSelector('HomePage', 'logo')).toBe('css=img.logo');
    });

    await test.step('Android platform throws when no android page exists', () => {
      const androidRepo = new ElementRepository(mockData, undefined, 'android');
      expect(() => androidRepo.getSelector('HomePage', 'logo')).toThrow(
        "ElementRepository: Page 'HomePage' not found for platform 'android'."
      );
    });
  });

  test('TC_006: getSelectorRaw returns strategy and value', async () => {
    const mockData = {
      pages: [
        {
          name: 'SearchPage',
          elements: [
            { elementName: 'searchInput', selector: { css: 'input.search' } },
            { elementName: 'searchButton', selector: { xpath: '//button[@id="search"]' } },
            { elementName: 'logo', selector: { id: 'site-logo' } }
          ]
        }
      ]
    };

    const repo = new ElementRepository(mockData);

    await test.step('Returns css strategy and raw value', () => {
      const raw = repo.getSelectorRaw('SearchPage', 'searchInput');
      expect(raw.strategy).toBe('css');
      expect(raw.value).toBe('input.search');
    });

    await test.step('Returns xpath strategy and raw value', () => {
      const raw = repo.getSelectorRaw('SearchPage', 'searchButton');
      expect(raw.strategy).toBe('xpath');
      expect(raw.value).toBe('//button[@id="search"]');
    });

    await test.step('Returns id strategy and raw value', () => {
      const raw = repo.getSelectorRaw('SearchPage', 'logo');
      expect(raw.strategy).toBe('id');
      expect(raw.value).toBe('site-logo');
    });
  });
});