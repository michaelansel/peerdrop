import { defineConfig } from 'vite';

const REPO_BASE = '/peerdrop/';

export default defineConfig(({ mode }) => ({
  base: mode === 'production' ? REPO_BASE : '/',
  define: {
    __DEV_BROKER_OVERRIDE__: JSON.stringify(mode !== 'production'),
  },
  build: {
    target: 'es2022',
    sourcemap: false,
    minify: 'esbuild',
  },
  server: {
    port: 5173,
  },
  preview: {
    port: 4173,
  },
}));
