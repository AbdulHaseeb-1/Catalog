/**
 * Error plumbing for the whole app.
 *
 * The app used to fail silently: a failed database open left every list empty,
 * a rejected promise in an `onPress` vanished, and a native crash arrived with
 * nothing in the logs. Everything here exists to make a failure *visible* —
 * either on screen, or in a log line that names where it came from.
 */

/** Where an error came from, so a log line is useful on its own. */
export type ErrorScope =
  | 'startup'
  | 'database'
  | 'library'
  | 'image'
  | 'pdf'
  | 'preview'
  | 'render'
  | 'uncaught'
  | 'unhandled-rejection';

export type ReportedError = {
  scope: ErrorScope;
  message: string;
  stack?: string;
  at: string;
  fatal: boolean;
};

/** Message worth showing a user, from anything that was thrown. */
export function toMessage(error: unknown, fallback = 'Something went wrong.'): string {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === 'string' && error.trim()) return error;
  if (error && typeof error === 'object') {
    const message = (error as { message?: unknown }).message;
    if (typeof message === 'string' && message) return message;
  }
  return fallback;
}

function stackOf(error: unknown): string | undefined {
  return error instanceof Error && typeof error.stack === 'string' ? error.stack : undefined;
}

/* -------------------------------------------------------------------------- */
/* Recent-error buffer                                                        */
/* -------------------------------------------------------------------------- */

const MAX_KEPT = 25;
// Replaced rather than mutated on every write, so the reference itself is a
// valid snapshot for useSyncExternalStore.
let recent: readonly ReportedError[] = [];
const listeners = new Set<() => void>();

/** Newest first. Backs the diagnostics list on the Settings tab. */
export function recentErrors(): readonly ReportedError[] {
  return recent;
}

export function subscribeToErrors(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function publish(next: readonly ReportedError[]): void {
  recent = next;
  for (const listener of listeners) listener();
}

export function clearErrors(): void {
  publish([]);
}

/**
 * Record a failure. Always logs; never throws. Call this anywhere a `catch`
 * would otherwise swallow the error whole.
 */
export function reportError(scope: ErrorScope, error: unknown, fatal = false): ReportedError {
  const entry: ReportedError = {
    scope,
    message: toMessage(error),
    stack: stackOf(error),
    at: new Date().toISOString(),
    fatal,
  };

  // console.error keeps this visible in `expo start`, in device logs, and in
  // the dev-client LogBox — the places someone actually looks after a crash.
  console.error(`[${scope}]${fatal ? ' FATAL' : ''} ${entry.message}`, error);

  publish([entry, ...recent].slice(0, MAX_KEPT));
  return entry;
}

/* -------------------------------------------------------------------------- */
/* Promise helpers                                                            */
/* -------------------------------------------------------------------------- */

/**
 * Run a promise from an event handler that cannot await it. Without this a
 * rejection becomes an unhandled rejection, which React Native reports as a
 * warning at best and drops entirely at worst.
 */
export function runSafely(
  scope: ErrorScope,
  work: () => Promise<unknown>,
  onError?: (message: string) => void
): void {
  try {
    work().catch((error: unknown) => {
      reportError(scope, error);
      onError?.(toMessage(error));
    });
  } catch (error) {
    // A handler that throws synchronously before returning its promise.
    reportError(scope, error);
    onError?.(toMessage(error));
  }
}

/**
 * Reject with a clear message instead of hanging forever. A promise that never
 * settles is the worst failure mode there is — the UI just sits there with no
 * error to show.
 */
export function withTimeout<T>(
  work: Promise<T>,
  ms: number,
  message = 'This took too long and was stopped.'
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), ms);
    work.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error instanceof Error ? error : new Error(toMessage(error)));
      }
    );
  });
}

/* -------------------------------------------------------------------------- */
/* Global handlers                                                            */
/* -------------------------------------------------------------------------- */

type GlobalErrorUtils = {
  getGlobalHandler?: () => (error: unknown, isFatal?: boolean) => void;
  setGlobalHandler?: (handler: (error: unknown, isFatal?: boolean) => void) => void;
};

let installed = false;

/**
 * Route every uncaught error and unhandled rejection through `reportError`.
 *
 * In a release build there is no LogBox, so an uncaught error otherwise takes
 * the app down with nothing written anywhere. Called once from the root layout.
 */
export function installGlobalErrorHandlers(): void {
  if (installed) return;
  installed = true;

  const errorUtils = (globalThis as { ErrorUtils?: GlobalErrorUtils }).ErrorUtils;
  if (errorUtils?.setGlobalHandler) {
    const previous = errorUtils.getGlobalHandler?.();
    errorUtils.setGlobalHandler((error: unknown, isFatal?: boolean) => {
      reportError('uncaught', error, !!isFatal);
      // Keep the default handler so the dev red box still appears.
      previous?.(error, isFatal);
    });
  }

  // React Native ships the `promise` polyfill; its rejection tracking is off by
  // default in release, which is exactly where a silent rejection hurts most.
  try {

    const tracking = require('promise/setimmediate/rejection-tracking');
    tracking.enable({
      allRejections: true,
      onUnhandled: (_id: number, error: unknown) => reportError('unhandled-rejection', error),
      onHandled: () => undefined,
    });
  } catch (error) {
    // Polyfill not present on this platform (web) — nothing to enable.
    if (__DEV__) console.warn('[startup] rejection tracking unavailable', error);
  }

  // Web: the polyfill above does not apply, the browser event does.
  const target = globalThis as {
    addEventListener?: (type: string, listener: (event: unknown) => void) => void;
  };
  if (typeof target.addEventListener === 'function') {
    target.addEventListener('unhandledrejection', (event: unknown) => {
      const reason = (event as { reason?: unknown })?.reason;
      reportError('unhandled-rejection', reason ?? event);
    });
  }
}
