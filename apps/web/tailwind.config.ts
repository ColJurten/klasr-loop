import type { Config } from 'tailwindcss';

/**
 * Charte Klasr (PROMPT_DESIGN_KLASR.md) — à respecter strictement :
 * palette monochrome, les pastels encodent UNIQUEMENT du sens fonctionnel
 * (lavande = accent produit, sauge = validation, pêche = attention).
 * Pas d'ombres, pas de gradients, bordures fines, coins 8–12 px,
 * Inter 400/500 seulement, JetBrains Mono pour fichiers et chemins.
 */
const config: Config = {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        ink: '#0A0A0A',
        paper: '#FAFAF7',
        lavender: { DEFAULT: '#AFA9EC', deep: '#7F77DD' },
        sage: { DEFAULT: '#9FE1CB', deep: '#1D9E75' },
        peach: { DEFAULT: '#F5C4B3', deep: '#D85A30' },
        line: 'rgba(0,0,0,0.08)',
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'ui-monospace', 'monospace'],
      },
    },
  },
  plugins: [],
};
export default config;
