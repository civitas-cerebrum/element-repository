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
// Constructor: (driver, fileOrData: string | PageRepository | PageRepositoryInput, options?: number | { platform?: Platform; defaultTimeout?: number; timeout?: number })
// driver = Playwright Page (web) or WebdriverIO Browser from remote() (android/ios). A number = timeout ms. Default timeout 15000.
// `timeout` is an alias of `defaultTimeout`; when both are given, `defaultTimeout` wins.
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
- `getByText(elementName, pageName, desiredText, strict?): Promise<Element | null>` — trimmed `textContent()` exact match first, then contains (platform: the text rule under PlatformElement).
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
- **Vocabulary:** `type Platform = 'web' | 'android' | 'ios' | 'macos' | 'windows'`; `type DriverFamily = 'playwright' | 'appium'`; `PLATFORMS` (frozen array); `isPlatformName(v)` (exact, case-sensitive); `familyOf(p)` — `web` → `playwright`, rest → `appium`; an unknown value (in `familyOf` or the constructor's `options.platform`) throws `ElementRepository: unknown platform '<v>'. Expected one of: web, android, ios, macos, windows.` `macos` / `windows` are declared, not implemented yet (base Appium formatters).
- **Two meanings of "platform":** the `Platform` type is the page/run platform and INCLUDES `web`. `PlatformElement`, `isPlatform(el)`, `ElementType.PLATFORM` mean the non-web (WebdriverIO/Appium) backend: `isPlatform(webElement)` is `false`.
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
- **Lookup rule:** active platform set → page with matching `name` AND `(platform ?? 'web') === active`, else throws `ElementRepository: page '<name>' has no entry for platform '<active>'. Available: <list>.` (`<list>` = platforms declaring the page, or `none`). No active platform → first page with that name, else `ElementRepository: Page '<name>' not found.` No cross-platform fallback; no global state.
- **Selector keys on platform pages:** `accessibility id` (`~v`), `id`, `xpath`, `class name`, `uiautomator` (`android=v`), `predicate` (`-ios predicate string:v`), `class chain` (`-ios class chain:v`), `text`, enhanced `role` + `name`.
  - `id`: android → `id=v` (resource-id; a short id gets the app package prefix); ios → predicate `name == "v"`; macos/windows → `~v`. Never CSS.
  - `text`: android → `UiSelector().text("v")` (only `"` escaped; a value ending in `\` cannot be expressed — the formatter throws and points to `xpath`); ios → predicate `label == "v"`.
- **Strategies on platform pages:** default = first match (`count()`/`all()` on it return at most 1; use `getAll` / `SelectionStrategy.ALL` to count). `TEXT` compares each match's OWN text, read with the `textContent()` rule (see PlatformElement; the selector must target the text-bearing element, or on Android a container without own text, which reads its descendants' joined text; a container row costs 2 + K round trips, a big container reads every text inside it, a descendant whose own text repeats its children's is counted twice (rare)), exact then case-insensitive contains, polls up to the full timeout. A blank `TEXT` value throws (web too).
- **Fallback:** primary not attached within `options.timeout ?? defaultTimeout`, or primary throws during resolution (platform TEXT, ATTRIBUTE / RANDOM / INDEX with no match) → walks `selector.fallback`; if the whole chain fails, the primary's error is rethrown.
- **Element primitives:** every interaction takes an optional `{ timeout? }` and returns `Promise<Element>` (the element itself), gestures included.
  - `click({ withoutScrolling?, timeout? })` (`ClickOptions`) — `withoutScrolling` on web: wait attached, then dispatch a DOM `click` (no scrolling, no actionability checks); on platform it changes nothing: a platform click is always the plain WebDriver element click, which never scrolls.
  - `longPress({ duration = 1000, timeout? })` — platform: touch down / pause / up; web: mouse hold.
  - `tapAt({ x, y }, { timeout? })` — px from the top-left, inside the bounds; web: `click({ position })`.
  - `pinch({ scale = 0.5, timeout? })` — scale in (0, 1); `zoom({ scale = 2, timeout? })` — scale > 1. Platform only; web throws `PlatformNotSupportedError`.
  - `scrollIntoView({ direction = 'down', maxSwipes = 20, timeout? })` — platform: no attach wait, one-direction sweep of at most `maxSwipes` swipes; ONLY a `timeout` passed to the call bounds it by time (no new swipe after the deadline, so it can overrun by one swipe); without one only the swipe limit applies (the default timeout does not). Web ignores `direction` / `maxSwipes`; Playwright timeout = `options.timeout ?? ` the element's default timeout (the repository default). Every backend throws for a `maxSwipes` that is not a positive integer. `swipe(direction, { distance?, timeout? })` — platform: waits attached, end point clamped to the window `[0, width-1]` x `[0, height-1]`, start point unchanged; web: waits visible.
  - Platform gestures and swipe use native-context viewport coordinates; the point must be inside the window (scroll first).
  - `ElementChain` has `scrollIntoView(options?)`, `swipe(direction, options?)`, `longPress`, `tapAt`, `pinch`, `zoom`. It never branches on the backend: `scrollIntoView` / `swipe` do not wait in the chain (the element waits for itself); the four gestures wait for visible first; `click({ withoutScrolling })` waits attached and passes the option to `element.click`, as `clickIfPresent({ withoutScrolling })` does. An explicit `options.timeout` overrides the chain timeout; otherwise the chain timeout is passed on — except `scrollIntoView`, which passes its options on as given; the chain timeout is never applied to `scrollIntoView`, so a web `action(t).scrollIntoView()` uses the repository default timeout, not `t`.
- **PlatformElement:** `first()` / `nth(i)` index for real, lazily (negative counts from the end; non-integer throws). `first()` / `nth(0)` use WebdriverIO `$` and its waiting (except on a `locateChild` child, which is always polled with `$$`); other indexes poll `$$`: actions wait up to their `timeout`, reads up to the default timeout, then throw `nth(<i>): no element at that index for "<selector>" (found <n>)`; `isVisible()` / `exists()` do not wait (`false`). On an already-single match (from `first`/`nth`/`all()`): `first()`, `nth(0)`, `nth(-1)` return itself; any other index matches nothing (`count()` 0, `exists()` / `isVisible()` false, actions and reads fail at once with `nth(<i>): "<selector>" is already a single match, so this index matches nothing`). `locateChild(sel)` searches inside the parent's match, honouring its index; every child is polled: actions wait up to their `timeout`, reads up to the default timeout, then fail naming the missing element (`parent "<selector>" not found`, `no element matches "<child>" inside "<parent>"`, or the parent's out-of-range error); a child of a missing parent has `count()` 0 and `isVisible()` / `exists()` false without waiting. `filter({ hasText })` (any criterion), `setInputFiles`, `dispatchEvent` throw `PlatformNotSupportedError`; an empty filter returns the element.
- **Platform text:** `textContent()` = trimmed visible text or `null`. iOS: `label`, then `value`; text inputs (TextField, SecureTextField, TextView, SearchField) `value` first, then `label`. Android: driver `getText()`; when that is empty/whitespace, the descendants' non-empty `text` values, hints excluded (XPath `.//*[@text!='' and not(@showing-hint='true')]`, a find-elements from the element, document order, each trimmed, not filtered by `displayed`) joined with single spaces (row `text=""` with children `Item 1`, `Alpha` → `Item 1 Alpha`); cost: one extra query + one read per text-bearing descendant (2 + K in all), only when own text is empty; every descendant is read; no descendant text → own text. Other: driver `getText()`. `rawText()` = same, untrimmed (web: DOM `textContent`). The `TEXT` strategy and `getByText` use the same rule.
- **Platform checked state:** `isChecked()` — Android: attribute `checked === "true"` (UiAutomator2 `selected` stays `"false"` on checked controls); iOS: `XCUIElementTypeSwitch` / `XCUIElementTypeToggle` → `value` `"1"`/`"true"`, any other type → `isSelected()` (a row's `value` may be a badge, never state); other platforms: `isSelected()`. `check()` / `uncheck()` use the same read (iOS: element type read once per call) and do nothing when the state matches; otherwise Android fails at once without a click for `checkable="false"` (`check: "<selector>" is not checkable`) and for `uncheck()` on a checked `android.widget.RadioButton` (`uncheck: "<selector>" is a radio button; select another option instead`); then `isEnabled()` is polled within the action timeout (still disabled → `check: "<selector>" is disabled`, no click); then one click and the state is polled within the same timeout (from the call's start, at least one read): `check: "<selector>" is still unchecked after clicking` / `uncheck: "<selector>" is still checked after clicking`.
- **Platform read of a missing element:** `textContent`, `rawText`, `getAttribute`, `getTagName`, `isEnabled`, `isChecked` (and `inputValue` on iOS) throw `<method>: "<selector>" not found within N ms: <reason>`; default-resolved: reason = WebdriverIO's `Can't call ... because element wasn't found`, N = driver `waitforTimeout` (omitted if unknown), WebdriverIO error as `cause`; indexed/child: N = element timeout; an element that matches nothing fails at once without `within N ms`. Gestures: `<method>: "<selector>" not found within N ms`; indexed/child gestures append `: <reason>`; a gesture on an element that matches nothing omits `within N ms`. Errors name an element `"<selector>"`; only an explicit `nth(i)` with i ≠ 0 reads `nth(<i>) of "<selector>"` (a plain repository lookup, `first()`, `nth(0)` do not); a child adds `inside <parent>`.
- **Platform element class:** `getTagName()` = iOS XCUITest type (`XCUIElementType*`), Android `class` attribute (`android.widget.*`; UiAutomator2's tag name is the content-desc or `null`, never used); the radio check and iOS text/switch rules read it the same way.
- **`doubleClick` on platform elements:** contract = two taps on the element centre as one double tap. iOS: `driver.execute('mobile: doubleTap', { elementId })` (WebdriverIO's mouse double-click is one tap for XCUITest); a missing element throws `doubleClick: "<selector>" not found within N ms` first. Android and other platforms: WebdriverIO `doubleClick()` (two clicks on UiAutomator2).
- **Unknown attribute name (android, ios):** `getAttribute(name)` returns `null` when the driver does not know the name at all — UiAutomator2 `'<name>' attribute is unknown for the element` (error `unknown command`, fatal for `isFatalDriverError`), XCUITest `The attribute '<name>' is unknown` (HTTP 500). Only that answer for that name is mapped; other errors are thrown. `getByAttribute` / `ATTRIBUTE` treat such elements as lacking the attribute; internal reads (checked, class, hint, iOS label / value) use the same mapping. A misspelt name reads as missing.
- **Android missing attribute:** UiAutomator2 returns the string `"null"` for an attribute an element lacks; `getAttribute()` maps it to `null`, so `getByAttribute` / `ATTRIBUTE` never match an element without the attribute, and `inputValue()` treats a `hint` of `"null"` as no hint. An attribute whose real value is the text `null` is indistinguishable from a missing one (same string) and also reads as `null`; `inputValue()` still returns `"null"` for a field holding that text.
- **Platform errors:** `getTagName()` throws for a missing element. `exists()` is `false` for a missing element but rethrows fatal driver errors (`isFatalDriverError`).
- **Errors:** `class PlatformNotSupportedError extends Error { method: string; platform: Platform }`, message `"<method>" is not supported on platform "<platform>".` Single definition; consumer packages re-export it.
- **Exports for consumers (use, do not copy):** `isFatalDriverError(err)` (invalid selector/argument, unknown command, unsupported operation, gone session/window/connection = fatal; everything else transient); touch helpers `SWIPE_HOLD_MS` (100), `SWIPE_MOVE_MS` (600), `SWIPE_SETTLE_MS` (200), `buildTouchSwipe(from, to, options?)`, `performTouchActions(driver, sources)` (always releases), `performTouchSwipe(driver, from, to, options?)` (no settle pause; `options` = `TouchSwipeOptions` `{ holdMs?, moveMs? }`, defaults `SWIPE_HOLD_MS` / `SWIPE_MOVE_MS`), `touchPointers(fingers)`, types `TouchPoint`, `TouchAction`, `TouchPointerSource`, `TouchSwipeOptions`; option/direction types `ClickOptions`, `ScrollIntoViewOptions`, `SwipeDirection`, `SwipeOptions`, `LongPressOptions`, `TapOffset`, `TapAtOptions`, `PinchOptions`, `ZoomOptions`; type guards `isWeb(el)`, `isPlatform(el)`.
- **Peer:** optional `webdriverio ^10` only (built and tested against 10; 9 is not supported). In this repo `webdriverio` is a devDependency for the real-client wire and type tests (moderate advisories accepted; CI audits at high); no `.npmrc`: now that `webdriverio` is a devDependency (for the wire tests), both optional peers are devDependencies, so `omit=peer` would have no effect; the file was removed. Node `>=22.23.4 <23 || >=24.22.1 <25 || >=26.12.1`.

