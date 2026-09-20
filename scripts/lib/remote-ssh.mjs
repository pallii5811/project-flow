/**
 * Talking to the machine the run just made, over ssh, with a key made for
 * that one machine and thrown away with it.
 *
 * Four things happen on that machine and nothing else does: we wait for its
 * cloud-init to finish, we send it this repository as a tar, we run one fixed
 * command, and we take back the small files it produced.
 *
 *   **The command takes no arguments.** Everything the run needs — the slug,
 *   the links, the R2 keys, the budget — goes down the standard input of that
 *   command as NAME=value lines. ssh joins argv into a single string for a
 *   remote shell, so an argument is a shell word; a line on stdin never is.
 *   That is the same rule as the workflow's ("never puts what the owner typed
 *   into a shell line"), one machine further away.
 *
 * The private key lives in a folder made by mkdtemp and deleted in a finally,
 * never in the repository; the public half goes into the cloud-init. The host
 * key is accepted on first sight: the address comes from the API answer for a
 * machine created seconds earlier, and there is no out-of-band fingerprint to
 * check it against — a declared limit, written down in docs/cloud-ingest.md.
 */
import { Buffer } from "node:buffer";
import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** The one command the machine ever runs for us, and the one that hands back the result. */
const RUN_COMMAND = "/usr/local/bin/cliffies-run";
const COLLECT_COMMAND = "/usr/local/bin/cliffies-collect";
const READY_COMMAND =
  "if [ -f /run/cliffies-failed ]; then echo CLIFFIES-FAILED; cat /run/cliffies-failed; " +
  "elif [ -f /run/cliffies-ready ]; then echo CLIFFIES-READY; else echo CLIFFIES-WAIT; fi";

export class RemoteError extends Error {
  constructor(message, { code = null } = {}) {
    super(message);
    this.name = "RemoteError";
    this.code = code;
  }
}

/** Makes a key pair for one run. Returns the public half and where the private one is. */
export function makeRunKey() {
  const dir = mkdtempSync(join(tmpdir(), "cliffies-key-"));
  const keyPath = join(dir, "id_ed25519");
  const made = spawnSync("ssh-keygen", ["-q", "-t", "ed25519", "-N", "", "-C", "cliffies-ingest", "-f", keyPath], {
    encoding: "utf8",
  });
  if (made.error || made.status !== 0) {
    rmSync(dir, { recursive: true, force: true });
    throw new RemoteError(
      `ssh-keygen could not make a key for this run: ${made.error?.message ?? made.stderr ?? `exit ${made.status}`}`,
    );
  }
  const publicKey = readFileSync(`${keyPath}.pub`, "utf8").trim();
  return {
    keyPath,
    publicKey,
    forget() {
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

/** Refuses early, with words, when the machine running this has no ssh. */
export function sshAvailable() {
  const probe = spawnSync("ssh", ["-V"], { encoding: "utf8" });
  return !probe.error;
}

/**
 * @param {{ host: string, user: string, keyPath: string, onLog?: (line: string) => void }} options
 */
export function createSshRemote({ host, user, keyPath, onLog = () => {} }) {
  const base = [
    "-i",
    keyPath,
    "-o",
    "IdentitiesOnly=yes",
    "-o",
    "BatchMode=yes",
    "-o",
    "StrictHostKeyChecking=accept-new",
    "-o",
    "UserKnownHostsFile=" + join(tmpdir(), `cliffies-known-${process.pid}`),
    "-o",
    "ConnectTimeout=10",
    "-o",
    "ServerAliveInterval=15",
    "-o",
    "ServerAliveCountMax=4",
  ];
  const target = `${user}@${host}`;
  /** @type {Set<import("node:child_process").ChildProcess>} */
  const running = new Set();

  function ssh(remoteCommand, { binary = false } = {}) {
    const child = spawn("ssh", [...base, target, remoteCommand], { stdio: ["pipe", "pipe", "pipe"] });
    running.add(child);
    const out = [];
    const err = [];
    child.stdout.on("data", (chunk) => out.push(chunk));
    child.stderr.on("data", (chunk) => err.push(chunk));
    const done = new Promise((resolve) => {
      child.on("close", (code) => {
        running.delete(child);
        resolve({
          code: code ?? 1,
          stdout: binary ? Buffer.concat(out) : Buffer.concat(out).toString("utf8"),
          stderr: Buffer.concat(err).toString("utf8"),
        });
      });
      child.on("error", (error) => {
        running.delete(child);
        resolve({ code: 255, stdout: binary ? Buffer.alloc(0) : "", stderr: String(error.message) });
      });
    });
    return { child, done };
  }

  return {
    /**
     * Waits for the cloud-init to have finished. A connection that is refused
     * is the machine still booting, not a failure — the same distinction as
     * everywhere else here: "I could not look" is not "there is nothing".
     */
    async waitReady({ timeoutMs = 12 * 60_000, intervalMs = 10_000, onWait = () => {} } = {}) {
      const until = Date.now() + timeoutMs;
      for (let attempt = 1; ; attempt += 1) {
        const { done } = ssh(READY_COMMAND);
        const result = await done;
        if (result.stdout.includes("CLIFFIES-READY")) return true;
        if (result.stdout.includes("CLIFFIES-FAILED")) {
          throw new RemoteError(
            `the machine could not install its tools:\n${result.stdout.replace("CLIFFIES-FAILED", "").trim()}`,
          );
        }
        if (Date.now() >= until) {
          throw new RemoteError(
            `the machine was not ready after ${Math.round(timeoutMs / 60_000)} minutes` +
              (result.stderr ? ` (last answer: ${result.stderr.trim().split("\n").pop()})` : ""),
            { code: "not-ready" },
          );
        }
        onWait({ attempt, stderr: result.stderr.trim().split("\n").pop() ?? "" });
        await new Promise((wake) => setTimeout(wake, intervalMs));
      }
    },

    /** Sends a tar of this repository, unpacked into the machine's work folder. */
    async sendRepo(tarStream) {
      const { child, done } = ssh("tar -x -C /work/repo");
      tarStream.pipe(child.stdin);
      const result = await done;
      if (result.code !== 0) {
        throw new RemoteError(`the repository could not be sent: ${result.stderr.trim() || `ssh exit ${result.code}`}`);
      }
      return true;
    },

    /**
     * Runs the ingest. `envLines` go down its standard input and nowhere else.
     * Every line of its output is handed to `onLine` as it arrives, so a
     * six-hour run is watched, not waited for.
     */
    async run({ envLines, onLine }) {
      const { child, done } = ssh(RUN_COMMAND);
      child.stdin.write(`${envLines.join("\n")}\n`);
      child.stdin.end();
      let pending = "";
      const feed = (chunk) => {
        pending += chunk.toString("utf8");
        const lines = pending.split(/\r?\n/);
        pending = lines.pop() ?? "";
        for (const line of lines) onLine(line);
      };
      child.stdout.on("data", feed);
      child.stderr.on("data", feed);
      const result = await done;
      if (pending) onLine(pending);
      return { code: result.code };
    },

    /** The small files the run produced, as a tar. No video ever comes back. */
    async collect() {
      const { done } = ssh(COLLECT_COMMAND, { binary: true });
      const result = await done;
      if (result.code !== 0) {
        onLog(`nothing could be collected: ${result.stderr.trim() || `ssh exit ${result.code}`}`);
        return null;
      }
      return result.stdout.length > 0 ? result.stdout : null;
    },

    /** Stops talking to the machine at once: the run is over, or being abandoned. */
    close() {
      for (const child of running) child.kill("SIGKILL");
      running.clear();
    },
  };
}
