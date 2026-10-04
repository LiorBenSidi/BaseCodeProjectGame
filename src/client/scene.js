import * as THREE from 'three';
import { MAP } from '../shared/map.js';
import { SKY, FOG, SUN, HEMI, FILL, FLOOR, GRID, boxMaterialParams, skyColorAt, shadowMapSizeFor } from './arenaStyle.js';

// Builds the Three.js world. Rendering only; no game rules live here. The look is decided in
// arenaStyle.js (docs/SPEC.md section 19.3); this file only turns those numbers into objects.

function buildSky() {
  const geometry = new THREE.SphereGeometry(SKY.radius, 24, 16);
  const pos = geometry.attributes.position;
  const colors = new Float32Array(pos.count * 3);
  const c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const [r, g, b] = skyColorAt(pos.getY(i) / SKY.radius);
    c.setRGB(r, g, b, THREE.SRGBColorSpace); // vertex colors are not color managed: convert like a material color
    colors[i * 3] = c.r; colors[i * 3 + 1] = c.g; colors[i * 3 + 2] = c.b;
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  const material = new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, fog: false, depthWrite: false });
  const sky = new THREE.Mesh(geometry, material);
  sky.renderOrder = -1;
  return sky;
}

export function createScene(canvas) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.15;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(SKY.horizon);
  scene.fog = new THREE.Fog(FOG.color, FOG.near, FOG.far);
  scene.add(buildSky());

  const camera = new THREE.PerspectiveCamera(80, 1, 0.05, 300);
  camera.rotation.order = 'YXZ'; // yaw first, then pitch: matches shared/hitscan.js aimDir

  scene.add(new THREE.HemisphereLight(HEMI.sky, HEMI.ground, HEMI.intensity));
  const sun = new THREE.DirectionalLight(SUN.color, SUN.intensity);
  sun.position.set(...SUN.position);
  sun.castShadow = true;
  const shadowSize = shadowMapSizeFor(window.innerWidth, window.innerHeight);
  sun.shadow.mapSize.set(shadowSize, shadowSize);
  sun.shadow.camera.left = -SUN.shadowExtent;
  sun.shadow.camera.right = SUN.shadowExtent;
  sun.shadow.camera.top = SUN.shadowExtent;
  sun.shadow.camera.bottom = -SUN.shadowExtent;
  sun.shadow.camera.near = SUN.shadowNear;
  sun.shadow.camera.far = SUN.shadowFar;
  sun.shadow.bias = SUN.shadowBias;
  sun.shadow.normalBias = SUN.shadowNormalBias;
  scene.add(sun, sun.target);
  const fill = new THREE.DirectionalLight(FILL.color, FILL.intensity);
  fill.position.set(...FILL.position);
  scene.add(fill);

  // SPEC 28: the arena (floor, grid, boxes) lives in one group so a map change can rebuild it.
  let arena = buildArena(MAP);
  scene.add(arena);
  const setMap = (map) => {
    scene.remove(arena);
    arena.traverse((o) => { o.geometry?.dispose?.(); o.material?.dispose?.(); });
    arena = buildArena(map ?? MAP);
    scene.add(arena);
  };

  function buildArena(map) {
  const group = new THREE.Group();
  const size = map.half * 2;
  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(size, size),
    new THREE.MeshStandardMaterial({ color: FLOOR.color, roughness: FLOOR.roughness, metalness: FLOOR.metalness }),
  );
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  group.add(floor);
  const grid = new THREE.GridHelper(size, map.half, GRID.center, GRID.line);
  grid.material.transparent = true;
  grid.material.opacity = GRID.opacity;
  grid.position.y = 0.01;
  group.add(grid);

  map.boxes.forEach((b, i) => {
    const w = b.max[0] - b.min[0];
    const h = b.max[1] - b.min[1];
    const d = b.max[2] - b.min[2];
    const p = boxMaterialParams(i);
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(w, h, d),
      new THREE.MeshStandardMaterial({
        color: new THREE.Color().setHSL(p.color.h, p.color.s, p.color.l), roughness: p.roughness, metalness: p.metalness,
      }),
    );
    mesh.position.set(b.min[0] + w / 2, b.min[1] + h / 2, b.min[2] + d / 2);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
  });
  return group;
  }

  function resize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  window.addEventListener('resize', resize);
  resize();

  return { THREE, renderer, scene, camera, setMap };
}
