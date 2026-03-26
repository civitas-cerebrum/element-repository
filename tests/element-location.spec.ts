import { test, expect } from '@playwright/test';
import { ElementRepository } from '../src/repo/ElementRepository';
import { WebElement, PlatformElement } from '../src/types';

// ---------------------------------------------------------------------------
// Mock data covering all selector strategies
// ---------------------------------------------------------------------------

const webMockData = {
  pages: [
    {
      name: 'TestPage',
      elements: [
        { elementName: 'cssBtn', selector: { css: 'button.primary' } },
        { elementName: 'xpathLink', selector: { xpath: '//a[@href="/about"]' } },
        { elementName: 'idInput', selector: { id: 'email-input' } },
        { elementName: 'textHeading', selector: { text: 'Welcome' } },
        { elementName: 'testidBtn', selector: { testid: 'submit-btn' } },
        { elementName: 'roleNav', selector: { role: 'navigation' } },
        { elementName: 'placeholderInput', selector: { placeholder: 'Search...' } },
        { elementName: 'labelClose', selector: { label: 'Close dialog' } },
      ],
    },
  ],
};

const androidMockData = {
  pages: [
    {
      name: 'LoginPage',
      platform: 'android',
      elements: [
        { elementName: 'byAccessibilityId', selector: { 'accessibility id': 'LoginBtn' } },
        { elementName: 'byXpath', selector: { xpath: '//android.widget.Button' } },
        { elementName: 'byUiAutomator', selector: { uiautomator: 'new UiSelector().text("Go")' } },
        { elementName: 'byText', selector: { text: 'Submit' } },
      ],
    },
  ],
};

const iosMockData = {
  pages: [
    {
      name: 'LoginPage',
      platform: 'ios',
      elements: [
        { elementName: 'byPredicate', selector: { predicate: 'label == "Login"' } },
        { elementName: 'byClassChain', selector: { 'class chain': '**/XCUIElementTypeButton' } },
        { elementName: 'byText', selector: { text: 'Submit' } },
      ],
    },
  ],
};

// ---------------------------------------------------------------------------
// Helpers that capture selector arguments
// ---------------------------------------------------------------------------

function createCapturingMockLocator() {
  const locator: any = {
    click: async () => {},
    fill: async () => {},
    clear: async () => {},
    check: async () => {},
    uncheck: async () => {},
    hover: async () => {},
    dblclick: async () => {},
    scrollIntoViewIfNeeded: async () => {},
    pressSequentially: async () => {},
    setInputFiles: async () => {},
    dispatchEvent: async () => {},
    isVisible: async () => true,
    isEnabled: async () => true,
    isChecked: async () => false,
    textContent: async () => 'text',
    getAttribute: async () => 'attr',
    inputValue: async () => 'val',
    locator: () => createCapturingMockLocator(),
    count: async () => 1,
    all: async () => [locator],
    first: () => locator,
    nth: () => locator,
    filter: () => locator,
    waitFor: async () => {},
  };
  return locator;
}

function createCapturingPage() {
  const calls: { locator: string[]; waitForSelector: string[] } = {
    locator: [],
    waitForSelector: [],
  };
  const page = {
    locator: (sel: string) => {
      calls.locator.push(sel);
      return createCapturingMockLocator();
    },
    waitForSelector: async (sel: string) => {
      calls.waitForSelector.push(sel);
    },
  };
  return { page, calls };
}

function createCapturingDriver(elementOverrides: Record<string, any> = {}) {
  const calls: { $: string[]; $$: string[] } = { $: [], $$: [] };
  const mockEl: any = {
    click: async () => {},
    clearValue: async () => {},
    setValue: async () => {},
    doubleClick: async () => {},
    isSelected: async () => false,
    isDisplayed: async () => true,
    isEnabled: async () => true,
    getText: async () => 'text',
    getAttribute: async () => 'attr',
    getValue: async () => 'val',
    addValue: async () => {},
    moveTo: async () => {},
    waitForDisplayed: async () => {},
    waitForExist: async () => {},
    elementId: 'elem-1',
    $: async (sel: string) => { calls.$.push(sel); return mockEl; },
    $$: async (sel: string) => { calls.$$.push(sel); return [mockEl]; },
    ...elementOverrides,
  };
  const driver = {
    $: async (sel: string) => { calls.$.push(sel); return mockEl; },
    $$: async (sel: string) => { calls.$$.push(sel); return [mockEl]; },
    pause: async () => {},
    execute: async () => {},
  };
  return { driver, calls, mockEl };
}

// ===========================================================================
// Web: get() passes the correct formatted selector to page.locator()
// ===========================================================================

test.describe('Web element location — get()', () => {
  const expectedSelectors: Record<string, string> = {
    cssBtn: 'css=button.primary',
    xpathLink: 'xpath=//a[@href="/about"]',
    idInput: '#email-input',
    textHeading: 'text=Welcome',
    testidBtn: "[data-testid='submit-btn']",
    roleNav: "[role='navigation']",
    placeholderInput: "[placeholder='Search...']",
    labelClose: "[aria-label='Close dialog']",
  };

  for (const [elementName, expectedSelector] of Object.entries(expectedSelectors)) {
    test(`${elementName} → page.locator("${expectedSelector}")`, async () => {
      const { page, calls } = createCapturingPage();
      const repo = new ElementRepository(webMockData);
      await repo.get(page, 'TestPage', elementName);

      expect(calls.locator).toContain(expectedSelector);
    });
  }

  test('returns a WebElement wrapping the locator', async () => {
    const { page } = createCapturingPage();
    const repo = new ElementRepository(webMockData);
    const el = await repo.get(page, 'TestPage', 'cssBtn');
    expect(el).toBeInstanceOf(WebElement);
  });
});

// ===========================================================================
// Web: getAll() uses get() internally — same selector chain
// ===========================================================================

test.describe('Web element location — getAll()', () => {
  test('passes formatted selector to page.locator() and returns WebElements', async () => {
    const { page, calls } = createCapturingPage();
    const repo = new ElementRepository(webMockData);
    const elements = await repo.getAll(page, 'TestPage', 'xpathLink');

    expect(calls.locator).toContain('xpath=//a[@href="/about"]');
    expect(elements.length).toBeGreaterThanOrEqual(1);
    expect(elements[0]).toBeInstanceOf(WebElement);
  });
});

// ===========================================================================
// Web: getRandom() uses the correct selector
// ===========================================================================

test.describe('Web element location — getRandom()', () => {
  test('resolves selector and waits before returning element', async () => {
    const { page, calls } = createCapturingPage();
    const repo = new ElementRepository(webMockData);
    const el = await repo.getRandom(page, 'TestPage', 'idInput');

    expect(calls.locator).toContain('#email-input');
    expect(el).toBeInstanceOf(WebElement);
  });
});

// ===========================================================================
// Web: getByText() uses the correct selector
// ===========================================================================

test.describe('Web element location — getByText()', () => {
  test('resolves selector then filters by text', async () => {
    const { page, calls } = createCapturingPage();
    const repo = new ElementRepository(webMockData);
    // The mock locator's textContent returns 'text', so match on that
    const el = await repo.getByText(page, 'TestPage', 'cssBtn', 'text');

    expect(calls.locator).toContain('css=button.primary');
    expect(el).toBeInstanceOf(WebElement);
  });
});

// ===========================================================================
// Web: getByIndex() uses the correct selector
// ===========================================================================

test.describe('Web element location — getByIndex()', () => {
  test('resolves selector then picks nth element', async () => {
    const { page, calls } = createCapturingPage();
    const repo = new ElementRepository(webMockData);
    const el = await repo.getByIndex(page, 'TestPage', 'testidBtn', 0);

    expect(calls.locator).toContain("[data-testid='submit-btn']");
    expect(el).toBeInstanceOf(WebElement);
  });
});

// ===========================================================================
// Android: get() passes Appium-formatted selector to driver.$()
// ===========================================================================

test.describe('Android element location — get()', () => {
  const expectedSelectors: Record<string, string> = {
    byAccessibilityId: '~LoginBtn',
    byXpath: '//android.widget.Button',
    byUiAutomator: 'android=new UiSelector().text("Go")',
    byText: 'android=new UiSelector().text("Submit")',
  };

  for (const [elementName, expectedSelector] of Object.entries(expectedSelectors)) {
    test(`${elementName} → driver.$("${expectedSelector}")`, async () => {
      const { driver, calls } = createCapturingDriver();
      const repo = new ElementRepository(androidMockData, undefined, 'android');
      const el = await repo.get(driver, 'LoginPage', elementName);
      expect(el).toBeInstanceOf(PlatformElement);

      // PlatformElement calls driver.$() lazily on interaction
      await el.click();
      expect(calls.$).toContain(expectedSelector);
    });
  }
});

// ===========================================================================
// Android: getAll() passes Appium-formatted selector to driver.$$()
// ===========================================================================

test.describe('Android element location — getAll()', () => {
  test('passes Appium selector to driver.$$()', async () => {
    const { driver, calls } = createCapturingDriver();
    const repo = new ElementRepository(androidMockData, undefined, 'android');
    const elements = await repo.getAll(driver, 'LoginPage', 'byAccessibilityId');

    expect(calls.$$).toContain('~LoginBtn');
    expect(elements[0]).toBeInstanceOf(PlatformElement);
  });
});

// ===========================================================================
// Android: getByText() passes Appium selector to driver.$$()
// ===========================================================================

test.describe('Android element location — getByText()', () => {
  test('passes Appium selector and filters by getText()', async () => {
    const { driver, calls } = createCapturingDriver({ getText: async () => 'Submit' });
    const repo = new ElementRepository(androidMockData, undefined, 'android');
    const el = await repo.getByText(driver, 'LoginPage', 'byXpath', 'Submit');

    expect(calls.$$).toContain('//android.widget.Button');
    expect(el).toBeInstanceOf(PlatformElement);
  });
});

// ===========================================================================
// Android: getByIndex() passes Appium selector to driver.$$()
// ===========================================================================

test.describe('Android element location — getByIndex()', () => {
  test('passes Appium selector and picks nth element', async () => {
    const { driver, calls } = createCapturingDriver();
    const repo = new ElementRepository(androidMockData, undefined, 'android');
    const el = await repo.getByIndex(driver, 'LoginPage', 'byUiAutomator', 0);

    expect(calls.$$).toContain('android=new UiSelector().text("Go")');
    expect(el).toBeInstanceOf(PlatformElement);
  });
});

// ===========================================================================
// Android: getRandom() passes Appium selector to driver.$$()
// ===========================================================================

test.describe('Android element location — getRandom()', () => {
  test('passes Appium selector and picks random element', async () => {
    const { driver, calls } = createCapturingDriver();
    const repo = new ElementRepository(androidMockData, undefined, 'android');
    const el = await repo.getRandom(driver, 'LoginPage', 'byAccessibilityId');

    expect(calls.$$).toContain('~LoginBtn');
    expect(el).toBeInstanceOf(PlatformElement);
  });
});

// ===========================================================================
// iOS: get() passes iOS-formatted selectors to driver.$()
// ===========================================================================

test.describe('iOS element location — get()', () => {
  const expectedSelectors: Record<string, string> = {
    byPredicate: '-ios predicate string:label == "Login"',
    byClassChain: '-ios class chain:**/XCUIElementTypeButton',
    byText: '-ios predicate string:label == "Submit"',
  };

  for (const [elementName, expectedSelector] of Object.entries(expectedSelectors)) {
    test(`${elementName} → driver.$("${expectedSelector}")`, async () => {
      const { driver, calls } = createCapturingDriver();
      const repo = new ElementRepository(iosMockData, undefined, 'ios');
      const el = await repo.get(driver, 'LoginPage', elementName);
      expect(el).toBeInstanceOf(PlatformElement);

      // PlatformElement calls driver.$() lazily on interaction
      await el.click();
      expect(calls.$).toContain(expectedSelector);
    });
  }
});

// ===========================================================================
// Timeout propagation: waitForSelector receives configured timeout
// ===========================================================================

test.describe('Timeout propagation', () => {
  test('default timeout (15000) is passed to element.waitFor', async () => {
    let capturedTimeout: number | undefined;
    const page = {
      locator: () => createCapturingMockLocator(),
    };
    // Override waitFor on the locator returned by page.locator()
    const origLocator = page.locator;
    page.locator = (sel: string) => {
      const loc = origLocator(sel);
      loc.waitFor = async (opts?: any) => { capturedTimeout = opts?.timeout; };
      return loc;
    };
    const repo = new ElementRepository(webMockData);
    await repo.get(page, 'TestPage', 'cssBtn');
    expect(capturedTimeout).toBe(15000);
  });

  test('custom timeout from constructor is propagated', async () => {
    let capturedTimeout: number | undefined;
    const page = {
      locator: (_sel: string) => {
        const loc = createCapturingMockLocator();
        loc.waitFor = async (opts?: any) => { capturedTimeout = opts?.timeout; };
        return loc;
      },
    };
    const repo = new ElementRepository(webMockData, 5000);
    await repo.get(page, 'TestPage', 'cssBtn');
    expect(capturedTimeout).toBe(5000);
  });

  test('setDefaultTimeout updates the propagated timeout', async () => {
    let capturedTimeout: number | undefined;
    const page = {
      locator: (_sel: string) => {
        const loc = createCapturingMockLocator();
        loc.waitFor = async (opts?: any) => { capturedTimeout = opts?.timeout; };
        return loc;
      },
    };
    const repo = new ElementRepository(webMockData);
    repo.setDefaultTimeout(3000);
    await repo.get(page, 'TestPage', 'cssBtn');
    expect(capturedTimeout).toBe(3000);
  });
});

// ===========================================================================
// Platform isolation: same page name, different platforms get different selectors
// ===========================================================================

test.describe('Platform isolation', () => {
  const multiPlatformData = {
    pages: [
      {
        name: 'SharedPage',
        platform: 'web',
        elements: [{ elementName: 'btn', selector: { css: 'button.web' } }],
      },
      {
        name: 'SharedPage',
        platform: 'android',
        elements: [{ elementName: 'btn', selector: { xpath: '//android.widget.Button' } }],
      },
      {
        name: 'SharedPage',
        platform: 'ios',
        elements: [{ elementName: 'btn', selector: { 'accessibility id': 'MainBtn' } }],
      },
    ],
  };

  test('web repo resolves web selector', async () => {
    const { page, calls } = createCapturingPage();
    const repo = new ElementRepository(multiPlatformData, undefined, 'web');
    await repo.get(page, 'SharedPage', 'btn');
    expect(calls.locator).toContain('css=button.web');
  });

  test('android repo resolves android selector', async () => {
    const { driver, calls } = createCapturingDriver();
    const repo = new ElementRepository(multiPlatformData, undefined, 'android');
    const el = await repo.get(driver, 'SharedPage', 'btn');
    await el.click();
    expect(calls.$).toContain('//android.widget.Button');
  });

  test('ios repo resolves ios selector', async () => {
    const { driver, calls } = createCapturingDriver();
    const repo = new ElementRepository(multiPlatformData, undefined, 'ios');
    const el = await repo.get(driver, 'SharedPage', 'btn');
    await el.click();
    expect(calls.$).toContain('~MainBtn');
  });
});
