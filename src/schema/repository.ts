/** Strategy-to-value mapping for a single selector (e.g. `{ css: "button.primary" }`). */
export interface Selector {
  [key: string]: string;
}

/** A named element within a page, paired with its locator strategy. */
export interface ElementDefinition {
  elementName: string;
  selector: Selector;
}

/**
 * A page block in the JSON repository.
 * Groups related elements under a name and an optional platform discriminator.
 */
export interface PageObject {
  name: string;
  platform?: string;
  elements: ElementDefinition[];
}

/** Top-level shape of the JSON element repository file. */
export interface PageRepository {
  pages: PageObject[];
}
