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
- `socialClipsAllowed` must be `true` or `false`, never left out. Clips do not exist yet;
  the answer is recorded before anything is built, and the default is no.
- `audioStream` is only needed when a master carries several audio streams. Without it the
  gate refuses to guess, because the second stream is usually music and effects.
- `episodeDurationMs` narrows the default range (30 s – 180 s) for a series that is
  deliberately shorter or longer.

## 2. The commands

```bash
node scripts/ingest-series.mjs                 # every series under content/series/
node scripts/ingest-series.mjs signal-night    # one series
node scripts/ingest-series.mjs signal-night --force   # re-encode even if unchanged
node scripts/gate-proof.mjs                    # prove the gate on deliberately broken deliveries
node scripts/package-episode.mjs <master> <out-dir>   # one episode, for a quick look
```

Ingest is **idempotent and resumable**: an episode whose master and gate version have not
changed is not re-encoded, so a run interrupted at episode 40 of 80 costs the remaining 40.
Posters, share cards and captions are rebuilt every run — they take milliseconds, and a
poster that quietly belongs to an older cut is worse than a wait.

What it writes:

```
apps/web/public/content/series/<slug>/hls/episode-N/   master.m3u8, v0…v3, manifest.json
apps/web/public/content/series/<slug>/posters/         episode-N.webp   (feed poster)
apps/web/public/content/series/<slug>/share/           episode-N.jpg    (1200×630 link card)
apps/web/public/content/series/<slug>/captions/        episode-N.<lang>.vtt
packages/feed-domain/src/data/generated/<slug>.ts      the series manifest the app reads
```

The catalog (`packages/feed-domain/src/data/catalog.ts`) is built from those manifests. It
contains no episode data any more, only the hostile fixtures the tests need.

## 3. What the gate checks

Every rule is a pure function in `scripts/lib/`, unit-tested in
`test/content-pipeline.test.ts`, and proven to fail on purpose by `node scripts/gate-proof.mjs`.

| Check                | Refused when                                                                | Why a viewer would feel it                       |
| -------------------- | ---------------------------------------------------------------------------- | ------------------------------------------------ |
| Vertical             | aspect outside 0.45–0.65                                                    | a horizontal episode breaks the feed it lands in |
| Resolution           | height below 1920 (unless the pack declares `allowBelow1080p`)               | the curation gate                                |
| Frame rate           | outside 23–61 fps                                                            | judder, or a file that is not what it claims     |
| Length               | outside the series range                                                     | a 15-second or six-minute "episode"              |
| Audio present        | no audio stream                                                              | it would ship silent                             |
| Which audio          | several streams and no `audioStream`                                         | the music-and-effects stem instead of the words  |
| Loudness             | packaged audio not within 1 LU of **−16 LUFS**, or true peak above −1 dBFS   | the volume jumps on every swipe                  |
| Black opening        | 0.5 s or more of black inside the first 5 s                                  | the hook is the product                          |
| Frozen picture       | the picture is still for 1.5 s or more                                       | a frozen master looks like a broken player       |
| Silent opening       | 1.5 s or more of silence inside the first 5 s, or half the episode silent    | no dialogue where the story is                   |
| Duplicate            | the same master already used by another episode                              | the same episode shown twice, paid twice         |
| Episode numbers      | a gap or a repeat in 1…N                                                     | auto-continue stops at the gap                   |
| Subtitles exist      | the declared file is missing, empty, or not WebVTT                           | a muted viewer sees nothing                      |
| Subtitles fit        | cues end more than 1 s past the episode, stop before half of it, or cover less than 30% of it | the file belongs to another cut     |
| Bytes                | the lowest rung costs more than 5 MB per watched minute                      | data cost on a phone plan                        |
| Playlists            | a playlist names a segment that is not on disk                               | a player that stalls forever                     |

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

The published catalog keeps the version that worked: a bad delivery never half-replaces a
good series. What to do, by reason:

| Reason                      | What to do                                                                   |
| --------------------------- | ----------------------------------------------------------------------------- |
| `not_vertical`, `below_curation_height` | Ask for the vertical master. Do not crop or upscale here: that is a new cut, and it is the producer's call |
| `duration_out_of_range`     | Check the series range in `series.json` before assuming the file is wrong    |
| `no_audio`, `ambiguous_audio` | Ask which stream carries the dialogue, then set `audioStream`               |
| `black_opening`, `frozen_picture` | Usually a slate or a leader left in the file: ask for the master without it |
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
