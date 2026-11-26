/**
 * The capabilities view the live specs' gates check. Appium takes its
 * options in three spellings: prefixed (`appium:app`), nested in
 * `appium:options` (`{ "appium:options": { "app": ... } }`), and, through
 * some clients, unprefixed (`app`). A gate that only reads the prefixed key
 * would let the other two through, so it checks this flat view instead.
 */

/** W3C capability names, which take no vendor prefix. */
const W3C_CAPABILITIES: ReadonlySet<string> = new Set([
  'browserName', 'browserVersion', 'platformName', 'acceptInsecureCerts', 'pageLoadStrategy', 'proxy',
  'setWindowRect', 'timeouts', 'strictFileInteractability', 'unhandledPromptBehavior', 'webSocketUrl',
]);

/**
 * Returns `caps` with every Appium option spelt `appium:<name>`: the keys
 * of `appium:options` and every top-level key that is neither a W3C name
 * nor vendor-prefixed get the `appium:` prefix. Throws for a wrapped file
 * (`alwaysMatch` / `firstMatch`: the specs take a flat W3C object), for an
 * `appium:options` that is not an object, and for an option given in two
 * spellings with different values. `caps` itself is not changed.
 */
export function flattenCapabilities(caps: Record<string, unknown>): Record<string, unknown> {
  for (const wrapper of ['alwaysMatch', 'firstMatch']) {
    if (wrapper in caps) {
      throw new Error(`CAPABILITIES file must be a flat W3C capabilities object, without "${wrapper}".`);
    }
  }
  const flat: Record<string, unknown> = {};
  const put = (key: string, value: unknown, from: string) => {
    if (key in flat && JSON.stringify(flat[key]) !== JSON.stringify(value)) {
      throw new Error(`CAPABILITIES file gives "${key}" twice with different values (${from}).`);
    }
    flat[key] = value;
  };
  const prefixed = (key: string) => (W3C_CAPABILITIES.has(key) || key.includes(':') ? key : `appium:${key}`);
  for (const [key, value] of Object.entries(caps)) {
    if (key === 'appium:options') continue;
    put(prefixed(key), value, `as "${key}"`);
  }
  const nested = caps['appium:options'];
  if (nested !== undefined) {
    if (!nested || typeof nested !== 'object' || Array.isArray(nested)) {
      throw new Error('CAPABILITIES file "appium:options" must be an object.');
    }
    for (const [key, value] of Object.entries(nested as Record<string, unknown>)) {
      const name = key.includes(':') ? key : `appium:${key}`;
      put(name, value, `in "appium:options" as "${key}"`);
    }
  }
  return flat;
}
