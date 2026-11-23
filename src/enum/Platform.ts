/**
 * The platforms a page repository and a test run can target.
 *
 * - `web` runs in the Playwright driver family.
 * - `android` and `ios` run in the Appium driver family.
 * - `macos` and `windows` are declared so that repositories and configuration
 *   can name them, but desktop support is **not implemented yet**: selector
 *   formatting for them falls back to the base Appium formatter table, and no
 *   desktop-specific behaviour exists.
 */
export type Platform = 'web' | 'android' | 'ios' | 'macos' | 'windows';

/**
 * The driver family that runs a platform: `playwright` for `web`, `appium`
 * for every other platform.
 */
export type DriverFamily = 'playwright' | 'appium';

/** Every {@link Platform} value, in declaration order. */
export const PLATFORMS: readonly Platform[] = Object.freeze(['web', 'android', 'ios', 'macos', 'windows'] as const);

/**
 * Runtime guard: `true` when `value` is one of the {@link PLATFORMS} strings
 * (exact, case-sensitive match).
 * @param value Any value, e.g. a string read from JSON or the environment.
 */
export function isPlatformName(value: unknown): value is Platform {
  return typeof value === 'string' && (PLATFORMS as readonly string[]).includes(value);
}

/**
 * Returns the driver family for a platform.
 *
 * `web` maps to `playwright`; `android`, `ios`, `macos` and `windows` map to
 * `appium`. (`macos` / `windows` are in the Appium family, but desktop support
 * is not implemented yet.)
 * @param platform The platform.
 * @throws Error when `platform` is not a known {@link Platform} at runtime.
 */
export function familyOf(platform: Platform): DriverFamily {
  if (!isPlatformName(platform)) {
    throw new Error(`ElementRepository: unknown platform '${String(platform)}'. Expected one of: ${PLATFORMS.join(', ')}.`);
  }
  return platform === 'web' ? 'playwright' : 'appium';
}
