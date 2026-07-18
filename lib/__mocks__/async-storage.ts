/**
 * Test-only in-memory stand-in for @react-native-async-storage/async-storage.
 * The real package's own jest mock calls the global `jest.fn()`, which
 * doesn't exist under Vitest — see expo-print.ts for the broader pattern of
 * aliasing native modules in vitest.config.ts.
 */
const store = new Map<string, string>();

function getItem(key: string): Promise<string | null> {
  return Promise.resolve(store.get(key) ?? null);
}

function setItem(key: string, value: string): Promise<void> {
  store.set(key, value);
  return Promise.resolve();
}

function multiRemove(keys: readonly string[]): Promise<void> {
  for (const key of keys) {
    store.delete(key);
  }
  return Promise.resolve();
}

function getAllKeys(): Promise<readonly string[]> {
  return Promise.resolve([...store.keys()]);
}

export default { getItem, setItem, multiRemove, getAllKeys };
