import type { Config } from 'tailwindcss';

const config: Config = {
  content: [
    './app/**/*.{ts,tsx}',
    './components/**/*.{ts,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        surface:  '#1a1d27',
        base:     '#0f1117',
        border:   '#2a2d3e',
        accent:   '#6366f1',
        accent2:  '#818cf8',
      },
      fontFamily: {
        mono: ['JetBrains Mono', 'Fira Code', 'Consolas', 'monospace'],
      },
      animation: {
        'pulse-slow': 'pulse 2.5s cubic-bezier(0.4,0,0.6,1) infinite',
        'spin-slow':  'spin 1.4s linear infinite',
      },
    },
  },
  plugins: [],
};

export default config;
