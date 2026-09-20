/**
 * What a Scaleway run WOULD be, before anything is created: the machine, the
 * disk, the tags, the time it may take, and what it costs in euro. Pure — no
 * network, no clock of its own — so every number here is checked in
 * test/scaleway.test.ts and printed by `--dry-run` before a single euro is
 * committed (docs/cloud-ingest.md).
 *
 * Two rules shape this file:
 *
 *   1. **A price that is not known is `null`, never 0.** An unknown machine
 *      type has no price here, so the orchestrator refuses to create it
 *      instead of quietly spending an unknown amount.
 *   2. **Nothing the owner typed ever becomes a shell word.** The slug, the
 *      links and the secrets travel as environment lines on the run's stdin;
 *      the command sent over ssh is one fixed path with no arguments.
 */
import { APT_PACKAGES, FFMPEG_SHA256, FFMPEG_URL, NODE_SNAP_CHANNEL } from "./pinned-tools.mjs";

/** The tag every machine and every volume of this project carries. The sweeper looks for it. */
export const RUN_TAG = "cliffies-ingest";

/**
 * Hourly prices, as the owner read them in his own Scaleway console.
 * A type that is not here has no price, and a run on it is refused unless the
 * caller passes --price-per-hour and takes responsibility for the number.
 */
export const INSTANCE_PRICES = Object.freeze({
  "STANDARD2-A16C-64G": Object.freeze({ eurPerHour: 0.5039, vcpu: 16, ramGb: 64 }),
  "STANDARD2-A24C-96G": Object.freeze({ eurPerHour: 0.6551, vcpu: 24, ramGb: 96 }),
});
export const PRICES_VERIFIED_ON = "2026-09-20";
export const PRICES_SOURCE = "the owner's Scaleway console (organization veezco, project cliffies), read on 2026-09-20";

/**
 * The volume is NOT priced here: nobody has read that figure off the console,
 * and an invented one would be a number people trust. A 60 GB volume for two
 * hours is small next to the machine; the run says so instead of adding zero.
 */
export const VOLUME_EUR_PER_GB_HOUR = null;

/** The default machine, and the faster one the owner may switch to. */
export const DEFAULT_TYPE = "STANDARD2-A16C-64G";
export const DEFAULT_ZONE = "fr-par-1";
export const DEFAULT_IMAGE = "ubuntu_noble";
/**
 * Scaleway's newer machines take Block Storage volumes (sbs_volume); the older
 * ones take local SSD (b_ssd). Which one a type accepts can only be learned
 * from the real API, so it is a flag with a default and a clear refusal.
 */
export const DEFAULT_VOLUME_TYPE = "sbs_volume";

/**
 * Measured on the owner's machine, 2026-09-20 (docs/standard.md §3): one
 * minute of 1080x1920 video costs about 3.5 minutes of TWO cores — 2.8 for
 * packaging the ladder, 0.7 for cutting the episode out of the compilation.
 */
export const CORE_MINUTES_PER_VIDEO_MINUTE = 7;
/**
 * How much of an added core is really gained. x264 does not scale linearly,
 * and this has NOT been measured on 16 cores: it is a deliberate discount, and
 * the first real run replaces the estimate with a figure.
 */
export const ASSUMED_CORE_EFFICIENCY = 0.6;
/** Boot, apt, the snap, ffmpeg, and downloading the delivery: charged whatever the series is. */
export const FIXED_MINUTES = 12;
/** What the orchestrator keeps for itself at the end: powering off and deleting. */
export const TEARDOWN_MINUTES = 8;

/** The wall-clock budget of a run, in minutes, when nobody says otherwise (6 hours). */
export const DEFAULT_BUDGET_MINUTES = 360;
/** A machine older than this with the project's tag is a leftover, not a run. */
export const DEFAULT_SWEEP_MINUTES = 60;

/** @returns {{ eurPerHour: number, vcpu: number, ramGb: number } | null} — null when the type is unknown. */
export function priceOf(type) {
  return INSTANCE_PRICES[type] ?? null;
}

/** Scaleway bills a running machine by the minute. At least one minute is charged. */
export function billedMinutes(millis) {
  if (!Number.isFinite(millis) || millis < 0) return null;
  return Math.max(1, Math.ceil(millis / 60_000));
}

/** What `minutes` on a machine at `eurPerHour` costs. Null in, null out — never 0. */
export function costEur(minutes, eurPerHour) {
  if (!Number.isFinite(minutes) || !Number.isFinite(eurPerHour)) return null;
  return (minutes / 60) * eurPerHour;
}

/** "1 h 18 min", "47 min" — how long a person reads it. */
export function humanMinutes(minutes) {
  if (!Number.isFinite(minutes)) return "unknown";
  const whole = Math.round(minutes);
  if (whole < 60) return `${whole} min`;
  return `${Math.floor(whole / 60)} h ${String(whole % 60).padStart(2, "0")} min`;
}

export function eur(value) {
  return value === null || value === undefined ? "unknown" : `EUR ${value.toFixed(2)}`;
}

/**
 * How long a delivery should take on a machine of this many cores. An
 * ESTIMATE, and it says so wherever it is printed: the measurement behind it
 * was taken on two cores of another processor.
 */
export function estimateMinutes({ videoMinutes, vcpu }) {
  if (!Number.isFinite(videoMinutes) || videoMinutes <= 0 || !Number.isFinite(vcpu) || vcpu <= 0) return null;
  const work = (videoMinutes * CORE_MINUTES_PER_VIDEO_MINUTE) / (vcpu * ASSUMED_CORE_EFFICIENCY);
  return Math.ceil(work + FIXED_MINUTES);
}

/**
 * The extra disk, from the size of the delivery: the file itself, the masters
 * cut from it (scripts/lib/split-rules.mjs counts 1.8x), the packaged ladder,
 * and room for the repository and the tools. Rounded up to ten, never below
 * fifty — a volume costs little and a run that dies for want of disk costs a
 * whole machine-hour.
 */
export function volumeGbFor({ deliveryGb }) {
  const delivery = Number.isFinite(deliveryGb) && deliveryGb > 0 ? deliveryGb : 5;
  const need = delivery * 4 + 20;
  return Math.min(600, Math.max(50, Math.ceil(need / 10) * 10));
}

/** A name Scaleway accepts: lowercase, digits and dashes, at most 63 characters. */
export function instanceName(slug, runId) {
  const clean = (value) =>
    String(value ?? "")
      .toLowerCase()
      .replace(/[^a-z0-9-]+/g, "-")
      .replace(/^-+|-+$/g, "");
  const name = `cliffies-${clean(slug) || "run"}-${clean(runId) || "0"}`;
  return name.slice(0, 63).replace(/-+$/, "");
}

/**
 * Everything about a run, decided before anything exists. The caller prints
 * this (--dry-run) or builds it (a real run); both read the same object, so
 * what the owner is shown is what is created.
 */
export function planRun({
  slug,
  mode = "publish",
  runId,
  type = DEFAULT_TYPE,
  zone = DEFAULT_ZONE,
  image = DEFAULT_IMAGE,
  volumeType = DEFAULT_VOLUME_TYPE,
  deliveryGb = null,
  videoMinutes = null,
  budgetMinutes = DEFAULT_BUDGET_MINUTES,
  priceEurPerHour = null,
}) {
  const known = priceOf(type);
  const hourly = Number.isFinite(priceEurPerHour) ? priceEurPerHour : (known?.eurPerHour ?? null);
  const vcpu = known?.vcpu ?? null;
  const estimated = vcpu === null ? null : estimateMinutes({ videoMinutes, vcpu });
  const name = instanceName(slug, runId);
  return {
    slug,
    mode,
    runId,
    name,
    type,
    zone,
    image,
    volumeType,
    volumeName: `${name}-work`,
    volumeGb: volumeGbFor({ deliveryGb }),
    tags: [RUN_TAG, `slug:${slug}`, `run:${runId}`],
    budgetMinutes,
    /**
     * What the ingest itself is allowed: the wall-clock budget, less what the
     * machine spends before it starts and what the orchestrator keeps to
     * destroy it. cloud-ingest stops cleanly inside its own budget, so the
     * run ends by finishing an episode instead of being cut off mid-encode.
     */
    remoteBudgetMinutes: Math.max(10, budgetMinutes - FIXED_MINUTES - TEARDOWN_MINUTES),
    price: {
      eurPerHour: hourly,
      known: known !== null,
      given: Number.isFinite(priceEurPerHour),
      vcpu,
      ramGb: known?.ramGb ?? null,
      verifiedOn: PRICES_VERIFIED_ON,
      source: PRICES_SOURCE,
    },
    estimate: {
      videoMinutes,
      minutes: estimated,
      eur: costEur(estimated, hourly),
      /** The budget is the most this run can ever cost, and it is a real number. */
      worstCaseEur: costEur(budgetMinutes, hourly),
    },
  };
}

/** The plan, in the words the owner reads before he says yes. */
export function planLines(plan) {
  const price = plan.price.eurPerHour;
  const lines = [
    `machine     ${plan.type}` +
      (plan.price.vcpu ? ` (${plan.price.vcpu} vCPU, ${plan.price.ramGb} GB)` : "") +
      (price === null ? "  — NO PRICE KNOWN" : `  ${eur(price)}/hour`),
    `zone        ${plan.zone}`,
    `image       ${plan.image}`,
    `name        ${plan.name}`,
    `tags        ${plan.tags.join(", ")}`,
    `extra disk  ${plan.volumeGb} GB (${plan.volumeType}), deleted with the machine`,
    `budget      ${humanMinutes(plan.budgetMinutes)} of wall clock, of which ${humanMinutes(plan.remoteBudgetMinutes)} for the ingest itself`,
  ];
  if (plan.estimate.minutes !== null) {
    lines.push(
      `estimate    ${humanMinutes(plan.estimate.minutes)} for ${plan.estimate.videoMinutes} minutes of video, about ${eur(plan.estimate.eur)} — AN ESTIMATE, not a measurement`,
    );
  } else {
    lines.push(
      "estimate    unknown: say --video-minutes <n> for one, and the run will print what it really cost",
    );
  }
  lines.push(`most it can cost  ${eur(plan.estimate.worstCaseEur)} (the whole budget, if it runs to the wall)`);
  lines.push(`price read on     ${plan.price.verifiedOn} — ${plan.price.source}`);
  lines.push("volume price      not known here, and not invented: it is small next to the machine");
  return lines;
}

/** The single line every run ends with, whatever happened to it. */
export function costLine({ minutes, eurPerHour, type, estimated = false }) {
  const spent = costEur(minutes, eurPerHour);
  return (
    `cost: ${humanMinutes(minutes)} on ${type} at ${eur(eurPerHour)}/hour = ${eur(spent)}` +
    (estimated ? " (estimated)" : " (measured wall clock, compute only)") +
    ` — price read on ${PRICES_VERIFIED_ON}`
  );
}

/**
 * The environment the run needs, as the lines that go down its stdin. The
 * values never touch a shell word, never reach a file on that machine, and
 * never come back in a log: `cliffies-run` reads them, exports them and stops
 * reading at the sentinel.
 */
export const ENV_SENTINEL = "END-OF-ENV";

export function envLines(values) {
  const lines = [];
  for (const [name, value] of Object.entries(values)) {
    if (value === undefined || value === null || value === "") continue;
    if (!/^[A-Z][A-Z0-9_]*$/.test(name)) throw new Error(`not an environment name: ${name}`);
    const text = String(value);
    // A newline would end the line and let the rest be read as another
    // variable. Nothing legitimate here carries one.
    if (/[\r\n]/.test(text)) throw new Error(`${name} carries a line break; it cannot be sent this way`);
    lines.push(`${name}=${text}`);
  }
  lines.push(ENV_SENTINEL);
  return lines;
}

/** Where the run lives on the machine. Fixed paths: nothing here is built from input. */
export const REMOTE = Object.freeze({
  work: "/work",
  repo: "/work/repo",
  delivery: "/work/delivery",
  out: "/work/out",
  run: "/usr/local/bin/cliffies-run",
  collect: "/usr/local/bin/cliffies-collect",
  install: "/usr/local/bin/cliffies-install",
  ready: "/run/cliffies-ready",
  failed: "/run/cliffies-failed",
  log: "/var/log/cliffies-install.log",
  user: "cliffies",
});

/** What comes back from a finished run, and where each part belongs here. */
export const COLLECTED = Object.freeze([
  { remote: "repo/packages/feed-domain/src/data/generated", local: "packages/feed-domain/src/data/generated" },
  { remote: "repo/.ingest-records", local: ".ingest-records" },
  { remote: "out", local: ".split-work" },
]);

/**
 * The cloud-init the machine boots with. It carries the public half of a key
 * made for this one run, the pinned tools, and a shutdown timer — and NOTHING
 * else: no R2 key, no Scaleway key, no GitHub token, nothing that would
 * survive the machine or show up in a console.
 *
 * The shutdown is the dead man's switch: if whoever started this machine is
 * killed — the laptop closes, the Actions job is cancelled, the orchestrator
 * crashes — the machine powers itself off by itself. The sweeper then deletes
 * it. Neither alone is enough; both together mean a crash costs minutes, not
 * a month.
 */
export function cloudInit({ publicKey, shutdownMinutes, ffmpegUrl = FFMPEG_URL, ffmpegSha256 = FFMPEG_SHA256 }) {
  if (!/^ssh-(ed25519|rsa) [A-Za-z0-9+/=]+/.test(String(publicKey ?? "").trim())) {
    throw new Error("cloudInit: a public ssh key is required (and only the public half)");
  }
  if (!Number.isFinite(shutdownMinutes) || shutdownMinutes < 1) {
    throw new Error("cloudInit: shutdownMinutes must be a number of minutes");
  }
  if (!/^https:\/\//.test(ffmpegUrl) || !/^[0-9a-f]{64}$/.test(ffmpegSha256)) {
    throw new Error("cloudInit: ffmpeg must be pinned to an https URL and a sha256");
  }
  const minutes = Math.ceil(shutdownMinutes);
  const indent = (text, spaces) =>
    text
      .split("\n")
      .map((line) => (line.length > 0 ? " ".repeat(spaces) + line : ""))
      .join("\n");

  const install = [
    "#!/bin/bash",
    "# Everything this machine needs, installed once, at boot. No secret ever",
    "# reaches this file: the run's keys arrive later, on its stdin.",
    "set -euo pipefail",
    'exec >>' + REMOTE.log + ' 2>&1',
    'trap \'tail -n 25 ' + REMOTE.log + ' > ' + REMOTE.failed + ' || touch ' + REMOTE.failed + '\' ERR',
    'echo "cliffies: install started $(date -Is)"',
    "",
    "# The dead man's switch. Whatever happens to whoever started this machine,",
    "# it powers itself off: Scaleway bills a machine that runs, by the minute.",
    "shutdown -P +" + minutes + ' "cliffies: the run budget is over"',
    "",
    "need() {",
    '  if command -v "$1" >/dev/null 2>&1; then return 0; fi',
    '  echo "cliffies: installing $2 (for $1)"',
    "  DEBIAN_FRONTEND=noninteractive apt-get update -qq",
    '  DEBIAN_FRONTEND=noninteractive apt-get install -y -qq "$2"',
    "}",
    ...Object.entries(APT_PACKAGES).map(([command, pkg]) => `need ${command} ${pkg}`),
    "",
    "# The work disk: the one disk with nothing mounted on it or under it.",
    'data=""',
    "for dev in $(lsblk -dnp -o NAME,TYPE | awk '$2 == \"disk\" { print $1 }'); do",
    '  if [ -z "$(lsblk -no MOUNTPOINT $dev | tr -d \' \\n\')" ]; then data=$dev; break; fi',
    "done",
    "mkdir -p " + REMOTE.work,
    'if [ -n "$data" ]; then',
    '  mkfs.ext4 -F -L cliffies "$data"',
    '  mount "$data" ' + REMOTE.work,
    '  echo "cliffies: work disk $data mounted on ' + REMOTE.work + '"',
    "else",
    '  echo "cliffies: no spare disk found; work stays on the boot volume"',
    "fi",
    `mkdir -p ${REMOTE.repo} ${REMOTE.delivery} ${REMOTE.out}`,
    `chown -R ${REMOTE.user}:${REMOTE.user} ${REMOTE.work}`,
    "",
    "# ffmpeg, pinned, and checked against the hash its author published before",
    "# it is unpacked: a build that changed is not the build this repository",
    "# measured (scripts/lib/pinned-tools.mjs).",
    "cd /tmp",
    `curl -fsSL "${ffmpegUrl}" -o ffmpeg.tar.xz`,
    `echo "${ffmpegSha256}  ffmpeg.tar.xz" | sha256sum -c -`,
    "mkdir -p /opt/ffmpeg",
    "tar -xJf ffmpeg.tar.xz -C /opt/ffmpeg --strip-components=1",
    "rm -f ffmpeg.tar.xz",
    "/opt/ffmpeg/bin/ffmpeg -version > /dev/null",
    "",
    "# Ubuntu carries Node 18; this repository needs 20 or later. The snap is",
    "# signed by Canonical, which piping a third party's installer into a shell",
    "# is not.",
    `snap install node --classic --channel=${NODE_SNAP_CHANNEL}`,
    "/snap/bin/node --version",
    "",
    `touch ${REMOTE.ready}`,
    'echo "cliffies: install finished $(date -Is)"',
  ].join("\n");

  const run = [
    "#!/bin/bash",
    "# One ingest. Everything it needs arrives on stdin as NAME=value lines,",
    "# ended by a line that says " + ENV_SENTINEL + ": no secret is written to",
    "# this machine's disk, none is printed, and nothing the owner typed is",
    "# ever a shell word — this script takes no arguments at all.",
    "set -ef -o pipefail",
    "export PATH=/snap/bin:/opt/ffmpeg/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin",
    "umask 077",
    "while IFS= read -r line; do",
    '  if [ "$line" = "' + ENV_SENTINEL + '" ]; then break; fi',
    '  case "$line" in',
    '    [A-Z][A-Z0-9_]*=*) export "$line" ;;',
    '    *) echo "cliffies-run: refused a line that is not NAME=value" >&2; exit 64 ;;',
    "  esac",
    "done",
    'case "$CLIFFIES_SLUG" in',
    '  ""|*[!a-z0-9-]*) echo "cliffies-run: that is not a series slug" >&2; exit 64 ;;',
    "esac",
    'case "$CLIFFIES_MODE" in',
    "  publish|propose-cuts) ;;",
    '  *) echo "cliffies-run: mode must be publish or propose-cuts" >&2; exit 64 ;;',
    "esac",
    'case "$CLIFFIES_BUDGET_MINUTES" in',
    '  ""|*[!0-9]*) echo "cliffies-run: the budget must be a number of minutes" >&2; exit 64 ;;',
    "esac",
    'if [ -z "$CLIFFIES_LINKS" ]; then echo "cliffies-run: no link to download" >&2; exit 64; fi',
    "cd " + REMOTE.repo,
    'echo "cliffies-run: node $(node --version) on $(nproc) cores"',
    "node scripts/check-ffmpeg.mjs",
    `node scripts/fetch-delivery.mjs --out ${REMOTE.delivery} $CLIFFIES_LINKS`,
    'if [ "$CLIFFIES_MODE" = "propose-cuts" ]; then',
    `  node scripts/split-compilation.mjs propose "$CLIFFIES_SLUG" --input ${REMOTE.delivery} --out "${REMOTE.out}/$CLIFFIES_SLUG"`,
    "  exit $?",
    "fi",
    "set +e",
    `node scripts/cloud-ingest.mjs "$CLIFFIES_SLUG" --source ${REMOTE.delivery} --budget-minutes "$CLIFFIES_BUDGET_MINUTES"`,
    "code=$?",
    "set -e",
    `df -h ${REMOTE.work} | tail -1`,
    'echo "cliffies-run: ingest finished with $code"',
    "exit $code",
    "",
  ].join("\n");

  const collect = [
    "#!/bin/bash",
    "# Writes, to stdout, a tar of the small files a run produced: the manifest",
    "# that puts a series online, what is known to be on the media store, and a",
    "# cuts proposal. No video ever comes back this way.",
    "set -ef -o pipefail",
    'list=""',
    `for p in ${COLLECTED.map((entry) => entry.remote).join(" ")}; do`,
    `  if [ -e "${REMOTE.work}/$p" ]; then list="$list $p"; fi`,
    "done",
    'if [ -z "$list" ]; then exit 0; fi',
    `tar -c -f - -C ${REMOTE.work} $list`,
    "",
  ].join("\n");

  return [
    "#cloud-config",
    "# Written by scripts/lib/scaleway-plan.mjs for one ingest run of Cliffies.",
    "# It carries the public half of a key made for this run and nothing else:",
    "# no R2 key, no Scaleway key, no token. See docs/cloud-ingest.md.",
    "package_update: false",
    "users:",
    `  - name: ${REMOTE.user}`,
    "    shell: /bin/bash",
    '    sudo: "ALL=(ALL) NOPASSWD:ALL"',
    "    ssh_authorized_keys:",
    `      - ${String(publicKey).trim()}`,
    "write_files:",
    `  - path: ${REMOTE.install}`,
    '    permissions: "0755"',
    "    content: |",
    indent(install, 6),
    `  - path: ${REMOTE.run}`,
    '    permissions: "0755"',
    "    content: |",
    indent(run, 6),
    `  - path: ${REMOTE.collect}`,
    '    permissions: "0755"',
    "    content: |",
    indent(collect, 6),
    "runcmd:",
    `  - [ "${REMOTE.install}" ]`,
    "",
  ].join("\n");
}
