import { getTouchOverride, setTouchOverride } from './deviceMode.js';

export const DEFAULT_SENSITIVITY = 0.0022;
export const MIN_SENSITIVITY = 0.0005;
export const MAX_SENSITIVITY = 0.01;

export const KEYS = {
  SENSITIVITY: 'bca.sensitivity',
  TOUCH_CONTROLS: 'bca.touchControls',
  SHOW_FPS: 'bca.showFps',
};

function resolveStorage(storage) {
  if (storage !== undefined) return storage;
  if (typeof window !== 'undefined') {
    try {
      return window.localStorage;
    } catch {
      return null;
    }
  }
  return null;
}

export function clampSensitivity(val) {
  const num = typeof val === 'number' ? val : parseFloat(val);
  if (Number.isNaN(num) || !Number.isFinite(num)) {
    return DEFAULT_SENSITIVITY;
  }
  return Math.max(MIN_SENSITIVITY, Math.min(MAX_SENSITIVITY, num));
}

export function getSensitivity(storage) {
  const store = resolveStorage(storage);
  if (!store) return DEFAULT_SENSITIVITY;
  try {
    const raw = store.getItem(KEYS.SENSITIVITY);
    if (raw === null || raw === undefined) return DEFAULT_SENSITIVITY;
    return clampSensitivity(raw);
  } catch {
    return DEFAULT_SENSITIVITY;
  }
}

export function setSensitivity(storage, value) {
  const clamped = clampSensitivity(value);
  const store = resolveStorage(storage);
  if (store) {
    try {
      store.setItem(KEYS.SENSITIVITY, String(clamped));
    } catch {
      // Storage unavailable or disabled
    }
  }
  return clamped;
}

export function getTouchControls(storage) {
  return getTouchOverride(resolveStorage(storage));
}

export function setTouchControls(storage, value) {
  const store = resolveStorage(storage);
  const valid = value === 'on' || value === 'off' || value === 'auto' ? value : 'auto';
  setTouchOverride(store, valid);
  return valid;
}

export function getShowFps(storage) {
  const store = resolveStorage(storage);
  if (!store) return false;
  try {
    return store.getItem(KEYS.SHOW_FPS) === 'true';
  } catch {
    return false;
  }
}

export function setShowFps(storage, value) {
  const store = resolveStorage(storage);
  const boolVal = Boolean(value);
  if (store) {
    try {
      store.setItem(KEYS.SHOW_FPS, boolVal ? 'true' : 'false');
    } catch {
      // Storage unavailable or disabled
    }
  }
  return boolVal;
}
