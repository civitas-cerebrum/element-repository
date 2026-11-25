/**
 * Live Android check: ElementRepository + PlatformElement against the
 * purpose-built test app (`com.civitas.testapp`) on a real device or
 * emulator, through an Appium server (UiAutomator2).
 *
 * The spec drives the test app only: it relaunches it, navigates from its
 * home screen (home card -> category entry -> screen), taps, toggles,
 * swipes, scrolls, long-presses, pinches and zooms inside it. It never
 * opens another app and never changes the device orientation.
 *
 * Run (placeholders only; never commit real values):
 *
 *   LIVE_ANDROID=1 APPIUM_URL=<appium-server-url-with-base-path> CAPABILITIES=<path-to-caps.json> \
 *     npx playwright test tests/live/android-testapp.live.spec.ts
 *
 * - APPIUM_URL: full server URL including the base path, e.g. http://<appium-server>:4723/wd/hub
 * - CAPABILITIES: path to a W3C capabilities JSON file (see
 *   tests/live/capabilities.android.example.json). It is sent exactly as
 *   written. It must have `platformName: Android` and
 *   `appium:appPackage: com.civitas.testapp`, and must not have
 *   `appium:app` (no installs) or `browserName` (no browser session).
 * - APPIUM_USER / APPIUM_KEY: optional server credentials.
 *
 * Without LIVE_ANDROID=1, APPIUM_URL and CAPABILITIES the device tests are
 * skipped (the offline checks of the pages file still run).
 *
 * One Appium session serves the whole file: the file's tests run in one
 * worker, in order. The screen groups are independent: each test relaunches
 * the app and opens its screen first, so a failing test neither skips nor
 * disturbs the others.
 *
 * The checked-state tests check that `isChecked()` / `check()` / `uncheck()`
 * follow the control's `checked` state (not `selected`), that `check()`
 * refuses a disabled radio button without clicking it, that `uncheck()`
 * refuses a checked radio button at once, and that `check()` refuses a
 * control that is not checkable. The list-row tests check that a
 * container's `textContent()`, the TEXT strategy and `getByText` use the
 * text of its descendants when its own text is empty, and leave out the
 * hint an empty search field shows.
 */
import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import { ElementRepository, Element, SelectionStrategy, isPlatform } from '../../src';

const PAGES = path.join(__dirname, 'android-testapp.pages.json');
const APP_PACKAGE = 'com.civitas.testapp';
const FULL_ID_PREFIX = `${APP_PACKAGE}:id/`;

const LIVE = process.env.LIVE_ANDROID === '1';
const APPIUM_URL = process.env.APPIUM_URL;
const CAPABILITIES = process.env.CAPABILITIES;
const ENABLED = LIVE && !!APPIUM_URL && !!CAPABILITIES;
const SKIP_REASON =
  'Live Android check: set LIVE_ANDROID=1, APPIUM_URL (server URL with base path) and CAPABILITIES (path to a W3C capabilities JSON file) to run it.';

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
 * Checks the capabilities target the installed Android test app: platform
 * Android, the test app's package, and no app to install or browser to open.
 * Returns them unchanged.
 */
function checkCapabilities(caps: Record<string, unknown>): Record<string, unknown> {
  for (const refused of ['appium:app', 'browserName']) {
    if (refused in caps) {
      throw new Error(
        `CAPABILITIES file must not have "${refused}" (this spec drives the installed test app only: no install, no browser).`,
      );
    }
  }
  const platformName = caps.platformName;
  if (typeof platformName !== 'string' || platformName.toLowerCase() !== 'android') {
    throw new Error(`CAPABILITIES file must have platformName "Android" for this spec, got ${JSON.stringify(platformName)}.`);
  }
  const appPackage = caps['appium:appPackage'];
  if (appPackage !== APP_PACKAGE) {
    throw new Error(
      `CAPABILITIES file must have "appium:appPackage": "${APP_PACKAGE}" (this spec drives the test app only), got ${JSON.stringify(appPackage)}.`,
    );
  }
  return caps;
}

test.describe('android-testapp pages file (offline)', () => {
  test('every entry resolves on the android pages', () => {
    const data = JSON.parse(fs.readFileSync(PAGES, 'utf-8')) as {
      pages: Array<{ name: string; platform?: string; elements: Array<{ elementName: string }> }>;
    };
    expect(() => ElementRepository.validate(data as any)).not.toThrow();
    const repo = new ElementRepository({}, PAGES, { platform: 'android' });
    expect(repo.platform).toBe('android');
    expect(data.pages.length).toBeGreaterThan(0);
    for (const page of data.pages) {
      expect(page.platform).toBe('android');
      expect(repo.getPagePlatform(page.name)).toBe('android');
      for (const { elementName } of page.elements) {
        expect(repo.getSelector(elementName, page.name)).toMatch(/\S/);
      }
    }
  });

  test('android selector formatting for every selector kind in the file', () => {
    const repo = new ElementRepository({}, PAGES, { platform: 'android' });
    // accessibility id -> content-desc.
    expect(repo.getSelector('grid', 'Home')).toBe('~home-grid');
    // id: short and full resource ids, both through Appium's native `id` strategy.
    expect(repo.getSelector('gridByShortId', 'Home')).toBe('id=home_grid');
    expect(repo.getSelector('gridByFullId', 'Home')).toBe(`id=${FULL_ID_PREFIX}home_grid`);
    expect(repo.getSelector('toggleOffByShortId', 'Checkboxes')).toBe('id=toggle_off');
    expect(repo.getSelector('toggleOffByFullId', 'Checkboxes')).toBe(`id=${FULL_ID_PREFIX}toggle_off`);
    // A full id of another package (the platform's own list item layout).
    expect(repo.getSelector('itemTitles', 'LongList')).toBe('id=android:id/text1');
    // class name, xpath: passed through.
    expect(repo.getSelector('gridByClassName', 'Home')).toBe('android.widget.GridView');
    expect(repo.getSelector('toggleOffByXpath', 'Checkboxes')).toBe("//android.widget.Switch[@content-desc='toggle-off']");
    // uiautomator: prefixed.
    expect(repo.getSelector('toggleOffByUiAutomator', 'Checkboxes'))
      .toBe(`android=new UiSelector().resourceId("${FULL_ID_PREFIX}toggle_off")`);
    expect(repo.getSelector('no', 'Radio')).toBe('android=new UiSelector().description("radio-no")');
    // text: an exact UiSelector text match.
    expect(repo.getSelector('mediaTitleByText', 'Home')).toBe('android=new UiSelector().text("Media")');
    expect(repo.getSelector('toggleOffByText', 'Checkboxes')).toBe('android=new UiSelector().text("Toggle (off)")');
  });

  test('UiSelector text escaping: double quotes escaped, backslashes kept, a trailing backslash refused', () => {
    // The test app has no text with a double quote, so this is checked offline only.
    const repo = new ElementRepository({}, {
      pages: [{
        name: 'Quotes',
        platform: 'android',
        elements: [
          { elementName: 'quoted', selector: { text: 'Say "hi" now' } },
          { elementName: 'backslash', selector: { text: 'C:\\dir\\file' } },
          { elementName: 'trailingBackslash', selector: { text: 'ends in \\' } },
        ],
      }],
    }, { platform: 'android' });
    expect(repo.getSelector('quoted', 'Quotes')).toBe('android=new UiSelector().text("Say \\"hi\\" now")');
    expect(repo.getSelector('backslash', 'Quotes')).toBe('android=new UiSelector().text("C:\\dir\\file")');
    expect(() => repo.getSelector('trailingBackslash', 'Quotes')).toThrow(/backslash/);
  });

  test('the capabilities gate accepts the example file and refuses another platform', () => {
    const example = readCapabilities(path.join(__dirname, 'capabilities.android.example.json'));
    expect(example['appium:appPackage']).toBe(APP_PACKAGE);
    expect(() => readCapabilities(path.join(__dirname, 'capabilities.ios.example.json'))).toThrow(/platformName "Android"/);
    expect(() => checkCapabilities({ ...example, 'appium:appPackage': 'com.example.other' })).toThrow(/appium:appPackage/);
  });

  test('the capabilities gate refuses an app to install and a browser session', () => {
    const example = readCapabilities(path.join(__dirname, 'capabilities.android.example.json'));
    expect(() => checkCapabilities({ ...example, 'appium:app': '/path/to/app.apk' })).toThrow(/must not have "appium:app"/);
    expect(() => checkCapabilities({ ...example, browserName: 'Chrome' })).toThrow(/must not have "browserName"/);
  });

  test('the alert dialog entries: the title id is the app package, message and button are android ids', () => {
    const repo = new ElementRepository({}, PAGES, { platform: 'android' });
    // AppCompat's title lives in the app's own package; message and button in android's.
    expect(repo.getSelector('dialogTitle', 'Alerts')).toBe(`id=${APP_PACKAGE}:id/alertTitle`);
    expect(repo.getSelector('dialogMessage', 'Alerts')).toBe('id=android:id/message');
    expect(repo.getSelector('dialogOk', 'Alerts')).toBe('id=android:id/button1');
  });

  test('the pages have no ios block: an ios repository finds no page', () => {
    const ios = new ElementRepository({}, PAGES, { platform: 'ios' });
    expect(() => ios.getSelector('grid', 'Home')).toThrow();
  });
});

test.describe('live Android test app', () => {
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

  /** Terminates and re-activates the test app, then waits until its home screen is in the foreground. */
  async function relaunch(): Promise<void> {
    await driver.terminateApp(APP_PACKAGE);
    await driver.activateApp(APP_PACKAGE);
    await expect.poll(() => driver.getCurrentPackage(), { timeout: 30_000 }).toBe(APP_PACKAGE);
    await (await get('grid', 'Home')).waitFor({ state: 'visible', timeout: 30_000 });
  }

  /**
   * Relaunches the app and opens a screen the way a user does: a home card,
   * then the entry on the category screen (scrolled to if needed), then waits
   * for an element of the target screen.
   */
  async function openScreen(card: string, entry: string, anchor: { name: string; page: string }): Promise<void> {
    await relaunch();
    await (await get(card, 'Home')).click();
    const item = await get(entry, 'Category', { timeout: 5_000 });
    await item.scrollIntoView({ direction: 'down', timeout: 60_000 });
    await item.click();
    await (await get(anchor.name, anchor.page)).waitFor({ state: 'visible', timeout: 30_000 });
  }

  async function expectAppInForeground(): Promise<void> {
    expect(await driver.getCurrentPackage()).toBe(APP_PACKAGE);
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
    repo = new ElementRepository(driver, PAGES, { platform: 'android', timeout: 20_000 });
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

  test.describe('home screen', () => {
    test.beforeEach(async () => {
      await relaunch();
    });

    test('the repository uses the android pages', () => {
      expect(repo.platform).toBe('android');
      expect(repo.getPagePlatform('Home')).toBe('android');
    });

    test('short and full resource ids resolve to the same element', async () => {
      const kinds = ['grid', 'gridByShortId', 'gridByFullId', 'gridByClassName'];
      const boxes = [];
      for (const name of kinds) {
        const el = await get(name, 'Home');
        expect(isPlatform(el)).toBe(true);
        expect(await el.getAttribute('resource-id')).toBe(`${FULL_ID_PREFIX}home_grid`);
        expect(await el.isVisible()).toBe(true);
        boxes.push(await el.boundingBox());
      }
      expect(boxes[0]).not.toBeNull();
      expect(boxes[0]!.width).toBeGreaterThan(0);
      for (const box of boxes.slice(1)) expect(box).toEqual(boxes[0]);
    });

    test('the TEXT strategy, getByText and a text selector resolve the same category title', async () => {
      const byTextSelector = await get('mediaTitleByText', 'Home');
      const expected = await byTextSelector.boundingBox();
      expect(expected).not.toBeNull();

      const byStrategy = await get('categoryTitles', 'Home', {
        strategy: SelectionStrategy.TEXT,
        value: 'Media',
        timeout: 30_000,
      });
      expect(isPlatform(byStrategy)).toBe(true);
      expect(await byStrategy.textContent()).toBe('Media');
      expect(await byStrategy.boundingBox()).toEqual(expected);

      const byText = await repo.getByText('categoryTitles', 'Home', 'Edge Cases', true);
      expect(byText).not.toBeNull();
      expect(await byText!.textContent()).toBe('Edge Cases');
      // Edge Cases is the card below-right of Media in the grid.
      const edgeBox = await byText!.boundingBox();
      expect(edgeBox).not.toBeNull();
      expect(edgeBox!.y).toBeGreaterThan(expected!.y);
    });
  });

  test.describe('checkboxes and toggles', () => {
    const CONTROLS: Array<{ name: string; initial: boolean }> = [
      { name: 'checkboxUnchecked', initial: false },
      { name: 'checkboxChecked', initial: true },
      { name: 'toggleOff', initial: false },
      { name: 'toggleOn', initial: true },
    ];
    const TOGGLE_OFF_KINDS = [
      'toggleOff', 'toggleOffByShortId', 'toggleOffByFullId',
      'toggleOffByUiAutomator', 'toggleOffByXpath', 'toggleOffByText',
    ];

    test.beforeEach(async () => {
      await openScreen('cardElements', 'checkboxes', { name: 'checkboxUnchecked', page: 'Checkboxes' });
    });

    test('every selector kind resolves to the same toggle', async () => {
      const boxes = [];
      for (const name of TOGGLE_OFF_KINDS) {
        const el = await get(name, 'Checkboxes');
        expect(await el.getAttribute('resource-id')).toBe(`${FULL_ID_PREFIX}toggle_off`);
        boxes.push(await el.boundingBox());
      }
      expect(boxes[0]).not.toBeNull();
      for (const box of boxes.slice(1)) expect(box).toEqual(boxes[0]);
    });

    test('the TEXT strategy picks a checkbox by its label', async () => {
      const el = await get('checkboxes', 'Checkboxes', {
        strategy: SelectionStrategy.TEXT,
        value: 'Checked (default)',
        timeout: 30_000,
      });
      expect(await el.getAttribute('resource-id')).toBe(`${FULL_ID_PREFIX}checkbox_checked`);
    });

    test('isChecked() reads the initial checked state', async () => {
      for (const { name, initial } of CONTROLS) {
        const el = await get(name, 'Checkboxes');
        expect(await el.getAttribute('checked'), `${name} checked attribute`).toBe(String(initial));
        expect(await el.isChecked(), `${name} isChecked()`).toBe(initial);
      }
    });

    for (const { name } of CONTROLS) {
      test(`check() and uncheck() are idempotent: ${name}`, async () => {
        const el = await get(name, 'Checkboxes');
        await el.check();
        await expect.poll(() => el.getAttribute('checked'), { timeout: 10_000 }).toBe('true');
        expect(await el.isChecked()).toBe(true);
        // Checking a checked control leaves it checked.
        await el.check();
        expect(await el.getAttribute('checked')).toBe('true');
        expect(await el.isChecked()).toBe(true);

        await el.uncheck();
        await expect.poll(() => el.getAttribute('checked'), { timeout: 10_000 }).toBe('false');
        expect(await el.isChecked()).toBe(false);
        // Unchecking an unchecked control leaves it unchecked.
        await el.uncheck();
        expect(await el.getAttribute('checked')).toBe('false');
        expect(await el.isChecked()).toBe(false);
      });
    }

    test('tapAt on a toggle flips it and returns the element', async () => {
      const toggle = await get('toggleOff', 'Checkboxes');
      const before = await toggle.getAttribute('checked');
      const box = (await toggle.boundingBox())!;
      const returned = await toggle.tapAt({ x: Math.floor(box.width / 2), y: Math.floor(box.height / 2) });
      expect(returned).toBe(toggle);
      const flipped = before === 'true' ? 'false' : 'true';
      await expect.poll(() => toggle.getAttribute('checked'), { timeout: 10_000 }).toBe(flipped);
    });
  });

  test.describe('radio buttons', () => {
    test.beforeEach(async () => {
      await openScreen('cardElements', 'radio', { name: 'yes', page: 'Radio' });
    });

    test('no radio button is checked at first', async () => {
      const buttons = await repo.getAll('buttons', 'Radio');
      expect(buttons.length).toBe(3);
      for (const name of ['yes', 'impressive', 'no']) {
        expect(await (await get(name, 'Radio')).isChecked(), name).toBe(false);
      }
    });

    test('check() on one radio button unchecks the other', async () => {
      // "yes" and "impressive" are enabled; "no" is disabled (see below).
      const yes = await get('yes', 'Radio');
      const impressive = await get('impressive', 'Radio');

      await yes.check();
      await expect.poll(() => yes.getAttribute('checked'), { timeout: 10_000 }).toBe('true');
      expect(await yes.isChecked()).toBe(true);
      expect(await impressive.isChecked()).toBe(false);
      // Checking the checked one again keeps it checked.
      await yes.check();
      expect(await yes.isChecked()).toBe(true);
      expect(await impressive.isChecked()).toBe(false);

      await impressive.check();
      await expect.poll(() => impressive.getAttribute('checked'), { timeout: 10_000 }).toBe('true');
      expect(await impressive.isChecked()).toBe(true);
      expect(await yes.isChecked()).toBe(false);
      await impressive.check();
      expect(await impressive.isChecked()).toBe(true);
      expect(await yes.isChecked()).toBe(false);
    });

    test('check() on the disabled radio button throws "is disabled" and leaves it unchecked', async () => {
      const no = await get('no', 'Radio');
      expect(await no.isEnabled()).toBe(false);
      // check() waits up to its timeout for the control to become enabled,
      // then throws without clicking it.
      const err = await no.check({ timeout: 3_000 }).then(() => null, (e: unknown) => e);
      expect(err).toBeInstanceOf(Error);
      // A plain repository element is named by its selector alone.
      expect((err as Error).message).toBe(`check: "${repo.getSelector('no', 'Radio')}" is disabled`);
      expect(await no.isChecked()).toBe(false);
      // No other option was selected by a stray click.
      for (const name of ['yes', 'impressive']) {
        expect(await (await get(name, 'Radio')).isChecked(), name).toBe(false);
      }
    });

    test('check() on a control that is not checkable throws "is not checkable" at once', async () => {
      // The RadioGroup holding the buttons has checkable="false".
      const group = await get('group', 'Radio');
      expect(await group.getAttribute('checkable')).toBe('false');
      const started = Date.now();
      const err = await group.check({ timeout: 10_000 }).then(() => null, (e: unknown) => e);
      const elapsed = Date.now() - started;
      expect(err).toBeInstanceOf(Error);
      expect((err as Error).message).toBe(`check: "${repo.getSelector('group', 'Radio')}" is not checkable`);
      expect(elapsed).toBeLessThan(2_000);
      for (const name of ['yes', 'impressive', 'no']) {
        expect(await (await get(name, 'Radio')).isChecked(), name).toBe(false);
      }
    });

    test('uncheck() on a checked radio button throws and leaves it checked', async () => {
      const yes = await get('yes', 'Radio');
      await yes.check();
      await expect.poll(() => yes.isChecked(), { timeout: 10_000 }).toBe(true);
      // Clicking a checked radio button does not uncheck it, so uncheck()
      // refuses at once, without waiting out its timeout.
      const started = Date.now();
      const err = await yes.uncheck({ timeout: 10_000 }).then(() => null, (e: unknown) => e);
      const elapsed = Date.now() - started;
      expect(err).toBeInstanceOf(Error);
      expect((err as Error).message)
        .toBe(`uncheck: "${repo.getSelector('yes', 'Radio')}" is a radio button; select another option instead`);
      expect(elapsed).toBeLessThan(2_000);
      expect(await yes.isChecked()).toBe(true);
    });
  });

  test.describe('long list', () => {
    test.beforeEach(async () => {
      await openScreen('cardEdgeCases', 'longList', { name: 'item1', page: 'LongList' });
    });

    test('a list row reads the text of its child views', async () => {
      // The row's own text is empty; its two TextViews hold "Item 1" and "Alpha".
      const row = await get('item1', 'LongList');
      expect(await row.textContent()).toBe('Item 1 Alpha');
    });

    test('the TEXT strategy and getByText pick a row by the text of its child views', async () => {
      // Exact match on the joined text of the row's two TextViews.
      const second = await get('items', 'LongList', {
        strategy: SelectionStrategy.TEXT,
        value: 'Item 2 Beta',
        timeout: 30_000,
      });
      expect(isPlatform(second)).toBe(true);
      expect(await second.getAttribute('content-desc')).toBe('long-list-item-2');
      expect(await second.textContent()).toBe('Item 2 Beta');

      // A contains match: the first row whose text contains "Gamma" is row 3.
      const gamma = await get('items', 'LongList', {
        strategy: SelectionStrategy.TEXT,
        value: 'gamma',
        timeout: 30_000,
      });
      expect(await gamma.getAttribute('content-desc')).toBe('long-list-item-3');

      const byText = await repo.getByText('items', 'LongList', 'Item 4 Delta', true);
      expect(byText).not.toBeNull();
      expect(await byText!.getAttribute('content-desc')).toBe('long-list-item-4');
      expect(await byText!.boundingBox()).not.toBeNull();
    });

    test('a container holding the empty search field does not read its hint as text', async () => {
      // The empty EditText shows its hint as `text` with showing-hint="true";
      // the hint is not text the field holds, so the LinearLayout around it
      // has no text, and the field's input value is empty.
      const search = await get('search', 'LongList');
      expect(await search.getAttribute('text')).toBe('Search by name or category...');
      expect(await search.inputValue()).toBe('');
      const searchRow = await get('searchRow', 'LongList');
      const text = (await searchRow.textContent()) ?? '';
      expect(text).not.toContain('Search by name or category');
      expect(text).toBe('');
    });

    test('locateChild finds the title TextView of a row', async () => {
      const row = await get('item1', 'LongList');
      const title = row.locateChild(repo.getSelector('itemTitles', 'LongList'));
      expect(await title.textContent()).toBe('Item 1');
      const subtitle = row.locateChild('id=android:id/text2');
      expect(await subtitle.textContent()).toBe('Alpha');
    });

    test('first() and nth(1) of a multi-match selector are different rows', async () => {
      const rows = await get('items', 'LongList', { strategy: SelectionStrategy.ALL });
      expect(await rows.count()).toBeGreaterThan(1);
      const first = rows.first();
      const second = rows.nth(1);
      expect(await first.getAttribute('content-desc')).toBe('long-list-item-1');
      expect(await second.getAttribute('content-desc')).toBe('long-list-item-2');
      const firstBox = await first.boundingBox();
      const secondBox = await second.boundingBox();
      expect(firstBox).not.toBeNull();
      expect(secondBox).not.toBeNull();
      expect(secondBox!.y).toBeGreaterThan(firstBox!.y);
      expect(await first.count()).toBe(1);

      const titles = await repo.getAll('itemTitles', 'LongList');
      expect(titles.length).toBeGreaterThan(1);
      expect(await titles[0].textContent()).toBe('Item 1');
      expect(await titles[1].textContent()).toBe('Item 2');

      const byXpath = await get('itemByXpath', 'LongList');
      expect(await byXpath.boundingBox()).toEqual(secondBox);
    });

    test('longPress on a row returns the row and keeps the app in the foreground', async () => {
      const row = await get('itemByXpath', 'LongList');
      expect(await row.longPress({ duration: 800 })).toBe(row);
      await expectAppInForeground();
      expect(await row.isVisible()).toBe(true);
    });

    test('scrollIntoView down reaches a row far below, then up brings the first row back', async () => {
      const far = await get('item40', 'LongList', { timeout: 2_000 });
      expect(await far.scrollIntoView({ direction: 'down', timeout: 120_000 })).toBe(far);
      expect(await far.isVisible()).toBe(true);
      expect(await far.getAttribute('content-desc')).toBe('long-list-item-40');

      const first = await get('item1', 'LongList', { timeout: 2_000 });
      await first.scrollIntoView({ direction: 'up', timeout: 120_000 });
      expect(await first.isVisible()).toBe(true);
    });
  });

  test.describe('tall page', () => {
    test.beforeEach(async () => {
      await openScreen('cardInteractions', 'tall', { name: 'scrollView', page: 'Tall' });
    });

    test('swipe up then down on the scroll view moves a section and back', async () => {
      const scrollView = await get('scrollView', 'Tall');
      const section = await get('section3', 'Tall');
      const before = await section.boundingBox();
      expect(before).not.toBeNull();
      const { height } = await driver.getWindowSize();
      const distance = Math.round(height * 0.2);
      // A swipe loses some distance to touch slop and settling; half of it
      // is still far more than any jitter.
      const minMove = Math.round(distance / 2);

      // Finger up: content moves up, so the section's y decreases.
      expect(await scrollView.swipe('up', { distance })).toBe(scrollView);
      const after = await (await get('section3', 'Tall', { timeout: 2_000 })).boundingBox().catch(() => null);
      // Either the section moved up by a real amount or it left the tree.
      const movedUp = after === null ? Infinity : before!.y - after.y;
      expect(movedUp, `section 3 moved up by ${movedUp}px (wanted at least ${minMove}px or out of the tree)`)
        .toBeGreaterThanOrEqual(minMove);

      // Finger down: content moves back down.
      expect(await scrollView.swipe('down', { distance })).toBe(scrollView);
      const back = await (await get('section3', 'Tall')).boundingBox();
      expect(back).not.toBeNull();
      if (after !== null) {
        expect(back!.y - after.y, 'section 3 moved back down').toBeGreaterThanOrEqual(minMove);
      } else {
        // It had left the tree; it is back, below where it was hidden.
        expect(back!.y).toBeGreaterThanOrEqual(0);
      }
    });

    test('scrollIntoView down reaches the last section, then up the first', async () => {
      const last = await get('section10', 'Tall', { timeout: 2_000 });
      await last.scrollIntoView({ direction: 'down', timeout: 120_000 });
      expect(await last.isVisible()).toBe(true);

      const first = await get('section1', 'Tall', { timeout: 2_000 });
      await first.scrollIntoView({ direction: 'up', timeout: 120_000 });
      expect(await first.isVisible()).toBe(true);
    });
  });

  test.describe('alerts', () => {
    test.beforeEach(async () => {
      await openScreen('cardAlerts', 'alerts', { name: 'info', page: 'Alerts' });
    });

    test('tapAt on a button opens its dialog; OK closes it and the status label changes', async () => {
      const status = await get('status', 'Alerts');
      expect(await status.textContent()).toBe('Status: none');
      const info = await get('info', 'Alerts');
      const box = (await info.boundingBox())!;
      expect(await info.tapAt({ x: Math.floor(box.width / 2), y: Math.floor(box.height / 2) })).toBe(info);

      // An in-app dialog; while it is up the status label is not in the tree.
      const title = await get('dialogTitle', 'Alerts');
      await title.waitFor({ state: 'visible', timeout: 10_000 });
      expect(await title.textContent()).toBe('Info');
      expect(await (await get('dialogMessage', 'Alerts')).textContent()).toBe('Here is some information.');
      await expectAppInForeground();

      const ok = await get('dialogOk', 'Alerts');
      expect(await ok.textContent()).toBe('OK');
      await ok.click();
      await (await get('dialogTitle', 'Alerts', { timeout: 2_000 })).waitFor({ state: 'hidden', timeout: 10_000 });

      await expect.poll(async () => (await get('status', 'Alerts', { timeout: 2_000 })).textContent().catch(() => null), {
        timeout: 15_000,
      }).toBe('Status: Info dismissed');
      await expectAppInForeground();
    });
  });

  test.describe('gallery', () => {
    test.beforeEach(async () => {
      await openScreen('cardMedia', 'gallery', { name: 'grid', page: 'Gallery' });
    });

    test('pinch and zoom on the gallery return the element and keep the app in the foreground', async () => {
      // Two-finger gestures on the image grid; no single tap reaches an image.
      const grid = await get('grid', 'Gallery');
      expect(await grid.pinch()).toBe(grid);
      await expectAppInForeground();
      expect(await grid.zoom()).toBe(grid);
      await expectAppInForeground();
      expect(await (await get('item1', 'Gallery')).isVisible()).toBe(true);
    });
  });
});
