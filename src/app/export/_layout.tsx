import { Stack, type ErrorBoundaryProps } from 'expo-router';

import { RouteErrorBoundary } from '@/components/route-error-boundary';
import { useTheme } from '@/hooks/use-theme';

export function ErrorBoundary(props: ErrorBoundaryProps) {
  return <RouteErrorBoundary {...props} where="export stack" />;
}

export default function ExportLayout() {
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
      <Stack.Screen name="preview" options={{ title: 'Catalogue preview' }} />
    </Stack>
  );
}
