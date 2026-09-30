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
     - on a player hit: `hp -= WEAPON.damage`; the shooter receives `{ t:'hit', id: victimId }`;
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

## 15. Approved combat extension — pending implementation (D-010–D-013)

The current contracts in §§1–12 still describe the running baseline. This section records the owner's
approved extension, not a claim that it is implemented. Resolve the remaining tuning decisions in
`docs/DESIGN.md` before replacing those contracts and writing feature tests.

- Five damage categories: head ×1.5, upper torso ×1.1, lower torso ×1.0, arms ×0.95, legs ×0.9.
  Categories are not the same as collider count: both arms can have separate geometry but share one multiplier.
  Hit geometry belongs to the deterministic core. Equal world poses and shot rays must produce equal zone
  results regardless of the room's 30/60/120 Hz scheduling. This does not imply that moving-world trajectories
  are automatically bit-identical across different step sizes.
- Weapon data defines three to four distance bands; the first rifle has three bands. The base damage steps
  down twice and is multiplied by the resolved zone multiplier. Distances and base values remain unapproved.
- The server accepts fire/throw intent only. Hit identity, health and damage never come from a client claim.
  Current baseline shots use current positions: lag compensation does not yet exist. When introduced, rewind
  must include the anatomical hit geometry, not only the movement box.
- One throwable: server-simulated launch arc, world collision, bounce, fuse, explosion and radial damage
  falloff. Snapshot replication includes projectile identity, position and state. Damage application is shared
  with bullets in the deterministic core. Abilities are explicitly deferred. Throwable tuning and inventory,
  self-damage and blast-cover rules remain to be confirmed.
- Accepted shots produce a server verdict even on a miss. The HUD distinguishes head/body confirmations
  and shows damage/zone feedback plus a bounded per-shot log (shot, zone, applied damage, kill outcome).
  Do not show speculative client hits as confirmed hits.
- The 4096-byte limit in §7 is an **incoming client-message** limit, not an outbound snapshot budget.
  New intent must remain within it; projectile snapshots and shot-result traffic need separate size/load tests.
  Five zone categories do not require transmitting collider geometry each snapshot.
- Verification order: existing rifle/obstruction/cooldown/death/respawn baseline, then zone and band-boundary
  unit tests, hostile new-intent tests, deterministic projectile/collision/fuse tests, socket replication tests,
  and real-browser feedback/throwing checks. Do not label current-position registration as lag-compensated.
