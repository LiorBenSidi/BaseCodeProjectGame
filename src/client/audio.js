// Procedural sound (SPEC 28.3): every cue is synthesized with WebAudio, so the repo ships no audio
// assets. `cueFor` and `falloff` are the pure part; `Audio` plays recipes, creates the context on the
// first user gesture, and stays silent when the page has no AudioContext (tests, headless browsers).

// Recipes: oscillator type, start / end frequency (Hz), duration (s), gain, optional noise burst.
export const CUES = Object.freeze({
  shot_rifle: { type: 'square', f0: 420, f1: 90, dur: 0.09, gain: 0.25, noise: 0.5 },
  shot_smg: { type: 'square', f0: 520, f1: 140, dur: 0.06, gain: 0.2, noise: 0.4 },
  shot_shotgun: { type: 'sawtooth', f0: 220, f1: 50, dur: 0.18, gain: 0.35, noise: 0.9 },
  shot_sniper: { type: 'sawtooth', f0: 900, f1: 60, dur: 0.25, gain: 0.35, noise: 0.6 },
  shot_pistol: { type: 'square', f0: 600, f1: 160, dur: 0.07, gain: 0.22, noise: 0.4 },
  hit: { type: 'triangle', f0: 1400, f1: 1200, dur: 0.05, gain: 0.18 },
  kill: { type: 'triangle', f0: 660, f1: 990, dur: 0.22, gain: 0.25 },
  death: { type: 'sawtooth', f0: 220, f1: 40, dur: 0.6, gain: 0.3 },
  boom: { type: 'sawtooth', f0: 120, f1: 25, dur: 0.7, gain: 0.5, noise: 1 },
  pickup: { type: 'sine', f0: 520, f1: 1040, dur: 0.14, gain: 0.2 },
  ability: { type: 'sine', f0: 300, f1: 900, dur: 0.2, gain: 0.22 },
  denied: { type: 'square', f0: 200, f1: 150, dur: 0.08, gain: 0.12 },
  level: { type: 'triangle', f0: 523, f1: 1046, dur: 0.35, gain: 0.25 },
  match: { type: 'sine', f0: 392, f1: 784, dur: 0.5, gain: 0.25 },
  step: { type: 'triangle', f0: 140, f1: 60, dur: 0.05, gain: 0.12, noise: 0.6 }, // SPEC 29.5
});

// Game event -> cue id (null = silent). Pure.
export function cueFor(event, data = {}) {
  switch (event) {
    case 'shot': return CUES[`shot_${data.w}`] ? `shot_${data.w}` : 'shot_rifle';
    case 'hit': return 'hit';
    case 'kill': return data.mine ? 'kill' : null;
    case 'death': return 'death';
    case 'boom': return 'boom';
    case 'pickup': return data.mine ? 'pickup' : null;
    case 'ability': return data.denied ? (data.mine ? 'denied' : null) : 'ability';
    case 'levelUp': return 'level';
    case 'step': return 'step';
    case 'matchStart': case 'matchEnd': return 'match';
    default: return null;
  }
}

// Distance attenuation for a cue heard `d` metres away: 1 inside 4 m, fading to 0 at 60 m.
export const falloff = (d) => (!(d >= 0) ? 1 : d <= 4 ? 1 : Math.max(0, 1 - (d - 4) / 56));

export class Audio {
  #ctx = null;
  #master = null;
  #enabled;
  #Ctx;
  #noise = null;

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

  setEnabled(on) {
    this.#enabled = !!on;
    if (this.#master) this.#master.gain.value = this.#enabled ? this.#volume : 0;
  }

  // PRO-menu (SPEC 33.3): master volume 0..1 from the audio preferences; the on/off switch still wins.
  #volume = 1;
  setVolume(v) {
    this.#volume = Math.min(1, Math.max(0, Number(v) || 0));
    if (this.#master) this.#master.gain.value = this.#enabled ? this.#volume : 0;
  }

  // Call from a user gesture (the Play click): browsers block audio before one.
  unlock() {
    if (!this.#Ctx) return false;
    if (this.#ctx) { this.#ctx.resume?.(); return true; }
    this.#ctx = new this.#Ctx();
    this.#master = this.#ctx.createGain();
    this.#master.gain.value = this.#enabled ? this.#volume : 0;
    this.#master.connect(this.#ctx.destination);
    return true;
  }

  play(cueId, volume = 1) {
    const c = CUES[cueId];
    if (!c || !this.#ctx || !this.#enabled || !(volume > 0)) return false;
    const ctx = this.#ctx;
    const t = ctx.currentTime;
    const env = ctx.createGain();
    env.gain.setValueAtTime(c.gain * volume, t);
    env.gain.exponentialRampToValueAtTime(0.001, t + c.dur);
    env.connect(this.#master);
    const osc = ctx.createOscillator();
    osc.type = c.type;
    osc.frequency.setValueAtTime(c.f0, t);
    osc.frequency.exponentialRampToValueAtTime(Math.max(20, c.f1), t + c.dur);
    osc.connect(env);
    osc.start(t);
    osc.stop(t + c.dur + 0.02);
    if (c.noise) {
      const src = ctx.createBufferSource();
      src.buffer = this.#noiseBuffer();
      const g = ctx.createGain();
      g.gain.setValueAtTime(c.gain * volume * c.noise, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + c.dur);
      src.connect(g);
      g.connect(this.#master);
      src.start(t);
      src.stop(t + c.dur + 0.02);
    }
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
