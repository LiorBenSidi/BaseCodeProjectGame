// SPEC 40.2: the lobby cosmetics picker and its storage. Three rows (badge, accent, tracer); locked items are
// disabled and name their unlock; the server answers every selection with the resolved set, which repaints the
// picker so a locked wish never looks chosen. Pure DOM, no three.js.
import { CATALOG, SLOTS, DEFAULT_COSMETICS, isUnlocked, unlockText, resolveCosmetics, sanitizeWish } from '../shared/cosmetics.js';

export const COSMETICS_KEY = 'bca.cosmetics';
const SLOT_LABELS = Object.freeze({ badge: 'Badge', accent: 'Name colour', tracer: 'Tracer' });

export function loadCosmetics(storage) {
  try { return { ...DEFAULT_COSMETICS, ...sanitizeWish(JSON.parse(storage?.getItem(COSMETICS_KEY) ?? 'null')) }; } catch { return { ...DEFAULT_COSMETICS }; }
}
export function saveCosmetics(storage, cs) {
  try { storage?.setItem(COSMETICS_KEY, JSON.stringify(sanitizeWish(cs))); } catch { /* storage full or blocked */ }
  return cs;
}

// Renders into `root`; returns { setStats(row), setResolved(cs) } so the owner can repaint on server messages.
export function renderCosmeticsPicker(root, wish, onPick, { stats = null } = {}) {
  let current = { ...DEFAULT_COSMETICS, ...wish };
  let row = stats;
  const doc = root.ownerDocument;
  const paint = () => {
    root.replaceChildren();
    const shown = resolveCosmetics(current, row);
    for (const slot of SLOTS) {
      const label = doc.createElement('p');
      label.className = 'kit-title cosmetic-title';
      label.textContent = SLOT_LABELS[slot];
      const group = doc.createElement('div');
      group.className = 'cosmetic-row';
      group.setAttribute('role', 'radiogroup');
      group.setAttribute('aria-label', SLOT_LABELS[slot]);
      group.dataset.slot = slot;
      for (const it of CATALOG[slot]) {
        const b = doc.createElement('button');
        b.type = 'button';
        b.setAttribute('role', 'radio');
        b.dataset.id = it.id;
        const open = isUnlocked(it, row);
        b.setAttribute('aria-checked', String(shown[slot] === it.id));
        b.disabled = !open;
        b.className = `cosmetic ${open ? '' : 'locked'}`.trim();
        b.title = open ? it.name : unlockText(it, row);
        if (slot === 'badge') b.textContent = it.glyph ? `${it.glyph} ${it.name}` : it.name;
        else { b.textContent = it.name; if (it.hex) b.style.setProperty('--swatch', it.hex); b.classList.add('swatch'); }
        if (!open) b.append(Object.assign(doc.createElement('small'), { textContent: ` ${unlockText(it, row)}` }));
        b.addEventListener('click', () => { if (!open) return; current = { ...current, [slot]: it.id }; paint(); onPick({ ...current }); });
        group.append(b);
      }
      root.append(label, group);
    }
  };
  paint();
  return {
    setStats(r) { row = r ?? null; paint(); },
    setResolved(cs) { if (cs) { current = { ...current, ...sanitizeWish(cs) }; paint(); } },
    get current() { return { ...current }; },
  };
}
