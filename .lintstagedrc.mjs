/** @param {string[]} files */
const tsAndTsx = (files) => [
  `eslint --max-warnings 0 ${files.join(' ')}`,
  `prettier --check ${files.join(' ')}`,
  'tsc --noEmit',
  'type-coverage --strict --at-least 100 --ignore-files "**/*.d.ts" --ignore-as-assertion',
  `vitest related --run ${files.join(' ')}`,
];

/** @param {string[]} files */
const configFiles = (files) => [`prettier --check ${files.join(' ')}`];

export default {
  '*.{ts,tsx}': tsAndTsx,
  '*.{json,md,cjs,mjs,js}': configFiles,
};
