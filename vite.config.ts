import { defineConfig } from 'vitest/config';
import preact from '@preact/preset-vite';

// GitHub Pages ではリポジトリ名がパスに入るため base を切り替える
const base = process.env.GITHUB_ACTIONS ? '/tokyo-train-time-map/' : '/';

export default defineConfig({
  base,
  plugins: [preact()],
  build: {
    outDir: 'dist',
    target: 'es2022',
  },
  test: {
    environment: 'node',
    include: ['tests/unit/**/*.test.ts'],
  },
});
