import './style.css';
import QRCode from 'qrcode';
import { createMatch, MODE_INFO, MODES, rematch, step, type GameEvent, type GameState, type Mode, type Vec } from './game';
import { cloneHc, fromLegacy, MANUAL_SIZE_MIN, MANUAL_SPEED_MAX, MANUAL_SPEED_MIN, neutral, nudge, pct, sanitize, type Effect, type Handicaps, type Side } from './handicap';
import { bindKeyboard, readKeys, TouchStick } from './input';
import { GuestLink, HostLink, normalizeCode, type HostMsg, type Snapshot } from './net';
import { Renderer } from './render';
import { isMuted, setMuted, sfx, unlockAudio } from './sound';

const app = document.getElementById('app')!;
app.innerHTML = `
  <canvas id="game"></canvas>
  <div id="overlay"></div>
  <div id="corner">
    <button id="btn-mute" title="Sound">🔊</button>
    <button id="btn-full" title="Fullscreen">⛶</button>
    <button id="btn-leave" title="Leave">✕</button>
  </div>
`;
const canvas = document.getElementById('game') as HTMLCanvasElement;
const overlay = document.getElementById('overlay')!;
const corner = document.getElementById('corner')!;
const renderer = new Renderer(canvas);
const stick = new TouchStick(canvas);
bindKeyboard();

// ---------- persistence (browser-local only) ----------
function load(key: string, fallback: string): string {
  try {
    return localStorage.getItem(key) ?? fallback;
  } catch {
    return fallback;
  }
}
function save(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* private mode etc. */
  }
}
let myName = load('hd.name', '');
function loadHandicaps(): Handicaps {
  const raw = load('hd.hc', '');
  if (raw) {
    try {
      return sanitize(JSON.parse(raw));
    } catch {
      return neutral();
    }
  }
  return fromLegacy(Number(load('hd.handicap', '0')) || 0);
}
let savedHc = loadHandicaps();
function saveHc() {
  save('hd.hc', JSON.stringify(savedHc));
}
const storedMode = load('hd.mode', 'coins') as Mode;
let savedMode: Mode = MODES.includes(storedMode) ? storedMode : 'coins';

// ---------- app state ----------
type Screen = 'menu' | 'hostLobby' | 'host' | 'guestWait' | 'guest' | 'practice';
let mode: Screen = 'menu';
let host: HostLink | null = null;
let guest: GuestLink | null = null;
let state: GameState | null = null;
let names: [string, string] = ['Player 1', 'Player 2'];
let guestInput: Vec = { x: 0, y: 0 };
let guestInputAt = 0;
let lastSend = 0;
let pendingNetEvents: GameEvent[] = [];
let lobbyStatus = '';

// Guest-side snapshot buffer for smooth interpolation.
let snaps: { at: number; s: Snapshot }[] = [];
let guestHc = neutral();
let guestMode: Mode = 'coins';
let wakeLock: { release(): Promise<void> } | null = null;

// ---------- helpers ----------
function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

function show(html: string) {
  overlay.innerHTML = html;
  overlay.classList.toggle('hidden', html === '');
}

function nameOr(fallback: string): string {
  const n = myName.trim().slice(0, 16);
  return n || fallback;
}

function joinUrl(code: string): string {
  return `${location.origin}${location.pathname}?join=${code}`;
}

async function keepAwake() {
  try {
    const nav = navigator as Navigator & { wakeLock?: { request(t: 'screen'): Promise<{ release(): Promise<void> }> } };
    if (nav.wakeLock && !wakeLock) wakeLock = await nav.wakeLock.request('screen');
  } catch {
    /* not supported */
  }
}

function releaseAwake() {
  void wakeLock?.release().catch(() => {});
  wakeLock = null;
}

function snapOf(s: GameState): Snapshot {
  const r = (n: number) => Math.round(n * 10) / 10;
  return {
    mode: s.mode,
    phase: s.phase,
    phaseTime: r(s.phaseTime),
    timeLeft: r(s.timeLeft),
    round: s.round,
    players: s.players.map((p) => ({ x: r(p.x), y: r(p.y), score: p.score, speed: p.speed, r: p.r, alive: p.alive })),
    coins: s.coins.map((c) => ({ id: c.id, x: r(c.x), y: r(c.y), value: c.value })),
    grid: s.mode === 'paint' ? s.grid.join('') : '',
    meteors: s.meteors.map((m) => ({ id: m.id, x: r(m.x), y: r(m.y), t: Math.round(m.t * 100) / 100 })),
    roundWins: [...s.roundWins] as [number, number],
    roundWinner: s.roundWinner,
    handicap: cloneHc(s.handicap),
    handicapBefore: cloneHc(s.handicapBefore),
  };
}

function playSounds(events: GameEvent[], me: 0 | 1 | null) {
  for (const e of events) {
    switch (e.kind) {
      case 'coin':
        if (e.value > 1) sfx.bigCoin(me === null || e.who === me);
        else sfx.coin(me === null || e.who === me);
        break;
      case 'bump':
        sfx.bump();
        break;
      case 'boom':
        sfx.boom();
        break;
      case 'hit':
        sfx.hit();
        break;
      case 'beep':
        sfx.beep();
        break;
      case 'go':
        sfx.go();
        break;
      case 'sudden':
        sfx.sudden();
        break;
      case 'round':
      case 'match':
        if (me === null || e.winner === me) sfx.win();
        else sfx.lose();
        break;
    }
  }
}

// ---------- screens ----------
function menuScreen(prefillCode = '') {
  mode = 'menu';
  corner.classList.add('hidden');
  const joining = prefillCode !== '';
  show(`
    <div class="panel">
      <h1>Handicap <span>Duel</span></h1>
      <p class="tag">Grab the most coins. The computer player gets slower every time they win.</p>
      <label class="field">Your name
        <input id="name" maxlength="16" placeholder="Your name" value="${esc(myName)}" autocomplete="off" />
      </label>
      ${
        joining
          ? `<div class="joinrow"><input id="code" maxlength="5" value="${esc(prefillCode)}" aria-label="Room code" /></div>
             <button class="primary" id="go-join">Join game</button>
             <button class="link" id="go-host">Host instead</button>`
          : `<button class="primary" id="go-host">Host a game</button>
             <div class="joinrow"><input id="code" maxlength="5" placeholder="CODE" aria-label="Room code" /><button id="go-join">Join</button></div>
             <button class="link" id="go-practice">Practice on one keyboard</button>`
      }
      <p class="err" id="err"></p>
    </div>`);
  const nameEl = document.getElementById('name') as HTMLInputElement;
  const codeEl = document.getElementById('code') as HTMLInputElement;
  nameEl.addEventListener('input', () => {
    myName = nameEl.value;
    save('hd.name', myName);
  });
  codeEl.addEventListener('input', () => {
    codeEl.value = normalizeCode(codeEl.value);
  });
  codeEl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') document.getElementById('go-join')?.click();
  });
  document.getElementById('go-host')!.addEventListener('click', () => {
    unlockAudio();
    void startHosting();
  });
  document.getElementById('go-join')!.addEventListener('click', () => {
    unlockAudio();
    const code = normalizeCode(codeEl.value);
    if (code.length !== 5) {
      document.getElementById('err')!.textContent = 'Enter the 5-character code from the host screen.';
      return;
    }
    void startJoining(code);
  });
  document.getElementById('go-practice')?.addEventListener('click', () => {
    unlockAudio();
    startPractice();
  });
  if (!joining) nameEl.focus();
}

async function startHosting() {
  mode = 'hostLobby';
  names = [nameOr('Player 1'), 'Player 2'];
  lobbyStatus = 'Opening a room…';
  show(`<div class="panel"><h2>Opening a room…</h2></div>`);
  host = new HostLink({
    onGuest(name) {
      names[1] = name;
      lobbyStatus = `${name} joined!`;
      host?.send({ t: 'welcome', hostName: names[0], guestName: name });
      sendLobby();
      if (mode === 'hostLobby') renderLobby();
    },
    onGuestLeft() {
      guestInput = { x: 0, y: 0 };
      lobbyStatus = `${names[1]} disconnected. They can rejoin with the same code.`;
      names[1] = 'Player 2';
      if (mode === 'host') {
        state = null;
        mode = 'hostLobby';
      }
      if (mode === 'hostLobby') renderLobby();
    },
    onInput(x, y) {
      guestInput = { x, y };
      guestInputAt = performance.now();
    },
    onStatus(text) {
      lobbyStatus = text;
      if (mode === 'hostLobby') renderLobby();
    },
  });
  try {
    await host.open();
  } catch (err) {
    host.destroy();
    host = null;
    show(`<div class="panel"><h2>Couldn't open a room</h2><p class="err">${esc((err as Error).message)}</p><button class="primary" id="back">Back</button></div>`);
    document.getElementById('back')!.addEventListener('click', () => menuScreen());
    return;
  }
  lobbyStatus = 'Waiting for player 2 to join…';
  renderLobby();
}

function sendLobby() {
  host?.send({ t: 'lobby', hostName: names[0], guestName: names[1], handicap: savedHc, mode: savedMode });
}

function statLine(h: Handicaps, n: [string, string]): string {
  const one = (i: Side) =>
    `<span style="color:var(--p${i + 1})">${esc(n[i])}: speed ${pct(h.speed[i])}% · size ${pct(h.size[i])}%</span>`;
  return `${one(0)}<br>${one(1)}`;
}

/** Host-only table: speed and size for both players, each with -/+ buttons. */
function handicapTable(h: Handicaps, n: [string, string]): string {
  const cell = (i: Side, e: Effect) => {
    const v = e === 'speed' ? h.speed[i] : h.size[i];
    const off = e === 'speed' ? v < 1 : v > 1;
    const boost = e === 'speed' ? v > 1 : v < 1;
    const lowDisabled = e === 'speed' ? v <= MANUAL_SPEED_MIN : v <= MANUAL_SIZE_MIN;
    const highDisabled = e === 'speed' && v >= MANUAL_SPEED_MAX;
    return `<td><div class="stepper">
      <button data-who="${i}" data-e="${e}" data-d="-1" ${lowDisabled ? 'disabled' : ''} aria-label="Less ${e}">−</button>
      <span class="${off ? 'off' : boost ? 'boost' : ''}">${pct(v)}%</span>
      <button data-who="${i}" data-e="${e}" data-d="1" ${highDisabled ? 'disabled' : ''} aria-label="More ${e}">+</button>
    </div></td>`;
  };
  const row = (i: Side) => `<tr><th style="color:var(--p${i + 1})">${esc(n[i])}</th>${cell(i, 'speed')}${cell(i, 'size')}</tr>`;
  return `<table class="htable"><thead><tr><th></th><th>Speed</th><th>Size</th></tr></thead><tbody>${row(0)}${row(1)}</tbody></table>`;
}

/** Game picker; calls onPick when a different game is chosen. */
function modePicker(current: Mode): string {
  return `<div class="modes">${MODES.map(
    (m) => `<button class="mode ${m === current ? 'on' : ''}" data-mode="${m}"><b>${MODE_INFO[m].name}</b><small>${MODE_INFO[m].blurb}</small></button>`,
  ).join('')}</div>`;
}

function bindModePicker(onPick: (m: Mode) => void) {
  overlay.querySelectorAll<HTMLButtonElement>('button.mode').forEach((b) =>
    b.addEventListener('click', () => onPick(b.dataset.mode as Mode)),
  );
}

function renderLobby() {
  if (!host) return;
  corner.classList.remove('hidden');
  const url = joinUrl(host.code);
  const ready = host.connected;
  show(`
    <div class="panel wide">
      <div class="lobby">
        <div class="qrbox">
          <canvas id="qr"></canvas>
          <p class="hint">Scan with the phone camera</p>
        </div>
        <div class="lobbyinfo">
          <p class="label">Room code</p>
          <p class="code">${host.code}</p>
          <p class="hint url">${esc(url)}</p>
          <p class="status ${ready ? 'ok' : ''}">${esc(lobbyStatus)}</p>
        </div>
      </div>
      <p class="label pick">Pick a game</p>
      ${modePicker(savedMode)}
      <div class="lobby">
        <div class="lobbyinfo">
          <div class="hcap">
            <div class="hhead"><p class="label">Handicap</p><button id="h-reset" class="small">Reset all</button></div>
            ${handicapTable(savedHc, names)}
            <p class="hint">In ${MODE_INFO[savedMode].name}, each round the computer player wins makes them ${MODE_INFO[savedMode].effect === 'size' ? 'bigger' : 'slower'}, with no limit. Speed and size both apply in every game. Bigger helps in Coin Rush and Paint. Saved on this computer.</p>
          </div>
          <button class="primary" id="start" ${ready ? '' : 'disabled'}>${ready ? 'Start match' : 'Waiting for player 2…'}</button>
          <p class="hint">You: WASD or arrow keys. Phone: drag a thumb anywhere.</p>
        </div>
      </div>
    </div>`);
  void QRCode.toCanvas(document.getElementById('qr') as HTMLCanvasElement, url, {
    width: 200,
    margin: 1,
    color: { dark: '#07070d', light: '#ffffff' },
  });
  const commit = (h: Handicaps) => {
    savedHc = h;
    saveHc();
    sendLobby();
    renderLobby();
  };
  overlay.querySelectorAll<HTMLButtonElement>('.stepper button').forEach((b) =>
    b.addEventListener('click', () =>
      commit(nudge(savedHc, Number(b.dataset.who) as Side, b.dataset.e as Effect, Number(b.dataset.d) as 1 | -1)),
    ),
  );
  bindModePicker((m) => {
    savedMode = m;
    save('hd.mode', m);
    sendLobby();
    renderLobby();
  });
  document.getElementById('h-reset')!.addEventListener('click', () => commit(neutral()));
  document.getElementById('start')!.addEventListener('click', () => {
    if (!host?.connected) return;
    unlockAudio();
    state = createMatch(savedHc, savedMode);
    pendingNetEvents = [];
    mode = 'host';
    show('');
    void keepAwake();
  });
}

function matchOverPanel(isHost: boolean) {
  if (isHost) {
    show(`
      <div class="panel bottom">
        <button class="primary" id="again">Rematch</button>
        <button id="lobby">Lobby</button>
      </div>`);
    document.getElementById('again')!.addEventListener('click', () => {
      if (!state) return;
      rematch(state);
      show('');
    });
    document.getElementById('lobby')!.addEventListener('click', () => {
      state = null;
      mode = 'hostLobby';
      host?.send({ t: 'toLobby' });
      sendLobby();
      lobbyStatus = host?.connected ? `${names[1]} is here.` : 'Waiting for player 2 to join…';
      renderLobby();
    });
  } else {
    show(`<div class="panel bottom"><p>Waiting for ${esc(names[0])} to start a rematch…</p></div>`);
  }
}

async function startJoining(code: string) {
  mode = 'guestWait';
  const name = nameOr('Player 2');
  names = ['Host', name];
  show(`<div class="panel"><h2>Joining ${code}…</h2></div>`);
  guest = new GuestLink({
    onMsg: onHostMsg,
    onClosed(reason) {
      releaseAwake();
      guest?.destroy();
      guest = null;
      snaps = [];
      mode = 'guestWait';
      show(`<div class="panel"><h2>Disconnected</h2><p class="err">${esc(reason)}</p>
        <button class="primary" id="retry">Rejoin ${code}</button><button class="link" id="back">Back</button></div>`);
      document.getElementById('retry')!.addEventListener('click', () => void startJoining(code));
      document.getElementById('back')!.addEventListener('click', () => menuScreen());
    },
  });
  try {
    await guest.join(code, name);
  } catch (err) {
    guest?.destroy();
    guest = null;
    show(`<div class="panel"><h2>Couldn't join</h2><p class="err">${esc((err as Error).message)}</p>
      <button class="primary" id="retry">Try again</button><button class="link" id="back">Back</button></div>`);
    document.getElementById('retry')!.addEventListener('click', () => void startJoining(code));
    document.getElementById('back')!.addEventListener('click', () => menuScreen(code));
    return;
  }
  corner.classList.remove('hidden');
  guestWaitScreen('Connected! Waiting for the host to start…');
}

function guestWaitScreen(text: string) {
  mode = 'guestWait';
  const portrait = window.innerHeight > window.innerWidth;
  show(`
    <div class="panel">
      <h2>${esc(text)}</h2>
      <p class="label">${esc(MODE_INFO[guestMode].name)}</p>
      <p>${statLine(guestHc, names)}</p>
      <p class="hint">Drag your thumb anywhere on the screen to move.</p>
      ${portrait ? '<p class="warn">Turn your phone sideways for a bigger arena.</p>' : ''}
      <button id="fs">Go fullscreen</button>
    </div>`);
  document.getElementById('fs')!.addEventListener('click', () => void goFullscreen());
}

function onHostMsg(m: HostMsg) {
  switch (m.t) {
    case 'welcome':
    case 'lobby':
      names = [m.hostName, m.guestName];
      if (m.t === 'lobby') {
        guestHc = sanitize(m.handicap);
        guestMode = m.mode;
      }
      if (mode === 'guestWait') guestWaitScreen('Connected! Waiting for the host to start…');
      break;
    case 'toLobby':
      snaps = [];
      releaseAwake();
      guestWaitScreen(`Back in the lobby. Waiting for ${names[0]}…`);
      break;
    case 'full':
      show(`<div class="panel"><h2>That game is full</h2><button class="primary" id="back">Back</button></div>`);
      document.getElementById('back')!.addEventListener('click', () => menuScreen());
      guest?.destroy();
      guest = null;
      break;
    case 'state': {
      const now = performance.now();
      snaps.push({ at: now, s: m.s });
      if (snaps.length > 6) snaps.shift();
      renderer.effects(m.ev);
      playSounds(m.ev, 1);
      if (mode !== 'guest') {
        mode = 'guest';
        show('');
        void keepAwake();
      }
      const over = m.s.phase === 'matchOver';
      const showing = overlay.querySelector('.bottom') !== null;
      if (over && !showing) matchOverPanel(false);
      else if (!over && showing) show('');
      break;
    }
  }
}

function startPractice() {
  corner.classList.remove('hidden');
  show(`
    <div class="panel wide">
      <h2>Practice: two players, one keyboard</h2>
      <p class="hint">Left player: WASD. Right player: arrow keys. Esc to quit.</p>
      ${modePicker(savedMode)}
      <button class="link" id="back">Back</button>
    </div>`);
  bindModePicker((m) => {
    savedMode = m;
    save('hd.mode', m);
    mode = 'practice';
    names = ['WASD', 'Arrows'];
    state = createMatch(neutral(), m);
    show('');
  });
  document.getElementById('back')!.addEventListener('click', () => leave());
}

async function goFullscreen() {
  try {
    if (!document.fullscreenElement) {
      await document.documentElement.requestFullscreen();
      const o = screen.orientation as ScreenOrientation & { lock?: (o: string) => Promise<void> };
      await o.lock?.('landscape').catch(() => {});
    } else {
      await document.exitFullscreen();
    }
  } catch {
    /* iOS Safari has no fullscreen for pages */
  }
}

function leave() {
  releaseAwake();
  host?.destroy();
  host = null;
  guest?.destroy();
  guest = null;
  state = null;
  snaps = [];
  history.replaceState(null, '', location.pathname);
  menuScreen();
}

// ---------- corner buttons ----------
const muteBtn = document.getElementById('btn-mute')!;
muteBtn.addEventListener('click', () => {
  setMuted(!isMuted());
  muteBtn.textContent = isMuted() ? '🔇' : '🔊';
});
document.getElementById('btn-full')!.addEventListener('click', () => void goFullscreen());
document.getElementById('btn-leave')!.addEventListener('click', () => {
  if (confirm('Leave this game?')) leave();
});
window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && mode === 'practice') leave();
});
canvas.addEventListener('contextmenu', (e) => e.preventDefault());

// ---------- main loop ----------
const FIXED = 1 / 120;
let acc = 0;
let last = performance.now();

function guestView(now: number): Snapshot | null {
  if (snaps.length === 0) return null;
  const latest = snaps[snaps.length - 1].s;
  const renderAt = now - 50;
  for (let i = snaps.length - 1; i > 0; i--) {
    const a = snaps[i - 1];
    const b = snaps[i];
    if (a.at <= renderAt && renderAt <= b.at) {
      const k = (renderAt - a.at) / Math.max(1, b.at - a.at);
      return {
        ...latest,
        players: b.s.players.map((p, j) => ({
          ...p,
          x: a.s.players[j].x + (p.x - a.s.players[j].x) * k,
          y: a.s.players[j].y + (p.y - a.s.players[j].y) * k,
        })),
      };
    }
  }
  return latest;
}

function tick(now: number) {
  const dt = Math.max(0, Math.min(0.1, (now - last) / 1000));
  last = now;

  if ((mode === 'host' || mode === 'practice') && state) {
    const prevPhase = state.phase;
    acc += dt;
    while (acc >= FIXED) {
      const stale = now - guestInputAt > 500;
      const inputs: [Vec, Vec] =
        mode === 'practice'
          ? [readKeys('wasd'), readKeys('arrows')]
          : [readKeys('both'), stale ? { x: 0, y: 0 } : guestInput];
      step(state, inputs, FIXED);
      acc -= FIXED;
    }
    const events = state.events;
    state.events = [];
    if (events.length) {
      renderer.effects(events);
      playSounds(events, mode === 'host' ? 0 : null);
      pendingNetEvents.push(...events);
      if (mode === 'host' && events.some((e) => e.kind === 'round' || e.kind === 'match')) {
        savedHc = cloneHc(state.handicap);
        saveHc();
      }
    }
    if (mode === 'host' && host && now - lastSend >= 33) {
      host.send({ t: 'state', s: snapOf(state), ev: pendingNetEvents });
      pendingNetEvents = [];
      lastSend = now;
    }
    if (state.phase === 'matchOver' && prevPhase !== 'matchOver') {
      if (mode === 'host') matchOverPanel(true);
      else practiceOver();
    }
    renderer.draw({ snap: snapOf(state), names, me: mode === 'host' ? 0 : null }, dt);
  } else if (mode === 'guest') {
    if (now - lastSend >= 33) {
      const kb = readKeys('both');
      const v = stick.active ? stick.read() : kb;
      guest?.sendInput(v.x, v.y);
      lastSend = now;
    }
    const view = guestView(now);
    if (view) renderer.draw({ snap: view, names, me: 1, stick }, dt);
  } else {
    acc = 0;
    renderer.draw({ snap: idleSnap(now), names: ['', ''], me: null, idle: true }, dt);
  }
}

function frame(now: number) {
  tick(now);
  requestAnimationFrame(frame);
}

function practiceOver() {
  show(`<div class="panel bottom"><button class="primary" id="again">Play again</button><button id="menu">Menu</button></div>`);
  document.getElementById('again')!.addEventListener('click', () => {
    if (state) rematch(state);
    show('');
  });
  document.getElementById('menu')!.addEventListener('click', leave);
}

/** Attract-mode backdrop behind menus: two dots drifting around coins. */
function idleSnap(now: number): Snapshot {
  const t = now / 1000;
  return {
    mode: 'coins',
    phase: 'playing',
    phaseTime: 0,
    timeLeft: 30,
    round: 1,
    players: [
      { x: 500 + Math.cos(t * 0.7) * 320, y: 312 + Math.sin(t * 1.1) * 180, score: 0, speed: 1, r: 24, alive: true },
      { x: 500 + Math.cos(t * 0.9 + 2) * 300, y: 312 + Math.sin(t * 0.8 + 1) * 200, score: 0, speed: 1, r: 24, alive: true },
    ],
    coins: [
      { id: 1, x: 300, y: 200, value: 1 },
      { id: 2, x: 700, y: 420, value: 1 },
      { id: 3, x: 520, y: 140, value: 3 },
    ],
    grid: '',
    meteors: [],
    roundWins: [0, 0],
    roundWinner: null,
    handicap: neutral(),
    handicapBefore: neutral(),
  };
}

const params = new URLSearchParams(location.search);
menuScreen(normalizeCode(params.get('join') ?? ''));
requestAnimationFrame(frame);

if (import.meta.env.DEV) {
  // Test hook: drive frames manually when the tab is hidden (rAF paused).
  let virt = 0;
  (window as unknown as Record<string, unknown>).__hd = {
    run(ms: number) {
      virt = Math.max(virt, performance.now());
      last = virt;
      for (let t = 16; t <= ms; t += 16) tick((virt += 16));
    },
    state: () => state,
    snaps: () => snaps.length,
    mode: () => mode,
    stick: () => stick.read(),
  };
}
