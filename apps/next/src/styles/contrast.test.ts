import { describe, expect, it } from 'vitest';

/**
 * Calculates WCAG 2.2 relative luminance for an sRGB hex color.
 * Formula: https://www.w3.org/WAI/GL/wiki/Relative_luminance
 */
function parseHex(hex: string): [number, number, number] {
  const clean = hex.replace('#', '').trim();
  if (clean.length === 6) {
    return [
      parseInt(clean.slice(0, 2), 16),
      parseInt(clean.slice(2, 4), 16),
      parseInt(clean.slice(4, 6), 16),
    ];
  }
  if (clean.length === 3) {
    return [
      parseInt(clean[0]! + clean[0]!, 16),
      parseInt(clean[1]! + clean[1]!, 16),
      parseInt(clean[2]! + clean[2]!, 16),
    ];
  }
  throw new Error(`Invalid hex color: ${hex}`);
}

function relativeLuminance(hex: string): number {
  const [r8, g8, b8] = parseHex(hex);
  const transform = (v: number) => {
    const s = v / 255;
    return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  const r = transform(r8);
  const g = transform(g8);
  const b = transform(b8);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/**
 * Contrast ratio between two colors: (L1 + 0.05) / (L2 + 0.05)
 * Range: 1:1 to 21:1
 */
function contrastRatio(hex1: string, hex2: string): number {
  const l1 = relativeLuminance(hex1);
  const l2 = relativeLuminance(hex2);
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

// Semantic tokens from globals.css
const lightTokens = {
  background: '#f8fafc',
  surface: '#ffffff',
  surfaceMuted: '#f1f5f9',
  foreground: '#0f172a',
  muted: '#475569',
  borderStrong: '#64748b',
  primary: '#047857',
  primaryFg: '#ffffff',
  navActiveBg: '#d1fae5',
  navActiveFg: '#064e3b',
  focus: '#1d4ed8',
  danger: '#b91c1c',
  dangerSoft: '#fef2f2',
  warning: '#92400e',
  warningSoft: '#fffbeb',
  success: '#047857',
  successSoft: '#ecfdf5',
};

const darkTokens = {
  background: '#020617',
  surface: '#0f172a',
  surfaceMuted: '#1e293b',
  foreground: '#f8fafc',
  muted: '#a3b1c6',
  borderStrong: '#64748b',
  primary: '#34d399',
  primaryFg: '#022c22',
  navActiveBg: '#064e3b',
  navActiveFg: '#d1fae5',
  focus: '#7dd3fc',
  danger: '#fda4af',
  dangerSoft: '#4c0519',
  warning: '#fcd34d',
  warningSoft: '#451a03',
  success: '#6ee7b7',
  successSoft: '#064e3b',
};

describe('WCAG 2.2 AA Contrast Compliance', () => {
  describe('Light Theme', () => {
    it('primary text against background meets AA (>= 4.5:1)', () => {
      const ratio = contrastRatio(lightTokens.foreground, lightTokens.background);
      expect(ratio).toBeGreaterThanOrEqual(4.5);
    });

    it('primary text against surface meets AA (>= 4.5:1)', () => {
      const ratio = contrastRatio(lightTokens.foreground, lightTokens.surface);
      expect(ratio).toBeGreaterThanOrEqual(4.5);
    });

    it('muted text against surface meets AA (>= 4.5:1)', () => {
      const ratio = contrastRatio(lightTokens.muted, lightTokens.surface);
      expect(ratio).toBeGreaterThanOrEqual(4.5);
    });

    it('muted text against surfaceMuted meets AA (>= 4.5:1)', () => {
      const ratio = contrastRatio(lightTokens.muted, lightTokens.surfaceMuted);
      expect(ratio).toBeGreaterThanOrEqual(4.5);
    });

    it('primary button text against primary background meets AA (>= 4.5:1)', () => {
      const ratio = contrastRatio(lightTokens.primaryFg, lightTokens.primary);
      expect(ratio).toBeGreaterThanOrEqual(4.5);
    });

    it('active navigation link text against active background meets AA (>= 4.5:1)', () => {
      const ratio = contrastRatio(lightTokens.navActiveFg, lightTokens.navActiveBg);
      expect(ratio).toBeGreaterThanOrEqual(4.5);
    });

    it('focus ring against surface meets UI components standard (>= 3:1)', () => {
      const ratio = contrastRatio(lightTokens.focus, lightTokens.surface);
      expect(ratio).toBeGreaterThanOrEqual(3.0);
    });

    it('status badges meet AA standards against their soft background', () => {
      expect(contrastRatio(lightTokens.danger, lightTokens.dangerSoft)).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(lightTokens.warning, lightTokens.warningSoft)).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(lightTokens.success, lightTokens.successSoft)).toBeGreaterThanOrEqual(4.5);
    });
  });

  describe('Dark Theme', () => {
    it('primary text against background meets AA (>= 4.5:1)', () => {
      const ratio = contrastRatio(darkTokens.foreground, darkTokens.background);
      expect(ratio).toBeGreaterThanOrEqual(4.5);
    });

    it('primary text against surface meets AA (>= 4.5:1)', () => {
      const ratio = contrastRatio(darkTokens.foreground, darkTokens.surface);
      expect(ratio).toBeGreaterThanOrEqual(4.5);
    });

    it('muted text against surface meets AA (>= 4.5:1)', () => {
      const ratio = contrastRatio(darkTokens.muted, darkTokens.surface);
      expect(ratio).toBeGreaterThanOrEqual(4.5);
    });

    it('muted text against surfaceMuted meets AA (>= 4.5:1)', () => {
      const ratio = contrastRatio(darkTokens.muted, darkTokens.surfaceMuted);
      expect(ratio).toBeGreaterThanOrEqual(4.5);
    });

    it('primary button text against primary background meets AA (>= 4.5:1)', () => {
      const ratio = contrastRatio(darkTokens.primaryFg, darkTokens.primary);
      expect(ratio).toBeGreaterThanOrEqual(4.5);
    });

    it('active navigation link text against active background meets AA (>= 4.5:1)', () => {
      const ratio = contrastRatio(darkTokens.navActiveFg, darkTokens.navActiveBg);
      expect(ratio).toBeGreaterThanOrEqual(4.5);
    });

    it('focus ring against background meets UI components standard (>= 3:1)', () => {
      const ratio = contrastRatio(darkTokens.focus, darkTokens.background);
      expect(ratio).toBeGreaterThanOrEqual(3.0);
    });

    it('status badges meet AA standards against their soft background', () => {
      expect(contrastRatio(darkTokens.danger, darkTokens.dangerSoft)).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(darkTokens.warning, darkTokens.warningSoft)).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(darkTokens.success, darkTokens.successSoft)).toBeGreaterThanOrEqual(4.5);
    });
  });
});
