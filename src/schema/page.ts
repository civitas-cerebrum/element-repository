/**
 * Structural interface describing the page or driver instance passed to
 * {@link ElementRepository} methods.
 *
 * Both Playwright `Page` and WebDriverIO `Browser` satisfy this contract,
 * allowing the repository to work across platforms without importing
 * framework-specific types.
 */
export interface Page {
  /**
   * Waits for an element matching the selector to appear in the DOM.
   * Used by Playwright pages.
   * @param selector - The selector string to wait for.
   * @param options  - Optional wait configuration (e.g. `{ timeout }`).
   */
  waitForSelector?(selector: string, options?: any): Promise<any>;

  /**
   * Creates a Playwright {@link Locator} for the given selector.
   * @param selector - A Playwright-compatible selector string.
   */
  locator?(selector: string): any;

  /**
   * Locates a single element via WebDriverIO's `$` command.
   * @param selector - An Appium-compatible selector string.
   */
  $?(selector: string): Promise<any>;

  /**
   * Locates all matching elements via WebDriverIO's `$$` command.
   * @param selector - An Appium-compatible selector string.
   */
  $$(selector: string): Promise<any[]>;
}
