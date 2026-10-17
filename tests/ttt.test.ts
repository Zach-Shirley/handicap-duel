import { describe, expect, it } from 'vitest';
import { createMatch, isLegalMove, MODE_INFO, playMove, rematch, step, type GameState } from '../src/game';
import { neutral } from '../src/handicap';

function match(): GameState {
  const s = createMatch(neutral(), 'ttt');
  s.events = [];
  return s;
}

/** Play a sequence of [board, cell] moves, alternating turns automatically. */
function play(s: GameState, moves: [number, number][]) {
  for (const [b, c] of moves) {
    const ok = playMove(s, s.ttt.turn, b, c);
    if (!ok) throw new Error(`illegal move ${b},${c}`);
  }
}

describe('mega tic-tac-toe', () => {
  it('starts immediately with the guest to move and any board open', () => {
    const s = match();
    expect(s.phase).toBe('playing');
    expect(s.ttt.turn).toBe(1);
    expect(s.ttt.next).toBe(-1);
    expect(MODE_INFO.ttt.wins).toBe(2);
  });

  it('rejects moves out of turn, on taken cells, or outside the sent board', () => {
    const s = match();
    expect(playMove(s, 0, 4, 4)).toBe(false); // host out of turn
    expect(playMove(s, 1, 4, 2)).toBe(true);
    expect(s.ttt.next).toBe(2); // cell 2 sends the host to board 2
    expect(playMove(s, 0, 4, 0)).toBe(false); // wrong board
    expect(playMove(s, 0, 2, 4)).toBe(true);
    expect(s.ttt.next).toBe(4);
    expect(playMove(s, 1, 4, 2)).toBe(false); // taken
    expect(playMove(s, 1, 9, 0)).toBe(false); // nonsense
  });

  it('winning a small board scores it, and being sent to a closed board frees the choice', () => {
    const s = match();
    // Guest (O) wins board 0 with cells 0,1,2. The host plays in harmless spots.
    play(s, [
      [0, 0], // O -> sends host to board 0
      [0, 3], // X -> sends guest to board 3
      [3, 0], // O -> host to 0
      [0, 4], // X -> guest to 4
      [4, 0], // O -> host to 0
      [0, 8], // X -> guest to 8
      [8, 0], // O -> host to 0
      [0, 6], // X -> guest to 6
      [6, 0], // O -> host to 0
      [0, 7], // X (board 0 now: O at 0, X at 3,4,6,7,8) ... X has 6,7,8 -> host wins board 0
    ]);
    expect(s.ttt.boards[0]).toBe(1);
    expect(s.players[0].score).toBe(1);
    expect(s.events.some((e) => e.kind === 'boardWon' && e.who === 0 && e.board === 0)).toBe(true);
    // Cell 7 sent the guest to board 7, which is open.
    expect(s.ttt.next).toBe(7);
    play(s, [[7, 0]]); // O sends host to board 0, which is closed -> free choice
    expect(s.ttt.next).toBe(-1);
    expect(isLegalMove(s.ttt, 0, 1)).toBe(false); // closed board
    expect(isLegalMove(s.ttt, 5, 5)).toBe(true);
  });

  it('three small boards in a row wins the round; handicap is untouched', () => {
    const s = match();
    // Hand the host boards 0 and 1, then let a real move win board 2.
    s.ttt.boards[0] = 1;
    s.ttt.boards[1] = 1;
    s.ttt.cells[2 * 9 + 0] = 1;
    s.ttt.cells[2 * 9 + 1] = 1;
    s.ttt.turn = 0;
    s.ttt.next = 2;
    expect(playMove(s, 0, 2, 2)).toBe(true);
    expect(s.phase).toBe('roundOver');
    expect(s.roundWinner).toBe(0);
    expect(s.ttt.line).toEqual([0, 1, 2]);
    expect(s.handicap).toEqual(neutral());
    expect(playMove(s, 1, 5, 5)).toBe(false); // no moves after the round ends
  });

  it('a full board with no line goes to whoever won more boards, else replays', () => {
    const s = match();
    s.ttt.boards.set([1, 2, 1, 1, 2, 2, 2, 1, 0]);
    s.players[0].score = 4;
    s.players[1].score = 4;
    // Board 8 gets filled without a winner by the final move.
    s.ttt.cells.set([1, 2, 1, 1, 2, 2, 2, 1, 0], 72);
    s.ttt.turn = 0;
    s.ttt.next = 8;
    expect(playMove(s, 0, 8, 8)).toBe(true);
    expect(s.ttt.boards[8]).toBe(3);
    expect(s.phase).toBe('roundOver');
    expect(s.roundWinner).toBeNull();
    expect(s.roundWins).toEqual([0, 0]);
    expect(s.events.some((e) => e.kind === 'draw')).toBe(true);
  });

  it('alternates who moves first, and first to 2 takes the match', () => {
    const s = match();
    const winRound = (who: 0 | 1) => {
      s.ttt.boards.set([who + 1, who + 1, 0, 0, 0, 0, 0, 0, 0]);
      s.ttt.cells.fill(0);
      s.ttt.cells[18] = who + 1;
      s.ttt.cells[19] = who + 1;
      s.ttt.turn = who;
      s.ttt.next = 2;
      expect(playMove(s, who, 2, 2)).toBe(true);
    };
    winRound(0);
    expect(s.phase).toBe('roundOver');
    for (let t = 0; t < 4; t += 1 / 60) step(s, [{ x: 0, y: 0 }, { x: 0, y: 0 }], 1 / 60);
    expect(s.phase).toBe('playing');
    expect(s.round).toBe(2);
    expect(s.ttt.turn).toBe(0); // host starts round 2
    winRound(0);
    expect(s.phase).toBe('matchOver');
    rematch(s);
    expect(s.ttt.turn).toBe(1);
    expect(s.ttt.cells.every((v) => v === 0)).toBe(true);
  });

  it('step() never moves anything in tic-tac-toe', () => {
    const s = match();
    const x = s.players[0].x;
    step(s, [{ x: 1, y: 0 }, { x: 1, y: 0 }], 0.5);
    expect(s.players[0].x).toBe(x);
    expect(s.phase).toBe('playing');
  });
});
