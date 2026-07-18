/**
 * Test-only stub. The real `expo-print` pulls in react-native's Flow-syntax
 * source, which Vitest's transform can't parse. Aliased in vitest.config.ts —
 * only lib/export.ts's pure functions are unit tested, never this native I/O.
 */
export function printToFileAsync(): Promise<{ uri: string }> {
  return Promise.resolve({ uri: 'file://mock.pdf' });
}
