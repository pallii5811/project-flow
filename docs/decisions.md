# Decision log

Format: date · decision · why · consequences · revisit when.

---

## 2026-09-16 — Shell 10/10 interaction + typography lock

**Decision:** Finish consumer shell craft before licensed content: (1) tap-to-unmute on media surface (first tap = sound, later = play/pause); (2) ActionRail + progress mount only on active slide; (3) self-hosted Syne/Manrope via `next/font/local` (Google `next/font` was emitting Arial-only Fallback faces); (4) next-episode `preload="auto"` + dynamic `<link rel=preload>` for next video/poster. Stand-in masters remain Signal Night only.

**Why:** User gate — shell must feel 10/10 before concentrating on real content packs. Typography must be real faces, not system Arial.

**Consequences:** Fonts vendored under `apps/web/src/fonts/`. Emotional category ceiling still limited by stand-in video; product scope still Watch/Feed only.

**Revisit:** When licensed vertical drama replaces Signal Night; when brand typefaces finalize.

---

## 2026-09-16 — Extreme UI/UX + perceived-speed craft pass

**Decision:** Web consumer adopts Syne (display) + Manrope (body) via `next/font` with `display: swap`; preload first poster+video; remove same-origin `crossOrigin` tax; faster poster crossfade; cinematic scrims; intentional enter motion (overlay/rail/play gate) with `prefers-reduced-motion` kill-switch; mute pulse when muted; denser progress edge; refined desktop 9:16 frame. Regenerated Signal Night masters with vignette/grain (still cleared stand-ins).

**Why:** User demand for extreme craft + incredible perceived speed; system UI fonts felt prototype-grade.

**Consequences:** Design-system RN still system fonts; web overrides with CSS variables. Content still not licensed — UI can approach premium; category 10/10 still blocked by masters.

**Revisit:** When licensed vertical drama lands; when brand typefaces finalize.

---

## 2026-09-16 — Prompt L1.5: Analytics transport + watch hardening

**Decision:** Add `AnalyticsTransport` (console + HTTP batch/retry/sendBeacon) switchable via `NEXT_PUBLIC_ANALYTICS_ENDPOINT` / `EXPO_PUBLIC_ANALYTICS_ENDPOINT`. Canonical launch events (`page_view`, `play`, `share_landing`, `series_continue`, …). Share URLs carry `utm_*` + `share_id` with session-persisted acquisition. Player: single listener attach, no remount key, active+adjacent media only, visibility pause, deep-link resume for same episode, one `series_continue`. DEV diagnostics via `?diag=1`.

**Why:** L1 validated content boundary; L1.5 makes watch measurable and robust for real-user testing without product expansion.

**Consequences:** Console remains default without endpoint. Analytics failure never blocks playback. Diagnostics absent in production unless `NEXT_PUBLIC_ENABLE_DIAG=1`.

**Revisit:** When production collector is chosen; when licensed masters replace Signal Night.

---

## 2026-09-16 — Prompt L1: Real content + playback boundary

**Decision:** Launch web path uses a content contract (`ContentStatus`, `PlaybackDescriptor`, `CaptionTrack`, localized metadata), `VideoProvider` (`createStaticVideoProvider`), and a cleared vertical stand-in pack **Signal Night** served from `/content/series/signal-night/` (in-repo ffmpeg originals — not licensed drama, not Picsum/GTV). Consumer feed = `getLaunchFeedCatalog()` (published only). Deep links resolve published content only. Analytics gains envelope + durable `anonymous_user_id` (separate from `session_id`), `deep_link_opened`, throttled `watch_progress`. WebVTT via HTML5 `<track>`. Mobile catalog remains temporarily divergent (non-launch).

**Why:** L0 audit blockers were fake media, missing publish/playback contract, static captions, console-only identity.

**Consequences:** `MOCK_CATALOG` aliases published launch feed. No Home/CMS/ads. Perf marks anchored to `performance.timeOrigin` when available; first frame uses `play` event proxy.

**Revisit:** When licensed vertical masters replace Signal Night; when CDN/signed/HLS providers replace static; when production analytics vendor is wired.

---

## 2026-09-16 — Prompt C.3: Cinematic UX quality gate

**Decision:** Pure consumer-visual pass on `apps/web`: stronger title→hook hierarchy (design-system type scale), quieter action rail, edge-thin progress, poster-first media bed (Unsplash cinematic stills + sample MP4 cover), polished play gate / media-fail copy, refined desktop 9:16 shell. Fixture series retitled to The Billionaire’s Secret / The Last Vow / House of Lies (explicitly fictional). No architecture or feature changes.

**Why:** C.2 was technically complete but did not yet feel like a world-class entertainment open.

**Consequences:** Deep-link slugs changed for velvet/north series (`the-last-vow`, `house-of-lies`). Sample motion remains non-drama stock until licensed vertical packs land.

**Revisit:** When real vertical drama masters replace fixture posters/MP4s.

---

## 2026-09-16 — Prompt C.2: Web-first consumer product

**Decision:** Launch strategy is **web-first**. Ship `apps/web` (Next.js App Router) as the primary consumer surface: OPEN URL → video → swipe → continue → share deep links (`/watch/[seriesSlug]/[episodeSlug]`) with OG metadata. Preserve `apps/mobile` (Expo) for future native. Shared domain lives in `@project-flow/feed-domain` (catalog, feed logic, resume, recommendation service, catalog Intent). HTML5 `PlayerAdapter` abstracts video. Desktop uses intentional 9:16 frame; mobile web is edge-to-edge.

**Why:** Web URL distribution removes install friction for first use while keeping A–H architecture reusable.

**Consequences:** `npm run web` starts the Next consumer app (Expo web remains `npm run web:expo`). Scene/Demand inspectors are `/__dev/*` only. Recommendation never blocks first paint.

**Revisit:** When licensed posters/CDN replace sample MP4s; when PWA install is productized; when mobile native ships.

---

## 2026-09-16 — Prompt C.1: Feed visual + UX surgery (no new features)

**Decision:** Recompose the S1 feed as a cinematic full-screen media surface: COVER video, poster/scrim loading (no “Loading” pill), series title + short narrative hook hierarchy, icon action rail, consumer “Tune” affordance (Intent architecture unchanged), thin progress, DEV tools moved to long-press developer menu, DEV-only web 9:16 phone frame. Enrich mock catalog hooks/titles; keep series IDs for Scene Graph alignment.

**Why:** Architecture A–H was acceptable; the feed looked like a technical prototype and failed the premium entertainment feel required for V0 judgment.

**Consequences:** Consumer copy no longer exposes “Steer” / `E2 · title` dominance. Web desktop preview does not stretch the mobile layout. No new product features, analytics contracts, or recommendation behavior.

**Revisit:** When real licensed posters/video packs replace sample MP4s; when custom brand typefaces land beyond Prompt B system fonts.

---

## 2026-09-16 — Prompt H: Demand Graph V0 (intelligence, not a forecast)

**Decision:** Ship Demand Graph as an internal, deterministic demand-intelligence layer: ingest Intent unresolved/weak/outcome signals → normalize → canonical pattern keys → aggregate with per-user request caps → gap detection (CONTENT_GAP vs INTENT_GAP) → behavioral validation vs closest content → confidence-as-evidence → lifecycle ending in optional ProductionSignal. Feature flag `DEMAND_GRAPH_V0` default **OFF**. Memory store + DEV inspector. No graph DB, no ML forecasting, no producer portal, no auto-commissioning.

**Why:** Query volume ≠ demand. Unmet intent is only useful when unique users + related-content behavior validate a content gap. Producers need traceable evidence, not “guaranteed viewers.”

**Consequences:** Intent can fire-and-forget into Demand Graph when the flag is on; Recommendation and OPEN→VIDEO never depend on it. SATISFIED requires post-launch evidence, not catalog insertion alone. Semantic/LLM clustering deferred.

**Revisit:** When warehouse/event-stream backends replace memory store; when acquisition workflows consume ProductionSignal.

---

## 2026-09-15 — Prompt G: Intent Layer (steer, don’t chat)

**Decision:** Ship Intent as an optional S3 sheet over the feed (chips first; NL behind `INTENT_NL_V0` default OFF). Layered deterministic parser (chip → exact phrase → vocabulary/compound → isolated semantic stub). Intent maps to SceneQuery + temporary Recommendation bias with **NEXT_ITEM** lifetime. Does **not** permanently mutate taste profile. Continuity hierarchy: in-series auto-continue > explicit intent > learned taste > editorial/popularity > exploration. Unresolved intents keep the feed and emit demand signals for a future Demand Graph (not built here).

**Why:** Users sometimes want to steer (“darker”, “more revenge”) without leaving the feed or talking to a chatbot. Asking is optional; watching is default.

**Consequences:** `Steer` rail affordance when `INTENT_LAYER` is on. Chip selection closes the sheet, keeps current playback, and reorders the next-item queue. Chatbot UX, persistent conversation history, and Demand Graph are explicitly rejected/deferred.

**Revisit:** When NL quality is measured; when Demand Graph consumes `intent_unresolved` / `intent_weak_match`.

---

## 2026-09-15 — Prompt F: Scene Graph V0 (content intelligence, not a graph DB)

**Decision:** Ship Scene Graph V0 as a typed document model (`Series → Episodes → Scenes` + Characters/Relationships) with controlled taxonomies, confidence/provenance, deterministic validation, in-memory store, compositional `SceneQuery`, scene→episode→series aggregation, and a DEV-only inspector. Hand-authored fixtures first. Optional ranking hooks exist behind `SCENE_GRAPH_SIGNALS_V0` (default **OFF**). No graph database, embeddings, vector DB, or LLM runtime ranking.

**Why:** Series/episode units are too coarse for future “find scenes with betrayal + high cliffhanger” queries. Validate the content model before paying for automated video understanding.

**Consequences:** Recommendation V0 is unchanged and does not depend on Scene Graph. Feed startup does not load or query the graph. Consumer UX stays invisible to Scene Graph. Storage is replaceable via `SceneGraphStore`.

**Revisit:** When automated extraction exists; when Demand Graph / Intent Layer need scene features; when ranking should blend scene signals under a measured A/B.

---

## 2026-09-15 — Prompt E: Recommendation V0 (deterministic, not ML)

**Decision:** Ship Recommendation V0 as a replaceable client-side pipeline: `Feed → RecommendationService → CandidateGenerator → Ranker → Diversifier → Exploration → ContentItems`. Local anonymous taste profile (AsyncStorage), explicit signal weights, editorial/popular/affinity/recent/continuation sources, diversity + seeded exploration, cold-start editorial/popular, editorial fallback on failure. Flags: `RECOMMENDATION_V0`, `RECOMMENDATION_DIVERSITY_V0`, `RECOMMENDATION_EXPLORATION_V0`. In-series continuation from Prompt D always outranks recommendation.

**Why:** Personalize the feed enough to improve watch time / completion / continuation without ML, embeddings, Scene Graph, Demand Graph, or Intent Layer. Keep ranking invisible to users and swappable without rewriting FeedScreen.

**Consequences:** Feed boots on editorial order immediately; recommendation refreshes asynchronously. No consumer UI for “why recommended.” No backend profile. V0 deliberately does **not** attempt learned ranking, embeddings, vector search, LLM ranking, geo beyond language/market fields already on content, or social graph.

**Revisit:** When learned ranking / Scene Graph features / Demand Graph land in later phases; `experimentBucket` is enough for early A/B assignment until then.

---

## 2026-09-15 — Prompt D: in-series continuity + anonymous resume

**Decision:** Episode boundary state machine (`playing→ending→preparing_next→transitioning→next_playing` / `series_ended`). Auto-continue only within the same series — never unrelated series. Anonymous resume via AsyncStorage with throttled writes. S2 Continue strip only for resume / failed prepare. Binge session is analytics-only.

**Why:** Retention is continuity of story, not catalog dumps or fake recommendations.

**Consequences:** End-of-series shows minimal completion surface; "Keep watching" may advance to the next feed item explicitly (not autoplay-as-recommendation).

**Revisit:** Prompt E (recommendation V0) for post-series destinations.

---

## 2026-09-15 — Prompt C: FEED_V0 vertical feed behind flag

**Decision:** Ship full-screen vertical feed with `expo-video` isolated behind `PlayerSurface`, deterministic mock catalog, adjacent-only prefetch (prev/current/next), explicit playback state machine, and TTFP instrumentation. `FEED_V0` defaults on in development, off in production unless `EXPO_PUBLIC_FEED_V0=1`.

**Why:** Validate OPEN → VIDEO → SWIPE → CONTINUE without auth/coins/ML/Scene Graph.

**Consequences:** Placeholder path remains when flag is off. Continuation is in-feed episode advance only (Prompt D polish later).

**Revisit:** After device TTFP measurements and Prompt D continuity UX.

---

## 2026-09-15 — Prompt B: cinematic design system, dark-first

**Decision:** Ship typed semantic tokens (color/type/space/radii/motion/elevation/layout) with dark as the primary consumer theme and a warm restrained accent (`#E8DCC8`). Implement only layout/text/press/overlay primitives in `packages/ui`. Dev-only showcase lives under `apps/mobile/src/dev/`. No UI kits, icon packs, or animation frameworks.

**Why:** Prompt B needs a reusable visual language without premature product surfaces. Restraint beats decorative “premium.”

**Consequences:** Product UI must consume tokens/primitives; feed/player/cards remain forbidden until Prompt C+.

**Revisit:** After Prompt C feed implementation stress-tests overlays and type on real video.

---

## 2026-09-15 — Prompt A: npm workspaces monorepo, defer empty services

**Decision:** Use a root npm workspaces monorepo with `apps/mobile` + `packages/*`. Do not scaffold empty `services/*` or `apps/web|admin` until a prompt needs them. Use `packages/shared` (config + flags) instead of a separate `types`-only package for now.

**Why:** Prompt A forbids premature microservices and speculative folders. Workspaces keep typed boundaries without deploy complexity.

**Consequences:** Metro watches the repo root; packages are imported as `@project-flow/*`. Future services can be added under `services/` without restructuring the app.

**Revisit:** When the first real API/recommendation service is implemented (Phase 2+).

---

## 2026-09-15 — Codename PROJECT FLOW

**Decision:** Internal name is PROJECT FLOW. Do not publicly position as “Netflix of short drama.”

**Why:** Positioning debt is expensive; sensations (fast / beautiful / addictive) matter more than category metaphors.

**Consequences:** All docs, repos, and analytics namespaces use `flow` / `project-flow`.

**Revisit:** When brand/legal naming is finalized.

---

## 2026-09-15 — Feed is the product for V0

**Decision:** MVP V0 ships only: open → autoplay → vertical swipe → continue series. Minimal chrome.

**Why:** Category competition is retention quality of the first minute, not feature count.

**Consequences:** Secondary surfaces (search, profile, library) are stubs or deferred until feed quality bar passes.

**Revisit:** After Phase 1 stop-gate metrics (time_to_first_play, first_session_watch_time).

---

## 2026-09-15 — No coins / no mandatory auth on first play

**Decision:** Forbidden in V0 consumer path: coin systems, episode microtransactions, login walls, tutorial overlays, paywall modals.

**Why:** Market reviews show this as primary trust destroyer; our thesis is premium free experience.

**Consequences:** Monetization enters only via AdPolicy abstraction in Phase 5.

**Revisit:** Premium optional experiment after retention baseline exists.

---

## 2026-09-15 — Scene Graph starts relational

**Decision:** V0 Scene Graph is PostgreSQL + indexes, not a graph database.

**Why:** Avoid premature infra; API shaped so a graph store can swap later without client changes.

**Consequences:** Query patterns designed as ports/adapters; no Neo4j/etc. in V0.

**Revisit:** When multi-hop trope queries dominate latency or editorial tooling needs.

---

## 2026-09-15 — LLM only for semantic intent, not every feed request

**Decision:** Default feed ranking is deterministic. LLM used only when natural-language intent needs parsing; normalized intents are cached.

**Why:** Cost, latency, and predictability; intent must not obstruct the feed.

**Consequences:** Demand gaps logged when unresolved; ranking remains explainable internally.

**Revisit:** When intent volume and cache hit rate justify model routing upgrades.

---

## 2026-09-15 — Monorepo with domain boundaries

**Decision:** Single repo with `apps/`, `services/`, `packages/`, `docs/`.

**Why:** Shared types/analytics/design-system without forcing a microservice zoo on day one.

**Consequences:** Services may start as packages/modules; extract deployables when ownership/scaling requires.

**Revisit:** When team size or deploy cadence forces service isolation.
