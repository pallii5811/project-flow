# The Standard — what "10/10" means, in numbers

Every claim of superiority is a number we measure, never an adjective. If it cannot be
measured, it is not part of the standard yet.

## 1. Why a viewer picks us

Competitor baseline (verified 2026-09-16, TheWrap): the leading apps give the first 8–10
episodes free, then paywall with coins or subscriptions of up to $19.99 a week.

| Our rule                                                                        | Status 2026-09-16                                                         |
| ------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| Every episode free, forever. No coins, unlocks or tasks                         | Holds by design: no payment code exists                                   |
| Open a link and the episode is already playing. No install, login or onboarding | Holds. Measured: about 2 s to playback on a local production build        |
| Ads only inside the Ad Charter (section 2)                                      | Written as rules. Code in progress. No ads shown                          |
| A shared link opens the exact episode, with a correct preview card              | **Broken**: preview image points to localhost (measured). Fix in progress |
| Contextual ads only, no personal profiling                                      | Holds by design                                                           |
| Picture adapts to the network; nothing downloaded beyond current + next episode | **Not yet.** Single-file MP4, and 4 files fetched at open (measured)      |
| Subtitles in the viewer's language                                              | Partial: English, and Spanish on one episode                              |
| Reasons to return tomorrow (follow survives reload, new-episode alerts)         | **Not yet.** Like and follow live in memory only                          |

A row turns green only with evidence: a test, a build artifact, or a production metric.

## 2. Ad Charter — hard rules

Enforced by `evaluateAdBreak` in `packages/feed-domain/src/ads/adCharter.ts`. The values are
pinned by tests, so changing one requires a new entry in [`docs/decisions.md`](decisions.md)
and a deliberate test change.

| Rule                                         | Value                                                                            |
| -------------------------------------------- | -------------------------------------------------------------------------------- |
| Ad-free grace at the start of a session      | first **10 watched minutes**                                                     |
| Watched time between two breaks              | at least **10 minutes**                                                          |
| Longest break                                | **30 seconds**                                                                   |
| Ad time per hour of viewing (rolling window) | at most **180 seconds**                                                          |
| Where                                        | only at an **episode boundary**                                                  |
| Sponsor card                                 | at most **3 seconds**, once per series per session, counts toward the hourly cap |
| Session reset                                | after **30 minutes** without watching                                            |
| Targeting                                    | contextual only: series, genre, language, country                                |

Never:

- before the first episode of a session;
- in the middle of an episode;
- while a sheet or surface is open (intent, share, series end);
- with sound when the viewer is muted;
- as a condition to unlock anything.

## 3. Experience targets

p75 in production unless stated otherwise.

| Metric                                    | Target                             | Measured from                                  |
| ----------------------------------------- | ---------------------------------- | ---------------------------------------------- |
| Time to first play, cold open on 4G       | < 1.5 s (spec), aiming < 1.0 s     | `first_meaningful_play.time_to_first_play`     |
| Swipe to next episode playing             | < 300 ms                           | `feed_swipe` → `play`                          |
| Rebuffering                               | < 1% of watch time                 | `buffer_start` / `buffer_end`                  |
| Playback failures                         | < 0.5% of plays                    | `playback_error` / `play`                      |
| First-load JavaScript                     | ≤ 150 kB                           | `next build` output (125–128 kB on 2026-09-16) |
| Data per watched minute at lowest quality | ≤ 5 MB                             | HLS ladder produced by the packaging script    |
| Preload                                   | current + next episode only (spec) | network log of a cold open                     |

## 4. Definition of done

On top of the quality bar in [`docs/product-principles.md`](product-principles.md):

1. **Measured, not estimated.** Every performance or economic claim points to an event, a
   build output or a dated source.
2. **Zero regressions.** Before a change is done: typecheck, lint, the full test suite, a
   production build, and a real browser run of open → play → swipe.
3. **Limits declared.** Whatever is not done is written down where the next person will read
   it — starting with the status column in section 1.
