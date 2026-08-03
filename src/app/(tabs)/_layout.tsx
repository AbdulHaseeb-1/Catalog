import { Tabs, type ErrorBoundaryProps } from 'expo-router';
import { StyleSheet, Text, View, type ColorValue } from 'react-native';

import { RouteErrorBoundary } from '@/components/route-error-boundary';
import { TabBar } from '@/constants/layout';
import { Colors, Elevation, Radii } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';

export function ErrorBoundary(props: ErrorBoundaryProps) {
  return <RouteErrorBoundary {...props} where="tabs" />;
}

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
  const theme = Colors[useColorScheme()];

  const icon = (name: string) => {
    // Named rather than an inline arrow so the lint rule can see a display name.
    const TabBarIcon = ({ color, focused }: { color: ColorValue; focused: boolean }) => (
      <TabIcon name={name} focused={focused} color={String(color)} />
    );
    return TabBarIcon;
  };

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
          // 5 tabs on a narrow phone — anything larger truncates "Companies".
          fontSize: 9,
          fontWeight: '600',
          marginTop: 0,
          marginBottom: 0,
        },
        tabBarItemStyle: {
          paddingVertical: 2,
          paddingHorizontal: 2,
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
