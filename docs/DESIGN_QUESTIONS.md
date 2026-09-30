# Design question bank

Every design decision that is **not** made yet lives here as a question. The assistant must ask them (in Discuss
mode, a few at a time, by topic), never guess an answer, and record each decision in `docs/DESIGN.md`.
Ask follow-ups whenever an answer opens a new question. More questions are always better than fewer.
For each question offer 2-4 concrete options with a recommendation and its trade-off, plus "something else".

## Interview order and tiers
The bank is large on purpose, so it is asked in tiers, never as one list. Any question may be **parked**: the answer is
recorded as parked with a sensible default and a trigger to revisit, and the interview moves on.

| Tier | What | Questions |
|---|---|---|
| 1 - anchors (ask first) | The few answers that shape everything else | R2 (minimum lovable game), R1 (priorities), V1, V2, V4, V10, E5 (budget and time), T1 (browser-first) |
| 2 - core design | What the game is and how it plays | G, M, W, MV, MP, S, A, UI |
| 3 - supporting | Feel, social and progression | AU, C, N, SO, P, E (rest), V (rest) |
| 4 - technical, legal, operations | Offer a recommended default and ask only "accept the default?" | AC, T (rest), Q, L, O, R (rest) |

A few questions have no safe default and are always asked in full, even in tier 4: T5 (TypeScript), R3 (first milestone), R5 (worries), V11 (name).

Before asking anything, check `docs/DESIGN.md`: never re-ask what is already decided or parked.

## V. Vision and audience
- V1. In one sentence, what is this game? What should a player say about it after their first match?
- V2. Who is it for: friends, a public audience, a class project, a portfolio piece, a business?
- V3. Which existing games are closest in feel? Which parts of them do you love, and which do you want to avoid?
- V4. Casual and quick, or competitive and skill-heavy? Where on that line?
- V5. How long is one session? One match? Should someone be able to play for 5 minutes?
- V6. What is the single most important feeling: speed, tension, teamwork, humour, mastery, spectacle?
- V7. Tone: serious, comedic, dark, colourful, retro, realistic?
- V8. Age rating goal (violence level, blood, language)? Any content you refuse to include?
- V9. What would make you consider this project a success in 3 months? In a year?
- V10. Is this meant to be released publicly, or stay private/demo?
- V11. Working title and name ideas? Is "Base Code Arena" the real name?
- V12. Languages: English only, or also Hebrew (right-to-left UI) and others?

## S. Story, setting and world
- S1. Does the game need a story at all, or just a setting?
- S2. Setting: sci-fi, modern military, fantasy, post-apocalyptic, cartoon, abstract, something unusual?
- S3. Who are the players in the fiction (soldiers, robots, gladiators, students, animals)?
- S4. Why are they fighting? Is there a factions/teams story?
- S5. How is story delivered: lore text, loading screens, map details, cutscenes, dialogue, none?
- S6. Are there named characters, and are they playable classes or just cosmetics?
- S7. Single-player campaign, co-op missions or story events, ever? Now or later?
- S8. Should the world evolve (seasons, events, updates that change the lore)?
- S9. Any real-world references, in-jokes or personal touches you want in the game?

## G. Core gameplay
- G1. Time-to-kill: how many hits to eliminate someone (1, 2-3, 4-6, more)?
- G2. Hit-scan only, or also projectiles, grenades, melee, abilities?
- G3. Health model: regenerating, fixed with pickups, armour, shields?
- G4. Is there friendly fire, and is it ever on?
- G5. Respawn: instant, timer (now 3 s), wave-based, limited lives?
- G6. Aim assist or sensitivity presets for accessibility?
- G7. Do you want classes/loadouts, or is everyone identical and skill-only?
- G8. Special abilities (dash, shield, scan)? Ultimate abilities?
- G9. Spectating after death, kill-cam, replays?
- G10. What are the top three things that must feel great in the first 10 seconds?
- G11. Should there be any randomness (spread, crits, item drops), or is it fully deterministic skill?
- G12. Is there a stamina or sprint mechanic? Crouch? Prone? Lean?

## M. Game modes and match rules
- M1. Which modes at launch: deathmatch, team deathmatch, capture the flag, king of the hill, last-man-standing, other?
- M2. Score limit, time limit, or both? Match length target?
- M3. Team size and counts (1v1, 2v2, 4v4, free-for-all up to 16)? Teams balanced automatically?
- M4. What happens when a match ends: results screen, rematch vote, back to lobby, next map rotation?
- M5. Can players join a match already in progress? Leave and rejoin?
- M6. Private matches with invite codes or links? Custom rules?
- M7. Practice/tutorial/bot mode for one person? Bots to fill empty slots?
- M8. Ranked or casual queues? Or no ranking?
- M9. Any limited-time or event modes planned?

## W. Weapons and items
- W1. How many weapons at launch, and which archetypes (rifle, pistol, shotgun, sniper, SMG, launcher, melee)?
- W2. Realistic or arcade handling? Recoil patterns, bullet drop, reload times?
- W3. Ammo: unlimited, limited with pickups, reloading only?
- W4. Do players choose weapons before spawning, or pick them up on the map?
- W5. Pickups: health, armour, ammo, power-ups? Respawn timers?
- W6. Headshot or body-part multipliers?
- W7. Damage falloff over distance?
- W8. Weapon customisation (skins, attachments)? Cosmetic only, or does it change stats?
- W9. Throwables and gadgets?
- W10. Kill feed style: names only, weapon icons, streaks?

## MV. Movement and feel
- MV1. Movement speed and jump height: keep current values (7 m/s, 8 m/s jump), or faster and floatier?
- MV2. Advanced movement: bunny-hopping, sliding, wall-running, double jump, grappling?
- MV3. Fall damage?
- MV4. Camera: field of view default and adjustable? Head-bob, screen shake, motion blur options?
- MV5. Third-person view or first-person only? Visible arms/weapon in first person?
- MV6. Footstep and movement noise: does it give away position?

## MP. Maps and levels
- MP1. How many maps at launch? Sizes (tiny arena, medium, large)?
- MP2. Map style: symmetrical competitive, sprawling, vertical, indoor, outdoor?
- MP3. Hand-made by us, or generated? Community-made maps and an editor someday?
- MP4. Hazards, moving platforms, destructible objects, doors, teleporters?
- MP5. Day/night, weather, lighting mood?
- MP6. Map voting and rotation rules?
- MP7. Do you have reference images or games for how the first map should look?

## A. Art direction and visuals
- A1. Art style: low-poly, voxel, cartoon, realistic, stylised, pixel, neon/synthwave?
- A2. Colour palette and mood references (please share images or links)?
- A3. Character look: robots, humans, animals, customisable avatars? Team colours?
- A4. Who makes the assets: generated, free asset packs, hand-made, hired? Any licence restrictions?
- A5. Visual effects: muzzle flash, bullet tracers, hit sparks, blood or a non-gore alternative?
- A6. Graphics quality settings and target hardware (laptops, phones, high-end)?
- A7. Logo, splash screen, loading screen style?

## AU. Audio
- AU1. Music: yes/no, style, dynamic during fights, per map?
- AU2. Sound effects style (realistic, sci-fi, comedic)? Positional 3D audio?
- AU3. Voice lines or announcer ("Double kill!")?
- AU4. In-game voice chat or text chat? Push-to-talk? Proximity or team?
- AU5. Sound sources: free libraries, generated, recorded?

## UI. Interface and HUD
- UI1. HUD layout preferences: minimal or rich? Minimap? Compass? Damage direction indicators?
- UI2. Crosshair styles, colours, customisation?
- UI3. Scoreboard columns (kills, deaths, assists, ping, score)?
- UI4. Menu flow: main menu, lobby, settings, profile, store? Sketch or describe the ideal flow.
- UI5. Settings to include: sensitivity, key rebinding, volume, graphics, FOV, colour-blind modes?
- UI6. Mobile/touch UI, controller support, or desktop keyboard-and-mouse only?
- UI7. Notifications and toasts: kill feed, achievements, system messages?
- UI8. Tutorials: onboarding screens, tooltips, first-match hints?

## C. Controls and accessibility
- C1. Default key bindings ok (WASD, Space, mouse, click, Tab, Esc)? Anything to change?
- C2. Left-handed or alternative layouts? Gamepad mapping?
- C3. Accessibility: colour-blind modes, subtitles, reduced motion, large text, toggle vs hold actions?
- C4. Photosensitivity: flashing effects to limit?

## N. Multiplayer and networking
- N1. Target concurrent players per match (now max 16) and total concurrent players overall?
- N2. Where are your players (Israel, Europe, worldwide)? Single server region or several?
- N3. Latency tolerance: what ping should still feel fair? Show ping in the HUD?
- N4. Joining: quick-play button, server browser, invite links, friends list?
- N5. Reconnect after a dropped connection: how long is the slot held?
- N6. AFK/idle kick rules? Rage-quit penalties?
- N7. Anonymous guests allowed, or login required to play?
- N8. Cross-platform play (desktop, mobile)?
- N9. Cheating: how strict? Are you willing to accept some server strictness that occasionally hurts honest players?
- N10. Spectator mode and streaming-friendly features?

## SO. Social and community
- SO1. Friends, parties, clans/teams?
- SO2. Chat moderation: profanity filter, mute, report, block, admin tools?
- SO3. Player names: unique handles, display names, real names, profile pictures?
- SO4. Emotes, sprays, taunts?
- SO5. Community channels (Discord, forum)? Who moderates?
- SO6. Leaderboards: global, weekly, per mode, friends only?

## P. Progression and rewards
- P1. Is there progression at all (levels, XP, unlocks), or every match is a clean slate?
- P2. What do players unlock: cosmetics only, weapons, maps, titles?
- P3. Achievements, challenges, daily missions, battle pass?
- P4. Stats to track per player (K/D, accuracy, time played, favourite weapon)?
- P5. Rank system design and seasons, if any?
- P6. Do you want to avoid pay-to-win entirely?

## E. Economy and business
- E1. Free, paid, ads, in-app purchases, or none of these?
- E2. If monetised: what may be sold (cosmetics only)? What is off limits?
- E3. Payment provider and legal entity, if ever needed?
- E4. Currency system (soft/hard currency), drops, trading, or none?
- E5. Budget and time available: hours per week, deadline, milestones?
- E6. Who else works on this (art, sound, testing)? Team roles and decision-makers?

## AC. Accounts, privacy and data
- AC1. Sign-in methods: none, email, Google, Base44 auth?
- AC2. What data may be stored per player and for how long?
- AC3. Minimum age, parental consent, children's privacy rules?
- AC4. Data deletion and export on request?
- AC5. Analytics and crash reporting: allowed? Opt-in or opt-out?
- AC6. Privacy policy and terms: who writes them?

## T. Platform and technology
- T1. Confirm the goal is browser-first. Any wish for mobile browsers, an installable app (PWA), or a desktop wrapper?
- T2. Minimum browser and hardware you want to support?
- T3. Where should the production game server live (Base Code is a preview only)? Preferences, budget, region?
- T4. Domain name: do you have one? Subdomain plan?
- T5. Are you open to the TypeScript migration described in `docs/adr/0003-typescript-migration.md`, and when?
- T6. Should C++/WebAssembly be considered if performance requires it, or is it off the table?
- T7. Which Base44 backend features (entities, functions, auth, agents) do you want to use, if any, versus our own server?
- T8. Save data and settings: local only, or synced to an account?
- T9. Any technologies you refuse to use, or must use?

## Q. Quality, performance and testing
- Q1. Target frame rate on your reference machine and on a low-end laptop?
- Q2. Maximum acceptable load time?
- Q3. How much bandwidth per player is acceptable (mobile data)?
- Q4. Definition of "done" for a feature: what must be true before you accept it?
- Q5. How do you want to playtest: friends, a private group, public alpha? How will you collect feedback?
- Q6. Which bugs are release-blockers versus acceptable at launch?
- Q7. Do you want automated load tests with a target of N simultaneous players?

## L. Legal and safety
- L1. Licences: the project's own licence, and rules for third-party assets and music?
- L2. Trademark concerns with names, weapons or characters inspired by other games?
- L3. Content rules for chat and names; how to handle harassment reports?
- L4. Regional restrictions (age ratings, loot-box laws, gambling rules) that matter to you?

## O. Operations and live service
- O1. Update cadence: continuous, weekly, seasonal?
- O2. Server monitoring and alerts: who gets paged, how?
- O3. Backups, incident response, downtime windows?
- O4. Player support channel and response expectations?
- O5. Changelog and patch notes: where and how?

## R. Roadmap and priorities
- R1. Rank these by importance to you: netcode quality, gameplay depth, visuals, content amount, security, launch speed.
- R2. What is the smallest version you would be proud to show someone? (a "minimum lovable game")
- R3. What is the first milestone date, and what must it include?
- R4. Which of the roadmap phases (`docs/ROADMAP.md`) would you reorder, cut or add to?
- R5. What are you most worried about in this project?
