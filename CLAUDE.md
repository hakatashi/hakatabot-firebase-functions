# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Firebase Cloud Functions backend for **HakataBot**, a personal Slack bot / automation system for the user (hakatashi) and the TSG Slack workspace. It's one part of a series (see `hakatabot`, `hakatabot-heroku`). Functions are written in TypeScript, compiled to `functions/lib`, and deployed as Firebase Functions (2nd gen).

## Commands

Run from the repo root unless noted otherwise.

- `npm install` — root postinstall (`install` script) also runs `npm install` inside `functions/`.
- `npm run build` / `npm run build:watch` — compiles `functions/src` (TypeScript) via `tsc`, proxied to `functions/`.
- `npm run lint` / `npm run lint:fix` — ESLint over `functions/src/**/*`, proxied to `functions/`.
- `npm test` — runs Jest (ESM mode: `node --experimental-vm-modules ... jest.js --passWithNoTests`) from the root. Test files live next to source, e.g. `functions/src/crons/lib/social.test.ts`.
  - Run a single test file: `npm test -- functions/src/crons/lib/social.test.ts`
  - Run tests matching a name: `npm test -- -t "parseBlueskyUrls"`
- `npm run dev` — starts the Firebase emulator suite (`firebase emulators:start --export-on-exit db --import db`), persisting Firestore state to `./db` between runs.
- From `functions/`: `npm run serve` (build + emulate functions only), `npm run shell` (build + `firebase functions:shell`, useful for manually invoking cron functions), `npm run deploy` (`firebase deploy --only functions`), `npm run logs`.
- `firebase deploy` (root) deploys everything (Firestore rules/indexes + functions). The `functions` predeploy hook automatically runs lint then build.

There is no separate typecheck script — `tsc` (via `npm run build`) is both the build and the typecheck.

## Architecture

### Entry point and exports

`functions/src/index.ts` is the sole deployment entry point. It re-exports everything from `./crons/index.js` and `./api/index.js`, plus defines a handful of OAuth callback HTTP functions directly (Google, Fitbit, TikTok) and `slackEvent` (from `slack.ts`). Every exported `const` in files reachable from `index.ts` becomes an individually deployed Cloud Function — when adding a new scheduled job or HTTP endpoint, it must be re-exported through `crons/index.ts` or `api/index.ts` (or `index.ts` directly) to actually deploy.

Note: imports use `.js` extensions even though source is `.ts` — this is required because the project compiles to native ESM (`"type": "module"` in `functions/package.json`, `module: "ESNext"` in `tsconfig.json`).

### Three kinds of functions

1. **HTTP functions** (`onRequest` from `firebase-functions/v2/https`) — OAuth callbacks in `index.ts`, webhook/API endpoints in `functions/src/api/*.ts` (e.g. `updateSocialPost`, YouTube/Fitbit/Google-Form webhooks), and the Slack events endpoint `slackEvent` in `slack.ts`.
2. **Scheduled functions** (`onSchedule` from `firebase-functions/v2/scheduler`) — cron jobs in `functions/src/crons/*.ts`, one file per job (e.g. `sleep-battle.ts`, `sleep-report.ts`, `exercise-report.ts`, `wordblog.ts`, `it-quiz.ts`, `genshin.ts`). Shared logic used by multiple crons/APIs lives in `functions/src/crons/lib/` (e.g. `social.ts` for cross-posting to Bluesky/Mastodon/Threads, `sleep.ts` for the sleep-score regression model, `youtube.ts`, `tiktok.ts`, `instagram.ts`, `waka.ts`).
3. **Slack event handlers** — all registered in `functions/src/slack.ts` via a single `@slack/events-api` `eventAdapter`, exposed through the one `slackEvent` HTTP function. Each behavior (e.g. "letterpack bomb" reactji easter egg, "rinna signal" heuristic trigger, IT-quiz Google Calendar auto-add, Fitbit opt-in/out via Slack message) is a separate `eventAdapter.on('message' | 'reaction_added', ...)` listener added in this one file — read the whole file when touching Slack behavior, since listeners are independent but share module-level state helpers.

Cross-service messaging: some Slack listeners publish to a Google Cloud Pub/Sub topic (`hakatabot`) with a `type` field in the JSON payload instead of acting directly — the actual work is handled elsewhere (in the separate `hakatabot` service, not this repo).

### Persistence (`functions/src/firestore.ts`)

Firebase Admin is initialized here; all Firestore collection references are defined once and imported elsewhere (`GoogleTokens`, `FitbitTokens`, `TikTokTokens`, `States`, etc.) — don't call `db.collection(...)` ad hoc in feature files. `firestore.rules` denies all client access by default (functions use the Admin SDK, which bypasses rules); only two collections have narrow public rules (`vocaloid_quiz_answers`, `rhythm-game-play-records`) for a separate embedded quiz app.

There's a generic `State` class backed by the `states` collection for simple key/value cron-job state (`optoutUsers`, `slackUsers`, last-run timestamps, etc.) — check for an existing `State('some-job-name')` pattern before inventing new persistence for a cron job.

### Config and secrets

All secrets/config are pulled via `defineString(...)` from `firebase-functions/params` (Firebase's parameterized config, backed by `.env`/Secret Manager), never `process.env` directly. Search existing `defineString('...')` calls before adding a new one, to check whether a config value already exists under a different name.

### External integrations

Each third-party API gets its own top-level module or `crons/lib/` module: `fitbit.ts` (OAuth client + generic `get()` helper keyed by Fitbit user id), `google.ts` (OAuth client, `getGoogleAuth()` reads hakatashi's stored token — most Google API calls run as the single hakatashi account, not per-user), `cloudinary.ts`, `tiktok.ts`, `crons/lib/social.ts` (Bluesky/Mastodon/Threads cross-posting, including a hand-rolled URL parser `parseBlueskyUrls` for facet generation), `crons/lib/youtube.ts`, `crons/lib/instagram.ts`, `crons/lib/waka.ts`, `crons/lib/sleep.ts` (linear regression model via `ml-regression-multivariate-linear` for estimating a sleep score from Fitbit sleep-stage minutes).

Constants that identify specific Slack users/channels/IDs (`HAKATASHI_ID`, `SANDBOX_ID`, `TSGBOT_ID`, calendar/sheet/channel IDs, etc.) live in `functions/src/const.ts` — reuse these instead of hardcoding IDs.

## Code style

- ESLint config extends `@hakatashi/eslint-config/typescript.js` plus `eslint-plugin-canonical` (`eslint.config.mjs`). Tabs for indentation (see existing files). Notable enabled/disabled rules: `canonical/require-extension: error` (enforces the `.js` import extensions mentioned above), `@typescript-eslint/no-explicit-any: warn` (avoid `any` where practical, but it's not a hard error), `import/prefer-default-export: off`, `import/no-namespace: off`.
- `strict: true` in `tsconfig.json`, plus `noUnusedLocals` and `noImplicitReturns` — clean these up rather than suppressing.
- Tests use Jest with `ts-jest`'s ESM preset; test files are colocated as `*.test.ts` with `/* eslint-env jest */` at the top.
