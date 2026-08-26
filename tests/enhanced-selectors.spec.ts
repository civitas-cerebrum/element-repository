import { test, expect } from '@playwright/test';
import { EnhancedResolver } from '../src/repo/EnhancedResolver';
import { StrategyResolver } from '../src/repo/StrategyResolver';
import { ElementRepository } from '../src/repo/ElementRepository';
import { WebElement } from '../src/types';
import { SelectionStrategy } from '../src/enum/Options';

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

  test('fromLocator — ATTRIBUTE strategy resolves the matching non-first element', async () => {
    // Generic list: three items with distinct data attributes; the target is
    // deliberately NOT first so a silent .first() fallback fails the test.
    const children = [
      { 'data-kind': 'alpha', text: 'Alpha' },
      { 'data-kind': 'bravo', text: 'Bravo' },
      { 'data-kind': 'charlie', text: 'Charlie' },
    ].map((c) => {
      const loc: any = {
        getAttribute: async (name: string) => (name === 'data-kind' ? c['data-kind'] : null),
        textContent: async () => c.text,
        waitFor: async () => {},
        first: () => loc,
        all: async () => [loc],
      };
      return loc;
    });
    const mockLocator: any = {
      first: () => mockLocator,
      filter: () => mockLocator,
      waitFor: async () => {},
      all: async () => children,
    };

    const element = await StrategyResolver.fromLocator(mockLocator, 'listItem', 'ListPage', 5000, {
      strategy: SelectionStrategy.ATTRIBUTE, attribute: 'data-kind', value: 'bravo',
    });
    expect(await element.textContent()).toBe('Bravo');
  });

  test('fromLocator — unhandled strategy throws instead of resolving .first()', async () => {
    const mockLocator: any = {
      first: () => mockLocator,
      filter: () => mockLocator,
      waitFor: async () => {},
      all: async () => [mockLocator],
    };
    await expect(
      StrategyResolver.fromLocator(mockLocator, 'btn', 'Page', 5000, { strategy: SelectionStrategy.VALUE, value: 'x' }),
    ).rejects.toThrow(`Unhandled selection strategy 'value' for 'btn' on 'Page'`);
  });

  test('fromMobileSelector — non-ALL strategy throws instead of resolving .first()', async () => {
    const mockDriver: any = {
      $: async () => ({ elementId: 'mock' }),
      $$: async () => [],
    };
    await expect(
      StrategyResolver.fromMobileSelector(mockDriver, 'android=new UiSelector()', 5000, {
        strategy: SelectionStrategy.ATTRIBUTE, attribute: 'content-desc', value: 'x',
      }),
    ).rejects.toThrow('Unhandled selection strategy');
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

test.describe('ElementRepository — selector fallback chains', () => {

  /**
   * Mock page whose `locator(selector)` returns a locator reporting `count()`
   * from a predefined map — used to simulate primary-misses-fallback-hits
   * without a live browser.
   */
  function createMockPageWithCounts(counts: Record<string, number>) {
    const makeLocator = (sel: string): any => {
      const loc: any = {
        selector: sel,
        // waitFor('attached') resolves iff count > 0; otherwise throws to
        // simulate Playwright's timeout — the fallback walker interprets
        // the throw as "primary did not attach, walk fallback".
        waitFor: async (opts?: { state?: string; timeout?: number }) => {
          if ((opts?.state ?? 'attached') === 'attached' && (counts[sel] ?? 0) === 0) {
            throw new Error(`Timeout ${opts?.timeout ?? 1000}ms exceeded`);
          }
        },
        isVisible: async () => (counts[sel] ?? 0) > 0,
        textContent: async () => 'Mock',
        getAttribute: async () => null,
        count: async () => counts[sel] ?? 0,
      };
      loc.first = () => loc;
      loc.filter = () => loc;
      loc.all = async () => [loc];
      return loc;
    };
    return {
      locator: (sel: string) => makeLocator(sel),
      getByRole: (role: string, options?: any) => makeLocator(`role=${role}[name=${options?.name}]`),
    } as any;
  }

  test('primary matches → fallback ignored', async () => {
    const page = createMockPageWithCounts({ "css=[data-qa='login-button']": 1 });
    const data = {
      pages: [{
        name: 'LoginPage',
        elements: [{
          elementName: 'loginBtn',
          selector: {
            css: "[data-qa='login-button']",
            fallback: { css: "#login-alt" },
          },
        }],
      }],
    };
    const repo = new ElementRepository(page, data);
    const element = await repo.get('loginBtn', 'LoginPage');
    expect(element).toBeDefined();
    expect(await element.count()).toBe(1);
  });

  test('primary matches zero → walks into fallback', async () => {
    const page = createMockPageWithCounts({
      "css=[data-qa='primary']": 0,
      "css=[data-qa='fallback']": 1,
    });
    const data = {
      pages: [{
        name: 'LoginPage',
        elements: [{
          elementName: 'loginBtn',
          selector: {
            css: "[data-qa='primary']",
            fallback: { css: "[data-qa='fallback']" },
          },
        }],
      }],
    };
    const repo = new ElementRepository(page, data);
    const element = await repo.get('loginBtn', 'LoginPage');
    // Resolved element is the fallback — count==1 only on the fallback selector.
    expect(await element.count()).toBe(1);
  });

  test('recursive chain — walks past multiple empty fallbacks', async () => {
    const page = createMockPageWithCounts({
      "css=[data-qa='one']": 0,
      "css=[data-qa='two']": 0,
      "css=[data-qa='three']": 1,
    });
    const data = {
      pages: [{
        name: 'ChainPage',
        elements: [{
          elementName: 'target',
          selector: {
            css: "[data-qa='one']",
            fallback: {
              css: "[data-qa='two']",
              fallback: { css: "[data-qa='three']" },
            },
          },
        }],
      }],
    };
    const repo = new ElementRepository(page, data);
    const element = await repo.get('target', 'ChainPage');
    expect(await element.count()).toBe(1);
  });

  test('no fallback key → pre-0.1.6 single-selector behaviour preserved', async () => {
    const page = createMockPageWithCounts({ "css=[data-qa='plain']": 1 });
    const data = {
      pages: [{
        name: 'PlainPage',
        elements: [{
          elementName: 'target',
          selector: { css: "[data-qa='plain']" },
        }],
      }],
    };
    const repo = new ElementRepository(page, data);
    const element = await repo.get('target', 'PlainPage');
    expect(element).toBeDefined();
  });

  test('terminal fallback — all nodes match zero → returns last fallback (caller handles)', async () => {
    const page = createMockPageWithCounts({
      "css=[data-qa='one']": 0,
      "css=[data-qa='two']": 0,
    });
    const data = {
      pages: [{
        name: 'EmptyPage',
        elements: [{
          elementName: 'target',
          selector: {
            css: "[data-qa='one']",
            fallback: { css: "[data-qa='two']" },
          },
        }],
      }],
    };
    const repo = new ElementRepository(page, data);
    const element = await repo.get('target', 'EmptyPage');
    // Both match zero; the terminal fallback is returned. Count remains 0 —
    // callers get a locator that will fail downstream actions rather than a
    // thrown resolution error, preserving the usual "element not found" UX.
    expect(await element.count()).toBe(0);
  });
});
