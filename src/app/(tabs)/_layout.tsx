import { Tabs } from 'expo-router';
import { StyleSheet, Text, View, type ColorValue } from 'react-native';

import { TabBar } from '@/constants/layout';
import { Colors, Elevation, Radii } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';

/** Filled glyph when focused, outline when not — tinted by the tab bar. */
const ICONS: Record<string, { on: string; off: string }> = {
  products: { on: '▦', off: '▤' },
  companies: { on: '⬢', off: '⬡' },
  formulas: { on: '◆', off: '◇' },
  generate: { on: '⬇', off: '⇩' },
  settings: { on: '⚙', off: '○' },
};

function TabIcon({ name, focused, color }: { name: string; focused: boolean; color: string }) {
  const glyph = ICONS[name] ?? ICONS.products;
  return (
    <View style={styles.iconWrap}>
      <Text style={{ color, fontSize: 16, fontWeight: '600' }}>
        {focused ? glyph.on : glyph.off}
      </Text>
    </View>
  );
}

export default function TabsLayout() {
  const scheme = useColorScheme();
  const theme = Colors[scheme === 'unspecified' ? 'light' : scheme];

  const icon =
    (name: string) =>
    ({ color, focused }: { color: ColorValue; focused: boolean }) => (
      <TabIcon name={name} focused={focused} color={String(color)} />
    );

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: theme.primary,
        tabBarInactiveTintColor: theme.textSecondary,
        tabBarStyle: {
          position: 'absolute',
          left: TabBar.side,
          right: TabBar.side,
          bottom: TabBar.bottom,
          height: TabBar.height,
          borderRadius: Radii.xl,
          backgroundColor: theme.tabBar,
          borderTopWidth: 0,
          paddingTop: 6,
          paddingBottom: 6,
          ...Elevation.bar,
        },
        tabBarLabelStyle: {
          fontSize: 10,
          fontWeight: '600',
          marginTop: 0,
          marginBottom: 0,
        },
        tabBarItemStyle: {
          paddingVertical: 2,
        },
      }}>
      <Tabs.Screen name="index" options={{ title: 'Products', tabBarIcon: icon('products') }} />
      <Tabs.Screen
        name="companies"
        options={{ title: 'Companies', tabBarIcon: icon('companies') }}
      />
      <Tabs.Screen name="formulas" options={{ title: 'Formulas', tabBarIcon: icon('formulas') }} />
      <Tabs.Screen name="generate" options={{ title: 'PDF', tabBarIcon: icon('generate') }} />
      <Tabs.Screen name="settings" options={{ title: 'Settings', tabBarIcon: icon('settings') }} />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  iconWrap: {
    width: 36,
    height: 24,
    borderRadius: Radii.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
