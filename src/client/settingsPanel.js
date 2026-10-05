// Settings (SPEC 33). DOM glue only: values, clamping and persistence live in settings.js, prefs.js and bindings.js,
// which the unit tests cover. The panel is a tabbed modal: Controls, Keybinds (table + keyboard and mouse maps with
// click to rebind), Video, Audio, HUD. Every change applies live through game.applyPrefs and persists at once.
import { encode as encodeCrosshair, decode as decodeCrosshair, crosshairSubset, PRESETS as CROSSHAIR_PRESETS, CROSSHAIR_FIELDS } from '../shared/crosshairCode.js';
import { getFov, getSensitivity, getShowFps, getSound, getTouchControls, setFov, setSensitivity, setShowFps, setSound, setTouchControls } from './settings.js';
import { PREFS_SCHEMA, TABS, fieldsFor, searchFields, loadPrefs, savePrefs, defaults as prefDefaults, keyLabel, KEYBOARD_ROWS, isMouseCode } from './prefs.js';
import { ACTION_LABELS, ACTION_GROUPS, REBINDABLE, bind, setBinding, resetBindings, getAllBindings, loadBindings, conflicts } from './bindings.js';

export const BINDINGS_KEY = 'bca.bindings';

function el(doc, tag, attrs = {}, children = []) {
  const n = doc.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') n.className = v;
    else if (k === 'text') n.textContent = v;
    else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
    else n.setAttribute(k, v);
  }
  for (const c of children) n.append(c);
  return n;
}

function persistBindings() {
  try { window.localStorage.setItem(BINDINGS_KEY, JSON.stringify(getAllBindings())); } catch { /* session only */ }
}

export function restoreBindings(storage = (typeof window !== 'undefined' ? window.localStorage : null)) {
  try { const raw = storage?.getItem(BINDINGS_KEY); return loadBindings(raw ? JSON.parse(raw) : null); } catch { resetBindings(); return 0; }
}

export function bindSettingsPanel(doc, game) {
  const panel = doc.getElementById('settings');
  const openBtn = doc.getElementById('settings-open');
  if (!panel || !openBtn) return;
  const tabsBar = panel.querySelector('.tabs');
  const body = panel.querySelector('.tab-body');
  const search = panel.querySelector('.settings-search'); // SPEC 36.6
  let query = '';
  search?.addEventListener('input', () => { query = search.value; render(); });
  const closeBtn = panel.querySelector('.settings-close');
  let tab = 'controls';
  let prefs = loadPrefs();
  restoreBindings();
  game.applyPrefs(prefs);

  const open = (on) => {
    panel.hidden = !on;
    openBtn.setAttribute('aria-expanded', String(on));
    if (on) render();
  };
  openBtn.addEventListener('click', () => open(panel.hidden));
  closeBtn?.addEventListener('click', () => open(false));
  doc.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !panel.hidden && !capturing) open(false); });

  const commit = (key, value) => {
    prefs = savePrefs({ ...prefs, [key]: value });
    game.applyPrefs(prefs);
    if (codeOut && CROSSHAIR_FIELDS.includes(key)) codeOut.value = encodeCrosshair(crosshairSubset(prefs));
  };
  let codeOut = null; // SPEC 40.4: the read only share code field, refreshed on every crosshair change

  // ---- SPEC 40.4 crosshair share code: current code, copy, apply a pasted code, presets
  function shareCodeRow() {
    const wrap = el(doc, 'div', { class: 'share-code', id: 'crosshair-share' });
    const current = el(doc, 'div', { class: 'row' });
    codeOut = el(doc, 'input', { id: 'crosshair-code', type: 'text', readonly: '', 'aria-label': 'Your crosshair code' });
    codeOut.value = encodeCrosshair(crosshairSubset(prefs));
    const note = el(doc, 'span', { class: 'muted share-note', id: 'crosshair-code-note', role: 'status' });
    const copy = el(doc, 'button', { type: 'button', class: 'ghost', text: 'Copy', onclick: async () => {
      try { await navigator.clipboard.writeText(codeOut.value); note.textContent = 'Copied'; } catch { codeOut.select(); note.textContent = 'Copy failed, select the text'; }
    } });
    current.append(el(doc, 'label', { for: 'crosshair-code', text: 'Share code' }), el(doc, 'span', { class: 'code-field' }, [codeOut, copy]));
    const apply = el(doc, 'div', { class: 'row' });
    const input = el(doc, 'input', { id: 'crosshair-code-input', type: 'text', placeholder: 'BCA-XXXX-XXXX', autocomplete: 'off', spellcheck: 'false', 'aria-label': 'Paste a crosshair code' });
    const applyCode = (text) => {
      const r = decodeCrosshair(text);
      if (!r.ok) { note.textContent = `Code rejected: ${r.reason}`; return false; }
      prefs = savePrefs({ ...prefs, ...r.values });
      game.applyPrefs(prefs);
      render(); // rebuilds the tab, so the note is looked up again
      const fresh = doc.getElementById('crosshair-code-note');
      if (fresh) fresh.textContent = 'Crosshair applied';
      return true;
    };
    const applyBtn = el(doc, 'button', { type: 'button', text: 'Apply', onclick: () => applyCode(input.value) });
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') applyCode(input.value); });
    apply.append(el(doc, 'label', { for: 'crosshair-code-input', text: 'Apply a code' }), el(doc, 'span', { class: 'code-field' }, [input, applyBtn]));
    const presets = el(doc, 'div', { class: 'row presets' });
    const seg = el(doc, 'div', { class: 'segment', role: 'group', 'aria-label': 'Crosshair presets' });
    for (const pr of CROSSHAIR_PRESETS) seg.append(el(doc, 'button', { type: 'button', text: pr.name, title: pr.code, onclick: () => applyCode(pr.code) }));
    presets.append(el(doc, 'label', { text: 'Presets' }), seg);
    wrap.append(current, apply, presets, note);
    return wrap;
  }

  // ---- generic controls from the schema
  function control(key) {
    const s = PREFS_SCHEMA[key];
    const row = el(doc, 'div', { class: 'row' });
    const id = `pref-${key}`;
    row.append(el(doc, 'label', { for: id, text: s.label }));
    if (s.type === 'bool') {
      const input = el(doc, 'input', { id, type: 'checkbox', role: 'switch' });
      input.checked = prefs[key];
      input.addEventListener('change', () => commit(key, input.checked));
      row.append(el(doc, 'span', { class: 'switch' }, [input, el(doc, 'i')]));
    } else if (s.type === 'enum') {
      const seg = el(doc, 'div', { class: 'segment', role: 'radiogroup', id });
      for (const v of s.values) {
        const b = el(doc, 'button', { type: 'button', role: 'radio', 'aria-checked': String(prefs[key] === v), text: v[0].toUpperCase() + v.slice(1).replace('-', ' ') });
        b.addEventListener('click', () => { commit(key, v); for (const o of seg.children) o.setAttribute('aria-checked', String(o === b)); });
        seg.append(b);
      }
      row.append(seg);
    } else {
      const out = el(doc, 'output', { for: id, text: String(prefs[key]) });
      const input = el(doc, 'input', { id, type: 'range', min: s.min, max: s.max, step: s.step });
      input.value = String(prefs[key]);
      input.addEventListener('input', () => { commit(key, input.value); out.textContent = String(prefs[key]); });
      row.append(el(doc, 'span', { class: 'range' }, [input, out]));
    }
    return row;
  }

  // ---- legacy settings (settings.js) rendered as the first rows of their tabs
  function legacyRange(label, min, max, step, get, set, apply, fmt = (v) => String(v)) {
    const row = el(doc, 'div', { class: 'row' });
    const out = el(doc, 'output', { text: fmt(get()) });
    const input = el(doc, 'input', { type: 'range', min, max, step });
    input.value = String(get());
    apply(get());
    input.addEventListener('input', () => { const v = set(undefined, input.value); out.textContent = fmt(v); apply(v); });
    row.append(el(doc, 'label', { text: label }), el(doc, 'span', { class: 'range' }, [input, out]));
    return row;
  }
  function legacyBool(label, get, set, apply) {
    const row = el(doc, 'div', { class: 'row' });
    const input = el(doc, 'input', { type: 'checkbox', role: 'switch' });
    input.checked = get();
    apply(input.checked);
    input.addEventListener('change', () => apply(set(undefined, input.checked)));
    row.append(el(doc, 'label', { text: label }), el(doc, 'span', { class: 'switch' }, [input, el(doc, 'i')]));
    return row;
  }
  function touchModeRow() {
    const row = el(doc, 'div', { class: 'row' });
    const seg = el(doc, 'div', { class: 'segment', role: 'radiogroup' });
    const mode = getTouchControls();
    for (const v of ['auto', 'on', 'off']) {
      const b = el(doc, 'button', { type: 'button', role: 'radio', 'aria-checked': String(mode === v), text: v[0].toUpperCase() + v.slice(1) });
      b.addEventListener('click', () => { setTouchControls(undefined, v); game.updateTouchMode(); for (const o of seg.children) o.setAttribute('aria-checked', String(o === b)); });
      seg.append(b);
    }
    row.append(el(doc, 'label', { text: 'Touch controls' }), seg);
    return row;
  }

  // ---- keybinds
  let capturing = null; // { action, slot, cell }
  function keybindsTab() {
    const wrap = el(doc, 'div', { class: 'keybinds' });
    const conflictSet = new Set(conflicts().map((c) => c.code));
    const table = el(doc, 'table', { class: 'bind-table' });
    table.append(el(doc, 'thead', {}, [el(doc, 'tr', {}, [el(doc, 'th', { text: 'Action' }), el(doc, 'th', { text: 'Primary' }), el(doc, 'th', { text: 'Secondary' })])]));
    const tbody = el(doc, 'tbody');
    for (const group of ACTION_GROUPS) {
      tbody.append(el(doc, 'tr', { class: 'group' }, [el(doc, 'td', { colspan: '3', text: group[0].toUpperCase() + group.slice(1) })]));
      for (const action of REBINDABLE.filter((a) => ACTION_LABELS[a][1] === group)) {
        const tr = el(doc, 'tr');
        tr.append(el(doc, 'td', { text: ACTION_LABELS[action][0] }));
        for (const slot of [action, `${action}Alt`]) {
          const code = bind(slot);
          const cell = el(doc, 'button', { type: 'button', class: `key${code && conflictSet.has(code) ? ' conflict' : ''}${isMouseCode(code) ? ' mouse' : ''}`, text: keyLabel(code), 'aria-label': `${ACTION_LABELS[action][0]} ${slot === action ? 'primary' : 'secondary'} key: ${keyLabel(code)}` });
          cell.addEventListener('click', () => startCapture(action, slot, cell));
          tr.append(el(doc, 'td', {}, [cell]));
        }
        tbody.append(tr);
      }
    }
    table.append(tbody);
    const help = el(doc, 'p', { class: 'bind-help', text: 'Click a key to rebind. Press any key or mouse button, scroll the wheel, Esc cancels, Backspace clears a secondary key.' });
    const actions = el(doc, 'div', { class: 'bind-actions' }, [
      el(doc, 'button', { type: 'button', class: 'ghost', text: 'Reset to defaults', onclick: () => { resetBindings(); persistBindings(); render(); } }),
    ]);
    if (conflictSet.size) actions.append(el(doc, 'span', { class: 'conflict-note', text: `${conflictSet.size} key${conflictSet.size > 1 ? 's' : ''} bound to more than one action` }));
    wrap.append(help, actions, keyboardMap(), mouseMap(), table);
    return wrap;
  }

  function actionsOn(code) {
    return REBINDABLE.filter((a) => bind(a) === code || bind(`${a}Alt`) === code);
  }

  function keyboardMap() {
    const kb = el(doc, 'div', { class: 'kbmap', 'aria-label': 'Keyboard map' });
    for (const row of KEYBOARD_ROWS) {
      const r = el(doc, 'div', { class: 'kbrow' });
      for (const spec of row) {
        const [code, w = '1'] = spec.split(':');
        const acts = actionsOn(code);
        const k = el(doc, 'button', { type: 'button', class: `kbkey${acts.length ? ' bound' : ''}`, style: `flex: ${w} 0 0`, title: acts.length ? acts.map((a) => ACTION_LABELS[a][0]).join(', ') : keyLabel(code) });
        k.append(el(doc, 'span', { class: 'cap', text: keyLabel(code) }));
        if (acts.length) k.append(el(doc, 'span', { class: 'act', text: acts.map((a) => ACTION_LABELS[a][0].split(' (')[0]).join(' / ') }));
        k.addEventListener('click', () => { const a = acts[0]; if (a) startCapture(a, bind(a) === code ? a : `${a}Alt`, k); });
        r.append(k);
      }
      kb.append(r);
    }
    return kb;
  }

  function mouseMap() {
    const m = el(doc, 'div', { class: 'mousemap', 'aria-label': 'Mouse map' });
    // the mouse figure is built from SVG nodes (no HTML sink; the policy check forbids innerHTML)
    const NS = 'http://www.w3.org/2000/svg';
    const svg = doc.createElementNS(NS, 'svg');
    for (const [k, v] of Object.entries({ viewBox: '0 0 120 180', width: '110', height: '165', 'aria-hidden': 'true' })) svg.setAttribute(k, v);
    const shape = (tag, attrs) => { const n = doc.createElementNS(NS, tag); for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v); svg.append(n); };
    shape('path', { d: 'M60 8c-30 0-50 22-50 60v60c0 28 22 46 50 46s50-18 50-46V68C110 30 90 8 60 8z', fill: '#161b22', stroke: '#30363d', 'stroke-width': '2' });
    shape('path', { d: 'M12 72h96', stroke: '#30363d', 'stroke-width': '2' });
    shape('path', { d: 'M60 8v64', stroke: '#30363d', 'stroke-width': '2' });
    shape('rect', { x: '54', y: '26', width: '12', height: '26', rx: '6', fill: '#30363d' });
    shape('rect', { x: '2', y: '86', width: '8', height: '26', rx: '3', fill: '#30363d' });
    shape('rect', { x: '2', y: '118', width: '8', height: '26', rx: '3', fill: '#30363d' });
    const fig = el(doc, 'div', { class: 'mouse-fig' }, [svg]);
    const list = el(doc, 'ul', { class: 'mouse-list' });
    for (const code of ['Mouse0', 'Mouse2', 'Mouse1', 'WheelUp', 'WheelDown', 'Mouse3', 'Mouse4']) {
      const acts = actionsOn(code);
      const li = el(doc, 'li', {}, [el(doc, 'b', { text: keyLabel(code) }), el(doc, 'span', { text: acts.length ? acts.map((a) => ACTION_LABELS[a][0].split(' (')[0]).join(' / ') : 'Unbound' })]);
      list.append(li);
    }
    m.append(fig, list);
    return m;
  }

  function startCapture(action, slot, cell) {
    if (capturing) return;
    capturing = { action, slot, cell };
    cell.classList.add('listening');
    cell.textContent = 'Press a key...';
    const finish = (code) => {
      cleanup();
      if (code === 'Escape') { render(); return; }
      if (code === 'Backspace') { if (slot.endsWith('Alt')) setBinding(slot, null); persistBindings(); render(); return; }
      setBinding(slot, code);
      persistBindings();
      render();
    };
    const onKey = (e) => { e.preventDefault(); e.stopPropagation(); finish(e.code); };
    const onMouse = (e) => { e.preventDefault(); e.stopPropagation(); finish(`Mouse${e.button}`); };
    const onWheel = (e) => { e.preventDefault(); finish(e.deltaY > 0 ? 'WheelDown' : 'WheelUp'); };
    const onCtx = (e) => e.preventDefault();
    const cleanup = () => {
      capturing = null;
      doc.removeEventListener('keydown', onKey, true);
      doc.removeEventListener('mousedown', onMouse, true);
      doc.removeEventListener('wheel', onWheel, { capture: true });
      doc.removeEventListener('contextmenu', onCtx, true);
    };
    setTimeout(() => { // skip the click that opened the capture
      doc.addEventListener('keydown', onKey, true);
      doc.addEventListener('mousedown', onMouse, true);
      doc.addEventListener('wheel', onWheel, { capture: true, passive: false });
      doc.addEventListener('contextmenu', onCtx, true);
    }, 0);
  }

  // ---- render
  function render() {
    if (query.trim()) { // SPEC 36.6: a search replaces the tab view with every matching field, labelled by its tab
      tabsBar.replaceChildren();
      const hits = searchFields(query);
      const frag = doc.createDocumentFragment();
      if (hits.length === 0 && !/share|code|preset/i.test(query)) frag.append(el(doc, 'p', { class: 'muted', text: `No settings match "${query.trim()}"` }));
      for (const k of hits) { const row = control(k); row.dataset.tab = PREFS_SCHEMA[k].tab; frag.append(row); }
      if (/share|code|preset/i.test(query)) { const row = shareCodeRow(); row.dataset.tab = 'hud'; frag.append(row); } // SPEC 40.4
      body.replaceChildren(frag);
      return;
    }
    tabsBar.replaceChildren(...TABS.map((t) => el(doc, 'button', { type: 'button', role: 'tab', 'aria-selected': String(t.id === tab), text: t.label, onclick: () => { tab = t.id; render(); } })));
    const frag = doc.createDocumentFragment();
    if (tab === 'controls') {
      frag.append(legacyRange('Mouse sensitivity', 0.0005, 0.01, 0.0001, getSensitivity, setSensitivity, (v) => game.setSensitivity(v), (v) => (v * 1000).toFixed(1)));
      for (const k of fieldsFor('controls')) frag.append(control(k));
      frag.append(touchModeRow());
    } else if (tab === 'keybinds') {
      frag.append(keybindsTab());
    } else if (tab === 'video') {
      frag.append(legacyRange('Field of view', 60, 110, 1, getFov, setFov, (v) => game.setFov(v)));
      for (const k of fieldsFor('video')) frag.append(control(k));
      frag.append(legacyBool('Show FPS and ping', getShowFps, setShowFps, (v) => game.setShowFps(v)));
    } else if (tab === 'audio') {
      frag.append(legacyBool('Sound', getSound, setSound, (v) => game.setSound(v)));
      for (const k of fieldsFor('audio')) frag.append(control(k));
    } else if (tab === 'hud') {
      frag.append(el(doc, 'div', { class: 'ch-preview', 'aria-label': 'Crosshair preview' }, [el(doc, 'div', { id: 'ch-preview-mark', class: 'crosshair-mark' })]));
      for (const k of fieldsFor('hud')) frag.append(control(k));
      frag.append(shareCodeRow());
      frag.append(el(doc, 'div', { class: 'bind-actions' }, [el(doc, 'button', { type: 'button', class: 'ghost', text: 'Reset HUD to defaults', onclick: () => { const d = prefDefaults(); prefs = savePrefs({ ...prefs, ...Object.fromEntries(fieldsFor('hud').map((k) => [k, d[k]])) }); game.applyPrefs(prefs); render(); } })]));
    }
    body.replaceChildren(frag);
    if (tab === 'hud') game.applyPrefs(prefs); // repaints the preview mark through the hud
  }
  render();
}
