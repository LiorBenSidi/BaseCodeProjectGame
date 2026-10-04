// Kit picker (menu), ability chips, XP bar and perk offer (SPEC 24.6 / 25.4). Pure helpers plus small DOM glue.
import { KITS, KIT_IDS, ABILITIES, DEFAULT_KIT } from '../shared/abilities.js';
import { PERKS, LEVELS, MAX_LEVEL } from '../shared/progression.js';

export const KIT_STORAGE_KEY = 'bca.kit';

export function loadKit(storage) {
  try {
    const v = storage?.getItem(KIT_STORAGE_KEY);
    return KIT_IDS.includes(v) ? v : DEFAULT_KIT;
  } catch {
    return DEFAULT_KIT;
  }
}

export function saveKit(storage, id) {
  try { storage?.setItem(KIT_STORAGE_KEY, id); } catch { /* private mode */ }
}

// Ability chip model: { name, key, ready, frac (0 ready .. 1 full cooldown), secs }.
export function deriveAbilityChips(kitId, cd = [0, 0]) {
  const kit = KITS[kitId] ?? KITS[DEFAULT_KIT];
  return kit.abilities.map((aid, i) => {
    const a = ABILITIES[aid];
    const left = Math.max(0, cd[i] ?? 0);
    return { id: aid, name: a.name, key: i === 0 ? 'Q' : 'E', ready: left === 0, frac: Math.min(1, left / a.cooldownMs), secs: Math.ceil(left / 1000) };
  });
}

// XP bar model: { lvl, frac (0..1 toward the next level), label }.
export function deriveXpBar(self) {
  const lvl = self?.lvl ?? 1;
  const xp = self?.xp ?? 0;
  if (lvl >= MAX_LEVEL) return { lvl, frac: 1, label: `LVL ${lvl}  MAX` };
  const lo = LEVELS[lvl - 1];
  const hi = LEVELS[lvl];
  return { lvl, frac: Math.max(0, Math.min(1, (xp - lo) / (hi - lo))), label: `LVL ${lvl}  ${xp} / ${hi} XP` };
}

export const perkCards = (offer) => (offer ?? []).map((id, i) => ({ id, key: String(i + 3), name: PERKS[id]?.name ?? id, blurb: PERKS[id]?.blurb ?? '' }));

// Fills the kit radio group in the menu. `onPick(id)` fires on change.
export function renderKitPicker(root, selected, onPick) {
  if (!root) return;
  root.replaceChildren(...KIT_IDS.map((id) => {
    const k = KITS[id];
    const label = document.createElement('label');
    label.className = `kit-card${id === selected ? ' on' : ''}`;
    const input = document.createElement('input');
    input.type = 'radio'; input.name = 'kit'; input.value = id; input.checked = id === selected;
    input.addEventListener('change', () => {
      root.querySelectorAll('.kit-card').forEach((el) => el.classList.toggle('on', el.contains(input)));
      onPick(id);
    });
    const name = document.createElement('strong'); name.textContent = k.name;
    const blurb = document.createElement('span'); blurb.className = 'kit-blurb'; blurb.textContent = k.blurb;
    const abil = document.createElement('span'); abil.className = 'kit-abilities';
    abil.textContent = k.abilities.map((a, i) => `${i === 0 ? 'Q' : 'E'} ${ABILITIES[a].name}`).join('  ');
    label.append(input, name, blurb, abil);
    return label;
  }));
}
