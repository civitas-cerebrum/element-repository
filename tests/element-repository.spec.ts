import { test, expect } from '@playwright/test';
import { ElementRepository } from '../src/ElementRepository';
import { WebElement, PlatformElement } from '../src/types';

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
      name: 'LoginPage',
      platform: 'android',
      elements: [{ elementName: 'submitButton', selector: { xpath: '//android.widget.Button' } }],
    },
    {
      name: 'LoginPage',
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
    first: () => createMockLocator(),
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
// setDefaultTimeout
// ===========================================================================

test.describe('setDefaultTimeout', () => {
  test('changes the internal timeout without throwing', () => {
    const repo = new ElementRepository(webMockData);
    // Should not throw
    repo.setDefaultTimeout(5000);
    repo.setDefaultTimeout(0);
    repo.setDefaultTimeout(60000);
  });

  test('new timeout is used by subsequent get calls (mock verifies waitForSelector is called)', async () => {
    let capturedTimeout: number | undefined;
    const mockPage = {
      locator: (_sel: string) => createMockLocator(),
      waitForSelector: async (_sel: string, opts: any) => {
        capturedTimeout = opts?.timeout;
      },
    };
    const repo = new ElementRepository(webMockData, 15000, 'web');
    repo.setDefaultTimeout(9999);
    await repo.get(mockPage, 'TestPage', 'button');
    expect(capturedTimeout).toBe(9999);
  });
});

// ===========================================================================
// get — platform branch
// ===========================================================================

test.describe('get — platform (android)', () => {
  test('returns a PlatformElement', async () => {
    const repo = new ElementRepository(multiPlatformMockData, undefined, 'android');
    const driver = createMockDriver();
    const el = await repo.get(driver, 'LoginPage', 'submitButton');
    expect(el).toBeInstanceOf(PlatformElement);
  });
});

// ===========================================================================
// getAll
// ===========================================================================

test.describe('getAll', () => {
  test('returns an array of WebElements for web platform', async () => {
    const repo = new ElementRepository(webMockData);
    const page = createMockPage({ all: async () => [createMockLocator(), createMockLocator()] });
    const elements = await repo.getAll(page, 'TestPage', 'button');
    expect(Array.isArray(elements)).toBe(true);
    expect(elements.length).toBeGreaterThanOrEqual(2);
    expect(elements[0]).toBeInstanceOf(WebElement);
  });

  test('returns an array of PlatformElements for android platform', async () => {
    const repo = new ElementRepository(multiPlatformMockData, undefined, 'android');
    const driver = createMockDriver([createMockDriverElement(), createMockDriverElement()]);
    const elements = await repo.getAll(driver, 'LoginPage', 'submitButton');
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
    const page = createMockPage({ count: async () => 3 });
    const repo = new ElementRepository(webMockData);
    const el = await repo.getRandom(page, 'TestPage', 'button');
    expect(el).not.toBeNull();
    expect(el).toBeInstanceOf(WebElement);
  });

  test('returns null when no elements found (web, strict=false)', async () => {
    const page = createMockPage({ count: async () => 0 });
    const repo = new ElementRepository(webMockData);
    const el = await repo.getRandom(page, 'TestPage', 'button', false);
    expect(el).toBeNull();
  });

  test('throws when no elements found (web, strict=true)', async () => {
    const page = createMockPage({ count: async () => 0 });
    const repo = new ElementRepository(webMockData);
    await expect(repo.getRandom(page, 'TestPage', 'button', true)).rejects.toThrow(
      "No elements found for 'button' on 'TestPage'"
    );
  });

  test('returns a PlatformElement when elements exist (android)', async () => {
    const repo = new ElementRepository(multiPlatformMockData, undefined, 'android');
    const driver = createMockDriver([createMockDriverElement(), createMockDriverElement()]);
    const el = await repo.getRandom(driver, 'LoginPage', 'submitButton');
    expect(el).not.toBeNull();
    expect(el).toBeInstanceOf(PlatformElement);
  });

  test('returns null when no platform elements found (strict=false)', async () => {
    const repo = new ElementRepository(multiPlatformMockData, undefined, 'android');
    const driver = { $: async () => createMockDriverElement(), $$: async () => [], pause: async () => {}, execute: async () => {} };
    const el = await repo.getRandom(driver, 'LoginPage', 'submitButton', false);
    expect(el).toBeNull();
  });

  test('throws when no platform elements found (strict=true)', async () => {
    const repo = new ElementRepository(multiPlatformMockData, undefined, 'android');
    const driver = { $: async () => createMockDriverElement(), $$: async () => [], pause: async () => {}, execute: async () => {} };
    await expect(repo.getRandom(driver, 'LoginPage', 'submitButton', true)).rejects.toThrow(
      "No elements found for 'submitButton' on 'LoginPage'"
    );
  });
});

// ===========================================================================
// getByText
// ===========================================================================

test.describe('getByText', () => {
  test('returns a WebElement when text matches (web)', async () => {
    const matchLocator = createMockLocator({ count: async () => 1 });
    const baseLocator = createMockLocator({
      filter: (_opts: any) => matchLocator,
    });
    const mockPage = {
      locator: () => baseLocator,
      waitForSelector: async () => {},
    };
    const repo = new ElementRepository(webMockData);
    const el = await repo.getByText(mockPage, 'TestPage', 'button', 'Click me');
    expect(el).not.toBeNull();
    expect(el).toBeInstanceOf(WebElement);
  });

  test('returns null when text not found (web, strict=false)', async () => {
    // The code does: baseEl.filter({hasText}).first(), then checks .count() === 0
    // chain: baseLocator -> filter() -> filteredLocator -> first() -> firstLocator (count=0)
    const firstLocator = createMockLocator({ count: async () => 0 });
    const filteredLocator = createMockLocator({ first: () => firstLocator });
    const baseLocator = createMockLocator({ filter: (_opts: any) => filteredLocator });
    const mockPage = {
      locator: () => baseLocator,
      waitForSelector: async () => {},
    };
    const repo = new ElementRepository(webMockData);
    const el = await repo.getByText(mockPage, 'TestPage', 'button', 'Nonexistent Text', false);
    expect(el).toBeNull();
  });

  test('throws when text not found (web, strict=true)', async () => {
    const firstLocator = createMockLocator({ count: async () => 0 });
    const filteredLocator = createMockLocator({ first: () => firstLocator });
    const baseLocator = createMockLocator({ filter: (_opts: any) => filteredLocator });
    const mockPage = {
      locator: () => baseLocator,
      waitForSelector: async () => {},
    };
    const repo = new ElementRepository(webMockData);
    await expect(
      repo.getByText(mockPage, 'TestPage', 'button', 'Nonexistent Text', true)
    ).rejects.toThrow('Element \'button\' on \'TestPage\' with text "Nonexistent Text" not found.');
  });

  test('returns PlatformElement when text matches (android)', async () => {
    const matchingEl = createMockDriverElement({ getText: async () => 'Submit' });
    const nonMatchingEl = createMockDriverElement({ getText: async () => 'Cancel' });
    const driver = {
      $: async () => matchingEl,
      $$: async () => [nonMatchingEl, matchingEl],
      pause: async () => {},
      execute: async () => {},
    };
    const repo = new ElementRepository(multiPlatformMockData, undefined, 'android');
    const el = await repo.getByText(driver, 'LoginPage', 'submitButton', 'Submit');
    expect(el).not.toBeNull();
    expect(el).toBeInstanceOf(PlatformElement);
  });

  test('returns null when text not found on platform (strict=false)', async () => {
    const driver = {
      $: async () => createMockDriverElement({ getText: async () => 'Cancel' }),
      $$: async () => [createMockDriverElement({ getText: async () => 'Cancel' })],
      pause: async () => {},
      execute: async () => {},
    };
    const repo = new ElementRepository(multiPlatformMockData, undefined, 'android');
    const el = await repo.getByText(driver, 'LoginPage', 'submitButton', 'Submit', false);
    expect(el).toBeNull();
  });

  test('throws when text not found on platform (strict=true)', async () => {
    const driver = {
      $: async () => createMockDriverElement({ getText: async () => 'Cancel' }),
      $$: async () => [createMockDriverElement({ getText: async () => 'Cancel' })],
      pause: async () => {},
      execute: async () => {},
    };
    const repo = new ElementRepository(multiPlatformMockData, undefined, 'android');
    await expect(
      repo.getByText(driver, 'LoginPage', 'submitButton', 'Submit', true)
    ).rejects.toThrow('Element \'submitButton\' on \'LoginPage\' with text "Submit" not found.');
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
    const repo = new ElementRepository(webMockData);
    const el = await repo.getByAttribute(mockPage, 'TestPage', 'button', 'class', 'btn-primary');
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
    const repo = new ElementRepository(webMockData);
    const el = await repo.getByAttribute(mockPage, 'TestPage', 'button', 'class', 'primary', { exact: false });
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
    const repo = new ElementRepository(webMockData);
    const el = await repo.getByAttribute(mockPage, 'TestPage', 'button', 'class', 'nonexistent', { strict: false });
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
    const repo = new ElementRepository(webMockData);
    await expect(
      repo.getByAttribute(mockPage, 'TestPage', 'button', 'class', 'nonexistent', { strict: true })
    ).rejects.toThrow('Element \'button\' on \'TestPage\' with attribute [class] equal to "nonexistent" not found.');
  });

  test('throws with partial-match wording when exact=false and strict=true', async () => {
    const noMatchLocator = createMockLocator({ getAttribute: async (_name: string) => 'unrelated' });
    const baseLocator = createMockLocator({ all: async () => [noMatchLocator] });
    const mockPage = { locator: () => baseLocator, waitForSelector: async () => {} };
    const repo = new ElementRepository(webMockData);
    await expect(
      repo.getByAttribute(mockPage, 'TestPage', 'button', 'class', 'primary', { exact: false, strict: true })
    ).rejects.toThrow('containing');
  });

  test('skips element when getAttribute returns null', async () => {
    const nullLocator = createMockLocator({ getAttribute: async (_name: string) => null });
    const baseLocator = createMockLocator({ all: async () => [nullLocator] });
    const mockPage = { locator: () => baseLocator, waitForSelector: async () => {} };
    const repo = new ElementRepository(webMockData);
    const el = await repo.getByAttribute(mockPage, 'TestPage', 'button', 'data-id', 'x');
    expect(el).toBeNull();
  });
});

// ===========================================================================
// getByIndex
// ===========================================================================

test.describe('getByIndex', () => {
  test('returns the nth WebElement at valid index', async () => {
    const nthLocator = createMockLocator();
    const baseLocator = createMockLocator({
      count: async () => 5,
      nth: (_i: number) => nthLocator,
    });
    const mockPage = { locator: () => baseLocator, waitForSelector: async () => {} };
    const repo = new ElementRepository(webMockData);
    const el = await repo.getByIndex(mockPage, 'TestPage', 'button', 2);
    expect(el).not.toBeNull();
    expect(el).toBeInstanceOf(WebElement);
  });

  test('returns null when index is out of bounds (web, strict=false)', async () => {
    const baseLocator = createMockLocator({ count: async () => 2 });
    const mockPage = { locator: () => baseLocator, waitForSelector: async () => {} };
    const repo = new ElementRepository(webMockData);
    const el = await repo.getByIndex(mockPage, 'TestPage', 'button', 10, false);
    expect(el).toBeNull();
  });

  test('throws when index is out of bounds (web, strict=true)', async () => {
    const baseLocator = createMockLocator({ count: async () => 2 });
    const mockPage = { locator: () => baseLocator, waitForSelector: async () => {} };
    const repo = new ElementRepository(webMockData);
    await expect(
      repo.getByIndex(mockPage, 'TestPage', 'button', 10, true)
    ).rejects.toThrow("Index 10 out of bounds for 'button' on 'TestPage' (found 2 elements).");
  });

  test('returns null when negative index (web, strict=false)', async () => {
    const baseLocator = createMockLocator({ count: async () => 3 });
    const mockPage = { locator: () => baseLocator, waitForSelector: async () => {} };
    const repo = new ElementRepository(webMockData);
    const el = await repo.getByIndex(mockPage, 'TestPage', 'button', -1, false);
    expect(el).toBeNull();
  });

  test('returns PlatformElement at valid index (android)', async () => {
    const driver = createMockDriver([createMockDriverElement(), createMockDriverElement(), createMockDriverElement()]);
    const repo = new ElementRepository(multiPlatformMockData, undefined, 'android');
    const el = await repo.getByIndex(driver, 'LoginPage', 'submitButton', 1);
    expect(el).not.toBeNull();
    expect(el).toBeInstanceOf(PlatformElement);
  });

  test('returns null when platform index out of bounds (strict=false)', async () => {
    const driver = createMockDriver([createMockDriverElement()]);
    const repo = new ElementRepository(multiPlatformMockData, undefined, 'android');
    const el = await repo.getByIndex(driver, 'LoginPage', 'submitButton', 5, false);
    expect(el).toBeNull();
  });

  test('throws when platform index out of bounds (strict=true)', async () => {
    const driver = createMockDriver([createMockDriverElement()]);
    const repo = new ElementRepository(multiPlatformMockData, undefined, 'android');
    await expect(
      repo.getByIndex(driver, 'LoginPage', 'submitButton', 5, true)
    ).rejects.toThrow("Index 5 out of bounds for 'submitButton' on 'LoginPage' (found 1 elements).");
  });
});

// ===========================================================================
// getVisible
// ===========================================================================

test.describe('getVisible', () => {
  test('returns first visible element (web)', async () => {
    const hiddenLocator = createMockLocator({ isVisible: async () => false, all: async () => [] });
    const visibleLocator = createMockLocator({ isVisible: async () => true, all: async () => [] });
    // getAll calls get() -> page.locator() and then el.all()
    // We need the base locator's all() to return [hiddenLocator, visibleLocator]
    const baseLocator = createMockLocator({
      all: async () => [hiddenLocator, visibleLocator],
    });
    const mockPage = { locator: () => baseLocator, waitForSelector: async () => {} };
    const repo = new ElementRepository(webMockData);
    const el = await repo.getVisible(mockPage, 'TestPage', 'button');
    expect(el).not.toBeNull();
    expect(el).toBeInstanceOf(WebElement);
  });

  test('returns null when no visible elements (strict=false)', async () => {
    const hiddenLocator = createMockLocator({ isVisible: async () => false, all: async () => [] });
    const baseLocator = createMockLocator({ all: async () => [hiddenLocator] });
    const mockPage = { locator: () => baseLocator, waitForSelector: async () => {} };
    const repo = new ElementRepository(webMockData);
    const el = await repo.getVisible(mockPage, 'TestPage', 'button', false);
    expect(el).toBeNull();
  });

  test('throws when no visible elements (strict=true)', async () => {
    const hiddenLocator = createMockLocator({ isVisible: async () => false, all: async () => [] });
    const baseLocator = createMockLocator({ all: async () => [hiddenLocator] });
    const mockPage = { locator: () => baseLocator, waitForSelector: async () => {} };
    const repo = new ElementRepository(webMockData);
    await expect(
      repo.getVisible(mockPage, 'TestPage', 'button', true)
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
    const repo = new ElementRepository(webMockData);
    const el = await repo.getByRole(mockPage, 'TestPage', 'button', 'button');
    expect(el).not.toBeNull();
    expect(el).toBeInstanceOf(WebElement);
  });

  test('returns null when role not found (strict=false)', async () => {
    const linkLocator = createMockLocator({ getAttribute: async (_name: string) => 'link' });
    const baseLocator = createMockLocator({ all: async () => [linkLocator] });
    const mockPage = { locator: () => baseLocator, waitForSelector: async () => {} };
    const repo = new ElementRepository(webMockData);
    const el = await repo.getByRole(mockPage, 'TestPage', 'button', 'button', false);
    expect(el).toBeNull();
  });

  test('throws when role not found (strict=true)', async () => {
    const linkLocator = createMockLocator({ getAttribute: async (_name: string) => 'link' });
    const baseLocator = createMockLocator({ all: async () => [linkLocator] });
    const mockPage = { locator: () => baseLocator, waitForSelector: async () => {} };
    const repo = new ElementRepository(webMockData);
    await expect(
      repo.getByRole(mockPage, 'TestPage', 'button', 'button', true)
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

  const repo = new ElementRepository(mockData);

  test('text selector', () => {
    expect(repo.getSelector('Page', 'byText')).toBe('text=Click here');
  });

  test('testid selector', () => {
    expect(repo.getSelector('Page', 'byTestId')).toBe("[data-testid='submit-btn']");
  });

  test('role selector', () => {
    expect(repo.getSelector('Page', 'byRole')).toBe("[role='navigation']");
  });

  test('placeholder selector', () => {
    expect(repo.getSelector('Page', 'byPlaceholder')).toBe("[placeholder='Enter email']");
  });

  test('label selector', () => {
    expect(repo.getSelector('Page', 'byLabel')).toBe("[aria-label='Search']");
  });

  test('unknown strategy falls through to raw value', () => {
    expect(repo.getSelector('Page', 'byDefault')).toBe('custom-value');
  });
});

// ===========================================================================
// Error cases for getSelector and getSelectorRaw
// ===========================================================================

test.describe('Error cases', () => {
  const repo = new ElementRepository(webMockData);

  test('getSelector throws when page not found', () => {
    expect(() => repo.getSelector('NonExistentPage', 'button')).toThrow(
      "ElementRepository: Page 'NonExistentPage' not found for platform 'web'."
    );
  });

  test('getSelector throws when element not found', () => {
    expect(() => repo.getSelector('TestPage', 'nonExistentElement')).toThrow(
      "ElementRepository: Element 'nonExistentElement' not found on page 'TestPage'."
    );
  });

  test('getSelectorRaw throws when page not found', () => {
    expect(() => repo.getSelectorRaw('NonExistentPage', 'button')).toThrow(
      "ElementRepository: Page 'NonExistentPage' not found for platform 'web'."
    );
  });

  test('getSelectorRaw throws when element not found', () => {
    expect(() => repo.getSelectorRaw('TestPage', 'nonExistentElement')).toThrow(
      "ElementRepository: Element 'nonExistentElement' not found on page 'TestPage'."
    );
  });

  test('getSelector throws when selector is empty', () => {
    const badData = {
      pages: [{ name: 'Bad', elements: [{ elementName: 'el', selector: {} }] }],
    };
    const badRepo = new ElementRepository(badData as any);
    expect(() => badRepo.getSelector('Bad', 'el')).toThrow(
      "ElementRepository: Invalid selector for 'el'."
    );
  });
});
