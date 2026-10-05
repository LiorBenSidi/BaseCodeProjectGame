// Combat visuals (SPEC 30.6): muzzle flash lights, impact sparks and a brief explosion light. Pooled and capped so a
// busy fight cannot grow the scene. Display only; game.js feeds it the replicated shot / boom messages.
import * as THREE from 'three';

export const FX_CAPS = Object.freeze({ flashes: 6, sparks: 24, flashMs: 70, sparkMs: 320, boomMs: 260 });

export class CombatFx {
  #scene;
  #flashes = [];
  #sparks = [];
  #sparkMat = new THREE.SpriteMaterial({ color: 0xffd27a, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });

  constructor(scene) {
    this.#scene = scene;
    for (let i = 0; i < FX_CAPS.flashes; i++) {
      const light = new THREE.PointLight(0xffc070, 0, 9, 2);
      light.visible = false;
      scene.add(light);
      this.#flashes.push({ light, until: 0 });
    }
    for (let i = 0; i < FX_CAPS.sparks; i++) {
      const sprite = new THREE.Sprite(this.#sparkMat.clone());
      sprite.visible = false;
      sprite.scale.set(0.3, 0.3, 1);
      scene.add(sprite);
      this.#sparks.push({ sprite, until: 0, born: 0, vy: 0 });
    }
  }

  // A shot from `from` toward `to`: flash at the muzzle, sparks at the impact point.
  shot(from, to, now, mine = false) {
    const f = this.#flashes.find((x) => now >= x.until) ?? this.#flashes[0];
    f.light.position.set(from[0], from[1], from[2]);
    f.light.intensity = mine ? 10 : 14;
    f.light.visible = true;
    f.until = now + FX_CAPS.flashMs;
    for (let i = 0; i < 3; i++) {
      const s = this.#sparks.find((x) => now >= x.until) ?? this.#sparks[0];
      s.sprite.position.set(to[0] + (Math.random() - 0.5) * 0.3, to[1] + (Math.random() - 0.5) * 0.3, to[2] + (Math.random() - 0.5) * 0.3);
      s.sprite.material.opacity = 1;
      s.sprite.visible = true;
      s.born = now;
      s.until = now + FX_CAPS.sparkMs;
      s.vy = 1.5 + Math.random();
    }
  }

  // SPEC 38.3: a clash: a white-blue spark where the blades met, shorter and brighter than a boom
  clash(at, now) {
    const f = this.#flashes.find((x) => now >= x.until) ?? this.#flashes[0];
    f.light.position.set(at[0], at[1], at[2]);
    f.light.color.setHex(0xcfe6ff);
    f.light.intensity = 60;
    f.light.distance = 10;
    f.light.visible = true;
    f.until = now + 120;
  }

  boom(at, now) {
    const f = this.#flashes.find((x) => now >= x.until) ?? this.#flashes[0];
    f.light.position.set(at[0], at[1] + 0.5, at[2]);
    f.light.color.setHex(0xff9a40);
    f.light.intensity = 40;
    f.light.distance = 18;
    f.light.visible = true;
    f.until = now + FX_CAPS.boomMs;
  }

  update(now) {
    for (const f of this.#flashes) {
      if (!f.light.visible) continue;
      if (now >= f.until) { f.light.visible = false; f.light.color.setHex(0xffc070); f.light.distance = 9; continue; }
      f.light.intensity *= 0.8; // flicker down
    }
    for (const s of this.#sparks) {
      if (!s.sprite.visible) continue;
      if (now >= s.until) { s.sprite.visible = false; continue; }
      const t = (now - s.born) / FX_CAPS.sparkMs;
      s.sprite.material.opacity = 1 - t;
      s.sprite.position.y += (s.vy - 4 * t) * 0.016;
    }
  }
}
