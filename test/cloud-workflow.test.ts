/**
 * The workflow the owner runs from his phone
 * (.github/workflows/ingest-from-link.yml), read as GitHub reads it.
 *
 * It cannot be run here, so what CAN be checked is checked: that it parses,
 * that every script it calls exists and is the one this repository tests,
 * that ffmpeg is pinned to a build with a published hash, that what the owner
 * types never becomes a shell command, that the secrets it uses are the ones
 * the owner's guide tells him to create, and that a job cannot outlive the
 * six hours GitHub allows.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";

import { MEDIA_ENV } from "../scripts/lib/media-publish.mjs";

const repoRoot = join(__dirname, "..");
const path = join(repoRoot, ".github", "workflows", "ingest-from-link.yml");
const source = readFileSync(path, "utf8");
const workflow = parse(source) as {
  on: { workflow_dispatch: { inputs: Record<string, { type: string; required?: boolean; options?: string[] }> } };
  permissions: Record<string, string>;
  concurrency: { group: string };
  jobs: Record<string, { "runs-on": string; "timeout-minutes": number; env: Record<string, string>; steps: Step[] }>;
};
type Step = { name?: string; uses?: string; run?: string; if?: string; with?: Record<string, string>; env?: Record<string, string> };
const job = workflow.jobs.ingest;
const steps = job.steps;
const runLines = steps.flatMap((step) => (step.run ?? "").split("\n"));

describe("the workflow the owner runs", () => {
  it("parses, and is one job that cannot outlive a GitHub job", () => {
    expect(Object.keys(workflow.jobs)).toEqual(["ingest"]);
    expect(job["runs-on"]).toBe("ubuntu-24.04");
    expect(job["timeout-minutes"]).toBeLessThanOrEqual(355);
    // Two runs on the same series would encode the same episodes twice.
    expect(workflow.concurrency.group).toContain("inputs.slug");
  });

  it("asks for a series, its links and a mode, and nothing else", () => {
    const inputs = workflow.on.workflow_dispatch.inputs;
    expect(Object.keys(inputs).sort()).toEqual(["continuation", "links", "mode", "slug"]);
    expect(inputs.slug.required).toBe(true);
    expect(inputs.links.required).toBe(true);
    expect(inputs.mode.options).toEqual(["propose-cuts", "publish"]);
  });

  it("may write the repository (the manifest) and start its own continuation", () => {
    expect(workflow.permissions).toMatchObject({ contents: "write", actions: "write" });
  });

  it("pins ffmpeg to a build whose hash is checked before it runs", () => {
    expect(job.env.FFMPEG_URL).toMatch(/^https:\/\/github\.com\/BtbN\/FFmpeg-Builds\/releases\/download\/autobuild-/);
    expect(job.env.FFMPEG_URL).toMatch(/ffmpeg-n8\.[\d.]+-\d+-g[0-9a-f]+-linux64-gpl-8\.\d+\.tar\.xz$/);
    expect(job.env.FFMPEG_SHA256).toMatch(/^[0-9a-f]{64}$/);
    expect(source).toContain("sha256sum -c -");
    // And it refuses a build that cannot do the work, before downloading anything.
    const checkAt = steps.findIndex((step) => (step.run ?? "").includes("check-ffmpeg"));
    const fetchAt = steps.findIndex((step) => (step.run ?? "").includes("fetch-delivery"));
    expect(checkAt).toBeGreaterThan(-1);
    expect(checkAt).toBeLessThan(fetchAt);
  });

  it("calls only scripts that exist here", () => {
    const called = [...source.matchAll(/node (scripts\/[\w.-]+\.mjs)/g)].map((match) => match[1]);
    expect(called.length).toBeGreaterThanOrEqual(4);
    for (const script of new Set(called)) expect(existsSync(join(repoRoot, script))).toBe(true);
    expect(new Set(called)).toEqual(
      new Set([
        "scripts/check-ffmpeg.mjs",
        "scripts/fetch-delivery.mjs",
        "scripts/split-compilation.mjs",
        "scripts/cloud-ingest.mjs",
      ]),
    );
  });

  it("never puts what the owner typed into a shell line", () => {
    // A link is data. Interpolated by Actions it would be a command.
    const interpolated = runLines.filter((line) => /\$\{\{\s*(inputs|github\.event)/.test(line));
    expect(interpolated).toEqual([]);
    expect(job.env.SLUG).toBe("${{ inputs.slug }}");
    expect(job.env.LINKS).toBe("${{ inputs.links }}");
    // Word splitting is wanted for several links; globbing never is.
    expect(source).toContain("set -euf -o pipefail");
  });

  it("gives the media store's secrets only to the step that publishes", () => {
    const withSecrets = steps.filter((step) => JSON.stringify(step.env ?? {}).includes("secrets."));
    expect(withSecrets).toHaveLength(2);
    const publish = withSecrets.find((step) => (step.run ?? "").includes("cloud-ingest"));
    expect(publish).toBeDefined();
    expect(Object.keys(publish?.env ?? {}).sort()).toEqual([...MEDIA_ENV].sort());
    for (const name of MEDIA_ENV) {
      expect(publish?.env?.[name]).toBe(`\${{ secrets.${name} }}`);
      // The owner's guide must tell him to create exactly these.
      expect(readFileSync(join(repoRoot, "docs", "cloud-ingest.md"), "utf8")).toContain(name);
    }
  });

  it("sends the proposal back as an artifact, and publishes only when the run finished", () => {
    const artifact = steps.find((step) => (step.uses ?? "").startsWith("actions/upload-artifact"));
    expect(artifact?.if).toContain("propose-cuts");
    expect(artifact?.with?.["if-no-files-found"]).toBe("error");
    const commit = steps.find((step) => (step.run ?? "").includes("git push"));
    expect(commit?.if).toContain("env.INGEST_EXIT == '0'");
    // Only the generated manifest is committed: no video ever reaches the repository.
    expect(commit?.run).toContain("git add packages/feed-domain/src/data/generated");
    expect(commit?.run).not.toMatch(/git add (-A|\.)/);
  });

  it("continues itself when a series needs more than one job, but not forever", () => {
    const again = steps.find((step) => (step.run ?? "").includes("gh workflow run"));
    expect(again?.if).toContain("env.INGEST_EXIT == '3'");
    expect(again?.if).toContain("fromJSON(inputs.continuation) < 8");
  });

  it("says how many runner minutes it used, whatever happened", () => {
    const minutes = steps[steps.length - 1];
    expect(minutes?.if).toBe("always()");
    expect(minutes?.run).toContain("GITHUB_STEP_SUMMARY");
    expect(minutes?.run).toContain("2000");
  });

  it("keeps what it learned, so a second run does not encode again", () => {
    const restore = steps.find((step) => (step.uses ?? "").includes("cache/restore"));
    const save = steps.find((step) => (step.uses ?? "").includes("cache/save"));
    expect(restore?.with?.path).toBe(".ingest-records");
    expect(save?.with?.path).toBe(".ingest-records");
    expect(save?.if).toContain("always()");
    expect(readFileSync(join(repoRoot, ".gitignore"), "utf8")).toContain(".ingest-records/");
  });
});
