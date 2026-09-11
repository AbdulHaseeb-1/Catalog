const DEFAULT_TIMEOUT_MS = 1300;
const DEFAULT_SCHEME = "verifybridge";
const MOBILE_OS_PATTERN = /Android|iPhone|iPad|iPod/i;

/**
 * Whether `userAgent` looks like a phone/tablet OS that could plausibly have
 * the native app installed. Desktop browsers have no corresponding native
 * app, and attempting `location.href` on an unregistered custom scheme
 * there is not just pointless but actively risky - it has been observed to
 * crash/close the tab under at least one real desktop Chromium automation
 * harness (Playwright). Callers should skip `attemptAppRedirect` entirely
 * when this returns false.
 */
export function isMobileOs(userAgent: string): boolean {
  return MOBILE_OS_PATTERN.test(userAgent);
}

export interface AppRedirectController {
  /** Stops watching and guarantees `onFallback` never fires after this call. */
  cancel: () => void;
}

type MinimalDocument = Pick<
  Document,
  "visibilityState" | "addEventListener" | "removeEventListener"
>;
// Typed off the ambient `setTimeout`/`clearTimeout` (not `Pick<Window, ...>`)
// so this stays consistent regardless of whether this project's ambient
// globals resolve to the DOM lib's or @types/node's overload of them.
interface MinimalWindow {
  setTimeout: typeof setTimeout;
  clearTimeout: typeof clearTimeout;
}
type MinimalLocation = Pick<Location, "href">;

export interface AttemptAppRedirectOptions {
  timeoutMs?: number;
  scheme?: string;
  document?: MinimalDocument;
  window?: MinimalWindow;
  location?: MinimalLocation;
}

/**
 * Best-effort hand-off of a verification session to the native app via a
 * custom-scheme deep link. This is a fallback/dev-mode mechanism, not the
 * primary one - in production, Android App Links / iOS Universal Links
 * intercept the HTTPS mobile URL directly at the OS level before this JS
 * ever runs. It exists so the hand-off still works in dev, and on platforms
 * or configurations where the OS-level verification isn't set up.
 *
 * Never invoke this from a QR code payload directly (i.e. never encode
 * `verifybridge://...` in the QR) - a custom scheme fails outright with no
 * fallback if the app isn't installed. The QR/link must always be the HTTPS
 * mobile URL so a browser can always open it; this function is what that
 * HTTPS page runs once loaded to *also* try the app.
 *
 * Detection works by watching for the page being backgrounded
 * (`visibilitychange` -> "hidden") shortly after setting `location.href` to
 * the custom scheme - the signal that the OS switched to the native app. If
 * that doesn't happen within `timeoutMs`, `onFallback` fires so the caller
 * can render the normal browser flow. If the OS *did* switch away but the
 * user later returns to this tab (backgrounded the app, or dismissed an
 * "Open in app?" prompt), `onFallback` fires then instead - there's no other
 * way forward for them than the browser at that point.
 */
export function attemptAppRedirect(
  token: string,
  onFallback: () => void,
  options: AttemptAppRedirectOptions = {},
): AppRedirectController {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const scheme = options.scheme ?? DEFAULT_SCHEME;
  const doc = options.document ?? document;
  const win = options.window ?? window;
  const loc = options.location ?? window.location;

  let handedOff = false;
  let resolved = false;

  function resolveToFallback() {
    if (resolved) return;
    resolved = true;
    win.clearTimeout(timeoutId);
    doc.removeEventListener("visibilitychange", handleVisibilityChange);
    onFallback();
  }

  function handleVisibilityChange() {
    if (doc.visibilityState === "hidden") {
      handedOff = true;
      win.clearTimeout(timeoutId);
    } else if (handedOff) {
      resolveToFallback();
    }
  }

  doc.addEventListener("visibilitychange", handleVisibilityChange);
  const timeoutId = win.setTimeout(resolveToFallback, timeoutMs);

  loc.href = `${scheme}://session/${encodeURIComponent(token)}`;

  return {
    cancel() {
      resolved = true;
      win.clearTimeout(timeoutId);
      doc.removeEventListener("visibilitychange", handleVisibilityChange);
    },
  };
}
