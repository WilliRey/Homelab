// Tailwind v4 reads theme config from CSS; this file is loaded via `@config` in src/index.css.
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Encore accent: teal, deliberately nothing like YouTube red.
        accent: { DEFAULT: '#2dd4bf', strong: '#14b8a6' },
      },
    },
  },
};
