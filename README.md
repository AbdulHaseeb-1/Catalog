# VerifyBridge

VerifyBridge lets a desktop user who has no webcam finish a **legitimate**
identity/face verification flow using their phone, through a Chrome
extension that hands the verification off to a mobile web app and reports
the trusted result back to the desktop site in real time.

```
Desktop website (needs identity verification)
        │  "Verify using phone" click
        ▼
Chrome extension  ───POST /verification-sessions───▶  Backend (NestJS)
        │  QR code / link (always an HTTPS URL)               │
        ▼                                                    │  Postgres (durable)
   Phone opens the link                                       │  Redis (rate limit, pub/sub)
        │                                                     │
        ├─ native app installed? ──▶ apps/native (Expo)       │
        │  (App Links/Universal Links, or a JS-timeout        │
        │   fallback - see Deep linking) ──camera──▶ on-device│
        │                              ML Kit face detection  │
        │                                                     │
        └─ else ────────────────────▶ apps/mobile (PWA) ──camera permission──▶ getUserMedia
                                                                │
        │──POST .../start─────────────────────────────────▶  │  provider.createVerification()
        │──POST .../complete-demo (dev only)──────────────▶  │  applyProviderResult()
        │                                                     │
        │                                              WebSocket (ws) push,
        │                                              fanned out via Redis pub/sub
        ▼                                                     │
   "Verification complete"                                    ▼
                                                        Chrome extension (background)
                                                                │
                                                     content script / popup update
                                                                ▼
                                                    Desktop site: "Identity verified ✓"
```

## What this is

- A **cross-device handoff**: the extension creates a single-use, short-lived
  session; the phone completes verification; the backend is the only party
  that ever decides a session is `VERIFIED`; the extension relays that
  trusted result back to the page that asked for it.
- A **provider-agnostic architecture**: `VerificationProvider` is an
  interface (`createVerification` / `getVerificationStatus` /
  `verifyWebhook`). Only a `DemoVerificationProvider` ships built-in, clearly
  marked development-only. Wiring in Persona, Veriff, Sumsub, Onfido/Entrust,
  or Stripe Identity means implementing that interface and registering it in
  `apps/api/src/verification/providers/providers.module.ts` - nothing else in
  the codebase depends on a concrete vendor.
- A **controlled per-site integration layer** (`SiteAdapter`) for desktop
  websites that want automatic updates when verification completes.

## What this is NOT

- **Not** a webcam spoofer. There is no `MediaStream` injection, no
  interception of `navigator.mediaDevices.getUserMedia`, and no fake video
  track presented to a desktop site. The desktop site's own webcam check
  still correctly reports "no camera" - VerifyBridge routes around that by
  verifying identity on the *phone*, then reporting a *result*, not a fake
  camera feed.
- **Not** a universal bypass for arbitrary sites' verification flows. A site
  without a `SiteAdapter` (and without accepting VerifyBridge results
  server-side) will never be told "verified" automatically - see [Mode 1 vs
  Mode 2](#mode-1-vs-mode-2) below. The popup's manual flow is always
  available, but it never claims to have completed a third party's check
  unless that party actually integrated.
- **Not** real facial recognition or identity matching in this repository.
  The only provider implemented is `DemoVerificationProvider`, which never
  inspects a camera frame - it is unmistakably marked development-only (see
  [Security assumptions](#security-assumptions)). The native app
  (`apps/native`) does run real, on-device face *detection* (Google ML Kit)
  before its "Complete demo verification" button becomes tappable, but that
  is a local sanity/liveness-ish gate against an empty frame or a photo held
  up out of frame - not identity matching, not anti-spoofing, and not a
  substitute for a real provider's biometric pipeline. See
  [Native app](#native-app-apps-native).

## Mode 1 vs Mode 2

- **Mode 1 - integrated website**: the site ships a `SiteAdapter` (or trusts
  a webhook-driven backend integration) and the extension updates its UI
  automatically once the backend confirms `VERIFIED`. `apps/demo-site` is a
  worked example of this end to end.
- **Mode 2 - arbitrary website**: no adapter exists. The extension popup can
  still create a session manually and the user can complete verification on
  their phone, but the popup says plainly that automatic completion requires
  a supported integration - it never fabricates a "verified" state on a page
  that didn't ask for one.

## Repository layout

```
verifybridge/
├── apps/
│   ├── api/            NestJS + Prisma + Redis + WebSocket backend
│   ├── extension/      WXT + React Chrome extension (Manifest V3)
│   ├── mobile/         Vite + React PWA - the phone-side verification flow
│   ├── native/         Expo/React Native app - on-device face detection
│   └── demo-site/      A simulated desktop site integrating VerifyBridge
├── packages/
│   ├── shared/         Cross-app types, Zod schemas, WS event contracts
│   ├── ui/             Shared React components (Button, Card, QRCodeCard, ...)
│   └── verification-sdk/  Typed REST + WebSocket client (extension + mobile)
├── e2e/                Playwright test driving the real, built extension
├── docker-compose.yml  Postgres + Redis for local development
└── pnpm-workspace.yaml
```

## Architecture in depth

### Session domain (`apps/api/src/verification`)

Sessions are modeled as an explicit, one-directional state machine
(`packages/shared/src/status.ts`):

```
CREATED → MOBILE_OPENED → CAMERA_GRANTED → VERIFYING → VERIFIED
   │            │               │              │           │
   └────────────┴───────────────┴──────────────┴──▶ FAILED  └──▶ CONSUMED
   (any non-terminal state) ──▶ EXPIRED (lazily, once past its TTL)
```

Every transition is validated server-side (`canTransition`) and rejected
otherwise - a client can never skip a step or replay one. `VerificationService`
is the only thing allowed to persist a transition, and every transition
publishes a sequenced WebSocket event (see below).

### REST API (`/api/v1`, `apps/api/src/verification/verification.controller.ts`)

| Method | Path | Caller | Auth |
| --- | --- | --- | --- |
| POST | `/verification-sessions` | extension | rate-limited, origin-checked |
| GET | `/verification-sessions/mobile/:token` | mobile | token in path |
| POST | `/verification-sessions/mobile/:token/start` | mobile | token in path |
| POST | `/verification-sessions/mobile/:token/complete-demo` | mobile (demo provider only) | token in path |
| POST | `/verification-sessions/:id/cancel` | extension | `Authorization: Bearer <desktopToken>` |
| GET | `/verification-sessions/:id/status` | extension | `Authorization: Bearer <desktopToken>` |
| POST | `/webhooks/verification/:provider` | verification provider | signature-verified in the provider adapter |

### WebSocket (`ws://<api>/ws/verification?token=<desktopToken>`)

The desktop token authenticates the connection itself (no separate login).
On connect the server sends a `connection.ack` with the session's current
`status` and `seq`; every subsequent status change is pushed as
`verification.session.updated` with a monotonically increasing `seq`, so a
client that reconnects (the extension's service worker can be suspended by
the browser at any time) can simply keep the highest `seq`/`status` it has
seen rather than needing full event replay. A single API process's gateway
only holds the sockets connected to *it*; cross-process fan-out goes through
Redis pub/sub (`apps/api/src/websocket/redis-session-events.publisher.ts`),
so the WebSocket layer is stateless enough to run behind a load balancer
across multiple instances.

### Chrome extension (`apps/extension`)

- **Background service worker** (`entrypoints/background.ts`) owns session
  lifecycle, the WebSocket connection, and message routing. State is kept in
  `chrome.storage.session` (survives the service worker being suspended and
  restarted, but not a full browser restart - appropriate for a 5-minute
  transaction) and the worker reconnects on wake if a non-expired,
  non-terminal session is stored.
- **Popup** (`entrypoints/popup`) is a pure view over background state -
  `GET_VERIFICATION_STATE` on mount, live updates via
  `VERIFICATION_STATUS_CHANGED` broadcasts while open. Because all real state
  lives in the background worker (and ultimately the server), closing the
  popup can never corrupt anything.
- **Content script + `SiteAdapter`** (`entrypoints/content.ts`,
  `lib/site-adapters`): a controlled integration layer, not a generic DOM
  hook. See [Writing a SiteAdapter](#writing-a-siteadapter).
- **Message validation**: every message that crosses a trust boundary
  (`window.postMessage` from an untrusted page, `chrome.runtime` messages
  between content/popup/background) is checked against a runtime shape guard
  (`lib/messaging/guards.ts`), not just a TypeScript type.

### Mobile PWA (`apps/mobile`)

Route `/session/:token`. Opens the session (which also marks it
`MOBILE_OPENED`), shows a live countdown, and only calls
`getUserMedia({ video: { facingMode: "user" } })` after an explicit "Allow
Camera" tap - never on mount. No frame is ever captured, stored, or
uploaded; the demo provider's completion is a deliberate button press, not a
biometric check.

Also runs the "open the native app if it's installed" attempt
(`src/lib/app-redirect.ts`) before rendering the rest of the flow - see
[Deep linking](#deep-linking-app-then-browser).

### Native app (`apps/native`)

An Expo/React Native app (Expo SDK 57, file-based routing via
`expo-router`) that mirrors the mobile PWA's session flow
(`app/session/[token].tsx`: loading → landing → camera → verifying →
success/failure/expired) using the same `@verifybridge/verification-sdk`
client and `@verifybridge/shared` types/state machine - it is a second
client of the same REST API, not a separate backend integration.
`@verifybridge/ui` (DOM/Tailwind) is not reused here; native screens use
plain React Native primitives.

**Face detection gate** (`components/FaceScanCamera.tsx` +
`lib/face-gate.ts`): once the user taps "Allow Camera", the app captures a
still frame roughly every 700ms (`expo-camera`'s `takePictureAsync`) and
runs it through on-device Google ML Kit face detection
(`@react-native-ml-kit/face-detection`). `evaluateFaceGate` (a pure,
independently unit-tested function) checks the result for exactly one face,
close enough to the camera, centered in frame, and (when ML Kit reports eye
state) not obviously eyes-closed - the "Continue"/"Complete demo
verification" button only becomes tappable once that gate passes. Every
captured frame is deleted immediately after detection
(`new File(uri).delete()`); nothing is stored or transmitted - this is
strictly a local sanity/liveness-ish check, **not** identity matching, and
not a substitute for a real provider's anti-spoofing pipeline (same
disclaimer as the demo provider itself - see
[What this is NOT](#what-this-is-not)).

Because native camera linking and ML Kit aren't compatible with Expo Go,
this app requires a custom dev client / prebuild - see
[Running the native app](#running-the-native-app).

## Deep linking: app-then-browser

Clicking the same verification link (from the QR code, "copy link", or a
shared URL) opens the native app if it's installed, and the mobile PWA
otherwise. The QR code and every generated link always encode the
**HTTPS** mobile URL (`PUBLIC_MOBILE_URL/session/:token`) - never a
custom scheme directly - so a link is always openable even when the app
isn't installed; only the app hand-off itself is layered on top:

1. **Android App Links / iOS Universal Links** (production): when
   `apps/native`'s `android.intentFilters`
   (`autoVerify: true`)/`ios.associatedDomains` are configured with real
   values and the corresponding `.well-known` files are served from the
   mobile PWA's own host, the OS intercepts the HTTPS URL before it ever
   reaches a browser and opens the native app directly - no JavaScript
   involved, and it degrades to the browser automatically if the app isn't
   installed or verification fails.
2. **Client-side fallback** (`apps/mobile/src/lib/app-redirect.ts`, always
   active, including dev): once the PWA loads, it sets
   `location.href = "verifybridge://session/:token"` and watches
   `visibilitychange`. If the OS switches away from the tab (the app took
   the hand-off) within ~1.3s, the browser UI is skipped entirely, with a
   "Continue in browser instead" escape hatch always visible. If nothing
   happens within that window - the common case in development, or in
   production for someone without the app and without a browser prompt for
   the unregistered scheme - it falls through to the normal browser flow.
   If the user *does* get handed to the app but returns to the browser tab
   afterwards (backgrounded the app, dismissed an "Open in app?" prompt),
   the same code detects that and falls through then instead, so there's
   never a dead end.

### Setting up real App Links / Universal Links

The `.well-known` files ship with obvious placeholders
(`apps/mobile/public/.well-known/assetlinks.json`,
`.../apple-app-site-association`) - replace them for a real deployment:

- **Android**: get your release signing certificate's SHA-256 fingerprint
  (`eas credentials -p android`, or your Play Console App Signing details)
  and put it in `assetlinks.json`'s `sha256_cert_fingerprints`. The file
  must be served over HTTPS from exactly the host in
  `EXPO_PUBLIC_MOBILE_HOST` (`apps/native/app.config.ts`'s
  `android.intentFilters`), with no redirects.
- **iOS**: put your real Apple Team ID in
  `apple-app-site-association`'s `appID` (`TEAMID.com.verifybridge.app`).
  The file must be served with no extension, over HTTPS, ideally as
  `Content-Type: application/json`, from the same host as
  `ios.associatedDomains`.
- Both files are already copied into `apps/mobile`'s build output as-is
  (they live under `apps/mobile/public/.well-known/`) - whatever static
  host serves the built mobile app serves these too, as long as it doesn't
  add a redirect or strip the extension-less iOS file.

## Security assumptions

- **Tokens**: desktop/mobile tokens are 256 bits of `crypto.randomBytes`,
  returned to the caller exactly once (at creation). Only their HMAC-SHA256
  hash (keyed with `TOKEN_HASH_SECRET`) is ever persisted - see
  `apps/api/src/verification/token.util.ts`. Lookups are indexed-equality
  queries on the hash column; a high-entropy token doesn't need a slow
  password-style hash.
- **Single-use**: every mutating mobile action requires the session to be in
  the exact expected status; a replayed call against an already-resolved
  session gets `SESSION_CONSUMED` (410), never a silent no-op success.
- **Expiry**: sessions default to a 5-minute TTL (`SESSION_TTL_SECONDS`),
  enforced lazily on every access (no cron needed) - a non-terminal session
  read after its TTL is transitioned to `EXPIRED` and rejected, both for the
  mobile link and the desktop token.
- **Origin binding**: `VerificationService.createSession` checks the
  caller's `Origin` header (when present) against the origin it claims to be
  creating a session for, so one site can't request a session while claiming
  to be another. The Chrome extension's own origin is exempted via
  `TRUSTED_INTERMEDIARY_ORIGINS` (it legitimately creates sessions on behalf
  of whatever tab it's acting for) - this is a *different* boundary from
  CORS (see below) and is where the real security property lives.
- **CORS is not access control**: `apps/api/src/main.ts`'s CORS policy only
  decides which *browser pages* may read a response - it can't stop a
  non-browser client from calling the API with any `Origin` header it likes,
  so it isn't relied on for security. `chrome-extension://` origins are
  always allowed (a published extension has one fixed ID shared by every
  install anyway); everything else must be in `CORS_ALLOWED_ORIGINS`.
- **Rate limiting**: session creation is rate-limited per IP via Redis
  (`RateLimitGuard`), independent of the process, so it holds across
  multiple API instances.
- **The demo provider can never forge a real result**: `completeDemoVerification`
  is refused (`ProviderVerificationError`) unless the configured provider's
  `name` is literally `"demo"`. There is no code path where a bare
  `{ verified: true }` from the phone is trusted directly - even the demo
  path goes through the same state-machine validation
  (`VERIFYING` → `VERIFIED`/`FAILED`) that a real provider's signature-verified
  webhook uses.
- **Webhooks**: `WebhooksController` requires the raw request body
  (`rawBody: true` on the Nest app) and delegates signature verification to
  the provider adapter (`VerificationProvider.verifyWebhook`) before trusting
  anything in the payload.
- **No biometric data at rest**: VerifyBridge's own tables hold session
  metadata only (origin, status, timestamps, a `providerSessionId` string) -
  never an image. Structured logs (`apps/api/src/common/logger`) redact
  `Authorization`, cookies, and request bodies, and never include a raw
  token or provider secret.
- **CSP/Helmet**: the API is JSON-only and ships a strict
  `default-src 'none'` CSP plus `crossOriginResourcePolicy: same-site`.

## Local development

Prerequisites: Node 20+, pnpm 10+, a local Postgres 16 and Redis (via
`docker-compose.yml`, or natively installed - both work).

```bash
pnpm install                 # also runs `prisma generate` and `wxt prepare`
docker compose up -d         # Postgres + Redis (skip if you already have both running)

cp .env.example apps/api/.env
cp apps/mobile/.env.example apps/mobile/.env
cp apps/extension/.env.example apps/extension/.env
# edit apps/api/.env: point DATABASE_URL/REDIS_URL at your local services

pnpm --filter @verifybridge/api run db:migrate

pnpm build:packages          # packages/shared, packages/ui, packages/verification-sdk
pnpm dev:api                 # http://localhost:4000
pnpm dev:mobile              # http://localhost:5174
pnpm dev:demo                # http://localhost:5175
pnpm dev:extension           # writes .output/chrome-mv3 continuously; load it (below)
```

Or run everything except the extension at once with `pnpm dev` (it builds
the packages first, then runs every app's dev server in parallel).

### Root commands

```
pnpm install        # installs deps, generates the Prisma client, prepares WXT types
pnpm dev             # build packages, then run every app's dev server
pnpm dev:api / dev:mobile / dev:extension / dev:demo
pnpm build           # build packages, then every app (production bundles)
pnpm test            # unit tests for every package (fast, no external services)
pnpm lint            # ESLint across the whole repo
pnpm typecheck       # tsc --noEmit for every package
```

`apps/api` also has `pnpm --filter @verifybridge/api run test:e2e`, which
runs real HTTP + WebSocket integration tests against your local
Postgres/Redis (not part of the default `pnpm test`, since it needs live
infrastructure) - see [Tests](#tests).

## Loading the Chrome extension

```bash
pnpm --filter @verifybridge/extension run build
```

Then in Chrome (116+):

1. Go to `chrome://extensions`
2. Enable **Developer mode** (top right)
3. **Load unpacked** → select `apps/extension/.output/chrome-mv3`
4. Copy the extension's ID from that page
5. Add it to `apps/api/.env`:
   `TRUSTED_INTERMEDIARY_ORIGINS=chrome-extension://<that-id>`
   (needed so the extension's `createSession` origin check passes - see
   [Security assumptions](#security-assumptions))
6. Restart the API (`pnpm dev:api` / rebuild + restart)

For active development, `pnpm dev:extension` (or
`pnpm --filter @verifybridge/extension run dev`) rebuilds on save - reload
the unpacked extension from `chrome://extensions` after changes to the
manifest/background/content script (the popup hot-reloads on its own).

## Running the native app

`apps/native` needs a custom dev client (native camera linking + ML Kit
aren't Expo-Go compatible) and, for Android, a local Android SDK.

```bash
cp apps/native/.env.example apps/native/.env
pnpm --filter @verifybridge/native run prebuild   # expo prebuild --clean, generates android/ (and ios/ on a Mac)
pnpm --filter @verifybridge/native run android    # expo run:android - builds + installs the dev client
```

`prebuild` regenerates `android/`/`ios/` from `app.config.ts` and is
git-ignored by design (Continuous Native Generation) - never hand-edit
those folders; change `app.config.ts` or its plugins instead and re-run
`prebuild`.

**Android, verified in this repo**: a real (non-emulator) build was
verified by installing a minimal Android SDK (`cmdline-tools`,
`platform-tools`, `platforms;android-35`, `build-tools;35.0.0`) and running
`./gradlew assembleDebug` against the `expo prebuild`-generated project -
see the commit history for the exact command and its output. Running the
app on a device/emulator (`expo run:android` end-to-end, including
granting camera permission and pointing the camera at a face) has not been
manually exercised in this environment (no emulator/device attached here);
the compiled build and the independently unit-tested `lib/face-gate.ts`
logic are the verification that exists.

**iOS could not be built or verified in this environment** - it requires
Xcode on a Mac (or EAS Build's iOS queue), neither of which is available
here. The `ios.bundleIdentifier`/`associatedDomains` config
(`app.config.ts`) and the `expo-camera` plugin are written correctly per
Expo's SDK 57 docs, but have only been checked for configuration
correctness, not compiled. Verify with `pnpm --filter @verifybridge/native
run ios` (or `eas build -p ios`) on a Mac before shipping.

## Testing the mobile app

The mobile app is a normal Vite dev server (`pnpm dev:mobile`,
`http://localhost:5174`) - open it directly with a session URL from the
extension popup ("Copy Link") to test in a desktop browser.

**Camera access requires a secure context** (HTTPS, or `localhost`/
`127.0.0.1`, which browsers treat as secure). `localhost` works out of the
box for desktop Chrome. To test on a real phone on your network, you need
either:

- An HTTPS development tunnel (e.g. `ngrok http 5174`, or a similar tool) -
  point `WXT_PUBLIC_MOBILE_URL` (extension) and `PUBLIC_MOBILE_URL` (API) at
  the tunnel's HTTPS URL, or
- A locally-trusted HTTPS certificate for your machine's LAN IP (e.g. via
  `mkcert`) served through Vite's `server.https` option.

Do not disable Chrome's secure-context requirement to work around this -
`getUserMedia` refusing to run over plain HTTP on a non-localhost host is
the correct, intended behavior.

## Running the demo end to end

```bash
pnpm dev:api
pnpm dev:mobile
pnpm dev:demo
pnpm --filter @verifybridge/extension run build   # then load unpacked, see above
```

Open `http://localhost:5175`, click **Verify using phone**, open the QR/link
from the extension popup on your phone (or another browser tab/profile on
the same machine), press **Continue → Allow Camera → Continue → Complete
demo verification**. The demo site's "Identity verified ✓" appears
automatically, no refresh.

### The one committed, automated version of this

```bash
pnpm build      # api, mobile, demo-site, extension all need a production build
pnpm --filter @verifybridge/api run db:migrate
pnpm --filter @verifybridge/e2e run test
```

`e2e/tests/full-flow.spec.ts` loads the real built extension into a real
(headless) Chromium via `launchPersistentContext` and drives the exact flow
above against your real Postgres/Redis - demo site click → content script →
background → real session → popup QR link → mobile camera (a fake device,
no physical webcam needed) → demo-complete → WebSocket push → demo site
updates live. It also starts the api/mobile/demo-site servers itself
(`playwright.config.ts`'s `webServer` array) if they aren't already running.
Building this test for real (rather than only mocking each app in
isolation) caught real bugs - see the git history around when `e2e/` was
added.

## Tests

| Where | What | Needs |
| --- | --- | --- |
| `packages/shared` | status state machine, Zod schemas | nothing |
| `packages/ui` | interactive/accessible components | nothing |
| `packages/verification-sdk` | REST client error mapping, WS reconnect/seq-dedup | nothing |
| `apps/api` (`pnpm test`) | token hashing, full session-service state machine (mocked repo/provider) | nothing |
| `apps/api` (`pnpm run test:e2e`) | real HTTP + WebSocket flow, expiry, replay, rate limiting, origin binding | local Postgres + Redis |
| `apps/mobile` | invalid/expired session, camera denied, demo success/failure, app-then-browser hand-off timing | nothing (mocks `getUserMedia`/API client/app-redirect) |
| `apps/native` | `evaluateFaceGate`'s gating logic (single/no/multiple faces, too small, off-center, eyes closed, missing eye data) | nothing |
| `apps/extension` | message guards, site-adapter matching, background message routing, popup rendering | nothing (WXT's `fake-browser`) |
| `apps/demo-site` | extension-not-found timeout, live update to "Identity verified" | nothing |
| `e2e` | the real thing, in a real browser | built apps + local Postgres/Redis |

## Writing a `SiteAdapter`

```ts
// apps/extension/lib/site-adapters/your-site.adapter.ts
import type { SiteAdapter } from "./types";

export const yourSiteAdapter: SiteAdapter = {
  name: "your-site",
  matches: (location) => location.origin === "https://your-site.example",
  detectVerificationPage: async () =>
    document.querySelector('[data-your-marker]') !== null,
  showVerifyBridgeOption: async () => {
    /* optional: enhance your page's own "verify with phone" affordance */
  },
  onVerificationCompleted: async (result) => {
    /* tell your page verification finished - e.g. window.postMessage,
       matching apps/demo-site's own listener - or direct DOM update */
  },
};
```

Register it in `apps/extension/lib/site-adapters/index.ts`, add your site's
origin to the content script's `matches` array in
`apps/extension/entrypoints/content.ts`, and add it to
`apps/demo-site`-style `window.postMessage` handling on your own page if
you want a live update without a page reload. See `demo-site.adapter.ts`
for a complete worked example, including the badge-injection and
postMessage-relay patterns.

## Writing a `VerificationProvider`

```ts
// apps/api/src/verification/providers/your-provider.provider.ts
import type { VerificationProvider } from "./verification-provider.interface";

@Injectable()
export class YourProvider implements VerificationProvider {
  readonly name = "your-provider";
  async createVerification(session) { /* call the vendor's API, return { providerSessionId } */ }
  async getVerificationStatus(providerSessionId) { /* poll the vendor, if it supports that */ }
  async verifyWebhook({ headers, rawBody, body }) {
    /* verify the vendor's signature against rawBody - throw if invalid -
       then return { providerSessionId, status, failureReason? } */
  }
}
```

Register it in `providers.module.ts`'s factory (keyed by
`VERIFICATION_PROVIDER`), set `VERIFICATION_PROVIDER=your-provider` in
`apps/api/.env`, and point the vendor's webhook at
`POST /api/v1/webhooks/verification/your-provider`. Nothing else in
`VerificationService` changes - it only ever calls the injected
`VerificationProvider` interface.

## Production deployment considerations

```
Cloudflare / CDN
      │
      ▼
API Gateway / load balancer
      │
      ▼
NestJS instances (stateless - no in-memory session/WS state)
 ┌────┴────┐
 ▼         ▼
Redis    PostgreSQL
      │
      ▼
Verification Provider
```

- Set real random secrets for `TOKEN_HASH_SECRET` and `WEBHOOK_SIGNING_SECRET`
  (`openssl rand -hex 32`) - never the `.env.example` placeholders.
- Terminate TLS in front of the API; `PUBLIC_API_URL`/`PUBLIC_MOBILE_URL`
  should be HTTPS, and the extension's `wsUrl` derives its scheme from
  `PUBLIC_API_URL` (`https` → `wss`).
- `CORS_ALLOWED_ORIGINS` should list your real integrated site origins only;
  once the extension is published to the Chrome Web Store it has one fixed
  ID - `chrome-extension://` origins are always allowed regardless (see
  [Security assumptions](#security-assumptions)), but you can further pin
  `TRUSTED_INTERMEDIARY_ORIGINS` to that exact published ID.
- Run `prisma migrate deploy` (not `migrate dev`) in CI/CD.
- The WebSocket gateway is per-process; horizontal scaling works because
  fan-out goes through Redis pub/sub, not in-memory state - just make sure
  your load balancer supports WebSocket upgrades and sticky-enough routing
  isn't required (any instance can serve any connection; Redis carries
  cross-instance events).
- Swap `DemoVerificationProvider` for a real one before going live -
  `VERIFICATION_PROVIDER=demo` should never be set in production, and the
  demo-only mobile completion endpoint refuses to run against any other
  provider name regardless.

## Accessibility

Interactive components (`packages/ui`) use semantic elements and real
`<button>`s throughout, visible focus rings
(`focus-visible:ring-2`), `aria-live="polite"` status regions that announce
*transitions* rather than every tick of a countdown (a fast-ticking
countdown is deliberately not wired into a live region - see
`Countdown`'s and `StatusIndicator`'s doc comments), and
`motion-safe:`-guarded animation for `prefers-reduced-motion`. Both light
and dark themes are supported via CSS custom properties
(`packages/ui/src/theme.css`).

## Privacy

VerifyBridge's own database never stores a face image - only session
metadata (origin, status, timestamps, a provider-assigned session ID
string). The mobile app only shows a camera preview locally; no frame is
captured or uploaded by this codebase. Actual biometric processing is the
verification provider's responsibility once a real one is wired in
(`VerificationProvider.createVerification` is where a real provider's
hosted flow or SDK would take over) - VerifyBridge's session domain and a
provider's biometric processing are deliberately separate concerns, joined
only by `providerSessionId`.

## Acceptance checklist

- [x] Chrome extension loads successfully (`wxt build` → load unpacked)
- [x] Extension can create a session (real API call, verified via the
      Playwright e2e test and the `apps/extension` unit tests)
- [x] QR code is generated (`packages/ui`'s `QRCodeCard`)
- [x] QR opens the mobile PWA
- [x] Mobile session is authenticated (token in the URL path)
- [x] Phone camera permission works (`getUserMedia`, explicit user gesture)
- [x] Demo verification works (clearly marked development-only)
- [x] Backend transitions session state correctly (state machine + tests)
- [x] WebSocket sends status changes (sequenced, Redis-fanned-out)
- [x] Extension updates in real time
- [x] Popup can close without corrupting session state (all state lives in
      the background worker + server)
- [x] Demo desktop website receives VERIFIED
- [x] Desktop UI updates without refresh
- [x] Expired links fail securely (`SESSION_EXPIRED`, lazily enforced)
- [x] Used links cannot be replayed (`SESSION_CONSUMED`)
- [x] Raw tokens are never stored in the database (HMAC hash only)
- [x] No biometric image is stored by default
- [x] Production provider interface exists (`VerificationProvider`)
- [x] Demo provider is clearly marked development-only (in its own doc
      comment, its log warning on boot, and the mobile UI's "Development
      only" badge)
- [x] Native app (Expo/React Native, Android + iOS) mirrors the mobile PWA's
      verification flow against the same API
- [x] Real on-device face detection (Google ML Kit) gates the native app's
      demo-completion button - not identity matching, not a liveness bypass
- [x] Captured frames are deleted immediately after on-device detection -
      never stored, never transmitted
- [x] Clicking a verification link opens the native app if installed, the
      browser otherwise (App Links/Universal Links in production; a
      visibility-timeout JS fallback always active, including dev)
- [x] QR code / generated links always encode the HTTPS mobile URL, never a
      custom scheme, so opening one never dead-ends without the app
- [x] Native app's Android build verified for real in this environment
      (`expo prebuild` + `./gradlew assembleDebug`); iOS could not be built
      here (no Mac/Xcode) - documented, not silently skipped
- [x] This README explains the full system

## License

MIT - see [LICENSE](./LICENSE).
