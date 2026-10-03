// DOM side of combat feedback. Text is written with textContent only (names come from other players).

import { CombatLog, formatBoom, formatVerdict, markerKind } from './combatLog.js';

const $ = (id) => document.getElementById(id);

export class CombatHud {
  #log = new CombatLog();
  #list = $('combat-log');
  #info = $('hit-info');
  #cross = $('crosshair');
  #boom = $('boom');
  #names = new Map();
  #timers = {};

  setPlayers(players) {
    this.#names = new Map(players.map((p) => [p.id, p.name]));
  }

  verdict(v) {
    this.#push(formatVerdict(v, (id) => this.#nameOf(id)));
    const kind = markerKind(v);
    if (!kind) return;
    this.#flash(this.#cross, kind === 'head' ? 'head' : 'hit', 150);
    this.#info.textContent = `${kind === 'head' ? 'HEADSHOT' : 'BODY'} ${v.dmg}${v.kill ? ' · KILL' : ''}`;
    this.#flash(this.#info, 'show', 700);
  }

  boom(b, myId) {
    const text = formatBoom(b, myId, (id) => this.#nameOf(id));
    this.#push(text);
    if (text) this.#flash(this.#boom, 'show', 350);
  }

  #nameOf(id) {
    return this.#names.get(id) ?? `#${id}`;
  }

  #push(text) {
    if (!text) return;
    this.#log.push(text);
    this.#list.replaceChildren(...this.#log.entries.map((line) => {
      const row = document.createElement('div');
      row.textContent = line;
      return row;
    }));
  }

  #flash(el, cls, ms) {
    el.classList.remove('hit', 'head');
    el.classList.add(cls);
    clearTimeout(this.#timers[el.id]);
    this.#timers[el.id] = setTimeout(() => el.classList.remove(cls), ms);
  }
}
