# The Standard — what "10/10" means, in numbers

Every claim of superiority is a number we measure, never an adjective. If it cannot be
measured, it is not part of the standard yet.

## 1. Why a viewer picks us

Competitor baseline (verified 2026-09-16, TheWrap): the leading apps give the first 8–10
episodes free, then paywall with coins or subscriptions of up to $19.99 a week.

| Our rule                                                                        | Status 2026-09-16                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Every episode free, forever. No coins, unlocks or tasks                         | Holds by design: no payment code exists                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| Open a link and the episode is already playing. No install, login or onboarding | Holds, also at catalog scale: the page carries only the target episode and the next, so the HTML stays about 16–18 kB whatever the catalog size (measured with 600 and 3,000 generated episodes, `npm run e2e:web:scale`). On a throttled phone profile (1.6 Mbps, 150 ms, 4x CPU) first play takes about 8 s on the stand-in pack: not yet within target. A viewer who once turned the sound on still gets autoplay: every visit starts muted (`npm run e2e:web`, under the phone rule that refuses sound without a gesture). A link shared from the rail carries the moment and opens 3 s before it, still as an autoplay (`npm run e2e:web`)                                                                                                                                                                                                                                                                                                                                                              |
| Ads only inside the Ad Charter (section 2)                                      | Enforced in code: 26 tests, each rule proven by a sabotage run. No ads shown yet                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| A shared link opens the exact episode, with a correct preview card              | Holds: absolute preview URLs; `npm run export:web` refuses an export pointing elsewhere (proven on a localhost build). Since 2026-09-18 the card is the landscape 1200×630 image ingest builds from the episode frame, declared with width, height and alt, instead of the 9:16 poster crawlers cut to a band; the export check refuses a page whose preview is not landscape. Real crawler rendering (X, WhatsApp) is not tested                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| Contextual ads only, no personal profiling                                      | Holds by design                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| Picture adapts to the network; nothing downloaded beyond current + next episode | Holds on the stand-in pack: HLS, 2 s segments; at a cold open the next episode fetches only its first 4 s and nothing beyond it is fetched (`npm run e2e:web`). At open only 3 posters are fetched and at most 5 slides hold a poster or a player, whatever the catalog size (`npm run e2e:web:scale`). Safari's native path is not tested yet                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| Subtitles in the viewer's language                                              | Partial: English, and Spanish on one episode. Drawn by the app above the title block, on by default while muted, and an explicit choice is remembered (`npm run e2e:web`); 8.0:1 contrast over a white frame, pinned by a test on the shipped CSS. Since 2026-09-18 a track is marked ready only if its file parses, its cues fit the measured duration (no drift past the end, no stop before 60% of the episode, at least 30% covered) and its language is one the licence covers and it is on disk in the export; `npm run export:web` refuses an export whose catalog promises a caption file that is not there. Real phones and Safari not tested yet                                                                                                                                                                                                                                                                                                                                                   |
| Reasons to return tomorrow (follow survives reload, new-episode alerts)         | **Partial.** The place in a story survives reload, one per series (a shared link into another series keeps it), and a viewer who finished an episode reopens on the next one (`npm run e2e:web`). Like and follow live in memory only; no new-episode alerts                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| Usable with a keyboard, a screen reader and a phone on its side                 | Partial. In headless Chrome (`npm run e2e:web`): Space on a focused button presses it; the Tune sheet traps focus, closes on Escape and gives focus back; an episode change is announced politely and focus follows it; rail toggles keep one name with `aria-pressed`; a 740×360 phone gets the uncropped 9:16 frame and no page scroll; on that frame and on a 568×320 one the Tune sheet stays inside the picture with its title and its Close button on screen, its chips scroll to the last one, and a tap on the backdrop above it closes it; every rail icon keeps 3:1 over a white frame. Contrast of the sheet title, episode position and playback error is pinned by `a11y.test.ts`. A notch is emulated through CDP (59/34/44/44, which env() does resolve) to measure the safe areas: the body adds no padding, the rail and the title clear the inset on a full-bleed phone, and a letterboxed frame does not pay it a second time. VoiceOver, TalkBack and real notched phones not tested yet |
| An episode never freezes on its poster                                          | Holds in headless Chrome: a network drop while the next episode warms recovers when the network is back; an episode that cannot load shows why for 2.5 s, then moves on; a playlist answering 503 four times plays after the player's own retries (6.5–7.8 s over two runs); a network that answers nothing shows the error after the watchdog (20 s), skips two episodes, then stops on "Connection problem" instead of running through the feed; sound refused without a gesture plays muted (`npm run e2e:web`). The watchdog re-attach, the retry timers and the muted fallback are each driven in the browser. Real phones, Safari's native player and flaky mobile networks not tested yet                                                                                                                                                                                                                                                                                                             |

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

| Metric                                    | Target                                                                                           | Measured from                                                                                                                                                                                             |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Time to first play, cold open on 4G       | < 1.5 s (spec), aiming < 1.0 s                                                                   | `first_meaningful_play.time_to_first_play` where `start_mode` = `autoplay`; stops at the first frame on screen (`frame_source`), not at `play()`                                                          |
| Swipe to next episode playing             | < 300 ms                                                                                         | `play.swipe_to_play_ms`: from the first scroll event of the gesture (the key press for keys) to the first frame of the episode swiped to, one clock; the snap animation and the settle wait are inside it |
| Rebuffering                               | < 1% of watch time                                                                               | `buffer_start` / `buffer_end`, after the first frame of each episode (startup waiting is not rebuffering)                                                                                                 |
| Playback failures                         | < 0.5% of plays                                                                                  | `playback_error` / `play` with `first_frame` = true                                                                                                                                                       |
| First-load JavaScript                     | ≤ 150 kB                                                                                         | `next build` output (136 kB on 2026-09-17, captions layer, notices, series end and accessibility pass included); the catalog is not in it, it is `catalog/feed.json`, fetched after first play            |
| Data per watched minute at lowest quality | ≤ 5 MB                                                                                           | `scripts/package-episode.mjs` refuses more (stand-in pack after the 2026-09-18 re-pack, now with audio and moving pictures: 1.67–1.74 MB)                                                                 |
| Loudness of every published episode       | −16 LUFS ± 1 LU, true peak ≤ −1 dBFS                                                             | measured back from the packaged audio with `ebur128`; the gate refuses the episode otherwise (stand-in pack: delivered −27.7 to −44.6 LUFS, published −16.0 on all five)                                  |
| Preload                                   | current + first 4 s of next only                                                                 | `npm run e2e:web` fails otherwise                                                                                                                                                                         |
| Feed at catalog scale                     | ≤ 6 posters at open, ≤ 5 slides with media, HTML ≤ 50 kB, feed list ≤ 120 slides after 47 swipes | `npm run build:web:stress && npm run e2e:web:scale` fails otherwise                                                                                                                                       |

Local reference run, 2026-09-16, headless Chrome on the static export: first episode playing
585 ms after navigation, swipe to next episode playing in 8 ms. Localhost has no network
latency, so these numbers bound the code, not the phone.

Catalog-scale run, 2026-09-17, same setup, stand-in pack plus 600 generated episodes
(`npm run build:web:stress`), before and after the feed was windowed:

| Measure                                   | Before (f2d2006) | After      |
| ----------------------------------------- | ---------------- | ---------- |
| Posters requested at open                 | 605              | 3          |
| Slides rendering poster or player at open | 605              | 3          |
| `index.html` / an episode page            | 408 / 410 kB     | 16 / 18 kB |
| Whole export                              | 254 MB           | 30 MB      |
| First episode playing after navigation    | 1,649 ms         | 474 ms     |
| Shared link far in the catalog playing    | 1,516 ms         | 333 ms     |
| Feed list after 47 swipes                 | 605 slides       | 82 slides  |
| Throttled phone, first play (median of 3) | 55.8 s           | 7.8 s      |

At 3,000 generated episodes the after column holds (3 posters, 16 / 18 kB HTML, 538 ms,
82 slides after 47 swipes); the catalog file is 3.4 MB, 78 kB gzipped, and is fetched only
after first play. On the throttled profile with the normal catalog, the hls.js download
now starts at about 0.6 s instead of 3.5 s, together with the episode playlist (5.5 s
before). Sharding the catalog file per series is left to the series-manifest batch.

Playback recovery run, 2026-09-17, same setup, `npm run e2e:web` against the export of
8b38a2f (built in a temporary worktree) and against the branch that fixes it:

| Check                                                        | 8b38a2f                           | After                             |
| ------------------------------------------------------------ | --------------------------------- | --------------------------------- |
| Continue on the resume offer (saved at 5 s)                  | 0.87 s: no seek                   | 5.80 s                            |
| Returning viewer who once unmuted, 3 s after open            | paused at 0 s, sound on           | playing at 3.0 s, muted           |
| Returning after finishing episode 2                          | lands on episode 1, no offer      | episode 3 with its offer          |
| Offline 12 s while episode 3 warms, back online, swipe to it | stuck at 0 s for 15 s, no message | playing after 102 ms              |
| Episode whose playlist answers 404                           | no error, no skip within 20 s     | error shown 2.5 s, then episode 4 |

The autoplay rule of phones is emulated in the page (headless Chrome plays sound without a
gesture whatever `--autoplay-policy` says). The error skip and the offline recovery are
measured on localhost; a real mobile network is untested.

Caveat on the "Before (f2d2006)" and "8b38a2f" columns, found during the review on
2026-09-17. Those temporary worktrees borrowed the main checkout's `node_modules`, where the
`@project-flow/*` workspace links point at the main repository. Those runs may therefore have
combined old app code with newer shared packages. The bugs were also reproduced
independently: the audit measured PB-1, PB-2 and PB-3 on the original code, and the review
rebuilt f0b6015 with its own workspace packages. The "After" columns are not affected.

Review of the playback batch, 2026-09-17, same setup, `npm run e2e:web` against the export
of f0b6015 (built in a temporary worktree with its own workspace packages) and against the
branch that fixes it:

| Check                                                      | f0b6015                                       | After                                              |
| ---------------------------------------------------------- | --------------------------------------------- | -------------------------------------------------- |
| Episode 1 watched 4 s, episode 2 glimpsed 1 s, reopen `/`  | episode 2, "Continue story" that does nothing | episode 1 at the top, no strip                     |
| Episode 2 finished, episode 3 left after 0.8 s, reopen `/` | episode 3, "Continue story"                   | episode 3, "Up next"                               |
| Network online but answering nothing                       | skips every ~22 s through the whole feed      | two skips, then "Connection problem" held          |
| Scroll gesture to the next episode, `swipe_to_play_ms`     | 165 ms, from the settled commit               | 166–199 ms (two runs), from the first scroll event |

A playlist answering 503 four times (played after 6.5–7.8 s, the last wait 3.0 s) and sound
refused without a gesture (next episode playing muted, `autoplay_muted_fallback` sent)
pass on both: they were untested paths, not broken ones.

Content pipeline, 2026-09-18 (`node scripts/ingest-series.mjs`, `node scripts/gate-proof.mjs`,
ffmpeg 8.0.1 on the stand-in pack). The pack was regenerated with an audio bed and brighter,
moving pictures, so the "before" column is the same five frames packaged the old way, not a
different pack:

| Measure                                    | Before                                     | After                                              |
| ------------------------------------------ | ------------------------------------------ | -------------------------------------------------- |
| Loudness delivered                         | −27.7 … −44.6 LUFS (16.9 LU apart)         | unchanged: that is the delivery                    |
| Loudness published                         | not normalised, not measured               | **−16.0 LUFS on all five**, read back with ebur128 |
| Posters, five episodes                     | 93,674 B (720×1280 JPEG)                   | **18,930 B** (540 px WebP), −80%                   |
| Poster of the active slide (LCP)           | 17.4–20.3 kB                               | 3.6–4.1 kB                                         |
| Link preview                               | 720×1280 poster, no size declared          | 1200×630 card, width/height/alt declared           |
| Duplicate `hls/*/poster.jpg` in the export | 5 files                                    | none                                               |
| Catalog entries typed by hand              | 5 episodes × 8 fields                      | none: built from the generated manifest            |
| Episode durations                          | one constant, 10 000 ms, for every episode | measured per episode by ffmpeg                     |
| Ingest of an unchanged pack                | —                                          | 3.5 s (0 re-encoded) against 50.7 s cold           |

The gate is proven by breaking it on purpose (`npm run proof:gate`, 18 real deliveries
built with ffmpeg and ingested for real, about 2 minutes; it runs in CI after the unit
tests). Since the review of 2026-09-18 it also proves what a refusal must NOT do:

| Delivery                                                                | Verdict  | Reason, or what is proven                                                                                              |
| ----------------------------------------------------------------------- | -------- | ---------------------------------------------------------------------------------------------------------------------- |
| the pack as delivered                                                   | accepted | —                                                                                                                      |
| silent audio                                                            | refused  | `silent_opening`, `mostly_silent`                                                                                      |
| 3 s of black at the top                                                 | refused  | `black_opening`                                                                                                        |
| 1280×720 master                                                         | refused  | `not_vertical`                                                                                                         |
| vertical pixels with a rotation flag that shows them landscape          | refused  | `not_vertical` 1280x720 (was accepted, and shipped landscape renditions)                                               |
| caption file missing                                                    | refused  | `missing_caption_file`                                                                                                 |
| same master twice                                                       | refused  | `duplicate_master`                                                                                                     |
| territories `["US"]`                                                    | refused  | the site cannot restrict by country (was accepted and shown worldwide)                                                 |
| a `fr` caption on an `en`-only licence                                  | refused  | `caption_language_not_licensed` (was published)                                                                        |
| `episodeSlug: ".."`                                                     | refused  | `bad_episode_slug` (was: the series folder wiped)                                                                      |
| a fade to black, an end card, a freeze-frame ending                     | accepted | the still is detected and allowed (all three were refused `frozen_picture`)                                            |
| a vertical master stored sideways with a rotation flag                  | accepted | renditions and manifest 720×1280 (was refused)                                                                         |
| a re-delivery with a recut and cut-off subtitles, then a numbering typo | refused  | **all 54 published files and the manifest byte-identical** (the recut used to overwrite the live HLS, poster and card) |
| the fixed re-delivery                                                   | accepted | 0 re-encoded, 2 resumed from the stage                                                                                 |
| the same delivery again                                                 | accepted | 0 re-encoded, 0 files changed                                                                                          |
| `audioStream` corrected from 1 to 0                                     | accepted | re-encoded with stream 0 (the wrong stem used to stay live)                                                            |

The rollback cases were themselves proven to fail: an ingest sabotaged to publish its stage
on a refusal turned 9 of the 18 cases red.

The same run on the real stand-in pack (`node scripts/ingest-series.mjs`, 2026-09-18) found
a defect nobody had seen: the Spanish subtitles of episode 1 stopped at 5.5 s of 10 s, one
line short. The tightened tail rule refused the series and **nothing published changed**
(`git status` clean under `apps/web/public`); with the line restored the next run resumed
all five episodes from the stage instead of re-encoding them, and a third run reported
"unchanged, byte for byte". Re-encoding under gate version 3 produced byte-identical
segments, posters and cards: only the packaging records changed.

Not measured: a real drama frame compresses differently from a colour bed, so the poster
saving above bounds the format change, not the picture; and no real crawler was asked to
render the new share card.

Declared trade-off: the feed poster is 540 px wide. On a 375 pt phone at 3× it is shown
about 2.1× upscaled (the old 720 px JPEG was 1.56×), so it is softer than the video that
replaces it. It is on screen until the first frame, and during the tap-to-play and error
states. The bytes (3.6–4.1 kB on the LCP image) were chosen over sharpness; a 1080 px
variant through `srcset` is not built yet.

## 4. Definition of done

On top of the quality bar in [`docs/product-principles.md`](product-principles.md):

1. **Measured, not estimated.** Every performance or economic claim points to an event, a
   build output or a dated source.
2. **Zero regressions.** Before a change is done: typecheck, lint, the full test suite, a
   production build, and `npm run e2e:web` — the real browser run of open → play → swipe.
3. **Limits declared.** Whatever is not done is written down where the next person will read
   it — starting with the status column in section 1.
