import { describe, expect, it } from 'vitest';
import { applyRoundResult, clampHandicap, describeChange, HANDICAP_MAX, speedsFor } from '../src/handicap';

describe('handicap', () => {
  it('starts even at full speed', () => {
    expect(speedsFor(0)).toEqual([1, 1]);
  });

  it('slows the host after a host win and never speeds anyone past 100%', () => {
    const h = applyRoundResult(0, 0);
    expect(h).toBeCloseTo(0.08);
    expect(speedsFor(h)).toEqual([0.92, 1]);
  });

  it('gives speed back to the host when the guest wins', () => {
    let h = 0;
    for (let i = 0; i < 3; i++) h = applyRoundResult(h, 0);
    expect(speedsFor(h)[0]).toBeCloseTo(0.76);
    h = applyRoundResult(h, 1);
    expect(speedsFor(h)[0]).toBeCloseTo(0.84);
    expect(speedsFor(h)[1]).toBe(1);
  });

  it('never slows the guest for winning', () => {
    expect(applyRoundResult(0, 1)).toBe(0);
    expect(applyRoundResult(0.04, 1)).toBe(0);
    // A manual guest handicap is left alone by guest wins, eased by host wins.
    expect(applyRoundResult(-0.16, 1)).toBe(-0.16);
    expect(applyRoundResult(-0.16, 0)).toBeCloseTo(-0.08);
  });

  it('caps at the maximum handicap', () => {
    let h = 0;
    for (let i = 0; i < 50; i++) h = applyRoundResult(h, 0);
    expect(h).toBe(HANDICAP_MAX);
    expect(speedsFor(h)[0]).toBe(0.5);
    expect(clampHandicap(-9)).toBe(-HANDICAP_MAX);
  });

  it('describes changes in plain language', () => {
    expect(describeChange(0, 0.08, ['Zach', 'Sis'])).toBe('Zach slowed to 92%');
    expect(describeChange(0.16, 0.08, ['Zach', 'Sis'])).toBe('Zach sped up to 92%');
    expect(describeChange(0.04, -0.04, ['Zach', 'Sis'])).toBe('Zach sped up to 100% · Sis slowed to 96%');
    expect(describeChange(0, 0, ['Zach', 'Sis'])).toBe('Zach is already at full speed');
    expect(describeChange(-0.16, -0.16, ['Zach', 'Sis'])).toBe('No speed change');
  });
});
