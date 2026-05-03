import { test, expect } from '@playwright/test';
import { ElementRepository } from '../src/repo/ElementRepository';
import { WebElement, PlatformElement } from '../src/types';
import { SelectionStrategy } from '../src/enum/Options';

// ---------------------------------------------------------------------------
// Shared mock data
// ---------------------------------------------------------------------------

const webMockData = {
  pages: [
    {
      name: 'TestPage',
      elements: [
        { elementName: 'button', selector: { css: 'button.primary' } },
        { elementName: 'input', selector: { id: 'email-input' } },
        { elementName: 'link', selector: { xpath: '//a[@href="/about"]' } },
      ],
    },
  ],
};

const multiPlatformMockData = {
  pages: [
    {
      name: 'LoginPage',
      platform: 'web',
      elements: [{ elementName: 'submitButton', selector: { css: 'button.web-submit' } }],
    },
    {
      name: 'LoginPageAndroid',
      platform: 'android',
      elements: [{ elementName: 'submitButton', selector: { xpath: '//android.widget.Button' } }],
    },
    {
      name: 'LoginPageIOS',
      platform: 'ios',
      elements: [{ elementName: 'submitButton', selector: { xpath: '//XCUIElementTypeButton' } }],
    },
  ],
};

// ---------------------------------------------------------------------------
// Mock page factory for web tests
// ---------------------------------------------------------------------------

function createMockLocator(overrides: Record<string, any> = {}): any {
  const self: any = {
    click: async () => {},
    fill: async (_text: string) => {},
    clear: async () => {},
    check: async () => {},
    uncheck: async () => {},
    hover: async () => {},
    dblclick: async () => {},
    scrollIntoViewIfNeeded: async () => {},
    pressSequentially: async (_text: string, _opts?: any) => {},
    setInputFiles: async (_path: string) => {},
    dispatchEvent: async (_event: string) => {},
    isVisible: async () => true,
    isEnabled: async () => true,
    isChecked: async () => false,
    textContent: async () => 'Hello',
    getAttribute: async (_name: string) => 'value',
    inputValue: async () => 'input-val',
    locator: (_sel: string) => createMockLocator(),
    count: async () => 3,
    all: async () => [createMockLocator(), createMockLocator()],
    first: () => self,
    nth: (_i: number) => createMockLocator(),
    filter: (_opts: any) => createMockLocator(),
    waitFor: async (_opts?: any) => {},
    ...overrides,
  };
  return self;
}

function createMockPage(locatorOverrides: Record<string, any> = {}): any {
  return {
    locator: (_sel: string) => createMockLocator(locatorOverrides),
    waitForSelector: async () => {},
  };
}

// ---------------------------------------------------------------------------
// Mock driver factory for platform tests
// ---------------------------------------------------------------------------

function createMockDriverElement(overrides: Record<string, any> = {}): any {
  return {
    click: async () => {},
    clearValue: async () => {},
    setValue: async (_v: any) => {},
    doubleClick: async () => {},
    isSelected: async () => false,
    isDisplayed: async () => true,
    isEnabled: async () => true,
    getText: async () => 'platform text',
    getAttribute: async (_n: string) => 'attr-value',
    getValue: async () => 'val',
    addValue: async (_c: string) => {},
    moveTo: async () => {},
    waitForDisplayed: async (_opts?: any) => {},
    waitForExist: async (_opts?: any) => {},
    elementId: 'elem-1',
    $: async (_sel: string) => createMockDriverElement(),
    $$: async (_sel: string) => [createMockDriverElement()],
    ...overrides,
  };
}

function createMockDriver(elements?: any[]): any {
  const mockEl = createMockDriverElement();
  return {
    $: async (_sel: string) => mockEl,
    $$: async (_sel: string) => elements ?? [mockEl, createMockDriverElement()],
    pause: async (_ms: number) => {},
    execute: async (_cmd: string, _args: any) => {},
  };
}

// ===========================================================================
// constructor — driver argument
// ===========================================================================

test.describe('constructor — driver argument', () => {
  test('stores driver and exposes it via getter', () => {
    const mockPage = createMockPage();
    const repo = new ElementRepository(mockPage, webMockData);
    expect(repo.driver).toBe(mockPage);
  });

  test('accepts optional timeout as third argument (capped at the attach probe ceiling)', async () => {
    // The configured timeout (5000) is the budget for downstream actions and
    // assertions. The resolver only uses it to bound a best-effort attach probe,
    // capped at 2000ms — see StrategyResolver.fromSelector.
    let capturedTimeout: number | undefined;
    const mockPage = {
      locator: (_sel: string) => createMockLocator({
        waitFor: async (opts?: any) => { capturedTimeout = opts?.timeout; },
      }),
    };
    const repo = new ElementRepository(mockPage, webMockData, 5000);
    await repo.get('button', 'TestPage');
    expect(capturedTimeout).toBe(2000);
  });
});

// ===========================================================================
// setDefaultTimeout
// ===========================================================================

test.describe('setDefaultTimeout', () => {
  test('changes the internal timeout without throwing', () => {
    const repo = new ElementRepository(createMockPage(), webMockData);
    // Should not throw
    repo.setDefaultTimeout(5000);
    repo.setDefaultTimeout(0);
    repo.setDefaultTimeout(60000);
  });

  test('new timeout is used by subsequent get calls (mock verifies waitFor is called, capped at the attach probe ceiling)', async () => {
    let capturedTimeout: number | undefined;
    const mockPage = {
      locator: (_sel: string) => createMockLocator({
        waitFor: async (opts?: any) => { capturedTimeout = opts?.timeout; },
      }),
    };
    const repo = new ElementRepository(mockPage, webMockData, 15000);
    repo.setDefaultTimeout(9999);
    await repo.get('button', 'TestPage');
    // 9999 is above the 2000ms attach probe cap — see StrategyResolver.fromSelector.
    expect(capturedTimeout).toBe(2000);
  });
});

// ===========================================================================
// getPagePlatform
// ===========================================================================

test.describe('getPagePlatform', () => {
  test('returns "web" when platform is not specified', () => {
    const repo = new ElementRepository(createMockPage(), webMockData);
    expect(repo.getPagePlatform('TestPage')).toBe('web');
  });

  test('returns explicit platform when set', () => {
    const repo = new ElementRepository(createMockDriver(), multiPlatformMockData);
    expect(repo.getPagePlatform('LoginPage')).toBe('web');
    expect(repo.getPagePlatform('LoginPageAndroid')).toBe('android');
    expect(repo.getPagePlatform('LoginPageIOS')).toBe('ios');
  });

  test('returns custom platform string as-is', () => {
    const repo = new ElementRepository(createMockPage(), {
      pages: [
        { name: 'DesktopPage', platform: 'macos', elements: [] },
        { name: 'WinPage', platform: 'windows', elements: [] },
      ],
    });
    expect(repo.getPagePlatform('DesktopPage')).toBe('macos');
    expect(repo.getPagePlatform('WinPage')).toBe('windows');
  });

  test('throws when page is not found', () => {
    const repo = new ElementRepository(createMockPage(), webMockData);
    expect(() => repo.getPagePlatform('NonExistentPage')).toThrow(
      "ElementRepository: Page 'NonExistentPage' not found."
    );
  });
});

// ===========================================================================
// get — platform branch
// ===========================================================================

test.describe('get — platform (android)', () => {
  test('returns a PlatformElement', async () => {
    const driver = createMockDriver();
    const repo = new ElementRepository(driver, multiPlatformMockData);
    const el = await repo.get('submitButton', 'LoginPageAndroid');
    expect(el).toBeInstanceOf(PlatformElement);
  });
});

// ===========================================================================
// getAll
// ===========================================================================

test.describe('getAll', () => {
  test('returns an array of WebElements for web platform', async () => {
    const page = createMockPage({ all: async () => [createMockLocator(), createMockLocator()] });
    const repo = new ElementRepository(page, webMockData);
    const elements = await repo.getAll('button', 'TestPage');
    expect(Array.isArray(elements)).toBe(true);
    expect(elements.length).toBeGreaterThanOrEqual(2);
    expect(elements[0]).toBeInstanceOf(WebElement);
  });

  test('returns an array of PlatformElements for android platform', async () => {
    const driver = createMockDriver([createMockDriverElement(), createMockDriverElement()]);
    const repo = new ElementRepository(driver, multiPlatformMockData);
    const elements = await repo.getAll('submitButton', 'LoginPageAndroid');
    expect(Array.isArray(elements)).toBe(true);
    expect(elements.length).toBe(2);
    expect(elements[0]).toBeInstanceOf(PlatformElement);
  });
});

// ===========================================================================
// getRandom
// ===========================================================================

test.describe('getRandom', () => {
  test('returns a WebElement when elements exist (web)', async () => {
    const page = createMockPage({ all: async () => [createMockLocator(), createMockLocator(), createMockLocator()] });
    const repo = new ElementRepository(page, webMockData);
    const el = await repo.getRandom('button', 'TestPage');
    expect(el).not.toBeNull();
    expect(el).toBeInstanceOf(WebElement);
  });

  test('returns null when no elements found (web, strict=false)', async () => {
    const page = createMockPage({ all: async () => [] });
    const repo = new ElementRepository(page, webMockData);
    const el = await repo.getRandom('button', 'TestPage', false);
    expect(el).toBeNull();
  });

  test('throws when no elements found (web, strict=true)', async () => {
    const page = createMockPage({ all: async () => [] });
    const repo = new ElementRepository(page, webMockData);
    await expect(repo.getRandom('button', 'TestPage', true)).rejects.toThrow(
      "No elements found for 'button' on 'TestPage'"
    );
  });

  test('returns a PlatformElement when elements exist (android)', async () => {
    const driver = createMockDriver([createMockDriverElement(), createMockDriverElement()]);
    const repo = new ElementRepository(driver, multiPlatformMockData);
    const el = await repo.getRandom('submitButton', 'LoginPageAndroid');
    expect(el).not.toBeNull();
    expect(el).toBeInstanceOf(PlatformElement);
  });

  test('returns null when no platform elements found (strict=false)', async () => {
    const driver = createMockDriver([]);
    const repo = new ElementRepository(driver, multiPlatformMockData);
    const el = await repo.getRandom('submitButton', 'LoginPageAndroid', false);
    expect(el).toBeNull();
  });

  test('throws when no platform elements found (strict=true)', async () => {
    const driver = createMockDriver([]);
    const repo = new ElementRepository(driver, multiPlatformMockData);
    await expect(repo.getRandom('submitButton', 'LoginPageAndroid', true)).rejects.toThrow(
      "No elements found for 'submitButton' on 'LoginPageAndroid'"
    );
  });
});

// ===========================================================================
// getByText
// ===========================================================================

test.describe('getByText', () => {
  test('returns a WebElement when text matches (web)', async () => {
    const matchLocator = createMockLocator({ textContent: async () => 'Click me' });
    const nonMatchLocator = createMockLocator({ textContent: async () => 'Other' });
    const baseLocator = createMockLocator({
      all: async () => [nonMatchLocator, matchLocator],
    });
    const mockPage = {
      locator: () => baseLocator,
    };
    const repo = new ElementRepository(mockPage, webMockData);
    const el = await repo.getByText('button', 'TestPage', 'Click me');
    expect(el).not.toBeNull();
    expect(el).toBeInstanceOf(WebElement);
  });

  test('returns null when text not found (web, strict=false)', async () => {
    const noMatchLocator = createMockLocator({ textContent: async () => 'Other' });
    const baseLocator = createMockLocator({ all: async () => [noMatchLocator] });
    const mockPage = { locator: () => baseLocator };
    const repo = new ElementRepository(mockPage, webMockData);
    const el = await repo.getByText('button', 'TestPage', 'Nonexistent Text', false);
    expect(el).toBeNull();
  });

  test('throws when text not found (web, strict=true)', async () => {
    const noMatchLocator = createMockLocator({ textContent: async () => 'Other' });
    const baseLocator = createMockLocator({ all: async () => [noMatchLocator] });
    const mockPage = { locator: () => baseLocator };
    const repo = new ElementRepository(mockPage, webMockData);
    await expect(
      repo.getByText('button', 'TestPage', 'Nonexistent Text', true)
    ).rejects.toThrow('Element \'button\' on \'TestPage\' with text "Nonexistent Text" not found.');
  });

  test('returns PlatformElement when text matches (android)', async () => {
    const matchingEl = createMockDriverElement({ getText: async () => 'Submit' });
    const nonMatchingEl = createMockDriverElement({ getText: async () => 'Cancel' });
    const driver = createMockDriver([nonMatchingEl, matchingEl]);
    const repo = new ElementRepository(driver, multiPlatformMockData);
    const el = await repo.getByText('submitButton', 'LoginPageAndroid', 'Submit');
    expect(el).not.toBeNull();
    expect(el).toBeInstanceOf(PlatformElement);
  });

  test('returns null when text not found on platform (strict=false)', async () => {
    const driver = createMockDriver([createMockDriverElement({ getText: async () => 'Cancel' })]);
    const repo = new ElementRepository(driver, multiPlatformMockData);
    const el = await repo.getByText('submitButton', 'LoginPageAndroid', 'Submit', false);
    expect(el).toBeNull();
  });

  test('throws when text not found on platform (strict=true)', async () => {
    const driver = createMockDriver([createMockDriverElement({ getText: async () => 'Cancel' })]);
    const repo = new ElementRepository(driver, multiPlatformMockData);
    await expect(
      repo.getByText('submitButton', 'LoginPageAndroid', 'Submit', true)
    ).rejects.toThrow('Element \'submitButton\' on \'LoginPageAndroid\' with text "Submit" not found.');
  });
});

// ===========================================================================
// getByAttribute
// ===========================================================================

test.describe('getByAttribute', () => {
  test('returns element with exact attribute match (web)', async () => {
    const matchLocator = createMockLocator({ getAttribute: async (_name: string) => 'btn-primary' });
    const nonMatchLocator = createMockLocator({ getAttribute: async (_name: string) => 'btn-secondary' });
    const baseLocator = createMockLocator({
      all: async () => [nonMatchLocator, matchLocator],
    });
    const mockPage = {
      locator: () => baseLocator,
      waitForSelector: async () => {},
    };
    const repo = new ElementRepository(mockPage, webMockData);
    const el = await repo.getByAttribute('button', 'TestPage', 'class', 'btn-primary');
    expect(el).not.toBeNull();
    expect(el).toBeInstanceOf(WebElement);
  });

  test('returns element with partial attribute match (exact=false)', async () => {
    const matchLocator = createMockLocator({ getAttribute: async (_name: string) => 'btn-primary active' });
    const baseLocator = createMockLocator({
      all: async () => [matchLocator],
    });
    const mockPage = {
      locator: () => baseLocator,
      waitForSelector: async () => {},
    };
    const repo = new ElementRepository(mockPage, webMockData);
    const el = await repo.getByAttribute('button', 'TestPage', 'class', 'primary', { exact: false });
    expect(el).not.toBeNull();
  });

  test('returns null when attribute not found (strict=false)', async () => {
    const noMatchLocator = createMockLocator({ getAttribute: async (_name: string) => 'something-else' });
    const baseLocator = createMockLocator({
      all: async () => [noMatchLocator],
    });
    const mockPage = {
      locator: () => baseLocator,
      waitForSelector: async () => {},
    };
    const repo = new ElementRepository(mockPage, webMockData);
    const el = await repo.getByAttribute('button', 'TestPage', 'class', 'nonexistent', { strict: false });
    expect(el).toBeNull();
  });

  test('throws when attribute not found (strict=true)', async () => {
    const noMatchLocator = createMockLocator({ getAttribute: async (_name: string) => 'something-else' });
    const baseLocator = createMockLocator({
      all: async () => [noMatchLocator],
    });
    const mockPage = {
      locator: () => baseLocator,
      waitForSelector: async () => {},
    };
    const repo = new ElementRepository(mockPage, webMockData);
    await expect(
      repo.getByAttribute('button', 'TestPage', 'class', 'nonexistent', { strict: true })
    ).rejects.toThrow('Element \'button\' on \'TestPage\' with attribute [class] matching "nonexistent" not found.');
  });

  test('throws with partial-match wording when exact=false and strict=true', async () => {
    const noMatchLocator = createMockLocator({ getAttribute: async (_name: string) => 'unrelated' });
    const baseLocator = createMockLocator({ all: async () => [noMatchLocator] });
    const mockPage = { locator: () => baseLocator, waitForSelector: async () => {} };
    const repo = new ElementRepository(mockPage, webMockData);
    await expect(
      repo.getByAttribute('button', 'TestPage', 'class', 'primary', { exact: false, strict: true })
    ).rejects.toThrow('containing');
  });

  test('skips element when getAttribute returns null', async () => {
    const nullLocator = createMockLocator({ getAttribute: async (_name: string) => null });
    const baseLocator = createMockLocator({ all: async () => [nullLocator] });
    const mockPage = { locator: () => baseLocator, waitForSelector: async () => {} };
    const repo = new ElementRepository(mockPage, webMockData);
    const el = await repo.getByAttribute('button', 'TestPage', 'data-id', 'x');
    expect(el).toBeNull();
  });

  test('defaults to exact-then-contains when exact is not specified', async () => {
    const exactLocator = createMockLocator({ getAttribute: async (_name: string) => 'btn-primary' });
    const partialLocator = createMockLocator({ getAttribute: async (_name: string) => 'btn-primary extra' });
    const baseLocator = createMockLocator({
      all: async () => [partialLocator, exactLocator],
    });
    const mockPage = { locator: () => baseLocator, waitForSelector: async () => {} };
    const repo = new ElementRepository(mockPage, webMockData);
    // Should prefer exact match even though partial match appears first
    const el = await repo.getByAttribute('button', 'TestPage', 'class', 'btn-primary');
    expect(el).not.toBeNull();
    const attr = await el!.getAttribute('class');
    expect(attr).toBe('btn-primary');
  });

  test('falls back to contains match when no exact match exists (default)', async () => {
    const partialLocator = createMockLocator({ getAttribute: async (_name: string) => 'btn-primary extra' });
    const baseLocator = createMockLocator({
      all: async () => [partialLocator],
    });
    const mockPage = { locator: () => baseLocator, waitForSelector: async () => {} };
    const repo = new ElementRepository(mockPage, webMockData);
    const el = await repo.getByAttribute('button', 'TestPage', 'class', 'btn-primary');
    expect(el).not.toBeNull();
  });
});

// ===========================================================================
// getByIndex
// ===========================================================================

test.describe('getByIndex', () => {
  test('returns the nth WebElement at valid index', async () => {
    const locators = Array.from({ length: 5 }, () => createMockLocator());
    const baseLocator = createMockLocator({ all: async () => locators });
    const mockPage = { locator: () => baseLocator };
    const repo = new ElementRepository(mockPage, webMockData);
    const el = await repo.getByIndex('button', 'TestPage', 2);
    expect(el).not.toBeNull();
    expect(el).toBeInstanceOf(WebElement);
  });

  test('returns null when index is out of bounds (web, strict=false)', async () => {
    const baseLocator = createMockLocator({ all: async () => [createMockLocator(), createMockLocator()] });
    const mockPage = { locator: () => baseLocator };
    const repo = new ElementRepository(mockPage, webMockData);
    const el = await repo.getByIndex('button', 'TestPage', 10, false);
    expect(el).toBeNull();
  });

  test('throws when index is out of bounds (web, strict=true)', async () => {
    const baseLocator = createMockLocator({ all: async () => [createMockLocator(), createMockLocator()] });
    const mockPage = { locator: () => baseLocator };
    const repo = new ElementRepository(mockPage, webMockData);
    await expect(
      repo.getByIndex('button', 'TestPage', 10, true)
    ).rejects.toThrow("Index 10 out of bounds for 'button' on 'TestPage' (found 2 elements).");
  });

  test('returns null when negative index (web, strict=false)', async () => {
    const baseLocator = createMockLocator({ all: async () => [createMockLocator(), createMockLocator(), createMockLocator()] });
    const mockPage = { locator: () => baseLocator };
    const repo = new ElementRepository(mockPage, webMockData);
    const el = await repo.getByIndex('button', 'TestPage', -1, false);
    expect(el).toBeNull();
  });

  test('returns PlatformElement at valid index (android)', async () => {
    const driver = createMockDriver([createMockDriverElement(), createMockDriverElement(), createMockDriverElement()]);
    const repo = new ElementRepository(driver, multiPlatformMockData);
    const el = await repo.getByIndex('submitButton', 'LoginPageAndroid', 1);
    expect(el).not.toBeNull();
    expect(el).toBeInstanceOf(PlatformElement);
  });

  test('returns null when platform index out of bounds (strict=false)', async () => {
    const driver = createMockDriver([createMockDriverElement()]);
    const repo = new ElementRepository(driver, multiPlatformMockData);
    const el = await repo.getByIndex('submitButton', 'LoginPageAndroid', 5, false);
    expect(el).toBeNull();
  });

  test('throws when platform index out of bounds (strict=true)', async () => {
    const driver = createMockDriver([createMockDriverElement()]);
    const repo = new ElementRepository(driver, multiPlatformMockData);
    await expect(
      repo.getByIndex('submitButton', 'LoginPageAndroid', 5, true)
    ).rejects.toThrow("Index 5 out of bounds for 'submitButton' on 'LoginPageAndroid' (found 1 elements).");
  });
});

// ===========================================================================
// getVisible
// ===========================================================================

test.describe('getVisible', () => {
  test('returns first visible element (web)', async () => {
    const hiddenLocator = createMockLocator({ isVisible: async () => false, all: async () => [] });
    const visibleLocator = createMockLocator({ isVisible: async () => true, all: async () => [] });
    const baseLocator = createMockLocator({
      all: async () => [hiddenLocator, visibleLocator],
    });
    const mockPage = { locator: () => baseLocator, waitForSelector: async () => {} };
    const repo = new ElementRepository(mockPage, webMockData);
    const el = await repo.getVisible('button', 'TestPage');
    expect(el).not.toBeNull();
    expect(el).toBeInstanceOf(WebElement);
  });

  test('returns null when no visible elements (strict=false)', async () => {
    const hiddenLocator = createMockLocator({ isVisible: async () => false, all: async () => [] });
    const baseLocator = createMockLocator({ all: async () => [hiddenLocator] });
    const mockPage = { locator: () => baseLocator, waitForSelector: async () => {} };
    const repo = new ElementRepository(mockPage, webMockData);
    const el = await repo.getVisible('button', 'TestPage', false);
    expect(el).toBeNull();
  });

  test('throws when no visible elements (strict=true)', async () => {
    const hiddenLocator = createMockLocator({ isVisible: async () => false, all: async () => [] });
    const baseLocator = createMockLocator({ all: async () => [hiddenLocator] });
    const mockPage = { locator: () => baseLocator, waitForSelector: async () => {} };
    const repo = new ElementRepository(mockPage, webMockData);
    await expect(
      repo.getVisible('button', 'TestPage', true)
    ).rejects.toThrow("No visible elements found for 'button' on 'TestPage'.");
  });
});

// ===========================================================================
// getByRole
// ===========================================================================

test.describe('getByRole', () => {
  test('returns element matching role attribute (web)', async () => {
    const btnLocator = createMockLocator({ getAttribute: async (name: string) => name === 'role' ? 'button' : null });
    const baseLocator = createMockLocator({ all: async () => [btnLocator] });
    const mockPage = { locator: () => baseLocator, waitForSelector: async () => {} };
    const repo = new ElementRepository(mockPage, webMockData);
    const el = await repo.getByRole('button', 'TestPage', 'button');
    expect(el).not.toBeNull();
    expect(el).toBeInstanceOf(WebElement);
  });

  test('returns null when role not found (strict=false)', async () => {
    const linkLocator = createMockLocator({ getAttribute: async (_name: string) => 'link' });
    const baseLocator = createMockLocator({ all: async () => [linkLocator] });
    const mockPage = { locator: () => baseLocator, waitForSelector: async () => {} };
    const repo = new ElementRepository(mockPage, webMockData);
    const el = await repo.getByRole('button', 'TestPage', 'button', false);
    expect(el).toBeNull();
  });

  test('throws when role not found (strict=true)', async () => {
    const linkLocator = createMockLocator({ getAttribute: async (_name: string) => 'link' });
    const baseLocator = createMockLocator({ all: async () => [linkLocator] });
    const mockPage = { locator: () => baseLocator, waitForSelector: async () => {} };
    const repo = new ElementRepository(mockPage, webMockData);
    await expect(
      repo.getByRole('button', 'TestPage', 'button', true)
    ).rejects.toThrow('Element \'button\' on \'TestPage\' with attribute [role] equal to "button" not found.');
  });
});

// ===========================================================================
// getSelector — additional strategies
// ===========================================================================

test.describe('getSelector — additional strategies', () => {
  const mockData = {
    pages: [{
      name: 'Page',
      elements: [
        { elementName: 'byText', selector: { text: 'Click here' } },
        { elementName: 'byTestId', selector: { testid: 'submit-btn' } },
        { elementName: 'byRole', selector: { role: 'navigation' } },
        { elementName: 'byPlaceholder', selector: { placeholder: 'Enter email' } },
        { elementName: 'byLabel', selector: { label: 'Search' } },
        { elementName: 'byDefault', selector: { custom: 'custom-value' } },
      ],
    }],
  };

  const repo = new ElementRepository(createMockPage(), mockData);

  test('text selector', () => {
    expect(repo.getSelector('byText', 'Page')).toBe('text=Click here');
  });

  test('testid selector', () => {
    expect(repo.getSelector('byTestId', 'Page')).toBe("[data-testid='submit-btn']");
  });

  test('role selector', () => {
    expect(repo.getSelector('byRole', 'Page')).toBe("[role='navigation']");
  });

  test('placeholder selector', () => {
    expect(repo.getSelector('byPlaceholder', 'Page')).toBe("[placeholder='Enter email']");
  });

  test('label selector', () => {
    expect(repo.getSelector('byLabel', 'Page')).toBe("[aria-label='Search']");
  });

  test('unknown strategy falls through to raw value', () => {
    expect(repo.getSelector('byDefault', 'Page')).toBe('custom-value');
  });
});

// ===========================================================================
// Error cases for getSelector and getSelectorRaw
// ===========================================================================

test.describe('Error cases', () => {
  const repo = new ElementRepository(createMockPage(), webMockData);

  test('getSelector throws when page not found', () => {
    expect(() => repo.getSelector('button', 'NonExistentPage')).toThrow(
      "ElementRepository: Page 'NonExistentPage' not found."
    );
  });

  test('getSelector throws when element not found', () => {
    expect(() => repo.getSelector('nonExistentElement', 'TestPage')).toThrow(
      "ElementRepository: Element 'nonExistentElement' not found on page 'TestPage'."
    );
  });

  test('getSelectorRaw throws when page not found', () => {
    expect(() => repo.getSelectorRaw('button', 'NonExistentPage')).toThrow(
      "ElementRepository: Page 'NonExistentPage' not found."
    );
  });

  test('getSelectorRaw throws when element not found', () => {
    expect(() => repo.getSelectorRaw('nonExistentElement', 'TestPage')).toThrow(
      "ElementRepository: Element 'nonExistentElement' not found on page 'TestPage'."
    );
  });

  test('getSelector throws when selector is empty', () => {
    const badData = {
      pages: [{ name: 'Bad', elements: [{ elementName: 'el', selector: {} }] }],
    };
    const badRepo = new ElementRepository(createMockPage(), badData as any);
    expect(() => badRepo.getSelector('el', 'Bad')).toThrow(
      "ElementRepository: Invalid selector for 'el'."
    );
  });
});

// ===========================================================================
// get — with ElementResolutionOptions
// ===========================================================================

test.describe('get — with ElementResolutionOptions', () => {
  test('default (no options) returns first element', async () => {
    const mockPage = createMockPage();
    const repo = new ElementRepository(mockPage, webMockData);
    const el = await repo.get('button', 'TestPage');
    expect(el).toBeInstanceOf(WebElement);
  });

  test('strategy INDEX returns nth element', async () => {
    const locators = [createMockLocator(), createMockLocator(), createMockLocator()];
    const baseLocator = createMockLocator({
      nth: (i: number) => locators[i],
      all: async () => locators,
      first: () => locators[0],
    });
    const mockPage = { locator: () => baseLocator };
    const repo = new ElementRepository(mockPage, webMockData);
    const el = await repo.get('button', 'TestPage', { strategy: SelectionStrategy.INDEX, index: 2 });
    expect(el).toBeInstanceOf(WebElement);
  });

  test('strategy INDEX throws when index is missing', async () => {
    const mockPage = createMockPage();
    const repo = new ElementRepository(mockPage, webMockData);
    await expect(
      repo.get('button', 'TestPage', { strategy: SelectionStrategy.INDEX })
    ).rejects.toThrow('options.index is required');
  });

  test('strategy RANDOM returns an element', async () => {
    const locators = [createMockLocator(), createMockLocator()];
    const baseLocator = createMockLocator({
      all: async () => locators,
      nth: (i: number) => locators[i],
      first: () => locators[0],
    });
    const mockPage = { locator: () => baseLocator };
    const repo = new ElementRepository(mockPage, webMockData);
    const el = await repo.get('button', 'TestPage', { strategy: SelectionStrategy.RANDOM });
    expect(el).toBeInstanceOf(WebElement);
  });

  test('strategy TEXT filters by text content', async () => {
    const matchLocator = createMockLocator({
      filter: () => createMockLocator({ first: () => createMockLocator() }),
    });
    const mockPage = { locator: () => matchLocator };
    const repo = new ElementRepository(mockPage, webMockData);
    const el = await repo.get('button', 'TestPage', { strategy: SelectionStrategy.TEXT, value: 'Submit' });
    expect(el).toBeInstanceOf(WebElement);
  });

  test('strategy TEXT throws when value is missing', async () => {
    const mockPage = createMockPage();
    const repo = new ElementRepository(mockPage, webMockData);
    await expect(
      repo.get('button', 'TestPage', { strategy: SelectionStrategy.TEXT })
    ).rejects.toThrow('options.value is required');
  });
});
