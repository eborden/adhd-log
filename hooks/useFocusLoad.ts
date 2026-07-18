import { useCallback, useState, type Dispatch, type SetStateAction } from 'react';
import { useFocusEffect } from 'expo-router';

/**
 * Focus-loaded state. Runs `loader` on every screen focus and stores its result, starting from
 * `initial`. Load errors are swallowed (the value simply stays put), matching the per-route
 * behavior this replaces. `deps` control when the loader is re-created — pass anything the loader
 * closes over (e.g. a route param), mirroring the hand-rolled `useCallback` deps in each route.
 *
 * Returns `setData` as well so screens that optimistically mutate the loaded value (e.g. Settings)
 * can update it locally without a reload; `refresh` re-runs the loader on demand.
 *
 * Lives in `hooks/`, not `lib/`: it depends on React + expo-router, so it is not RN-free and
 * cannot be unit-tested under the repo's node-environment Vitest setup.
 */
export function useFocusLoad<T>(
  loader: () => Promise<T>,
  initial: T,
  deps: readonly unknown[] = [],
): {
  readonly data: T;
  readonly setData: Dispatch<SetStateAction<T>>;
  readonly refresh: () => void;
} {
  const [data, setData] = useState<T>(initial);
  const refresh = useCallback((): void => {
    loader()
      .then(setData)
      .catch(() => undefined);
  }, deps);
  useFocusEffect(refresh);
  return { data, setData, refresh };
}
