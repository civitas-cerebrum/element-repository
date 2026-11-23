/**
 * Compile-time check: every WebdriverIO call that PlatformElement and
 * StrategyResolver make exists on WebdriverIO 10's `Browser` / `Element`
 * types with the argument shapes the source uses.
 *
 * This file is not a spec and never runs. `tests/platform-wdio10-wire.spec.ts`
 * type-checks it with the TypeScript compiler against the installed
 * `webdriverio` devDependency. Keep it in step with the driver calls in
 * src/types/PlatformElement.ts and src/repo/StrategyResolver.ts.
 */
import type {} from 'webdriverio';

declare const driver: WebdriverIO.Browser;
declare const id: string;
declare const actions: Array<Record<string, unknown>>;

export async function browserCalls(): Promise<void> {
  // Locating ($ / $$) and the element id the protocol commands take.
  const el: WebdriverIO.Element = await driver.$('~x', { strict: false });
  const elementId: string = el.elementId;
  const all = await driver.$$('~x');
  const list: WebdriverIO.Element[] = Array.from(all);
  void elementId; void list;

  // Protocol commands with an element id.
  const rect: { x: number; y: number; width: number; height: number } = await driver.getElementRect(id);
  const css: string = await driver.getElementCSSValue(id, 'color');
  const shot: string = await driver.takeElementScreenshot(id);
  void rect; void css; void shot;

  // W3C actions (raw protocol) used by swipe, scrollIntoView and the gestures.
  await driver.performActions(actions);
  await driver.releaseActions();

  // Browser commands.
  const size: { width: number; height: number } = await driver.getWindowSize();
  await driver.pause(200);
  await driver.keys('a');
  void size;

  // Appium keyboard commands and `mobile:` execute used by scrollIntoView.
  const shown: boolean = await driver.isKeyboardShown();
  await driver.hideKeyboard();
  await driver.execute('mobile: hideKeyboard', { strategy: 'tapOutside' });
  void shown;

  // Session facts read for the platform name.
  const caps: WebdriverIO.Capabilities = driver.capabilities;
  const ios: boolean = driver.isIOS;
  const android: boolean = driver.isAndroid;
  void caps; void ios; void android;
}

export async function elementCalls(el: WebdriverIO.Element, target: WebdriverIO.Element): Promise<void> {
  await el.click();
  await el.doubleClick();
  await el.moveTo();
  await el.clearValue();
  await el.setValue('text');
  await el.addValue('t');
  await el.dragAndDrop(target);
  const selected: boolean = await el.isSelected();
  const displayed: boolean = await el.isDisplayed();
  const existing: boolean = await el.isExisting();
  const text: string = await el.getText();
  const value: string = await el.getValue();
  const attr: string | null = await el.getAttribute('name');
  const tag: string = await el.getTagName();
  void selected; void displayed; void existing; void text; void value; void attr; void tag;

  await el.waitForExist({ timeout: 1000 });
  await el.waitForExist({ timeout: 1000, reverse: true });
  await el.waitForDisplayed({ timeout: 1000 });
  await el.waitForDisplayed({ timeout: 1000, reverse: true });

  // Child lookups under a parent element (locateChild).
  const child: WebdriverIO.Element = await el.$('~child', { strict: false });
  const children: WebdriverIO.Element[] = Array.from(await el.$$('~child'));
  void child; void children;
}
