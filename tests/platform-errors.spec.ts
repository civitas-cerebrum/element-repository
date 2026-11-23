import { test, expect } from '@playwright/test';
import { PlatformNotSupportedError } from '../src';

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
