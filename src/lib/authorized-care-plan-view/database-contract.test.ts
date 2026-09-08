import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";

import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { bootstrapSql } from "../../../scripts/lib/pglite-bootstrap.mjs";
import { projectAuthorizedCarePlanViewSnapshot,
  type AuthorizedCarePlanViewSourceRow } from "./projection";
import type { AuthorizedCarePlanFilters } from "./types";

const ORGANIZATION_ID = "55900000-0000-4000-8000-000000000001";
const BRANCH_ID = "55900000-0000-4000-8000-000000000002";
const ACTOR_ID = "55900000-0000-4000-8000-000000000003";
const MEMBERSHIP_ID = "55900000-0000-4000-8000-000000000004";
const CLIENT_ID = "55900000-0000-4000-8000-000000000005";
const PLAN_KEY = "55900000-0000-4000-8000-000000000006";
const VERSION_ID = "55900000-0000-4000-8000-000000000007";
const baseFilters: AuthorizedCarePlanFilters = {
  asOf: "2026-09-08",
  clientId: null,
  authorizedFrom: null,
  authorizedTo: null,
  effectiveState: "all",
  sourceSystem: null,
  page: 1,
  pageSize: 25,
};

describe("Page 55 PostgreSQL to TypeScript snapshot contract", () => {
  let database: PGlite;

  beforeAll(async () => {
    database = new PGlite();
    await database.exec(bootstrapSql);
    const directory = resolve("supabase/migrations");
    const files = (await readdir(directory)).filter((file) =>
      file.endsWith(".sql") && file <= "20260908003000_authorized_care_plan_view_page55.sql"
    ).sort();
    expect(files.at(-1)).toBe("20260908003000_authorized_care_plan_view_page55.sql");
    for (const file of files) {
      await database.exec(await readFile(resolve(directory, file), "utf8"));
    }
    await database.query(
      "insert into auth.users(id,aud,role,email,created_at,updated_at) values ($1,'authenticated','authenticated','page55-contract@example.invalid',now(),now())",
      [ACTOR_ID],
    );
    await database.query(
      "insert into public.organizations(id,code,name) values ($1,'page55_contract','Page55 合成契約機構')",
      [ORGANIZATION_ID],
    );
    await database.query(
      "insert into public.branches(id,organization_id,code,name) values ($1,$2,'main','Page55 合成契約分支')",
      [BRANCH_ID, ORGANIZATION_ID],
    );
    await database.query(
      "insert into public.profiles(id,display_name,kind) values ($1,'Page55 合成契約讀者','staff')",
      [ACTOR_ID],
    );
    await database.query(
      "insert into public.memberships(id,organization_id,profile_id,status) values ($1,$2,$3,'active')",
      [MEMBERSHIP_ID, ORGANIZATION_ID, ACTOR_ID],
    );
    await database.query(
      "insert into public.membership_roles(membership_id,role_id) select $1,id from public.roles where role_key='organization_manager' and is_system",
      [MEMBERSHIP_ID],
    );
    await database.query(
      "insert into public.clients(id,organization_id,branch_id,client_code,display_name,status,source_system) values ($1,$2,$3,'P55-CONTRACT-001','Page55 合成個案','active','test')",
      [CLIENT_ID, ORGANIZATION_ID, BRANCH_ID],
    );
    await database.query(
      `insert into public.authorized_care_plans(
        id,organization_id,branch_id,client_id,plan_key,version,status,
        effective_from,effective_to,source_system,source_record_id,source_provenance,
        service_limits,plan_data,idempotency_key,created_by
      ) values (
        $1,$2,$3,$4,$5,1,'draft','2026-09-01','2026-12-31',
        'legacy_contract','P55-RAW-001',$6::jsonb,$7::jsonb,$8::jsonb,$9,$10
      )`,
      [
        VERSION_ID,
        ORGANIZATION_ID,
        BRANCH_ID,
        CLIENT_ID,
        PLAN_KEY,
        JSON.stringify({ batch: "synthetic", location: "A-K" }),
        JSON.stringify({ legacy_limit: "not interpreted" }),
        '{"legacy_integer":9007199254740993,"legacy_html":"<script>probe()</script>"}',
        "55900000-0000-4000-8000-000000000008",
        ACTOR_ID,
      ],
    );
    await database.query("select set_config('request.jwt.claims',$1,false)", [JSON.stringify({
      sub: ACTOR_ID,
      role: "authenticated",
      aal: "aal2",
    })]);
    await database.exec("set role authenticated");
  }, 60_000);

  afterAll(async () => {
    await database?.close();
  });

  async function snapshot(filters = baseFilters) {
    const { rows } = await database.query<{ value: AuthorizedCarePlanViewSourceRow }>(
      `select to_jsonb(result) as value
       from public.authorized_care_plan_view_snapshot(
         $1::uuid,$2::uuid,$3::date,$4::uuid,$5::date,$6::date,$7::text,$8::text,
         $9::integer,$10::integer
       ) result`,
      [
        ORGANIZATION_ID, BRANCH_ID, filters.asOf, filters.clientId,
        filters.authorizedFrom, filters.authorizedTo, filters.effectiveState,
        filters.sourceSystem, filters.page, filters.pageSize,
      ],
    );
    expect(rows).toHaveLength(1);
    return projectAuthorizedCarePlanViewSnapshot({
      row: rows[0]!.value,
      expectedOrganizationId: ORGANIZATION_ID,
      expectedBranchId: BRANCH_ID,
      filters,
      demo: false,
    });
  }

  it("strictly projects a real single-statement empty-mapping draft", async () => {
    const actual = await snapshot();
    expect(actual.metrics).toMatchObject({
      matchingStreamTotal: 1,
      pageStreamCount: 1,
      historyVersionCount: 1,
      notPublishedTotal: 1,
      needsMappingTotal: 1,
    });
    expect(actual.plans[0]).toMatchObject({
      planKey: PLAN_KEY,
      clientId: CLIENT_ID,
      displayVersionId: VERSION_ID,
      publishedHead: null,
      currentPublishedId: null,
    });
    expect(actual.plans[0]!.history[0]!.planData.canonicalJson)
      .toContain("9007199254740993");
    expect(actual.plans[0]!.history[0]!.planData.canonicalJson)
      .toContain("<script>probe()</script>");
    expect(Date.parse(actual.expiresAt) - Date.parse(actual.generatedAt)).toBe(60_000);
  });

  it("keeps filter totals, rows and selected history in the same database snapshot", async () => {
    const actual = await snapshot({
      ...baseFilters,
      effectiveState: "current",
      sourceSystem: "legacy_contract",
    });
    expect(actual.metrics.matchingStreamTotal).toBe(0);
    expect(actual.metrics.pageStreamCount).toBe(0);
    expect(actual.metrics.historyVersionCount).toBe(0);
    expect(actual.plans).toEqual([]);
    expect(actual.sourceOptions).toEqual([{ sourceSystem: "legacy_contract", recordCount: 1 }]);
  });
});
