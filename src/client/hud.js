// DOM heads-up display. Every string that originates from the server or another player
// (names, kill-feed text) is written with textContent, never innerHTML: that is what keeps a
// player named "<img src=x onerror=...>" from becoming stored XSS in everyone else's browser.

const $ = (id) => document.getElementById(id);

export class Hud {
  #root = $('hud');
  #hp = $('hp-value');
  #feed = $('feed');
  #board = $('scoreboard');
  #cross = $('crosshair');
  #dead = $('dead');
  #notice = $('notice');

  show() {
    this.#root.hidden = false;
  }

  setScoreboardVisible(visible) {
    this.#board.hidden = !visible;
  }

  update(me, players) {
    this.#hp.textContent = String(me.hp);
    this.#dead.hidden = me.alive === 1;

    if (this.#board.hidden) return;
    const rows = [...players]
      .sort((a, b) => b.k - a.k || a.d - b.d)
      .map((p) => {
        const row = document.createElement('div');
        row.className = p.id === me.id ? 'row me' : 'row';
        for (const text of [p.name, String(p.k), String(p.d)]) {
          const cell = document.createElement('span');
          cell.textContent = text;
          row.append(cell);
        }
        return row;
      });
    this.#board.replaceChildren(...rows);
  }

  hitMarker() {
    this.#cross.classList.add('hit');
    setTimeout(() => this.#cross.classList.remove('hit'), 120);
  }

  killFeed(text) {
    const line = document.createElement('div');
    line.textContent = text;
    this.#feed.append(line);
    setTimeout(() => line.remove(), 5000);
  }

  notice(text) {
    this.#notice.textContent = text;
    this.#notice.hidden = !text;
  }
}
