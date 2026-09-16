# Metrics & analytics

## North star

**Minutes of great entertainment per user**

Not MAU. Not downloads. Not registrations. Those can be bought. Return tomorrow cannot.

## Core metrics (dashboard, giant)

| Metric | Why |
|--------|-----|
| `time_to_first_play` | Activation friction |
| `first_session_watch_time` | First-minute quality |
| `episode_completion_rate` | Content + pacing fit |
| `next_episode_rate` | Continuity / addiction |
| `session_length` | Depth |
| `sessions_per_user` | Habit |
| `d1_retention` | Immediate hook |
| `d3_retention` | Early habit |
| `d7_retention` | Weekly habit |
| `d30_retention` | Product-market fit signal |
| `share_rate` | Organic growth |
| `organic_share_rate` | Share quality |
| `content_discovery_rate` | Feed / intent health |
| `recommendation_success_rate` | Ranking quality |

## Event envelope (required on every major event)

```ts
type AnalyticsEnvelope = {
  event_name: string;
  timestamp: string; // ISO-8601
  session_id: string;
  anonymous_user_id: string;
  acquisition_source?: string;
  country?: string;
  language?: string;
  content_id?: string;
  series_id?: string;
  episode_id?: string;
  scene_id?: string;
  recommendation_source?: RecommendationSource;
  // event-specific payload
  properties?: Record<string, string | number | boolean | null>;
};
```

## Critical playback events

| Event | When |
|-------|------|
| `app_open` | Process / cold / warm open |
| `feed_impression` | First eligible item visible |
| `play_start` | First frame rendered + audio path ready |
| `watch_progress` | Heartbeats / thresholds (10/25/50/75/95%) |
| `skip` | Swipe away before meaningful watch |
| `replay` | Restart same item |
| `completion` | Item finished |
| `binge_session` | ≥N consecutive episode watches |
| `like` / `dislike` | Explicit feedback |
| `follow` | Follow series/creator |
| `save` | Save for later |
| `share_tap` / `share_complete` | Share funnel |
| `intent_submit` | User expresses intent |
| `intent_resolved` | Intent → candidates returned |
| `demand_gap` | Intent unresolved / no candidates |
| `continue_resume` | Resume exact position |
| `ad_opportunity` / `ad_impression` / `ad_complete` / `ad_skip` | Monetization (later) |

## Instrumentation rules

- Structured events only — no freeform debug strings as analytics.
- Server may enrich; client must never invent business truth.
- Analytics must not block the critical playback path.
- Failed event send: queue + retry; never throw into UI.

---

## Recommendation V0 (Prompt E)

V0 is **not** machine learning. It is a deterministic affinity + candidate + rank pipeline behind `RecommendationService`. Success = meaningful watch outcomes, not impressions or clicks.

### Recommendation events

| Event | When |
|-------|------|
| `recommendation_requested` | Feed asks for ordered candidates |
| `recommendation_generated` | Pipeline returned (or editorial fallback) |
| `recommendation_source_selected` | Per ranked item: source, rank, score, controlled reason enum |
| `recommendation_exploration_served` | Exploration slot injected |
| `recommendation_impression` | Recommended item became visible |
| `recommendation_play_started` | Playback started on recommended item |
| `recommendation_completed` | User completed recommended item |
| `recommendation_skipped` | User skipped recommended item |

Common properties: `recommendation_request_id`, `content_id`, `series_id`, `recommendation_source`, `rank_position`, `score`, `session_id`. Do **not** send freeform internal reasoning strings.

### Derived metrics

| Metric | Definition |
|--------|------------|
| `recommendation_completion_rate` | `recommendation_completed` / (`recommendation_play_started`) |
| `recommendation_skip_rate` | `recommendation_skipped` / (`recommendation_impression`) where skip completion &lt; 40% |
| `recommendation_watch_time` | Sum watch duration on items with a recommendation_request_id |
| `recommendation_next_item_rate` | Plays that continue to another recommended item in-session / play_started |
| `recommendation_repeat_rate` | Distinct content with ≥2 recommendation_play_started / content with ≥1 |
| `exploration_success_rate` | exploration items with completion or continue / exploration_served |

A recommendation is a **success** only on meaningful outcomes (completion, continue, like/follow), never on impression or autoplay alone.

### Signal philosophy (V0)

| Signal | Strength |
|--------|----------|
| like | very strong positive |
| follow | strong positive |
| complete / continue | strong positive |
| replay | moderate positive |
| immediate skip (≤15%) | strong negative |
| early abandon (≤40%) | moderate negative |
| view_start | weak / noisy |
| watch_duration mid-progress | weak positive |

Weights live in `apps/mobile/src/features/recommendation/model/weights.ts` and are intentionally tunable constants — not learned.

---

## Scene Graph V0 (Prompt F)

Scene Graph is a **content intelligence foundation**, not a recommendation engine and not a graph database.

### Why scene-level metadata

Series/episode labels are too coarse. Scenes carry tropes, beats, cliffhangers, and character roles that future ranking, recap, and demand systems will need.

### Controlled vocabulary

Genres, tropes, emotional tones, narrative beats, character roles, relationship types, and provenance sources are closed enums (see `scene-graph/model/taxonomy.ts`). Extensible by adding constants — not free-text sprawl.

### Confidence + provenance

Each scene has `metadataConfidence` (0–1) and `source`: `verified` | `inferred` | `generated` | `humanReviewed`. Low confidence emits validation warnings; never treat inferred/generated as ground truth.

### Storage strategy

In-memory / document `SceneGraphStore` with stable IDs and episode/series indexes. Graph DB deferred until query scale demands it.

### Query model

Typed `SceneQuery` with AND composition across optional filters (genres, tropes, characters, roles, tone, beat, intensity thresholds). Returns `SceneResult` with matched fields + confidence summary.

### Aggregation rules

- **Episode:** genre/trope = ordered union; emotional intensity / hook = max; cliffhanger = last scene’s cliffhanger (else max); dominant tone = mode.
- **Series:** dominant genres/tropes = top by scene frequency; overallTone = mode; characterSet from series node; maxCliffhanger = max.

### Analytics

| Event | When |
|-------|------|
| `scene_metadata_loaded` | Graph document loaded into store |
| `scene_query_executed` | Query finished (type, result_count, latency_ms, schema_version) |
| `scene_signal_used` | Optional ranking signals applied (flag on) |

Do not log full metadata blobs or user PII. Scene Graph describes **content**, not users.

### Recommendation integration

`SCENE_GRAPH_SIGNALS_V0` default **OFF**. `blendSceneGraphSignals` / `computeSceneGraphSignals` are optional hooks. Recommendation V0 must function identically when Scene Graph is unavailable or disabled. Scene Graph must never block first playback.

---

## Intent Layer V0 (Prompt G)

Intent is **secondary**. Default remains OPEN → VIDEO → SWIPE. Intent never blocks first playback, browsing, or in-series continuation.

### Chip taxonomy

`MORE_LIKE_THIS` · `MORE_ROMANCE` · `DARKER` · `MORE_REVENGE` · `STRONG_FEMALE_LEAD` · `SURPRISE_ME`

### Parser layers

1. Chip / exact phrase  
2. Controlled vocabulary  
3. Deterministic compound normalization  
4. Isolated semantic/LLM fallback (noop stub in V0 — no invented confidence)

### Lifetime

Default **NEXT_ITEM**. Does not permanently rewrite `UserTasteProfile`.

### Continuity priority

1. Active in-series continuation  
2. Explicit user intent (after continuation / deliberate next)  
3. Learned taste  
4. Editorial / popularity  
5. Exploration  

### Unresolved intent

Keep current feed; optional non-blocking hint; emit `intent_unresolved` / `intent_weak_match` for future Demand Graph. Never invent content.

### Intent analytics

| Event | When |
|-------|------|
| `intent_sheet_opened` | S3 opened |
| `intent_chip_selected` / `intent_text_submitted` | User input (no raw private text stored) |
| `intent_parsed` | Parser output |
| `intent_resolved` / `intent_weak_match` / `intent_unresolved` | Resolution |
| `intent_candidate_generated` | Candidates ready |
| `intent_result_played` / `completed` / `skipped` | Outcome on steered item |

### Derived success metrics

| Metric | Definition |
|--------|------------|
| `intent_resolution_rate` | resolved / intents submitted |
| `intent_result_play_rate` | result_played / resolved |
| `intent_result_completion_rate` | result_completed / result_played |
| `intent_result_skip_rate` | result_skipped / result_played |
| `intent_to_next_content_rate` | swipe-to-intent-item / resolved |
| `unresolved_intent_rate` | unresolved / submitted |

Success = meaningful watch behavior, not “parser returned an object.”

---

## Demand Graph V0 (Prompt H)

Internal market intelligence. **Query volume ≠ demand.**

### Core objects

- `DemandSignal` — append-only event from Intent (unresolved / weak / outcomes), hashed anonymous id, no raw private text by default.
- `NormalizedDemandPattern` — controlled genres/tropes/tone/roles/language + unresolved fields.
- Canonical key — deterministic `v1|g:…|t:…|…` (versioned).
- `DemandPatternRecord` — aggregated evidence + lifecycle + closest content + geo/language segments.
- `ProductionSignal` — producer-facing foundation with explicit non-forecast disclaimer.

### Gap detection (configurable thresholds)

| State | Meaning |
|-------|---------|
| NO_GAP | Strong catalog match |
| INTENT_GAP | Parser/interpretation failure — not a production brief |
| POSSIBLE_GAP | Content gap with early unique-user evidence |
| REPEATED_GAP | Sustained unique users + capped requests |
| BEHAVIORALLY_VALIDATED | + related-content completion/continuation evidence |
| PRODUCTION_SIGNAL | Explicit promote of validated CONTENT_GAP |
| SATISFIED | Post-launch plays+completions recorded (not auto) |

### Behavioral metrics (component, not one opaque score)

`unique_users`, `request_count`, `cappedRequestCount`, `repeat_users`, related impressions/plays/completions/skips/next, shares, follows, returns, and derived rates.

Anti-obsession: per-anonymous-id request cap for gap promotion counts.

### Confidence

`low|medium|high` + numeric score = **how much evidence we have**, never “expected viewers.”

### Temporal / geo / language

Activity score with half-life decay; segments by country/language when already present in context (no precise location).

### Closest content

Best catalog overlap for the pattern — measure related behavior even when primary query is weak/zero.

### Privacy assumptions

Aggregate intelligence only; hash anonymous identifiers; minimize raw query storage; no sensitive attributes; producer API must not expose individual behavior.

### Derived metrics

| Metric | Calculation |
|--------|-------------|
| `request_count` | Raw ingest events per pattern |
| `unique_users` | Distinct anonymous hashes |
| `repeat_users` | Users with ≥2 requests |
| `gap_rate` | patterns in CONTENT_GAP states / all patterns |
| `repeat_gap_rate` | REPEATED_GAP+ / CONTENT_GAP patterns |
| `behavioral_validation_rate` | BEHAVIORALLY_VALIDATED+ / CONTENT_GAP |
| `closest_content_completion_rate` | related completions / related plays |
| `closest_content_continuation_rate` | related next / related plays |
| `demand_satisfaction_rate` | SATISFIED / ever BEHAVIORALLY_VALIDATED |

None of these is a forecast.
