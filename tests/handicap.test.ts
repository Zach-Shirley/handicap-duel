import { describe, expect, it } from 'vitest';
import {
  applyRoundResult,
  describeChange,
  fromLegacy,
  MANUAL_SIZE_MIN,
  MANUAL_SPEED_MAX,
  neutral,
  nudge,
  sanitize,
  type Handicaps,
} from '../src/handicap';

const names: [string, string] = ['Zach', 'Sis'];

function winsBy(h: Handicaps, winner: 0 | 1, n: number, effect: 'speed' | 'size') {
  for (let i = 0; i < n; i++) h = applyRoundResult(h, winner, effect);
  return h;
}

describe('automatic handicap', () => {
  it('starts neutral', () => {
    expect(neutral()).toEqual({ speed: [1, 1], size: [1, 1] });
  });

  it('a host win slows the host by 8% of current speed', () => {
    const h = applyRoundResult(neutral(), 0, 'speed');
    expect(h.speed).toEqual([0.92, 1]);
    expect(h.size).toEqual([1, 1]);
  });

  it('has no limit: speed keeps shrinking but never reaches zero', () => {
    const h = winsBy(neutral(), 0, 60, 'speed');
    expect(h.speed[0]).toBeGreaterThan(0);
    expect(h.speed[0]).toBeLessThan(0.01);
  });

  it('size grows 16 points per win with no limit', () => {
    const h = winsBy(neutral(), 0, 30, 'size');
    expect(h.size[0]).toBeCloseTo(1 + 0.16 * 30);
    expect(h.speed).toEqual([1, 1]);
  });

  it('guest wins take the host handicap back, exactly to normal', () => {
    let h = winsBy(neutral(), 0, 3, 'speed');
    h = winsBy(h, 1, 3, 'speed');
    expect(h.speed).toEqual([1, 1]);
    let z = winsBy(neutral(), 0, 2, 'size');
    z = winsBy(z, 1, 2, 'size');
    expect(z.size).toEqual([1, 1]);
  });

  it('never handicaps the guest for winning', () => {
    expect(applyRoundResult(neutral(), 1, 'speed')).toEqual(neutral());
    expect(applyRoundResult(neutral(), 1, 'size')).toEqual(neutral());
  });

  it('a host win eases a manual guest handicap before touching the host', () => {
    const h: Handicaps = { speed: [1, 0.8], size: [1, 1.32] };
    const a = applyRoundResult(h, 0, 'speed');
    expect(a.speed[0]).toBe(1);
    expect(a.speed[1]).toBeCloseTo(0.8696, 3);
    const b = applyRoundResult(h, 0, 'size');
    expect(b.size).toEqual([1, 1.16]);
  });

  it('leaves manual boosts alone', () => {
    const h: Handicaps = { speed: [1, 1.3], size: [1, 0.7] };
    expect(applyRoundResult(h, 1, 'speed')).toEqual(h);
    expect(applyRoundResult(h, 0, 'speed').speed).toEqual([0.92, 1.3]);
  });
});

describe('manual lobby controls', () => {
  it('nudges speed in 5% steps and size in 10% steps for either player', () => {
    let h = nudge(neutral(), 1, 'speed', 1);
    expect(h.speed).toEqual([1, 1.05]);
    h = nudge(h, 0, 'size', 1);
    expect(h.size).toEqual([1.1, 1]);
    h = nudge(h, 0, 'speed', -1);
    expect(h.speed[0]).toBe(0.95);
  });

  it('snaps odd automatic values onto the manual grid', () => {
    expect(nudge({ speed: [0.92, 1], size: [1, 1] }, 0, 'speed', 1).speed[0]).toBe(0.95);
  });

  it('respects manual limits, but size has no upper limit', () => {
    let h = neutral();
    for (let i = 0; i < 100; i++) h = nudge(h, 0, 'speed', 1);
    expect(h.speed[0]).toBe(MANUAL_SPEED_MAX);
    for (let i = 0; i < 100; i++) h = nudge(h, 1, 'size', -1);
    expect(h.size[1]).toBe(MANUAL_SIZE_MIN);
    for (let i = 0; i < 100; i++) h = nudge(h, 0, 'size', 1);
    expect(h.size[0]).toBeCloseTo(11);
  });
});

describe('persistence and messages', () => {
  it('sanitizes bad data to neutral', () => {
    expect(sanitize(null)).toEqual(neutral());
    expect(sanitize({ speed: ['x', -1], size: [NaN, 0] })).toEqual(neutral());
    expect(sanitize({ speed: [0.5, 9], size: [3, 0.1] })).toEqual({ speed: [0.5, MANUAL_SPEED_MAX], size: [3, MANUAL_SIZE_MIN] });
  });

  it('migrates the old single-number save', () => {
    expect(fromLegacy(0.24).speed).toEqual([0.76, 1]);
    expect(fromLegacy(-0.08).speed).toEqual([1, 0.92]);
    expect(fromLegacy(0)).toEqual(neutral());
  });

  it('describes changes in plain language', () => {
    const a = neutral();
    expect(describeChange(a, applyRoundResult(a, 0, 'speed'), names)).toBe('Zach slowed to 92%');
    expect(describeChange(a, applyRoundResult(a, 0, 'size'), names)).toBe('Zach grew to 116% size');
    const b = applyRoundResult(a, 0, 'speed');
    expect(describeChange(b, applyRoundResult(b, 1, 'speed'), names)).toBe('Zach sped up to 100%');
    expect(describeChange(a, a, names)).toBe('No handicap to take back');
  });
});
