import { DarkTheme, DefaultTheme, Stack, ThemeProvider, type ErrorBoundaryProps } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, useColorScheme, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

import { ErrorScreen } from '@/components/error-screen';
import { RouteErrorBoundary } from '@/components/route-error-boundary';
import { installGlobalErrorHandlers, reportError, toMessage } from '@/lib/errors';
import { useLibraryStore } from '@/stores/library-store';

/** Opening and migrating SQLite should take milliseconds. Past this, something
 * is wrong and a blank screen forever is the worst possible answer. */
const HYDRATE_TIMEOUT_MS = 20_000;

// Installed at module scope so a throw during the very first render is still
// caught and logged.
installGlobalErrorHandlers();

// Floating on purpose (per the SDK 57 docs), but a rejection here must not
// become an unhandled rejection.
SplashScreen.preventAutoHideAsync().catch((error: unknown) => {
  reportError('startup', error);
});

/** Catches anything the route tree throws before a nested boundary exists. */
export function ErrorBoundary(props: ErrorBoundaryProps) {
  return <RouteErrorBoundary {...props} where="root layout" />;
}

export default function RootLayout() {
  const colorScheme = useColorScheme();
  const hydrate = useLibraryStore((s) => s.hydrate);
  const status = useLibraryStore((s) => s.status);
  const storeError = useLibraryStore((s) => s.error);

  const [ready, setReady] = useState(false);
  // Separate from the store's error: this covers a hydrate that never settles,
  // which the store itself can never report.
  const [startupError, setStartupError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(() => {
      if (cancelled) return;
      const message =
        'The product library did not finish loading. This is usually a storage problem on the device.';
      reportError('startup', new Error(message));
      setStartupError(message);
      setReady(true);
    }, HYDRATE_TIMEOUT_MS);

    (async () => {
      try {
        await hydrate();
        if (!cancelled) setStartupError(null);
      } catch (error) {
        // hydrate() handles its own errors, so reaching here means something
        // failed outside it entirely.
        if (!cancelled) {
          reportError('startup', error, true);
          setStartupError(toMessage(error, 'The app could not start.'));
        }
      } finally {
        clearTimeout(timer);
        if (!cancelled) setReady(true);
      }
    })();

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [hydrate, attempt]);

  // Hiding the splash is its own step: if it throws, the app must still render.
  useEffect(() => {
    if (!ready) return;
    SplashScreen.hideAsync().catch((error: unknown) => {
      reportError('startup', error);
    });
  }, [ready]);

  const retry = useCallback(() => {
    setStartupError(null);
    setReady(false);
    setAttempt((n) => n + 1);
  }, []);

  const theme = colorScheme === 'dark' ? DarkTheme : DefaultTheme;

  if (!ready) {
    // Rendered behind the splash screen, and visible on its own if hiding the
    // splash failed — never a bare `null`.
    return (
      <View
        style={{
          flex: 1,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: colorScheme === 'dark' ? '#131314' : '#F7F7F8',
        }}>
        <ActivityIndicator size="large" color={colorScheme === 'dark' ? '#8AB4F8' : '#1A73E8'} />
      </View>
    );
  }

  // The library is the whole app — starting without it would show empty lists
  // and look like every product had been deleted.
  const fatal = startupError ?? (status === 'error' ? storeError : null);
  if (fatal) {
    return (
      <ErrorScreen
        title="The product library could not be opened"
        message={fatal}
        detail={
          __DEV__
            ? 'Your products are stored in psf_catalog.db on this device. Nothing has been deleted — the app just could not read it this time.'
            : undefined
        }
        actionLabel="Retry"
        onAction={retry}
      />
    );
  }

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <ThemeProvider value={theme}>
        <Stack screenOptions={{ headerShown: false }}>
          <Stack.Screen name="(tabs)" />
          <Stack.Screen name="product" />
          <Stack.Screen name="library" />
          <Stack.Screen name="export" />
        </Stack>
      </ThemeProvider>
    </GestureHandlerRootView>
  );
}
