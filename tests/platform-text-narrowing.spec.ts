import { test, expect } from '@playwright/test';
import { ElementRepository } from '../src/repo/ElementRepository';
import { SelectionStrategy } from '../src/enum/Options';
import { PlatformElement } from '../src/types';
import { TextNotFoundError } from '../src/types/errors';
import { readPlatformText, ANDROID_DESCENDANT_TEXT_XPATH, IOS_DESCENDANT_TEXT_SELECTOR } from '../src/utils/platformText';
import {
  pickTextToken, narrowedTextQueries, selectorKind, xpathLiteral, normaliseText,
} from '../src/utils/textNarrowing';
import { isSessionLostError, isFatalDriverError } from '../src/utils/driverErrors';
import {
  answerNarrowed, decodeXPathLiteral, decodePredicateString, isNarrowedQuery, wasQueried, fold,
} from './support/narrowedQueries';

// ===========================================================================
// The word a narrowed lookup asks for
// ===========================================================================

test.describe('pickTextToken', () => {
  test('the longest word of the normalised needle; the first of equal ones', () => {
    expect(pickTextToken('Apple Pie', 'android')).toBe('apple');
    expect(pickTextToken('Pie Pot', 'ios')).toBe('pie');
    expect(pickTextToken('  Personal   Hotspot ', 'ios')).toBe('personal');
    expect(pickTextToken('Wi Fi', 'ios')).toBe('wi');
  });

  test('NBSP and newlines split words, as the rule\'s normaliser treats them as spaces', () => {
    expect(pickTextToken('Blue\u00a0Chinos\nXL', 'android')).toBe('chinos');
    expect(normaliseText('Blue\u00a0Chinos\nXL')).toBe('blue chinos xl');
  });

  test('a blank needle, or a platform other than android / ios: no word (not narrowed)', () => {
    expect(pickTextToken('   ', 'android')).toBeUndefined();
    expect(pickTextToken('', 'ios')).toBeUndefined();
    expect(pickTextToken('Apple', 'web')).toBeUndefined();
    expect(pickTextToken('Apple', 'macos')).toBeUndefined();
    expect(pickTextToken('Apple', undefined)).toBeUndefined();
  });

  test('ios: a word with a backtick or $ is skipped for the next safe one; none safe = not narrowed', () => {
    expect(pickTextToken('a`very`long pie', 'ios')).toBe('pie');
    expect(pickTextToken('$100000 off', 'ios')).toBe('off');
    expect(pickTextToken('`x` $y', 'ios')).toBeUndefined();
    // Android carries both in an XPath literal.
    expect(pickTextToken('a`very`long pie', 'android')).toBe('a`very`long');
    expect(pickTextToken('$100000 off', 'android')).toBe('$100000');
  });

  test('ios: emoji, combining marks and joiners are not narrowed on (NSPredicate matches whole character sequences)', () => {
    expect(pickTextToken('👍 Like', 'ios')).toBe('like');
    expect(pickTextToken('👍', 'ios')).toBeUndefined();
    expect(pickTextToken('cafe\u0301', 'ios')).toBeUndefined();
    expect(pickTextToken('👍', 'android')).toBe('👍');
  });

  test('android: a sigma, and the dot of İ (its lowercase is i + U+0307), are not narrowed on', () => {
    expect(pickTextToken('ΟΔΟΣ', 'android')).toBeUndefined();
    expect(pickTextToken('İstanbul', 'android')).toBeUndefined();
    expect(normaliseText('İstanbul')).toBe('i\u0307stanbul');
    expect(pickTextToken('İstanbul Airport', 'android')).toBe('airport');
    expect(pickTextToken('ΟΔΟΣ', 'ios')).toBe('οδος');
  });

  test('quotes, backslashes, % and ] are carried on both platforms; ß stays ß', () => {
    for (const p of ['android', 'ios'] as const) {
      expect(pickTextToken('say "hello"', p)).toBe('"hello"');
      expect(pickTextToken("it's", p)).toBe("it's");
      expect(pickTextToken('C:\\dir', p)).toBe('c:\\dir');
      expect(pickTextToken('100%', p)).toBe('100%');
      expect(pickTextToken('a]b', p)).toBe('a]b');
      expect(pickTextToken('Straße', p)).toBe('straße');
    }
  });
});

// ===========================================================================
// Selector kinds and the composed queries
// ===========================================================================

test.describe('selectorKind mirrors WebdriverIO 10', () => {
  const cases: Array<[string, ReturnType<typeof selectorKind>]> = [
    ['//android.widget.TextView', { using: 'xpath', value: '//android.widget.TextView' }],
    ['(//a)[2]', { using: 'xpath', value: '(//a)[2]' }],
    ['xpath://a', { using: 'xpath', value: '//a' }],
    ['id=com.example:id/title', { using: 'id', value: 'com.example:id/title' }],
    ['id:title', { using: 'id', value: 'title' }],
    ['~row', { using: 'accessibility id', value: 'row' }],
    ['accessibility id:row', { using: 'accessibility id', value: 'row' }],
    ['android.widget.TextView', { using: 'class name', value: 'android.widget.TextView' }],
    ['XCUIElementTypeCell', { using: 'class name', value: 'XCUIElementTypeCell' }],
    ['class name:android.widget.Button', { using: 'class name', value: 'android.widget.Button' }],
    ['-ios class chain:**/XCUIElementTypeCell', { using: '-ios class chain', value: '**/XCUIElementTypeCell' }],
    ['-ios predicate string:name == "x"', { using: '-ios predicate string', value: 'name == "x"' }],
    ['android=new UiSelector().text("x")', null],
    ['-android uiautomator:new UiSelector()', null],
    ['-android datamatcher:{}', null],
    ['button.png', null],
    ['=Link', null],
    ['css selector:.a', null],
    ['tag name:x', null],
  ];
  for (const [selector, kind] of cases) {
    test(JSON.stringify(selector), () => { expect(selectorKind(selector)).toEqual(kind); });
  }
});

test.describe('xpathLiteral', () => {
  test('single quotes, double quotes, or concat() when the value holds both', () => {
    expect(xpathLiteral('plain')).toBe("'plain'");
    expect(xpathLiteral("it's")).toBe(`"it's"`);
    expect(xpathLiteral('say "hi"')).toBe(`'say "hi"'`);
    expect(xpathLiteral(`it's "x"`)).toBe(`concat('it', "'", 's "x"')`);
    expect(xpathLiteral(`'"`)).toBe(`concat("'", '"')`);
    expect(xpathLiteral(`"'`)).toBe(`concat('"', "'")`);
    for (const s of [`'`, `''`, `a'b"c'd`, `"'"`]) expect(decodeXPathLiteral(xpathLiteral(s))).toBe(s);
  });
});

const LC_APPLE = "translate(@text, 'APLE', 'aple')";
const COND_APPLE = `contains(${LC_APPLE}, 'apple')`;
const androidQuery = (base: string, cond = COND_APPLE) => `(${base})[${cond} or .//*[not(@showing-hint='true') and ${cond}]]`;

test.describe('narrowedTextQueries — android: one XPath per base kind', () => {
  const cases: Array<[string, string | null]> = [
    ['//android.widget.TextView', androidQuery('//android.widget.TextView')],
    ['xpath://a[@x]', androidQuery('//a[@x]')],
    // A base ending in an index keeps its meaning: the parentheses filter its matches.
    ['//android.widget.TextView[3]', androidQuery('//android.widget.TextView[3]')],
    ['(//a | //b)[last()]', androidQuery('(//a | //b)[last()]')],
    ['id=com.example:id/title', androidQuery("//*[@resource-id='com.example:id/title']")],
    ['id:com.example:id/title', androidQuery("//*[@resource-id='com.example:id/title']")],
    ['~row', androidQuery("//*[@content-desc='row']")],
    ["~it's", androidQuery(`//*[@content-desc="it's"]`)],
    ['accessibility id:row', androidQuery("//*[@content-desc='row']")],
    ['android.widget.TextView', androidQuery('//android.widget.TextView')],
    ['class name:android.widget.Button', androidQuery('//android.widget.Button')],
    // A short resource id needs the current app package; an inner class name has no XPath tag.
    ['id=title', null],
    ['class name:android.widget.Foo$Bar', null],
    ['android=new UiSelector().className("x")', null],
    ['-android viewtag:x', null],
  ];
  for (const [selector, query] of cases) {
    test(JSON.stringify(selector), () => {
      expect(narrowedTextQueries(selector, 'android', 'apple')).toEqual(query === null ? null : [query]);
    });
  }

  test('the translate() covers every character that lowercases to a character of the word', () => {
    // K: K and the Kelvin sign; i: I and İ (whose lowercase starts with i).
    expect(narrowedTextQueries('~r', 'android', 'kiwi')).toEqual([
      androidQuery("//*[@content-desc='r']", "contains(translate(@text, 'K\u212aI\u0130W', 'kkiiw'), 'kiwi')"),
    ]);
    // å: Å and the Angstrom sign; ǆ: Ǆ and its titlecase ǅ.
    expect(narrowedTextQueries('~r', 'android', 'åǆ')![0]).toContain("translate(@text, '\u00c5\u212b\u01c4\u01c5', 'ååǆǆ')");
  });

  test('a word without cased characters is compared as it is', () => {
    expect(narrowedTextQueries('~r', 'android', '100%')).toEqual([
      androidQuery("//*[@content-desc='r']", "contains(@text, '100%')"),
    ]);
  });

  test('escaping: the word is an XPath literal (concat() for both quotes)', () => {
    const word = `it's"x"`;
    const q = narrowedTextQueries('~r', 'android', word)![0];
    expect(q).toContain(`, concat('it', "'", 's"x"'))`);
  });
});

const OWN_APPLE = 'label CONTAINS[cd] "apple" OR value CONTAINS[cd] "apple"';
const DESC_APPLE = `[\`NOT (${OWN_APPLE})\`][$type == "XCUIElementTypeStaticText" AND (${OWN_APPLE})$]`;

test.describe('narrowedTextQueries — ios: two disjoint queries per base kind', () => {
  const cases: Array<[string, string[] | null]> = [
    ['-ios class chain:**/XCUIElementTypeCell', [
      `-ios class chain:**/XCUIElementTypeCell[\`${OWN_APPLE}\`]`,
      `-ios class chain:**/XCUIElementTypeCell${DESC_APPLE}`,
    ]],
    // Appended to the last segment, after the base's own predicate and index.
    ['-ios class chain:**/XCUIElementTypeTable/XCUIElementTypeCell[`visible == 1`][2]', [
      `-ios class chain:**/XCUIElementTypeTable/XCUIElementTypeCell[\`visible == 1\`][2][\`${OWN_APPLE}\`]`,
      `-ios class chain:**/XCUIElementTypeTable/XCUIElementTypeCell[\`visible == 1\`][2]${DESC_APPLE}`,
    ]],
    ['~row', [
      `-ios class chain:**/*[\`name == "row"\`][\`${OWN_APPLE}\`]`,
      `-ios class chain:**/*[\`name == "row"\`]${DESC_APPLE}`,
    ]],
    ['~say "hi"', [
      `-ios class chain:**/*[\`name == "say \\"hi\\""\`][\`${OWN_APPLE}\`]`,
      `-ios class chain:**/*[\`name == "say \\"hi\\""\`]${DESC_APPLE}`,
    ]],
    ['XCUIElementTypeCell', [
      `-ios class chain:**/XCUIElementTypeCell[\`${OWN_APPLE}\`]`,
      `-ios class chain:**/XCUIElementTypeCell${DESC_APPLE}`,
    ]],
    ['-ios predicate string:name == "row" OR name == "cell"', [
      `-ios predicate string:(name == "row" OR name == "cell") AND (${OWN_APPLE})`,
      `-ios class chain:**/*[\`name == "row" OR name == "cell"\`]${DESC_APPLE}`,
    ]],
    // A backtick or $ in the base would end the class chain predicate.
    ['-ios predicate string:name == "a`b"', null],
    ['-ios predicate string:name == "$x"', null],
    ['~a`b', null],
    // XPath on iOS is not narrowed.
    ['//XCUIElementTypeCell', null],
  ];
  for (const [selector, queries] of cases) {
    test(JSON.stringify(selector), () => {
      expect(narrowedTextQueries(selector, 'ios', 'apple')).toEqual(queries);
    });
  }

  test('escaping: \\ and " in the word are escaped for NSPredicate', () => {
    const [own] = narrowedTextQueries('~r', 'ios', 'c:\\"dir"')!;
    expect(own).toContain('label CONTAINS[cd] "c:\\\\\\"dir\\"" OR value CONTAINS[cd] "c:\\\\\\"dir\\""');
  });

  test('an unknown or web platform: null', () => {
    expect(narrowedTextQueries('~row', undefined, 'apple')).toBeNull();
    expect(narrowedTextQueries('~row', 'web', 'apple')).toBeNull();
  });
});

// ===========================================================================
// Escaping fixtures: every composed query decodes back to its word, and the
// server's answer holds every element the rule could choose.
// ===========================================================================

/** Needles with characters that need escaping or special case handling. */
const ESCAPING_NEEDLES = [
  'say "hi"', "it's", `it's "both"`, `it's"x"`, 'C:\\dir\\', '100%', 'a`b', '$5 off', 'a]b', 'Blue\u00a0Chinos',
  'line1\nline2', '👍 Like', 'KI', 'Straße', 'KELVIN',
];

/** Element texts each needle is checked against (case variants, the Kelvin sign, İ, ẞ). */
function textsFor(needle: string): string[] {
  return [
    needle, needle.toUpperCase(), `Prefix ${needle} suffix`, `${needle.toLowerCase()}!`,
    'unrelated', 'kelvin', '\u212aELVIN', 'STRASSE', 'STRAẞE', 'kİ', 'Kİ',
  ];
}

test.describe('escaping fixtures — android, evaluated by a real XPath 1.0 engine', () => {
  const xmlAttr = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;')
    .replace(/\n/g, '&#10;').replace(/\u00a0/g, '&#160;');

  for (const needle of ESCAPING_NEEDLES) {
    test(JSON.stringify(needle), async ({ page }) => {
      const token = pickTextToken(needle, 'android');
      expect(token).toBeDefined();
      const [query] = narrowedTextQueries('~row', 'android', token!)!;

      // One own-text row and one container row (text in a child) per text,
      // a hint field showing the text, and a row outside the base.
      const texts = textsFor(needle);
      const nodes: Array<{ uid: string; own: string; child?: string; hint?: boolean; inBase: boolean }> = [];
      texts.forEach((t, i) => {
        nodes.push({ uid: `own${i}`, own: t, inBase: true });
        nodes.push({ uid: `box${i}`, own: '', child: t, inBase: true });
        nodes.push({ uid: `hintbox${i}`, own: '', child: t, hint: true, inBase: true });
        nodes.push({ uid: `other${i}`, own: t, inBase: false });
      });
      const xml = '<hierarchy><android.widget.FrameLayout uid="root" text="">' + nodes.map(n =>
        `<android.widget.LinearLayout uid="${n.uid}" text="${xmlAttr(n.own)}" content-desc="${n.inBase ? 'row' : 'other'}">` +
        (n.child !== undefined ? `<android.widget.TextView uid="${n.uid}-c" text="${xmlAttr(n.child)}"${n.hint ? ' showing-hint="true"' : ''}/>` : '') +
        '</android.widget.LinearLayout>').join('') + '</android.widget.FrameLayout></hierarchy>';

      const found: string[] = await page.evaluate(([x, q]) => {
        const doc = new DOMParser().parseFromString(x, 'application/xml');
        if (doc.getElementsByTagName('parsererror').length) throw new Error('bad xml');
        const r = doc.evaluate(q, doc, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
        const out: string[] = [];
        for (let i = 0; i < r.snapshotLength; i++) out.push((r.snapshotItem(i) as Element).getAttribute('uid')!);
        return out;
      }, [xml, query] as const);

      // The rule's text of each base row: its own, else its (non-hint) child's.
      const ruleText = (n: typeof nodes[number]) => n.own.trim() !== '' ? n.own : (n.hint ? '' : n.child ?? '');
      const wanted = normaliseText(needle);
      const mustHit = nodes.filter(n => n.inBase && normaliseText(ruleText(n)).includes(wanted)).map(n => n.uid);
      expect(mustHit.length).toBeGreaterThan(0);
      for (const uid of mustHit) expect(found).toContain(uid);
      // Only base rows, in document order.
      const baseOrder = nodes.filter(n => n.inBase).map(n => n.uid);
      expect(found.every(uid => baseOrder.includes(uid))).toBe(true);
      expect([...found].sort((a, b) => baseOrder.indexOf(a) - baseOrder.indexOf(b))).toEqual(found);
      // The hint child is never a reason for a hit.
      for (const n of nodes.filter(n => n.hint)) {
        expect(found.includes(n.uid)).toBe(normaliseText(n.own).includes(token!));
      }
    });
  }
});

test.describe('escaping fixtures — ios, decoded as NSPredicate and evaluated as CONTAINS[cd]', () => {
  for (const needle of ESCAPING_NEEDLES) {
    test(JSON.stringify(needle), async () => {
      const token = pickTextToken(needle, 'ios');
      if (needle === 'a`b') { expect(token).toBeUndefined(); return; }
      expect(token).toBeDefined();
      const queries = narrowedTextQueries('~row', 'ios', token!)!;
      expect(queries).toHaveLength(2);
      for (const q of queries) {
        expect(isNarrowedQuery(q)).toBe(true);
        const literal = q.match(/label CONTAINS\[cd\] "((?:[^"\\]|\\.)*)"/)![1];
        expect(decodePredicateString(literal)).toBe(token);
      }

      const texts = textsFor(needle);
      const cells = texts.map((t, i) => iosRaw({ id: `cell${i}`, name: 'row', label: t }));
      const boxes = texts.map((t, i) => iosRaw({
        id: `box${i}`, name: 'row', label: null,
        children: [{ id: `box${i}-t`, type: 'XCUIElementTypeStaticText', label: t }],
      }));
      const all = [...cells, ...boxes];
      const own = answerNarrowed(queries[0], b => (b === '~row' ? all : undefined))!;
      const desc = answerNarrowed(queries[1], b => (b === '~row' ? all : undefined))!;
      // Disjoint, and together they hold every element the rule could choose.
      expect(own.filter(r => desc.includes(r))).toEqual([]);
      const wanted = normaliseText(needle);
      for (const raw of all) {
        const text = await readPlatformText(raw, 'ios');
        if (normaliseText(text ?? '').includes(wanted)) expect([...own, ...desc]).toContain(raw);
      }
    });
  }
});

// ===========================================================================
// Mock drivers that answer like the servers, with per-request latency
// ===========================================================================

interface MockNode {
  id: string;
  /** Android `text`. */
  text?: string;
  showingHint?: boolean;
  /** Android `content-desc` / iOS `name`. */
  name?: string;
  resourceId?: string;
  /** iOS element type (default `XCUIElementTypeCell`). */
  type?: string;
  label?: string | null;
  value?: string | null;
  children?: MockNode[];
}

/** A raw iOS element from a node (no request counting): for the fixtures above. */
function iosRaw(node: MockNode): any {
  return new MockServer('ios', [node]).raw(node);
}

/**
 * A mock Appium server over a tree of nodes. Every request (a find from the
 * driver or an element, an attribute / text / tag read) is logged and takes
 * `latencyMs`. A narrowed text query is answered as the server would (see
 * `support/narrowedQueries`); `failNarrowed` makes it fail instead. Base
 * selectors: `~<name>`, `id=<resource id>`, any other selector string
 * matches every top-level node (UiAutomator, XPath, class names).
 */
class MockServer {
  readonly log: string[] = [];
  private readonly raws = new Map<string, any>();
  failNarrowed?: Error;

  constructor(readonly platform: 'android' | 'ios', readonly roots: MockNode[], readonly latencyMs = 0) {}

  private async request(entry: string): Promise<void> {
    this.log.push(entry);
    if (this.latencyMs > 0) await new Promise(r => setTimeout(r, this.latencyMs));
  }

  /** Requests that were finds (driver-level). */
  finds(): string[] { return this.log.filter(e => e.startsWith('find ')).map(e => e.slice(5)); }

  private static all(nodes: MockNode[]): MockNode[] {
    return nodes.flatMap(n => [n, ...MockServer.all(n.children ?? [])]);
  }

  private baseMatches(selector: string): any[] | undefined {
    const nodes = MockServer.all(this.roots);
    if (selector.startsWith('~')) return nodes.filter(n => n.name === selector.slice(1)).map(n => this.raw(n));
    if (selector.startsWith('id=')) return nodes.filter(n => n.resourceId === selector.slice(3)).map(n => this.raw(n));
    return this.roots.map(n => this.raw(n));
  }

  raw(node: MockNode): any {
    const existing = this.raws.get(node.id);
    if (existing) return existing;
    const server = this;
    const descendants = () => MockServer.all(node.children ?? []);
    const raw = {
      elementId: node.id,
      get __fields() {
        return {
          text: node.text, showingHint: node.showingHint, type: node.type ?? 'XCUIElementTypeCell',
          label: node.label, value: node.value, children: (node.children ?? []).map(c => server.raw(c)),
        };
      },
      getText: async () => { await server.request(`${node.id}:text`); return server.platform === 'android' ? node.text ?? '' : node.value || node.label || ''; },
      getAttribute: async (name: string) => {
        await server.request(`${node.id}:${name}`);
        if (name === 'label') return node.label ?? null;
        if (name === 'value') return node.value ?? null;
        return null;
      },
      getTagName: async () => { await server.request(`${node.id}:tag`); return node.type ?? 'XCUIElementTypeCell'; },
      isDisplayed: async () => true,
      isExisting: async () => true,
      waitForExist: async () => true,
      $$: async (selector: string) => {
        await server.request(`${node.id}:$$`);
        if (selector === ANDROID_DESCENDANT_TEXT_XPATH) {
          return descendants().filter(d => (d.text ?? '') !== '' && !d.showingHint).map(d => server.raw(d));
        }
        if (selector === IOS_DESCENDANT_TEXT_SELECTOR) {
          return descendants().filter(d => d.type === 'XCUIElementTypeStaticText').map(d => server.raw(d));
        }
        throw new Error(`unexpected element-scoped selector ${selector}`);
      },
    };
    this.raws.set(node.id, raw);
    return raw;
  }

  driver(): any {
    return {
      capabilities: { platformName: this.platform === 'ios' ? 'iOS' : 'Android' },
      $: async (selector: string) => (this.baseMatches(selector) ?? [])[0],
      $$: async (selector: string) => {
        await this.request(`find ${selector}`);
        if (isNarrowedQuery(selector)) {
          if (this.failNarrowed) throw this.failNarrowed;
          return answerNarrowed(selector, b => this.baseMatches(b));
        }
        return this.baseMatches(selector) ?? [];
      },
    };
  }
}

function repoOver(server: MockServer, selector: Record<string, string>, timeout = 400): ElementRepository {
  return new ElementRepository(server.driver(), {
    pages: [{ name: 'List', platform: server.platform, elements: [{ elementName: 'rows', selector }] }],
  } as any, { platform: server.platform, timeout });
}

const byText = (repo: ElementRepository, value: string, timeout?: number) =>
  repo.get('rows', 'List', { strategy: SelectionStrategy.TEXT, value, ...(timeout === undefined ? {} : { timeout }) });

const FRUITS = [
  'Apple', 'Apricot', 'Banana', 'Blueberry', 'Cherry', 'Date', 'Elderberry', 'Fig',
  'Grape', 'Guava', 'Kiwi', 'Lemon', 'Lime', 'Mango', 'Melon', 'Nectarine',
];

// ===========================================================================
// The rule on the hits
// ===========================================================================

test.describe('narrowed TEXT keeps the rule', () => {
  test('android: exact beats contains across own and joined text (a container "Apple"+"Pie" beats "Apple Pie Deluxe")', async () => {
    const server = new MockServer('android', [
      { id: 'deluxe', name: 'row', text: 'Apple Pie Deluxe' },
      { id: 'box', name: 'row', text: '', children: [{ id: 'b1', text: 'Apple' }, { id: 'b2', text: 'Pie' }] },
    ]);
    const el = await byText(repoOver(server, { 'accessibility id': 'row' }), 'Apple Pie') as PlatformElement;
    expect(el.resolvedElement.elementId).toBe('box');
    expect(server.finds().every(isNarrowedQuery)).toBe(true);
  });

  test('ios: exact beats contains across label and joined StaticText (container in the descendant query wins, no full pass)', async () => {
    const server = new MockServer('ios', [
      { id: 'deluxe', name: 'row', label: 'Apple Pie Deluxe' },
      {
        id: 'box', name: 'row', label: null, value: null,
        children: [{ id: 'b1', type: 'XCUIElementTypeStaticText', label: 'Apple' }, { id: 'b2', type: 'XCUIElementTypeStaticText', label: 'Pie' }],
      },
    ]);
    const el = await byText(repoOver(server, { 'accessibility id': 'row' }), 'Apple Pie') as PlatformElement;
    expect(el.resolvedElement.elementId).toBe('box');
    expect(server.finds()).toHaveLength(2);
    expect(server.finds().every(isNarrowedQuery)).toBe(true);
  });

  test('ios: a text input matches by its value (the own query covers value and label)', async () => {
    const server = new MockServer('ios', [
      { id: 'other', name: 'row', label: 'Apple Pie Deluxe' },
      { id: 'field', name: 'row', type: 'XCUIElementTypeTextField', label: 'Search', value: 'Apple Pie' },
    ]);
    const el = await byText(repoOver(server, { 'accessibility id': 'row' }), 'apple pie') as PlatformElement;
    // No exact match ('apple pie' is lowercase): the first contains hit, in document order.
    expect(el.resolvedElement.elementId).toBe('other');
    const exact = await byText(repoOver(server, { 'accessibility id': 'row' }), 'Apple Pie') as PlatformElement;
    expect(exact.resolvedElement.elementId).toBe('field');
  });

  for (const platform of ['android', 'ios'] as const) {
    test(`${platform}: document order with duplicates — the first exact match`, async () => {
      const node = (id: string, t: string): MockNode => (platform === 'android' ? { id, name: 'row', text: t } : { id, name: 'row', label: t });
      const server = new MockServer(platform, [node('a1', 'Apple Pie Deluxe'), node('a2', 'Apple'), node('b', 'Banana'), node('a3', 'Apple')]);
      const el = await byText(repoOver(server, { 'accessibility id': 'row' }), 'Apple') as PlatformElement;
      expect(el.resolvedElement.elementId).toBe('a2');
      const contains = await byText(repoOver(server, { 'accessibility id': 'row' }), 'apple') as PlatformElement;
      expect(contains.resolvedElement.elementId).toBe('a1');
    });

    test(`${platform}: the returned element keeps the base selector; all() and count() re-query it`, async () => {
      const node = (id: string, t: string): MockNode => (platform === 'android' ? { id, name: 'row', text: t } : { id, name: 'row', label: t });
      const server = new MockServer(platform, [node('a', 'Apple'), node('b', 'Banana'), node('c', 'Cherry')]);
      const el = await byText(repoOver(server, { 'accessibility id': 'row' }), 'Banana') as PlatformElement;
      expect(el.selector).toBe('~row');
      expect(el.resolvedElement.elementId).toBe('b');
      expect(await el.count()).toBe(3);
      expect(await el.all()).toHaveLength(3);
    });
  }

  test('ios: winning hits from both queries (order unknown) → a full pass for that poll picks the first in document order', async () => {
    const box = (id: string): MockNode => ({
      id, name: 'row', label: null, children: [{ id: `${id}-t`, type: 'XCUIElementTypeStaticText', label: 'Apple' }],
    });
    const cell = (id: string): MockNode => ({ id, name: 'row', label: 'Apple' });

    const boxFirst = new MockServer('ios', [box('box'), cell('cell')]);
    const el1 = await byText(repoOver(boxFirst, { 'accessibility id': 'row' }), 'Apple') as PlatformElement;
    expect(el1.resolvedElement.elementId).toBe('box');
    expect(boxFirst.finds()).toEqual([expect.stringMatching(/^-ios class chain:/), expect.stringMatching(/^-ios class chain:/), '~row']);

    const cellFirst = new MockServer('ios', [cell('cell'), box('box')]);
    const el2 = await byText(repoOver(cellFirst, { 'accessibility id': 'row' }), 'Apple') as PlatformElement;
    expect(el2.resolvedElement.elementId).toBe('cell');
    expect(wasQueried(cellFirst.finds(), '~row')).toBe(true);
    expect(cellFirst.finds()).toContain('~row');
  });

  test('ios: contains winners from both queries also take the full pass', async () => {
    const server = new MockServer('ios', [
      { id: 'cell', name: 'row', label: 'Green Apple' },
      { id: 'box', name: 'row', label: null, children: [{ id: 'box-t', type: 'XCUIElementTypeStaticText', label: 'Red Apple' }] },
    ]);
    const el = await byText(repoOver(server, { 'accessibility id': 'row' }), 'apple') as PlatformElement;
    expect(el.resolvedElement.elementId).toBe('cell');
    expect(server.finds()).toContain('~row');
  });
});

// ===========================================================================
// Costs: requests per hit and per miss (16-row list, per-request latency)
// ===========================================================================

test.describe('narrowed TEXT costs', () => {
  const LATENCY = 15;

  test('android hit: 1 query + 1 text read; a full pass of the same list reads up to every row', async () => {
    const rows = FRUITS.map((f, i): MockNode => ({ id: `r${i}`, name: 'row', text: f }));
    const narrowed = new MockServer('android', rows, LATENCY);
    const started = Date.now();
    const el = await byText(repoOver(narrowed, { 'accessibility id': 'row' }), 'Nectarine') as PlatformElement;
    const narrowedMs = Date.now() - started;
    expect(el.resolvedElement.elementId).toBe('r15');
    expect(narrowed.log).toEqual([expect.stringMatching(/^find \(/), 'r15:text']);

    const full = new MockServer('android', rows, LATENCY);
    const startedFull = Date.now();
    await byText(repoOver(full, { uiautomator: 'new UiSelector().description("row")' }), 'Nectarine');
    const fullMs = Date.now() - startedFull;
    expect(full.log).toHaveLength(1 + 16);
    expect(narrowedMs).toBeLessThan(fullMs);
  });

  test('ios hit: 2 queries + the hit\'s type and label reads (4 requests); a full pass costs 1 + 2 per row', async () => {
    const rows = FRUITS.map((f, i): MockNode => ({ id: `r${i}`, name: 'row', label: f }));
    const narrowed = new MockServer('ios', rows, LATENCY);
    const el = await byText(repoOver(narrowed, { 'accessibility id': 'row' }), 'Nectarine') as PlatformElement;
    expect(el.resolvedElement.elementId).toBe('r15');
    expect(narrowed.log).toEqual([
      expect.stringMatching(/^find -ios class chain:/), expect.stringMatching(/^find -ios class chain:/),
      expect.stringMatching(/^r15:(tag|label)$/), expect.stringMatching(/^r15:(tag|label)$/),
    ]);

    const full = new MockServer('ios', rows, LATENCY);
    await byText(repoOver(full, { xpath: '//XCUIElementTypeCell' }), 'Nectarine');
    expect(full.log).toHaveLength(1 + 2 * 16);
  });

  test('a miss: each poll costs 1 query on android and 2 on ios, and polls until the deadline (clean miss)', async () => {
    for (const platform of ['android', 'ios'] as const) {
      const rows = FRUITS.map((f, i): MockNode => (platform === 'android' ? { id: `r${i}`, name: 'row', text: f } : { id: `r${i}`, name: 'row', label: f }));
      const server = new MockServer(platform, rows, LATENCY);
      const err = await byText(repoOver(server, { 'accessibility id': 'row' }), 'Durian', 700).then(() => null, (e: unknown) => e);
      expect(err).toBeInstanceOf(TextNotFoundError);
      expect((err as TextNotFoundError).cleanMiss).toBe(true);
      expect((err as TextNotFoundError).lastDriverError).toBeUndefined();
      const perPoll = platform === 'android' ? 1 : 2;
      // Only queries, no reads, and more than one poll.
      expect(server.log.every(e => e.startsWith('find '))).toBe(true);
      expect(server.log.length % perPoll).toBe(0);
      expect(server.log.length / perPoll).toBeGreaterThan(1);
    }
  });

  test('a match that appears later is found by a later poll', async () => {
    const rows: MockNode[] = [{ id: 'a', name: 'row', text: 'Apple' }];
    const server = new MockServer('android', rows);
    setTimeout(() => rows.push({ id: 'k', name: 'row', text: 'Kiwi' }), 300);
    const el = await byText(repoOver(server, { 'accessibility id': 'row' }), 'Kiwi', 3000) as PlatformElement;
    expect(el.resolvedElement.elementId).toBe('k');
  });
});

// ===========================================================================
// Falling back to the full pass
// ===========================================================================

test.describe('narrowed TEXT falls back to the full pass', () => {
  const named = (name: string, message: string) => Object.assign(new Error(message), { name });
  const android = (): MockServer => new MockServer('android', FRUITS.map((f, i) => ({ id: `r${i}`, name: 'row', text: f })));

  for (const err of [
    named('invalid selector', 'Unable to locate using the given strategy'),
    named('invalid argument', 'bad predicate'),
    named('unknown error', 'Can\'t do a substring operation with something that isn\'t a string'),
    named('stale element reference', 'gone'),
  ]) {
    test(`a narrowed query failing with ${err.name} (${isFatalDriverError(err) ? 'fatal' : 'non-fatal'} elsewhere): full passes from then on`, async () => {
      const server = android();
      server.failNarrowed = err;
      const el = await byText(repoOver(server, { 'accessibility id': 'row' }), 'Mango') as PlatformElement;
      expect(el.resolvedElement.elementId).toBe('r13');
      expect(server.finds()).toEqual([expect.stringMatching(/^\(/), '~row']);

      // A miss: the narrowed query is tried once; every later poll is a full pass.
      const missServer = android();
      missServer.failNarrowed = err;
      const miss = await byText(repoOver(missServer, { 'accessibility id': 'row' }), 'Durian', 600).then(() => null, (e: unknown) => e) as TextNotFoundError;
      expect(miss).toBeInstanceOf(TextNotFoundError);
      expect(missServer.finds().filter(isNarrowedQuery)).toHaveLength(1);
      expect(missServer.finds().filter(f => f === '~row').length).toBeGreaterThan(1);
      // The query error is kept as the last driver error; the full passes were clean.
      expect(miss.cleanMiss).toBe(true);
      expect(miss.lastDriverError).toBe(err);
    });
  }

  for (const err of [named('invalid session id', 'session deleted'), named('Error', 'connect ECONNREFUSED <appium-server>')]) {
    test(`a lost session in a narrowed query is thrown: ${err.message}`, async () => {
      expect(isSessionLostError(err)).toBe(true);
      const server = android();
      server.failNarrowed = err;
      await expect(byText(repoOver(server, { 'accessibility id': 'row' }), 'Mango')).rejects.toBe(err);
    });
  }

  test('not narrowable: a UiAutomator selector, a short resource id, an iOS XPath, an unsafe word', async () => {
    const cases: Array<[MockServer, Record<string, string>, string]> = [
      [android(), { uiautomator: 'new UiSelector().description("row")' }, 'Mango'],
      [new MockServer('android', FRUITS.map((f, i) => ({ id: `r${i}`, resourceId: 'title', text: f }))), { id: 'title' }, 'Mango'],
      [new MockServer('ios', FRUITS.map((f, i) => ({ id: `r${i}`, label: f }))), { xpath: '//XCUIElementTypeCell' }, 'Mango'],
      [new MockServer('ios', [...FRUITS.map((f, i) => ({ id: `r${i}`, name: 'row', label: f })), { id: 'thumb', name: 'row', label: '👍' }]), { 'accessibility id': 'row' }, '👍'],
    ];
    for (const [server, selector, value] of cases) {
      const el = await byText(repoOver(server, selector), value) as PlatformElement;
      expect(el.resolvedElement).toBeDefined();
      expect(server.finds().some(isNarrowedQuery)).toBe(false);
    }
  });
});

// ===========================================================================
// getByText
// ===========================================================================

test.describe('narrowed getByText', () => {
  const ios = (): MockServer => new MockServer('ios', [
    { id: 'deluxe', name: 'row', label: 'Apple Pie Deluxe' },
    { id: 'box', name: 'row', label: null, children: [{ id: 'b1', type: 'XCUIElementTypeStaticText', label: 'Apple' }, { id: 'b2', type: 'XCUIElementTypeStaticText', label: 'Pie' }] },
    { id: 'lower', name: 'row', label: 'apple pie' },
  ]);

  test('its own rule: exact (case-sensitive) beats an earlier contains hit', async () => {
    const server = ios();
    const el = await repoOver(server, { 'accessibility id': 'row' }).getByText('rows', 'List', 'Apple Pie', true) as PlatformElement;
    expect(el.resolvedElement.elementId).toBe('box');
    expect(el.selector).toBe('~row');
    expect(server.finds().every(isNarrowedQuery)).toBe(true);
  });

  test('contains is case-sensitive: "apple" matches the lowercase row only, though every row is a hit', async () => {
    const server = ios();
    const el = await repoOver(server, { 'accessibility id': 'row' }).getByText('rows', 'List', 'apple', true) as PlatformElement;
    expect(el.resolvedElement.elementId).toBe('lower');
  });

  test('a miss is null (strict: a clean TextNotFoundError) without reading the non-hits', async () => {
    const server = new MockServer('android', FRUITS.map((f, i) => ({ id: `r${i}`, name: 'row', text: f })));
    const repo = repoOver(server, { 'accessibility id': 'row' });
    expect(await repo.getByText('rows', 'List', 'Durian')).toBeNull();
    const err = await repo.getByText('rows', 'List', 'Durian', true).then(() => null, (e: unknown) => e) as TextNotFoundError;
    expect(err).toBeInstanceOf(TextNotFoundError);
    expect(err.cleanMiss).toBe(true);
    expect(server.log.filter(e => !e.startsWith('find '))).toEqual([]);
  });

  test('an untrimmed needle: no exact match (texts are trimmed), as in the full comparison', async () => {
    const server = new MockServer('android', [{ id: 'a', name: 'row', text: 'Apple' }]);
    expect(await repoOver(server, { 'accessibility id': 'row' }).getByText('rows', 'List', ' Apple')).toBeNull();
  });

  test('a narrowed query error falls back to comparing every match', async () => {
    const server = new MockServer('android', FRUITS.map((f, i) => ({ id: `r${i}`, name: 'row', text: f })));
    server.failNarrowed = Object.assign(new Error('bad'), { name: 'invalid selector' });
    const el = await repoOver(server, { 'accessibility id': 'row' }).getByText('rows', 'List', 'Mango', true) as PlatformElement;
    expect(el.resolvedElement.elementId).toBe('r13');
    expect(server.finds().filter(f => f === '~row').length).toBeGreaterThan(0);
  });

  test('a lost session in its narrowed query is thrown', async () => {
    const server = new MockServer('android', [{ id: 'a', name: 'row', text: 'Apple' }]);
    const lost = Object.assign(new Error('gone'), { name: 'invalid session id' });
    server.failNarrowed = lost;
    await expect(repoOver(server, { 'accessibility id': 'row' }).getByText('rows', 'List', 'Apple')).rejects.toBe(lost);
  });

  test('ios: winners from both queries → every match is compared, document order wins', async () => {
    const server = new MockServer('ios', [
      { id: 'box', name: 'row', label: null, children: [{ id: 'box-t', type: 'XCUIElementTypeStaticText', label: 'Apple' }] },
      { id: 'cell', name: 'row', label: 'Apple' },
    ]);
    const el = await repoOver(server, { 'accessibility id': 'row' }).getByText('rows', 'List', 'Apple', true) as PlatformElement;
    expect(el.resolvedElement.elementId).toBe('box');
    expect(server.finds()).toContain('~row');
  });
});

test('the iOS CONTAINS[cd] model folds case and diacritics', () => {
  expect(fold('STRAẞE')).toBe(fold('straße'));
  expect(fold('Café')).toBe('cafe');
});
