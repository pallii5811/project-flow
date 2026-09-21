/**
 * The machine made for one series: what it would cost before it exists, what
 * it is told to do at boot, and how the client behaves against an API that
 * answers — and refuses — the way Scaleway's reference says it does
 * (scripts/lib/fake-scaleway.mjs).
 *
 * What is NOT here, and cannot be: a call to the real Scaleway API. No
 * credential for it exists in this repository or in the environment it was
 * written in, and none was invented. What these tests prove is the behaviour
 * of our side of the wire.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { parse } from "yaml";

import { startFakeScaleway } from "../scripts/lib/fake-scaleway.mjs";
import { APT_PACKAGES, FFMPEG_SHA256, FFMPEG_URL, NODE_SNAP_CHANNEL } from "../scripts/lib/pinned-tools.mjs";
import {
  billedMinutes,
  cloudInit,
  costEur,
  costLine,
  DEFAULT_BUDGET_MINUTES,
  ENV_SENTINEL,
  envLines,
  estimateMinutes,
  humanMinutes,
  INSTANCE_PRICES,
  instanceName,
  planLines,
  planRun,
  priceOf,
  PRICES_VERIFIED_ON,
  RUN_TAG,
  volumeGbFor,
} from "../scripts/lib/scaleway-plan.mjs";
import { createScalewayClient, redact, scalewayConfig, ScalewayError } from "../scripts/lib/scaleway.mjs";

const repoRoot = join(__dirname, "..");
const SECRET = "11111111-2222-4333-8444-555555555555";
const PROJECT = "99999999-8888-4777-8666-555555555555";
const KEY = "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA cliffies";

describe("what a run would cost, before anything exists", () => {
  it("knows the price of the two machines the owner chose, with the day it was read", () => {
    expect(Object.keys(INSTANCE_PRICES).sort()).toEqual(["STANDARD2-A16C-64G", "STANDARD2-A24C-96G"]);
    expect(priceOf("STANDARD2-A16C-64G")).toMatchObject({ eurPerHour: 0.5039, vcpu: 16 });
    expect(PRICES_VERIFIED_ON).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("has no price for a machine nobody priced — null, never zero", () => {
    expect(priceOf("GP1-XL")).toBeNull();
    const plan = planRun({ slug: "x", runId: "1", type: "GP1-XL", videoMinutes: 90 });
    expect(plan.price.eurPerHour).toBeNull();
    expect(plan.estimate.eur).toBeNull();
    expect(plan.estimate.worstCaseEur).toBeNull();
    // Nothing is ever multiplied by an absent price.
    expect(costEur(120, null as unknown as number)).toBeNull();
    expect(costEur(null as unknown as number, 0.5)).toBeNull();
  });

  it("bills by the started minute, and never less than one", () => {
    expect(billedMinutes(0)).toBe(1);
    expect(billedMinutes(59_000)).toBe(1);
    expect(billedMinutes(61_000)).toBe(2);
    expect(billedMinutes(3 * 3_600_000)).toBe(180);
    expect(costEur(180, 0.5039)).toBeCloseTo(1.5117, 4);
  });

  it("estimates from a measurement that exists, and says it is an estimate", () => {
    // 3.5 minutes of two cores per minute of video (docs/standard.md §3),
    // discounted for how badly x264 scales, plus the fixed twelve.
    expect(estimateMinutes({ videoMinutes: 90, vcpu: 16 })).toBe(78);
    expect(estimateMinutes({ videoMinutes: 90, vcpu: 24 })).toBe(56);
    expect(estimateMinutes({ videoMinutes: null as unknown as number, vcpu: 16 })).toBeNull();
    const lines = planLines(planRun({ slug: "night-shift", runId: "7", videoMinutes: 90 })).join("\n");
    expect(lines).toContain("AN ESTIMATE, not a measurement");
    expect(lines).toContain(PRICES_VERIFIED_ON);
    expect(lines).toContain("most it can cost  EUR 3.02");
    expect(lines).toContain("not known here, and not invented");
  });

  it("gives the disk the delivery needs, and the ingest less time than the wall", () => {
    expect(volumeGbFor({ deliveryGb: null as unknown as number })).toBe(50);
    expect(volumeGbFor({ deliveryGb: 20 })).toBe(100);
    expect(volumeGbFor({ deliveryGb: 4000 })).toBe(600);
    const plan = planRun({ slug: "x", runId: "1", budgetMinutes: DEFAULT_BUDGET_MINUTES });
    expect(plan.remoteBudgetMinutes).toBe(340);
    expect(planRun({ slug: "x", runId: "1", budgetMinutes: 20 }).remoteBudgetMinutes).toBe(10);
    expect(plan.tags).toEqual([RUN_TAG, "slug:x", "run:1"]);
  });

  it("names a machine the way Scaleway accepts, however the slug is written", () => {
    expect(instanceName("night-shift", "42")).toBe("cliffies-night-shift-42");
    expect(instanceName("Night Shift!", "x")).toBe("cliffies-night-shift-x");
    expect(instanceName("a".repeat(80), "1").length).toBeLessThanOrEqual(63);
  });

  it("says what a run cost in one line, whatever happened to it", () => {
    const line = costLine({ minutes: 83, eurPerHour: 0.5039, type: "STANDARD2-A16C-64G" });
    expect(line).toContain("1 h 23 min");
    expect(line).toContain("EUR 0.70");
    expect(line).toContain("measured wall clock");
    expect(humanMinutes(59)).toBe("59 min");
    expect(humanMinutes(60)).toBe("1 h 00 min");
  });
});

describe("what the machine is told, on its stdin and nowhere else", () => {
  it("writes NAME=value lines, ends them, and leaves out what is not there", () => {
    const lines = envLines({ A: "1", B: "", C: null, D: undefined, E: "x y" });
    expect(lines).toEqual(["A=1", "E=x y", ENV_SENTINEL]);
  });

  it("refuses a value carrying a line break: it would become another variable", () => {
    expect(() => envLines({ LINKS: "https://a\nR2_SECRET_ACCESS_KEY=stolen" })).toThrow(/line break/);
    expect(() => envLines({ "not a name": "x" })).toThrow(/environment name/);
  });
});

describe("the cloud-init the machine boots with", () => {
  const text = cloudInit({ publicKey: KEY, shutdownMinutes: 330 });
  const parsed = parse(text) as {
    users: { name: string; ssh_authorized_keys: string[] }[];
    write_files: { path: string; content: string; permissions: string }[];
    runcmd: string[][];
  };
  const files = Object.fromEntries(parsed.write_files.map((file) => [file.path, file.content]));

  it("is YAML, starts with the line cloud-init looks for, and runs one thing", () => {
    expect(text.startsWith("#cloud-config")).toBe(true);
    expect(parsed.runcmd).toEqual([["/usr/local/bin/cliffies-install"]]);
    expect(Object.keys(files).sort()).toEqual([
      "/usr/local/bin/cliffies-collect",
      "/usr/local/bin/cliffies-install",
      "/usr/local/bin/cliffies-run",
    ]);
    for (const file of parsed.write_files) expect(file.permissions).toBe("0755");
  });

  it("carries the public half of a key, and no secret of any kind", () => {
    expect(parsed.users[0].ssh_authorized_keys).toEqual([KEY]);
    expect(text).not.toMatch(/PRIVATE KEY/);
    expect(text).not.toMatch(/R2_SECRET|SCW_SECRET|Authorization|x-auth-token/i);
    expect(() => cloudInit({ publicKey: "not a key", shutdownMinutes: 10 })).toThrow(/public ssh key/);
    expect(() => cloudInit({ publicKey: KEY, shutdownMinutes: 0 })).toThrow(/minutes/);
  });

  it("powers the machine off by itself, whatever happens to whoever made it", () => {
    expect(files["/usr/local/bin/cliffies-install"]).toContain("shutdown -P +330 ");
    // And that is the third line of the script, not the last: a failure after
    // it still leaves a machine that switches itself off.
    const lines = files["/usr/local/bin/cliffies-install"].split("\n");
    const at = lines.findIndex((line) => line.startsWith("shutdown -P"));
    expect(at).toBeGreaterThan(-1);
    expect(at).toBeLessThan(12);
  });

  it("installs the ffmpeg this repository pins, and checks its hash before unpacking", () => {
    const install = files["/usr/local/bin/cliffies-install"];
    expect(install).toContain(`curl -fsSL "${FFMPEG_URL}" -o ffmpeg.tar.xz`);
    expect(install).toContain(`echo "${FFMPEG_SHA256}  ffmpeg.tar.xz" | sha256sum -c -`);
    expect(install.indexOf("sha256sum -c -")).toBeLessThan(install.indexOf("tar -xJf"));
    expect(install).toContain(`snap install node --classic --channel=${NODE_SNAP_CHANNEL}`);
  });

  it("pins the same ffmpeg as the workflow: the two cannot drift", () => {
    const workflow = readFileSync(join(repoRoot, ".github", "workflows", "ingest-from-link.yml"), "utf8");
    const job = (parse(workflow) as { jobs: { ingest: { env: Record<string, string> } } }).jobs.ingest.env;
    expect(job.FFMPEG_URL).toBe(FFMPEG_URL);
    expect(job.FFMPEG_SHA256).toBe(FFMPEG_SHA256);
  });

  it("uses only commands a plain Ubuntu cloud image has, or installs them first", () => {
    /** In the image (coreutils, util-linux, systemd, snapd, bash builtins). */
    const inImage = new Set([
      "apt-get",
      "awk",
      "bash",
      "chmod",
      "chown",
      "curl",
      "date",
      "df",
      "echo",
      "head",
      "lsblk",
      "mkdir",
      "mkfs.ext4",
      "mount",
      "nproc",
      "rm",
      "sha256sum",
      "shutdown",
      "snap",
      "tail",
      "tar",
      "touch",
      "tr",
      "yt-dlp",
    ]);
    /** Shell keywords and builtins: nothing to install for these. */
    const shell = new Set([
      "break",
      "case",
      "cd",
      "command",
      "continue",
      "do",
      "done",
      "elif",
      "else",
      "esac",
      "exec",
      "exit",
      "export",
      "fi",
      "for",
      "if",
      "return",
      "set",
      "then",
      "trap",
      "umask",
      "while",
      "}",
      "{",
    ]);
    /** What this cloud-init itself put on the machine before using it. */
    const weInstall = new Set(["/opt/ffmpeg/bin/ffmpeg", "/snap/bin/node", "node", "ffmpeg"]);
    const apt = new Set(Object.keys(APT_PACKAGES));

    const unknown = new Set<string>();
    for (const [path, content] of Object.entries(files)) {
      /** A script may define its own helper and then call it. */
      const own = new Set(
        content
          .split("\n")
          .map((line) => /^([a-z_][a-z0-9_]*)\(\)/.exec(line.trim())?.[1])
          .filter(Boolean) as string[],
      );
      const known = (word: string) =>
        shell.has(word) || inImage.has(word) || weInstall.has(word) || apt.has(word) || own.has(word);

      for (const raw of content.split("\n")) {
        const line = raw.trim();
        if (line === "" || line.startsWith("#")) continue;
        const words: string[] = [];
        // A command substitution starts a command of its own.
        for (const found of line.matchAll(/\$\(\s*([^\s)]+)/g)) words.push(found[1]);
        let rest = line.replace(/\$\([^)]*\)/g, " ");
        // A case pattern is not a command: what follows the ) is.
        const pattern = /^[^\s;]*\)\s*(.*)$/.exec(rest);
        if (pattern) rest = pattern[1];
        // What is inside quotes is text, not a command — and it carries the
        // semicolons and pipes that would otherwise look like one.
        rest = rest.replace(/"[^"]*"/g, ' "" ').replace(/'[^']*'/g, " '' ");
        // …and every place a command can start: the line, a pipe, a semicolon.
        for (const piece of rest.split(/[|;]/)) {
          let tokens = piece.trim().split(/\s+/).filter(Boolean);
          // NAME=value prefixes (DEBIAN_FRONTEND=noninteractive apt-get …)
          while (tokens.length > 0 && /^[A-Za-z_][A-Za-z0-9_]*=/.test(tokens[0])) tokens = tokens.slice(1);
          if (tokens[0]) words.push(tokens[0]);
        }
        for (const word of words) {
          if (!word || known(word)) continue;
          // A test, a function being defined, a redirection, a bare argument.
          if (/^[a-z_]+\(\)$/.test(word) || word === "[" || word === "]" || word === ":") continue;
          if (/^[-"'<>&]/.test(word)) continue;
          unknown.add(`${path}: ${word}`);
        }
      }
    }
    expect([...unknown]).toEqual([]);
  });

  it("gives the run no arguments at all: a link can never be a shell word", () => {
    const run = files["/usr/local/bin/cliffies-run"];
    expect(run).not.toMatch(/\$1|\$2|\$@|\$\*/);
    expect(run).toContain(`if [ "$line" = "${ENV_SENTINEL}" ]; then break; fi`);
    // A slug that is not a slug, a mode that is not a mode, a budget that is
    // not a number: refused there too, not only here.
    expect(run).toContain('""|*[!a-z0-9-]*)');
    expect(run).toContain("publish|propose-cuts|auto-publish) ;;");
    expect(run).toContain("node scripts/check-ffmpeg.mjs");
    expect(run).toContain("node scripts/cloud-ingest.mjs");
  });

  it("brings back only small files, from paths this repository knows", () => {
    expect(files["/usr/local/bin/cliffies-collect"]).toContain("repo/packages/feed-domain/src/data/generated");
    expect(files["/usr/local/bin/cliffies-collect"]).toContain("repo/.ingest-records");
    const ignore = readFileSync(join(repoRoot, ".gitignore"), "utf8");
    expect(ignore).toContain(".split-work/");
    expect(ignore).toContain(".ingest-records/");
  });
});

describe("the client, against an API that answers like Scaleway's", () => {
  let fake: Awaited<ReturnType<typeof startFakeScaleway>>;
  let api: ReturnType<typeof createScalewayClient>;

  beforeAll(async () => {
    fake = await startFakeScaleway({ secretKey: SECRET, projectId: PROJECT, zone: "fr-par-1", pollsToSettle: 3 });
    api = createScalewayClient(
      { secretKey: SECRET, projectId: PROJECT, zone: "fr-par-1", baseUrl: fake.url },
      { backoffMs: 1, retries: 4 },
    );
  });
  afterAll(async () => {
    await fake.close();
  });

  it("refuses to start without the names it needs, and never prints a value", () => {
    const bad = scalewayConfig({ SCW_SECRET_KEY: "hunter2", SCW_ZONE: "paris" });
    expect(bad.ok).toBe(false);
    const said = (bad as { problems: string[] }).problems.join("\n");
    expect(said).toContain("SCW_PROJECT_ID is not set");
    expect(said).toContain("does not look like a Scaleway secret key");
    expect(said).not.toContain("hunter2");
    const good = scalewayConfig({ SCW_SECRET_KEY: SECRET, SCW_PROJECT_ID: PROJECT, SCW_ZONE: "nl-ams-1" });
    expect(good.ok).toBe(true);
  });

  it("turns an image label into the id that machine can boot", async () => {
    const id = await api.resolveImage("ubuntu_noble", { commercialType: "STANDARD2-A16C-64G" });
    expect(id).toMatch(/^[0-9a-f-]{36}$/);
    expect(await api.resolveImage(id, { commercialType: "STANDARD2-A16C-64G" })).toBe(id);
    await expect(api.resolveImage("debian_ancient", { commercialType: "STANDARD2-A16C-64G" })).rejects.toThrow(
      /no image called "debian_ancient"/,
    );
  });

  it("makes a disk and a machine in the project, with the tags the sweeper looks for", async () => {
    const volume = await api.createVolume({
      name: "cliffies-x-work",
      sizeGb: 50,
      volumeType: "sbs_volume",
      tags: [RUN_TAG, "run:1"],
    });
    expect(volume.size).toBe(50_000_000_000);
    const server = await api.createServer({
      name: "cliffies-x-1",
      commercialType: "STANDARD2-A16C-64G",
      image: "11111111-2222-3333-4444-555555555555",
      tags: [RUN_TAG, "run:1"],
    });
    expect(server.state).toBe("stopped");
    await api.setCloudInit(server.id, cloudInit({ publicKey: KEY, shutdownMinutes: 10 }));
    expect(fake.cloudInits.at(-1)?.content).toContain("#cloud-config");
    await api.attachVolume(server.id, volume.id);
    expect(fake.volumes.get(volume.id)?.server).toBe(server.id);

    // Only what carries the tag comes back.
    expect((await api.listServers({ tag: RUN_TAG })).map((s) => s.id)).toEqual([server.id]);
    expect(await api.listServers({ tag: "someone-else" })).toEqual([]);
  });

  it("waits for a machine to really be running, and hands back its address", async () => {
    const [server] = await api.listServers({ tag: RUN_TAG });
    await api.action(server.id, "poweron");
    const polls: string[] = [];
    const running = await api.waitForServer(server.id, {
      states: ["running"],
      intervalMs: 2,
      timeoutMs: 5_000,
      onPoll: (seen: { state: string }) => polls.push(seen.state),
    });
    expect(polls.length).toBeGreaterThan(1);
    expect(polls[0]).toBe("starting");
    expect(running.state).toBe("running");
    expect(api.publicIpOf(running)).toMatch(/^203\.0\.113\./);
  });

  it("refuses to delete a machine that is still running — and says so", async () => {
    const [server] = await api.listServers({ tag: RUN_TAG });
    await expect(api.deleteServer(server.id)).rejects.toMatchObject({ name: "ScalewayError", status: 400 });
    await api.action(server.id, "poweroff");
    await api.waitForServer(server.id, { states: ["stopped"], intervalMs: 2, timeoutMs: 5_000 });
    const [volume] = await api.listVolumes({ tag: RUN_TAG });
    await expect(api.deleteVolume(volume.id)).rejects.toThrow(/still attached/);
    await api.detachVolume(server.id, volume.id);
    await api.deleteServer(server.id);
    await api.deleteVolume(volume.id);
    expect(await api.listServers({ tag: RUN_TAG })).toEqual([]);
    expect(await api.listVolumes({ tag: RUN_TAG })).toEqual([]);
  });

  it("a thing that is not there is null, not an error and not an empty one", async () => {
    expect(await api.getServer("00000000-0000-4000-8000-000000000000")).toBeNull();
    expect(await api.getVolume("00000000-0000-4000-8000-000000000000")).toBeNull();
    // Deleting what is already gone is what a teardown does twice: it must pass.
    await expect(api.deleteServer("00000000-0000-4000-8000-000000000000")).resolves.toBeUndefined();
  });

  it("waits out a Scaleway that is having a bad minute", async () => {
    fake.failNext(500, 429, 503);
    const before = api.stats.retried;
    const server = await api.createServer({
      name: "cliffies-retry",
      commercialType: "STANDARD2-A16C-64G",
      image: "11111111-2222-3333-4444-555555555555",
      tags: [RUN_TAG],
    });
    expect(server.id).toBeTruthy();
    expect(api.stats.retried - before).toBe(3);
    await api.deleteServer(server.id);
  });

  it("stops at once on a refusal, with the token nowhere in the message", async () => {
    const wrong = createScalewayClient(
      { secretKey: "00000000-1111-4222-8333-444444444444", projectId: PROJECT, zone: "fr-par-1", baseUrl: fake.url },
      { backoffMs: 1 },
    );
    const before = wrong.stats.requests;
    await expect(wrong.listServers({ tag: RUN_TAG })).rejects.toMatchObject({ status: 401 });
    // One request, not five: retrying a wrong key does not make it right.
    expect(wrong.stats.requests - before).toBe(1);
    try {
      await wrong.listServers({ tag: RUN_TAG });
    } catch (error) {
      expect((error as ScalewayError).message).not.toContain("00000000-1111-4222-8333-444444444444");
      expect((error as ScalewayError).message).toContain("SCW_SECRET_KEY is wrong");
    }
  });

  it("never lets a secret through redact(), whatever shape it is in", () => {
    expect(redact(`token=${SECRET} here`, [SECRET])).toBe("token=[redacted] here");
    // Even one nobody listed: anything shaped like a Scaleway id is cut short.
    expect(redact(`id ${PROJECT}`)).toBe(`id ${PROJECT.slice(0, 8)}…`);
    expect(redact("nothing to hide", [])).toBe("nothing to hide");
  });

  it("puts the token in a header, never in a URL", () => {
    expect(fake.log.length).toBeGreaterThan(10);
    expect(fake.log.filter((entry) => (entry.query ?? "").includes(SECRET))).toEqual([]);
    expect(fake.log.filter((entry) => (entry.raw ?? "").includes(SECRET))).toEqual([]);
    expect(fake.log.filter((entry) => entry.token === SECRET).length).toBeGreaterThan(10);
  });

  it("lists accessible projects via listProjects", async () => {
    const projects = await api.listProjects();
    expect(projects).toEqual([{ id: PROJECT, name: "cliffies", organization_id: "org-1" }]);
  });
});
