import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";

const suites = ["intake", "admission", "transport-cancellation", "custom-form-responses", "custom-form-lifecycle", "custom-response-print", "publication-revision", "questionnaire", "questionnaire-rule-governance", "claim-operation-receipts", "nursing-assessments", "referral-admission", "social-work-admission"];
describe("bounded native runner cleanup wiring", () => {
  it.each(suites)("%s registers a fresh runtime and preserves the original error before exact stop/cleanup", async (suite) => {
    const source = await readFile(new URL(`./test-${suite}-native.mjs`, import.meta.url), "utf8");
    expect(source).toContain('import { createNativeTestRuntime } from "./lib/native-test-cleanup.mjs";');
    expect(source).toMatch(/const \{ runtime, data, cleanupNativeData \} = await createNativeTestRuntime\("\/tmp\/daycare-[a-z-]+\."\);/);
    expect(source).not.toMatch(/\bmkdtemp\s*\(/);
    expect(source).toMatch(/catch \(error\) \{\s*testFailure = error;\s*throw error;\s*\} finally \{/);
    expect(source).toMatch(/await cleanupNativeData\(\{ started, testFailure(?:, cleanupErrors)?,\s*stop: \(\) => run\(join\(binaries, "pg_ctl"\), \["-D", data, "-m", "fast", "-w", "stop"\]\) \}\);/);
    expect(source).not.toMatch(/\b(?:rm|unlink|rmdir)\s*\(/);
  });
  it("deletes only its verified data child, never runtime, parent or an environment-derived target", async () => {
    const source = await readFile(new URL("./lib/native-test-cleanup.mjs", import.meta.url), "utf8");
    expect(source.match(/await rm\(/g)).toHaveLength(1);
    expect(source).toContain('await rm(data, { recursive: true, force: false });');
    expect(source).toContain('process.env.NATIVE_TEST_RETAIN_DATA === "1"');
    expect(source).toContain('await realpath("/tmp")');
    expect(source).not.toMatch(/process\.env\.(?:HOME|TMPDIR|CODEX_HOME)/);
  });
});
