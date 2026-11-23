import { test, expect } from '@playwright/test';
import { ElementRepository } from '../src/repo/ElementRepository';
import { WebElement, PlatformElement } from '../src/types';
import { PLATFORMS, familyOf, isPlatformName, Platform, ElementRepositoryOptions } from '../src';

// ---------------------------------------------------------------------------
// Shared data: the same page name declared once per platform
// ---------------------------------------------------------------------------

const samePageData = {
  pages: [
    {
      name: 'LoginPage',
      platform: 'web' as const,
      elements: [{ elementName: 'submitButton', selector: { css: 'button.web-submit' } }],
    },
    {
      name: 'LoginPage',
      platform: 'android' as const,
      elements: [{ elementName: 'submitButton', selector: { xpath: '//android.widget.Button' } }],
    },
    {
      name: 'LoginPage',
      platform: 'ios' as const,
      elements: [{ elementName: 'submitButton', selector: { xpath: '//XCUIElementTypeButton' } }],
    },
    {
      name: 'SettingsPage',
      platform: 'android' as const,
      elements: [{ elementName: 'title', selector: { xpath: '//android.widget.TextView' } }],
    },
    {
      name: 'SettingsPage',
      platform: 'ios' as const,
      elements: [{ elementName: 'title', selector: { xpath: '//XCUIElementTypeStaticText' } }],
    },
    {
      // No platform field: counts as 'web'.
      name: 'HomePage',
      elements: [{ elementName: 'logo', selector: { css: 'img.logo' } }],
    },
  ],
};

// ---------------------------------------------------------------------------
// A driver that answers both Playwright (`locator`) and WebdriverIO (`$`/`$$`)
// calls, and records every selector it was asked for.
// ---------------------------------------------------------------------------

function createMockLocator(): any {
  const self: any = {
    click: async () => {},
    count: async () => 1,
    all: async () => [self],
    first: () => self,
    nth: () => self,
    filter: () => self,
    locator: () => self,
    waitFor: async () => {},
    isVisible: async () => true,
    textContent: async () => 'text',
  };
  return self;
}

function createMockDriverElement(): any {
  return {
    click: async () => {},
    isDisplayed: async () => true,
    getText: async () => 'text',
    getAttribute: async () => 'value',
    waitForExist: async () => {},
    waitForDisplayed: async () => {},
    elementId: 'elem-1',
    $: async () => createMockDriverElement(),
    $$: async () => [createMockDriverElement()],
  };
}

function createRecordingDriver(): { driver: any; selectors: string[] } {
  const selectors: string[] = [];
  const driver = {
    locator: (sel: string) => { selectors.push(sel); return createMockLocator(); },
    waitForSelector: async () => {},
    $: async (sel: string) => { selectors.push(sel); return createMockDriverElement(); },
    $$: async (sel: string) => { selectors.push(sel); return [createMockDriverElement()]; },
    pause: async () => {},
    execute: async () => {},
  };
  return { driver, selectors };
}

// ===========================================================================
// Platform vocabulary
// ===========================================================================

test.describe('Platform vocabulary', () => {
  test('familyOf maps web to playwright and every other platform to appium', () => {
    expect(familyOf('web')).toBe('playwright');
    expect(familyOf('android')).toBe('appium');
    expect(familyOf('ios')).toBe('appium');
    expect(familyOf('macos')).toBe('appium');
    expect(familyOf('windows')).toBe('appium');
  });

  test('PLATFORMS lists the five platforms', () => {
    expect([...PLATFORMS]).toEqual(['web', 'android', 'ios', 'macos', 'windows']);
  });

  test('isPlatformName accepts the five platforms and rejects anything else', () => {
    for (const p of PLATFORMS) expect(isPlatformName(p)).toBe(true);
    expect(isPlatformName('mobile')).toBe(false);
    expect(isPlatformName('IOS')).toBe(false);
    expect(isPlatformName(undefined)).toBe(false);
    expect(isPlatformName(42)).toBe(false);
  });

  test('familyOf rejects an unknown platform at runtime', () => {
    expect(() => familyOf('mobile' as Platform)).toThrow(/Unknown platform 'mobile'/);
  });
});

// ===========================================================================
// Platform-aware page lookup
// ===========================================================================

test.describe('ElementRepository — active platform lookup', () => {
  test('the same page name resolves per active platform (element type and selector)', async () => {
    const web = createRecordingDriver();
    const webRepo = new ElementRepository(web.driver, samePageData, { platform: 'web' });
    const webEl = await webRepo.get('submitButton', 'LoginPage');
    expect(webEl).toBeInstanceOf(WebElement);
    expect(web.selectors).toContain('css=button.web-submit');
    expect(webRepo.getSelector('submitButton', 'LoginPage')).toBe('css=button.web-submit');

    const android = createRecordingDriver();
    const androidRepo = new ElementRepository(android.driver, samePageData, { platform: 'android' });
    const androidEl = await androidRepo.get('submitButton', 'LoginPage');
    expect(androidEl).toBeInstanceOf(PlatformElement);
    expect(android.selectors).toContain('//android.widget.Button');
    expect(androidRepo.getSelector('submitButton', 'LoginPage')).toBe('//android.widget.Button');

    const ios = createRecordingDriver();
    const iosRepo = new ElementRepository(ios.driver, samePageData, { platform: 'ios' });
    const iosEl = await iosRepo.get('submitButton', 'LoginPage');
    expect(iosEl).toBeInstanceOf(PlatformElement);
    expect(ios.selectors).toContain('//XCUIElementTypeButton');
    expect(iosRepo.getSelector('submitButton', 'LoginPage')).toBe('//XCUIElementTypeButton');
  });

  test('every page-resolving method uses the active platform', async () => {
    const { driver, selectors } = createRecordingDriver();
    const repo = new ElementRepository(driver, samePageData, { platform: 'ios' });

    expect(repo.getPagePlatform('LoginPage')).toBe('ios');
    expect(repo.getSelectorRaw('submitButton', 'LoginPage')).toEqual({ strategy: 'xpath', value: '//XCUIElementTypeButton' });
    expect(repo.getElementMeta('submitButton', 'LoginPage')).toEqual({ provisional: false, list: false });

    const all = await repo.getAll('submitButton', 'LoginPage');
    expect(all[0]).toBeInstanceOf(PlatformElement);
    const random = await repo.getRandom('submitButton', 'LoginPage', true);
    expect(random).toBeInstanceOf(PlatformElement);
    const byIndex = await repo.getByIndex('submitButton', 'LoginPage', 0, true);
    expect(byIndex).toBeInstanceOf(PlatformElement);

    expect(selectors.length).toBeGreaterThan(0);
    for (const sel of selectors) expect(sel).toBe('//XCUIElementTypeButton');
  });

  test('a page without a platform field counts as web', async () => {
    const { driver, selectors } = createRecordingDriver();
    const repo = new ElementRepository(driver, samePageData, { platform: 'web' });
    const el = await repo.get('logo', 'HomePage');
    expect(el).toBeInstanceOf(WebElement);
    expect(selectors).toContain('css=img.logo');
    expect(repo.getPagePlatform('HomePage')).toBe('web');
  });

  test('throws a clear error when the page exists only for other platforms', async () => {
    const { driver } = createRecordingDriver();
    const repo = new ElementRepository(driver, samePageData, { platform: 'web' });
    const expected = new RegExp(`^${escapeRegExp('Page "SettingsPage" has no entry for platform "web". Available: android, ios.')}$`);
    expect(() => repo.getPagePlatform('SettingsPage')).toThrow(expected);
    expect(() => repo.getSelector('title', 'SettingsPage')).toThrow(expected);
    expect(() => repo.getSelectorRaw('title', 'SettingsPage')).toThrow(expected);
    expect(() => repo.getElementMeta('title', 'SettingsPage')).toThrow(expected);
    await expect(repo.get('title', 'SettingsPage')).rejects.toThrow(expected);
    await expect(repo.getAll('title', 'SettingsPage')).rejects.toThrow(expected);
    await expect(repo.getByText('title', 'SettingsPage', 'x', true)).rejects.toThrow(expected);
  });

  test('with an active platform, a page missing on every platform lists none', () => {
    const { driver } = createRecordingDriver();
    const repo = new ElementRepository(driver, samePageData, { platform: 'ios' });
    expect(() => repo.getPagePlatform('NoSuchPage'))
      .toThrow(new RegExp(`^${escapeRegExp('Page "NoSuchPage" has no entry for platform "ios". Available: none.')}$`));
  });

  test('without an active platform, a missing page keeps the existing message', () => {
    const repo = new ElementRepository(createRecordingDriver().driver, samePageData);
    expect(() => repo.getPagePlatform('NoSuchPage')).toThrow("ElementRepository: Page 'NoSuchPage' not found.");
  });

  test('two repositories on the same data with different platforms do not affect each other', async () => {
    const a = createRecordingDriver();
    const b = createRecordingDriver();
    const androidRepo = new ElementRepository(a.driver, samePageData, { platform: 'android' });
    const iosRepo = new ElementRepository(b.driver, samePageData, { platform: 'ios' });

    expect(androidRepo.platform).toBe('android');
    expect(iosRepo.platform).toBe('ios');

    await androidRepo.get('submitButton', 'LoginPage');
    await iosRepo.get('submitButton', 'LoginPage');
    await androidRepo.get('submitButton', 'LoginPage');

    expect(a.selectors.every((s) => s === '//android.widget.Button')).toBe(true);
    expect(b.selectors.every((s) => s === '//XCUIElementTypeButton')).toBe(true);
    expect(androidRepo.getSelector('submitButton', 'LoginPage')).toBe('//android.widget.Button');
    expect(iosRepo.getSelector('submitButton', 'LoginPage')).toBe('//XCUIElementTypeButton');

    // A repository with no active platform is untouched by the other two.
    const plain = new ElementRepository(createRecordingDriver().driver, samePageData);
    expect(plain.platform).toBeUndefined();
    expect(plain.getPagePlatform('LoginPage')).toBe('web');
  });
});

// ===========================================================================
// Constructor forms
// ===========================================================================

test.describe('ElementRepository — constructor forms', () => {
  test('positional form keeps first-name-match lookup and has no active platform', async () => {
    const { driver, selectors } = createRecordingDriver();
    const repo = new ElementRepository(driver, samePageData, 5000);
    expect(repo.platform).toBeUndefined();
    // First 'LoginPage' in the file is the web one.
    expect(repo.getPagePlatform('LoginPage')).toBe('web');
    const el = await repo.get('submitButton', 'LoginPage');
    expect(el).toBeInstanceOf(WebElement);
    expect(selectors).toContain('css=button.web-submit');
    // First 'SettingsPage' is android.
    expect(repo.getPagePlatform('SettingsPage')).toBe('android');
  });

  test('positional form without a timeout still works', () => {
    const repo = new ElementRepository(createRecordingDriver().driver, samePageData);
    expect(repo.platform).toBeUndefined();
    expect(repo.getPagePlatform('SettingsPage')).toBe('android');
  });

  test('options form with only a timeout: timeout applies, no active platform', async () => {
    let capturedTimeout: number | undefined;
    const driver = {
      locator: () => {
        const loc = createMockLocator();
        loc.waitFor = async (opts?: any) => { capturedTimeout = opts?.timeout; };
        return loc;
      },
    };
    const repo = new ElementRepository(driver, samePageData, { timeout: 1234 });
    expect(repo.platform).toBeUndefined();
    expect(repo.getPagePlatform('LoginPage')).toBe('web');
    await repo.get('submitButton', 'LoginPage');
    // 1234 is under the resolver's 2000 ms attach-probe ceiling, so it is used as-is.
    expect(capturedTimeout).toBe(1234);
  });

  test('options form with an empty object behaves like the positional form', () => {
    const repo = new ElementRepository(createRecordingDriver().driver, samePageData, {});
    expect(repo.platform).toBeUndefined();
    expect(repo.getPagePlatform('SettingsPage')).toBe('android');
  });

  test('an unknown platform option throws a clear error', () => {
    const { driver } = createRecordingDriver();
    expect(() => new ElementRepository(driver, samePageData, { platform: 'mobile' as Platform }))
      .toThrow("ElementRepository: unknown platform 'mobile'. Expected one of: web, android, ios, macos, windows.");
  });

  test('the active platform is read-only', () => {
    const repo = new ElementRepository(createRecordingDriver().driver, samePageData, { platform: 'ios' });
    try { (repo as any).platform = 'android'; } catch { /* getter-only: throws in strict mode */ }
    expect(repo.platform).toBe('ios');
  });
});

// ===========================================================================
// The shared three-platform page repository shape
// ===========================================================================

test.describe('ElementRepository — three-platform LoginPage repository', () => {
  const loginJson = JSON.parse(`{ "pages": [
  { "name": "LoginPage", "platform": "web",     "elements": [ { "elementName": "submit", "selector": { "css": "button[type=submit]" } } ] },
  { "name": "LoginPage", "platform": "android", "elements": [ { "elementName": "submit", "selector": { "accessibility id": "login-submit" } } ] },
  { "name": "LoginPage", "platform": "ios",     "elements": [ { "elementName": "submit", "selector": { "accessibility id": "login-submit" } } ] }
] }`);

  const cases: Array<{ platform: Platform; type: unknown; selector: string }> = [
    { platform: 'web', type: WebElement, selector: 'css=button[type=submit]' },
    { platform: 'android', type: PlatformElement, selector: '~login-submit' },
    { platform: 'ios', type: PlatformElement, selector: '~login-submit' },
  ];

  for (const c of cases) {
    test(`resolves submit on ${c.platform}`, async () => {
      const { driver, selectors } = createRecordingDriver();
      const options: ElementRepositoryOptions = { platform: c.platform };
      const repo = new ElementRepository(driver, loginJson, options);
      expect(repo.getPagePlatform('LoginPage')).toBe(c.platform);
      expect(repo.getSelector('submit', 'LoginPage')).toBe(c.selector);
      const el = await repo.get('submit', 'LoginPage');
      expect(el).toBeInstanceOf(c.type as any);
      expect(selectors).toContain(c.selector);
    });
  }
});

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
