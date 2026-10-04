# Behavior Specification

This is the contract that tests are written against. Tests assert **behavior described here**, never
implementation details. If code and this document disagree, one of them is a bug: fix the spec by pull
request first, then the tests, then the code (RED → GREEN → REFACTOR).

All modules are ES modules. Paths are relative to the repo root.

---

## 1. `src/shared/constants.js` (already exists)

Named exports: `TICK_RATE=30`, `INPUT_DT=1/60`, `MAX_PLAYERS=16`, `MAX_HP=100`, `RESPAWN_MS=3000`,
`PLAYER={radius:0.4,height:1.8,eye:1.6,speed:7,jump:8,gravity:24}`,
`WEAPON={damage:25,range:120,cooldownMs:150}`.

## 2. `src/shared/map.js`

`MAP = { half, boxes, spawns }`.
- `half` is a positive number; the playable area is the square `[-half, half]` on X and Z.
- `boxes`: array of axis-aligned boxes `{ min:[x,y,z], max:[x,y,z] }`, with `min[i] < max[i]` for every axis.
- `spawns`: non-empty array of `{ x, z, yaw }`. Every spawn lies inside the play area and is **not inside any box**
  (a player of `PLAYER` size standing at `y=0` on a spawn must overlap no box).

## 3. `src/shared/movement.js` — `stepPlayer(p, cmd, boxes = MAP.boxes, half = MAP.half)`

Advances one fixed step of `INPUT_DT` seconds. Mutates **and returns** `p`.

- `p`: `{ x, y, z, vx, vy, vz, onGround }` where `y` is the **feet** position. The hitbox is an AABB:
  `x±radius`, `y..y+height`, `z±radius`.
- `cmd`: `{ fwd, right, jump, yaw }`. `fwd`,`right` ∈ [-1,1]. Yaw 0 faces **-Z**; increasing yaw turns **left**
  (toward -X). So at yaw 0, `fwd=1` decreases z; `right=1` increases x. At yaw π/2, `fwd=1` decreases x.
- Horizontal speed is `PLAYER.speed` times the input vector; the input vector's length is capped at 1
  (moving diagonally is **not** faster than moving straight). No input → horizontal velocity 0 (no sliding).
- Gravity: `vy -= gravity * INPUT_DT` every step. Standing on the floor (`y=0`) or on a box top, `onGround` is true
  and `vy` is 0 after the step.
- Jump: if `cmd.jump` and `p.onGround` at the start of the step, `vy` becomes `PLAYER.jump` (minus one step of gravity)
  and `onGround` becomes false. Jump while airborne has no effect.
- Collision: the player never ends a step overlapping any box (touching a face is allowed). Walking into a wall
  stops movement along that axis but allows sliding along the other axis. Landing on a box places the feet exactly
  on the box top. Hitting a box ceiling while rising zeroes `vy`.
- The floor is `y=0`; `y` never goes below 0.
- Bounds: after the step `|x| <= half - radius` and `|z| <= half - radius`.
- Determinism: the same starting state and the same command sequence always produce bit-identical results
  (client prediction depends on this).
- Purity: no I/O, no randomness, no dependence on wall-clock time.

## 4. `src/shared/hitscan.js`

- `aimDir(yaw, pitch)` → unit vector `[x,y,z]`. Yaw 0, pitch 0 → `[0,0,-1]`. Positive pitch looks **up** (+y).
  Yaw π/2, pitch 0 → `[-1,0,0]`. Length is always 1.
- `playerBox(p)` → `{min,max}` matching the hitbox in §3.
- `rayAabb(origin, dir, min, max)` → distance `t >= 0` to the first intersection, or `null` on a miss.
  Origin inside the box → `0`. A box behind the ray → `null`. A ray parallel to a slab and outside it → `null`.
  A ray that only grazes an edge/face plane inside the slab range counts as a hit.
- `castRay(origin, dir, range, boxes, targets)` where `targets = [{ id, box }]` → `{ t, targetId }`.
  `t` is the distance to the nearest obstruction (map box, target, or `range`, whichever is smallest).
  `targetId` is the id of the target hit **only if it is strictly nearer than every map box and `range`**;
  otherwise `null`. A wall between shooter and target means no hit.

## 5. `src/server/config.js` — `loadConfig(env)`

Pure function of an env-like object (never reads `process.env` itself). Returns
`{ port, host, isProd, allowedOrigins, logLevel }`.

| Variable | Default | Rules |
|---|---|---|
| `PORT` | `3000` | integer 1–65535, otherwise **throw** an `Error` whose message contains `PORT` |
| `HOST` | `0.0.0.0` | any non-empty string |
| `NODE_ENV` | — | `isProd` is true only for the exact string `production` |
| `ALLOWED_ORIGINS` | `[]` | comma-separated; entries trimmed, lowercased, empty entries dropped |
| `LOG_LEVEL` | `info` | one of `debug`,`info`,`warn`,`error`, otherwise **throw** an `Error` containing `LOG_LEVEL` |

## 6. `src/server/security.js`

- `sanitizeName(raw)` → string. Non-string → `''`. Result contains only Unicode letters, Unicode digits, space,
  `_` and `-`; leading/trailing whitespace trimmed; runs of spaces collapsed to one; at most **16 characters**
  (code points). Markup such as `<script>` must not survive as `<` or `>` characters. May return `''`.
  The input is Unicode-normalised to **NFC** first (accents compose into their letters); letters are never rewritten
  into different letters (no NFKC folding), so a name made of 16 astral letters such as `𝒜` survives intact.
- `isAllowedOrigin(originHeader, hostHeader, allowedOrigins)` → boolean. Guards against cross-site WebSocket
  hijacking.
  - Missing/empty/non-string `originHeader` → `false`.
  - Unparseable origin → `false`.
  - If `allowedOrigins` is non-empty: `true` only if the lowercased origin **exactly equals** one entry.
  - If empty: `true` only if the origin's host (including port) equals `hostHeader` case-insensitively
    (same-origin). Scheme is not compared in this mode.
  - `null`-string origins (`"null"`) → `false`.

## 7. `src/server/protocol.js` — `parseClientMessage(raw)`

`raw` is a string or Buffer. Returns `{ ok:true, msg }` or `{ ok:false, reason }`. Never throws, for any input.

Reasons: `too_large` (byte length > 4096), `bad_json`, `bad_shape` (not a plain object, or unknown/missing `t`),
`bad_join`, `bad_cmd`, `bad_ping`.

Accepted messages (the returned `msg` is **freshly built from whitelisted fields only**; unknown extra fields such as
`__proto__`, `isAdmin`, `hp` are dropped):

- `{ t:'join', name? }` → `msg = { t:'join', name }` where `name = sanitizeName(name)` (`''` if absent/non-string).
- `{ t:'shoot' }` → `msg = { t:'shoot' }`.
- `{ t:'ping', id, ts }` → `msg = { t:'ping', id, ts }` (§18.2). `id`: safe integer >= 0; `ts`: finite number >= 0 (the
  client's `Date.now()`). Anything else → `bad_ping`.
- `{ t:'input', cmds:[...] }`: 1 to `MAX_CMDS_PER_MSG = 8` commands (export this constant), each
  `{ seq, fwd, right, jump, yaw, pitch }`:
  - `seq`: safe integer ≥ 0, otherwise `bad_cmd`.
  - `fwd`,`right`: finite numbers, clamped into [-1,1]; non-number/NaN/Infinity → `bad_cmd`.
  - `jump`: coerced with `!!`.
  - `yaw`: finite number (not clamped); otherwise `bad_cmd`.
  - `pitch`: finite number clamped into [-1.5533, 1.5533]; otherwise `bad_cmd`.
  - Empty array, more than 8 commands, or non-array `cmds` → `bad_cmd`. One bad command rejects the whole message.

## 8. `src/server/rateLimit.js` — `class TokenBucket`

`new TokenBucket({ capacity, refillPerSec, now = () => Date.now() })`, `now()` returns **milliseconds**.
- Starts full. `take(cost = 1)` → `true` and deducts if enough tokens are available after refilling, else `false`
  (and deducts nothing).
- Refill is continuous at `refillPerSec` and never exceeds `capacity`.
- Non-positive or non-finite `capacity`/`refillPerSec` → constructor throws.

## 9. `src/server/logger.js` — `createLogger(name, opts)`

`opts = { level = 'info', sink = (line) => process.stdout.write(line + '\n'), now = () => new Date() }`.
Returns `{ debug, info, warn, error }`, each `(msg, fields?)`.
- Each call below the configured level does nothing (the sink is **not** called).
- Otherwise it calls `sink` once with a **single-line JSON string** containing `ts` (ISO-8601 from `now()`),
  `level`, `logger` (= `name`), `msg`, plus the extra `fields`.
- The reserved keys `ts`, `level`, `logger`, `msg` in `fields` never override the real values.
- A field named `err` holding an `Error` is serialized as `{ name, message }` (no stack).
- Newlines/control characters in any value cannot break the one-line-per-event format (log-forging defence).
- Level order: `debug < info < warn < error`. Invalid `level` → throws.

## 10. `src/server/GameRoom.js` — `class GameRoom`

`new GameRoom({ now = () => Date.now(), random = Math.random, logger, maxPlayers = MAX_PLAYERS } = {})`.
`logger` is optional (`createLogger`-shaped); the room must work without one. The room does **no I/O of its own**:
each player supplies a `send(obj)` function; the room never touches sockets or timers (a caller drives `tick()`).

Constants (export them): `MAX_CMDS_PER_TICK = 4`, `MAX_QUEUE = 12`.

### API
- `addPlayer({ send, name })` → the live player object, or `null` if the room is full. Player fields:
  `id` (unique integer, starting at 1, never reused), `name` (`sanitizeName(name)`; if empty → `` `Player${id}` ``),
  `x,y,z,vx,vy,vz,onGround,yaw,pitch`, `hp = MAX_HP`, `alive = true`, `kills = 0`, `deaths = 0`, `lastSeq = -1`.
  Spawns at `MAP.spawns[Math.floor(random() * MAP.spawns.length)]` with `y = 0` and that spawn's `yaw`.
  Immediately calls `send({ t:'welcome', id, tickRate: TICK_RATE })`.
  The returned object is the live state; tests may set `x,y,z,yaw,pitch,hp` directly.
- `removePlayer(id)` → `true` if a player was removed, `false` otherwise.
- `playerCount` getter.
- `handleInput(id, cmds)` → validated commands as from §7. Unknown id → ignored. Commands whose `seq` is not strictly
  greater than the highest `seq` already **queued** for that player are dropped (replay protection). The queue
  holds at most `MAX_QUEUE`; when exceeded the **oldest** are dropped.
- `handleShoot(id)` → marks a pending shot (at most one pending shot per player). Unknown id → ignored.
- `tick()` → advances the world by one server tick, in this order:
  1. **Commands.** Per player, consume at most `MAX_CMDS_PER_TICK` queued commands, oldest first. For each: if the
     player is alive apply `stepPlayer`; always copy `yaw`,`pitch` and set `lastSeq = cmd.seq`. Dead players' commands
     are consumed but not simulated.
  2. **Shots.** Each pending shot is resolved and cleared. A shot fires only if the shooter is alive and
     `now() - lastShotAt >= WEAPON.cooldownMs` (the first shot is always allowed); otherwise it is discarded.
     Origin `[x, y + PLAYER.eye, z]`, direction `aimDir(yaw, pitch)`, range `WEAPON.range`, against `MAP.boxes` and
     the hitboxes of **other alive** players. Events, all through `send`:
     - every player receives `{ t:'shot', id: shooterId, from:[x,y,z], to:[x,y,z] }` (`to` = origin + dir·t);
     - on a player hit: damage from §15 (zone × range band) is applied; the shooter receives `{ t:'hit', id: victimId }`
       and, for every fired shot, a `verdict` (§15.4);
     - if `hp <= 0`: victim `alive=false`, `deaths++`, shooter `kills++`, respawn time `now() + RESPAWN_MS`, and every
       player receives `{ t:'kill', killer, victim, killerName, victimName }`.
     A player can never damage themself. A wall in between prevents damage. Dead players cannot be hit.
  3. **Respawn.** Any dead player with `now() >= respawnAt` is revived: `hp = MAX_HP`, `alive = true`, velocities 0,
     placed at a random spawn (as in `addPlayer`).
  4. **Snapshot.** Every player receives `{ t:'snap', tick, ack: thatPlayer.lastSeq, players:[...] }` where `tick`
     is a counter starting at 1 for the first call, and each entry is
     `{ id, name, x, y, z, vy, g, yaw, pitch, hp, alive, k, d }` with numbers rounded to 3 decimals and
     `g` / `alive` encoded as `1` / `0`.
- A `send` that throws must not break the tick for other players (the error is caught; the room may log it).

### Invariants (property-style tests should hold these after any sequence of API calls)
- `0 <= hp <= MAX_HP`; `alive` is false iff `hp <= 0`.
- Every alive player's position is inside the map bounds and overlaps no box.
- `kills` and `deaths` never decrease. Ids are unique.

---

## 11. `src/server/static.js` — `resolveStaticPath(root, urlPath)`

Pure (no filesystem access, does not check that the file exists). `root` is an absolute directory path,
`urlPath` is the raw request target (path plus optional `?query` / `#hash`). Returns an absolute file path
**inside `root`**, or `null` to refuse.

- Query string and hash are stripped. `"/"` (and the empty string) → `<root>/index.html`.
- The path is percent-decoded exactly once; invalid encoding (e.g. `%E0%A4%A`) → `null`.
- NUL bytes (raw or `%00`) → `null`. Backslashes (raw or `%5c`) → `null`.
- Any `..` segment, raw or encoded (`%2e%2e`, `%2E%2E`), that would leave `root` → `null`. A `..` that stays
  inside root after normalisation may resolve normally.
- Any segment starting with `.` (dotfiles such as `.env`, `.git`) → `null`.
- The result never equals `root` itself and always starts with `root + path.sep`.
- Non-string `urlPath` → `null`.

---

## 12. `src/server/server.js` — `startServer(options)` (HTTP + WebSocket behaviour)

`await startServer({ port, host, isProd, allowedOrigins, logLevel, client, sink })` → `{ port, room, close }`.
- `port: 0` binds an ephemeral port; the returned `port` is the real one. `host` e.g. `'127.0.0.1'`.
- `client`: `'none'` serves no client (only the endpoints below), `'static'` serves the built `dist/` folder
  (requires `npm run build` to have produced it), `'vite'` runs the dev middleware (not used in tests).
- `sink(line)` receives each log line (default: stdout). `logLevel` filters as in §9.
- `close()` returns a promise; afterwards the port refuses connections. Calling it must not hang even with open sockets.
- `room` is the live `GameRoom` (§10); tests may use `room.playerCount`.

### HTTP
- `GET /healthz` → `200`, `Content-Type: application/json`, body `{"status":"ok"}`, `Cache-Control: no-store`.
- `GET /readyz` → `200`, body `{"status":"ready","players":<room.playerCount>}`.
- Query strings are ignored when matching those two paths.
- Any method other than GET/HEAD (on any path) → `405` with an `Allow: GET, HEAD` header.
- With `client:'none'`, every other path → `404`.
- **Every** response carries `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`,
  `Cross-Origin-Opener-Policy: same-origin`. When `isProd` is true it additionally carries
  `X-Frame-Options: DENY` and a `Content-Security-Policy` containing `default-src 'self'`, `script-src 'self'`,
  `object-src 'none'`, `base-uri 'none'` and `frame-ancestors 'none'`. When `isProd` is false there is **no**
  CSP and no `X-Frame-Options` (they would break the dev preview).
- With `client:'static'`: `GET /` → `200`, `text/html`, body contains `Base Code Arena`, `Cache-Control: no-cache`;
  `HEAD /` → `200` with no body; a built file under `/assets/` → `200`, correct `Content-Type`
  (`text/javascript` or `text/css`) and `Cache-Control` containing `immutable`. Refused with `404`:
  a missing file, a directory (`/assets/`), `/.env`, `/.git/config`, `/%2e%2e/package.json`,
  and a raw `/../package.json` sent without client-side normalisation. Static serving uses §11.

### WebSocket at `/ws`
- Upgrade requests for any other path are destroyed (the client sees a connection error, no HTTP upgrade).
- **Origin check (§6 `isAllowedOrigin`)** happens before the upgrade: a missing `Origin`, `Origin: null`, or an origin that
  is neither same-origin (its host equals the `Host` header) nor in `allowedOrigins` gets an HTTP `403` and no WebSocket.
  A same-origin `Origin` (e.g. `http://127.0.0.1:<port>`) upgrades. When `allowedOrigins` is non-empty only exact listed origins upgrade.
  Rejections are logged at `warn` with message `websocket rejected: origin`, as valid single-line JSON, with the origin value cut to at most 100 characters.
- **Per-IP cap:** at most **8** concurrent sockets per remote address; the 9th upgrade gets HTTP `429`. When one closes, a new one is accepted.
- **Join flow:** after `{"t":"join","name":"Ann"}` the server sends `{"t":"welcome","id":<int>,"tickRate":30}` and then
  `snap` messages at about 30 Hz whose `players` include `{ name:"Ann", ... }`.
  A second `join` on the same socket is ignored. `input` / `shoot` before `join` are ignored (no player is created,
  `room.playerCount` stays 0) and do not close the socket.
- **Simulation over the wire:** `{"t":"input","cmds":[{seq:1,fwd:1,right:0,jump:false,yaw:0,pitch:0}, ...]}` makes later snapshots
  carry `ack >= 1` and the player's `z` decreases (yaw 0, fwd 1). Sending the same `seq` again does not move the player again.
- **Shoot:** `{"t":"shoot"}` from a joined player makes every joined player receive a `{ t:"shot", id:<shooterId>, from:[3], to:[3] }` within a few ticks.
- **Disconnect:** when a joined socket closes, `room.playerCount` drops and `/readyz` reflects it.
- **Binary frames** close the socket with code `1003`.
- **Oversized frames** (> 4096 bytes) close the socket (`ws` reports code `1009`).
- **Protocol strikes:** an invalid message (bad JSON, unknown type, bad command) counts a strike and is otherwise ignored;
  the 5th strike closes the socket with code `1008`. Valid messages between strikes do not reset the count.
  4 invalid messages leave the connection open.
- **Rate limit:** each socket has a token bucket (capacity 120, refill 100 per second). Sending far more than that in a burst
  (say 400 tiny valid messages) closes the socket with code `1008`; a normal 60 Hz sender is never closed.
- Room capacity (16) cannot be reached from one address because of the per-IP cap; it is covered at unit level (§10).
- A player that joins sees `hp` 100 and is alive in snapshots.

---

## 13. `scripts/check-policy.mjs` — policy checker library

Exports `RULES`, `stripComments(text)`, `scanSource(file, text)`.
- `scanSource(file, text)` → array of `{ file, line, rule, why }` (`line` is 1-based). `file` is a repo-relative POSIX path such as
  `src/server/x.js`. Files outside `src/` (e.g. `tests/a.js`, `scripts/b.mjs`) never produce findings.
- Rule ids and scopes:
  - `NO_CONSOLE_SERVER` (files under `src/server/` and `src/shared/`): any `console.<anything>` use (`console.log(`, `console . error(`).
  - `NO_CONSOLE_LOG_CLIENT` (`src/client/`): `console.log` only; `console.warn` / `console.error` are allowed.
  - `NO_HTML_SINK` (`src/client/`): `.innerHTML`, `.outerHTML`, `insertAdjacentHTML`, `document.write`, `document.writeln`.
    `textContent`, `createElement`, `append` are fine. Not applied to server files.
  - `NO_DYNAMIC_CODE` (all of `src/`): `eval(`, `new Function(`, and string-form `setTimeout("...")` / `setInterval("...")`.
    Whole-word only: `retrieval(` and `setTimeout(fn, 10)` are fine.
  - `NO_SHELL_EXEC` (all of `src/`): any mention of `child_process`.
  - `NO_HARDCODED_SECRET` (all of `src/`): an identifier containing `apiKey`/`api_key`/`secret`/`token`/`password` assigned a quoted literal of
    8+ non-space characters (e.g. `const apiKey = "abcd1234efgh"`). Shorter literals and `process.env.X` reads are fine.
  - `NO_WILDCARD_REEXPORT` (all of `src/`): `export * from '...'` and `export * as ns from '...'`.
    `import * as THREE from 'three'` is fine.
- Comments (`// ...` and `/* ... */`) are not scanned, so a comment that merely mentions `innerHTML` is not a finding.
  A `//` that is part of `://` (a URL) does not start a comment.
- Suppression: a `policy-allow: RULE_ID` marker in a `//` comment on the same line suppresses only that rule on that line.
  Another rule on the same line is still reported; a marker on a different line has no effect.
- Multiple violations on one line produce multiple findings. Line numbers stay correct after multi-line block comments.
- `stripComments(text)` keeps the line count identical to the input.

---

## 14. Open questions found by the independent test authors

Each row is something the spec did not pin down. "Today" is what the code does now. **Resolve every row** (see Prompt 1 in
`docs/BASE_CODE_PROMPTS.md`): decide, write the decision into the relevant section above, add a test, and mark the row
`resolved (D-nnn)`. Rows marked (owner) change gameplay or security posture, so the owner decides.

| # | Question | Where | Today | Status |
|---|---|---|---|---|
| 1 | Overkill damage: may `hp` go below 0? | 10 | Clamped at 0; the invariant `0 <= hp <= MAX_HP` holds | open |
| 2 | `bad_join` reason is listed but nothing produces it | 7 | Never produced; a non-string name becomes `''` | open |
| 3 | `PORT=""` or `HOST=""`: default or error? | 5 | Empty means unset, so the default is used | open |
| 4 | `LOG_LEVEL` case/whitespace; `PORT` forms such as `1e3`, `0x50` | 5 | `INFO` and `" info"` are rejected; only plain decimal digits are accepted for `PORT` | open |
| 5 | Allowlist origin with a trailing slash | 6 | Rejected (exact match only) | open |
| 6 | A lower `seq` after earlier ones were consumed | 10 | Rejected: `seq` must exceed the highest ever queued | open |
| 7 | Two players kill each other in the same tick (owner) | 10 | Resolved in player-join order; a victim killed earlier cannot fire later that tick | open |
| 8 | Respawn yaw | 10 | The spawn's yaw is applied | open |
| 9 | Does a cooldown-rejected shot update the cooldown clock? | 10 | No; only a fired shot does | open |
| 10 | Name characters such as tab, newline, U+3000 | 6 | Removed (not turned into spaces) | open |
| 11 | `TokenBucket` when the clock steps backwards | 8 | Treated as zero elapsed time | open |
| 12 | Logger with circular objects, `BigInt`, or a throwing sink | 9 | Circular/BigInt fall back to a short line; a throwing sink propagates to the caller | open |
| 13 | Tick counter in an empty room | 10 | Still increments | open |
| 14 | `stepPlayer` with `NaN` or out-of-range input | 3 | Not guarded; relies on `parseClientMessage` upstream | open |
| 15 | Static path: a `.` or `..` segment vs "any segment starting with `.` is refused" | 11 | `/a/../b.js` resolves inside root; `/a/./b.js` is refused | open |
| 16 | Static path: `//` and an encoded `%2f` inside a segment | 11 | `//` collapses; `%2f` decodes to a separator | open |
| 17 | Policy checker: secret rule case/inner spaces; `policy-allow` inside `/* */`; `setTimeout("a"+b)` | 13 | Case-insensitive; a literal with spaces is not matched; the marker in a block comment is ignored; the concatenated form is not flagged | open |
| 18 | Do messages before `join` consume rate-limit tokens? | 12 | Yes: every message on a socket does | open |
| 19 | Origin `http://evil@127.0.0.1:PORT` where the host equals `Host` (owner) | 6 | Accepted (userinfo is ignored by URL parsing) | open |
| 20 | Security headers on the 403/429 upgrade rejections | 12 | Not sent (raw socket write) | open |
| 21 | Oversize-frame close code | 12 | 1009, produced by the `ws` library's payload limit | open |
| 22 | Origin with a path or without a scheme; `/ws/` with a trailing slash | 6, 12 | Path ignored; scheme-less rejected; `/ws/` is not upgraded | open |
| 23 | `/assets` without a trailing slash | 12 | 404 (a directory) | open |

Not testable through the public surface, by design: room capacity of 16 (the per-IP cap of 8 is reached first), and spawn
positions (random).

---

## 15. Combat: zones, range bands, throwable (D-010 to D-015)

Implemented 2026-09-30. Tuning lives as data in `src/shared/combatData.js`; changing a value there changes
gameplay without code edits. Shots resolve against **current** positions: this is not lag compensation.
When lag compensation arrives, rewind must include the zone geometry below, not only the movement box.

### 15.1 `src/shared/combatData.js`
- `ZONE_MULTIPLIERS = { head: 1.5, upperTorso: 1.1, lowerTorso: 1.0, arms: 0.95, legs: 0.9 }` (D-010).
- `ZONE_LAYOUT = { legsTop: 0.9, lowerTorsoTop: 1.15, upperTorsoTop: 1.5, armOffset: 0.25 }`, heights in
  metres above the feet, inside the §3 hitbox (height 1.8).
- `RIFLE = { range: 120, cooldownMs: 150, bands: [{ below: 20, damage: 25 }, { below: 40, damage: 22 },
  { below: 120, damage: 18 }] }` (D-011, D-014). `range`, `cooldownMs` and the close band equal `WEAPON` in §1.
- `GRENADE = { fuseMs: 3000, speed: 16, gravity: 24, restitution: 0.45, radius: 0.1, blastRadius: 5,
  maxDamage: 100, substepHz: 120, perLife: 1 }` (D-015).

### 15.2 `src/shared/combat.js`
- `zoneAt(p, point)` → zone name for an impact `point` on player `p`'s hitbox. Height `h = point.y - p.y`:
  `h >= upperTorsoTop` → `head`; `h < legsTop` → `legs`. Otherwise the lateral offset
  `(point - p) · right`, with `right = [cos yaw, 0, -sin yaw]`, decides: `|offset| > armOffset` → `arms`,
  else `upperTorso` (`h >= lowerTorsoTop`) or `lowerTorso`. Two arms share one multiplier.
- `bandDamage(weapon, dist)` → the damage of the first band with `dist < below`, or `0` when `dist` is at or
  beyond the last band. Boundaries are exclusive above: exactly 20 m is band 2, exactly 40 m is band 3,
  exactly 120 m is `0`.
- `shotDamage(weapon, zone, dist)` → `bandDamage × ZONE_MULTIPLIERS[zone]`, rounded to 2 decimals.
- `applyDamage(target, amount)` → `{ applied, killed }`, the one damage function for bullets **and**
  explosions. `applied = min(target.hp, amount)`; `target.hp` drops by it (2-decimal rounding, never below 0);
  `killed` is true when hp reaches 0 from above 0. Amounts `<= 0` change nothing.
- `resolveShot(origin, dir, weapon, boxes, targets)`, `targets = [{ id, p }]` → `{ t, targetId, zone, dist,
  damage }`. Obstruction follows `castRay` (§4) against `playerBox(p)`. On a miss `targetId`/`zone` are `null`
  and `damage` is `0`. `dist = t`. Pure: equal poses and rays give equal results whatever the room tick rate.

### 15.3 `src/shared/projectile.js`
- `launchGrenade(id, owner, origin, dir)` → `{ id, owner, x, y, z, vx, vy, vz, stepsLeft, exploded: false }`,
  velocity `dir × GRENADE.speed`, `stepsLeft = round(fuseMs / 1000 × substepHz)` (360).
- `stepGrenade(g, dt, boxes, half)` advances `round(dt × substepHz)` sub-steps (at least 1) of
  `1 / substepHz` s. Each: `vy -= gravity × h`, then move axis by axis; a move that would overlap a box
  (the grenade is a cube of half-size `radius`), go below `y = radius`, or leave `|x|,|z| <= half - radius`
  is undone and that velocity component becomes `-v × restitution`. Every vertical contact (floor or box top)
  also multiplies horizontal velocity by `restitution`, and a vertical speed below 0.5 m/s after a contact
  becomes 0, so the grenade settles (within one sub-step, under 1 cm, of the surface). `stepsLeft` counts down;
  at 0 `exploded` becomes true and the grenade stops. The fuse is therefore exactly 3 s at 30, 60 and 120 Hz.
- `blastDamage(center, p, boxes)` → damage to player `p`. `d` = distance from `center` to the nearest point
  of `playerBox(p)`. `d >= blastRadius` → `0`. Any map box strictly nearer along the segment from `center` to
  that point (cover) → `0`. Otherwise `maxDamage × (1 - d / blastRadius)`, rounded to 2 decimals.

### 15.4 Protocol and room (extends §7, §10, §12)
- `parseClientMessage` accepts `{ t: 'throw' }` → `msg = { t: 'throw' }`; every other field is dropped.
- `GameRoom.handleThrow(id)` marks one pending throw. Player fields add `grenades` (`GRENADE.perLife`,
  restored on respawn). Unknown ids are ignored.
- Tick order becomes: commands, shots, throws, grenades, respawn, snapshot.
- **Shots** use `resolveShot` with `RIFLE`. Unchanged: cooldown, the `shot` broadcast, `hit` to the shooter,
  the `kill` broadcast. New: the shooter always receives
  `{ t: 'verdict', target: id|null, zone: name|null, dmg, dist, kill: bool }`, a miss included. `dmg` is the
  applied damage, `dist` is rounded to 2 decimals.
- **Throws** fire only if the thrower is alive and `grenades > 0`; origin at the eye, direction
  `aimDir(yaw, pitch)`, grenade ids start at 1 and are never reused.
- **Grenades** step by `1 / TICK_RATE`. On explosion every alive player within range, the thrower included,
  takes `blastDamage` through `applyDamage`. Everyone receives
  `{ t: 'boom', id, owner, at: [x, y, z], hits: [{ id, dmg, kill }] }`. A kill broadcasts `kill` with
  `killer` = owner; a self-kill counts a death and no kill. A grenade outlives its owner's death or departure.
- **Snapshots** add `nades: [{ id, x, y, z }]` (3-decimal rounding) next to `players`; player entries are
  unchanged. With 16 players and 16 live grenades a snapshot stays under 4096 bytes of JSON (a load check,
  not the §7 incoming limit, which still applies only to client messages).

### 15.5 Client feedback (D-013)
- Feedback reacts only to server messages (`verdict`, `boom`, `kill`); the client never shows a hit it
  predicted. The crosshair marks a head hit differently from a body hit.
- The combat log (`src/client/combatLog.js`) keeps at most 8 entries: shot, zone, applied damage, kill.
- G throws. With `?debug=1` the page exposes a debug harness (`window.__arenaDebug`) that aims, fires and
  throws through the normal intent path, for browsers where pointer lock is unavailable.

## 16. Mobile touch controls, landscape (D-016)

Client-only. Touch produces the same intent as keyboard/mouse (command `fwd`/`right`/`jump`/`yaw`/`pitch`,
`shoot`, `throw`); nothing new is sent and the server is unchanged.

### 16.1 `src/client/touchMath.js` (pure)
- `STICK_RADIUS = 60` (px), `STICK_DEADZONE = 0.15`, `LOOK_SENSITIVITY = 0.005` (rad per px).
- `stickVector(dx, dy, radius = STICK_RADIUS, deadzone = STICK_DEADZONE)` → `{ fwd, right }`. `dx`/`dy` are the
  thumb offset from the stick origin in screen px (down is +y). Normalised by `radius`; length below `deadzone`
  → `{ fwd: 0, right: 0 }`; length above 1 is scaled to 1. `right = x`, `fwd = -y`, each within [-1, 1].
- `lookDelta(dx, dy, sensitivity = LOOK_SENSITIVITY)` → `{ yaw: -dx × s, pitch: -dy × s }` (drag right turns right,
  drag up looks up, matching mouse look).
- `needsRotate(width, height, coarse)` → `true` only when the pointer is coarse (touch) and `height > width`.

### 16.2 Behaviour
- Input is "active" when the pointer is locked **or** touch controls are enabled; movement and fire are sampled
  only while active. Keyboard and stick add, then clamp to [-1, 1].
- Pitch from touch look is clamped to ±1.5533 like mouse look.
- Portrait on a touch device shows `#rotate` over the game; inputs keep sampling but the overlay blocks touches.

## 17. Base44 hosting: Match actor and session layer (D-017)

The game runs as a Base44 app: the client is a static site on Base44 hosting, the simulation runs in a
**Match actor** (one Cloudflare Durable Object per room id). The Node server in `src/server/server.js`
stays for local development, the test suites and the smoke script. Both transports share one session
layer so their behaviour cannot drift.

### 17.1 `src/server/matchSession.js` — `MatchSession({ room, logger, now })`
- A connection is `{ id, send(obj), close(reason) }`. `connect(conn)` registers it (returns `false` for a
  duplicate id), `message(conn, data)` handles one already-parsed message, `close(conn)` forgets it and
  removes its player, `tick()` advances the room.
- Per connection: a `TokenBucket({ capacity: 120, refillPerSec: 100 })` (`BUCKET`) and a strike counter.
  Over budget → `close('rate_limit')`. Every message goes through `validateClientMessage` (§5 whitelist,
  same reasons); a rejected message is a strike, `MAX_PROTOCOL_STRIKES = 5` → `close('protocol_violations')`.
- Size: `exceedsMessageBytes(data)` re-measures a parsed object as JSON text against `MAX_MESSAGE_BYTES`
  (4096) and counts a larger one as a `too_large` strike. Needed because the actor transport delivers parsed
  objects and the platform's own frame cap is Cloudflare's 32 MiB for received WebSocket messages, with no
  smaller cap in Base44's dispatcher or runtime shim (verified 2026-10-03). On the ws path
  `parseClientMessage` has already refused anything larger, so the check is a no-op there.
- `join` before a seat creates the player (`GameRoom.addPlayer`); a second `join` on the same connection is
  ignored. A full room sends `{ t: 'error', reason: 'room_full' }` then `close('room_full')`.
- `input`, `shoot`, `throw` without a seat are dropped; `ping` is answered with or without a seat (§18.2). Messages from an unregistered connection are ignored.
- `requestRejoin()` sends `{ t: 'rejoin' }` to every seatless connection and returns how many were asked.
- Close reasons are stable strings; the transport maps them: ws `1008` (rate_limit, protocol_violations),
  `1013` (room_full); actor `4008` / `4013` (Cloudflare accepts application codes 1000 and 3000-4999 only).

### 17.2 `src/server/protocol.js` — `validateClientMessage(data)`
Object-level entry to the §5 whitelist for transports that already decoded the JSON. Never throws
(`bad_shape` on anything unexpected). `parseClientMessage(raw)` is now `size check → JSON.parse →
validateClientMessage`; its behaviour and reasons are unchanged. On the actor path the byte cap is applied
by `MatchSession` after the fact (§17.1); `ws` keeps `maxPayload`.

### 17.3 `base44/actors/Match/` — the actor
- `entry.ts` default-exports `class Match extends Actor` with `tickIntervalMs = 1000 / TICK_RATE` and delegates
  every hook to `matchHost.js`. `shouldTick()` is `playerCount > 0` (the platform also requires a live socket).
- **Event-driven clock (D-018).** The managed ticker is declared but never relied on: in the deployed actor
  `handleTick` was observed not to fire (2026-10-03). Instead every hook (`handleStart`, `handleConnect`,
  `handleMessage`, `handleClose`, `handleTick`, `handleWake`) ends in `MatchHost.advance()`, which samples
  `now()` and runs the simulation steps due since a fixed anchor: `floor((now - anchor) / TICK_MS)` minus the
  steps already run, at most `MAX_CATCHUP = 3` per event; when more are due the remainder is dropped and the
  clock re-anchors to `now` (the same rule as the platform `TickLoop`). The first step of a room that just got
  its first seated player runs at once, so the first `snap` leaves with the `welcome`: the anchor is the wall
  time of that first event itself and the step count starts at -1. The arithmetic only ever divides a small
  difference of two clock readings; it must never subtract `TICK_MS` from an epoch-size reading, because at
  1.7e12 ms a double carries about 0.0002 ms and `(now - (now - 33.333)) / 33.333` rounds below 1, which lost
  the first step in production while every test at `now = 1_000_000` passed (2026-10-03). Clock tests run at
  an epoch-size `now` for that reason. An empty room resets the anchor, so the next first player never pays a
  catch-up for idle time. The managed `handleTick`, if it ever runs, goes through the same gate and cannot
  double step.
- **Idle heartbeat.** While `shouldTick()` is true the actor keeps one platform schedule armed
  (`this.schedule("clock", now + CLOCK_WAKE_MS)`, `CLOCK_WAKE_MS = 500`), delivered through `handleWake`.
  Active play never needs it (each player's `input` message advances the room, 60 Hz per player); it bounds how
  long a room with only idle players stands still (respawn timers, grenade fuses). Schedules are Durable Object
  alarms: they survive hibernation and cost two storage writes per arm, which is why the period is coarse and
  re-arming only moves the one key.
- **Hook guards.** The runtime shim swallows an exception thrown by a hook and skips the rest of that hook, and
  actor console output is not reachable from outside the platform. Every hook body in `entry.ts` therefore runs
  under `guard(hook, conn, fn)`: a throw is passed to `MatchHost.fail(hook, err, conn)`, which logs it (`error`
  level) and sends the affected connection `{ t: "error", reason: "internal", hook }`. The client shows
  "Server error" for any `error` frame it does not know. Only in a diagnostics room does the frame also carry
  the error `name` and `message` (and the log line the stack). A failed `schedule` call is reported the same
  way and the clock is re-armed on the next event.
- **Diagnostics gate.** Diagnostics are on for a room whose id starts with `diag-` (`isDiagRoom` in
  `src/shared/constants.js`, evaluated once per object from `instanceId`) and off everywhere else. The gate is
  the room id, not an app secret, because the platform uploads no app secret to a deployed actor: an actor's
  environment holds only its configuration strings and its connection keypair (platform actors design doc,
  read 2026-10-03), so a secret-based switch can never turn on in production. The lobby never produces a
  `diag-` id, and a diagnostics room exposes nothing the actor does not already hold in plain memory: clock
  numbers, hook counters, the last error's name and message. Anyone may open one; it is a room like any other,
  rate limited and striked the same way.
- **Diagnostic probe.** In a diagnostics room, a client message `{ t: "diag" }` is answered, before protocol
  validation, with `{ t: "diag", now, anchorAt, stepsSinceAnchor, tickMs, maxCatchup, playerCount, lastFail,
  build, hooks, clockArmed }`: the clock internals (`MatchHost.probe`), the last error reported through `fail`
  (`{ hook, name, message, at }` or `null`), the `ACTOR_BUILD` marker from `entry.ts` (a hand-bumped string,
  the only way to read back which code a live object runs after a Publish), how many times each hook ran
  since the object was created (`hooks`, including `tick` and `wake`, so a silent ticker or alarm is visible),
  and whether a heartbeat is armed. The probe does not advance the clock, so two probes some milliseconds
  apart show whether the object's wall clock moves between messages. In any other room `{ t: "diag" }` is an
  unknown message type and earns a protocol strike like any other. `scripts/actor-probe.mjs` sends it from Node over the SDK with the
  direct transport a browser uses (see `docs/LIVE_TESTING.md`).
- `handleStart` runs on every wake. A hibernation wake keeps sockets attached without `handleConnect`, so
  `MatchHost.wake(conns)` re-registers them and calls `requestRejoin()`; the client answers with a new `join`
  and gets a new `welcome` (a new id, a fresh spawn: match state is not persisted in this slice).
- `server/` and `shared/` inside the actor folder are **generated** copies of `src/` made by
  `node base44/tools/sync-actor.mjs`; `tests/unit/actorBundle.test.js` fails when they differ, when a file
  imports anything but `./`, `../` or `base44:runtime/actors`, when `Deno.*` appears, or when a helper is
  named `entry`.
- Room id: `?room=<id>` on the page URL, `^[A-Za-z0-9_-]{1,64}$`, default `arena-1`.
- Placement: the platform resolves a room with `idFromName(room)` and no location hint or jurisdiction
  (bundler `actor-compat.ts`, verified 2026-10-03). Cloudflare therefore creates the object close to the
  **first** `get()` for that id and does not move it afterwards. A room id is pinned for life to the region of
  its first ever joiner; a lobby must put the region in the id (for example `eu-arena-1`) rather than reuse
  one global name.

### 17.4 `src/client/netActor.js` — `ActorNetwork(handlers, { appId, roomId })`
- Same handler contract as `Network` (§12 client side). Chosen by `game.js` when `VITE_BASE44_APP_ID` is set
  (set by the Base44 build environment: the app sandbox exports it, `base44 build` derives it from `BASE44_APP_ID`);
  otherwise the raw `/ws` transport is used.
- Connection id: one per tab (`sessionStorage`, key `bca.connectionId`, `^[A-Za-z0-9_-]{1,64}$`), so a reconnect
  reclaims the same server-side connection and two tabs never share one.
- New client handlers: `rejoin` (re-send `join` with the stored name, drop the old id and pending commands),
  `stale` (no message for `STALE_MS = 5000` while seated → HUD notice; the SDK reconnects by itself).
- The client never learns about a close: the SDK heartbeats (1 s) and redials with backoff.

### 17.5 What the platform owns on this path (not re-implemented)
Origin check and connection tokens (minted per connection by the SDK), the per-actor connection-attempt rate
limit (300 per 60 s per actor script), reconnect supersede (a returning connection id replaces a stale socket
without a `handleClose`), hibernation and eviction, object placement (§17.3). The per-IP connection cap of
§12 has no equivalent; the 16-player room cap, the per-connection budget and the 4 KB message rule (re-applied
in §17.1) remain the in-room limits. Not owned by anyone below 32 MiB: the inbound frame size, which is why
§17.1 measures it.

## 18. Phase 1 netcode (Batch 2)

### 18.1 `base44/actors/Match/clockSource.js`: `ClockSource({ wall, aheadToleranceMs, maxClientStepMs })`
Why: on the deployed actor (build 1.3, 2026-10-03) `Date.now()` was frozen across incoming WebSocket messages
(two diag frames 400 ms apart, 117 messages in between, identical `now`), `handleTick` never fired and the
500 ms schedule did not wake the object within 12 s. The event-driven clock of §17.3 was correct and had no
time to read: one snapshot per connection, then nothing. Worse, `TokenBucket` refills from the same frozen
clock, so a 60 Hz input stream was cut by `rate_limit` after `BUCKET.capacity` messages.

`MatchHost` now takes `clock` (a `ClockSource`) and reads `now()` from it. Candidates, all in ms:
- `wall`: `Date.now()` as the runtime reports it. May be frozen.
- `ioWall`: `Date.now()` recorded by the actor after awaited I/O (`recordIoWall`). Build 2.0 sampled it
  after an awaited `storage.get` on every message; live (diag-live-4, 2026-10-03) it advanced only during
  connection setup, exactly like `wall`, so build 2.1 removed that read. The candidate and its API stay for
  any future I/O point that turns out to move the clock.
- `clientClock`: every `input` message may carry `ts`, the client's `Date.now()` (`game.js` stamps it;
  §7 accepts a finite number >= 0 and drops anything else without failing the message). Per connection the
  first stamp anchors a virtual clock at the current chosen time (client skew is irrelevant); each later
  stamp advances it by `min(ts - lastTs, MAX_CLIENT_STEP_MS = 100)`, never backwards. The candidate is the
  fastest connection. While the server clock (`wall` or `ioWall`) is alive, meaning it advanced within the
  last `SERVER_ALIVE_WINDOW_MS = 1000` of client time (measured on the client candidate; a move seen before
  any connection existed starts its window at the first connection's anchor), the candidate may lead
  `max(wall, ioWall)` by at most `CLOCK_AHEAD_TOLERANCE_MS = 250`, which bounds a speed hack to that lead.
  A server clock still for longer than the window counts as frozen and the client clock drives on its own,
  bounded by `MAX_CLIENT_STEP_MS` per message and the §7 input rate limit (about 6x real time at most for a
  forged stream). When the server clock moves again the clamp re-arms; the chosen time never drops. Why the
  window (build 2.0 live, 2026-10-03): `wall` advanced 4 to 5 times during connection setup and then froze;
  a clamp armed for good by that first movement held the room at 15 steps (16 snapshots in 12 s). A closed
  connection stops contributing (`removeConnection`).
- `timerTick`: a counter bumped by a `setTimeout` chain in `entry.ts` (`TIMER_EVIDENCE_MS = 1000`, at most
  `TIMER_EVIDENCE_MAX = 600` fires per object lifetime). Evidence only: it never drives the chosen time.

`now()` returns `max(previous, best candidate)`: monotonic whichever candidate wins. `probe()` returns
`{ candidates: { wall, ioWall, clientClock, timerTick }, advances: { same keys, how often each moved },
connections, serverAlive, chosen, source }` where `source` names the candidate that last moved the chosen time
and `serverAlive` says whether the lead clamp is currently armed. The diag
frame of §17.3 carries it as `clock`, and `now` in that frame equals `clock.chosen`.

`MatchHost.message` records the stamp before `MatchSession.message` so the token bucket refills from the
advanced time; `MatchHost.close` drops the connection from the clock. Tests: `tests/unit/clockSource.test.js`
(frozen everything; moving wall; ioWall drives and never goes backwards; 60 Hz client deltas; 10 s jump clamped
to one step; backwards and non-numeric stamps ignored; fastest connection wins and removal keeps monotonicity;
tolerance clamp while the server clock is alive; a server clock that moved at setup and froze releases the
client clock after the window; a moving server clock keeps the clamp; a resuming server clock re-arms it
without a drop; timerTick counted and never chosen), `tests/unit/matchHost.test.js`
(stamped inputs on a frozen clock produce snapshots and the probe's `clock` block; unstamped inputs never step
and never throw), `tests/unit/protocol.test.js` (`ts` validation).

Live check: `ACTOR_BUILD = "2.1"`. `npm run actor-probe -- <app-id> diag-live-5 12 --inputs --diag` must
report `snaps` near 30 per second (build 2.0: 16 in 12 s), `clock.source: "clientClock"`, `serverAlive: false`
once the setup movement is more than a second behind, and `stepsSinceAnchor` growing between the two diag
frames. The probe stamps its inputs like `game.js`, so the Node probe exercises `clientClock` on its own.

### 18.2 Clock sync: `ping` / `pong` and `src/client/clockSync.js`
Why: lag compensation (18.6) rewinds the room to the time the shooter saw, and the shooter can only name that
time in room time. 18.1 made the room clock move; 18.2 gives every client an estimate of it, and a measured
RTT for the HUD and the probe.

Wire format. The client sends `{ t: 'ping', id, ts }` (`id` counts up from 0 per connection, `ts` is the
client's `Date.now()`; §7 validates both). The session answers `{ t: 'pong', id, ts, now }` on the same
connection: `id` and `ts` echoed unchanged, `now` the room clock as the session sees it (`Date.now()` on the
Node server, the `ClockSource` chosen time on the actor, §18.1). A `ping` is answered with or without a seat,
so a client can measure before its `join` completes. On the actor the ping's `ts` also feeds the ClockSource
exactly like an input stamp (`MatchHost.message`), so an idle client still moves the room clock once a second.

Per-connection clamp (`PING_MIN_INTERVAL_MS = 400` and `answerPing(state, msg, now, send)`, exported from
`matchSession.js`; `MatchSession` and the ws path in `server.js` both call it, so the Node server and the
actor apply one rule). A ping is dropped,
silently and without a strike, when it arrives within the interval of the previous accepted ping on both the
server clock and the client's own stamps. Both, because a frozen server clock (§18.1) would otherwise block
every ping after the first; a client that forges its stamps to beat the clamp is still bounded by the token
bucket of §8 and §17.1, and a `pong` costs about 60 bytes. Pings still cost a bucket token like every message.

Client (`src/client/clockSync.js`, pure, no DOM, unit tested in `tests/unit/clockSync.test.js`):
- `new ClockSync({ intervalMs = PING_INTERVAL_MS (1000), samples = CLOCK_SAMPLES (8), timeoutMs = PING_TIMEOUT_MS (5000) })`.
- `nextPing(now)`: the `{ t: 'ping', id, ts: now }` to send when at least `intervalMs` passed since the previous
  one (the first call always sends), otherwise `null`. Outstanding pings older than `timeoutMs` are forgotten.
- `onPong(pong, now)`: validates the shape and that `id` is outstanding with the echoed `ts`, computes
  `rtt = now - ts` and `offset = pong.now + rtt / 2 - now`, keeps the newest `samples` samples, returns the
  sample, or `null` for anything unknown, duplicated or malformed.
- `rtt` (latest sample), `jitter` (max minus min RTT over the kept samples), `offset` (the offset of the
  lowest-RTT kept sample: the sample least smeared by queueing), `synced` (at least one sample),
  `serverTime(now) = now + offset` (`null` while unsynced), `stats()` for display and the probe.
- `game.js` owns one `ClockSync`, calls `nextPing(Date.now())` every frame while seated and sends the result,
  routes `pong` into `onPong`. The FPS readout (§19.2) shows `NN FPS · RR ms` once synced; `debugState()`
  carries `rtt` and `clockOffset`. Nothing else consumes the estimate yet: 18.6 does.

Probe: `npm run actor-probe -- <app-id> [room] [secs] --ping` sends a ping per second through the same
`ClockSync` and reports `pongs`, `rttMs { p50, max }` and `clockOffsetMs` in the summary.

Tests: `tests/unit/protocol.test.js` (ping shape, `bad_ping`), `tests/unit/matchSession.test.js` (pong echoes
`id` and `ts` with the injected clock's `now`; answered before `join`; a second ping inside 400 ms on both
clocks is dropped without a strike; a ping inside 400 ms of server time but 1000 ms of client time is
answered; no bucket bypass), `tests/unit/matchHost.test.js` (ping stamps advance the ClockSource on a frozen
runtime), `tests/unit/clockSync.test.js` (interval gating, sample math, lowest-RTT offset, unknown and stale
pongs ignored, timeout, serverTime), `tests/unit/actorProbeArgs.test.js` (`--ping`).

Live check: `ACTOR_BUILD = "2.2"`. `npm run actor-probe -- <app-id> diag-live-6 12 --inputs --ping` must report
`pongs` near 12 and an `rttMs.p50` in the same range as the snapshot gap percentiles.

Not started in this batch: 18.3 delta snapshots, 18.4 reconnect tokens, 18.5 blended reconciliation,
18.6 lag compensation rewind.


## 19. Design and HUD (Batch D1)

Client-only UX, HUD, theme system, menu skin, arena visual pass, and touch layout resolution.

### 19.1 In-match HUD
- Pure HUD state derivation lives in `src/client/hudModel.js` (unit tested in `tests/unit/hudModel.test.js`):
  - `deriveHealthSegments(hp, maxHp, segmentsCount)`: health percentage and an array of fill ratios for the segment bar.
  - `deriveAmmoStatus()`: weapon status object `{ text: "INF", status: "READY" }` (infinite ammo until the weapons table in Phase 2).
  - `calculateDamageAngle(player, yaw, attacker)`: screen angle of the attacker in radians, clockwise from the top (0 ahead, +PI/2 right, PI behind). The camera looks down -Z at yaw 0 and +yaw turns left (`src/shared/movement.js`, `aimDir` in `src/shared/hitscan.js`), so the relative angle is `atan2(dx, -dz) + yaw`.
  - `attributeDamage(threats, now, windowMs)` and `pruneThreats(threats, now, windowMs)`: damage attribution, see below. `DAMAGE_ATTRIBUTION_MS = 300`.
  - `KillFeedQueue`: queue capped at 5 entries with 5000 ms auto-expiry.
  - `deriveRespawnText(alive, now, deathTime, respawnMs)`: centered countdown string (`Respawning in X.Xs...`) while dead, `null` while alive.
  - `deriveTeamColor(playerId)`: `even` (blue) or `odd` (red) by player ID parity. Visual only until Phase 2 TDM assigns real teams.
  - `sortScoreboardPlayers(players)`: kills descending, then deaths ascending, then ID ascending.
- Damage attribution. The server never tells the victim who hit them (`hit` and `verdict` go to the shooter only); the victim only sees its own `hp` drop in the next snapshot. The client keeps a list of threats from messages every client already receives: the `from` origin of each remote `shot` and the `at` point of each `boom`. When the local `hp` drops between two snapshots, the newest threat inside `DAMAGE_ATTRIBUTION_MS` is taken as the attacker position and the directional indicator rotates to `calculateDamageAngle(me, yaw, threat)`. With no threat inside the window only the non-directional vignette shows. This is a client-side heuristic that can mis-attribute when two players fire inside the same 300 ms window; it never affects gameplay (the server stays authoritative) and it adds no client-reported data. A server-side `attacker` field on a victim-facing message is the Phase 2 upgrade if the heuristic proves too loose in play.
- Rendering contract (`index.html`, `src/client/hud.js`, `src/client/combatHud.js`, `src/client/style.css`). `hud.js` is thin DOM glue over `hudModel.js`; every string that originates from another player goes through `textContent`.
  - `#status` (bottom left): `#hp` holding `#hp-bar` with 5 `.hp-segment` elements whose `.hp-segment-fill` is scaled by the fill ratio (`transform: scaleX`), plus `#hp-value` (rounded HP) and the `HP` unit. `#hp.low` is set at `hp <= 25` and turns the segments to `--danger`. `#ammo` holds the weapon label and `#ammo-value` (`INF / READY`).
  - `#crosshair`: centered. `.expanded` for `HUD_TIMING.fireExpandMs` (100 ms) on each local shot. `.hit` (body, 150 ms) and `.head` (headshot, 150 ms, scaled and rotated 45 degrees) come from the shooter's `verdict` via `combatHud.js`.
  - `#hit-info`: hit feedback text below the crosshair (`HEADSHOT 25 · KILL`, `BODY 22`), `.show` for 700 ms.
  - `#damage-flash`: full-screen red vignette, `.show` for `HUD_TIMING.damageFlashMs` (250 ms) on every local hp drop.
  - `#damage-indicator`: arrow on a ring around the crosshair, rotated by the attributed angle, `.show` for `HUD_TIMING.damageIndicatorMs` (500 ms); only when a threat was attributed.
  - `#feed` (top right): kill feed rendered from `KillFeedQueue` (max 5, 5000 ms expiry), one row per entry, re-rendered only when the entry count changes or a new kill arrives.
  - `#dead`: centered respawn overlay with the `deriveRespawnText` countdown; the death time is the local time of the first snapshot with `alive: 0`.
  - `#scoreboard`: grid rows (`.row`, header `.row.head`) with columns `.col-chip`, `.col-name`, `.col-k`, `.col-d`; the local player's row is `.row.me`; the team chip is `.chip.team-even` / `.chip.team-odd` (colors from `--team-blue` / `--team-red`). Toggled by Tab (desktop) or the `#touch-score` button (touch mode). Rendered only while visible.
  - All colors come from the theme CSS variables of 19.2 (fallbacks mirror `PALETTE`). The short-landscape media query (phones) shrinks the status block, the ring and the kill feed and keeps them clear of the safe-area insets.
- Not in this batch: weapon names and ammo counts beyond `INF / READY` (Phase 2 weapons table), real team assignment (Phase 2 TDM), a server-side attacker field.

### 19.2 Menu and lobby skin (`src/client/theme.js`)
- Theme tokens exported from `src/client/theme.js` as JS constants (palette, spacing, typography) and injected as CSS variables (`:root`).
- Dark launcher styling for `#menu`: centered card, accent highlights, muted secondary text.
- Settings panel (`#settings`, toggled by the gear button `#settings-open`, DOM glue in `src/client/settingsPanel.js`,
  values in `src/client/settings.js`) containing:
  - Mouse sensitivity slider (`localStorage` key `bca.sensitivity`, default 0.0022, clamped to [0.0005, 0.01], shown
    as rad per 1000 px, applied to `Input.sensitivity` on the next mouse move).
  - Touch controls three-way radio (`Auto` / `On` / `Off`, `localStorage` key `bca.touchControls`); a change
    re-resolves the device mode at once (`Game.updateTouchMode`), also mid-match, without a reload.
  - Show FPS checkbox (`localStorage` key `bca.showFps`): `#fps` bottom-left, frames per 500 ms window.

### 19.3 Arena visual pass (`src/client/arenaStyle.js`, `src/client/scene.js`, `src/client/remote.js`)
Rendering only; no game rule changes. The numbers live in `arenaStyle.js` (pure, unit tested); `scene.js` and `remote.js` turn them into Three.js objects.
- Renderer: ACES filmic tone mapping (exposure 1.15), PCF soft shadow maps. Shadow map 2048, or 1024 when the viewport is a phone (`shadowMapSizeFor(w, h)`: height <= 500 or width < 1000).
- Sky: inverted sphere (radius 240) with vertex colors from `skyColorAt(h)`, horizon `0x0f172a` to zenith `0x070a16`, smoothstep eased. Vertex colors are converted from sRGB like a material color so the horizon matches the fog. `scene.background` is the horizon color.
- Fog: `THREE.Fog(0x0f172a, 35, 140)`; `FOG.color === SKY.horizon`, `FOG.far >= MAP.half * 2`.
- Lights: hemisphere `0x9db1dc` / `0x2a3140` at 1.0; warm sun `0xffe3c2` at 1.9 from `[28, 46, 18]` casting shadows (ortho shadow camera +-46, covers the arena and its walls); cool fill `0x8fa6ff` at 0.7 from `[-24, 20, -30]` without shadows so faces turned away from the sun still read.
- Floor `0x343e4b` roughness 0.92, receives shadows. Grid helper at opacity 0.22 (`0x5a6b80` / `0x3b4858`).
- Boxes: `boxMaterialParams(i)` gives hue 0.58 / saturation 0.14, lightness `0.38 + (i % 4) * 0.05`, roughness `0.55 + (i % 3) * 0.15`, metalness `0.04 + (i % 2) * 0.1`; cast and receive shadows.
- Remote players: `teamColorHex(id)` = `PALETTE.teamBlue` for even ids, `PALETTE.teamRed` for odd ids (parity stands in for teams until Phase 2 TDM). Body, head and visor cast and receive shadows.
- Name tags: `THREE.Sprite` with a `CanvasTexture` per distinct name (cached), `nameTagLayout(name)`: text capped at 16 code points (`?` when empty), 48 px tall canvas, width from the text, world height 0.36 with the canvas aspect, placed at y 2.05. The name is drawn with `fillText`, never inserted into the DOM. The tag follows the player's `name` in the snapshot and is rebuilt when it changes.
- Vignette: `#vignette`, a fixed `radial-gradient` overlay under the HUD (`pointer-events: none`).
- Verification: `tests/unit/arenaStyle.test.js`; a headless Chrome render with two bots in view at 1280x720 and 844x390 shows lit boxes, shadows, both team colors and the name tag.

### 19.4 Mobile touch controls resolution (`src/client/deviceMode.js`)
- `resolveDeviceMode({ override, hasTouch, coarsePointer, userAgentMobile })`:
  - `override === 'on'` -> `'touch'`
  - `override === 'off'` -> `'desktop'`
  - `override === 'auto'` or invalid -> `'touch'` iff `hasTouch && (coarsePointer || userAgentMobile)`.
- Touch controls in `src/client/touch.js` render only when `isTouchDevice()` (which is
  `resolveDeviceMode(...) === 'touch'` with `hasTouch = navigator.maxTouchPoints > 0 || 'ontouchstart' in window`,
  `coarsePointer = matchMedia('(pointer: coarse)')`, `userAgentMobile` from the user agent) holds. `enable()` on a
  desktop-mode device is a no-op that hides the controls; `updateMode(inGame)` re-applies after an override change.
- Safe-area insets (`env(safe-area-inset-*)`) applied to touch controls and HUD.
- HUD font sizes scale with `clamp()` on viewport width.
- Landscape hint overlay (`#rotate`) shown in portrait touch mode.


## 20. Weapons (Batch 3a, D-019)

`src/shared/weapons.js` is the table and the per-player state machine, pure and deterministic (time arrives as `nowMs`, randomness as the injected `random`). The server alone decides whether a shot happens; the client reads the table for the interval it uses to pace its `shoot` intents and for cosmetic recoil.

### 20.1 Table (`WEAPONS`)
Bands use the `combat.js` shape `{ below, damage }` so `bandDamage` and `shotDamage` apply unchanged; `range` equals the last band's `below`. The rifle is the Milestone 1 weapon (`RIFLE` in `combatData.js`): same interval, same bands.

| id | slot | fireIntervalMs | magSize | reserve | reloadMs | switchMs | pellets | spreadBase | spreadPerShot | spreadDecayPerMs | spreadMax | recoilPitch | recoilYaw | bands (below: damage) |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| rifle | primary | 150 | 30 | 90 | 2000 | 400 | 1 | 0 | 0.006 | 0.00005 | 0.06 | 0.02 | 0.005 | 20: 25, 40: 22, 120: 18 |
| smg | primary | 90 | 35 | 105 | 1600 | 300 | 1 | 0.012 | 0.006 | 0.00006 | 0.08 | 0.012 | 0.008 | 12: 18, 25: 14, 60: 9 |
| shotgun | primary | 800 | 8 | 32 | 2500 | 500 | 8 | 0.08 | 0.02 | 0.00004 | 0.12 | 0.06 | 0.015 | 10: 12, 20: 7, 35: 3 |
| sniper | primary | 1200 | 5 | 20 | 3000 | 600 | 1 | 0.001 | 0.05 | 0.00003 | 0.10 | 0.08 | 0.002 | 50: 85, 100: 75, 200: 65 |
| pistol | sidearm | 220 | 12 | 48 | 1400 | 250 | 1 | 0.006 | 0.012 | 0.00007 | 0.05 | 0.025 | 0.004 | 15: 22, 30: 16, 70: 10 |

Spread is a cone half-angle in radians. A rifle spread of 0 on the first shot keeps the Milestone 1 tests exact: one shot per interval decays fully (0.006 grows, 0.0075 decays per 150 ms).

### 20.2 State machine
- Weapon state: `{ id, mag, reserve, spread, reloadingUntil, lastShotAt }`. Loadout: `{ active: 'primary' | 'sidearm', primary, sidearm, switchingUntil }`; `newLoadout()` is a full rifle in hand and a pistol holstered (`DEFAULT_LOADOUT`).
- `fireBlock(loadout, nowMs)` returns `null` or the reason, checked in this order: `switching`, `reloading`, `empty`, `interval`. `canFire` is `fireBlock === null`.
- `recordShot(ws, nowMs)`: `lastShotAt = nowMs`, `mag -= 1`, `spread = min(spreadMax, spread + spreadPerShot)`. `decaySpread(ws, dtMs)` moves spread back toward `spreadBase`.
- `startReload(loadout, nowMs)`: only when not switching, not reloading, mag below magSize and reserve above 0; sets `reloadingUntil = nowMs + reloadMs`. `finishReloadIfDue(ws, nowMs)` moves `min(magSize - mag, reserve)` rounds on the first tick at or after `reloadingUntil`.
- `switchSlot(loadout, slot, nowMs)`: refused for an unknown slot, the slot already in hand, or while switching; cancels a reload in progress (rounds stay in the reserve) and sets `switchingUntil = nowMs + switchMs` of the weapon now in hand.
- `spreadDir(dir, spread, random)`: a unit direction inside the cone; spread 0 returns `dir` untouched and consumes no randomness.
- `addReserve(ws, rounds)` caps the reserve at twice the table value (pickups, Batch 3b).

### 20.3 Messages (extends section 7)
- `{ t: 'reload' }` and `{ t: 'switch', slot: 'primary' | 'sidearm' }`; any other slot fails with `bad_switch`. Both are intents: the room applies them on its next tick through the state machine, dead players are ignored, and the respawn hands out a fresh `newLoadout()`.
- `shot` gains `w` (weapon id). A shotgun broadcasts one `shot` per pellet.
- Per trigger pull: one ray per pellet, each with its own spread sample from the room's `random`; damage is summed per victim and applied once; one `hit` per victim; one `verdict` naming the victim who took the most damage (zone and distance of the first pellet that reached them).

### 20.4 Snapshot fields (extends section 7)
Every player entry gains `w` (weapon id in hand), `m` (magazine), `r` (reserve), `rel` (1 while reloading). They are public: the information is scoreboard-sized.

### 20.5 Client
- Keys: `R` reload, `1` primary, `2` sidearm, mouse wheel toggles the slot; touch buttons `touch-reload` and `touch-swap`.
- `#tryFire` paces `shoot` intents with the in-hand weapon's `fireIntervalMs` (from the snapshot `w`), kicks the aim by `recoilPitch` and a random yaw within `recoilYaw`, and recovers 70 percent of the kick over the next frames.
- HUD: `deriveAmmoStatus(me)` gives `{ weapon, text: 'mag / reserve', status }` with status `READY`, `LOW` (mag at or below 20 percent), `EMPTY`, `DRY` (no reserve), `RELOADING`; without weapon fields it falls back to `INF / READY`.

### 20.6 Tests
`tests/unit/weapons.test.js` (table and state machine), `tests/unit/gameRoomWeapons.test.js` (room: magazines, reload, switch, pellets, snapshot, respawn), `tests/unit/protocol.test.js` (intent whitelist), `tests/unit/hudModel.test.js` (readout).

## 21. Pickups, spawn selection and spawn protection (Batch 3b, D-020)

Numbers live in `src/shared/rules.js` (`SPAWN`, `PICKUP`, `PICKUP_TYPES`), shared so the client shows the same values.

### 21.1 Pickups (`src/shared/pickups.js`)
- Spots are map data: `MAP.pickups = [{ type, x, z, y? }]`; `buildPickups` validates the list once (unknown type or non-finite coordinates are dropped) and gives each spot an index `i`. The arena has 9 spots: sniper on the centre platform (y 2), health at the mid lanes and one corner, ammo beside the cover and one corner, SMG and shotgun in opposite corners.
- Types: `health` (+50 hp up to `MAX_HP`, back after 20 s), `ammo` (one magazine of the weapon in hand added to its reserve, capped by `addReserve`, back after 15 s), `smg` / `shotgun` (replace the primary with a full one, 30 s), `sniper` (45 s).
- Reach: horizontal distance from the player's feet to the spot at most `PICKUP.radius` (1.2) and a vertical difference at most `PICKUP.heightTolerance` (1.5).
- Each tick (`stepPickups`), after respawns: for every available spot, the first living player in reach who would gain something takes it; a player who gains nothing (full hp, full reserve, identical full weapon) leaves it. The spot becomes available again at `now + respawnMs`.
- Messages: `welcome` gains `pickups: [{ i, type, x, y, z }]`; `snap` gains `items: [i, ...]` (indices available now); the taker receives `{ t: 'pickup', i, kind: 'health' | 'ammo' | 'weapon', amount, weapon? }`.
- Client (`src/client/pickups.js`): spinning, bobbing marker per spot (cross for health, box for ammo, gun silhouette for weapons) over a ground ring; hidden while taken; the kill feed shows `+30 health`, `+12 ammo`, `Picked up Shotgun`.

### 21.2 Spawn selection and protection (`src/shared/spawning.js`, `SPAWN`)
- `pickSpawn(spawns, enemies, random)`: with no living enemy the Milestone 1 rule stands (`spawns[floor(random() * n)]`, every index reachable); otherwise the spawn whose nearest living enemy is farthest wins, ties broken by `random` among the tied. Used for the first placement and every respawn.
- A respawned player is protected for `SPAWN.protectMs` (2000 ms): bullets and blasts apply 0 damage (the shooter's verdict says `dmg: 0`), and the protection ends early the moment the protected player fires. The first spawn after joining is not protected (it is already the safest spot and the player has not been in a fight). Snapshot entries gain `sp` (1 while protected).

### 21.3 Tests
`tests/unit/pickups.test.js` (spots, heal cap, ammo and weapon swaps, reach, one taker per tick, spawn choice), `tests/unit/pickupsClient.test.js`, and the respawn and protection cases in `tests/unit/gameRoom.test.js`.

## 22. Match modes: deathmatch and team deathmatch (Batch 3c, D-021)

`src/shared/modes.js` holds the mode table and the match state machine, pure (time arrives as `nowMs`).

### 22.1 Modes
| id | name | teams | timeLimitMs | scoreLimit |
|---|---|---|---|---|
| dm | Deathmatch | no | 300000 | 25 kills by one player |
| tdm | Team Deathmatch | Blue (0) / Red (1) | 480000 | 50 team kills |

`GameRoom` takes `mode` as a constructor option (default `dm`); an unknown id throws `RangeError` before anyone joins. `room.mode` and `room.matchState` expose it for lobbies and tests.

### 22.2 State machine
- Phases: `waiting` (empty room), `playing`, `ending`. The first join starts the match (`startMatch`: timer, scores reset, match number + 1). When the last player leaves the room goes back to `waiting`.
- Teams: a joining TDM player goes to the smaller team, ties to Blue; DM players have team -1. `welcome` carries `mode` and `team`; snapshot entries carry `tm`.
- Scoring: a kill on an enemy adds one to the killer's team; a kill on a teammate costs the team one (never below 0); self-kills score nothing. Player kills and deaths keep counting in every mode.
- Friendly fire: bullets and grenade blasts from a teammate apply 0 damage (the shooter's verdict says `dmg: 0`); your own grenade still hurts you.
- End: `endReason` is `time` when `now >= endsAt`, `score` when a DM player or a TDM team reaches the limit, checked once per tick after respawns. `endMatch` broadcasts `{ t: 'matchEnd', reason, winner, ranking, teamScores, number }` where `winner` is `{ type: 'player', id, name }`, `{ type: 'team', team, name }` or `{ type: 'draw' }` (equal top kills and deaths in DM, equal team scores in TDM), and `ranking` is kills desc, deaths asc, id asc.
- End screen: for `ENDING_MS` (8000) nobody can shoot or throw; respawns still happen. Then every player is reset (kills, deaths, hp, loadout, placed on the safest spawn, no protection) and `{ t: 'matchStart', mode, phase, left, ts, number }` is broadcast.
- Snapshot: `match: { mode, phase, left, ts }` with `left` in whole seconds and `ts` the team scores (`null` in DM).

### 22.3 Client
- Top centre: `m:ss` timer while playing and `Blue n  Red n` in TDM (`deriveMatchStatus`).
- `matchEnd` opens the end screen (`Victory`, `<name> wins`, `<Team> team wins`, `Draw`, top three `name k/d`) and the scoreboard; `matchStart` closes both.
- Team colors: `teamColorHex(id, team)` and `deriveTeamColor(id, team)` follow the server team when present (remote bodies, scoreboard chips); DM keeps the id parity two-tone.

### 22.4 Tests
`tests/unit/modes.test.js`, `tests/unit/gameRoomModes.test.js`, the SPEC 22 cases in `tests/unit/hudModel.test.js`.

## 23. Movement set: sprint, crouch, slide, step-up, mantle, wall jump, air control (Batch 3d, D-022)

All in `src/shared/movement.js` (`stepPlayer`, plus `heightOf(p)` and `eyeOf(p)`), deterministic and pure as in section 3. Numbers live in `PLAYER` (`src/shared/constants.js`). `cmd` gains two booleans, `sprint` and `crouch`, parsed with `!!` in `protocol.js` (absent means false). Player state gains `h` (current hitbox height), `slide` (seconds left), `slideDx` / `slideDz`, `wallJumps`, `jumpHeld`, `crouchHeld`; all created on first use so Milestone 1 callers and tests keep working.

### 23.1 Stance
- `crouch` sets the hitbox height to `crouchHeight` (1.2) at once and ground speed to `speed * crouchMul` (0.55). Standing up requires head room for the full `height`; under a low ceiling the player stays crouched.
- `playerBox` (hitscan) uses `heightOf(p)`; `zoneAt` scales the point height by `height / heightOf(p)`, so a crouched head is still a head. `eyeOf(p)` scales `PLAYER.eye` the same way; the server fires and throws from that eye, the client camera follows it (smoothed on the client only).
- Snapshot entries gain `h` (rounded to 3 decimals). Remote bodies are squashed to `h / height`; the name tag follows.

### 23.2 Sprint and slide
- `sprint` with `fwd > 0` (not crouched, not sliding) multiplies ground speed by `sprintMul` (1.35). Sideways or backward input never sprints.
- Slide: on the ground, with `sprint` held and a horizontal input, a fresh `crouch` press starts a slide of `slideTime` (0.7 s): speed starts at `slideSpeed` (11) and decays linearly to crouch speed, the direction is locked to the input at the start, the hitbox is the crouch height. Holding crouch does not re-trigger; a crouch tap without sprint only crouches. A jump ends the slide (the momentum carries into the air).

### 23.3 Step-up and mantle
- Step-up: walking (on the ground) into a box whose top is at most `stepHeight` (0.55) above the feet moves the player onto it when the space above is free, no jump needed.
- Mantle: airborne, moving into a box whose top is at most `mantleHeight` (1.5) above the feet, while `vy <= jump / 2` (past the first half of the rise), snaps the feet to the top with `vy = 0` and `onGround = true`. A taller box is a wall.

### 23.4 Air control
- In the air the horizontal velocity moves toward the wanted velocity (`input * speed`) by at most `airAccel * dt` (30 m/s^2) per step; with no input the momentum is kept. On the ground the Milestone 1 rule stands: velocity equals input times speed, no input stops at once.

### 23.5 Wall jump
- Airborne, pressed against a wall this step (a horizontal move was blocked), a fresh `jump` press (not held from the ground) and `wallJumps > 0`: `vy = jump * wallJumpMul` (0.9) and the velocity on the blocked axis becomes `wallJumpPush` (6) away from the wall. `wallJumpsPerAir` (1) resets on landing.

### 23.6 Client
- Keys: Shift sprint, C or left Ctrl crouch, Space jump (press again on a wall). Touch: RUN toggles sprint, a crouch button holds crouch. The menu hint lists them.

### 23.7 Tests
`tests/unit/movementParkour.test.js` (12 cases: sprint, crouch and head room, zone scaling, slide start / lock / decay / no re-trigger, step-up vs wall, mantle with and without a jump, wall jump and its reset, fresh-press rule, air control, determinism), the SPEC 23 cases in `tests/unit/protocol.test.js`, and the `h` key in the snapshot key lists.

## 24. Kits and abilities (Batch 3e, D-023)

`src/shared/abilities.js` (pure, time and randomness injected). Four kits, two abilities each, slot 0 on Q and slot 1 on E:

| Kit | Slot 0 | Slot 1 |
|---|---|---|
| Vanguard (default) | `dash` 5 s: 0.2 s burst at `PLAYER.dashSpeed` (18 m/s) in the movement direction, else facing | `shield` 12 s: a 3 x 2.2 x 0.3 m wall 1.5 m ahead across the facing axis, 8 s |
| Phantom | `blink` 8 s: 8 m horizontal teleport along the facing, stopped 5 cm short of the first box (box widened by the player radius), clamped to the arena | `decoy` 14 s: a player-shaped marker walking forward at 4 m/s for 6 s, 25 hp, dies on any damage |
| Engineer | `grapple` 7 s: an anchor on the first box along the aim within 25 m (else `no_anchor`, no cooldown); pulled at 16 m/s until within 1.2 m, a jump press, or 1.5 s | `scan` 10 s: enemies within 25 m carry `sc: 1` for 5 s |
| Medic | `heal` 12 s: a 4 m zone for 6 s healing 10 hp/s to the owner (DM) or the owner's team (TDM), capped at `MAX_HP` | `stasis` 15 s: a 6 m field for 6 s; enemies inside have their movement input scaled by 0.5 (server side, sprint off) |

### 24.1 Intents and state
- Join: `{ t: 'join', name, kit? }`; an unknown kit falls back to `vanguard`. `welcome` carries `kit`.
- `{ t: 'ability', slot: 0 | 1 }`: validated in `protocol.js`; the room applies it once per tick in `#stepAbilities` (before weapons and movement) when the match is `playing`, the player is alive and the slot is off cooldown. Success broadcasts `{ t: 'ability', id, ability, slot, cd }`; a refusal is private: `{ t: 'ability', id, slot, denied: 'cooldown' | 'dead' | 'no_anchor' | ... }`.
- `{ t: 'kit', id }`: stored as `nextKit`, applied on the next spawn (and on match restart). Cooldowns survive death and reset on match restart.
- Player state: `kitState { kit, readyAt[2] }`, `nextKit`, `grapple`, `scannedUntil`, `dash`, `dashDx`, `dashDz`.

### 24.2 Dash and prediction
The dash runs inside `stepPlayer` (`p.dash` seconds left, `dashDx` / `dashDz`): velocity is the dash vector at `dashSpeed`, the slide is cancelled, gravity still applies. The recipient's private `self` block carries `dash`, `dashDx`, `dashDz` while active so client prediction replays the same burst.

### 24.3 Effects and combat
The room keeps `#fx` (shields, decoys, heal zones, stasis fields), stepped by `stepEffects` after grenades. Shields are extra boxes for `resolveShot`, `stepGrenade` and `blastDamage` (they block bullets, bounce grenades, stop blast line of sight). Decoys are shot targets with id `-fxId`: pellets that hit one give the shooter a `hit` marker with the negative id and a zero-damage verdict, and the decoy dies. Scanned players are flagged `sc: 1`. The grapple pull is applied before each command (`applyGrapple`), setting the velocity toward the anchor.

### 24.4 Stasis
`slowFactor(fx, p)` is 0.5 for an enemy inside a stasis field. `#runCommands` scales `fwd` and `right` and clears `sprint` on a copy of each command; the client predicts at full speed and reconciles to the server's position (accepted V1 trade-off, documented in D-023).

### 24.5 Snapshot
- Per player: `kt` (index into `KIT_IDS`), `lv` (level), `sc` (scanned).
- Top level: `fx: [{ id, k, o, tm, x, y, z, yaw?, r?, nm?, ttl }]` from `describeEffects`.
- Per recipient `self`: `{ cd: [ms, ms], kit, dash?, dashDx?, dashDz?, grapple?, xp, lvl, offer?, perks? }`. Optional keys are omitted when idle so a full room with 16 grenades stays under 4096 bytes (measured 4040).

### 24.6 Client
Menu kit picker (`kitUi.js`, remembered in `localStorage` key `bca.kit`), Q / E send the ability intent, two ability chips with a cooldown sweep and a red flash on refusal, `effects.js` renders shields (translucent box), decoys (player silhouette in the owner's color), heal and stasis domes. A kit change in the menu while joined sends `{ t: 'kit' }` and prints "kit on next spawn" in the feed. The debug harness exposes `useAbility`, `pickPerk`, `selectKit`.

## 25. In-match progression: XP, levels, perks (Batch 3e, D-023)

`src/shared/progression.js` (pure). Everything resets on match restart.

### 25.1 XP
Kill 100. Assist 50 (anyone else who damaged the victim within 10 s; team mates of the victim excluded). Damage 1 XP per 10 hp applied, capped at 10 XP per victim per life. Levels at 0 / 100 / 250 / 500 / 850 XP (levels 1 to 5). Each award sends `{ t: 'xp', amount, xp, lvl, levelUp?, offer }` to the earner.

### 25.2 Perks
Each level-up offers two distinct perks not yet taken (deterministic from the room's `random`); a second level-up while an offer is open queues the next offer. Perks: `faster_reload` (reload 0.8x), `cooldown` (ability cooldowns 0.8x), `grenadier` (+1 grenade per life), `thick_skin` (damage taken 0.9x), `quick_switch` (weapon switch 0.5x). Multipliers live in `progress.mods` and apply in the room (`#stepWeapons`, `#stepAbilities`, `#fire`, `#stepGrenades`, `#respawn`); nothing touches shared prediction.

### 25.3 Intents
`{ t: 'perk', id }` (string, max 32 chars) picks from the open offer; a pick outside the offer is ignored. Success: `{ t: 'perk', id, perks }`. Client keys 3 / 4 pick the first / second card.

### 25.4 Client
XP bar with level and `xp / next` label under the ability chips; a perk offer card pair at the top while an offer is open; feed lines for level-up and the chosen perk.

### 25.5 Tests
`tests/unit/abilities.test.js` (14: kit table, cooldowns, every ability, stepEffects, grapple, scan, heal, stasis, room welcome and snapshot, intent flow and denial, shield and decoy in the firing path, kit change on spawn and XP), `tests/unit/progression.test.js` (5), `tests/unit/kitUi.test.js` (4), SPEC 24 cases in `protocol.test.js`, snapshot key lists updated.

## 26. Rooms and lobby (Batch 4, D-024)

`src/shared/rooms.js` (pure). A room is one Match actor instance; its id carries the mode.

### 26.1 Room ids
`<mode>-<code>`: mode in `MODE_IDS` (`dm`, `tdm`), code `[a-z0-9]{4,12}`; generated codes are 6 chars from `ROOM_CODE_ALPHABET` (no i, l, o, 0, 1). `arena-1` (the legacy default) and `diag-*` rooms parse as `dm`. `modeForRoomId(id)` is what the actor hands to `GameRoom({ mode })`, so the first joiner's choice binds everyone (`MatchHost` reads it from `instanceId`). `roomIdFromLocation(search)` reads `?room=` and falls back to `arena-1` for anything that is not a room id; `roomLink(origin, id)` is the shareable link.

### 26.2 Registry (entity `Room`)
One row per room, written by the actor's service role on persistence paths only (join, leave, match start, match end; never per tick), coalesced to one write in flight per room (`base44/actors/Match/persistence.js`). Fields: `room_id`, `mode`, `players`, `max_players`, `phase`, `match_number`, `status` (`empty` / `open` / `full`), `last_seen`. RLS: read everyone, write nobody (the service role bypasses RLS). `lobbyRooms(rows, now)` shows `open` rows seen within `ROOM_STALE_MS` (120 s), fullest first.

### 26.3 Hooks
`GameRoom({ hooks })`: `roster({ players, maxPlayers, phase, matchNumber, nowMs })` after join, leave, match start and match end; `matchEnd({ result, players, mode, nowMs })` after the `matchEnd` broadcast. A throwing hook is logged and ignored; the simulation never waits on a write.

### 26.4 Client
Menu (actor transport only; the Node dev server shows "Local server: one room, no sign-in" and hides the lobby): mode select, Quick Play (`quickPlayRoom`: the fullest open room with space in that mode, else a new room), Create room (new code), Join by room id or link (`resolveJoinInput`), the open-room list (click to join), refreshed every 5 s from `entities.Room.list('-players', 50)`. Picking a room writes `?room=<id>` with `history.replaceState` and submits the menu. The HUD match bar shows the room id (hidden for `arena-1`).

## 27. Sign-in binding and persistence (Batch 5, D-024)

### 27.1 Identity
`wrapConn` exposes `userId` only when `conn.identity.type === 'authenticated'`; `MatchSession` passes it to `addPlayer({ userId })`, never from the join payload. Anonymous players play normally and get no persistent stats.

### 27.2 Entities
- `PlayerStats` (keyed by `user_id`): `name` (last callsign), `kills`, `deaths`, `xp`, `matches`, `wins`, `best_kills`, `last_played`. Merged per match with `mergeStats` (totals add, `best_kills` is a max).
- `MatchResult`: `room_id`, `mode`, `match_number`, `reason`, `winner { type, name?, team? }`, `team_scores`, `players [{ name, user_id, kills, deaths, team, xp, level }]`, `ended_at`.
- Both RLS read everyone, write nobody. Schemas in `base44/entities/*.jsonc`; they reach the app with `base44 entities push` (or `base44 deploy`), which is an owner action like the actor deploy.

### 27.3 Writes
`Persistence.matchEnd` creates the `MatchResult`, then for each signed-in player reads the `PlayerStats` row by `user_id` and updates or creates it. Failures are logged per record; nothing propagates to the room. A win is by player id in DM and by team in TDM; a draw wins for nobody (`playerWon`).

### 27.4 Client
Account line from `auth.me()` with Sign in (`auth.redirectToLogin(href)`) / Sign out; the callsign defaults to the user's name. Leaderboard: top 10 `PlayerStats` by kills, wins, then fewer deaths (`leaderboard`), refreshed with the room list.

### 27.5 Tests
`tests/unit/rooms.test.js` (4), `persistence.test.js` (5, including the room hooks), `persistenceActor.test.js` (3: identity mapping, a `tdm-*` instance runs TDM and writes registry, result and stats through a fake service-role client, a failing write never reaches the room), `lobby.test.js` (2). `netActor.test.js` updated to the room grammar.

## 28. Content: maps, avatars, sound (Batch 6, D-025)

### 28.1 Map registry and rotation
`src/shared/maps.js`: `MAPS` = `arena` (the original `MAP`), `foundry` (two raised decks joined by a bridge over a sunken lane, half 36), `crossfire` (a plus of 4 m walls splitting the floor into four rooms around an open hub, half 40). Each map: `{ id, name, half, boxes, spawns, pickups }` with 8 spawns and 9 pickup spots including one sniper and at least two health. `mapForMatch(number)` rotates in registry order starting at `arena` for match 1; an empty room resets to match 0, so a fresh room always opens on Arena. `GameRoom` keeps `#map`, feeds its boxes / half to movement, hitscan, grenades, abilities, effects and spawns, and switches map (`#switchMap`) before the restart respawns so players land on the new map; pickups and grenades are rebuilt. `welcome.map` and `matchStart.map` carry `describeMap(m)` = `{ id, name, half, boxes }`; `matchStart.pickups` carries the new spots. The client (`Game.#setMap`) replaces its prediction collision set and calls `scene.setMap`, which rebuilds the arena group (floor, grid, boxes) and disposes the old geometry; the kill feed shows "Map: <name>". Validity test: every spawn and pickup stands on free ground, raised pickups sit on a box top (`tests/unit/maps.test.js`).

### 28.2 Kit avatars
`src/client/avatars.js`: the shared box figure gets one accent group per kit (`KIT_ACCENTS`, index = `kt` from the snapshot): Vanguard shoulder plate and pauldrons, Phantom hood and cloak, Engineer backpack and antenna, Medic chest cross. The body material stays shared so team color still drives the figure. `RemotePlayers` reapplies the accent when `kt` changes (kit swap at respawn, decoys copy their owner's kit).

### 28.3 Procedural sound
`src/client/audio.js`: no audio assets; every cue is a WebAudio oscillator sweep with an optional noise burst (`CUES`: per-weapon shots, hit, kill, death, boom, pickup, ability, denied, level, match). `cueFor(event, data)` is pure and keeps private cues private (another player's kill, pickup or denied ability is silent). `falloff(d)` attenuates world-positioned cues (full inside 4 m, silent at 60 m). The context is created inside the Play click (`Game.join` calls `unlock()`), and the module is inert without an `AudioContext`. Settings panel: "Sound" checkbox (`bca.sound`, default on).

## 29. Genre parity: chat, streaks, ADS, view model, footsteps (D-026)

Source: docs/COMPETITIVE_AUDIT.md. Everything here is client feel or relayed text; the simulation (movement, hitscan, damage) is untouched, so no balance changes ride along.

### 29.1 Text chat
Client `{ t: 'chat', text }` (protocol: string, 1 to 400 chars, inside the 4 KB frame rule). `GameRoom.handleChat` relays `{ t: 'chat', id, name, team, text }` to everyone after `sanitizeChat` (control characters to spaces, trimmed, cut at `CHAT_MAX_CHARS` = 120 code points) and `chatAllowed` (one line per `CHAT_MIN_INTERVAL_MS` = 1000 per player; faster lines are dropped silently, not counted as strikes). Nothing is stored. Client: Enter opens the chat line, Enter sends, Escape cancels; `Input.chatOpen` zeroes movement while typing; the HUD keeps the newest `CHAT_KEEP` = 6 lines for 12 s, names tinted by team.

### 29.2 Streaks and multi-kills
`src/shared/social.js`: `recordKill(p, now)` bumps `p.streak` and `p.multi` (kills within `MULTI_WINDOW_MS` = 4000); `resetStreak(victim)` on death. The kill message carries `streak` + `streakText` only at a milestone (3 Killing Spree, 5 Rampage, 7 Unstoppable, 10 Godlike, 15 Legendary) and `multi` + `multiText` only for a multi-kill (Double, Triple, Multi), plus `ended` when a streak of 5 or more was ended, so the plain kill message shape of SPEC 20 is unchanged. Client: the killer sees a centred banner (multi-kill wins over streak); everyone else gets a feed line for streaks of 5 or more and for ended streaks.

### 29.3 ADS and field of view
`src/client/aim.js`. Right mouse held (`Input.ads`) eases the camera fov toward `ADS_FOV[weapon]` (sniper 28, rifle 58, SMG 62, shotgun 68, pistol 64), never above the player's setting, at `ADS_LERP` 18 / s; mouse sensitivity is scaled by `tan(fov / 2) / tan(base / 2)` so screen-space aim speed is constant. The sniper below 60% of the base fov shows the scope overlay (`#scope`) and hides the crosshair and the view model. Settings: Field of view slider 60 to 110 (`bca.fov`, default 80). Spread and damage are unchanged by ADS in V1.

### 29.4 Weapon view model
`src/client/weaponView.js`: a box gun per weapon (`WEAPON_VIEW`) parented to the camera, pose from `pose({ ads, kick, reload, swayX, swayY })`: hip rest at `REST`, centred at `ADS_POS` while aiming, `KICK` 6 cm back per shot decaying at 9 / s, a sine dip of `RELOAD_DIP` across the weapon's reload time (started when the snapshot first reports `rel: 1`), walk sway scaled by ground speed and suppressed while aiming. Hidden while dead or scoped.

### 29.5 Footsteps
Own steps: a `step` cue every 2.4 m of ground travel above 1 m/s. Remote steps: `RemotePlayers.moving(now)` reports grounded players moving above 1 m/s from the last two snapshots; each gets a positional `step` cue (falloff of SPEC 28.3) no more often than once per 2.4 m.

### 29.6 Tests
`tests/unit/social.test.js` (4: sanitize and pacing, protocol, streak and multi-kill rules, room relay), `aim.test.js` (2: fov and ADS targets, view model pose). Existing exact-shape kill tests still pass because milestone fields are optional.


## 31. Pro weapons and characters (Pro batch P2, D-028)

Client rendering only; no gameplay number changes. Readability rule from SPEC 30.1 applies: the figure stays one
team colored material, accents are small.

### 31.1 Weapon models (`src/client/weaponModels.js`, `weaponView.js`)
One parts table per weapon (receiver, barrel, handguard or pump, grip, magazine, stock, sights or scope with glass ends) in weapon space (muzzle toward -Z), four materials (`body`, `accent` per weapon, `wood`, `glass`), shared by the first person view and the hands of remote players. `weaponLength` ranks sniper > shotgun > rifle > SMG > pistol (tested). The view model adds forearms and gloves so the weapon is held. `WeaponView.inspect()` (F, SPEC 32.6) lifts and rolls the weapon over `INSPECT_MS` = 1400 and back, never while aiming; `pose()` gains `inspect`, `yaw` and `roll`.

### 31.2 Character rig (`src/client/characterRig.js`, `remote.js`)
Torso, pelvis, head, visor, two arms and two legs with pivots at shoulders and hips, dimensions in `RIG`. `walkCycle(phase, speed, { airborne, crouchK })` returns leg and arm angles, bob and forward lean (sprint leans more, crouch steps shorter, airborne tucks); `advancePhase` ties the cycle to distance (one cycle per 1.6 m, so feet match the ground at any speed). The head follows the snapshot pitch. The weapon in hand follows `w` from the snapshot. Kit accents (SPEC 28.2) and crouch squash (SPEC 23) are unchanged.

### 31.3 Hit flash and death pose
A verdict with damage flashes the victim's body emissive for 120 ms (`hitFlash`), so the shooter sees the hit land on the figure, not only on the HUD. A player whose `alive` turns 0 tips over (`deathPose`: roll to 0.92 of a quarter turn and sink 0.35 m over 450 ms, fading out in the last 30%) before the mesh hides; respawn resets it.

### 31.4 Tests
`tests/unit/proWeapons.test.js` (4: model coverage, materials and lengths; rig cycle; phase, flash and death curves; inspect pose).
