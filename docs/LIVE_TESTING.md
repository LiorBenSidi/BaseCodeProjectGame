# Dry tests and live tests

Every change is proven in two different ways. They catch different bugs, and **neither replaces the other**.

| | **Dry tests** | **Live tests** |
|---|---|---|
| What runs | Code in isolation: no server and no ports (`npm audit` is the one network call) | A real running server with real HTTP and WebSocket traffic |
| Commands | `npm run test:dry` = lint (policy checker + syntax) + `AGENTS.md` guard + unit tests. Also `npm run build` and `npm audit`. | `npm run test:live` = integration + security + system + stress suites. `npm run smoke <url>` against a running server. Browser play-through. |
| Speed | Seconds | Tens of seconds to minutes |
| Deterministic? | Yes (fake clocks, seeded randomness) | Mostly; timing-based checks use generous bounds |
| Catches | Logic errors, spec violations, banned patterns, broken imports, secrets | Wiring bugs: wrong HTTP method order, origin policy, proxy/host mismatches, resource leaks, rate limits, real-socket behaviour |
| Example bug found this way | Text normalisation rewriting letters | `POST /healthz` returned 200 instead of 405 |

`npm run verify` = dry + live in one go.

## When to run what
| Situation | Dry | Live suites | `smoke` on a URL | Browser play-through |
|---|:-:|:-:|:-:|:-:|
| After every small edit / each prompt | yes | | | |
| Before opening a pull request | yes | yes | | |
| Changing networking, protocol, security, config, headers | yes | yes | yes (local) | |
| First run in a new environment, or after a proxy/host/origin change | yes | yes | **yes (that environment's URL)** | yes |
| Changing gameplay, HUD, rendering or feel | yes | yes | | **yes** |
| Before merging performance-sensitive work | yes | yes (`test:live` already includes stress; CI runs stress only on demand) | | |

## The assistant must know what it can actually run
Before claiming anything, find out which kinds of test are possible **in the current environment**:
1. **Dry** needs only Node. It should always work.
2. **Live** needs permission to open a local port. Run one live suite once. If it fails immediately with `EPERM`,
   `EACCES` or "operation not permitted", live tests **cannot run here**. That is an environment limit, not a result.
3. If live tests cannot run locally, **do not skip them silently and do not report success**. Open the pull request
   and let CI run them: CI runs the unit, security, integration and system suites on every pull request. Read the CI result,
   fix what it finds, and report it.
4. If no terminal is available at all, dry and live checks both happen in CI; say so.

## Reporting rule (use this wording in PR descriptions and in chat)
```
Dry:  PASS - lint, AGENTS.md guard, N unit tests
Live: PASS - integration N, security N, system N, stress N        (or)
Live: NOT RUN locally - <reason>; CI run: <link or status>
Smoke: PASS against the preview (URL withheld: repo is public)     (or not applicable)
Browser: <what was played through, what was not>
```
Never write "all tests pass" unless both dry and live actually ran and passed. A live suite that did not run is
"not run", never "passed".

## Smoke test against any URL
```bash
npm run dev:server                            # in one terminal (Node ws transport)
npm run smoke http://localhost:3000           # in another
npm run smoke https://<preview-host>          # a hosted preview: same command, its own URL
npm run smoke -- https://<preview-host> --origin https://<the-page-origin>   # the extra -- hands the flag to the script, not to npm
```
It performs GET requests and one short WebSocket session: health, readiness, the game page, then join -> welcome ->
snapshot -> input acknowledged. A `403` on the WebSocket step means the server refused the page's `Origin`: set
`ALLOWED_ORIGINS` to that exact origin for that environment (see `SECURITY.md`). It changes no data: it briefly joins as a player named `smoke-NNNN` and leaves.

## Smoke against the Base44 deployment

`npm run smoke <site-url>` covers only the HTTP half there: `/healthz`, `/readyz` and `/ws` live on the Node
server, not on Base44 hosting, so expect those lines to fail and read only the page line. The room is checked
by hand until the smoke script gains an actor mode (Phase 6): open the deployed site in two tabs (same
`?room=`), press Play in both, confirm each sees the other; then reload one tab and confirm it comes back with
its seat (same `sessionStorage` connection id) and that the other tab saw no duplicate player.

`npm run actor-probe -- <app-id> [room] [seconds] [--inputs] [--diag]` joins the deployed `Match` actor from Node
over the SDK and counts the frames that arrive (`welcome`, `snap`, `error`, ...). It installs a minimal `window`
first: without one the SDK sends no `X-Base44-Anonymous-Id`, the connection-token mint answers 422 and the SDK
silently falls back to the platform proxy, so the Node run would not exercise the direct WebSocket path a browser
uses. `--inputs` streams 60 Hz input messages like a moving player; `--diag` sends `{ t: "diag" }` twice, a few
hundred ms apart, and prints both answers (SPEC 17.3 diagnostic probe). The probe is answered only in a room
whose id starts with `diag-` (for example `diag-live-1`); in any other room it earns a protocol strike. Read
`build` in the answer to confirm which `ACTOR_BUILD` the live object runs, and compare `now` across the two
answers to see whether the object's clock moved. A room name given here is a real room: pick one no player uses.
From build 2.0 the answer also carries `clock` (SPEC 18.1): `candidates` (`wall`, `ioWall`, `clientClock`,
`timerTick`), `advances` per candidate, `chosen` and `source`. `advances.ioWall` growing between the two answers
means awaited storage I/O unfreezes the object's clock; `advances.timerTick` growing means timers fire there;
`source: "clientClock"` with `--inputs` means the stamped input stream drives the room clock.

## Browser play-through (live, visual)
Use this when a person or the assistant can drive a browser. Some embedded browsers refuse pointer lock; the game
logic can still be exercised by treating the pointer as captured and sending real keyboard and mouse events:

```js
// run in the page BEFORE pressing Play (inspection only, do not commit)
const canvas = document.getElementById('game');
Object.defineProperty(document, 'pointerLockElement', { get: () => canvas, configurable: true });
canvas.requestPointerLock = () => Promise.resolve();
// record server messages so results can be read back
window.__events = []; window.__snap = null;
const Native = window.WebSocket;
window.WebSocket = function (u, p) {
  const ws = new Native(u, p);
  ws.addEventListener('message', (e) => { const m = JSON.parse(e.data); if (m.t === 'snap') window.__snap = m; else window.__events.push(m); });
  return ws;
};
window.WebSocket.OPEN = Native.OPEN; window.WebSocket.prototype = Native.prototype;
```
Then walk (`keydown`/`keyup` with `code: 'KeyW'` on `window`), aim (`mousemove` with `movementX/Y`; yaw changes by
`-movementX * 0.0022`), and shoot (`mousedown` with `button: 0`). Verify from the recorded snapshots and events: position
changed at about 7 m/s, `hit` events arrive, the target's hp goes 75, 50, 25, 0, a `kill` event appears, the kill feed
and scoreboard update, and the target respawns with 100 hp. **State clearly that pointer lock and real mouse feel were
simulated, not tested.** Two players need two tabs; background tabs pause animation, so a background tab makes a good
stationary target.

## Dry-run convention for anything that changes something outside the code
Any script or workflow that changes external state (deploys, publishes, migrations, data changes) must support a
**dry run** that prints exactly what it would do and changes nothing: a `--dry-run` flag for scripts, a `dry_run` input
for manually triggered workflows. Run the dry run first, show its output, and only then run for real. Examples from git and
npm: `git push --dry-run`, `npm ci --dry-run`.

## Rules for good dry and live tests (applied from the software-testing course material)
1. **Design for dry tests with injection.** Anything slow, random or external is passed in, never created inside:
   `GameRoom` takes `now`, `random` and a per-player `send`, so a unit test runs in microseconds with fakes, exactly like
   injecting a mock database instead of a slow real one. A fake must match the real interface (a drop-in) and hand out
   copies, so a caller cannot corrupt it. Default parameters are functions evaluated per call, never a shared object
   created once at import time.
2. **Speed is a budget, not an accident.** The dry suite should finish in seconds (currently about 0.2 s for 700 tests).
   If a "unit" test needs a port, a real timer or the network, it is a live test: move it to `tests/integration`.
3. **The author verifies first.** Run dry and live yourself before saying "done". CI and a reviewer are the second net,
   never the first; do not hand your teammate a change that has not run. Passing is not proof of correctness: read what each
   new test actually asserts and make sure it checks something that was asked for, not something the code merely does.
4. **A bug fix starts with a test that fails for that bug.** Write it, watch it fail, confirm it fails *for the reason you
   think*, then fix, then watch it pass. (Example from this project: a `POST /healthz` returning 200 is what the failing
   integration test showed before the ordering fix.)
5. **Never dismiss a failure you cannot reproduce.** An intermittent failure is a real bug until proven otherwise:
   note the seed, timing and machine load, shrink the case, and reproduce it. Timing-dependent live checks use generous
   bounds, and a flaky test is investigated the same day, not retried until green or silenced.
6. **Measure, do not guess.** Before "optimising", get numbers. For load, read them against the configured limits: the
   per-IP cap of 8 sockets and the 120-message token bucket are *intended* ceilings, so a plateau there is the limit working,
   not a capacity measurement. Keep the server quiet while measuring (`logLevel: 'error'`): logging costs CPU.
7. **Compare against a known-good baseline** when something regresses (behavioural comparison): re-run the same suite
   on the last good commit (`git bisect` finds the commit) to see exactly what changed.
8. **Never comment out a broken test.** Fix it or delete it with a reason. A suite that collects zero tests is a failure.

## Reading live-test failures (socket and network errors)
| You see | Likely meaning | What to do |
|---|---|---|
| `EPERM` / `EACCES` at listen or bind | The environment forbids opening a port (a sandbox), or the port is below 1024 | Live tests cannot run here: say "not run", rely on CI. Use ports 1024 and up; tests use port 0 so the OS picks one |
| `EADDRINUSE` | Another process holds the port (often a dev server) | Stop it, or let the test choose port 0; never kill unrelated processes |
| `ECONNREFUSED` | Nothing is listening at that host and port, or wrong host | Start the server; check the URL; a server bound to `127.0.0.1` is unreachable from other machines, `0.0.0.0` listens on all interfaces |
| WebSocket handshake `403` | The `Origin` was refused (missing, `null`, or not the allowed one) | Set `ALLOWED_ORIGINS` to the exact page origin for that environment; never disable the check |
| WebSocket handshake `429` | More than 8 concurrent sockets from one address | Close idle clients; this is the DoS control working |
| Close code `1008` / `1003` / `1009` / `1013` | Policy (flood, 5 protocol strikes) / binary frame / frame over 4096 bytes / room full | Read the message that triggered it; these are intended defences |
| Test passes locally, fails in CI | Timing, environment or a hidden dependency on your machine | Reproduce with the CI Node version; check for fixed ports, real clocks, leftover state |

## Optional HTTP load probe
The health endpoint can also be hit with the standard Apache Bench tool (`ab`, preinstalled on macOS; `apache2-utils` on
Linux): `ab -n 1000 -c 100 http://localhost:3000/healthz`. It exercises HTTP only, not the WebSocket game traffic (that is
`npm run test:stress`). Watch requests per second and time per request; higher concurrency raises per-request latency while
throughput flattens.

## Deployed room clock (D-018)

The hosted room has no timer of its own: steps run inside the events that reach the actor (every `input`
message, plus one platform wake every 500 ms while someone is seated). To check it on the published site:

1. Open the site in two tabs, join both. Each tab should see the other move with no visible stepping.
2. Kill one player and leave both tabs idle (no keys, no mouse). The dead player must respawn after `RESPAWN_MS`
   with at most about half a second of extra delay: that delay is the idle heartbeat doing the work the managed
   ticker does not.
3. Throw a grenade and stand still. The blast must land on its fuse, again within about half a second.

If step 2 or 3 stalls indefinitely, the schedule did not fire: check the actor logs for `clock dropped time`
lines and `Actor.handleWake threw` (platform shim), and re-read SPEC §17.3.

