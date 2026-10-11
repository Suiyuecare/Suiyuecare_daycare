// Runnable only against separately reviewed, synthetic-only staging. No JWT
// generation, seed mutation, service-role key, or production override exists.
import { readFile, writeFile, stat } from "node:fs/promises";
import { isAbsolute } from "node:path";
import { parseArgs } from "node:util";
import { LoadFailure, runHttpLoad } from "./lib/http-load.mjs";

try {
  const { values } = parseArgs({ options: {
    manifest: { type: "string" }, "allow-origin": { type: "string" }, "allow-auth-origin": { type: "string" },
    "confirm-synthetic-fixtures": { type: "string" }, "duration-seconds": { type: "string", default: "600" },
    report: { type: "string" }, help: { type: "boolean", default: false },
  }, strict: true });
  if (values.help) {
    process.stdout.write("node scripts/test-http-load.mjs --manifest /absolute/private/fixture.json --allow-origin https://isolated-staging.example --allow-auth-origin https://<staging-ref>.supabase.co --confirm-synthetic-fixtures <fixture-uuid> --duration-seconds 600 --report /absolute/private/aggregate-report.json\nRead docs/HTTP_LOAD_ACCEPTANCE.md first. Production origins and both current production Supabase refs are always denied.\n");
  } else {
    if (!values.manifest || !values.report || !isAbsolute(values.manifest) || !isAbsolute(values.report) || values.manifest === values.report) throw new LoadFailure("ABSOLUTE_PRIVATE_FILE_PATHS_REQUIRED");
    const info = await stat(values.manifest);
    if (!info.isFile() || info.size > 2 * 1024 * 1024 || (info.mode & 0o077)) throw new LoadFailure("PRIVATE_MANIFEST_MODE_0600_REQUIRED");
    const seconds = Number(values["duration-seconds"]);
    if (!Number.isInteger(seconds) || seconds < 60 || seconds > 1800) throw new LoadFailure("DURATION_MUST_BE_60_TO_1800_SECONDS");
    let manifest;
    try { manifest = JSON.parse(await readFile(values.manifest, "utf8")); } catch { throw new LoadFailure("MANIFEST_JSON_INVALID"); }
    const result = await runHttpLoad({ manifest, durationMs: seconds * 1000, options: {
      allowOrigin: values["allow-origin"], allowAuthOrigin: values["allow-auth-origin"], confirmFixture: values["confirm-synthetic-fixtures"],
    } });
    // Aggregate/hash report only, exclusive creation prevents overwriting a
    // previous release's evidence. No cookie, JWT, actor/client ID or body saved.
    await writeFile(values.report, `${JSON.stringify(result, null, 2)}\n`, { mode: 0o600, flag: "wx" });
    process.stdout.write(JSON.stringify({ accepted: result.accepted, proofLevel: result.proofLevel,
      productionVerified: false, readP95Ms: result.workload.readP95Ms, writeP95Ms: result.workload.writeP95Ms,
      readSamples: result.workload.readSamples, writeSamples: result.workload.writeSamples,
      errors: result.violations.errorCodes, gates: result.gates }) + "\n");
    if (!result.accepted) process.exitCode = 1;
  }
} catch (error) {
  // Do not print filesystem contents, HTTP bodies, Error.message, or stacks.
  process.stderr.write(`${error instanceof LoadFailure ? error.code : "LOAD_TOOL_SETUP_FAILED"}\n`);
  process.exitCode = 1;
}
