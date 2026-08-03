import { useColorScheme as useRNColorScheme } from 'react-native';

export type ResolvedColorScheme = 'light' | 'dark';

/**
 * Always a concrete scheme.
 *
 * React Native's shipped types claim `useColorScheme()` returns
 * `'light' | 'dark' | 'unspecified'`, but the runtime signature is
 * `?ColorSchemeName` and `Appearance.getColorScheme()` genuinely returns
 * **null** whenever the platform reports no preference — routinely on Android
 * and in Expo Go. Indexing the palette with that null yielded `undefined`, and
 * the first `theme.background` read threw "Cannot read property 'background'
 * of undefined", taking the whole app down before anything could report it.
 * TypeScript could not catch it because the .d.ts is wrong about nullability.
 *
 * Normalising here means no caller has to think about it again.
 */
export function useColorScheme(): ResolvedColorScheme {
  const scheme = useRNColorScheme() as 'light' | 'dark' | 'unspecified' | null | undefined;
  return scheme === 'dark' ? 'dark' : 'light';
}
