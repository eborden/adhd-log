/** Test-only stub — see expo-print.ts for why this is aliased in vitest.config.ts. */
export function shareAsync(): Promise<void> {
  return Promise.resolve();
}

export function isAvailableAsync(): Promise<boolean> {
  return Promise.resolve(true);
}
