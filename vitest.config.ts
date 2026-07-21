import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

function mock(name: string): string {
  return fileURLToPath(new URL(`./lib/__mocks__/${name}.ts`, import.meta.url));
}

export default defineConfig({
  resolve: {
    alias: {
      '@react-native-async-storage/async-storage': mock('async-storage'),
      'expo-print': mock('expo-print'),
      'expo-sharing': mock('expo-sharing'),
      'expo-file-system': mock('expo-file-system'),
    },
  },
  test: {
    environment: 'node',
    include: ['lib/__tests__/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: [
        'lib/types.ts',
        'lib/schema.ts',
        'lib/storage.ts',
        'lib/backup.ts',
        'lib/metrics.ts',
        'lib/export.ts',
        'lib/checkin.ts',
        'lib/trends.ts',
      ],
      thresholds: {
        lines: 90,
        statements: 90,
        functions: 90,
        branches: 85,
      },
    },
  },
});
