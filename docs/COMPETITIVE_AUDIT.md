# Competitive audit: Base Code Arena V1 against the browser FPS field

Date: 2026-10-04. Reference set: Krunker.io and Shell Shockers (the two browser FPS games most players
compare a new one with), Venge.io, plus the mainstream shooters whose conventions players bring with
them (Counter-Strike, Valorant, Call of Duty, Overwatch, Fortnite). Sources: public feature descriptions
and reviews of the browser games (classes, maps, weapon pickups, text chat, kill cams, kill streaks,
progression) and the genre conventions every FPS player expects (hit markers, kill feed, ADS, FOV
slider, footsteps, weapon view model, recoil). This file lists what the field has, what V1 has, and
what was added to close each gap. It is a checklist, not a design document; designs live in SPEC.md.

| Area | Field standard | V1 before this audit | Action |
| --- | --- | --- | --- |
| Movement | sprint, crouch, slide, jump, wall jump / parkour (Krunker) | sprint, crouch, slide, coyote jump, wall jump, mantle, grapple (SPEC 23 / 24) | parity, keep |
| Weapons | 5+ weapons, pickups on the map, reload, switch, recoil | rifle, SMG, shotgun, sniper, pistol, grenades, pickups, reload, switch, recoil (SPEC 20 / 21) | parity, keep |
| Aim | right-mouse ADS, sniper scope, FOV slider | none | added: SPEC 29.3 |
| Weapon view model | first-person gun with kick, reload and sway | none | added: SPEC 29.4 |
| Feedback | hit markers, damage direction, kill feed, kill confirm sound | all present (SPEC 19.1), sound since SPEC 28.3 | parity, keep |
| Streaks | kill streak and multi-kill announcements | none | added: SPEC 29.2 |
| Social | in-match text chat | none | added: SPEC 29.1 |
| Sound | shots, hits, footsteps, UI | shots, hits, UI (SPEC 28.3), no footsteps | added footsteps: SPEC 29.5 |
| Classes | Krunker: 11 classes with a weapon each | 4 kits with 2 abilities each, perks, in-match XP (SPEC 24 / 25) | parity in depth, fewer kits by design (unique layer is abilities) |
| Modes | FFA, TDM, often CTF / KOTH | DM, TDM (SPEC 22) | V1 parity; CTF is post-V1 |
| Maps | several maps, map rotation | Arena, Foundry, Crossfire with rotation (SPEC 28.1) | parity, more maps post-V1 |
| Rooms | public list, private rooms, join by code / link | lobby, quick play, create, join by id or link (SPEC 26) | parity, keep |
| Accounts | sign-in, lifetime stats, leaderboard | sign-in binding, PlayerStats, MatchResult, top 10 (SPEC 27) | parity, keep |
| Spectate | kill cam / follow killer while dead | respawn countdown only | post-V1 (3 s respawn keeps the gap small) |
| Cosmetics | skins, unlockables, daily challenges | none | post-V1 by design (no monetisation in V1) |
| Mobile | touch controls on phones | touch controls with auto / on / off (SPEC 19.4) | parity, keep |
| Bots | fill empty rooms (Venge) | none | post-V1 |
| Anti-cheat basics | server authority, rate limits, validation | server-authoritative hitscan, movement, abilities; token bucket; 4 KB frames; strikes (SPEC 5, 16) | parity or better |

Post-V1 backlog derived from this audit, in priority order: kill cam, a third mode (CTF or King of the
Hill), two more maps, bots for empty rooms, cosmetics tied to PlayerStats milestones.
