// DOM heads-up display (docs/SPEC.md 19.1). Every string that originates from the server or another
// player (names, kill-feed text) is written with textContent, never innerHTML: that is what keeps a
// player named "<img src=x onerror=...>" from becoming stored XSS in everyone else's browser.
// All state derivation lives in hudModel.js (pure, unit tested); this file only moves it into the DOM.

import { crosshairStyle } from './prefs.js'; // PRO-menu: SPEC 33.4
import { introText, podium, mvp, medalLines, voteView, minimapLayout } from './ceremony.js'; // PRO-ceremony: SPEC 34
import { MEDALS } from '../shared/medals.js'; // PRO-ceremony
import { MAPS } from '../shared/maps.js'; // PRO-ceremony: vote names

import { CHAT_KEEP } from '../shared/social.js';
import { deriveAbilityChips, deriveXpBar, perkCards } from './kitUi.js';
import {
  KillFeedQueue,
  deriveAmmoStatus,
  deriveHealthSegments,
  deriveRespawnText,
  deriveTeamColor,
  deriveMatchStatus,
  deriveMatchEndText,
  sortScoreboardPlayers,
} from './hudModel.js';

export const HUD_TIMING = Object.freeze({
  fireExpandMs: 100,
  damageIndicatorMs: 500,
  damageFlashMs: 250,
});

const $ = (id) => document.getElementById(id);

export class Hud {
  // PRO-menu begin (SPEC 33.4): crosshair, HUD scale and opacity, feature toggles
  applyPrefs(p) {
    const doc = document;
    const vars = crosshairStyle(p);
    for (const mark of [doc.getElementById('crosshair'), doc.getElementById('ch-preview-mark')]) {
      if (!mark) continue;
      if (!mark.querySelector('.h')) for (const c of ['h', 'd', 'r']) { const e = doc.createElement('span'); e.className = c; mark.append(e); } // horizontal lines, dot, ring
      for (const [k, v] of Object.entries(vars)) mark.style.setProperty(k, v);
      mark.classList.toggle('static', !p.crosshairDynamic);
    }
    const hud = doc.getElementById('hud');
    if (hud) { hud.style.setProperty('--hud-scale', String(p.hudScale)); hud.style.setProperty('--hud-opacity', String(p.hudOpacity)); }
    doc.getElementById('feed')?.toggleAttribute('hidden', !p.killFeed);
    doc.getElementById('hit-info')?.classList.toggle('off', !p.damageNumbers);
    doc.getElementById('damage-flash')?.classList.toggle('off', !p.damageFlash);
    this.prefs = p;
  }
  // PRO-menu end
  #root = $('hud');
  #hp = $('hp');
  #hpValue = $('hp-value');
  #segments = [...$('hp-bar').querySelectorAll('.hp-segment-fill')];
  #ammoValue = $('ammo-value');
  #matchTimer = $('match-timer');
  #matchTeams = $('match-teams');
  #matchRoom = $('match-room'); // SPEC 26.4: the room id, so a friend can be told where to join
  #banner = $('banner'); // SPEC 29.2 streak / multi-kill announcements
  #bannerUntil = 0;
  #chatLines = $('chat-lines'); // SPEC 29.1
  #chat = []; // [{ text, at }]
  #endScreen = $('match-end');
  #endTitle = $('match-end-title');
  #endSub = $('match-end-sub');
  #lastMatchLine = '';
  #ammoLabel = document.querySelector('#ammo .label');
  #lastAmmo = null;
  #lastWeapon = null;
  #feed = $('feed');
  #board = $('scoreboard');
  #cross = $('crosshair');
  #dead = $('dead');
  #notice = $('notice');
  #protect = $('protect'); // SPEC 37.2
  #damageArc = $('damage-indicator');
  #damageFlash = $('damage-flash');

  #killFeed = new KillFeedQueue(5, 5000);
  // SPEC 24.6 / 25.4
  #abilities = $('abilities');
  #xpBar = $('xp-bar');
  #xpFill = $('xp-fill');
  #xpLabel = $('xp-label');
  #perkOffer = $('perk-offer');
  #lastAbilityLine = '';
  #lastXpLine = '';
  #lastOfferLine = '';
  #feedDirty = true;
  #deathTime = null;
  #lastHp = null;
  #timers = {};

  show() {
    this.#root.hidden = false;
    this.#renderAmmo(null);
  }

  // SPEC 20.4: weapon name, magazine / reserve and the state word; re-rendered only when the text changes.
  #renderAmmo(me) {
    const ammo = deriveAmmoStatus(me);
    const text = `${ammo.text} / ${ammo.status}`;
    if (text !== this.#lastAmmo) {
      this.#lastAmmo = text;
      this.#ammoValue.textContent = text;
      this.#ammoValue.classList.toggle('warn', ammo.status !== 'READY');
    }
    if (ammo.weapon !== this.#lastWeapon) {
      this.#lastWeapon = ammo.weapon;
      if (this.#ammoLabel) this.#ammoLabel.textContent = ammo.weapon;
    }
  }

  setScoreboardVisible(visible) {
    this.#board.hidden = !visible;
  }

  // Local fire: the crosshair kicks out for HUD_TIMING.fireExpandMs.
  onFire() {
    this.#pulse(this.#cross, 'expanded', HUD_TIMING.fireExpandMs);
  }

  // Damage taken by the local player. angle is the screen angle from calculateDamageAngle (radians,
  // clockwise from the top), or null when the attacker could not be attributed: then only the vignette shows.
  damageFrom(angle) {
    this.#pulse(this.#damageFlash, 'show', HUD_TIMING.damageFlashMs);
    if (angle === null || angle === undefined) return;
    this.#damageArc.style.transform = `rotate(${angle}rad)`;
    this.#pulse(this.#damageArc, 'show', HUD_TIMING.damageIndicatorMs);
  }

  // SPEC 24.6: two ability chips with a cooldown sweep; SPEC 25.4: XP bar and the perk offer card.
  #renderKit(self) {
    if (!self || !this.#abilities) return;
    const chips = deriveAbilityChips(self.kit, self.cd);
    const line = chips.map((c) => `${c.id}:${c.ready ? 'r' : c.secs}`).join('|');
    if (line !== this.#lastAbilityLine) {
      this.#lastAbilityLine = line;
      this.#abilities.replaceChildren(...chips.map((c) => {
        const el = document.createElement('div');
        el.className = `chip${c.ready ? ' ready' : ''}`;
        el.style.setProperty('--cd', String(c.frac));
        const key = document.createElement('span'); key.className = 'key'; key.textContent = c.key;
        const name = document.createElement('span'); name.className = 'name'; name.textContent = c.ready ? c.name : `${c.name} ${c.secs}s`;
        el.append(key, name);
        return el;
      }));
    }
    const xp = deriveXpBar(self);
    const xline = `${xp.lvl}|${xp.frac.toFixed(3)}|${xp.label}`;
    if (xline !== this.#lastXpLine && this.#xpBar) {
      this.#lastXpLine = xline;
      this.#xpFill.style.width = `${Math.round(xp.frac * 100)}%`;
      this.#xpLabel.textContent = xp.label;
    }
    const cards = perkCards(self.offer);
    const oline = cards.map((c) => c.id).join('|');
    if (oline !== this.#lastOfferLine && this.#perkOffer) {
      this.#lastOfferLine = oline;
      this.#perkOffer.hidden = cards.length === 0;
      this.#perkOffer.replaceChildren(...cards.map((c) => {
        const el = document.createElement('div');
        el.className = 'perk';
        const key = document.createElement('span'); key.className = 'key'; key.textContent = c.key;
        const name = document.createElement('strong'); name.textContent = c.name;
        const blurb = document.createElement('span'); blurb.className = 'blurb'; blurb.textContent = c.blurb;
        el.append(key, name, blurb);
        return el;
      }));
    }
  }

  // SPEC 24.1: the server refused an ability; flash the chip so the player knows why.
  abilityDenied(slot, reason) {
    const chip = this.#abilities?.children[slot];
    if (!chip) return;
    chip.classList.remove('deny');
    void chip.offsetWidth;
    chip.classList.add('deny');
    chip.title = reason === 'no_anchor' ? 'No surface in range' : reason;
  }

  // SPEC 29.2: a short centred announcement; a later one replaces it.
  banner(text, now = Date.now(), ms = 2200) {
    if (!this.#banner || !text) return;
    this.#banner.textContent = text;
    this.#banner.hidden = false;
    this.#banner.classList.remove('pop');
    void this.#banner.offsetWidth; // restart the animation
    this.#banner.classList.add('pop');
    this.#bannerUntil = now + ms;
  }

  // SPEC 29.1: chat lines fade after 12 s; the newest CHAT_KEEP stay.
  chat(line, now = Date.now()) {
    if (!this.#chatLines) return;
    this.#chat.push({ ...line, at: now });
    if (this.#chat.length > CHAT_KEEP) this.#chat.shift();
    this.#renderChat(now);
  }

  #renderChat(now) {
    this.#chatLines.replaceChildren(...this.#chat.filter((l) => now - l.at < 12_000).map((l) => {
      const li = document.createElement('li');
      const who = document.createElement('span');
      who.className = l.team === 0 ? 'who blue' : l.team === 1 ? 'who red' : 'who';
      who.textContent = `${l.name}: `;
      li.append(who, document.createTextNode(l.text));
      return li;
    }));
  }

  // SPEC 29.3: the sniper scope overlay replaces the crosshair while zoomed in.
  setScoped(on) {
    const scope = document.getElementById('scope');
    if (scope && scope.hidden === !!on) { scope.hidden = !on; document.getElementById('crosshair')?.classList.toggle('scoped', !!on); }
  }

  setRoom(id) {
    if (!this.#matchRoom) return;
    this.#matchRoom.hidden = !id || id === 'arena-1';
    this.#matchRoom.textContent = id ?? '';
  }

  killFeed(text, now = Date.now()) {
    this.#killFeed.add(text, now);
    this.#feedDirty = true;
  }

  // Called once per snapshot with the local player's row and the full player list.
  update(me, players, now = Date.now(), match = null, self = null) {
    if (this.#banner && !this.#banner.hidden && now >= this.#bannerUntil) this.#banner.hidden = true;
    if (this.#chat.length && this.#chat[0].at + 12_000 < now) { this.#chat = this.#chat.filter((l) => now - l.at < 12_000); this.#renderChat(now); }
    this.#renderHealth(me.hp);
    this.#renderAmmo(me);
    this.#renderMatch(match);
    this.intro(match, now); // PRO-ceremony
    this.#renderKit(self);
    this.#renderRespawn(me, now);
    this.#renderFeed(now);
    if (!this.#board.hidden) this.#renderScoreboard(me, players);
  }

  // SPEC 22: timer and team scores at the top; the end screen shows while the match is ending.
  #renderMatch(match) {
    const st = deriveMatchStatus(match);
    const line = `${st.timer}|${st.teams}|${st.ending}`;
    if (line === this.#lastMatchLine) return;
    this.#lastMatchLine = line;
    if (this.#matchTimer) { this.#matchTimer.textContent = st.timer; this.#matchTimer.hidden = !st.timer; }
    if (this.#matchTeams) { this.#matchTeams.textContent = st.teams; this.#matchTeams.hidden = !st.teams; }
    if (this.#endScreen && !st.ending) this.#endScreen.hidden = true;
    if (!st.ending) this.setScoreboardVisible(false);
  }

  // PRO-ceremony begin (SPEC 34.2 / 34.4): podium, my medals, the next map vote
  #vote = { candidates: [], counts: {}, mine: null, onVote: null };
  #introEl = $('intro');
  #introCount = $('intro-count');
  #introSub = $('intro-sub');
  #lastIntro = null;
  #killcamEl = $('killcam');
  #killcamWho = $('killcam-who');
  #medalsEl = $('medals');
  #minimap = $('minimap');

  matchEnd(m, myId, { onVote = null } = {}) {
    if (!this.#endScreen) return;
    this.#endTitle.textContent = deriveMatchEndText(m, myId);
    const top = mvp(m.ranking ?? []);
    this.#endSub.textContent = top ? `MVP: ${top.name}` : '';
    const list = $('podium');
    if (list) {
      list.replaceChildren(...podium(m.ranking, m.medals ?? {}, myId).map((r) => {
        const li = document.createElement('li');
        li.className = `${r.rank === 1 ? 'first' : ''} ${r.me ? 'me' : ''}`.trim();
        const rank = document.createElement('span'); rank.className = 'rank'; rank.textContent = `#${r.rank}`;
        const name = document.createElement('span'); name.className = 'name'; name.textContent = r.name; // textContent only: names are hostile
        const kd = document.createElement('span'); kd.className = 'kd'; kd.textContent = `${r.k} / ${r.d}  (${r.kd})`;
        const pm = document.createElement('span'); pm.className = 'pm'; pm.textContent = r.medals ? `${r.medals} medal${r.medals === 1 ? '' : 's'}` : '';
        li.append(rank, name, kd, pm);
        return li;
      }));
    }
    const mine = $('my-medals');
    if (mine) mine.replaceChildren(...medalLines(m.medals ?? {}, myId).map((l) => { const e = document.createElement('span'); e.textContent = `${l.name}${l.count > 1 ? ` x${l.count}` : ''}`; return e; }));
    this.#vote = { candidates: m.voteCandidates ?? [], counts: {}, mine: null, onVote };
    this.#renderVote();
    this.#endScreen.hidden = false;
    this.setScoreboardVisible(false); // the podium replaces the raw board; Tab still opens it
  }

  votes(counts) {
    this.#vote.counts = counts ?? {};
    this.#renderVote();
  }

  // Cast my vote (click or key); the server broadcasts the counts back.
  castVote(mapId) {
    if (!this.#vote.candidates.includes(mapId)) return false;
    this.#vote.mine = mapId;
    this.#vote.onVote?.(mapId);
    this.#renderVote();
    return true;
  }

  voteCandidate(index) {
    return this.#vote.candidates[index] ?? null;
  }

  #renderVote() {
    const box = $('vote'), opts = $('vote-options');
    if (!box || !opts) return;
    const names = Object.fromEntries(Object.values(MAPS).map((m) => [m.id, m.name]));
    const view = voteView(this.#vote.candidates, this.#vote.counts, this.#vote.mine, names);
    box.hidden = view.length === 0;
    opts.replaceChildren(...view.map((v) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = v.mine ? 'mine' : '';
      b.style.setProperty('--share', `${Math.round(v.share * 100)}%`);
      const bar = document.createElement('i');
      const label = document.createElement('span'); label.textContent = `${v.key}  ${v.name}`;
      const small = document.createElement('small'); small.textContent = `${v.votes} vote${v.votes === 1 ? '' : 's'}`;
      label.append(small);
      b.append(bar, label);
      b.addEventListener('click', () => this.castVote(v.id));
      return b;
    }));
  }

  matchStart() {
    if (this.#endScreen) this.#endScreen.hidden = true;
    this.setScoreboardVisible(false);
  }

  // SPEC 34.1: intro countdown from the match snapshot; GO flashes for the first second of play.
  intro(match, now = Date.now()) {
    if (!this.#introEl) return;
    const phase = match?.phase;
    if (phase === 'ending') { const hint = $('match-end-hint'); if (hint) hint.textContent = match.left > 0 ? `Next match in ${match.left}s` : 'Next match starting'; }
    if (phase === 'intro') {
      const text = introText(match.left);
      if (text !== this.#lastIntro) { this.#lastIntro = text; this.#introCount.textContent = text; this.#introCount.classList.remove('go'); this.#introCount.style.animation = 'none'; void this.#introCount.offsetWidth; this.#introCount.style.animation = ''; }
      this.#introSub.textContent = 'Get ready';
      this.#introEl.hidden = false;
      this.#goUntil = null;
    } else if (this.#lastIntro !== null && this.#lastIntro !== 'GO') {
      this.#lastIntro = 'GO';
      this.#introCount.textContent = 'GO';
      this.#introCount.classList.add('go');
      this.#introSub.textContent = '';
      this.#goUntil = now + 900;
    } else if (this.#goUntil !== null && now >= this.#goUntil) {
      this.#goUntil = null;
      this.#lastIntro = null;
      this.#introEl.hidden = true;
    }
  }
  #goUntil = null;

  // SPEC 34.3: medal toasts, newest at the bottom, each fades on its own.
  medal(ids) {
    if (!this.#medalsEl) return;
    for (const id of ids) {
      const def = MEDALS[id];
      if (!def) continue;
      const el = document.createElement('div');
      el.className = 'medal';
      const b = document.createElement('b'); b.textContent = def.short;
      const t = document.createElement('span'); t.textContent = def.name;
      el.append(b, t);
      this.#medalsEl.append(el);
      setTimeout(() => el.remove(), 3100);
    }
    while (this.#medalsEl.childElementCount > 4) this.#medalsEl.firstElementChild.remove();
  }

  // SPEC 34.5: the kill cam tag.
  killcam(info) {
    if (!this.#killcamEl) return;
    this.#killcamEl.hidden = !info;
    if (info) this.#killcamWho.textContent = `${info.name}${info.weapon ? `  ·  ${info.weapon}` : ''}`;
  }

  // SPEC 34.6: minimap, drawn each frame from the layout.
  minimap(map, me, others, opts) {
    const c = this.#minimap;
    if (!c) return;
    const on = this.prefs?.minimap !== false && !!map;
    c.hidden = !on;
    if (!on) return;
    const size = c.width;
    const lay = minimapLayout(map, me, others, size, opts);
    const ctx = c.getContext('2d');
    ctx.clearRect(0, 0, size, size);
    ctx.fillStyle = 'rgba(255,255,255,0.08)';
    ctx.fillRect(0, 0, size, size);
    for (const b of lay.boxes) { ctx.fillStyle = b.tall ? 'rgba(230,237,243,0.55)' : 'rgba(230,237,243,0.3)'; ctx.fillRect(b.x, b.y, b.w, b.h); }
    if (lay.radar) { // SPEC 37.1: a sweep ring while the pulse shows
      ctx.strokeStyle = 'rgba(92,225,255,0.55)'; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(size / 2, size / 2, size * (0.2 + 0.3 * ((opts?.now ?? 0) % 1500) / 1500), 0, Math.PI * 2); ctx.stroke();
    }
    for (const d of lay.dots) {
      ctx.fillStyle = d.kind === 'ally' ? '#5ce1ff' : '#ff5252';
      ctx.beginPath(); ctx.arc(d.x, d.y, 3.5, 0, Math.PI * 2); ctx.fill();
      if (d.pulse) { ctx.strokeStyle = 'rgba(255,82,82,0.6)'; ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(d.x, d.y, 6, 0, Math.PI * 2); ctx.stroke(); }
    }
    ctx.save();
    ctx.translate(lay.me.x, lay.me.y);
    ctx.rotate(-lay.me.yaw); // yaw 0 looks toward -Z, which is up on a north-up map
    if (lay.cone > 0) { // SPEC 37.3: vision wedge
      ctx.fillStyle = 'rgba(61,220,132,0.12)';
      ctx.beginPath(); ctx.moveTo(0, 0); ctx.arc(0, 0, size * 0.45, -Math.PI / 2 - lay.cone / 2, -Math.PI / 2 + lay.cone / 2); ctx.closePath(); ctx.fill();
    }
    if (lay.ring > 0) { // SPEC 37.3: footstep audibility while sprinting
      ctx.strokeStyle = 'rgba(255,255,255,0.35)'; ctx.setLineDash([3, 3]); ctx.lineWidth = 1;
      ctx.beginPath(); ctx.arc(0, 0, lay.ring, 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]);
    }
    ctx.fillStyle = '#3ddc84';
    ctx.beginPath(); ctx.moveTo(0, -7); ctx.lineTo(5, 5); ctx.lineTo(0, 2); ctx.lineTo(-5, 5); ctx.closePath(); ctx.fill();
    ctx.restore();
  }
  // PRO-ceremony end

  // SPEC 37.2: spawn protection marker
  protection(on) {
    if (this.#protect) this.#protect.hidden = !on;
  }

  notice(text) {
    this.#notice.textContent = text;
    this.#notice.hidden = !text;
  }

  #renderHealth(hp) {
    if (hp === this.#lastHp) return;
    this.#lastHp = hp;
    const { segments } = deriveHealthSegments(hp, 100, this.#segments.length);
    this.#hpValue.textContent = String(Math.round(hp));
    this.#segments.forEach((el, i) => { el.style.transform = `scaleX(${segments[i] ?? 0})`; });
    this.#hp.classList.toggle('low', hp <= 25);
  }

  #renderRespawn(me, now) {
    if (me.alive === 1) {
      this.#deathTime = null;
      this.#dead.hidden = true;
      return;
    }
    if (this.#deathTime === null) this.#deathTime = now;
    const state = deriveRespawnText(me.alive, now, this.#deathTime);
    this.#dead.textContent = state.text;
    this.#dead.hidden = !state.visible;
  }

  #renderFeed(now) {
    const before = this.#feed.childElementCount;
    const entries = this.#killFeed.getEntries(now);
    if (!this.#feedDirty && entries.length === before) return;
    this.#feedDirty = false;
    this.#feed.replaceChildren(...entries.map((entry) => {
      const line = document.createElement('div');
      line.textContent = entry.text;
      return line;
    }));
  }

  #renderScoreboard(me, players) {
    const rows = sortScoreboardPlayers(players).map((p) => {
      const row = document.createElement('div');
      row.className = p.id === me.id ? 'row me' : 'row';
      const chip = document.createElement('span');
      chip.className = `chip team-${deriveTeamColor(p.id, p.tm)}`;
      const chipCell = document.createElement('span');
      chipCell.className = 'col-chip';
      chipCell.append(chip);
      row.append(chipCell, cell('col-name', p.bot === 1 ? `${p.name} [BOT]` : p.afk === 1 ? `${p.name} [AFK]` : p.name), cell('col-k', String(p.k)), cell('col-d', String(p.d))); // PRO-audio: SPEC 35.3
      return row;
    });
    const head = document.createElement('div');
    head.className = 'row head';
    head.append(cell('col-chip', ''), cell('col-name', 'Player'), cell('col-k', 'K'), cell('col-d', 'D'));
    this.#board.replaceChildren(head, ...rows);
  }

  #pulse(el, cls, ms) {
    el.classList.remove(cls);
    // Force a style flush so a re-triggered class restarts its transition.
    void el.offsetWidth;
    el.classList.add(cls);
    clearTimeout(this.#timers[`${el.id}:${cls}`]);
    this.#timers[`${el.id}:${cls}`] = setTimeout(() => el.classList.remove(cls), ms);
  }
}

function cell(className, text) {
  const span = document.createElement('span');
  span.className = className;
  span.textContent = text;
  return span;
}
