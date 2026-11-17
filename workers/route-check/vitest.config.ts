import { cloudflareTest } from "@cloudflare/vitest-plugin"
import { defineConfig } from "vitest/config"

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: "./wrangler.jsonc" },
      miniflare: {
        // Use an explicit test date; production keeps its date in wrangler.jsonc.
        compatibilityDate: "2026-07-02",
        serviceBindings: {
          POLICY_CAPABILITIES: { name: "policy-capability-test", entrypoint: "RouteCapabilityService" },
        },
        workers: [
          {
            name: "policy-capability-test",
            modules: true,
            scriptPath: "./test/policy-capability-worker.mjs",
          },
        ],
      },
    }),
  ],
  test: { include: ["test/**/*.test.ts"] },
})
