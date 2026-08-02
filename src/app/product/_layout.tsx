import { Stack } from 'expo-router';

import { useTheme } from '@/hooks/use-theme';

export default function ProductLayout() {
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
      <Stack.Screen name="new" options={{ title: 'Add product' }} />
      <Stack.Screen name="[productId]/index" options={{ title: 'Product' }} />
      <Stack.Screen
        name="[productId]/crop"
        options={{ title: 'Crop image', presentation: 'modal' }}
      />
    </Stack>
  );
}
