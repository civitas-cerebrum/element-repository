import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as http from 'http';
import * as path from 'path';
import * as ts from 'typescript';
import type { AddressInfo } from 'net';
import { PlatformElement } from '../src/types';
import { ElementRepository } from '../src';

// Drives PlatformElement through a REAL WebdriverIO 10 `remote()` session
// against a tiny local fake WebDriver server, and asserts the HTTP requests
// that reach the wire. This proves every WebdriverIO call the element makes
// exists in WebdriverIO 10 with the used signature: a missing command throws
// "is not a function", a wrong argument shape sends the wrong request.

const W3C_ELEMENT_KEY = 'element-6066-11e4-a52e-4f735466cecf';
// WebdriverIO remembers ended sessions by id, so every server uses its own.
let sessionCounter = 0;
const ELEMENT = 'el-1';
const RECT = { x: 100, y: 200, width: 50, height: 40 };
const WINDOW = { x: 0, y: 0, width: 400, height: 800 };
/** A selector value the fake server answers with several matches. */
const MANY = 'many';
const MANY_IDS = [ELEMENT, 'el-2', 'el-3'];
/** A selector value the fake server finds nothing for. */
const MISSING = 'missing';
/** An attribute name the fake server answers as XCUITest does for a name it does not know. */
const UNKNOWN_ATTRIBUTE = 'data-never-reported';
/** Elements the fake server returns for an element-scoped XPath find, with their text. */
const DESCENDANT_TEXTS: Record<string, string> = { 'txt-1': 'Item 1', 'txt-2': 'Alpha' };

interface Recorded { method: string; path: string; body: any }

interface FakeServer { port: number; session: string; requests: Recorded[]; close(): Promise<void> }

/** A minimal W3C WebDriver endpoint set: session, find, rect, window, actions, css, screenshot. */
async function startFakeServer(): Promise<FakeServer> {
  const requests: Recorded[] = [];
  const session = `fake-session-${process.pid}-${++sessionCounter}`;
  const server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', chunk => { raw += chunk; });
    req.on('end', () => {
      const body = raw ? JSON.parse(raw) : undefined;
      const method = req.method ?? 'GET';
      const url = (req.url ?? '/').replace(/\?.*$/, '');
      requests.push({ method, path: url, body });
      const s = `/session/${session}`;
      let value: unknown = null;
      let status = 200;
      if (method === 'POST' && url === '/session') {
        value = { sessionId: session, capabilities: { platformName: 'iOS', 'appium:automationName': 'XCUITest' } };
      } else if (method === 'POST' && url === `${s}/element` && body?.value === MISSING) {
        status = 404;
        value = { error: 'no such element', message: 'fake server: no such element', stacktrace: '' };
      } else if (method === 'POST' && url === `${s}/elements` && body?.value === MISSING) {
        value = [];
      } else if (method === 'POST' && /\/element\/[^/]+\/element$/.test(url) && url.startsWith(s)) {
        // Element-scoped find: a child of any element.
        value = { [W3C_ELEMENT_KEY]: ELEMENT };
      } else if (method === 'POST' && /\/element\/[^/]+\/elements$/.test(url) && url.startsWith(s) && body?.using === 'xpath') {
        // An element-scoped XPath find: the text-bearing descendants.
        value = Object.keys(DESCENDANT_TEXTS).map(id => ({ [W3C_ELEMENT_KEY]: id }));
      } else if (method === 'POST' && /\/element\/[^/]+\/elements$/.test(url) && url.startsWith(s)) {
        value = [{ [W3C_ELEMENT_KEY]: ELEMENT }];
      } else if (method === 'GET' && url === `${s}/element/${ELEMENT}/text`) {
        value = ''; // a container: no text of its own
      } else if (method === 'GET' && Object.keys(DESCENDANT_TEXTS).some(id => url === `${s}/element/${id}/text`)) {
        value = DESCENDANT_TEXTS[url.split('/')[4]];
      } else if (method === 'POST' && url === `${s}/element`) {
        value = { [W3C_ELEMENT_KEY]: ELEMENT };
      } else if (method === 'POST' && url === `${s}/elements`) {
        // The selector value `many` matches three elements; anything else one.
        value = (body?.value === MANY ? MANY_IDS : [ELEMENT]).map(id => ({ [W3C_ELEMENT_KEY]: id }));
      } else if (method === 'GET' && url === `${s}/element/${ELEMENT}/rect`) {
        value = RECT;
      } else if (method === 'GET' && MANY_IDS.some(id => url === `${s}/element/${id}/rect`)) {
        value = { ...RECT, y: RECT.y + 100 * MANY_IDS.findIndex(id => url.includes(`/${id}/`)) };
      } else if (method === 'GET' && url === `${s}/element/${ELEMENT}/displayed`) {
        value = false; // never on screen: scrollIntoView keeps swiping
      } else if (method === 'GET' && url === `${s}/element/${ELEMENT}/attribute/${UNKNOWN_ATTRIBUTE}`) {
        // WebDriverAgent's answer for an attribute name XCUITest does not know.
        status = 500;
        value = {
          error: 'unknown error',
          message: `The attribute '${UNKNOWN_ATTRIBUTE}' is unknown. Valid attribute names are: (\n    UID,\n    label,\n    name,\n    value\n)`,
          traceback: '',
        };
      } else if (method === 'GET' && url === `${s}/element/${ELEMENT}/attribute/label`) {
        value = 'Wi-Fi';
      } else if (method === 'GET' && url === `${s}/window/rect`) {
        value = WINDOW;
      } else if (method === 'GET' && url === `${s}/element/${ELEMENT}/css/color`) {
        value = 'rgb(1, 2, 3)';
      } else if (method === 'GET' && url === `${s}/element/${ELEMENT}/screenshot`) {
        value = Buffer.from('png-bytes').toString('base64');
      } else if (method === 'POST' && url === `${s}/execute/sync` && body?.script === 'mobile: doubleTap') {
        value = null;
      } else if ((method === 'POST' || method === 'DELETE') && url === `${s}/actions`) {
        value = null;
      } else if (method === 'DELETE' && url === s) {
        value = null;
      } else {
        status = 404;
        value = { error: 'unknown command', message: `fake server: ${method} ${url}`, stacktrace: '' };
      }
      res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ value }));
    });
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    port,
    session,
    requests,
    close: () => new Promise<void>(resolve => server.close(() => resolve())),
  };
}

// `webdriverio` is ESM; a real dynamic import (not rewritten to require by
// the test transpiler) loads its Node entry point.
const importEsm = new Function('m', 'return import(m)') as (m: string) => Promise<any>;

test.describe('PlatformElement against a real WebdriverIO 10 session (fake WebDriver server)', () => {
  let server: FakeServer;
  let driver: any;

  test.beforeEach(async () => {
    server = await startFakeServer();
    const { remote } = await importEsm('webdriverio');
    driver = await remote({
      protocol: 'http',
      hostname: '127.0.0.1',
      port: server.port,
      path: '/',
      logLevel: 'silent',
      connectionRetryCount: 0,
      capabilities: { platformName: 'iOS', 'appium:automationName': 'XCUITest' } as any,
    });
    server.requests.length = 0; // keep only the element's own traffic
  });

  test.afterEach(async () => {
    await driver?.deleteSession().catch(() => {});
    await server?.close();
  });

  /**
   * Requests after session creation, without the element lookups and
   * WebdriverIO's own tag-name probe on found elements.
   */
  const wire = () => server.requests
    .filter(r => !/\/elements?$/.test(r.path) && !/\/element\/[^/]+\/name$/.test(r.path))
    .map(r => `${r.method} ${r.path.replace(`/session/${server.session}`, '')}`);

  test('installed webdriverio is major 10', async () => {
    const entry = require.resolve('webdriverio');
    const pkg = JSON.parse(fs.readFileSync(path.join(path.dirname(entry), '..', 'package.json'), 'utf8'));
    expect(pkg.version).toMatch(/^10\./);
  });

  test('boundingBox sends GET /element/:id/rect', async () => {
    const box = await new PlatformElement(driver, '~x').boundingBox();
    expect(box).toEqual(RECT);
    expect(wire()).toEqual([`GET /element/${ELEMENT}/rect`]);
    expect(server.requests.some(r => r.method === 'POST' && /\/elements?$/.test(r.path) && r.body?.using === 'accessibility id' && r.body?.value === 'x')).toBe(true);
  });

  test('longPress sends rect, window rect, POST /actions with a touch pointer, then DELETE /actions', async () => {
    await new PlatformElement(driver, '~x').longPress({ duration: 700 });
    expect(wire()).toEqual([
      `GET /element/${ELEMENT}/rect`,
      'GET /window/rect',
      'POST /actions',
      'DELETE /actions',
    ]);
    const perform = server.requests.find(r => r.method === 'POST' && r.path.endsWith('/actions'))!;
    expect(perform.body.actions).toEqual([{
      type: 'pointer',
      id: 'finger1',
      parameters: { pointerType: 'touch' },
      actions: [
        { type: 'pointerMove', duration: 0, origin: 'viewport', x: 125, y: 220 },
        { type: 'pointerDown', button: 0 },
        { type: 'pause', duration: 700 },
        { type: 'pointerUp', button: 0 },
      ],
    }]);
  });

  test('pinch sends one POST /actions with two touch pointers, then DELETE /actions', async () => {
    await new PlatformElement(driver, '~x').pinch();
    expect(wire()).toEqual([
      `GET /element/${ELEMENT}/rect`,
      'GET /window/rect',
      'POST /actions',
      'DELETE /actions',
    ]);
    const perform = server.requests.find(r => r.method === 'POST' && r.path.endsWith('/actions'))!;
    expect(perform.body.actions.map((a: any) => [a.type, a.id, a.parameters.pointerType])).toEqual([
      ['pointer', 'finger1', 'touch'],
      ['pointer', 'finger2', 'touch'],
    ]);
  });

  test('swipe sends rect, window rect and a touch POST /actions from the element centre', async () => {
    await new PlatformElement(driver, '~x').swipe('up', { distance: 100 });
    const calls = wire();
    expect(calls).toEqual([`GET /element/${ELEMENT}/rect`, 'GET /window/rect', 'POST /actions', 'DELETE /actions']);
    const perform = server.requests.find(r => r.method === 'POST' && r.path.endsWith('/actions'))!;
    // The exact body: one touch finger, an instant move to the start, a
    // 100 ms hold after the press, a 600 ms move to the end, release.
    expect(perform.body).toEqual({
      actions: [{
        type: 'pointer',
        id: 'finger1',
        parameters: { pointerType: 'touch' },
        actions: [
          { type: 'pointerMove', duration: 0, origin: 'viewport', x: 125, y: 220 },
          { type: 'pointerDown', button: 0 },
          { type: 'pause', duration: 100 },
          { type: 'pointerMove', duration: 600, origin: 'viewport', x: 125, y: 120 },
          { type: 'pointerUp', button: 0 },
        ],
      }],
    });
  });

  /** The start and end points of every swipe sent, in order. */
  const swipePoints = () => server.requests
    .filter(r => r.method === 'POST' && r.path.endsWith('/actions'))
    .map(r => { const a = r.body.actions[0].actions; return [a[0].x, a[0].y, a[3].x, a[3].y]; });

  test('scrollIntoView with the target in the tree swipes along the target\'s own column', async () => {
    await expect(new PlatformElement(driver, '~x').scrollIntoView({ direction: 'down', maxSwipes: 2 })).rejects.toThrow(/after 2 swipes/);
    // Target rect x 100-150: centre x 125; window 400x800: from y 600 (75%) to y 200 (25%).
    expect(swipePoints()).toEqual([[125, 600, 125, 200], [125, 600, 125, 200]]);
    expect(wire().filter(r => r.endsWith('/rect'))).toEqual([
      'GET /window/rect', `GET /element/${ELEMENT}/rect`, `GET /element/${ELEMENT}/rect`,
    ]);
  });

  test('scrollIntoView with a container swipes inside the container\'s rect', async () => {
    await expect(new PlatformElement(driver, `~${MISSING}`).scrollIntoView({
      direction: 'right', maxSwipes: 1, container: new PlatformElement(driver, '~x'),
    })).rejects.toThrow(/after 1 swipes/);
    // Container x 100-150, y 200-240: centre y 220, from x 142.5 (85%) to x 107.5 (15%).
    expect(swipePoints()).toEqual([[143, 220, 108, 220]]);
  });

  test('scrollIntoView without a container swipes with the default touch body, from 75% to 25% of the window', async () => {
    // A target that is not in the tree: the window's centre line.
    await expect(new PlatformElement(driver, `~${MISSING}`).scrollIntoView({ direction: 'down' })).rejects.toThrow(/not visible after 20 swipes/);
    const performs = server.requests.filter(r => r.method === 'POST' && r.path.endsWith('/actions'));
    const releases = server.requests.filter(r => r.method === 'DELETE' && r.path.endsWith('/actions'));
    expect(performs).toHaveLength(20);
    expect(releases).toHaveLength(20);
    // Window 400x800: centre x 200, from y 600 (75%) to y 200 (25%); a
    // 100 ms hold and a 600 ms move, no hold before the finger lifts.
    for (const p of performs) {
      expect(p.body).toEqual({
        actions: [{
          type: 'pointer',
          id: 'finger1',
          parameters: { pointerType: 'touch' },
          actions: [
            { type: 'pointerMove', duration: 0, origin: 'viewport', x: 200, y: 600 },
            { type: 'pointerDown', button: 0 },
            { type: 'pause', duration: 100 },
            { type: 'pointerMove', duration: 600, origin: 'viewport', x: 200, y: 200 },
            { type: 'pointerUp', button: 0 },
          ],
        }],
      });
    }
    // Every swipe is released before the next one is sent.
    const actionCalls = server.requests.filter(r => r.path.endsWith('/actions')).map(r => r.method);
    expect(actionCalls).toEqual(Array.from({ length: 20 }, () => ['POST', 'DELETE']).flat());
  });

  test('getAttribute of a name XCUITest does not know (HTTP 500 "The attribute ... is unknown") reads null', async () => {
    const el = new PlatformElement(driver, '~x');
    expect(await el.getAttribute(UNKNOWN_ATTRIBUTE)).toBeNull();
    expect(await el.getAttribute('label')).toBe('Wi-Fi');
    // One request each: the driver's answer is mapped, not retried.
    expect(wire().filter(r => r.includes('/attribute/'))).toEqual([
      `GET /element/${ELEMENT}/attribute/${UNKNOWN_ATTRIBUTE}`,
      `GET /element/${ELEMENT}/attribute/label`,
    ]);
  });

  test('doubleClick on iOS sends one `mobile: doubleTap` with the element id and no pointer actions', async () => {
    await new PlatformElement(driver, '~x').doubleClick();
    expect(wire()).toEqual([`POST /execute/sync`]);
    const call = server.requests.find(r => r.path.endsWith('/execute/sync'))!;
    expect(call.body).toEqual({ script: 'mobile: doubleTap', args: [{ elementId: ELEMENT }] });
  });

  test('getCssProperty sends GET /element/:id/css/:property', async () => {
    expect(await new PlatformElement(driver, '~x').getCssProperty('color')).toBe('rgb(1, 2, 3)');
    expect(wire()).toEqual([`GET /element/${ELEMENT}/css/color`]);
  });

  test('screenshot sends GET /element/:id/screenshot', async () => {
    const buf = await new PlatformElement(driver, '~x').screenshot();
    expect(buf.toString()).toBe('png-bytes');
    expect(wire()).toEqual([`GET /element/${ELEMENT}/screenshot`]);
  });

  test('android container text: the descendant XPath is sent as a find-elements from the element', async () => {
    const el = new PlatformElement(driver, '~row', undefined, 1000, { platform: 'android' });
    expect(await el.textContent()).toBe('Item 1 Alpha');
    const scoped = server.requests.filter(r => r.method === 'POST' && /\/element\/[^/]+\/elements$/.test(r.path));
    expect(scoped.map(r => [r.path.replace(`/session/${server.session}`, ''), r.body])).toEqual([
      [`/element/${ELEMENT}/elements`, { using: 'xpath', value: ".//*[@text!='' and not(@showing-hint='true')]" }],
    ]);
    expect(wire()).toEqual([
      `GET /element/${ELEMENT}/text`,
      'GET /element/txt-1/text',
      'GET /element/txt-2/text',
    ]);
  });

  test('$$ and elementId: all() wraps every match', async () => {
    const all = await new PlatformElement(driver, '~x').all();
    expect(all).toHaveLength(1);
    expect(await all[0].boundingBox()).toEqual(RECT);
    expect(server.requests.some(r => r.method === 'POST' && r.path.endsWith('/elements'))).toBe(true);
  });
});

test.describe('multi-match selectors on WebdriverIO 10 (strict `$` by default)', () => {
  let server: FakeServer;
  let driver: any;

  test.beforeEach(async () => {
    server = await startFakeServer();
    const { remote } = await importEsm('webdriverio');
    driver = await remote({
      protocol: 'http',
      hostname: '127.0.0.1',
      port: server.port,
      path: '/',
      logLevel: 'silent',
      connectionRetryCount: 0,
      capabilities: { platformName: 'iOS', 'appium:automationName': 'XCUITest' } as any,
    });
  });

  test.afterEach(async () => {
    await driver?.deleteSession().catch(() => {});
    await server?.close();
  });

  test('the fake server really triggers strict mode: a bare driver.$ throws', async () => {
    await expect(driver.$(`~${MANY}`)).rejects.toThrow(/strict/i);
  });

  test('an element on a multi-match selector acts on the first match', async () => {
    expect(await new PlatformElement(driver, `~${MANY}`).boundingBox()).toEqual(RECT);
  });

  test('first() on a multi-match selector acts on the first match', async () => {
    await new PlatformElement(driver, `~${MANY}`).first().longPress({ duration: 100 });
    const perform = server.requests.find(r => r.method === 'POST' && r.path.endsWith('/actions'))!;
    expect(perform.body.actions[0].actions[0]).toMatchObject({ x: 125, y: 220 });
  });

  test('nth(1) on a multi-match selector acts on the second match', async () => {
    expect(await new PlatformElement(driver, `~${MANY}`).nth(1).boundingBox()).toEqual({ ...RECT, y: RECT.y + 100 });
  });

  test('locateChild under nth(1) sends an element-scoped find on the second match', async () => {
    const child = new PlatformElement(driver, `~${MANY}`, undefined, 2000).nth(1).locateChild('~label');
    expect(await child.boundingBox()).toEqual(RECT);
    const scoped = server.requests.filter(r => r.method === 'POST' && /\/element\/[^/]+\/elements?$/.test(r.path));
    expect(scoped.map(r => [r.path.replace(`/session/${server.session}`, ''), r.body?.value])).toEqual([
      ['/element/el-2/elements', 'label'],
    ]);
  });

  test('a gesture on a missing element fails with "not found within N ms", not a malformed elementId', async () => {
    await expect(new PlatformElement(driver, `~${MISSING}`).longPress({ timeout: 300 }))
      .rejects.toThrow(/^longPress: "~missing" not found within 300 ms$/);
    expect(server.requests.some(r => /\/rect$/.test(r.path) && !r.path.endsWith('/window/rect'))).toBe(false);
    expect(server.requests.some(r => r.path.endsWith('/actions'))).toBe(false);
  });

  test('repository default resolution of a multi-match element, then an action', async () => {
    const repo = new ElementRepository(driver, {
      pages: [{ name: 'ListPage', platform: 'ios', elements: [{ elementName: 'row', selector: { 'accessibility id': MANY } }] }],
    }, { platform: 'ios', timeout: 2000 });
    const row = await repo.get('row', 'ListPage');
    expect(await row.boundingBox()).toEqual(RECT);
    await row.tapAt({ x: 1, y: 1 });
    const perform = server.requests.find(r => r.method === 'POST' && r.path.endsWith('/actions'))!;
    expect(perform.body.actions[0].actions[0]).toMatchObject({ x: 101, y: 201 });
  });
});

test.describe('a child of a missing unindexed parent (WebdriverIO 10)', () => {
  // WebdriverIO's implicit wait on `$` / `$$` of a missing lazy element is
  // `waitforTimeout`; set it well above the element timeouts so any call on
  // the missing parent shows up as a slow test.
  const WAITFOR_TIMEOUT = 3000;
  let server: FakeServer;
  let driver: any;

  test.beforeEach(async () => {
    server = await startFakeServer();
    const { remote } = await importEsm('webdriverio');
    driver = await remote({
      protocol: 'http',
      hostname: '127.0.0.1',
      port: server.port,
      path: '/',
      logLevel: 'silent',
      connectionRetryCount: 0,
      waitforTimeout: WAITFOR_TIMEOUT,
      capabilities: { platformName: 'iOS', 'appium:automationName': 'XCUITest' } as any,
    });
    server.requests.length = 0;
  });

  test.afterEach(async () => {
    await driver?.deleteSession().catch(() => {});
    await server?.close();
  });

  const child = (timeout = 500) => new PlatformElement(driver, `~${MISSING}`, undefined, timeout).locateChild('~label');
  const scopedFinds = () => server.requests.filter(r => /\/element\/[^/]+\/elements?$/.test(r.path));

  test('count() is 0 at once', async () => {
    const start = Date.now();
    expect(await child().count()).toBe(0);
    expect(Date.now() - start).toBeLessThan(1000);
    expect(scopedFinds()).toEqual([]);
  });

  test('isVisible() is false at once', async () => {
    const start = Date.now();
    expect(await child().isVisible()).toBe(false);
    expect(Date.now() - start).toBeLessThan(1000);
  });

  test('exists() is false at once', async () => {
    const start = Date.now();
    expect(await child().exists()).toBe(false);
    expect(Date.now() - start).toBeLessThan(1000);
  });

  test('click() fails within its timeout with a plain not-found Error', async () => {
    const start = Date.now();
    const err = await child().click({ timeout: 500 }).then(() => null, e => e);
    const elapsed = Date.now() - start;
    expect(err).toBeInstanceOf(Error);
    expect(err.constructor).toBe(Error);
    expect(err.name).toBe('Error');
    expect(err.message).toMatch(/parent "~missing" not found/);
    expect(elapsed).toBeGreaterThanOrEqual(450);
    expect(elapsed).toBeLessThan(500 + 1000);
    expect(scopedFinds()).toEqual([]);
  });

  test('textContent() fails within the element timeout', async () => {
    const start = Date.now();
    await expect(child(500).textContent()).rejects.toThrow(/parent "~missing" not found/);
    expect(Date.now() - start).toBeLessThan(500 + 1000);
  });

  test('nth(1).textContent() fails within the element timeout', async () => {
    const start = Date.now();
    await expect(child(500).nth(1).textContent()).rejects.toThrow(/parent "~missing" not found/);
    expect(Date.now() - start).toBeLessThan(500 + 1000);
  });

  test('a gesture names the method and the element', async () => {
    const start = Date.now();
    await expect(child().longPress({ timeout: 500 }))
      .rejects.toThrow(/^longPress: "~label" inside "~missing" not found within 500 ms: parent "~missing" not found$/);
    expect(Date.now() - start).toBeLessThan(500 + 1000);
  });

  test('nth(1).scrollIntoView() takes about as long as with no parent (swipes only)', async () => {
    test.setTimeout(90_000);
    let start = Date.now();
    await expect(new PlatformElement(driver, `~${MISSING}`, undefined, 500).nth(1).scrollIntoView())
      .rejects.toThrow(/after 20 swipes/);
    const noParent = Date.now() - start;
    start = Date.now();
    await expect(child().nth(1).scrollIntoView()).rejects.toThrow(/after 20 swipes/);
    const withParent = Date.now() - start;
    test.info().annotations.push({ type: 'timing', description: `no parent ${noParent} ms, missing parent ${withParent} ms` });
    expect(withParent).toBeLessThan(noParent * 1.5 + 1000);
    expect(scopedFinds()).toEqual([]);
  });
});

test.describe('reads of a missing element name the method (WebdriverIO 10)', () => {
  const WAITFOR_TIMEOUT = 300;
  let server: FakeServer;
  let driver: any;

  test.beforeEach(async () => {
    server = await startFakeServer();
    const { remote } = await importEsm('webdriverio');
    driver = await remote({
      protocol: 'http',
      hostname: '127.0.0.1',
      port: server.port,
      path: '/',
      logLevel: 'silent',
      connectionRetryCount: 0,
      waitforTimeout: WAITFOR_TIMEOUT,
      capabilities: { platformName: 'iOS', 'appium:automationName': 'XCUITest' } as any,
    });
  });

  test.afterEach(async () => {
    await driver?.deleteSession().catch(() => {});
    await server?.close();
  });

  const notFound = (method: string, desc: string) => new RegExp(
    `^${method}: ${desc} not found within ${WAITFOR_TIMEOUT} ms: Can't call \\w+ on element with selector "~${MISSING}" because element wasn't found$`,
  );

  test('textContent()', async () => {
    await expect(new PlatformElement(driver, `~${MISSING}`).textContent()).rejects.toThrow(notFound('textContent', `"~${MISSING}"`));
  });

  test('rawText()', async () => {
    await expect(new PlatformElement(driver, `~${MISSING}`).rawText()).rejects.toThrow(notFound('rawText', `"~${MISSING}"`));
  });

  test('getAttribute()', async () => {
    await expect(new PlatformElement(driver, `~${MISSING}`).getAttribute('label')).rejects.toThrow(notFound('getAttribute', `"~${MISSING}"`));
  });

  test('isChecked() and isEnabled()', async () => {
    await expect(new PlatformElement(driver, `~${MISSING}`).isChecked()).rejects.toThrow(notFound('isChecked', `"~${MISSING}"`));
    await expect(new PlatformElement(driver, `~${MISSING}`).isEnabled()).rejects.toThrow(notFound('isEnabled', `"~${MISSING}"`));
  });

  test('the original WebdriverIO error is the cause', async () => {
    const err = await new PlatformElement(driver, `~${MISSING}`).textContent().then(() => null, e => e);
    expect(err.cause).toBeInstanceOf(Error);
    expect(err.cause.message).toMatch(/because element wasn't found$/);
  });

  test('a polled read names the method too', async () => {
    const child = new PlatformElement(driver, `~${MISSING}`, undefined, 500).locateChild('~label');
    await expect(child.textContent())
      .rejects.toThrow(/^textContent: "~label" inside "~missing" not found within 500 ms: parent "~missing" not found$/);
  });
});

test.describe('webdriverio stays an optional peer', () => {
  test('no source file imports webdriverio or names the WebdriverIO namespace', () => {
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (entry.name.endsWith('.ts')) files.push(full);
      }
    };
    walk(path.resolve(__dirname, '..', 'src'));
    expect(files.length).toBeGreaterThan(0);
    // A runtime import would break consumers without webdriverio; a type
    // reference in a public signature would break their `skipLibCheck: false`
    // builds (the global WebdriverIO namespace comes from webdriverio's types).
    const offenders = files.filter(f => {
      const code = fs.readFileSync(f, 'utf8');
      return /(from\s+['"]webdriverio['"]|require\(\s*['"]webdriverio['"]\s*\)|import\(\s*['"]webdriverio['"]\s*\)|\bWebdriverIO\.)/.test(code);
    });
    expect(offenders).toEqual([]);
  });
});

test.describe('WebdriverIO 10 types', () => {
  test('every driver and element call the source makes type-checks against webdriverio 10', () => {
    test.setTimeout(120_000);
    const configPath = path.resolve(__dirname, '..', 'tsconfig.json');
    const config = ts.readConfigFile(configPath, ts.sys.readFile);
    const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, path.dirname(configPath));
    const program = ts.createProgram([path.resolve(__dirname, 'platform-wdio10-api.check.ts')], {
      ...parsed.options,
      noEmit: true,
      rootDir: undefined,
      outDir: undefined,
      declaration: false,
    });
    const text = ts.formatDiagnostics(ts.getPreEmitDiagnostics(program), {
      getCanonicalFileName: (f) => f,
      getCurrentDirectory: () => process.cwd(),
      getNewLine: () => '\n',
    });
    expect(text).toBe('');
  });
});
