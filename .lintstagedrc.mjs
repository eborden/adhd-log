export default {
  '*.{ts,tsx}': (files) => [
    `eslint --max-warnings 0 ${files.join(' ')}`,
    `prettier --check ${files.join(' ')}`,
    'tsc --noEmit',
    'type-coverage --strict --at-least 100 --ignore-files "**/*.d.ts"',
    `vitest related --run ${files.join(' ')}`,
  ],
  '*.{json,md,cjs,mjs,js}': (files) => [`prettier --check ${files.join(' ')}`],
};
