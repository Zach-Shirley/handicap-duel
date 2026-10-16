import { applyRoundResult, speedsFor, type Side } from './handicap';

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
}

export interface Coin {
  id: number;
  x: number;
  y: number;
  value: number;
}

export type GameEvent =
  | { kind: 'coin'; who: Side; value: number; x: number; y: number }
  | { kind: 'bump'; x: number; y: number; force: number }
  | { kind: 'beep'; n: number }
  | { kind: 'go' }
  | { kind: 'sudden' }
  | { kind: 'round'; winner: Side }
  | { kind: 'match'; winner: Side };

export interface GameState {
  phase: Phase;
  /** Seconds left in countdown / roundOver. */
  phaseTime: number;
  /** Seconds left in the round clock. */
  timeLeft: number;
  round: number;
  players: [Player, Player];
  coins: Coin[];
  nextCoinId: number;
  spawnTimer: number;
  bumpCooldown: number;
  roundWins: [number, number];
  roundWinner: Side | null;
  handicap: number;
  handicapBefore: number;
  events: GameEvent[];
}

function makePlayer(x: number, y: number, speed: number): Player {
  return { x, y, vx: 0, vy: 0, kx: 0, ky: 0, score: 0, speed };
}

export function createMatch(handicap: number, rng: Rng = Math.random): GameState {
  const [s0, s1] = speedsFor(handicap);
  const state: GameState = {
    phase: 'countdown',
    phaseTime: COUNTDOWN_TIME,
    timeLeft: ROUND_TIME,
    round: 0,
    players: [makePlayer(0, 0, s0), makePlayer(0, 0, s1)],
    coins: [],
    nextCoinId: 1,
    spawnTimer: 0,
    bumpCooldown: 0,
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
  const [s0, s1] = speedsFor(state.handicap);
  state.players = [
    makePlayer(ARENA.w * 0.2, ARENA.h / 2, s0),
    makePlayer(ARENA.w * 0.8, ARENA.h / 2, s1),
  ];
  state.coins = [];
  state.round += 1;
  state.phase = 'countdown';
  state.phaseTime = COUNTDOWN_TIME;
  state.timeLeft = ROUND_TIME;
  state.roundWinner = null;
  state.spawnTimer = 0;
  state.bumpCooldown = 0;
  // Opening coins: one fair coin on the center line, plus one random.
  state.coins.push({ id: state.nextCoinId++, x: ARENA.w / 2, y: ARENA.h / 2, value: 1 });
  spawnCoin(state, rng);
}

export function rematch(state: GameState, rng: Rng = Math.random): void {
  state.roundWins = [0, 0];
  state.round = 0;
  startRound(state, rng);
}

export function spawnCoin(state: GameState, rng: Rng): Coin {
  const margin = 50;
  let best: Vec = { x: ARENA.w / 2, y: ARENA.h / 2 };
  let bestScore = -Infinity;
  for (let i = 0; i < 20; i++) {
    const p = {
      x: margin + rng() * (ARENA.w - margin * 2),
      y: margin + rng() * (ARENA.h - margin * 2),
    };
    // Prefer spots not right under a player or on top of another coin.
    let clearance = Infinity;
    for (const pl of state.players) clearance = Math.min(clearance, dist(p, pl) - 120);
    for (const c of state.coins) clearance = Math.min(clearance, dist(p, c) - 60);
    if (clearance >= 0) {
      best = p;
      break;
    }
    if (clearance > bestScore) {
      bestScore = clearance;
      best = p;
    }
  }
  const coin: Coin = {
    id: state.nextCoinId++,
    x: best.x,
    y: best.y,
    value: rng() < BIG_COIN_CHANCE ? 3 : 1,
  };
  state.coins.push(coin);
  return coin;
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
  const stick = clampStick(input);
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
  if (p.x < PLAYER_R) {
    p.x = PLAYER_R;
    p.kx = Math.abs(p.kx);
  } else if (p.x > ARENA.w - PLAYER_R) {
    p.x = ARENA.w - PLAYER_R;
    p.kx = -Math.abs(p.kx);
  }
  if (p.y < PLAYER_R) {
    p.y = PLAYER_R;
    p.ky = Math.abs(p.ky);
  } else if (p.y > ARENA.h - PLAYER_R) {
    p.y = ARENA.h - PLAYER_R;
    p.ky = -Math.abs(p.ky);
  }
}

function resolveBump(state: GameState): void {
  const [a, b] = state.players;
  const d = dist(a, b);
  const minD = PLAYER_R * 2;
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

function collectCoins(state: GameState): Side | null {
  for (let ci = state.coins.length - 1; ci >= 0; ci--) {
    const c = state.coins[ci];
    const r = coinRadius(c) + PLAYER_R;
    const d0 = dist(state.players[0], c);
    const d1 = dist(state.players[1], c);
    let who: Side | null = null;
    if (d0 < r && d1 < r) who = d0 <= d1 ? 0 : 1;
    else if (d0 < r) who = 0;
    else if (d1 < r) who = 1;
    if (who === null) continue;
    state.players[who].score += c.value;
    state.coins.splice(ci, 1);
    state.events.push({ kind: 'coin', who, value: c.value, x: c.x, y: c.y });
    if (state.phase === 'sudden') return who;
  }
  return null;
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

  const suddenWinner = collectCoins(state);
  if (suddenWinner !== null) {
    endRound(state, suddenWinner);
    return;
  }

  if (state.coins.length < MAX_COINS) {
    state.spawnTimer += dt;
    if (state.spawnTimer >= COIN_RESPAWN) {
      state.spawnTimer = 0;
      spawnCoin(state, rng);
    }
  } else {
    state.spawnTimer = 0;
  }

  if (state.phase === 'playing') {
    state.timeLeft = Math.max(0, state.timeLeft - dt);
    if (state.timeLeft <= 0) {
      const [p0, p1] = state.players;
      if (p0.score === p1.score) {
        state.phase = 'sudden';
        state.events.push({ kind: 'sudden' });
      } else {
        endRound(state, p0.score > p1.score ? 0 : 1);
      }
    }
  }
}
