export {
  Element, ElementType, ElementActionOptions, ClickOptions, ScrollIntoViewOptions, SwipeDirection, SwipeOptions,
  LongPressOptions, TapOffset, TapAtOptions, PinchOptions, ZoomOptions, isWeb, isPlatform,
} from './Element';
export { WebElement } from './WebElement';
export { PlatformElement, PlatformElementOptions } from './PlatformElement';
export { ElementChain } from './ElementChain';
// The W3C touch swipe used by platform gestures, so a screen-level swipe can send the same sequence.
export {
  SWIPE_HOLD_MS, SWIPE_MOVE_MS, SWIPE_SETTLE_MS, TouchPoint, TouchAction, TouchPointerSource,
  touchPointers, buildTouchSwipe, performTouchActions, performTouchSwipe,
} from '../utils/touch';
