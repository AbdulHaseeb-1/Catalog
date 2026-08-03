import { Stack, type ErrorBoundaryProps } from 'expo-router';

import { RouteErrorBoundary } from '@/components/route-error-boundary';
import { useTheme } from '@/hooks/use-theme';

export function ErrorBoundary(props: ErrorBoundaryProps) {
  return <RouteErrorBoundary {...props} where="product stack" />;
}

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
      <Stack.Screen name="bulk" options={{ title: 'Import photos' }} />
      <Stack.Screen name="[productId]/index" options={{ title: 'Product' }} />
    </Stack>
  );
}
