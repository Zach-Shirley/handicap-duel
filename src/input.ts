import type { Vec } from './game';

const keys = new Set<string>();
let keyboardBound = false;

export function bindKeyboard(): void {
  if (keyboardBound) return;
  keyboardBound = true;
  window.addEventListener('keydown', (e) => {
    if (e.target instanceof HTMLInputElement) return;
    keys.add(e.code);
    if (e.code.startsWith('Arrow') || e.code === 'Space') e.preventDefault();
  });
  window.addEventListener('keyup', (e) => keys.delete(e.code));
  window.addEventListener('blur', () => keys.clear());
}

function axis(neg: string[], pos: string[]): number {
  return (pos.some((k) => keys.has(k)) ? 1 : 0) - (neg.some((k) => keys.has(k)) ? 1 : 0);
}

/** 'wasd', 'arrows', or 'both' (host playing alone uses either set). */
export function readKeys(set: 'wasd' | 'arrows' | 'both'): Vec {
  const L = set === 'wasd' ? ['KeyA'] : set === 'arrows' ? ['ArrowLeft'] : ['KeyA', 'ArrowLeft'];
  const R = set === 'wasd' ? ['KeyD'] : set === 'arrows' ? ['ArrowRight'] : ['KeyD', 'ArrowRight'];
  const U = set === 'wasd' ? ['KeyW'] : set === 'arrows' ? ['ArrowUp'] : ['KeyW', 'ArrowUp'];
  const D = set === 'wasd' ? ['KeyS'] : set === 'arrows' ? ['ArrowDown'] : ['KeyS', 'ArrowDown'];
  const x = axis(L, R);
  const y = axis(U, D);
  const len = Math.hypot(x, y);
  return len > 0 ? { x: x / len, y: y / len } : { x: 0, y: 0 };
}

/**
 * Floating thumb joystick: touch anywhere, drag to steer. The stick's
 * centre is wherever the thumb first lands.
 */
export class TouchStick {
  readonly radius = 60;
  active = false;
  origin: Vec = { x: 0, y: 0 };
  thumb: Vec = { x: 0, y: 0 };
  private id: number | null = null;

  constructor(private el: HTMLElement) {
    el.addEventListener('pointerdown', this.down, { passive: false });
    window.addEventListener('pointermove', this.move, { passive: false });
    window.addEventListener('pointerup', this.up);
    window.addEventListener('pointercancel', this.up);
  }

  private down = (e: PointerEvent) => {
    if (e.pointerType === 'mouse' || this.id !== null) return;
    e.preventDefault();
    this.id = e.pointerId;
    this.active = true;
    this.origin = { x: e.clientX, y: e.clientY };
    this.thumb = { ...this.origin };
  };

  private move = (e: PointerEvent) => {
    if (e.pointerId !== this.id) return;
    e.preventDefault();
    const dx = e.clientX - this.origin.x;
    const dy = e.clientY - this.origin.y;
    const len = Math.hypot(dx, dy);
    if (len > this.radius) {
      // Drag the base along so reversing direction is instant.
      const over = len - this.radius;
      this.origin.x += (dx / len) * over;
      this.origin.y += (dy / len) * over;
    }
    this.thumb = { x: e.clientX, y: e.clientY };
  };

  private up = (e: PointerEvent) => {
    if (e.pointerId !== this.id) return;
    this.id = null;
    this.active = false;
  };

  read(): Vec {
    if (!this.active) return { x: 0, y: 0 };
    const dx = (this.thumb.x - this.origin.x) / this.radius;
    const dy = (this.thumb.y - this.origin.y) / this.radius;
    const len = Math.hypot(dx, dy);
    if (len < 0.12) return { x: 0, y: 0 }; // dead zone
    // Past ~70% deflection counts as full speed: thumbs are imprecise.
    const mag = Math.min(1, len / 0.7);
    return { x: (dx / len) * mag, y: (dy / len) * mag };
  }

  destroy() {
    this.el.removeEventListener('pointerdown', this.down);
    window.removeEventListener('pointermove', this.move);
    window.removeEventListener('pointerup', this.up);
    window.removeEventListener('pointercancel', this.up);
  }
}
