# Signal Night — cleared vertical stand-in pack

Original assets generated in this repository with ffmpeg (moving colour beds and an audio
bed). Not third-party drama. Not licensed IP. Never present it as a commercial title.

Purpose: prove the whole path studio delivery → quality gate → adaptive playback → WebVTT →
feed → continue, before licensed series arrive.

| What                            | Where                                                             |
| ------------------------------- | ------------------------------------------------------------------ |
| Delivery (rights, episode list) | `content/series/signal-night/series.json`                         |
| Masters (720×1280, 10 s)        | `content/series/signal-night/masters/` — not published            |
| Subtitles as delivered          | `content/series/signal-night/captions/`                           |
| Adaptive HLS, posters, cards    | `apps/web/public/content/series/signal-night/`                    |
| Series manifest the app reads   | `packages/feed-domain/src/data/generated/signal-night.ts`         |

Two things about this pack are deliberate, because the gate is measured on them:

- the picture is bright and moving, so a black or frozen opening is a real failure and not
  the normal case;
- the five episodes are delivered at five different loudnesses (−27.7 to −44.6 LUFS), the
  way five studios would deliver them, so the normalisation has something to correct. All
  five are published at −16.0 LUFS.

## Commands

```bash
node scripts/make-standin-masters.mjs   # regenerate the masters (video + audio bed)
node scripts/ingest-series.mjs signal-night
```

Ingest re-encodes only what changed. The masters are below the 1080×1920 curation gate on
purpose, which is why `series.json` declares `allowBelow1080p` and a 8–15 s episode range; a
licensed series declares neither. Everything else — the gate, what to do when it refuses,
and what a studio must send — is in [`docs/content-operations.md`](../../../docs/content-operations.md).

A licensed series is packaged the same way, and its HLS goes to zero-egress storage
(Cloudflare R2), not to git.
