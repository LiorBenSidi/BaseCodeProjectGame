// DOM heads-up display (docs/SPEC.md 19.1). Every string that originates from the server or another
// player (names, kill-feed text) is written with textContent, never innerHTML: that is what keeps a
// player named "<img src=x onerror=...>" from becoming stored XSS in everyone else's browser.
// All state derivation lives in hudModel.js (pure, unit tested); this file only moves it into the DOM.

import {
  KillFeedQueue,
  deriveAmmoStatus,
  deriveHealthSegments,
  deriveRespawnText,
  deriveTeamColor,
  sortScoreboardPlayers,
} from './hudModel.js';

export const HUD_TIMING = Object.freeze({
  fireExpandMs: 100,
  damageIndicatorMs: 500,
  damageFlashMs: 250,
});

const $ = (id) => document.getElementById(id);

export class Hud {
  #root = $('hud');
  #hp = $('hp');
  #hpValue = $('hp-value');
  #segments = [...$('hp-bar').querySelectorAll('.hp-segment-fill')];
  #ammoValue = $('ammo-value');
  #feed = $('feed');
  #board = $('scoreboard');
  #cross = $('crosshair');
  #dead = $('dead');
  #notice = $('notice');
  #damageArc = $('damage-indicator');
  #damageFlash = $('damage-flash');

  #killFeed = new KillFeedQueue(5, 5000);
  #feedDirty = true;
  #deathTime = null;
  #lastHp = null;
  #timers = {};

  show() {
    this.#root.hidden = false;
    const ammo = deriveAmmoStatus();
    this.#ammoValue.textContent = `${ammo.text} / ${ammo.status}`;
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

  killFeed(text, now = Date.now()) {
    this.#killFeed.add(text, now);
    this.#feedDirty = true;
  }

  // Called once per snapshot with the local player's row and the full player list.
  update(me, players, now = Date.now()) {
    this.#renderHealth(me.hp);
    this.#renderRespawn(me, now);
    this.#renderFeed(now);
    if (!this.#board.hidden) this.#renderScoreboard(me, players);
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
      chip.className = `chip team-${deriveTeamColor(p.id)}`;
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
