# The Standard — what "10/10" means, in numbers

Every claim of superiority is a number we measure, never an adjective. If it cannot be
measured, it is not part of the standard yet.

## 1. Why a viewer picks us

Competitor baseline (verified 2026-09-16, TheWrap): the leading apps give the first 8–10
episodes free, then paywall with coins or subscriptions of up to $19.99 a week.

| Our rule                                                                        | Status 2026-09-16                                                                                                                                                                                      |
| ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Every episode free, forever. No coins, unlocks or tasks                         | Holds by design: no payment code exists                                                                                                                                                                |
| Open a link and the episode is already playing. No install, login or onboarding | Holds, also at catalog scale: the page carries only the target episode and the next, so the HTML stays about 16–18 kB whatever the catalog size (measured with 600 and 3,000 generated episodes, `npm run e2e:web:scale`). On a throttled phone profile (1.6 Mbps, 150 ms, 4x CPU) first play takes about 8 s on the stand-in pack: not yet within target |
| Ads only inside the Ad Charter (section 2)                                      | Enforced in code: 26 tests, each rule proven by a sabotage run. No ads shown yet                                                                                                                       |
| A shared link opens the exact episode, with a correct preview card              | Holds: absolute preview URLs; `npm run export:web` refuses an export pointing elsewhere (proven on a localhost build)                                                                                  |
| Contextual ads only, no personal profiling                                      | Holds by design                                                                                                                                                                                        |
| Picture adapts to the network; nothing downloaded beyond current + next episode | Holds on the stand-in pack: HLS, 2 s segments; at a cold open the next episode fetches only its first 4 s and nothing beyond it is fetched (`npm run e2e:web`). At open only 3 posters are fetched and at most 5 slides hold a poster or a player, whatever the catalog size (`npm run e2e:web:scale`). Safari's native path is not tested yet |
| Subtitles in the viewer's language                                              | Partial: English, and Spanish on one episode                                                                                                                                                           |
| Reasons to return tomorrow (follow survives reload, new-episode alerts)         | **Not yet.** Like and follow live in memory only                                                                                                                                                       |

A row turns green only with evidence: a test, a build artifact, or a production metric.

## 2. Ad Charter — hard rules

Enforced by `evaluateAdBreak` in `packages/feed-domain/src/ads/adCharter.ts`. The values are
pinned by tests, so changing one requires a new entry in [`docs/decisions.md`](decisions.md)
and a deliberate test change.

| Rule                                         | Value                                                                                                                                  |
| -------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| Ad-free grace at the start of a session      | first **10 watched minutes**                                                                                                           |
| Watched time between two interruptions       | at least **10 minutes**, whatever their kind                                                                                           |
| Longest break                                | **30 seconds**                                                                                                                         |
| Ad time per hour of viewing (rolling window) | at most **180 seconds**                                                                                                                |
| Where                                        | only at an **episode boundary**                                                                                                        |
| Sponsor card                                 | at most **3 seconds**, once per series per session, only when a series starts; obeys the same grace, spacing and hourly cap as a break |
| Session reset                                | after **30 minutes** without watching                                                                                                  |
| Targeting                                    | contextual only: series, genre, language, country                                                                                      |

Never:

- before the first episode of a session;
- in the middle of an episode;
- while a sheet or surface is open (intent, share, series end);
- with sound when the viewer is muted;
- as a condition to unlock anything.

## 3. Experience targets

p75 in production unless stated otherwise.

| Metric                                    | Target                           | Measured from                                                            |
| ----------------------------------------- | -------------------------------- | ------------------------------------------------------------------------ |
| Time to first play, cold open on 4G       | < 1.5 s (spec), aiming < 1.0 s   | `first_meaningful_play.time_to_first_play`                               |
| Swipe to next episode playing             | < 300 ms                         | `feed_swipe` → `play`                                                    |
| Rebuffering                               | < 1% of watch time               | `buffer_start` / `buffer_end`                                            |
| Playback failures                         | < 0.5% of plays                  | `playback_error` / `play`                                                |
| First-load JavaScript                     | ≤ 150 kB                         | `next build` output (127 kB on 2026-09-17); the catalog is not in it, it is `catalog/feed.json`, fetched after first play |
| Data per watched minute at lowest quality | ≤ 5 MB                           | `scripts/package-episode.mjs` refuses more (stand-in pack: 0.95–1.02 MB) |
| Preload                                   | current + first 4 s of next only | `npm run e2e:web` fails otherwise                                        |
| Feed at catalog scale                     | ≤ 6 posters at open, ≤ 5 slides with media, HTML ≤ 50 kB, feed list ≤ 120 slides after 47 swipes | `npm run build:web:stress && npm run e2e:web:scale` fails otherwise |

Local reference run, 2026-09-16, headless Chrome on the static export: first episode playing
585 ms after navigation, swipe to next episode playing in 8 ms. Localhost has no network
latency, so these numbers bound the code, not the phone.

Catalog-scale run, 2026-09-17, same setup, stand-in pack plus 600 generated episodes
(`npm run build:web:stress`), before and after the feed was windowed:

| Measure                                   | Before (f2d2006) | After        |
| ----------------------------------------- | ---------------- | ------------ |
| Posters requested at open                 | 605              | 3            |
| Slides rendering poster or player at open | 605              | 3            |
| `index.html` / an episode page            | 408 / 410 kB     | 16 / 18 kB   |
| Whole export                              | 254 MB           | 30 MB        |
| First episode playing after navigation    | 1,649 ms         | 474 ms       |
| Shared link far in the catalog playing    | 1,516 ms         | 333 ms       |
| Feed list after 47 swipes                 | 605 slides       | 82 slides    |
| Throttled phone, first play (median of 3) | 55.8 s           | 7.8 s        |

At 3,000 generated episodes the after column holds (3 posters, 16 / 18 kB HTML, 538 ms,
82 slides after 47 swipes); the catalog file is 3.4 MB, 78 kB gzipped, and is fetched only
after first play. On the throttled profile with the normal catalog, the hls.js download
now starts at about 0.6 s instead of 3.5 s, together with the episode playlist (5.5 s
before). Sharding the catalog file per series is left to the series-manifest batch.

## 4. Definition of done

On top of the quality bar in [`docs/product-principles.md`](product-principles.md):

1. **Measured, not estimated.** Every performance or economic claim points to an event, a
   build output or a dated source.
2. **Zero regressions.** Before a change is done: typecheck, lint, the full test suite, a
   production build, and `npm run e2e:web` — the real browser run of open → play → swipe.
3. **Limits declared.** Whatever is not done is written down where the next person will read
   it — starting with the status column in section 1.
