/**
 * A local stand-in for the Scaleway Instances API, for tests and proofs only.
 * It answers the eleven calls scripts/lib/scaleway.mjs makes, in the shapes
 * Scaleway's reference documents, and refuses what the real one refuses:
 *
 *   - no X-Auth-Token, or the wrong one            401 denied_authentication
 *   - a machine deleted while it is still running  400 invalid_arguments
 *   - a volume deleted while it is still attached  400 invalid_arguments
 *   - anything it does not know                    404 not_found
 *
 * A machine does not change state the moment it is asked to: poweron leaves it
 * "starting" and it becomes "running" after a few polls, with an address —
 * which is what makes the waiting, and the timeouts, real in a proof.
 *
 * Nothing here is proof that the real API behaves this way. It is proof that
 * the client and the orchestrator behave correctly against an API that does.
 */
import { Buffer } from "node:buffer";
import { randomUUID } from "node:crypto";
import { createServer } from "node:http";

const SECOND = 1000;

/**
 * @param {{ secretKey: string, projectId: string, zone?: string, pollsToSettle?: number }} options
 */
export function startFakeScaleway({ secretKey, projectId, zone = "fr-par-1", pollsToSettle = 2, port = 0 }) {
  /** @type {Map<string, any>} */
  const servers = new Map();
  /** @type {Map<string, any>} */
  const volumes = new Map();
  const log = [];
  /** Every cloud-init this account was ever sent, kept after its machine is gone. */
  const cloudInits = [];
  let failures = [];
  let addresses = 1;

  const now = () => new Date().toISOString();

  function answer(response, status, body, entry) {
    entry.status = status;
    response.writeHead(status, { "content-type": "application/json" });
    response.end(body === null ? "" : JSON.stringify(body));
  }

  function refuse(response, status, type, message, entry) {
    answer(response, status, { type, message }, entry);
  }

  /** A machine asked to move settles after a few polls, as a real one does. */
  function settle(server) {
    if (server.state === "starting" || server.state === "stopping") {
      server.polls += 1;
      if (server.polls >= pollsToSettle) {
        server.state = server.state === "starting" ? "running" : "stopped";
        server.polls = 0;
        if (server.state === "running" && !server.public_ip) {
          addresses += 1;
          server.public_ip = { id: randomUUID(), address: `203.0.113.${addresses}`, dynamic: true };
          server.public_ips = [server.public_ip];
        }
        if (server.state === "stopped") {
          server.public_ip = null;
          server.public_ips = [];
        }
      }
    }
    return server;
  }

  const publicVolume = (volume) => ({ ...volume, server: volume.server ? { id: volume.server } : null });

  function handle(request, response, body, entry) {
    const url = new URL(request.url, "http://fake");
    const path = url.pathname;
    const method = request.method;

    if (failures.length > 0) {
      const status = failures.shift();
      return refuse(response, status, "internal_server_error", "injected failure", entry);
    }
    if (request.headers["x-auth-token"] !== secretKey) {
      return refuse(response, 401, "denied_authentication", "authentication is denied", entry);
    }

    // The marketplace: a label becomes an image id.
    if (method === "GET" && path === "/marketplace/v2/local-images") {
      const label = url.searchParams.get("image_label");
      if (label !== "ubuntu_noble") return answer(response, 200, { local_images: [] }, entry);
      return answer(
        response,
        200,
        {
          local_images: [
            {
              id: "11111111-2222-3333-4444-555555555555",
              zone: url.searchParams.get("zone") ?? zone,
              label,
              arch: "x86_64",
              compatible_commercial_types: ["STANDARD2-A16C-64G", "STANDARD2-A24C-96G", "DEV1-S"],
            },
          ],
        },
        entry,
      );
    }

    const prefix = `/instance/v1/zones/${zone}`;
    if (!path.startsWith(prefix)) return refuse(response, 404, "not_found", `no such path: ${path}`, entry);
    const rest = path.slice(prefix.length);
    const parts = rest.split("/").filter(Boolean);

    // ---- volumes -----------------------------------------------------------
    if (parts[0] === "volumes") {
      const id = parts[1];
      if (method === "POST" && !id) {
        if (body?.project !== projectId) {
          return refuse(response, 400, "invalid_arguments", "project: unknown project for this application", entry);
        }
        const volume = {
          id: randomUUID(),
          name: body.name,
          size: body.size,
          volume_type: body.volume_type,
          tags: body.tags ?? [],
          state: "available",
          server: null,
          creation_date: now(),
          project: body.project,
        };
        volumes.set(volume.id, volume);
        return answer(response, 201, { volume: publicVolume(volume) }, entry);
      }
      if (method === "GET" && !id) {
        const tag = url.searchParams.get("tags");
        const found = [...volumes.values()].filter((volume) => !tag || (volume.tags ?? []).includes(tag));
        return answer(response, 200, { volumes: found.map(publicVolume) }, entry);
      }
      const volume = volumes.get(id);
      if (!volume) return refuse(response, 404, "not_found", "volume not found", entry);
      if (method === "GET") return answer(response, 200, { volume: publicVolume(volume) }, entry);
      if (method === "DELETE") {
        if (volume.server) {
          return refuse(response, 400, "invalid_arguments", "volume: still attached to a server", entry);
        }
        volumes.delete(id);
        return answer(response, 204, null, entry);
      }
      return refuse(response, 405, "method_not_allowed", method, entry);
    }

    // ---- servers -----------------------------------------------------------
    if (parts[0] === "servers") {
      const id = parts[1];
      if (method === "POST" && !id) {
        if (body?.project !== projectId) {
          return refuse(response, 400, "invalid_arguments", "project: unknown project for this application", entry);
        }
        if (!body?.image) return refuse(response, 400, "invalid_arguments", "image: required", entry);
        const server = {
          id: randomUUID(),
          name: body.name,
          commercial_type: body.commercial_type,
          image: { id: body.image },
          tags: body.tags ?? [],
          state: "stopped",
          polls: 0,
          public_ip: null,
          public_ips: [],
          volumes: {},
          creation_date: now(),
          project: body.project,
          cloudInit: null,
        };
        servers.set(server.id, server);
        return answer(response, 201, { server }, entry);
      }
      if (method === "GET" && !id) {
        const tag = url.searchParams.get("tags");
        const found = [...servers.values()].filter((server) => !tag || (server.tags ?? []).includes(tag));
        return answer(response, 200, { servers: found }, entry);
      }
      const server = servers.get(id);
      if (!server) return refuse(response, 404, "not_found", "server not found", entry);

      if (method === "GET" && parts.length === 2) return answer(response, 200, { server: settle(server) }, entry);

      if (method === "PATCH" && parts[2] === "user_data") {
        server.cloudInit = body?.content ?? "";
        cloudInits.push({ server: server.id, name: server.name, content: server.cloudInit });
        return answer(response, 204, null, entry);
      }
      if (method === "POST" && parts[2] === "attach-volume") {
        const volume = volumes.get(body?.volume_id);
        if (!volume) return refuse(response, 404, "not_found", "volume not found", entry);
        if (server.state !== "stopped") {
          return refuse(response, 400, "invalid_arguments", "server must be stopped to attach a volume", entry);
        }
        volume.server = server.id;
        server.volumes[String(Object.keys(server.volumes).length + 1)] = { id: volume.id };
        return answer(response, 200, { server }, entry);
      }
      if (method === "POST" && parts[2] === "detach-volume") {
        const volume = volumes.get(body?.volume_id);
        if (!volume) return refuse(response, 404, "not_found", "volume not found", entry);
        volume.server = null;
        server.volumes = Object.fromEntries(
          Object.entries(server.volumes).filter(([, entryValue]) => entryValue.id !== volume.id),
        );
        return answer(response, 200, { server }, entry);
      }
      if (method === "POST" && parts[2] === "action") {
        const what = body?.action;
        if (what === "poweron") {
          if (server.state !== "stopped") {
            return refuse(response, 400, "invalid_arguments", `server is ${server.state}`, entry);
          }
          server.state = "starting";
          server.polls = 0;
        } else if (what === "poweroff") {
          if (server.state === "stopped") return answer(response, 202, { task: { id: randomUUID() } }, entry);
          server.state = "stopping";
          server.polls = 0;
        } else if (what === "terminate") {
          for (const volume of volumes.values()) if (volume.server === server.id) volumes.delete(volume.id);
          servers.delete(server.id);
        } else {
          return refuse(response, 400, "invalid_arguments", `unknown action: ${String(what)}`, entry);
        }
        return answer(response, 202, { task: { id: randomUUID(), status: "pending" } }, entry);
      }
      if (method === "DELETE" && parts.length === 2) {
        if (server.state !== "stopped") {
          return refuse(response, 400, "invalid_arguments", `server is ${server.state}; stop it first`, entry);
        }
        for (const volume of volumes.values()) if (volume.server === server.id) volume.server = null;
        servers.delete(id);
        return answer(response, 204, null, entry);
      }
      return refuse(response, 404, "not_found", `no such path: ${path}`, entry);
    }

    return refuse(response, 404, "not_found", `no such path: ${path}`, entry);
  }

  const server = createServer((request, response) => {
    const chunks = [];
    request.on("data", (chunk) => chunks.push(chunk));
    request.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8");
      let body = null;
      try {
        body = raw ? JSON.parse(raw) : null;
      } catch {
        body = null;
      }
      const url = new URL(request.url, "http://fake");
      const entry = {
        method: request.method,
        path: url.pathname,
        query: url.search,
        token: request.headers["x-auth-token"] ?? null,
        /** Kept whole: a proof reads every body looking for a secret that should not be there. */
        raw,
        status: 0,
      };
      log.push(entry);
      try {
        handle(request, response, body, entry);
      } catch (error) {
        entry.status = 500;
        response.writeHead(500, { "content-type": "application/json" });
        response.end(JSON.stringify({ type: "internal_server_error", message: String(error?.message ?? error) }));
      }
    });
  });

  return new Promise((ready) => {
    server.listen(port, "127.0.0.1", () => {
      ready({
        url: `http://127.0.0.1:${server.address().port}`,
        port: server.address().port,
        servers,
        volumes,
        log,
        cloudInits,
        /** The next requests fail with these statuses, whatever they ask for. */
        failNext(...statuses) {
          failures = [...failures, ...statuses];
        },
        /** Makes a machine or a volume look older, so the sweeper has something to find. */
        backdate(id, minutes) {
          const thing = servers.get(id) ?? volumes.get(id);
          if (thing) thing.creation_date = new Date(Date.now() - minutes * 60 * SECOND).toISOString();
        },
        /** Everything this account would still be paying for. */
        alive() {
          return { servers: [...servers.values()], volumes: [...volumes.values()] };
        },
        close: () => new Promise((done) => server.close(() => done())),
      });
    });
  });
}
