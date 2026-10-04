// In-match progression: XP, levels, perk offers (docs/SPEC.md section 25, D-023). Pure.

export const XP = Object.freeze({ kill: 100, assist: 50, damagePer10: 1, damageCapPerVictim: 10, pickup: 10, assistWindowMs: 10_000 });
export const LEVELS = Object.freeze([0, 100, 250, 500, 850]); // xp needed for level 1..5
export const MAX_LEVEL = LEVELS.length;

export const PERKS = Object.freeze({
  faster_reload: Object.freeze({ id: 'faster_reload', name: 'Fast Hands', blurb: 'Reload 20% faster', mods: { reloadMul: 0.8 } }),
  cooldown: Object.freeze({ id: 'cooldown', name: 'Overclocked', blurb: 'Ability cooldowns 20% shorter', mods: { cdMul: 0.8 } }),
  grenadier: Object.freeze({ id: 'grenadier', name: 'Grenadier', blurb: 'One more grenade each life', mods: { grenades: 1 } }),
  thick_skin: Object.freeze({ id: 'thick_skin', name: 'Thick Skin', blurb: 'Take 10% less damage', mods: { dmgTakenMul: 0.9 } }),
  quick_switch: Object.freeze({ id: 'quick_switch', name: 'Quick Draw', blurb: 'Switch weapons twice as fast', mods: { switchMul: 0.5 } }),
});
export const PERK_IDS = Object.freeze(Object.keys(PERKS));

export function newProgress() {
  return { xp: 0, level: 1, perks: [], offer: null, mods: { reloadMul: 1, cdMul: 1, grenades: 0, dmgTakenMul: 1, switchMul: 1 }, dmgDealt: new Map(), hitBy: new Map() };
}

export function levelFor(xp) {
  let lvl = 1;
  for (let i = 1; i < LEVELS.length; i++) if (xp >= LEVELS[i]) lvl = i + 1;
  return lvl;
}

// Adds XP; when the level rises and no offer is pending, offers two distinct perks not yet taken. Returns { leveled, offer }.
export function grantXp(pr, amount, random) {
  pr.xp += amount;
  const lvl = levelFor(pr.xp);
  let leveled = false;
  if (lvl > pr.level) {
    pr.pendingOffers = (pr.pendingOffers ?? 0) + (lvl - pr.level);
    pr.level = lvl;
    leveled = true;
  }
  if (!pr.offer && (pr.pendingOffers ?? 0) > 0) {
    const pool = PERK_IDS.filter((id) => !pr.perks.includes(id));
    if (pool.length >= 2) {
      const i = Math.min(pool.length - 1, Math.floor(random() * pool.length));
      const first = pool.splice(i, 1)[0];
      const j = Math.min(pool.length - 1, Math.floor(random() * pool.length));
      pr.offer = [first, pool[j]];
    }
    pr.pendingOffers -= 1;
  }
  return { leveled, offer: pr.offer };
}

// Picks a perk from the current offer. Returns the perk or null when the pick is not allowed.
export function pickPerk(pr, id) {
  if (!pr.offer || !pr.offer.includes(id)) return null;
  const perk = PERKS[id];
  pr.perks.push(id);
  pr.offer = null;
  for (const [k, v] of Object.entries(perk.mods)) pr.mods[k] = k === 'grenades' ? pr.mods[k] + v : pr.mods[k] * v;
  return perk;
}

// Damage bookkeeping for assists: who hurt the victim and when, plus capped damage XP for the attacker.
export function recordDamage(attackerPr, victimPr, attackerId, victimId, amount, nowMs) {
  if (amount <= 0 || attackerId === victimId) return 0;
  victimPr.hitBy.set(attackerId, nowMs);
  const given = attackerPr.dmgDealt.get(victimId) ?? 0;
  const xp = Math.min(XP.damageCapPerVictim - given, Math.floor(amount / 10) * XP.damagePer10);
  if (xp <= 0) return 0;
  attackerPr.dmgDealt.set(victimId, given + xp);
  return xp;
}

// Assist ids for a kill: everyone else who damaged the victim within the window. Clears the victim's book.
export function assistsFor(victimPr, killerId, nowMs) {
  const out = [];
  for (const [id, t] of victimPr.hitBy) if (id !== killerId && nowMs - t <= XP.assistWindowMs) out.push(id);
  victimPr.hitBy.clear();
  return out;
}

export const progressSnapshot = (pr) => ({ xp: pr.xp, lvl: pr.level, ...(pr.offer ? { offer: pr.offer } : {}), ...(pr.perks.length ? { perks: pr.perks } : {}) });
