// Procedural sound (SPEC 28.3, 35.1): every cue is synthesized with WebAudio, so the repo ships no audio assets
// (the owner's rule is CC0 only; synthesis has no license at all). P6 turns the single oscillator recipes into
// layered sounds: each cue is a list of layers (oscillator sweeps, noise bursts with their own filter, a sub thump),
// panned from the listener's point of view, lowpassed with distance, with a distant variant for far gunfire and a
// ducking stage so your own shot sits on top of the mix. `cueFor` and the math in audioModel.js are the pure part;
// `Audio` plays recipes, creates the context on the first user gesture, and stays silent without an AudioContext.
import { panFor, falloff as falloffM, isDistant, BUSES, DEFAULT_LEVELS, busGain, clampLevel, cutoffFor, DUCK } from './audioModel.js';

export { panFor };
export const falloff = falloffM;

// Layer: { kind: 'osc' | 'noise' | 'sub', type, f0, f1, dur, gain, delay, hp, lp, q }. Times in seconds.
const osc = (type, f0, f1, dur, gain, extra = {}) => ({ kind: 'osc', type, f0, f1, dur, gain, ...extra });
const noise = (dur, gain, extra = {}) => ({ kind: 'noise', dur, gain, ...extra });
const sub = (f0, f1, dur, gain, extra = {}) => ({ kind: 'sub', f0, f1, dur, gain, ...extra });

export const CUES = Object.freeze({
  // gunfire: crack (noise, highpassed), body (sweep), thump (sub)
  shot_rifle: { bus: 'sfx', duck: true, layers: [noise(0.07, 0.55, { hp: 1200 }), osc('square', 380, 90, 0.1, 0.22), sub(110, 45, 0.12, 0.35)] },
  shot_smg: { bus: 'sfx', duck: true, layers: [noise(0.05, 0.45, { hp: 1800 }), osc('square', 520, 140, 0.06, 0.18), sub(130, 60, 0.08, 0.25)] },
  shot_shotgun: { bus: 'sfx', duck: true, layers: [noise(0.16, 0.9, { hp: 400 }), osc('sawtooth', 220, 50, 0.2, 0.3), sub(90, 30, 0.25, 0.55)] },
  shot_sniper: { bus: 'sfx', duck: true, layers: [noise(0.12, 0.7, { hp: 900 }), osc('sawtooth', 900, 60, 0.28, 0.3), sub(80, 28, 0.35, 0.6), noise(0.5, 0.18, { lp: 1200, delay: 0.08 })] },
  shot_pistol: { bus: 'sfx', duck: true, layers: [noise(0.05, 0.5, { hp: 1500 }), osc('square', 600, 160, 0.07, 0.2), sub(120, 55, 0.09, 0.3)] },
  // far gunfire: no crack, long low tail
  shot_distant: { bus: 'sfx', layers: [noise(0.35, 0.35, { lp: 700 }), sub(70, 35, 0.4, 0.4)] },
  // weapon handling
  reload: { bus: 'sfx', layers: [noise(0.03, 0.25, { hp: 2500 }), noise(0.04, 0.3, { hp: 1800, delay: 0.25 }), osc('square', 900, 700, 0.03, 0.12, { delay: 0.55 })] },
  switch: { bus: 'sfx', layers: [noise(0.04, 0.3, { hp: 2000 }), osc('triangle', 700, 500, 0.05, 0.1, { delay: 0.05 })] },
  empty: { bus: 'sfx', layers: [osc('square', 1800, 1500, 0.03, 0.12)] },
  // feedback
  hit: { bus: 'sfx', layers: [osc('triangle', 1400, 1200, 0.05, 0.18)] },
  headshot: { bus: 'sfx', layers: [osc('triangle', 2100, 1900, 0.06, 0.2), osc('sine', 3100, 2900, 0.08, 0.1, { delay: 0.02 })] },
  kill: { bus: 'sfx', layers: [osc('triangle', 660, 990, 0.22, 0.25), osc('sine', 1320, 1980, 0.18, 0.08, { delay: 0.05 })] },
  damage: { bus: 'sfx', layers: [noise(0.08, 0.3, { lp: 600 }), sub(90, 60, 0.12, 0.3)] },
  death: { bus: 'sfx', layers: [osc('sawtooth', 220, 40, 0.6, 0.3, { lp: 1200 }), noise(0.4, 0.2, { lp: 500 })] },
  boom: { bus: 'sfx', duck: true, layers: [noise(0.5, 1, { lp: 2500 }), sub(120, 25, 0.7, 0.6), noise(1.2, 0.25, { lp: 400, delay: 0.1 })] },
  // movement
  step: { bus: 'sfx', layers: [noise(0.04, 0.35, { lp: 1800, hp: 200 }), sub(140, 60, 0.05, 0.1)] },
  jump: { bus: 'sfx', layers: [noise(0.06, 0.25, { lp: 1500 })] },
  land: { bus: 'sfx', layers: [noise(0.08, 0.45, { lp: 900 }), sub(100, 50, 0.1, 0.3)] },
  slide: { bus: 'sfx', layers: [noise(0.35, 0.3, { lp: 1200, hp: 300 })] },
  // pickups, kit, progression
  pickup: { bus: 'sfx', layers: [osc('sine', 520, 1040, 0.14, 0.2), osc('sine', 1040, 1560, 0.1, 0.1, { delay: 0.08 })] },
  ability: { bus: 'sfx', layers: [osc('sine', 300, 900, 0.2, 0.22), noise(0.15, 0.15, { hp: 3000 })] },
  denied: { bus: 'ui', layers: [osc('square', 200, 150, 0.08, 0.12)] },
  level: { bus: 'ui', layers: [osc('triangle', 523, 1046, 0.35, 0.25), osc('triangle', 784, 1568, 0.3, 0.12, { delay: 0.12 })] },
  medal: { bus: 'ui', layers: [osc('sine', 880, 1320, 0.18, 0.2), osc('sine', 1320, 1760, 0.22, 0.14, { delay: 0.12 })] },
  // match flow and menu
  match: { bus: 'ui', layers: [osc('sine', 392, 784, 0.5, 0.25)] },
  countdown: { bus: 'ui', layers: [osc('sine', 880, 870, 0.08, 0.2)] },
  go: { bus: 'ui', layers: [osc('sine', 1320, 1310, 0.25, 0.25), osc('sine', 1760, 1750, 0.3, 0.12, { delay: 0.04 })] },
  ui_hover: { bus: 'ui', layers: [osc('sine', 1500, 1600, 0.03, 0.06)] },
  ui_click: { bus: 'ui', layers: [osc('triangle', 900, 1200, 0.05, 0.12)] },
  ui_back: { bus: 'ui', layers: [osc('triangle', 700, 500, 0.06, 0.1)] },
});
export const CUE_IDS = Object.freeze(Object.keys(CUES));

// Game event -> cue id (null = silent). Pure. `data.d` is the distance for shots so far gunfire picks the distant variant.
export function cueFor(event, data = {}) {
  switch (event) {
    case 'shot': return isDistant(data.d ?? 0) ? 'shot_distant' : (CUES[`shot_${data.w}`] ? `shot_${data.w}` : 'shot_rifle');
    case 'hit': return data.head ? 'headshot' : 'hit';
    case 'kill': return data.mine ? 'kill' : null;
    case 'death': return 'death';
    case 'damage': return 'damage';
    case 'boom': return 'boom';
    case 'pickup': return data.mine ? 'pickup' : null;
    case 'ability': return data.denied ? (data.mine ? 'denied' : null) : 'ability';
    case 'levelUp': return 'level';
    case 'medal': return 'medal';
    case 'reload': return 'reload';
    case 'switch': return 'switch';
    case 'empty': return 'empty';
    case 'step': return 'step';
    case 'jump': return 'jump';
    case 'land': return 'land';
    case 'slide': return 'slide';
    case 'countdown': return data.go ? 'go' : 'countdown';
    case 'matchStart': case 'matchEnd': return 'match';
    case 'ui': return CUES[`ui_${data.kind}`] ? `ui_${data.kind}` : 'ui_click';
    default: return null;
  }
}

export class Audio {
  #ctx = null;
  #master = null;
  #buses = {};
  #duck = null;
  #enabled;
  #Ctx;
  #noise = null;
  #levels = { ...DEFAULT_LEVELS };
  #listener = { x: 0, z: 0, yaw: 0 };
  #active = 0;

  constructor({ enabled = true, AudioContextClass = globalThis.AudioContext ?? globalThis.webkitAudioContext } = {}) {
    this.#enabled = enabled;
    this.#Ctx = AudioContextClass ?? null;
  }

  get available() {
    return this.#Ctx !== null;
  }

  get enabled() {
    return this.#enabled;
  }

  get levels() {
    return { ...this.#levels };
  }

  setEnabled(on) {
    this.#enabled = !!on;
    if (this.#master) this.#master.gain.value = this.#enabled ? busGain(this.#levels, 'master') : 0;
  }

  // Bus levels 0..1 (SPEC 33 reads them from the settings). Unknown buses are ignored.
  setLevel(bus, value) {
    if (!BUSES.includes(bus)) return false;
    this.#levels[bus] = clampLevel(value);
    if (this.#master && bus === 'master') this.#master.gain.value = this.#enabled ? this.#levels.master : 0;
    if (this.#buses[bus]) this.#buses[bus].gain.value = this.#levels[bus];
    return true;
  }

  // Where the player's ears are, for panning. Call once per frame.
  setListener(x, z, yaw) {
    this.#listener = { x, z, yaw };
  }

  // Call from a user gesture (the Play click): browsers block audio before one.
  unlock() {
    if (!this.#Ctx) return false;
    if (this.#ctx) { this.#ctx.resume?.(); return true; }
    this.#ctx = new this.#Ctx();
    this.#master = this.#ctx.createGain();
    this.#master.gain.value = this.#enabled ? this.#levels.master : 0;
    this.#master.connect(this.#ctx.destination);
    this.#duck = this.#ctx.createGain();
    this.#duck.gain.value = 1;
    this.#duck.connect(this.#master);
    for (const b of BUSES) {
      if (b === 'master') continue;
      const g = this.#ctx.createGain();
      g.gain.value = this.#levels[b];
      g.connect(b === 'sfx' ? this.#duck : this.#master); // ui sounds are never ducked
      this.#buses[b] = g;
    }
    return true;
  }

  // Plays a cue. `volume` is the distance attenuation (0..1); `at` is the world position [x, y, z] for panning and
  // the distance lowpass (null = on the listener). Returns false when nothing could play.
  play(cueId, volume = 1, at = null) {
    const c = CUES[cueId];
    if (!c || !this.#ctx || !this.#enabled || !(volume > 0)) return false;
    if (this.#active > 48) return false; // a grenade in a crowd must not pile up hundreds of nodes
    const ctx = this.#ctx;
    const t = ctx.currentTime;
    const dist = at ? Math.hypot(at[0] - this.#listener.x, at[2] - this.#listener.z) : 0;
    const out = ctx.createGain();
    out.gain.value = volume;
    let head = out;
    if (at && typeof ctx.createStereoPanner === 'function') {
      const pan = ctx.createStereoPanner();
      pan.pan.value = panFor(this.#listener, at);
      out.connect(pan);
      head = pan;
    }
    if (dist > 4 && typeof ctx.createBiquadFilter === 'function') {
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = cutoffFor(dist);
      head.connect(lp);
      head = lp;
    }
    head.connect(this.#buses[c.bus] ?? this.#master);
    let longest = 0;
    for (const L of c.layers) {
      const start = t + (L.delay ?? 0);
      longest = Math.max(longest, (L.delay ?? 0) + L.dur);
      const env = ctx.createGain();
      env.gain.setValueAtTime(0.0001, start);
      env.gain.linearRampToValueAtTime(L.gain, start + 0.004);
      env.gain.exponentialRampToValueAtTime(0.001, start + L.dur);
      let dst = env;
      if ((L.hp || L.lp) && typeof ctx.createBiquadFilter === 'function') {
        const f = ctx.createBiquadFilter();
        f.type = L.hp ? 'highpass' : 'lowpass';
        f.frequency.value = L.hp ?? L.lp;
        f.connect(env);
        dst = f;
      }
      env.connect(out);
      if (L.kind === 'noise') {
        const src = ctx.createBufferSource();
        src.buffer = this.#noiseBuffer();
        src.connect(dst);
        src.start(start);
        src.stop(start + L.dur + 0.02);
      } else {
        const o = ctx.createOscillator();
        o.type = L.kind === 'sub' ? 'sine' : L.type;
        o.frequency.setValueAtTime(L.f0, start);
        o.frequency.exponentialRampToValueAtTime(Math.max(20, L.f1), start + L.dur);
        o.connect(dst);
        o.start(start);
        o.stop(start + L.dur + 0.02);
      }
    }
    if (c.duck && this.#duck && !at) {
      // my own shot or a blast next to me: dip the rest of the world for a moment
      const g = this.#duck.gain;
      g.cancelScheduledValues(t);
      g.setValueAtTime(g.value, t);
      g.linearRampToValueAtTime(DUCK.gain, t + DUCK.attackS);
      g.linearRampToValueAtTime(1, t + DUCK.attackS + DUCK.releaseS);
    }
    this.#active += 1;
    const release = () => { this.#active = Math.max(0, this.#active - 1); };
    if (typeof setTimeout === 'function') setTimeout(release, (longest + 0.05) * 1000); else release();
    return true;
  }

  #noiseBuffer() {
    if (this.#noise) return this.#noise;
    const ctx = this.#ctx;
    const buf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    this.#noise = buf;
    return buf;
  }
}
