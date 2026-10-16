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

export function speedsFor(h: number): [number, number] {
  const c = clampHandicap(h);
  return [1 - Math.max(0, c), 1 - Math.max(0, -c)];
}

export function speedPercent(speed: number): number {
  return Math.round(speed * 100);
}

/** Plain-language summary of what a round result did to the handicap. */
export function describeChange(before: number, after: number, names: [string, string]): string {
  const [b0, b1] = speedsFor(before);
  const [a0, a1] = speedsFor(after);
  const parts: string[] = [];
  for (const [i, b, a] of [[0, b0, a0], [1, b1, a1]] as const) {
    if (a < b) parts.push(`${names[i]} slowed to ${speedPercent(a)}%`);
    else if (a > b) parts.push(`${names[i]} sped up to ${speedPercent(a)}%`);
  }
  if (parts.length === 0) return after >= 0 && after === before && before === 0 ? `${names[0]} is already at full speed` : 'No speed change';
  return parts.join(' · ');
}
