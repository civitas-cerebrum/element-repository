/**
 * A model of how UiAutomator2 and WebDriverAgent answer the narrowed text
 * queries, for mock drivers. It parses a composed query back into its base
 * selector and word (decoding the XPath literal / NSPredicate string, so an
 * escaping mistake shows as a wrong answer), and filters the base's matches
 * the way the server evaluates the condition:
 *
 * - Android: `(<base>)[contains(translate(@text, A, B), 't') or
 *   .//*[not(@showing-hint='true') and contains(translate(@text, A, B), 't')]]`
 *   — XPath `translate()` maps each character of A to the one at the same
 *   place in B; `contains()` is a plain substring test.
 * - iOS: `CONTAINS[cd]` — case- and diacritic-insensitive (modelled as
 *   NFD, marks removed, lowercased, `ß` → `ss`); a missing attribute never
 *   contains anything.
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

const ANDROID_QUERY = /^\((.*)\)\[contains\((translate\(@text, (.+?), (.+?)\)|@text), (.+?)\) or \.\/\/\*\[not\(@showing-hint='true'\) and contains\(\2, \5\)\]\]$/s;

const STR = '"((?:[^"\\\\]|\\\\.)*)"';
const OWN = `label CONTAINS\\[cd\\] ${STR} OR value CONTAINS\\[cd\\] "\\2"`;
const OWN3 = `label CONTAINS\\[cd\\] ${STR} OR value CONTAINS\\[cd\\] "\\3"`;
const IOS_OWN_CHAIN = new RegExp(`^-ios class chain:(.*)\\[\`${OWN}\`\\]$`, 's');
const IOS_DESC_CHAIN = new RegExp(
  `^-ios class chain:(.*)\\[\`NOT \\(${OWN}\\)\`\\]\\[\\$type == "XCUIElementTypeStaticText" AND \\(label CONTAINS\\[cd\\] "\\2" OR value CONTAINS\\[cd\\] "\\2"\\)\\$\\]$`, 's',
);
const IOS_OWN_PREDICATE = new RegExp(`^-ios predicate string:\\((.*)\\) AND \\((${OWN3})\\)$`, 's');

export function fold(s: string): string {
  return s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/ß/g, 'ss');
}

function iosContains(attr: string | null | undefined, word: string): boolean {
  return typeof attr === 'string' && fold(attr).includes(fold(word));
}

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
  const lookup = (bases: string[]) => {
    for (const b of bases) { const m = baseMatches(b); if (m !== undefined) return m; }
    return [];
  };

  const a = selector.match(ANDROID_QUERY);
  if (a) {
    const [, base, , from, to, lit] = a;
    const src = from === undefined ? '' : decodeXPathLiteral(from);
    const dst = to === undefined ? '' : decodeXPathLiteral(to);
    const word = decodeXPathLiteral(lit);
    const tr = (s: string) => Array.from(s).map(ch => { const i = src.indexOf(ch); return i >= 0 ? dst[i] : ch; }).join('');
    const has = (raw: any) => tr(fieldsOf(raw).text ?? '').includes(word);
    return lookup(androidBases(base)).filter(raw =>
      has(raw) || descendants(raw, fieldsOf).some(d => !fieldsOf(d).showingHint && has(d)));
  }

  const ownOf = (raw: any, word: string) => {
    const f = fieldsOf(raw);
    return iosContains(f.label, word) || iosContains(f.value, word);
  };
  const own = selector.match(IOS_OWN_CHAIN);
  if (own) {
    const word = decodePredicateString(own[2]);
    return lookup(chainBases(own[1])).filter(raw => ownOf(raw, word));
  }
  const desc = selector.match(IOS_DESC_CHAIN);
  if (desc) {
    const word = decodePredicateString(desc[2]);
    return lookup(chainBases(desc[1])).filter(raw => !ownOf(raw, word)
      && descendants(raw, fieldsOf).some(d => fieldsOf(d).type === 'XCUIElementTypeStaticText' && ownOf(d, word)));
  }
  const ownPred = selector.match(IOS_OWN_PREDICATE);
  if (ownPred) {
    const word = decodePredicateString(ownPred[3]);
    return lookup([`-ios predicate string:${ownPred[1]}`]).filter(raw => ownOf(raw, word));
  }
  return undefined;
}

/** True when `selector` is a narrowed text query (any platform). */
export function isNarrowedQuery(selector: string): boolean {
  return ANDROID_QUERY.test(selector) || IOS_OWN_CHAIN.test(selector) || IOS_DESC_CHAIN.test(selector) || IOS_OWN_PREDICATE.test(selector);
}

/**
 * The selector a query was made against: `selector` itself, or, for a
 * narrowed query, every base selector string it may stand for.
 */
export function queriedBases(selector: string): string[] {
  const a = selector.match(ANDROID_QUERY);
  if (a) return androidBases(a[1]);
  const chain = selector.match(IOS_OWN_CHAIN) ?? selector.match(IOS_DESC_CHAIN);
  if (chain) return chainBases(chain[1]);
  const pred = selector.match(IOS_OWN_PREDICATE);
  if (pred) return [`-ios predicate string:${pred[1]}`];
  return [selector];
}

/** True when some query in `queried` was made against `base`. */
export function wasQueried(queried: string[], base: string): boolean {
  return queried.some(q => queriedBases(q).includes(base));
}
