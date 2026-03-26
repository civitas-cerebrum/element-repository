export interface Selector {
  [key: string]: string;
}

export interface ElementDefinition {
  elementName: string;
  selector: Selector;
}

export interface PageObject {
  name: string;
  platform?: string;
  elements: ElementDefinition[];
}

export interface PageRepository {
  pages: PageObject[];
}
