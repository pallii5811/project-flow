/**
 * The tools a machine that packages video must have, pinned in one place.
 *
 * The GitHub workflow installs them in its own steps and the Scaleway
 * cloud-init installs them in a shell script; both must install the SAME
 * ffmpeg, or a series packaged on one machine is not the series packaged on
 * the other. test/scaleway.test.ts compares the workflow's env with what is
 * written here, so the two cannot drift.
 *
 * The build is checked against the hash its author published before it is
 * unpacked: a download that changed is not run. BtbN keeps a build of the
 * month for two years; when that stops being true, this is one URL and one
 * hash to change (docs/cloud-ingest.md).
 */

/** The pinned ffmpeg build (linux64, GPL, static). */
export const FFMPEG_URL =
  "https://github.com/BtbN/FFmpeg-Builds/releases/download/autobuild-2026-02-28-12-59/ffmpeg-n8.0.1-66-g27b8d1a017-linux64-gpl-8.0.tar.xz";
/** sha256 of that file, as its author published it. */
export const FFMPEG_SHA256 = "26d2ecd0cefba99f9d1ea92252a3a4f743a58df4c1c3cf9f8bbaaa40b1fca5b0";

/** The pinned yt-dlp build (linux standalone executable). */
export const YT_DLP_URL = "https://github.com/yt-dlp/yt-dlp/releases/download/2026.08.19/yt-dlp";
/** sha256 of that file, as calculated on 2026-09-21. */
export const YT_DLP_SHA256 = "1fa6733c37ea6fb51c99ad8fe785e7b7e5f3246c9b980230329d4fb72ed8d4d6";

/**
 * Node on a fresh Ubuntu machine. Ubuntu 24.04 carries Node 18, which this
 * repository does not run on (package.json asks for 20 or later), so the
 * cloud-init installs the snap Canonical signs instead of adding a third
 * party's apt repository and piping its setup script into a shell.
 */
export const NODE_SNAP_CHANNEL = "22";

/**
 * The commands the cloud-init calls that a plain Ubuntu cloud image may not
 * carry. The script installs whatever is missing with apt, once, and says
 * which. Everything else it uses (bash, mkdir, mount, lsblk, awk, tar,
 * sha256sum, shutdown, snap) is in the image.
 */
export const APT_PACKAGES = Object.freeze({
  curl: "curl",
  xz: "xz-utils",
  "mkfs.ext4": "e2fsprogs",
});
