import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: [
    "@project-flow/feed-domain",
    "@project-flow/design-system",
    "@project-flow/analytics",
    "@project-flow/shared",
  ],
};

export default nextConfig;
