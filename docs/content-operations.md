# Content operations — from a studio delivery to a live series

One command turns what a producer sends into a series the app can play. Nothing on the way
is typed by hand: durations, poster, share card, caption status and rights all come from the
files themselves, and anything that would reach a viewer as a defect is refused before it is
published.

## 1. What a studio must deliver

Per series, in `content/series/<slug>/`:

| What            | Where                    | Rule                                                                          |
| --------------- | ------------------------ | ----------------------------------------------------------------------------- |
| Masters         | `masters/`               | one file per episode, vertical 9:16, at least 1080×1920, one dialogue audio track |
| Subtitles       | `captions/`              | `.vtt` or `.srt`, one per episode and language                                |
| Delivery file   | `series.json`            | rights, producer of record, episode list, titles and hooks                    |

`series.json`, field by field:

```json
{
  "schemaVersion": 1,
  "seriesId": "series_signal",
  "seriesSlug": "signal-night",
  "title": "Signal Night",
  "status": "published",
  "defaultLocale": "en",
  "producerId": "prod_standin_inhouse",
  "producerOfRecord": "Who is paid, and who answers for the rights",
  "socialClipsAllowed": false,
  "episodeDurationMs": { "min": 30000, "max": 180000 },
  "genres": ["thriller"],
  "tropes": ["mystery"],
  "rights": {
    "territories": ["WORLD"],
    "languages": ["en", "es"],
    "windowStart": "2026-01-01T00:00:00.000Z",
    "windowEnd": null
  },
  "localizedMetadata": { "en": { "title": "…", "hook": "…", "description": "…" } },
  "episodes": [
    {
      "episodeNumber": 1,
      "master": "masters/episode-1.mp4",
      "title": "The Signal",
      "hook": "Two lines at most.",
      "audioStream": 0,
      "captions": [
        { "language": "en", "file": "captions/episode-1.en.vtt", "kind": "captions", "default": true }
      ]
    }
  ]
}
```

- `rights` is F8 of the roadmap and the first item of the curation gate: **territories,
  languages, window start and end, producer of record**. A series without them is refused,
  and the app refuses to list a series outside its window — checked at every build, so a
  window that closes takes the title out at the next publish.
- **Territories must be `["WORLD"]`.** The site is one static export served everywhere; it
  cannot restrict by country yet, so a title licensed for part of the world is refused
  instead of being shown where the licence does not reach (§6).
- **Languages are enforced.** `defaultLocale` (the language the episodes are spoken in) and
  every caption track must be covered by `rights.languages`; `es` covers `es-419`. A caption
  in any other language is refused, not published.
- `episodeSlug` is optional (`episode-N` by default). When set it must be lowercase letters
  and digits joined by single hyphens, and unique in the series: it becomes a folder that
  ingest writes and replaces.
- `socialClipsAllowed` must be `true` or `false`, never left out. Clips do not exist yet;
  the answer is recorded before anything is built, and the default is no.
- `audioStream` is only needed when a master carries several audio streams. Without it the
  gate refuses to guess, because the second stream is usually music and effects.
- `episodeDurationMs` narrows the default range (30 s – 180 s) for a series that is
  deliberately shorter or longer.

## 2. The commands

```bash
npm run ingest                                 # every series under content/series/
node scripts/ingest-series.mjs signal-night    # one series
node scripts/ingest-series.mjs signal-night --force   # re-encode even if unchanged
npm run proof:gate                             # prove the pipeline on deliberately broken deliveries (CI runs it)
node scripts/package-episode.mjs <master> <out-dir>   # one episode, for a quick look
```

**A refused delivery changes nothing that is published.** Everything — renditions,
posters, share cards, captions — is built in a stage folder, `.ingest-stage/<slug>/` at
the repository root (git ignores it; it must be on the same disk as the published folder).
Only when every episode of the series passes does the stage replace
`apps/web/public/content/series/<slug>/` in one rename, and only then is the manifest
written. A refusal, a crash, or an ffmpeg failure halfway through leaves the published
series and its manifest byte for byte as they were — `npm run proof:gate` checks exactly
that on every run.

Ingest is **idempotent and resumable**: an episode is re-encoded only when its master, the
gate version or the options it was judged with (`audioStream`, `episodeDurationMs`,
`allowBelow1080p`) changed — correcting `audioStream` re-encodes with the right stem.
Episodes that passed the gate stay in the stage after a refusal or an interruption, so a
run stopped at episode 40 of 80 costs the remaining 40, and a fixed delivery resumes what
already passed. Posters, share cards and captions are rebuilt every run — they take
milliseconds, and a poster that quietly belongs to an older cut is worse than a wait. A run
that changes nothing reports "unchanged, byte for byte" and touches no file.

What it writes:

```
apps/web/public/content/series/<slug>/hls/episode-N/   master.m3u8, v0…v3, manifest.json
apps/web/public/content/series/<slug>/posters/         episode-N.webp   (feed poster)
apps/web/public/content/series/<slug>/share/           episode-N.jpg    (1200×630 link card)
apps/web/public/content/series/<slug>/captions/        episode-N.<lang>.vtt
packages/feed-domain/src/data/generated/<slug>.ts      the series manifest the app reads
```

The published series folder is **fully generated**: a file placed there by hand is removed
at the next accepted ingest. Each `hls/episode-N/manifest.json` is the packaging record
ingest resumes from (master name and hash, ffmpeg build, gate options); `export:web` keeps
it out of the export.

The catalog (`packages/feed-domain/src/data/catalog.ts`) is built from those manifests. It
contains no episode data any more, only the hostile fixtures the tests need. The browser
receives a smaller catalog (`catalog/feed.json`): territories, licensed languages and the
producer of record never leave the build; the window end does, because the player checks
it at every activation.

## 3. What the gate checks

Every rule is a pure function in `scripts/lib/`, unit-tested in
`test/content-pipeline.test.ts`, and proven to fail on purpose by `npm run proof:gate`.

| Check                | Refused when                                                                | Why a viewer would feel it                       |
| -------------------- | ---------------------------------------------------------------------------- | ------------------------------------------------ |
| Vertical             | aspect outside 0.45–0.65 **as shown**, after the file's rotation flag; the top rendition produced must be vertical too | a horizontal episode breaks the feed it lands in |
| Resolution           | height below 1920 (unless the pack declares `allowBelow1080p`)               | the curation gate                                |
| Frame rate           | outside 23–61 fps                                                            | judder, or a file that is not what it claims     |
| Length               | outside the series range                                                     | a 15-second or six-minute "episode"              |
| Audio present        | no audio stream                                                              | it would ship silent                             |
| Which audio          | several streams and no `audioStream`                                         | the music-and-effects stem instead of the words  |
| Loudness             | packaged audio not within 1 LU of **−16 LUFS**, or true peak above −1 dBFS   | the volume jumps on every swipe                  |
| Black opening        | 0.5 s or more of black inside the first 5 s                                  | the hook is the product                          |
| Frozen opening       | the picture is still for 1.5 s or more inside the first 5 s                  | the hook does not move                           |
| Frozen picture       | after the opening, a still of **10 s or more**. Fades to black, end cards and freeze-frame endings are shorter and pass | the master itself froze |
| Silent opening       | 1.5 s or more of silence inside the first 5 s, or half the episode silent    | no dialogue where the story is                   |
| Duplicate            | the same master already used by another episode                              | the same episode shown twice, paid twice         |
| Episode numbers      | a gap or a repeat in 1…N                                                     | auto-continue stops at the gap                   |
| Episode slugs        | not lowercase letters and digits joined by hyphens, or used twice            | a slug is a folder ingest replaces               |
| Rights               | territories other than `["WORLD"]`; spoken or caption language outside `rights.languages` | shown where, or in a language, the licence does not cover |
| Subtitles exist      | the declared file is missing, empty, or not WebVTT; the language is not a tag (`en`, `pt-BR`, `fil`) | a muted viewer sees nothing |
| Subtitles fit        | cues end more than 1 s past the episode, stop before 60% of it, or cover less than 30% of it | the file belongs to another cut, or was cut off |
| Bytes                | the lowest rung costs more than 5 MB per watched minute                      | data cost on a phone plan                        |
| Playlists            | a playlist names a segment that is not on disk                               | a player that stalls forever                     |

Some things pass but are named in the report under "worth a look": a subtitle file whose
last cue leaves more than 20% of the episode, and more than 5 s, without text
(`quiet_tail`). Short drama usually talks up to the cliffhanger; check it is the full file.

Loudness is a two-pass EBU R128 normalisation (`loudnorm`), and the result is **measured
back from the packaged rendition** with `ebur128`: a filter that was asked to normalise is
not proof that it did.

## 4. When a check fails

The run prints one block per refused episode, named, with every reason:

```
ingest-series: REFUSED signal-night — 1 episode(s) cannot be published
  signal-night episode 3
    - [black_opening] 3.00 s of black picture in the first 5 s (from 0.00 s): no hook
```

The published catalog and every published file keep the version that worked: a bad
delivery never half-replaces a good series (proven on every `npm run proof:gate`). What to
do, by reason:

| Reason                      | What to do                                                                   |
| --------------------------- | ----------------------------------------------------------------------------- |
| `not_vertical`, `below_curation_height` | Ask for the vertical master. Do not crop or upscale here: that is a new cut, and it is the producer's call. A "vertical" file refused as 1280x720 carries a rotation flag that turns it landscape |
| `duration_out_of_range`     | Check the series range in `series.json` before assuming the file is wrong    |
| `no_audio`, `ambiguous_audio` | Ask which stream carries the dialogue, then set `audioStream`               |
| `black_opening`, `frozen_opening` | Usually a slate or a leader left in the file: ask for the master without it |
| `frozen_picture`            | A still of 10 s or more after the opening: the export froze. Ask for a new export |
| `rights.territories`        | The title is licensed for part of the world. It cannot be listed until the site can restrict by country — do not change the territories to `WORLD` without the producer's signature |
| `caption_language_not_licensed`, `defaultLocale` | The licence does not cover that language: drop the track, or get the language added to the licence |
| `bad_episode_slug`, `duplicate_episode_slug` | Fix `episodeSlug` in `series.json`, or remove it to get `episode-N`   |
| `silent_opening`, `mostly_silent` | Often the music-and-effects stem: check `audioStream` first                |
| `loudness_off_target`       | The normalisation could not reach the target (a master that is nearly silent or already clipped). Ask for a cleaner mix |
| `duplicate_master`          | Two episode numbers point at the same file: a delivery mistake, not a re-encode |
| `episode_gap`               | An episode is missing from the delivery. Never renumber to close the gap     |
| `missing_caption_file`, `no_cues` | Ask for the subtitle file. Never publish with captions marked ready and no file |
| `drifts_past_the_end`, `stops_too_early` | The file is for another cut or another frame rate. Ask for the one that matches the delivered master |
| `too_many_bytes`            | The master is unusually noisy; ask for a cleaner grade, or the ladder needs a decision |

Nothing here is fixed by relaxing a rule. A rule is changed only with a new entry in
`docs/decisions.md` and a test that changes with it.

## 5. After a successful ingest

```bash
npm test && npm run build:web && npm run e2e:web
NEXT_PUBLIC_SITE_URL=https://… npm run export:web
```

`export:web` refuses to publish an export whose catalog promises a file that is not there:
every video, poster, share card and caption URL must resolve inside `apps/web/out`.

## 6. Limits, declared

- **No geo-restriction.** The export is served everywhere, so only worldwide licences can be
  published; ingest refuses any other territory list. A title licensed for part of the
  world needs restriction at the edge first.
- The swap is two renames: the published folder steps aside, the stage takes its place. A
  crash exactly between them leaves the old series in `.ingest-stage/<slug>.previous`; the
  next run puts it back before doing anything else. A crash after the swap and before the
  manifest is written leaves new files under the old manifest until the next run, which
  finds everything current and writes the manifest.
- On Windows a folder held open by another program (an editor, a file browser) cannot be
  renamed: ingest retries for a few seconds, then stops with "nothing was changed".
- The share card carries the picture only. Adding the title and "Ep N" needs a font file in
  the repository, which is not there yet; the crawler shows the title and hook as text next
  to the card.
- Media is published inside the static export. A real catalog does not fit there (about 191
  files per 90-second episode, against Cloudflare Pages' 20,000 files per deploy), so
  zero-egress storage with a media base URL is the next step — the manifests already hold
  every URL in one place, which is what makes that change small.
- Posters are WebP only. Browsers older than Safari 14 (2020) would see no poster; the video
  still plays.
- The stand-in pack under `content/series/signal-night/` is generated in this repository by
  `scripts/make-standin-masters.mjs` (colour beds and an audio bed). It is not drama, and it
  is deliberately delivered at five different loudnesses so the normalisation has something
  to correct.
