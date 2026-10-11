import path from "node:path";

import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "src"),
    },
  },
  test: {
    environment: "node",
    // These CLI contracts use Node's own test runner and are executed by
    // test:load-harness / CI, not silently discovered as empty Vitest suites.
    exclude: [...configDefaults.exclude, "scripts/tests/**"],
    // The large ABCD form suite shares this runner with hundreds of other
    // files. Bound worker contention so its async UI checks measure behavior,
    // not scheduler starvation on smaller build hosts.
    maxWorkers: 2,
    coverage: {
      provider: "v8",
      reporter: ["text", "json-summary"],
      include: ["src/lib/**/*.ts"],
      exclude: ["src/lib/supabase/**"],
    },
  },
});
