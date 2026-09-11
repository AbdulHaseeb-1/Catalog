# VerifyBridge monorepo

This repository is a pnpm workspace. Package managers other than pnpm are not
supported — always run commands with `pnpm`.

## Stack versions in use (do not assume older/deprecated APIs)

- TypeScript ^6.0.2 everywhere except `apps/extension`, which is pinned to
  ^5.9.3 to match WXT's current toolchain.
- NestJS 12 (`apps/api`), ESM-native (`"type": "module"`, `moduleResolution:
  "nodenext"`). Relative imports must use explicit `.js` extensions even
  though the source files are `.ts`.
- Prisma ORM 7. The client generator is `provider = "prisma-client"` with an
  explicit `output`, configured via `prisma.config.ts` (not the old
  `datasource { url = env(...) }` inline syntax), and instantiated with the
  `@prisma/adapter-pg` driver adapter.
- Vite 8 / React 19 (`apps/mobile`, `apps/demo-site`).
- Tailwind CSS v4 via the `@tailwindcss/vite` plugin — there is no
  `tailwind.config.js`; configuration lives in CSS via `@import "tailwindcss"`
  and `@theme`.
- WXT 0.21 for the Chrome extension (Manifest V3, Chrome 116+). Auto-imports
  are disabled (`imports: false` in `wxt.config.ts`); import WXT APIs
  explicitly from `#imports`.
- Zod v4 (`z.email()` not `.email()`, `error` option not `message`).
- Vitest is the test runner for every package (including the NestJS API).

Before changing how any of these tools are configured, check the current
official docs for that exact major version — several of these libraries
changed significantly in ways that differ from older tutorials/training data.

## Verifying changes

Run, from the repo root:

```
pnpm typecheck
pnpm lint
pnpm test
```

`apps/api` tests that touch Postgres/Redis expect a local instance reachable
via the `DATABASE_URL`/`REDIS_URL` in `apps/api/.env` (see
`docker-compose.yml` for the expected local setup).
