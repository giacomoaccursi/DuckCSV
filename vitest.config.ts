import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: [
      'src/**/*.test.ts',
      'media/src/**/*.test.js',
    ],
    exclude: ['node_modules', 'dist', 'out', 'src/test'],
  },
});
