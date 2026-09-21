/**
 * A small client for the Scaleway Instances API: create a machine and a disk,
 * attach them, start, poll, stop, detach, delete — and list by tag, which is
 * what lets a later run find what a crashed one left behind. No SDK: eleven
 * calls do not justify a dependency (the same choice as scripts/lib/r2.mjs).
 *
 *   base      https://api.scaleway.com
 *   instances /instance/v1/zones/<zone>/…
 *   auth      X-Auth-Token: <SCW_SECRET_KEY>
 *
 * Three rules, each paid for elsewhere in this repository:
 *
 *   1. **The token is never in a URL, never in a message, never in a log.**
 *      Every error this file throws is built from the status and Scaleway's
 *      own words, and `redact()` is applied to both.
 *   2. **A failure of the API is not a failure of the run** (Veezco's rule
 *      3b, learned on someone else's 503): 408, 425, 429, 5xx, a dropped
 *      connection and a timeout are retried with a growing wait. A refusal —
 *      400, 401, 403, 404 — stops at once, because retrying a wrong key does
 *      not make it right.
 *   3. **What is not known is null.** A machine that is not there answers
 *      null, not an empty object, so a caller cannot mistake "gone" for
 *      "fine".
 *
 * NOT verified against the real API: no Scaleway credentials exist in the
 * environment this was written in, and none were invented. Every shape here
 * comes from Scaleway's published API reference; the fake in
 * scripts/lib/fake-scaleway.mjs answers exactly those shapes, so what is
 * proven is this client's behaviour, not Scaleway's.
 */
import { setTimeout as sleep } from "node:timers/promises";

const TRANSIENT_STATUS = new Set([408, 425, 429, 500, 502, 503, 504]);
/** States the API reports for a machine (docs: "instance server states"). */
export const SERVER_STATES = Object.freeze({
  starting: "starting",
  running: "running",
  stopping: "stopping",
  stopped: "stopped",
  stoppedInPlace: "stopped in place",
  locked: "locked",
});

export class ScalewayError extends Error {
  constructor(message, { status = null, type = null, transient = false } = {}) {
    super(message);
    this.name = "ScalewayError";
    this.status = status;
    /** Scaleway's own error type ("invalid_arguments", "quotas_exceeded", "permissions_denied", …). */
    this.type = type;
    this.transient = transient;
  }
}

/**
 * Takes every secret out of a string before it is printed. Called on every
 * message this file produces, and exported so callers can use it on their own
 * output: one forgotten log line is a key in a public build log.
 */
export function redact(text, secrets = []) {
  let out = String(text ?? "");
  for (const secret of secrets) {
    if (typeof secret === "string" && secret.length >= 8) out = out.split(secret).join("[redacted]");
  }
  // A Scaleway key is a UUID; a secret key is one too. Anything shaped like
  // one that slipped through a body we print is masked as well.
  return out.replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, (id) =>
    `${id.slice(0, 8)}…`,
  );
}

/**
 * What the environment must carry for a run. Values are read at call time and
 * never stored anywhere but this process's memory.
 */
export const SCW_ENV = ["SCW_SECRET_KEY", "SCW_PROJECT_ID", "SCW_ZONE"];

/**
 * @returns {{ ok: true, config: object } | { ok: false, problems: string[] }}
 *   Never prints a value — only which names are missing or malformed.
 */
export function scalewayConfig(env) {
  const value = (name) => (typeof env[name] === "string" ? env[name].trim() : "");
  const problems = [];
  const secretKey = value("SCW_SECRET_KEY");
  const projectId = value("SCW_PROJECT_ID");
  const zone = value("SCW_ZONE");
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!secretKey) problems.push("SCW_SECRET_KEY is not set (the secret key of the cliffie-ingest application)");
  else if (!uuid.test(secretKey)) problems.push("SCW_SECRET_KEY does not look like a Scaleway secret key (a UUID)");
  if (!projectId) problems.push("SCW_PROJECT_ID is not set (the id of the cliffies project)");
  else if (!uuid.test(projectId)) problems.push("SCW_PROJECT_ID must be the project's UUID, not its name");
  if (!zone) problems.push("SCW_ZONE is not set (for example fr-par-1, nl-ams-1 or pl-waw-1)");
  else if (!/^[a-z]{2}-[a-z]{3}-[1-9]$/.test(zone)) problems.push(`SCW_ZONE is not a zone: "${zone}"`);
  const baseUrl = value("SCW_API_URL") || "https://api.scaleway.com";
  if (problems.length > 0) return { ok: false, problems };
  return {
    ok: true,
    config: {
      secretKey,
      projectId,
      zone,
      baseUrl: baseUrl.replace(/\/+$/, ""),
      /** Only ever used to say which key is being used, never to sign anything. */
      accessKey: value("SCW_ACCESS_KEY") || null,
    },
  };
}

/**
 * @param {{ secretKey: string, projectId: string, zone: string, baseUrl?: string }} config
 * @param {{ fetchImpl?: typeof fetch, retries?: number, backoffMs?: number, timeoutMs?: number, onRequest?: Function }} [options]
 */
export function createScalewayClient(config, options = {}) {
  const fetchImpl = options.fetchImpl ?? fetch;
  const retries = options.retries ?? 4;
  const backoffMs = options.backoffMs ?? 1000;
  const timeoutMs = options.timeoutMs ?? 30_000;
  const baseUrl = (config.baseUrl ?? "https://api.scaleway.com").replace(/\/+$/, "");
  const zone = config.zone;
  const secrets = [config.secretKey].filter(Boolean);
  const stats = { requests: 0, retried: 0, byMethod: {} };
  const clean = (text) => redact(text, secrets);

  const instances = (path) => `${baseUrl}/instance/v1/zones/${encodeURIComponent(zone)}${path}`;

  async function send(method, url, { body = null, accept = "json", query = null, contentType = "application/json" } = {}) {
    const target = new URL(url);
    for (const [name, value] of Object.entries(query ?? {})) {
      if (value !== null && value !== undefined) target.searchParams.set(name, String(value));
    }
    let last = null;
    for (let attempt = 0; attempt <= retries; attempt += 1) {
      if (attempt > 0) {
        stats.retried += 1;
        await sleep(backoffMs * 2 ** (attempt - 1));
      }
      stats.requests += 1;
      stats.byMethod[method] = (stats.byMethod[method] ?? 0) + 1;
      options.onRequest?.({ method, url: target.pathname, attempt });
      let response;
      try {
        response = await fetchImpl(target.toString(), {
          method,
          headers: {
            // The one place the secret is used. It is a header, never a query
            // parameter: a URL reaches logs, proxies and error messages.
            "X-Auth-Token": config.secretKey,
            "content-type": contentType,
            accept: accept === "json" ? "application/json" : "*/*",
          },
          body: body === null ? undefined : (contentType === "application/json" ? JSON.stringify(body) : String(body)),
          signal: AbortSignal.timeout(timeoutMs),
        });
      } catch (error) {
        last = new ScalewayError(`${method} ${target.pathname}: ${clean(error.message)}`, { transient: true });
        continue;
      }
      if (response.status === 204 || response.status === 205) return null;
      const text = await response.text().catch(() => "");
      let parsed = null;
      try {
        parsed = text ? JSON.parse(text) : null;
      } catch {
        parsed = null;
      }
      if (response.ok) return parsed ?? {};
      const type = parsed?.type ?? parsed?.code ?? null;
      const details = parsed?.fields ? ` (fields: ${JSON.stringify(parsed.fields)})` : (parsed?.details ? ` (details: ${JSON.stringify(parsed.details)})` : "");
      const said = (parsed?.message ?? (text ? text.slice(0, 300) : "")) + details;
      const transient = TRANSIENT_STATUS.has(response.status);
      const hint =
        response.status === 401 || response.status === 403
          ? " (the SCW_SECRET_KEY is wrong, or the cliffie-ingest application has no rights on this project)"
          : response.status === 404
            ? " (it is not there — it may already have been deleted)"
            : "";
      last = new ScalewayError(`${method} ${target.pathname}: Scaleway answered ${response.status}${hint}${said ? ` — ${clean(said)}` : ""}`, {
        status: response.status,
        type,
        transient,
      });
      if (!transient) throw last;
    }
    throw last;
  }

  /** null instead of throwing when a thing is simply not there. */
  async function maybe(promise) {
    try {
      return await promise;
    } catch (error) {
      if (error instanceof ScalewayError && error.status === 404) return null;
      throw error;
    }
  }

  const publicIpOf = (server) =>
    server?.public_ip?.address ?? server?.public_ips?.find((entry) => entry?.address)?.address ?? null;

  return {
    zone,
    stats,
    redact: clean,
    publicIpOf,

    async listProjects() {
      // 1. If config.projectId happens to be the organization ID:
      try {
        const answer = await send("GET", `${baseUrl}/account/v3/projects`, {
          query: { organization_id: config.projectId },
        });
        if (answer?.projects?.length) return answer.projects;
      } catch {}

      // 2. If config.projectId is already a project ID, fetch that project:
      try {
        const proj = await send("GET", `${baseUrl}/account/v3/projects/${encodeURIComponent(config.projectId)}`);
        if (proj?.id) {
          if (proj.organization_id) {
            try {
              const answer = await send("GET", `${baseUrl}/account/v3/projects`, {
                query: { organization_id: proj.organization_id },
              });
              if (answer?.projects?.length) return answer.projects;
            } catch {}
          }
          return [proj];
        }
      } catch {}

      return [];
    },

    async getApiKeyInfo(accessKey) {
      if (!accessKey) return null;
      try {
        return await send("GET", `${baseUrl}/iam/v1alpha1/api-keys/${encodeURIComponent(accessKey)}`);
      } catch {
        return null;
      }
    },

    /**
     * An image label ("ubuntu_noble") is not what create-server takes: it
     * takes a UUID. The marketplace answers which image that label is in this
     * zone, for this kind of machine.
     */
    async resolveImage(label, { commercialType }) {
      if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(label)) return label;
      const answer = await send("GET", `${baseUrl}/marketplace/v2/local-images`, {
        query: { image_label: label, zone },
      });
      const images = answer?.local_images ?? [];
      const fit =
        images.find((image) => (image.compatible_commercial_types ?? []).includes(commercialType)) ?? null;
      if (!fit) {
        throw new ScalewayError(
          `no image called "${label}" in ${zone} that ${commercialType} can boot` +
            (images.length > 0 ? ` (${images.length} image(s) carry that label in other shapes)` : ""),
          { status: 404, type: "image_not_found" },
        );
      }
      return fit.id;
    },

    async createVolume({ name, sizeGb, volumeType, tags, projectId = null }) {
      const targetProject = projectId ?? config.projectId;
      if (volumeType?.startsWith("sbs")) {
        try {
          const answer = await send("POST", `${baseUrl}/block/v1/zones/${zone}/volumes`, {
            body: {
              name,
              project_id: targetProject,
              perf_iops: 5000,
              from_empty: {
                size: Math.round(sizeGb) * 1_000_000_000,
              },
              tags,
            },
          });
          if (answer?.id || answer?.volume?.id) {
            return answer?.volume ?? answer;
          }
        } catch {
          // fallback to instance API
        }
      }
      const answer = await send("POST", instances("/volumes"), {
        body: {
          name,
          project: targetProject,
          volume_type: volumeType,
          size: Math.round(sizeGb) * 1_000_000_000,
          tags,
        },
      });
      return answer?.volume ?? null;
    },

    getVolume(id) {
      return maybe(send("GET", instances(`/volumes/${encodeURIComponent(id)}`)).then((a) => a?.volume ?? null));
    },

    async listVolumes({ tag = null } = {}) {
      const answer = await send("GET", instances("/volumes"), { query: { tags: tag, per_page: 100 } });
      return answer?.volumes ?? [];
    },

    async deleteVolume(id) {
      await maybe(send("DELETE", instances(`/volumes/${encodeURIComponent(id)}`)));
    },

    async createServer({ name, commercialType, image, tags, projectId = null }) {
      const targetProject = projectId ?? config.projectId;
      const answer = await send("POST", instances("/servers"), {
        body: {
          name,
          project: targetProject,
          commercial_type: commercialType,
          image,
          tags,
          // A machine with no public address cannot be reached, and the run
          // talks to it over ssh. The address goes with the machine.
          dynamic_ip_required: true,
          routed_ip_enabled: true,
        },
      });
      return answer?.server ?? null;
    },

    getServer(id) {
      return maybe(send("GET", instances(`/servers/${encodeURIComponent(id)}`)).then((a) => a?.server ?? null));
    },

    async listServers({ tag = null } = {}) {
      const answer = await send("GET", instances("/servers"), { query: { tags: tag, per_page: 100 } });
      return answer?.servers ?? [];
    },

    /** The cloud-init. Sent as its own call, so it never travels in a URL or a tag. */
    async setCloudInit(serverId, text) {
      await send("PATCH", instances(`/servers/${encodeURIComponent(serverId)}/user_data/cloud-init`), {
        body: text,
        contentType: "text/plain",
      });
    },

    async attachVolume(serverId, volumeId) {
      await send("POST", instances(`/servers/${encodeURIComponent(serverId)}/attach-volume`), {
        body: { volume_id: volumeId },
      });
    },

    async detachVolume(serverId, volumeId) {
      await maybe(
        send("POST", instances(`/servers/${encodeURIComponent(serverId)}/detach-volume`), {
          body: { volume_id: volumeId },
        }),
      );
    },

    /** poweron | poweroff | terminate | reboot | stop_in_place */
    async action(serverId, what) {
      return maybe(
        send("POST", instances(`/servers/${encodeURIComponent(serverId)}/action`), { body: { action: what } }),
      );
    },

    async deleteServer(id) {
      await maybe(send("DELETE", instances(`/servers/${encodeURIComponent(id)}`)));
    },

    /**
     * Waits until the machine reports one of `states`, or until the time is
     * up. A machine that disappears while being waited for is not an error
     * here: the caller asked for a state, and "gone" is reported as null.
     */
    async waitForServer(id, { states, timeoutMs = 10 * 60_000, intervalMs = 5_000, onPoll = null }) {
      const wanted = new Set(states);
      const until = Date.now() + timeoutMs;
      for (;;) {
        const server = await this.getServer(id);
        if (server === null) return null;
        onPoll?.(server);
        if (wanted.has(server.state)) return server;
        if (Date.now() >= until) {
          throw new ScalewayError(
            `the machine is still "${server.state}" after ${Math.round(timeoutMs / 60_000)} minutes, and should be ${[...wanted].join(" or ")}`,
            { type: "timeout" },
          );
        }
        await sleep(intervalMs);
      }
    },
  };
}
