export const STORAGE_KEY = 'bca.touchControls';

export function getTouchOverride(storage = (typeof window !== 'undefined' ? window.localStorage : null)) {
  if (!storage) return 'auto';
  try {
    const val = storage.getItem(STORAGE_KEY);
    if (val === 'on' || val === 'off' || val === 'auto') {
      return val;
    }
  } catch {
    // Fallback if storage access is blocked
  }
  return 'auto';
}

export function setTouchOverride(storage = (typeof window !== 'undefined' ? window.localStorage : null), value) {
  if (!storage) return;
  try {
    storage.setItem(STORAGE_KEY, value);
  } catch {
    // Ignore storage write errors
  }
}

export function resolveDeviceMode(options = {}) {
  const override = options?.override ?? 'auto';
  const hasTouch = Boolean(options?.hasTouch);
  const coarsePointer = Boolean(options?.coarsePointer);
  const userAgentMobile = Boolean(options?.userAgentMobile);

  if (override === 'on') return 'touch';
  if (override === 'off') return 'desktop';

  if (hasTouch && (coarsePointer || userAgentMobile)) {
    return 'touch';
  }

  return 'desktop';
}
