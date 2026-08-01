import { Tabs } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';

import { TabBar } from '@/constants/layout';
import { Colors, Elevation, Radii } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';

function TabIcon({ name, focused, color }: { name: string; focused: boolean; color: string }) {
  const icon = name === 'catalogs' ? (focused ? '▦' : '▢') : focused ? '⚙' : '○';
  return (
    <View style={styles.iconWrap}>
      <Text style={{ color, fontSize: 17, fontWeight: '600' }}>{icon}</Text>
    </View>
  );
}

export default function TabsLayout() {
  const scheme = useColorScheme();
  const theme = Colors[scheme === 'unspecified' ? 'light' : scheme];

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
          fontSize: 11,
          fontWeight: '600',
          marginTop: 0,
          marginBottom: 0,
        },
        tabBarItemStyle: {
          paddingVertical: 2,
        },
      }}>
      <Tabs.Screen
        name="index"
        options={{
          title: 'Catalogs',
          tabBarIcon: ({ color, focused }) => (
            <TabIcon name="catalogs" focused={focused} color={String(color)} />
          ),
        }}
      />
      <Tabs.Screen
        name="settings"
        options={{
          title: 'Settings',
          tabBarIcon: ({ color, focused }) => (
            <TabIcon name="settings" focused={focused} color={String(color)} />
          ),
        }}
      />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  iconWrap: {
    width: 36,
    height: 26,
    borderRadius: Radii.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
