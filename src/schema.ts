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

export interface PageObjectSchema {
  pages: PageObject[];
}

export interface Page {
  waitForSelector(selector: string, options?: any): Promise<any>;
  locator(selector: string): any;
}