/**
 * A model of how UiAutomator2 and WebDriverAgent answer the narrowed text
 * queries, for mock drivers. It parses a composed query back into its base
 * selector and words (decoding the XPath literals / NSPredicate strings, so
 * an escaping mistake shows as a wrong answer), and filters the base's
 * matches the way the server evaluates the condition:
 *
 * - Android: `(<base>)[(c1 and … and cn) or (.//*[nh and c1] and … and
 *   .//*[nh and cn])]` (no parentheses for one word), `ck` =
 *   `contains(translate(@text, A, B), 'tk')` or `contains(@text, 'tk')`,
 *   `nh` = `not(@showing-hint='true')` — XPath `translate()` maps each
 *   character of A to the one at the same place in B; `contains()` is a
 *   plain substring test.
 * - iOS: own `(label CONTAINS[cd] "t1" AND …) OR (value CONTAINS[cd] "t1"
 *   AND …)` (`label CONTAINS[cd] "t" OR value CONTAINS[cd] "t"` for one
 *   word), descendant `[`NOT (…t1…)`][$type == "XCUIElementTypeStaticText"
 *   AND (…t1…)$]`. `CONTAINS[cd]` is case- and diacritic-insensitive
 *   (modelled as NFD, marks removed, lowercased, `ß` → `ss`); a missing
 *   attribute never contains anything.
 *
 * The parser splits on ` or `, ` and `, ` OR ` and ` AND `: a composed word
 * never holds a space.
 *
 * Mock elements describe themselves with {@link MockFields} (read without
 * going through the element's own, possibly counted, methods).
 */

export interface MockFields {
  /** Android `text` attribute (what `getText()` returns). */
  text?: string | null;
  /** Android `showing-hint="true"`. */
  showingHint?: boolean;
  /** iOS element type. */
  type?: string;
  label?: string | null;
  value?: string | null;
  /** Child elements (raw mocks), in document order. */
  children?: any[];
}

export type FieldsOf = (raw: any) => MockFields;

/** Reads `raw.__fields`, the convention of the specs' mock elements. */
export const fieldsOfMock: FieldsOf = raw => raw?.__fields ?? {};

function descendants(raw: any, fieldsOf: FieldsOf): any[] {
  return (fieldsOf(raw).children ?? []).flatMap(c => [c, ...descendants(c, fieldsOf)]);
}

/** Decodes an XPath 1.0 string literal or a `concat()` of literals. */
export function decodeXPathLiteral(lit: string): string {
  const m = lit.match(/^concat\((.*)\)$/s);
  const parts = m ? m[1].match(/'[^']*'|"[^"]*"/g) ?? [] : [lit];
  return parts.map(p => {
    if (!/^(['"]).*\1$/s.test(p)) throw new Error(`invalid selector: bad XPath literal ${p}`);
    return p.slice(1, -1);
  }).join('');
}

/** Decodes the inside of an NSPredicate double-quoted string. */
export function decodePredicateString(s: string): string {
  return s.replace(/\\(.)/gs, '$1');
}

export function fold(s: string): string {
  return s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/ß/g, 'ss');
}

function iosContains(attr: string | null | undefined, word: string): boolean {
  return typeof attr === 'string' && fold(attr).includes(fold(word));
}

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

/** One Android `contains()` test: the `translate()` map and the word. */
interface AndroidCondition { raw: string; from: string; to: string; word: string }

type Parsed =
  | { kind: 'android'; base: string; conditions: AndroidCondition[] }
  | { kind: 'ios-own'; bases: string[]; words: string[] }
  | { kind: 'ios-desc'; bases: string[]; word: string };

const ANDROID_CONTAINS = /^contains\((?:translate\(@text, ('[^']*'|"[^"]*"), ('[^']*'|"[^"]*")\)|@text), (.+)\)$/s;
const NOT_HINT = ".//*[not(@showing-hint='true') and ";

/** The items of `part`: one item as it is, several in parentheses joined by `sep`. */
function items(part: string, sep: string | RegExp): string[] | null {
  const wrapped = part.startsWith('(') && part.endsWith(')');
  const list = wrapped ? part.slice(1, -1).split(sep) : [part];
  return wrapped === list.length > 1 ? list : null;
}

function parseAndroidContains(s: string): AndroidCondition | null {
  const m = s.match(ANDROID_CONTAINS);
  if (!m) return null;
  const [, from, to, lit] = m;
  return {
    raw: s,
    from: from === undefined ? '' : decodeXPathLiteral(from),
    to: to === undefined ? '' : decodeXPathLiteral(to),
    word: decodeXPathLiteral(lit),
  };
}

/** `<own> or <descendants>`, both naming the same conditions in the same order. */
function parseAndroidCondition(cond: string): AndroidCondition[] | null {
  const halves = cond.split(' or ');
  if (halves.length !== 2) return null;
  const own = items(halves[0], ' and ');
  const desc = items(halves[1], /(?<=\]) and (?=\.\/\/\*\[)/);
  if (!own || !desc || own.length !== desc.length) return null;
  const conditions: AndroidCondition[] = [];
  for (let k = 0; k < own.length; k++) {
    const c = parseAndroidContains(own[k]);
    if (!c || desc[k] !== `${NOT_HINT}${c.raw}]`) return null;
    conditions.push(c);
  }
  return conditions;
}

/** The words of an iOS own predicate, or `null` when it is not one. */
function parseIosOwn(pred: string): string[] | null {
  const sides = pred.split(' OR ');
  if (sides.length !== 2) return null;
  const words = sides.map((side, k) => {
    const list = items(side, ' AND ');
    if (!list) return null;
    const re = new RegExp(`^${k === 0 ? 'label' : 'value'} CONTAINS\\[cd\\] "((?:[^"\\\\]|\\\\.)*)"$`, 's');
    const out: string[] = [];
    for (const item of list) {
      const m = item.match(re);
      if (!m) return null;
      out.push(decodePredicateString(m[1]));
    }
    return out;
  });
  const [label, value] = words;
  if (!label || !value || label.join('\u0000') !== value.join('\u0000')) return null;
  return label;
}

const STR = '"((?:[^"\\\\]|\\\\.)*)"';
const IOS_DESC_CHAIN = new RegExp(
  `^-ios class chain:(.*)\\[\`NOT \\(label CONTAINS\\[cd\\] ${STR} OR value CONTAINS\\[cd\\] "\\2"\\)\`\\]` +
  `\\[\\$type == "XCUIElementTypeStaticText" AND \\(label CONTAINS\\[cd\\] "\\2" OR value CONTAINS\\[cd\\] "\\2"\\)\\$\\]$`, 's',
);
const CHAIN = '-ios class chain:';
const PREDICATE = '-ios predicate string:(';

/** The base selector strings a class chain stands for, most specific first. */
function chainBases(chain: string): string[] {
  const out: string[] = [];
  const pred = chain.match(/^\*\*\/\*\[`(.*)`\]$/s);
  if (pred) {
    out.push(`-ios predicate string:${pred[1]}`);
    const name = pred[1].match(/^name == "((?:[^"\\]|\\.)*)"$/s);
    if (name) out.push(`~${decodePredicateString(name[1])}`);
  }
  const cls = chain.match(/^\*\*\/([A-Za-z_]\w*)$/);
  if (cls) out.push(cls[1]);
  out.push(`-ios class chain:${chain}`);
  return out;
}

function androidBases(base: string): string[] {
  const out: string[] = [];
  const id = base.match(/^\/\/\*\[@resource-id=(.+)\]$/s);
  if (id) out.push(`id=${decodeXPathLiteral(id[1])}`);
  const desc = base.match(/^\/\/\*\[@content-desc=(.+)\]$/s);
  if (desc) out.push(`~${decodeXPathLiteral(desc[1])}`);
  const cls = base.match(/^\/\/([A-Za-z_][\w.]*)$/);
  if (cls) out.push(cls[1]);
  out.push(base);
  return out;
}

/** The composed query `selector` stands for, or `null` when it is not one. */
function parseNarrowed(selector: string): Parsed | null {
  if (selector.startsWith('(') && selector.endsWith(']')) {
    for (let i = selector.indexOf(')['); i >= 0; i = selector.indexOf(')[', i + 1)) {
      const conditions = parseAndroidCondition(selector.slice(i + 2, -1));
      if (conditions) return { kind: 'android', base: selector.slice(1, i), conditions };
    }
  }
  const desc = selector.match(IOS_DESC_CHAIN);
  if (desc) return { kind: 'ios-desc', bases: chainBases(desc[1]), word: decodePredicateString(desc[2]) };
  if (selector.startsWith(CHAIN) && selector.endsWith('`]')) {
    // A composed word holds no backtick: the own predicate is the last one.
    const i = selector.lastIndexOf('[`');
    const words = i < 0 ? null : parseIosOwn(selector.slice(i + 2, -2));
    if (words) return { kind: 'ios-own', bases: chainBases(selector.slice(CHAIN.length, i)), words };
  }
  if (selector.startsWith(PREDICATE) && selector.endsWith(')')) {
    for (let j = selector.lastIndexOf(') AND ('); j >= PREDICATE.length; j = selector.lastIndexOf(') AND (', j - 1)) {
      const words = parseIosOwn(selector.slice(j + 7, -1));
      if (words) return { kind: 'ios-own', bases: [`-ios predicate string:${selector.slice(PREDICATE.length, j)}`], words };
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Answering
// ---------------------------------------------------------------------------

/**
 * The server's answer to `selector` when it is a narrowed text query, or
 * `undefined` when it is not one. `baseMatches(base)` returns the base
 * selector's matches (`undefined` for a selector the mock does not know).
 */
export function answerNarrowed(
  selector: string,
  baseMatches: (base: string) => any[] | undefined,
  fieldsOf: FieldsOf = fieldsOfMock,
): any[] | undefined {
  const parsed = parseNarrowed(selector);
  if (!parsed) return undefined;
  const lookup = (bases: string[]) => {
    for (const b of bases) { const m = baseMatches(b); if (m !== undefined) return m; }
    return [];
  };

  if (parsed.kind === 'android') {
    const has = (raw: any, c: AndroidCondition) => {
      const tr = (s: string) => Array.from(s).map(ch => { const i = c.from.indexOf(ch); return i >= 0 ? c.to[i] : ch; }).join('');
      return tr(fieldsOf(raw).text ?? '').includes(c.word);
    };
    return lookup(androidBases(parsed.base)).filter(raw =>
      parsed.conditions.every(c => has(raw, c))
      || parsed.conditions.every(c => descendants(raw, fieldsOf).some(d => !fieldsOf(d).showingHint && has(d, c))));
  }

  const ownOf = (raw: any, word: string) => {
    const f = fieldsOf(raw);
    return iosContains(f.label, word) || iosContains(f.value, word);
  };
  if (parsed.kind === 'ios-own') {
    return lookup(parsed.bases).filter(raw => {
      const f = fieldsOf(raw);
      return parsed.words.every(w => iosContains(f.label, w)) || parsed.words.every(w => iosContains(f.value, w));
    });
  }
  return lookup(parsed.bases).filter(raw => !ownOf(raw, parsed.word)
    && descendants(raw, fieldsOf).some(d => fieldsOf(d).type === 'XCUIElementTypeStaticText' && ownOf(d, parsed.word)));
}

/** True when `selector` is a narrowed text query (any platform). */
export function isNarrowedQuery(selector: string): boolean {
  return parseNarrowed(selector) !== null;
}

/** The words a narrowed query asks for, in query order (`null` when it is not one). */
export function narrowedWords(selector: string): string[] | null {
  const parsed = parseNarrowed(selector);
  if (!parsed) return null;
  if (parsed.kind === 'android') return parsed.conditions.map(c => c.word);
  return parsed.kind === 'ios-own' ? parsed.words : [parsed.word];
}

/**
 * The selector a query was made against: `selector` itself, or, for a
 * narrowed query, every base selector string it may stand for.
 */
export function queriedBases(selector: string): string[] {
  const parsed = parseNarrowed(selector);
  if (!parsed) return [selector];
  return parsed.kind === 'android' ? androidBases(parsed.base) : parsed.bases;
}

/** True when some query in `queried` was made against `base`. */
export function wasQueried(queried: string[], base: string): boolean {
  return queried.some(q => queriedBases(q).includes(base));
}
