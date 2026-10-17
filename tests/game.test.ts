import { describe, expect, it } from 'vitest';
import {
  ARENA,
  BASE_SPEED,
  COUNTDOWN_TIME,
  createMatch,
  MAX_R,
  meteorGap,
  PLAYER_R,
  rematch,
  ROUND_OVER_TIME,
  ROUND_TIME,
  step,
  WINS_TO_MATCH,
  type GameState,
  type Vec,
} from '../src/game';
import { neutral, type Handicaps } from '../src/handicap';

const still: [Vec, Vec] = [{ x: 0, y: 0 }, { x: 0, y: 0 }];

function seeded(seed = 1) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}

function run(state: GameState, seconds: number, inputs: [Vec, Vec] = still, rng = seeded()) {
  const dt = 1 / 120;
  for (let t = 0; t < seconds; t += dt) step(state, inputs, dt, rng);
}

function skipCountdown(state: GameState) {
  run(state, COUNTDOWN_TIME + 0.01);
  expect(state.phase).toBe('playing');
  state.events = [];
}

describe('round flow', () => {
  it('counts down, then plays', () => {
    const s = createMatch(neutral(), 'coins', seeded());
    expect(s.phase).toBe('countdown');
    run(s, COUNTDOWN_TIME + 0.01);
    expect(s.phase).toBe('playing');
    expect(s.events.filter((e) => e.kind === 'beep').map((e) => (e as { n: number }).n)).toEqual([2, 1]);
    expect(s.events.some((e) => e.kind === 'go')).toBe(true);
  });

  it('freezes players during the countdown', () => {
    const s = createMatch(neutral(), 'coins', seeded());
    const x = s.players[0].x;
    run(s, 1, [{ x: 1, y: 0 }, { x: 0, y: 0 }]);
    expect(s.players[0].x).toBe(x);
  });

  it('awards the round to the higher score when time runs out and moves the handicap', () => {
    const s = createMatch(neutral(), 'coins', seeded());
    skipCountdown(s);
    s.players[0].score = 4;
    s.players[1].score = 2;
    s.coins = [];
    run(s, ROUND_TIME + 0.1);
    expect(s.phase).toBe('roundOver');
    expect(s.roundWinner).toBe(0);
    expect(s.roundWins).toEqual([1, 0]);
    expect(s.handicap.speed).toEqual([0.92, 1]);
  });

  it('goes to sudden death on a tie, and the next coin wins', () => {
    const s = createMatch(neutral(), 'coins', seeded());
    skipCountdown(s);
    s.coins = [];
    // Keep coins from spawning under anyone by parking players in corners.
    s.players[0].x = PLAYER_R;
    s.players[0].y = PLAYER_R;
    s.players[1].x = ARENA.w - PLAYER_R;
    s.players[1].y = ARENA.h - PLAYER_R;
    s.timeLeft = 0.05;
    run(s, 0.1);
    expect(s.phase).toBe('sudden');
    // Drop a coin on the guest.
    s.coins = [{ id: 999, x: s.players[1].x, y: s.players[1].y, value: 1 }];
    step(s, still, 1 / 120);
    expect(s.phase).toBe('roundOver');
    expect(s.roundWinner).toBe(1);
    expect(s.handicap).toEqual(neutral());
  });

  it('starts the next round with the new speeds applied', () => {
    const s = createMatch(neutral(), 'coins', seeded());
    skipCountdown(s);
    s.players[0].score = 1;
    s.timeLeft = 0.01;
    s.coins = [];
    run(s, 0.05);
    expect(s.phase).toBe('roundOver');
    run(s, ROUND_OVER_TIME + 0.05);
    expect(s.phase).toBe('countdown');
    expect(s.round).toBe(2);
    expect(s.players[0].speed).toBeCloseTo(0.92);
    expect(s.players[1].speed).toBe(1);
    expect(s.players[0].score).toBe(0);
  });

  it('ends the match at the win target, and rematch keeps the handicap', () => {
    const s = createMatch(neutral(), 'coins', seeded());
    for (let r = 0; r < WINS_TO_MATCH; r++) {
      skipCountdown(s);
      s.players[0].score = 1;
      s.coins = [];
      s.timeLeft = 0.01;
      run(s, 0.05);
      if (s.phase === 'roundOver') run(s, ROUND_OVER_TIME + 0.05);
    }
    expect(s.phase).toBe('matchOver');
    expect(s.roundWins).toEqual([WINS_TO_MATCH, 0]);
    expect(s.handicap.speed[0]).toBeCloseTo(0.92 ** WINS_TO_MATCH, 3);
    rematch(s, seeded());
    expect(s.phase).toBe('countdown');
    expect(s.roundWins).toEqual([0, 0]);
    expect(s.players[0].speed).toBeCloseTo(0.92 ** WINS_TO_MATCH, 3);
  });
});

describe('movement and coins', () => {
  it('a slowed player covers less ground', () => {
    const s = createMatch({ speed: [0.75, 1], size: [1, 1] }, 'coins', seeded());
    skipCountdown(s);
    s.coins = [];
    const start0 = s.players[0].x;
    const start1 = s.players[1].x;
    run(s, 0.5, [{ x: 0, y: -1 }, { x: 0, y: -1 }]);
    // Moving up from the same height: compare distance travelled.
    const d0 = Math.abs(s.players[0].y - ARENA.h / 2);
    const d1 = Math.abs(s.players[1].y - ARENA.h / 2);
    expect(d0).toBeLessThan(d1);
    expect(d0 / d1).toBeGreaterThan(0.7);
    expect(d0 / d1).toBeLessThan(0.8);
    expect(s.players[0].x).toBeCloseTo(start0);
    expect(s.players[1].x).toBeCloseTo(start1);
  });

  it('caps diagonal and oversized stick input at full speed', () => {
    const s = createMatch(neutral(), 'coins', seeded());
    skipCountdown(s);
    s.coins = [];
    run(s, 0.3, [{ x: 5, y: 5 }, { x: 0, y: 0 }]);
    const p = s.players[0];
    expect(Math.hypot(p.vx, p.vy)).toBeCloseTo(BASE_SPEED, 0);
  });

  it('ignores NaN input instead of corrupting positions', () => {
    const s = createMatch(neutral(), 'coins', seeded());
    skipCountdown(s);
    run(s, 0.2, [{ x: NaN, y: NaN }, { x: 0, y: 0 }]);
    expect(Number.isFinite(s.players[0].x)).toBe(true);
  });

  it('stays inside the arena walls', () => {
    const s = createMatch(neutral(), 'coins', seeded());
    skipCountdown(s);
    run(s, 4, [{ x: -1, y: -1 }, { x: 1, y: 1 }]);
    expect(s.players[0].x).toBeGreaterThanOrEqual(PLAYER_R);
    expect(s.players[0].y).toBeGreaterThanOrEqual(PLAYER_R);
    expect(s.players[1].x).toBeLessThanOrEqual(ARENA.w - PLAYER_R);
    expect(s.players[1].y).toBeLessThanOrEqual(ARENA.h - PLAYER_R);
  });

  it('collecting a coin scores its value and respawns coins over time', () => {
    const s = createMatch(neutral(), 'coins', seeded());
    skipCountdown(s);
    s.coins = [{ id: 500, x: s.players[0].x, y: s.players[0].y, value: 3 }];
    step(s, still, 1 / 120);
    expect(s.players[0].score).toBe(3);
    expect(s.events.some((e) => e.kind === 'coin' && e.who === 0 && e.value === 3)).toBe(true);
    run(s, 3);
    expect(s.coins.length).toBe(3);
  });

  it('bumping pushes both players apart and fires one bump event', () => {
    const s = createMatch(neutral(), 'coins', seeded());
    skipCountdown(s);
    s.coins = [];
    s.players[0].x = 480;
    s.players[1].x = 520;
    s.players[0].y = s.players[1].y = 300;
    step(s, still, 1 / 120);
    expect(s.events.filter((e) => e.kind === 'bump')).toHaveLength(1);
    expect(s.players[0].kx).toBeLessThan(0);
    expect(s.players[1].kx).toBeGreaterThan(0);
    run(s, 0.5);
    expect(s.players[1].x - s.players[0].x).toBeGreaterThan(PLAYER_R * 2);
  });
});

describe('paint the floor', () => {
  it('paints cells under each player and scores them', () => {
    const s = createMatch(neutral(), 'paint', seeded());
    skipCountdown(s);
    step(s, still, 1 / 120);
    expect(s.players[0].score).toBeGreaterThan(0);
    expect(s.players[0].score).toBe(s.players[1].score);
    const owned = (o: number) => s.grid.filter((c) => c === o).length;
    expect(owned(1)).toBe(s.players[0].score);
    run(s, 1, [{ x: 0, y: 1 }, { x: 0, y: 0 }]);
    expect(s.players[0].score).toBeGreaterThan(s.players[1].score);
    expect(owned(1)).toBe(s.players[0].score);
  });

  it('stealing a cell moves the point to the new owner', () => {
    const s = createMatch(neutral(), 'paint', seeded());
    skipCountdown(s);
    step(s, still, 1 / 120);
    const before1 = s.players[1].score;
    // Teleport the host onto the guest's painted patch (guest moved away first).
    s.players[1].x = ARENA.w - PLAYER_R;
    s.players[1].y = PLAYER_R;
    const gx = ARENA.w * 0.8;
    s.players[0].x = gx;
    s.players[0].y = ARENA.h / 2;
    step(s, still, 1 / 120);
    expect(s.grid.filter((c) => c === 2).length).toBe(s.players[1].score);
    expect(s.players[1].score).toBeLessThan(before1 + 20);
    expect(s.grid.filter((c) => c === 1).length).toBe(s.players[0].score);
  });

  it('awards the round to whoever owns more floor at the buzzer', () => {
    const s = createMatch(neutral(), 'paint', seeded());
    skipCountdown(s);
    run(s, ROUND_TIME + 0.1, [{ x: 0, y: 0 }, { x: -1, y: 0.3 }]);
    expect(s.phase).toBe('roundOver');
    expect(s.roundWinner).toBe(1);
  });
});

describe('meteor dodge', () => {
  it('applies both manual speed and size, and a host win grows the host', () => {
    const hc: Handicaps = { speed: [0.9, 1.2], size: [1.16, 0.8] };
    const s = createMatch(hc, 'meteor', seeded());
    expect(s.players[0].speed).toBe(0.9);
    expect(s.players[1].speed).toBe(1.2);
    expect(s.players[0].r).toBeCloseTo(PLAYER_R * 1.16);
    expect(s.players[1].r).toBeCloseTo(PLAYER_R * 0.8);
    skipCountdown(s);
    s.spawnTimer = -100;
    s.meteors = [{ id: 1, x: s.players[1].x, y: s.players[1].y, t: 0.001 }];
    step(s, still, 1 / 120);
    expect(s.roundWinner).toBe(0);
    // Meteor Dodge adjusts size only; the manual speeds are untouched.
    expect(s.handicap.size[0]).toBeCloseTo(1.32);
    expect(s.handicap.speed).toEqual([0.9, 1.2]);
  });

  it('caps the physical radius so a huge size still fits the arena', () => {
    const s = createMatch({ speed: [1, 1], size: [40, 1] }, 'meteor', seeded());
    expect(s.players[0].r).toBe(MAX_R);
    expect(s.players[0].x).toBeGreaterThanOrEqual(MAX_R);
    skipCountdown(s);
    run(s, 0.5, [{ x: 1, y: 1 }, { x: 0, y: 0 }]);
    expect(s.players[0].y).toBeLessThanOrEqual(ARENA.h - MAX_R + 0.001);
  });

  it('a direct hit knocks a player out and gives the round to the other', () => {
    const s = createMatch(neutral(), 'meteor', seeded());
    skipCountdown(s);
    s.meteors = [{ id: 1, x: s.players[1].x, y: s.players[1].y, t: 0.001 }];
    s.spawnTimer = -100; // no new meteors during the test
    step(s, still, 1 / 120);
    expect(s.players[1].alive).toBe(false);
    expect(s.phase).toBe('roundOver');
    expect(s.roundWinner).toBe(0);
    expect(s.events.some((e) => e.kind === 'hit' && e.who === 1)).toBe(true);
  });

  it('a near miss outside the blast does nothing', () => {
    const s = createMatch(neutral(), 'meteor', seeded());
    skipCountdown(s);
    s.spawnTimer = -100;
    s.meteors = [{ id: 1, x: s.players[1].x + 55 + PLAYER_R, y: s.players[1].y, t: 0.001 }];
    step(s, still, 1 / 120);
    expect(s.players[1].alive).toBe(true);
    expect(s.phase).toBe('playing');
  });

  it('if both are hit at once, nobody is out', () => {
    const s = createMatch(neutral(), 'meteor', seeded());
    skipCountdown(s);
    s.spawnTimer = -100;
    s.meteors = [
      { id: 1, x: s.players[0].x, y: s.players[0].y, t: 0.001 },
      { id: 2, x: s.players[1].x, y: s.players[1].y, t: 0.001 },
    ];
    step(s, still, 1 / 120);
    expect(s.players.every((p) => p.alive)).toBe(true);
    expect(s.phase).toBe('playing');
  });

  it('spawns faster over time and turns into a storm after the clock', () => {
    const s = createMatch(neutral(), 'meteor', seeded());
    skipCountdown(s);
    const startGap = meteorGap(s);
    s.timeLeft = 1;
    const lateGap = meteorGap(s);
    expect(lateGap).toBeLessThan(startGap);
    s.meteors = [];
    s.spawnTimer = -100;
    s.timeLeft = 0.005;
    step(s, still, 1 / 120);
    expect(s.phase).toBe('sudden');
    expect(meteorGap(s)).toBeLessThan(lateGap);
  });

  it('a standing-still player eventually gets hit (meteors aim at players)', () => {
    const s = createMatch(neutral(), 'meteor', seeded(7));
    skipCountdown(s);
    run(s, 40, still, seeded(7));
    expect(s.roundWins[0] + s.roundWins[1]).toBeGreaterThan(0);
  });
});
