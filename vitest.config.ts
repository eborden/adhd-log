import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@react-native-async-storage/async-storage': '@react-native-async-storage/async-storage/jest',
    },
  },
  test: {
    environment: 'node',
    include: ['lib/__tests__/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['lib/types.ts', 'lib/schema.ts', 'lib/storage.ts', 'lib/export.ts'],
      thresholds: {
        lines: 90,
        statements: 90,
        functions: 90,
        branches: 85,
      },
    },
  },
});
