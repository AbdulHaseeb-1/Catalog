import { Stack } from 'expo-router';

import { useTheme } from '@/hooks/use-theme';

export default function CatalogLayout() {
  const theme = useTheme();

  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: theme.background },
        headerTintColor: theme.text,
        headerTitleStyle: { fontWeight: '600', fontSize: 17 },
        headerShadowVisible: false,
        headerBackTitle: 'Back',
        contentStyle: { backgroundColor: theme.background },
      }}>
      <Stack.Screen name="[catalogId]/index" options={{ title: 'Photos' }} />
      <Stack.Screen name="[catalogId]/layouts" options={{ title: 'Layout' }} />
      <Stack.Screen name="[catalogId]/preview" options={{ title: 'Preview' }} />
      <Stack.Screen name="[catalogId]/export" options={{ title: 'Export' }} />
      <Stack.Screen
        name="[catalogId]/crop/[photoId]"
        options={{ title: 'Crop', presentation: 'modal' }}
      />
    </Stack>
  );
}
