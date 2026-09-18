/**
 * Regenerates the cleared stand-in masters of `signal-night` with ffmpeg.
 *
 *   node scripts/make-standin-masters.mjs [output-dir]
 *
 * These are NOT drama and never licensed IP: moving colour beds with an audio
 * bed, generated here so the whole path (gate → packaging → feed → playback)
 * can be proven on files that behave like a studio delivery.
 *
 * Two things are deliberate, because the quality gate is measured on them:
 *
 *   - the picture is bright and moving, so a black or frozen opening is a
 *     real failure and not the normal case (docs/content-operations.md);
 *   - every episode is delivered at a DIFFERENT loudness (−3 dB to −20 dB of
 *     the same tone), the way five studios would deliver it, so the loudness
 *     normalisation in scripts/package-episode.mjs has something to correct.
 *
 * Until 2026-09-18 the masters were in the repository without the script that
 * made them: what is not in git does not exist the day it is needed.
 */
import { spawnSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const outputDir = resolve(
  repoRoot,
  process.argv[2] ?? "content/series/signal-night/masters",
);

const SECONDS = 10;
const FPS = 25;
const WIDTH = 720;
const HEIGHT = 1280;

/** One row per episode: palette, movement, tone and delivered loudness. */
const EPISODES = [
  { seed: 11, colors: ["0x123f7a", "0xe8b44a", "0x8c2f39", "0x2f6f6b"], hz: 220, gainDb: -3 },
  { seed: 27, colors: ["0x1f6f4a", "0xf0d264", "0x2b3a67", "0xd06b3c"], hz: 180, gainDb: -12 },
  { seed: 43, colors: ["0x6b2f6f", "0xe6a35c", "0x1d4e89", "0x3fa796"], hz: 300, gainDb: -20 },
  { seed: 58, colors: ["0x8a3b2f", "0xf2c14e", "0x2f4858", "0x4e937a"], hz: 260, gainDb: -8 },
  { seed: 71, colors: ["0x24506e", "0xefb08a", "0x7a4b8b", "0x58a55c"], hz: 200, gainDb: -16 },
];

function run(command, args) {
  const result = spawnSync(command, args, { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });
  if (result.error) {
    console.error(`make-standin-masters: ${command} could not start: ${result.error.message}`);
    process.exit(1);
  }
  if (result.status !== 0) {
    console.error(`make-standin-masters: ${command} exited with ${result.status}`);
    console.error((result.stderr ?? "").slice(-2000));
    process.exit(1);
  }
  return result.stdout;
}

mkdirSync(outputDir, { recursive: true });

for (let index = 0; index < EPISODES.length; index += 1) {
  const episode = EPISODES[index];
  const number = index + 1;
  const path = join(outputDir, `episode-${number}.mp4`);
  const gradient =
    `gradients=s=${WIDTH}x${HEIGHT}:` +
    episode.colors.map((color, i) => `c${i}=${color}`).join(":") +
    `:nb_colors=${episode.colors.length}:x0=120:y0=200:x1=600:y1=1100:` +
    `seed=${episode.seed}:speed=0.04:d=${SECONDS}:r=${FPS}`;
  const box =
    `drawbox=x='${90 + index * 20}+70*sin(t+${index})':` +
    `y='280+90*cos(t*0.7+${index})':w=250:h=250:color=white@0.35:t=fill`;

  run("ffmpeg", [
    "-hide_banner",
    "-loglevel",
    "error",
    "-y",
    "-f",
    "lavfi",
    "-i",
    gradient,
    "-f",
    "lavfi",
    "-i",
    `sine=frequency=${episode.hz}:duration=${SECONDS}:sample_rate=48000`,
    "-filter_complex",
    `[0:v]${box},vignette=PI/5[v];[1:a]tremolo=f=5:d=0.6,volume=${episode.gainDb}dB[a]`,
    "-map",
    "[v]",
    "-map",
    "[a]",
    "-c:v",
    "libx264",
    "-preset",
    "slow",
    "-crf",
    "23",
    "-pix_fmt",
    "yuv420p",
    "-c:a",
    "aac",
    "-b:a",
    "128k",
    "-ac",
    "2",
    "-t",
    String(SECONDS),
    path,
  ]);
  console.error(`make-standin-masters: episode-${number}.mp4 (tone ${episode.hz} Hz at ${episode.gainDb} dB)`);
}

console.error(`make-standin-masters: ${EPISODES.length} masters in ${outputDir}`);
