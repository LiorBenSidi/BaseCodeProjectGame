// Post-processing (SPEC 30.5): render pass, subtle bloom, FXAA, output (ACES filmic tone mapping, sRGB).
// Quality tiers switch bloom and the pixel ratio; `low` renders straight without the composer.
import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { FXAAShader } from 'three/examples/jsm/shaders/FXAAShader.js';
import { QUALITY_SETTINGS } from './themes.js';

export const BLOOM = Object.freeze({ strength: 0.22, radius: 0.35, threshold: 0.85 });

export function createPost(renderer, scene, camera) {
  const composer = new EffectComposer(renderer);
  const renderPass = new RenderPass(scene, camera);
  const bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), BLOOM.strength, BLOOM.radius, BLOOM.threshold);
  const fxaa = new ShaderPass(FXAAShader);
  const output = new OutputPass();
  composer.addPass(renderPass);
  composer.addPass(bloom);
  composer.addPass(fxaa);
  composer.addPass(output);
  let tier = 'high';
  let settings = QUALITY_SETTINGS.high;
  let renderScale = 1; // SPEC 36.4: internal resolution fraction (0.5 .. 1)

  function resize(w, h) {
    const pr = Math.min(window.devicePixelRatio || 1, settings.maxPixelRatio) * renderScale;
    renderer.setPixelRatio(pr);
    composer.setPixelRatio(pr);
    composer.setSize(w, h);
    fxaa.material.uniforms.resolution.value.set(1 / (w * pr), 1 / (h * pr));
  }

  function setQuality(next) {
    tier = QUALITY_SETTINGS[next] ? next : 'medium';
    settings = QUALITY_SETTINGS[tier];
    bloom.enabled = settings.bloom;
    fxaa.enabled = settings.fxaa;
    renderer.shadowMap.enabled = settings.shadows;
    renderer.shadowMap.needsUpdate = true;
    resize(window.innerWidth, window.innerHeight);
  }

  function setRenderScale(pct) {
    renderScale = Math.min(1, Math.max(0.5, (Number(pct) || 100) / 100));
    resize(window.innerWidth, window.innerHeight);
  }

  function render() {
    if (tier === 'low') renderer.render(scene, camera);
    else composer.render();
  }

  return { composer, render, resize, setQuality, setRenderScale, get renderScale() { return renderScale; }, get tier() { return tier; }, get settings() { return settings; } };
}
