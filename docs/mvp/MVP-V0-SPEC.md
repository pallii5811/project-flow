# MVP V0 — Complete specification for Cursor

**Product:** PROJECT FLOW  
**Objective:** Make short drama feel inevitable.  
**V0 bet:** The first minute is so good the user does not want to leave.

This document is the only build contract for Phase 1 (+ minimal continuity hooks).  
Do not implement Phases 2–7 until the Phase 1 stop-gate passes.

---

## 0. Success definition

A new user on a mid-range phone:

1. Opens the app.
2. Sees a full-screen vertical drama clip start with **no instructions**.
3. Swipes to the next clip without thinking.
4. Can continue the same series without hunting.
5. Feels: fast, premium, not manipulated.

### Hard targets (V0)

| Target | Budget |
|--------|--------|
| Cold start → interactive shell | aggressively toward < 2s |
| First meaningful playback (content available) | < 1.5s |
| UI feedback (tap/swipe) | < 100ms perceived |
| Continuity transition | < 1s perceived |
| Bundle / deps | no new library without written justification |

### Explicitly OUT of V0

- Login wall before first play
- Coins / fake currency / episode unlocks
- Paywall / subscription modals
- Tutorial overlays
- Dense metadata panels
- Full search app
- Full profile / settings suite
- Admin CMS UI
- ML personalization
- Graph database
- Chatbot as primary UX
- Multi-tab “dashboard” home

---

## 1. User flows (only these)

### F1 — First open (critical path)

```
App launch
  → create anonymous_user_id + session_id
  → request feed candidates (editorial + popularity V0)
  → mount Feed screen
  → autoplay first eligible item
  → emit app_open, feed_impression, play_start
  → record time_to_first_play
```

**No blocking screens. No auth. No “welcome”.**

### F2 — Vertical discovery

```
Watching item N
  → swipe up → item N+1 (preload already warm)
  → if watch_ms < skip_threshold → emit skip
  → else emit watch_progress / completion as applicable
```

### F3 — In-clip controls (sparse)

```
Tap center → pause / resume
Tap mute → mute / unmute
Optional captions toggle
Right rail: like | dislike | follow | share | save
Bottom: series title + episode indicator + thin progress
```

### F4 — Series continuation (minimal, required for addiction)

```
Episode completes OR user taps “Continue”
  → auto-advance to next episode when available
  → minimal transition (no interstitial)
  → one-tap chips ONLY after completion (optional, non-blocking):
       Continue | Similar | Surprise me
  → NEVER dump into a generic catalog grid
```

### F5 — Resume (same device, anonymous)

```
User returns
  → if continue_state exists for series → offer / auto-resume exact position
  → restore mute + captions prefs
```

### F6 — Share (stub interface in V0, full loop Phase 4)

```
Tap share → native share sheet with deep link payload
Recipient path may be stubbed in V0 but link schema MUST be defined now.
```

---

## 2. Screens (V0)

Only **three** consumer surfaces. Everything else is deferred.

### S1 — Feed (primary, 95% of V0)

| Element | Spec |
|---------|------|
| Video | Edge-to-edge, vertical, fills safe area under status bar |
| Autoplay | First eligible item; resume after app background if same item |
| Swipe | Vertical pager; one item per viewport |
| Progress | 2–3px bar at bottom or top edge; never a fat scrubber by default |
| Series label | Single line: `{series_title} · E{n}` |
| Right rail | Icon-only: like, dislike, follow, share, save |
| Captions | Burned-in or overlay text track; toggle control sparse |
| Mute | Persistent preference; default muted only if platform requires |
| Empty | Full-screen calm state: “Finding something great…” + retry |
| Error | Per-item fallback: skip to next + emit failure; no modal |
| Offline | Cached last item if any; else offline empty state |

**Forbidden on S1:** grids, tabs, coin balance, “For You / Following” chrome bloat, story rings, avatars row.

### S2 — Series continue strip (overlay, not a destination)

Triggered on completion or explicit continue:

- Title of next episode (one line)
- Primary: Continue (auto-focus)
- Secondary chips (max 3): Similar · More like this tone · Surprise me
- Auto-dismiss into next episode if user does nothing for ~800ms when next episode is ready (feature-flagged)

### S3 — Intent sheet (hidden entry, non-blocking)

Entry: long-press on “more like this” OR small intent affordance that does **not** compete with play.

- Chip row: Romance · Revenge · Darker · Funnier · Female lead · Surprise me
- Optional single-line text field
- Submit replaces upcoming feed candidates; **does not** stop current playback until natural swipe

V0 may implement chips only; free-text parser can return `demand_gap` if unresolved.

---

## 3. UI components (packages)

### `packages/design-system` (tokens only in V0)

- Color (dark-first + light)
- Type scale (display / title / body / meta / caption)
- Spacing (4-pt base)
- Radius (near-zero for media chrome; modest for chips)
- Motion (enter/exit durations + easing; no decorative loops)
- Elevation (almost none on feed)
- Contrast rules (WCAG AA for text over scrims)

### `packages/ui` (consumer primitives)

| Component | Role |
|-----------|------|
| `FeedPager` | Vertical virtualized pager |
| `PlayerSurface` | Renders current video via VideoProvider |
| `PlayerScrim` | Bottom gradient for legibility only |
| `RailActions` | Right-side action column |
| `SeriesMeta` | Title + episode |
| `ProgressHairline` | Watch progress |
| `ContinueStrip` | Post-episode continuity |
| `IntentChips` | Intent entry |
| `StateView` | loading / empty / error / offline |

### Domain separation (apps/mobile)

```
player/           playback + VideoProvider adapter
feed/             orchestration, preload policy
recommendation/   client port to ranking API
analytics/        event emitters (uses packages/analytics)
controls/         rail + mute + captions
content/          types for series/episode/scene refs
continuity/       resume state
```

**Rule:** UI never contains monetization or ranking business rules.

---

## 4. Architecture (V0 deploy shape)

Pragmatic monorepo: services may start as modules behind HTTP later.

```
apps/mobile          Expo (TypeScript strict) — consumer
apps/web             optional share landing stub (can wait)
apps/admin           OUT of V0 UI
services/api         Nest/Fastify/Hono — authoritative API
services/recommendation   V0 ranker module
services/analytics        ingest + validate events
packages/*           shared types, design-system, analytics client, ui
```

### Technical principles (enforce)

- TypeScript everywhere; **no `any`**
- Server-authoritative business logic
- Feature flags for experimental ranking / auto-continue
- Event-driven analytics
- Video provider abstraction (CDN swappable)
- Predictive preload: **current + next only** (not N arbitrary)
- Avoid unnecessary dependencies

### Performance rules

- No blocking network on critical render path unless unavoidable
- Preload must respect bandwidth hints / user network quality when available
- Analytics never blocks play_start

---

## 5. PostgreSQL schema (V0)

```sql
-- =====================================================
-- PROJECT FLOW — MVP V0
-- Tokens OAuth / device secrets: NEVER in DB.
-- Scene Graph V0 = relational; graph DB later without client change.
-- =====================================================

create extension if not exists "pgcrypto";

-- ---------- identity (anonymous-first) ----------
create table public.users (
  id uuid primary key default gen_random_uuid(),
  anonymous_key text not null unique,
  country text,
  language text,
  is_premium boolean not null default false,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);

-- ---------- catalog ----------
create table public.series (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  title text not null,
  description text,
  language_source text not null,
  status text not null check (status in ('draft','published','archived')),
  editorial_priority int not null default 0,
  published_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.episodes (
  id uuid primary key default gen_random_uuid(),
  series_id uuid not null references public.series(id) on delete cascade,
  episode_number int not null,
  title text,
  duration_ms int not null check (duration_ms > 0),
  status text not null check (status in ('draft','published','archived')),
  published_at timestamptz,
  created_at timestamptz not null default now(),
  unique (series_id, episode_number)
);

create table public.scenes (
  id uuid primary key default gen_random_uuid(),
  episode_id uuid not null references public.episodes(id) on delete cascade,
  scene_number int not null,
  start_ms int not null check (start_ms >= 0),
  end_ms int not null check (end_ms > start_ms),
  -- structured attrs (V0 columns; expand via JSONB sidecar if needed)
  genres text[] not null default '{}',
  tropes text[] not null default '{}',
  emotional_intensity real check (emotional_intensity between 0 and 1),
  emotional_direction text,
  conflict text,
  narrative_beat text,
  cliffhanger_score real check (cliffhanger_score between 0 and 1),
  scene_importance real check (scene_importance between 0 and 1),
  dialogue_density real,
  action_density real,
  romance_intensity real,
  suspense_intensity real,
  comedy_intensity real,
  metadata_confidence real check (metadata_confidence between 0 and 1),
  localization_status text not null default 'source'
    check (localization_status in ('source','transcribed','translated','dubbed','qa','approved','published')),
  created_at timestamptz not null default now(),
  unique (episode_id, scene_number)
);

create table public.characters (
  id uuid primary key default gen_random_uuid(),
  series_id uuid not null references public.series(id) on delete cascade,
  name text not null,
  role text, -- e.g. female_lead, male_lead, antagonist
  unique (series_id, name)
);

create table public.scene_characters (
  scene_id uuid not null references public.scenes(id) on delete cascade,
  character_id uuid not null references public.characters(id) on delete cascade,
  primary key (scene_id, character_id)
);

create table public.media_assets (
  id uuid primary key default gen_random_uuid(),
  episode_id uuid not null references public.episodes(id) on delete cascade,
  kind text not null check (kind in ('video','poster','caption','audio')),
  provider text not null, -- abstraction key, e.g. 'cloudflare', 'mux'
  external_id text not null,
  playback_url text,
  language text,
  duration_ms int,
  status text not null check (status in ('processing','ready','failed','expired')),
  created_at timestamptz not null default now()
);

-- ---------- share / hooks metadata (schema now, product later) ----------
create table public.share_moments (
  id uuid primary key default gen_random_uuid(),
  episode_id uuid not null references public.episodes(id) on delete cascade,
  scene_id uuid references public.scenes(id) on delete set null,
  moment_type text not null check (moment_type in ('hook','emotion','cliffhanger','quotable','surprise')),
  start_ms int not null,
  end_ms int not null,
  score real,
  unique (episode_id, moment_type, start_ms)
);

-- ---------- continuity ----------
create table public.watch_positions (
  user_id uuid not null references public.users(id) on delete cascade,
  episode_id uuid not null references public.episodes(id) on delete cascade,
  position_ms int not null check (position_ms >= 0),
  completed boolean not null default false,
  updated_at timestamptz not null default now(),
  primary key (user_id, episode_id)
);

create table public.user_preferences (
  user_id uuid primary key references public.users(id) on delete cascade,
  muted boolean not null default false,
  captions_enabled boolean not null default true,
  updated_at timestamptz not null default now()
);

-- ---------- recommendation / feedback ----------
create table public.user_interactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  series_id uuid references public.series(id) on delete set null,
  episode_id uuid references public.episodes(id) on delete set null,
  scene_id uuid references public.scenes(id) on delete set null,
  interaction_type text not null check (interaction_type in (
    'impression','play','skip','replay','complete','like','dislike','follow','save','share'
  )),
  watch_ms int,
  recommendation_source text,
  created_at timestamptz not null default now()
);

-- ---------- intent + demand ----------
create table public.intents (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  raw_query text,
  normalized jsonb not null, -- Intent object
  resolved boolean not null default false,
  created_at timestamptz not null default now()
);

create table public.demand_gaps (
  id uuid primary key default gen_random_uuid(),
  raw_query text not null,
  normalized_query text,
  country text,
  language text,
  state text not null default 'discovered'
    check (state in ('discovered','normalized','repeated','behaviorally_validated','production_signal')),
  unique_users int not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------- experiments ----------
create table public.feature_flags (
  key text primary key,
  description text,
  enabled boolean not null default false,
  rules jsonb not null default '{}'::jsonb
);

create table public.experiment_assignments (
  user_id uuid not null references public.users(id) on delete cascade,
  experiment_key text not null,
  variant text not null,
  assigned_at timestamptz not null default now(),
  primary key (user_id, experiment_key)
);

-- ---------- analytics (optional raw store; may be warehouse later) ----------
create table public.analytics_events (
  id bigserial primary key,
  event_name text not null,
  user_id uuid,
  session_id text not null,
  payload jsonb not null,
  created_at timestamptz not null default now()
);

-- indexes
create index idx_episodes_series on public.episodes(series_id);
create index idx_scenes_episode on public.scenes(episode_id);
create index idx_media_episode on public.media_assets(episode_id);
create index idx_interactions_user_created on public.user_interactions(user_id, created_at desc);
create index idx_series_published on public.series(status, editorial_priority desc, published_at desc);
create index idx_scenes_tropes on public.scenes using gin (tropes);
create index idx_scenes_genres on public.scenes using gin (genres);
create index idx_demand_state on public.demand_gaps(state, updated_at desc);
```

### Typed Intent model (packages/types)

```ts
export type Intent = {
  genres: string[];
  tropes: string[];
  emotionalTone?: string;
  pacing?: 'slow' | 'medium' | 'fast';
  characterPreference?: string[];
  relationshipPreference?: string[];
  setting?: string[];
  intensity?: number; // 0..1
  exclusions?: string[];
  language?: string;
  currentSeriesId?: string;
};
```

### Recommendation source (internal only)

```ts
export type RecommendationSource =
  | 'editorial'
  | 'popularity'
  | 'affinity'
  | 'intent'
  | 'exploration';
```

---

## 6. Analytics events (V0 must emit)

Envelope: see `docs/metrics.md`.

| Event | Required properties |
|-------|---------------------|
| `app_open` | `cold` boolean |
| `feed_impression` | `episode_id`, `recommendation_source` |
| `play_start` | `episode_id`, `ttfp_ms` |
| `watch_progress` | `episode_id`, `position_ms`, `pct` |
| `skip` | `episode_id`, `watch_ms` |
| `replay` | `episode_id` |
| `completion` | `episode_id`, `watch_ms` |
| `binge_session` | `series_id`, `episode_count` |
| `like` / `dislike` / `follow` / `save` | ids |
| `share_tap` | `episode_id`, `scene_id?` |
| `continue_resume` | `episode_id`, `position_ms` |
| `intent_submit` | `raw` / chips |
| `intent_resolved` | `intent_id`, `candidate_count` |
| `demand_gap` | `raw_query`, `normalized_query?` |
| `player_error` | `code`, `episode_id` |

---

## 7. API surface (V0 minimal)

| Method | Path | Purpose |
|--------|------|---------|
| `POST` | `/v0/session` | Upsert anonymous user; return prefs + flags |
| `GET` | `/v0/feed` | Ranked candidates (`recommendation_source` per item) |
| `POST` | `/v0/events` | Batch analytics |
| `PUT` | `/v0/watch-position` | Continuity |
| `POST` | `/v0/intent` | Normalize + candidates or demand_gap |
| `GET` | `/v0/episode/:id/playback` | Signed/playback descriptors via VideoProvider |

All responses typed in `packages/types`. Clients never receive Scene Graph internals beyond what UI needs (title, episode number, captions URL, playback URL).

---

## 8. Recommendation V0 (interface only in Phase 1; implement Phase 2)

Even in Phase 1, feed responses MUST include `recommendation_source`.

Ranking inputs (when implemented):

- editorial priority
- popularity
- freshness
- language / geography
- recent skips
- series affinity
- completion history

Output: ranked candidates + **internal** explanation metadata (never shown as fake “because you liked…” spam in V0 UI).

---

## 9. Video provider abstraction

```ts
export interface VideoProvider {
  getPlayback(asset: MediaAssetRef): Promise<PlaybackDescriptor>;
  prefetch(descriptor: PlaybackDescriptor): Promise<void>;
}

export type PlaybackDescriptor = {
  url: string;
  mimeType?: string;
  captionsUrl?: string;
  headers?: Record<string, string>;
  expiresAt?: string;
};
```

Preload policy: **current fully warm + next intelligently**. Never preload an arbitrary queue length.

Failure modes to handle in player: slow network, unavailable video, malformed metadata, expired asset, unsupported format.

---

## 10. Feature flags (seed)

| Key | Default | Purpose |
|-----|---------|---------|
| `feed_auto_continue` | true | Auto-advance on completion |
| `continue_strip_chips` | true | Show post-episode chips |
| `intent_chips` | false until Phase 3 | Show intent entry |
| `ranker_strategy` | `editorial_popularity` | Experiment hook |
| `ads_enabled` | false | Phase 5 |

---

## 11. Test plan (Phase 1 gate)

### Automated

- Feed mounts and requests candidates once
- Autoplay starts for first eligible item
- Swipe advances index and triggers preload of next
- Skip threshold emits `skip`
- Completion emits `completion` and optionally auto-continues
- Player error on item N advances to N+1 without modal
- Analytics envelope fields present
- Typecheck + lint clean; **no `any`**

### Manual / device

- Cold open on mid-range Android + recent iPhone
- Slow 3G / throttled network: buffering UI calm, no crash
- Mute/captions prefs persist across relaunch
- First second comprehension test with a cold user

### Stop-gate metrics (instrument even if n is small)

- `time_to_first_play` distribution
- First-session watch time
- Swipe / skip ratio
- Crash-free sessions

**Do not start Phase 2 until stop-gate is explicitly accepted.**

---

## 12. Exact Cursor prompt order

Paste **one prompt at a time**. After each: inspect diff → run typecheck/tests → only then continue.

### PROMPT A — Repository OS (this phase’s first build)

```
You are the principal engineer for PROJECT FLOW.
Read docs/vision.md, docs/product-principles.md, docs/ux-principles.md,
docs/metrics.md, docs/roadmap.md, docs/decisions.md, and docs/mvp/MVP-V0-SPEC.md.

Implement ONLY Phase 1 foundation scaffolding:
- Keep monorepo folders apps/mobile, apps/web, apps/admin, services/*, packages/*
- Initialize apps/mobile as Expo TypeScript strict app with flat expo-router structure
  (no (tabs) template chrome). Default route = Feed placeholder.
- Create packages/types with Intent, RecommendationSource, catalog IDs, AnalyticsEnvelope.
- Create packages/analytics with typed track() stub (queue, no throw).
- Add services/api stub README + SQL file from the MVP spec schema (versioned only).
- Add .gitignore, workspace tooling as needed.
- No new dependencies unless required to boot Expo.
- No feed UI polish yet. No admin. No ads. No auth wall.

Report files touched. Run typecheck. Do not claim done without commands run.
```

### PROMPT B — Design system (feed-first)

```
Read docs/ux-principles.md and docs/mvp/MVP-V0-SPEC.md §3.
Create packages/design-system tokens and packages/ui primitives listed in the spec.
Design for premium vertical video — not TikTok clone, not streaming dashboard.
Implement Feed-oriented components only. Skip profile/search screens.
Render a representative Feed mock screen with fake stills/placeholders.
Then self-critique spacing/hierarchy and fix inconsistencies before finishing.
```

### PROMPT C — Production feed

```
Read docs/mvp/MVP-V0-SPEC.md flows F1–F3 and §9–§11.
Build the vertical video feed end-to-end with provider abstraction, preload
(current+next), sparse controls, analytics events, and failure fallbacks.
No login, coins, paywall, tutorial, or dense metadata.
Add automated tests for core feed behavior. Run them.
```

### STOP

Human review + device test. Accept/reject Phase 1.

### Later prompts (do not paste yet)

| ID | Phase | Topic |
|----|-------|-------|
| D | 2 | Continue Story (Prompt 7) |
| E | 2 | Recommendation V0 (Prompt 6) |
| F | 2 | Scene Graph ingestion (Prompt 5) |
| G | 3 | Intent Layer (Prompt 4) |
| H | 3 | Demand Graph (Prompt 12) |
| I | 4 | Share / deep links (Prompt 8) |
| J | 5 | AdPolicy (Prompt 9) |
| K | 6 | Localization pipeline (Prompt 10) |
| L | 6 | Admin CMS (Prompt 11) |
| M | 7 | Performance audit (Prompt 13) |
| N | 7 | UX surgery (Prompt 14) |

Full narrative text for D–N lives in the product OS brief; adapt to repo state at execution time. Always re-read this spec + `docs/decisions.md` before expanding scope.

---

## 13. Master system prompt (pin in Cursor rules)

Use as `AGENTS.md` / project rule. Condensed:

> You are principal engineer, staff product engineer, product architect, UX systems thinker, growth engineer, and QA lead for PROJECT FLOW. Mission: fastest, simplest, most beautiful, addictive short-drama experience. Core loop: open → video → swipe → continue → return tomorrow. Follow docs/*.md and MVP-V0-SPEC.md. Smallest viable diffs. Justify dependencies. Instrument behavior. No coins, no first-play auth wall, no dark patterns. Prefer simple evolvable architecture. Never claim done without lint/typecheck/tests run. When uncertain, simplest implementation that preserves extensibility.

---

## 14. What “done” means for this document’s next action

Next human/agent action is **PROMPT A only**: scaffold the mobile app + shared packages + schema file.  
Not the design system. Not the feed polish. Not 12 other prompts.
