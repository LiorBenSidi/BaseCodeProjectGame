# Base Code Arena: Art Direction Style Guide

## 1. Vision and Mood Reference
- Visual Benchmark: High-rate browser multiplayer FPS (Krunker, Venge, Deadshot).
- Mood Reference: Call of Duty: Black Ops 6 (tactical, industrial, high-contrast combat zones).
- Core Principle: Readability First. Environment geometry, props, and textures provide mood and depth but must NEVER obscure enemy or teammate visibility.

## 2. Map Visual Themes and Lighting

### 2.1 Arena (Industrial Training Ground)
- Mood: Cool, clean, tactical proving grounds.
- Color Palette: Slate grey (#343e4b), cool blue-grey concrete, dark brushed steel trim.
- Lighting: Direct sunlight at 55 degree pitch (warm white 0xffe3c2), navy/slate sky ambient (0x9db1dc / 0x2a3140).
- Textures: Clean concrete floor, panelized steel wall materials.
- Props: Shipping crates, industrial barriers, floodlight poles.

### 2.2 Foundry (Heavy Industrial Complex)
- Mood: Gritty, high-heat metal refinery with two elevated decks and a sunken lane.
- Color Palette: Rusted iron (#4a3028), oxidized copper green (#2e4a3d), dark cast steel (#1f242d).
- Lighting: Low angled sun (0xffbd80), heavy orange fill, warm atmosphere.
- Textures: Rusted steel plates, industrial metal grate floor, dark brick walls.
- Props: Steel pipes, pressure tanks, oil barrels, industrial railings.

### 2.3 Crossfire (Desert Outpost)
- Mood: Arid, sun-bleached courtyard divided by heavy masonry walls.
- Color Palette: Sandstone tan (#d4b896), terracotta red (#8b4513), bleached concrete (#9e9484).
- Lighting: High noon harsh sun (0xfff0d0), bright desert fill, sharp cast shadows.
- Textures: Sandstone block walls, dry packed dirt / worn tile floor.
- Props: Wooden crates, sandbags, concrete barriers, metal drums.

## 3. Readability and Gameplay Invariants

### 3.1 Player Silhouettes and Team Colors
- Team Identification: Team Blue (#38bdf8) and Team Red (#f87171) emissive accents and name tags remain dominant over all background colors.
- Background Contrast: Environment material roughness and metallic settings are tuned to prevent extreme glare or specularity behind player characters.
- Silhouette Integrity: No props or clutter may extend into player spawn paths or obscure head-height sightlines unexpectedly.

### 3.2 Material Tiling and World Scale
- Tiling Rule: All materials use world-space UV repetition based on object bounding dimensions (1 unit = 1 meter).
- Uniform Scale: Textures must not stretch or distort on elongated walls or boxes.

### 3.3 Fallback Visual Hierarchy
- If PBR textures fail to load, materials fall back to deterministic flat colors (boxMaterialParams / FLOOR) without interrupting gameplay.
