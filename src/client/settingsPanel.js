// Settings panel on the menu screen (docs/SPEC.md 19.2). DOM glue only: the values, defaults, clamping and
// persistence live in settings.js and deviceMode.js, which the unit tests cover.
import { getSensitivity, getShowFps, getTouchControls, setSensitivity, setShowFps, setTouchControls } from './settings.js';

export function bindSettingsPanel(doc, game) {
  const panel = doc.getElementById('settings');
  const openBtn = doc.getElementById('settings-open');
  const slider = doc.getElementById('sensitivity');
  const sliderOut = doc.getElementById('sensitivity-value');
  const fpsBox = doc.getElementById('show-fps');
  const touchRadios = [...doc.querySelectorAll('input[name="touch-mode"]')];
  if (!panel || !openBtn || !slider || !fpsBox) return;

  openBtn.addEventListener('click', () => {
    panel.hidden = !panel.hidden;
    openBtn.setAttribute('aria-expanded', String(!panel.hidden));
  });

  const showSensitivity = (v) => { if (sliderOut) sliderOut.value = (v * 1000).toFixed(1); };
  const sensitivity = getSensitivity();
  slider.value = String(sensitivity);
  showSensitivity(sensitivity);
  game.setSensitivity(sensitivity);
  slider.addEventListener('input', () => {
    const v = setSensitivity(undefined, slider.value);
    showSensitivity(v);
    game.setSensitivity(v);
  });

  const mode = getTouchControls();
  for (const r of touchRadios) {
    r.checked = r.value === mode;
    r.addEventListener('change', () => {
      if (!r.checked) return;
      setTouchControls(undefined, r.value);
      game.updateTouchMode();
    });
  }

  const showFps = getShowFps();
  fpsBox.checked = showFps;
  game.setShowFps(showFps);
  fpsBox.addEventListener('change', () => game.setShowFps(setShowFps(undefined, fpsBox.checked)));
}
