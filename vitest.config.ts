import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
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
    alias: {
      "react-native": path.resolve(__dirname, "test/react-native-stub.ts"),
      "@react-native-async-storage/async-storage": path.resolve(
        __dirname,
        "test/async-storage-stub.ts",
      ),
    },
  },
});
