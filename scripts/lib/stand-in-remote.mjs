/**
 * A machine that does not exist, for proofs only: it plays the part of the
 * Scaleway instance on the other end of ssh (scripts/lib/remote-ssh.mjs), so
 * `npm run proof:scaleway` can drive the real orchestrator, with the real
 * destroy paths, without a Scaleway account.
 *
 * scripts/run-on-scaleway.mjs loads it only when CLIFFIES_REMOTE_MODULE is
 * set AND the API it talks to is a stand-in on this machine: a fake machine
 * pointed at the real Scaleway would create real machines and never talk to
 * them, which is the one mistake this whole batch exists to prevent.
 *
 * What it does is read from CLIFFIES_STANDIN, a JSON object:
 *
 *   readyFails   the cloud-init "failed": waitReady must refuse, with words
 *   runExitCode  what the ingest answers (0 published, 3 partial, 1 refused)
 *   runMillis    how long the ingest "takes" (a long one is for the budget wall)
 *   markerFile   written the moment the ingest starts, so a proof can kill the
 *                orchestrator exactly mid-run
 *   transcript   where to write what really arrived: the bytes of the
 *                repository, and the environment lines — which is how the
 *                proof checks the R2 keys reached the machine and reached
 *                nothing else
 *   collectTar   a real tar file handed back as "what the run produced"
 */
import { readFileSync, writeFileSync } from "node:fs";

export function createRemote({ host, user, onLog = () => {} }) {
  const plan = JSON.parse(process.env.CLIFFIES_STANDIN ?? "{}");
  const seen = { host, user, repoBytes: 0, sends: 0, envLines: [], ran: false };
  const write = () => {
    if (plan.transcript) writeFileSync(plan.transcript, `${JSON.stringify(seen, null, 2)}\n`);
  };
  let closed = false;
  /** What close() calls to stop a run that is "in progress". */
  let wake = null;
  write();

  return {
    async waitReady() {
      if (plan.readyFails) {
        const error = new Error("the machine could not install its tools:\ncliffies: install FAILED (stand-in)");
        error.name = "RemoteError";
        throw error;
      }
      return true;
    },
    async sendRepo(stream) {
      seen.sends += 1;
      for await (const chunk of stream) seen.repoBytes += chunk.length;
      write();
      return true;
    },
    async run({ envLines, onLine }) {
      seen.ran = true;
      seen.envLines = [...envLines];
      write();
      if (plan.markerFile) writeFileSync(plan.markerFile, `${Date.now()}\n`);
      onLine("cliffies-run: node v22.22.3 on 16 cores");
      onLine("cloud-ingest: stand-in, no video was touched");
      const millis = Number(plan.runMillis ?? 0);
      if (millis > 0) {
        await new Promise((done) => {
          // Kept referenced: on a real machine the ssh child is what holds
          // this process open while the ingest runs, and the proof must
          // reproduce that, or the orchestrator exits before its own wall.
          const timer = setTimeout(done, millis);
          wake = () => {
            clearTimeout(timer);
            done();
          };
        });
      }
      if (closed) return { code: 255 };
      return { code: Number(plan.runExitCode ?? 0) };
    },
    async collect() {
      if (!plan.collectTar) return null;
      try {
        return readFileSync(plan.collectTar);
      } catch (error) {
        onLog(`stand-in: nothing to collect (${error.message})`);
        return null;
      }
    },
    close() {
      closed = true;
      wake?.();
    },
  };
}
