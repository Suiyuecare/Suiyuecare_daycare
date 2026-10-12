// Only reads the caller's injected server configuration. Never load .env files,
// fetch provider settings, read Keychain or expose supplied values/errors.
import { inspectTokyoAuthConfiguration } from "./lib/tokyo-auth-configuration.mjs";

if (process.argv.length !== 2) {
  process.stderr.write("Usage: node scripts/preflight-tokyo-auth-configuration.mjs (injected server configuration only; syntax/origins, no real login or connection proof)\n");
  process.exitCode = 2;
} else {
  try {
    const result = inspectTokyoAuthConfiguration(process.env);
    process.stdout.write(`${JSON.stringify(result)}\n`);
    process.exitCode = result.status === "configured_unverified" ? 0 : 2;
  } catch {
    process.stderr.write("TOKYO_AUTH_PREFLIGHT_FAILED\n");
    process.exitCode = 2;
  }
}
