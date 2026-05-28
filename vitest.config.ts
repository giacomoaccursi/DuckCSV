import { defineConfig } from 'vitest/config';
import { join } from 'path';

export default defineConfig({
  test: {
    include: ['test/**/*.test.{ts,js}'],
  },
  resolve: {
    alias: {
      vscode: join(__dirname, 'test', '__mocks__', 'vscode.ts'),
    },
  },
});
