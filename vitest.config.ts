import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  // The web app compiles JSX with the automatic runtime (Next does it for the
  // build); tests that render a component need the same.
  esbuild: { jsx: "automatic" },
  test: {
    environment: "node",
    include: [
      "packages/**/*.test.ts",
      "apps/mobile/src/**/*.test.ts",
      "apps/web/src/**/*.test.ts",
      // The content pipeline lives in scripts/ as plain .mjs (no build step);
      // its pure rules are tested from here.
      "test/**/*.test.ts",
    ],
  },
  resolve: {
    alias: [
      { find: "react-native", replacement: path.resolve(__dirname, "test/react-native-stub.ts") },
      {
        find: "@react-native-async-storage/async-storage",
        replacement: path.resolve(__dirname, "test/async-storage-stub.ts"),
      },
      // The web app's own "@/..." imports (apps/web/tsconfig.json), so a test
      // can render its components.
      { find: /^@\/(.*)$/, replacement: path.resolve(__dirname, "apps/web/src/$1") },
    ],
  },
});
