import type { MetadataRoute } from "next";

import { webAppManifest } from "@/lib/siteMetadata";

/** out/manifest.webmanifest: what makes the site installable (A11Y-04). */
export const dynamic = "force-static";

export default function manifest(): MetadataRoute.Manifest {
  return webAppManifest();
}
