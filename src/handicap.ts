/**
 * Self-balancing handicap.
 *
 * A single number `h` describes who is held back:
 *   h > 0  -> player 0 (host) is slowed to (1 - h) of full speed
 *   h < 0  -> player 1 (guest) is slowed to (1 + h) of full speed
 * Nobody is ever faster than full speed. The host (the computer, played by
 * the stronger player) is the one the game holds back: each host win slows
 * the host, each guest win gives the host speed back, but a guest win never
 * slows the guest. A negative `h` only comes from the lobby's manual setting.
 */

export const HANDICAP_STEP = 0.08;
export const HANDICAP_MAX = 0.5;

export type Side = 0 | 1;

export function clampHandicap(h: number): number {
  const c = Math.max(-HANDICAP_MAX, Math.min(HANDICAP_MAX, h));
  // Avoid float drift like 0.24000000000000002 showing up as noise.
  return Math.round(c * 1000) / 1000;
}

export function applyRoundResult(h: number, winner: Side): number {
  if (winner === 0) return clampHandicap(h + HANDICAP_STEP);
  return h > 0 ? clampHandicap(Math.max(0, h - HANDICAP_STEP)) : h;
}

export function penaltiesFor(h: number): [number, number] {
  const c = clampHandicap(h);
  return [Math.max(0, c), Math.max(0, -c)];
}

export function speedsFor(h: number): [number, number] {
  const [a, b] = penaltiesFor(h);
  return [1 - a, 1 - b];
}

/** Meteor Dodge handicaps size instead of speed: 8% penalty -> 16% bigger. */
export function sizesFor(h: number): [number, number] {
  const [a, b] = penaltiesFor(h);
  return [1 + 2 * a, 1 + 2 * b];
}

export function speedPercent(speed: number): number {
  return Math.round(speed * 100);
}

export type Effect = 'speed' | 'size';

/** Plain-language summary of what a round result did to the handicap. */
export function describeChange(before: number, after: number, names: [string, string], effect: Effect = 'speed'): string {
  const fn = effect === 'size' ? sizesFor : speedsFor;
  const b = fn(before);
  const a = fn(after);
  const parts: string[] = [];
  for (const i of [0, 1] as const) {
    const pct = speedPercent(a[i]);
    if (effect === 'speed') {
      if (a[i] < b[i]) parts.push(`${names[i]} slowed to ${pct}%`);
      else if (a[i] > b[i]) parts.push(`${names[i]} sped up to ${pct}%`);
    } else {
      if (a[i] > b[i]) parts.push(`${names[i]} grew to ${pct}% size`);
      else if (a[i] < b[i]) parts.push(`${names[i]} shrank to ${pct}% size`);
    }
  }
  if (parts.length === 0) {
    if (before === 0 && after === 0) return effect === 'speed' ? `${names[0]} is already at full speed` : `${names[0]} is already normal size`;
    return 'No change';
  }
  return parts.join(' · ');
}
