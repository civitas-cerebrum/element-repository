# @civitas-cerebrum/element-repository — AI Reference
**Purpose:** A JSON-based locator repository for Playwright (web) and WebdriverIO/Appium (android, ios). Selectors live in a JSON file, not in test code; tests look elements up by `elementName` + `pageName` and get a unified `Element` (`WebElement` wrapping a Playwright `Locator`, or `PlatformElement` wrapping WebdriverIO `$` / `$$`).
## JSON Schema
- `pages[]`: `{ name, platform?, frame?, frameIndex?, elements[] }`. `platform` missing = `web` (see Platforms). `frame` (web only) = `{ css? | xpath? }` or an array of them for nested iframes; `frameIndex` = `"first"` / `"last"` / integer when several frames match.
- `elements[]`: `{ elementName, selector, list?, provisional? }`. `list: true` = a collection (contract: at least one match); `provisional: true` = not yet confirmed against the app. Both JSON booleans, default `false`; resolution ignores them (read via `getElementMeta` / `getProvisional`).
- `selector`: ONE selector key per object — only the first string-valued key is used (web: `css`, `xpath`, `id`, `text`, `testid`, `role`, `placeholder`, `label`; platform keys: see Platforms). Exception: enhanced `role` + `name` (+ optional `exact`) together. `text` / `name` also take `{ "regex": "...", "flags": "i" }`. Optional `fallback`: another selector object, recursive.
```json
{
  "pages": [
    {
      "name": "HomePage",
      "elements": [
        { "elementName": "categories", "list": true, "selector": { "css": ".category-card" } },
        { "elementName": "login", "selector": { "css": "[data-qa='login']", "fallback": { "role": "button", "name": { "regex": "Log in|Anmelden", "flags": "i" } } } }
      ]
    },
    {
      "name": "PaymentPage", "frame": { "css": "iframe.payment" }, "frameIndex": "first",
      "elements": [ { "elementName": "cardNumber", "provisional": true, "selector": { "css": "input[name='card']" } } ]
    }
  ]
}
```

## Setup
```ts
// Constructor: (driver, pathOrData: string | PageRepository | PageRepositoryInput, options?: number | { platform?: Platform; timeout?: number })
// driver = Playwright Page (web) or WebdriverIO Browser from remote() (android/ios). A number = timeout ms. Default timeout 15000.
const repo = new ElementRepository(page, 'tests/data/page-repository.json', 15000);
```

## Usage Example
```ts
const repo = new ElementRepository(page, 'tests/data/page-repository.json');
const forms = await repo.getByText('categories', 'HomePage', 'Forms'); // Element | null
await forms?.click();
const cards = await repo.getAll('categories', 'HomePage');             // Element[]
const login = await repo.get('login', 'HomePage');                     // Element (falls back if the css never attaches)
```

## API (`elementName` first, then `pageName`; `strict` defaults to `false`: `null` + warning when nothing matches, `true` throws)
- `get(elementName, pageName, options?: ElementResolutionOptions): Promise<Element>` — first match by default. `options`: `{ strategy?: SelectionStrategy, value?, attribute?, index?, timeout? }`; `SelectionStrategy` = `INDEX` / `TEXT` / `ATTRIBUTE` / `RANDOM` / `ALL` (an unhandled one, e.g. `VALUE`, throws).
- `getAll(elementName, pageName): Promise<Element[]>` — every match.
- `getRandom(elementName, pageName, strict?): Promise<Element | null>` — random match (waits for one to be visible).
- `getByText(elementName, pageName, desiredText, strict?): Promise<Element | null>` — trimmed `textContent()` exact match first, then contains.
- `getByAttribute(elementName, pageName, attribute, value, options?: { exact?: boolean; strict?: boolean }): Promise<Element | null>` — `exact` omitted: exact then contains.
- `getByIndex(elementName, pageName, index, strict?): Promise<Element | null>` — zero-based; out of range → `null` (or throws if strict).
- `getVisible(elementName, pageName, strict?): Promise<Element | null>` — first match with `isVisible()`.
- `getByRole(elementName, pageName, role, strict?): Promise<Element | null>` — `role` attribute, exact.
- `getElementMeta(elementName, pageName): ElementMeta` — **sync**, `{ provisional, list }` with defaults.
- `getProvisional(): Array<{ pageName, elementName }>` — **sync**, entries with `provisional: true` (active platform only, if set).
- `getSelector(elementName, pageName): string` — **sync**, platform-formatted selector (e.g. `css=.btn`, `~login-submit`).
- `getSelectorRaw(elementName, pageName): { strategy: string; value: string }` — **sync**, unformatted.
- `getPagePlatform(pageName): Platform` — **sync**, page's platform (`'web'` when missing).
- `static validate(data: PageRepository | PageRepositoryInput): void` — throws `ElementRepository: invalid repository — <problems>.`; the constructor runs it.
- `setDefaultTimeout(timeout: number): void`.
- `driver` (getter) — the driver passed in. `platform` (getter) — active `Platform` or `undefined`.
- Lookup errors: unknown element → `ElementRepository: Element '<el>' not found on page '<page>'.`; unknown page → see Platforms (Lookup rule).

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
- **Constructor** (signature: see Setup): `options.platform` sets the ACTIVE platform; a WebdriverIO `Browser` from `remote()` is the driver for android/ios. `repo.platform` = active platform or `undefined`.
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
- **PlatformElement:** `first()` / `nth(i)` index for real, lazily (negative counts from the end; non-integer throws). `first()` / `nth(0)` use WebdriverIO `$` and its waiting; other indexes poll `$$`: actions wait up to their `timeout`, reads up to the default timeout, then throw `nth(<i>): no element at that index for "<selector>" (found <n>)`; `isVisible()` / `exists()` do not wait (`false`). On an already-single match (from `first`/`nth`/`all()`): `first()`, `nth(0)`, `nth(-1)` return itself; any other index matches nothing (`count()` 0, `exists()` / `isVisible()` false, actions and reads fail at once with `nth(<i>): "<selector>" is already a single match, so this index matches nothing`). `locateChild(sel)` searches inside the parent's match, honouring its index. `filter({ hasText })` (any criterion), `setInputFiles`, `dispatchEvent` throw `PlatformNotSupportedError`; an empty filter returns the element.
- **Errors:** `class PlatformNotSupportedError extends Error { method: string; platform: Platform }`, message `"<method>" is not supported on platform "<platform>".` Single definition; consumer packages re-export it.
- **Peer:** optional `webdriverio ^10` (Node `>=22.23.4 <23 || >=24.22.1 <25 || >=26.12.1`).

