/**
 * Narrowed platform text lookups ("superset narrowing"), shared by the
 * platform `TEXT` selection strategy and `ElementRepository.getByText`.
 * Not part of the package's public API.
 *
 * A text lookup applies its rule (exact beats contains, document order) to
 * every match of the entry's selector. On iOS WebDriverAgent serialises
 * requests, so reading every match of a long list costs seconds. A narrowed
 * lookup first asks the driver for a SUPERSET of the elements whose text
 * could match: the matches of the selector whose own text, or the text of a
 * descendant, contains one word (token) of the wanted text. The rule is then
 * applied only to those hits, in the order the driver returned them.
 *
 * The superset holds every element the rule could choose: the rule's
 * "contains" compares lowercased, whitespace-normalised text, so any text
 * that contains the wanted text contains each of its words, in the same
 * case-insensitive sense the composed query tests. When a query cannot be
 * composed exactly (an unknown selector kind, a word the query cannot
 * express safely), the lookup is not narrowed.
 */
import type { Platform } from '../enum/Platform';
import { escapeDoubleQuoted } from './escape';
import { isSessionLostError } from './driverErrors';

/**
 * The text lookup's normaliser: whitespace runs (JavaScript `\s`, so NBSP
 * and newlines too) become one space, the ends are trimmed, and the result
 * is lowercased.
 */
export function normaliseText(s: string): string {
  return s.replace(/\s+/g, ' ').trim().toLowerCase();
}

// ---------------------------------------------------------------------------
// Case tables
// ---------------------------------------------------------------------------

interface CaseTables {
  /** For a BMP character `c`: every other BMP character whose `toLowerCase()` is exactly `c`. */
  preimages: Map<string, string[]>;
  /** For a BMP character `c`: the characters whose `toLowerCase()` is longer than one character and starts with `c` (U+0130 `İ` → `i̇`). */
  expanding: Map<string, string[]>;
  /** Every character after the first in such an expansion (U+0307). */
  expansionTails: Set<string>;
}

let caseTables: CaseTables | undefined;

/**
 * Built once, from the running engine's own `toLowerCase()`, over the Basic
 * Multilingual Plane. A character outside it never lowercases to or from a
 * BMP character, so astral characters are handled by {@link isUncasedAstral}.
 */
function getCaseTables(): CaseTables {
  if (caseTables) return caseTables;
  const preimages = new Map<string, string[]>();
  const expanding = new Map<string, string[]>();
  const expansionTails = new Set<string>();
  for (let cp = 0; cp <= 0xffff; cp++) {
    if (cp >= 0xd800 && cp <= 0xdfff) continue;
    const ch = String.fromCharCode(cp);
    const lower = ch.toLowerCase();
    if (lower === ch) continue;
    const chars = Array.from(lower);
    const table = chars.length === 1 ? preimages : expanding;
    const list = table.get(chars[0]) ?? [];
    list.push(ch);
    table.set(chars[0], list);
    for (const tail of chars.slice(1)) expansionTails.add(tail);
  }
  caseTables = { preimages, expanding, expansionTails };
  return caseTables;
}

/** True for a character outside the BMP that has no case mapping either way. */
function isUncasedAstral(ch: string): boolean {
  return ch.toLowerCase() === ch && ch.toUpperCase() === ch;
}

/** The two sigmas: `Σ` lowercases to either, depending on its position in the word. */
const SIGMAS = new Set(['σ', 'ς']);

/** Characters no composed query carries: controls and lone surrogates. */
const NEVER_SAFE = /[\p{Cc}\p{Cs}]/u;

/**
 * Characters the iOS query does not use. A backtick or `$` would end the
 * class chain predicate. The rest are characters NSPredicate's `CONTAINS`
 * may match only on whole composed character sequences (combining marks,
 * joiners, variation selectors, emoji and their modifiers, regional
 * indicators, conjoining Hangul jamo), where the rule's plain substring test
 * matches inside one.
 */
const IOS_UNSAFE = /[`$\p{M}‌‍︀-️\u{e0100}-\u{e01ef}\u{1f3fb}-\u{1f3ff}\p{Extended_Pictographic}\p{Regional_Indicator}ᄀ-ᇿꥠ-꥿ힰ-퟿]/u;

/**
 * The XPath `translate()` mapping that lowercases every character whose
 * `toLowerCase()` is a character of `token`, or `null` when the token
 * cannot be matched that way: a sigma (its lowercase depends on context), a
 * character that only appears as the tail of a longer lowercase (U+0307 of
 * `İ` → `i̇`), or a cased character outside the BMP (XPath engines on the
 * JVM translate UTF-16 code units, not characters).
 */
function androidLowercaseMap(token: string): { from: string; to: string } | null {
  const { preimages, expanding, expansionTails } = getCaseTables();
  let from = '';
  let to = '';
  const seen = new Set<string>();
  for (const ch of Array.from(token)) {
    if (seen.has(ch)) continue;
    seen.add(ch);
    if (SIGMAS.has(ch) || expansionTails.has(ch)) return null;
    if (ch.length > 1) {
      if (!isUncasedAstral(ch)) return null;
      continue;
    }
    for (const upper of [...(preimages.get(ch) ?? []), ...(expanding.get(ch) ?? [])]) {
      from += upper;
      to += ch;
    }
  }
  return { from, to };
}

/** True when `token` can be carried by the composed query on `platform`. */
function isSafeToken(token: string, platform: Platform): boolean {
  if (NEVER_SAFE.test(token)) return false;
  if (platform === 'android') return androidLowercaseMap(token) !== null;
  if (platform === 'ios') return !IOS_UNSAFE.test(token);
  return false;
}

/**
 * The word of `needle` a narrowed lookup asks for: the needle is normalised
 * with {@link normaliseText} and split on whitespace, and the longest word
 * (in characters; the first of equal ones) the platform's query can carry
 * is taken. `undefined` when there is none (a blank needle, or every word
 * unsafe), or the platform is not `android` / `ios`: the lookup is then not
 * narrowed.
 */
export function pickTextToken(needle: string, platform: Platform | undefined): string | undefined {
  if (platform !== 'android' && platform !== 'ios') return undefined;
  const words = normaliseText(needle).split(/\s+/).filter(w => w !== '');
  const byLength = words
    .map((word, i) => ({ word, i, length: Array.from(word).length }))
    .sort((a, b) => b.length - a.length || a.i - b.i);
  return byLength.find(w => isSafeToken(w.word, platform))?.word;
}

// ---------------------------------------------------------------------------
// Selector kinds
// ---------------------------------------------------------------------------

/** The WebdriverIO strategy of a selector string, for the kinds a narrowed query can be composed onto. */
export interface SelectorKind {
  using: 'xpath' | 'id' | 'accessibility id' | 'class name' | '-ios class chain' | '-ios predicate string';
  value: string;
}

/** WebdriverIO's explicit `<strategy>:<value>` form (same expression as WebdriverIO 10). */
const DIRECT_SELECTOR = /^(id|css selector|xpath|link text|partial link text|name|tag name|class name|-android uiautomator|-android datamatcher|-android viewmatcher|-android viewtag|-ios uiautomation|-ios predicate string|-ios class chain|accessibility id):(.+)/;
const XPATH_STARTS = ['/', '(', '../', './', '*/'];
const CLASS_NAME_STARTS = ['uia', 'xcuielementtype', 'android.widget', 'cyi', 'android.view'];
const IMAGE_ENDS = ['.jpg', '.jpeg', '.gif', '.png', '.bmp', '.svg'];
const OTHER_STARTS = ['=', '*=', '>>>', 'aria/', 'role/', 'android=', 'ios='];

/**
 * The strategy WebdriverIO 10 sends for `selector` (the same checks, in the
 * same order, as its `findStrategy`), or `null` for every kind a narrowed
 * query is not composed onto (UiAutomator, data / view matchers, images,
 * link text, CSS, ...).
 */
export function selectorKind(selector: string): SelectorKind | null {
  const direct = selector.match(DIRECT_SELECTOR);
  if (direct) {
    const using = direct[1];
    const kinds = ['xpath', 'id', 'accessibility id', 'class name', '-ios class chain', '-ios predicate string'];
    return kinds.includes(using) ? { using: using as SelectorKind['using'], value: direct[2] } : null;
  }
  const lower = selector.toLowerCase();
  if (IMAGE_ENDS.some(ext => lower.endsWith(ext) && lower !== ext)) return null;
  if (XPATH_STARTS.some(start => selector.startsWith(start))) return { using: 'xpath', value: selector };
  if (selector.startsWith('id=')) return { using: 'id', value: selector.slice(3) };
  if (OTHER_STARTS.some(start => selector.startsWith(start))) return null;
  if (selector.startsWith('~')) return { using: 'accessibility id', value: selector.slice(1) };
  if (CLASS_NAME_STARTS.some(start => lower.startsWith(start))) return { using: 'class name', value: selector };
  return null;
}

// ---------------------------------------------------------------------------
// Composed queries
// ---------------------------------------------------------------------------

/**
 * An XPath 1.0 string literal for `s`: `'s'`, else `"s"`, else a
 * `concat()` of single-quoted parts and `"'"`.
 */
export function xpathLiteral(s: string): string {
  if (!s.includes("'")) return `'${s}'`;
  if (!s.includes('"')) return `"${s}"`;
  const parts: string[] = [];
  s.split("'").forEach((part, i) => {
    if (i > 0) parts.push(`"'"`);
    if (part !== '') parts.push(`'${part}'`);
  });
  if (parts.length === 1) parts.push("''");
  return `concat(${parts.join(', ')})`;
}

/** Android class names the XPath tag test can name (no `$` of an inner class). */
const ANDROID_CLASS_NAME = /^[A-Za-z_][A-Za-z0-9_.]*$/;
/** iOS element types a class chain segment can name. */
const IOS_CLASS_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;
/** Characters that would end a class chain predicate. */
const CLASS_CHAIN_DELIMITERS = /[`$]/;

/**
 * The base selector as an XPath that matches the same elements, in the
 * same order: XPath as it is; a full resource id (`<package>:id/<name>`);
 * an accessibility id (`content-desc`); a class name. A short resource id
 * is not converted: UiAutomator2 prefixes it with the current app package,
 * which the selector does not name.
 */
function androidBaseXPath(kind: SelectorKind): string | null {
  switch (kind.using) {
    case 'xpath': return kind.value;
    case 'id': return kind.value.includes(':id/') ? `//*[@resource-id=${xpathLiteral(kind.value)}]` : null;
    case 'accessibility id': return `//*[@content-desc=${xpathLiteral(kind.value)}]`;
    case 'class name': return ANDROID_CLASS_NAME.test(kind.value) ? `//${kind.value}` : null;
    default: return null;
  }
}

/** The base selector as a class chain (without the prefix), for every kind but a predicate string. */
function iosBaseClassChain(kind: SelectorKind): string | null {
  switch (kind.using) {
    case '-ios class chain': return kind.value;
    case 'accessibility id':
      return CLASS_CHAIN_DELIMITERS.test(kind.value) ? null : `**/*[\`name == "${escapeDoubleQuoted(kind.value)}"\`]`;
    case 'class name': return IOS_CLASS_NAME.test(kind.value) ? `**/${kind.value}` : null;
    default: return null;
  }
}

/**
 * The narrowed queries for `selector` and `token` on `platform`, as
 * WebdriverIO selector strings, or `null` when the selector's kind cannot be
 * narrowed (see {@link selectorKind}) or `platform` is neither `android` nor
 * `ios`. `token` must come from {@link pickTextToken} for the same
 * platform.
 *
 * - `android`: ONE XPath, the base's matches whose `text`, or the `text` of
 *   a descendant not showing a hint, contains the token case-insensitively
 *   (`translate()` over every character that lowercases to a character of
 *   the token): `(<base>)[contains(LC(@text), 't') or
 *   .//*[not(@showing-hint='true') and contains(LC(@text), 't')]]`.
 * - `ios`: TWO disjoint queries. Own: the base's matches whose `label` or
 *   `value` contains the token (`CONTAINS[cd]`); descendant: the base's
 *   other matches with an `XCUIElementTypeStaticText` descendant whose
 *   `label` or `value` contains it. A class chain base gets the predicates
 *   appended to its last segment; a predicate string base gets an `AND` for
 *   the own query and becomes the class chain `**\/*[`<pred>`]` for the
 *   descendant query.
 */
export function narrowedTextQueries(selector: string, platform: Platform | undefined, token: string): string[] | null {
  const kind = selectorKind(selector);
  if (!kind) return null;
  if (platform === 'android') {
    const base = androidBaseXPath(kind);
    const map = androidLowercaseMap(token);
    if (base === null || map === null) return null;
    const text = map.from === '' ? '@text' : `translate(@text, ${xpathLiteral(map.from)}, ${xpathLiteral(map.to)})`;
    const contains = `contains(${text}, ${xpathLiteral(token)})`;
    return [`(${base})[${contains} or .//*[not(@showing-hint='true') and ${contains}]]`];
  }
  if (platform === 'ios') {
    const t = escapeDoubleQuoted(token);
    const own = `label CONTAINS[cd] "${t}" OR value CONTAINS[cd] "${t}"`;
    const descendant = `[\`NOT (${own})\`][$type == "XCUIElementTypeStaticText" AND (${own})$]`;
    if (kind.using === '-ios predicate string') {
      if (CLASS_CHAIN_DELIMITERS.test(kind.value)) return null;
      return [
        `-ios predicate string:(${kind.value}) AND (${own})`,
        `-ios class chain:**/*[\`${kind.value}\`]${descendant}`,
      ];
    }
    const chain = iosBaseClassChain(kind);
    if (chain === null) return null;
    return [`-ios class chain:${chain}[\`${own}\`]`, `-ios class chain:${chain}${descendant}`];
  }
  return null;
}

// ---------------------------------------------------------------------------
// Picking a match from the hits
// ---------------------------------------------------------------------------

/** How a hit's text compares with the wanted text under a lookup's rule. */
export type TextVerdict = 'exact' | 'contains' | 'none';

/**
 * The outcome of applying a lookup's rule to the hits of the narrowed
 * queries: the chosen raw element, `null` when no hit matches, or
 * `'ambiguous'` when the winning hits (the exact matches if there are any,
 * else the contains matches) come from more than one query: their order
 * relative to each other is unknown, so only a full pass can tell which one
 * is first in document order.
 */
export type NarrowedPick = { raw: any } | null | 'ambiguous';

/**
 * Applies a lookup's rule to `lists` (the hits of each narrowed query, in
 * query order): each list is read in order until its first exact match.
 */
export async function pickFromHits(lists: any[][], judge: (raw: any) => Promise<TextVerdict>): Promise<NarrowedPick> {
  const exact: any[] = [];
  const contains: any[] = [];
  for (const list of lists) {
    let firstContains: any;
    let found = false;
    for (const raw of list) {
      const verdict = await judge(raw);
      if (verdict === 'exact') { exact.push(raw); found = true; break; }
      if (verdict === 'contains' && firstContains === undefined) firstContains = raw;
    }
    if (!found && firstContains !== undefined) contains.push(firstContains);
  }
  const winners = exact.length > 0 ? exact : contains;
  if (winners.length === 0) return null;
  const ids = new Set(winners.map(raw => raw?.elementId ?? raw));
  return ids.size === 1 ? { raw: winners[0] } : 'ambiguous';
}

/**
 * The hits of each query, in query order (`lists`), or the `error` a query
 * failed with when it is anything but a lost session
 * ({@link isSessionLostError}, rethrown): the caller then reads the full
 * match list instead.
 */
export async function runNarrowedQueries(driver: any, queries: string[]): Promise<{ lists: any[][] } | { error: unknown }> {
  const lists: any[][] = [];
  try {
    for (const query of queries) lists.push(Array.from((await driver.$$(query)) ?? []));
  } catch (err) {
    if (isSessionLostError(err)) throw err;
    return { error: err };
  }
  return { lists };
}
