// Lobby: rooms, quick play, create / join by code, account line and leaderboard (SPEC 26.4 / 27.4).
// Pure helpers are exported for tests; `Lobby` is the DOM glue. Reads go through the Base44 SDK
// (Room and PlayerStats are readable by everyone, written only by the actor's service role).
import { MODES, MODE_IDS, DEFAULT_MODE } from '../shared/modes.js';
import { lobbyRooms, quickPlayRoom, makeRoomId, newRoomCode, isRoomId, parseRoomId, roomLink, LEGACY_ROOM_ID } from '../shared/rooms.js';
import { leaderboard } from '../shared/persistence.js';

export const REFRESH_MS = 5000;

// A typed code or pasted link resolves to a room id, or null.
export function resolveJoinInput(text) {
  const raw = String(text ?? '').trim();
  if (!raw) return null;
  try {
    const url = new URL(raw);
    const q = url.searchParams.get('room');
    return q && isRoomId(q) ? q : null;
  } catch {
    /* not a URL */
  }
  if (isRoomId(raw)) return raw;
  const low = raw.toLowerCase();
  for (const m of MODE_IDS) if (isRoomId(makeRoomId(m, low))) return null; // a bare code is ambiguous without its mode
  return null;
}

// Account line text from an SDK user object (or null when signed out).
export const accountLine = (user) => (user ? `Signed in as ${user.full_name || user.email || 'player'}` : 'Not signed in: stats are not saved');

export const roomLabel = (r) => `${MODES[r.mode]?.name ?? r.mode}  ${r.players} / ${r.max}  ${r.phase === 'playing' ? 'in match' : r.phase}`;

export class Lobby {
  #client;
  #doc;
  #onRoom; // (roomId) => void: the menu's current room selection
  #timer = null;
  #rows = [];
  #user = null;

  constructor({ client, doc = document, onRoom }) {
    this.#client = client; // null on the Node dev server: the lobby then shows a single local room
    this.#doc = doc;
    this.#onRoom = onRoom;
  }

  mount() {
    const d = this.#doc;
    const $ = (id) => d.getElementById(id);
    if (!this.#client) {
      $('lobby').hidden = true;
      $('account').textContent = 'Local server: one room, no sign-in';
      return;
    }
    $('quick-play').addEventListener('click', () => this.quickPlay($('create-mode').value));
    $('create-room').addEventListener('click', () => this.create($('create-mode').value));
    $('join-code').addEventListener('change', () => this.joinInput($('join-code').value));
    $('join-code').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); this.joinInput($('join-code').value); } });
    $('sign-in').addEventListener('click', () => this.#client.auth.redirectToLogin(window.location.href));
    $('sign-out').addEventListener('click', async () => { await this.#client.auth.logout(); this.#user = null; this.#renderAccount(); });
    this.refresh();
    this.#timer = setInterval(() => this.refresh(), REFRESH_MS);
    d.addEventListener('visibilitychange', () => { if (!d.hidden) this.refresh(); });
  }

  stop() {
    if (this.#timer) clearInterval(this.#timer);
    this.#timer = null;
  }

  async refresh() {
    if (!this.#client) return;
    const [rooms, stats, user] = await Promise.all([
      this.#client.entities.Room.list('-players', 50).catch(() => []),
      this.#client.entities.PlayerStats.list('-kills', 10).catch(() => []),
      this.#user ? Promise.resolve(this.#user) : this.#client.auth.me().catch(() => null),
    ]);
    this.#rows = rooms;
    this.#user = user;
    this.#renderRooms(lobbyRooms(rooms, Date.now()));
    this.#renderBoard(leaderboard(stats, 10));
    this.#renderAccount();
  }

  quickPlay(mode = DEFAULT_MODE) {
    this.#pick(quickPlayRoom(this.#rows, MODE_IDS.includes(mode) ? mode : DEFAULT_MODE, Date.now()), true);
  }

  create(mode = DEFAULT_MODE) {
    this.#pick(makeRoomId(MODE_IDS.includes(mode) ? mode : DEFAULT_MODE, newRoomCode()), true);
  }

  joinInput(text) {
    const id = resolveJoinInput(text);
    const el = this.#doc.getElementById('join-code');
    el.setCustomValidity(id ? '' : 'Use a room id like tdm-abc234 or a join link');
    el.reportValidity();
    if (id) this.#pick(id, true);
  }

  #pick(id, submit) {
    this.#onRoom(id);
    if (submit) this.#doc.getElementById('menu').requestSubmit();
  }

  #renderRooms(list) {
    const ul = this.#doc.getElementById('rooms');
    if (!ul) return;
    if (list.length === 0) {
      const li = this.#doc.createElement('li');
      li.className = 'empty';
      li.textContent = 'No open rooms. Quick Play starts one.';
      ul.replaceChildren(li);
      return;
    }
    ul.replaceChildren(...list.map((r) => {
      const li = this.#doc.createElement('li');
      const btn = this.#doc.createElement('button');
      btn.type = 'button';
      btn.className = 'room';
      const code = this.#doc.createElement('span'); code.className = 'code'; code.textContent = r.id;
      const meta = this.#doc.createElement('span'); meta.className = 'meta'; meta.textContent = roomLabel(r);
      btn.append(code, meta);
      btn.addEventListener('click', () => this.#pick(r.id, true));
      li.append(btn);
      return li;
    }));
  }

  #renderBoard(rows) {
    const ol = this.#doc.getElementById('leaderboard');
    if (!ol) return;
    if (rows.length === 0) {
      const li = this.#doc.createElement('li');
      li.className = 'empty';
      li.textContent = 'No results yet. Sign in and play a match.';
      ol.replaceChildren(li);
      return;
    }
    ol.replaceChildren(...rows.map((r) => {
      const li = this.#doc.createElement('li');
      const name = this.#doc.createElement('span'); name.className = 'name'; name.textContent = `${r.rank}. ${r.name}`;
      const stat = this.#doc.createElement('span'); stat.className = 'stat'; stat.textContent = `${r.kills} K  ${r.wins} W  ${r.kd.toFixed(1)} K/D`;
      li.append(name, stat);
      return li;
    }));
  }

  #renderAccount() {
    const d = this.#doc;
    d.getElementById('account').textContent = accountLine(this.#user);
    d.getElementById('sign-in').hidden = !!this.#user;
    d.getElementById('sign-out').hidden = !this.#user;
    const name = d.getElementById('name');
    if (this.#user && name && !name.value) name.value = String(this.#user.full_name || '').slice(0, 16);
  }
}

// Room line for the menu and the HUD: "tdm-abc234 (Team Deathmatch)" or the legacy room.
export function describeRoom(id) {
  const p = parseRoomId(id);
  if (!p) return id;
  if (id === LEGACY_ROOM_ID) return `${id} (Deathmatch)`;
  return `${id} (${MODES[p.mode].name})`;
}

export { roomLink };
