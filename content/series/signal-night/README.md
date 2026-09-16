# Signal Night — cleared vertical stand-in pack

Original assets generated in this repository with ffmpeg (color beds and simple overlays).
Not third-party drama. Not licensed IP. Never present it as a commercial title.

Purpose: prove the whole path real asset → validated content → feed → adaptive playback →
WebVTT → continue, before licensed series arrive.

| What                       | Where                                                         |
| -------------------------- | ------------------------------------------------------------- |
| Masters (720×1280, 10 s)   | `content/series/signal-night/masters/` — not published        |
| Adaptive HLS, posters, VTT | `apps/web/public/content/series/signal-night/`                |
| Catalog entries            | `packages/feed-domain/src/data/catalog.ts` (`LAUNCH_CATALOG`) |

## Re-packaging

The masters are below the 1080×1920 curation gate on purpose (stand-ins), hence the flag:

```bash
node scripts/package-episode.mjs content/series/signal-night/masters/episode-1.mp4 apps/web/public/content/series/signal-night/hls/episode-1 --allow-below-1080p
```

Each output folder carries a `manifest.json` with the measured duration, renditions, bytes
and real bitrates. A licensed series is packaged the same way without the flag, and its HLS
goes to zero-egress storage (Cloudflare R2), not to git.
