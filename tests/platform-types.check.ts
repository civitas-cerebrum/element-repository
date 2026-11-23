/**
 * Compile-time checks for the public constructor and repository types.
 *
 * This file is not a spec and never runs. `tests/platform-lookup.spec.ts`
 * type-checks it with the TypeScript compiler (the project `tsconfig.json`
 * excludes `tests/`, so `tsc --noEmit` alone would not see it). Every line
 * must compile; each `@ts-expect-error` must be a real error.
 */
import {
  ElementRepository,
  ElementRepositoryOptions,
  PageRepository,
  PageRepositoryInput,
  Platform,
  Element, WebElement, PlatformElement, isWeb, isPlatform, ClickOptions, TapAtOptions, LongPressOptions,
  PinchOptions, ZoomOptions, SwipeDirection, SwipeOptions, ScrollIntoViewOptions,
  SWIPE_HOLD_MS, SWIPE_MOVE_MS, SWIPE_SETTLE_MS, buildTouchSwipe, performTouchSwipe, TouchPointerSource,
  TouchAction, TouchSwipeOptions,
} from '../src';
import pages from './platform-pages.json';

declare const driver: unknown;
declare const optionsUnion: number | ElementRepositoryOptions;
declare const maybeOptions: number | ElementRepositoryOptions | undefined;
declare const fileOrData: string | PageRepository | PageRepositoryInput;
declare const platform: Platform;

// A variable typed as the union is accepted (number = default timeout).
new ElementRepository(driver, pages, optionsUnion);
new ElementRepository(driver, 'tests/platform-pages.json', optionsUnion);
new ElementRepository(driver, fileOrData, maybeOptions);

// Each form on its own.
new ElementRepository(driver, pages);
new ElementRepository(driver, pages, 5000);
new ElementRepository(driver, pages, { platform, defaultTimeout: 1000 });
new ElementRepository(driver, pages, { platform, timeout: 1000 });
new ElementRepository(driver, pages, {});

// A typed JSON import (resolveJsonModule) is a PageRepositoryInput, including
// its widened `platform` and `frameIndex` strings.
const input: PageRepositoryInput = pages;
ElementRepository.validate(input);
ElementRepository.validate(pages);

// The strict type still narrows platform to the vocabulary.
const strict: PageRepository = { pages: [{ name: 'A', platform: 'ios', frameIndex: 0, elements: [] }] };
new ElementRepository(driver, strict, { platform: 'android' });

// @ts-expect-error an unknown platform literal is rejected by the strict type
const badPlatform: PageRepository = { pages: [{ name: 'A', platform: 'mobile', elements: [] }] };

// @ts-expect-error a string is not an options value
new ElementRepository(driver, strict, 'ios');

void badPlatform;

// Element contract: gestures return the element, the guards narrow, and the
// gesture option types and touch helpers are exported from the root.
declare const el: Element;
async function elementContract(): Promise<void> {
  const chained: Element = await (await (await (await el.longPress()).tapAt({ x: 1, y: 1 })).pinch()).zoom();
  const raw: string | null = await chained.rawText();
  const click: ClickOptions = { withoutScrolling: true, timeout: 1 };
  const tap: TapAtOptions = { timeout: 1 };
  const opts: [LongPressOptions, PinchOptions, ZoomOptions, SwipeOptions, ScrollIntoViewOptions] = [{}, {}, {}, {}, {}];
  const dir: SwipeDirection = 'left';
  await el.click(click);
  if (isWeb(el)) { const w: WebElement = el; void w.locator; }
  if (isPlatform(el)) { const p: PlatformElement = el; void p.driver; }
  const sequence: TouchPointerSource[] = buildTouchSwipe({ x: 0, y: 0 }, { x: 1, y: 1 });
  const timing: TouchSwipeOptions = { holdMs: 0, moveMs: 300 };
  const timed: TouchPointerSource[] = buildTouchSwipe({ x: 0, y: 0 }, { x: 1, y: 1 }, timing);
  await performTouchSwipe(driver, { x: 0, y: 0 }, { x: 1, y: 1 });
  await performTouchSwipe(driver, { x: 0, y: 0 }, { x: 1, y: 1 }, { moveMs: 300 });
  const ms: number = SWIPE_HOLD_MS + SWIPE_MOVE_MS + SWIPE_SETTLE_MS;
  const scroll: ScrollIntoViewOptions = { direction: 'up', maxSwipes: 5, timeout: 1 };
  const actions: TouchAction[] = [
    { type: 'pointerMove', duration: 0, origin: 'viewport', x: 1, y: 2 },
    { type: 'pointerDown', button: 0 },
    { type: 'pause', duration: 10 },
    { type: 'pointerUp', button: 0 },
  ];
  // @ts-expect-error an unknown action type is not a TouchAction
  const badType: TouchAction = { type: 'keyDown', value: 'a' };
  // @ts-expect-error a pointerMove needs coordinates
  const noCoords: TouchAction = { type: 'pointerMove', duration: 0 };
  // @ts-expect-error a swipe timing is a number of ms
  buildTouchSwipe({ x: 0, y: 0 }, { x: 1, y: 1 }, { holdMs: '100' });
  void raw; void tap; void opts; void dir; void sequence; void timed; void ms; void scroll; void actions; void badType; void noCoords;
}
void elementContract;
