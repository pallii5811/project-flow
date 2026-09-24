# The Standard — what "10/10" means, in numbers

Every claim of superiority is a number we measure, never an adjective. If it cannot be
measured, it is not part of the standard yet.

## 1. Why a viewer picks us

Competitor baseline (verified 2026-09-16, TheWrap): the leading apps give the first 8–10
episodes free, then paywall with coins or subscriptions of up to $19.99 a week.

| Our rule                                                                        | Status 2026-09-16                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| ------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Every episode free, forever. No coins, unlocks or tasks                         | Holds by design: no payment code exists                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| Open a link and the episode is already playing. No install, login or onboarding | Holds, also at catalog scale: the page carries only the target episode and the next, so the HTML stays about 16–18 kB whatever the catalog size (measured with 600 and 3,000 generated episodes, `npm run e2e:web:scale`). On a throttled phone profile (1.6 Mbps, 150 ms, 4x CPU) first play takes about 8 s on the stand-in pack: not yet within target. A viewer who once turned the sound on still gets autoplay: every visit starts muted (`npm run e2e:web`, under the phone rule that refuses sound without a gesture). A link shared from the rail carries the moment and opens 3 s before it, still as an autoplay (`npm run e2e:web`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| Ads only inside the Ad Charter (section 2)                                      | Enforced in code: 26 tests, each rule proven by a sabotage run. No ads shown yet                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| A shared link opens the exact episode, with a correct preview card              | Holds: absolute preview URLs; `npm run export:web` refuses an export pointing elsewhere (proven on a localhost build). Since 2026-09-18 the card is the landscape 1200×630 image ingest builds from the episode frame, declared with width, height and alt, instead of the 9:16 poster crawlers cut to a band; the export check refuses a page whose preview is not landscape. Since 2026-09-18 (batch 5) every episode page has its own title ("Signal Night · Episode 3") and share title ("Signal Night · Ep. 3: …"), `og:type` video.episode, `og:site_name` and a canonical address on the configured site, and a share is built on `NEXT_PUBLIC_SITE_URL`, never on the host that served the page (a `pages.dev` preview, a mirror): `npm run export:web` refuses duplicate titles or a canonical elsewhere, `npm run e2e:web:platform` clicks Share and reads the link. Real crawler rendering (X, WhatsApp) is not tested                                                                                                                                                                                                                                                         |
| Contextual ads only, no personal profiling                                      | Holds by design                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| A studio's delivery becomes a published series without the owner downloading it | Holds for the whole path, proven without a studio file: a link is downloaded on a runner, a 90-minute file glued from episodes is cut where a person confirmed, each episode is packaged, uploaded to zero-egress storage and its local copy deleted, and only a manifest comes back (`npm run proof:cloud`, `npm run proof:split`, `npm run proof:gate`). A catalog whose media sits on another host plays in a browser, with its subtitles, and breaks no security policy (`npm run e2e:web:scale`, check 46). Measured cost, not guessed: the run prints its runner minutes. Since 2026-09-20 the same ingest can run on a 16-core machine made for one series and deleted with it (`runner: scaleway`), because 45–60 series do not fit in 2,000 free minutes a month; 15 cases prove it is unmade after every way a run can end, including the orchestrator killed mid-run (`npm run proof:scaleway`). No real studio delivery has gone through it yet, and **nothing here has ever spoken to the real Scaleway API**: the proofs run against a stand-in, because no credential for it exists on this machine                                                                        |
| A stranger finds us at all, with no advertising budget                          | **Partial, and untried.** One command turns an ingested series into a day of vertical clips for TikTok, Reels and Shorts — the moment chosen from measured speech, loudness, picture cuts and position, never at random; subtitles burned in on an opaque plate at 9.55:1 over the real frames; −14.3 LUFS; nothing drawn where the platforms' own interface sits; a link carrying `utm_campaign=clip-<code>` back to the exact clip; and a refusal by name for a series whose licence does not allow clips (`npm run proof:clips`, 23 cases; `docs/clips.md`). Ten clips cost 1.5–3 minutes of machine time. **Nothing has been posted yet**, so there is no arrival, retention or conversion number here — only that the files are what the platforms ask for                                                                                                                                                                                                                                                                                                                                                                                                                           |
| A studio's delivery becomes a published series without the owner downloading it | Holds for the whole path, proven without a studio file: a link is downloaded on a runner, a 90-minute file glued from episodes is cut where a person confirmed, each episode is packaged, uploaded to zero-egress storage and its local copy deleted, and only a manifest comes back (`npm run proof:cloud`, `npm run proof:split`, `npm run proof:gate`). A catalog whose media sits on another host plays in a browser, with its subtitles, and breaks no security policy (`npm run e2e:web:scale`, check 46). Measured cost, not guessed: the run prints its runner minutes. Since 2026-09-20 the same ingest can run on a 16-core machine made for one series and deleted with it (`runner: scaleway`), because 45–60 series do not fit in 2,000 free minutes a month; 15 cases prove it is unmade after every way a run can end, including the orchestrator killed mid-run (`npm run proof:scaleway`). No real studio delivery has gone through it yet, and **nothing here has ever spoken to the real Scaleway API**: the proofs run against a stand-in, because no credential for it exists on this machine                                                                        |
| Picture adapts to the network; nothing downloaded beyond current + next episode | Holds on the stand-in pack: HLS, 2 s segments; at a cold open the next episode fetches only its first 4 s and nothing beyond it is fetched (`npm run e2e:web`). At open only 3 posters are fetched and at most 5 slides hold a poster or a player, whatever the catalog size (`npm run e2e:web:scale`). Safari's native path is not tested yet                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| Subtitles in the viewer's language                                              | Partial: English, and Spanish on one episode. Drawn by the app above the title block, on by default while muted, and an explicit choice is remembered (`npm run e2e:web`); 8.0:1 contrast over a white frame, pinned by a test on the shipped CSS. Since 2026-09-18 a track is marked ready only if its file parses, its cues fit the measured duration (no drift past the end, no stop before 60% of the episode, at least 30% covered) and its language is one the licence covers and it is on disk in the export; `npm run export:web` refuses an export whose catalog promises a caption file that is not there. Real phones and Safari not tested yet                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| Reasons to return tomorrow (follow survives reload, new-episode alerts)         | **Partial.** The place in a story survives reload, one per series (a shared link into another series keeps it), and a viewer who finished an episode reopens on the next one (`npm run e2e:web`). Like and follow live in memory only; no new-episode alerts. Since 2026-09-18 the site installs to the home screen (manifest Chrome accepts with no installability error, 192/512/maskable icons and an apple-touch-icon from one mark, standalone portrait, `npm run e2e:web:platform`); a one-time invitation appears only after two finished episodes and a minute, never again whatever the answer, and a launch from the home screen is counted (`utm_source=homescreen`, `display_mode` on `page_view`). Installing on a real phone is not tested                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| Usable with a keyboard, a screen reader and a phone on its side                 | Partial. In headless Chrome (`npm run e2e:web`): Space on a focused button presses it; the Tune sheet traps focus, closes on Escape and gives focus back; an episode change is announced politely and focus follows it; rail toggles keep one name with `aria-pressed`; a 740×360 phone gets the uncropped 9:16 frame and no page scroll; on that frame and on a 568×320 one the Tune sheet stays inside the picture with its title and its Close button on screen, its chips scroll to the last one, and a tap on the backdrop above it closes it; every rail icon keeps 3:1 over a white frame. Contrast of the sheet title, episode position and playback error is pinned by `a11y.test.ts`. A notch is emulated through CDP (59/34/44/44, which env() does resolve) to measure the safe areas: the body adds no padding, the rail and the title clear the inset on a full-bleed phone, and a letterboxed frame does not pay it a second time. Since 2026-09-18 the page asks for `viewport-fit=cover`, so those insets are no longer 0 on a real notched phone; the install card sits 14 px below an emulated 59 px notch. VoiceOver, TalkBack and real notched phones not tested yet |
| An episode never freezes on its poster                                          | Holds in headless Chrome: a network drop while the next episode warms recovers when the network is back; an episode that cannot load shows why for 2.5 s, then moves on; a playlist answering 503 four times plays after the player's own retries (6.5–7.8 s over two runs); a network that answers nothing shows the error after the watchdog (20 s), skips two episodes, then stops on "Connection problem" instead of running through the feed; sound refused without a gesture plays muted (`npm run e2e:web`). The watchdog re-attach, the retry timers and the muted fallback are each driven in the browser. Real phones, Safari's native player and flaky mobile networks not tested yet                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |

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

| Metric                                    | Target                                                                                           | Measured from                                                                                                                                                                                                    |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Time to first play, cold open on 4G       | < 1.5 s (spec), aiming < 1.0 s                                                                   | `first_meaningful_play.time_to_first_play` where `start_mode` = `autoplay`; stops at the first frame on screen (`frame_source`), not at `play()`                                                                 |
| Swipe to next episode playing             | < 300 ms                                                                                         | `play.swipe_to_play_ms`: from the first scroll event of the gesture (the key press for keys) to the first frame of the episode swiped to, one clock; the snap animation and the settle wait are inside it        |
| Rebuffering                               | < 1% of watch time                                                                               | `buffer_start` / `buffer_end`, after the first frame of each episode (startup waiting is not rebuffering)                                                                                                        |
| Playback failures                         | < 0.5% of plays                                                                                  | `playback_error` / `play` with `first_frame` = true                                                                                                                                                              |
| First-load JavaScript                     | ≤ 150 kB                                                                                         | `next build` output (138 kB on 2026-09-18, with the install invitation and the service worker registration; 136 kB on 2026-09-17); the catalog is not in it, it is `catalog/feed.json`, fetched after first play |
| Data per watched minute at lowest quality | ≤ 5 MB                                                                                           | `scripts/package-episode.mjs` refuses more (stand-in pack after the 2026-09-18 re-pack, now with audio and moving pictures: 1.67–1.74 MB)                                                                        |
| Loudness of every published episode       | −16 LUFS ± 1 LU, true peak ≤ −1 dBFS                                                             | measured back from the packaged audio with `ebur128`; the gate refuses the episode otherwise (stand-in pack: delivered −27.7 to −44.6 LUFS, published −16.0 on all five)                                         |
| Preload                                   | current + first 4 s of next only                                                                 | `npm run e2e:web` fails otherwise                                                                                                                                                                                |
| Feed at catalog scale                     | ≤ 6 posters at open, ≤ 5 slides with media, HTML ≤ 50 kB, feed list ≤ 120 slides after 47 swipes | `npm run build:web:stress && npm run e2e:web:scale` fails otherwise                                                                                                                                              |

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

The gate is proven by breaking it on purpose (`npm run proof:gate`, 19 cases over real deliveries
built with ffmpeg and ingested for real, about 2 minutes; it runs in CI after the unit
tests). Since the review of 2026-09-18 it also proves what a refusal must NOT do:

| Delivery                                                                | Verdict  | Reason, or what is proven                                                                                                                                                                          |
| ----------------------------------------------------------------------- | -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| the pack as delivered                                                   | accepted | —                                                                                                                                                                                                  |
| silent audio                                                            | refused  | `silent_opening`, `mostly_silent`                                                                                                                                                                  |
| 3 s of black at the top                                                 | refused  | `black_opening`                                                                                                                                                                                    |
| 1280×720 master                                                         | refused  | `not_vertical`                                                                                                                                                                                     |
| vertical pixels with a rotation flag that shows them landscape          | refused  | `not_vertical` 1280x720 (was accepted, and shipped landscape renditions)                                                                                                                           |
| caption file missing                                                    | refused  | `missing_caption_file`                                                                                                                                                                             |
| same master twice                                                       | refused  | `duplicate_master`                                                                                                                                                                                 |
| territories `["US"]`                                                    | refused  | the site cannot restrict by country (was accepted and shown worldwide)                                                                                                                             |
| a `fr` caption on an `en`-only licence                                  | refused  | `caption_language_not_licensed` (was published)                                                                                                                                                    |
| `episodeSlug: ".."`                                                     | refused  | `bad_episode_slug` (was: the series folder wiped)                                                                                                                                                  |
| a fade to black, an end card, a freeze-frame ending                     | accepted | the still is detected and allowed (all three were refused `frozen_picture`)                                                                                                                        |
| a vertical master stored sideways with a rotation flag                  | accepted | renditions and manifest 720×1280 (was refused)                                                                                                                                                     |
| a re-delivery with a recut and cut-off subtitles, then a numbering typo | refused  | **all 54 published files and the manifest byte-identical** (the recut used to overwrite the live HLS, poster and card)                                                                             |
| the fixed re-delivery                                                   | accepted | 0 re-encoded, 2 resumed from the stage                                                                                                                                                             |
| the fixed re-delivery, read by URL (batch 5)                            | accepted | the two new cuts are published under new revision folders, the old folders are gone, the manifest points at the new ones: a URL under `hls/` never changes content, so it can be cached for a year |
| the same delivery again                                                 | accepted | 0 re-encoded, 0 files changed                                                                                                                                                                      |
| `audioStream` corrected from 1 to 0                                     | accepted | re-encoded with stream 0 (the wrong stem used to stay live)                                                                                                                                        |

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

Platform run, 2026-09-18 (batch 5: `_headers`, service worker, manifest, closed beta). First
play of the 45ebb08 export against this branch, same machine, runs interleaved, headless
Chrome on the local server that now applies `_headers`:

| Measure                                   | 45ebb08            | After                     |
| ----------------------------------------- | ------------------ | ------------------------- |
| First frame, cold open, median of 9       | 384 ms (338–745)   | 359 ms (343–384)          |
| First frame, throttled phone, median of 5 | 8,229 ms           | 8,262 ms (+0.4%)          |
| Returning open, worker installed          | —                  | 285–311 ms                |
| Cache-Control on chunks, fonts and HLS    | none (revalidated) | a year, immutable         |
| Security headers                          | none               | CSP, frame, HSTS …        |
| Indexable by search engines               | yes, by default    | no, until `FLOW_PUBLIC=1` |

The throttled cost is about 2 kB more gzipped JavaScript (the install invitation, the
worker registration) and 1.5 kB more HTML (a script policy, the manifest and icon links).
A first version that sent every security header on every file cost +166 ms on the same
profile, because the local server speaks HTTP/1.1 without header compression; the document
headers are now left off scripts, fonts, media and the catalog. Pages speaks HTTP/2 and 3,
so the local figure bounds the cost from above. Real installs, iOS Safari and a real
Cloudflare edge are not measured.

Review of batch 5, same day: the `_headers` of that run wrote `/_next/static/*` and
`/catalog/*` twice, and Pages keeps only the last rule of a pattern, so on a real edge the
year of cache in the table above would have been lost (the local server applied every rule
and showed it). The file now writes each pattern once and the local server reads it the
way Pages does, so the table holds for what Pages will be sent; step 7 of
`docs/deploy.md` reads it on the real edge after the first deploy.

Cloud ingest, 2026-09-20 (one delivery, from a link to a published series). Measured on
this machine (Ryzen 9 5900X, ffmpeg 8.0.1), with packaging pinned to **two cores** to stand
for a GitHub runner, on a 30-second 1080×1920 clip at 6.4 Mbps built for the purpose (a
colour bed with grain and motion — a real drama frame compresses differently, so these
numbers bound the shape of the cost, not its exact value):

| Step, per second of video                   | 12 cores | 2 cores | What it is                              |
| ------------------------------------------- | -------- | ------- | --------------------------------------- |
| analysis pass (black, silence, cuts, bars)  | —        | 0.26 s  | once per delivery, in propose-cuts mode |
| cutting one episode out (CRF 16, veryfast)  | —        | 0.72 s  | once per episode                        |
| packaging the ladder (4 rungs, preset slow) | 0.74 s   | 2.78 s  | the cost that matters                   |

So a minute of 1080×1920 video costs about **3.5 minutes of two cores** here (packaging
plus the cut), and a 90-minute series about **5 hours** on this machine. A GitHub runner's
two processors are two threads of one core at a lower clock, so it will be slower — the
guide says 5 to 10 hours and about one 90-minute series a month inside the free 2,000
minutes, deliberately pessimistic. **This is the only number here that is an estimate**:
every run prints the minutes it really used, and the first real delivery replaces it.

The stand-in pack, same machine, 12 cores: 3.4–3.9 s per 10-second 720×1280 episode
(3 rungs), 50.7 s for the five cold.

A lever, measured on the same clip and the same two cores, **not taken**: `-preset medium`
packages in 62 s instead of 83 s (−25%) for 8% more bytes; `fast` in 58 s for 26% more
bytes. Bytes are the viewer's data plan (docs/business-model.md), so the preset stays
`slow` until someone decides otherwise with a new entry in the decision log.

Compilation splitter, 2026-09-20 (`npm run proof:split`, a 66-second file built from the
stand-in episodes with a shot change inside every episode, as strong as a boundary):

| Transition between episodes | Where it landed          | What it said                                       |
| --------------------------- | ------------------------ | -------------------------------------------------- |
| fade to black               | exact (frame 480/480)    | HIGH: "fade to black, 0.16 s of black ending here" |
| five frames of black        | exact (735/735)          | HIGH: "cut to black, 0.20 s of black"              |
| 0.8 s of silence            | exact (955/955)          | HIGH: "picture cut + 0.80 s of silence"            |
| hard cut, twice             | exact (250, 1420)        | LOW, naming the shot change 4 s away               |
| one-second cross-dissolve   | 8 frames from the middle | NONE: "nothing visible or audible"                 |

13 picture cuts were found in that file; 6 of them are inside episodes. The splitter never
took one of those, and never called a cut it could not see a sure one.

A machine made for one series, 2026-09-20 (`npm run proof:scaleway`, 15 cases against a
stand-in of the Scaleway API that refuses what the real one refuses). What is measured
here is behaviour, not speed: a run makes a disk and a machine, sends 17.8 MB of
repository, runs the ingest, brings back the manifest and what is on the store, and
deletes both — and the machine is gone after a refusal (exit 1), after a continuation
(exit 3), after the wall-clock budget (exit 2, proven with a one-minute budget) and after
Ctrl-C. Killed with SIGKILL mid-run it leaves a machine, on purpose: that is the case the
sweeper exists for, and it finds it, says it had cost EUR 1.68, and deletes it — while
refusing to touch a machine still inside its own budget unless told twice. 102 requests
were scanned: the token is a header on 101 of them and appears in no URL, no body, no tag,
no cloud-init and no log line. The commands inside the cloud-init are not copied into the
proof, they are read back out of it and run here, on real video, against a store that
checks every signature (50 objects uploaded, 8 URLs fetched back).

**The numbers below are the only estimates in this document**, and they are marked as such
wherever they are printed. From 3.5 minutes of two cores per minute of 1080×1920 video
(measured, above), divided by sixteen cores with a deliberate 40% discount for how badly
x264 scales, plus twelve fixed minutes of boot, install and download:

| Machine            | vCPU | EUR/hour | A 90-minute series | What it would cost |
| ------------------ | ---- | -------- | ------------------ | ------------------ |
| STANDARD2-A16C-64G | 16   | 0.5039   | about 1 h 18       | about EUR 0.66     |
| STANDARD2-A24C-96G | 24   | 0.6551   | about 56 min       | about EUR 0.61     |

So 45 to 60 series for EUR 30 to 45, inside the EUR 100 of free credit. Prices read off
the owner's console on 2026-09-20 and kept in `scripts/lib/scaleway-plan.mjs` with that
date; a machine type with no price there is refused rather than guessed. The ceiling of
one run is its budget: EUR 3.02 at six hours. The first real delivery replaces every
figure in this paragraph, and the run prints the measured one on its own.

Media on a store, 2026-09-20 (`npm run proof:gate`, the R2 cases, against a local stand-in
that checks every signature): a two-episode series uploads 50 objects, every URL of the
manifest is fetched back from the store's public side and answers with a year of cache; the
same delivery again uploads nothing and encodes nothing (8 questions, 0 writes); a refused
re-delivery leaves the manifest byte-identical and everything published still served; a
three-episode series published over two runs is "incomplete" until the last one; a
half-configured environment and a wrong key stop the run by name, never printing a secret.

Social clips, 2026-09-24 (`npm run proof:clips`, four one-minute episodes built with a
picture cut every 4 s, a line of dialogue every 5 s and a still end card for the last 3 s,
plus the stand-in pack through its real manifest):

| What was asked of a clip                           | What was measured                                                                                                                                              |
| -------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| the cliffhanger is where the rules put it          | 16.000–55.000 s, the millisecond the rules give                                                                                                                |
| the cut is frame-accurate in the rendered file     | first frame differs by **0.06/255** from the master's frame at the cut, and by 30.50/255 from the frame before it                                              |
| nothing burned in falls where the platform's UI is | text at 245–820 × 154–1417 px inside a free area of 65–918 × 154–1440                                                                                          |
| the captions are readable muted, over any frame    | **9.55:1** at worst on the frames they are really drawn on (AA asks 4.5:1)                                                                                     |
| the sound matches what the platforms level to      | **−14.3 LUFS**, true peak under −1 dBFS                                                                                                                        |
| the file fits every platform's cap                 | 40.52 s (39.00 s moment + 1.5 s end card), 17.3 MB, 1080×1920 H.264 + AAC                                                                                      |
| a defect is refused by its own name                | `black_in_clip`, `silent_clip`, `cut_mid_line`, one episode each; and `clips_not_allowed`, `clip_permission_missing`, `no_captions` before anything is encoded |

Cost on this machine: **about 8 s per clip** on the stand-in pack (9.5-second clips) and
**18 s** for a 40-second one at 1080×1920, so a day of ten clips is 1.5–3 minutes. The
moment selection is cached per master, so a second day pays only for the rendering.

**No clip has been posted.** Every number above is measured on a file; none of it is a
claim about what performs on a platform.

## 4. Definition of done

On top of the quality bar in [`docs/product-principles.md`](product-principles.md):

1. **Measured, not estimated.** Every performance or economic claim points to an event, a
   build output or a dated source.
2. **Zero regressions.** Before a change is done: typecheck, lint, the full test suite, a
   production build, and `npm run e2e:web` — the real browser run of open → play → swipe.
3. **Limits declared.** Whatever is not done is written down where the next person will read
   it — starting with the status column in section 1.
