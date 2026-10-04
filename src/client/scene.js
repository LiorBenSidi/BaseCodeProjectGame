import * as THREE from 'three';
import { MAP } from '../shared/map.js';
import { GRID, shadowMapSizeFor } from './arenaStyle.js';
import { themeFor, surfaceKindFor, tileRepeat, qualityTierFor, QUALITY_SETTINGS } from './themes.js';
import { surfaceMaterial } from './textures.js';
import { buildProps } from './props.js';
import { createPost } from './post.js';
import { getQuality } from './settings.js';

// Builds the Three.js world. Rendering only; no game rules live here. Each map's look comes from themes.js
// (SPEC 30, D-027); the base numbers for team colors and name tags stay in arenaStyle.js (SPEC 19.3).

function skyColorAt(theme, h) {
  const k = Math.min(1, Math.max(0, h));
  const e = k * k * (3 - 2 * k);
  const a = new THREE.Color(theme.sky.horizon), b = new THREE.Color(theme.sky.zenith);
  return a.lerp(b, e);
}

// SPEC 30.3: a vertex colored dome with a sun disc, graded per theme; cheaper than an HDRI and offline.
function buildSky(theme) {
  const radius = 240;
  const geometry = new THREE.SphereGeometry(radius, 32, 20);
  const pos = geometry.attributes.position;
  const colors = new Float32Array(pos.count * 3);
  const sunDir = new THREE.Vector3(...theme.sky.sunDir).normalize();
  const sunColor = new THREE.Color(theme.sky.sun);
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.set(pos.getX(i), pos.getY(i), pos.getZ(i)).normalize();
    const c = skyColorAt(theme, Math.max(0, v.y));
    const d = Math.max(0, v.dot(sunDir));
    c.lerp(sunColor, Math.pow(d, 48) * 0.9 + Math.pow(d, 6) * 0.12); // disc plus halo
    c.convertSRGBToLinear();
    colors[i * 3] = c.r; colors[i * 3 + 1] = c.g; colors[i * 3 + 2] = c.b;
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  const material = new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, fog: false, depthWrite: false });
  const sky = new THREE.Mesh(geometry, material);
  sky.renderOrder = -1;
  return sky;
}

export function createScene(canvas) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(80, 1, 0.05, 300);
  camera.rotation.order = 'YXZ'; // yaw first, then pitch: matches shared/hitscan.js aimDir

  const post = createPost(renderer, scene, camera);
  const auto = qualityTierFor({
    isTouch: typeof navigator !== 'undefined' && navigator.maxTouchPoints > 0,
    dpr: window.devicePixelRatio || 1, width: window.innerWidth, height: window.innerHeight,
    cores: navigator.hardwareConcurrency ?? 4, memoryGb: navigator.deviceMemory ?? 8,
  });
  let quality = getQuality() ?? auto;
  post.setQuality(quality);

  // lights are rebuilt per theme
  const lights = new THREE.Group();
  scene.add(lights);
  let sky = null;
  let arena = null;
  let props = null;
  let theme = themeFor(MAP.id);

  function buildLights(t) {
    lights.clear();
    lights.add(new THREE.HemisphereLight(t.hemi.sky, t.hemi.ground, t.hemi.intensity));
    const sun = new THREE.DirectionalLight(t.sun.color, t.sun.intensity);
    sun.position.set(...t.sun.position);
    sun.castShadow = QUALITY_SETTINGS[quality].shadows;
    const shadowSize = Math.min(QUALITY_SETTINGS[quality].shadowMap, shadowMapSizeFor(window.innerWidth, window.innerHeight));
    sun.shadow.mapSize.set(shadowSize, shadowSize);
    const extent = 48;
    sun.shadow.camera.left = -extent; sun.shadow.camera.right = extent;
    sun.shadow.camera.top = extent; sun.shadow.camera.bottom = -extent;
    sun.shadow.camera.near = 1; sun.shadow.camera.far = 160;
    sun.shadow.bias = -0.0006; sun.shadow.normalBias = 0.02;
    lights.add(sun, sun.target);
    const fill = new THREE.DirectionalLight(t.fill.color, t.fill.intensity);
    fill.position.set(...t.fill.position);
    lights.add(fill);
  }

  function buildArena(map, t) {
    const q = QUALITY_SETTINGS[quality];
    const group = new THREE.Group();
    const size = map.half * 2;
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(size, size), surfaceMaterial(t.floor.surface, t.floor.color, tileRepeat(size, size, t.floor.tile), q.textureSize));
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    group.add(floor);
    if (t.grid.opacity > 0) {
      const grid = new THREE.GridHelper(size, map.half, GRID.center, GRID.line);
      grid.material.transparent = true;
      grid.material.opacity = t.grid.opacity;
      grid.position.y = 0.01;
      group.add(grid);
    }
    map.boxes.forEach((b, i) => {
      const w = b.max[0] - b.min[0], h = b.max[1] - b.min[1], d = b.max[2] - b.min[2];
      const kind = surfaceKindFor(b, i);
      const s = t[kind];
      // SPEC 30.2: world sized tiling; sides and top get their own repeat so tall walls do not stretch
      const side = surfaceMaterial(s.surface, s.color, tileRepeat(Math.max(w, d), h, s.tile), q.textureSize);
      const top = surfaceMaterial(s.surface, s.color, tileRepeat(w, d, s.tile), q.textureSize);
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), [side, side, top, top, side, side]);
      mesh.position.set(b.min[0] + w / 2, b.min[1] + h / 2, b.min[2] + d / 2);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      group.add(mesh);
    });
    return group;
  }

  const dispose = (root) => root?.traverse((o) => {
    o.geometry?.dispose?.();
    const mats = Array.isArray(o.material) ? o.material : o.material ? [o.material] : [];
    for (const m of mats) { m.map?.dispose?.(); m.roughnessMap?.dispose?.(); m.dispose?.(); }
  });

  function setMap(map) {
    const m = map ?? MAP;
    theme = themeFor(m.id);
    if (sky) { scene.remove(sky); dispose(sky); }
    if (arena) { scene.remove(arena); dispose(arena); }
    if (props) { scene.remove(props); dispose(props); }
    scene.background = new THREE.Color(theme.sky.horizon);
    scene.fog = new THREE.Fog(theme.fog.color, theme.fog.near, theme.fog.far);
    renderer.toneMappingExposure = theme.exposure;
    sky = buildSky(theme);
    arena = buildArena(m, theme);
    props = QUALITY_SETTINGS[quality].props ? buildProps(m, theme, QUALITY_SETTINGS[quality]) : new THREE.Group();
    buildLights(theme);
    scene.add(sky, arena, props);
    scene.userData.map = m;
  }

  function setQuality(tier) {
    quality = QUALITY_SETTINGS[tier] ? tier : auto;
    post.setQuality(quality);
    setMap(scene.userData.map ?? MAP);
  }

  function resize() {
    const w = window.innerWidth, h = window.innerHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    post.resize(w, h);
  }
  window.addEventListener('resize', resize);
  setMap(MAP);
  resize();

  return { THREE, renderer, scene, camera, setMap, setQuality, render: () => post.render(), get quality() { return quality; }, get theme() { return theme; } };
}
