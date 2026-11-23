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
      } else if (method === 'POST' && /\/element\/[^/]+\/elements$/.test(url) && url.startsWith(s)) {
        value = [{ [W3C_ELEMENT_KEY]: ELEMENT }];
      } else if (method === 'POST' && url === `${s}/element`) {
        value = { [W3C_ELEMENT_KEY]: ELEMENT };
      } else if (method === 'POST' && url === `${s}/elements`) {
        // The selector value `many` matches three elements; anything else one.
        value = (body?.value === MANY ? MANY_IDS : [ELEMENT]).map(id => ({ [W3C_ELEMENT_KEY]: id }));
      } else if (method === 'GET' && url === `${s}/element/${ELEMENT}/rect`) {
        value = RECT;
      } else if (method === 'GET' && MANY_IDS.some(id => url === `${s}/element/${id}/rect`)) {
        value = { ...RECT, y: RECT.y + 100 * MANY_IDS.findIndex(id => url.includes(`/${id}/`)) };
      } else if (method === 'GET' && url === `${s}/window/rect`) {
        value = WINDOW;
      } else if (method === 'GET' && url === `${s}/element/${ELEMENT}/css/color`) {
        value = 'rgb(1, 2, 3)';
      } else if (method === 'GET' && url === `${s}/element/${ELEMENT}/screenshot`) {
        value = Buffer.from('png-bytes').toString('base64');
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
    expect(calls.slice(0, 3)).toEqual([`GET /element/${ELEMENT}/rect`, 'GET /window/rect', 'POST /actions']);
    const perform = server.requests.find(r => r.method === 'POST' && r.path.endsWith('/actions'))!;
    expect(perform.body.actions).toHaveLength(1);
    const [source] = perform.body.actions;
    expect(source.type).toBe('pointer');
    expect(source.parameters).toEqual({ pointerType: 'touch' });
    const moves = source.actions.filter((a: any) => a.type === 'pointerMove');
    expect(moves.map((m: any) => [m.x, m.y])).toEqual([[125, 220], [125, 120]]);
    expect(source.actions.map((a: any) => a.type)).toEqual(['pointerMove', 'pointerDown', 'pointerMove', 'pointerUp']);
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
      .rejects.toThrow(/^longPress: element "~missing" not found within 300 ms$/);
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
