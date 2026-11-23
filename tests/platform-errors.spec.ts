import { test, expect } from '@playwright/test';
import { PlatformNotSupportedError } from '../src';
import * as root from '../src';

test.describe('PlatformNotSupportedError', () => {
  test('carries method, platform, name and the exact message', () => {
    const err = new PlatformNotSupportedError('pinch', 'web');
    expect(err.message).toBe('"pinch" is not supported on platform "web".');
    expect(err.method).toBe('pinch');
    expect(err.platform).toBe('web');
    expect(err.name).toBe('PlatformNotSupportedError');
  });

  test('instanceof works for both the class and Error', () => {
    const err = new PlatformNotSupportedError('pressBack', 'ios');
    expect(err).toBeInstanceOf(PlatformNotSupportedError);
    expect(err).toBeInstanceOf(Error);
    expect(() => { throw err; }).toThrow(PlatformNotSupportedError);
  });
});

test.describe('package root exports', () => {
  test('exports the platform vocabulary and the error, but not the selector escape helpers', () => {
    expect(typeof root.PlatformNotSupportedError).toBe('function');
    expect(typeof root.familyOf).toBe('function');
    expect(typeof root.isPlatformName).toBe('function');
    expect(root.PLATFORMS).toEqual(['web', 'android', 'ios', 'macos', 'windows']);
    expect('escapeDoubleQuoted' in root).toBe(false);
    expect('escapeUiSelectorString' in root).toBe(false);
  });
});
