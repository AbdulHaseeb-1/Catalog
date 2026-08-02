import { Stack } from 'expo-router';

import { useTheme } from '@/hooks/use-theme';

export default function LibraryLayout() {
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
      <Stack.Screen name="company/[companyId]/index" options={{ title: 'Company' }} />
      <Stack.Screen
        name="company/[companyId]/reorder"
        options={{ title: 'Reorder products' }}
      />
      <Stack.Screen name="formula/[formulaId]" options={{ title: 'Formula' }} />
    </Stack>
  );
}
