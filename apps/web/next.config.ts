import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Plain files on Cloudflare Pages: no server to pay for, and every request
  // is a CDN hit (docs/business-model.md, zero owner cash).
  output: "export",
  transpilePackages: [
    "@project-flow/feed-domain",
    "@project-flow/design-system",
    "@project-flow/analytics",
    "@project-flow/shared",
  ],
};

export default nextConfig;
