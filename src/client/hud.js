// DOM heads-up display (docs/SPEC.md 19.1). Every string that originates from the server or another
// player (names, kill-feed text) is written with textContent, never innerHTML: that is what keeps a
// player named "<img src=x onerror=...>" from becoming stored XSS in everyone else's browser.
// All state derivation lives in hudModel.js (pure, unit tested); this file only moves it into the DOM.

import { crosshairStyle } from './prefs.js'; // PRO-menu: SPEC 33.4
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

  matchEnd(m, myId) {
    if (!this.#endScreen) return;
    this.#endTitle.textContent = deriveMatchEndText(m, myId);
    const top = (m.ranking ?? []).slice(0, 3).map((r) => `${r.name} ${r.k}/${r.d}`).join('   ');
    this.#endSub.textContent = top ? `Top: ${top}` : '';
    this.#endScreen.hidden = false;
    this.setScoreboardVisible(true);
  }

  matchStart() {
    if (this.#endScreen) this.#endScreen.hidden = true;
    this.setScoreboardVisible(false);
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
      row.append(chipCell, cell('col-name', p.name), cell('col-k', String(p.k)), cell('col-d', String(p.d)));
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
