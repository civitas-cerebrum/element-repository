import { test, expect } from '@playwright/test';
import { ElementRepository } from '../src/repo/ElementRepository';
import { SelectionStrategy } from '../src/enum/Options';
import { PlatformElement } from '../src/types';
import { TextNotFoundError, LookupAbortedError } from '../src/types/errors';
import { readPlatformText, ANDROID_DESCENDANT_TEXT_XPATH, IOS_DESCENDANT_TEXT_SELECTOR } from '../src/utils/platformText';
import {
  pickTextTokens, MAX_TEXT_TOKENS, narrowedTextQueries, selectorKind, xpathLiteral, normaliseText,
  DEFAULT_SNAPSHOT_MAX_DEPTH, depthSentinelQuery, snapshotConfirmedComplete,
} from '../src/utils/textNarrowing';
import { isSessionLostError, isFatalDriverError } from '../src/utils/driverErrors';
import {
  answerNarrowed, decodeXPathLiteral, decodePredicateString, isNarrowedQuery, narrowedWords, wasQueried, fold,
  type SnapshotCap, inSnapshot, inSnapshotBelow, isDepthSentinel, answerDepthSentinel,
} from './support/narrowedQueries';

// ===========================================================================
// The word a narrowed lookup asks for
// ===========================================================================

/** The longest word a lookup asks for (the first of pickTextTokens). */
const longest = (needle: string, platform: Parameters<typeof pickTextTokens>[1]): string | undefined =>
  pickTextTokens(needle, platform)[0];

test.describe('pickTextTokens', () => {
  test('every distinct safe word, longest first (the first of equal ones first)', () => {
    expect(pickTextTokens('Item 9', 'ios')).toEqual(['item', '9']);
    expect(pickTextTokens('Item 9', 'android')).toEqual(['item', '9']);
    expect(pickTextTokens('Pie Pot of Apple', 'ios')).toEqual(['apple', 'pie', 'pot', 'of']);
    expect(pickTextTokens('Apple apple APPLE pie', 'android')).toEqual(['apple', 'pie']);
    expect(pickTextTokens('  Personal   Hotspot ', 'ios')).toEqual(['personal', 'hotspot']);
  });

  test(`at most ${MAX_TEXT_TOKENS} words: the longest ones are kept`, () => {
    expect(MAX_TEXT_TOKENS).toBe(4);
    expect(pickTextTokens('a bb ccc dddd eeeee ffffff', 'ios')).toEqual(['ffffff', 'eeeee', 'dddd', 'ccc']);
    expect(pickTextTokens('one two three four five six', 'android')).toEqual(['three', 'four', 'five', 'one']);
  });

  test('an unsafe word is left out, the safe ones are kept', () => {
    expect(pickTextTokens('a`very`long pie of $5', 'ios')).toEqual(['pie', 'of']);
    expect(pickTextTokens('ΟΔΟΣ Airport', 'android')).toEqual(['airport']);
    expect(pickTextTokens('İstanbul Airport 2', 'android')).toEqual(['airport', '2']);
    expect(pickTextTokens('नमस्ते Hello World', 'ios')).toEqual(['hello', 'world']);
    expect(pickTextTokens('`x` $y', 'ios')).toEqual([]);
    expect(pickTextTokens('Apple', 'web')).toEqual([]);
  });

  test('the longest word of the normalised needle; the first of equal ones', () => {
    expect(longest('Apple Pie', 'android')).toBe('apple');
    expect(longest('Pie Pot', 'ios')).toBe('pie');
    expect(longest('  Personal   Hotspot ', 'ios')).toBe('personal');
    expect(longest('Wi Fi', 'ios')).toBe('wi');
  });

  test('NBSP and newlines split words, as the rule\'s normaliser treats them as spaces', () => {
    expect(longest('Blue\u00a0Chinos\nXL', 'android')).toBe('chinos');
    expect(normaliseText('Blue\u00a0Chinos\nXL')).toBe('blue chinos xl');
  });

  test('a blank needle, or a platform other than android / ios: no word (not narrowed)', () => {
    expect(longest('   ', 'android')).toBeUndefined();
    expect(longest('', 'ios')).toBeUndefined();
    expect(longest('Apple', 'web')).toBeUndefined();
    expect(longest('Apple', 'macos')).toBeUndefined();
    expect(longest('Apple', undefined)).toBeUndefined();
  });

  test('ios: a word with a backtick or $ is skipped for the next safe one; none safe = not narrowed', () => {
    expect(longest('a`very`long pie', 'ios')).toBe('pie');
    expect(longest('$100000 off', 'ios')).toBe('off');
    expect(longest('`x` $y', 'ios')).toBeUndefined();
    // Android carries both in an XPath literal.
    expect(longest('a`very`long pie', 'android')).toBe('a`very`long');
    expect(longest('$100000 off', 'android')).toBe('$100000');
  });

  test('ios: only words of scripts without spacing or conjoining marks are narrowed on; else the next longest safe word', () => {
    // Safe: Latin, Greek, Cyrillic, Han, Hiragana / Katakana, Hangul syllables, digits, ASCII punctuation.
    for (const word of ['straße', 'οδος', 'привет', '東京', 'ひらがな', 'コーヒー', '안녕하세요', '12:30', 'a-b_c!']) {
      expect(longest(word, 'ios')).toBe(word);
    }
    // Unsafe scripts or characters: the next longest safe word is taken.
    expect(longest('नमस्ते Hello', 'ios')).toBe('hello');
    expect(longest('สวัสดีครับ hi', 'ios')).toBe('hi');
    expect(longest('مرحبا ok', 'ios')).toBe('ok');
    expect(longest('שלום ok', 'ios')).toBe('ok');
    expect(longest('ﾃﾞｰﾀ ok', 'ios')).toBe('ok');
    expect(longest('\u1112\u1161 ok', 'ios')).toBe('ok');
    expect(longest('\u20ac100 ok', 'ios')).toBe('ok');
    expect(longest('नमस्ते', 'ios')).toBeUndefined();
    // Android is not restricted this way.
    expect(longest('नमस्ते Hello', 'android')).toBe('नमस्ते');
  });

  test('ios: emoji, combining marks and joiners are not narrowed on (NSPredicate matches whole character sequences)', () => {
    expect(longest('👍 Like', 'ios')).toBe('like');
    expect(longest('👍', 'ios')).toBeUndefined();
    expect(longest('cafe\u0301', 'ios')).toBeUndefined();
    expect(longest('👍', 'android')).toBe('👍');
  });

  test('android: a sigma, and the dot of İ (its lowercase is i + U+0307), are not narrowed on', () => {
    expect(longest('ΟΔΟΣ', 'android')).toBeUndefined();
    expect(longest('İstanbul', 'android')).toBeUndefined();
    expect(normaliseText('İstanbul')).toBe('i\u0307stanbul');
    expect(longest('İstanbul Airport', 'android')).toBe('airport');
    expect(longest('ΟΔΟΣ', 'ios')).toBe('οδος');
  });

  test('quotes, backslashes, % and ] are carried on both platforms; ß stays ß', () => {
    for (const p of ['android', 'ios'] as const) {
      expect(longest('say "hello"', p)).toBe('"hello"');
      expect(longest("it's", p)).toBe("it's");
      expect(longest('C:\\dir', p)).toBe('c:\\dir');
      expect(longest('100%', p)).toBe('100%');
      expect(longest('a]b', p)).toBe('a]b');
      expect(longest('Straße', p)).toBe('straße');
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
      expect(narrowedTextQueries(selector, 'android', ['apple'])).toEqual(query === null ? null : [query]);
    });
  }

  test('the translate() covers every character that lowercases to a character of the word', () => {
    // K: K and the Kelvin sign; i: I and İ (whose lowercase starts with i).
    expect(narrowedTextQueries('~r', 'android', ['kiwi'])).toEqual([
      androidQuery("//*[@content-desc='r']", "contains(translate(@text, 'K\u212aI\u0130W', 'kkiiw'), 'kiwi')"),
    ]);
    // å: Å and the Angstrom sign; ǆ: Ǆ and its titlecase ǅ.
    expect(narrowedTextQueries('~r', 'android', ['åǆ'])![0]).toContain("translate(@text, '\u00c5\u212b\u01c4\u01c5', 'ååǆǆ')");
  });

  test('a word without cased characters is compared as it is', () => {
    expect(narrowedTextQueries('~r', 'android', ['100%'])).toEqual([
      androidQuery("//*[@content-desc='r']", "contains(@text, '100%')"),
    ]);
  });

  test('escaping: the word is an XPath literal (concat() for both quotes)', () => {
    const word = `it's"x"`;
    const q = narrowedTextQueries('~r', 'android', [word])![0];
    expect(q).toContain(`, concat('it', "'", 's"x"'))`);
  });

  test('several words: every one in the own text, or every one in some descendant, each with its own lowercase map', () => {
    expect(narrowedTextQueries('~row', 'android', pickTextTokens('Item 9', 'android'))).toEqual([
      "(//*[@content-desc='row'])[(contains(translate(@text, 'IİTEM', 'iitem'), 'item') and contains(@text, '9'))" +
      " or (.//*[not(@showing-hint='true') and contains(translate(@text, 'IİTEM', 'iitem'), 'item')]" +
      " and .//*[not(@showing-hint='true') and contains(@text, '9')])]",
    ]);
  });

  test('a word the query cannot carry: null (pickTextTokens never passes one)', () => {
    expect(narrowedTextQueries('~r', 'android', ['apple', 'οδος'])).toBeNull();
    expect(narrowedTextQueries('~r', 'android', [])).toBeNull();
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
    // Appended to the last segment, after the base's own predicate.
    ['-ios class chain:**/XCUIElementTypeTable/XCUIElementTypeCell[`visible == 1`]', [
      `-ios class chain:**/XCUIElementTypeTable/XCUIElementTypeCell[\`visible == 1\`][\`${OWN_APPLE}\`]`,
      `-ios class chain:**/XCUIElementTypeTable/XCUIElementTypeCell[\`visible == 1\`]${DESC_APPLE}`,
    ]],
    // A last segment ending in an index cannot take a predicate after it
    // (WebDriverAgent: a predicate must come before the position): not narrowed.
    ['-ios class chain:**/XCUIElementTypeTable/XCUIElementTypeCell[`visible == 1`][2]', null],
    ['-ios class chain:**/XCUIElementTypeCell[-1]', null],
    ['-ios class chain:XCUIElementTypeWindow/XCUIElementTypeCell[12]', null],
    // An index in an earlier segment, or brackets inside a predicate, is no last-segment index.
    ['-ios class chain:**/XCUIElementTypeTable[1]/XCUIElementTypeCell', [
      `-ios class chain:**/XCUIElementTypeTable[1]/XCUIElementTypeCell[\`${OWN_APPLE}\`]`,
      `-ios class chain:**/XCUIElementTypeTable[1]/XCUIElementTypeCell${DESC_APPLE}`,
    ]],
    ['-ios class chain:**/XCUIElementTypeCell[`name == "a/b[2]"`]', [
      `-ios class chain:**/XCUIElementTypeCell[\`name == "a/b[2]"\`][\`${OWN_APPLE}\`]`,
      `-ios class chain:**/XCUIElementTypeCell[\`name == "a/b[2]"\`]${DESC_APPLE}`,
    ]],
    ['-ios class chain:**/XCUIElementTypeCell[$name == "x[2]"$]', [
      `-ios class chain:**/XCUIElementTypeCell[$name == "x[2]"$][\`${OWN_APPLE}\`]`,
      `-ios class chain:**/XCUIElementTypeCell[$name == "x[2]"$]${DESC_APPLE}`,
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
      expect(narrowedTextQueries(selector, 'ios', ['apple'])).toEqual(queries);
    });
  }

  test('escaping: \\ and " in the word are escaped for NSPredicate', () => {
    const [own] = narrowedTextQueries('~r', 'ios', ['c:\\"dir"'])!;
    expect(own).toContain('label CONTAINS[cd] "c:\\\\\\"dir\\"" OR value CONTAINS[cd] "c:\\\\\\"dir\\""');
  });

  test('an unknown or web platform, or no word: null', () => {
    expect(narrowedTextQueries('~row', undefined, ['apple'])).toBeNull();
    expect(narrowedTextQueries('~row', 'web', ['apple'])).toBeNull();
    expect(narrowedTextQueries('~row', 'ios', [])).toBeNull();
  });

  test('several words: own = every word in the label, or every word in the value; descendant = the longest word only', () => {
    const own = '(label CONTAINS[cd] "item" AND label CONTAINS[cd] "9") OR (value CONTAINS[cd] "item" AND value CONTAINS[cd] "9")';
    const longestOnly = 'label CONTAINS[cd] "item" OR value CONTAINS[cd] "item"';
    const desc = `[\`NOT (${longestOnly})\`][$type == "XCUIElementTypeStaticText" AND (${longestOnly})$]`;
    expect(narrowedTextQueries('~row', 'ios', pickTextTokens('Item 9', 'ios'))).toEqual([
      `-ios class chain:**/*[\`name == "row"\`][\`${own}\`]`,
      `-ios class chain:**/*[\`name == "row"\`]${desc}`,
    ]);
    expect(narrowedTextQueries('-ios predicate string:type == "XCUIElementTypeCell"', 'ios', ['item', '9'])).toEqual([
      `-ios predicate string:(type == "XCUIElementTypeCell") AND (${own})`,
      `-ios class chain:**/*[\`type == "XCUIElementTypeCell"\`]${desc}`,
    ]);
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
  // Several words: split across children, case folding per word, an unsafe word left out.
  'Item 9', 'Kiwi Pie', 'Item 9 of the list', 'ΟΔΟΣ Airport',
];

/** Element texts each needle is checked against (case variants, the Kelvin sign, İ, ẞ). */
function textsFor(needle: string): string[] {
  return [
    needle, needle.toUpperCase(), `Prefix ${needle} suffix`, `${needle.toLowerCase()}!`,
    'unrelated', 'kelvin', '\u212aELVIN', 'STRASSE', 'STRAẞE', 'kİ', 'Kİ',
    needle.replace(/k/gi, 'K'), 'Item 19', 'Item 90 - Lorem', 'Pie Kiwi', 'airport',
  ];
}

/** `t` cut in two at its first whitespace (`null` for one word): the two children of a split row. */
function splitInTwo(t: string): [string, string] | null {
  const m = t.match(/^(\S*)\s+(.*)$/s);
  return m && m[1] !== '' && m[2].trim() !== '' ? [m[1], m[2]] : null;
}

test.describe('escaping fixtures — android, evaluated by a real XPath 1.0 engine', () => {
  const xmlAttr = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;')
    .replace(/\n/g, '&#10;').replace(/\u00a0/g, '&#160;');

  for (const needle of ESCAPING_NEEDLES) {
    test(JSON.stringify(needle), async ({ page }) => {
      const tokens = pickTextTokens(needle, 'android');
      expect(tokens.length).toBeGreaterThan(0);
      const [query] = narrowedTextQueries('~row', 'android', tokens)!;
      expect(narrowedWords(query)).toEqual(tokens);

      // One own-text row and one container row (text in a child) per text,
      // a container whose text is split across two children, a hint field
      // showing the text, and a row outside the base.
      const texts = textsFor(needle);
      const nodes: Array<{ uid: string; own: string; children?: string[]; hint?: boolean; inBase: boolean }> = [];
      texts.forEach((t, i) => {
        nodes.push({ uid: `own${i}`, own: t, inBase: true });
        nodes.push({ uid: `box${i}`, own: '', children: [t], inBase: true });
        const split = splitInTwo(t);
        if (split) nodes.push({ uid: `split${i}`, own: '', children: split, inBase: true });
        nodes.push({ uid: `hintbox${i}`, own: '', children: [t], hint: true, inBase: true });
        nodes.push({ uid: `other${i}`, own: t, inBase: false });
      });
      const xml = '<hierarchy><android.widget.FrameLayout uid="root" text="">' + nodes.map(n =>
        `<android.widget.LinearLayout uid="${n.uid}" text="${xmlAttr(n.own)}" content-desc="${n.inBase ? 'row' : 'other'}">` +
        (n.children ?? []).map((c, k) =>
          `<android.widget.TextView uid="${n.uid}-c${k}" text="${xmlAttr(c)}"${n.hint ? ' showing-hint="true"' : ''}/>`).join('') +
        '</android.widget.LinearLayout>').join('') + '</android.widget.FrameLayout></hierarchy>';

      const found: string[] = await page.evaluate(([x, q]) => {
        const doc = new DOMParser().parseFromString(x, 'application/xml');
        if (doc.getElementsByTagName('parsererror').length) throw new Error('bad xml');
        const r = doc.evaluate(q, doc, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
        const out: string[] = [];
        for (let i = 0; i < r.snapshotLength; i++) out.push((r.snapshotItem(i) as Element).getAttribute('uid')!);
        return out;
      }, [xml, query] as const);

      // The rule's text of each base row: its own, else its (non-hint) children's, joined.
      const ruleText = (n: typeof nodes[number]) => n.own.trim() !== ''
        ? n.own
        : (n.hint ? '' : (n.children ?? []).map(c => c.trim()).filter(c => c !== '').join(' '));
      const wanted = normaliseText(needle);
      const mustHit = nodes.filter(n => n.inBase && normaliseText(ruleText(n)).includes(wanted)).map(n => n.uid);
      expect(mustHit.length).toBeGreaterThan(0);
      for (const uid of mustHit) expect(found).toContain(uid);
      if (splitInTwo(needle)) expect(found).toContain(`split${texts.indexOf(needle)}`);
      // Only base rows, in document order.
      const baseOrder = nodes.filter(n => n.inBase).map(n => n.uid);
      expect(found.every(uid => baseOrder.includes(uid))).toBe(true);
      expect([...found].sort((a, b) => baseOrder.indexOf(a) - baseOrder.indexOf(b))).toEqual(found);
      // The hint child is never a reason for a hit (the hint rows have no own text).
      for (const n of nodes.filter(n => n.hint)) expect(found).not.toContain(n.uid);
      // Every word is required: a row whose text lacks one is no hit.
      const lc = (s: string) => s.replace(/K/g, 'k').replace(/İ/g, 'i').toLowerCase();
      for (const n of nodes.filter(n => n.inBase && !n.hint)) {
        const all = [n.own, ...(n.children ?? [])].map(lc).join(' ');
        if (tokens.some(t => !all.includes(t))) expect(found).not.toContain(n.uid);
      }
    });
  }
});

test.describe('escaping fixtures — ios, decoded as NSPredicate and evaluated as CONTAINS[cd]', () => {
  for (const needle of ESCAPING_NEEDLES) {
    test(JSON.stringify(needle), async () => {
      const tokens = pickTextTokens(needle, 'ios');
      if (needle === 'a`b') { expect(tokens).toEqual([]); return; }
      expect(tokens.length).toBeGreaterThan(0);
      const queries = narrowedTextQueries('~row', 'ios', tokens)!;
      expect(queries).toHaveLength(2);
      for (const q of queries) {
        expect(isNarrowedQuery(q)).toBe(true);
        const literal = q.match(/label CONTAINS\[cd\] "((?:[^"\\]|\\.)*)"/)![1];
        expect(decodePredicateString(literal)).toBe(tokens[0]);
      }
      expect(narrowedWords(queries[0])).toEqual(tokens);
      expect(narrowedWords(queries[1])).toEqual([tokens[0]]);

      // Per text: a cell by label, a cell by value, a text input by value
      // (its label holds the text too, or only its label does), a container
      // with one StaticText, one with the text split across two, and a cell
      // whose label holds the first word and value the rest.
      const texts = textsFor(needle);
      const st = (id: string, label: string) => ({ id, type: 'XCUIElementTypeStaticText', label });
      const all = texts.flatMap((t, i) => {
        const split = splitInTwo(t);
        return [
          iosRaw({ id: `cell${i}`, name: 'row', label: t }),
          iosRaw({ id: `val${i}`, name: 'row', label: null, value: t }),
          iosRaw({ id: `input${i}`, name: 'row', type: 'XCUIElementTypeTextField', label: 'Name', value: t }),
          iosRaw({ id: `inputlabel${i}`, name: 'row', type: 'XCUIElementTypeTextField', label: t, value: 'typed' }),
          iosRaw({ id: `box${i}`, name: 'row', label: null, children: [st(`box${i}-t`, t)] }),
          ...(split ? [
            iosRaw({ id: `split${i}`, name: 'row', label: null, children: [st(`split${i}-a`, split[0]), st(`split${i}-b`, split[1])] }),
            iosRaw({ id: `lv${i}`, name: 'row', label: split[0], value: split[1] }),
          ] : []),
        ];
      });
      const own = answerNarrowed(queries[0], b => (b === '~row' ? all : undefined))!;
      const desc = answerNarrowed(queries[1], b => (b === '~row' ? all : undefined))!;
      // Disjoint, and together they hold every element the rule could choose.
      expect(own.filter(r => desc.includes(r))).toEqual([]);
      const wanted = normaliseText(needle);
      let chosen = 0;
      for (const raw of all) {
        const text = await readPlatformText(raw, 'ios');
        if (normaliseText(text ?? '').includes(wanted)) { chosen++; expect([...own, ...desc]).toContain(raw); }
      }
      expect(chosen).toBeGreaterThan(0);
      if (splitInTwo(needle)) expect(desc.map(r => r.elementId)).toContain('split0');
      // Several words: the label / value split is no own hit (the rule reads the label only).
      if (tokens.length > 1 && splitInTwo(needle)) {
        expect(own.map(r => r.elementId)).not.toContain('lv0');
        expect(own.map(r => r.elementId)).toContain('inputlabel0');
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
  /** A top-level node's depth below the page root (default 1); a child is one deeper than its parent. */
  depth?: number;
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
 *
 * The snapshot is cut off at `snapshotMaxDepth` as the server cuts it (see
 * `SnapshotCap`): Android page-level XPath (the narrowed query, an XPath
 * base, the depth query) and every iOS query see only held nodes;
 * Android `~name` / `id=` finds see every node; element-scoped reads
 * start a snapshot of their own at the element. `settings` is what
 * `getSettings()` answers (an `Error` is thrown, `'unsupported'` leaves the
 * method out; `{}` means the default depth); `failSentinel` makes the depth
 * query fail.
 */
class MockServer {
  readonly log: string[] = [];
  private readonly raws = new Map<string, any>();
  failNarrowed?: Error;
  settings: Record<string, unknown> | Error | 'unsupported' = {};
  failSentinel?: Error;
  /** Makes the full pass's find (any query but a narrowed or depth one) fail. */
  failFull?: Error;
  /** Called with each request as it is made. */
  onRequest?: (entry: string) => void;

  constructor(readonly platform: 'android' | 'ios', readonly roots: MockNode[], readonly latencyMs = 0) {}

  /** The snapshot cap the server applies now. */
  cap(): SnapshotCap {
    const named = this.settings instanceof Error || this.settings === 'unsupported' ? undefined : this.settings.snapshotMaxDepth;
    const maxDepth = typeof named === 'number' ? named : DEFAULT_SNAPSHOT_MAX_DEPTH[this.platform];
    const depths = new Map<string, number>();
    const walk = (nodes: MockNode[], parent?: number) => nodes.forEach(n => {
      const d = parent === undefined ? n.depth ?? 1 : parent + 1;
      depths.set(n.id, d);
      walk(n.children ?? [], d);
    });
    walk(this.roots);
    return { platform: this.platform, maxDepth, depthOf: raw => depths.get(raw.elementId) ?? 0 };
  }

  /** The finds that were depth queries. */
  sentinels(): string[] { return this.finds().filter(isDepthSentinel); }
  /** How many times the settings were read. */
  settingsReads(): number { return this.log.filter(e => e === 'settings').length; }

  private async request(entry: string): Promise<void> {
    this.log.push(entry);
    this.onRequest?.(entry);
    if (this.latencyMs > 0) await new Promise(r => setTimeout(r, this.latencyMs));
  }

  /** Requests that were finds (driver-level). */
  finds(): string[] { return this.log.filter(e => e.startsWith('find ')).map(e => e.slice(5)); }

  private static all(nodes: MockNode[]): MockNode[] {
    return nodes.flatMap(n => [n, ...MockServer.all(n.children ?? [])]);
  }

  private baseMatches(selector: string): any[] | undefined {
    const nodes = MockServer.all(this.roots);
    const cap = this.cap();
    // iOS finds and Android XPath run on the cut-off snapshot.
    const held = (raws: any[], snapshot: boolean) => (snapshot ? raws.filter(r => inSnapshot(r, cap)) : raws);
    const ios = this.platform === 'ios';
    if (selector.startsWith('~')) return held(nodes.filter(n => n.name === selector.slice(1)).map(n => this.raw(n)), ios);
    if (selector.startsWith('id=')) return held(nodes.filter(n => n.resourceId === selector.slice(3)).map(n => this.raw(n)), ios);
    // An XPath by name: every node of that name the snapshot holds.
    const byName = selector.match(/^\/\/\*\[@content-desc="([^"]*)"\]$/);
    if (byName) return held(nodes.filter(n => n.name === byName[1]).map(n => this.raw(n)), true);
    return held(this.roots.map(n => this.raw(n)), ios || selector.startsWith('/') || selector.startsWith('('));
  }

  raw(node: MockNode): any {
    const existing = this.raws.get(node.id);
    if (existing) return existing;
    const server = this;
    // An element-scoped read starts a snapshot of its own at the element.
    const descendants = () => {
      const cap = server.cap();
      return MockServer.all(node.children ?? []).filter(d => inSnapshotBelow(raw, server.raw(d), cap));
    };
    const raw: any = {
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
    const driver: any = {
      capabilities: { platformName: this.platform === 'ios' ? 'iOS' : 'Android' },
      $: async (selector: string) => (this.baseMatches(selector) ?? [])[0],
      $$: async (selector: string) => {
        await this.request(`find ${selector}`);
        if (isNarrowedQuery(selector)) {
          if (this.failNarrowed) throw this.failNarrowed;
          return answerNarrowed(selector, b => this.baseMatches(b), undefined, this.cap());
        }
        if (isDepthSentinel(selector)) {
          if (this.failSentinel) throw this.failSentinel;
          return answerDepthSentinel(selector, MockServer.all(this.roots).map(n => this.raw(n)), this.cap());
        }
        if (this.failFull) throw this.failFull;
        return this.baseMatches(selector) ?? [];
      },
    };
    if (this.settings !== 'unsupported') {
      driver.getSettings = async () => {
        await this.request('settings');
        if (this.settings instanceof Error) throw this.settings;
        return this.settings;
      };
    }
    return driver;
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

  test('android: the words split across two TextViews of a container, read only that row', async () => {
    const server = new MockServer('android', [
      { id: 'pie', name: 'row', text: 'Pie' },
      { id: 'apple', name: 'row', text: '', children: [{ id: 'a1', text: 'Apple' }, { id: 'a2', text: 'Tart' }] },
      { id: 'box', name: 'row', text: '', children: [{ id: 'b1', text: 'Kiwi' }, { id: 'b2', text: 'Pie' }] },
    ]);
    const el = await byText(repoOver(server, { 'accessibility id': 'row' }), 'kiwi pie') as PlatformElement;
    expect(el.resolvedElement.elementId).toBe('box');
    expect(server.log.filter(e => !e.startsWith('find ')).every(e => /^(box|b1|b2):/.test(e))).toBe(true);
  });

  test('ios: the words split across two StaticTexts of a container', async () => {
    const st = (id: string, label: string): MockNode => ({ id, type: 'XCUIElementTypeStaticText', label });
    const server = new MockServer('ios', [
      { id: 'kiwi', name: 'row', label: 'Kiwi' },
      { id: 'box', name: 'row', label: null, children: [st('b1', 'Kiwi'), st('b2', 'Pie')] },
    ]);
    const el = await byText(repoOver(server, { 'accessibility id': 'row' }), 'Kiwi Pie') as PlatformElement;
    expect(el.resolvedElement.elementId).toBe('box');
    expect(server.log.some(e => e.startsWith('kiwi:'))).toBe(false);
  });

  test('ios: a text input whose label holds the words but whose value does not is no match (the rule reads its value)', async () => {
    const server = new MockServer('ios', [
      { id: 'field', name: 'row', type: 'XCUIElementTypeTextField', label: 'Kiwi Pie', value: 'typed' },
      { id: 'cell', name: 'row', label: 'Fresh Kiwi Pie' },
    ]);
    const el = await byText(repoOver(server, { 'accessibility id': 'row' }), 'Kiwi Pie') as PlatformElement;
    expect(el.resolvedElement.elementId).toBe('cell');
  });

  test('ios: one word in the label and the other in the value is no own hit (the rule reads one attribute)', async () => {
    const server = new MockServer('ios', [
      { id: 'lv', name: 'row', label: 'Kiwi', value: 'Pie' },
      { id: 'cell', name: 'row', label: 'Kiwi Pie' },
    ]);
    const el = await byText(repoOver(server, { 'accessibility id': 'row' }), 'Kiwi Pie') as PlatformElement;
    expect(el.resolvedElement.elementId).toBe('cell');
    expect(server.log.some(e => e.startsWith('lv:'))).toBe(false);
  });

  test('a word that folds case per word (the Kelvin sign, İ) is matched on both platforms; a sigma word is left out', async () => {
    const android = new MockServer('android', [
      { id: 'other', name: 'row', text: 'Kiwi Tart' },
      { id: 'kelvin', name: 'row', text: 'KIWI PIE' },
    ]);
    const a = await byText(repoOver(android, { 'accessibility id': 'row' }), 'kiwi pie') as PlatformElement;
    expect(a.resolvedElement.elementId).toBe('kelvin');
    expect(android.log.some(e => e.startsWith('other:'))).toBe(false);
    // ΟΔΟΣ is unsafe on android: only "airport" narrows, the rule still picks the row.
    const sigma = new MockServer('android', [
      { id: 'a', name: 'row', text: 'Airport' },
      { id: 'b', name: 'row', text: 'ΟΔΟΣ Airport' },
    ]);
    const s = await byText(repoOver(sigma, { 'accessibility id': 'row' }), 'ΟΔΟΣ Airport') as PlatformElement;
    expect(s.resolvedElement.elementId).toBe('b');
    expect(narrowedWords(sigma.finds()[0])).toEqual(['airport']);
    // İ lowercases to i + U+0307: its word is left out on both platforms, the others narrow.
    for (const platform of ['android', 'ios'] as const) {
      const node = (id: string, t: string): MockNode => (platform === 'android' ? { id, name: 'row', text: t } : { id, name: 'row', label: t });
      const server = new MockServer(platform, [node('x', 'Ankara Airport'), node('y', 'İstanbul Airport'), node('z', 'İstanbul Tour')]);
      const i = await byText(repoOver(server, { 'accessibility id': 'row' }), 'İstanbul Airport') as PlatformElement;
      expect(i.resolvedElement.elementId).toBe('y');
      expect(narrowedWords(server.finds()[0])).toEqual(['airport']);
      expect(server.log.some(e => e.startsWith('z:'))).toBe(false);
    }
    // ios: CONTAINS[cd] folds case per word.
    const ios = new MockServer('ios', [
      { id: 'x', name: 'row', label: 'Kiwi Tart' },
      { id: 'y', name: 'row', label: 'KIWI PIE' },
    ]);
    const k = await byText(repoOver(ios, { 'accessibility id': 'row' }), 'kiwi pie') as PlatformElement;
    expect(k.resolvedElement.elementId).toBe('y');
    expect(ios.log.some(e => e.startsWith('x:'))).toBe(false);
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

  test('"Item 9" among "Item N - Lorem ipsum" rows: every word narrows, so only that row is read', async () => {
    const ITEMS = Array.from({ length: 16 }, (_, i) => `Item ${i + 1} - Lorem ipsum dolor`);
    // android: 1 query + 1 text read.
    const android = new MockServer('android', ITEMS.map((t, i): MockNode => ({ id: `r${i}`, name: 'row', text: t })), LATENCY);
    const a = await byText(repoOver(android, { 'accessibility id': 'row' }), 'Item 9') as PlatformElement;
    expect(a.resolvedElement.elementId).toBe('r8');
    expect(android.log).toEqual([expect.stringMatching(/^find \(/), 'r8:text']);
    expect(narrowedWords(android.finds()[0])).toEqual(['item', '9']);

    // ios: 2 queries + the one hit's type and label reads; the own list is that row only.
    const iosRows = ITEMS.map((t, i): MockNode => ({ id: `r${i}`, name: 'row', label: t }));
    const ios = new MockServer('ios', iosRows, LATENCY);
    const b = await byText(repoOver(ios, { 'accessibility id': 'row' }), 'Item 9') as PlatformElement;
    expect(b.resolvedElement.elementId).toBe('r8');
    expect(ios.log).toEqual([
      expect.stringMatching(/^find -ios class chain:/), expect.stringMatching(/^find -ios class chain:/),
      expect.stringMatching(/^r8:(tag|label)$/), expect.stringMatching(/^r8:(tag|label)$/),
    ]);
    const [ownQuery] = narrowedTextQueries('~row', 'ios', pickTextTokens('Item 9', 'ios'))!;
    const listed = new MockServer('ios', iosRows);
    expect(answerNarrowed(ownQuery, base => (base === '~row' ? iosRows.map(n => listed.raw(n)) : undefined))!
      .map(r => r.elementId)).toEqual(['r8']);
    // The longest word alone would hold every row.
    const [longestOnly] = narrowedTextQueries('~row', 'ios', ['item'])!;
    expect(answerNarrowed(longestOnly, base => (base === '~row' ? iosRows.map(n => listed.raw(n)) : undefined))!)
      .toHaveLength(16);

    // getByText sends the same queries and reads only that row too.
    const ios2 = new MockServer('ios', iosRows, LATENCY);
    const c = await repoOver(ios2, { 'accessibility id': 'row' }).getByText('rows', 'List', 'Item 9') as PlatformElement;
    expect(c.resolvedElement.elementId).toBe('r8');
    expect(ios2.log.filter(e => !e.startsWith('find ')).every(e => e.startsWith('r8:'))).toBe(true);
  });

  test('a single-word needle every row contains still reads every row', async () => {
    const ITEMS = Array.from({ length: 16 }, (_, i) => `Item ${i + 1}`);
    const server = new MockServer('android', ITEMS.map((t, i): MockNode => ({ id: `r${i}`, name: 'row', text: t })));
    const el = await byText(repoOver(server, { 'accessibility id': 'row' }), 'item') as PlatformElement;
    expect(el.resolvedElement.elementId).toBe('r0');
    // Contains matches only: every hit is read for an exact one.
    expect(server.log.filter(e => e.endsWith(':text'))).toHaveLength(16);
  });

  test('a miss: each poll costs 1 query on android and 2 on ios, polls until the deadline, then one settings read and one depth query (clean, narrowed)', async () => {
    for (const platform of ['android', 'ios'] as const) {
      const rows = FRUITS.map((f, i): MockNode => (platform === 'android' ? { id: `r${i}`, name: 'row', text: f } : { id: `r${i}`, name: 'row', label: f }));
      const server = new MockServer(platform, rows, LATENCY);
      const err = await byText(repoOver(server, { 'accessibility id': 'row' }), 'Durian', 700).then(() => null, (e: unknown) => e);
      expect(err).toBeInstanceOf(TextNotFoundError);
      expect((err as TextNotFoundError).cleanMiss).toBe(true);
      expect((err as TextNotFoundError).lastDriverError).toBeUndefined();
      expect((err as TextNotFoundError).missBasis).toBe('narrowed');
      const perPoll = platform === 'android' ? 1 : 2;
      // The confirmation comes last: one settings read, one depth query.
      expect(server.log.slice(-2)).toEqual(['settings', `find ${server.sentinels()[0]}`]);
      expect(server.sentinels()).toHaveLength(1);
      const polls = server.log.slice(0, -2);
      // Only narrowed queries, no reads, and more than one poll.
      expect(polls.every(e => e.startsWith('find ') && isNarrowedQuery(e.slice(5)))).toBe(true);
      expect(polls.length % perPoll).toBe(0);
      expect(polls.length / perPoll).toBeGreaterThan(1);
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
      // The query error belongs to a query the user never wrote: it is not
      // reported; the full passes were clean.
      expect(miss.cleanMiss).toBe(true);
      expect(miss.lastDriverError).toBeUndefined();
      expect(miss.message).not.toContain('last driver error');
      expect(miss.message).not.toContain(err.message);
    });
  }

  test('isSessionLostError agrees with isFatalDriverError on every session and transport error', () => {
    const lost = [
      named('invalid session id', 'x'), named('InvalidSessionIdError', 'x'),
      named('session not created', 'x'), named('SessionNotCreatedError', 'x'),
      named('Error', 'A session is either terminated or not started'),
      named('Error', 'connect ECONNREFUSED <appium-server>'), named('Error', 'read ECONNRESET'),
      named('Error', 'getaddrinfo ENOTFOUND <appium-server>'), named('Error', 'write EPIPE'),
      named('Error', 'The instrumentation process is not running (probably crashed)'),
    ];
    for (const err of lost) {
      expect(isSessionLostError(err)).toBe(true);
      expect(isFatalDriverError(err)).toBe(true);
    }
    // Neither list calls these transport errors fatal: a narrowed query failing
    // with one falls back to the full pass, which polls through it as before.
    for (const err of [named('Error', 'fetch failed'), named('Error', 'socket hang up'), named('Error', 'connect ETIMEDOUT'), named('Error', 'UND_ERR_SOCKET')]) {
      expect(isSessionLostError(err)).toBe(isFatalDriverError(err));
    }
    // Errors about the query, not the session: fatal elsewhere, not a lost session.
    for (const err of [named('invalid selector', 'x'), named('invalid argument', 'x'), named('unknown command', 'x'), named('no such window', 'x')]) {
      expect(isFatalDriverError(err)).toBe(true);
      expect(isSessionLostError(err)).toBe(false);
    }
  });

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
    expect(err.missBasis).toBe('narrowed');
    // Each lookup: the narrowed query, one settings read, one depth query.
    expect(server.log.filter(e => !e.startsWith('find '))).toEqual(['settings', 'settings']);
    expect(server.finds().filter(f => !isNarrowedQuery(f))).toEqual(server.sentinels());
    expect(server.sentinels()).toHaveLength(2);
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

  test('a narrowed query error is not reported in a strict miss', async () => {
    const server = new MockServer('android', FRUITS.map((f, i) => ({ id: `r${i}`, name: 'row', text: f })));
    const err = Object.assign(new Error('narrowed query rejected'), { name: 'invalid selector' });
    server.failNarrowed = err;
    const miss = await repoOver(server, { 'accessibility id': 'row' }).getByText('rows', 'List', 'Durian', true)
      .then(() => null, (e: unknown) => e) as TextNotFoundError;
    expect(miss).toBeInstanceOf(TextNotFoundError);
    expect(miss.cleanMiss).toBe(true);
    expect(miss.lastDriverError).toBeUndefined();
    expect(miss.message).not.toContain('narrowed query rejected');
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

// ===========================================================================
// Confirming a narrowed miss: the snapshot depth cap
// ===========================================================================

/** `node` placed `depth` levels below the page root, under a chain of plain containers. */
function nestAt(depth: number, node: MockNode, prefix: string): MockNode {
  let current = node;
  for (let d = depth - 1; d >= 1; d--) current = { id: `${prefix}${d}`, children: [current] };
  return current;
}

/** The children of a container whose descendant `levels` below it is `leaf`. */
function chainBelow(levels: number, leaf: MockNode, prefix: string): MockNode[] {
  let current = leaf;
  for (let k = levels - 1; k >= 1; k--) current = { id: `${prefix}${k}`, children: [current] };
  return [current];
}

const missOf = (p: Promise<unknown>) => p.then(() => null, (e: unknown) => e) as Promise<TextNotFoundError>;
/** The full pass's finds: every find but the narrowed and the depth queries. */
const fullFinds = (server: MockServer) => server.finds().filter(f => !isNarrowedQuery(f) && !isDepthSentinel(f));

test.describe('a narrowed miss is confirmed against the snapshot depth cap', () => {
  const ANDROID_SENTINEL_70 = '(//*[count(ancestor::*) >= 69])[1]';
  const IOS_SENTINEL_50 = `-ios class chain:${Array(49).fill('*').join('/')}[1]`;

  test('the depth queries: android counts ancestors from the hierarchy root (>= D - 1), ios has D - 1 child segments, the last [1]', () => {
    expect(depthSentinelQuery('android', 70)).toBe(ANDROID_SENTINEL_70);
    expect(depthSentinelQuery('android', 2)).toBe('(//*[count(ancestor::*) >= 1])[1]');
    expect(depthSentinelQuery('android', 1)).toBe('(//*[count(ancestor::*) >= 0])[1]');
    expect(depthSentinelQuery('ios', 50)).toBe(IOS_SENTINEL_50);
    expect(depthSentinelQuery('ios', 3)).toBe('-ios class chain:*/*[1]');
    expect(depthSentinelQuery('ios', 2)).toBe('-ios class chain:*[1]');
    expect(depthSentinelQuery('ios', 1)).toBeNull();
    for (const bad of [0, -1, 2.5, NaN]) expect(depthSentinelQuery('android', bad)).toBeNull();
    expect(depthSentinelQuery('web', 70)).toBeNull();
    expect(DEFAULT_SNAPSHOT_MAX_DEPTH).toEqual({ android: 70, ios: 50 });
  });

  test('the model: a node at the cut-off depth is held; the depth query finds it (android: one level shallower too)', () => {
    for (const platform of ['android', 'ios'] as const) {
      const cutOff = platform === 'android' ? 70 : 49;
      // Android asks for >= D - 1 ancestors: an off-by-one in the model errs towards a full pass.
      const found = platform === 'android' ? cutOff - 1 : cutOff;
      const server = new MockServer(platform, [nestAt(cutOff + 3, { id: 'leaf' }, 'w')]);
      const cap = server.cap();
      const all = ['w1', `w${cutOff}`, `w${cutOff + 1}`].map(id => ({ elementId: id }));
      expect(all.map(r => inSnapshot(r, cap))).toEqual([true, true, false]);
      const sentinel = depthSentinelQuery(platform, cap.maxDepth)!;
      const nodes = Array.from({ length: cutOff + 2 }, (_, i) => ({ elementId: `w${i + 1}` }));
      // At most one element (android `(...)[1]`, ios the last segment's `[1]`).
      expect(answerDepthSentinel(sentinel, nodes, cap)!.map(r => r.elementId)).toEqual([`w${found}`]);
      // One level shallower than what it finds: nothing that deep.
      expect(answerDepthSentinel(sentinel, nodes.slice(0, found - 1), cap)).toEqual([]);
    }
  });

  test('android ~row: a row deeper than the cap is missed by the narrowed query and found by the confirming pass', async () => {
    const server = new MockServer('android', [
      { id: 'a', name: 'row', text: 'Apple' },
      nestAt(75, { id: 'deep', name: 'row', text: 'Durian' }, 'w'),
    ]);
    const el = await byText(repoOver(server, { 'accessibility id': 'row' }), 'Durian', 200) as PlatformElement;
    expect(el.resolvedElement.elementId).toBe('deep');
    expect(server.settingsReads()).toBe(1);
    expect(server.sentinels()).toEqual([ANDROID_SENTINEL_70]);
    expect(fullFinds(server)).toEqual(['~row']);
  });

  test('android XPath base: the row deeper than the cap is outside every pass (the same snapshot); the miss is a full pass', async () => {
    const server = new MockServer('android', [
      { id: 'a', name: 'row', text: 'Apple' },
      nestAt(75, { id: 'deep', name: 'row', text: 'Durian' }, 'w'),
    ]);
    const miss = await missOf(byText(repoOver(server, { xpath: '//*[@content-desc="row"]' }), 'Durian', 200));
    expect(miss).toBeInstanceOf(TextNotFoundError);
    expect(miss.missBasis).toBe('full-pass');
    expect(miss.cleanMiss).toBe(true);
    // The full pass ran on the cut-off snapshot: the miss is not proven absence.
    expect(miss.snapshotTruncated).toBe(true);
    expect(fullFinds(server)).toEqual(['//*[@content-desc="row"]']);
    // One settings read and one depth query, before the confirming pass only.
    expect(server.settingsReads()).toBe(1);
    expect(server.sentinels()).toEqual([ANDROID_SENTINEL_70]);
  });

  test('android ~row: the snapshot cut off but the text absent: the confirming pass (not capped) proves the miss, snapshotTruncated false', async () => {
    const server = new MockServer('android', [
      { id: 'a', name: 'row', text: 'Apple' },
      nestAt(75, { id: 'deep', name: 'row', text: 'Elderberry' }, 'w'),
    ]);
    const miss = await missOf(byText(repoOver(server, { 'accessibility id': 'row' }), 'Durian', 200));
    expect(miss.missBasis).toBe('full-pass');
    expect(miss.cleanMiss).toBe(true);
    expect(miss.snapshotTruncated).toBe(false);
    expect(server.sentinels()).toEqual([ANDROID_SENTINEL_70]);
    // The `~row` find saw the deep row too.
    expect(fullFinds(server)).toEqual(['~row']);
    expect(server.log).toContain('deep:text');
  });

  for (const selector of [{ 'accessibility id': 'row' }, { xpath: '//*[@content-desc="row"]' }]) {
    test(`android ${Object.values(selector)[0]}: a row within the cap whose text lies below it is found by the confirming pass`, async () => {
      const box: MockNode = { id: 'box', name: 'row', text: '', children: chainBelow(45, { id: 'leaf', text: 'Durian' }, 'c') };
      const server = new MockServer('android', [{ id: 'a', name: 'row', text: 'Apple' }, nestAt(30, box, 'w')]);
      const el = await byText(repoOver(server, selector), 'Durian', 200) as PlatformElement;
      expect(el.resolvedElement.elementId).toBe('box');
      expect(server.sentinels()).toEqual([ANDROID_SENTINEL_70]);
      expect(fullFinds(server)).toHaveLength(1);
    });
  }

  test('ios ~row: a row within the cap whose StaticText lies below it is found by the confirming pass', async () => {
    const box: MockNode = { id: 'box', name: 'row', label: null, children: chainBelow(40, { id: 'leaf', type: 'XCUIElementTypeStaticText', label: 'Durian' }, 'c') };
    const server = new MockServer('ios', [{ id: 'a', name: 'row', label: 'Apple' }, nestAt(20, box, 'w')]);
    const el = await byText(repoOver(server, { 'accessibility id': 'row' }), 'Durian', 200) as PlatformElement;
    expect(el.resolvedElement.elementId).toBe('box');
    expect(server.settingsReads()).toBe(1);
    expect(server.sentinels()).toEqual([IOS_SENTINEL_50]);
    expect(fullFinds(server)).toEqual(['~row']);
  });

  test('ios ~row: a row deeper than the cap: every query runs on the snapshot, so the confirming pass misses it too', async () => {
    const server = new MockServer('ios', [
      { id: 'a', name: 'row', label: 'Apple' },
      nestAt(55, { id: 'deep', name: 'row', label: 'Durian' }, 'w'),
    ]);
    const miss = await missOf(byText(repoOver(server, { 'accessibility id': 'row' }), 'Durian', 200));
    expect(miss.missBasis).toBe('full-pass');
    expect(miss.snapshotTruncated).toBe(true);
    expect(fullFinds(server)).toEqual(['~row']);
    expect(server.sentinels()).toEqual([IOS_SENTINEL_50]);
  });

  for (const platform of ['android', 'ios'] as const) {
    test(`${platform}: a shallow tree: one settings read, one depth query, no full pass, missBasis 'narrowed'`, async () => {
      const server = new MockServer(platform, FRUITS.map((f, i) => ({ id: `r${i}`, name: 'row', text: f, label: f })));
      const miss = await missOf(byText(repoOver(server, { 'accessibility id': 'row' }), 'Durian', 200));
      expect(miss).toBeInstanceOf(TextNotFoundError);
      expect(miss.missBasis).toBe('narrowed');
      expect(miss.cleanMiss).toBe(true);
      expect(miss.snapshotTruncated).toBe(false);
      expect(server.settingsReads()).toBe(1);
      expect(server.sentinels()).toEqual([platform === 'android' ? ANDROID_SENTINEL_70 : IOS_SENTINEL_50]);
      expect(fullFinds(server)).toEqual([]);
      expect(miss.message).toBe(`Element 'rows' on 'List' with text "Durian" not found.`);
    });

    test(`${platform}: the depth named in the settings is the one queried`, async () => {
      const server = new MockServer(platform, [{ id: 'a', name: 'row', text: 'Apple', label: 'Apple' }]);
      server.settings = { snapshotMaxDepth: 12, otherSetting: true };
      await missOf(byText(repoOver(server, { 'accessibility id': 'row' }), 'Durian', 100));
      expect(server.sentinels()).toEqual([depthSentinelQuery(platform, 12)]);
    });
  }

  const named = (name: string, message: string) => Object.assign(new Error(message), { name });
  const confirmers: Array<[string, (s: MockServer) => void, { settings: number; sentinels: number }]> = [
    ['the depth query finds a node', s => { s.roots.push(nestAt(72, { id: 'deep-empty' }, 'w')); }, { settings: 1, sentinels: 1 }],
    ['getSettings is unsupported', s => { s.settings = 'unsupported'; }, { settings: 0, sentinels: 0 }],
    ['getSettings fails', s => { s.settings = named('unknown command', 'settings refused'); }, { settings: 1, sentinels: 0 }],
    ['the settings name an unusable depth', s => { s.settings = { snapshotMaxDepth: 'deep' }; }, { settings: 1, sentinels: 0 }],
    ['the depth query fails', s => { s.failSentinel = named('invalid selector', 'sentinel refused'); }, { settings: 1, sentinels: 1 }],
  ];
  for (const [why, arrange, counts] of confirmers) {
    test(`ios: ${why} → one full pass; snapshotTruncated true when the depth query found the cut-off, else absent (not checked)`, async () => {
      const server = new MockServer('ios', FRUITS.map((f, i) => ({ id: `r${i}`, name: 'row', label: f })));
      arrange(server);
      const deep = why === 'the depth query finds a node';
      // The android arrangement nests 72 deep; on ios the cut-off is 49 levels, so that node is beyond it too.
      const miss = await missOf(byText(repoOver(server, { 'accessibility id': 'row' }), 'Durian', 200));
      expect(miss.missBasis).toBe('full-pass');
      expect(miss.cleanMiss).toBe(true);
      if (deep) expect(miss.snapshotTruncated).toBe(true);
      else expect(miss.snapshotTruncated).toBeUndefined();
      // The depth check is not repeated after the confirming pass.
      expect(server.settingsReads()).toBe(counts.settings);
      expect(server.sentinels()).toHaveLength(counts.sentinels);
      expect(fullFinds(server)).toEqual(['~row']);
    });

    test(`android: ${why} → one full pass, missBasis 'full-pass', the confirmation's error is not reported`, async () => {
      const server = new MockServer('android', FRUITS.map((f, i) => ({ id: `r${i}`, name: 'row', text: f })));
      arrange(server);
      const miss = await missOf(byText(repoOver(server, { 'accessibility id': 'row' }), 'Durian', 200));
      expect(miss).toBeInstanceOf(TextNotFoundError);
      expect(miss.missBasis).toBe('full-pass');
      expect(miss.cleanMiss).toBe(true);
      // The `~row` full pass does not read the snapshot: its miss stands whatever the depth check said.
      expect(miss.snapshotTruncated).toBe(false);
      expect(miss.lastDriverError).toBeUndefined();
      expect(miss.message).toBe(`Element 'rows' on 'List' with text "Durian" not found.`);
      expect(server.settingsReads()).toBe(counts.settings);
      expect(server.sentinels()).toHaveLength(counts.sentinels);
      expect(fullFinds(server)).toEqual(['~row']);
      // The full pass read every row.
      expect(server.log.filter(e => e.endsWith(':text'))).toHaveLength(FRUITS.length);
    });
  }

  test('a lost session in the settings read or the depth query is thrown', async () => {
    const lost = named('invalid session id', 'session deleted');
    const a = new MockServer('android', [{ id: 'a', name: 'row', text: 'Apple' }]);
    a.settings = lost;
    await expect(byText(repoOver(a, { 'accessibility id': 'row' }), 'Durian', 100)).rejects.toBe(lost);
    const b = new MockServer('ios', [{ id: 'a', name: 'row', label: 'Apple' }]);
    b.failSentinel = lost;
    await expect(byText(repoOver(b, { 'accessibility id': 'row' }), 'Durian', 100)).rejects.toBe(lost);
    await expect(repoOver(b, { 'accessibility id': 'row' }).getByText('rows', 'List', 'Durian')).rejects.toBe(lost);
  });

  test('a driver error in the confirming pass: cleanMiss false, lastDriverError that error', async () => {
    const server = new MockServer('android', [{ id: 'a', name: 'row', text: 'Apple' }, nestAt(72, { id: 'deep-empty' }, 'w')]);
    const stale = named('stale element reference', 'list changed');
    server.onRequest = entry => { if (isDepthSentinel(entry.slice(5))) server.failFull = stale; };
    const miss = await missOf(byText(repoOver(server, { 'accessibility id': 'row' }), 'Durian', 200));
    expect(miss.missBasis).toBe('full-pass');
    expect(miss.cleanMiss).toBe(false);
    expect(miss.lastDriverError).toBe(stale);
    expect(miss.message).toContain('(last driver error: stale element reference: list changed)');
  });

  test('over a timeout of many polls: one settings read, one depth query and at most one confirming pass', async () => {
    for (const deep of [false, true]) {
      const roots: MockNode[] = FRUITS.map((f, i) => ({ id: `r${i}`, name: 'row', text: f }));
      if (deep) roots.push(nestAt(72, { id: 'deep-empty' }, 'w'));
      const server = new MockServer('android', roots, 10);
      await missOf(byText(repoOver(server, { 'accessibility id': 'row' }), 'Durian', 600));
      expect(server.finds().filter(isNarrowedQuery).length).toBeGreaterThan(3);
      expect(server.settingsReads()).toBe(1);
      expect(server.sentinels()).toHaveLength(1);
      expect(fullFinds(server)).toHaveLength(deep ? 1 : 0);
      // The confirmation comes after the last poll.
      const lastNarrowed = server.log.map(e => isNarrowedQuery(e.slice(5))).lastIndexOf(true);
      expect(server.log.indexOf('settings')).toBeGreaterThan(lastNarrowed);
    }
  });

  test('requireFullPass: a narrowed miss is always confirmed by a full pass, without the settings read or depth query', async () => {
    const server = new MockServer('android', FRUITS.map((f, i) => ({ id: `r${i}`, name: 'row', text: f })));
    const miss = await missOf(repoOver(server, { 'accessibility id': 'row' })
      .get('rows', 'List', { strategy: SelectionStrategy.TEXT, value: 'Durian', timeout: 200, requireFullPass: true }));
    expect(miss.missBasis).toBe('full-pass');
    // A `~row` full pass does not read the snapshot: its miss needs no depth check.
    expect(miss.snapshotTruncated).toBe(false);
    expect(server.settingsReads()).toBe(0);
    expect(server.sentinels()).toEqual([]);
    expect(fullFinds(server)).toEqual(['~row']);
    // A hit is still narrowed.
    const hit = new MockServer('android', FRUITS.map((f, i) => ({ id: `r${i}`, name: 'row', text: f })));
    const el = await repoOver(hit, { 'accessibility id': 'row' })
      .get('rows', 'List', { strategy: SelectionStrategy.TEXT, value: 'Mango', requireFullPass: true }) as PlatformElement;
    expect(el.resolvedElement.elementId).toBe('r13');
    expect(fullFinds(hit)).toEqual([]);
  });

  test('requireFullPass: the depth check runs after the confirming pass misses, and reports the cut-off (ios)', async () => {
    const server = new MockServer('ios', [{ id: 'a', name: 'row', label: 'Apple' }, nestAt(55, { id: 'deep', name: 'row', label: 'Durian' }, 'w')]);
    const miss = await missOf(repoOver(server, { 'accessibility id': 'row' })
      .get('rows', 'List', { strategy: SelectionStrategy.TEXT, value: 'Durian', timeout: 200, requireFullPass: true }));
    expect(miss.missBasis).toBe('full-pass');
    expect(miss.snapshotTruncated).toBe(true);
    expect(server.settingsReads()).toBe(1);
    expect(server.sentinels()).toEqual([IOS_SENTINEL_50]);
    expect(fullFinds(server)).toEqual(['~row']);
    // The order: the full pass, then the settings read and the depth query.
    expect(server.log.indexOf('settings')).toBeGreaterThan(server.log.indexOf('find ~row'));
    // A shallow tree: false.
    const shallow = new MockServer('ios', FRUITS.map((f, i) => ({ id: `r${i}`, name: 'row', label: f })));
    const flat = await missOf(repoOver(shallow, { 'accessibility id': 'row' })
      .get('rows', 'List', { strategy: SelectionStrategy.TEXT, value: 'Durian', timeout: 200, requireFullPass: true }));
    expect(flat.snapshotTruncated).toBe(false);
  });

  test('requireFullPass on an android XPath base over a cut-off snapshot: snapshotTruncated true', async () => {
    const server = new MockServer('android', [{ id: 'a', name: 'row', text: 'Apple' }, nestAt(75, { id: 'deep', name: 'row', text: 'Durian' }, 'w')]);
    const miss = await missOf(repoOver(server, { xpath: '//*[@content-desc="row"]' })
      .get('rows', 'List', { strategy: SelectionStrategy.TEXT, value: 'Durian', timeout: 200, requireFullPass: true }));
    expect(miss.snapshotTruncated).toBe(true);
    expect(server.sentinels()).toEqual([ANDROID_SENTINEL_70]);
  });

  test('ios: a value CONTAINS error (a non-string value) makes every poll a full pass; the final miss gets one depth check', async () => {
    const server = new MockServer('ios', FRUITS.map((f, i) => ({ id: `r${i}`, name: 'row', label: f })));
    server.failNarrowed = named('unknown error', 'Can\'t do a substring operation with something that isn\'t a string');
    const miss = await missOf(byText(repoOver(server, { 'accessibility id': 'row' }), 'Durian', 300));
    expect(miss.missBasis).toBe('full-pass');
    expect(miss.cleanMiss).toBe(true);
    expect(miss.snapshotTruncated).toBe(false);
    expect(server.settingsReads()).toBe(1);
    expect(server.sentinels()).toEqual([IOS_SENTINEL_50]);
    expect(fullFinds(server).length).toBeGreaterThan(0);
    // The depth check comes after the last full pass.
    expect(server.log.indexOf('settings')).toBeGreaterThan(server.log.lastIndexOf('find ~row'));
  });

  test('ios: the depth query finding a node → one full pass', async () => {
    const server = new MockServer('ios', [{ id: 'a', name: 'row', label: 'Apple' }, nestAt(52, { id: 'deep-empty' }, 'w')]);
    const miss = await missOf(byText(repoOver(server, { 'accessibility id': 'row' }), 'Durian', 200));
    expect(miss.missBasis).toBe('full-pass');
    expect(miss.snapshotTruncated).toBe(true);
    expect(server.sentinels()).toEqual([IOS_SENTINEL_50]);
    expect(fullFinds(server)).toEqual(['~row']);
  });

  for (const stage of ['settings', 'sentinel'] as const) {
    test(`an abort during the ${stage} stops the lookup before the next call`, async () => {
      const server = new MockServer('android', [{ id: 'a', name: 'row', text: 'Apple' }, nestAt(72, { id: 'deep-empty' }, 'w')], 20);
      const controller = new AbortController();
      server.onRequest = entry => {
        if (stage === 'settings' ? entry === 'settings' : isDepthSentinel(entry.slice(5))) controller.abort(new Error('stop'));
      };
      const err = await repoOver(server, { 'accessibility id': 'row' })
        .get('rows', 'List', { strategy: SelectionStrategy.TEXT, value: 'Durian', timeout: 100, signal: controller.signal })
        .then(() => null, (e: unknown) => e);
      expect(err).toBeInstanceOf(LookupAbortedError);
      expect(server.sentinels()).toHaveLength(stage === 'settings' ? 0 : 1);
      expect(fullFinds(server)).toEqual([]);
    });
  }

  test('an aborted signal is checked before the settings read', async () => {
    const server = new MockServer('android', [{ id: 'a', name: 'row', text: 'Apple' }]);
    const controller = new AbortController();
    controller.abort(new Error('early'));
    await expect(snapshotConfirmedComplete(server.driver(), 'android', controller.signal)).rejects.toBeInstanceOf(LookupAbortedError);
    expect(server.settingsReads()).toBe(0);
  });

  test.describe('getByText', () => {
    test('a shallow tree: strict miss with missBasis narrowed; requireFullPass: missBasis full-pass and a full comparison', async () => {
      const server = new MockServer('android', FRUITS.map((f, i) => ({ id: `r${i}`, name: 'row', text: f })));
      const repo = repoOver(server, { 'accessibility id': 'row' });
      const narrowed = await missOf(repo.getByText('rows', 'List', 'Durian', true));
      expect(narrowed.missBasis).toBe('narrowed');
      expect(narrowed.snapshotTruncated).toBe(false);
      expect(fullFinds(server)).toEqual([]);

      const full = await missOf(repo.getByText('rows', 'List', 'Durian', true, { requireFullPass: true }));
      expect(full.missBasis).toBe('full-pass');
      // `~row` on android: the full comparison's miss stands without a depth check.
      expect(full.snapshotTruncated).toBe(false);
      expect(full.message).toBe(narrowed.message);
      expect(fullFinds(server)).toEqual(['~row']);
      expect(server.settingsReads()).toBe(1);

      // Non-strict: null either way; requireFullPass backs it with a full comparison.
      const before = fullFinds(server).length;
      expect(await repo.getByText('rows', 'List', 'Durian', false, { requireFullPass: true })).toBeNull();
      expect(fullFinds(server).length).toBe(before + 1);
    });

    for (const platform of ['android', 'ios'] as const) {
      test(`${platform}: a row within the cap whose text lies below it is found by comparing every match`, async () => {
        const leaf: MockNode = platform === 'android' ? { id: 'leaf', text: 'Durian' } : { id: 'leaf', type: 'XCUIElementTypeStaticText', label: 'Durian' };
        // The leaf lies below the page's cut-off but within the row's own snapshot.
        const box: MockNode = { id: 'box', name: 'row', text: '', label: null, children: chainBelow(platform === 'android' ? 50 : 40, leaf, 'c') };
        const server = new MockServer(platform, [{ id: 'a', name: 'row', text: 'Apple', label: 'Apple' }, nestAt(25, box, 'w')]);
        const el = await repoOver(server, { 'accessibility id': 'row' }).getByText('rows', 'List', 'Durian', true) as PlatformElement;
        expect(el.resolvedElement.elementId).toBe('box');
        expect(server.settingsReads()).toBe(1);
        expect(server.sentinels()).toHaveLength(1);
        expect(fullFinds(server)).toEqual(['~row']);
      });
    }

    for (const platform of ['android', 'ios'] as const) {
      test(`${platform}: a row deeper than the cap, missed by every query on the snapshot: snapshotTruncated true`, async () => {
        const roots: MockNode[] = [
          { id: 'a', name: 'row', text: 'Apple', label: 'Apple' },
          nestAt(platform === 'android' ? 75 : 55, { id: 'deep', name: 'row', text: 'Durian', label: 'Durian' }, 'w'),
        ];
        const selector = platform === 'android' ? { xpath: '//*[@content-desc="row"]' } : { 'accessibility id': 'row' };
        const server = new MockServer(platform, roots);
        const miss = await missOf(repoOver(server, selector).getByText('rows', 'List', 'Durian', true));
        expect(miss.missBasis).toBe('full-pass');
        expect(miss.snapshotTruncated).toBe(true);
        expect(server.settingsReads()).toBe(1);
        expect(server.sentinels()).toHaveLength(1);
        // requireFullPass: the depth check after the full comparison, the same flag.
        const again = new MockServer(platform, roots);
        const forced = await missOf(repoOver(again, selector).getByText('rows', 'List', 'Durian', true, { requireFullPass: true }));
        expect(forced.snapshotTruncated).toBe(true);
        expect(again.settingsReads()).toBe(1);
        const firstFull = again.log.findIndex(e => e.startsWith('find ') && !isNarrowedQuery(e.slice(5)) && !isDepthSentinel(e.slice(5)));
        expect(again.log.indexOf('settings')).toBeGreaterThan(firstFull);
      });
    }

    test('android ~row: a row deeper than the cap is found by comparing every match', async () => {
      const server = new MockServer('android', [{ id: 'a', name: 'row', text: 'Apple' }, nestAt(75, { id: 'deep', name: 'row', text: 'Durian' }, 'w')]);
      const el = await repoOver(server, { 'accessibility id': 'row' }).getByText('rows', 'List', 'Durian') as PlatformElement;
      expect(el.resolvedElement.elementId).toBe('deep');
    });

    test('getSettings unsupported, or the depth query failing: every match is compared, missBasis full-pass', async () => {
      for (const arrange of [(s: MockServer) => { s.settings = 'unsupported'; }, (s: MockServer) => { s.failSentinel = named('invalid selector', 'x'); }]) {
        const server = new MockServer('ios', FRUITS.map((f, i) => ({ id: `r${i}`, name: 'row', label: f })));
        arrange(server);
        const miss = await missOf(repoOver(server, { 'accessibility id': 'row' }).getByText('rows', 'List', 'Durian', true));
        expect(miss.missBasis).toBe('full-pass');
        expect(miss.cleanMiss).toBe(true);
        // Not checked: the depth check could not run, so the flag is absent.
        expect(miss.snapshotTruncated).toBeUndefined();
        expect(fullFinds(server)).toEqual(['~row']);
      }
    });

    test('an abort during the depth query rejects, also when strict is false', async () => {
      const server = new MockServer('android', [{ id: 'a', name: 'row', text: 'Apple' }, nestAt(72, { id: 'deep-empty' }, 'w')]);
      const controller = new AbortController();
      server.onRequest = entry => { if (isDepthSentinel(entry.slice(5))) controller.abort(new Error('stop')); };
      await expect(repoOver(server, { 'accessibility id': 'row' }).getByText('rows', 'List', 'Durian', false, { signal: controller.signal }))
        .rejects.toBeInstanceOf(LookupAbortedError);
      // Nothing after the depth query (the `~row` find before it is the attach wait a signal adds).
      expect(isDepthSentinel(server.log[server.log.length - 1].slice(5))).toBe(true);
    });
  });
});

test.describe('TextNotFoundError.missBasis', () => {
  test('defaults to full-pass; the message does not change with it', () => {
    const a = new TextNotFoundError({ elementName: 'e', pageName: 'p', text: 't' });
    const b = new TextNotFoundError({ elementName: 'e', pageName: 'p', text: 't', missBasis: 'narrowed' });
    expect(a.missBasis).toBe('full-pass');
    expect(b.missBasis).toBe('narrowed');
    expect(b.message).toBe(a.message);
  });

  test('snapshotTruncated: absent unless given (not checked); true and false are kept; the message does not change', () => {
    const a = new TextNotFoundError({ elementName: 'e', pageName: 'p', text: 't' });
    const t = new TextNotFoundError({ elementName: 'e', pageName: 'p', text: 't', snapshotTruncated: true });
    const f = new TextNotFoundError({ elementName: 'e', pageName: 'p', text: 't', snapshotTruncated: false });
    expect(a.snapshotTruncated).toBeUndefined();
    expect(t.snapshotTruncated).toBe(true);
    expect(f.snapshotTruncated).toBe(false);
    expect(t.message).toBe(a.message);
  });
});

test('android: U+FFFE and U+FFFF are unsafe (UiAutomator2 writes ? for them in the page source)', () => {
  expect(pickTextTokens('ab￾cd ok', 'android')).toEqual(['ok']);
  expect(pickTextTokens('ab￿cd ok', 'android')).toEqual(['ok']);
  expect(pickTextTokens('￾', 'android')).toEqual([]);
  expect(pickTextTokens('ab￾cd ok', 'ios')).toEqual(['ok']);
  // The neighbours U+FFFD and U+E000 are XML characters and stay safe.
  expect(pickTextTokens('ab�cd', 'android')).toEqual(['ab�cd']);
});

test('the iOS CONTAINS[cd] model folds case and diacritics', () => {
  expect(fold('STRAẞE')).toBe(fold('straße'));
  expect(fold('Café')).toBe('cafe');
});
