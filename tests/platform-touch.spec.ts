import { test, expect } from '@playwright/test';
import {
  SWIPE_HOLD_MS, SWIPE_MOVE_MS, SWIPE_SETTLE_MS, buildTouchSwipe, performTouchSwipe, performTouchActions, touchPointers,
  SWEEP_HOLD_MS, SWEEP_MOVE_MS, SWEEP_RELEASE_HOLD_MS, SWEEP_START_FRACTION, SWEEP_END_FRACTION, SWEEP_EDGE_BAND,
} from '../src';

function recordingDriver(overrides: Record<string, any> = {}): { driver: any; calls: any[] } {
  const calls: any[] = [];
  const driver = {
    performActions: async (a: any) => { calls.push(['performActions', a]); },
    releaseActions: async () => { calls.push(['releaseActions']); },
    ...overrides,
  };
  return { driver, calls };
}

test.describe('touch swipe helpers', () => {
  test('the constants are the gesture timings', () => {
    expect([SWIPE_HOLD_MS, SWIPE_MOVE_MS, SWIPE_SETTLE_MS]).toEqual([100, 600, 200]);
  });

  test('the sweep constants: timings and geometry of a scrollIntoView swipe', () => {
    expect([SWEEP_HOLD_MS, SWEEP_MOVE_MS, SWEEP_RELEASE_HOLD_MS]).toEqual([50, 300, 200]);
    expect([SWEEP_START_FRACTION, SWEEP_END_FRACTION, SWEEP_EDGE_BAND]).toEqual([0.85, 0.15, 0.1]);
  });

  test('releaseHoldMs holds the finger at the end point before it lifts', () => {
    const [finger] = buildTouchSwipe({ x: 0, y: 0 }, { x: 0, y: 9 }, { releaseHoldMs: 200 });
    expect(finger.actions.slice(3)).toEqual([
      { type: 'pointerMove', duration: SWIPE_MOVE_MS, origin: 'viewport', x: 0, y: 9 },
      { type: 'pause', duration: 200 },
      { type: 'pointerUp', button: 0 },
    ]);
  });

  test('no releaseHoldMs, or 0: the finger lifts on arrival, no pause sent', () => {
    for (const options of [undefined, { releaseHoldMs: 0 }]) {
      const [finger] = buildTouchSwipe({ x: 0, y: 0 }, { x: 0, y: 9 }, options);
      expect(finger.actions.map(a => a.type)).toEqual(['pointerMove', 'pointerDown', 'pause', 'pointerMove', 'pointerUp']);
    }
  });

  test('buildTouchSwipe is one touch finger: move, down, hold, move, up (rounded)', () => {
    expect(buildTouchSwipe({ x: 10.4, y: 500.6 }, { x: 10, y: 100 })).toEqual([{
      type: 'pointer',
      id: 'finger1',
      parameters: { pointerType: 'touch' },
      actions: [
        { type: 'pointerMove', duration: 0, origin: 'viewport', x: 10, y: 501 },
        { type: 'pointerDown', button: 0 },
        { type: 'pause', duration: SWIPE_HOLD_MS },
        { type: 'pointerMove', duration: SWIPE_MOVE_MS, origin: 'viewport', x: 10, y: 100 },
        { type: 'pointerUp', button: 0 },
      ],
    }]);
  });

  test('buildTouchSwipe takes the hold and move times as options', () => {
    const [finger] = buildTouchSwipe({ x: 0, y: 0 }, { x: 0, y: 9 }, { holdMs: 0, moveMs: 250 });
    expect(finger.actions[2]).toEqual({ type: 'pause', duration: 0 });
    expect(finger.actions[3]).toEqual({ type: 'pointerMove', duration: 250, origin: 'viewport', x: 0, y: 9 });
  });

  test('an omitted timing keeps its default', () => {
    const [finger] = buildTouchSwipe({ x: 0, y: 0 }, { x: 0, y: 9 }, { moveMs: 250 });
    expect(finger.actions[2]).toEqual({ type: 'pause', duration: SWIPE_HOLD_MS });
    expect(buildTouchSwipe({ x: 0, y: 0 }, { x: 0, y: 9 }, {})).toEqual(buildTouchSwipe({ x: 0, y: 0 }, { x: 0, y: 9 }));
  });

  test('performTouchSwipe passes its timings to the swipe it sends', async () => {
    const { driver, calls } = recordingDriver();
    await performTouchSwipe(driver, { x: 1, y: 2 }, { x: 3, y: 4 }, { holdMs: 50, moveMs: 900 });
    expect(calls).toEqual([
      ['performActions', buildTouchSwipe({ x: 1, y: 2 }, { x: 3, y: 4 }, { holdMs: 50, moveMs: 900 })],
      ['releaseActions'],
    ]);
    expect(calls[0][1][0].actions[3].duration).toBe(900);
  });

  test('touchPointers names fingers in order', () => {
    expect(touchPointers([[], []]).map(s => s.id)).toEqual(['finger1', 'finger2']);
  });

  test('performTouchSwipe sends the swipe and releases', async () => {
    const { driver, calls } = recordingDriver();
    await performTouchSwipe(driver, { x: 1, y: 2 }, { x: 3, y: 4 });
    expect(calls).toEqual([['performActions', buildTouchSwipe({ x: 1, y: 2 }, { x: 3, y: 4 })], ['releaseActions']]);
  });

  test('a failed gesture is still released, and its own error wins over a release error', async () => {
    const { driver, calls } = recordingDriver({
      performActions: async () => { throw new Error('gesture failed'); },
      releaseActions: async () => { calls.push(['releaseActions']); throw new Error('release failed'); },
    });
    await expect(performTouchActions(driver, buildTouchSwipe({ x: 1, y: 1 }, { x: 2, y: 2 }))).rejects.toThrow('gesture failed');
    expect(calls).toEqual([['releaseActions']]);
  });

  test('a release error after a good gesture is thrown', async () => {
    const { driver } = recordingDriver({ releaseActions: async () => { throw new Error('release failed'); } });
    await expect(performTouchSwipe(driver, { x: 1, y: 1 }, { x: 2, y: 2 })).rejects.toThrow('release failed');
  });
});
