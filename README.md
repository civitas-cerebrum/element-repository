# Element Repository

[![NPM Version](https://img.shields.io/npm/v/@civitas-cerebrum/element-repository?color=rgb(88%2C%20171%2C%2070))](https://www.npmjs.com/package/@civitas-cerebrum/element-repository)

A lightweight, robust package that decouples your UI selectors from your test code. By externalizing locators into a central JSON repository, you make your test automation framework cleaner, easier to maintain, and accessible to non-developers. Supports both **Playwright (web)** and **Appium/WebdriverIO (native iOS and Android)** through a unified API — one JSON file can hold the same page once per platform.

## 📦 Installation

```bash
npm i @civitas-cerebrum/element-repository
```

**Peer Dependencies (both optional):**
- Web testing: `@playwright/test` (`^1.58.2`).
- Native iOS / Android testing: `webdriverio` (`^10`). WebdriverIO 10 requires Node.js `>=22.23.4 <23`, `>=24.22.1 <25` or `>=26.12.1`.

## 🚀 What is it good for?

* **Zero Hardcoded Selectors:** Keep your Page Objects and Step Definitions completely free of complex DOM queries.
* **Platform-Agnostic Element API:** A unified `Element` interface with interaction, state, extraction, querying, and waiting methods that work identically across Playwright and WebDriverIO.
* **Fluent Action Chains:** Sequence multiple actions on an element with `element.action().waitForState('visible').click()`.
* **Dynamic Parsing:** Automatically converts your JSON configuration into platform-native selectors.
* **Smart Locators:** Built-in methods for arrays, randomized element selection, text-filtering, attribute-filtering, and visibility checks.

## 📐 Package Contract

This package owns **element acquisition + primitive operations only**. Everything with retry, fallback, options-driven variants, composition, matcher trees, or assertion framing belongs in consumer packages.

**What lives here:**
- Locating elements from a JSON repository
- The `Element` interface and its two backends (`WebElement` for Playwright, `PlatformElement` for Appium)
- `ElementChain` — a fluent action sequencer over `Element` primitives
- Thin one-call wrappers over the underlying `Locator` / WebdriverIO element (click, fill, hover, check, scrollIntoView, etc.)

**What lives in consumers:**
- Verification DSLs, assertion error formatting, retry-on-mismatch semantics
- Pointer-interception auto-retry, force-click fallbacks, `{ withoutScrolling, ifPresent }` modifiers
- Listed-element composition (text/regex/withDescendant filtering)
- Matcher trees (`steps.expect(...).text.toBe(...)`), VisibleChain, Steps API facades

**Rule of thumb — classify by implementation, not by name.** A method whose body is a single wrapped primitive call is a primitive and stays here (even if it sounds verification-y — e.g., `ElementChain.isPresent()` is just `element.isVisible()` after queue execution). A method that retries, composes, or formats assertion errors is smart and moves to a consumer.

See `@civitas-cerebrum/element-interactions` (web) and `@civitas-cerebrum/singularity-engine` (web + mobile + desktop) for the smart layer.

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

One file may hold the same page `name` **once per platform**. The `platform` field names the platform of each page block; a page without it is a `web` page. Use the same `elementName` for one logical element on every platform, so test code stays identical and only the selectors differ.

**`page-repository.json`**

```json
{
  "pages": [
    {
      "name": "LoginPage",
      "platform": "web",
      "elements": [
        { "elementName": "username", "selector": { "css": "input[name='username']" } },
        { "elementName": "submit", "selector": { "css": "button[type=submit]" } },
        { "elementName": "welcome", "selector": { "text": "Welcome back" } }
      ]
    },
    {
      "name": "LoginPage",
      "platform": "android",
      "elements": [
        { "elementName": "username", "selector": { "id": "com.example.app:id/username" } },
        { "elementName": "submit", "selector": { "accessibility id": "login-submit" } },
        { "elementName": "welcome", "selector": { "uiautomator": "new UiSelector().textStartsWith(\"Welcome\")" } },
        { "elementName": "rows", "list": true, "selector": { "xpath": "//android.widget.TextView[@resource-id='com.example.app:id/row']" } }
      ]
    },
    {
      "name": "LoginPage",
      "platform": "ios",
      "elements": [
        { "elementName": "username", "selector": { "id": "username" } },
        { "elementName": "submit", "selector": { "accessibility id": "login-submit" } },
        { "elementName": "welcome", "selector": { "predicate": "label BEGINSWITH \"Welcome\"" } },
        { "elementName": "rows", "list": true, "selector": { "class chain": "**/XCUIElementTypeCell/XCUIElementTypeStaticText" } },
        { "elementName": "doneLabel", "selector": { "text": "Done" } }
      ]
    }
  ]
}
```

**Rules:**
- `platform` must be one of `web`, `android`, `ios`, `macos`, `windows` (exact, lowercase). Any other value — including legacy values such as `"mobile"` — is rejected when the repository is constructed.
- A missing `platform` means `web`. A page `name` may appear at most once per platform; a duplicate `name` + `platform` pair is rejected.
- `macos` and `windows` are declared but **not implemented yet**: their pages resolve through the base Appium selector table, with no desktop-specific behaviour.

**Choosing the block — the active platform.** Construct the repository with `{ platform }` and every method that takes a `pageName` uses the page whose `name` matches **and** whose `platform` (missing = `web`) equals the active platform:

```typescript
const repo = new ElementRepository(driver, 'tests/data/page-repository.json', { platform: 'ios' });
await (await repo.get('submit', 'LoginPage')).click(); // the "ios" LoginPage block
```

If the page exists only for other platforms, the lookup throws (there is no silent fallback to another platform's block):

```
Page "LoginPage" has no entry for platform "ios". Available: web, android.
```

`Available:` lists the platforms that do declare the page, in file order, or `none`. Without an active platform the repository keeps the behaviour of earlier versions: the **first** page with that name wins, and an unknown page throws `ElementRepository: Page '<name>' not found.`. The active platform is held per instance (no global or static state), so repositories for different platforms can be used side by side in one process.

### Supported Selector Keys

The `platform` of each page block determines which selector format is used. If `platform` is omitted, it defaults to `web`.

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

#### Non-Web / Native (Appium)

| Key | camelCase Alias | Resolves To | Example |
|-----|-----------------|-------------|---------|
| `accessibility id` | `accessibilityId` | `~<value>` | `"accessibility id": "LoginBtn"` |
| `id` | — | per platform, see below — never a CSS `#id` | `"id": "submit-btn"` |
| `xpath` | — | `<value>` (raw) | `"xpath": "//android.widget.Button"` |
| `text` | — | per platform, see below (android, ios only) | `"text": "Sign in"` |
| `uiautomator` | `androidUIAutomator` | `android=<value>` | `"uiautomator": "new UiSelector().text(\"Go\")"` |
| `predicate` | `iOSNsPredicateString` | `-ios predicate string:<value>` | `"predicate": "label == \"Login\""` |
| `class chain` | `iOSClassChain` | `-ios class chain:<value>` | `"class chain": "**/XCUIElementTypeButton"` |
| `class name` | `className` | `<value>` (raw) | `"class name": "android.widget.EditText"` |

> All strategy keys that contain spaces also accept a camelCase alias (e.g., `"accessibilityId"` instead of `"accessibility id"`). The enhanced `role` + `name` selector also works on platform pages.

**`id` per platform:**

| Platform | `"id": "submit"` resolves to |
|----------|------------------------------|
| `android` | `id=submit` — Appium's native `id` strategy, matched against `resource-id`. A full id (`com.example.app:id/submit`) is used as-is; a short id is prefixed with the current app package (`<package>:id/submit`), so an element of another package needs its full resource id. |
| `ios` | `-ios predicate string:name == "submit"` — an exact match on `name` (XCUITest exposes the accessibility identifier as `name`). Quotes and backslashes are escaped. |
| `macos`, `windows` | `~submit` (accessibility id) — the base Appium table. |

**`text` per platform:**

| Platform | `"text": "Sign in"` resolves to |
|----------|---------------------------------|
| `android` | `android=new UiSelector().text("Sign in")` — exact match. Only double quotes are escaped: UiAutomator2's UiSelector parser decodes `\"` but not `\\`, so other backslashes are sent unchanged. A value that **ends in `\`** cannot be expressed this way: the formatter throws an error pointing you to an `xpath` selector. |
| `ios` | `-ios predicate string:label == "Sign in"` — exact match on `label`; quotes and backslashes are escaped. |

### Selector Fallback Chains

Add a nested `fallback` selector to handle DOM variations (per country, per brand, per renderer) without duplicating repo entries. When the primary does not attach within the probe timeout — the call's `options.timeout` when given, otherwise the repository's `defaultTimeout` (15 s by default) — resolution walks into `fallback`, recursively.

```json
{
  "elementName": "loginButton",
  "selector": {
    "css": "[data-qa='login-button']",
    "fallback": {
      "role": "button",
      "name": { "regex": "Log in|Iniciar sesión|Anmelden|Inloggen", "flags": "i" }
    }
  }
}
```

**Rules:**
- The probe timeout is the call's `options.timeout` when given, otherwise the repository's `defaultTimeout` (15 s by default).
- Primary attaches within the probe timeout → fallback is never consulted. `waitFor` resolves the moment the element appears, so the common case pays no timeout cost.
- Primary does not attach within the probe timeout → walk into `selector.fallback`.
- Primary **throws while it is being resolved** → walk into `selector.fallback` as well. This covers the strategies that pick their match eagerly: `TEXT` on a platform page that finds no match, and `ATTRIBUTE`, `RANDOM` and `INDEX` (web and platform) that find no match or an out-of-range index. If the rest of the chain fails too, the primary's error is rethrown.
- The probe waits on the first match only, so a primary that matches several elements counts as attached (`getAll()` / `ALL` still return every match of the primary).
- Entries without a `fallback` key skip the fallback probe. Every lookup (each node of a chain too) still waits while it resolves, by path, where *timeout* is `options.timeout` when given, else `defaultTimeout`:
  - **Default (no strategy), `ALL`, and `TEXT` on web** — standard selectors on any platform and enhanced selectors on web: a best-effort attach wait of at most 2 s (the smaller of 2 s and the timeout); its failure is swallowed and the element is returned. The full timeout applies when you act on the element (`click()`, `fill()`, …).
  - **Enhanced `role` + `name` and regex `text` on platform pages** (default and `ALL`, the only strategies they support): an attach wait of the full timeout; its failure is swallowed.
  - **`TEXT` on platform pages**: polls for a match for the full timeout, then throws `Element '<el>' on '<page>' with text "<value>" not found.`
  - **`ATTRIBUTE` and `RANDOM`** (web and platform): wait the full timeout for the first match (attached for `ATTRIBUTE`, visible for `RANDOM`), then throw `No elements found for '<el>' on '<page>'`; `ATTRIBUTE` also throws when no match has the attribute value.
  - **`INDEX`**: no wait; reads the current matches and throws `Index <i> out of bounds for '<el>' on '<page>' (found <n> elements).` when the index is out of range.
- Chains are recursive: `fallback.fallback.fallback` is legal.
- Fallbacks can mix strategies freely — CSS primary with role+name fallback, id primary with xpath fallback, etc.

**Worst-case latency** on an N-level chain where no node matches: about `N ×` the probe timeout (a node whose strategy waits the full timeout while resolving can add that wait on top). In practice fallbacks cover real DOM variants, so the first or second level matches on pages where the primary doesn't.

**Common uses:**
- **Multi-country DOM variants** — one entry serves every country instead of country-specific repo files.
- **Brand-specific primary + generic fallback** — prefer a brand-specific `data-qa`, degrade to a role selector.
- **Graceful degradation** — test works on both old and new DOM during progressive rollout.

### Entry Flags: `provisional` and `list`

Two optional boolean keys sit next to `elementName` and `selector`. Neither changes how an element is resolved; they record what the entry *means*, so tooling and consumer packages can act on it.

```json
{
  "elementName": "basketRows",
  "list": true,
  "selector": { "css": "[data-testid='basket-row']" }
},
{
  "elementName": "discountLine",
  "provisional": true,
  "selector": { "role": "row", "name": { "regex": "discount", "flags": "i" } }
}
```

- **`list`** — the entry is a collection: its contract is "at least one match" (count ≥ 1), not "exactly one element". Consumers read it with `getElementMeta()`; element-interactions uses it for `verifyPresence` / `getAll`. Default `false`.
- **`provisional`** — the entry has not been confirmed against the running application yet (for example, it was inferred from source code or documentation). `getProvisional()` lists these entries so a pipeline can confirm them or refuse to ship them. Default `false`.

Both keys are validated when the repository is constructed (and by the static `ElementRepository.validate(data)`): a value other than `true` / `false` — such as the string `"true"` — throws an error naming every offending `Page.element`.

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

// Option D: With an options object — active platform and/or timeout
const repo = new ElementRepository(page, locatorData, { platform: 'web', timeout: 30000 });

// Access the bound driver
const driver = repo.driver; // returns the Page/Browser passed to the constructor
```

### Native iOS and Android (WebdriverIO + Appium)

Pass a WebdriverIO `Browser` from `remote()` as the driver and name the active platform. Keep the capabilities in a JSON file rather than in code:

**`capabilities/ios.json`** (placeholder values)

```json
{
  "platformName": "iOS",
  "appium:automationName": "XCUITest",
  "appium:udid": "<device-udid>",
  "appium:bundleId": "com.example.app"
}
```

```typescript
import { readFileSync } from 'fs';
import { remote } from 'webdriverio';
import { ElementRepository, SelectionStrategy } from '@civitas-cerebrum/element-repository';

const capabilities = JSON.parse(readFileSync('capabilities/ios.json', 'utf-8'));
const driver = await remote({
  hostname: '<appium-server>',
  port: 4723,
  path: '/',            // your Appium base path, e.g. '/wd/hub'
  capabilities,
});

const repo = new ElementRepository(driver, 'tests/data/page-repository.json', { platform: 'ios' });

await (await repo.get('username', 'LoginPage')).fill('demo-user');
await (await repo.get('submit', 'LoginPage')).click();

// TEXT strategy on a platform page: compares each match's own text
const row = await repo.get('rows', 'LoginPage', { strategy: SelectionStrategy.TEXT, value: 'Settings' });
await row.click();

// Gestures
const map = await repo.get('map', 'MapPage');
await map.zoom({ scale: 2 });
await map.longPress({ duration: 1500 });

await driver.deleteSession();
```

For Android, use a capabilities file with `"platformName": "Android"`, `"appium:automationName": "UiAutomator2"` and `"appium:appPackage"`, and `{ platform: 'android' }`. The same test code then resolves the `android` page blocks.

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

// Fill, then read the value back
const value = await element.action()
  .fill('hello@test.com')
  .getInputValue()

// Scroll down until the element is displayed, then tap it
// (on web the browser scrolls and `direction` is ignored)
await element.action(10000)
  .scrollIntoView({ direction: 'down' })
  .click()

// Extraction (terminal — returns value)
const text = await element.action().getText()
const href = await element.action().getAttribute('href')
const count = await element.action().getCount()
```

#### Available Chain Methods

**Interactions:** `click(options?)`, `clickIfPresent(options?)`, `hover()`, `fill(text)`, `clear()`, `check()`, `uncheck()`, `doubleClick()`, `scrollIntoView(options?)`, `swipe(direction, options?)`, `pressSequentially(text, delay?)`, `longPress(options?)`, `tapAt(offset, options?)`, `pinch(options?)`, `zoom(options?)`, `dispatchEvent(event)`

**Extractions (terminal):** `getText()`, `getAttribute(name)`, `getInputValue()`, `getCount()`, `getRaw()`, `isPresent()`

An explicit `options.timeout` on `scrollIntoView`, `swipe`, `longPress`, `tapAt`, `pinch` or `zoom` overrides the chain timeout. The gesture methods wait for the element to be visible first. On platform (Appium) elements, `scrollIntoView` does **not** wait for the element first — an off-screen row of a lazy list is not in the element tree until it has been scrolled to — and `swipe` delegates straight to the element (which waits for attached itself); on web, `scrollIntoView` waits for attached and `swipe` for visible.

Assertions (`verifyText`, `verifyPresence`, …) are not part of this package; they live in the consumer packages (see [Package Contract](#-package-contract)).

**Waiting:** `waitForState(state)`

## 🛠️ API Reference

### ElementRepository

#### `constructor(driver, dataOrPath, options?)`

| Param | Type | Description |
|-------|------|-------------|
| `driver` | `any` | Playwright `Page` or WebdriverIO `Browser` (from `remote()`) |
| `dataOrPath` | `string \| PageRepository \| PageRepositoryInput` | Path to the JSON file (relative to the working directory) or the parsed data. `PageRepositoryInput` is the shape a typed JSON import produces (`platform` / `frameIndex` as plain strings); those values are checked at runtime. |
| `options` | `number \| ElementRepositoryOptions` | A number is the default wait timeout in ms (the earlier positional form). An object is `{ platform?, timeout? }`. Omitted: no active platform, timeout `15000`. |

```typescript
interface ElementRepositoryOptions {
  platform?: Platform;  // the ACTIVE platform of this instance (see Multi-Platform Configuration)
  timeout?: number;     // default element wait timeout in ms, default 15000
}
```

The data is validated on construction (see `validate`). An unknown `options.platform` throws `ElementRepository: unknown platform '<value>'. Expected one of: web, android, ios, macos, windows.`

#### `platform` (getter)

The active platform given in the constructor options (`Platform`), or `undefined` when none was given. Read-only.

#### `get(elementName, pageName, options?)`

Returns a single `Element`. Defaults to the first match. Pass `ElementResolutionOptions` to control selection:

```typescript
import { SelectionStrategy } from '@civitas-cerebrum/element-repository';

await repo.get('button', 'Page')                                                    // first (default)
await repo.get('button', 'Page', { strategy: SelectionStrategy.INDEX, index: 2 })   // by index
await repo.get('button', 'Page', { strategy: SelectionStrategy.RANDOM })             // random
await repo.get('button', 'Page', { strategy: SelectionStrategy.TEXT, value: 'Sub' }) // by text
await repo.get('button', 'Page', { strategy: SelectionStrategy.ATTRIBUTE,
                                   attribute: 'data-id', value: 'row-2' })           // by attribute value
await repo.get('button', 'Page', { strategy: SelectionStrategy.ALL })                // un-narrowed (for counts)
```

> An unhandled strategy value throws a descriptive error — resolution never
> silently falls back to the first matching element when a strategy was requested.

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

#### `getElementMeta(elementName, pageName)`

Returns `{ provisional, list }` for an entry, with defaults applied (`false`). Synchronous; reads the repository data only.

#### `getProvisional()`

Returns `[{ pageName, elementName }]` for every entry marked `"provisional": true`, in repository order. With an active platform set, only page blocks of that platform are listed.

#### `ElementRepository.validate(data)` (static)

Validates a repository without a driver (the constructor calls it too). It rejects:

- a page `platform` that is not one of `web`, `android`, `ios`, `macos`, `windows` (legacy values such as `"mobile"` included);
- a page `name` declared more than once for the same platform (a missing `platform` counts as `web`);
- a `frameIndex` other than `"first"`, `"last"` or an integer (a negative index counts from the end: `-1` is the last frame);
- an entry-level `provisional` or `list` that is not a JSON boolean (e.g. the string `"true"`).

It throws one error listing every problem: `ElementRepository: invalid repository — <problem>; <problem>.`

#### `getPagePlatform(pageName)`

Returns the page's `Platform` (`'web'` when the page has no `platform`). With an active platform set, this is the active platform whenever the page exists for it, and the lookup error above otherwise.

#### Lookup and the active platform

Every method that takes a `pageName` resolves it the same way: with an active platform, the page whose `name` matches and whose `platform` (missing = `web`) equals it, else `Page "<name>" has no entry for platform "<active>". Available: <list>.`; without one, the first page with that name, else `ElementRepository: Page '<name>' not found.`

#### Selection strategies on platform pages

- **Default (no strategy)** resolves the **first match**. `count()` and `all()` on that element return at most 1 — use `getAll()` or `SelectionStrategy.ALL` to count or iterate every match.
- **`TEXT`** picks its match eagerly: it fetches every match of the selector and compares each one's **own** text as the driver reports it through `getText()` — not the text of its descendants, as Playwright's `filter({ hasText })` does on web. The selector must therefore target the text-bearing element itself (the label or cell title), not a container around it. An exact (trimmed) match wins; otherwise the first case-insensitive, whitespace-normalised "contains" match. It polls until a match appears or the full timeout elapses, then throws `Element '<el>' on '<page>' with text "<value>" not found.` Fatal driver errors (invalid selector, dead session, lost connection) are rethrown at once. `all()` / `count()` on the result re-query the selector and return every match.
- A blank `TEXT` value throws `options.value is required when using SelectionStrategy.TEXT` (web and platform).
- Enhanced `role` + `name` and regex `text` selectors on platform pages support only the default and `ALL`; any other strategy throws.

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
| `scrollIntoView(options?)` | Scrolls into view. `options`: `{ direction?: 'up' \| 'down' \| 'left' \| 'right'; timeout? }`. Returns `Promise<Element>`. |
| `swipe(direction, options?)` | Swipes from the element centre. `options`: `{ distance?; timeout? }`. Returns `Promise<Element>`. |
| `pressSequentially(text, delay?, options?)` | Types character by character. Returns `Promise<Element>`. |
| `longPress(options?)` | Presses and holds on the element centre. `options`: `{ duration?: number; timeout? }`, `duration` in ms, default `1000`. Returns `Promise<void>`. |
| `tapAt(offset, options?)` | Taps at `{ x, y }` px from the element's top-left corner; `0 <= x < width`, `0 <= y < height`. Returns `Promise<void>`. |
| `pinch(options?)` | Two-finger pinch (fingers together). `options`: `{ scale?: number; timeout? }`, `scale` in (0, 1), default `0.5`. **Platform only.** Returns `Promise<void>`. |
| `zoom(options?)` | Two-finger zoom (fingers apart). `options`: `{ scale?: number; timeout? }`, `scale` > 1, default `2`. **Platform only.** Returns `Promise<void>`. |
| `setInputFiles(filePath, options?)` | Sets file input value. **Web only.** |
| `dispatchEvent(event)` | Dispatches a DOM event. **Web only.** |

All interaction methods accept an optional `{ timeout?: number }`; the ones returning `Promise<Element>` return the element for simple chaining.

#### Gestures and scrolling per platform

| Method | Platform (Appium) element | Web (Playwright) element |
|--------|---------------------------|--------------------------|
| `scrollIntoView` | Sweeps the screen in **one** direction until the element is displayed, up to 20 swipes, then throws. `direction` says where the target is: `'down'` (default) reveals content below, `'up'` above, `'left'` / `'right'` to that side. No bidirectional mode — call it twice if the position is unknown. | The browser scrolls whatever is needed; `direction` is ignored. |
| `swipe` | W3C touch pointer from the element centre (window centre when the driver reports no rect); default distance ~50% of the window in that axis. | Mouse drag from the element centre. |
| `longPress` | One W3C touch pointer: down, pause `duration`, up. | Scrolls into view, checks the element itself (not a cover over it) receives the pointer, then holds the primary mouse button for `duration`. |
| `tapAt` | W3C touch tap at the point. | Playwright `click({ position })`. |
| `pinch` / `zoom` | Two W3C touch pointers on the horizontal axis through the element centre (fingers 40% of the element width from the centre, never closer than 10 px; outer positions clamped to the window). | Throw `PlatformNotSupportedError` (`"pinch" is not supported on platform "web".`). |

On platform elements, gestures and swipes use **native-context viewport coordinates** — the space of the element rect and the window size; in a webview context CSS pixels may differ. The gesture point (the element centre, or the `tapAt` point) must be inside the window: call `scrollIntoView` first for an off-screen element. The pointer is always released; if the gesture failed, that error is thrown. `longPress` rejects a negative or non-finite `duration`, `tapAt` an offset outside the element bounds, `pinch` a `scale` outside (0, 1) and `zoom` a `scale` not greater than 1.

#### Platform elements (`PlatformElement`)

- `first()` and `nth(index)` index for real: `nth(i)` acts on the i-th match of the selector (negative counts from the end, `-1` is the last; a non-integer index throws `nth: index must be an integer, got <i>`). They are lazy, like Playwright: the match is looked up when the element is used. `first()` / `nth(0)` use WebdriverIO's `$` and its own waiting, like an unindexed element. Any other index polls `$$`: actions wait up to their `timeout`, and reads (`textContent()`, `getAttribute()`, `inputValue()`, …) up to the element's default timeout, for the match to appear, then throw `nth(<i>): no element at that index for "<selector>" (found <n>)`; `isVisible()` and `exists()` do not wait (a missing match is `false`). `count()` / `all()` on an element made by `first()` / `nth()` return at most that one match.
- On an element that is already a single match (made by `first()` / `nth()`, or taken from `all()`), `first()`, `nth(0)` and `nth(-1)` return the element itself, and any other index returns an element that matches nothing: `count()` is 0, `exists()` and `isVisible()` are `false`, and actions and reads fail at once with `nth(<i>): "<selector>" is already a single match, so this index matches nothing`.
- `locateChild(selector)` searches inside the parent's match (WebdriverIO `parent.$` / `parent.$$`), honouring the parent's index: the child of `nth(2)` searches inside the third match. It is lazy; a child of a missing indexed parent waits like an action, then fails with the parent's out-of-range error, and its `count()` is 0.
- `filter({ hasText })` throws `PlatformNotSupportedError` (`"filter" is not supported on platform "<platform>".`) — WebdriverIO has no lazy text filter; use the `TEXT` selection strategy instead. An empty filter returns the element unchanged.
- `setInputFiles` and `dispatchEvent` throw `PlatformNotSupportedError` naming the element's platform.
- `textContent()` returns the element's own text from the driver's `getText()`.

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
| `first()` | Returns the first match (platform: see [Platform elements](#platform-elements-platformelement)). |
| `nth(index)` | Returns the element at the index; negative counts from the end (platform: see above). |
| `filter({ hasText })` | Filters by text content (web; platform throws `PlatformNotSupportedError`). |
| `locateChild(selector)` | Locates a descendant inside this element's match (platform: honours the parent's index). |
| `waitFor(options?)` | Waits for state: `"visible"`, `"hidden"`, `"attached"`, `"detached"`. |
| `action(timeout?)` | Returns a fluent `ElementChain` builder. |

### Platform Vocabulary

```typescript
import {
  Platform, DriverFamily, PLATFORMS, isPlatformName, familyOf,
} from '@civitas-cerebrum/element-repository';

type Platform = 'web' | 'android' | 'ios' | 'macos' | 'windows';
type DriverFamily = 'playwright' | 'appium';

PLATFORMS;                 // readonly ['web', 'android', 'ios', 'macos', 'windows'] (frozen)
isPlatformName('ios');     // true  — exact, case-sensitive
isPlatformName('mobile');  // false
familyOf('web');           // 'playwright'
familyOf('android');       // 'appium' (ios, macos, windows too)
```

`familyOf` throws `Unknown platform '<value>'. Expected one of: web, android, ios, macos, windows.` for a value outside `PLATFORMS`. `macos` and `windows` are declared (they belong to the `appium` family) but desktop support is **not implemented yet**: their pages use the base Appium selector table, with no desktop-specific behaviour.

### `PlatformNotSupportedError`

Thrown when an operation exists in the API but cannot run on the given platform — `pinch` / `zoom` on web, `filter` / `setInputFiles` / `dispatchEvent` on a platform element.

```typescript
import { PlatformNotSupportedError } from '@civitas-cerebrum/element-repository';

try {
  await webElement.pinch();
} catch (e) {
  if (e instanceof PlatformNotSupportedError) {
    e.method;   // 'pinch'
    e.platform; // 'web'
    e.message;  // '"pinch" is not supported on platform "web".'
  }
}
```

This package holds the only definition of the class; consumer packages re-export it, so `instanceof` works across packages.

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

## ⚠️ Breaking Changes (v0.4.0)

| Change | Migration |
|---|---|
| A page's `platform` must be a `Platform`: `web`, `android`, `ios`, `macos` or `windows` (exact, lowercase). Legacy values such as `"mobile"` are rejected at construction. | Rename the value, e.g. `"mobile"` → `"android"` or `"ios"`. Run `ElementRepository.validate(data)` in a lint step to find them. |
| A page `name` declared twice for the same platform is rejected (a missing `platform` counts as `web`). | Merge the duplicate blocks, or give each its own platform. |
| An invalid `frameIndex` is rejected. | Use `"first"`, `"last"` or an integer. |
| The root `PageObject.platform` (and `PageRepository`'s) is typed `Platform`, not `string`. | Type your values as `Platform`, or pass JSON imports as `PageRepositoryInput` (checked at runtime). |
| A blank `TEXT` strategy value throws `options.value is required when using SelectionStrategy.TEXT`, on web too. | Pass a non-blank value, or omit the strategy. |
| A default-resolved platform element is the first match, so `count()` / `all()` on it return at most 1. | Use `getAll()` or `SelectionStrategy.ALL` to count or iterate. |
| `id` on a platform page is no longer a CSS `#v`: android → `id=v` (resource-id; a short id gets the app package prefix), ios → predicate `name == "v"`, macos / windows → `~v` (accessibility id). | Check every platform `id` entry still finds its element; switch to `accessibility id`, `xpath` or a full android resource id (`com.example:id/v`) where it does not. |
| `text` on platform pages is now escaped: android escapes `"` (backslashes unchanged), ios escapes `"` and `\`. An android value that ends in `\` throws (pointing to `xpath`); so do enhanced android `role` + `name` and regex `text` selectors whose name or pattern ends in `\`. | Remove hand-written escaping from `text` values (pre-escaped values are now escaped twice). Use an `xpath` selector for an android value that ends in `\`. |
| `PlatformElement.filter(...)` with any criterion throws `PlatformNotSupportedError` (it used to return the element unchanged, ignoring the filter). | Use `SelectionStrategy.TEXT` (or `getByText`) instead. An empty filter still returns the element. |
| `PlatformElement.first()` / `nth(i)` index for real (they used to return the element unchanged). Actions wait for the match, then throw when the index is out of range; `nth(k)` with `k` other than `0` / `-1` on an element that is already a single match matches nothing. | Check calls that relied on `nth(i)` being a no-op: pass the index you mean, call `nth` on the multi-match element (e.g. from `ALL`), or use `getAll()`. |
| `PlatformElement.locateChild(selector)` searches inside the parent's match, honouring its index (it used to search the whole screen). | Write child selectors relative to the parent, or look the element up on its own when it lies outside the parent. |
| The `Element` interface has new required methods `longPress`, `tapAt`, `pinch` and `zoom`. | Custom `Element` implementations and test mocks must add them (a stub that throws is enough where unused). |
| `PlatformElement.setInputFiles` / `dispatchEvent` throw `PlatformNotSupportedError` (`"<method>" is not supported on platform "<platform>".`) instead of a plain `Error` (`<method> is not supported on platform elements.`). | Update assertions on the message; catch `PlatformNotSupportedError` to tell these apart. |
| The optional `webdriverio` peer is `^10` (was `^9.27.0`). WebdriverIO 10 needs Node.js `>=22.23.4 <23`, `>=24.22.1 <25` or `>=26.12.1`. | Upgrade WebdriverIO to 10 and Node.js to a supported version. |

Not breaking, but new: the third constructor argument also takes `{ platform?, timeout? }`; with an active platform, lookups use the page block for that platform only (see [Multi-Platform Configuration](#multi-platform-configuration)).

## ⚠️ Breaking Changes (v0.1.0)

| Change | Migration |
|---|---|
| Constructor requires `driver` as first arg | `new ElementRepository(data)` → `new ElementRepository(page, data)` |
| Methods drop `driver`/`page` first param | `repo.get(page, 'Page', 'el')` → `repo.get('el', 'Page')` |
| Param order flipped to `(elementName, pageName)` | Swap args in all calls |
| Element methods return `Promise<Element>` | Was `Promise<void>` — no action needed unless you depend on `void` |
| `raw()` returns actual selector string | Was `locator.toString()` — likely an improvement |

## License

MIT
