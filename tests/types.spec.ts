import { test, expect } from '@playwright/test';
import { WebElement, PlatformElement, ElementType, isWeb, isPlatform } from '../src/types';

// ---------------------------------------------------------------------------
// Mock Playwright locator
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
    textContent: async () => 'Hello World',
    getAttribute: async (_name: string) => 'attr-value',
    inputValue: async () => 'my-input',
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

// ---------------------------------------------------------------------------
// Mock WebdriverIO element + driver
// ---------------------------------------------------------------------------

function createMockWdioElement(overrides: Record<string, any> = {}): any {
  return {
    click: async () => {},
    clearValue: async () => {},
    setValue: async (_v: any) => {},
    doubleClick: async () => {},
    isSelected: async () => false,
    isDisplayed: async () => true,
    isEnabled: async () => true,
    getText: async () => 'platform text',
    getAttribute: async (_n: string) => 'wdio-attr',
    getValue: async () => 'wdio-val',
    addValue: async (_c: string) => {},
    moveTo: async () => {},
    waitForDisplayed: async (_opts?: any) => {},
    waitForExist: async (_opts?: any) => {},
    elementId: 'mock-elem-id',
    $: async (_sel: string) => createMockWdioElement(),
    $$: async (_sel: string) => [createMockWdioElement(), createMockWdioElement()],
    ...overrides,
  };
}

function createMockDriver(overrides: Record<string, any> = {}): any {
  const mockEl = createMockWdioElement();
  return {
    $: async (_sel: string) => mockEl,
    $$: async (_sel: string) => [mockEl, createMockWdioElement()],
    pause: async (_ms: number) => {},
    execute: async (_cmd: string, _args: any) => {},
    ...overrides,
  };
}

// ===========================================================================
// ElementType enum
// ===========================================================================

test.describe('ElementType enum', () => {
  test('WEB has value "web"', () => {
    expect(ElementType.WEB).toBe('web');
  });

  test('PLATFORM has value "platform"', () => {
    expect(ElementType.PLATFORM).toBe('platform');
  });
});

// ===========================================================================
// isWeb / isPlatform type guards
// ===========================================================================

test.describe('isWeb and isPlatform type guards', () => {
  test('isWeb returns true for WebElement', () => {
    const el = new WebElement(createMockLocator());
    expect(isWeb(el)).toBe(true);
  });

  test('isWeb returns false for PlatformElement', () => {
    const el = new PlatformElement(createMockDriver(), '~button');
    expect(isWeb(el)).toBe(false);
  });

  test('isPlatform returns true for PlatformElement', () => {
    const el = new PlatformElement(createMockDriver(), '~button');
    expect(isPlatform(el)).toBe(true);
  });

  test('isPlatform returns false for WebElement', () => {
    const el = new WebElement(createMockLocator());
    expect(isPlatform(el)).toBe(false);
  });
});

// ===========================================================================
// WebElement — _type
// ===========================================================================

test.describe('WebElement._type', () => {
  test('_type is ElementType.WEB', () => {
    const el = new WebElement(createMockLocator());
    expect(el._type).toBe(ElementType.WEB);
  });
});

// ===========================================================================
// WebElement — interaction methods
// ===========================================================================

test.describe('WebElement interaction methods', () => {
  test('click delegates to locator.click', async () => {
    let called = false;
    const el = new WebElement(createMockLocator({ click: async () => { called = true; } }));
    await el.click();
    expect(called).toBe(true);
  });

  test('fill delegates to locator.fill', async () => {
    let received = '';
    const el = new WebElement(createMockLocator({ fill: async (t: string) => { received = t; } }));
    await el.fill('hello');
    expect(received).toBe('hello');
  });

  test('clear delegates to locator.clear', async () => {
    let called = false;
    const el = new WebElement(createMockLocator({ clear: async () => { called = true; } }));
    await el.clear();
    expect(called).toBe(true);
  });

  test('check delegates to locator.check', async () => {
    let called = false;
    const el = new WebElement(createMockLocator({ check: async () => { called = true; } }));
    await el.check();
    expect(called).toBe(true);
  });

  test('uncheck delegates to locator.uncheck', async () => {
    let called = false;
    const el = new WebElement(createMockLocator({ uncheck: async () => { called = true; } }));
    await el.uncheck();
    expect(called).toBe(true);
  });

  test('hover delegates to locator.hover', async () => {
    let called = false;
    const el = new WebElement(createMockLocator({ hover: async () => { called = true; } }));
    await el.hover();
    expect(called).toBe(true);
  });

  test('doubleClick delegates to locator.dblclick', async () => {
    let called = false;
    const el = new WebElement(createMockLocator({ dblclick: async () => { called = true; } }));
    await el.doubleClick();
    expect(called).toBe(true);
  });

  test('scrollIntoView delegates to locator.scrollIntoViewIfNeeded', async () => {
    let called = false;
    const el = new WebElement(createMockLocator({ scrollIntoViewIfNeeded: async () => { called = true; } }));
    await el.scrollIntoView();
    expect(called).toBe(true);
  });

  test('pressSequentially delegates with text and delay', async () => {
    let receivedText = '';
    let receivedOpts: any = null;
    const el = new WebElement(createMockLocator({
      pressSequentially: async (t: string, opts: any) => { receivedText = t; receivedOpts = opts; },
    }));
    await el.pressSequentially('abc', 30);
    expect(receivedText).toBe('abc');
    expect(receivedOpts).toEqual({ delay: 30 });
  });

  test('pressSequentially passes undefined delay when not provided', async () => {
    let receivedOpts: any = { delay: 'sentinel' };
    const el = new WebElement(createMockLocator({
      pressSequentially: async (_t: string, opts: any) => { receivedOpts = opts; },
    }));
    await el.pressSequentially('abc');
    expect(receivedOpts).toEqual({ delay: undefined });
  });

  test('setInputFiles delegates to locator.setInputFiles', async () => {
    let receivedPath = '';
    const el = new WebElement(createMockLocator({ setInputFiles: async (p: string) => { receivedPath = p; } }));
    await el.setInputFiles('/path/to/file.pdf');
    expect(receivedPath).toBe('/path/to/file.pdf');
  });

  test('dispatchEvent delegates to locator.dispatchEvent', async () => {
    let receivedEvent = '';
    const el = new WebElement(createMockLocator({ dispatchEvent: async (e: string) => { receivedEvent = e; } }));
    await el.dispatchEvent('click');
    expect(receivedEvent).toBe('click');
  });
});

// ===========================================================================
// WebElement — state methods
// ===========================================================================

test.describe('WebElement state methods', () => {
  test('isVisible returns locator.isVisible result', async () => {
    const el = new WebElement(createMockLocator({ isVisible: async () => false }));
    expect(await el.isVisible()).toBe(false);
  });

  test('isEnabled returns locator.isEnabled result', async () => {
    const el = new WebElement(createMockLocator({ isEnabled: async () => true }));
    expect(await el.isEnabled()).toBe(true);
  });

  test('isChecked returns locator.isChecked result', async () => {
    const el = new WebElement(createMockLocator({ isChecked: async () => true }));
    expect(await el.isChecked()).toBe(true);
  });
});

// ===========================================================================
// WebElement — extraction methods
// ===========================================================================

test.describe('WebElement extraction methods', () => {
  test('textContent returns locator.textContent result', async () => {
    const el = new WebElement(createMockLocator({ textContent: async () => 'My Text' }));
    expect(await el.textContent()).toBe('My Text');
  });

  test('textContent can return null', async () => {
    const el = new WebElement(createMockLocator({ textContent: async () => null }));
    expect(await el.textContent()).toBeNull();
  });

  test('getAttribute returns locator.getAttribute result', async () => {
    const el = new WebElement(createMockLocator({ getAttribute: async (_n: string) => 'href-value' }));
    expect(await el.getAttribute('href')).toBe('href-value');
  });

  test('inputValue returns locator.inputValue result', async () => {
    const el = new WebElement(createMockLocator({ inputValue: async () => 'typed-text' }));
    expect(await el.inputValue()).toBe('typed-text');
  });
});

// ===========================================================================
// WebElement — querying methods
// ===========================================================================

test.describe('WebElement querying methods', () => {
  test('locateChild returns a WebElement wrapping a child locator', () => {
    const childLocator = createMockLocator();
    const el = new WebElement(createMockLocator({ locator: (_s: string) => childLocator }));
    const child = el.locateChild('span.inner');
    expect(child).toBeInstanceOf(WebElement);
  });

  test('count returns locator.count result', async () => {
    const el = new WebElement(createMockLocator({ count: async () => 7 }));
    expect(await el.count()).toBe(7);
  });

  test('all returns array of WebElements', async () => {
    const el = new WebElement(createMockLocator({ all: async () => [createMockLocator(), createMockLocator()] }));
    const result = await el.all();
    expect(result).toHaveLength(2);
    result.forEach(item => expect(item).toBeInstanceOf(WebElement));
  });

  test('first returns a WebElement', () => {
    const el = new WebElement(createMockLocator({ first: () => createMockLocator() }));
    expect(el.first()).toBeInstanceOf(WebElement);
  });

  test('nth returns a WebElement', () => {
    let receivedIndex = -1;
    const el = new WebElement(createMockLocator({ nth: (i: number) => { receivedIndex = i; return createMockLocator(); } }));
    const result = el.nth(3);
    expect(result).toBeInstanceOf(WebElement);
    expect(receivedIndex).toBe(3);
  });

  test('filter returns a WebElement', () => {
    let receivedOpts: any = null;
    const el = new WebElement(createMockLocator({ filter: (opts: any) => { receivedOpts = opts; return createMockLocator(); } }));
    const result = el.filter({ hasText: 'Submit' });
    expect(result).toBeInstanceOf(WebElement);
    expect(receivedOpts).toEqual({ hasText: 'Submit' });
  });
});

// ===========================================================================
// WebElement — waitFor
// ===========================================================================

test.describe('WebElement waitFor', () => {
  test('delegates waitFor with state and timeout', async () => {
    let receivedOpts: any = null;
    const el = new WebElement(createMockLocator({ waitFor: async (opts: any) => { receivedOpts = opts; } }));
    await el.waitFor({ state: 'visible', timeout: 5000 });
    expect(receivedOpts).toEqual({ state: 'visible', timeout: 5000 });
  });

  test('waitFor with no options calls through without error', async () => {
    let called = false;
    const el = new WebElement(createMockLocator({ waitFor: async () => { called = true; } }));
    await el.waitFor();
    expect(called).toBe(true);
  });
});

// ===========================================================================
// PlatformElement — _type
// ===========================================================================

test.describe('PlatformElement._type', () => {
  test('_type is ElementType.PLATFORM', () => {
    const el = new PlatformElement(createMockDriver(), '~button');
    expect(el._type).toBe(ElementType.PLATFORM);
  });
});

// ===========================================================================
// PlatformElement — interaction methods
// ===========================================================================

test.describe('PlatformElement interaction methods', () => {
  test('click calls element.click via driver.$', async () => {
    let called = false;
    const mockEl = createMockWdioElement({ click: async () => { called = true; } });
    const driver = { ...createMockDriver(), $: async () => mockEl };
    const el = new PlatformElement(driver, '~button');
    await el.click();
    expect(called).toBe(true);
  });

  test('fill calls clearValue then setValue', async () => {
    const ops: string[] = [];
    const mockEl = createMockWdioElement({
      clearValue: async () => { ops.push('clear'); },
      setValue: async (v: any) => { ops.push(`set:${v}`); },
    });
    const driver = { ...createMockDriver(), $: async () => mockEl };
    const el = new PlatformElement(driver, '~button');
    await el.fill('hello');
    expect(ops).toEqual(['clear', 'set:hello']);
  });

  test('clear calls element.clearValue', async () => {
    let called = false;
    const mockEl = createMockWdioElement({ clearValue: async () => { called = true; } });
    const driver = { ...createMockDriver(), $: async () => mockEl };
    const el = new PlatformElement(driver, '~button');
    await el.clear();
    expect(called).toBe(true);
  });

  test('check clicks when not selected', async () => {
    let clicked = false;
    const mockEl = createMockWdioElement({
      isSelected: async () => false,
      click: async () => { clicked = true; },
    });
    const driver = { ...createMockDriver(), $: async () => mockEl };
    const el = new PlatformElement(driver, '~button');
    await el.check();
    expect(clicked).toBe(true);
  });

  test('check does NOT click when already selected', async () => {
    let clicked = false;
    const mockEl = createMockWdioElement({
      isSelected: async () => true,
      click: async () => { clicked = true; },
    });
    const driver = { ...createMockDriver(), $: async () => mockEl };
    const el = new PlatformElement(driver, '~button');
    await el.check();
    expect(clicked).toBe(false);
  });

  test('uncheck clicks when selected', async () => {
    let clicked = false;
    const mockEl = createMockWdioElement({
      isSelected: async () => true,
      click: async () => { clicked = true; },
    });
    const driver = { ...createMockDriver(), $: async () => mockEl };
    const el = new PlatformElement(driver, '~button');
    await el.uncheck();
    expect(clicked).toBe(true);
  });

  test('uncheck does NOT click when already unselected', async () => {
    let clicked = false;
    const mockEl = createMockWdioElement({
      isSelected: async () => false,
      click: async () => { clicked = true; },
    });
    const driver = { ...createMockDriver(), $: async () => mockEl };
    const el = new PlatformElement(driver, '~button');
    await el.uncheck();
    expect(clicked).toBe(false);
  });

  test('hover calls element.moveTo', async () => {
    let called = false;
    const mockEl = createMockWdioElement({ moveTo: async () => { called = true; } });
    const driver = { ...createMockDriver(), $: async () => mockEl };
    const el = new PlatformElement(driver, '~button');
    await el.hover();
    expect(called).toBe(true);
  });

  test('doubleClick calls element.doubleClick', async () => {
    let called = false;
    const mockEl = createMockWdioElement({ doubleClick: async () => { called = true; } });
    const driver = { ...createMockDriver(), $: async () => mockEl };
    const el = new PlatformElement(driver, '~button');
    await el.doubleClick();
    expect(called).toBe(true);
  });

  test('scrollIntoView calls driver.execute with element id', async () => {
    let executedCmd = '';
    let executedArgs: any = null;
    const mockEl = createMockWdioElement({ elementId: 'el-42' });
    const driver = {
      $: async () => mockEl,
      $$: async () => [mockEl],
      pause: async () => {},
      execute: async (cmd: string, args: any) => { executedCmd = cmd; executedArgs = args; },
    };
    const el = new PlatformElement(driver, '~button');
    await el.scrollIntoView();
    expect(executedCmd).toBe('mobile: scroll');
    expect(executedArgs).toEqual({ element: 'el-42', toVisible: true });
  });

  test('pressSequentially calls addValue for each char with delay', async () => {
    const addedValues: string[] = [];
    const pauseDelays: number[] = [];
    const mockEl = createMockWdioElement({
      addValue: async (c: string) => { addedValues.push(c); },
    });
    const driver = {
      $: async () => mockEl,
      $$: async () => [mockEl],
      pause: async (ms: number) => { pauseDelays.push(ms); },
      execute: async () => {},
    };
    const el = new PlatformElement(driver, '~input');
    await el.pressSequentially('hi', 10);
    expect(addedValues).toEqual(['h', 'i']);
    expect(pauseDelays).toEqual([10, 10]);
  });

  test('pressSequentially uses default delay of 50ms', async () => {
    const pauseDelays: number[] = [];
    const mockEl = createMockWdioElement({ addValue: async () => {} });
    const driver = {
      $: async () => mockEl,
      $$: async () => [mockEl],
      pause: async (ms: number) => { pauseDelays.push(ms); },
      execute: async () => {},
    };
    const el = new PlatformElement(driver, '~input');
    await el.pressSequentially('ab');
    expect(pauseDelays).toEqual([50, 50]);
  });

  test('pressSequentially skips pause when delay is 0', async () => {
    const pauseDelays: number[] = [];
    const mockEl = createMockWdioElement({ addValue: async () => {} });
    const driver = {
      $: async () => mockEl,
      $$: async () => [mockEl],
      pause: async (ms: number) => { pauseDelays.push(ms); },
      execute: async () => {},
    };
    const el = new PlatformElement(driver, '~input');
    await el.pressSequentially('ab', 0);
    expect(pauseDelays).toHaveLength(0);
  });

  test('setInputFiles throws not-supported error', async () => {
    const el = new PlatformElement(createMockDriver(), '~button');
    await expect(el.setInputFiles('/file.pdf')).rejects.toThrow(
      'setInputFiles is not supported on platform elements.'
    );
  });

  test('dispatchEvent throws not-supported error', async () => {
    const el = new PlatformElement(createMockDriver(), '~button');
    await expect(el.dispatchEvent('click')).rejects.toThrow(
      'dispatchEvent is not supported on platform elements.'
    );
  });
});

// ===========================================================================
// PlatformElement — state methods
// ===========================================================================

test.describe('PlatformElement state methods', () => {
  test('isVisible returns element.isDisplayed result', async () => {
    const mockEl = createMockWdioElement({ isDisplayed: async () => false });
    const driver = { ...createMockDriver(), $: async () => mockEl };
    const el = new PlatformElement(driver, '~button');
    expect(await el.isVisible()).toBe(false);
  });

  test('isEnabled returns element.isEnabled result', async () => {
    const mockEl = createMockWdioElement({ isEnabled: async () => true });
    const driver = { ...createMockDriver(), $: async () => mockEl };
    const el = new PlatformElement(driver, '~button');
    expect(await el.isEnabled()).toBe(true);
  });

  test('isChecked returns element.isSelected result', async () => {
    const mockEl = createMockWdioElement({ isSelected: async () => true });
    const driver = { ...createMockDriver(), $: async () => mockEl };
    const el = new PlatformElement(driver, '~button');
    expect(await el.isChecked()).toBe(true);
  });
});

// ===========================================================================
// PlatformElement — extraction methods
// ===========================================================================

test.describe('PlatformElement extraction methods', () => {
  test('textContent returns trimmed getText result', async () => {
    const mockEl = createMockWdioElement({ getText: async () => '  hello  ' });
    const driver = { ...createMockDriver(), $: async () => mockEl };
    const el = new PlatformElement(driver, '~button');
    expect(await el.textContent()).toBe('hello');
  });

  test('textContent returns null when getText returns null/undefined', async () => {
    const mockEl = createMockWdioElement({ getText: async () => null });
    const driver = { ...createMockDriver(), $: async () => mockEl };
    const el = new PlatformElement(driver, '~button');
    expect(await el.textContent()).toBeNull();
  });

  test('getAttribute delegates to element.getAttribute', async () => {
    const mockEl = createMockWdioElement({ getAttribute: async (_n: string) => 'some-class' });
    const driver = { ...createMockDriver(), $: async () => mockEl };
    const el = new PlatformElement(driver, '~button');
    expect(await el.getAttribute('class')).toBe('some-class');
  });

  test('inputValue returns getValue result', async () => {
    const mockEl = createMockWdioElement({ getValue: async () => 'typed-value' });
    const driver = { ...createMockDriver(), $: async () => mockEl };
    const el = new PlatformElement(driver, '~input');
    expect(await el.inputValue()).toBe('typed-value');
  });

  test('inputValue falls back to getAttribute("value") when getValue throws', async () => {
    const mockEl = createMockWdioElement({
      getValue: async () => { throw new Error('not supported'); },
      getAttribute: async (n: string) => n === 'value' ? 'fallback-val' : null,
    });
    const driver = { ...createMockDriver(), $: async () => mockEl };
    const el = new PlatformElement(driver, '~input');
    expect(await el.inputValue()).toBe('fallback-val');
  });

  test('inputValue returns empty string when both getValue and getAttribute fail', async () => {
    const mockEl = createMockWdioElement({
      getValue: async () => { throw new Error('not supported'); },
      getAttribute: async (_n: string) => null,
    });
    const driver = { ...createMockDriver(), $: async () => mockEl };
    const el = new PlatformElement(driver, '~input');
    expect(await el.inputValue()).toBe('');
  });
});

// ===========================================================================
// PlatformElement — querying methods
// ===========================================================================

test.describe('PlatformElement querying methods', () => {
  test('locateChild returns a new PlatformElement', () => {
    const el = new PlatformElement(createMockDriver(), '~button');
    const child = el.locateChild('~inner');
    expect(child).toBeInstanceOf(PlatformElement);
    expect((child as PlatformElement).selector).toBe('~inner');
  });

  test('count returns length of $$ result', async () => {
    const driver = { ...createMockDriver(), $$: async () => [createMockWdioElement(), createMockWdioElement()] };
    const el = new PlatformElement(driver, '~list-item');
    expect(await el.count()).toBe(2);
  });

  test('all returns array of PlatformElements', async () => {
    const driver = { ...createMockDriver(), $$: async () => [createMockWdioElement(), createMockWdioElement()] };
    const el = new PlatformElement(driver, '~list-item');
    const result = await el.all();
    expect(result).toHaveLength(2);
    result.forEach(item => expect(item).toBeInstanceOf(PlatformElement));
  });

  test('first returns self', () => {
    const el = new PlatformElement(createMockDriver(), '~button');
    expect(el.first()).toBe(el);
  });

  test('nth returns self', () => {
    const el = new PlatformElement(createMockDriver(), '~button');
    expect(el.nth(2)).toBe(el);
  });

  test('filter returns self', () => {
    const el = new PlatformElement(createMockDriver(), '~button');
    expect(el.filter({ hasText: 'foo' })).toBe(el);
  });
});

// ===========================================================================
// PlatformElement — waitFor
// ===========================================================================

test.describe('PlatformElement waitFor', () => {
  test('waits for visible by default', async () => {
    let opts: any = null;
    const mockEl = createMockWdioElement({ waitForDisplayed: async (o: any) => { opts = o; } });
    const driver = { ...createMockDriver(), $: async () => mockEl };
    const el = new PlatformElement(driver, '~button');
    await el.waitFor();
    expect(opts).toEqual({ timeout: 30000 });
  });

  test('waits for visible state explicitly', async () => {
    let opts: any = null;
    const mockEl = createMockWdioElement({ waitForDisplayed: async (o: any) => { opts = o; } });
    const driver = { ...createMockDriver(), $: async () => mockEl };
    const el = new PlatformElement(driver, '~button');
    await el.waitFor({ state: 'visible', timeout: 5000 });
    expect(opts).toEqual({ timeout: 5000 });
  });

  test('waits for hidden state (reverse=true)', async () => {
    let opts: any = null;
    const mockEl = createMockWdioElement({ waitForDisplayed: async (o: any) => { opts = o; } });
    const driver = { ...createMockDriver(), $: async () => mockEl };
    const el = new PlatformElement(driver, '~button');
    await el.waitFor({ state: 'hidden' });
    expect(opts).toEqual({ timeout: 30000, reverse: true });
  });

  test('waits for attached state', async () => {
    let opts: any = null;
    const mockEl = createMockWdioElement({ waitForExist: async (o: any) => { opts = o; } });
    const driver = { ...createMockDriver(), $: async () => mockEl };
    const el = new PlatformElement(driver, '~button');
    await el.waitFor({ state: 'attached', timeout: 10000 });
    expect(opts).toEqual({ timeout: 10000 });
  });

  test('waits for detached state (reverse=true)', async () => {
    let opts: any = null;
    const mockEl = createMockWdioElement({ waitForExist: async (o: any) => { opts = o; } });
    const driver = { ...createMockDriver(), $: async () => mockEl };
    const el = new PlatformElement(driver, '~button');
    await el.waitFor({ state: 'detached' });
    expect(opts).toEqual({ timeout: 30000, reverse: true });
  });
});

// ===========================================================================
// PlatformElement — parentElement branch
// ===========================================================================

test.describe('PlatformElement with parentElement', () => {
  test('findOne uses parentElement.$ when parentElement is set', async () => {
    let queryUsed = '';
    const parentEl = createMockWdioElement({
      $: async (sel: string) => { queryUsed = `parent:${sel}`; return createMockWdioElement(); },
    });
    const el = new PlatformElement(createMockDriver(), '~inner', parentEl);
    await el.click();
    expect(queryUsed).toBe('parent:~inner');
  });

  test('findAll uses parentElement.$$ when parentElement is set', async () => {
    let queryUsed = '';
    const parentEl = createMockWdioElement({
      $$: async (sel: string) => { queryUsed = `parent:${sel}`; return [createMockWdioElement()]; },
    });
    const el = new PlatformElement(createMockDriver(), '~list-item', parentEl);
    await el.count();
    expect(queryUsed).toBe('parent:~list-item');
  });
});
