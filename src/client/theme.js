export const PALETTE = {
  bg: '#0d1117',
  surface: '#161b22',
  surfaceBorder: '#30363d',
  accent: '#238636',
  accentHover: '#2ea043',
  text: '#e6edf3',
  textMuted: '#8b949e',
  teamBlue: '#38bdf8',
  teamRed: '#f87171',
  danger: '#da3633',
};

export const SPACING = {
  xs: '4px',
  sm: '8px',
  md: '16px',
  lg: '24px',
  xl: '32px',
};

export const TYPOGRAPHY = {
  fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
  fontSizeSm: '12px',
  fontSizeMd: '14px',
  fontSizeLg: '18px',
  fontSizeXl: '24px',
};

export function generateCssVariables() {
  return `:root {
  --bg: ${PALETTE.bg};
  --surface: ${PALETTE.surface};
  --surface-border: ${PALETTE.surfaceBorder};
  --accent: ${PALETTE.accent};
  --accent-hover: ${PALETTE.accentHover};
  --text: ${PALETTE.text};
  --text-muted: ${PALETTE.textMuted};
  --team-blue: ${PALETTE.teamBlue};
  --team-red: ${PALETTE.teamRed};
  --danger: ${PALETTE.danger};

  --space-xs: ${SPACING.xs};
  --space-sm: ${SPACING.sm};
  --space-md: ${SPACING.md};
  --space-lg: ${SPACING.lg};
  --space-xl: ${SPACING.xl};

  --font-family: ${TYPOGRAPHY.fontFamily};
  --font-sm: ${TYPOGRAPHY.fontSizeSm};
  --font-md: ${TYPOGRAPHY.fontSizeMd};
  --font-lg: ${TYPOGRAPHY.fontSizeLg};
  --font-xl: ${TYPOGRAPHY.fontSizeXl};
}`;
}

export function injectTheme() {
  if (typeof document === 'undefined') return;
  let styleEl = document.getElementById('theme-vars');
  if (!styleEl) {
    styleEl = document.createElement('style');
    styleEl.id = 'theme-vars';
    document.head.appendChild(styleEl);
  }
  styleEl.textContent = generateCssVariables();
}
