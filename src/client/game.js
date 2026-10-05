import { INPUT_DT, PLAYER, RESPAWN_MS } from '../shared/constants.js';
import { killcamWindow, killcamSample } from './ceremony.js'; // PRO-ceremony: SPEC 34.5
import { WEAPONS, meleeStyle } from '../shared/weapons.js';
import { stepPlayer, eyeOf } from '../shared/movement.js';
import { ClockSync } from './clockSync.js';
import { CombatHud } from './combatHud.js';
import { Grenades } from './grenades.js';
import { Pickups, pickupText } from './pickups.js';
import { Effects } from './effects.js';
import { KITS } from '../shared/abilities.js';
import { PERKS } from '../shared/progression.js';
import { Hud } from './hud.js';
import { attributeDamage, calculateDamageAngle, pruneThreats } from './hudModel.js';
import { Input } from './input.js';
import { Network } from './net.js';
import { ActorNetwork, roomIdFromLocation } from './netActor.js';
import { createClient } from '@base44/sdk';
import { MAP } from '../shared/map.js';
import { Audio, cueFor, falloff } from './audio.js';
import { targetFov, adsSensitivity, stepFovFor, isScoped, DEFAULT_FOV } from './aim.js';
// PRO-feel begin (SPEC 32, D-029)
import { isBound } from './bindings.js';
import { CameraFeel } from './cameraFeel.js';
import { applyAimAssist } from './aimAssist.js';
import { eventBus } from './eventBus.js';
import { RECOIL_RECOVERY_MS } from '../shared/weapons.js';
// PRO-feel end
import { newTutorial, current as tutorialStep, advance as tutorialAdvance, progress as tutorialProgress, shouldStart as tutorialShouldStart, markDone as tutorialMarkDone, nextTip, TIPS_KEY } from './tutorial.js'; // PRO-audio: SPEC 35.4
import { modeForRoomId } from '../shared/rooms.js'; // PRO-audio
import { nextLevel as nextStationLevel } from '../shared/rangeStation.js'; // SPEC 37.7
import { newTelemetry, recordPing, recordSnapshot, stats as telemetryStats, format as telemetryFormat, level as telemetryLevel, frameDue } from './telemetry.js'; // SPEC 36
import { WeaponView } from './weaponView.js';
import { RemotePlayers } from './remote.js';
import { createScene } from './scene.js';
import { CombatFx } from './combatFx.js'; // PRO-env: SPEC 30.6
import { defaults as prefDefaults } from './prefs.js'; // PRO-menu: SPEC 33
import { TouchControls } from './touch.js';

const TRACER_MS = 90;
const MAX_PENDING = 600; // ~10 s of unacknowledged commands; beyond that the connection is effectively dead

// Client-side prediction + server reconciliation:
//   1. every fixed step we build a command, apply it locally at once, and send it;
//   2. when a snapshot arrives we adopt the server's state for our player, then re-apply every
//      command the server has not yet acknowledged (`ack`), so we stay in sync without rubber-banding.
// This only works because shared/movement.js is deterministic and used by both sides.
export class Game {
  #gfx;
  #input;
  #hud = new Hud();
  #combat = new CombatHud();
  #grenades;
  #touch;
  #remote;
  #net = null;
  #name = '';
  #me = { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, onGround: true, alive: false };
  #radarUntil = -Infinity; // SPEC 37.1: the last snapshot said the radar pulse is on
  #sprinting = false; // SPEC 37.3: for the minimap footstep ring
  #protectedSeen = false; // SPEC 37.2
  // PRO-ceremony begin (SPEC 34)
  #killcam = null; // { id, name, weapon, startedAt, from, to, duration }
  #lastShotAt = new Map(); // player id -> performance.now() of their last shot, for the minimap reveal
  #myTeam = -1;
  // PRO-ceremony end
  #id = null;
  #seq = 0;
  #pending = [];
  #accumulator = 0;
  #lastFrame = performance.now();
  #fps = { on: false, frames: 0, since: performance.now() };
  #tele = newTelemetry(); // SPEC 36.1
  #fpsCap = 0; // SPEC 36.4, 0 = uncapped
  #lastRenderAt = 0;
  #clock = new ClockSync(); // SPEC 18.2: room clock estimate and RTT from ping/pong
  #lastShot = 0;
  #weapon = WEAPONS.rifle; // SPEC 20: the weapon the server says is in hand; paces our shoot intents and recoil
  #recoil = { pitch: 0, yaw: 0 }; // SPEC 20: client-only camera kick, recovers over a few frames
  #tracers = [];
  #pickups;
  #effects;
  #fx = null; // PRO-env: SPEC 30.6 muzzle flashes, sparks, explosion light
  #kit = 'vanguard';
  #self = null; // SPEC 24.5 private block of the last snapshot
  #sdk = null;
  #roomId = null;
  #map = MAP; // SPEC 28: the current map's collision set, replaced on welcome / matchStart
  #audio = new Audio(); // SPEC 28.3
  #baseFov = DEFAULT_FOV; // SPEC 29.3 setting
  #fov = DEFAULT_FOV; // current, eased toward the target
  #sensitivity = 0.0022;
  #weaponView = null; // SPEC 29.4
  #stepT = 0; // SPEC 29.5 footstep phase
  #remoteSteps = new Map(); // id -> last step time
  #reloadSeen = false;
  // PRO-audio begin (SPEC 35.4): tutorial and tips state
  #tutorial = null; // null = not running
  #tipsSeen = [];
  #tipUntil = 0;
  #wasOnGround = true;
  #wasSliding = false;
  #lastWeaponId = null;
  // PRO-audio end
  #threats = [];
  #lastHp = null;
  #eyeY = null; // SPEC 23 smoothed camera height
  // PRO-feel begin
  #feel = new CameraFeel(); // SPEC 32.3 landing dip, head bob, sprint fov, slide tilt, dive, mantle dip
  #wasGround = true;
  #lastVy = 0;
  #fovKick = 0;
  #team = -1; // own team from the last snapshot, so the aim assist ignores teammates
  #gpScoreboard = false;
  // PRO-feel end

  constructor(canvas) {
    this.#gfx = createScene(canvas);
    this.#input = new Input(canvas);
    this.#remote = new RemotePlayers(this.#gfx.scene);
    this.#grenades = new Grenades(this.#gfx.scene);
    this.#pickups = new Pickups(this.#gfx.scene); // SPEC 21.1
    this.#effects = new Effects(this.#gfx.scene); // SPEC 24.5
    this.#fx = new CombatFx(this.#gfx.scene); // PRO-env
    this.#weaponView = new WeaponView(this.#gfx.camera); // SPEC 29.4
    this.#gfx.scene.add(this.#gfx.camera); // the view model is a child of the camera
    // PRO-feel begin: keys read through bindings.js (SPEC 32.6) so the settings UI can remap them
    window.addEventListener('keydown', (e) => {
      if ((e.code === 'Digit1' || e.code === 'Digit2') && !e.repeat) { const c = this.#hud.voteCandidate(e.code === 'Digit1' ? 0 : 1); if (c && this.#hud.castVote(c)) return; } // PRO-ceremony: SPEC 34.4 vote keys
      if (isBound('scoreboard', e.code)) { e.preventDefault(); this.#hud.setScoreboardVisible(true); }
      if (isBound('station', e.code) && !e.repeat && this.#input.locked) this.cycleStation(); // SPEC 37.7
      if (isBound('grenade', e.code) && !e.repeat && this.#input.locked) this.throwGrenade();
      if (isBound('melee', e.code) && !e.repeat && this.#input.locked) this.melee(); // SPEC 38.3
      // SPEC 20.3: weapon intents; the server's state machine decides whether they take effect.
      if (isBound('reload', e.code) && !e.repeat && this.#input.locked) this.reload();
      if (isBound('weapon1', e.code) && this.#input.locked) this.switchWeapon('primary');
      if (isBound('weapon2', e.code) && this.#input.locked) this.switchWeapon('sidearm');
      // SPEC 24.1: Q / E abilities; SPEC 25.3: 3 / 4 pick a perk from the open offer
      if (isBound('ability1', e.code) && !e.repeat && this.#input.locked) this.useAbility(0);
      if (isBound('ability2', e.code) && !e.repeat && this.#input.locked) this.useAbility(1);
      if (isBound('perk1', e.code) && !e.repeat) this.pickPerk(0);
      if (isBound('perk2', e.code) && !e.repeat) this.pickPerk(1);
      if (isBound('inspect', e.code) && !e.repeat && this.#input.locked) this.#weaponView?.inspect?.();
    });
    // SPEC 32.5: aim assist for sticks and touch only; the targets are the live enemies of the last snapshot
    this.#input.aimAssist = (dyaw, dpitch, type) => (this.#prefs.aimAssist ? applyAimAssist({
      inputType: type,
      aimDelta: { dyaw, dpitch },
      player: { x: this.#me.x, y: this.#me.y + eyeOf(this.#me), z: this.#me.z, yaw: this.#input.yaw, pitch: this.#input.pitch },
      targets: this.#me.alive ? this.#remote.latest().filter((t) => this.#team < 0 || t.team !== this.#team) : [],
      moving: Math.hypot(this.#me.vx ?? 0, this.#me.vz ?? 0) > 0.5,
    }) : { dyaw, dpitch }); // PRO-menu: aim assist can be turned off
    // PRO-feel end
    // PRO-menu: the wheel goes through bindings.js (nextWeapon / prevWeapon by default); input.js queues the actions
    window.addEventListener('keyup', (e) => {
      if (isBound('scoreboard', e.code)) this.#hud.setScoreboardVisible(false);
    });
    this.#touch = new TouchControls(this.#input, {
      grenade: () => this.throwGrenade(),
      melee: () => this.melee(), // SPEC 38.3
      reload: () => this.reload(),
      swap: () => this.switchWeapon(this.#weapon.slot === 'primary' ? 'sidearm' : 'primary'),
      scoreboard: (show) => this.#hud.setScoreboardVisible(show),
    });
    requestAnimationFrame((t) => this.#frame(t));
  }

  // Must run inside the Play gesture (fullscreen / orientation lock need one).
  enableTouch() {
    this.#touch.enable();
  }

  /** SPEC 19.4: the touch override changed in settings; re-resolve without a reload. */
  updateTouchMode() {
    this.#touch.updateMode(this.joined);
  }

  /** SPEC 19.2: mouse sensitivity from the settings panel, applied to the next mouse move. */
  setSensitivity(value) {
    this.#sensitivity = value;
    this.#input.sensitivity = value * adsSensitivity(this.#fov, this.#baseFov, this.#weapon.id, this.#input.ads) * (this.#input.ads ? this.#prefs.adsSensMul : 1); // PRO-menu
  }

  setFov(value) {
    this.#baseFov = value;
  }

  // PRO-env: SPEC 30.5 quality tier from the settings panel (P4 adds the control); an unknown tier returns to automatic.
  setQuality(tier) {
    this.#gfx.setQuality(tier);
  }

  get quality() {
    return this.#gfx.quality;
  }
  // PRO-menu begin (SPEC 33): preferences applied live; the panel calls this on every change
  #prefs = prefDefaults();

  applyPrefs(prefs) {
    this.#prefs = prefs;
    this.#input.prefs = prefs;
    // PRO-audio (SPEC 35.1): one bus per slider
    this.#audio.setLevel('master', prefs.masterVolume / 100);
    this.#audio.setLevel('sfx', prefs.sfxVolume / 100);
    this.#audio.setLevel('ui', (prefs.uiVolume ?? 80) / 100);
    // SPEC 36: research polish, D-033
    this.#audio.setMix?.(prefs.audioMix ?? 'default');
    this.#audio.setSpatialMode?.(prefs.spatialAudio ?? 'stereo'); // SPEC 37.6
    this.#remote.setOutline(prefs.enemyOutline ?? 'off', this.#myTeam); // SPEC 37.5
    this.#gfx.setRenderScale?.(prefs.renderScale ?? 100);
    this.#fpsCap = prefs.fpsCap && prefs.fpsCap !== 'off' ? Number(prefs.fpsCap) : 0;
    if (prefs.telemetry) this.setShowFps(true);
    this.#gfx.setQuality?.(prefs.quality === 'auto' ? null : prefs.quality);
    this.#hud.applyPrefs?.(prefs);
  }

  get prefs() {
    return this.#prefs;
  }
  // PRO-menu end

  // SPEC 29.1: chat input; the caller (main.js) owns the DOM element and the Enter key.
  sendChat(text) {
    if (!this.joined || typeof text !== 'string' || text.trim().length === 0) return false;
    this.#net.send({ t: 'chat', text: text.slice(0, 400) });
    return true;
  }

  setChatOpen(open) {
    this.#input.chatOpen = open;
  }

  /** SPEC 19.2: FPS readout, measured from frame deltas and refreshed twice a second. */
  setSound(on) {
    this.#audio.setEnabled(on);
  }

  // SPEC 28.3: a cue at a world position is attenuated by its distance from the local player.
  #cue(event, data = {}, at = null) {
    const id = cueFor(event, at ? { ...data, d: Math.hypot(at[0] - this.#me.x, at[2] - this.#me.z) } : data); // PRO-audio: distance picks the far variant
    if (!id) return;
    const d = at ? Math.hypot(at[0] - this.#me.x, at[2] - this.#me.z) : 0;
    this.#audio.play(id, falloff(d), at); // PRO-audio: panned and lowpassed from the listener
  }

  setShowFps(on) {
    this.#fps.on = on === true;
    const el = document.getElementById('fps');
    if (el) el.hidden = !this.#fps.on;
  }

  get joined() {
    return this.#id !== null;
  }

  // Intent helpers, shared by the real controls and the ?debug=1 harness. The server decides every result.
  aim(yaw, pitch) {
    this.#input.yaw = yaw;
    this.#input.pitch = Math.max(-1.5533, Math.min(1.5533, pitch));
  }

  fire() {
    return this.#tryFire(performance.now());
  }

  reload() {
    if (!this.joined || !this.#me.alive) return;
    this.#net.send({ t: 'reload' });
    this.#tut('reload'); // PRO-audio
  }

  switchWeapon(slot) {
    if (!this.joined || !this.#me.alive || slot === this.#weapon.slot) return;
    this.#net.send({ t: 'switch', slot });
    this.#cue('switch'); this.#tut('switch'); // PRO-audio
  }

  // SPEC 38.3: one swing with the kit's blade; the server resolves hits and clashes, the view model swings at once.
  melee() {
    if (!this.joined || !this.#me.alive) return false;
    this.#net.send({ t: 'melee' });
    this.#weaponView?.swing?.(meleeStyle(this.#kit));
    this.#tut('melee');
    return true;
  }

  throwGrenade() {
    if (!this.joined || !this.#me.alive) return false;
    this.#net.send({ t: 'throw' });
    this.#tut('throw'); // PRO-audio
    return true;
  }

  // SPEC 24.1: the server validates cooldown, life and phase; the HUD chip shows the result.
  useAbility(slot) {
    if (!this.joined || !this.#me.alive) return false;
    this.#net.send({ t: 'ability', slot });
    this.#tut('ability'); // PRO-audio
    return true;
  }

  // SPEC 25.3: picks the i-th perk of the open offer.
  pickPerk(i) {
    const offer = this.#self?.offer;
    if (!this.joined || !offer || !offer[i]) return false;
    this.#net.send({ t: 'perk', id: offer[i] });
    return true;
  }

  // SPEC 24.1: a kit change applies on the next spawn.
  selectKit(id) {
    if (!KITS[id]) return;
    this.#kit = id;
    if (this.joined) { this.#net.send({ t: 'kit', id }); this.#hud.killFeed(`${KITS[id].name} kit on next spawn`); }
  }

  debugState() {
    return { joined: this.joined, id: this.#id, alive: this.#me.alive, yaw: this.#input.yaw, pitch: this.#input.pitch,
      pos: [this.#me.x, this.#me.y, this.#me.z], rtt: this.#clock.rtt, clockOffset: this.#clock.offset };
  }

  // SPEC 28: a map description from the server replaces the arena and the prediction collision set.
  #setMap(desc) {
    if (!desc || !Array.isArray(desc.boxes)) return;
    this.#map = { half: Number(desc.half) || MAP.half, boxes: desc.boxes };
    this.#gfx.setMap?.({ ...this.#map, id: desc.id, name: desc.name });
  }

  // SPEC 26: an SDK client for lobby reads on the actor transport; null on the Node dev server.
  lobbyClient() {
    const appId = import.meta.env?.VITE_BASE44_APP_ID;
    if (!appId) return null;
    this.#sdk ??= createClient({ appId, requiresAuth: false });
    return this.#sdk;
  }

  join(name, kit = this.#kit, roomId = roomIdFromLocation(window.location.search)) {
    this.#audio.unlock(); // SPEC 28.3: join runs inside the Play click, the gesture browsers require
    this.#name = name;
    this.#kit = KITS[kit] ? kit : this.#kit;
    this.#roomId = roomId;
    this.#hud.setRoom(roomId);
    // PRO-audio begin (SPEC 35.4)
    const storage = globalThis.localStorage;
    try { this.#tipsSeen = JSON.parse(storage?.getItem?.(TIPS_KEY) ?? '[]'); } catch { this.#tipsSeen = []; }
    if (!Array.isArray(this.#tipsSeen)) this.#tipsSeen = [];
    this.#tutorial = tutorialShouldStart(modeForRoomId(roomId), storage) ? newTutorial() : null;
    document.getElementById('tut-skip')?.addEventListener('click', () => this.#tut('skip'));
    this.#renderTutorial();
    // PRO-audio end
    const handlers = {
      welcome: (m) => { this.#id = m.id; this.#pending = []; this.#lastHp = null; this.#hud.notice(''); this.#hud.show(); this.#setMap(m.map); this.#pickups.setSpots(m.pickups); },
      pickup: (m) => { this.#hud.killFeed(pickupText(m)); this.#cue('pickup', { mine: m.id === this.#id }); },
      snap: (m) => { recordSnapshot(this.#tele, performance.now()); this.#onSnapshot(m); }, // SPEC 36.1
      shot: (m) => { this.#addTracer(m); this.#fx.shot(m.from, m.to, performance.now(), m.id === this.#id); // PRO-env
  if (m.id !== this.#id) { this.#threat(m.from[0], m.from[2]); this.#lastShotAt.set(m.id, performance.now()); this.#tip('firstShotHeard'); } this.#cue('shot', { w: m.w }, m.id === this.#id ? null : m.from); },
      verdict: (m) => { this.#combat.verdict(m); if (m.dmg > 0 && m.zone === 'melee') this.#cue('melee_hit'); if (m.dmg > 0) { this.#cue('hit', { head: m.zone === 'head' }); this.#tut('hit'); this.#tip('firstHit'); if (m.target !== null) this.#remote.flash(m.target); eventBus.emit(m.kill ? 'killConfirm' : m.zone === 'head' ? 'headshot' : 'bodyHit', m); } }, // PRO-feel: SPEC 32.4 events; PRO-weapons: SPEC 31.3 hit flash
      boom: (m) => { this.#fx.boom(m.at, performance.now()); this.#combat.boom(m, this.#id); // PRO-env
  this.#grenades.explode(m.at, performance.now()); this.#threat(m.at[0], m.at[2]); this.#cue('boom', {}, m.at); },
      // SPEC 38.3: a swing by anyone (the sound and the third person arm), a clash between two players (spark, ring, shake)
      melee: (m) => {
        const at = m.id === this.#id ? null : this.#remote.positionOf?.(m.id) ?? null;
        this.#cue('melee', { mine: m.id === this.#id }, at);
        if (m.id !== this.#id) this.#remote.swing?.(m.id, m.style);
      },
      clash: (m) => {
        const mine = m.a === this.#id || m.b === this.#id;
        this.#fx.clash?.(m.at, performance.now());
        this.#cue('clash', { mine }, mine ? null : m.at);
        if (mine) {
          this.#weaponView?.clash?.(m.riposte === this.#id);
          this.#hud.killFeed(m.riposte === this.#id ? 'Clash: riposte, you recover first' : 'Clash: staggered');
        }
      },
      kill: (m) => {
        this.#hud.killFeed(`${m.killerName} eliminated ${m.victimName}`);
        if (m.ended) this.#hud.killFeed(`${m.killerName} ended ${m.victimName}'s ${m.ended} kill streak`);
        if (m.killer === this.#id) { this.#cue('kill', { mine: true }); const b = m.multiText ?? m.streakText; if (b) this.#hud.banner(b); } else if (m.streakText && m.streak >= 5) this.#hud.killFeed(`${m.killerName} is on a ${m.streak} kill streak: ${m.streakText}`);
        if (m.victim === this.#id) { this.#cue('death'); this.#startKillcam(m); this.#tip('death'); } // PRO-ceremony: SPEC 34.5; PRO-audio tip
        if (m.killer === this.#id) this.#tip('kill'); // PRO-audio
        eventBus.emit('kill', { ...m, mine: m.killer === this.#id, me: m.victim === this.#id }); // PRO-feel
      },
      chat: (m) => this.#hud.chat({ name: m.name, team: m.team, text: m.text }),
      station: (m) => { if (m.on === 1 && typeof m.target === 'number') this.#remote.flash(m.target); this.#hud.station(m); if (m.on === 0) setTimeout(() => this.#hud.station(null), 6000); }, // SPEC 37.7
      matchEnd: (m) => { this.#hud.matchEnd(m, this.#id, { onVote: (mapId) => this.#net.send({ t: 'vote', mapId }) }); this.#cue('matchEnd'); this.#endKillcam(); }, // SPEC 22 + PRO-ceremony vote
      // PRO-ceremony begin (SPEC 34)
      matchLive: () => { this.#hud.banner('GO'); this.#cue('matchStart'); },
      vote: (m) => this.#hud.votes(m.counts),
      medal: (m) => { if (m.id === this.#id) { this.#hud.medal(m.medals); this.#cue('kill', { mine: true }); } },
      // PRO-ceremony end
      matchStart: (m) => { this.#hud.matchStart(); this.#cue('matchStart'); this.#tip('matchStart'); if (m.map) { this.#setMap(m.map); this.#pickups.setSpots(m.pickups); this.#hud.killFeed(`Map: ${m.map.name}`); } },
      // SPEC 24 / 25 feedback lines
      ability: (m) => { if (m.id === this.#id && m.denied) this.#hud.abilityDenied(m.slot, m.denied); this.#cue('ability', { denied: !!m.denied, mine: m.id === this.#id }); },
      xp: (m) => { if (m.levelUp) { this.#hud.killFeed(`Level ${m.lvl}: pick a perk (3 / 4)`); this.#cue('levelUp'); } },
      perk: (m) => this.#hud.killFeed(`Perk: ${PERKS[m.id]?.name ?? m.id}`),
      pong: (m) => this.#clock.onPong(m, Date.now()),
      error: (m) => this.#hud.notice(m.reason === 'room_full' ? 'Room is full' : 'Server error'),
      close: () => { this.#id = null; this.#hud.notice('Disconnected. Reload to rejoin.'); },
      // Actor transport only: the room woke up without our seat, or the link went quiet.
      rejoin: () => { this.#id = null; this.#net.send({ t: 'join', name: this.#name, kit: this.#kit }); },
      stale: () => { if (this.#id !== null) this.#hud.notice('Connection unstable, reconnecting...'); },
    };
    // VITE_BASE44_APP_ID is set by the Base44 build environment (the app sandbox exports it; `base44 build`
    // derives it from BASE44_APP_ID); without it this is the Node/ws server.
    const appId = import.meta.env?.VITE_BASE44_APP_ID;
    this.#net = appId
      ? new ActorNetwork(handlers, { appId, roomId: this.#roomId, client: this.lobbyClient() })
      : new Network(handlers);
    this.#net.connect(name, this.#kit);
  }

  #onSnapshot(snap) {
    this.#remote.push(snap.players, this.#id);
    this.#grenades.sync(snap.nades ?? []);
    this.#pickups.sync(snap.items);
    this.#effects.sync(snap.fx, performance.now());
    this.#self = snap.self ?? null;
    this.#combat.setPlayers(snap.players);
    const mine = snap.players.find((p) => p.id === this.#id);
    if (!mine) return;
    if (typeof mine.tm === 'number' && mine.tm !== this.#myTeam) { this.#myTeam = mine.tm; this.#remote.setOutline(this.#prefs.enemyOutline ?? 'off', mine.tm); } // PRO-ceremony: minimap ally / enemy; SPEC 37.5 outline side
    if (snap.radar === 1) this.#radarUntil = performance.now() + 200; // SPEC 37.1: holds across the snapshot gap
    // SPEC 37.2: a visible marker while spawn protection holds; shooting or an ability ends it on the server
    const prot = mine.sp === 1 && mine.alive === 1;
    if (prot !== this.#protectedSeen) { this.#protectedSeen = prot; this.#hud.protection(prot); }

    this.#pending = this.#pending.filter((c) => c.seq > snap.ack);
    Object.assign(this.#me, {
      x: mine.x, y: mine.y, z: mine.z, vy: mine.vy, vx: 0, vz: 0,
      onGround: mine.g === 1, alive: mine.alive === 1,
      ...(typeof mine.h === 'number' ? { h: mine.h } : {}),
      // SPEC 24.2: the dash runs inside stepPlayer, so prediction needs its remaining time and direction
      dash: snap.self?.dash ?? 0, dashDx: snap.self?.dashDx ?? 0, dashDz: snap.self?.dashDz ?? 0,
    });
    if (this.#me.alive) for (const c of this.#pending) stepPlayer(this.#me, c, this.#map.boxes, this.#map.half);
    if (typeof mine.tm === 'number') this.#team = mine.tm; // PRO-feel
    if (mine.w && WEAPONS[mine.w]) this.#weapon = WEAPONS[mine.w];
    this.#weaponView?.setDrawMs(this.#weapon.switchMs); // SPEC 38.2: the draw clip matches the server's switch time
    this.#weaponView?.setWeapon(this.#weapon.id);
    if (mine.rel === 1 && !this.#reloadSeen) { this.#reloadSeen = true; this.#cue('reload'); this.#weaponView?.reloading(this.#weapon.reloadMs, performance.now()); } else if (mine.rel !== 1) this.#reloadSeen = false;
    this.#onDamage(mine);
    this.#hud.update(mine, snap.players, Date.now(), snap.match, snap.self);
  }

  // SPEC 19.1 damage direction: the server does not tell the victim who hit them, so a drop in our hp
  // is attributed to the newest remote shot origin or explosion point seen inside the attribution window.
  #threat(x, z) {
    const now = performance.now();
    this.#threats = pruneThreats(this.#threats, now);
    this.#threats.push({ x, z, at: now });
  }

  #onDamage(mine) {
    const prev = this.#lastHp;
    this.#lastHp = mine.hp;
    if (prev === null || mine.hp >= prev) return;
    const now = performance.now();
    this.#threats = pruneThreats(this.#threats, now);
    const from = attributeDamage(this.#threats, now);
    this.#hud.damageFrom(from ? calculateDamageAngle(mine, this.#input.yaw, from) : null);
  }

  #addTracer(m) {
    const { THREE, scene } = this.#gfx;
    const geometry = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(...m.from), new THREE.Vector3(...m.to)]);
    const material = new THREE.LineBasicMaterial({ color: 0xffe08a, transparent: true });
    const line = new THREE.Line(geometry, material);
    scene.add(line);
    this.#tracers.push({ line, born: performance.now() });
  }

  #updateTracers(now) {
    this.#tracers = this.#tracers.filter((t) => {
      const age = now - t.born;
      if (age < TRACER_MS) { t.line.material.opacity = 1 - age / TRACER_MS; return true; }
      this.#gfx.scene.remove(t.line);
      t.line.geometry.dispose();
      t.line.material.dispose();
      return false;
    });
  }

  #simulate(dt, now) {
    this.#accumulator += dt;
    const outgoing = [];
    while (this.#accumulator >= INPUT_DT) {
      this.#accumulator -= INPUT_DT;
      const s = this.#input.sample();
      const cmd = { seq: ++this.#seq, fwd: s.fwd, right: s.right, jump: s.jump, sprint: s.sprint, crouch: s.crouch, dive: s.dive, tac: s.tac, yaw: this.#input.yaw, pitch: this.#input.pitch };
      if (this.#me.alive) {
        stepPlayer(this.#me, cmd, this.#map.boxes, this.#map.half);
        if (this.#me.mantled) this.#feel.onMantle(); // PRO-feel: SPEC 32.3 mantle camera dip
      }
      this.#pending.push(cmd);
      outgoing.push(cmd);
    }
    if (this.#pending.length > MAX_PENDING) this.#pending.splice(0, this.#pending.length - MAX_PENDING);
    // SPEC 18.1: the stamp lets the room's ClockSource advance from client time when the runtime clock is frozen.
    if (outgoing.length) this.#net.send({ t: 'input', cmds: outgoing, ts: Date.now() });

    // PRO-feel begin: SPEC 32.6 gamepad buttons map onto the same intents as the keys
    for (const a of this.#input.takeGamepadActions()) {
      if (a === 'reload') this.reload();
      else if (a === 'switch' || a === 'nextWeapon' || a === 'prevWeapon') this.switchWeapon(this.#weapon.slot === 'primary' ? 'sidearm' : 'primary'); // PRO-menu: two slots, so next and previous both swap
      else if (a === 'weapon1') this.switchWeapon('primary');
      else if (a === 'weapon2') this.switchWeapon('sidearm');
      else if (a === 'inspect') this.#weaponView?.inspect?.();
      else if (a === 'ability1') this.useAbility(0);
      else if (a === 'ability2') this.useAbility(1);
      else if (a === 'grenade') this.throwGrenade();
      else if (a === 'melee') this.melee(); // SPEC 38.3
      else if (a === 'scoreboard') { this.#gpScoreboard = !this.#gpScoreboard; this.#hud.setScoreboardVisible(this.#gpScoreboard); }
    }
    // PRO-feel end
    if (this.#input.firing && this.#input.active) this.#tryFire(now);
    this.#recoverRecoil(dt);
  }

  #recoverRecoil(dt) {
    const k = Math.min(1, dt * (1000 / RECOIL_RECOVERY_MS)); // SPEC 32.4: the kick recovers over RECOIL_RECOVERY_MS
    const dp = this.#recoil.pitch * k;
    const dy = this.#recoil.yaw * k;
    if (dp === 0 && dy === 0) return;
    this.#input.turn(-dy, -dp);
    this.#recoil.pitch -= dp;
    this.#recoil.yaw -= dy;
    if (Math.abs(this.#recoil.pitch) < 1e-4) this.#recoil.pitch = 0;
    if (Math.abs(this.#recoil.yaw) < 1e-4) this.#recoil.yaw = 0;
  }

  // SPEC 37.7: Range reaction station, cycles off -> easy -> medium -> hard -> off. Range rooms only.
  #stationLevel = null;
  cycleStation() {
    if (modeForRoomId(this.#roomId) !== 'range') return false;
    this.#stationLevel = nextStationLevel(this.#stationLevel);
    this.#net.send({ t: 'station', level: this.#stationLevel });
    return true;
  }

  // SPEC 29.5: footsteps from movement, own and remote, synthesized like every other cue.
  #footsteps(dt, speed) {
    if (this.#me.alive && this.#me.onGround && speed > 1) {
      this.#stepT += dt * speed;
      if (this.#stepT >= 2.4) { this.#stepT = 0; this.#audio.play('step', 0.35); }
    } else this.#stepT = 0;
    const now = performance.now();
    for (const r of this.#remote.moving(now)) {
      const last = this.#remoteSteps.get(r.id) ?? 0;
      if (now - last < 2400 / Math.max(1, r.speed)) continue;
      this.#remoteSteps.set(r.id, now);
      this.#cue('step', {}, [r.x, 0, r.z]);
    }
  }

  #tryFire(now) {
    if (!this.joined || !this.#me.alive || now - this.#lastShot < this.#weapon.fireIntervalMs) return false;
    this.#lastShot = now;
    this.#net.send({ t: 'shoot' });
    this.#hud.onFire();
    this.#weaponView?.fired();
    // SPEC 20: recoil is cosmetic. The kick moves the aim; the recovery below pulls most of it back.
    const w = this.#weapon;
    const yawKick = (Math.random() - 0.5) * 2 * w.recoilYaw;
    this.#input.turn(yawKick, w.recoilPitch);
    this.#recoil.pitch += w.recoilPitch * 0.7;
    this.#recoil.yaw += yawKick * 0.7;
    return true;
  }

  #countFrame(now) {
    this.#fps.frames += 1;
    const elapsed = now - this.#fps.since;
    if (elapsed < 500) return;
    const el = document.getElementById('fps');
    const rtt = this.#clock.stats().rtt;
    if (rtt !== null) recordPing(this.#tele, rtt);
    this.#tele.fps = Math.round((this.#fps.frames * 1000) / elapsed);
    const s = telemetryStats(this.#tele); // SPEC 36.1: fps, ping, jitter, loss
    if (el) { el.textContent = telemetryFormat(s); el.dataset.level = telemetryLevel(s); }
    this.#fps.frames = 0;
    this.#fps.since = now;
  }

  // PRO-ceremony begin (SPEC 34.5): the kill cam replays the killer's last seconds from their eyes until the respawn
  #startKillcam(m) {
    if (!m.killer || m.killer === this.#id) return;
    const history = this.#remote.historyOf(m.killer);
    if (history.length < 2) return;
    const now = performance.now();
    const win = killcamWindow(now, RESPAWN_MS);
    const last = this.#remote.lastPlayers().find((p) => p.id === m.killer);
    const weapon = last?.w ? (WEAPONS[last.w]?.name ?? last.w) : '';
    this.#killcam = { id: m.killer, name: m.killerName ?? 'Unknown', weapon, startedAt: now, ...win };
    this.#remote.setHidden(m.killer, true);
    this.#hud.killcam({ name: this.#killcam.name, weapon });
  }

  #endKillcam() {
    if (!this.#killcam) return;
    this.#remote.setHidden(this.#killcam.id, false);
    this.#killcam = null;
    this.#hud.killcam(null);
  }
  // PRO-ceremony end

  // PRO-audio begin (SPEC 35.4)
  #tut(event) {
    if (!this.#tutorial) return;
    if (tutorialAdvance(this.#tutorial, event)) {
      this.#cue('ui', { kind: 'click' });
      if (this.#tutorial.done) { tutorialMarkDone(globalThis.localStorage); this.#tutorial = null; }
      this.#renderTutorial();
    }
  }

  #renderTutorial() {
    const box = document.getElementById('tutorial');
    if (!box) return;
    const step = this.#tutorial ? tutorialStep(this.#tutorial) : null;
    box.hidden = !step;
    if (!step) return;
    const pr = tutorialProgress(this.#tutorial);
    document.getElementById('tut-step').textContent = `Step ${pr.index} of ${pr.total}`;
    document.getElementById('tut-title').textContent = step.title;
    document.getElementById('tut-text').textContent = step.text;
    const skip = document.getElementById('tut-skip');
    if (skip) skip.textContent = step.event === null ? 'Got it' : 'Skip tutorial';
    if (step.event === null) skip?.addEventListener('click', () => this.#tut('dismiss'), { once: true });
  }

  // Contextual tips (SPEC 35.4): one line, once ever, only in live matches (not the range) and not during the tutorial.
  #tip(trigger) {
    if (this.#tutorial || modeForRoomId(this.#roomId) === 'range') return;
    const tip = nextTip(trigger, this.#tipsSeen);
    if (!tip) return;
    this.#tipsSeen.push(tip.id);
    try { globalThis.localStorage?.setItem?.(TIPS_KEY, JSON.stringify(this.#tipsSeen)); } catch { /* private mode */ }
    const el = document.getElementById('tip');
    if (!el) return;
    el.textContent = tip.text;
    el.hidden = false;
    this.#tipUntil = performance.now() + 5000;
  }
  // PRO-audio end

  #frame(now) {
    requestAnimationFrame((t) => this.#frame(t));
    const dt = Math.min(0.1, (now - this.#lastFrame) / 1000); // clamp: a background tab must not flood the server
    this.#lastFrame = now;
    if (this.#fps.on) this.#countFrame(now);
    if (this.joined) {
      this.#simulate(dt, now);
      const ping = this.#clock.nextPing(Date.now());
      if (ping) this.#net.send(ping);
    }

    this.#remote.update(now);
    this.#updateTracers(now);
    this.#fx.update(now); // PRO-env
    this.#grenades.update(now);
    this.#pickups.update(now);
    const { camera } = this.#gfx;
    // SPEC 23: the eye follows the crouch height; smoothed so a slide does not snap the camera
    const eyeTarget = this.#me.y + eyeOf(this.#me);
    this.#eyeY = this.#eyeY === null ? eyeTarget : this.#eyeY + (eyeTarget - this.#eyeY) * Math.min(1, dt * 14);
    const ads = this.#input.ads && this.#me.alive;
    const speed = Math.hypot(this.#me.vx ?? 0, this.#me.vz ?? 0);
    // PRO-feel begin: SPEC 32.3 camera feel on top of the smoothed eye height
    if (this.#me.onGround && !this.#wasGround) this.#feel.onLanding(this.#lastVy);
    this.#wasGround = !!this.#me.onGround;
    if (!this.#me.onGround) this.#lastVy = this.#me.vy ?? 0;
    const sprinting = this.#me.alive && this.#me.onGround && speed > PLAYER.speed + 0.3 && !(this.#me.slide > 0) && !(this.#me.dive > 0);
    this.#sprinting = sprinting; // SPEC 37.3
    const feel = this.#feel.step(dt, {
      speed: this.#me.onGround ? speed : 0, baseSpeed: PLAYER.speed, isAds: ads,
      isSprinting: sprinting, isTacSprinting: sprinting && this.#me.tac > 0,
      isSliding: this.#me.slide > 0, isDiving: this.#me.dive > 0,
    });
    // PRO-menu: head bob, camera shake and fov kick follow the video preferences (SPEC 33.3)
    const bobK = this.#prefs.headBob, shakeK = this.#prefs.cameraShake;
    this.#fovKick += ((this.#prefs.fovKick ? feel.fovKick : 0) - this.#fovKick) * Math.min(1, dt * 8);
    const sideX = Math.cos(this.#input.yaw) * feel.offsetX * bobK;
    const sideZ = -Math.sin(this.#input.yaw) * feel.offsetX * bobK;
    camera.position.set(this.#me.x + sideX, this.#eyeY + feel.offsetY * Math.max(bobK, shakeK), this.#me.z + sideZ);
    camera.rotation.set(this.#input.pitch, this.#input.yaw, feel.rollTilt * shakeK);
    // SPEC 29.3: ADS eases the fov toward the weapon's zoom and scales the mouse to match; SPEC 32.4 sets the
    // pace per weapon and the sprint kick widens the view a little.
    const fovTarget = targetFov(this.#baseFov, this.#weapon.id, ads) + (ads ? 0 : this.#fovKick);
    const nextFov = stepFovFor(this.#fov, fovTarget, dt, this.#weapon.id);
    if (Math.abs(nextFov - this.#fov) > 1e-3 || Math.abs(camera.fov - nextFov) > 1e-3) { this.#fov = nextFov; camera.fov = nextFov; camera.updateProjectionMatrix(); this.#input.sensitivity = this.#sensitivity * adsSensitivity(this.#fov, this.#baseFov, this.#weapon.id, ads) * (ads ? this.#prefs.adsSensMul : 1); } // PRO-menu
    // PRO-feel end
    const scoped = isScoped(this.#weapon.id, ads) && this.#fov < this.#baseFov * 0.6;
    this.#hud.setScoped(scoped);
    this.#weaponView?.setVisible(this.#me.alive && !scoped);
    this.#weaponView?.update(dt, performance.now(), { moving: this.#me.onGround ? speed : 0, ads, sprinting }); // SPEC 38.2 sprint lowers the weapon
    this.#footsteps(dt, speed);
    // PRO-audio begin (SPEC 35.1 / 35.4): ears follow the camera; jump, land and slide cues; movement tutorial steps
    this.#audio.setListener(this.#me.x, this.#me.z, this.#input.yaw);
    if (this.#me.alive) {
      if (this.#wasOnGround && !this.#me.onGround && this.#me.vy > 0.5) { this.#cue('jump'); this.#tut('jump'); }
      if (!this.#wasOnGround && this.#me.onGround) this.#cue('land');
      const sliding = (this.#me.slide ?? 0) > 0;
      if (sliding && !this.#wasSliding) { this.#cue('slide'); this.#tut('slide'); }
      this.#wasSliding = sliding;
      if (speed > 1 && this.#me.onGround) this.#tut('move');
      if (this.#input.locked && (Math.abs(this.#input.yaw) > 0.3 || Math.abs(this.#input.pitch) > 0.2)) this.#tut('look');
    }
    this.#wasOnGround = this.#me.onGround;
    if (this.#tipUntil && now >= this.#tipUntil) { this.#tipUntil = 0; const el = document.getElementById('tip'); if (el) el.hidden = true; }
    // PRO-audio end
    // PRO-ceremony begin (SPEC 34.5 / 34.6)
    if (this.#killcam) {
      const kc = this.#killcam;
      const elapsed = now - kc.startedAt;
      if (elapsed >= kc.duration + 400 || this.#me.alive) this.#endKillcam();
      else {
        const sample = killcamSample(this.#remote.historyOf(kc.id), kc.from + Math.min(elapsed, kc.duration));
        if (sample) {
          camera.position.set(sample.x, sample.y + eyeOf({ h: sample.h }), sample.z);
          camera.rotation.set(sample.pitch, sample.yaw, 0);
          this.#weaponView?.setVisible(false);
        }
      }
    }
    this.#hud.minimap(this.#map, { x: this.#me.x, z: this.#me.z, yaw: this.#input.yaw }, this.#remote.lastPlayers(), {
      now, team: this.#myTeam, lastShotAt: this.#lastShotAt,
      radar: this.#radarUntil > now, sprinting: this.#sprinting, fov: (this.#fov * Math.PI) / 180, // SPEC 37.1 / 37.3
      footstepRing: this.#prefs.minimapFootsteps !== false, visionCone: this.#prefs.minimapCone !== false,
    });
    // PRO-ceremony end
    if (frameDue(this.#lastRenderAt, now, this.#fpsCap)) { this.#lastRenderAt = now; this.#gfx.render(); } // PRO-env post pipeline; SPEC 36.4 frame cap
  }
}
