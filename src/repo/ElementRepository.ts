import * as fs from 'fs';
import * as path from 'path';

import { PageRepository, PageRepositoryInput, PageObject, ElementMeta } from '../schema/repository';
import { Platform, PLATFORMS, isPlatformName } from '../enum/Platform';
import { pickRandomIndex } from '../utils/math';
import { Element, PlatformElement } from '../types';
import { detectDriverPlatform } from '../utils/platformText';
import { pickTextToken, narrowedTextQueries, runNarrowedQueries, pickFromHits } from '../utils/textNarrowing';
import {
  SelectorFormatter,
  WEB_FORMATTERS, APPIUM_FORMATTERS, ANDROID_FORMATTERS, IOS_FORMATTERS,
} from './formatters';
import { ElementResolutionOptions, SelectionStrategy } from '../enum/Options';
import { EnhancedResolver } from './EnhancedResolver';
import { StrategyResolver } from './StrategyResolver';
import { TextNotFoundError } from '../types/errors';

/** Default element wait timeout in milliseconds. */
const DEFAULT_TIMEOUT = 15000;

/**
 * Options for the {@link ElementRepository} constructor's options-object form.
 */
export interface ElementRepositoryOptions {
  /**
   * The ACTIVE platform of this repository instance. When set, every lookup
   * by page name only considers page blocks whose `platform` (missing means
   * `'web'`) equals it, so one file can hold `LoginPage` once per platform.
   * When omitted, lookup takes the first page with the given name (the
   * behaviour of earlier versions).
   *
   * `'macos'` and `'windows'` are accepted but not implemented yet: pages for
   * them resolve with the base Appium selector formatter table, with no
   * desktop-specific behaviour.
   */
  platform?: Platform;
  /**
   * Default element wait timeout in milliseconds, the same value
   * {@link ElementRepository.setDefaultTimeout} sets. Default `15000`.
   */
  defaultTimeout?: number;
  /**
   * Alias of {@link ElementRepositoryOptions.defaultTimeout}, kept for
   * callers written against the earlier name. When both are given,
   * `defaultTimeout` wins.
   */
  timeout?: number;
}

/**
 * Platform-agnostic element lookup engine backed by a JSON repository.
 *
 * Maps human-readable page/element names to platform-specific selectors and
 * returns unified {@link Element} wrappers (either {@link WebElement} for
 * Playwright or {@link PlatformElement} for WebDriverIO/Appium). Every
 * element is automatically waited for before it is returned.
 *
 * **Active platform.** A repository built with `{ platform }` resolves every
 * page name against the page block for that platform only. If the name exists
 * only for other platforms, lookups throw
 * `ElementRepository: page '<name>' has no entry for platform '<active>'. Available: <platforms>.`
 * — there is no silent fallback to another platform's block. The active
 * platform is held per instance (no static or global state), so repositories
 * for different platforms can be used side by side over the same data.
 */
export class ElementRepository {
  private pageData: PageRepository;
  private defaultTimeout: number;

  /** The active platform of this instance, or `undefined` for first-match lookup. */
  private readonly _platform: Platform | undefined;

  /**
   * The Playwright `Page` or WebDriverIO `Browser`/`Driver` instance used for
   * element interactions.
   */
  private _driver: any;

  /**
   * Initializes the repository with a driver, the page repository, and
   * optionally a default timeout or an options object.
   *
   * The repository data is validated on construction (see {@link validate}).
   *
   * @param driver The Playwright `Page` or WebDriverIO `Browser`/`Driver` instance.
   * @param fileOrData Path to the JSON file (relative to the project root), or
   *   the parsed data as a {@link PageRepository} — or a
   *   {@link PageRepositoryInput}, the same shape as a typed JSON import
   *   produces it (string `platform` / `frameIndex`, checked at runtime).
   * @param options Either a number — the default element wait timeout in
   *   milliseconds (earlier versions' positional form) — or
   *   `{ platform?, defaultTimeout? }` (see {@link ElementRepositoryOptions};
   *   `timeout` is accepted as an alias of `defaultTimeout`).
   *   Omitted: no active platform, timeout 15000.
   * @throws Error when the repository is invalid, or when `options.platform`
   *   is not a known {@link Platform}.
   */
  constructor(
    driver: any,
    fileOrData: string | PageRepository | PageRepositoryInput,
    options?: number | ElementRepositoryOptions,
  ) {
    this._driver = driver;
    if (typeof fileOrData === 'string') {
      const absolutePath = path.resolve(process.cwd(), fileOrData);
      const rawData = fs.readFileSync(absolutePath, 'utf-8');
      this.pageData = JSON.parse(rawData);
    } else {
      // validate() below rejects any platform / frameIndex value outside PageRepository.
      this.pageData = fileOrData as PageRepository;
    }
    ElementRepository.validate(this.pageData);

    const opts: ElementRepositoryOptions =
      typeof options === 'number' ? { defaultTimeout: options } : (options ?? {});
    if (opts.platform !== undefined && !isPlatformName(opts.platform)) {
      throw new Error(
        `ElementRepository: unknown platform '${String(opts.platform)}'. Expected one of: ${PLATFORMS.join(', ')}.`,
      );
    }
    this._platform = opts.platform;
    this.defaultTimeout = opts.defaultTimeout ?? opts.timeout ?? DEFAULT_TIMEOUT;
  }

  /**
   * The active platform of this instance, as given in the constructor's
   * options; `undefined` when none was given (first-name-match lookup).
   * Read-only.
   */
  public get platform(): Platform | undefined {
    return this._platform;
  }

  /** Entry-level boolean keys and the only values they accept. */
  private static readonly BOOLEAN_ENTRY_KEYS = ['provisional', 'list'] as const;

  /**
   * Validates a repository without a driver — usable from a lint step as well
   * as from the constructor. Checks:
   *
   * - a page's `platform`, when present, is a {@link Platform} (exact,
   *   case-sensitive; legacy values such as `"mobile"` are rejected);
   * - a page `name` appears at most once per platform (a missing `platform`
   *   counts as `'web'`);
   * - a page's `frameIndex`, when present, is `"first"`, `"last"` or an
   *   integer (passed to Playwright's `frameLocator(...).nth()`, where a
   *   negative index counts from the end: `-1` is the last frame);
   * - entry-level `provisional` and `list`, when present, are JSON booleans:
   *   a string such as `"true"` is rejected rather than silently read as
   *   truthy or ignored.
   * @param data The parsed repository.
   * @throws Error `ElementRepository: invalid repository — <problems>.`,
   *   listing every problem found, separated by `; `.
   */
  public static validate(data: PageRepository | PageRepositoryInput): void {
    const problems: string[] = [];
    const seen = new Set<string>();
    const reportedDuplicates = new Set<string>();
    for (const page of data?.pages ?? []) {
      const platformValue: unknown = page.platform;
      if (platformValue !== undefined && !isPlatformName(platformValue)) {
        problems.push(
          `page '${page.name}' has "platform": ${JSON.stringify(platformValue)} (expected one of: ${PLATFORMS.join(', ')})`,
        );
      }
      const effectivePlatform = String(platformValue ?? 'web');
      const key = JSON.stringify([page.name, effectivePlatform]);
      if (seen.has(key)) {
        if (!reportedDuplicates.has(key)) {
          reportedDuplicates.add(key);
          problems.push(`page '${page.name}' is declared more than once for platform "${effectivePlatform}"`);
        }
      } else {
        seen.add(key);
      }
      const frameIndex: unknown = page.frameIndex;
      if (frameIndex !== undefined && frameIndex !== 'first' && frameIndex !== 'last'
        && !(typeof frameIndex === 'number' && Number.isInteger(frameIndex))) {
        problems.push(
          `page '${page.name}' has "frameIndex": ${JSON.stringify(frameIndex)} (expected "first", "last" or an integer)`,
        );
      }
      for (const element of page.elements ?? []) {
        for (const key of ElementRepository.BOOLEAN_ENTRY_KEYS) {
          const value = (element as unknown as Record<string, unknown>)[key];
          if (value !== undefined && typeof value !== 'boolean') {
            problems.push(`'${page.name}.${element.elementName}' has "${key}": ${JSON.stringify(value)} (expected true or false)`);
          }
        }
      }
    }
    if (problems.length > 0) {
      throw new Error(`ElementRepository: invalid repository — ${problems.join('; ')}.`);
    }
  }

  /**
   * The Playwright `Page` or WebDriverIO `Browser`/`Driver` instance provided
   * at construction time.
   */
  public get driver(): any {
    return this._driver;
  }

  /**
   * Updates the default timeout for all subsequent element retrievals.
   * @param timeout The new timeout in milliseconds.
   */
  public setDefaultTimeout(timeout: number): void {
    this.defaultTimeout = timeout;
  }

  /**
   * Returns the platform of the given page, or `'web'` if not specified.
   * With an active platform set, this is the active platform whenever the
   * page exists for it.
   * @param pageName The name of the page block in the JSON repository.
   * @returns The platform (e.g. `'web'`, `'android'`, `'ios'`).
   * @throws Error if the page is not found (see {@link ElementRepository} for
   * the message when an active platform is set).
   */
  public getPagePlatform(pageName: string): Platform {
    return this.requirePage(pageName).platform ?? 'web';
  }

  // ══════════════════════════════════════════════════════════════
  // Element Resolution
  // ══════════════════════════════════════════════════════════════

  /**
   * Creates the platform-appropriate Element wrapper and waits for it to
   * be attached in the DOM / exist in the view hierarchy.
   *
   * Resolution order:
   * 1. Enhanced selectors (role+name, regex text, iframe) via {@link EnhancedResolver}
   * 2. Standard selectors (css, xpath, id, text, etc.) via {@link StrategyResolver}
   *
   * @param elementName The specific element name to look up.
   * @param pageName The name of the page block in the JSON repository.
   * @param options Optional element resolution options (strategy, index, value, etc.).
   * @returns A promise that resolves to the located Element.
   * @throws Error if the page is not found.
   */
  private async resolveElement(elementName: string, pageName: string, options?: ElementResolutionOptions): Promise<Element> {
    const pageObj = this.requirePage(pageName);

    const elementDef = pageObj.elements.find((e) => e.elementName === elementName);
    if (!elementDef) throw new Error(`ElementRepository: Element '${elementName}' not found on page '${pageName}'.`);

    // Walk the fallback chain: resolve from the primary selector entry; if it
    // matches zero elements within the probe timeout, walk into
    // `selector.fallback` recursively. The primary is always attempted even
    // without a fallback — backwards-compatible with pre-0.1.6 behaviour.
    return this.resolveWithFallback(pageObj, elementName, elementDef.selector, pageName, options);
  }

  /**
   * Resolves `selector` for `elementName`; walks `selector.fallback`
   * recursively when the primary does not attach within the probe timeout,
   * or when resolving the primary throws (an eager strategy such as TEXT on
   * a platform page that found no match). Returns the resolved `Element`
   * (matched or terminal fallback); when the primary threw and the rest of
   * the chain fails too, the primary's error is rethrown.
   *
   * **Probe timeout = `this.defaultTimeout`** (the repository's configured
   * element timeout — 15s by default, user-overridable via the
   * `ElementRepository` constructor). This matches the single-selector
   * resolution budget: an element that would have appeared within the
   * standard element timeout still has the full budget to do so before
   * fallback kicks in. On slow-loading pages (SPA hydration, XHR-gated
   * content), the primary is never walked past prematurely.
   *
   * **No-fallback path is unchanged** — elements without a `fallback` key
   * skip the probe entirely and return the lazy locator, preserving
   * pre-0.1.6 behaviour where the full element timeout is applied at
   * action time (`element.click()`, `element.fill()`, etc.).
   *
   * Trade-off: an N-step fallback chain where no node matches can take up
   * to `N × defaultTimeout` before returning the terminal element. In
   * practice fallbacks are defined to cover real DOM variants, so the
   * first or second level matches on pages where the primary doesn't.
   */
  private async resolveWithFallback(
    pageObj: PageObject,
    elementName: string,
    selector: { [key: string]: unknown },
    pageName: string,
    options: ElementResolutionOptions | undefined,
  ): Promise<Element> {
    const fallback = (selector as { fallback?: Record<string, unknown> }).fallback;
    if (!fallback) {
      // No fallback — return the lazy locator. The full element timeout
      // applies at action time via `element.waitFor(...)`, preserving the
      // pre-fallback-chain behaviour exactly.
      return this.resolveFromSingleSelector(pageObj, elementName, selector, pageName, options);
    }

    // Eager strategies (e.g. TEXT on a platform page) throw during resolution
    // instead of returning a lazy element for the probe below. Treat such a
    // throw like a failed probe and walk the fallback; if the rest of the
    // chain fails too, surface the primary's error.
    let element: Element;
    try {
      element = await this.resolveFromSingleSelector(pageObj, elementName, selector, pageName, options);
    } catch (primaryError) {
      try {
        return await this.resolveWithFallback(pageObj, elementName, fallback, pageName, options);
      } catch {
        throw primaryError;
      }
    }

    // Wait for the primary to attach. Probe budget is `options.timeout` when
    // provided (caller-supplied override — e.g. a non-throwing visibility
    // probe with a short deadline), otherwise the repo's configured
    // `defaultTimeout`. `waitFor` resolves the moment the element appears;
    // the timeout only caps the wait. Throws on timeout or detachment,
    // which triggers the fallback walk.
    //
    // The probe waits on the FIRST match: "this node attached" means "at
    // least one element matches". Waiting on the whole match set would trip
    // Playwright's strict mode as soon as it holds more than one element, so
    // the ALL strategy (and `getAll()`) used to walk past a multi-match
    // primary onto its fallback. The full match set is still returned.
    const attachTimeout = options?.timeout ?? this.defaultTimeout;
    try {
      await element.first().waitFor({ state: 'attached', timeout: attachTimeout });
      return element;
    } catch {
      return this.resolveWithFallback(pageObj, elementName, fallback, pageName, options);
    }
  }

  /**
   * Resolves a single `selector` entry (one node of the fallback chain) into
   * an `Element` using the existing enhanced / standard resolution paths. Does
   * not look at `selector.fallback` — that walk is owned by `resolveWithFallback`.
   */
  private async resolveFromSingleSelector(
    pageObj: PageObject,
    elementName: string,
    selector: { [key: string]: unknown },
    pageName: string,
    options: ElementResolutionOptions | undefined,
  ): Promise<Element> {
    // Try enhanced resolution first (role+name, regex text, iframe), feeding
    // it a synthetic element definition that exposes only the current node of
    // the fallback chain so the resolver doesn't accidentally see a nested
    // fallback key.
    const syntheticPage: PageObject = {
      ...pageObj,
      elements: [{ elementName, selector: this.stripFallback(selector) as PageObject['elements'][number]['selector'] }],
    };

    const enhanced = EnhancedResolver.resolve(
      this._driver, syntheticPage, elementName, this.getFormattersForPlatform(pageObj.platform ?? 'web'),
    );

    const attachTimeout = options?.timeout ?? this.defaultTimeout;

    if (enhanced !== null) {
      if (EnhancedResolver.isWebPlatform(pageObj)) {
        return StrategyResolver.fromLocator(enhanced, elementName, pageName, attachTimeout, options);
      } else {
        return StrategyResolver.fromMobileSelector(this._driver, enhanced as string, attachTimeout, options, pageObj.platform);
      }
    }

    // Standard resolution path — format via platform selector formatter.
    const formatted = this.formatSingleSelector(pageObj, selector);
    return StrategyResolver.fromSelector(this._driver, formatted, pageObj, elementName, pageName, attachTimeout, options);
  }

  /** Returns a copy of `selector` with the `fallback` key stripped. */
  private stripFallback(selector: { [key: string]: unknown }): { [key: string]: unknown } {
    const copy: { [key: string]: unknown } = {};
    for (const key of Object.keys(selector)) {
      if (key !== 'fallback') copy[key] = selector[key];
    }
    return copy;
  }

  /**
   * Platform-formats the first string-valued strategy of a single selector
   * node. Mirrors `getSelector` but operates on an arbitrary selector object
   * instead of a repo lookup — used by the fallback walker.
   */
  private formatSingleSelector(pageObj: PageObject, selector: { [key: string]: unknown }): string {
    const stripped = this.stripFallback(selector);
    for (const key of Object.keys(stripped)) {
      if (typeof stripped[key] === 'string') {
        const formatters = this.getFormattersForPlatform(pageObj.platform ?? 'web');
        const formatter = formatters[key.toLowerCase()];
        return formatter ? formatter(stripped[key] as string) : (stripped[key] as string);
      }
    }
    // No plain-string strategy — fall back to the first key (enhanced
    // selectors would have been picked up earlier).
    const firstKey = Object.keys(stripped)[0];
    const value = stripped[firstKey];
    return typeof value === 'string' ? value : JSON.stringify(value);
  }

  // ══════════════════════════════════════════════════════════════
  // Public Query API
  // ══════════════════════════════════════════════════════════════

  /**
   * Retrieves a single Element based on the externalized JSON mapping.
   * @param elementName The specific element name to look up.
   * @param pageName The name of the page block in the JSON repository.
   * @param options Optional element resolution options.
   * @returns A promise that resolves to an Element.
   */
  public async get(elementName: string, pageName: string, options?: ElementResolutionOptions): Promise<Element> {
    return this.resolveElement(elementName, pageName, options);
  }

  /**
   * Retrieves an array of Elements matching the mapped selector.
   * @param elementName The specific element name to look up.
   * @param pageName The name of the page block in the JSON repository.
   * @returns A promise that resolves to an array of Elements.
   */
  public async getAll(elementName: string, pageName: string): Promise<Element[]> {
    const el = await this.resolveElement(elementName, pageName, { strategy: SelectionStrategy.ALL });
    return el.all();
  }

  /**
   * Randomly selects one element from a list of elements matching the given selector.
   * @param elementName The specific element name to look up.
   * @param pageName The name of the page block in the JSON repository.
   * @param strict If true, throws an error if no elements are found. Defaults to false.
   * @returns A promise that resolves to a randomly selected Element, or null if none are found.
   */
  public async getRandom(elementName: string, pageName: string, strict: boolean = false): Promise<Element | null> {
    try {
      return await this.resolveElement(elementName, pageName, { strategy: SelectionStrategy.RANDOM });
    } catch {
      const msg = `No elements found for '${elementName}' on '${pageName}'`;
      if (strict) throw new Error(msg);
      console.warn(msg);
      return null;
    }
  }

  /**
   * Filters an element list and returns the first element matching the specified text.
   *
   * Matching strategy: first attempts an exact match (trimmed), then falls back
   * to a contains match if no exact match is found.
   *
   * On iOS and Android pages the elements compared are narrowed first, as
   * for the platform `TEXT` strategy: the driver is asked only for the
   * matches whose own or descendant text contains the longest safe word of
   * `desiredText` (case-insensitively), and this method's own comparison
   * (exact, then case-sensitive contains, in document order) is applied to
   * those hits. It compares every match instead when the selector kind or
   * the text cannot be narrowed, when a narrowed query fails (a lost
   * session or connection is thrown; any other error of that query is not
   * reported), or when on iOS the winning hits come from both narrowed
   * queries. Known limit (Android): the narrowed XPath runs on the page
   * source, capped at `snapshotMaxDepth` (default 70), so a match deeper
   * than that is not found.
   *
   * @param elementName The specific element name to look up.
   * @param pageName The name of the page block in the JSON repository.
   * @param desiredText The string of text to search for within the elements.
   * @param strict If true, throws a {@link TextNotFoundError} (`cleanMiss` true) if the element is not found. Defaults to false.
   * @returns A promise that resolves to the matched Element, or null if not found.
   */
  public async getByText(elementName: string, pageName: string, desiredText: string, strict: boolean = false): Promise<Element | null> {
    const base = await this.resolveElement(elementName, pageName, { strategy: SelectionStrategy.ALL });

    const narrowed = await this.narrowedGetByText(base, pageName, desiredText);
    if (narrowed) return narrowed;
    if (narrowed === undefined) {
      const allElements = await base.all();

      // Each element's text is read once. An exact match wins, so the first
      // one returns at once; the texts read are kept for the contains pass.
      const texts: Array<string | undefined> = [];
      for (const element of allElements) {
        const text = (await element.textContent())?.trim();
        if (text === desiredText) return element;
        texts.push(text);
      }

      const index = texts.findIndex(text => text?.includes(desiredText));
      if (index >= 0) return allElements[index];
    }

    // A text read that fails is not caught here, so a miss is always clean.
    const notFound = new TextNotFoundError({ elementName, pageName, text: desiredText, cleanMiss: true });
    if (strict) throw notFound;
    console.warn(notFound.message);
    return null;
  }

  /**
   * `getByText` on a platform element, narrowed (see `textNarrowing`): the
   * composed queries' hits are compared with `getByText`'s own rule (the
   * trimmed `textContent()` equal to `desiredText`, else the first that
   * includes it, case-sensitively). Returns the match, `null` for a miss,
   * or `undefined` when the lookup is not narrowed (a web element, a
   * selector kind or text that cannot be narrowed, a composed query the
   * driver could not run, or winning hits from two iOS queries whose
   * relative order is unknown): the caller then compares every match.
   */
  private async narrowedGetByText(base: Element, pageName: string, desiredText: string): Promise<Element | null | undefined> {
    if (!(base instanceof PlatformElement)) return undefined;
    const pagePlatform = this.requirePage(pageName).platform;
    const platform = pagePlatform ?? detectDriverPlatform(base.driver);
    const token = pickTextToken(desiredText, platform);
    const queries = token === undefined ? null : narrowedTextQueries(base.selector, platform, token);
    if (!queries) return undefined;
    const hits = await runNarrowedQueries(base.driver, queries);
    if ('error' in hits) return undefined;

    // The same element `getAll()` would hand out for this match.
    const wrap = (raw: any) => new PlatformElement(base.driver, base.selector, raw, this.defaultTimeout, { platform: pagePlatform });
    const picked = await pickFromHits(hits.lists, async raw => {
      const text = (await wrap(raw).textContent())?.trim();
      if (text === desiredText) return 'exact';
      return text?.includes(desiredText) ? 'contains' : 'none';
    });
    if (picked === 'ambiguous') return undefined;
    return picked ? wrap(picked.raw) : null;
  }

  /**
   * Filters elements by a specific HTML attribute value.
   *
   * Matching strategy: when `exact` is not specified, first attempts an exact
   * match, then falls back to a contains match. When `exact` is explicitly set,
   * only that matching mode is used.
   *
   * @param elementName The specific element name to look up.
   * @param pageName The name of the page block in the JSON repository.
   * @param attribute The HTML attribute name to filter by.
   * @param value The attribute value to match against.
   * @param options Optional configuration.
   * @param options.exact If true, requires an exact attribute match. If false, matches when the attribute contains the value. If omitted, tries exact first then falls back to contains.
   * @param options.strict If true, throws an error when no matching element is found. Defaults to false.
   * @returns A promise that resolves to the matched Element, or null if not found.
   */
  public async getByAttribute(
    elementName: string,
    pageName: string,
    attribute: string,
    value: string,
    options: { exact?: boolean; strict?: boolean } = {}
  ): Promise<Element | null> {
    const { exact, strict = false } = options;
    const allElements = await this.getAll(elementName, pageName);

    // Shared with the ATTRIBUTE selection strategy — one filtering
    // implementation, two entry points (see StrategyResolver.filterByAttribute).
    const match = await StrategyResolver.filterByAttribute(allElements, attribute, value, exact);
    if (match) return match;

    const matchType = exact === true ? 'equal to' : exact === false ? 'containing' : 'matching';
    const msg = `Element '${elementName}' on '${pageName}' with attribute [${attribute}] ${matchType} "${value}" not found.`;
    if (strict) throw new Error(msg);
    console.warn(msg);
    return null;
  }

  /**
   * Returns the nth matching element from a list of elements.
   * @param elementName The specific element name to look up.
   * @param pageName The name of the page block in the JSON repository.
   * @param index The zero-based index of the element to retrieve.
   * @param strict If true, throws an error if the index is out of bounds. Defaults to false.
   * @returns A promise that resolves to the Element at the given index, or null if out of bounds.
   */
  public async getByIndex(elementName: string, pageName: string, index: number, strict: boolean = false): Promise<Element | null> {
    const allElements = await this.getAll(elementName, pageName);
    if (index < 0 || index >= allElements.length) {
      const msg = `Index ${index} out of bounds for '${elementName}' on '${pageName}' (found ${allElements.length} elements).`;
      if (strict) throw new Error(msg);
      console.warn(msg);
      return null;
    }
    return allElements[index];
  }

  /**
   * Returns the first visible element matching the selector.
   * @param elementName The specific element name to look up.
   * @param pageName The name of the page block in the JSON repository.
   * @param strict If true, throws an error if no visible element is found. Defaults to false.
   * @returns A promise that resolves to a visible Element, or null if none are visible.
   */
  public async getVisible(elementName: string, pageName: string, strict: boolean = false): Promise<Element | null> {
    const allElements = await this.getAll(elementName, pageName);
    for (const element of allElements) {
      if (await element.isVisible()) return element;
    }
    const msg = `No visible elements found for '${elementName}' on '${pageName}'.`;
    if (strict) throw new Error(msg);
    console.warn(msg);
    return null;
  }

  /**
   * Filters elements by their ARIA role attribute and returns the first match.
   * @param elementName The specific element name to look up.
   * @param pageName The name of the page block in the JSON repository.
   * @param role The ARIA role value to filter by (e.g., 'button', 'link', 'tab').
   * @param strict If true, throws an error if no matching element is found. Defaults to false.
   * @returns A promise that resolves to the matched Element, or null if not found.
   */
  public async getByRole(elementName: string, pageName: string, role: string, strict: boolean = false): Promise<Element | null> {
    return this.getByAttribute(elementName, pageName, 'role', role, { exact: true, strict });
  }

  // ══════════════════════════════════════════════════════════════
  // Entry Metadata
  // ══════════════════════════════════════════════════════════════

  /**
   * Returns the entry-level metadata of an element definition with defaults
   * applied (`provisional: false`, `list: false`). Synchronous — reads the
   * repository data only, never the driver.
   * @param elementName The specific element name to look up.
   * @param pageName The name of the page block in the JSON repository.
   * @returns `{ provisional, list }`.
   * @throws Error if the page or element is not found.
   */
  public getElementMeta(elementName: string, pageName: string): ElementMeta {
    const page = this.requirePage(pageName);
    const element = (page.elements ?? []).find((e) => e.elementName === elementName);
    if (!element) throw new Error(`ElementRepository: Element '${elementName}' not found on page '${pageName}'.`);
    return { provisional: element.provisional === true, list: element.list === true };
  }

  /**
   * Lists every entry marked `"provisional": true`, in repository order — the
   * work list of entries still to be confirmed against the running application.
   * With an active platform set, only pages whose `platform` (missing means
   * `'web'`) equals it are listed; without one, every page is.
   * @returns An array of `{ pageName, elementName }`.
   */
  public getProvisional(): Array<{ pageName: string; elementName: string }> {
    const out: Array<{ pageName: string; elementName: string }> = [];
    const active = this._platform;
    for (const page of this.pageData.pages) {
      if (active !== undefined && (page.platform ?? 'web') !== active) continue;
      for (const element of page.elements ?? []) {
        if (element.provisional === true) out.push({ pageName: page.name, elementName: element.elementName });
      }
    }
    return out;
  }

  // ══════════════════════════════════════════════════════════════
  // Selector Access
  // ══════════════════════════════════════════════════════════════

  /**
   * Returns the raw selector strategy and value without Playwright-specific formatting.
   * Skips enhanced keys (object values like regex patterns) and returns the first
   * key with a plain string value.
   * @param elementName The specific element name to look up.
   * @param pageName The name of the page block in the JSON repository.
   * @returns An object with `strategy` (e.g. 'css', 'xpath', 'id') and `value` (the raw selector value).
   * @throws Error if the page, element, or selector is not found.
   */
  public getSelectorRaw(elementName: string, pageName: string): { strategy: string; value: string } {
    const page = this.requirePage(pageName);

    const element = page.elements.find((e) => e.elementName === elementName);
    if (!element) throw new Error(`ElementRepository: Element '${elementName}' not found on page '${pageName}'.`);

    const selector = element.selector;
    if (!selector || Object.keys(selector).length === 0) {
      throw new Error(`ElementRepository: Invalid selector for '${elementName}'.`);
    }

    // Find the first key with a plain string value (skip enhanced keys like 'name' with objects)
    for (const key of Object.keys(selector)) {
      if (typeof selector[key] === 'string') {
        return { strategy: key, value: selector[key] as string };
      }
    }

    // Fallback: return first key (may be an object for enhanced selectors resolved elsewhere)
    const strategy = Object.keys(selector)[0] as string;
    const value = selector[strategy];
    return { strategy, value: typeof value === 'string' ? value : JSON.stringify(value) };
  }

  /**
   * Returns a platform-appropriate selector string based on the page's platform field.
   *
   * **Web (Playwright) selector keys:** css, xpath, id, text, testid, role, placeholder, label
   *
   * **Non-web (Appium) selector keys:** accessibility id, xpath, id, css, uiautomator,
   * predicate, class chain, class name, tag name, name, android data matcher,
   * android view matcher, android view tag, text
   *
   * All space-separated keys also accept camelCase aliases (e.g., `accessibilityId`,
   * `androidUIAutomator`, `iOSNsPredicateString`, `iOSClassChain`, `className`,
   * `tagName`, `androidDataMatcher`, `androidViewMatcher`, `androidViewTag`).
   *
   * @param elementName The specific element name to look up.
   * @param pageName The name of the page block in the JSON repository.
   * @returns A selector string formatted for Playwright (web) or Appium (non-web).
   * @throws Error if the page, element, or selector is not found.
   */
  public getSelector(elementName: string, pageName: string): string {
    const { strategy, value } = this.getSelectorRaw(elementName, pageName);
    const page = this.requirePage(pageName);
    const formatters = this.getFormattersForPlatform(page.platform ?? 'web');
    const formatter = formatters[strategy.toLowerCase()];
    return formatter ? formatter(value) : value;
  }

  // ══════════════════════════════════════════════════════════════
  // Internal Helpers
  // ══════════════════════════════════════════════════════════════

  /**
   * Finds a page by name, honouring the active platform.
   *
   * - Active platform set: the page whose `name` matches AND whose
   *   `platform ?? 'web'` equals the active platform.
   * - No active platform: the first page whose `name` matches.
   * @param pageName The name of the page block in the JSON repository.
   * @returns The matching PageObject, or undefined if not found.
   */
  private findPage(pageName: string): PageObject | undefined {
    const active = this._platform;
    if (active === undefined) return this.pageData.pages.find((p) => p.name === pageName);
    return this.pageData.pages.find((p) => p.name === pageName && (p.platform ?? 'web') === active);
  }

  /**
   * Like {@link findPage}, but throws when no page matches. Every public
   * method that takes a `pageName` resolves it through here.
   * @param pageName The name of the page block in the JSON repository.
   * @returns The matching PageObject.
   * @throws Error — without an active platform:
   *   `ElementRepository: Page '<name>' not found.`; with one:
   *   `ElementRepository: page '<name>' has no entry for platform '<active>'. Available: <list>.`
   *   where `<list>` is the comma-separated platforms that do declare the
   *   page, in file order, or `none`.
   */
  private requirePage(pageName: string): PageObject {
    const page = this.findPage(pageName);
    if (page) return page;
    if (this._platform === undefined) {
      throw new Error(`ElementRepository: Page '${pageName}' not found.`);
    }
    const available: string[] = [];
    for (const p of this.pageData.pages) {
      if (p.name !== pageName) continue;
      const platform = p.platform ?? 'web';
      if (!available.includes(platform)) available.push(platform);
    }
    throw new Error(
      `ElementRepository: page '${pageName}' has no entry for platform '${this._platform}'. Available: ${available.length ? available.join(', ') : 'none'}.`,
    );
  }

  /**
   * Returns the {@link SelectorFormatter} lookup table for the given platform.
   * Falls back to the base {@link APPIUM_FORMATTERS} for unrecognised non-web platforms.
   * @param platform The platform string (e.g. `'web'`, `'android'`, `'ios'`).
   * @returns The formatter record for the specified platform.
   */
  private getFormattersForPlatform(platform: string): Record<string, SelectorFormatter> {
    if (platform === 'web') return WEB_FORMATTERS;
    if (platform === 'android') return ANDROID_FORMATTERS;
    if (platform === 'ios') return IOS_FORMATTERS;
    return APPIUM_FORMATTERS;
  }
}
