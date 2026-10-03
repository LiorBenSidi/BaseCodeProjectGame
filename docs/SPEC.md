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
`bad_join`, `bad_cmd`.

Accepted messages (the returned `msg` is **freshly built from whitelisted fields only**; unknown extra fields such as
`__proto__`, `isAdmin`, `hp` are dropped):

- `{ t:'join', name? }` → `msg = { t:'join', name }` where `name = sanitizeName(name)` (`''` if absent/non-string).
- `{ t:'shoot' }` → `msg = { t:'shoot' }`.
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
- `input`, `shoot`, `throw` without a seat are dropped. Messages from an unregistered connection are ignored.
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
- `ioWall`: `Date.now()` sampled right after an awaited `storage.get(CLOCK_STORAGE_KEY)` in `handleMessage`
  (`entry.ts`, at most once per message, only while `shouldTick()`); awaited I/O is where the Workers clock
  is allowed to move. The key is never written, so the read stays in the object's storage cache. A storage
  failure is reported through `fail("io-clock")`, never fatal.
- `clientClock`: every `input` message may carry `ts`, the client's `Date.now()` (`game.js` stamps it;
  §7 accepts a finite number >= 0 and drops anything else without failing the message). Per connection the
  first stamp anchors a virtual clock at the current chosen time (client skew is irrelevant); each later
  stamp advances it by `min(ts - lastTs, MAX_CLIENT_STEP_MS = 100)`, never backwards. The candidate is the
  fastest connection. Once `ioWall` has been seen moving, the candidate may lead `max(wall, ioWall)` by at
  most `CLOCK_AHEAD_TOLERANCE_MS = 250`, which bounds a speed hack to that lead; while the server clock has
  never moved the client clock is the only time there is and is not clamped. A closed connection stops
  contributing (`removeConnection`), the chosen time never drops.
- `timerTick`: a counter bumped by a `setTimeout` chain in `entry.ts` (`TIMER_EVIDENCE_MS = 1000`, at most
  `TIMER_EVIDENCE_MAX = 600` fires per object lifetime). Evidence only: it never drives the chosen time.

`now()` returns `max(previous, best candidate)`: monotonic whichever candidate wins. `probe()` returns
`{ candidates: { wall, ioWall, clientClock, timerTick }, advances: { same keys, how often each moved },
connections, chosen, source }` where `source` names the candidate that last moved the chosen time. The diag
frame of §17.3 carries it as `clock`, and `now` in that frame equals `clock.chosen`.

`MatchHost.message` records the stamp before `MatchSession.message` so the token bucket refills from the
advanced time; `MatchHost.close` drops the connection from the clock. Tests: `tests/unit/clockSource.test.js`
(frozen everything; moving wall; ioWall drives and never goes backwards; 60 Hz client deltas; 10 s jump clamped
to one step; backwards and non-numeric stamps ignored; fastest connection wins and removal keeps monotonicity;
tolerance clamp only after ioWall moved; timerTick counted and never chosen), `tests/unit/matchHost.test.js`
(stamped inputs on a frozen clock produce snapshots and the probe's `clock` block; unstamped inputs never step
and never throw), `tests/unit/protocol.test.js` (`ts` validation).

Live check: `ACTOR_BUILD = "2.0"`. In a `diag-` room, two probes must show `clock.advances.ioWall` growing
if awaited I/O unfreezes the clock, and `clock.source` must read `clientClock` while a browser player moves.
`scripts/actor-probe.mjs --inputs` stamps its inputs like `game.js`, so the Node probe exercises `clientClock` too.

Not started in this batch: 18.2 clock sync (ping/pong), 18.3 delta snapshots, 18.4 reconnect tokens,
18.5 blended reconciliation, 18.6 lag compensation rewind.


## 19. Design and HUD (Batch D1)

Client-only UX, HUD, theme system, menu skin, arena visual pass, and touch layout resolution.

### 19.1 In-match HUD
- HUD state derivation lives in `src/client/hudModel.js` (pure logic):
  - Crosshair state: expanded briefly on fire, flash on hit (headshot vs body).
  - Health and ammo readouts: health percentage and segment bar; infinite ammo status display (`INF / READY`).
  - Hit marker: brief flash with headshot differentiation (`head` vs `hit`).
  - Directional damage indicator: computes relative angle pointing toward attacker from player position, attacker position, and camera yaw.
  - Kill feed queue: maximum 5 entries, auto-expiring after 5000 ms.
  - Respawn countdown: displays centered countdown text (`Respawning in X.Xs...`) derived from local death time and `RESPAWN_MS`.
- Scoreboard polish: Tab / touch score overlay, aligned columns, highlighted self row (`.row.me`), team color chip based on player ID parity.

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

### 19.3 Arena visual pass (`src/client/scene.js`, `src/client/remote.js`)
- Hemisphere light and directional sun light with soft shadow mapping enabled.
- Dark fog matching the horizon/sky background color (`0x0f172a`).
- Simple gradient skybox generated via inverted sphere geometry with vertex colors.
- Box materials with slight roughness and metalness variation per box.
- Toned-down floor grid with lower opacity and subtle line colors.
- Team color meshes for remote players (Blue for even IDs, Red for odd IDs) with shadows.
- Name tags above remote players rendered as `THREE.Sprite` using cached `CanvasTexture` per name.
- Cheap CSS radial vignette overlay for framing.

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
