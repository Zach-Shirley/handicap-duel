/**
 * Self-balancing handicap.
 *
 * Each player has a speed multiplier and a size multiplier (1 = normal).
 * Slower or bigger counts as handicapped; faster or smaller is a boost the
 * host set by hand. The host (the computer, played by the stronger player)
 * is the one the game holds back:
 *   - a host win first takes back any handicap on the guest, otherwise
 *     handicaps the host one more step (no limit);
 *   - a guest win takes back one step of the host's handicap and never
 *     handicaps the guest.
 * Coin Rush and Paint adjust speed automatically; Meteor Dodge adjusts size.
 * Manual values set in the lobby apply in every game.
 */

export type Side = 0 | 1;
export type Effect = 'speed' | 'size' | 'none';
export type Stat = Exclude<Effect, 'none'>;

export interface Handicaps {
  speed: [number, number];
  size: [number, number];
}

/** Each automatic speed step keeps 92% of the current speed: never reaches 0. */
export const SPEED_FACTOR = 0.92;
/** Each automatic size step adds 16 percentage points: unlimited. */
export const SIZE_STEP = 0.16;

// Manual lobby limits. Automatic steps may go past the handicap side of these.
export const MANUAL_SPEED_STEP = 0.05;
export const MANUAL_SPEED_MIN = 0.05;
export const MANUAL_SPEED_MAX = 2.5;
export const MANUAL_SIZE_STEP = 0.1;
export const MANUAL_SIZE_MIN = 0.3;

export function neutral(): Handicaps {
  return { speed: [1, 1], size: [1, 1] };
}

export function cloneHc(h: Handicaps): Handicaps {
  return { speed: [h.speed[0], h.speed[1]], size: [h.size[0], h.size[1]] };
}

function tidy(n: number): number {
  return Math.round(n * 10000) / 10000;
}

/** Accept saved or received data defensively; anything odd becomes neutral. */
export function sanitize(raw: unknown): Handicaps {
  const h = neutral();
  if (!raw || typeof raw !== 'object') return h;
  const r = raw as { speed?: unknown; size?: unknown };
  for (const i of [0, 1] as const) {
    const sp = Array.isArray(r.speed) ? Number(r.speed[i]) : NaN;
    const sz = Array.isArray(r.size) ? Number(r.size[i]) : NaN;
    if (Number.isFinite(sp) && sp > 0) h.speed[i] = Math.min(MANUAL_SPEED_MAX, sp);
    if (Number.isFinite(sz) && sz > 0) h.size[i] = Math.max(MANUAL_SIZE_MIN, sz);
  }
  return h;
}

/** Old saves stored one signed number: positive slowed the host. */
export function fromLegacy(h: number): Handicaps {
  const out = neutral();
  if (!Number.isFinite(h) || h === 0) return out;
  if (h > 0) out.speed[0] = tidy(1 - Math.min(0.95, h));
  else out.speed[1] = tidy(1 - Math.min(0.95, -h));
  return out;
}

function isHandicapped(h: Handicaps, who: Side, effect: Stat): boolean {
  return effect === 'speed' ? h.speed[who] < 1 : h.size[who] > 1;
}

function handicapStep(h: Handicaps, who: Side, effect: Stat) {
  if (effect === 'speed') h.speed[who] = tidy(h.speed[who] * SPEED_FACTOR);
  else h.size[who] = tidy(h.size[who] + SIZE_STEP);
}

function easeStep(h: Handicaps, who: Side, effect: Stat) {
  if (effect === 'speed') h.speed[who] = Math.min(1, tidy(h.speed[who] / SPEED_FACTOR));
  else h.size[who] = Math.max(1, tidy(h.size[who] - SIZE_STEP));
  // Snap float residue back to exactly normal.
  if (Math.abs(h.speed[who] - 1) < 0.002) h.speed[who] = 1;
  if (Math.abs(h.size[who] - 1) < 0.002) h.size[who] = 1;
}

export function applyRoundResult(prev: Handicaps, winner: Side, effect: Effect): Handicaps {
  const h = cloneHc(prev);
  if (effect === 'none') return h;
  if (winner === 0) {
    if (isHandicapped(h, 1, effect)) easeStep(h, 1, effect);
    else handicapStep(h, 0, effect);
  } else if (isHandicapped(h, 0, effect)) {
    easeStep(h, 0, effect);
  }
  return h;
}

/** Lobby +/- buttons. dir = +1 means "more" of the value (faster / bigger). */
export function nudge(prev: Handicaps, who: Side, effect: Stat, dir: 1 | -1): Handicaps {
  const h = cloneHc(prev);
  if (effect === 'speed') {
    const v = Math.round((h.speed[who] + dir * MANUAL_SPEED_STEP) / MANUAL_SPEED_STEP) * MANUAL_SPEED_STEP;
    h.speed[who] = tidy(Math.max(MANUAL_SPEED_MIN, Math.min(MANUAL_SPEED_MAX, v)));
  } else {
    const v = Math.round((h.size[who] + dir * MANUAL_SIZE_STEP) / MANUAL_SIZE_STEP) * MANUAL_SIZE_STEP;
    h.size[who] = tidy(Math.max(MANUAL_SIZE_MIN, v));
  }
  return h;
}

export function pct(n: number): number {
  return Math.round(n * 100);
}

/** Plain-language summary of what a round result did to the handicaps. */
export function describeChange(before: Handicaps, after: Handicaps, names: [string, string]): string {
  const parts: string[] = [];
  for (const i of [0, 1] as const) {
    const sb = before.speed[i];
    const sa = after.speed[i];
    if (sa < sb) parts.push(`${names[i]} slowed to ${pct(sa)}%`);
    else if (sa > sb) parts.push(`${names[i]} sped up to ${pct(sa)}%`);
    const zb = before.size[i];
    const za = after.size[i];
    if (za > zb) parts.push(`${names[i]} grew to ${pct(za)}% size`);
    else if (za < zb) parts.push(`${names[i]} shrank to ${pct(za)}% size`);
  }
  return parts.length ? parts.join(' · ') : 'No handicap to take back';
}
