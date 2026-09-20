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
  deliberately shorter or longer. The compilation splitter uses the same range: it never
  proposes an episode outside it.
- `splitAllowed` and `splitPermission` are needed **only** when the delivery is one long
  file to be cut into episodes (§7). Cutting a work is an alteration of it, so the
  licence has to say it is allowed:

  ```json
  "splitAllowed": true,
  "splitPermission": {
    "grantedOn": "2026-09-19",
    "source": "email from the studio, 19 Sep 2026: 'you may split the compilation'"
  }
  ```

  Without both, `scripts/split-compilation.mjs split` refuses and nothing is cut. The
  date and the source are not decoration: they are where to look when the studio asks
  what was published and under which permission.

## 2. The commands

```bash
npm run ingest                                 # every series under content/series/
node scripts/ingest-series.mjs signal-night    # one series
node scripts/ingest-series.mjs signal-night --force   # re-encode even if unchanged
npm run proof:gate                             # prove the pipeline on deliberately broken deliveries (CI runs it)
node scripts/package-episode.mjs <master> <out-dir>   # one episode, for a quick look
npm run check:ffmpeg                           # does this ffmpeg have what the gate needs?
```

One delivery that is a whole series in one file, or a delivery that must never touch the
owner's connection, goes through §7 and `docs/cloud-ingest.md` instead:

```bash
npm run split -- propose <slug> --input <file>   # where are the episodes? (writes contact sheets)
npm run split -- split <slug> --input <file>     # cut them, on a confirmed cuts file
npm run ingest:cloud -- <slug> --source <file>   # cut + package + upload + manifest, inside a time budget
npm run proof:split                              # a compilation with known boundaries (CI runs it)
npm run proof:cloud                              # a link, a media store, the whole path twice (CI runs it)
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
apps/web/public/content/series/<slug>/hls/episode-N/   manifest.json (packaging record)
apps/web/public/content/series/<slug>/hls/episode-N/<revision>/   master.m3u8, v0…v3
apps/web/public/content/series/<slug>/posters/         episode-N.webp   (feed poster)
apps/web/public/content/series/<slug>/share/           episode-N.jpg    (1200×630 link card)
apps/web/public/content/series/<slug>/captions/        episode-N.<lang>.vtt
packages/feed-domain/src/data/generated/<slug>.ts      the series manifest the app reads
```

The published series folder is **fully generated**: a file placed there by hand is removed
at the next accepted ingest. Each `hls/episode-N/manifest.json` is the packaging record
ingest resumes from (master name and hash, ffmpeg build, gate options, revision);
`export:web` keeps it out of the export.

The renditions sit in a folder named by the hash of their own files (`<revision>`, 12 hex
characters, `encodeRevision` in `scripts/lib/delivery-rules.mjs`). An unchanged encode keeps
its name and its URL; a new cut gets a new folder, and the manifest points the catalog at
it. That is what lets the site tell browsers to keep every playlist and segment for a year
(`_headers`, docs/deploy.md): a URL under `hls/` never changes content. `npm run export:web`
refuses HLS outside a revision folder, and `npm run proof:gate` proves a re-delivered cut
gets a new URL. When video moves to `MEDIA_BASE_URL`, the same rule and the same one-year
header go with it.

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
| `split_not_allowed`, `split_permission_*` | The licence does not say the file may be cut into episodes: get the studio's written OK, then fill `splitAllowed` and `splitPermission` (§1) |
| `cuts_not_confirmed`        | Nobody checked the contact sheets yet (§7)                                   |
| `cuts_other_file`, `cuts_label`, `cuts_count`, `cuts_length` | The cuts file does not match the delivered file, or was half edited: §7 |
| `master_provenance_mismatch` | A master was replaced by hand next to the provenance of a split: cut it again |

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
- Media is published inside the static export **unless the media store is configured**
  (§8): a real catalog does not fit in the export (about 191 files per 90-second episode,
  against Cloudflare Pages' 20,000 files per deploy).
- Posters are WebP only. Browsers older than Safari 14 (2020) would see no poster; the video
  still plays.
- The stand-in pack under `content/series/signal-night/` is generated in this repository by
  `scripts/make-standin-masters.mjs` (colour beds and an audio bed). It is not drama, and it
  is deliberately delivered at five different loudnesses so the normalisation has something
  to correct.

## 7. One file that is a whole series

Some studios deliver a mini-series as one 90-minute file: dozens of one-to-three-minute
episodes glued together. `scripts/split-compilation.mjs` proposes where the episodes
begin; **a person decides**; then it cuts.

```bash
npm run split -- propose night-shift --input delivery.mp4      # nothing is cut
# look at .split-work/night-shift/contact/*.jpg and report.txt
# fix any frame, set "confirmed": true, commit as content/series/night-shift/cuts.json
npm run split -- split night-shift --input delivery.mp4        # writes masters/episode-N.mp4
npm run ingest -- night-shift
```

What the proposal is made of, and what each piece is worth:

| Evidence                  | How exact          | How much it means                                                                 |
| ------------------------- | ------------------ | ---------------------------------------------------------------------------------- |
| black between episodes    | to the frame       | strong: a compilation puts black, or a fade to black, between episodes            |
| a pause in the sound      | to about a second  | strong, but it only says "around here": the frame comes from the picture cut in it |
| a picture cut (`scdet`)   | to the frame       | **weak alone**: drama cuts between shots every few seconds, and an episode boundary looks exactly the same |
| the brightness curve      | —                  | tells a fade to black from a cut to black; it describes black, it does not find it |
| how long an episode may be | —                 | the cuts are chosen together, as the set that best explains the file with episodes of a regular length inside `episodeDurationMs` |

Each cut carries its own verdict, and the report puts the ones to look at first:

- **HIGH** — black of two frames or more, a fade into black, or a long silence around a
  picture cut, with nothing else nearby that looks as good;
- **LOW** — a picture cut, or a rival within five seconds. It may well be right; a shot
  change looks the same, so a person must say;
- **NONE** — nothing visible or audible (episodes that dissolve into each other): the cut
  sits where the lengths want it, which is a guess.

Measured on a compilation built here with known boundaries (`npm run proof:split`): the
fade to black, the five frames of black and the silence are found **to the frame**; the two
hard cuts are found to the frame as well but marked LOW, naming the shot change that looks
like them; the cross-dissolve is marked NONE and lands 8 frames from the middle of the
dissolve, for a person to correct.

Other rules of the splitter:

- **`frame` is the truth, `at` is its label.** A file where they disagree is refused
  (`cuts_label`): it is what a half-finished hand edit looks like.
- **The cuts belong to one file.** The delivered file's sha256 is in the cuts file; another
  file behind the same link is refused (`cuts_other_file`) before anything is encoded.
- **Episodes are contiguous**: what is between two episodes (black, a logo) stays at the end
  of the first one. `startFrame` and `endFrame` drop a leader or a trailer.
- **Never a stream copy.** Cutting on keyframes only would move every boundary by up to a
  GOP; each episode is re-encoded from the exact frame (CRF 16, `veryfast`, FLAC audio) into
  `masters/`, and the frame count of what was written is checked against the cuts.
- **A horizontal file with a vertical picture in the middle** (a 9:16 cut exported into a
  16:9 frame) is reported, never fixed silently: the report says so and offers a crop, which
  has to be turned on by hand (`"crop": { …, "apply": true }`). The result is about 608×1080
  — under the curation height, so the series also has to declare `allowBelow1080p`. Two
  deliberate steps, because the right fix is to ask the studio for the vertical master.
- Next to each master the splitter writes `<master>.source.json`: which frames of which file
  it is. That is the episode's identity — so the same episode cut again, on another machine
  where the re-encode is not byte-identical, is still recognised as published.
- Not done: a single subtitle file for the whole compilation is not cut into per-episode
  files. Subtitles are delivered per episode.

## 8. Media on a store instead of in the export

When `MEDIA_BASE_URL` and the R2 keys are set (`docs/cloud-ingest.md`), ingest publishes
nothing under `apps/web/public`: every episode that passes the gate is uploaded to the
bucket as soon as it is packaged, and the manifest carries absolute URLs on that host.
With none of them set, everything works exactly as in §2.

- **Everything on the store is named by its content**: renditions in their revision folder
  (as in the export), posters, share cards and subtitles with the first 12 characters of
  their own sha256 in the name. So no object ever changes, every one is cached for a year,
  an upload is skipped when the object is already there, and a re-delivery switches the
  whole series in one deploy — a recut never shows new subtitles over old video.
- **The master playlist of an encode is uploaded last.** Its presence therefore proves the
  whole folder is there, which is what lets a later run know, with one question, that an
  episode is published.
- **The record of what is published lives in `.ingest-records/`** (git-ignored; the workflow
  keeps it in the Actions cache). Lose it and nothing breaks: the next run re-encodes and
  finds the objects already on the store.
- `--only 3,5-7` packages part of a series and ends "INCOMPLETE" (exit 3) without writing a
  manifest, so a series longer than one runner job is published over several runs. `--status`
  prints what is already on the store. `--free-disk` deletes each episode's local files once
  they are up.
- **Nothing is ever deleted from the store.** A Pages build takes minutes to go live, and
  deleting what the live manifest still names would break playback for whoever is watching.
- `npm run export:web` refuses a catalog whose media is on a host that is not
  `MEDIA_BASE_URL` for that build — the security policy would block it and nothing would
  play.
