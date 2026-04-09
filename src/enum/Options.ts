export enum SelectionStrategy {
    INDEX = 'index',
    TEXT = 'text',
    VALUE = 'value',
    ATTRIBUTE = 'attribute',
    RANDOM = 'random',
    ALL = 'all'
}

/**
 * Configuration options for resolving an element.
 */
export interface ElementResolutionOptions {
  /** The selection strategy to use. Defaults to FIRST to prevent strict mode errors. */
  strategy?: SelectionStrategy;
  /** The specific text or attribute value to match. */
  value?: string;
  /** The specific attribute name to check (Required if strategy is ATTRIBUTE). */
  attribute?: string;
  /** The zero-based index of the element to select (Required if strategy is INDEX). */
  index?: number;
}