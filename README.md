# PROJECT FLOW

Make short drama feel inevitable. **FAST · BEAUTIFUL · ADDICTIVE**

Core loop: `OPEN → VIDEO STARTS → SWIPE → CONTINUE → FOLLOW → RETURN TOMORROW`

This repo is a TypeScript monorepo. Prompt A established the foundation only — no feed, no video player, no monetization.

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
Deep links: `/watch/the-billionaires-secret/episode-1` · `/watch/the-last-vow/episode-1` · `/watch/house-of-lies/episode-1`

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

| Command | Purpose |
|---------|---------|
| `npm start` | Start Expo for `apps/mobile` |
| `npm run android` | Expo Android |
| `npm run ios` | Expo iOS (macOS) |
| `npm run typecheck` | Strict TypeScript across workspaces |
| `npm run lint` | ESLint |
| `npm test` | Vitest smoke tests |
| `npm run format` | Prettier write |

## Environment

See `.env.example`. Currently:

- `FLOW_APP_ENV` — `development` | `test` | `production`

No secrets are required for Prompt A. Do not commit `.env`.

## Development principles

1. Follow `docs/` and `docs/mvp/MVP-V0-SPEC.md`.
2. Smallest viable change. Justify new dependencies.
3. No feed/video/auth/coins until their prompts.
4. Never claim done without typecheck + lint + tests.

## Product docs

- [`docs/vision.md`](docs/vision.md)
- [`docs/product-principles.md`](docs/product-principles.md)
- [`docs/ux-principles.md`](docs/ux-principles.md)
- [`docs/metrics.md`](docs/metrics.md)
- [`docs/roadmap.md`](docs/roadmap.md)
- [`docs/decisions.md`](docs/decisions.md)
- [`docs/mvp/MVP-V0-SPEC.md`](docs/mvp/MVP-V0-SPEC.md)
