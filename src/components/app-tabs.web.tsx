import { Tabs, TabList, TabTrigger, TabSlot } from 'expo-router/ui';

import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';

/**
 * Legacy web tabs shim (unused — root uses app/(tabs)/_layout.tsx).
 * Kept so typedRoutes/build does not break on old imports.
 */
export default function AppTabs() {
  const colors = Colors[useColorScheme()];

  return (
    <Tabs>
      <TabSlot />
      <TabList style={{ backgroundColor: colors.background }}>
        <TabTrigger name="index" href="/" style={{ padding: 12 }}>
          Catalogs
        </TabTrigger>
        <TabTrigger name="settings" href="/settings" style={{ padding: 12 }}>
          Settings
        </TabTrigger>
      </TabList>
    </Tabs>
  );
}
