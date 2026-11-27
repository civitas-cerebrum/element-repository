// Export all schema types
export * from './schema';

// The repository shapes the ElementRepository constructor accepts. Named
// exports only: `./schema/repository` also declares `Selector`, `PageObject`
// and friends, which would clash with the `./schema` exports above.
export type { PageRepository, PageRepositoryInput } from './schema/repository';

// Export the platform vocabulary and the shared platform error
export * from './enum/Platform';
export { PlatformNotSupportedError } from './types/errors';

// Export enums and options
export * from './enum/Options';

// Export standalone utilities
export * from './utils/math';
export { isFatalDriverError } from './utils/driverErrors';
// The soft keyboard dismissal the platform element runs before a scrollIntoView sweep.
export { dismissKeyboard, KeyboardStillShownError, KEYBOARD_SETTLE_MS, IOS_DISMISS_KEYS, TAP_ELEMENT_WAIT_MS } from './utils/keyboard';
export type { DismissKeyboardOptions } from './utils/keyboard';
// The W3C touch swipe used by platform gestures, so a screen-level swipe can send the same sequence.
export {
  SWIPE_HOLD_MS, SWIPE_MOVE_MS, SWIPE_SETTLE_MS, touchPointers, buildTouchSwipe, performTouchActions, performTouchSwipe,
  SWEEP_HOLD_MS, SWEEP_MOVE_MS, SWEEP_RELEASE_HOLD_MS, SWEEP_START_FRACTION, SWEEP_END_FRACTION, SWEEP_EDGE_BAND,
} from './utils/touch';
export type { TouchPoint, TouchAction, TouchPointerSource, TouchSwipeOptions } from './utils/touch';

// Export element types
export * from './types';

// Export the primary class and selector formatters
export { ElementRepository } from './repo';
export type { SelectorFormatter } from './repo';
export * from './repo';
