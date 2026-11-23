/**
 * String escaping for selector arguments. Used by the formatter tables and
 * the enhanced resolver; not part of the package's public API.
 */

/**
 * Escapes a value for use inside a double-quoted string literal of an
 * NSPredicate (iOS predicate string): backslashes first, then quotes.
 * NSPredicate decodes both `\\` and `\"`. Not for UiSelector arguments
 * (Android `text` escapes double quotes only; see {@link escapeUiSelectorString}).
 */
export function escapeDoubleQuoted(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

/**
 * Escapes a value for use inside a double-quoted UiSelector argument
 * (Android UiAutomator2): double quotes only. UiAutomator2's UiSelector
 * parser is not a Java string parser: it decodes `\"` to `"` but never `\\`
 * to `\`, so a backslash is passed through unchanged (`C:\dir` stays
 * `C:\dir`). Consequently a value that ends in `\` cannot be expressed in
 * a UiSelector argument (its closing quote would read as escaped), so it is
 * rejected with an error that points to an `xpath` selector.
 * Shared with the enhanced (role / regex) Android selectors.
 *
 * @throws When `value` ends in a backslash.
 */
export function escapeUiSelectorString(value: string): string {
  if (value.endsWith('\\')) {
    throw new Error(
      `UiSelector argument ${JSON.stringify(value)} ends in a backslash, which UiSelector cannot express ` +
      '(the closing quote would read as escaped); use an xpath selector for this element instead',
    );
  }
  return value.replace(/"/g, '\\"');
}
