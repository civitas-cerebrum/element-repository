# Element Repository

[![NPM Version](https://img.shields.io/npm/v/@civitas-cerebrum/element-repository?color=rgb(88%2C%20171%2C%2070))](https://www.npmjs.com/package/@civitas-cerebrum/element-repository)

A lightweight, robust package that decouples your UI selectors from your test code. By externalizing locators into a central JSON repository, you make your test automation framework cleaner, easier to maintain, and accessible to non-developers. Supports both **Playwright (web)** and **Appium/WebdriverIO (mobile)** through a unified API.

## 📦 Installation

```bash
npm i @civitas-cerebrum/element-repository
```

**Peer Dependencies:**
For web testing, install `@playwright/test` or `playwright`. For mobile/platform testing, install `webdriverio`.

## 🚀 What is it good for?

* **Zero Hardcoded Selectors:** Keep your Page Objects and Step Definitions completely free of complex DOM queries.
* **Platform-Agnostic Element API:** A unified `Element` interface with interaction, state, extraction, querying, and waiting methods that work identically across Playwright and WebDriverIO.
* **Fluent Action Chains:** Sequence multiple actions on an element with `element.action().waitForState('visible').click()`.
* **Built-in Verifications:** Assert presence, absence, text, attributes, and counts directly on elements.
* **Dynamic Parsing:** Automatically converts your JSON configuration into platform-native selectors.
* **Smart Locators:** Built-in methods for arrays, randomized element selection, text-filtering, attribute-filtering, and visibility checks.

## 🏗️ Configuration

Create a JSON file in your project to hold your selectors:

**`locators.json`**

```json
{
  "pages": [
    {
      "name": "HomePage",
      "elements": [
        {
          "elementName": "search-input",
          "selector": { "css": "input[name='search']" }
        },
        {
          "elementName": "submit-button",
          "selector": { "id": "btn-submit" }
        }
      ]
    },
    {
      "name": "ProductList",
      "elements": [
        {
          "elementName": "product-cards",
          "selector": { "xpath": "//article[@class='product']" }
        }
      ]
    }
  ]
}
```

### Multi-Platform Configuration

Use the `platform` field to define platform-specific selectors for the same page. Pages without a `platform` field default to `web`.

```json
{
  "pages": [
    {
      "name": "LoginPage",
      "platform": "web",
      "elements": [
        { "elementName": "submitButton", "selector": { "css": "button.web-submit" } }
      ]
    },
    {
      "name": "LoginPage",
      "platform": "android",
      "elements": [
        { "elementName": "submitButton", "selector": { "accessibility id": "SubmitBtn" } }
      ]
    },
    {
      "name": "LoginPage",
      "platform": "ios",
      "elements": [
        { "elementName": "submitButton", "selector": { "predicate": "label == \"Submit\"" } }
      ]
    }
  ]
}
```

### Supported Selector Keys

The `platform` field on each page object determines which selector format is used. If `platform` is omitted, it defaults to `web`.

#### Web (Playwright)

| Key | Resolves To | Example |
|-----|-------------|---------|
| `css` | `css=<value>` | `"css": "button.primary"` |
| `xpath` | `xpath=<value>` | `"xpath": "//button[@id='submit']"` |
| `id` | `#<value>` | `"id": "btn-submit"` |
| `text` | `text=<value>` | `"text": "Submit"` |
| `testid` | `[data-testid='<value>']` | `"testid": "login-btn"` |
| `role` | `[role='<value>']` | `"role": "button"` |
| `placeholder` | `[placeholder='<value>']` | `"placeholder": "Search..."` |
| `label` | `[aria-label='<value>']` | `"label": "Close"` |

#### Non-Web / Mobile (Appium)

| Key | camelCase Alias | Resolves To | Example |
|-----|-----------------|-------------|---------|
| `accessibility id` | `accessibilityId` | `~<value>` | `"accessibility id": "LoginBtn"` |
| `xpath` | — | `<value>` (raw) | `"xpath": "//android.widget.Button"` |
| `id` | — | `#<value>` | `"id": "submit-btn"` |
| `uiautomator` | `androidUIAutomator` | `android=<value>` | `"uiautomator": "new UiSelector().text(\"Go\")"` |
| `predicate` | `iOSNsPredicateString` | `-ios predicate string:<value>` | `"predicate": "label == \"Login\""` |
| `class chain` | `iOSClassChain` | `-ios class chain:<value>` | `"class chain": "**/XCUIElementTypeButton"` |
| `class name` | `className` | `<value>` (raw) | `"class name": "android.widget.EditText"` |

> All strategy keys that contain spaces also accept a camelCase alias (e.g., `"accessibilityId"` instead of `"accessibility id"`).

## 💻 Usage

### Initialization

The constructor takes the **driver** (Playwright `Page` or WebDriverIO `Browser`) as the first argument:

```typescript
import { ElementRepository } from '@civitas-cerebrum/element-repository';

// Option A: Pass a file path (relative to project root)
const repo = new ElementRepository(page, 'tests/data/locators.json');

// Option B: Pass parsed JSON data directly
import locatorData from '../data/locators.json';
const repo = new ElementRepository(page, locatorData);

// Option C: With a custom timeout (default: 15000ms)
const repo = new ElementRepository(page, locatorData, 30000);

// Access the bound driver
const driver = repo.driver; // returns the Page/Browser passed to the constructor
```

### Retrieving Elements

All methods use `(elementName, pageName)` order and return unified `Element` objects:

```typescript
test('Search and select random product', async ({ page }) => {
  const repo = new ElementRepository(page, 'tests/data/locators.json');

  // Get a single element (defaults to first match)
  const searchInput = await repo.get('search-input', 'HomePage');
  await searchInput.fill('Trousers');

  // Get with a specific strategy
  const thirdCard = await repo.get('product-cards', 'ProductList', {
    strategy: SelectionStrategy.INDEX, index: 2
  });

  // Select a random element from a list
  const randomProduct = await repo.getRandom('product-cards', 'ProductList');
  await randomProduct?.click();

  // Find by text
  const specificProduct = await repo.getByText('product-cards', 'ProductList', 'Blue Chinos');
  await specificProduct?.click();

  // Find by HTML attribute
  const activeCard = await repo.getByAttribute('product-cards', 'ProductList', 'data-status', 'active');

  // Get by index
  const secondCard = await repo.getByIndex('product-cards', 'ProductList', 1);

  // Get the first visible element
  const visibleModal = await repo.getVisible('modal', 'HomePage');

  // Filter by ARIA role
  const navLink = await repo.getByRole('nav-links', 'HomePage', 'link');
});
```

### Fluent Action Chains

Every `Element` exposes an `action(timeout?)` method that returns a thenable `ElementChain` builder. Queue multiple actions and execute them all with a single `await`:

```typescript
const element = await repo.get('submitButton', 'LoginPage');

// Interaction chain
await element.action(5000)
  .waitForState('visible')
  .click()

// Click without scrolling (for dropdown/flyout items)
await element.action()
  .waitForState('attached')
  .click({ withoutScrolling: true })

// Fill and verify
await element.action()
  .fill('hello@test.com')
  .verifyText('hello@test.com')

// Verification chain
await element.action(5000)
  .verifyPresence()
  .verifyText('Submit')
  .verifyAttribute('type', 'submit')

// Extraction (terminal — returns value)
const text = await element.action().getText()
const href = await element.action().getAttribute('href')
const count = await element.action().getCount()
```

#### Available Chain Methods

**Interactions:** `click(options?)`, `clickIfPresent(options?)`, `hover()`, `fill(text)`, `clear()`, `check()`, `uncheck()`, `doubleClick()`, `scrollIntoView()`, `pressSequentially(text, delay?)`, `dispatchEvent(event)`

**Verifications:** `verifyPresence()`, `verifyAbsence()`, `verifyText(expected?)`, `verifyTextContains(text)`, `verifyAttribute(name, value)`, `verifyEnabled()`, `verifyDisabled()`, `verifyChecked()`, `verifyCount(options)`

**Extractions (terminal):** `getText()`, `getAttribute(name)`, `getInputValue()`, `getCount()`, `getRaw()`, `isPresent()`

**Waiting:** `waitForState(state)`

## 🛠️ API Reference

### ElementRepository

#### `constructor(driver, dataOrPath, defaultTimeout?)`

| Param | Type | Description |
|-------|------|-------------|
| `driver` | `any` | Playwright `Page` or WebDriverIO `Browser`/`Driver` instance |
| `dataOrPath` | `string \| PageRepository` | Path to JSON file or parsed JSON object |
| `defaultTimeout` | `number` | Default wait timeout in ms (default: `15000`) |

#### `get(elementName, pageName, options?)`

Returns a single `Element`. Defaults to the first match. Pass `ElementResolutionOptions` to control selection:

```typescript
import { SelectionStrategy } from '@civitas-cerebrum/element-repository';

await repo.get('button', 'Page')                                                    // first (default)
await repo.get('button', 'Page', { strategy: SelectionStrategy.INDEX, index: 2 })   // by index
await repo.get('button', 'Page', { strategy: SelectionStrategy.RANDOM })             // random
await repo.get('button', 'Page', { strategy: SelectionStrategy.TEXT, value: 'Sub' }) // by text
await repo.get('button', 'Page', { strategy: SelectionStrategy.ALL })                // un-narrowed (for counts)
```

#### `getAll(elementName, pageName)`

Returns an array of all matching `Element` objects.

#### `getRandom(elementName, pageName, strict?)`

Randomly selects one element from all matches.

#### `getByText(elementName, pageName, desiredText, strict?)`

Returns the first element containing the specified text. Tries exact match first, falls back to contains.

#### `getByAttribute(elementName, pageName, attribute, value, options?)`

Returns the first element whose HTML attribute matches the given value.

**Options:** `exact` (boolean), `strict` (boolean)

#### `getByIndex(elementName, pageName, index, strict?)`

Returns the element at the specified zero-based index.

#### `getVisible(elementName, pageName, strict?)`

Returns the first visible element, filtering out hidden duplicates.

#### `getByRole(elementName, pageName, role, strict?)`

Filters elements by their `role` HTML attribute.

#### `getSelector(elementName, pageName)`

Returns a platform-formatted selector string (synchronous).

#### `getSelectorRaw(elementName, pageName)`

Returns `{ strategy, value }` — the raw selector without platform formatting.

#### `getPagePlatform(pageName)`

Returns the platform string for a page (`'web'`, `'android'`, `'ios'`).

#### Strict Mode

All `get*` methods that return `Element | null` accept an optional `strict` parameter:

- **`strict: false`** (default) — returns `null` when no match is found.
- **`strict: true`** — throws an `Error` when no match is found.

### Element Interface

All `get*` methods return an `Element` — a platform-agnostic interface wrapping either a Playwright `Locator` (`WebElement`) or a WebDriverIO element (`PlatformElement`).

#### Interaction Methods

| Method | Description |
|--------|-------------|
| `click(options?)` | Clicks the element. Returns `Promise<Element>`. |
| `fill(text, options?)` | Clears and fills with text. Returns `Promise<Element>`. |
| `clear(options?)` | Clears the element's value. Returns `Promise<Element>`. |
| `check(options?)` | Checks a checkbox/radio. Returns `Promise<Element>`. |
| `uncheck(options?)` | Unchecks a checkbox. Returns `Promise<Element>`. |
| `hover(options?)` | Hovers over the element. Returns `Promise<Element>`. |
| `doubleClick(options?)` | Double-clicks. Returns `Promise<Element>`. |
| `scrollIntoView(options?)` | Scrolls into view. Returns `Promise<Element>`. |
| `pressSequentially(text, delay?, options?)` | Types character by character. Returns `Promise<Element>`. |
| `setInputFiles(filePath, options?)` | Sets file input value. **Web only.** |
| `dispatchEvent(event)` | Dispatches a DOM event. **Web only.** |

All interaction methods accept an optional `{ timeout?: number }` and return the element for simple chaining.

#### State, Extraction, Querying, and Waiting

| Method | Description |
|--------|-------------|
| `isVisible()` | Returns `true` if visible. |
| `isEnabled()` | Returns `true` if enabled. |
| `isChecked()` | Returns `true` if checked. |
| `raw()` | Returns the selector string. |
| `textContent()` | Returns text content or `null`. |
| `getAttribute(name)` | Returns attribute value or `null`. |
| `inputValue()` | Returns current input value. |
| `count()` | Returns matched element count. |
| `all()` | Returns array of all matched elements. |
| `first()` | Returns the first match. |
| `nth(index)` | Returns element at index. |
| `filter({ hasText })` | Filters by text content. |
| `locateChild(selector)` | Locates a descendant. |
| `waitFor(options?)` | Waits for state: `"visible"`, `"hidden"`, `"attached"`, `"detached"`. |
| `action(timeout?)` | Returns a fluent `ElementChain` builder. |

### 🔧 Type Safety

```typescript
import { Element, isWeb, isPlatform } from '@civitas-cerebrum/element-repository';

const el = await repo.get('submitButton', 'LoginPage');

if (isWeb(el)) {
  // Access the underlying Playwright Locator
  await (el as WebElement).locator.click();
}

if (isPlatform(el)) {
  // Access the WebDriverIO selector
  console.log((el as PlatformElement).selector);
}
```

## ⚠️ Breaking Changes (v0.2.0)

| Change | Migration |
|---|---|
| Constructor requires `driver` as first arg | `new ElementRepository(data)` → `new ElementRepository(page, data)` |
| Methods drop `driver`/`page` first param | `repo.get(page, 'Page', 'el')` → `repo.get('el', 'Page')` |
| Param order flipped to `(elementName, pageName)` | Swap args in all calls |
| Element methods return `Promise<Element>` | Was `Promise<void>` — no action needed unless you depend on `void` |
| `raw()` returns actual selector string | Was `locator.toString()` — likely an improvement |

## License

MIT
