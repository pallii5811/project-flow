import { mkdirSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const [slug, ...titleParts] = process.argv.slice(2);
const title = titleParts.join(" ").trim() || slug;

if (!slug) {
  console.error("usage: node scripts/init-series.mjs <slug> [title]");
  process.exit(1);
}

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
  console.log(`Initialized series: ${seriesPath}`);
} else {
  console.log(`Series already exists: ${seriesPath}`);
}
