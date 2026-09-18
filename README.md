# PROJECT FLOW

Make short drama feel inevitable. **FAST · BEAUTIFUL · ADDICTIVE**

Core loop: `OPEN → VIDEO STARTS → SWIPE → CONTINUE → FOLLOW → RETURN TOMORROW`

A short-drama **distributor**: the best vertical dramas made by others, free for every viewer, forever. Business shape in [`docs/business-model.md`](docs/business-model.md), measurable rules in [`docs/standard.md`](docs/standard.md).

This repo is a TypeScript monorepo. The web feed and player work end to end on a stand-in content pack; there is no monetization code yet.

## Structure

```
apps/web/                    Next.js consumer product (WEB-FIRST launch)
apps/mobile/                 Expo foundation (future native)
packages/feed-domain/        shared catalog, feed, resume, recommendation, intent
packages/shared/             config + feature flags
packages/design-system/      semantic tokens
packages/analytics/          analytics provider abstraction
packages/ui/                 RN UI primitives (mobile)
docs/                        product OS + MVP V0 spec
```

## Run the product (web-first)

```bash
cd C:\Users\Simone\CascadeProjects\project-flow
npm run web
```

Opens **http://localhost:3000** — open → watch → swipe.  
Deep links: `/watch/signal-night/episode-1` … `/watch/signal-night/episode-5` (stand-in pack, not licensed drama)

Expo mobile preview (not the launch surface): `npm run web:expo`

## Prerequisites

- Node.js 20+ (22 recommended)
- npm 10+
- Expo Go or a dev client for device/simulator runs

## Setup

```bash
cp .env.example .env
npm install
```

## Commands

| Command              | Purpose                                                                                                |
| -------------------- | ------------------------------------------------------------------------------------------------------ |
| `npm start`          | Start Expo for `apps/mobile`                                                                           |
| `npm run android`    | Expo Android                                                                                           |
| `npm run ios`        | Expo iOS (macOS)                                                                                       |
| `npm run typecheck`  | Strict TypeScript across workspaces                                                                    |
| `npm run lint`       | ESLint + invisible control-byte scan                                                                   |
| `npm test`           | Vitest suite                                                                                           |
| `npm run format`     | Prettier write                                                                                         |
| `npm run export:web` | Checked static export for deploy (see below)                                                           |
| `npm run serve:web`  | Serve `apps/web/out` like Cloudflare Pages on http://localhost:3100                                    |
| `npm run e2e:web`    | Real Chrome, phone profile: open → play → preload budget → swipe → deep link → 404 (run after a build) |

## Publishing a series

`node scripts/ingest-series.mjs [slug]` turns a studio delivery (`content/series/<slug>/`: masters, subtitles and a `series.json` carrying the rights) into a publishable series: adaptive HLS, a WebP poster, a 1200×630 link card, verified WebVTT and the series manifest the catalog is built from. It is idempotent — an unchanged episode is not re-encoded — and it refuses the whole series when one episode would break the feed. Everything is built in a stage folder and swapped in only when the whole series passes, so a refusal leaves every published file and the manifest byte for byte as they were.

`node scripts/package-episode.mjs <master> <output-dir>` does one episode, with the same quality gate: vertical, at least 1080×1920, one dialogue audio track, loudness normalised to −16 LUFS and measured back on the packaged audio, no black, frozen or silent opening, and a lightest rung under 5 MB per watched minute.

`npm run proof:gate` proves the pipeline on 18 real deliveries (CI runs it): each broken rule refused for the reason it should be, real endings (fade to black, end card, freeze-frame) accepted, and a refused re-delivery proven to change no published file.

What a studio must deliver, what each check means and what to do when one fails: [`docs/content-operations.md`](docs/content-operations.md). Example pack: `content/series/signal-night/README.md`.

## Deploy — Cloudflare Pages (free tier)

The web app is a static export in `apps/web/out`: no server to pay for, every request a CDN hit.

| Pages setting                    | Value                                                                              |
| -------------------------------- | ---------------------------------------------------------------------------------- |
| Build command                    | `npm run export:web`                                                               |
| Build output directory           | `apps/web/out`                                                                     |
| `NODE_VERSION`                   | `22`                                                                               |
| `NEXT_PUBLIC_SITE_URL`           | public https origin, no path                                                       |
| `NEXT_PUBLIC_ANALYTICS_ENDPOINT` | event collector (roadmap F7); or `FLOW_ALLOW_NO_ANALYTICS=1` for a private preview |

`npm run export:web` refuses to build without the site URL or the analytics endpoint, and refuses to publish an export whose share previews (`og:image`, `og:url`, `twitter:image`) point anywhere but the site URL.

Publication and rights expiry are evaluated **at build time**: rebuild whenever the catalog or a rights window changes.

## Environment

See `.env.example`. Currently:

- `FLOW_APP_ENV` — `development` | `test` | `production`

No secrets are required for Prompt A. Do not commit `.env`.

## Development principles

1. Follow `docs/` and `docs/mvp/MVP-V0-SPEC.md`.
2. Smallest viable change. Justify new dependencies.
3. Coins, paywalls and unlock mechanics are forbidden forever (`AGENTS.md`).
4. Never claim done without typecheck + lint + tests.

## Product docs

- [`docs/business-model.md`](docs/business-model.md)
- [`docs/standard.md`](docs/standard.md)
- [`docs/content-strategy.md`](docs/content-strategy.md)
- [`docs/content-operations.md`](docs/content-operations.md)
- [`docs/vision.md`](docs/vision.md)
- [`docs/product-principles.md`](docs/product-principles.md)
- [`docs/ux-principles.md`](docs/ux-principles.md)
- [`docs/metrics.md`](docs/metrics.md)
- [`docs/roadmap.md`](docs/roadmap.md)
- [`docs/decisions.md`](docs/decisions.md)
- [`docs/mvp/MVP-V0-SPEC.md`](docs/mvp/MVP-V0-SPEC.md)
