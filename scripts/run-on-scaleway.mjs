/**
 * One series, packaged on a machine that exists only for it.
 *
 *   node scripts/run-on-scaleway.mjs <slug> --links "<link> [<link> …]"
 *        [--mode publish|propose-cuts] [--type STANDARD2-A16C-64G] [--zone fr-par-1]
 *        [--budget-minutes 360] [--video-minutes 90] [--delivery-gb 5]
 *        [--max-parallel 1] [--dry-run]
 *
 *   node scripts/run-on-scaleway.mjs --sweep [--older-than-minutes 60] [--force]
 *        [--run <github run id>] [--dry-run]
 *
 * GitHub's free runner has two threads; a 90-minute series costs it most of a
 * month's free minutes (docs/standard.md §3). This makes a 16-core machine at
 * Scaleway, runs the SAME cloud ingest on it, and deletes it — so the GitHub
 * job spends a few free minutes orchestrating and the encoding happens where
 * it is quick. The owner's rule is "no money of mine", so everything here is
 * built around not leaving a machine running:
 *
 *   1. the machine powers ITSELF off after the budget (the cloud-init's
 *      shutdown), so a killed orchestrator costs minutes, not a month;
 *   2. the orchestrator deletes it on success, on failure, on timeout and on
 *      Ctrl-C, and says so in one line;
 *   3. what a crash still leaves behind, `--sweep` finds by tag and deletes;
 *   4. every run ends with what it cost, in euro, from a price table with the
 *      date it was read.
 *
 * Exit codes: 0 the series is published; 3 part of it is (run again); 1 a
 * refusal or a failure; 2 the wall-clock budget was reached and the machine
 * was destroyed.
 *
 * Nothing in this file has ever run against the real Scaleway API: there are
 * no credentials in the environment it was written in, and none were invented
 * (docs/decisions.md, 2026-09-20).
 */
import { spawn, spawnSync } from "node:child_process";
import { appendFileSync, cpSync, existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { isSlug } from "./lib/delivery-rules.mjs";
import { mediaConfig, MEDIA_ENV } from "./lib/media-publish.mjs";
import {
  billedMinutes,
  COLLECTED,
  cloudInit,
  costLine,
  DEFAULT_BUDGET_MINUTES,
  DEFAULT_IMAGE,
  DEFAULT_SWEEP_MINUTES,
  DEFAULT_TYPE,
  DEFAULT_VOLUME_TYPE,
  envLines,
  eur,
  humanMinutes,
  planLines,
  planRun,
  priceOf,
  REMOTE,
  RUN_TAG,
  costEur,
} from "./lib/scaleway-plan.mjs";
import { createScalewayClient, scalewayConfig, ScalewayError } from "./lib/scaleway.mjs";
import { createSshRemote, makeRunKey, sshAvailable } from "./lib/remote-ssh.mjs";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const args = process.argv.slice(2);

function say(line) {
  console.error(`scaleway: ${line}`);
}

function die(message, code = 1) {
  console.error(`scaleway: ${message}`);
  process.exit(code);
}

function flag(name, fallback = null) {
  const at = args.indexOf(name);
  if (at === -1) return fallback;
  const value = args[at + 1];
  if (value === undefined || value.startsWith("--")) die(`${name} needs a value`);
  return value;
}

const has = (name) => args.includes(name);
const number = (name, fallback) => {
  const raw = flag(name, null);
  if (raw === null) return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value)) die(`${name} must be a number`);
  return value;
};

/** Written where the owner reads it: the job's page on GitHub, and the terminal. */
function summary(lines) {
  for (const line of lines) console.error(line);
  const file = process.env.GITHUB_STEP_SUMMARY;
  if (file) appendFileSync(file, `${lines.join("\n")}\n`);
}

/**
 * The stand-in remote used by npm run proof:scaleway. It is only ever allowed
 * against a stand-in API on this machine: a fake remote pointed at the real
 * Scaleway would make real machines and never talk to them.
 */
async function makeRemote(options) {
  const standIn = process.env.CLIFFIES_REMOTE_MODULE;
  if (!standIn) return createSshRemote(options);
  const api = process.env.SCW_API_URL ?? "";
  if (!/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?(\/|$)/.test(api)) {
    die("CLIFFIES_REMOTE_MODULE is for proofs only, and only against a stand-in API on this machine");
  }
  const module = await import(pathToFileURL(resolve(standIn)).href);
  return module.createRemote(options);
}

/** A key for this one run; the stand-in remote does not need a real one. */
function keyForRun() {
  if (process.env.CLIFFIES_REMOTE_MODULE) {
    return {
      keyPath: "(stand-in)",
      publicKey:
        "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA cliffies-stand-in",
      forget() {},
    };
  }
  if (!sshAvailable()) die("there is no ssh on this machine, and the run talks to the machine it makes over ssh");
  return makeRunKey();
}

// ---------------------------------------------------------------------------
// Making a machine, and unmaking it whatever happens
// ---------------------------------------------------------------------------

/**
 * Deletes everything a run made, and answers what is still alive. Called on
 * success, on failure, on the budget wall, on Ctrl-C — and by the sweeper.
 * Every step tolerates the thing already being gone, because half the reasons
 * to call it are "something went wrong".
 */
async function destroy(api, { serverId, volumeId, name = "the machine" }) {
  const problems = [];
  if (serverId) {
    try {
      await api.action(serverId, "poweroff");
      await api.waitForServer(serverId, { states: ["stopped"], timeoutMs: 5 * 60_000, intervalMs: 3_000 });
    } catch (error) {
      problems.push(`powering ${name} off: ${error.message}`);
    }
    if (volumeId) {
      try {
        await api.detachVolume(serverId, volumeId);
      } catch (error) {
        problems.push(`detaching its disk: ${error.message}`);
      }
    }
    try {
      await api.deleteServer(serverId);
    } catch (error) {
      problems.push(`deleting ${name}: ${error.message}`);
    }
  }
  if (volumeId) {
    try {
      await api.deleteVolume(volumeId);
    } catch (error) {
      problems.push(`deleting its disk: ${error.message}`);
    }
  }
  // Whatever the steps above said, the only answer that counts is what is
  // still there. A "deleted" that left a machine running would be the most
  // expensive lie this program could tell.
  let alive = { server: null, volume: null };
  try {
    alive = {
      server: serverId ? await api.getServer(serverId) : null,
      volume: volumeId ? await api.getVolume(volumeId) : null,
    };
  } catch (error) {
    problems.push(`checking what is left: ${error.message}`);
  }
  if (alive.server) {
    // Last resort: terminate deletes the machine and its disks in one call.
    try {
      await api.action(alive.server.id, "terminate");
      alive.server = await api.getServer(serverId);
      if (volumeId) alive.volume = await api.getVolume(volumeId);
    } catch (error) {
      problems.push(`terminating ${name}: ${error.message}`);
    }
  }
  return { gone: !alive.server && !alive.volume, alive, problems };
}

// ---------------------------------------------------------------------------
// The sweeper
// ---------------------------------------------------------------------------

const untilOf = (tags) => {
  const tag = (tags ?? []).find((entry) => entry.startsWith("until:"));
  const seconds = tag ? Number(tag.slice("until:".length)) : NaN;
  return Number.isFinite(seconds) ? seconds * 1000 : null;
};
const ageMinutes = (creation) => {
  const at = Date.parse(creation ?? "");
  return Number.isFinite(at) ? (Date.now() - at) / 60_000 : null;
};

async function sweep(api, { olderThanMinutes, force, dryRun, onlyRun = null }) {
  // --run <id> is the precise form: it deletes what ONE run made, whatever
  // its budget said, and touches nothing else. That is what the workflow
  // calls when a job is cancelled mid-run.
  const mine = (thing) => !onlyRun || (thing.tags ?? []).includes(`run:${onlyRun}`);
  const servers = (await api.listServers({ tag: RUN_TAG })).filter(mine);
  const volumes = (await api.listVolumes({ tag: RUN_TAG })).filter(mine);
  if (onlyRun) force = true;
  say(
    `${servers.length} machine(s) and ${volumes.length} disk(s) carry the tag ${RUN_TAG}` +
      (onlyRun ? ` and run:${onlyRun}` : "") +
      ` (older than ${humanMinutes(olderThanMinutes)} counts as a leftover)`,
  );
  const removed = [];
  const spared = [];
  const keptIds = new Set();
  let wasted = 0;
  for (const server of servers) {
    const age = ageMinutes(server.creation_date);
    const until = untilOf(server.tags);
    const inFlight = until !== null && until > Date.now();
    if (age !== null && age < olderThanMinutes) {
      keptIds.add(server.id);
      spared.push(`${server.name}: ${humanMinutes(age)} old, younger than the threshold`);
      continue;
    }
    if (inFlight && !force) {
      keptIds.add(server.id);
      spared.push(
        `${server.name}: still inside its own budget (until ${new Date(until).toISOString()}). ` +
          "It is probably a run in flight. Add --force to delete it anyway",
      );
      continue;
    }
    const price = priceOf(server.commercial_type)?.eurPerHour ?? null;
    const cost = costEur(age ?? 0, price);
    if (cost !== null) wasted += cost;
    if (dryRun) {
      removed.push(`${server.name} (${server.commercial_type}, ${humanMinutes(age)}, about ${eur(cost)}) — would be deleted`);
      continue;
    }
    const volumeIds = Object.values(server.volumes ?? {})
      .map((volume) => volume?.id)
      .filter(Boolean);
    const result = await destroy(api, { serverId: server.id, volumeId: volumeIds[0] ?? null, name: server.name });
    removed.push(
      `${server.name} (${server.commercial_type}, ${humanMinutes(age)}, about ${eur(cost)}) — ` +
        (result.gone ? "deleted" : `STILL THERE: ${result.problems.join("; ")}`),
    );
  }
  for (const volume of volumes) {
    if (volume.server) continue;
    const age = ageMinutes(volume.creation_date);
    if (age !== null && age < olderThanMinutes) {
      spared.push(`${volume.name}: ${humanMinutes(age)} old, younger than the threshold`);
      continue;
    }
    if (dryRun) {
      removed.push(`${volume.name} (disk, ${Math.round((volume.size ?? 0) / 1e9)} GB) — would be deleted`);
      continue;
    }
    await api.deleteVolume(volume.id);
    removed.push(`${volume.name} (disk, ${Math.round((volume.size ?? 0) / 1e9)} GB) — deleted`);
  }
  for (const line of removed) say(`  ${dryRun ? "would remove" : "removed"}: ${line}`);
  for (const line of spared) say(`  kept: ${line}`);
  if (removed.length === 0) say("nothing to sweep: no machine and no disk of this project is still there");
  else if (wasted > 0) say(`those leftovers had been running for about ${eur(wasted)} in total`);
  if (dryRun) return 0;
  // The verdict is what is still there afterwards, not what the deletions said.
  const left = (await api.listServers({ tag: RUN_TAG })).filter(mine);
  const shouldBeGone = left.filter((server) => !keptIds.has(server.id));
  if (shouldBeGone.length > 0) {
    say(`WARNING: ${shouldBeGone.length} machine(s) could not be deleted: ${shouldBeGone.map((s) => s.name).join(", ")}`);
    return 1;
  }
  return 0;
}

// ---------------------------------------------------------------------------
// The run
// ---------------------------------------------------------------------------

async function main() {
  const dryRun = has("--dry-run");
  const sweeping = has("--sweep");
  const mode = flag("--mode", "publish");
  if (!["publish", "propose-cuts", "auto-publish"].includes(mode)) die("--mode must be publish, propose-cuts, or auto-publish");

  const config = scalewayConfig(process.env);
  if (!config.ok && !(dryRun && !sweeping)) {
    die(`the Scaleway credentials are not set:\n  - ${config.problems.join("\n  - ")}\n  docs/cloud-ingest.md says where each one comes from`);
  }

  const type = flag("--type", DEFAULT_TYPE);
  const budgetMinutes = number("--budget-minutes", DEFAULT_BUDGET_MINUTES);
  if (budgetMinutes < 1 || budgetMinutes > 24 * 60) die("--budget-minutes must be between 1 and 1440 minutes");
  const maxParallel = number("--max-parallel", 1);
  const priceGiven = flag("--price-per-hour", null);

  // ---- the sweeper -------------------------------------------------------
  if (sweeping) {
    const api = createScalewayClient(config.config);
    process.exit(
      await sweep(api, {
        olderThanMinutes: number("--older-than-minutes", DEFAULT_SWEEP_MINUTES),
        force: has("--force"),
        onlyRun: flag("--run", null),
        dryRun,
      }),
    );
  }

  const series = args[0] && !args[0].startsWith("--") ? args[0] : null;
  if (!series || !isSlug(series)) {
    die("usage: node scripts/run-on-scaleway.mjs <series-slug> --links \"<link> …\" [--mode publish]");
  }
  const links = flag("--links", null);
  if (!links && !dryRun) die("--links \"<link> …\" is required: that is what the machine downloads");

  const runId = String(process.env.GITHUB_RUN_ID ?? `${Date.now().toString(36)}`);
  const plan = planRun({
    slug: series,
    mode,
    runId,
    type,
    zone: config.ok ? config.config.zone : (process.env.SCW_ZONE ?? "fr-par-1"),
    image: flag("--image", DEFAULT_IMAGE),
    volumeType: flag("--volume-type", DEFAULT_VOLUME_TYPE),
    deliveryGb: number("--delivery-gb", null),
    videoMinutes: number("--video-minutes", null),
    budgetMinutes,
    priceEurPerHour: priceGiven === null ? null : Number(priceGiven),
  });

  say(`${plan.mode} ${plan.slug} on a machine made for it`);
  for (const line of planLines(plan)) say(`  ${line}`);

  if (plan.price.eurPerHour === null) {
    die(
      `no price is known for ${plan.type}, and a machine whose price nobody knows is not created here.\n` +
        `  Add it to INSTANCE_PRICES in scripts/lib/scaleway-plan.mjs with the date you read it, or pass --price-per-hour.`,
    );
  }
  if (dryRun) {
    say("--dry-run: nothing was created, nothing was asked of Scaleway, nothing was spent");
    process.exit(0);
  }

  // The media store's keys must be there BEFORE a machine exists: finding out
  // afterwards costs a machine-hour for nothing.
  if (mode === "publish") {
    const media = mediaConfig(process.env);
    if (media.mode !== "r2") {
      die(
        media.mode === "error"
          ? `the media store is half configured:\n  - ${media.problems.join("\n  - ")}`
          : `no media store: set ${MEDIA_ENV.join(", ")} (docs/cloud-ingest.md). No machine was created`,
      );
    }
  }

  const api = createScalewayClient(config.config);

  // ---- never more machines than we said -----------------------------------
  let already = [];
  try {
    already = await api.listServers({ tag: RUN_TAG });
  } catch (error) {
    die(`Scaleway would not say what is already running: ${api.redact(error?.message ?? String(error))}`);
  }
  if (already.length >= maxParallel) {
    die(
      `${already.length} machine(s) of this project are already up and --max-parallel is ${maxParallel}:\n  - ` +
        already.map((server) => `${server.name} (${server.state}, ${humanMinutes(ageMinutes(server.creation_date))})`).join("\n  - ") +
        "\n  Wait for it, raise --max-parallel, or run --sweep if it is a leftover. Nothing was created.",
    );
  }

  const key = keyForRun();
  const state = { serverId: null, volumeId: null, startedAt: null, destroyed: false };
  let remote = null;
  let outcome = { code: 1, why: "the run did not start" };

  /** Idempotent, and the only path that ends a run. */
  let teardown = null;
  const unmake = (why) => {
    teardown ??= (async () => {
      state.destroyed = true;
      remote?.close();
      key.forget();
      if (!state.serverId && !state.volumeId) return { gone: true, problems: [] };
      say(`taking the machine down (${why}) …`);
      const result = await destroy(api, { serverId: state.serverId, volumeId: state.volumeId, name: plan.name });
      if (result.gone) say("the machine and its disk are gone");
      else {
        say(`WARNING: something is STILL THERE and may still be billed: ${result.problems.join("; ")}`);
        say(`  run: node scripts/run-on-scaleway.mjs --sweep --older-than-minutes 0 --force`);
      }
      return result;
    })();
    return teardown;
  };

  // Ctrl-C, a cancelled Actions job, an error nobody caught: the machine goes.
  let leaving = false;
  const leave = async (why, code) => {
    if (leaving) return;
    leaving = true;
    say(why);
    const result = await unmake(why);
    reportCost(result.gone);
    process.exit(code);
  };
  process.on("SIGINT", () => void leave("interrupted (Ctrl-C)", 2));
  process.on("SIGTERM", () => void leave("stopped (SIGTERM)", 2));
  process.on("uncaughtException", (error) => void leave(`a failure nobody caught: ${error?.message ?? error}`, 1));
  process.on("unhandledRejection", (error) => void leave(`a failure nobody caught: ${error?.message ?? error}`, 1));

  function reportCost(gone) {
    const minutes = state.startedAt === null ? 0 : billedMinutes(Date.now() - state.startedAt);
    const lines = [
      `### ${plan.slug}: ${outcome.why}`,
      "",
      `- machine: ${plan.type} in ${plan.zone}, ${gone ? "created and deleted" : "CREATED AND POSSIBLY STILL THERE"}`,
      `- ${costLine({ minutes, eurPerHour: plan.price.eurPerHour, type: plan.type })}`,
    ];
    if (plan.estimate.minutes !== null) {
      lines.push(`- the estimate before the run was ${humanMinutes(plan.estimate.minutes)}, about ${eur(plan.estimate.eur)}`);
    }
    if (!gone) lines.push("- **run `node scripts/run-on-scaleway.mjs --sweep --older-than-minutes 0 --force` now**");
    summary(lines);
  }

  // The wall. Whatever is happening when it is reached, the machine goes.
  // Not unref'd on purpose: this timer is the one thing that must outlive
  // everything else in this process. It is cleared on the normal path.
  const wall = setTimeout(() => {
    outcome = { code: 2, why: `stopped at the ${humanMinutes(plan.budgetMinutes)} budget` };
    void leave(`the ${humanMinutes(plan.budgetMinutes)} budget is over; the machine is being destroyed`, 2);
  }, plan.budgetMinutes * 60_000);

  try {
    const image = await api.resolveImage(plan.image, { commercialType: plan.type });
    say(`image ${plan.image} is ${image}`);

    const volume = await api.createVolume({
      name: plan.volumeName,
      sizeGb: plan.volumeGb,
      volumeType: plan.volumeType,
      tags: plan.tags,
    });
    state.volumeId = volume?.id ?? null;
    say(`disk ${plan.volumeGb} GB made`);

    const until = Math.round((Date.now() + plan.budgetMinutes * 60_000) / 1000);
    const server = await api.createServer({
      name: plan.name,
      commercialType: plan.type,
      image,
      tags: [...plan.tags, `until:${until}`],
    });
    state.serverId = server?.id ?? null;
    state.startedAt = Date.now();
    if (!state.serverId) throw new ScalewayError("Scaleway created no machine and said nothing about why");
    say(`machine ${plan.name} made`);

    await api.setCloudInit(state.serverId, cloudInit({ publicKey: key.publicKey, shutdownMinutes: plan.budgetMinutes }));
    await api.attachVolume(state.serverId, state.volumeId);
    await api.action(state.serverId, "poweron");
    const running = await api.waitForServer(state.serverId, {
      states: ["running"],
      timeoutMs: 10 * 60_000,
      intervalMs: 5_000,
    });
    const address = api.publicIpOf(running);
    if (!address) throw new ScalewayError("the machine is running but has no address to talk to");
    say(`machine running at ${address}; waiting for it to install its tools`);

    remote = await makeRemote({ host: address, user: REMOTE.user, keyPath: key.keyPath, onLog: say });
    await remote.waitReady({
      timeoutMs: 15 * 60_000,
      onWait: ({ attempt }) => {
        if (attempt % 3 === 0) say(`still installing (${attempt} tries)`);
      },
    });
    say("the machine has node and the pinned ffmpeg");

    await sendWorkingCopy(remote);

    const started = Date.now();
    const result = await remote.run({
      envLines: envLines({
        CLIFFIES_MODE: plan.mode,
        CLIFFIES_SLUG: plan.slug,
        CLIFFIES_LINKS: links,
        CLIFFIES_BUDGET_MINUTES: String(plan.remoteBudgetMinutes),
        MEDIA_BASE_URL: process.env.MEDIA_BASE_URL,
        R2_ACCOUNT_ID: process.env.R2_ACCOUNT_ID,
        R2_ENDPOINT: process.env.R2_ENDPOINT,
        R2_ACCESS_KEY_ID: process.env.R2_ACCESS_KEY_ID,
        R2_SECRET_ACCESS_KEY: process.env.R2_SECRET_ACCESS_KEY,
        R2_BUCKET: process.env.R2_BUCKET,
      }),
      onLine: (line) => console.error(`  | ${line}`),
    });
    say(`the ingest finished with ${result.code} after ${humanMinutes((Date.now() - started) / 60_000)}`);

    const collected = await remote.collect();
    const brought = collected ? unpack(collected) : [];
    if (brought.length > 0) say(`brought back: ${brought.join(", ")}`);
    else say("nothing came back from the machine");

    outcome = {
      code: result.code === 3 ? 3 : result.code === 0 ? 0 : 1,
      why: result.code === 0 ? "published" : result.code === 3 ? "part of the series (run again)" : "refused",
    };
  } catch (error) {
    outcome = { code: 1, why: `refused: ${api.redact(error?.message ?? String(error))}` };
    say(outcome.why);
  }

  clearTimeout(wall);
  if (leaving) return;
  const result = await unmake(outcome.code === 0 ? "the run is over" : "the run ended badly");
  reportCost(result.gone);
  process.exit(result.gone ? outcome.code : 1);
}

/**
 * This repository, as the machine will see it: the tracked files of one
 * commit, plus what an earlier run learned is already on the media store. Not
 * a git clone: a clone from a private repository needs a token on that
 * machine, and a token that outlives a run is exactly what must not exist
 * there.
 */
async function sendWorkingCopy(remote) {
  const commit = flag("--commit", process.env.GITHUB_SHA ?? "HEAD");
  const dirty = spawnSync("git", ["status", "--porcelain"], { cwd: repoRoot, encoding: "utf8" }).stdout ?? "";
  if (dirty.trim() && commit === "HEAD") {
    say("note: this working copy has uncommitted changes; the machine gets the COMMITTED files of HEAD");
  }
  const archive = spawn("git", ["archive", "--format=tar", commit], { cwd: repoRoot, stdio: ["ignore", "pipe", "pipe"] });
  let archiveError = "";
  archive.stderr.on("data", (chunk) => (archiveError += chunk.toString("utf8")));
  await remote.sendRepo(archive.stdout);
  if (archiveError.trim()) say(`git archive said: ${archiveError.trim().split("\n")[0]}`);
  say(`sent the repository at ${commit}`);

  const records = join(repoRoot, ".ingest-records");
  if (existsSync(records)) {
    const tar = spawn("tar", ["-c", "-f", "-", "-C", repoRoot, ".ingest-records"], {
      stdio: ["ignore", "pipe", "ignore"],
    });
    await remote.sendRepo(tar.stdout);
    say("sent what the last run knew about the media store");
  }
}

/** Unpacks what came back into this working copy. Only the paths this project wrote. */
function unpack(tarBuffer) {
  const work = mkdtempSync(join(tmpdir(), "cliffies-back-"));
  try {
    const extract = spawnSync("tar", ["-x", "-f", "-", "-C", work], {
      input: tarBuffer,
      encoding: "buffer",
      maxBuffer: 64 * 1024 * 1024,
    });
    if (extract.status !== 0) {
      say(`what came back could not be unpacked: ${String(extract.stderr ?? "").slice(0, 200)}`);
      return [];
    }
    const brought = [];
    for (const entry of COLLECTED) {
      const from = join(work, entry.remote);
      if (!existsSync(from)) continue;
      const to = join(repoRoot, entry.local);
      cpSync(from, to, { recursive: true });
      const count = readdirSync(from).length;
      brought.push(`${entry.local} (${count} file(s) or folder(s))`);
    }
    return brought;
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

await main();
