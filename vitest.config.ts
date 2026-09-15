import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    setupFiles: ["./test/setup-env.ts"],
    // The live tests reach a real KeeperHub organization over the network.
    testTimeout: 60_000,
  },
});
