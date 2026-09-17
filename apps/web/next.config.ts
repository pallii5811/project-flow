import { execSync } from "node:child_process";

import type { NextConfig } from "next";

/**
 * The version every analytics event carries (app_version): the commit the
 * export was built from, so an event can be tied to the catalog and code that
 * produced it (MP-7). An explicit NEXT_PUBLIC_APP_VERSION wins.
 */
function appVersion(): string {
  const explicit = process.env.NEXT_PUBLIC_APP_VERSION?.trim();
  if (explicit) return explicit;
  try {
    return execSync("git rev-parse --short=12 HEAD", {
      stdio: ["ignore", "pipe", "ignore"],
    })
      .toString()
      .trim();
  } catch {
    return "0.0.0";
  }
}

const nextConfig: NextConfig = {
  // Plain files on Cloudflare Pages: no server to pay for, and every request
  // is a CDN hit (docs/business-model.md, zero owner cash).
  output: "export",
  env: {
    NEXT_PUBLIC_APP_VERSION: appVersion(),
  },
  transpilePackages: [
    "@project-flow/feed-domain",
    "@project-flow/design-system",
    "@project-flow/analytics",
    "@project-flow/shared",
  ],
};

export default nextConfig;
