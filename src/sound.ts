/** Tiny procedural sound effects; no audio files. */

let ctx: AudioContext | null = null;
let muted = false;

export function unlockAudio(): void {
  if (!ctx) {
    try {
      ctx = new AudioContext();
    } catch {
      return;
    }
  }
  if (ctx.state === 'suspended') void ctx.resume();
}

export function setMuted(m: boolean) {
  muted = m;
}

export function isMuted() {
  return muted;
}

function tone(freq: number, dur: number, type: OscillatorType = 'sine', vol = 0.15, delay = 0, slideTo?: number) {
  if (!ctx || muted) return;
  const t0 = ctx.currentTime + delay;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, t0 + dur);
  gain.gain.setValueAtTime(0.0001, t0);
  gain.gain.exponentialRampToValueAtTime(vol, t0 + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  osc.connect(gain).connect(ctx.destination);
  osc.start(t0);
  osc.stop(t0 + dur + 0.02);
}

export const sfx = {
  coin(mine: boolean) {
    const base = mine ? 880 : 520;
    tone(base, 0.08, 'square', 0.07);
    tone(base * 1.5, 0.12, 'square', 0.07, 0.06);
  },
  bigCoin(mine: boolean) {
    const base = mine ? 660 : 400;
    [1, 1.25, 1.5, 2].forEach((m, i) => tone(base * m, 0.12, 'triangle', 0.1, i * 0.05));
  },
  bump() {
    tone(140, 0.18, 'sine', 0.25, 0, 60);
  },
  beep() {
    tone(600, 0.12, 'sine', 0.12);
  },
  go() {
    tone(1000, 0.25, 'sine', 0.14);
  },
  sudden() {
    tone(300, 0.3, 'sawtooth', 0.08, 0, 600);
    tone(300, 0.3, 'sawtooth', 0.08, 0.3, 600);
  },
  win() {
    [523, 659, 784, 1046].forEach((f, i) => tone(f, 0.2, 'triangle', 0.12, i * 0.1));
  },
  lose() {
    [392, 330, 262].forEach((f, i) => tone(f, 0.25, 'triangle', 0.1, i * 0.12));
  },
};
