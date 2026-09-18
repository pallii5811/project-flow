# Decision log

Format: date · decision · why · consequences · revisit when.

---

## 2026-09-18 — Review of 3b: a Tune sheet bounded by the picture, and a side inset paid once, by whoever owes it

**Decision:** The Tune sheet can never grow past the frame it lives in. It is a column no taller than `calc(100% - 56px)`, its header (title and Close) keeps its size, and the chips are the part that gives way: they scroll, with `overscroll-behavior: contain` so the feed behind does not move, and in the short landscape frame a 16 px fade at either end marks that there is more. That fade sits below the header, never over it. The 56 px it gives up is the band of backdrop a finger taps to dismiss the sheet.

The side safe-area insets are added by the chrome inside the picture through `--flow-inset-left` and `--flow-inset-right`, not by `env()` directly. What each piece owes is the distance to the **screen** edge: a frame that letterboxes the picture already stands clear of the notch, declares how wide its band is in `--flow-frame-gap`, and the chrome inside it pays only what is left over — which, measured, is nothing. The page for an unknown URL is a page and not a picture, so it takes `env()` straight.

**Why:** Measured on acf8795, the commit this reviews, with the system Chrome at 740×360 and 568×320: the sheet was 409 px tall in a 360 px frame, `#intent-sheet-title` sat at −30 px and Close at −36 px, no backdrop was left anywhere around it, and a tap in the letterbox hit the stage shell with the dialog still open — a touch-only viewer in landscape could not close it. The first attempt at the side insets added `env()` everywhere: correct on a full-bleed phone, wrong in a letterboxed frame, where it charged a notch that is 269 px away and cut the landscape title column from 137 px to 49 px of text with 11 px of it overflowing.

**Consequences:**

- e2e check 30 now opens the sheet at 740×360 and 568×320 and asserts the title, the Close button and the sheet itself are on screen, that the chips scroll to the last one, and that a tap on the band above it closes the dialog. Check 33 emulates a notch (59/34/44/44 through `Emulation.setSafeAreaInsetsOverride`, which `env()` does resolve in this Chrome even without `viewport-fit=cover`) and measures from the screen edge.
- Four sabotage runs, each red on its own check and on nothing else, each restored from a copy and compared byte for byte: the sheet unbounded (title at −48 px), the body padding put back (only the notched check goes red — the old one stayed green, which is why it proved nothing), the rail without its inset (6 px of clearance against a 44 px notch), and the letterbox blind to its own band (the title column back to 49 px).
- Measured after the fix: at 740×360 the sheet spans 56–360 px, its title sits at 71 px and Close at 65 px; with the notch emulated, a full-bleed 375×812 phone moves the rail from 6 px to 50 px of clearance and the title from 18 px to 62 px, while the letterboxed 812×375 frame keeps its 145 px title column with and without the notch.

**Revisit:** When `viewport-fit=cover` lands, or the app runs installed: the insets stop being 0 on real phones and the emulated numbers become checkable against a device.

---

## 2026-09-18 — Content pipeline: a refusal publishes nothing; still endings pass; rights the site cannot honour are refused

**Decision:** `scripts/ingest-series.mjs` builds every series in a stage folder (`.ingest-stage/<slug>/`, git-ignored, same disk) and replaces the published folder in one rename only when every episode passes; the manifest is written after. A refusal or a crash leaves published files and manifest byte-identical. An episode is reused only when its master, the gate version (now 3) AND the options it was judged with (`audioStream`, `episodeDurationMs`, `allowBelow1080p`) are unchanged; renditions that passed survive a refusal in the stage, so a fixed delivery resumes them.

Gate rule changes, each with its test changed:

- **Frozen picture.** A still of 1.5 s or more inside the first 5 s is refused (`frozen_opening`). After the opening a still is a shot — a fade to black, an end card, a freeze-frame cliffhanger, a text message on a phone — and is refused only at 10 s or more (`frozen_picture`: the master froze). Before, any 1.5 s still anywhere was refused, which refused standard short-drama endings.
- **Subtitle tail.** The last cue must reach 60% of the episode (was 50%): a file cut off at 55% passed. A tail of more than 20% and more than 5 s without text passes but is named in the report (`quiet_tail`).
- **Shape.** The vertical check uses the picture as shown, after the rotation flag; the size recorded in the manifest is measured on the top rendition, which must be vertical and no taller than the master.
- **Languages.** Tags with a 3-letter primary subtag (`fil`, `yue`, `haw`) are valid. SRT conversion drops only a number that sits right before a timing line, so a line of dialogue "47" survives.
- **Rights.** Territories must be `["WORLD"]` until the serving side can restrict by country; `defaultLocale` and every caption language must be in `rights.languages`. `episodeSlug` must match the site's slug shape and be unique.
- The browser catalog (`catalog/feed.json`, inlined first frames) no longer carries territories, languages, the producer of record or `socialClipsAllowed`; it carries the window end. The per-episode packaging record stays out of the export.

**Why:** The batch-4 review proved on scratch copies that a refused re-delivery overwrote the live episode's HLS, poster and card (a numbering typo made episode 2 play episode 3's video); that fades and end cards were refused; that a landscape picture behind a rotation flag shipped as landscape renditions; that a corrected `audioStream` kept the wrong stem live; that `episodeSlug: ".."` wiped the series folder; that a US-only title was accepted for the worldwide site. On the real stand-in pack the tightened tail rule found the Spanish subtitles of episode 1 one line short.

**Consequences:** `npm run proof:gate` (18 real deliveries, about 2 minutes) runs in CI after the unit tests, on the runner's ffmpeg. Titles licensed per territory cannot be listed until geo-restriction exists. The published series folder is fully generated: a file placed there by hand is removed at the next accepted ingest.

**Revisit:** When media moves to zero-egress storage (the swap becomes a manifest switch); when a licensed title needs territories (geo-restriction at the edge); when real deliveries show a legitimate still longer than 10 s.

---

## 2026-09-17 — Accessibility and polish: keys that respect controls, a real Tune dialog, a player that survives landscape

**Decision:** The feed's global keys never take a key that belongs to someone else: nothing while a dialog is open or inside one, nothing in a text field, nothing with Ctrl, Alt or Meta, and Space on a focused button or link presses that control instead of pausing. The arrow keys still move between episodes from a rail button. The Tune sheet is a modal dialog: focus moves to its first chip, Tab and Shift+Tab wrap inside it, Escape closes it wherever focus is, focus returns to Tune, a visible Close button sits next to its title (`#b3b0a8`, 8.4:1), and the feed behind it is `inert`. A chip says what it did in a notice ("Darker stories are up next", or "Nothing new for that yet" when the catalog had no candidate). Decisions pure in `apps/web/src/features/feed/a11y.ts`.

Other decisions:

- Screen readers: each slide is named "Series, Episode N of M" with `aria-posinset` (`aria-setsize` −1: the feed grows); one polite live region announces an episode change the viewer made, never the episode the page opened on. When the rail button that had focus leaves with its slide, focus moves to the new slide.
- Rail toggles keep one name and say their state with `aria-pressed` ("Mute", "Like", "Follow series", "Captions"); state also changes the glyph (filled heart with a short pop, person with a check, filled captions box), never only the colour. Tune uses a sliders glyph.
- Over a white frame the rail keeps at least 3:1 per icon: a feathered shade behind the rail only (at most 56% black at the edge, fading to nothing 190 px in) and a tight dark edge on each icon. The picture elsewhere is not darkened.
- A phone in landscape (height ≤ 480 px, any width) gets the uncropped 9:16 frame at full height; the padded desktop frame needs at least 481 px of height. Below 240 px of stage width the title, hook and captions shrink.
- Safe-area insets are no longer padded on the body: the picture runs full bleed and each piece of chrome adds its inset once. (Corrected on 2026-09-18: it did so on the top and the bottom only, and the Close button was visible in a portrait frame only. See the entry below.)
- Contrast: the episode position at 90% opacity (4.5:1 over a white frame where the scrim sits under it), the playback error on a 62% shade, neighbouring slides no longer dimmed to 55%. `a11y.test.ts` reads these values from the shipped CSS.
- Any unknown URL answers 404 with the product's page: "This link has moved or expired." and one card that plays the story the feed opens on.

**Why:** Found on e6ccd17 before the change, from the code and phone screenshots of that build: Space on a focused Like paused the episode; with Tune open the arrow keys changed episode behind it and Escape did nothing unless focus was inside the sheet, where nothing put it; the sheet title was `#6f6d67` (3.6:1); a 740×360 phone got a full-width stage showing a slice of the vertical video; over a bright frame like and follow measured 1.1–1.2:1 against the picture (e2e sabotage run with the shade removed); "Unmute, selected"; the 404 page said "This episode is unavailable." for every URL.

**Consequences:**

- e2e checks 29–35 and an extended 6. Each new browser check was proven by a sabotage run: Space always toggling play, the announcement emptied, Tab and Escape handling renamed, the landscape rule disabled and the rail shade removed all turned `npm run e2e:web` red.
- The mute pulse the audit blamed for the lost press feedback (UX-11) was already gone in 3a; check 35 now pins the press scale.
- First-load JavaScript 134 → 136 kB.
- Not done: haptics on like (no product need proven), a one-time label on Tune (AGENTS.md forbids tutorial overlays). VoiceOver, TalkBack and real notched phones are not tested: the live region and the insets are proven in headless Chrome only.

**Revisit:** When the app runs with `viewport-fit=cover` or as an installed app (insets become non-zero); when a screen-reader user tests the feed on a real phone.

---

## 2026-09-17 — The first seconds: captions drawn by the app, one sound cue, a series end that hands off

**Decision:** The browser no longer draws captions. Every text track stays `hidden` and the app renders the active cue as plain text in the overlay column, right above the episode position and the title, on a per-line backdrop (`#faf8f4` on `rgba(8, 8, 10, 0.72)`, 18 px). Captions follow the sound until the viewer chooses: on while muted, off with sound. A tap on the captions button is an explicit choice that wins from then on and is remembered on the device (`project-flow.captions.v1`); a resume point saved with captions on migrates as "on". While the Continue strip covers the title block, the title hides and the captions move above the strip.

The first muted episode that reaches a frame shows one "Tap for sound" pill at the top of the frame, once per browser session. It leaves after 4 s, at the first touch or key, and never shows to a viewer who already turned the sound on. The mute button no longer pulses.

Other decisions, all pure in `apps/web/src/features/feed/storyThread.ts`:

- The episode position reads "Episode 3 / 5" above the title, 12 px at 80% opacity; the total is dropped when unknown or contradictory.
- A pause the viewer can see shows a play glyph; playing again removes it.
- Share: a copied link says "Link copied" (1.8 s) in a status region; a refused clipboard says so and shows the link on one selectable line (6 s); closing the native share sheet copies nothing and sends `share_cancel`. The rail share carries the moment (`t`, 3 s before the position, only past 5 s and not in the last 2 s); a landing with `t` seeks there before the first frame and offers no resume. `share_open` carries `source` (rail, series_end) and `start_seconds`.
- The end of a series: "Series complete" (or "More episodes soon"), share (the story from episode 1, `utm_campaign=series_end`), follow, and the next story: the next other series in the viewer's feed, from its first episode, with poster and hook. It starts only on a tap: no countdown (Prompt D). When the catalog has no other series the card says so. `next_story_offered` and `next_story_open` measure the handoff.
- A returning viewer who finished an episode sees a "Next episode" label that fades after 4 s. It has no button: the episode is already playing (B2-UPNEXT).
- New events: `sound_toggled` (source surface, rail, key), `sound_cue_shown`, `share_cancel`, `share_copy_failed`, `next_story_offered`, `next_story_open`; `caption_toggled` carries `muted`.

**Why:** Measured on master (ad27a70) with phone screenshots at 375×812: a cold open played muted with no captions, and captions turned on were drawn by the browser at the bottom of the video, under the 92% scrim and under the hook, barely visible. Nothing said the first tap turns the sound on; the mute icon pulsed forever. Share by clipboard gave no feedback, and a closed share sheet overwrote the clipboard. The series end said "Episode complete" over "You finished this story" and offered only "Keep watching". "Up next" had a Continue button that only hid the strip.

**Consequences:**

- The caption backdrop keeps 8.0:1 over a pure white frame; `storyThread.test.ts` reads the shipped CSS and fails under 4.5:1 (sabotage run: alpha 0.3 → 1.93:1, red).
- First-load JavaScript 130 → 134 kB.
- The "previously on" recap (OPP-04) is not built: the catalog has a teaser hook per episode, not a summary of what happened, and a teaser shown as a recap would say something the story did not.
- The countdown into another series proposed by the audit (OPP-03, UX-06) is not built: Prompt D and the owner's decisions forbid autoplay into another series.
- A pause never showed the poster, as the audit feared (UX-03): the video element sits above it (z-index 1 over 0) and keeps its frame, as the master screenshot shows. Only the missing pause feedback was real.

**Revisit:** When series manifests carry recaps; when beta data gives `next_story_open / next_story_offered` and share landings with `t`; when real phones show whether the sound cue at the top is seen.

---

## 2026-09-17 — Playback never ends on a poster; resume per series; metrics on the first frame

**Decision:** Every activation of an episode ends playing, at the tap-to-play gate, or in a visible error followed by a move. The player (`apps/web/src/features/player`, decisions pure in `playbackRecovery.ts`):

- retries a failed network load by attaching the source again, after 1 s and 3 s; a 4xx answer (except 408/429) fails at once;
- while the browser is offline it spends no retries: it shows "You're offline" and attaches again on the `online` event;
- a slide whose source died while it was only warming is attached again when it becomes active;
- a watchdog re-attaches an active episode that is not playing and has received no media for 10 s, then fails it. It counts from the last playlist, segment or frame, so a slow phone that keeps receiving data is never cut off;
- a failed episode shows "This episode couldn't play" with Try again for 2.5 s, then the feed moves to the next episode of the series (or the next slide). Only the episode on screen can move the feed. Coming back to a failed episode, or the network returning, tries it again, and cancels the pending skip as Try again does. On the last listed slide the skip waits for the page to grow; with the whole catalog listed the error stays, without "Moving to the next one";
- after two connection failures skipped in a row (retries spent, or the watchdog) with nothing played in between, the next one does not skip: it shows "Connection problem" with Try again. A network that is online but carries no data would otherwise run through the whole feed, one episode every 22 s;
- a retry or a watchdog re-attach is given back once playback has moved 4 s past the point it recovered from, so a later stall in the same episode gets its own recovery, while a source failing again at the same point still runs out.

Sound: every visit starts muted, whatever was saved; a `play()` refused because sound needs a gesture retries muted.

Resume: one point per series (`project-flow.resume.v2`, 20 series at most, the old single key is read and migrated). The home page lands on the most recent one: at the saved position, or on the next episode of the series when the saved one was finished or over 92% watched. A saved position under 2 s is not a landing (most often the viewer swiped the episode away), and it never replaces a finished episode of the same series, so leaving an auto-continued episode in its first seconds still reopens on it as "Up next". A shared link reads only its own series.

Metrics: `first_meaningful_play` and `play` are sent at the first frame on screen (`requestVideoFrameCallback`, else `playing`), never at `play()`. `first_meaningful_play` carries `start_mode` (autoplay, play_gate, resume; resume only when the landing moved the feed), `autoplay_blocked` and `gate_tap_to_play_ms`; `play` carries `swipe_to_play_ms`. Waiting before the first frame is not `buffer_start`. `series_complete` is sent only when the series' last episode ends or is left at 95% watched; an episode whose successor is missing sends `series_unavailable_next`. Content events carry `episode_number` and `episode_count`, and every event's `app_version` is the git commit of the build.

The scroller commits the active slide at `scrollend` (a 150 ms quiet period where the event does not exist), not at the halfway mark mid-gesture.

**Why:** Measured on 8b38a2f with `npm run e2e:web`: an episode that warmed while offline stayed at 0 s forever after the network came back; an episode whose playlist answered 404 showed no message and never moved on (20 s watched); Continue did not seek (0.87 s instead of 5 s); a viewer who had once unmuted got a paused first episode; a viewer who finished episode 2 reopened on episode 1. `time_to_first_play` and swipe latency were taken at `play()`, before any frame, and mixed gate taps with autoplay. Numbers in `docs/standard.md` §3.

**Consequences:**

- While offline an episode waits instead of skipping: skipping would run through the whole feed with nothing able to play.
- The active slide changes when a swipe settles, so on a phone playback starts after the snap animation; `swipe_to_play_ms` counts from the first scroll event of the gesture, so the snap and the settle wait are inside the < 300 ms target.
- A returning viewer whose saved episode is not in the first frame waits for `catalog/feed.json` before the landing episode plays (as a resumed episode already did).
- `scripts/link-hls-engine.mjs` warns instead of failing when no exported page opens on an HLS episode; it still fails when a page carries the warmup script and cannot be linked.
- First-load JavaScript 127 → 130 kB.

**Revisit:** When real phones and Safari's native player are tested (the recovery is proven in headless Chrome only); when beta data shows how often the watchdog fires; when series manifests give a catalog version to put on events (`catalog_version` is not sent yet).

---

## 2026-09-17 — Feed at scale: windowed slides, catalog as static JSON, early hls.js

**Decision:** The feed list holds a page of 40 episodes (`FEED_PAGE_SIZE`), extended from catalog order when the viewer is within 10 of its end; it never holds the whole catalog. Only slides in [index−2, index+2] render poster and player; the rest are empty boxes that keep their scroll-snap point, and non-active posters use `loading="lazy"`. Each page's HTML carries only the target episode and the next one, inlined, so first play never waits for anything else. The catalog reaches the browser as `catalog/feed.json`, written at build time by a `force-static` route handler with only the fields the feed shows, and fetched after the first `playing` event (earlier only when something needs it: a refused autoplay, a playback error, a resumed episode outside the page, an intent chip, the end of the last listed slide; at the latest after 20 s). The recommended re-rank runs on that catalog when the main thread is idle and only replaces slides after the next one. Playback progress lives in a small store read by the progress bar only, and slides are memoized with stable handlers. hls.js is no longer discovered after hydration: an inline script preloads its chunk and the episode playlist (the chunk name is written into the export by `scripts/link-hls-engine.mjs`), and the player module starts the import at load; Safari and browsers without Media Source skip both. The TypeScript catalog in `packages/feed-domain` stays the source until series manifests replace it.

**Why:** Measured on a stress export of 605 episodes (`npm run build:web:stress`): every open requested 605 posters, rendered 605 slides with media, and every HTML file weighed 408 kB (254 MB export, growing as N²). After: 3 posters, at most 5 slides with media, 16–18 kB per page whatever the catalog size, 30 MB export. Numbers in `docs/standard.md` §3.

**Consequences:**

- `npm run build:web:stress` (default 600 extra episodes, output in `apps/web/out-stress`) plus `npm run e2e:web:scale` gate the scale budgets; `scripts/deploy-checks.mjs` refuses a stress catalog.
- The catalog file grows with the catalog: 3.4 MB, 78 kB gzipped, at 3,000 generated episodes. It is off the first-play path.
- This supersedes "loads the light build lazily, only when the first adaptive source mounts" in the HLS entry below.

**Revisit:** When series manifests land: shard the catalog file per series.

---

## 2026-09-16 — Launch gated on content critical mass, English first

**Decision (owner):** Go online only with the quantity and quality of content needed to reach critical mass from day one. The gate, estimated in `docs/content-strategy.md`:

- 45–60 English series across three clusters (billionaire/CEO romance, revenge & comeback, werewolf/supernatural romance);
- at least 10–15 proven performers;
- 12–20 new series signed per month for the first three months;
- rights and technical gates at 100%.

A closed beta with zero ads comes before any public push.

**Why:** Leaders hold libraries of thousands to tens of thousands of series (NetShort 73,655), so volume cannot be matched with zero owner cash; the catalog must instead never run dry for a single viewer. The benchmarks: 25 minutes a day worldwide and 35.7 for ReelShort's US users (Sensor Tower), series of 90–150 minutes. A public push into a thin catalog spends each viewer's first impression.

**Consequences:** Next work is content acquisition, not features:

- outreach to catalog licensors with non-exclusive AVOD rights (Face Production Media, SeaStar Film);
- outreach to independent producers without distribution.

If proven titles require minimum guarantees, we pass on the title. Rejected on 2026-09-18 because it would change the terms: no guarantees, no flat fees, no funding partner for guarantees — the public page promises "no fees, no minimums" on both sides, and there is no owner cash. What stays open is an uplift of the revenue share, or a smaller launch. The gates are never lowered.

**Revisit:** When the first licensors answer with terms, and when beta data replaces the model's assumptions (completion 1 in 3, 9 series a month per engaged viewer).

---

## 2026-09-16 — Adaptive HLS delivery, capped preload, real-browser gate

**Decision:** Episodes ship as HLS: 2-second fMP4 segments, a keyframe every 2 s, and a vertical ladder of 640/960/1280/1920 lines that never upscales. `scripts/package-episode.mjs` produces them from a master and records measured facts in `manifest.json`. The web player uses **hls.js 1.6.19**, pinned exactly: the mature 1.6 line, while 1.7.3 was five days old. It loads the light build lazily, only when the first adaptive source mounts. Safari keeps its native HLS engine. Preload: the active episode buffers up to 30 s, the next one only its first **4 s**, and the previous one no media. `npm run e2e:web` drives the system Chrome through **playwright-core 1.63.0** (no browser download) and fails when that contract breaks. MP4 masters of the stand-in pack moved out of `public/`.

**Why:** With progressive MP4 the next episode is downloaded whole before anyone swipes to it (measured: 2 full files at a cold open). On real episodes of 60–120 s that means megabytes per viewer that nobody watches, and a single quality that stalls on slow networks. Adaptive segments bound both.

**Consequences:**

- hls.js weighs 109 kB gzipped and is fetched only when needed: first-load JS went from 125 to 126 kB.
- Measured on the stand-in pack: the lightest rung costs 0.95–1.02 MB per minute. Local reference run: first playing at 585 ms, swipe to playing at 8 ms.
- A trap found by measuring: hls.js treats `maxBufferLength` as a floor, so the next episode was downloaded whole until `maxMaxBufferLength` was capped. The e2e run now catches it (sabotage run: red on seg_2, seg_3, seg_4).
- A play() interrupted by a new load (AbortError) no longer counts as blocked autoplay, so no play gate flashes while hls.js attaches.

**Revisit:**

- When Safari/iOS is tested on a device (the native path is untested).
- When real series expose rung choices at startup: the first 2 s currently come from the lowest rung, a side effect of hls.js bandwidth testing.
- When `NEXT_EPISODE_WARM_SECONDS` should follow measured swipe behavior.

---

## 2026-09-16 — Distributor only, free forever, Ad Charter, zero owner cash

**Decision (owner):** PROJECT FLOW is a **distributor** of vertical dramas made by others and never produces. Viewing is **free forever**. Revenue comes from series sponsors, shop-the-scene commissions and ad breaks capped by the **Ad Charter**: nothing in the first 10 watched minutes of a session, only at episode boundaries, at most 30 s per break and 180 s per viewing hour, contextual targeting only. Producers get **50%** of market revenue pro-rata to verified watched minutes, non-exclusive, with "second life" catalog titles preferred. The owner puts in **zero personal cash**: free tiers that allow commercial use, pay-per-use only. Video is delivered from zero-egress storage (Cloudflare R2), the site is served as static files (Cloudflare Pages), and events are collected by Workers + D1.

**Why:** The owner wants hundreds of millions of viewers, a free product and no personal spend. Hongguo (304M monthly users, free, ad-funded, revenue shared with 400+ rights partners) and Tubi (>$1.1B FY2025 revenue, 4–6 ad-minutes per hour, profitable since July–September 2025) show that free, ad-funded distribution of third-party content works at scale. The unit economics in `docs/business-model.md` show the model breaks with per-minute delivery pricing (−$0.41 per viewer per month in a rich market) and holds on zero-egress storage (+$0.33 rich, +$0.03 emerging, estimated).

**Consequences:** Coins, paid episodes, unlock mechanics and cash rewards are forbidden forever (AGENTS.md). The Ad Charter values live in code and are pinned by tests. Producer statements need server-side watched-minute counting. The web app must deploy as static files, and share previews must carry absolute URLs. A domain (~€10 a year) and, past the free tiers, Workers Paid ($5 a month) are the first costs; ad revenue arrives about a month later.

**Revisit:** When the soft launch produces measured D1/D7, completion and ad yield. Replace every estimated number in `docs/business-model.md` with a measured one.

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
