import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";

import { PGlite } from "@electric-sql/pglite";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { bootstrapSql } from "../../../scripts/lib/pglite-bootstrap.mjs";
import { parseAbcdClientSearchResult } from "./client-search";

const ORG = "21800000-0000-4000-8000-000000000001";
const BRANCH = "21800000-0000-4000-8000-000000000002";
const OTHER_BRANCH = "21800000-0000-4000-8000-000000000003";
const ACTOR = "21800000-0000-4000-8000-000000000004";
const SESSION = "21800000-0000-4000-8000-000000000005";
const MEMBERSHIP = "21800000-0000-4000-8000-000000000006";

describe("Page 21 bounded, authorized client search SQL", () => {
  let database: PGlite;
  beforeAll(async () => {
    database = new PGlite();
    await database.exec(bootstrapSql);
    const directory = resolve("supabase/migrations");
    const files = (await readdir(directory)).filter((file) => file.endsWith(".sql") &&
      file <= "20260908002000_abcd_assessments_page21.sql").sort();
    for (const file of files) await database.exec(await readFile(resolve(directory, file), "utf8"));
    // The later AAL1 migration owns this helper in production; this isolated
    // AAL2 fixture only needs its original assigned-client visibility policy.
    await database.exec(`create function private.abcd_assessment_visible_client(
      p_client_id uuid,p_permission text) returns boolean
      language sql volatile security definer set search_path='' as $$
        select private.can_staff_access_client(p_client_id,p_permission);
      $$;`);
    await database.exec(await readFile(resolve(directory,
      "20260928050459_abcd_assessment_client_search.sql"), "utf8"));
    await database.query(`insert into auth.users(id,aud,role,email,created_at,updated_at)
      values ($1,'authenticated','authenticated','picker@example.invalid',now(),now())`, [ACTOR]);
    await database.query("insert into public.organizations(id,code,name) values ($1,'picker','合成評估機構')", [ORG]);
    await database.query(`insert into public.branches(id,organization_id,code,name)
      values ($1,$3,'main','萬華'),($2,$3,'other','其他分支')`, [BRANCH, OTHER_BRANCH, ORG]);
    await database.query("insert into public.profiles(id,display_name,kind) values ($1,'合成專業人員','professional')", [ACTOR]);
    await database.query(`insert into public.memberships(id,organization_id,branch_id,profile_id,status)
      values ($1,$2,$3,$4,'active')`, [MEMBERSHIP, ORG, BRANCH, ACTOR]);
    await database.query(`insert into public.membership_roles(membership_id,role_id)
      select $1,id from public.roles where role_key='professional' and is_system`, [MEMBERSHIP]);
    await database.query(`insert into public.clients(id,organization_id,branch_id,client_code,display_name,status,admitted_on)
      select ('21810000-0000-4000-8000-'||lpad(series::text,12,'0'))::uuid,
        $1,$2,'SYN-PICK-'||series,'Anna '||lpad(series::text,3,'0'),
        'active','2025-01-01' from generate_series(1,500) series`, [ORG, BRANCH]);
    await database.query(`insert into public.client_assignments(
      organization_id,branch_id,client_id,assignee_user_id,assignment_kind)
      select $1,$2,id,$3,'assessment' from public.clients
      where organization_id=$1 and branch_id=$2`, [ORG, BRANCH, ACTOR]);
    await database.query(`insert into public.clients(id,organization_id,branch_id,client_code,display_name,status,admitted_on)
      values ('21810000-0000-4000-8000-000000000601',$1,$2,'A%literal','A% name','active','2025-01-01'),
      ('21810000-0000-4000-8000-000000000602',$1,$2,'SYN-UNASSIGNED','Anna hidden','active','2025-01-01'),
      ('21810000-0000-4000-8000-000000000603',$1,$3,'SYN-OTHER','Anna other branch','active','2025-01-01')`,
    [ORG, BRANCH, OTHER_BRANCH]);
    await database.query(`insert into public.client_assignments(
      organization_id,branch_id,client_id,assignee_user_id,assignment_kind)
      values ($1,$2,'21810000-0000-4000-8000-000000000601',$3,'assessment'),
        ($1,$4,'21810000-0000-4000-8000-000000000603',$3,'assessment')`, [ORG, BRANCH, ACTOR, OTHER_BRANCH]);
    await database.query("select set_config('request.jwt.claims',$1,false)",
      [JSON.stringify({ sub: ACTOR, role: "authenticated", aal: "aal2", session_id: SESSION })]);
    await database.exec("set role authenticated");
  }, 60_000);
  beforeEach(async () => { await database.exec("begin"); });
  afterEach(async () => { await database.exec("rollback"); });
  afterAll(async () => { await database?.close(); });

  async function search(query: string) {
    const { rows } = await database.query<{ value: unknown }>(
      "select public.abcd_assessment_client_search($1::uuid,$2::uuid,$3::text) as value",
      [ORG, BRANCH, query]);
    return parseAbcdClientSearchResult(rows[0]!.value, ORG, BRANCH);
  }

  it("returns at most 20 of 500 authorized same-branch clients and signals more", async () => {
    const actual = await search("Anna");
    expect(actual.clients).toHaveLength(20);
    expect(actual.hasMore).toBe(true);
    expect(actual.clients.map((client) => client.displayName)).toEqual(
      Array.from({ length: 20 }, (_, index) => `Anna ${String(index + 1).padStart(3, "0")}`));
    expect(JSON.stringify(actual)).not.toMatch(/hidden|other branch/u);
  });

  it("finds the 500th authorized client beyond the original snapshot's 200 choices", async () => {
    const actual = await search("Anna 500");
    expect(actual.hasMore).toBe(false);
    expect(actual.clients).toEqual([{ clientId: "21810000-0000-4000-8000-000000000500",
      displayName: "Anna 500", clientCode: "SYN-PICK-500", clientCodeTruncated: false }]);
  });

  it("treats SQL wildcard characters literally and audits without the query", async () => {
    const actual = await search("A%");
    expect(actual.clients).toEqual([{ clientId: "21810000-0000-4000-8000-000000000601",
      displayName: "A% name", clientCode: "A%literal", clientCodeTruncated: false }]);
    await database.exec("reset role");
    const { rows } = await database.query<{ metadata: unknown }>(
      "select metadata from public.audit_events where table_name='abcd_assessment_client_search'");
    expect(rows).toHaveLength(1);
    expect(JSON.stringify(rows[0]!.metadata)).not.toContain("A%");
  });

  it("denies one-character searches", async () => {
    await expect(search("A")).rejects.toThrow(/invalid/u);
    // One SQL exception aborts the PostgreSQL transaction, so rate-limit and
    // authority cases run in separate transactions below.
  });

  it("caps this actor at twenty searches per rolling minute", async () => {
    for (let attempt = 0; attempt < 20; attempt += 1) await search("A%");
    await expect(search("A%")).rejects.toThrow(/rate limit/u);
  }, 20_000);

  it("rejects a forged branch instead of returning the other branch's names", async () => {
    await expect(database.query<{ value: unknown }>(
      "select public.abcd_assessment_client_search($1::uuid,$2::uuid,$3::text) as value",
      [ORG, OTHER_BRANCH, "Anna"])).rejects.toThrow(/not permitted/u);
  });
});
