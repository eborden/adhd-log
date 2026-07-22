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
      // cobertura is added for GitHub's native code-coverage reporting (see ci.yml); the
      // rest is vitest's own default set, made explicit so adding cobertura doesn't drop them.
      reporter: ['text', 'html', 'clover', 'json', 'cobertura'],
      include: [
        'lib/types.ts',
        'lib/schema.ts',
        'lib/storage.ts',
        'lib/backup.ts',
        'lib/metrics.ts',
        'lib/report-metrics.ts',
        'lib/report-html.ts',
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
