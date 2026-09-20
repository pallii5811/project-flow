/**
 * Proves the Scaleway path without a Scaleway account: the real orchestrator
 * (scripts/run-on-scaleway.mjs), against a stand-in API that answers what
 * Scaleway's reference documents and refuses what it refuses
 * (scripts/lib/fake-scaleway.mjs), with a stand-in machine on the other end
 * of ssh (scripts/lib/stand-in-remote.mjs).
 *
 *   node scripts/scaleway-proof.mjs [--keep]
 *
 * What is proven, in this order:
 *
 *    1. --dry-run prints the plan and the cost and asks Scaleway for NOTHING;
 *    2. a run makes a disk and a machine, sends this repository, runs the
 *       ingest, brings back the small files, and deletes both;
 *    3. a refused ingest still deletes the machine;
 *    4. a run that asks for a continuation still deletes the machine;
 *    5. the wall-clock budget destroys the machine mid-run;
 *    6. the orchestrator KILLED mid-run leaves a machine — and the sweeper
 *       finds it;
 *    7. while that leftover is there, a second run refuses to create another
 *       (--max-parallel);
 *    8. the sweeper spares what is still inside its own budget…
 *    9. …and deletes it when told to, saying what it removed and what it cost;
 *   10. Scaleway failing twice with 500 is retried; 403 stops at once with
 *       nothing created;
 *   11. no secret is ever in a request body, a tag, a cloud-init or a log
 *       line — checked against every byte that left this process;
 *   12. the cloud-init parses as YAML, pins the same ffmpeg as the workflow,
 *       and carries the shutdown that makes a killed run cost minutes;
 *   13. the ingest commands inside that cloud-init RUN here, on real video,
 *       against a media store that checks every signature.
 *
 * Nothing in this proof touches the real Scaleway API, and no Scaleway
 * credential exists in this environment.
 */
import { spawn, spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as sleep } from "node:timers/promises";

import { parse } from "yaml";

import { startFakeMediaStore } from "./lib/fake-media-store.mjs";
import { startFakeScaleway } from "./lib/fake-scaleway.mjs";
import { FFMPEG_SHA256, FFMPEG_URL } from "./lib/pinned-tools.mjs";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const standIn = join(repoRoot, "content", "series", "signal-night");
const keep = process.argv.includes("--keep");
const work = mkdtempSync(join(tmpdir(), "flow-scw-proof-"));
const SLUG = "scaleway-proof";

/** Invented here, for this process only. Nothing real is ever in this file. */
const SCW_SECRET = "11111111-2222-4333-8444-555555555555";
const SCW_PROJECT = "99999999-8888-4777-8666-555555555555";
const R2_SECRET = "scaleway-proof-r2-secret-value";
const ALL_SECRETS = [SCW_SECRET, R2_SECRET];

const results = [];
const record = (name, ok, detail, output = "") => results.push({ name, ok, detail, output });

const scw = await startFakeScaleway({ secretKey: SCW_SECRET, projectId: SCW_PROJECT, zone: "fr-par-1", pollsToSettle: 1 });
const store = await startFakeMediaStore({
  bucket: "scaleway-proof-media",
  accessKeyId: "AKIDSCALEWAY",
  secretAccessKey: R2_SECRET,
  allowedOrigins: ["*"],
});

const baseEnv = {
  SCW_SECRET_KEY: SCW_SECRET,
  SCW_PROJECT_ID: SCW_PROJECT,
  SCW_ZONE: "fr-par-1",
  SCW_API_URL: scw.url,
  SCW_ACCESS_KEY: "SCWXXXXXXXXXXXXXXXXX",
  CLIFFIES_REMOTE_MODULE: join(repoRoot, "scripts", "lib", "stand-in-remote.mjs"),
  MEDIA_BASE_URL: store.endpoint,
  R2_ENDPOINT: store.endpoint,
  R2_ACCESS_KEY_ID: "AKIDSCALEWAY",
  R2_SECRET_ACCESS_KEY: R2_SECRET,
  R2_BUCKET: "scaleway-proof-media",
  // A proof must not write into the summary of whatever job is running it.
  GITHUB_STEP_SUMMARY: "",
};

/** Runs the real orchestrator as its own process, the way a workflow does. */
function orchestrate(argv, { plan = {}, env = {}, onStart = null } = {}) {
  return new Promise((done) => {
    const child = spawn(process.execPath, [join(repoRoot, "scripts", "run-on-scaleway.mjs"), ...argv], {
      env: { ...process.env, ...baseEnv, CLIFFIES_STANDIN: JSON.stringify(plan), ...env },
    });
    let output = "";
    child.stdout.on("data", (chunk) => (output += chunk));
    child.stderr.on("data", (chunk) => (output += chunk));
    onStart?.(child);
    child.on("close", (code, signal) => done({ code, signal, output, ok: code === 0 }));
  });
}

const alive = () => ({ servers: [...scw.servers.values()], volumes: [...scw.volumes.values()] });
const nothingLeft = () => scw.servers.size === 0 && scw.volumes.size === 0;

// ---------------------------------------------------------------------------
// 1. --dry-run asks for nothing
// ---------------------------------------------------------------------------
{
  const before = scw.log.length;
  const run = await orchestrate([SLUG, "--links", "https://example.invalid/x.mp4", "--dry-run", "--video-minutes", "90"], {
    env: { GITHUB_RUN_ID: "dry" },
  });
  const wants = [
    /machine\s+STANDARD2-A16C-64G \(16 vCPU, 64 GB\)\s+EUR 0\.50\/hour/,
    /extra disk\s+50 GB \(sbs_volume\), deleted with the machine/,
    /budget\s+6 h 00 min of wall clock, of which 5 h 40 min for the ingest itself/,
    /estimate\s+1 h 18 min for 90 minutes of video, about EUR 0\.66 — AN ESTIMATE, not a measurement/,
    /most it can cost\s+EUR 3\.02/,
    /price read on\s+2026-09-20/,
    /nothing was created, nothing was asked of Scaleway, nothing was spent/,
  ];
  const missing = wants.filter((pattern) => !pattern.test(run.output));
  record(
    "--dry-run prints the plan and its cost, and asks Scaleway for nothing",
    run.ok && missing.length === 0 && scw.log.length === before,
    missing.length > 0
      ? `${missing.length} line(s) missing: ${missing.map(String).join(" ")}`
      : `plan printed, ${scw.log.length - before} requests made`,
    run.output,
  );
}

// ---------------------------------------------------------------------------
// 2. A whole run: made, used, brought back, deleted
// ---------------------------------------------------------------------------
const transcript = join(work, "transcript.json");
{
  // What the machine "produces": the two small things a real run sends back.
  const staged = join(work, "collected");
  mkdirSync(join(staged, "repo", ".ingest-records"), { recursive: true });
  mkdirSync(join(staged, "out", SLUG), { recursive: true });
  writeFileSync(join(staged, "repo", ".ingest-records", `${SLUG}.json`), '{"proof":true}\n');
  writeFileSync(join(staged, "out", SLUG, "report.txt"), "a proposal from a machine that never existed\n");
  const collectTar = join(work, "collected.tar");
  // `-f -` is required on Windows bsdtar (otherwise it opens \\.\tape0).
  // Never pass a Windows path to -f: bsdtar treats `C:/…` as a tape device.
  const tarred = spawnSync("tar", ["-c", "-f", "-", "-C", staged, "repo", "out"], {
    encoding: "buffer",
    maxBuffer: 64 * 1024 * 1024,
  });
  if (tarred.status !== 0) {
    console.error(
      `scaleway-proof: tar could not pack what comes back: ${String(tarred.stderr ?? "")}`,
    );
  } else {
    writeFileSync(collectTar, tarred.stdout);
  }

  const before = scw.log.length;
  const run = await orchestrate(
    [SLUG, "--links", "https://example.invalid/whole.mp4", "--commit", "HEAD", "--video-minutes", "90"],
    { plan: { runExitCode: 0, transcript, collectTar }, env: { GITHUB_RUN_ID: "whole" } },
  );
  const seen = existsSync(transcript) ? JSON.parse(readFileSync(transcript, "utf8")) : null;
  const short = (path) => path.replace(/^\/instance\/v1\/zones\/[a-z0-9-]+/, "").replace(/\/[0-9a-f-]{36}/g, "/<id>");
  const calls = scw.log.slice(before).map((entry) => `${entry.method} ${short(entry.path)}`);
  const problems = [];
  if (!run.ok) problems.push(`the run answered ${run.code}`);
  if (!nothingLeft()) problems.push(`${alive().servers.length} machine(s) and ${alive().volumes.length} disk(s) left`);
  if (!seen?.ran) problems.push("the ingest never ran on the machine");
  if ((seen?.repoBytes ?? 0) < 1_000_000) problems.push(`only ${seen?.repoBytes ?? 0} bytes of repository arrived`);
  const env = Object.fromEntries((seen?.envLines ?? []).filter((line) => line.includes("=")).map((line) => [line.slice(0, line.indexOf("=")), line.slice(line.indexOf("=") + 1)]));
  if (env.R2_SECRET_ACCESS_KEY !== R2_SECRET) problems.push("the media store's key did not reach the machine");
  if (env.CLIFFIES_SLUG !== SLUG) problems.push("the slug did not reach the machine");
  if (env.CLIFFIES_BUDGET_MINUTES !== "340") problems.push(`the ingest was given ${env.CLIFFIES_BUDGET_MINUTES} minutes, not 340`);
  if ((seen?.envLines ?? []).at(-1) !== "END-OF-ENV") problems.push("the environment block was not closed");
  if (!existsSync(join(repoRoot, ".split-work", SLUG, "report.txt"))) problems.push("the proposal did not come back");
  if (!existsSync(join(repoRoot, ".ingest-records", `${SLUG}.json`))) problems.push("what is on the store did not come back");
  if (!/cost: \d+ min on STANDARD2-A16C-64G at EUR 0\.50\/hour = EUR \d+\.\d\d \(measured wall clock/.test(run.output)) {
    problems.push("the run did not end with what it cost");
  }
  if (!/the machine and its disk are gone/.test(run.output)) problems.push("the run did not say it destroyed the machine");
  record(
    "a run makes a disk and a machine, uses them, brings the small files back and deletes both",
    problems.length === 0,
    problems.join("; ") || `${calls.length} calls, ${(seen.repoBytes / 1e6).toFixed(1)} MB of repository sent, nothing left alive`,
    run.output,
  );
  {
    const at = (call) => calls.indexOf(call);
    const order = [
      ["it asks the marketplace which image that label is", calls.some((call) => call.includes("local-images"))],
      ["the disk is made before the machine", at("POST /volumes") > -1 && at("POST /volumes") < at("POST /servers")],
      [
        "the cloud-init is in place before the machine is ever started",
        at("PATCH /servers/<id>/user_data/cloud-init") < at("POST /servers/<id>/action"),
      ],
      ["the disk is attached before the machine starts", at("POST /servers/<id>/attach-volume") < at("POST /servers/<id>/action")],
      ["both are deleted at the end", calls.filter((call) => call.startsWith("DELETE")).length === 2],
    ];
    const wrong = order.filter(([, ok]) => !ok).map(([what]) => what);
    record(
      "it does it in the order that cannot leave a paid thing behind",
      wrong.length === 0,
      wrong.length === 0 ? calls.join(" · ") : `wrong: ${wrong.join("; ")} — ${calls.join(" · ")}`,
      run.output,
    );
  }
}

// ---------------------------------------------------------------------------
// 3 & 4. A refusal, and a continuation: the machine goes either way
// ---------------------------------------------------------------------------
for (const [exitCode, name, expected] of [
  [1, "an ingest that refuses still leaves nothing running", 1],
  [3, "an ingest that asks for another run still leaves nothing running", 3],
]) {
  const run = await orchestrate([SLUG, "--links", "https://example.invalid/x.mp4", "--commit", "HEAD"], {
    plan: { runExitCode: exitCode },
    env: { GITHUB_RUN_ID: `exit${exitCode}` },
  });
  record(
    name,
    run.code === expected && nothingLeft() && /the machine and its disk are gone/.test(run.output),
    `answered ${run.code} (wanted ${expected}), ${alive().servers.length} machine(s) left`,
    run.output,
  );
}

// ---------------------------------------------------------------------------
// 5. The wall-clock budget
// ---------------------------------------------------------------------------
{
  const started = Date.now();
  const run = await orchestrate(
    [SLUG, "--links", "https://example.invalid/x.mp4", "--commit", "HEAD", "--budget-minutes", "1"],
    { plan: { runExitCode: 0, runMillis: 5 * 60_000 }, env: { GITHUB_RUN_ID: "wall" } },
  );
  const took = (Date.now() - started) / 1000;
  record(
    "the wall-clock budget stops a run that would not end, and destroys the machine",
    run.code === 2 && nothingLeft() && /budget is over; the machine is being destroyed/.test(run.output) && took < 150,
    `stopped after ${took.toFixed(0)} s with ${run.code}, ${alive().servers.length} machine(s) left`,
    run.output,
  );
}

// ---------------------------------------------------------------------------
// 6. The orchestrator is killed mid-run
// ---------------------------------------------------------------------------
{
  const marker = join(work, "running.marker");
  rmSync(marker, { force: true });
  let killed = false;
  const run = await orchestrate([SLUG, "--links", "https://example.invalid/x.mp4", "--commit", "HEAD"], {
    plan: { runExitCode: 0, runMillis: 120_000, markerFile: marker },
    env: { GITHUB_RUN_ID: "killed" },
    onStart: (child) => {
      void (async () => {
        for (let i = 0; i < 600 && !existsSync(marker); i += 1) await sleep(100);
        killed = child.kill("SIGKILL");
      })();
    },
  });
  const left = alive();
  record(
    "the orchestrator killed mid-run leaves a machine — which is what the sweeper is for",
    killed && left.servers.length === 1 && left.servers[0].tags.includes("cliffies-ingest"),
    killed
      ? `${left.servers.length} machine(s) and ${left.volumes.length} disk(s) survived, tagged ${left.servers[0]?.tags.join(" ")}`
      : "the orchestrator could not be killed",
    run.output,
  );
}

// ---------------------------------------------------------------------------
// 7. While a leftover is there, no second machine is made
// ---------------------------------------------------------------------------
{
  const before = alive().servers.length;
  const run = await orchestrate([SLUG, "--links", "https://example.invalid/x.mp4", "--commit", "HEAD"], {
    env: { GITHUB_RUN_ID: "parallel" },
  });
  record(
    "--max-parallel refuses a second machine, and creates nothing",
    run.code === 1 && /already up and --max-parallel is 1/.test(run.output) && alive().servers.length === before,
    `answered ${run.code}, ${alive().servers.length} machine(s) (was ${before})`,
    run.output,
  );
}

// ---------------------------------------------------------------------------
// 8. The sweeper spares a run that is still inside its budget
// ---------------------------------------------------------------------------
{
  const run = await orchestrate(["--sweep", "--older-than-minutes", "0"], { env: { GITHUB_RUN_ID: "sweep-careful" } });
  record(
    "the sweeper does not kill a run that is still inside its own budget",
    run.ok && alive().servers.length === 1 && /still inside its own budget/.test(run.output) && /--force/.test(run.output),
    `${alive().servers.length} machine(s) still there, and it said why`,
    run.output,
  );
}

// ---------------------------------------------------------------------------
// 9. …and deletes it when told, saying what it removed and what it cost
// ---------------------------------------------------------------------------
{
  const [leftover] = alive().servers;
  scw.backdate(leftover.id, 200);
  const dry = await orchestrate(["--sweep", "--older-than-minutes", "0", "--force", "--dry-run"], {
    env: { GITHUB_RUN_ID: "sweep-dry" },
  });
  const sweptNothing = alive().servers.length === 1 && /would remove: .*would be deleted/.test(dry.output);
  const run = await orchestrate(["--sweep", "--older-than-minutes", "0", "--force"], {
    env: { GITHUB_RUN_ID: "sweep" },
  });
  record(
    "the sweeper finds the leftover, says what it removed and what it had cost, and deletes it",
    sweptNothing &&
      run.ok &&
      nothingLeft() &&
      /removed: cliffies-scaleway-proof-killed .*deleted/.test(run.output) &&
      /had been running for about EUR 1\.\d\d/.test(run.output),
    nothingLeft() ? "nothing of this project is left at Scaleway" : `${alive().servers.length} machine(s) survived the sweep`,
    `${dry.output}\n---\n${run.output}`,
  );
}

// ---------------------------------------------------------------------------
// 10. A Scaleway that fails, and a Scaleway that refuses
// ---------------------------------------------------------------------------
{
  scw.failNext(500, 503);
  const retried = await orchestrate([SLUG, "--links", "https://example.invalid/x.mp4", "--commit", "HEAD"], {
    plan: { runExitCode: 0 },
    env: { GITHUB_RUN_ID: "flaky" },
  });
  record(
    "two failures of the API are waited out, not counted against the run",
    retried.ok && nothingLeft(),
    retried.ok ? "the run finished and left nothing behind" : `answered ${retried.code}`,
    retried.output,
  );

  const wrongKey = await orchestrate([SLUG, "--links", "https://example.invalid/x.mp4", "--commit", "HEAD"], {
    env: { GITHUB_RUN_ID: "wrongkey", SCW_SECRET_KEY: "00000000-0000-4000-8000-000000000000" },
  });
  record(
    "a key Scaleway refuses stops the run at once, with nothing created",
    wrongKey.code === 1 &&
      nothingLeft() &&
      /401/.test(wrongKey.output) &&
      /SCW_SECRET_KEY is wrong, or the cliffie-ingest application has no rights/.test(wrongKey.output),
    `answered ${wrongKey.code}, ${alive().servers.length} machine(s) created`,
    wrongKey.output,
  );
}

// ---------------------------------------------------------------------------
// 11. No secret anywhere it could be read
// ---------------------------------------------------------------------------
{
  const everything = [
    ...results.map((result) => result.output),
    ...scw.log.map((entry) => `${entry.path}${entry.query} ${entry.raw ?? ""}`),
    ...scw.cloudInits.map((entry) => entry.content),
  ].join("\n");
  const found = ALL_SECRETS.filter((secret) => everything.includes(secret));
  // The token is a header on every call, and that is the only place it may be.
  const inUrl = scw.log.filter((entry) => (entry.query ?? "").includes(SCW_SECRET));
  record(
    "no secret is ever in a log line, a request body, a URL, a tag or a cloud-init",
    found.length === 0 && inUrl.length === 0,
    found.length === 0
      ? `${scw.log.length} requests and ${results.length} outputs scanned, ${scw.log.filter((e) => e.token === SCW_SECRET).length} carried the token as a header, 0 anywhere else`
      : `${found.length} secret(s) leaked`,
  );
}

// ---------------------------------------------------------------------------
// 12. The cloud-init the machine really got
// ---------------------------------------------------------------------------
{
  const sent = scw.cloudInits[0]?.content ?? "";
  const problems = [];
  let parsed = null;
  try {
    parsed = parse(sent);
  } catch (error) {
    problems.push(`it is not YAML: ${error.message}`);
  }
  if (!sent.startsWith("#cloud-config")) problems.push("it does not start with #cloud-config");
  const files = Object.fromEntries((parsed?.write_files ?? []).map((file) => [file.path, file.content]));
  const install = files["/usr/local/bin/cliffies-install"] ?? "";
  const runScript = files["/usr/local/bin/cliffies-run"] ?? "";
  if (!install.includes(FFMPEG_URL)) problems.push("it does not install the ffmpeg this repository pins");
  if (!install.includes(`${FFMPEG_SHA256}  ffmpeg.tar.xz`)) problems.push("it does not check that ffmpeg's hash");
  if (!/shutdown -P \+360 /.test(install)) problems.push("it has no shutdown: a killed run would cost a month");
  if (!(parsed?.users ?? []).some((user) => (user.ssh_authorized_keys ?? []).some((key) => key.startsWith("ssh-")))) {
    problems.push("it carries no key to talk to the machine with");
  }
  if (!/^\s*runcmd:/m.test(sent)) problems.push("nothing is ever run");
  // The command sent over ssh takes no arguments at all: everything arrives on
  // its stdin. A script that read $1 would be a shell word away from a link.
  if (/\$1|\$@|\$\*/.test(runScript)) problems.push("the run script reads arguments; links must never be shell words");
  if (!runScript.includes("node scripts/cloud-ingest.mjs")) problems.push("it does not run the ingest this repository tests");
  record(
    "the cloud-init parses, pins the tools, carries the shutdown and takes no arguments",
    problems.length === 0,
    problems.join("; ") || `${sent.length} bytes of cloud-config, ${Object.keys(files).length} scripts, shutdown at +360 min`,
    sent.slice(0, 1500),
  );
}

// ---------------------------------------------------------------------------
// 13. The commands inside that cloud-init, run here, on real video
// ---------------------------------------------------------------------------
{
  const sent = scw.cloudInits[0]?.content ?? "";
  const files = Object.fromEntries((parse(sent)?.write_files ?? []).map((file) => [file.path, file.content]));
  const runScript = files["/usr/local/bin/cliffies-run"] ?? "";

  // A delivery of one file per episode, behind two links.
  const deliveryRoot = join(work, "content-series");
  const deliveryDir = join(deliveryRoot, SLUG);
  mkdirSync(join(deliveryDir, "captions"), { recursive: true });
  for (let i = 1; i <= 2; i += 1) {
    cpSync(join(standIn, "captions", "episode-1.en.vtt"), join(deliveryDir, "captions", `episode-${i}.en.vtt`));
  }
  writeFileSync(
    join(deliveryDir, "series.json"),
    `${JSON.stringify(
      {
        schemaVersion: 1,
        seriesId: "series_scaleway_proof",
        seriesSlug: SLUG,
        title: "Scaleway Proof",
        status: "published",
        defaultLocale: "en",
        producerId: "prod_scaleway_proof",
        producerOfRecord: "PROJECT FLOW — scaleway proof",
        socialClipsAllowed: false,
        allowBelow1080p: true,
        episodeDurationMs: { min: 8000, max: 15000 },
        genres: ["thriller"],
        tropes: ["night"],
        rights: { territories: ["WORLD"], languages: ["en"], windowStart: null, windowEnd: null },
        localizedMetadata: { en: { title: "Scaleway Proof", hook: "Scaleway proof.", description: "Scaleway proof." } },
        episodes: [1, 2].map((number) => ({
          episodeNumber: number,
          master: `masters/EP0${number}.mp4`,
          title: `Part ${number}`,
          hook: "Scaleway proof.",
          captions: [{ language: "en", file: `captions/episode-${number}.en.vtt`, kind: "captions", default: true }],
        })),
      },
      null,
      2,
    )}\n`,
  );

  const linkServer = createServer((request, response) => {
    const number = request.url.includes("two") ? 2 : 1;
    const bytes = readFileSync(join(standIn, "masters", `episode-${number}.mp4`));
    response.writeHead(200, {
      "content-type": "video/mp4",
      "content-length": bytes.length,
      "content-disposition": `attachment; filename="EP0${number}.mp4"`,
    });
    response.end(request.method === "HEAD" ? undefined : bytes);
  });
  await new Promise((ready) => linkServer.listen(0, "127.0.0.1", ready));
  const link = `http://127.0.0.1:${linkServer.address().port}`;

  const delivery = join(work, "delivery");
  /**
   * The only things replaced are what a shell would have replaced: the
   * variables the machine reads off its stdin, and the two fixed folders of
   * that machine. The commands themselves are read out of the cloud-init,
   * never copied here — so a command that changed there fails here.
   */
  const substitute = (line) =>
    line
      .split('"$CLIFFIES_SLUG"')
      .join(`"${SLUG}"`)
      // A real run is given 340 minutes; an episode of an unmeasured delivery
      // is guessed at 24 minutes, so a smaller budget here would prove only
      // that cloud-ingest refuses to start what it cannot finish.
      .split('"$CLIFFIES_BUDGET_MINUTES"')
      .join('"60"')
      .split("$CLIFFIES_LINKS")
      .join(`${link}/one.mp4 ${link}/two.mp4`)
      .split("/work/delivery")
      .join(`"${delivery}"`)
      .split("/work/out")
      .join(`"${join(work, "out")}"`);
  const commands = runScript
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith("node scripts/"))
    // The proposer has its own proof, on a file built for it (npm run proof:split).
    .filter((line) => !line.includes("split-compilation.mjs propose"))
    .map(substitute);
  const extra = {
    "cloud-ingest.mjs": [
      "--delivery-root",
      deliveryRoot,
      "--generated-root",
      join(work, "generated"),
      "--records-root",
      join(work, "records"),
      "--publish-root",
      join(work, "published"),
      "--stage-root",
      join(work, "stage"),
    ],
  };
  const argvOf = (line) => {
    const out = [];
    const pattern = /"([^"]*)"|(\S+)/g;
    let match;
    while ((match = pattern.exec(line)) !== null) out.push(match[1] ?? match[2]);
    return out;
  };

  let failure = null;
  const ran = [];
  for (const command of commands) {
    const argv = argvOf(command).slice(1);
    const script = argv[0];
    const more = Object.entries(extra).find(([name]) => script.endsWith(name))?.[1] ?? [];
    // Never spawnSync here: the link server and the media store live in this
    // process, and a blocked event loop answers neither.
    const result = await new Promise((done) => {
      const child = spawn(process.execPath, [join(repoRoot, ...script.split("/")), ...argv.slice(1), ...more], {
        env: {
          ...process.env,
          MEDIA_BASE_URL: store.endpoint,
          R2_ENDPOINT: store.endpoint,
          R2_ACCESS_KEY_ID: "AKIDSCALEWAY",
          R2_SECRET_ACCESS_KEY: R2_SECRET,
          R2_BUCKET: "scaleway-proof-media",
        },
      });
      let said = "";
      child.stdout.on("data", (chunk) => (said += chunk));
      child.stderr.on("data", (chunk) => (said += chunk));
      child.on("close", (status) => done({ status, said }));
    });
    ran.push(`${script} → ${result.status}`);
    if (result.status !== 0) {
      failure = `${script} answered ${result.status}:\n${result.said.slice(-2000)}`;
      break;
    }
  }
  linkServer.close();
  const manifest = join(work, "generated", `${SLUG}.ts`);
  const urls = existsSync(manifest) ? [...readFileSync(manifest, "utf8").matchAll(/"(https?:\/\/[^"]+)"/g)].map((m) => m[1]) : [];
  const uploads = store.log.filter((entry) => entry.method === "PUT").length;
  const problems = [];
  if (failure) problems.push(failure);
  if (commands.length !== 3) problems.push(`${commands.length} commands were read out of the cloud-init, not 3`);
  if (urls.length === 0) problems.push("the manifest names no media on the store");
  if (uploads === 0) problems.push("nothing was uploaded");
  for (const url of urls.slice(0, 8)) {
    const response = await fetch(url);
    if (response.status !== 200) problems.push(`${url} answered ${response.status}`);
  }
  record(
    "the ingest commands the machine is given run here, on real video, and publish",
    problems.length === 0,
    problems.join("; ") || `${ran.join(", ")}; ${uploads} objects uploaded, ${urls.length} URLs in the manifest, all fetched back`,
    ran.join("\n"),
  );
}

// --- what the proof borrowed from the working copy, given back ---------------
rmSync(join(repoRoot, ".split-work", SLUG), { recursive: true, force: true });
rmSync(join(repoRoot, ".ingest-records", `${SLUG}.json`), { force: true });

await store.close();
await scw.close();

console.error("\nscaleway-proof: a machine that is made, used and unmade — and never left behind\n");
for (const result of results) console.error(`  ${result.ok ? "ok  " : "FAIL"}  ${result.name} — ${result.detail}`);
const failed = results.filter((result) => !result.ok);
if (failed.length > 0) {
  for (const result of failed) console.error(`\n--- ${result.name} ---\n${result.output.slice(-4000)}`);
  console.error(`\nscaleway-proof: ${failed.length} case(s) did not behave as declared`);
  if (!keep) rmSync(work, { recursive: true, force: true });
  process.exit(1);
}
console.error(`\nscaleway-proof: ${results.length} cases, all as declared`);
console.error("scaleway-proof: nothing here touched the real Scaleway API, and no credential of it exists in this environment");
if (keep) console.error(`scaleway-proof: files kept in ${work}`);
else rmSync(work, { recursive: true, force: true });
