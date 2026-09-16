import type { Metadata } from "next";
import localFont from "next/font/local";
import { darkColors } from "@project-flow/design-system";

import { resolveSiteUrl } from "@/lib/siteUrl";

import "./globals.css";

/**
 * Self-hosted consumer type — next/font/google was resolving to Arial-only
 * "Fallback" faces in this environment (no Google font bytes). Local woff2
 * keeps Syne/Manrope real and offline-reliable.
 */
const fontDisplay = localFont({
  src: [
    { path: "../fonts/syne-600.woff2", weight: "600", style: "normal" },
    { path: "../fonts/syne-700.woff2", weight: "700", style: "normal" },
  ],
  variable: "--font-display",
  display: "swap",
  preload: true,
  adjustFontFallback: false,
  fallback: ["system-ui", "sans-serif"],
});

const fontBody = localFont({
  src: [
    { path: "../fonts/manrope-400.woff2", weight: "400", style: "normal" },
    { path: "../fonts/manrope-500.woff2", weight: "500", style: "normal" },
    { path: "../fonts/manrope-600.woff2", weight: "600", style: "normal" },
  ],
  variable: "--font-body",
  display: "swap",
  preload: true,
  adjustFontFallback: false,
  fallback: ["system-ui", "sans-serif"],
});

export const metadata: Metadata = {
  metadataBase: new URL(resolveSiteUrl(process.env.NEXT_PUBLIC_SITE_URL)),
  title: {
    default: "PROJECT FLOW",
    template: "%s · PROJECT FLOW",
  },
  description: "Short drama that starts the moment you open it.",
  openGraph: {
    type: "website",
    siteName: "PROJECT FLOW",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${fontDisplay.variable} ${fontBody.variable}`}>
      <body
        style={{
          background: darkColors.background,
          color: darkColors.foreground,
        }}
      >
        {children}
      </body>
    </html>
  );
}
