import { test, expect } from '@playwright/test';
import { ElementRepository } from '../src/repo/ElementRepository';
import { WebElement } from '../src/types';
import { ElementChain } from '../src/types/ElementChain';
import { SelectionStrategy } from '../src/enum/Options';

// ---------------------------------------------------------------------------
// Mock factories (copied from element-repository.spec.ts with adjustments)
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

// ===========================================================================
// ElementChain — interactions
// ===========================================================================

test.describe('ElementChain — interactions', () => {
  test('click() waits for visible then clicks', async () => {
    let waitState: string | undefined;
    let clicked = false;
    const mockLocator = createMockLocator({
      waitFor: async (opts?: any) => { waitState = opts?.state; },
      click: async () => { clicked = true; },
    });
    const element = new WebElement(mockLocator);
    await element.action().click();
    expect(waitState).toBe('visible');
    expect(clicked).toBe(true);
  });

  test('click({ withoutScrolling: true }) waits for attached then dispatches click event', async () => {
    let waitState: string | undefined;
    let dispatched: string | undefined;
    const mockLocator = createMockLocator({
      waitFor: async (opts?: any) => { waitState = opts?.state; },
      dispatchEvent: async (event: string) => { dispatched = event; },
    });
    const element = new WebElement(mockLocator);
    await element.action().click({ withoutScrolling: true });
    expect(waitState).toBe('attached');
    expect(dispatched).toBe('click');
  });

  test('hover() waits for visible then hovers', async () => {
    let hovered = false;
    const mockLocator = createMockLocator({
      waitFor: async () => {},
      hover: async () => { hovered = true; },
    });
    const element = new WebElement(mockLocator);
    await element.action().hover();
    expect(hovered).toBe(true);
  });

  test('fill() waits for visible then fills', async () => {
    let filledText: string | undefined;
    const mockLocator = createMockLocator({
      waitFor: async () => {},
      fill: async (text: string) => { filledText = text; },
    });
    const element = new WebElement(mockLocator);
    await element.action().fill('hello');
    expect(filledText).toBe('hello');
  });

  test('check() waits for visible then checks', async () => {
    let checked = false;
    const mockLocator = createMockLocator({
      waitFor: async () => {},
      check: async () => { checked = true; },
    });
    const element = new WebElement(mockLocator);
    await element.action().check();
    expect(checked).toBe(true);
  });

  test('chain executes actions in sequence', async () => {
    const order: string[] = [];
    const mockLocator = createMockLocator({
      waitFor: async () => { order.push('wait'); },
      hover: async () => { order.push('hover'); },
      click: async () => { order.push('click'); },
    });
    const element = new WebElement(mockLocator);
    await element.action().hover().click();
    // hover: wait+hover, click: wait+click
    expect(order).toEqual(['wait', 'hover', 'wait', 'click']);
  });

  test('timeout propagates to waitFor and action calls', async () => {
    let capturedWaitTimeout: number | undefined;
    let capturedClickTimeout: number | undefined;
    const mockLocator = createMockLocator({
      waitFor: async (opts?: any) => { capturedWaitTimeout = opts?.timeout; },
      click: async (opts?: any) => { capturedClickTimeout = opts?.timeout; },
    });
    const element = new WebElement(mockLocator);
    await element.action(5000).click();
    expect(capturedWaitTimeout).toBe(5000);
    expect(capturedClickTimeout).toBe(5000);
  });
});

// ===========================================================================
// ElementChain — verifications
// ===========================================================================

test.describe('ElementChain — verifications', () => {
  test('verifyPresence() waits for visible', async () => {
    let waitState: string | undefined;
    const mockLocator = createMockLocator({
      waitFor: async (opts?: any) => { waitState = opts?.state; },
    });
    const element = new WebElement(mockLocator);
    await element.action().verifyPresence();
    expect(waitState).toBe('visible');
  });

  test('verifyAbsence() waits for hidden', async () => {
    let waitState: string | undefined;
    const mockLocator = createMockLocator({
      waitFor: async (opts?: any) => { waitState = opts?.state; },
    });
    const element = new WebElement(mockLocator);
    await element.action().verifyAbsence();
    expect(waitState).toBe('hidden');
  });

  test('verifyText() with expected text passes when matching', async () => {
    const mockLocator = createMockLocator({
      waitFor: async () => {},
      textContent: async () => 'Submit',
    });
    const element = new WebElement(mockLocator);
    await element.action().verifyText('Submit');
  });

  test('verifyText() with expected text throws when not matching', async () => {
    const mockLocator = createMockLocator({
      waitFor: async () => {},
      textContent: async () => 'Cancel',
    });
    const element = new WebElement(mockLocator);
    await expect(element.action().verifyText('Submit')).rejects.toThrow('Expected text "Submit"');
  });

  test('verifyText() without args asserts not empty', async () => {
    const mockLocator = createMockLocator({
      waitFor: async () => {},
      textContent: async () => 'Some text',
    });
    const element = new WebElement(mockLocator);
    await element.action().verifyText();
  });

  test('verifyText() without args throws on empty text', async () => {
    const mockLocator = createMockLocator({
      waitFor: async () => {},
      textContent: async () => '',
    });
    const element = new WebElement(mockLocator);
    await expect(element.action().verifyText()).rejects.toThrow('Expected element to have text content');
  });

  test('verifyTextContains() passes when text contains substring', async () => {
    const mockLocator = createMockLocator({
      waitFor: async () => {},
      textContent: async () => 'Click to Submit Form',
    });
    const element = new WebElement(mockLocator);
    await element.action().verifyTextContains('Submit');
  });

  test('verifyTextContains() throws when text does not contain substring', async () => {
    const mockLocator = createMockLocator({
      waitFor: async () => {},
      textContent: async () => 'Click to Cancel',
    });
    const element = new WebElement(mockLocator);
    await expect(element.action().verifyTextContains('Submit')).rejects.toThrow('Expected text to contain "Submit"');
  });

  test('verifyAttribute() passes when attribute matches', async () => {
    const mockLocator = createMockLocator({
      waitFor: async () => {},
      getAttribute: async () => 'active',
    });
    const element = new WebElement(mockLocator);
    await element.action().verifyAttribute('class', 'active');
  });

  test('verifyAttribute() throws when attribute does not match', async () => {
    const mockLocator = createMockLocator({
      waitFor: async () => {},
      getAttribute: async () => 'inactive',
    });
    const element = new WebElement(mockLocator);
    await expect(element.action().verifyAttribute('class', 'active')).rejects.toThrow('Expected attribute "class" to be "active"');
  });

  test('verifyCount() passes with exact match', async () => {
    const mockLocator = createMockLocator({ count: async () => 5 });
    const element = new WebElement(mockLocator);
    await element.action().verifyCount({ exactly: 5 });
  });

  test('verifyCount() throws on mismatch', async () => {
    const mockLocator = createMockLocator({ count: async () => 3 });
    const element = new WebElement(mockLocator);
    await expect(element.action().verifyCount({ exactly: 5 })).rejects.toThrow('Expected count to be exactly 5');
  });

  test('verifyEnabled() passes when enabled', async () => {
    const mockLocator = createMockLocator({ isEnabled: async () => true });
    const element = new WebElement(mockLocator);
    await element.action().verifyEnabled();
  });

  test('verifyDisabled() passes when disabled', async () => {
    const mockLocator = createMockLocator({ isEnabled: async () => false });
    const element = new WebElement(mockLocator);
    await element.action().verifyDisabled();
  });
});

// ===========================================================================
// ElementChain — extractions
// ===========================================================================

test.describe('ElementChain — extractions', () => {
  test('getText() returns trimmed text', async () => {
    const mockLocator = createMockLocator({
      waitFor: async () => {},
      textContent: async () => '  Hello World  ',
    });
    const element = new WebElement(mockLocator);
    const text = await element.action().getText();
    expect(text).toBe('Hello World');
  });

  test('getAttribute() returns attribute value', async () => {
    const mockLocator = createMockLocator({
      waitFor: async () => {},
      getAttribute: async () => 'https://example.com',
    });
    const element = new WebElement(mockLocator);
    const href = await element.action().getAttribute('href');
    expect(href).toBe('https://example.com');
  });

  test('getCount() returns element count', async () => {
    const mockLocator = createMockLocator({ count: async () => 7 });
    const element = new WebElement(mockLocator);
    const count = await element.action().getCount();
    expect(count).toBe(7);
  });

  test('getInputValue() returns input value', async () => {
    const mockLocator = createMockLocator({
      waitFor: async () => {},
      inputValue: async () => 'john@test.com',
    });
    const element = new WebElement(mockLocator);
    const val = await element.action().getInputValue();
    expect(val).toBe('john@test.com');
  });

  test('extractions execute queued actions first', async () => {
    const order: string[] = [];
    const mockLocator = createMockLocator({
      waitFor: async () => { order.push('wait'); },
      hover: async () => { order.push('hover'); },
      textContent: async () => { order.push('getText'); return 'result'; },
    });
    const element = new WebElement(mockLocator);
    const text = await element.action().hover().getText();
    expect(text).toBe('result');
    expect(order[0]).toBe('wait'); // hover's waitForState
    expect(order[1]).toBe('hover');
  });
});

// ===========================================================================
// SelectionStrategy.ALL
// ===========================================================================

test.describe('SelectionStrategy.ALL', () => {
  test('get() with ALL strategy returns un-narrowed element', async () => {
    let firstCalled = false;
    const baseLocator = createMockLocator({
      first: () => { firstCalled = true; return createMockLocator(); },
      count: async () => 5,
    });
    const mockPage = { locator: () => baseLocator };
    const repo = new ElementRepository(mockPage, {
      pages: [{ name: 'Page', elements: [{ elementName: 'items', selector: { css: '.item' } }] }],
    } as any);
    const el = await repo.get('items', 'Page', { strategy: SelectionStrategy.ALL });
    // first() should NOT have been called
    expect(firstCalled).toBe(false);
    // count should return 5 (all elements)
    const count = await el.count();
    expect(count).toBe(5);
  });

  test('get() without options returns first element', async () => {
    const mockPage = createMockPage();
    const repo = new ElementRepository(mockPage, {
      pages: [{ name: 'Page', elements: [{ elementName: 'items', selector: { css: '.item' } }] }],
    } as any);
    const el = await repo.get('items', 'Page');
    expect(el).toBeInstanceOf(WebElement);
  });

  test('getAll() uses ALL strategy internally', async () => {
    const items = [createMockLocator(), createMockLocator(), createMockLocator()];
    const baseLocator = createMockLocator({
      all: async () => items,
    });
    const mockPage = { locator: () => baseLocator };
    const repo = new ElementRepository(mockPage, {
      pages: [{ name: 'Page', elements: [{ elementName: 'items', selector: { css: '.item' } }] }],
    } as any);
    const elements = await repo.getAll('items', 'Page');
    expect(elements.length).toBe(3);
  });
});

// ===========================================================================
// Element methods return Element for chaining
// ===========================================================================

test.describe('ElementChain — waitForState', () => {
  test('waitForState() calls waitFor with the specified state', async () => {
    let waitState: string | undefined;
    const mockLocator = createMockLocator({
      waitFor: async (opts?: any) => { waitState = opts?.state; },
    });
    const element = new WebElement(mockLocator);
    await element.action().waitForState('attached');
    expect(waitState).toBe('attached');
  });
});

test.describe('ElementChain — clickIfPresent', () => {
  test('clickIfPresent() clicks when element is visible', async () => {
    let clicked = false;
    const mockLocator = createMockLocator({
      isVisible: async () => true,
      click: async () => { clicked = true; },
    });
    const element = new WebElement(mockLocator);
    await element.action().clickIfPresent();
    expect(clicked).toBe(true);
  });

  test('clickIfPresent() skips when element is not visible', async () => {
    let clicked = false;
    const mockLocator = createMockLocator({
      isVisible: async () => false,
      click: async () => { clicked = true; },
    });
    const element = new WebElement(mockLocator);
    await element.action().clickIfPresent();
    expect(clicked).toBe(false);
  });
});

test.describe('ElementChain — scrollIntoView', () => {
  test('scrollIntoView() waits for attached then scrolls', async () => {
    let waitState: string | undefined;
    let scrolled = false;
    const mockLocator = createMockLocator({
      waitFor: async (opts?: any) => { waitState = opts?.state; },
      scrollIntoViewIfNeeded: async () => { scrolled = true; },
    });
    const element = new WebElement(mockLocator);
    await element.action().scrollIntoView();
    expect(waitState).toBe('attached');
    expect(scrolled).toBe(true);
  });
});

test.describe('ElementChain — verifyChecked', () => {
  test('verifyChecked() passes when element is checked', async () => {
    const mockLocator = createMockLocator({
      isChecked: async () => true,
    });
    const element = new WebElement(mockLocator);
    await element.action().verifyChecked();
  });

  test('verifyChecked() throws when element is not checked', async () => {
    const mockLocator = createMockLocator({
      isChecked: async () => false,
    });
    const element = new WebElement(mockLocator);
    await expect(element.action().verifyChecked()).rejects.toThrow('Expected element to be checked');
  });
});

test.describe('ElementChain — isPresent', () => {
  test('isPresent() returns true when element is visible', async () => {
    const mockLocator = createMockLocator({
      isVisible: async () => true,
    });
    const element = new WebElement(mockLocator);
    const result = await element.action().isPresent();
    expect(result).toBe(true);
  });

  test('isPresent() returns false when element is not visible', async () => {
    const mockLocator = createMockLocator({
      isVisible: async () => false,
    });
    const element = new WebElement(mockLocator);
    const result = await element.action().isPresent();
    expect(result).toBe(false);
  });
});

test.describe('ElementChain — getRaw', () => {
  test('getRaw() returns the raw selector', async () => {
    const mockLocator = createMockLocator({
      waitFor: async () => {},
      toString: () => '.my-selector',
    });
    const element = new WebElement(mockLocator);
    const raw = await element.action().getRaw();
    expect(raw).toBe('.my-selector');
  });

  test('getRaw() returns selector string when provided', async () => {
    const mockLocator = createMockLocator({
      waitFor: async () => {},
    });
    const element = new WebElement(mockLocator, '#my-id');
    const raw = await element.action().getRaw();
    expect(raw).toBe('#my-id');
  });
});

test.describe('ElementChain — then', () => {
  test('awaiting the chain returns the element', async () => {
    const mockLocator = createMockLocator();
    const element = new WebElement(mockLocator);
    const result = await element.action();
    expect(result).toBe(element);
  });

  test('then() can be called explicitly with resolve callback', async () => {
    const mockLocator = createMockLocator();
    const element = new WebElement(mockLocator);
    const chain = element.action();
    const result = await chain.then((el) => el);
    expect(result).toBe(element);
  });
});

// ===========================================================================
// WebElement.raw
// ===========================================================================

test.describe('WebElement — raw', () => {
  test('raw() returns the selector when provided', async () => {
    const mockLocator = createMockLocator();
    const element = new WebElement(mockLocator, 'div.container');
    const raw = await element.raw();
    expect(raw).toBe('div.container');
  });

  test('raw() falls back to locator.toString() when no selector', async () => {
    const mockLocator = createMockLocator({
      toString: () => 'locator(".fallback")',
    });
    const element = new WebElement(mockLocator);
    const raw = await element.raw();
    expect(raw).toBe('locator(".fallback")');
  });
});

// ===========================================================================
// PlatformElement — action and raw
// ===========================================================================

test.describe('PlatformElement — action and raw', () => {
  test('action() returns an ElementChain', () => {
    const { PlatformElement } = require('../src/types/PlatformElement');
    const mockDriver = { $: async () => ({}) };
    const el = new PlatformElement(mockDriver, '~myAccessibilityId');
    const chain = el.action();
    expect(chain).toBeInstanceOf(ElementChain);
  });

  test('raw() returns the selector', async () => {
    const { PlatformElement } = require('../src/types/PlatformElement');
    const mockDriver = { $: async () => ({}) };
    const el = new PlatformElement(mockDriver, '~loginButton');
    const raw = await el.raw();
    expect(raw).toBe('~loginButton');
  });
});

// ===========================================================================
// Element methods return Element for chaining
// ===========================================================================

test.describe('Element methods return Element for chaining', () => {
  test('click() returns the element', async () => {
    const mockLocator = createMockLocator();
    const element = new WebElement(mockLocator);
    const result = await element.click();
    expect(result).toBe(element);
  });

  test('fill() returns the element', async () => {
    const mockLocator = createMockLocator();
    const element = new WebElement(mockLocator);
    const result = await element.fill('test');
    expect(result).toBe(element);
  });

  test('hover() returns the element', async () => {
    const mockLocator = createMockLocator();
    const element = new WebElement(mockLocator);
    const result = await element.hover();
    expect(result).toBe(element);
  });
});
