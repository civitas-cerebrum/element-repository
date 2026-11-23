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
// The W3C touch swipe used by platform gestures, so a screen-level swipe can send the same sequence.
export {
  SWIPE_HOLD_MS, SWIPE_MOVE_MS, SWIPE_SETTLE_MS, touchPointers, buildTouchSwipe, performTouchActions, performTouchSwipe,
} from './utils/touch';
export type { TouchPoint, TouchAction, TouchPointerSource, TouchSwipeOptions } from './utils/touch';

// Export element types
export * from './types';

// Export the primary class and selector formatters
export { ElementRepository } from './repo';
export type { SelectorFormatter } from './repo';
export * from './repo';
