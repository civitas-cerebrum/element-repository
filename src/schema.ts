export interface Selector {
  [key: string]: string;
}

export interface ElementDefinition {
  elementName: string;
  selector: Selector;
  /**
   * The entry has not been confirmed against the running application yet (for
   * example, it was inferred from source code or documentation). Resolution is
   * unaffected; tooling lists such entries through
   * `ElementRepository.getProvisional()` so they can be confirmed or refused
   * before a suite ships. Default `false`.
   */
  provisional?: boolean;
  /**
   * The entry is a collection whose contract is "at least one match"
   * (count ≥ 1), not "exactly one element". Resolution is unaffected;
   * consumers read it through `ElementRepository.getElementMeta()` (e.g. a
   * presence check passes when any match is visible). Default `false`.
   */
  list?: boolean;
}

/** Entry-level metadata of an element definition, with defaults applied. */
export interface ElementMeta {
  provisional: boolean;
  list: boolean;
}

export interface PageObject {
  name: string;
  platform?: string;
  elements: ElementDefinition[];
}

export interface PageObjectSchema {
  pages: PageObject[];
}

export interface Page {
  waitForSelector?(selector: string, options?: any): Promise<any>;
  locator?(selector: string): any;
  $?(selector: string): Promise<any>;
  $$(selector: string): Promise<any[]>;
}