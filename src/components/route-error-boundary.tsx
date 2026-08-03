import type { ErrorBoundaryProps } from 'expo-router';
import { useEffect } from 'react';

import { ErrorScreen } from '@/components/error-screen';
import { reportError } from '@/lib/errors';

/**
 * Shared body for every `export function ErrorBoundary` in the route tree.
 *
 * Expo Router catches a render-time throw at the nearest boundary, so putting
 * one on each stack keeps a single broken screen from taking the whole app
 * down — previously any such throw unmounted everything and left a blank
 * screen with nothing logged.
 */
export function RouteErrorBoundary({
  error,
  retry,
  where,
}: ErrorBoundaryProps & { where?: string }) {
  useEffect(() => {
    reportError('render', error, true);
  }, [error]);

  return (
    <ErrorScreen
      title="This screen hit an error"
      message={
        error?.message
          ? error.message
          : 'The screen could not be displayed. Going back and trying again usually clears it.'
      }
      detail={__DEV__ ? [where, error?.stack].filter(Boolean).join('\n\n') : undefined}
      actionLabel="Try again"
      onAction={() => {
        void retry();
      }}
    />
  );
}
