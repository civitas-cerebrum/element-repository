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
