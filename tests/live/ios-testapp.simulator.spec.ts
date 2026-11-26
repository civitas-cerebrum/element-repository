/**
 * Live iOS SIMULATOR check: ElementRepository + PlatformElement against the
 * purpose-built iOS test app (`com.civitas-cerebrum.test-app`) on an iOS
 * simulator, through an Appium server (XCUITest).
 *
 * RESULTS OF THIS SPEC ARE SIMULATOR RESULTS. They are never device
 * verification: report them as "iOS simulator", with the simulator model and
 * iOS version, and keep real-device results separate.
 *
 * The spec drives the test app only: it relaunches it, navigates from its
 * home screen (home card -> category entry -> screen), taps, double-taps,
 * long-presses, toggles, swipes, scrolls, pinches and zooms inside it. It
 * never opens another app and never changes the orientation.
 *
 * Run (placeholders only; never commit real values):
 *
 *   LIVE_IOS_SIM=1 APPIUM_URL=<appium-server-url-with-base-path> CAPABILITIES=<path-to-caps.json> \
 *     npx playwright test tests/live/ios-testapp.simulator.spec.ts
 *
 * - APPIUM_URL: full server URL including the base path, e.g. http://<appium-server>:<port>/wd/hub
 *   (or http://<appium-server>:<port> for a server without a base path).
 * - CAPABILITIES: path to a W3C capabilities JSON file (see
 *   tests/live/capabilities.ios-simulator.example.json). It is sent exactly
 *   as written. It must have `platformName: iOS` and
 *   `appium:bundleId: com.civitas-cerebrum.test-app`. It may have
 *   `appium:app` only as the test app's SIMULATOR build (a path ending in
 *   `.app` or `.app.zip`, as `build-app.sh` produces): Appium installs it
 *   on the simulator. A device build (`.ipa`) is refused, and so are
 *   `browserName`, `appium:otherApps` and an `appium:udid` that is not a
 *   simulator UDID (a simulator UDID is a UUID, 8-4-4-4-12 hex digits).
 * - APPIUM_USER / APPIUM_KEY: optional server credentials.
 *
 * Without LIVE_IOS_SIM=1, APPIUM_URL and CAPABILITIES the simulator tests are
 * skipped (the offline checks of the pages file and the capabilities gate
 * still run).
 *
 * One Appium session serves the whole file: the file's tests run in one
 * worker, in order. Each test relaunches the app and opens its screen first,
 * so a failing test neither skips nor disturbs the others.
 */
import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import { ElementRepository, Element, ScrollIntoViewOptions, isPlatform } from '../../src';
import { flattenCapabilities } from './capabilities';

const PAGES = path.join(__dirname, 'ios-testapp.pages.json');
const BUNDLE_ID = 'com.civitas-cerebrum.test-app';
/** An attribute name XCUITest does not know at all. */
const UNKNOWN_ATTRIBUTE = 'data-never-reported';
/** A simulator UDID is a UUID; a real device's UDID is not. */
const SIMULATOR_UDID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** The test app's simulator build, as `build-app.sh` produces it. */
const SIMULATOR_APP = /\.app(\.zip)?$/i;

const LIVE = process.env.LIVE_IOS_SIM === '1';
const APPIUM_URL = process.env.APPIUM_URL;
const CAPABILITIES = process.env.CAPABILITIES;
const ENABLED = LIVE && !!APPIUM_URL && !!CAPABILITIES;
const SKIP_REASON =
  'Live iOS simulator check: set LIVE_IOS_SIM=1, APPIUM_URL (server URL with base path) and CAPABILITIES (path to a W3C capabilities JSON file) to run it.';

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
 * Checks the capabilities target the iOS test app on a simulator: platform
 * iOS, the test app's bundle id, at most the test app's simulator build to
 * install, no other app, no browser, no real-device UDID. Appium options
 * are checked in every spelling (prefixed, in `appium:options`,
 * unprefixed; see {@link flattenCapabilities}). Returns them unchanged.
 */
function checkCapabilities(caps: Record<string, unknown>): Record<string, unknown> {
  const flat = flattenCapabilities(caps);
  for (const refused of ['browserName', 'appium:otherApps']) {
    if (refused in flat) {
      throw new Error(
        `CAPABILITIES file must not have "${refused}" (this spec drives the iOS test app on a simulator only: no other app, no browser).`,
      );
    }
  }
  const platformName = flat.platformName;
  if (typeof platformName !== 'string' || platformName.toLowerCase() !== 'ios') {
    throw new Error(`CAPABILITIES file must have platformName "iOS" for this spec, got ${JSON.stringify(platformName)}.`);
  }
  const bundleId = flat['appium:bundleId'];
  if (bundleId !== BUNDLE_ID) {
    throw new Error(
      `CAPABILITIES file must have "appium:bundleId": "${BUNDLE_ID}" (this spec drives the test app only), got ${JSON.stringify(bundleId)}.`,
    );
  }
  if ('appium:app' in flat) {
    const app = flat['appium:app'];
    if (typeof app !== 'string' || !SIMULATOR_APP.test(app)) {
      throw new Error(
        `CAPABILITIES file may have "appium:app" only as the test app's simulator build (a path ending in .app or .app.zip), got ${JSON.stringify(app)}.`,
      );
    }
  }
  if ('appium:udid' in flat) {
    const udid = flat['appium:udid'];
    if (typeof udid !== 'string' || !SIMULATOR_UDID.test(udid)) {
      throw new Error('CAPABILITIES file "appium:udid" must be a simulator UDID (8-4-4-4-12 hex digits): this spec runs on a simulator only.');
    }
  }
  return caps;
}

test.describe('ios-testapp pages file and simulator capabilities gate (offline)', () => {
  test('every entry resolves on the ios pages, with the platform selector prefixes', () => {
    const data = JSON.parse(fs.readFileSync(PAGES, 'utf-8')) as {
      pages: Array<{ name: string; platform?: string; elements: Array<{ elementName: string }> }>;
    };
    expect(() => ElementRepository.validate(data as any)).not.toThrow();
    const repo = new ElementRepository({}, PAGES, { platform: 'ios' });
    expect(repo.platform).toBe('ios');
    expect(data.pages.length).toBeGreaterThan(0);
    for (const page of data.pages) {
      expect(page.platform).toBe('ios');
      expect(repo.getPagePlatform(page.name)).toBe('ios');
      for (const { elementName } of page.elements) {
        expect(repo.getSelector(elementName, page.name)).toMatch(/\S/);
      }
    }
    expect(repo.getSelector('increment', 'Counter')).toBe('~counter-increment');
    expect(repo.getSelector('alert', 'Alerts')).toBe('-ios predicate string:type == "XCUIElementTypeAlert"');
    expect(repo.getSelector('alertOk', 'Alerts'))
      .toBe('-ios class chain:**/XCUIElementTypeAlert/**/XCUIElementTypeButton[`label == "OK"`]');
  });

  test('the pages have no android block: an android repository finds no page', () => {
    const android = new ElementRepository({}, PAGES, { platform: 'android' });
    expect(() => android.getSelector('grid', 'Home')).toThrow();
  });

  test('the capabilities gate accepts the example file (simulator build to install) and refuses another platform or app', () => {
    const example = readCapabilities(path.join(__dirname, 'capabilities.ios-simulator.example.json'));
    expect(example['appium:bundleId']).toBe(BUNDLE_ID);
    expect(example['appium:app']).toMatch(SIMULATOR_APP);
    expect(() => readCapabilities(path.join(__dirname, 'capabilities.android.example.json'))).toThrow(/platformName "iOS"/);
    expect(() => readCapabilities(path.join(__dirname, 'capabilities.ios.example.json'))).toThrow(/appium:bundleId/);
    expect(() => checkCapabilities({ ...example, 'appium:bundleId': 'com.example.other' })).toThrow(/appium:bundleId/);
    // Without an app to install (already installed on the simulator) is fine too.
    const { 'appium:app': _app, ...installed } = example;
    expect(checkCapabilities(installed)).toBe(installed);
  });

  test('the capabilities gate refuses a device build, a browser, other apps and a real-device UDID', () => {
    const example = readCapabilities(path.join(__dirname, 'capabilities.ios-simulator.example.json'));
    expect(() => checkCapabilities({ ...example, 'appium:app': '/path/to/TestApp.ipa' })).toThrow(/simulator build/);
    expect(() => checkCapabilities({ ...example, browserName: 'Safari' })).toThrow(/must not have "browserName"/);
    expect(() => checkCapabilities({ ...example, 'appium:otherApps': ['/path/to/Other.app'] })).toThrow(/must not have "appium:otherApps"/);
    expect(() => checkCapabilities({ ...example, 'appium:udid': '<device-udid>' })).toThrow(/simulator UDID/);
    const simulatorUdid = { ...example, 'appium:udid': '00000000-0000-0000-0000-000000000000' };
    expect(checkCapabilities(simulatorUdid)).toBe(simulatorUdid);
  });

  test('the capabilities gate checks options nested in appium:options and unprefixed ones too', () => {
    const example = readCapabilities(path.join(__dirname, 'capabilities.ios-simulator.example.json'));
    const { 'appium:bundleId': _bundleId, 'appium:app': _app, ...bare } = example;
    expect(() => checkCapabilities({ ...example, 'appium:options': { udid: '<device-udid>' } })).toThrow(/simulator UDID/);
    expect(() => checkCapabilities({ ...example, udid: '<device-udid>' })).toThrow(/simulator UDID/);
    expect(() => checkCapabilities({ ...example, 'appium:options': { app: '/path/to/TestApp.ipa' } })).toThrow(/twice|simulator build/);
    expect(() => checkCapabilities({ ...bare, app: '/path/to/TestApp.ipa', bundleId: BUNDLE_ID })).toThrow(/simulator build/);
    expect(() => checkCapabilities({ ...example, 'appium:options': { otherApps: ['/path/to/Other.app'] } })).toThrow(/must not have "appium:otherApps"/);
    expect(() => checkCapabilities({ ...example, otherApps: ['/path/to/Other.app'] })).toThrow(/must not have "appium:otherApps"/);
    expect(() => checkCapabilities({ ...bare, 'appium:options': { bundleId: 'com.example.other' } })).toThrow(/appium:bundleId/);
    expect(() => checkCapabilities({ ...example, bundleId: 'com.example.other' })).toThrow(/twice/);
    expect(() => checkCapabilities({ alwaysMatch: example })).toThrow(/flat W3C/);
    expect(() => checkCapabilities({ ...example, 'appium:options': 'udid' })).toThrow(/must be an object/);
    const nested = { ...bare, 'appium:options': { bundleId: BUNDLE_ID, udid: '00000000-0000-0000-0000-000000000000' } };
    expect(checkCapabilities(nested)).toBe(nested);
  });
});

test.describe('live iOS test app (SIMULATOR)', () => {
  test.skip(!ENABLED, SKIP_REASON);
  // Not serial: a failing test does not skip the rest. The tests still run
  // in order in one worker, sharing the session opened in beforeAll (a
  // worker restarted after a failure opens its own). Generous timeout: the
  // first gesture of a fresh session is slow, each test's relaunch and two
  // navigation taps take several seconds, and scrollIntoView may run up to
  // 20 swipes.
  test.describe.configure({ mode: 'default', timeout: 300_000 });

  let driver: any;
  let repo: ElementRepository;

  const get = (name: string, page: string, options?: Parameters<ElementRepository['get']>[2]): Promise<Element> =>
    repo.get(name, page, options);

  /**
   * Terminates and re-activates the test app, then waits until its first
   * home card is shown (a scroll container such as the home grid reports
   * isDisplayed false on iOS, so a card is the anchor).
   */
  async function relaunch(): Promise<void> {
    await driver.terminateApp(BUNDLE_ID).catch(() => { /* not running */ });
    await driver.activateApp(BUNDLE_ID);
    await (await get('cardElements', 'Home')).waitFor({ state: 'visible', timeout: 30_000 });
  }

  /**
   * Relaunches the app and opens a screen the way a user does: a home card,
   * then the entry on the category list, then waits for an element of the
   * target screen.
   */
  async function openScreen(card: string, entry: string, anchor: { name: string; page: string }): Promise<void> {
    await relaunch();
    await (await get(card, 'Home')).click();
    const item = await get(entry, 'Category', { timeout: 10_000 });
    await item.scrollIntoView({ direction: 'down', timeout: 60_000 });
    await item.click();
    await (await get(anchor.name, anchor.page)).waitFor({ state: 'visible', timeout: 30_000 });
  }

  /** The text of the open alert's message, or null while no alert is shown. */
  async function alertMessage(): Promise<string | null> {
    return (await get('alertMessage', 'Alerts', { timeout: 2_000 })).textContent().catch(() => null);
  }

  /** Waits for the alert with this message, then closes it with OK. */
  async function expectAlertAndClose(message: string): Promise<void> {
    await expect.poll(alertMessage, { timeout: 15_000 }).toBe(message);
    await (await get('alertOk', 'Alerts')).click();
    await (await get('alert', 'Alerts', { timeout: 2_000 })).waitFor({ state: 'hidden', timeout: 10_000 });
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
      driver = undefined;
      // Best effort: a session the server already dropped must not fail the run.
      await d.deleteSession().catch(() => {});
    }
  });

  test.describe('counter', () => {
    test.beforeEach(async () => {
      await openScreen('cardAuth', 'counter', { name: 'increment', page: 'Counter' });
    });

    test('doubleClick on the increment button taps it twice: the counter reads 2', async () => {
      const value = await get('value', 'Counter');
      expect(await value.textContent()).toBe('0');
      const increment = await get('increment', 'Counter');
      expect(await increment.doubleClick()).toBe(increment);
      // One tap per touchUpInside: a double tap taken as one tap reads "1".
      await expect.poll(() => value.textContent(), { timeout: 10_000 }).toBe('2');
    });
  });

  test.describe('alerts', () => {
    test.beforeEach(async () => {
      await openScreen('cardAlerts', 'alerts', { name: 'clickMe', page: 'Alerts' });
    });

    test('doubleClick fires the two-tap gesture recognizer', async () => {
      const button = await get('doubleTapMe', 'Alerts');
      expect(await button.doubleClick()).toBe(button);
      await expectAlertAndClose('You double-tapped me!');
    });

    test('longPress fires the long-press gesture recognizer', async () => {
      const button = await get('longPressMe', 'Alerts');
      expect(await button.longPress({ duration: 1_000 })).toBe(button);
      await expectAlertAndClose('You long-pressed me!');
    });

    test('tapAt inside a button taps it', async () => {
      const button = await get('clickMe', 'Alerts');
      const box = (await button.boundingBox())!;
      expect(box).not.toBeNull();
      expect(await button.tapAt({ x: Math.floor(box.width / 2), y: Math.floor(box.height / 2) })).toBe(button);
      await expectAlertAndClose('You clicked me!');
    });
  });

  test.describe('attributes', () => {
    test.beforeEach(async () => {
      await openScreen('cardElements', 'checkboxes', { name: 'toggleOff', page: 'Checkboxes' });
    });

    test('getAttribute reads null for an attribute XCUITest does not know, and reads a known one', async () => {
      const toggle = await get('toggleOn', 'Checkboxes');
      // XCUITest answers an unknown name with HTTP 500 "The attribute ... is unknown".
      const started = Date.now();
      expect(await toggle.getAttribute(UNKNOWN_ATTRIBUTE)).toBeNull();
      // Read once, not polled to a timeout.
      expect(Date.now() - started).toBeLessThan(10_000);
      expect(await toggle.getAttribute('name')).toBe('toggle-on');
      expect(await toggle.getAttribute('value')).toBe('1');
      // A known attribute the element has no value for also reads null.
      expect(await (await get('checkboxUnchecked', 'Checkboxes')).getAttribute('value')).toBeNull();
    });

    test('getByAttribute skips elements that lack the attribute and finds the one that has it', async () => {
      // Document order: the unchecked checkbox button (no value), the OFF
      // switch ("0"), the ON switch ("1").
      const all = await repo.getAll('mixedControls', 'Checkboxes');
      expect(all.length).toBe(3);

      const on = await repo.getByAttribute('mixedControls', 'Checkboxes', 'value', '1', { exact: true });
      expect(on).not.toBeNull();
      expect(isPlatform(on!)).toBe(true);
      expect(await on!.getAttribute('name')).toBe('toggle-on');

      // No element knows the attribute: no match, and no error.
      expect(await repo.getByAttribute('mixedControls', 'Checkboxes', UNKNOWN_ATTRIBUTE, 'x')).toBeNull();
    });
  });

  test.describe('switches and checkboxes', () => {
    test.beforeEach(async () => {
      await openScreen('cardElements', 'checkboxes', { name: 'toggleOff', page: 'Checkboxes' });
    });

    test('a UISwitch reads "0" when off and "1" when on', async () => {
      expect(await (await get('toggleOff', 'Checkboxes')).getAttribute('value')).toBe('0');
      expect(await (await get('toggleOff', 'Checkboxes')).isChecked()).toBe(false);
      expect(await (await get('toggleOn', 'Checkboxes')).getAttribute('value')).toBe('1');
      expect(await (await get('toggleOn', 'Checkboxes')).isChecked()).toBe(true);
    });

    for (const name of ['toggleOff', 'toggleOn']) {
      test(`check() and uncheck() on a UISwitch are idempotent: ${name}`, async () => {
        const toggle = await get(name, 'Checkboxes');
        await toggle.check();
        await expect.poll(() => toggle.getAttribute('value'), { timeout: 10_000 }).toBe('1');
        expect(await toggle.isChecked()).toBe(true);
        // Checking an ON switch leaves it on.
        await toggle.check();
        expect(await toggle.getAttribute('value')).toBe('1');
        expect(await toggle.isChecked()).toBe(true);

        await toggle.uncheck();
        await expect.poll(() => toggle.getAttribute('value'), { timeout: 10_000 }).toBe('0');
        expect(await toggle.isChecked()).toBe(false);
        // Unchecking an OFF switch leaves it off.
        await toggle.uncheck();
        expect(await toggle.getAttribute('value')).toBe('0');
        expect(await toggle.isChecked()).toBe(false);
      });
    }

    test('check() and uncheck() on a checkbox button follow its selected state', async () => {
      const box = await get('checkboxUnchecked', 'Checkboxes');
      expect(await box.isChecked()).toBe(false);
      await box.check();
      await expect.poll(() => box.isChecked(), { timeout: 10_000 }).toBe(true);
      await box.check();
      expect(await box.isChecked()).toBe(true);
      await box.uncheck();
      await expect.poll(() => box.isChecked(), { timeout: 10_000 }).toBe(false);
      await box.uncheck();
      expect(await box.isChecked()).toBe(false);
    });

    test('check() on the disabled switch throws "is disabled" and leaves it off', async () => {
      const disabled = await get('toggleDisabled', 'Checkboxes');
      expect(await disabled.isEnabled()).toBe(false);
      const err = await disabled.check({ timeout: 3_000 }).then(() => null, (e: unknown) => e);
      expect(err).toBeInstanceOf(Error);
      expect((err as Error).message).toBe(`check: "${repo.getSelector('toggleDisabled', 'Checkboxes')}" is disabled`);
      expect(await disabled.getAttribute('value')).toBe('0');
    });

    test('the text rule reads the label first: a switch reads its label, not its value', async () => {
      // XCUITest's getText() returns the value first ("1" for an ON switch).
      expect(await (await get('toggleOn', 'Checkboxes')).textContent()).toBe('On');
      expect(await (await get('toggleOff', 'Checkboxes')).textContent()).toBe('Off');
    });
  });

  test.describe('product carousel (horizontal)', () => {
    test.beforeEach(async () => {
      await openScreen('cardMedia', 'productCarousel', { name: 'indicator', page: 'ProductCarousel' });
    });

    async function expectIndicator(text: string): Promise<void> {
      await expect.poll(async () => (await get('indicator', 'ProductCarousel')).textContent(), { timeout: 15_000 }).toBe(text);
    }

    test('the carousel sits above the window centre, so a centre-line sweep would miss it', async () => {
      // Guard for the horizontal checks below: they prove the sweep runs
      // along the carousel row, not along the window's middle.
      const box = await (await get('carousel', 'ProductCarousel')).boundingBox();
      expect(box).not.toBeNull();
      const { height } = await driver.getWindowSize();
      expect(box!.y + box!.height).toBeLessThan(height / 2);
      // The text rule: a page dot reads its label, not its selected value.
      expect(await (await get('dot0', 'ProductCarousel')).textContent()).toBe('Go to product 1');
      await expectIndicator('Product 1 of 5');
    });

    // No check without a container here: the carousel pages full-width
    // slides and only the shown slide is in the tree, so no target to the
    // side is in the tree, and without a container the sweep runs along the
    // window centre (outside the carousel). The no-container horizontal
    // check runs on the Android table, which spans the window centre.

    test('scrollIntoView right reaches the last product, then left the first, inside the carousel container', async () => {
      const container = await get('carousel', 'ProductCarousel');
      const right: ScrollIntoViewOptions = { direction: 'right', container, timeout: 120_000 };
      const last = await get('name4', 'ProductCarousel', { timeout: 2_000 });
      expect(await last.scrollIntoView(right)).toBe(last);
      expect(await last.isVisible()).toBe(true);
      expect(await last.textContent()).toBe('USB-C Hub');
      await expectIndicator('Product 5 of 5');

      const left: ScrollIntoViewOptions = { direction: 'left', container, timeout: 120_000 };
      const first = await get('name0', 'ProductCarousel', { timeout: 2_000 });
      await first.scrollIntoView(left);
      expect(await first.isVisible()).toBe(true);
      expect(await first.textContent()).toBe('Wireless Headphones');
      await expectIndicator('Product 1 of 5');
    });
  });

  test.describe('dropdown list (vertical, below the window centre)', () => {
    test.beforeEach(async () => {
      await openScreen('cardForms', 'dropDown', { name: 'customButton', page: 'Dropdown' });
      await (await get('customButton', 'Dropdown')).click();
      await (await get('option0', 'Dropdown')).waitFor({ state: 'visible', timeout: 10_000 });
    });

    test('scrollIntoView down and up inside the list container reaches its last and first option', async () => {
      const container = await get('customList', 'Dropdown');
      const box = await container.boundingBox();
      expect(box).not.toBeNull();
      const { height } = await driver.getWindowSize();
      if (box!.y <= height / 2 && box!.y + box!.height >= height / 2) {
        test.info().annotations.push({
          type: 'layout',
          description: `the list (y ${box!.y}..${box!.y + box!.height}) spans the window centre on this simulator`,
        });
      }

      const down: ScrollIntoViewOptions = { direction: 'down', container, timeout: 120_000 };
      const last = await get('option17', 'Dropdown', { timeout: 2_000 });
      expect(await last.scrollIntoView(down)).toBe(last);
      expect(await last.isVisible()).toBe(true);
      expect(await last.textContent()).toBe('United States');

      const up: ScrollIntoViewOptions = { direction: 'up', container, timeout: 120_000 };
      const first = await get('option0', 'Dropdown', { timeout: 2_000 });
      await first.scrollIntoView(up);
      expect(await first.isVisible()).toBe(true);
      expect(await first.textContent()).toBe('Argentina');
    });
  });

  test.describe('gallery', () => {
    test.beforeEach(async () => {
      await openScreen('cardMedia', 'gallery', { name: 'item1', page: 'Gallery' });
    });

    test('pinch and zoom on the full-size image return the element and leave the viewer open', async () => {
      await (await get('item1', 'Gallery')).click();
      const image = await get('fullImage', 'Gallery');
      await image.waitFor({ state: 'visible', timeout: 10_000 });
      expect(await image.pinch()).toBe(image);
      expect(await image.zoom()).toBe(image);
      // The viewer closes only on a one-finger tap; two-finger gestures leave it open.
      expect(await (await get('fullImage', 'Gallery')).isVisible()).toBe(true);
      expect(await (await get('caption', 'Gallery')).textContent()).toBe('Image 1 of 8');
      await (await get('close', 'Gallery')).click();
    });
  });
});
