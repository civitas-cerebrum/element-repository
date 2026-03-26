# Playwright Element Repository

[![NPM Version](https://img.shields.io/npm/v/@civitas-cerebrum/element-repository?color=rgb(88%2C%20171%2C%2070))](https://www.npmjs.com/package/@civitas-cerebrum/element-repository)

A lightweight, robust package that decouples your UI selectors from your test code. By externalizing locators into a central JSON repository, you make your test automation framework cleaner, easier to maintain, and accessible to non-developers. Supports both **Playwright (web)** and **Appium/WebdriverIO (mobile)** through a unified API.

## 📦 Installation

Install the package via your preferred package manager:

```bash
npm i @civitas-cerebrum/element-repository
```

**Peer Dependencies:**
This package requires `@playwright/test` or `playwright` to be installed in your project. For mobile/platform testing, `webdriverio` is included as a dependency.

## 🚀 What is it good for?

* **Zero Hardcoded Selectors:** Keep your Page Objects and Step Definitions completely free of complex DOM queries.
* **Dynamic Parsing:** Automatically converts your JSON configuration into native Playwright CSS, XPath, ID, Text, Test ID, Role, Placeholder, or Label selectors.
* **Smart Locators:** Built-in methods for handling arrays, randomized element selection (great for catalog/PLP testing), text-filtering, attribute-filtering, and visibility checks.
* **Soft Waiting:** Seamlessly waits for elements to attach and become visible before returning a locator to prevent flake.

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

#### Multi-Platform Configuration

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
import { test } from '@playwright/test';
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

The repository exposes clean, asynchronous methods that return `Element` objects (wrapping Playwright `Locator` for web, or WebdriverIO elements for mobile), ready for interaction.

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

### `get(page, pageName, elementName)`

Returns a single `Element`. For web, waits for the selector to attach to the DOM based on your configured timeout. For platform, returns a lazy `PlatformElement` that resolves on interaction.

### `getAll(page, pageName, elementName)`

Returns an array of `Element` objects. Useful when you need to iterate over multiple elements.

### `getRandom(page, pageName, elementName, strict?)`

Counts the matching elements and randomly selects one. Safely waits for the specific randomized element to become visible.

### `getByText(page, pageName, elementName, desiredText, strict?)`

Returns the first `Element` matching the mapped selector that also contains the `desiredText`.

### `getByAttribute(page, pageName, elementName, attribute, value, options?)`

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

### `getByIndex(page, pageName, elementName, index, strict?)`

Returns the `Element` at the specified zero-based index from the list of matching elements. Returns `null` (or throws in strict mode) if the index is out of bounds.

```typescript
const thirdCard = await repo.getByIndex(page, 'ProductList', 'product-cards', 2);
```

### `getVisible(page, pageName, elementName, strict?)`

Returns the first visible element matching the selector. Unlike `get()`, which returns the locator after a basic wait, this method explicitly filters to only visible elements — useful when hidden duplicates exist in the DOM.

```typescript
const visibleModal = await repo.getVisible(page, 'Dashboard', 'modal');
```

### `getByRole(page, pageName, elementName, role, strict?)`

Filters elements by their explicit `role` HTML attribute and returns the first match.

```typescript
const navButton = await repo.getByRole(page, 'Header', 'navItems', 'button');
```

### `getSelector(pageName, elementName)`

Returns a platform-appropriate selector string. For web platforms, returns Playwright-formatted selectors (e.g., `"css=input[name='search']"`). For non-web platforms (android, ios), returns Appium-formatted selectors (e.g., `"~LoginBtn"`, `"android=new UiSelector().text(\"Submit\")"`). This is a synchronous method useful for debugging, custom logging, or passing raw selector strings directly into native APIs.

```typescript
// Web
const webRepo = new ElementRepository(data);
webRepo.getSelector('LoginPage', 'submitButton'); // "css=button.web-submit"

// Android
const androidRepo = new ElementRepository(data, undefined, 'android');
androidRepo.getSelector('LoginPage', 'submitButton'); // "~SubmitBtn"
```

### `getSelectorRaw(pageName, elementName)`

Returns the raw selector strategy and value as an object, without any platform-specific formatting. Useful when you need the original strategy name and value from the JSON.

```typescript
const { strategy, value } = repo.getSelectorRaw('HomePage', 'search-input');
// { strategy: 'css', value: "input[name='search']" }
```

### `setDefaultTimeout(timeout)`

Updates the default timeout (in milliseconds) for all subsequent element retrievals.

## 🔧 Type Safety

All `get*` methods return an `Element` interface that wraps either a Playwright `Locator` (web) or a WebdriverIO element (platform). Use the type guards to narrow:

```typescript
import { Element, WebElement, PlatformElement, isWeb, isPlatform } from '@civitas-cerebrum/element-repository';

const el = await repo.get(page, 'LoginPage', 'submitButton');

if (isWeb(el)) {
  // el is WebElement — access el.locator (Playwright Locator)
  await el.locator.click();
}

if (isPlatform(el)) {
  // el is PlatformElement — access el.driver, el.selector
  await el.click();
}
```
