import * as THREE from 'three';
import { MAP } from '../shared/map.js';

// Builds the Three.js world. Rendering only; no game rules live here.
export function createScene(canvas) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x87a7c4);
  scene.fog = new THREE.Fog(0x87a7c4, 30, 110);

  const camera = new THREE.PerspectiveCamera(80, 1, 0.05, 300);
  camera.rotation.order = 'YXZ'; // yaw first, then pitch: matches shared/hitscan.js aimDir

  scene.add(new THREE.HemisphereLight(0xffffff, 0x445566, 1.1));
  const sun = new THREE.DirectionalLight(0xffffff, 1.4);
  sun.position.set(20, 40, 10);
  scene.add(sun);

  const size = MAP.half * 2;
  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(size, size),
    new THREE.MeshStandardMaterial({ color: 0x3a4652 }),
  );
  floor.rotation.x = -Math.PI / 2;
  scene.add(floor);
  const grid = new THREE.GridHelper(size, MAP.half, 0x66788a, 0x4a5866);
  grid.position.y = 0.01;
  scene.add(grid);

  MAP.boxes.forEach((b, i) => {
    const w = b.max[0] - b.min[0];
    const h = b.max[1] - b.min[1];
    const d = b.max[2] - b.min[2];
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(w, h, d),
      new THREE.MeshStandardMaterial({ color: new THREE.Color().setHSL(0.58, 0.15, 0.35 + (i % 4) * 0.06) }),
    );
    mesh.position.set(b.min[0] + w / 2, b.min[1] + h / 2, b.min[2] + d / 2);
    scene.add(mesh);
  });

  function resize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  window.addEventListener('resize', resize);
  resize();

  return { THREE, renderer, scene, camera };
}
