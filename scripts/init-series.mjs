import { mkdirSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";

function extractVideoId(input) {
  const match = input.match(/(?:youtu\.be\/|v=|\/v\/|embed\/|watch\?v=|\&v=)([^#\&\?\s]{11})/);
  if (match) return match[1];
  if (/^[a-zA-Z0-9_-]{11}$/.test(input.trim())) return input.trim();
  return null;
}

async function getTitle(url, videoId) {
  try {
    const oembedUrl = `https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${videoId}&format=json`;
    const res = await fetch(oembedUrl, { signal: AbortSignal.timeout(5000) });
    if (res.ok) {
      const data = await res.json();
      if (data.title && typeof data.title === "string") {
        return data.title.trim();
      }
    }
  } catch {
    // fallback below
  }
  return `YouTube Drama ${videoId}`;
}

async function main() {
  const input = process.argv[2];
  if (!input) {
    console.error("usage: node scripts/init-series.mjs <youtube-url-or-id>");
    process.exit(1);
  }

  const videoId = extractVideoId(input);
  if (!videoId) {
    console.error(`could not extract video ID from: ${input}`);
    process.exit(1);
  }

  const slug = `yt-${videoId}`;
  const title = await getTitle(input, videoId);

  const dir = join(process.cwd(), "content", "series", slug);
  mkdirSync(dir, { recursive: true });

  const seriesPath = join(dir, "series.json");
  if (!existsSync(seriesPath)) {
    const data = {
      schemaVersion: 1,
      seriesId: `series_${slug}`,
      seriesSlug: slug,
      title: title,
      status: "published",
      defaultLocale: "en",
      producerId: "prod_standin_inhouse",
      producerOfRecord: "Automated YouTube Ingest",
      socialClipsAllowed: false,
      episodeDurationMs: { min: 15000, max: 240000 },
      genres: [],
      tropes: [],
      rights: {
        territories: ["WORLD"],
        languages: ["en"],
        windowStart: new Date().toISOString(),
        windowEnd: null,
      },
      splitAllowed: true,
      splitPermission: {
        grantedOn: new Date().toISOString().slice(0, 10),
        source: "Automated end-to-end pipeline confirmation",
      },
      episodes: [],
    };

    writeFileSync(seriesPath, JSON.stringify(data, null, 2) + "\n", "utf8");
  }

  // Print slug as the only stdout line so shell scripts can capture it
  process.stdout.write(slug);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
