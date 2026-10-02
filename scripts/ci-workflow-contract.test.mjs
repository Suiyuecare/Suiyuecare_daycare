import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const workflow = readFileSync(resolve(import.meta.dirname, "../.github/workflows/verify.yml"), "utf8");

describe("source-only CI safety contract", () => {
  it("pins reviewed actions to immutable full commit IDs", () => {
    const actions = [...workflow.matchAll(/uses:\s*(\S+)/gu)].map((match) => match[1]);
    expect(actions).toHaveLength(4);
    for (const action of actions) expect(action).toMatch(/^actions\/(?:checkout|setup-node)@[a-f0-9]{40}$/u);
  });
  it("does not grant writes, persist tokens, load secrets or run privileged PR triggers", () => {
    expect(workflow).toContain("contents: read");
    expect(workflow.match(/persist-credentials: false/gu)).toHaveLength(2);
    expect(workflow).not.toMatch(/pull_request_target|workflow_run|secrets\.|id-token:|contents: write|permissions: write/iu);
  });
  it("checks source, dependencies, migrations and native gates, without deployment", () => {
    for (const command of ["pnpm lint", "pnpm typecheck", "pnpm test", "pnpm test:database", "pnpm build", "pnpm audit --prod", "pnpm test:database:native"]) expect(workflow).toContain(command);
    expect(workflow).not.toMatch(/vercel (?:deploy|promote|pull)|supabase (?:db push|migration up|functions deploy)|DATABASE_URL|SUPABASE_SERVICE_ROLE/iu);
    expect(workflow).toContain("INTAKE_NATIVE_PG_BIN: /usr/lib/postgresql/17/bin");
  });
  it("states that conditional Finance and real operational gates are not proven", () => {
    expect(workflow).toContain("Finance cross-repository test is conditional");
    expect(workflow).toContain("PRODUCTION_GATES.md remain required");
    expect(workflow).toContain("Source checks are not formal release approval");
  });
});
