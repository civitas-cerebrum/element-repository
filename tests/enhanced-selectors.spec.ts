import { test, expect } from '@playwright/test';
import { EnhancedResolver } from '../src/repo/EnhancedResolver';
import { StrategyResolver } from '../src/repo/StrategyResolver';
import { ElementRepository } from '../src/repo/ElementRepository';
import { WebElement } from '../src/types';

/**
 * Mock helpers for testing enhanced selectors without a live browser.
 */
function createMockPage() {
  const mockLocator: any = {
    selector: '',
    first: () => mockLocator,
    filter: () => mockLocator,
    waitFor: async () => {},
    all: async () => [mockLocator],
    isVisible: async () => true,
    textContent: async () => 'Mock Text',
    getAttribute: async () => null,
  };

  const createMockFrameLocator = (): any => {
    const fl: any = {
      locator: (sel: string) => {
        const loc = { ...mockLocator, selector: sel };
        loc.first = () => loc;
        loc.filter = () => loc;
        return loc;
      },
      getByRole: (role: string, options?: any) => {
        const loc = { ...mockLocator, selector: `role=${role}[name=${options?.name}]` };
        loc.first = () => loc;
        return loc;
      },
      frameLocator: (sel: string) => ({ ...createMockFrameLocator(), frameSelector: sel }),
      first: () => fl,
      last: () => fl,
      nth: () => fl,
    };
    return fl;
  };
  const mockFrameLocator = createMockFrameLocator();

  const mockPage: any = {
    locator: (sel: string) => {
      const loc = { ...mockLocator, selector: sel };
      loc.first = () => loc;
      loc.filter = () => loc;
      return loc;
    },
    getByRole: (role: string, options?: any) => {
      const loc = { ...mockLocator, selector: `role=${role}[name=${options?.name}]` };
      loc.first = () => loc;
      return loc;
    },
    frameLocator: (sel: string) => {
      return { ...mockFrameLocator, frameSelector: sel };
    },
    waitForSelector: async () => {},
  };

  return mockPage;
}

test.describe('EnhancedResolver — static methods', () => {

  test('isRegex — detects regex pattern objects', () => {
    expect(EnhancedResolver.isRegex({ regex: 'test', flags: 'i' })).toBe(true);
    expect(EnhancedResolver.isRegex({ regex: 'test' })).toBe(true);
    expect(EnhancedResolver.isRegex('plain string')).toBe(false);
  });

  test('isWebPlatform — identifies web vs mobile pages', () => {
    expect(EnhancedResolver.isWebPlatform({ name: 'P', elements: [] })).toBe(true);
    expect(EnhancedResolver.isWebPlatform({ name: 'P', platform: 'web', elements: [] })).toBe(true);
    expect(EnhancedResolver.isWebPlatform({ name: 'P', platform: 'android', elements: [] })).toBe(false);
    expect(EnhancedResolver.isWebPlatform({ name: 'P', platform: 'ios', elements: [] })).toBe(false);
  });

  test('resolve — returns locator for role + name selector on web', () => {
    const page = createMockPage();
    const pageObj = {
      name: 'TestPage',
      elements: [{ elementName: 'loginBtn', selector: { role: 'button', name: 'Log in' } }],
    };
    const result = EnhancedResolver.resolve(page, pageObj, 'loginBtn', {});
    expect(result).not.toBeNull();
    expect(result.selector).toContain('role=button');
  });

  test('resolve — returns locator for regex text selector on web', () => {
    const page = createMockPage();
    const pageObj = {
      name: 'TestPage',
      elements: [{ elementName: 'alert', selector: { text: { regex: 'Error.*failed', flags: 'i' } } }],
    };
    const result = EnhancedResolver.resolve(page, pageObj, 'alert', {});
    expect(result).not.toBeNull();
    expect(result.selector).toContain('text=/Error.*failed/i');
  });

  test('resolve — returns null for standard selectors', () => {
    const page = createMockPage();
    const pageObj = {
      name: 'TestPage',
      elements: [{ elementName: 'btn', selector: { css: 'button.primary' } }],
    };
    const result = EnhancedResolver.resolve(page, pageObj, 'btn', {});
    expect(result).toBeNull();
  });

  test('resolve — returns selector string for role + name on android', () => {
    const page = createMockPage();
    const pageObj = {
      name: 'TestPage',
      platform: 'android',
      elements: [{ elementName: 'loginBtn', selector: { role: 'button', name: 'Log in' } }],
    };
    const result = EnhancedResolver.resolve(page, pageObj, 'loginBtn', {});
    expect(result).toBe('android=new UiSelector().className("android.widget.Button").text("Log in")');
  });

  test('resolve — returns selector string for role + name on ios', () => {
    const page = createMockPage();
    const pageObj = {
      name: 'TestPage',
      platform: 'ios',
      elements: [{ elementName: 'loginBtn', selector: { role: 'button', name: 'Log in' } }],
    };
    const result = EnhancedResolver.resolve(page, pageObj, 'loginBtn', {});
    expect(result).toBe("-ios predicate string:type == 'XCUIElementTypeButton' AND label == 'Log in'");
  });

  test('resolve — returns selector string for regex text on android', () => {
    const page = createMockPage();
    const pageObj = {
      name: 'TestPage',
      platform: 'android',
      elements: [{ elementName: 'alert', selector: { text: { regex: 'Error.*failed' } } }],
    };
    const result = EnhancedResolver.resolve(page, pageObj, 'alert', {});
    expect(result).toBe('android=new UiSelector().textMatches("Error.*failed")');
  });

  test('resolve — returns selector string for regex text on ios', () => {
    const page = createMockPage();
    const pageObj = {
      name: 'TestPage',
      platform: 'ios',
      elements: [{ elementName: 'alert', selector: { text: { regex: 'Error.*failed' } } }],
    };
    const result = EnhancedResolver.resolve(page, pageObj, 'alert', {});
    expect(result).toBe("-ios predicate string:label MATCHES 'Error.*failed'");
  });

  test('resolveFrameScope — resolves single frame', () => {
    const page = createMockPage();
    const pageObj = {
      name: 'IframePage',
      frame: { css: 'iframe.payment' },
      elements: [],
    };
    const scope = EnhancedResolver.resolveFrameScope(page, pageObj);
    expect(scope).toBeDefined();
    expect(scope.frameSelector).toBe('iframe.payment');
  });

  test('resolveFrameScope — resolves nested frames', () => {
    const page = createMockPage();
    const pageObj = {
      name: 'NestedIframePage',
      frame: [{ css: 'iframe.outer' }, { css: 'iframe.inner' }],
      elements: [],
    };
    const scope = EnhancedResolver.resolveFrameScope(page, pageObj);
    expect(scope).toBeDefined();
  });

  test('resolve — resolves standard selector inside frame', () => {
    const page = createMockPage();
    const pageObj = {
      name: 'IframePage',
      frame: { css: 'iframe.payment' },
      elements: [{ elementName: 'cardInput', selector: { css: '#card-number' } }],
    };
    const result = EnhancedResolver.resolve(page, pageObj, 'cardInput', { css: (v: string) => `css=${v}` });
    expect(result).not.toBeNull();
  });
});

test.describe('StrategyResolver — static methods', () => {

  test('fromLocator — default strategy returns first element', async () => {
    const mockLocator: any = {
      first: () => mockLocator,
      filter: () => mockLocator,
      waitFor: async () => {},
      all: async () => [mockLocator],
    };
    const element = await StrategyResolver.fromLocator(mockLocator, 'btn', 'Page', 5000);
    expect(element).toBeDefined();
  });

  test('fromSelector — creates WebElement for web page', async () => {
    const page = createMockPage();
    const pageObj = { name: 'TestPage', elements: [] };
    const element = await StrategyResolver.fromSelector(page, 'css=button', pageObj, 'btn', 'Page', 5000);
    expect(element).toBeDefined();
  });

  test('fromMobileSelector — creates PlatformElement', async () => {
    const mockDriver: any = {
      $: async () => ({ elementId: 'mock' }),
      $$: async () => [],
    };
    const element = await StrategyResolver.fromMobileSelector(mockDriver, 'android=new UiSelector()', 5000);
    expect(element).toBeDefined();
  });
});

test.describe('ElementRepository — enhanced selector integration', () => {

  test('get — resolves role + name selector via getByRole', async () => {
    const page = createMockPage();
    const data = {
      pages: [{
        name: 'LoginPage',
        elements: [{ elementName: 'loginBtn', selector: { role: 'button', name: 'Sign in' } }],
      }],
    };
    const repo = new ElementRepository(page, data);
    const element = await repo.get('loginBtn', 'LoginPage');
    expect(element).toBeDefined();
  });

  test('get — resolves regex text selector', async () => {
    const page = createMockPage();
    const data = {
      pages: [{
        name: 'AlertPage',
        elements: [{ elementName: 'errorMsg', selector: { text: { regex: 'Error.*occurred', flags: 'i' } } }],
      }],
    };
    const repo = new ElementRepository(page, data);
    const element = await repo.get('errorMsg', 'AlertPage');
    expect(element).toBeDefined();
  });

  test('get — resolves iframe-scoped selector', async () => {
    const page = createMockPage();
    const data = {
      pages: [{
        name: 'PaymentIframe',
        frame: { css: 'iframe.payment' },
        elements: [{ elementName: 'cardInput', selector: { css: '#card' } }],
      }],
    };
    const repo = new ElementRepository(page, data);
    const element = await repo.get('cardInput', 'PaymentIframe');
    expect(element).toBeDefined();
  });
});
