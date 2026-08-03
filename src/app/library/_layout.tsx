import { Stack, type ErrorBoundaryProps } from 'expo-router';

import { RouteErrorBoundary } from '@/components/route-error-boundary';
import { useTheme } from '@/hooks/use-theme';

export function ErrorBoundary(props: ErrorBoundaryProps) {
  return <RouteErrorBoundary {...props} where="library stack" />;
}

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
