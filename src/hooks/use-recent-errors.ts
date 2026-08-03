import { useSyncExternalStore } from 'react';

import { recentErrors, subscribeToErrors, type ReportedError } from '@/lib/errors';

/** Live view of the in-memory error log. Newest first. */
export function useRecentErrors(): readonly ReportedError[] {
  return useSyncExternalStore(subscribeToErrors, recentErrors, recentErrors);
}
