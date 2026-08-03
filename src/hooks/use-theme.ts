/**
 * Learn more about light and dark modes:
 * https://docs.expo.dev/guides/color-schemes/
 */

import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';

export function useTheme() {
  // useColorScheme() is normalised to 'light' | 'dark', so this lookup can
  // never produce undefined. Every screen reads `theme.<colour>` directly, so
  // an undefined palette here crashes the entire app.
  return Colors[useColorScheme()];
}
