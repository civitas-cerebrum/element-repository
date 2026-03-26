# Element Repository

[![NPM Version](https://img.shields.io/npm/v/@civitas-cerebrum/element-repository?color=rgb(88%2C%20171%2C%2070))](https://www.npmjs.com/package/@civitas-cerebrum/element-repository)

A lightweight, robust package that decouples your UI selectors from your test code. By externalizing locators into a central JSON repository, you make your test automation framework cleaner, easier to maintain, and accessible to non-developers. Supports both **Playwright (web)** and **Appium/WebdriverIO (mobile)** through a unified API.

## 📦 Installation

Install the package via your preferred package manager:

```bash
npm i @civitas-cerebrum/element-repository
```

**Peer Dependencies:**
For web testing, install `@playwright/test` or `playwright`. For mobile/platform testing, install `webdriverio`.

## 🚀 What is it good for?

* **Zero Hardcoded Selectors:** Keep your Page Objects and Step Definitions completely free of complex DOM queries.
* **Platform-Agnostic Element API:** A unified `Element` interface with interaction, state, extraction, querying, and waiting methods that work identically across Playwright and WebDriverIO.
* **Dynamic Parsing:** Automatically converts your JSON configuration into platform-native selectors — CSS, XPath, ID, Text, Test ID, Role, Placeholder, and Label for web; Accessibility ID, UIAutomator, Predicate, Class Chain, and more for mobile.
* **Smart Locators:** Built-in methods for handling arrays, randomized element selection (great for catalog/PLP testing), text-filtering, attribute-filtering, and visibility checks.
* **Soft Waiting:** Seamlessly waits for elements to attach and become visible before returning them to prevent flake.

## 🏗️ Configuration

Create a JSON file in your project to hold your selectors. The file must adhere to the standard schema:

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
        },
        {
          "elementName": "login-button",
          "selector": { "testid": "login-btn" }
        },
        {
          "elementName": "nav-links",
          "selector": { "role": "link" }
        },
        {
          "elementName": "search-field",
          "selector": { "placeholder": "Search..." }
        },
        {
          "elementName": "close-button",
          "selector": { "label": "Close" }
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

> **Note:** The `testid` key uses the standard `data-testid` attribute.

#### Non-Web / Mobile (Appium)

| Key | camelCase Alias | Resolves To | Example |
|-----|-----------------|-------------|---------|
| `accessibility id` | `accessibilityId` | `~<value>` | `"accessibility id": "LoginBtn"` |
| `xpath` | — | `<value>` (raw) | `"xpath": "//android.widget.Button"` |
| `id` | — | `#<value>` | `"id": "submit-btn"` |
| `css` | — | `css=<value>` | `"css": "button.primary"` |
| `uiautomator` | `androidUIAutomator` | `android=<value>` | `"uiautomator": "new UiSelector().text(\"Go\")"` |
| `predicate` | `iOSNsPredicateString` | `-ios predicate string:<value>` | `"predicate": "label == \"Login\""` |
| `class chain` | `iOSClassChain` | `-ios class chain:<value>` | `"class chain": "**/XCUIElementTypeButton"` |
| `class name` | `className` | `<value>` (raw) | `"class name": "android.widget.EditText"` |
| `tag name` | `tagName` | `<value>` (raw) | `"tag name": "button"` |
| `name` | — | `<value>` (raw) | `"name": "username"` |
| `android data matcher` | `androidDataMatcher` | `-android datamatcher:<value>` | `"androidDataMatcher": "{\"name\":\"Title\"}"` |
| `android view matcher` | `androidViewMatcher` | `-android viewmatcher:<value>` | `"androidViewMatcher": "{\"id\":\"btn\"}"` |
| `android view tag` | `androidViewTag` | `-android viewtag:<value>` | `"androidViewTag": "my-tag"` |
| `text` | — | Platform-specific | `"text": "Submit"` |

> **Note:** The `text` key resolves to `android=new UiSelector().text("...")` on Android, `-ios predicate string:label == "..."` on iOS, and the raw value on other platforms.
>
> **Note:** All strategy keys that contain spaces also accept a camelCase alias (e.g., `"accessibilityId"` instead of `"accessibility id"`). Both forms produce identical selectors.

#### Full Example

```json
{
  "pages": [
    {
      "name": "LoginPage",
      "platform": "web",
      "elements": [
        { "elementName": "emailInput", "selector": { "css": "input[type='email']" } },
        { "elementName": "passwordInput", "selector": { "id": "password" } },
        { "elementName": "submitButton", "selector": { "testid": "login-submit" } },
        { "elementName": "forgotPasswordLink", "selector": { "text": "Forgot password?" } },
        { "elementName": "heading", "selector": { "xpath": "//h1[@class='title']" } },
        { "elementName": "navMenu", "selector": { "role": "navigation" } },
        { "elementName": "searchField", "selector": { "placeholder": "Search..." } },
        { "elementName": "closeButton", "selector": { "label": "Close" } }
      ]
    },
    {
      "name": "LoginPage",
      "platform": "android",
      "elements": [
        { "elementName": "emailInput", "selector": { "accessibilityId": "email-field" } },
        { "elementName": "passwordInput", "selector": { "id": "password-field" } },
        { "elementName": "submitButton", "selector": { "androidUIAutomator": "new UiSelector().text(\"Log In\")" } },
        { "elementName": "heading", "selector": { "xpath": "//android.widget.TextView[@text='Login']" } },
        { "elementName": "editField", "selector": { "className": "android.widget.EditText" } },
        { "elementName": "taggedView", "selector": { "androidViewTag": "login-form" } },
        { "elementName": "matchedItem", "selector": { "androidDataMatcher": "{\"name\":\"email\"}" } },
        { "elementName": "welcomeText", "selector": { "text": "Welcome back" } }
      ]
    },
    {
      "name": "LoginPage",
      "platform": "ios",
      "elements": [
        { "elementName": "emailInput", "selector": { "accessibilityId": "email-field" } },
        { "elementName": "passwordInput", "selector": { "iOSNsPredicateString": "type == 'XCUIElementTypeSecureTextField'" } },
        { "elementName": "submitButton", "selector": { "iOSClassChain": "**/XCUIElementTypeButton[`label == \"Log In\"`]" } },
        { "elementName": "heading", "selector": { "xpath": "//XCUIElementTypeStaticText[@name='Login']" } },
        { "elementName": "textField", "selector": { "className": "XCUIElementTypeTextField" } },
        { "elementName": "welcomeText", "selector": { "text": "Welcome back" } }
      ]
    }
  ]
}
```

## 💻 Usage

You can initialize the `ElementRepository` either by passing the **file path** to your JSON, or by passing the **parsed JSON object** directly.

### Initialization

```typescript
import { ElementRepository } from '@civitas-cerebrum/element-repository';

// Option A: Pass the path to your JSON (relative to your project root)
const repo = new ElementRepository('tests/data/locators.json', 15000);

// Option B: Import the JSON directly (requires resolveJsonModule in tsconfig)
import locatorData from '../data/locators.json';
const repo = new ElementRepository(locatorData, 15000);

// Option C: Platform-specific repository (for mobile/Appium)
const androidRepo = new ElementRepository('tests/data/locators.json', 15000, 'android');
const iosRepo = new ElementRepository(locatorData, 15000, 'ios');
```

The third parameter (`platform`) defaults to `'web'`. When set to a non-web platform, `getSelector()` automatically returns Appium-formatted selectors, and `get()` returns `PlatformElement` wrappers instead of `WebElement`.

### Retrieving Elements

The repository exposes clean, asynchronous methods that return unified `Element` objects, ready for interaction regardless of the underlying platform.

```typescript
test('Search and select random product', async ({ page }) => {
  await page.goto('/');

  // 1. Get a standard element
  const searchInput = await repo.get(page, 'HomePage', 'search-input');
  await searchInput.fill('Trousers');

  const submitBtn = await repo.get(page, 'HomePage', 'submit-button');
  await submitBtn.click();

  // 2. Select a random element from a list
  const randomProduct = await repo.getRandom(page, 'ProductList', 'product-cards');
  await randomProduct?.click();

  // 3. Find a specific element by text within a list
  const specificProduct = await repo.getByText(page, 'ProductList', 'product-cards', 'Blue Chinos');
  await specificProduct?.click();

  // 4. Find an element by HTML attribute
  const activeCard = await repo.getByAttribute(page, 'ProductList', 'product-cards', 'data-status', 'active');
  await activeCard?.click();

  // 5. Get a specific element by index
  const thirdProduct = await repo.getByIndex(page, 'ProductList', 'product-cards', 2);
  await thirdProduct?.click();

  // 6. Get the first visible element (filters out hidden duplicates)
  const visibleModal = await repo.getVisible(page, 'HomePage', 'modal');
  await visibleModal?.click();

  // 7. Filter elements by ARIA role
  const navLink = await repo.getByRole(page, 'HomePage', 'nav-links', 'link');
  await navLink?.click();
});
```

## 🛠️ API Reference

### ElementRepository

#### `get(page, pageName, elementName)`

Returns a single `Element`. For web, waits for the selector to attach to the DOM based on your configured timeout. For platform, returns a lazy `PlatformElement` that resolves on interaction.

#### `getAll(page, pageName, elementName)`

Returns an array of `Element` objects. Useful when you need to iterate over multiple elements.

#### `getRandom(page, pageName, elementName, strict?)`

Counts the matching elements and randomly selects one. Safely waits for the specific randomized element to become visible.

#### `getByText(page, pageName, elementName, desiredText, strict?)`

Returns the first `Element` matching the mapped selector that also contains the `desiredText`.

#### `getByAttribute(page, pageName, elementName, attribute, value, options?)`

Returns the first `Element` whose HTML attribute matches the given value. Iterates through all matching elements and checks the specified attribute.

**Options:**
- `exact` (boolean, default: `true`) — If `true`, requires an exact attribute match. If `false`, matches when the attribute contains the value.
- `strict` (boolean, default: `false`) — If `true`, throws an error when no matching element is found.

```typescript
// Exact match (default)
const active = await repo.getByAttribute(page, 'Dashboard', 'cards', 'data-status', 'active');

// Partial (contains) match
const dashLink = await repo.getByAttribute(page, 'Nav', 'links', 'href', '/dashboard', { exact: false });
```

#### `getByIndex(page, pageName, elementName, index, strict?)`

Returns the `Element` at the specified zero-based index from the list of matching elements. Returns `null` (or throws in strict mode) if the index is out of bounds.

```typescript
const thirdCard = await repo.getByIndex(page, 'ProductList', 'product-cards', 2);
```

#### `getVisible(page, pageName, elementName, strict?)`

Returns the first visible element matching the selector. Unlike `get()`, which returns the locator after a basic wait, this method explicitly filters to only visible elements — useful when hidden duplicates exist in the DOM.

```typescript
const visibleModal = await repo.getVisible(page, 'Dashboard', 'modal');
```

#### `getByRole(page, pageName, elementName, role, strict?)`

Filters elements by their explicit `role` HTML attribute and returns the first match.

```typescript
const navButton = await repo.getByRole(page, 'Header', 'navItems', 'button');
```

#### `getSelector(pageName, elementName)`

Returns a platform-appropriate selector string. For web platforms, returns Playwright-formatted selectors (e.g., `"css=input[name='search']"`). For non-web platforms (android, ios), returns Appium-formatted selectors (e.g., `"~LoginBtn"`, `"android=new UiSelector().text(\"Submit\")"`). This is a synchronous method useful for debugging, custom logging, or passing raw selector strings directly into native APIs.

```typescript
// Web
const webRepo = new ElementRepository(data);
webRepo.getSelector('LoginPage', 'submitButton'); // "css=button.web-submit"

// Android
const androidRepo = new ElementRepository(data, undefined, 'android');
androidRepo.getSelector('LoginPage', 'submitButton'); // "~SubmitBtn"
```

#### `getSelectorRaw(pageName, elementName)`

Returns the raw selector strategy and value as an object, without any platform-specific formatting. Useful when you need the original strategy name and value from the JSON.

```typescript
const { strategy, value } = repo.getSelectorRaw('HomePage', 'search-input');
// { strategy: 'css', value: "input[name='search']" }
```

#### `setDefaultTimeout(timeout)`

Updates the default timeout (in milliseconds) for all subsequent element retrievals.

#### Strict Mode

All `get*` methods that return `Element | null` accept an optional `strict` parameter (default: `false`):

- **`strict: false`** — logs a warning and returns `null` when no match is found.
- **`strict: true`** — throws an `Error` when no match is found.

```typescript
// Non-strict (default): returns null on failure
const card = await repo.getByText(page, 'ProductList', 'product-cards', 'Missing Item');
// card === null

// Strict: throws an error on failure
const card = await repo.getByText(page, 'ProductList', 'product-cards', 'Missing Item', true);
// Error: Element 'product-cards' on 'ProductList' with text "Missing Item" not found.
```

### Element Interface

All `get*` methods return an `Element` — a platform-agnostic interface that wraps either a Playwright `Locator` (via `WebElement`) or a WebDriverIO element (via `PlatformElement`). You can interact with elements directly without caring about the underlying driver.

#### Interaction Methods

| Method | Description |
|--------|-------------|
| `click()` | Clicks the element. |
| `fill(text)` | Clears the input and fills it with the given text. |
| `clear()` | Clears the element's value. |
| `check()` | Checks a checkbox or radio button. |
| `uncheck()` | Unchecks a checkbox. |
| `hover()` | Hovers over the element. |
| `doubleClick()` | Double-clicks the element. |
| `scrollIntoView()` | Scrolls the element into the visible area. |
| `pressSequentially(text, delay?)` | Types text one character at a time. |
| `setInputFiles(filePath)` | Sets the value of a file input. **Web only.** |
| `dispatchEvent(event)` | Dispatches a DOM event on the element. **Web only.** |

#### State Methods

| Method | Description |
|--------|-------------|
| `isVisible()` | Returns `true` if the element is visible. |
| `isEnabled()` | Returns `true` if the element is enabled. |
| `isChecked()` | Returns `true` if a checkbox/radio is checked. |

#### Extraction Methods

| Method | Description |
|--------|-------------|
| `textContent()` | Returns the text content, or `null` if empty. |
| `getAttribute(name)` | Returns the value of an HTML attribute, or `null`. |
| `inputValue()` | Returns the current value of an input/textarea/select. |

#### Querying Methods

| Method | Description |
|--------|-------------|
| `locateChild(selector)` | Locates a descendant element matching the selector. |
| `count()` | Returns the number of matched elements. |
| `all()` | Returns an array of all matched elements. |
| `first()` | Returns the first matched element. |
| `nth(index)` | Returns the element at the given zero-based index. |
| `filter({ hasText })` | Filters matched elements by text content. |

#### Waiting

| Method | Description |
|--------|-------------|
| `waitFor(options?)` | Waits for the element to reach a state: `"visible"` (default), `"hidden"`, `"attached"`, or `"detached"`. Accepts an optional `timeout` in ms. |

### 🔧 Type Safety

Use the `ElementType` enum and type guards to narrow to the concrete implementation when you need driver-specific access:

```typescript
import { Element, WebElement, PlatformElement, isWeb, isPlatform } from '@civitas-cerebrum/element-repository';

const el = await repo.get(page, 'LoginPage', 'submitButton');

if (isWeb(el)) {
  // el is WebElement — access the underlying Playwright Locator
  await el.locator.click();
}

if (isPlatform(el)) {
  // el is PlatformElement — access the WebDriverIO driver and selector
  console.log(el.selector); // the Appium selector string
  await el.click();
}
```

### 📤 Exports

```typescript
// Primary class
export { ElementRepository } from '@civitas-cerebrum/element-repository';

// Element types and type guards
export { Element, WebElement, PlatformElement, ElementType, isWeb, isPlatform };

// Schema types
export { Selector, ElementDefinition, PageObject, PageRepository, Page };

// Formatter type
export type { SelectorFormatter };

// Utility functions
export { pickRandomIndex, pickRandomMember };
```

## License

MIT
