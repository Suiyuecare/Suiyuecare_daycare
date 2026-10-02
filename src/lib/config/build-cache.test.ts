import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => { vi.unstubAllEnvs(); vi.resetModules(); });

describe("explicit disposable build cache opt-out", () => {
  it.each([undefined, "false", "", "TRUE", "true"])("keeps the default unless exactly true (%s)", async (value) => {
    vi.stubEnv("DAYCARE_DISABLE_FILESYSTEM_CACHE", value);
    vi.resetModules();
    const { default: config } = await import("../../../next.config");
    expect(config.experimental?.turbopackFileSystemCacheForBuild).toBe(value !== "true");
    expect(config.experimental?.turbopackFileSystemCacheForDev).toBe(value !== "true");
    expect(config.experimental?.typedEnv).toBe(true);
  });
});
