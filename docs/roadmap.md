# Roadmap — controlled sequence

Never build everything at once. Stop gates are mandatory.

## Now — Launch foundations, zero owner cash (decided 2026-09-16)

Business shape and rules: `docs/business-model.md`, `docs/standard.md`.

| Step | Deliverable                                                                                                | Status |
| ---- | ---------------------------------------------------------------------------------------------------------- | ------ |
| F1   | Repository in git                                                                                          | DONE   |
| F2   | Business model + Standard written as law (docs, AGENTS.md, decision log)                                   | DONE   |
| F3   | Ad Charter as pure, tested code (`evaluateAdBreak`)                                                        | DONE   |
| F4   | Watched minutes + producer statements as pure, tested code                                                 | DONE   |
| F5   | Share previews with absolute URLs + static export for Cloudflare Pages + build-time guard                  | DONE   |
| F6   | Adaptive video: HLS packaging script + player + current/next-only preload                                  | DONE   |
| F7   | Event collector (Workers + D1) — needs the owner's Cloudflare account                                      | todo   |
| F8   | Rights metadata per series: territories, languages, window, producer of record                             | DONE   |
| F9   | Content pipeline: one command from a studio delivery to a live series, with a gate that measures (`docs/content-operations.md`) | DONE |
| C1   | Content gate: 45–60 English series in 3 clusters + 12–20 new per month signed (`docs/content-strategy.md`) | todo   |

**Stop.** No public launch before the content gate C1 is met (owner decision 2026-09-16). Closed beta first, with the same catalog and zero ads, to measure D1/D7, series completion and catalog exhaustion. F5–F8 must be live for the beta.

F8 detail (2026-09-18): rights live on the series itself — `SeriesRights` in
`packages/feed-domain/src/model/types.ts` (territories, languages, `windowStart`,
`windowEnd`), plus `producerId` and `socialClipsAllowed`. They are delivered in
`content/series/<slug>/series.json`, carried into the generated manifest, required by
`validateCatalog`, and enforced by `toPublishedCatalog`, which does not list a series
outside its window. The remaining limit is that the site is a static export: a window that
closes removes the title at the next build, not at the minute.

## Phase 1 — Foundation (STOP & TEST)

| Step | Prompt                | Deliverable                                                                                                           |
| ---- | --------------------- | --------------------------------------------------------------------------------------------------------------------- |
| 1    | Master / architecture | Repo boundaries, docs OS, empty packages                                                                              |
| 2    | Design system         | Tokens + feed-first primitives                                                                                        |
| 3    | Vertical feed         | **C.1–C.2 DONE** · **L1 DONE** · **L1.5 DONE** (analytics transport + watch hardening + share attribution + DEV diag) |

**Stop.** Validate: cold open → video → swipe → video feels exceptional.

## Phase 2 — Retention

| Step | Prompt            | Deliverable                                                                                                           |
| ---- | ----------------- | --------------------------------------------------------------------------------------------------------------------- |
| 4    | Continue Story    | Exact resume + post-episode one-tap continuity                                                                        |
| 5    | Recommendation V0 | **DONE** — deterministic candidates + ranking + affinity profile + diversity/exploration + flags + analytics (not ML) |
| 6    | Scene Graph V0    | **DONE** — typed scene metadata + query API + validation + aggregation + DEV inspector (not a graph DB / not ML)      |

### Scene Graph V0 notes

- Location: `apps/mobile/src/features/scene-graph/`
- Purpose: **content intelligence foundation**, not a recommendation engine.
- Storage: document/memory interface (replaceable) — graph DB intentionally deferred.
- Extraction: hand-authored fixtures — automated video analysis intentionally deferred.
- Ranking: `SCENE_GRAPH_SIGNALS_V0` default OFF; Recommendation V0 works without it.
- Explicit non-goals: embeddings, vector DB, LLM feed ranking, Intent Layer, Demand Graph, consumer scene search, remix engine.

## Phase 3 — Intent

| Step | Prompt       | Deliverable                                                                                                                   |
| ---- | ------------ | ----------------------------------------------------------------------------------------------------------------------------- |
| 7    | Intent Layer | **DONE** — S3 sheet + chips + layered parser + Scene/Rec mapping + NEXT_ITEM lifetime (not a chatbot)                         |
| 8    | Demand Graph | **DONE** — DemandSignal + normalization + gap/validation lifecycle + ProductionSignal foundation (not ML / not a marketplace) |

### Demand Graph V0 notes

- Purpose: turn unmet viewing intent into **measurable**, behaviorally checked demand — not search vanity metrics.
- Flag: `DEMAND_GRAPH_V0` default OFF; never blocks OPEN→VIDEO.
- CONTENT_GAP ≠ INTENT_GAP; only validated CONTENT_GAP can become ProductionSignal.
- Confidence = evidence volume, **not** predicted audience.
- Privacy: hashed anonymous ids, no raw private queries, no precise location, aggregate-only producer view.
- Explicit non-goals: graph DB, vector DB, ML forecasting, semantic LLM clustering, auto production, producer consumer UI.

## Phase 4 — Growth

| Step | Prompt             | Deliverable                        |
| ---- | ------------------ | ---------------------------------- |
| 9    | Share / deep links | 1-tap share → land on exact moment |

## Phase 5 — Monetization

| Step | Prompt         | Deliverable                          |
| ---- | -------------- | ------------------------------------ |
| 10   | AdPolicy layer | Abstracted ads, no coins, measurable |

## Phase 6 — Content ops

| Step | Prompt                | Deliverable                                   |
| ---- | --------------------- | --------------------------------------------- |
| 11   | Localization pipeline | Status-tracked adaptation                     |
| 12   | Admin CMS             | RBAC console for catalog + performance + gaps |

## Phase 7 — Optimization

| Step | Prompt                    | Deliverable                            |
| ---- | ------------------------- | -------------------------------------- |
| 13   | Hostile performance audit | Feed + first play first                |
| 14   | UX surgery                | Top 3 frictions only, then re-evaluate |

## Explicit non-goals until Phase 1 passes

- 300 screens
- Account wall before first play
- Coins / fake currency
- Full CMS
- ML personalization
- Chatbot as primary UX
- Graph DB
- Multi-brand theming systems
