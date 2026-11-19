import { defineConfig } from 'vite';

// Local dev and preview use base '/'.
// The GitHub Pages build (`vite build --mode pages`) is served from the
// project subpath https://aggsslim.github.io/ringkasku/, so it needs
// base '/ringkasku/' for asset URLs to resolve.
export default defineConfig(({ mode }) => ({
  base: mode === 'pages' ? '/ringkasku/' : '/',
}));
