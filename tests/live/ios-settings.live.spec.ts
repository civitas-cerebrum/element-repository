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

/** Reads the capabilities file; checks it targets iOS Settings. Returns it unchanged. */
function readCapabilities(file: string): Record<string, unknown> {
  const caps = JSON.parse(fs.readFileSync(path.resolve(process.cwd(), file), 'utf-8')) as Record<string, unknown>;
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
    expect(ios.getSelector('generalByPredicate', PAGE)).toMatch(/^-ios predicate string:/);
    expect(ios.getSelector('generalByClassChain', PAGE)).toMatch(/^-ios class chain:/);

    // Without an active platform the first SettingsHome block (android) wins,
    // so the ios answers above come from the platform-aware lookup.
    const firstMatch = new ElementRepository({}, PAGES);
    expect(firstMatch.getPagePlatform(PAGE)).toBe('android');
    expect(new ElementRepository({}, PAGES, { platform: 'web' }).getPagePlatform(PAGE)).toBe('web');
  });
});

test.describe.serial('live iOS Settings (read-only)', () => {
  test.skip(!ENABLED, SKIP_REASON);
  test.describe.configure({ timeout: 240_000 });

  let driver: any;
  let repo: ElementRepository;

  const get = (name: string): Promise<Element> => repo.get(name, PAGE);

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
    test.setTimeout(120_000);
    if (driver) {
      const d = driver;
      driver = undefined;
      await d.deleteSession();
    }
  });

  test('the repository uses the ios page', () => {
    expect(repo.platform).toBe('ios');
    expect(repo.getPagePlatform(PAGE)).toBe('ios');
  });

  for (const name of ['generalByAccessibilityId', 'generalByPredicate', 'generalByClassChain', 'generalById']) {
    test(`resolves and reads the General row: ${name}`, async () => {
      const el = await get(name);
      expect(isPlatform(el)).toBe(true);
      expect(await el.getAttribute('name')).toBe(GENERAL_NAME);
      expect(await el.isVisible()).toBe(true);
      expect(await el.textContent()).toMatch(/\S/);
      const box = await el.boundingBox();
      expect(box).not.toBeNull();
      expect(box!.width).toBeGreaterThan(0);
      expect(box!.height).toBeGreaterThan(0);
    });
  }

  test('all four selector kinds resolve to the same row', async () => {
    const boxes = [];
    for (const name of ['generalByAccessibilityId', 'generalByPredicate', 'generalByClassChain', 'generalById']) {
      boxes.push(await (await get(name)).boundingBox());
    }
    for (const box of boxes.slice(1)) expect(box).toEqual(boxes[0]);
  });

  test('ElementChain reads through action()', async () => {
    const el = await get('generalByAccessibilityId');
    const chain = el.action(20_000);
    expect(await chain.waitForState('visible').getAttribute('name')).toBe(GENERAL_NAME);
    expect(await el.action(20_000).getText()).toMatch(/\S/);
    expect(await el.action(20_000).isPresent()).toBe(true);
  });

  test('a multi-match selector counts, indexes and lists cells', async () => {
    const cells = await repo.get('cells', PAGE, { strategy: SelectionStrategy.ALL });
    const count = await cells.count();
    expect(count).toBeGreaterThan(1);

    const first = cells.first();
    const second = cells.nth(1);
    const [firstBox, secondBox] = [await first.boundingBox(), await second.boundingBox()];
    expect(firstBox).not.toBeNull();
    expect(secondBox).not.toBeNull();
    expect(secondBox!.y).not.toBe(firstBox!.y);
    expect(await first.count()).toBe(1);

    const listed = await repo.getAll('cells', PAGE);
    expect(listed.length).toBe(count);
  });

  test('swipe up then down on the list moves the rows and back', async () => {
    const list = await get('settingsList');
    const general = await get('generalByAccessibilityId');
    const { height } = await driver.getWindowSize();
    const distance = Math.round(height * 0.3);

    const before = (await general.boundingBox())!;
    await list.swipe('up', { distance });
    const general2 = await get('generalByAccessibilityId');
    const after = await general2.boundingBox().catch(() => null);
    // Either the row moved up or it scrolled out of the tree.
    if (after) expect(after.y).toBeLessThan(before.y);

    await list.swipe('down', { distance });
    await list.swipe('down', { distance });
    const general3 = await get('generalByAccessibilityId');
    await expect.poll(() => general3.isVisible(), { timeout: 20_000 }).toBe(true);
  });

  test('scrollIntoView down reaches a row far down the list, then back up', async () => {
    const privacy = await get('privacyRow');
    await privacy.scrollIntoView({ direction: 'down', timeout: 60_000 });
    expect(await privacy.isVisible()).toBe(true);
    expect(await privacy.textContent()).toMatch(/\S/);

    // Chain form, then return to the top of the list for the next run.
    const general = await get('generalByAccessibilityId');
    await general.action(60_000).scrollIntoView({ direction: 'up' });
    expect(await general.isVisible()).toBe(true);
  });
});
