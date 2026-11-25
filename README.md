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

**Waiting is not retrying.** Acquisition waits that give native elements Playwright-equivalent auto-wait (an action waiting for its element to attach, a lookup polling until a match appears) are primitives and live here; retry-on-mismatch is not.

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
ElementRepository: page 'LoginPage' has no entry for platform 'ios'. Available: web, android.
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
const repo = new ElementRepository(page, locatorData, { platform: 'web', defaultTimeout: 30000 });

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
// (on web the browser scrolls and `direction` is ignored).
// The chain timeout never reaches scrollIntoView, so pass its own timeout.
await element.action(10000)
  .scrollIntoView({ direction: 'down', timeout: 10000 })
  .click()

// Extraction (terminal — returns value)
const text = await element.action().getText()
const href = await element.action().getAttribute('href')
const count = await element.action().getCount()
```

#### Available Chain Methods

**Interactions:** `click(options?)`, `clickIfPresent(options?)`, `hover()`, `fill(text)`, `clear()`, `check()`, `uncheck()`, `doubleClick()`, `scrollIntoView(options?)`, `swipe(direction, options?)`, `pressSequentially(text, delay?)`, `longPress(options?)`, `tapAt(offset, options?)`, `pinch(options?)`, `zoom(options?)`, `dispatchEvent(event)`

**Extractions (terminal):** `getText()`, `getAttribute(name)`, `getInputValue()`, `getCount()`, `getRaw()`, `isPresent()`

The chain is a sequencer: it does not branch on the backend. What each step waits for:

- `click()` waits for visible, then clicks. `click({ withoutScrolling: true })` waits for attached, then calls `element.click({ withoutScrolling: true })`; `clickIfPresent({ withoutScrolling: true })` passes the option to the click the same way. What the option means per backend is defined on the element (see [Interaction Methods](#interaction-methods)).
- `scrollIntoView` and `swipe` do **not** wait in the chain; the element waits for itself. Web `scrollIntoView` waits for attached and web `swipe` for visible. Platform `swipe` waits for attached; platform `scrollIntoView` does not wait at all, because an off-screen row of a lazy list is not in the element tree until it has been scrolled to.
- `longPress`, `tapAt`, `pinch` and `zoom` wait for visible first.

An explicit `options.timeout` on `swipe`, `longPress`, `tapAt`, `pinch` or `zoom` overrides the chain timeout; otherwise the chain timeout is passed to the element. `scrollIntoView` is the exception: the chain passes its options on as given; the chain timeout is never applied to `scrollIntoView`, because a sweep is time-bounded only by a timeout the caller passes to that call (see [Gestures and scrolling per platform](#gestures-and-scrolling-per-platform)). So `element.action(10000).scrollIntoView()` on a platform element is bounded by the swipe limit; write `.scrollIntoView({ timeout: 10000 })` to bound it by time.

Assertions (`verifyText`, `verifyPresence`, …) are not part of this package; they live in the consumer packages (see [Package Contract](#-package-contract)).

**Waiting:** `waitForState(state)`

## 🛠️ API Reference

### ElementRepository

#### `constructor(driver, fileOrData, options?)`

| Param | Type | Description |
|-------|------|-------------|
| `driver` | `any` | Playwright `Page` or WebdriverIO `Browser` (from `remote()`) |
| `fileOrData` | `string \| PageRepository \| PageRepositoryInput` | Path to the JSON file (relative to the working directory) or the parsed data. `PageRepositoryInput` is the shape a typed JSON import produces (`platform` / `frameIndex` as plain strings); those values are checked at runtime. |
| `options` | `number \| ElementRepositoryOptions` | A number is the default wait timeout in ms (the earlier positional form). An object is `{ platform?, defaultTimeout? }` (`timeout` is accepted as an alias). Omitted: no active platform, timeout `15000`. |

```typescript
interface ElementRepositoryOptions {
  platform?: Platform;      // the ACTIVE platform of this instance (see Multi-Platform Configuration)
  defaultTimeout?: number;  // default element wait timeout in ms, default 15000 (same value setDefaultTimeout() sets)
  timeout?: number;         // alias of defaultTimeout; when both are given, defaultTimeout wins
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

Every method that takes a `pageName` resolves it the same way: with an active platform, the page whose `name` matches and whose `platform` (missing = `web`) equals it, else `ElementRepository: page '<name>' has no entry for platform '<active>'. Available: <list>.`; without one, the first page with that name, else `ElementRepository: Page '<name>' not found.`

#### Selection strategies on platform pages

- **Default (no strategy)** resolves the **first match**. `count()` and `all()` on that element return at most 1 — use `getAll()` or `SelectionStrategy.ALL` to count or iterate every match.
- **`TEXT`** picks its match eagerly: it fetches every match of the selector and compares each one's **own** text, read with the same rule as `textContent()` (see [Platform elements](#platform-elements-platformelement): on iOS `label`, else `value`; on Android the driver's `getText()`, or the joined text of its descendants when that is empty; elsewhere the driver's `getText()`) — not the text of its descendants, as Playwright's `filter({ hasText })` does on web (Android's empty-container fallback is the one exception). The selector should therefore target the text-bearing element itself (the label or cell title), or on Android a container without text of its own. Such a container row costs 2 + K driver round trips under `TEXT` and `getByText` (its own text, the descendant query, one read per K text-bearing descendants) instead of one, so a selector matching many rows is slower than one matching their title TextViews; a selector matching a large container (a whole list or screen) reads every text inside it; and a descendant whose own `text` already repeats its children's text (a node that merges its children's text, as some Compose layouts report) has that text counted twice (rare). An exact (trimmed) match wins; otherwise the first case-insensitive, whitespace-normalised "contains" match. It polls until a match appears or the full timeout elapses, then throws `Element '<el>' on '<page>' with text "<value>" not found.` Fatal driver errors (invalid selector, dead session, lost connection) are rethrown at once. `all()` / `count()` on the result re-query the selector and return every match.
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
| `click(options?)` | Clicks the element. `options`: `ClickOptions` = `{ withoutScrolling?: boolean; timeout? }` (see below). Returns `Promise<Element>`. |
| `fill(text, options?)` | Clears and fills with text. Returns `Promise<Element>`. |
| `clear(options?)` | Clears the element's value. Returns `Promise<Element>`. |
| `check(options?)` | Checks a checkbox/radio; does nothing when it is already checked (platform: see [Platform elements](#platform-elements-platformelement)). Returns `Promise<Element>`. |
| `uncheck(options?)` | Unchecks a checkbox; does nothing when it is already unchecked (platform: see [Platform elements](#platform-elements-platformelement)). Returns `Promise<Element>`. |
| `hover(options?)` | Hovers over the element. Returns `Promise<Element>`. |
| `doubleClick(options?)` | Double-clicks. Returns `Promise<Element>`. |
| `scrollIntoView(options?)` | Scrolls into view. `options`: `{ direction?: 'up' \| 'down' \| 'left' \| 'right'; maxSwipes?: number; timeout? }` (`maxSwipes` is platform only, default `20`; a `maxSwipes` that is not a positive integer throws on every backend). Returns `Promise<Element>`. |
| `swipe(direction, options?)` | Swipes from the element centre. `options`: `{ distance?; timeout? }`. Returns `Promise<Element>`. |
| `pressSequentially(text, delay?, options?)` | Types character by character. Returns `Promise<Element>`. |
| `longPress(options?)` | Presses and holds on the element centre. `options`: `{ duration?: number; timeout? }`, `duration` in ms, default `1000`. Returns `Promise<Element>`. |
| `tapAt(offset, options?)` | Taps at `{ x, y }` px from the element's top-left corner; `0 <= x < width`, `0 <= y < height`. Returns `Promise<Element>`. |
| `pinch(options?)` | Two-finger pinch (fingers together). `options`: `{ scale?: number; timeout? }`, `scale` in (0, 1), default `0.5`. **Platform only.** Returns `Promise<Element>`. |
| `zoom(options?)` | Two-finger zoom (fingers apart). `options`: `{ scale?: number; timeout? }`, `scale` > 1, default `2`. **Platform only.** Returns `Promise<Element>`. |
| `setInputFiles(filePath, options?)` | Sets file input value. **Web only.** Returns `Promise<Element>`. |
| `dispatchEvent(event)` | Dispatches a DOM event. **Web only.** Returns `Promise<Element>`. |

All interaction methods accept an optional `{ timeout?: number }` and return the element for simple chaining.

**`click({ withoutScrolling: true })`** clicks without scrolling the element into view first:

- **Web:** waits for the element to be attached, then dispatches a DOM `click` event on it — no scrolling and no actionability checks.
- **Platform (Appium):** the option changes nothing. A platform click is always the plain WebDriver element click, which taps the element where it is and never scrolls.

#### Gestures and scrolling per platform

| Method | Platform (Appium) element | Web (Playwright) element |
|--------|---------------------------|--------------------------|
| `scrollIntoView` | Sweeps the screen in **one** direction until the element is displayed, up to `maxSwipes` swipes (default `20`), then throws (each swipe is about 0.9 s of gesture time: 100 ms hold, 600 ms move, 200 ms settle; more on a real device). Only a `timeout` passed to this call bounds the sweep by time: no new swipe starts once that many ms have passed, so the call can overrun it by at most one swipe. Without one, only the swipe limit applies (the element's default timeout does not bound it). The error names the bound that was hit. It does not wait for the element to attach first. `direction` says where the target is: `'down'` (default) reveals content below, `'up'` above, `'left'` / `'right'` to that side. No bidirectional mode — call it twice if the position is unknown. | The browser scrolls whatever is needed; `direction` and `maxSwipes` are ignored; the Playwright timeout is `options.timeout`, else the element's default timeout (the repository default timeout). |
| `swipe` | Waits for attached, then sends a W3C touch pointer from the element centre (window centre when the driver reports no rect); default distance ~50% of the window in that axis; the start point must be inside the window and the end point is clamped to it (`[0, width-1]` x `[0, height-1]`). | Waits for visible, then a mouse drag from the element centre. |
| `longPress` | One W3C touch pointer: down, pause `duration`, up. | Scrolls into view, checks the element itself (not a cover over it) receives the pointer, then holds the primary mouse button for `duration`. |
| `tapAt` | W3C touch tap at the point. | Playwright `click({ position })`. |
| `pinch` / `zoom` | Two W3C touch pointers on the horizontal axis through the element centre (fingers 40% of the element width from the centre, never closer than 10 px; outer positions clamped to the window). | Throw `PlatformNotSupportedError` (`"pinch" is not supported on platform "web".`). |

On platform elements, gestures and swipes use **native-context viewport coordinates** — the space of the element rect and the window size; in a webview context CSS pixels may differ. The gesture point (the element centre, or the `tapAt` point) and the swipe start point must be inside the window, or the call throws: call `scrollIntoView` first for an off-screen element. The swipe end point is not checked but clamped to the window, so near an edge a swipe travels less than `distance`; a swipe whose start point is on the edge it moves toward throws (`nothing to swipe`) rather than sending a press. The pointer is always released; if the gesture failed, that error is thrown. `longPress` rejects a negative or non-finite `duration`, `tapAt` an offset outside the element bounds, `pinch` a `scale` outside (0, 1) and `zoom` a `scale` not greater than 1.

#### Platform elements (`PlatformElement`)

- `first()` and `nth(index)` index for real: `nth(i)` acts on the i-th match of the selector (negative counts from the end, `-1` is the last; a non-integer index throws `nth: index must be an integer, got <i>`). They are lazy, like Playwright: the match is looked up when the element is used. `first()` / `nth(0)` use WebdriverIO's `$` and its own waiting, like an unindexed element, except on a child made by `locateChild`, which is always polled with `$$`. Any other index polls `$$`: actions wait up to their `timeout`, and reads (`textContent()`, `getAttribute()`, `inputValue()`, …) up to the element's default timeout, for the match to appear, then throw `nth(<i>): no element at that index for "<selector>" (found <n>)`; `isVisible()` and `exists()` do not wait (a missing match is `false`). `count()` / `all()` on an element made by `first()` / `nth()` return at most that one match.
- On an element that is already a single match (made by `first()` / `nth()`, or taken from `all()`), `first()`, `nth(0)` and `nth(-1)` return the element itself, and any other index returns an element that matches nothing: `count()` is 0, `exists()` and `isVisible()` are `false`, and actions and reads fail at once with `nth(<i>): "<selector>" is already a single match, so this index matches nothing`.
- `locateChild(selector)` searches inside the parent's match (WebdriverIO `parent.$` / `parent.$$`), honouring the parent's index: the child of `nth(2)` searches inside the third match. It is lazy, and every child is polled with `$$`: actions wait up to their `timeout`, and reads up to the element's default timeout, for the parent and the child, then fail naming the missing element (`parent "<selector>" not found`, `no element matches "<child>" inside "<parent>"`, or the parent's out-of-range error). A child of a missing parent has `count()` 0 and `isVisible()` / `exists()` `false`, without waiting.
- `filter({ hasText })` throws `PlatformNotSupportedError` (`"filter" is not supported on platform "<platform>".`) — WebdriverIO has no lazy text filter; use the `TEXT` selection strategy instead. An empty filter returns the element unchanged.
- `setInputFiles` and `dispatchEvent` throw `PlatformNotSupportedError` naming the element's platform.
- `textContent()` returns the element's own visible text, trimmed, or `null`. On iOS it reads the `label` attribute, then `value`; for text inputs (`XCUIElementTypeTextField`, `SecureTextField`, `TextView`, `SearchField`) it reads `value` first, then `label`. (XCUITest's own `getText()` returns `value` first, so a Settings row with a badge would read as the badge count.) On Android it is the driver's `getText()`; when that is empty (or whitespace only) the element is read as a container: the text of its descendants that have a non-empty `text` and are not showing a hint (an empty input reports its hint as `text` with `showing-hint="true"`), each trimmed, joined with single spaces in document order (a list row `text=""` with child TextViews `Item 1` and `Alpha` reads `Item 1 Alpha`). Descendants are not filtered by `displayed`. The fallback costs one extra query (XPath `.//*[@text!='' and not(@showing-hint='true')]`, sent as a find-elements from the element) plus one text read per descendant found, so 2 + K round trips in all, and only runs when the own text is empty; with no descendant text the own text is returned. Every descendant is read, so an element that is a large container reads every text inside it, and a descendant whose own `text` already repeats its children's text has that text appear twice (rare: a TextView has no children). On other platforms it is the driver's `getText()`. `rawText()` returns the same text untrimmed (the joined Android text has no outer whitespace). The `TEXT` selection strategy and `getByText` use the same rule.
- `isChecked()` reads the platform's own state. Android: the `checked` attribute is `"true"` (UiAutomator2 keeps `selected` `"false"` on a checked CheckBox, Switch or RadioButton). iOS: for `XCUIElementTypeSwitch` / `XCUIElementTypeToggle`, `value` is `"1"` (or `"true"`); for any other type, `selected` (a plain row's `value` can be a badge count, so it is never read as state). Other platforms: WebdriverIO `isSelected()`. On iOS this costs two driver reads (type, then state), elsewhere one.
- `check()` / `uncheck()` read the state the same way and do nothing when it already matches. Otherwise, in this order:
  - Android, fail at once without a click: an element whose `checkable` attribute is `"false"` throws `check: "<selector>" is not checkable` (or `uncheck: ...`); `uncheck()` on a checked `android.widget.RadioButton` throws `uncheck: "<selector>" is a radio button; select another option instead` (clicking a checked radio never unchecks it). A missing `checkable` attribute does not fail. iOS has no radio button type and is not checked for either.
  - The element must be enabled. Like Playwright's actionability wait, `isEnabled()` is polled within the action's `timeout`; a control still disabled when the timeout runs out throws `check: "<selector>" is disabled` (or `uncheck: ...`) without a click. A control that turns enabled in time is clicked.
  - One click, then the state is polled until it matches, within the same `timeout` (default: the element's default timeout) counted from the start of the call, with at least one read after the click; otherwise `check: "<selector>" is still unchecked after clicking` / `uncheck: "<selector>" is still checked after clicking`.
  - On iOS the element type is read once per call, not on every poll.
- A read of a missing element names the method: `textContent()`, `rawText()`, `getAttribute()`, `getTagName()`, `isEnabled()` and `isChecked()` (and `inputValue()` where its read throws: on Android it reads a missing element as `''`) throw `<method>: "<selector>" not found within N ms: <reason>`. On a default-resolved element the reason is WebdriverIO's own error (`Can't call getText on element with selector ... because element wasn't found`), N is the driver's `waitforTimeout` (left out when the driver does not report it), and the WebdriverIO error is the `cause`; on an indexed or child element N is the element's timeout. An element that matches nothing (see `nth()` above) fails at once and the message leaves out `within N ms`. Gestures (`longPress`, `tapAt`, `pinch`, `zoom`) on a missing element use the same wording: `<method>: "<selector>" not found within N ms` on a default-resolved element; on an indexed or child element the reason is appended (`<method>: nth(<i>) of "<selector>" not found within N ms: <reason>`), and on an element that matches nothing `within N ms` is left out (`<method>: <element> not found: <reason>`).
- Errors name an element by its selector (`"<selector>"`). Only an index other than `0` given with `nth()` is named: `nth(<i>) of "<selector>"`; an element from a plain repository lookup (internally the first match) and `first()` / `nth(0)` read as `"<selector>"`. A child adds `inside <parent>`.
- `getAttribute(name)` on Android returns `null` for an attribute the element does not have (UiAutomator2 sends the string `"null"`, which is mapped). `getByAttribute` and the `ATTRIBUTE` strategy read through `getAttribute()`, so an element without the attribute never matches. An attribute whose real value is the text `null` is indistinguishable from a missing one (UiAutomator2 sends the same string), so it also reads as `null`. `inputValue()` on Android reads `text` without this mapping and reads an empty field as `''` by comparing `text` with `hint`; a field without a hint (hint `"null"`) has no hint, so a field holding the text `null` returns the string `"null"`, not `''` or `null`.
- `getTagName()` returns the element class: on iOS the XCUITest type (`XCUIElementTypeButton`), on Android the `class` attribute (`android.widget.Button`). UiAutomator2's own tag name is the content-desc when one is set (and `null` otherwise), so it is not used. `check()` / `uncheck()` and the iOS text and switch rules read the class the same way. It throws for a missing element (as on web). `exists()` returns `false` for a missing element but rethrows a fatal driver error (see `isFatalDriverError` below).

#### State, Extraction, Querying, and Waiting

| Method | Description |
|--------|-------------|
| `isVisible()` | Returns `true` if visible. |
| `isEnabled()` | Returns `true` if enabled. |
| `isChecked()` | Returns `true` if checked (platform: per-platform state, see above). |
| `raw()` | Returns the selector string. |
| `textContent()` | Returns text content or `null` (web: untrimmed DOM `textContent`; platform: trimmed, see above). |
| `rawText()` | Returns the text as `textContent()` reads it, never trimmed, or `null`. |
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

`familyOf` throws `ElementRepository: unknown platform '<value>'. Expected one of: web, android, ios, macos, windows.` for a value outside `PLATFORMS`. `macos` and `windows` are declared (they belong to the `appium` family) but desktop support is **not implemented yet**: their pages use the base Appium selector table, with no desktop-specific behaviour.

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

### Helpers for consumer packages

Consumer packages import these instead of keeping their own copies, so screen-level gestures and error handling behave exactly like the element primitives:

| Export | What it is |
|--------|------------|
| `isFatalDriverError(error)` | `true` for a WebDriver / WebdriverIO error that no polling can fix: an invalid selector or argument, an unknown command or unsupported operation, or a session, window or connection that is gone. Every other error (`no such element`, `stale element reference`, anything unrecognised) counts as a transient missing element. The platform element and the repository's polling lookups use this rule. |
| `SWIPE_HOLD_MS`, `SWIPE_MOVE_MS`, `SWIPE_SETTLE_MS` | Swipe timing in ms: `100` hold after finger down, `600` travel, `200` settle pause before the next read. |
| `buildTouchSwipe(from, to, options?)` | The W3C touch action sequence of a one-finger swipe (move, down, hold, move, up), coordinates rounded. `options` (`TouchSwipeOptions`): `{ holdMs?, moveMs? }`, the hold and travel durations in ms (defaults `SWIPE_HOLD_MS`, `SWIPE_MOVE_MS`). |
| `performTouchActions(driver, sources)` | Sends W3C pointer sources with `performActions` and always calls `releaseActions`; a release error never masks the gesture's own error. |
| `performTouchSwipe(driver, from, to, options?)` | `buildTouchSwipe` (with the same `TouchSwipeOptions`) sent through `performTouchActions`. It does not pause afterwards; wait `SWIPE_SETTLE_MS` before reading the screen. |
| `touchPointers(fingers)` | Wraps per-finger action lists as touch pointer sources `finger1`, `finger2`, … |
| `TouchPoint`, `TouchAction`, `TouchPointerSource`, `TouchSwipeOptions` | Types of the touch helpers. Coordinates are native-context viewport coordinates. |
| `ClickOptions`, `ScrollIntoViewOptions`, `SwipeDirection`, `SwipeOptions`, `LongPressOptions`, `TapOffset`, `TapAtOptions`, `PinchOptions`, `ZoomOptions` | Option and direction types of the `Element` primitives. |
| `isWeb(el)`, `isPlatform(el)` | Type guards that narrow an `Element` to `WebElement` / `PlatformElement`. |

### 🔧 Type Safety

`isWeb` and `isPlatform` are type guards, so no cast is needed after them:

```typescript
import { isWeb, isPlatform } from '@civitas-cerebrum/element-repository';

const el = await repo.get('submitButton', 'LoginPage');

if (isWeb(el)) {
  // el is a WebElement: the underlying Playwright Locator
  await el.locator.click();
}

if (isPlatform(el)) {
  // el is a PlatformElement: the WebdriverIO selector and driver
  console.log(el.selector);
}
```

**Two meanings of "platform".** The word names two different things in this API; neither is renamed, to avoid another break:

- **The `Platform` type** (`'web' | 'android' | 'ios' | 'macos' | 'windows'`) is the platform a page block or a test run targets. It **includes `web`**: `getPagePlatform()` returns `'web'` for a web page, and `isPlatformName('web')` is `true`.
- **`PlatformElement`, `isPlatform(el)` and `ElementType.PLATFORM`** mean the **non-web backend**: an element driven through WebdriverIO / Appium. A web element is never a `PlatformElement`, so `isPlatform(webElement)` is `false`.

## ✅ Verified on Real Devices

The platform elements were run against real devices through Appium with the live specs in `tests/live/`.

- **iOS** (a real iOS device, XCUITest, the built-in Settings app, read-only): lookups by accessibility id, predicate string, class chain and `id`; `count()`, `first()` and `nth()`; `textContent()` reading the label first, and `rawText()`; the `TEXT` strategy and `getByText`; gestures returning the element; `swipe()`; `scrollIntoView()` down and up.
- **Android** (a real Android device, UiAutomator2, the purpose-built test app): checked state of checkboxes, switches and radio buttons, including the refusals (a disabled control, a control that is not checkable, `uncheck()` on a radio button) and idempotence (`check()` on a checked control does not click); row text read from child views; the `TEXT` strategy and `getByText` by child text, with the hint of an empty search field left out; short and full resource ids; `locateChild()`; `first()` and `nth()`; `longPress()`, `tapAt()`, `pinch()`, `zoom()`, `swipe()`, `scrollIntoView()` up and down; an alert dialog flow.
- **Not verified live:** on iOS, `longPress()`, `tapAt()`, `pinch()`, `zoom()`, `check()` and `uncheck()` (the iOS run is read-only). These are covered by the mock-driver and WebdriverIO wire tests only.

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
| The `Element` interface has new required methods `longPress`, `tapAt`, `pinch` and `zoom` (each returns `Promise<Element>`). | Custom `Element` implementations and test mocks must add them (a stub that throws is enough where unused). |
| `PlatformElement.setInputFiles` / `dispatchEvent` throw `PlatformNotSupportedError` (`"<method>" is not supported on platform "<platform>".`) instead of a plain `Error` (`<method> is not supported on platform elements.`). | Update assertions on the message; catch `PlatformNotSupportedError` to tell these apart. |
| `PlatformElement.getTagName()` throws for a missing element (it returned `''`). | Check `exists()` first, or catch the error, where a missing element is expected. |
| On Android, `PlatformElement.getTagName()` returns the element's `class` attribute (`android.widget.RadioButton`). It returned UiAutomator2's tag name, which is the content-desc for an element that has one (`radio-yes` for `~radio-yes`) and `null` otherwise. iOS is unchanged (the XCUITest type). | Compare against the class name; read `getAttribute('content-desc')` where you need the content-desc. |
| On Android, `PlatformElement.getAttribute(name)` returns `null` for an attribute the element does not have. It returned the string `"null"`, which UiAutomator2 sends for a missing attribute. `getByAttribute` and the `ATTRIBUTE` strategy read the same way, so an element without the attribute never matches (a contains match for `ul` no longer picks an element without a `content-desc`; an exact match for `"null"` no longer picks every element that lacks it). | Compare against `null` instead of `"null"` where an Android attribute may be missing. |
| `PlatformElement.exists()` rethrows fatal driver errors — invalid selector, dead session, lost connection (see `isFatalDriverError`) — instead of returning `false` for every error. A missing element is still `false`. | Fix the selector or session; catch the error only if a broken session really should read as "not there". |
| On iOS, `PlatformElement.textContent()` reads the `label` attribute first, then `value` (text inputs: `value` first). It used WebdriverIO `getText()`, which returns `value` first, so a row with a badge read as the badge. The `TEXT` strategy and `getByText` now compare the same text. | Check iOS text assertions and `TEXT` values: use the label the user sees. Read `getAttribute('value')` where you need the value. |
| On Android, `PlatformElement.textContent()` / `rawText()` of an element with no text of its own (empty or whitespace only) return its descendants' text, joined with single spaces in document order (a list row whose title and subtitle are child TextViews reads `Item 1 Alpha`); an input showing its hint is left out. It returned `''`. This costs one extra query, plus one text read per descendant that has text, only when the own text is empty. The `TEXT` strategy and `getByText` compare the same text. | Check Android assertions and `TEXT` values on container rows: use the joined text, or point the entry at the child TextView to read one part only. |
| `PlatformElement.isChecked()` follows the platform's own state: Android reads the `checked` attribute; iOS reads `value` (`"1"` = on) for an `XCUIElementTypeSwitch` / `XCUIElementTypeToggle` and `selected` for any other type; other platforms keep WebdriverIO `isSelected()`. It used `isSelected()` everywhere, which is always `false` for an Android CheckBox, Switch or RadioButton and for an iOS switch. `check()` / `uncheck()` use the same read, so on Android they no longer click a checked control (`check()` turned it off; `uncheck()` never unchecked). | Remove workarounds that inverted or skipped `check()` / `isChecked()` on Android or iOS switches. Read `getAttribute('selected')` where you need the selected state itself. |
| `PlatformElement.check()` / `uncheck()` click only when the state differs, then wait (within the same `timeout`) for the new state and throw `check: "<selector>" is still unchecked after clicking` / `uncheck: "<selector>" is still checked after clicking` when it does not arrive. They never verified the result before. They wait for the element to be enabled and throw `check: "<selector>" is disabled` without clicking when it is not within the timeout. On Android, `uncheck()` on a checked radio button throws `uncheck: "<selector>" is a radio button; select another option instead` at once, and an element with `checkable="false"` throws `check: "<selector>" is not checkable`, both without a click. | Expect these errors where a click cannot change the state (a disabled control, a radio button, a plain button); select another radio option instead of calling `uncheck()` on one. |
| A `PlatformElement` read (`textContent`, `rawText`, `getAttribute`, `getTagName`, `isEnabled`, `isChecked`; `inputValue` on iOS) of a missing element throws `<method>: "<selector>" not found within N ms: <reason>` (no `within N ms` for an element that matches nothing), with the original error as `cause`. It threw WebdriverIO's bare `Can't call <command> on element ... because element wasn't found` (or the bare not-found message of an indexed or child element). | Match on the new prefix, or on `cause`, where tests assert the message. |
| `PlatformElement.scrollIntoView({ timeout })` stops sweeping once `timeout` ms have passed (no new swipe starts after the deadline) and throws; it used to ignore `timeout` and stop only at the 20-swipe limit. Only a timeout passed to the call bounds the sweep; the swipe limit is now `maxSwipes` (default `20`). | Pass a `timeout` large enough for the swipes you need, or omit it to keep the swipe limit only. |
| `ElementChain.scrollIntoView()` no longer waits for the element to attach before scrolling; the element does its own waiting (on platform elements it starts swiping at once). It passes its options on as given; the chain timeout is never applied to `scrollIntoView` (on web it was the Playwright timeout; now `options.timeout`, else the element's default timeout). So a web `element.action(t).scrollIntoView()` no longer uses `t`: it uses the repository default timeout unless a timeout is passed to `scrollIntoView`. | Add `.waitForState('attached')` before it if you relied on the wait; pass `scrollIntoView({ timeout })` for a per-call timeout. |
| `WebElement.scrollIntoView()` called without `timeout` now uses the element's default timeout (the repository default, 15 s). It used Playwright's own default (`actionTimeout`, unlimited unless configured). | Pass `scrollIntoView({ timeout })`, or set the repository default timeout, where a different bound is wanted. |
| The platform swipe-limit error of `scrollIntoView` reads `scrollIntoView: element not visible after <n> swipes, the swipe limit (direction=<direction>)` (was `... after 20 swipes (direction=<direction>)`). A sweep stopped by its `timeout` throws `scrollIntoView: element not visible within the <t> ms timeout (<i> of at most <n> swipes made, direction=<direction>)`. | Update assertions on the message. |
| `PlatformElement.swipe()` throws when the start point (element centre) is outside the window (`swipe: element centre (x, y) is outside the window (WxH); call scrollIntoView first`) or on the window edge the swipe moves toward (`swipe: the start point (x, y) is at the window edge (WxH) for a '<direction>' swipe; nothing to swipe`). It never threw for these before. | Call `scrollIntoView` first for an off-screen element; start an edge swipe from an element away from that edge. |
| The platform swipe gesture (`swipe` and each `scrollIntoView` swipe) is an explicit W3C touch action with a 100 ms hold after finger down and a 600 ms move (`SWIPE_HOLD_MS`, `SWIPE_MOVE_MS`), instead of the WebdriverIO action builder's 300 ms move with no hold. Each swipe takes longer. | None for most callers; allow for the longer gesture time in tight timeouts. |
| `WebElement.swipe()` waits for the element to be visible (it waited for attached). | None for most callers; a swipe on a hidden element now times out instead of dragging from its box. |
| `Element.rawText()` is a new required method of the interface. | Third-party `Element` implementations and mocks must add it (untrimmed text, or `null`). |
| `Element.click` takes `ClickOptions` (`ElementActionOptions` plus `withoutScrolling`) instead of `ElementActionOptions`. | Callers need no change. Third-party `Element` implementations should accept `ClickOptions` and honour `withoutScrolling` (see [Interaction Methods](#interaction-methods)). |
| `ElementChain.click({ withoutScrolling: true })` and `clickIfPresent({ withoutScrolling: true })` call `element.click({ withoutScrolling: true })` instead of `dispatchEvent('click')`. On platform elements they now click (they threw, because platform elements have no `dispatchEvent`). Web behaviour is unchanged (a dispatched DOM `click`). | None, unless you relied on the platform error. |
| The exported `APPIUM_FORMATTERS.id` returns `~v` (accessibility id) instead of `#v`; `ANDROID_FORMATTERS.id` and `IOS_FORMATTERS.id` have their own rules (see the `id` row above). | Code that calls the formatter tables directly: expect the new output, or format the selector yourself. |
| Error messages of platform `boundingBox()`, `screenshot()` and `getCssProperty()` changed. `boundingBox()`: `boundingBox() could not read the element rect: <driver error>` (was `boundingBox() is not supported on this platform driver`). `screenshot()` and `getCssProperty()` keep their text and append `: <driver error>`. | Update assertions on these messages. |
| The optional `webdriverio` peer is `^10` (was `^9.27.0`). The package is built and tested against WebdriverIO 10 only: its wire tests drive a real WebdriverIO 10 client, and its first-match lookups are written for WebdriverIO 10's `$`, which is strict by default (it throws when a selector matches more than once). WebdriverIO 9 is not supported. WebdriverIO 10 needs Node.js `>=22.23.4 <23`, `>=24.22.1 <25` or `>=26.12.1`. | Upgrade WebdriverIO to 10 and Node.js to a supported version. |

Not breaking, but new: the third constructor argument also takes `{ platform?, defaultTimeout? }` (`timeout` is an accepted alias); with an active platform, lookups use the page block for that platform only (see [Multi-Platform Configuration](#multi-platform-configuration)).

## 🧪 Development

- `npm test` runs every spec with the Playwright runner (`npx playwright test`); `npx tsc --noEmit` type-checks `src`.
- `webdriverio` is a devDependency for the real-client wire and type tests: `tests/platform-wdio10-wire.spec.ts` drives a real WebdriverIO 10 client against a local fake WebDriver server, and `tests/platform-wdio10-api.check.ts` type-checks the calls against WebdriverIO 10's types. Its advisory surface is accepted: it currently brings moderate findings only, and CI audits at `--audit-level=high`.
- There is no `.npmrc`. It used to set `omit=peer`; now that `webdriverio` is a devDependency (for the wire tests), both optional peers (`@playwright/test`, `webdriverio`) are devDependencies, so `omit=peer` would have no effect, and the file was removed.
- `tests/*.check.ts` are type-only fixtures. They are not run as tests; specs compile them with the TypeScript compiler API and assert the result.
- The live device specs live in `tests/live/`. Run them with `npx playwright test tests/live/` — the trailing slash matters, because the filter `tests/live` also matches `tests/live-element-location.spec.ts`. Both need `APPIUM_URL` (the server URL including its base path) and `CAPABILITIES` (path to a W3C capabilities JSON file, sent as written); `APPIUM_USER` / `APPIUM_KEY` are optional. Without them the device tests are skipped and only the offline checks of the pages files run.
  - iOS (`tests/live/ios-settings.live.spec.ts`, `LIVE_IOS=1`): read-only, against the built-in Settings app. The capabilities need `platformName: iOS` and `appium:bundleId: com.apple.Preferences` (see `tests/live/capabilities.ios.example.json`).
  - Android (`tests/live/android-testapp.live.spec.ts`, `LIVE_ANDROID=1`): drives the purpose-built test app (`appium:appPackage: com.civitas.testapp`, see `tests/live/capabilities.android.example.json`).
  - Both specs refuse a capabilities file that has `appium:app` or `browserName`: they never install an app or open a browser, so the app must already be on the device. To reuse a capabilities file that installs the app, strip `appium:app` from a copy of it.

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
