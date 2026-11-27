/**
 * An attribute value as UiAutomator2 returned it, with a missing attribute
 * as `null`.
 *
 * UiAutomator2 answers `getAttribute` for an attribute the element lacks
 * with the literal string `"null"`, not `null`. Reads whose result is
 * returned, compared by content or tested for presence go through here
 * (`getAttribute`, the element class, the input hint) so a missing
 * attribute is never taken for the four-letter value. Reads compared only
 * to a fixed value such as `"true"` need no mapping.
 *
 * @param value - The value `getAttribute` returned on an Android element.
 * @returns `null` for `null`, `undefined` or `"null"`; otherwise the value as a string.
 */
export function androidAttribute(value: unknown): string | null {
  if (value === null || value === undefined || value === 'null') return null;
  return String(value);
}
