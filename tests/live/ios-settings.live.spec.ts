/**
 * Live iOS check: ElementRepository + PlatformElement against the built-in
 * Settings app on a real device or simulator, through an Appium server.
 *
 * READ-ONLY. The spec only resolves, reads and scrolls the Settings home
 * list. It never taps, toggles, types or opens a row.
 *
 * Run (placeholders only; never commit real values):
 *
 *   LIVE_IOS=1 APPIUM_URL=<appium-server-url-with-base-path> CAPABILITIES=<path-to-caps.json> \
 *     npx playwright test tests/live/
 *
 * (Keep the trailing slash: `tests/live` is a filter that also matches
 * tests/live-element-location.spec.ts.)
 *
 * - APPIUM_URL: full server URL including the base path, e.g. http://<appium-server>:4723/wd/hub
 * - CAPABILITIES: path to a W3C capabilities JSON file (see
 *   tests/live/capabilities.ios.example.json). It is sent exactly as written.
 *   It must have `platformName: iOS` and `appium:bundleId: com.apple.Preferences`.
 *   The spec refuses a file that has `appium:app` (no installs) or
 *   `browserName` (no browser session); strip those keys from a copy of a
 *   capabilities file that has them.
 * - APPIUM_USER / APPIUM_KEY: optional server credentials.
 *
 * Without LIVE_IOS=1, APPIUM_URL and CAPABILITIES the device tests are
 * skipped (the offline check of the pages file still runs).
 */
import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import { ElementRepository, Element, SelectionStrategy, isPlatform } from '../../src';

const PAGES = path.join(__dirname, 'ios-settings.pages.json');
const PAGE = 'SettingsHome';
const SETTINGS_BUNDLE_ID = 'com.apple.Preferences';
const GENERAL_NAME = 'com.apple.settings.general';
const PRIVACY_NAME = 'com.apple.settings.privacyAndSecurity';
const GENERAL_LABEL = 'General';
/**
 * The Settings row buttons, minus any account row: the predicate excludes
 * names containing "account" or "appleid", so no account text is ever read.
 */
const ROW_BUTTONS_PREDICATE =
  'type == "XCUIElementTypeButton" AND name BEGINSWITH "com.apple.settings." ' +
  'AND NOT (name CONTAINS[c] "account") AND NOT (name CONTAINS[c] "appleid")';
const GENERAL_KINDS = ['generalByAccessibilityId', 'generalByPredicate', 'generalByClassChain', 'generalById'];

const LIVE = process.env.LIVE_IOS === '1';
const APPIUM_URL = process.env.APPIUM_URL;
const CAPABILITIES = process.env.CAPABILITIES;
const ENABLED = LIVE && !!APPIUM_URL && !!CAPABILITIES;
const SKIP_REASON =
  'Live iOS check: set LIVE_IOS=1, APPIUM_URL (server URL with base path) and CAPABILITIES (path to a W3C capabilities JSON file) to run it.';

// `webdriverio` is ESM; a real dynamic import (not rewritten to require by
// the CommonJS transform).
const importEsm = new Function('m', 'return import(m)') as (m: string) => Promise<any>;

/** WebdriverIO `remote()` connection options from a server URL that includes the base path. */
function serverFromUrl(url: string): {
  protocol: 'http' | 'https'; hostname: string; port: number; path: string; user?: string; key?: string;
} {
  const u = new URL(url);
  const protocol = u.protocol.replace(/:$/, '');
  if (protocol !== 'http' && protocol !== 'https') {
    throw new Error(`APPIUM_URL must be an http or https URL, got protocol "${protocol}".`);
  }
  const port = u.port ? Number(u.port) : (protocol === 'https' ? 443 : 80);
  const basePath = u.pathname.length > 1 ? u.pathname.replace(/\/+$/, '') : '/';
  const server: ReturnType<typeof serverFromUrl> = { protocol, hostname: u.hostname, port, path: basePath };
  if (process.env.APPIUM_USER) server.user = process.env.APPIUM_USER;
  if (process.env.APPIUM_KEY) server.key = process.env.APPIUM_KEY;
  return server;
}

/** Reads the capabilities file and checks it with {@link checkCapabilities}. Returns it unchanged. */
function readCapabilities(file: string): Record<string, unknown> {
  return checkCapabilities(JSON.parse(fs.readFileSync(path.resolve(process.cwd(), file), 'utf-8')) as Record<string, unknown>);
}

/**
 * Checks the capabilities target iOS Settings: platform iOS, the Settings
 * bundle id, and no app to install or browser to open. Returns them unchanged.
 */
function checkCapabilities(caps: Record<string, unknown>): Record<string, unknown> {
  for (const refused of ['appium:app', 'browserName']) {
    if (refused in caps) {
      throw new Error(
        `CAPABILITIES file must not have "${refused}" (this read-only spec targets the built-in Settings app only: no install, no browser).`,
      );
    }
  }
  const platformName = caps.platformName;
  if (typeof platformName !== 'string' || platformName.toLowerCase() !== 'ios') {
    throw new Error(`CAPABILITIES file must have platformName "iOS" for this spec, got ${JSON.stringify(platformName)}.`);
  }
  const bundleId = caps['appium:bundleId'];
  if (bundleId !== SETTINGS_BUNDLE_ID) {
    throw new Error(
      `CAPABILITIES file must have "appium:bundleId": "${SETTINGS_BUNDLE_ID}" (this read-only spec targets Settings only), got ${JSON.stringify(bundleId)}.`,
    );
  }
  return caps;
}

test.describe('ios-settings pages file (offline)', () => {
  test('platform-aware lookup picks the ios SettingsHome page', () => {
    const ios = new ElementRepository({}, PAGES, { platform: 'ios' });
    expect(ios.platform).toBe('ios');
    expect(ios.getPagePlatform(PAGE)).toBe('ios');
    expect(ios.getSelector('generalByAccessibilityId', PAGE)).toBe(`~${GENERAL_NAME}`);
    expect(ios.getSelector('generalById', PAGE)).toBe(`-ios predicate string:name == "${GENERAL_NAME}"`);
    expect(ios.getSelector('generalByPredicate', PAGE))
      .toBe(`-ios predicate string:type == "XCUIElementTypeButton" AND name == "${GENERAL_NAME}"`);
    expect(ios.getSelector('generalByClassChain', PAGE))
      .toBe(`-ios class chain:**/XCUIElementTypeButton[\`name == "${GENERAL_NAME}"\`]`);
    expect(ios.getSelector('privacyRow', PAGE)).toBe(`~${PRIVACY_NAME}`);
    expect(ios.getSelector('rowButtons', PAGE)).toBe(`-ios predicate string:${ROW_BUTTONS_PREDICATE}`);

    // Without an active platform the first SettingsHome block (android) wins,
    // so the ios answers above come from the platform-aware lookup.
    const firstMatch = new ElementRepository({}, PAGES);
    expect(firstMatch.getPagePlatform(PAGE)).toBe('android');
    expect(new ElementRepository({}, PAGES, { platform: 'web' }).getPagePlatform(PAGE)).toBe('web');
  });

  test('the capabilities gate accepts the example file and refuses an install, a browser and another app', () => {
    const example = readCapabilities(path.join(__dirname, 'capabilities.ios.example.json'));
    expect(example['appium:bundleId']).toBe(SETTINGS_BUNDLE_ID);
    expect(() => readCapabilities(path.join(__dirname, 'capabilities.android.example.json'))).toThrow(/platformName "iOS"/);
    expect(() => checkCapabilities({ ...example, 'appium:app': '/path/to/app.ipa' })).toThrow(/must not have "appium:app"/);
    expect(() => checkCapabilities({ ...example, browserName: 'Safari' })).toThrow(/must not have "browserName"/);
    expect(() => checkCapabilities({ ...example, 'appium:bundleId': 'com.example.other' })).toThrow(/appium:bundleId/);
  });
});

test.describe.serial('live iOS Settings (read-only)', () => {
  test.skip(!ENABLED, SKIP_REASON);
  // Generous: the first gesture of a fresh session can take ~15 s, later
  // ones ~3 s each, and scrollIntoView may run up to 20 swipes.
  test.describe.configure({ timeout: 300_000 });

  let driver: any;
  let repo: ElementRepository;

  const get = (name: string): Promise<Element> => repo.get(name, PAGE);

  /**
   * Scrolls the Settings list back to its top with plain swipes on the list
   * (finger moves DOWN, so the content moves down and rows above appear).
   * Read-only: a swipe is never a tap. Called before each test that needs a
   * known starting position, so a failure in one test does not leave the
   * list scrolled for the next.
   */
  async function toTop(): Promise<void> {
    const list = await get('settingsList');
    const { height } = await driver.getWindowSize();
    for (let i = 0; i < 3; i++) await list.swipe('down', { distance: Math.round(height * 0.4) });
  }

  test.beforeAll(async () => {
    test.setTimeout(240_000);
    const capabilities = readCapabilities(CAPABILITIES!);
    const server = serverFromUrl(APPIUM_URL!);
    const { remote } = await importEsm('webdriverio');
    driver = await remote({
      ...server,
      capabilities,
      logLevel: 'warn',
      connectionRetryTimeout: 180_000,
      connectionRetryCount: 0,
    });
    repo = new ElementRepository(driver, PAGES, { platform: 'ios', timeout: 20_000 });
  });

  test.afterAll(async () => {
    test.setTimeout(180_000);
    if (driver) {
      const d = driver;
      try {
        // Best effort: leave Settings at the top of its list for the next run.
        if (repo) await toTop();
      } catch { /* the session is deleted regardless */ }
      finally {
        driver = undefined;
        // Best effort: a session the server already dropped must not fail the run.
        await d.deleteSession().catch(() => {});
      }
    }
  });

  test('the repository uses the ios page', () => {
    expect(repo.platform).toBe('ios');
    expect(repo.getPagePlatform(PAGE)).toBe('ios');
  });

  test('one swipe up on the list really moves the General row', async () => {
    // Guard for every scroll check below: if a touch swipe does not reach the
    // list, fail here with a clear message instead of a 20-swipe timeout.
    await toTop();
    const list = await get('settingsList');
    const before = await (await get('generalByAccessibilityId')).boundingBox();
    if (!before) throw new Error('The General row has no bounds at the top of Settings; cannot check that a swipe moves the list.');
    const { height } = await driver.getWindowSize();
    const distance = Math.round(height * 0.2);
    // Finger up: content moves up, so the General row's y must decrease.
    await list.swipe('up', { distance });
    const after = await (await get('generalByAccessibilityId')).boundingBox().catch(() => null);
    if (!after || after.y === before.y) {
      throw new Error(
        `A single swipe('up', { distance: ${distance} }) on the Settings list did not move the General row ` +
        `(y before ${before.y}, after ${after ? after.y : 'no bounds'}): touch swipes are not scrolling the list.`,
      );
    }
    expect(after.y).toBeLessThan(before.y);
    await toTop();
  });

  test('a multi-match selector counts and indexes cells (bounds only)', async () => {
    await toTop();
    const cells = await repo.get('cells', PAGE, { strategy: SelectionStrategy.ALL });
    const count = await cells.count();
    expect(count).toBeGreaterThan(1);

    // Bounds only: the first cell at the top of Settings is the account
    // entry, so no text of any cell is read.
    const first = cells.first();
    const second = cells.nth(1);
    const firstBox = await first.boundingBox();
    const secondBox = await second.boundingBox();
    expect(firstBox).not.toBeNull();
    expect(secondBox).not.toBeNull();
    expect(secondBox!.y).not.toBe(firstBox!.y);
    expect(await first.count()).toBe(1);

    const listed = await repo.getAll('cells', PAGE);
    expect(listed.length).toBe(count);
  });

  test('scrollIntoView down brings the General row (present, below the fold) into view', async () => {
    await toTop();
    // At the top the General row is in the tree but below the fold
    // (isDisplayed false). `direction: 'down'` means "reveal content further
    // DOWN the list": the finger swipes UP (75% -> 25% of the window height),
    // so the content moves up and lower rows come into view.
    const general = await get('generalByAccessibilityId');
    await general.scrollIntoView({ direction: 'down', timeout: 60_000 });
    expect(await general.isVisible()).toBe(true);
  });

  test('the General row text is its label, not its value (iOS text rule)', async () => {
    const general = await get('generalByAccessibilityId');
    await general.scrollIntoView({ direction: 'down', timeout: 60_000 });
    // XCUITest's getText() returns the value first (a badge such as "1" when
    // an update is pending); the platform text rule reads the label first.
    expect(await general.textContent()).toBe(GENERAL_LABEL);
    const raw = await general.rawText();
    expect(raw).not.toBeNull();
    expect(raw!).toContain(GENERAL_LABEL);
  });

  test('the TEXT strategy and getByText resolve the General row', async () => {
    // rowButtons matches the row buttons only (account rows excluded by the
    // predicate). Both lookups read texts in order and stop at the first
    // exact match, so rows below General are not read.
    const general = await get('generalByAccessibilityId');
    await general.scrollIntoView({ direction: 'down', timeout: 60_000 });
    const expected = await general.boundingBox();
    expect(expected).not.toBeNull();

    const byStrategy = await repo.get('rowButtons', PAGE, {
      strategy: SelectionStrategy.TEXT,
      value: GENERAL_LABEL,
      timeout: 30_000,
    });
    expect(isPlatform(byStrategy)).toBe(true);
    expect(await byStrategy.getAttribute('name')).toBe(GENERAL_NAME);
    expect(await byStrategy.boundingBox()).toEqual(expected);

    const byText = await repo.getByText('rowButtons', PAGE, GENERAL_LABEL, true);
    expect(byText).not.toBeNull();
    expect(await byText!.getAttribute('name')).toBe(GENERAL_NAME);
    expect(await byText!.boundingBox()).toEqual(expected);
  });

  test('gestures return the element they act on', async () => {
    // Read-only: swipes and scrollIntoView only, never a tap or press.
    const general = await get('generalByAccessibilityId');
    expect(await general.scrollIntoView({ direction: 'down', timeout: 60_000 })).toBe(general);

    const list = await get('settingsList');
    const { height } = await driver.getWindowSize();
    const distance = Math.round(height * 0.2);
    const up = await list.swipe('up', { distance });
    expect(up).toBe(list);
    const back = await up.swipe('down', { distance });
    expect(back).toBe(list);
  });

  for (const name of GENERAL_KINDS) {
    test(`resolves and reads the General row: ${name}`, async () => {
      const el = await get(name);
      expect(isPlatform(el)).toBe(true);
      expect(await el.getAttribute('name')).toBe(GENERAL_NAME);
      expect(await el.isVisible()).toBe(true);
      const box = await el.boundingBox();
      expect(box).not.toBeNull();
      expect(box!.width).toBeGreaterThan(0);
      expect(box!.height).toBeGreaterThan(0);
    });
  }

  test('getAttribute reads null for an attribute XCUITest does not know, and reads a known one', async () => {
    // Read-only: attribute reads on the General row. XCUITest answers an
    // unknown name with HTTP 500 "The attribute ... is unknown".
    const general = await get('generalByAccessibilityId');
    const started = Date.now();
    expect(await general.getAttribute('data-never-reported')).toBeNull();
    // Read once, not polled to a timeout.
    expect(Date.now() - started).toBeLessThan(10_000);
    expect(await general.getAttribute('name')).toBe(GENERAL_NAME);
  });

  test('all four selector kinds resolve to the same row', async () => {
    const boxes = [];
    for (const name of GENERAL_KINDS) boxes.push(await (await get(name)).boundingBox());
    expect(boxes[0]).not.toBeNull();
    for (const box of boxes.slice(1)) expect(box).toEqual(boxes[0]);
  });

  test('ElementChain reads through action()', async () => {
    const el = await get('generalByAccessibilityId');
    expect(await el.action(20_000).scrollIntoView({ direction: 'down' }).waitForState('visible').getAttribute('name'))
      .toBe(GENERAL_NAME);
    expect(await el.action(20_000).getText()).toMatch(/\S/);
    expect(await el.action(20_000).isPresent()).toBe(true);
  });

  test('swipe up then down on the list moves the rows and back', async () => {
    // The scroll container reports isDisplayed false on iOS: never assert
    // its visibility, only swipe on it.
    const list = await get('settingsList');
    const general = await get('generalByAccessibilityId');
    await general.scrollIntoView({ direction: 'down', timeout: 60_000 });
    const { height } = await driver.getWindowSize();
    const distance = Math.round(height * 0.3);

    const before = (await general.boundingBox())!;
    // Finger up: content moves up.
    await list.swipe('up', { distance });
    const after = await (await get('generalByAccessibilityId')).boundingBox().catch(() => null);
    // Either the row moved up or it scrolled out of the tree.
    if (after) expect(after.y).toBeLessThan(before.y);

    // Finger down: content moves back down.
    await list.swipe('down', { distance });
    const back = await (await get('generalByAccessibilityId')).boundingBox();
    expect(back).not.toBeNull();
    if (after) expect(back!.y).toBeGreaterThan(after.y);
  });

  test('scrollIntoView down reaches a row not yet in the tree, then back up', async () => {
    await toTop();
    // Privacy & Security is not in the tree at the top of the list; each
    // swipe re-queries it until it is loaded and displayed.
    const privacy = await get('privacyRow');
    await privacy.scrollIntoView({ direction: 'down', timeout: 60_000 });
    expect(await privacy.isVisible()).toBe(true);
    expect(await privacy.getAttribute('name')).toBe(PRIVACY_NAME);

    // Chain form, direction 'up' (finger swipes down, content above comes
    // back), then return to the top of the list for the next run.
    const general = await get('generalByAccessibilityId');
    await general.action(60_000).scrollIntoView({ direction: 'up' });
    expect(await general.isVisible()).toBe(true);
    await toTop();
  });
});
