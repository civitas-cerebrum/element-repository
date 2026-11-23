# pw-element-repository — AI Reference
**Purpose:** A JSON-based locator repository for Playwright. It externalizes selectors (CSS, XPath, ID, Text) from test code, allowing tests to reference elements by pageName and elementName strings.
## JSON Schema
```json
{
  "pages": [
    {
      "name": "StringPageName",
      "elements": [
        {
          "elementName": "StringElementName",
          "selector": {
            "css": "selector",
            "xpath": "selector",
            "id": "id",
            "text": "text"
          }
        }
      ]
    }
  ]
}
```

## Usage Example:

```ts

await test.step('✅ Open Forms Page and verify navigation', async () => {
  const repo = new ElementRepository("tests/data/page-repository.json");
  const formsCategory = await repo.getByText(page, 'HomePage', 'categories', 'Forms');
  await formsCategory?.click();
  await steps.verifyAbsence('HomePage', 'categories');
});
```

## Setup
```ts
// Constructor: (pathOrData: string | object, timeout?: number)
const repo = new ElementRepository('path/to/locators.json', 15000);
```

## API (all async, return Playwright `Locator` unless noted)
- `get(page, pageName, elementName)` — single `Locator`, waits for DOM attachment
- `getAll(page, pageName, elementName)` — `Locator[]` for iteration
- `getRandom(page, pageName, elementName, strict?)` — random `Locator`, waits for visibility
- `getByText(page, pageName, elementName, desiredText, strict?)` — first `Locator` containing `desiredText`
- `getSelector(pageName, elementName)` — **sync**, returns raw selector string (e.g. `css=.btn`)

## Platforms (0.4.0+)
- **Vocabulary:** `type Platform = 'web' | 'android' | 'ios' | 'macos' | 'windows'`; `type DriverFamily = 'playwright' | 'appium'`; `PLATFORMS` (frozen array); `isPlatformName(v)` (exact, case-sensitive); `familyOf(p)` — `web` → `playwright`, rest → `appium`. `macos` / `windows` are declared, not implemented yet (base Appium formatters).
- **JSON:** one file may hold the same page `name` once per platform. `"platform"` missing = `web`. Same `elementName` per logical element on every platform. Invalid platform (e.g. `"mobile"`), duplicate `name`+`platform`, or `frameIndex` other than `"first"`/`"last"`/integer → constructor throws `ElementRepository: invalid repository — ...`.
```json
{ "pages": [
  { "name": "LoginPage", "platform": "web",     "elements": [ { "elementName": "submit", "selector": { "css": "button[type=submit]" } } ] },
  { "name": "LoginPage", "platform": "android", "elements": [ { "elementName": "submit", "selector": { "accessibility id": "login-submit" } } ] },
  { "name": "LoginPage", "platform": "ios",     "elements": [ { "elementName": "submit", "selector": { "accessibility id": "login-submit" } } ] }
] }
```
- **Constructor:** `new ElementRepository(driver, pathOrData, options?)`; `options` is a number (timeout ms) or `{ platform?: Platform; timeout?: number }` (default timeout 15000). Driver: Playwright `Page` (web) or WebdriverIO `Browser` from `remote()` (android/ios). `repo.platform` = active platform or `undefined`.
```ts
const repo = new ElementRepository(driver, 'tests/data/page-repository.json', { platform: 'ios' });
const submit = await repo.get('submit', 'LoginPage'); // the "ios" LoginPage block
```
- **Lookup rule:** active platform set → page with matching `name` AND `(platform ?? 'web') === active`, else throws `Page "<name>" has no entry for platform "<active>". Available: <list>.` (`<list>` = platforms declaring the page, or `none`). No active platform → first page with that name, else `ElementRepository: Page '<name>' not found.` No cross-platform fallback; no global state.
- **Selector keys on platform pages:** `accessibility id` (`~v`), `id`, `xpath`, `class name`, `uiautomator` (`android=v`), `predicate` (`-ios predicate string:v`), `class chain` (`-ios class chain:v`), `text`, enhanced `role` + `name`.
  - `id`: android → `id=v` (resource-id; a short id gets the app package prefix); ios → predicate `name == "v"`; macos/windows → `~v`. Never CSS.
  - `text`: android → `UiSelector().text("v")` (only `"` escaped; a value ending in `\` cannot be expressed — the formatter throws and points to `xpath`); ios → predicate `label == "v"`.
- **Strategies on platform pages:** default = first match (`count()`/`all()` on it return at most 1; use `getAll` / `SelectionStrategy.ALL` to count). `TEXT` compares each match's OWN `getText()` (the selector must target the text-bearing element), exact then case-insensitive contains, polls up to the full timeout. A blank `TEXT` value throws (web too).
- **Fallback:** primary not attached within `options.timeout ?? defaultTimeout`, or primary throws during resolution (platform TEXT, ATTRIBUTE / RANDOM / INDEX with no match) → walks `selector.fallback`; if the whole chain fails, the primary's error is rethrown.
- **Element primitives (new):**
  - `longPress({ duration = 1000, timeout? })` — platform: touch down / pause / up; web: mouse hold.
  - `tapAt({ x, y }, { timeout? })` — px from the top-left, inside the bounds; web: `click({ position })`.
  - `pinch({ scale = 0.5, timeout? })` — scale in (0, 1); `zoom({ scale = 2, timeout? })` — scale > 1. Platform only; web throws `PlatformNotSupportedError`.
  - `scrollIntoView({ direction = 'down', timeout? })` — platform: one-direction sweep, max 20 swipes; web ignores `direction`. `swipe(direction, { distance?, timeout? })`.
  - Platform gestures and swipe use native-context viewport coordinates; the point must be inside the window (scroll first).
  - `ElementChain` has `scrollIntoView(options?)`, `swipe(direction, options?)`, `longPress`, `tapAt`, `pinch`, `zoom`.
- **PlatformElement:** `first()` / `nth(i)` index for real (negative counts from the end; out of range throws `nth(<i>): no element at that index ...`). `filter({ hasText })`, `setInputFiles`, `dispatchEvent` throw `PlatformNotSupportedError`.
- **Errors:** `class PlatformNotSupportedError extends Error { method: string; platform: Platform }`, message `"<method>" is not supported on platform "<platform>".` Single definition; consumer packages re-export it.
- **Peer:** optional `webdriverio ^10` (Node `>=22.23.4 <23 || >=24.22.1 <25 || >=26.12.1`).

