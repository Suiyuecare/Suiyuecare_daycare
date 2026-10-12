import { appendFileSync, existsSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

// Synthetic pg_ctl contract fixture. It is not PostgreSQL and cannot connect
// to a database, access a keychain or authenticate to a hosted service.
const [scenario, log, ...args] = process.argv.slice(2);
const data = args[args.indexOf("-D") + 1];
const action = args.at(-1);
appendFileSync(log, `${JSON.stringify({ action, data, args })}\n`);
const pid = join(data, "postmaster.pid");
if (action === "start") {
  if (scenario !== "failed-start-no-server") writeFileSync(pid, "synthetic-pid-not-a-real-process\n");
  process.exitCode = scenario.startsWith("failed-start") ? 1 : 0;
} else if (action === "status") {
  process.exitCode = scenario === "status-failure" ? 4 :
    scenario === "ambiguous-pid" ? 3 : existsSync(pid) ? 0 : 3;
} else if (action === "stop") {
  if (scenario === "stop-failure") process.exitCode = 1;
  else if (scenario !== "still-running") rmSync(pid, { force: true });
} else process.exitCode = 9;
