import { useRouter } from 'expo-router';

import { ErrorScreen } from '@/components/error-screen';

/**
 * Reached when a deep link or a stale `router.push` names a route that no
 * longer exists. Without this the router renders its own bare fallback, which
 * reads like the app broke.
 */
export default function NotFoundScreen() {
  const router = useRouter();

  return (
    <ErrorScreen
      title="Page not found"
      message="That screen does not exist. It may have been opened from an old link."
      actionLabel="Go to Products"
      onAction={() => router.replace('/')}
    />
  );
}
