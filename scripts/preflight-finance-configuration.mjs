// Read-only syntax preflight. Does not contact Finance, read an env file, or print values.
import { inspectFinanceConfiguration } from "../src/lib/store-overview/finance-configuration.ts";

if (process.argv.length !== 2) {
  process.stderr.write("Usage: node scripts/preflight-finance-configuration.mjs (reads injected server environment only)\n");
  process.exitCode = 2;
} else {
  const check = inspectFinanceConfiguration(process.env);
  process.stdout.write(`${JSON.stringify({ ...check, externalRequests: 0, writes: 0 })}\n`);
  process.exitCode = check.status === "configured_unverified" ? 0 : 2;
}
