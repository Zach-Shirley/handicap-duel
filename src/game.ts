import { applyRoundResult, sizesFor, speedsFor, type Effect, type Side } from './handicap';

export const ARENA = { w: 1000, h: 625 };
export const PLAYER_R = 24;
export const COIN_R = 14;
export const BIG_COIN_R = 20;
export const BASE_SPEED = 340; // arena units per second at 100%
export const ACCEL = 2600; // how quickly velocity reaches the stick target
export const ROUND_TIME = 30;
export const COUNTDOWN_TIME = 3;
export const ROUND_OVER_TIME = 3.5;
export const WINS_TO_MATCH = 5;
export const MAX_COINS = 3;
export const COIN_RESPAWN = 0.6;
export const BIG_COIN_CHANCE = 0.12;
export const BUMP_COOLDOWN = 0.25;

// Paint the Floor
export const CELL = 25;
export const GRID_W = ARENA.w / CELL; // 40
export const GRID_H = Math.round(ARENA.h / CELL); // 25
export const GRID_N = GRID_W * GRID_H;

// Meteor Dodge
export const METEOR_WARN = 1.1; // seconds between warning circle and impact
export const BLAST_R = 55;
export const METEOR_GAP_START = 0.9;
export const METEOR_GAP_END = 0.3;
export const METEOR_GAP_STORM = 0.12;
/** Hits are judged against 80% of the player's radius: grazes don't count. */
export const HIT_FORGIVENESS = 0.8;

export type Mode = 'coins' | 'paint' | 'meteor';
export const MODES: Mode[] = ['coins', 'paint', 'meteor'];
export const MODE_INFO: Record<Mode, { name: string; blurb: string; effect: Effect; sudden: string; suddenSub: string }> = {
  coins: {
    name: 'Coin Rush',
    blurb: 'Grab the most coins in 30 seconds',
    effect: 'speed',
    sudden: 'SUDDEN DEATH',
    suddenSub: 'next coin wins',
  },
  paint: {
    name: 'Paint the Floor',
    blurb: 'Cover more floor than the other player',
    effect: 'speed',
    sudden: 'SUDDEN DEATH',
    suddenSub: 'next tile wins',
  },
  meteor: {
    name: 'Meteor Dodge',
    blurb: 'Dodge the meteors. One hit and you are out',
    effect: 'size',
    sudden: 'METEOR STORM',
    suddenSub: 'last one standing',
  },
};

export type Rng = () => number;
export type Phase = 'countdown' | 'playing' | 'sudden' | 'roundOver' | 'matchOver';

export interface Vec {
  x: number;
  y: number;
}

export interface Player {
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** Knockback velocity from bumps; decays separately from steering. */
  kx: number;
  ky: number;
  score: number;
  speed: number;
  r: number;
  alive: boolean;
}

export interface Coin {
  id: number;
  x: number;
  y: number;
  value: number;
}

export interface Meteor {
  id: number;
  x: number;
  y: number;
  /** Seconds until impact. */
  t: number;
}

export type GameEvent =
  | { kind: 'coin'; who: Side; value: number; x: number; y: number }
  | { kind: 'bump'; x: number; y: number; force: number }
  | { kind: 'boom'; x: number; y: number }
  | { kind: 'hit'; who: Side; x: number; y: number }
  | { kind: 'beep'; n: number }
  | { kind: 'go' }
  | { kind: 'sudden' }
  | { kind: 'round'; winner: Side }
  | { kind: 'match'; winner: Side };

export interface GameState {
  mode: Mode;
  phase: Phase;
  /** Seconds left in countdown / roundOver. */
  phaseTime: number;
  /** Seconds left in the round clock. */
  timeLeft: number;
  round: number;
  players: [Player, Player];
  coins: Coin[];
  nextId: number;
  spawnTimer: number;
  bumpCooldown: number;
  /** Paint ownership per cell: 0 empty, 1 host, 2 guest. */
  grid: Uint8Array;
  meteors: Meteor[];
  roundWins: [number, number];
  roundWinner: Side | null;
  handicap: number;
  handicapBefore: number;
  events: GameEvent[];
}

function makePlayer(x: number, y: number, speed: number, r: number): Player {
  return { x, y, vx: 0, vy: 0, kx: 0, ky: 0, score: 0, speed, r, alive: true };
}

export function createMatch(handicap: number, mode: Mode = 'coins', rng: Rng = Math.random): GameState {
  const state: GameState = {
    mode,
    phase: 'countdown',
    phaseTime: COUNTDOWN_TIME,
    timeLeft: ROUND_TIME,
    round: 0,
    players: [makePlayer(0, 0, 1, PLAYER_R), makePlayer(0, 0, 1, PLAYER_R)],
    coins: [],
    nextId: 1,
    spawnTimer: 0,
    bumpCooldown: 0,
    grid: new Uint8Array(GRID_N),
    meteors: [],
    roundWins: [0, 0],
    roundWinner: null,
    handicap,
    handicapBefore: handicap,
    events: [],
  };
  startRound(state, rng);
  return state;
}

export function startRound(state: GameState, rng: Rng = Math.random): void {
  const meteor = state.mode === 'meteor';
  const speeds = meteor ? [1, 1] : speedsFor(state.handicap);
  const sizes = meteor ? sizesFor(state.handicap) : [1, 1];
  state.players = [
    makePlayer(ARENA.w * 0.2, ARENA.h / 2, speeds[0], PLAYER_R * sizes[0]),
    makePlayer(ARENA.w * 0.8, ARENA.h / 2, speeds[1], PLAYER_R * sizes[1]),
  ];
  state.coins = [];
  state.meteors = [];
  state.grid = new Uint8Array(GRID_N);
  state.round += 1;
  state.phase = 'countdown';
  state.phaseTime = COUNTDOWN_TIME;
  state.timeLeft = ROUND_TIME;
  state.roundWinner = null;
  state.spawnTimer = 0;
  state.bumpCooldown = 0;
  if (state.mode === 'coins') {
    // Opening coins: one fair coin on the center line, plus one random.
    state.coins.push({ id: state.nextId++, x: ARENA.w / 2, y: ARENA.h / 2, value: 1 });
    spawnCoin(state, rng);
  }
}

export function rematch(state: GameState, rng: Rng = Math.random): void {
  state.roundWins = [0, 0];
  state.round = 0;
  startRound(state, rng);
}

function randomSpot(state: GameState, rng: Rng, playerGap: number, coinGap: number): Vec {
  const margin = 50;
  let best: Vec = { x: ARENA.w / 2, y: ARENA.h / 2 };
  let bestScore = -Infinity;
  for (let i = 0; i < 20; i++) {
    const p = {
      x: margin + rng() * (ARENA.w - margin * 2),
      y: margin + rng() * (ARENA.h - margin * 2),
    };
    let clearance = Infinity;
    for (const pl of state.players) clearance = Math.min(clearance, dist(p, pl) - playerGap);
    for (const c of state.coins) clearance = Math.min(clearance, dist(p, c) - coinGap);
    if (clearance >= 0) return p;
    if (clearance > bestScore) {
      bestScore = clearance;
      best = p;
    }
  }
  return best;
}

export function spawnCoin(state: GameState, rng: Rng): Coin {
  const p = randomSpot(state, rng, 120, 60);
  const coin: Coin = { id: state.nextId++, x: p.x, y: p.y, value: rng() < BIG_COIN_CHANCE ? 3 : 1 };
  state.coins.push(coin);
  return coin;
}

/**
 * Meteors alternate between aiming at a player (where they are now, so moving
 * dodges it) and landing somewhere random. Targets alternate between players
 * so neither side is picked on.
 */
export function spawnMeteor(state: GameState, rng: Rng): Meteor {
  const n = state.nextId++;
  let x: number;
  let y: number;
  if (n % 2 === 0) {
    const target = state.players[(n / 2) % 2];
    const a = rng() * Math.PI * 2;
    const off = rng() * 40;
    x = target.x + Math.cos(a) * off;
    y = target.y + Math.sin(a) * off;
  } else {
    x = 30 + rng() * (ARENA.w - 60);
    y = 30 + rng() * (ARENA.h - 60);
  }
  const m: Meteor = {
    id: n,
    x: Math.max(20, Math.min(ARENA.w - 20, x)),
    y: Math.max(20, Math.min(ARENA.h - 20, y)),
    t: METEOR_WARN,
  };
  state.meteors.push(m);
  return m;
}

export function meteorGap(state: GameState): number {
  if (state.phase === 'sudden') return METEOR_GAP_STORM;
  const k = Math.min(1, (ROUND_TIME - state.timeLeft) / ROUND_TIME);
  return METEOR_GAP_START + (METEOR_GAP_END - METEOR_GAP_START) * k;
}

export function coinRadius(c: Coin): number {
  return c.value > 1 ? BIG_COIN_R : COIN_R;
}

function dist(a: Vec, b: Vec): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function clampStick(v: Vec): Vec {
  const len = Math.hypot(v.x, v.y);
  if (!Number.isFinite(len) || len === 0) return { x: 0, y: 0 };
  return len > 1 ? { x: v.x / len, y: v.y / len } : v;
}

function movePlayer(p: Player, input: Vec, dt: number): void {
  const stick = p.alive ? clampStick(input) : { x: 0, y: 0 };
  const max = BASE_SPEED * p.speed;
  const tx = stick.x * max;
  const ty = stick.y * max;
  const dx = tx - p.vx;
  const dy = ty - p.vy;
  const dlen = Math.hypot(dx, dy);
  const stepLen = ACCEL * dt;
  if (dlen <= stepLen) {
    p.vx = tx;
    p.vy = ty;
  } else {
    p.vx += (dx / dlen) * stepLen;
    p.vy += (dy / dlen) * stepLen;
  }
  const decay = Math.exp(-6 * dt);
  p.kx *= decay;
  p.ky *= decay;
  p.x += (p.vx + p.kx) * dt;
  p.y += (p.vy + p.ky) * dt;
  if (p.x < p.r) {
    p.x = p.r;
    p.kx = Math.abs(p.kx);
  } else if (p.x > ARENA.w - p.r) {
    p.x = ARENA.w - p.r;
    p.kx = -Math.abs(p.kx);
  }
  if (p.y < p.r) {
    p.y = p.r;
    p.ky = Math.abs(p.ky);
  } else if (p.y > ARENA.h - p.r) {
    p.y = ARENA.h - p.r;
    p.ky = -Math.abs(p.ky);
  }
}

function resolveBump(state: GameState): void {
  const [a, b] = state.players;
  if (!a.alive || !b.alive) return;
  const d = dist(a, b);
  const minD = a.r + b.r;
  if (d >= minD) return;
  const nx = d > 0 ? (b.x - a.x) / d : 1;
  const ny = d > 0 ? (b.y - a.y) / d : 0;
  const overlap = minD - d;
  a.x -= nx * overlap * 0.5;
  a.y -= ny * overlap * 0.5;
  b.x += nx * overlap * 0.5;
  b.y += ny * overlap * 0.5;
  if (state.bumpCooldown > 0) return;
  const closing = (a.vx + a.kx - b.vx - b.kx) * nx + (a.vy + a.ky - b.vy - b.ky) * ny;
  const force = 260 + Math.max(0, closing) * 0.6;
  a.kx -= nx * force;
  a.ky -= ny * force;
  b.kx += nx * force;
  b.ky += ny * force;
  state.bumpCooldown = BUMP_COOLDOWN;
  state.events.push({ kind: 'bump', x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, force });
}

function collectCoins(state: GameState): void {
  for (let ci = state.coins.length - 1; ci >= 0; ci--) {
    const c = state.coins[ci];
    const [p0, p1] = state.players;
    const d0 = dist(p0, c);
    const d1 = dist(p1, c);
    const in0 = d0 < coinRadius(c) + p0.r;
    const in1 = d1 < coinRadius(c) + p1.r;
    let who: Side | null = null;
    if (in0 && in1) who = d0 <= d1 ? 0 : 1;
    else if (in0) who = 0;
    else if (in1) who = 1;
    if (who === null) continue;
    state.players[who].score += c.value;
    state.coins.splice(ci, 1);
    state.events.push({ kind: 'coin', who, value: c.value, x: c.x, y: c.y });
  }
}

/** Paint every cell whose centre lies under a player. Scores are cell counts. */
export function paintCells(state: GameState): void {
  state.players.forEach((p, i) => {
    const owner = i + 1;
    const r = p.r + 2;
    const cx0 = Math.max(0, Math.floor((p.x - r) / CELL));
    const cx1 = Math.min(GRID_W - 1, Math.floor((p.x + r) / CELL));
    const cy0 = Math.max(0, Math.floor((p.y - r) / CELL));
    const cy1 = Math.min(GRID_H - 1, Math.floor((p.y + r) / CELL));
    for (let cy = cy0; cy <= cy1; cy++) {
      for (let cx = cx0; cx <= cx1; cx++) {
        const mx = (cx + 0.5) * CELL;
        const my = (cy + 0.5) * CELL;
        if ((mx - p.x) ** 2 + (my - p.y) ** 2 > r * r) continue;
        const k = cy * GRID_W + cx;
        const prev = state.grid[k];
        if (prev === owner) continue;
        if (prev) state.players[prev - 1].score -= 1;
        state.grid[k] = owner;
        p.score += 1;
      }
    }
  });
}

function updateMeteors(state: GameState, dt: number, rng: Rng): void {
  state.spawnTimer += dt;
  const gap = meteorGap(state);
  while (state.spawnTimer >= gap) {
    state.spawnTimer -= gap;
    spawnMeteor(state, rng);
  }
  const hit: [boolean, boolean] = [false, false];
  for (let i = state.meteors.length - 1; i >= 0; i--) {
    const m = state.meteors[i];
    m.t -= dt;
    if (m.t > 0) continue;
    state.meteors.splice(i, 1);
    state.events.push({ kind: 'boom', x: m.x, y: m.y });
    state.players.forEach((p, j) => {
      if (p.alive && dist(p, m) < BLAST_R + p.r * HIT_FORGIVENESS) hit[j] = true;
    });
  }
  // Both caught by the same frame's blasts: nobody is out, play on.
  if (hit[0] && hit[1]) {
    state.events.push({ kind: 'bump', x: ARENA.w / 2, y: ARENA.h / 2, force: 300 });
    return;
  }
  for (const j of [0, 1] as const) {
    if (!hit[j]) continue;
    const p = state.players[j];
    p.alive = false;
    state.events.push({ kind: 'hit', who: j, x: p.x, y: p.y });
    endRound(state, j === 0 ? 1 : 0);
  }
}

function endRound(state: GameState, winner: Side): void {
  state.roundWinner = winner;
  state.roundWins[winner] += 1;
  state.handicapBefore = state.handicap;
  state.handicap = applyRoundResult(state.handicap, winner);
  if (state.roundWins[winner] >= WINS_TO_MATCH) {
    state.phase = 'matchOver';
    state.phaseTime = 0;
    state.events.push({ kind: 'match', winner });
  } else {
    state.phase = 'roundOver';
    state.phaseTime = ROUND_OVER_TIME;
    state.events.push({ kind: 'round', winner });
  }
}

/** Advance the match by dt seconds. Mutates state and appends events. */
export function step(state: GameState, inputs: [Vec, Vec], dt: number, rng: Rng = Math.random): void {
  switch (state.phase) {
    case 'countdown': {
      const before = Math.ceil(state.phaseTime);
      state.phaseTime -= dt;
      const after = Math.ceil(state.phaseTime);
      if (state.phaseTime <= 0) {
        state.phase = 'playing';
        state.events.push({ kind: 'go' });
      } else if (after < before) {
        state.events.push({ kind: 'beep', n: after });
      }
      return;
    }
    case 'roundOver': {
      state.phaseTime -= dt;
      if (state.phaseTime <= 0) startRound(state, rng);
      return;
    }
    case 'matchOver':
      return;
    case 'playing':
    case 'sudden':
      break;
  }

  state.bumpCooldown = Math.max(0, state.bumpCooldown - dt);
  movePlayer(state.players[0], inputs[0], dt);
  movePlayer(state.players[1], inputs[1], dt);
  resolveBump(state);

  if (state.mode === 'coins') {
    collectCoins(state);
    if (state.coins.length < MAX_COINS) {
      state.spawnTimer += dt;
      if (state.spawnTimer >= COIN_RESPAWN) {
        state.spawnTimer = 0;
        spawnCoin(state, rng);
      }
    } else {
      state.spawnTimer = 0;
    }
  } else if (state.mode === 'paint') {
    paintCells(state);
  } else {
    updateMeteors(state, dt, rng);
    if (state.phase !== 'playing' && state.phase !== 'sudden') return;
  }

  const [p0, p1] = state.players;
  if (state.phase === 'sudden') {
    // Coins and paint: the first lead ends it. Meteors end on a hit (above).
    if (state.mode !== 'meteor' && p0.score !== p1.score) endRound(state, p0.score > p1.score ? 0 : 1);
    return;
  }

  state.timeLeft = Math.max(0, state.timeLeft - dt);
  if (state.timeLeft <= 0) {
    if (state.mode === 'meteor' || p0.score === p1.score) {
      state.phase = 'sudden';
      state.events.push({ kind: 'sudden' });
    } else {
      endRound(state, p0.score > p1.score ? 0 : 1);
    }
  }
}
