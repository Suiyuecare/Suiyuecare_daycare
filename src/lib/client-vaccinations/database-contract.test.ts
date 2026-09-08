import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";

import { PGlite } from "@electric-sql/pglite";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { bootstrapSql } from "../../../scripts/lib/pglite-bootstrap.mjs";
import { clientVaccinationTaipeiDate } from "./date";
import { parseClientVaccinationBatchDatabaseReceipt, parseClientVaccinationBatchInput,
  parseClientVaccinationRecordInput, parseClientVaccinationRecordReceipt } from "./parser";
import { projectClientVaccinationSnapshot,
  type ClientVaccinationSnapshotSourceRow } from "./projection";
import type { ClientVaccinationFilters } from "./types";

const ORG = "23200000-0000-4000-8000-000000000001";
const BRANCH = "23200000-0000-4000-8000-000000000002";
const ACTOR = "23200000-0000-4000-8000-000000000003";
const CLIENT = "23200000-0000-4000-8000-000000000004";
const OTHER_CLIENT = "23200000-0000-4000-8000-000000000005";
const OTHER_BRANCH = "23200000-0000-4000-8000-000000000006";
const MEMBERSHIP = "23200000-0000-4000-8000-000000000007";
const SESSION = "23200000-0000-4000-8000-000000000008";
const KEY = "23200000-0000-4000-8000-000000000010";
const OTHER_KEY = "23200000-0000-4000-8000-000000000011";
const OPERATION = "23200000-0000-4000-8000-000000000012";
const OTHER_OPERATION = "23200000-0000-4000-8000-000000000013";
const BATCH = "23200000-0000-4000-8000-000000000014";
const baseFilters: ClientVaccinationFilters = { clientId: null, vaccineName: null,
  doseNumber: null, dateFrom: null, dateTo: null, status: "all", query: "" };

function record(overrides: Record<string, unknown> = {}) {
  return { action: "create", vaccination_key: KEY, previous_version_id: null,
    expected_base_version: 0, client_id: CLIENT, vaccine_name: "Synthetic Vaccine",
    dose_number: "Dose A", vaccinated_on: clientVaccinationTaipeiDate(new Date()),
    lot_number: "SYNTHETIC-LOT", provider_name: "合成測試院所", evidence_status: "missing",
    evidence_reference_id: null, evidence_sha256: null, evidence_file_name: null,
    source_system: "manual_entry", source_record_id: null, correction_reason: null,
    ...overrides };
}

// Exercise real migrations and their JSON wire output. No mocked RPC rows are
// used, so SQL columns, filters, bigint serialization and TS strictness must agree.
describe("Page 23 PostgreSQL → TypeScript contract", () => {
  let database: PGlite;

  beforeAll(async () => {
    database = new PGlite();
    await database.exec(bootstrapSql);
    const directory = resolve("supabase/migrations");
    const files = (await readdir(directory)).filter((file) => file.endsWith(".sql") &&
      file <= "20260908001000_client_vaccinations_page23.sql").sort();
    expect(files.at(-1)).toBe("20260908001000_client_vaccinations_page23.sql");
    for (const file of files) await database.exec(await readFile(resolve(directory, file), "utf8"));
    await database.query(`insert into auth.users(id,aud,role,email,created_at,updated_at)
      values ($1,'authenticated','authenticated','contract23@example.invalid',now(),now())`, [ACTOR]);
    await database.query("insert into public.organizations(id,code,name) values ($1,'contract23','合成疫苗測試機構')", [ORG]);
    await database.query(`insert into public.branches(id,organization_id,code,name)
      values ($1,$2,'main','合成主分支'),($3,$2,'other','合成其他分支')`, [BRANCH, ORG, OTHER_BRANCH]);
    await database.query("insert into public.profiles(id,display_name,kind) values ($1,'合成護理人員','staff')", [ACTOR]);
    await database.query(`insert into public.memberships(id,organization_id,branch_id,profile_id,status)
      values ($1,$2,$3,$4,'active')`, [MEMBERSHIP, ORG, BRANCH, ACTOR]);
    await database.query(`insert into public.membership_roles(membership_id,role_id)
      select $1,id from public.roles where role_key='nurse' and is_system`, [MEMBERSHIP]);
    await database.query(`insert into public.clients(id,organization_id,branch_id,client_code,display_name,status,admitted_on)
      values ($1,$2,$3,'SYN-CONTRACT-1','合成個案甲','active',current_date-90),
      ($4,$2,$5,'SYN-CONTRACT-2','合成其他分支個案','active',current_date-90)`,
    [CLIENT, ORG, BRANCH, OTHER_CLIENT, OTHER_BRANCH]);
    await database.query(`insert into public.client_assignments(organization_id,branch_id,client_id,assignee_user_id,assignment_kind)
      values ($1,$2,$3,$4,'vaccination')`, [ORG, BRANCH, CLIENT, ACTOR]);
    await database.query(`insert into private.reauth_challenges(id,user_id,session_id,nonce_sha256,
      idempotency_key,issued_jwt_iat,created_at,expires_at,consumed_at,consumed_jwt_iat,factor_method,factor_verified_at)
      values ($1,$2,$3,repeat('a',64),$1,clock_timestamp()-interval '2 minutes',
      clock_timestamp()-interval '2 minutes',clock_timestamp()+interval '5 minutes',
      clock_timestamp()-interval '30 seconds',clock_timestamp()-interval '30 seconds',
      'totp',clock_timestamp()-interval '30 seconds')`, ["23200000-0000-4000-8000-000000000020", ACTOR, SESSION]);
    await database.query(`insert into private.reauth_events(user_id,session_id,challenge_id,aal,verification_method,verified_at)
      select user_id,session_id,id,'aal2',factor_method,factor_verified_at from private.reauth_challenges where user_id=$1`, [ACTOR]);
    await database.query("select set_config('request.jwt.claims',$1,false)",
      [JSON.stringify({ sub: ACTOR, role: "authenticated", aal: "aal2", session_id: SESSION })]);
    await database.exec("set role authenticated");
  }, 60_000);
  beforeEach(async () => { await database.exec("begin"); });
  afterEach(async () => { await database.exec("rollback"); });
  afterAll(async () => { await database?.close(); });

  async function snapshot(filters = baseFilters) {
    const { rows } = await database.query<{ value: ClientVaccinationSnapshotSourceRow }>(
      `select to_jsonb(result) as value from public.client_vaccination_snapshot(
        $1::uuid,$2::uuid,$3::uuid,$4::text,$5::text,$6::date,$7::date,$8::text,$9::text) result`,
      [ORG, BRANCH, filters.clientId, filters.vaccineName, filters.doseNumber,
        filters.dateFrom, filters.dateTo, filters.status === "all" ? null : filters.status, filters.query || null]);
    expect(rows).toHaveLength(1);
    return projectClientVaccinationSnapshot({ row: rows[0]!.value,
      expectedOrganizationId: ORG, expectedBranchId: BRANCH, filters, demo: false });
  }

  async function append() {
    const input = parseClientVaccinationRecordInput(record(), OPERATION);
    const { rows } = await database.query<{ value: unknown }>(
      `select to_jsonb(result) as value from public.append_client_vaccination(
        $1::uuid,$2::uuid,$3::text,$4::uuid,$5::uuid,$6::integer,$7::uuid,$8::text,
        $9::text,$10::date,$11::text,$12::text,$13::text,$14::uuid,$15::text,$16::text,
        $17::text,$18::text,$19::text,$20::uuid) result`,
      [ORG, BRANCH, input.action, input.vaccinationKey, input.previousVersionId,
        input.expectedBaseVersion, input.clientId, input.vaccineName, input.doseNumber,
        input.vaccinatedOn, input.lotNumber, input.providerName, input.evidenceStatus,
        null, null, null, input.sourceSystem, null, null, input.idempotencyKey]);
    return parseClientVaccinationRecordReceipt(rows[0]!.value, input, ORG, BRANCH);
  }

  async function batch(items: { idempotency_key: string; record: ReturnType<typeof record> }[]) {
    const input = parseClientVaccinationBatchInput({ items }, BATCH);
    const { rows } = await database.query<{ value: unknown }>(
      "select to_jsonb(result) as value from public.append_client_vaccination_batch($1::uuid,$2::uuid,$3::jsonb,$4::uuid) result",
      [ORG, BRANCH, JSON.stringify(items), BATCH]);
    return parseClientVaccinationBatchDatabaseReceipt(rows[0]!.value, input,
      items.map((item) => item.idempotency_key), BATCH, ORG, BRANCH);
  }

  it("projects the exact empty RPC row, server staleness and authorized client options", async () => {
    const actual = await snapshot();
    expect(actual.recordTotal).toBe(0);
    expect(actual.clientOptions.map((item) => item.clientId)).toEqual([CLIENT]);
    expect(Date.parse(actual.staleAfter) - Date.parse(actual.generatedAt)).toBe(60_000);
  });

  it("accepts real create/replay receipts and the resulting strict snapshot", async () => {
    const created = await append();
    expect(created.replayed).toBe(false);
    const replayed = await append();
    expect(replayed).toEqual({ ...created, replayed: true });
    const actual = await snapshot();
    expect(actual.recordTotal).toBe(1);
    expect(actual.historyTotal).toBe(1);
    expect(actual.records[0]!.recordVersionId).toBe(created.recordVersionId);
    expect(actual.records[0]!.contentHash).toBe(created.contentHash);
    const filtered = await snapshot({ ...baseFilters, clientId: CLIENT,
      dateFrom: actual.snapshotDate, dateTo: actual.snapshotDate, status: "active",
      query: "SYN-CONTRACT-1 合成個案甲" });
    expect(filtered.recordTotal).toBe(1);
  });

  it("retains raw filter variants while normalized duplicate warnings stay consistent", async () => {
    const items = [{ idempotency_key: OPERATION, record: record() },
      { idempotency_key: OTHER_OPERATION, record: record({ vaccination_key: OTHER_KEY,
        vaccine_name: "synthetic vaccine", dose_number: "dose a" }) }];
    expect((await batch(items)).succeededTotal).toBe(2);
    const replayed = await batch(items);
    expect(replayed.replayed).toBe(true);
    expect(replayed.results.map((item) => item.status)).toEqual(["replayed", "replayed"]);
    const actual = await snapshot();
    expect(actual.records.map((item) => item.vaccinationKey)).toEqual([KEY, OTHER_KEY]);
    expect(actual.duplicateWarningTotal).toBe(2);
    expect(actual.vaccineOptions.map((item) => item.value).sort()).toEqual(["Synthetic Vaccine", "synthetic vaccine"]);
    const filtered = await snapshot({ ...baseFilters, vaccineName: "synthetic vaccine", doseNumber: "dose a" });
    expect(filtered.recordTotal).toBe(1);
    expect(filtered.historyTotal).toBe(1);
    expect(filtered.records[0]!.vaccinationKey).toBe(OTHER_KEY);
    expect(filtered.duplicateWarningTotal).toBe(1);
  });

  it("returns and safely replays a mixed batch with a cross-branch rejection", async () => {
    const items = [{ idempotency_key: OPERATION, record: record() },
      { idempotency_key: OTHER_OPERATION, record: record({ vaccination_key: OTHER_KEY, client_id: OTHER_CLIENT }) }];
    const result = await batch(items);
    expect([result.succeededTotal, result.rejectedTotal]).toEqual([1, 1]);
    expect(result.results[1]!.receipt).toBeNull();
    const replayed = await batch(items);
    expect(replayed.results.map((item) => item.status)).toEqual(["replayed", "rejected"]);
    expect((await snapshot()).recordTotal).toBe(1);
  });
});
