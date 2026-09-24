import { inspectInfrastructure } from "../infra/intake/preflight.mjs";

const allowed = new Set(["--live-read-only"]);
if (process.argv.slice(2).some((arg) => !allowed.has(arg))) throw new Error("Only --live-read-only is accepted. No write/provision/enable command exists.");
// Explicit environment only: never read dotenv files or search other projects.
const report = await inspectInfrastructure(process.env, { live: process.argv.includes("--live-read-only") });
console.log(JSON.stringify(report, null, 2));
if (!report.operatorEnablementRecommended) process.exitCode = 2;
