import { describe, expect, it } from 'vitest';

const colors = {
  ink: '#0A0A0A',
  paper: '#FAFAF7',
  lavender: '#AFA9EC',
  sage: '#9FE1CB',
  peach: '#F5C4B3',
};

describe('design tokens — WCAG contrast', () => {
  it('keeps normal text contrast at AA level on functional pastel surfaces', () => {
    expect(contrast(colors.ink, colors.paper)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(colors.ink, colors.lavender)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(colors.ink, colors.sage)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(colors.ink, colors.peach)).toBeGreaterThanOrEqual(4.5);
  });
});

function contrast(foreground: string, background: string): number {
  const lighter = Math.max(luminance(foreground), luminance(background));
  const darker = Math.min(luminance(foreground), luminance(background));
  return (lighter + 0.05) / (darker + 0.05);
}

function luminance(hex: string): number {
  const [red, green, blue] = hex
    .replace('#', '')
    .match(/.{2}/g)!
    .map((channel) => Number.parseInt(channel, 16) / 255)
    .map((value) => (value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4));
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}
