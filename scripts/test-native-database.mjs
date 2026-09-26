// Required native checks are separate from the portable PGlite compatibility
// suite. Every child owns a temporary Unix-socket-only synthetic cluster.
import { spawn } from "node:child_process";
import { resolve } from "node:path";

if (!process.env.INTAKE_NATIVE_PG_BIN?.startsWith("/")) {
  throw new Error("Set INTAKE_NATIVE_PG_BIN to an absolute native PostgreSQL 17 bin directory. No hosted URL is accepted.");
}
const root = resolve(import.meta.dirname, "..");
const suites = [
  "test-intake-native.mjs",
  "test-admission-native.mjs",
  "test-transport-cancellation-native.mjs",
  "test-custom-form-responses-native.mjs",
  "test-custom-form-lifecycle-native.mjs",
  "test-custom-response-print-native.mjs",
  "test-publication-revision-native.mjs",
  "test-questionnaire-native.mjs",
];
for (const suite of suites) {
  console.log(`Native gate: ${suite}`);
  await new Promise((resolveResult, rejectResult) => {
    const child = spawn(process.execPath, [resolve(root, "scripts", suite)], { cwd: root, env: process.env, stdio: "inherit" });
    child.on("error", rejectResult);
    child.on("exit", (code, signal) => {
      if (code === 0) resolveResult();
      else rejectResult(new Error(`Native gate ${suite} failed (${signal ?? code}).`));
    });
  });
}
console.log(`Native database gates: ${suites.length}/${suites.length} suites passed. Hosted services and production release gates remain separate.`);
