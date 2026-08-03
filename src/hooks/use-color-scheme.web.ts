import { useEffect, useState } from 'react';
import { useColorScheme as useRNColorScheme } from 'react-native';

export type ResolvedColorScheme = 'light' | 'dark';

/**
 * Web build of the hook. The scheme is only trustworthy after hydration, so
 * static rendering gets 'light' and the client corrects it on mount.
 *
 * Like the native version this always resolves to a concrete scheme — see
 * use-color-scheme.ts for why returning null is not survivable.
 */
export function useColorScheme(): ResolvedColorScheme {
  const [hasHydrated, setHasHydrated] = useState(false);

  useEffect(() => {
    setHasHydrated(true);
  }, []);

  const scheme = useRNColorScheme() as 'light' | 'dark' | 'unspecified' | null | undefined;

  if (!hasHydrated) return 'light';
  return scheme === 'dark' ? 'dark' : 'light';
}
