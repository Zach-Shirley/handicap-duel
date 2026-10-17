import { ARENA, BIG_COIN_R, BLAST_R, CELL, COIN_R, GRID_N, GRID_W, METEOR_WARN, MODE_INFO, type GameEvent } from './game';
import { describeChange, pct } from './handicap';
import type { Snapshot } from './net';
import type { TouchStick } from './input';

export const COLORS: [string, string] = ['#ff4d6d', '#38d6ff'];
const HUD_H = 78;
const WORLD_W = ARENA.w;
const WORLD_H = ARENA.h + HUD_H;

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  max: number;
  color: string;
  size: number;
}

interface FloatText {
  x: number;
  y: number;
  text: string;
  color: string;
  life: number;
}

interface Ring {
  x: number;
  y: number;
  life: number;
}

export interface View {
  snap: Snapshot;
  names: [string, string];
  /** Which side this screen controls (null in same-keyboard practice). */
  me: 0 | 1 | null;
  stick?: TouchStick | null;
  /** Menu backdrop: arena only, no scoreboard or banners. */
  idle?: boolean;
  /** Tic-tac-toe: this screen may place a mark right now (enables hover). */
  canPlay?: boolean;
}

interface BoardRect {
  x: number;
  y: number;
  side: number;
  gap: number;
  sb: number;
}

export class Renderer {
  private ctx: CanvasRenderingContext2D;
  private particles: Particle[] = [];
  /** Particles positioned in screen pixels (tic-tac-toe board effects). */
  private screenParticles: Particle[] = [];
  private texts: FloatText[] = [];
  private rings: Ring[] = [];
  private shake = 0;
  private scale = 1;
  private ox = 0;
  private oy = 0;
  private dpr = 1;
  private t = 0;
  private board: BoardRect | null = null;
  /** Last mouse position in CSS pixels, for tic-tac-toe hover. */
  pointer: { x: number; y: number } | null = null;

  constructor(private canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext('2d')!;
    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  resize() {
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.canvas.width = Math.round(w * this.dpr);
    this.canvas.height = Math.round(h * this.dpr);
    this.canvas.style.width = `${w}px`;
    this.canvas.style.height = `${h}px`;
    const pad = Math.min(w, h) < 500 ? 6 : 20;
    // Keep a 52px lane on each side so the corner buttons never cover the scores.
    const lane = h > w ? 0 : 104; // portrait: buttons sit above the arena instead
    this.scale = Math.min((w - pad * 2 - lane) / WORLD_W, (h - pad * 2) / WORLD_H);
    this.ox = (w - WORLD_W * this.scale) / 2;
    this.oy = (h - WORLD_H * this.scale) / 2;
  }

  /** Spawn visual effects for game events. */
  effects(events: GameEvent[]) {
    for (const e of events) {
      if (e.kind === 'coin') {
        const color = COLORS[e.who];
        const n = e.value > 1 ? 26 : 12;
        for (let i = 0; i < n; i++) {
          const a = Math.random() * Math.PI * 2;
          const sp = 80 + Math.random() * (e.value > 1 ? 320 : 200);
          this.particles.push({
            x: e.x,
            y: e.y,
            vx: Math.cos(a) * sp,
            vy: Math.sin(a) * sp,
            life: 0.6,
            max: 0.6,
            color: i % 2 ? '#ffd34d' : color,
            size: 3 + Math.random() * 3,
          });
        }
        this.texts.push({ x: e.x, y: e.y - 10, text: `+${e.value}`, color, life: 0.9 });
      } else if (e.kind === 'boom') {
        for (let i = 0; i < 18; i++) {
          const a = Math.random() * Math.PI * 2;
          const sp = 60 + Math.random() * 260;
          this.particles.push({
            x: e.x,
            y: e.y,
            vx: Math.cos(a) * sp,
            vy: Math.sin(a) * sp,
            life: 0.5,
            max: 0.5,
            color: i % 3 ? '#ff8a3d' : '#ffd34d',
            size: 3 + Math.random() * 4,
          });
        }
        this.rings.push({ x: e.x, y: e.y, life: 0.35 });
        this.shake = Math.max(this.shake, 5);
      } else if (e.kind === 'hit') {
        for (let i = 0; i < 40; i++) {
          const a = Math.random() * Math.PI * 2;
          const sp = 100 + Math.random() * 400;
          this.particles.push({
            x: e.x,
            y: e.y,
            vx: Math.cos(a) * sp,
            vy: Math.sin(a) * sp,
            life: 0.9,
            max: 0.9,
            color: i % 2 ? COLORS[e.who] : '#ffffff',
            size: 4 + Math.random() * 4,
          });
        }
        this.shake = 16;
      } else if (e.kind === 'boardWon' && this.board) {
        const b = this.board;
        const cx = b.x + (e.board % 3) * (b.sb + b.gap) + b.sb / 2;
        const cy = b.y + Math.floor(e.board / 3) * (b.sb + b.gap) + b.sb / 2;
        for (let i = 0; i < 30; i++) {
          const a = Math.random() * Math.PI * 2;
          const sp = 60 + Math.random() * 220;
          this.screenParticles.push({
            x: cx,
            y: cy,
            vx: Math.cos(a) * sp,
            vy: Math.sin(a) * sp,
            life: 0.7,
            max: 0.7,
            color: i % 2 ? COLORS[e.who] : '#ffd34d',
            size: 3 + Math.random() * 3,
          });
        }
      } else if (e.kind === 'bump') {
        this.rings.push({ x: e.x, y: e.y, life: 0.35 });
        this.shake = Math.min(14, 4 + e.force / 60);
      }
    }
  }

  draw(view: View, dt: number) {
    this.t += dt;
    const { ctx } = this;
    const W = this.canvas.width / this.dpr;
    const H = this.canvas.height / this.dpr;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.fillStyle = '#07070d';
    ctx.fillRect(0, 0, W, H);

    let sx = 0;
    let sy = 0;
    if (this.shake > 0.1) {
      sx = (Math.random() - 0.5) * this.shake;
      sy = (Math.random() - 0.5) * this.shake;
      this.shake *= Math.exp(-10 * dt);
    }
    ctx.setTransform(this.dpr * this.scale, 0, 0, this.dpr * this.scale, this.dpr * (this.ox + sx), this.dpr * (this.oy + sy));

    if (!view.idle) this.drawHud(view);
    if (view.snap.mode === 'ttt' && !view.idle) {
      this.drawTtt(view, W, H, dt);
      ctx.setTransform(this.dpr * this.scale, 0, 0, this.dpr * this.scale, this.dpr * this.ox, this.dpr * this.oy);
      ctx.save();
      ctx.translate(0, HUD_H);
      this.drawBanner(view);
      ctx.restore();
      return;
    }
    this.board = null;
    ctx.save();
    ctx.translate(0, HUD_H);
    this.drawArena();
    if (view.snap.mode === 'paint') this.drawGrid(view.snap.grid);
    this.drawCoins(view.snap);
    if (view.snap.mode === 'meteor') this.drawMeteorWarnings(view.snap);
    this.drawPlayers(view);
    if (view.snap.mode === 'meteor') this.drawMeteorRocks(view.snap);
    this.drawEffects(dt);
    if (!view.idle) this.drawBanner(view);
    ctx.restore();

    if (view.stick?.active) this.drawStick(view.stick);
  }

  private drawArena() {
    const { ctx } = this;
    const g = ctx.createRadialGradient(ARENA.w / 2, ARENA.h / 2, 50, ARENA.w / 2, ARENA.h / 2, ARENA.w * 0.7);
    g.addColorStop(0, '#16142a');
    g.addColorStop(1, '#0b0a16');
    ctx.fillStyle = g;
    roundRect(ctx, 0, 0, ARENA.w, ARENA.h, 22);
    ctx.fill();
    ctx.save();
    roundRect(ctx, 0, 0, ARENA.w, ARENA.h, 22);
    ctx.clip();
    ctx.strokeStyle = 'rgba(255,255,255,0.04)';
    ctx.lineWidth = 1;
    for (let x = 50; x < ARENA.w; x += 50) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, ARENA.h);
      ctx.stroke();
    }
    for (let y = 50; y < ARENA.h; y += 50) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(ARENA.w, y);
      ctx.stroke();
    }
    ctx.restore();
    ctx.strokeStyle = 'rgba(160,140,255,0.35)';
    ctx.lineWidth = 3;
    ctx.shadowColor = 'rgba(160,140,255,0.6)';
    ctx.shadowBlur = 18;
    roundRect(ctx, 0, 0, ARENA.w, ARENA.h, 22);
    ctx.stroke();
    ctx.shadowBlur = 0;
  }

  /** Map a screen point to a tic-tac-toe (board, cell), or null. */
  hitTtt(clientX: number, clientY: number): { board: number; cell: number } | null {
    const b = this.board;
    if (!b) return null;
    for (let board = 0; board < 9; board++) {
      const bx = b.x + (board % 3) * (b.sb + b.gap);
      const by = b.y + Math.floor(board / 3) * (b.sb + b.gap);
      if (clientX < bx || clientY < by || clientX >= bx + b.sb || clientY >= by + b.sb) continue;
      const cs = b.sb / 3;
      const cell = Math.floor((clientY - by) / cs) * 3 + Math.floor((clientX - bx) / cs);
      return { board, cell: Math.max(0, Math.min(8, cell)) };
    }
    return null;
  }

  /**
   * Tic-tac-toe is laid out in screen space, not the arena, so the board can
   * fill a phone screen in either orientation.
   */
  private drawTtt(view: View, W: number, H: number, dt: number) {
    const t = view.snap.ttt;
    if (!t) return;
    const { ctx } = this;
    const pad = Math.min(W, H) < 500 ? 8 : 20;
    const top = this.oy + HUD_H * this.scale + 6;
    const lane = H > W ? 0 : 104;
    const side = Math.max(120, Math.min(W - pad * 2 - lane, H - top - pad));
    const gap = side * 0.035;
    const sb = (side - gap * 2) / 3;
    const cs = sb / 3;
    const x0 = (W - side) / 2;
    const y0 = top + Math.max(0, (H - top - pad - side) / 2);
    this.board = { x: x0, y: y0, side, gap, sb };
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);

    const playing = view.snap.phase === 'playing';
    const turnColor = COLORS[t.turn];
    const hover = view.canPlay && this.pointer ? this.hitTtt(this.pointer.x, this.pointer.y) : null;
    const legal = (b: number, c: number) =>
      playing && t.boards[b] === '0' && (t.next === -1 || t.next === b) && t.cells[b * 9 + c] === '0';

    for (let b = 0; b < 9; b++) {
      const bx = x0 + (b % 3) * (sb + gap);
      const by = y0 + Math.floor(b / 3) * (sb + gap);
      const open = t.boards[b] === '0';
      const active = playing && open && (t.next === -1 || t.next === b);
      ctx.fillStyle = active ? hexA(turnColor, 0.13) : 'rgba(255,255,255,0.035)';
      roundRect(ctx, bx, by, sb, sb, sb * 0.08);
      ctx.fill();
      if (active) {
        ctx.strokeStyle = hexA(turnColor, 0.4 + 0.25 * Math.sin(this.t * 4));
        ctx.lineWidth = 3;
        ctx.shadowColor = turnColor;
        ctx.shadowBlur = 14;
        ctx.stroke();
        ctx.shadowBlur = 0;
      }
      // Inner grid
      ctx.strokeStyle = 'rgba(232,230,255,0.22)';
      ctx.lineWidth = Math.max(1.5, cs * 0.04);
      ctx.lineCap = 'round';
      for (let k = 1; k < 3; k++) {
        ctx.beginPath();
        ctx.moveTo(bx + k * cs, by + cs * 0.15);
        ctx.lineTo(bx + k * cs, by + sb - cs * 0.15);
        ctx.moveTo(bx + cs * 0.15, by + k * cs);
        ctx.lineTo(bx + sb - cs * 0.15, by + k * cs);
        ctx.stroke();
      }
      for (let c = 0; c < 9; c++) {
        const cx = bx + (c % 3) * cs + cs / 2;
        const cy = by + Math.floor(c / 3) * cs + cs / 2;
        const v = t.cells[b * 9 + c];
        if (v === '1' || v === '2') {
          this.drawMark(Number(v) - 1, cx, cy, cs * 0.3, open ? 1 : 0.35);
          if (t.last === b * 9 + c) {
            ctx.strokeStyle = 'rgba(255,211,77,0.9)';
            ctx.lineWidth = 2;
            roundRect(ctx, cx - cs * 0.44, cy - cs * 0.44, cs * 0.88, cs * 0.88, cs * 0.15);
            ctx.stroke();
          }
        } else if (hover && hover.board === b && hover.cell === c && legal(b, c)) {
          this.drawMark(t.turn, cx, cy, cs * 0.3, 0.35);
        }
      }
      // Won or full boards get a big overlay mark.
      const st = t.boards[b];
      if (st === '1' || st === '2') {
        ctx.fillStyle = 'rgba(7,7,13,0.45)';
        roundRect(ctx, bx, by, sb, sb, sb * 0.08);
        ctx.fill();
        this.drawMark(Number(st) - 1, bx + sb / 2, by + sb / 2, sb * 0.32, 0.95, sb * 0.09);
      } else if (st === '3') {
        ctx.fillStyle = 'rgba(7,7,13,0.55)';
        roundRect(ctx, bx, by, sb, sb, sb * 0.08);
        ctx.fill();
      }
    }
    if (t.line) {
      const center = (b: number) => ({
        x: x0 + (b % 3) * (sb + gap) + sb / 2,
        y: y0 + Math.floor(b / 3) * (sb + gap) + sb / 2,
      });
      const a = center(t.line[0]);
      const z = center(t.line[2]);
      const owner = t.boards[t.line[0]] === '1' ? 0 : 1;
      ctx.strokeStyle = '#fff';
      ctx.shadowColor = COLORS[owner];
      ctx.shadowBlur = 24;
      ctx.lineWidth = sb * 0.07;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(z.x, z.y);
      ctx.stroke();
      ctx.shadowBlur = 0;
    }
    this.screenParticles = this.screenParticles.filter((p) => (p.life -= dt) > 0);
    for (const p of this.screenParticles) {
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      ctx.globalAlpha = p.life / p.max;
      ctx.fillStyle = p.color;
      ctx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
    }
    ctx.globalAlpha = 1;
  }

  /** X for the host (red), O for the guest (blue). */
  private drawMark(who: number, x: number, y: number, r: number, alpha: number, width = Math.max(3, r * 0.32)) {
    const { ctx } = this;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.strokeStyle = COLORS[who];
    ctx.shadowColor = COLORS[who];
    ctx.shadowBlur = 10;
    ctx.lineWidth = width;
    ctx.lineCap = 'round';
    ctx.beginPath();
    if (who === 0) {
      ctx.moveTo(x - r, y - r);
      ctx.lineTo(x + r, y + r);
      ctx.moveTo(x + r, y - r);
      ctx.lineTo(x - r, y + r);
    } else {
      ctx.arc(x, y, r, 0, Math.PI * 2);
    }
    ctx.stroke();
    ctx.restore();
  }

  private drawGrid(grid: string) {
    const { ctx } = this;
    const fills = ['', 'rgba(255,77,109,0.55)', 'rgba(56,214,255,0.55)'];
    for (let k = 0; k < grid.length; k++) {
      const o = grid.charCodeAt(k) - 48;
      if (o !== 1 && o !== 2) continue;
      const x = (k % GRID_W) * CELL;
      const y = Math.floor(k / GRID_W) * CELL;
      ctx.fillStyle = fills[o];
      ctx.fillRect(x + 1, y + 1, CELL - 2, CELL - 2);
    }
  }

  private drawMeteorWarnings(s: Snapshot) {
    const { ctx } = this;
    for (const m of s.meteors) {
      const k = Math.max(0, Math.min(1, 1 - m.t / METEOR_WARN)); // 0 -> 1 as impact nears
      ctx.fillStyle = `rgba(255,70,40,${0.08 + k * 0.22})`;
      ctx.beginPath();
      ctx.arc(m.x, m.y, BLAST_R, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = `rgba(255,110,60,${0.5 + k * 0.5})`;
      ctx.lineWidth = 2;
      ctx.stroke();
      // Closing ring: the meteor lands when it shrinks to the danger zone's edge.
      ctx.strokeStyle = 'rgba(255,220,120,0.9)';
      ctx.lineWidth = 3;
      ctx.globalAlpha = k;
      ctx.beginPath();
      ctx.arc(m.x, m.y, BLAST_R * (2 - k), 0, Math.PI * 2);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
  }

  private drawMeteorRocks(s: Snapshot) {
    const { ctx } = this;
    for (const m of s.meteors) {
      // Falls in from the upper right over the warning time.
      const k = Math.max(0, m.t / METEOR_WARN);
      const x = m.x + k * 260;
      const y = m.y - k * 520;
      const g = ctx.createLinearGradient(x, y, x + 60, y - 120);
      g.addColorStop(0, 'rgba(255,170,80,0.7)');
      g.addColorStop(1, 'rgba(255,170,80,0)');
      ctx.strokeStyle = g;
      ctx.lineWidth = 10;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + 60, y - 120);
      ctx.stroke();
      ctx.fillStyle = '#ffb36b';
      ctx.shadowColor = '#ff7a2f';
      ctx.shadowBlur = 20;
      ctx.beginPath();
      ctx.arc(x, y, 11, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;
    }
  }

  private drawCoins(s: Snapshot) {
    const { ctx } = this;
    for (const c of s.coins) {
      const big = c.value > 1;
      const r = (big ? BIG_COIN_R : COIN_R) * (1 + Math.sin(this.t * 6 + c.id) * 0.06);
      ctx.save();
      ctx.translate(c.x, c.y);
      ctx.shadowColor = big ? '#ffb347' : '#ffd34d';
      ctx.shadowBlur = big ? 26 : 14;
      ctx.fillStyle = big ? '#ffb347' : '#ffd34d';
      ctx.beginPath();
      ctx.arc(0, 0, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.fillStyle = 'rgba(255,255,255,0.55)';
      ctx.beginPath();
      ctx.arc(-r * 0.3, -r * 0.3, r * 0.3, 0, Math.PI * 2);
      ctx.fill();
      if (big) {
        ctx.fillStyle = '#5a2a00';
        ctx.font = '700 20px "Fredoka", system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('3', 0, 1);
      }
      ctx.restore();
    }
  }

  private drawPlayers(view: View) {
    const { ctx } = this;
    view.snap.players.forEach((p, i) => {
      const color = COLORS[i];
      const R = p.r;
      ctx.save();
      ctx.translate(p.x, p.y);
      if (!p.alive) ctx.globalAlpha = 0.3;
      ctx.shadowColor = color;
      ctx.shadowBlur = 24;
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(0, 0, R, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;
      // Speed ring: the gap shows how much of full speed is missing.
      if (p.speed < 0.999) {
        ctx.strokeStyle = 'rgba(255,255,255,0.85)';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(0, 0, R + 6, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * p.speed);
        ctx.stroke();
      }
      ctx.fillStyle = 'rgba(0,0,0,0.25)';
      ctx.beginPath();
      ctx.arc(0, 0, R * 0.45, 0, Math.PI * 2);
      ctx.fill();
      if (!p.alive) {
        ctx.globalAlpha = 1;
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 5;
        ctx.beginPath();
        ctx.moveTo(-R * 0.5, -R * 0.5);
        ctx.lineTo(R * 0.5, R * 0.5);
        ctx.moveTo(R * 0.5, -R * 0.5);
        ctx.lineTo(-R * 0.5, R * 0.5);
        ctx.stroke();
      }
      ctx.fillStyle = '#fff';
      ctx.font = '600 17px "Fredoka", system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'bottom';
      const label = view.me === i ? `${view.names[i]} (you)` : view.names[i];
      // When the dots are touching, put the guest's label underneath.
      const o = view.snap.players[1 - i];
      const close = Math.abs(o.x - p.x) < 130 && Math.abs(o.y - p.y) < 70 + R;
      if (i === 1 && close) {
        ctx.textBaseline = 'top';
        ctx.fillText(label, 0, R + 10);
      } else {
        ctx.fillText(label, 0, -R - 10);
      }
      ctx.restore();
    });
  }

  private drawEffects(dt: number) {
    const { ctx } = this;
    this.particles = this.particles.filter((p) => (p.life -= dt) > 0);
    for (const p of this.particles) {
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vx *= Math.exp(-4 * dt);
      p.vy *= Math.exp(-4 * dt);
      ctx.globalAlpha = p.life / p.max;
      ctx.fillStyle = p.color;
      ctx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
    }
    ctx.globalAlpha = 1;
    this.rings = this.rings.filter((r) => (r.life -= dt) > 0);
    for (const r of this.rings) {
      const k = 1 - r.life / 0.35;
      ctx.strokeStyle = `rgba(255,255,255,${0.7 * (1 - k)})`;
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.arc(r.x, r.y, 20 + k * 60, 0, Math.PI * 2);
      ctx.stroke();
    }
    this.texts = this.texts.filter((t) => (t.life -= dt) > 0);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const t of this.texts) {
      ctx.globalAlpha = Math.min(1, t.life * 2);
      ctx.fillStyle = t.color;
      ctx.font = '700 26px "Fredoka", system-ui, sans-serif';
      ctx.fillText(t.text, t.x, t.y - (0.9 - t.life) * 50);
    }
    ctx.globalAlpha = 1;
  }

  private drawHud(view: View) {
    const { ctx } = this;
    const s = view.snap;
    ctx.textBaseline = 'middle';
    for (const i of [0, 1] as const) {
      const p = s.players[i];
      const left = i === 0;
      const x = left ? 8 : WORLD_W - 8;
      ctx.textAlign = left ? 'left' : 'right';
      ctx.fillStyle = COLORS[i];
      ctx.font = '700 40px "Fredoka", system-ui, sans-serif';
      const mode = s.mode;
      const scoreText =
        mode === 'paint'
          ? `${Math.round((p.score / GRID_N) * 100)}%`
          : mode === 'meteor'
            ? p.alive
              ? '\u2665'
              : '\u2715'
            : String(p.score);
      ctx.fillText(scoreText, x, 28);
      const sw = ctx.measureText(scoreText).width;
      ctx.font = '600 18px "Fredoka", system-ui, sans-serif';
      ctx.fillStyle = '#e8e6ff';
      const nx = left ? x + sw + 14 : x - sw - 14;
      ctx.fillText(view.names[i], nx, 18);
      ctx.font = '500 14px "Fredoka", system-ui, sans-serif';
      // Show the stat this game adjusts, plus the other one whenever it isn't normal.
      const sp = s.handicap.speed[i];
      const sz = s.handicap.size[i];
      const effect = MODE_INFO[mode].effect;
      const stats: string[] = [];
      if (effect === 'none') stats.push(i === 0 ? 'plays X · boards won' : 'plays O · boards won');
      else {
        if (effect === 'speed' || sp !== 1) stats.push(`speed ${pct(sp)}%`);
        if (effect === 'size' || sz !== 1) stats.push(`size ${pct(sz)}%`);
      }
      ctx.fillStyle = effect !== 'none' && (sp < 1 || sz > 1) ? '#ffd34d' : 'rgba(232,230,255,0.55)';
      ctx.fillText(stats.join(' · '), nx, 40);
      // Round-win pips
      for (let k = 0; k < MODE_INFO[mode].wins; k++) {
        const px = left ? 14 + k * 20 : WORLD_W - 14 - k * 20;
        ctx.beginPath();
        ctx.arc(px, 64, 6, 0, Math.PI * 2);
        if (k < s.roundWins[i]) {
          ctx.fillStyle = COLORS[i];
          ctx.fill();
        } else {
          ctx.strokeStyle = 'rgba(255,255,255,0.25)';
          ctx.lineWidth = 2;
          ctx.stroke();
        }
      }
    }
    ctx.textAlign = 'center';
    const sudden = s.phase === 'sudden';
    ctx.fillStyle = sudden ? '#ff4d6d' : s.timeLeft <= 5 && s.phase === 'playing' ? '#ffd34d' : '#fff';
    ctx.font = '700 38px "Fredoka", system-ui, sans-serif';
    const info = MODE_INFO[s.mode];
    let center = sudden ? info.sudden : String(Math.ceil(s.timeLeft));
    if (s.mode === 'ttt' && s.ttt) {
      const turn = s.ttt.turn;
      center = s.phase !== 'playing' ? '' : view.me === turn ? 'Your turn' : `${view.names[turn]}'s turn`;
      ctx.fillStyle = COLORS[turn];
      ctx.font = '700 32px "Fredoka", system-ui, sans-serif';
    }
    ctx.fillText(center, WORLD_W / 2, 28);
    ctx.font = '500 14px "Fredoka", system-ui, sans-serif';
    ctx.fillStyle = 'rgba(232,230,255,0.55)';
    ctx.fillText(sudden ? info.suddenSub : `${info.name} · round ${s.round} · first to ${info.wins}`, WORLD_W / 2, 58);
  }

  private drawBanner(view: View) {
    const s = view.snap;
    const { ctx } = this;
    let big = '';
    let small = '';
    let color = '#fff';
    if (s.phase === 'countdown') {
      big = String(Math.max(1, Math.ceil(s.phaseTime)));
      small = s.round === 1 ? MODE_INFO[s.mode].blurb : '';
    } else if (s.phase === 'roundOver' && s.roundWinner === null) {
      big = 'Draw';
      small = 'Replaying the round';
    } else if (s.phase === 'roundOver' && s.roundWinner !== null) {
      big = `${view.names[s.roundWinner]} wins the round`;
      color = COLORS[s.roundWinner];
      small = describeChange(s.handicapBefore, s.handicap, view.names);
    } else if (s.phase === 'matchOver' && s.roundWinner !== null) {
      big = `${view.names[s.roundWinner]} wins the match!`;
      color = COLORS[s.roundWinner];
      small = describeChange(s.handicapBefore, s.handicap, view.names);
    }
    if (MODE_INFO[s.mode].effect === 'none' && s.roundWinner !== null) small = '';
    if (!big) return;
    ctx.fillStyle = 'rgba(7,7,13,0.55)';
    ctx.fillRect(0, ARENA.h / 2 - 80, ARENA.w, 150);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = color;
    ctx.shadowColor = color;
    ctx.shadowBlur = 20;
    ctx.font = `700 ${s.phase === 'countdown' ? 96 : 54}px "Fredoka", system-ui, sans-serif`;
    ctx.fillText(big, ARENA.w / 2, ARENA.h / 2 - 18);
    ctx.shadowBlur = 0;
    if (small) {
      ctx.fillStyle = '#ffd34d';
      ctx.font = '600 24px "Fredoka", system-ui, sans-serif';
      ctx.fillText(small, ARENA.w / 2, ARENA.h / 2 + 42);
    }
  }

  private drawStick(stick: TouchStick) {
    const { ctx } = this;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.strokeStyle = 'rgba(255,255,255,0.35)';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(stick.origin.x, stick.origin.y, stick.radius, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,0.45)';
    ctx.beginPath();
    ctx.arc(stick.thumb.x, stick.thumb.y, 26, 0, Math.PI * 2);
    ctx.fill();
  }
}

function hexA(hex: string, a: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${Math.max(0, Math.min(1, a))})`;
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
