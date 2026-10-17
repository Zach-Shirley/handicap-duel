import Peer, { type DataConnection } from 'peerjs';
import type { GameEvent, Mode, Phase } from './game';
import type { Handicaps } from './handicap';

/**
 * Networking: the host (computer) runs the authoritative simulation and
 * streams snapshots; the guest (phone) only sends its stick input.
 * Devices connect peer-to-peer over WebRTC. PeerJS's free public broker is
 * used only so the two browsers can find each other by room code.
 */

const PREFIX = 'handicap-duel-v1-';
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export function makeRoomCode(rng: () => number = Math.random): string {
  let s = '';
  for (let i = 0; i < 5; i++) s += ALPHABET[Math.floor(rng() * ALPHABET.length)];
  return s;
}

export function normalizeCode(raw: string): string {
  return raw
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, 5);
}

export interface Snapshot {
  mode: Mode;
  phase: Phase;
  phaseTime: number;
  timeLeft: number;
  round: number;
  players: { x: number; y: number; score: number; speed: number; r: number; alive: boolean }[];
  coins: { id: number; x: number; y: number; value: number }[];
  /** Paint grid as a string of '0' / '1' / '2', row-major. Empty outside paint mode. */
  grid: string;
  meteors: { id: number; x: number; y: number; t: number }[];
  roundWins: [number, number];
  roundWinner: 0 | 1 | null;
  handicap: Handicaps;
  handicapBefore: Handicaps;
}

export type HostMsg =
  | { t: 'welcome'; hostName: string; guestName: string }
  | { t: 'lobby'; hostName: string; guestName: string; handicap: Handicaps; mode: Mode }
  | { t: 'state'; s: Snapshot; ev: GameEvent[] }
  | { t: 'toLobby' }
  | { t: 'full' };

export type GuestMsg = { t: 'hello'; name: string } | { t: 'i'; x: number; y: number };

export interface HostHandlers {
  onGuest(name: string): void;
  onGuestLeft(): void;
  onInput(x: number, y: number): void;
  onStatus(text: string): void;
}

export class HostLink {
  peer: Peer | null = null;
  conn: DataConnection | null = null;
  code = '';
  private destroyed = false;

  constructor(private h: HostHandlers) {}

  /** Opens a room. Retries with a fresh code if the id is taken. */
  open(): Promise<string> {
    return new Promise((resolve, reject) => {
      let attempts = 0;
      const tryOpen = () => {
        attempts++;
        const code = makeRoomCode();
        const peer = new Peer(PREFIX + code);
        peer.on('open', () => {
          this.peer = peer;
          this.code = code;
          resolve(code);
        });
        peer.on('connection', (c) => this.accept(c));
        peer.on('disconnected', () => {
          if (this.destroyed) return;
          this.h.onStatus('Lost the matchmaking server, reconnecting…');
          try {
            peer.reconnect();
          } catch {
            /* reconnect throws if already destroyed */
          }
        });
        peer.on('error', (err: { type?: string }) => {
          if (err.type === 'unavailable-id' && attempts < 5) {
            peer.destroy();
            tryOpen();
            return;
          }
          if (!this.peer) {
            peer.destroy();
            reject(new Error(describePeerError(err.type)));
          } else {
            this.h.onStatus(describePeerError(err.type));
          }
        });
      };
      tryOpen();
    });
  }

  private accept(c: DataConnection) {
    if (this.conn && this.conn.open) {
      c.on('open', () => {
        c.send({ t: 'full' } satisfies HostMsg);
        setTimeout(() => c.close(), 500);
      });
      return;
    }
    this.conn = c;
    c.on('data', (raw) => {
      const m = raw as GuestMsg;
      if (!m || typeof m !== 'object') return;
      if (m.t === 'hello') this.h.onGuest(String(m.name || 'Player 2').slice(0, 16));
      else if (m.t === 'i') this.h.onInput(Number(m.x) || 0, Number(m.y) || 0);
    });
    c.on('close', () => {
      if (this.conn === c) {
        this.conn = null;
        this.h.onGuestLeft();
      }
    });
    c.on('error', () => {
      /* close fires too */
    });
  }

  get connected(): boolean {
    return !!this.conn && this.conn.open;
  }

  send(m: HostMsg) {
    if (this.conn && this.conn.open) this.conn.send(m);
  }

  destroy() {
    this.destroyed = true;
    this.conn?.close();
    this.peer?.destroy();
  }
}

export interface GuestHandlers {
  onMsg(m: HostMsg): void;
  onClosed(reason: string): void;
}

export class GuestLink {
  peer: Peer | null = null;
  conn: DataConnection | null = null;
  private closed = false;

  constructor(private h: GuestHandlers) {}

  join(code: string, name: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const peer = new Peer();
      this.peer = peer;
      let opened = false;
      const timer = setTimeout(() => {
        if (!opened) {
          reject(new Error('Could not reach the host. Check the code and that the host screen is open.'));
          this.destroy();
        }
      }, 15000);
      peer.on('open', () => {
        const c = peer.connect(PREFIX + code, { reliable: true });
        this.conn = c;
        c.on('open', () => {
          opened = true;
          clearTimeout(timer);
          c.send({ t: 'hello', name } satisfies GuestMsg);
          resolve();
        });
        c.on('data', (raw) => this.h.onMsg(raw as HostMsg));
        c.on('close', () => this.fail('The host left the game.'));
      });
      peer.on('error', (err: { type?: string }) => {
        if (!opened) {
          clearTimeout(timer);
          reject(new Error(err.type === 'peer-unavailable' ? `No game found with code ${code}.` : describePeerError(err.type)));
          this.destroy();
        } else if (err.type !== 'peer-unavailable') {
          this.fail(describePeerError(err.type));
        }
      });
    });
  }

  private fail(reason: string) {
    if (this.closed) return;
    this.closed = true;
    this.h.onClosed(reason);
  }

  sendInput(x: number, y: number) {
    if (this.conn && this.conn.open) {
      this.conn.send({ t: 'i', x: Math.round(x * 100) / 100, y: Math.round(y * 100) / 100 } satisfies GuestMsg);
    }
  }

  destroy() {
    this.closed = true;
    this.conn?.close();
    this.peer?.destroy();
  }
}

function describePeerError(type?: string): string {
  switch (type) {
    case 'network':
    case 'server-error':
    case 'socket-error':
    case 'socket-closed':
      return 'Could not reach the matchmaking server. Check the internet connection and try again.';
    case 'browser-incompatible':
      return 'This browser does not support peer-to-peer play.';
    case 'webrtc':
      return 'The direct connection failed. Try both devices on the same Wi-Fi.';
    default:
      return `Connection problem (${type ?? 'unknown'}).`;
  }
}
