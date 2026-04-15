import { PageObject } from '../schema/repository';
import { Element, WebElement, PlatformElement } from '../types';
import { ElementResolutionOptions, SelectionStrategy } from '../enum/Options';
import { pickRandomIndex } from '../utils/math';
import { EnhancedResolver } from './EnhancedResolver';

/**
 * Creates platform-appropriate Element wrappers and applies selection
 * strategies (FIRST, INDEX, RANDOM, TEXT, ALL).
 *
 * This module handles the mechanical work of constructing WebElement or
 * PlatformElement instances from a locator/selector and applying the
 * requested strategy on top.
 */
export class StrategyResolver {

  /**
   * Creates an Element from a Playwright Locator (web enhanced path)
   * and applies the requested selection strategy.
   */
  static async fromLocator(
    locator: any,
    elementName: string,
    pageName: string,
    timeout: number,
    options?: ElementResolutionOptions,
  ): Promise<Element> {
    const desc = `enhanced:${elementName}@${pageName}`;

    if (options?.strategy) {
      switch (options.strategy) {
        case SelectionStrategy.INDEX: {
          if (options.index === undefined || options.index === null) {
            throw new Error('options.index is required when using SelectionStrategy.INDEX');
          }
          const base = new WebElement(locator, desc, timeout);
          const all = await base.all();
          if (options.index < 0 || options.index >= all.length) {
            throw new Error(`Index ${options.index} out of bounds for '${elementName}' on '${pageName}' (found ${all.length} elements).`);
          }
          return all[options.index];
        }
        case SelectionStrategy.RANDOM: {
          const base = new WebElement(locator, desc, timeout);
          const all = await base.all();
          if (all.length === 0) {
            throw new Error(`No elements found for '${elementName}' on '${pageName}'`);
          }
          return all[pickRandomIndex(all.length)];
        }
        case SelectionStrategy.ALL: {
          const element = new WebElement(locator, desc, timeout);
          await element.waitFor({ state: 'attached', timeout }).catch(() => {});
          return element;
        }
        case SelectionStrategy.TEXT: {
          if (!options.value) {
            throw new Error('options.value is required when using SelectionStrategy.TEXT');
          }
          const filtered = locator.filter({ hasText: options.value });
          const element = new WebElement(filtered.first(), desc, timeout);
          await element.waitFor({ state: 'attached', timeout }).catch(() => {});
          return element;
        }
        default:
          break;
      }
    }

    const element = new WebElement(locator.first(), desc, timeout);
    await element.waitFor({ state: 'attached', timeout }).catch(() => {});
    return element;
  }

  /**
   * Creates an Element from a selector string and applies the requested
   * selection strategy. Branches on platform to produce WebElement or
   * PlatformElement.
   */
  static async fromSelector(
    driver: any,
    selector: string,
    pageObj: PageObject,
    elementName: string,
    pageName: string,
    timeout: number,
    options?: ElementResolutionOptions,
  ): Promise<Element> {
    const isWeb = EnhancedResolver.isWebPlatform(pageObj);

    if (options?.strategy) {
      switch (options.strategy) {
        case SelectionStrategy.INDEX: {
          if (options.index === undefined || options.index === null) {
            throw new Error('options.index is required when using SelectionStrategy.INDEX');
          }
          const base = isWeb
            ? new WebElement(driver.locator(selector), selector, timeout)
            : new PlatformElement(driver, selector, undefined, timeout);
          const all = await base.all();
          if (options.index < 0 || options.index >= all.length) {
            throw new Error(`Index ${options.index} out of bounds for '${elementName}' on '${pageName}' (found ${all.length} elements).`);
          }
          return all[options.index];
        }
        case SelectionStrategy.RANDOM: {
          const base = isWeb
            ? new WebElement(driver.locator(selector), selector, timeout)
            : new PlatformElement(driver, selector, undefined, timeout);
          const all = await base.all();
          if (all.length === 0) {
            throw new Error(`No elements found for '${elementName}' on '${pageName}'`);
          }
          return all[pickRandomIndex(all.length)];
        }
        case SelectionStrategy.TEXT: {
          if (!options.value) {
            throw new Error('options.value is required when using SelectionStrategy.TEXT');
          }
          const baseLocator = driver.locator(selector);
          const filtered = baseLocator.filter({ hasText: options.value });
          const element = isWeb
            ? new WebElement(filtered.first(), selector, timeout)
            : new PlatformElement(driver, selector, undefined, timeout);
          await element.waitFor({ state: 'attached', timeout }).catch(() => {});
          return element;
        }
        case SelectionStrategy.ALL: {
          const element = isWeb
            ? new WebElement(driver.locator(selector), selector, timeout)
            : new PlatformElement(driver, selector, undefined, timeout);
          await element.waitFor({ state: 'attached', timeout }).catch(() => {});
          return element;
        }
        default:
          break;
      }
    }

    const base = isWeb
      ? new WebElement(driver.locator(selector), selector, timeout)
      : new PlatformElement(driver, selector, undefined, timeout);
    const element = base.first();
    await element.waitFor({ state: 'attached', timeout }).catch(() => {});
    return element;
  }

  /**
   * Creates a PlatformElement from a mobile selector string (enhanced path).
   */
  static async fromMobileSelector(
    driver: any,
    selector: string,
    timeout: number,
    options?: ElementResolutionOptions,
  ): Promise<Element> {
    const base = new PlatformElement(driver, selector, undefined, timeout);

    if (options?.strategy === SelectionStrategy.ALL) {
      await base.waitFor({ state: 'attached', timeout }).catch(() => {});
      return base;
    }

    const element = base.first();
    await element.waitFor({ state: 'attached', timeout }).catch(() => {});
    return element;
  }
}
