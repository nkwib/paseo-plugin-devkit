import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    testTimeout: 60_000,
    // The daemon end-to-end files take ports from the same range (or the same PPD_E2E_PORT), so one file at a time.
    fileParallelism: process.env.PPD_E2E !== "1",
  },
});
