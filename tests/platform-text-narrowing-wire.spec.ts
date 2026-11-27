import { test, expect } from '@playwright/test';
import * as http from 'http';
import type { AddressInfo } from 'net';
import { ElementRepository, SelectionStrategy, PlatformElement } from '../src';

// The narrowed text queries over a REAL WebdriverIO 10 `remote()` session
// against a local fake WebDriver server: the composed selector strings reach
// the wire as the W3C find-elements body the server evaluates (strategy and
// value exactly as composed), and a server that rejects them is answered
// by a full pass.

const W3C_ELEMENT_KEY = 'element-6066-11e4-a52e-4f735466cecf';
let sessionCounter = 0;

interface Recorded { method: string; path: string; body: any }
interface FakeServer { port: number; session: string; requests: Recorded[]; close(): Promise<void> }

/** Elements of the fake app: two rows, the second is "Apple Pie". */
const ROWS: Record<string, string> = { 'row-1': 'Banana Split', 'row-2': 'Apple Pie' };

async function startFakeServer(platformName: 'iOS' | 'Android', options: { rejectNarrowed?: boolean } = {}): Promise<FakeServer> {
  const requests: Recorded[] = [];
  const session = `fake-narrowing-${process.pid}-${++sessionCounter}`;
  const isNarrowed = (body: any) =>
    typeof body?.value === 'string' && (body.value.includes('CONTAINS[cd]') || body.value.includes('contains(translate('));
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
      const ids = (list: string[]) => list.map(id => ({ [W3C_ELEMENT_KEY]: id }));
      const rowId = url.split('/')[4];
      if (method === 'POST' && url === '/session') {
        value = { sessionId: session, capabilities: { platformName } };
      } else if (method === 'POST' && url === `${s}/elements` && isNarrowed(body)) {
        if (options.rejectNarrowed) {
          status = 400;
          value = { error: 'invalid selector', message: 'fake server: cannot evaluate', stacktrace: '' };
        } else if (body.value.includes('NOT (')) {
          value = []; // iOS descendant query: no container rows
        } else {
          value = ids(['row-2']);
        }
      } else if (method === 'POST' && url === `${s}/elements`) {
        value = ids(Object.keys(ROWS));
      } else if (method === 'POST' && url === `${s}/element`) {
        value = { [W3C_ELEMENT_KEY]: 'row-1' };
      } else if (method === 'GET' && url === `${s}/element/${rowId}/name` && rowId in ROWS) {
        value = 'XCUIElementTypeCell';
      } else if (method === 'GET' && url === `${s}/element/${rowId}/attribute/label` && rowId in ROWS) {
        value = ROWS[rowId];
      } else if (method === 'GET' && url === `${s}/element/${rowId}/text` && rowId in ROWS) {
        value = ROWS[rowId];
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
  return { port, session, requests, close: () => new Promise<void>(resolve => server.close(() => resolve())) };
}

const importEsm = new Function('m', 'return import(m)') as (m: string) => Promise<any>;

async function session(server: FakeServer, platformName: string): Promise<any> {
  const { remote } = await importEsm('webdriverio');
  const driver = await remote({
    protocol: 'http', hostname: '127.0.0.1', port: server.port, path: '/',
    logLevel: 'silent', connectionRetryCount: 0,
    capabilities: { platformName } as any,
  });
  server.requests.length = 0;
  return driver;
}

const finds = (server: FakeServer) => server.requests
  .filter(r => r.method === 'POST' && /\/session\/[^/]+\/elements$/.test(r.path))
  .map(r => ({ using: r.body.using, value: r.body.value }));

function repo(driver: any, platform: 'ios' | 'android', selector: Record<string, string>): ElementRepository {
  return new ElementRepository(driver, {
    pages: [{ name: 'List', platform, elements: [{ elementName: 'rows', selector }] }],
  } as any, { platform, timeout: 1000 });
}

const OWN = 'label CONTAINS[cd] "apple" OR value CONTAINS[cd] "apple"';
const ANDROID_COND = "contains(translate(@text, 'APLE', 'aple'), 'apple')";

test.describe('narrowed text queries on the wire (WebdriverIO 10)', () => {
  let server: FakeServer | undefined;
  let driver: any;

  test.afterEach(async () => {
    await driver?.deleteSession().catch(() => {});
    await server?.close();
    server = undefined;
    driver = undefined;
  });

  test('ios: the own and descendant class chains, then the hit\'s type and label only', async () => {
    server = await startFakeServer('iOS');
    driver = await session(server, 'iOS');
    const el = await repo(driver, 'ios', { 'accessibility id': 'row' })
      .get('rows', 'List', { strategy: SelectionStrategy.TEXT, value: 'Apple Pie' }) as PlatformElement;
    expect(el.resolvedElement.elementId).toBe('row-2');
    expect(el.selector).toBe('~row');
    expect(finds(server)).toEqual([
      { using: '-ios class chain', value: `**/*[\`name == "row"\`][\`${OWN}\`]` },
      { using: '-ios class chain', value: `**/*[\`name == "row"\`][\`NOT (${OWN})\`][$type == "XCUIElementTypeStaticText" AND (${OWN})$]` },
    ]);
    expect(server.requests.some(r => r.path.endsWith('/element/row-2/attribute/label'))).toBe(true);
    expect(server.requests.some(r => r.path.includes('/element/row-1/'))).toBe(false);
  });

  test('ios: a predicate string base keeps its strategy for the own query', async () => {
    server = await startFakeServer('iOS');
    driver = await session(server, 'iOS');
    await repo(driver, 'ios', { predicate: 'type == "XCUIElementTypeCell"' })
      .get('rows', 'List', { strategy: SelectionStrategy.TEXT, value: 'Apple Pie' });
    expect(finds(server)).toEqual([
      { using: '-ios predicate string', value: `(type == "XCUIElementTypeCell") AND (${OWN})` },
      { using: '-ios class chain', value: `**/*[\`type == "XCUIElementTypeCell"\`][\`NOT (${OWN})\`][$type == "XCUIElementTypeStaticText" AND (${OWN})$]` },
    ]);
  });

  test('android: one XPath find, then the hit\'s text only', async () => {
    server = await startFakeServer('Android');
    driver = await session(server, 'Android');
    const el = await repo(driver, 'android', { 'accessibility id': 'row' })
      .get('rows', 'List', { strategy: SelectionStrategy.TEXT, value: 'Apple Pie' }) as PlatformElement;
    expect(el.resolvedElement.elementId).toBe('row-2');
    expect(finds(server)).toEqual([
      { using: 'xpath', value: `(//*[@content-desc='row'])[${ANDROID_COND} or .//*[not(@showing-hint='true') and ${ANDROID_COND}]]` },
    ]);
    expect(server.requests.filter(r => /\/element\/[^/]+\/text$/.test(r.path)).map(r => r.path.split('/')[4])).toEqual(['row-2']);
  });

  test('a server that rejects the narrowed query (HTTP 400 invalid selector): the full pass finds the row', async () => {
    server = await startFakeServer('Android', { rejectNarrowed: true });
    driver = await session(server, 'Android');
    const el = await repo(driver, 'android', { 'accessibility id': 'row' })
      .get('rows', 'List', { strategy: SelectionStrategy.TEXT, value: 'Apple Pie' }) as PlatformElement;
    expect(el.resolvedElement.elementId).toBe('row-2');
    expect(finds(server).map(f => f.using)).toEqual(['xpath', 'accessibility id']);
    expect(finds(server)[1].value).toBe('row');
  });

  test('getByText on ios sends the same narrowed queries', async () => {
    server = await startFakeServer('iOS');
    driver = await session(server, 'iOS');
    const el = await repo(driver, 'ios', { 'accessibility id': 'row' }).getByText('rows', 'List', 'Apple Pie', true) as PlatformElement;
    expect(el.resolvedElement.elementId).toBe('row-2');
    expect(finds(server).filter(f => f.using === '-ios class chain')).toHaveLength(2);
  });
});
