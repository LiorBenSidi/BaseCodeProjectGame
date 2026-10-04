// Net and frame telemetry (SPEC 36.1, D-033). Pure rolling statistics; the HUD readout formats them.
// Reference standard: the CS2 telemetry row (fps, ping, loss, jitter) and the Source networking notes.
export const WINDOW = 60; // samples kept per series (about two seconds of snapshots, half a minute of pings)
export const TICK_MS = 1000 / 60;

export function newTelemetry() {
  return { rtts: [], gaps: [], lastSnapAt: null, frames: 0, since: null, fps: 0 };
}

const push = (arr, v) => { arr.push(v); if (arr.length > WINDOW) arr.shift(); };

export function recordPing(t, rtt) { if (Number.isFinite(rtt) && rtt >= 0) push(t.rtts, rtt); }

// A snapshot arrived at `now`; gaps are measured in ticks so loss reads the same at any tick rate.
export function recordSnapshot(t, now) {
  if (t.lastSnapAt !== null) push(t.gaps, (now - t.lastSnapAt) / TICK_MS);
  t.lastSnapAt = now;
}

export function recordFrame(t, now) {
  if (t.since === null) t.since = now;
  t.frames += 1;
  const elapsed = now - t.since;
  if (elapsed >= 500) { t.fps = Math.round((t.frames * 1000) / elapsed); t.frames = 0; t.since = now; }
}

const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);

// jitter = standard deviation of the ping samples; loss = share of snapshot intervals that skipped at least one tick.
export function stats(t) {
  const ping = t.rtts.length ? Math.round(t.rtts[t.rtts.length - 1]) : null;
  const m = mean(t.rtts);
  const jitter = t.rtts.length > 1 ? Math.round(Math.sqrt(mean(t.rtts.map((r) => (r - m) ** 2)))) : 0;
  const lost = t.gaps.filter((g) => g > 2.5).length;
  const loss = t.gaps.length ? Math.round((lost / t.gaps.length) * 100) : 0;
  return { fps: t.fps, ping, jitter, loss };
}

// Warning levels drive the readout colour: ok, warn, bad.
export const level = (s) => (s.ping !== null && s.ping > 150) || s.loss > 10 || s.jitter > 40 || (s.fps > 0 && s.fps < 30) ? 'bad' : (s.ping !== null && s.ping > 80) || s.loss > 2 || s.jitter > 15 || (s.fps > 0 && s.fps < 55) ? 'warn' : 'ok';

export function format(s) {
  const parts = [`${s.fps} FPS`];
  if (s.ping !== null) parts.push(`${s.ping} ms`, `±${s.jitter}`, `${s.loss}% loss`);
  return parts.join(' · ');
}

// FPS cap (SPEC 36.4): should this frame render? 0 = uncapped. A little slack keeps 60 on a 60 Hz display.
export function frameDue(lastRenderAt, now, cap) {
  if (!(cap > 0)) return true;
  return now - lastRenderAt >= 1000 / cap - 1;
}
