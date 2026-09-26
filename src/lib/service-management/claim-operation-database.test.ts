import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { bootstrapSql } from "../../../scripts/lib/pglite-bootstrap.mjs";
import { hashClaimExportRequest, hashClaimReconciliationRequest } from "./claim-request-hash";

vi.mock("server-only", () => ({}));
const ORG = "70100000-0000-4000-8000-000000000001";
const BRANCH = "70200000-0000-4000-8000-000000000001";
const ACTOR = "70000000-0000-4000-8000-000000000001";
const SESSION = "70600000-0000-4000-8000-000000000001";
const BATCH = "72000000-0000-4000-8000-000000000001";
const VALIDATE_KEY = "49050000-0000-4000-8000-000000000001";
const EXPORT_KEY = "49050000-0000-4000-8000-000000000002";
const RECONCILE_KEY = "49050000-0000-4000-8000-000000000003";
const OTHER_KEY = "49050000-0000-4000-8000-000000000004";
const results = [
  { claim_item_id: "72100000-0000-4000-8000-000000000002", outcome: "rejected" as const, response_code: "R1", response_message: " 合成退件 😀 \"理由\" " },
  { claim_item_id: "72100000-0000-4000-8000-000000000001", outcome: "accepted" as const, response_code: "OK", response_message: null },
];
type Receipt = Record<string, unknown> & { request_hash: string; committed_at: string; replayed: boolean };

describe("persisted claim export and reconciliation SQL receipts", () => {
  let database: PGlite;
  beforeAll(async () => {
    database = new PGlite();
    await database.exec(bootstrapSql);
    const directory = resolve("supabase/migrations");
    const files = (await readdir(directory)).filter((file) => file.endsWith(".sql")).sort();
    const baseline = "20260908004000_claim_validation_receipts.sql";
    expect(files).toContain(baseline);
    for (const file of files.filter((file) => file <= baseline)) {
      await database.exec(await readFile(resolve(directory, file), "utf8"));
    }
    await database.exec(await readFile(resolve("supabase/seed.sql"), "utf8"));
    // Synthetic upgrade fixture only, before the executive admission migration.
    // Apply every remaining migration unchanged: no admission/auth helper bypass.
    const source = await readFile(resolve("supabase/tests/atomic_claim_workflows.test.sql"), "utf8");
    const start = source.indexOf("insert into auth.users (");
    const end = source.indexOf("-- Defensive export tests");
    expect(start).toBeGreaterThan(0); expect(end).toBeGreaterThan(start);
    await database.exec(source.slice(start, end));
    for (const file of files.filter((file) => file > baseline)) {
      await database.exec(await readFile(resolve(directory, file), "utf8"));
    }
    const oauthAt = Math.floor(Date.now() / 1000) - 120;
    const totpAt = Math.floor(Date.now() / 1000) - 30;
    await database.query(`insert into auth.identities(id,provider_id,user_id,identity_data,provider)
      values($1::uuid,'synthetic-claim-google',$2::uuid,
      '{"sub":"synthetic-claim-google","email":"claims-a@example.invalid","email_verified":true}', 'google')`, [OTHER_KEY, ACTOR]);
    await database.query(`insert into auth.sessions(id,user_id,created_at,aal)
      values($1::uuid,$2::uuid,clock_timestamp()-interval '3 minutes','aal2')`, [SESSION, ACTOR]);
    for (const [index, method, time] of [[1, "oauth", oauthAt], [2, "totp", totpAt]] as const) {
      await database.query(`insert into auth.mfa_amr_claims(id,session_id,created_at,updated_at,authentication_method)
        values($1::uuid,$2::uuid,to_timestamp($3),to_timestamp($3),$4)`,
      [`49060000-0000-4000-8000-00000000000${index}`, SESSION, time, method]);
    }
    await database.query(`insert into private.executive_access_policy
      (allowed_user_id,allowed_email,google_subject,enabled,approval_reference)
      values($1::uuid,'claims-a@example.invalid','synthetic-claim-google',true,'Synthetic claim upgrade test only')`, [ACTOR]);
    await database.query("select set_config('request.jwt.claims',$1,false)", [JSON.stringify({
      sub: ACTOR, role: "authenticated", aud: "authenticated", aal: "aal2", session_id: SESSION,
      email: "claims-a@example.invalid", is_anonymous: false, iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 1800,
      amr: [{ method: "oauth", timestamp: oauthAt }, { method: "totp", timestamp: totpAt }],
    })]);
    await database.exec("set role authenticated");
    const authority = await database.query(`select public.is_executive_login_allowed() as admitted,
      public.has_recent_aal2(15) as recent`);
    expect(authority.rows).toEqual([{ admitted: true, recent: true }]);
  }, 90_000);
  beforeEach(async () => { await database.exec("begin"); });
  afterEach(async () => { await database.exec("rollback"); });
  afterAll(async () => { await database?.close(); });

  async function owner(sql: string) {
    await database.exec("reset role");
    // Do not mask the original SQL error with SET ROLE on an aborted transaction.
    await database.exec(sql);
    await database.exec("set role authenticated");
  }
  async function validate() {
    await database.query("select * from public.validate_claim_batch($1::uuid,$2::uuid,$3::uuid,$4::numeric,$5::uuid)",
      [ORG, BRANCH, BATCH, "30.00", VALIDATE_KEY]);
  }
  async function exportReceipt(key = EXPORT_KEY, amount = "30.00", org = ORG, branch = BRANCH) {
    const { rows } = await database.query<{ value: Receipt }>(`select to_jsonb(result) as value from
      public.export_claim_batch_receipt($1::uuid,$2::uuid,$3::uuid,$4::numeric,$5::uuid) result`,
    [org, branch, BATCH, amount, key]);
    expect(rows).toHaveLength(1); return rows[0]!.value;
  }
  async function reconcileReceipt(key = RECONCILE_KEY, entries = results, amount = "30.00", org = ORG, branch = BRANCH) {
    const { rows } = await database.query<{ value: Receipt }>(`select to_jsonb(result) as value from
      public.reconcile_claim_batch_receipt($1::uuid,$2::uuid,$3::uuid,$4::numeric,$5::jsonb,$6::uuid) result`,
    [org, branch, BATCH, amount, JSON.stringify(entries), key]);
    expect(rows).toHaveLength(1); return rows[0]!.value;
  }
  async function rejected(action: () => Promise<unknown>, code: string) {
    await database.exec("savepoint expected_rejection");
    await expect(action()).rejects.toMatchObject({ code });
    await database.exec("rollback to savepoint expected_rejection");
  }
  async function batchState() {
    const { rows } = await database.query(`select status,export_idempotency_key,reconciliation_idempotency_key
      from public.claim_batches where id=$1::uuid`, [BATCH]);
    return rows[0];
  }
  it("binds actual persisted export scope, key, JSONB request hash, snapshot and original commit time", async () => {
    await validate(); const receipt = await exportReceipt();
    expect(receipt).toMatchObject({ organization_id: ORG, branch_id: BRANCH, idempotency_key: EXPORT_KEY,
      claim_batch_id: BATCH, format_version: "test-main", status: "exported", item_count: 2,
      total_amount: 30, replayed: false, snapshot_hash_version: "postgres-jsonb-v1" });
    expect(receipt.request_hash).toBe(hashClaimExportRequest({ idempotencyKey: "synthetic-raw-key",
      claimBatchId: BATCH, expectedTotalAmount: "30.00" }, { organizationId: ORG, branchId: BRANCH }));
    const { rows } = await database.query<{ value: Record<string, unknown> }>(`select jsonb_build_object(
      'request_hash',export_request_hash,'idempotency_key',export_idempotency_key,'committed_at',exported_at,
      'snapshot_hash',snapshot_hash,'snapshot_hash_version',snapshot_hash_version) as value from public.claim_batches where id=$1`, [BATCH]);
    expect(receipt).toMatchObject(rows[0]!.value);
    expect(await exportReceipt()).toEqual({ ...receipt, replayed: true });
  });
  it("binds reconciliation to actual persisted normalized response hash and original commit time", async () => {
    await validate(); await exportReceipt(); const receipt = await reconcileReceipt();
    expect(receipt).toMatchObject({ organization_id: ORG, branch_id: BRANCH, idempotency_key: RECONCILE_KEY,
      claim_batch_id: BATCH, status: "reconciled", item_count: 2, accepted_count: 1, rejected_count: 1,
      total_amount: 30, replayed: false, snapshot_hash_version: "postgres-jsonb-v1" });
    expect(receipt.request_hash).toBe(hashClaimReconciliationRequest({ idempotencyKey: "synthetic-raw-key",
      claimBatchId: BATCH, expectedTotalAmount: "30.00", results: results.map((entry) => ({
        claimItemId: entry.claim_item_id, outcome: entry.outcome, responseCode: entry.response_code,
        responseMessage: entry.response_message })) }, { organizationId: ORG, branchId: BRANCH }));
    const { rows } = await database.query<{ value: Record<string, unknown> }>(`select jsonb_build_object(
      'request_hash',reconciliation_request_hash,'idempotency_key',reconciliation_idempotency_key,
      'committed_at',reconciled_at) as value from public.claim_batches where id=$1`, [BATCH]);
    expect(receipt).toMatchObject(rows[0]!.value);
    expect(await reconcileReceipt(RECONCILE_KEY, [...results].reverse())).toEqual({ ...receipt, replayed: true });
  });
  it("replays unchanged original export evidence after reconciliation", async () => {
    await validate(); const receipt = await exportReceipt(); await reconcileReceipt();
    expect(await exportReceipt()).toEqual({ ...receipt, replayed: true });
  });
  it("rejects same export key with changed amount and different operation key without mutation", async () => {
    await validate(); const receipt = await exportReceipt(); const state = await batchState();
    await rejected(() => exportReceipt(EXPORT_KEY, "31.00"), "23505");
    await rejected(() => exportReceipt(OTHER_KEY), "P2001");
    expect(await batchState()).toEqual(state); expect(await exportReceipt()).toEqual({ ...receipt, replayed: true });
  });
  it("rejects same reconciliation key with changed body or amount and a different key without mutation", async () => {
    await validate(); await exportReceipt(); const receipt = await reconcileReceipt(); const state = await batchState();
    await rejected(() => reconcileReceipt(RECONCILE_KEY, results.map((entry) => ({ ...entry, response_code: "CHANGED" }))), "23505");
    await rejected(() => reconcileReceipt(RECONCILE_KEY, results, "31.00"), "23505");
    await rejected(() => reconcileReceipt(OTHER_KEY), "P2001");
    expect(await batchState()).toEqual(state); expect(await reconcileReceipt()).toEqual({ ...receipt, replayed: true });
  });
  it("rejects wrong organization or branch for both operations, even for a matching key", async () => {
    await validate(); await exportReceipt(); await reconcileReceipt();
    for (const [org, branch] of [[ORG, "70200000-0000-4000-8000-000000000002"],
      ["70100000-0000-4000-8000-000000000002", BRANCH]]) {
      await rejected(() => exportReceipt(EXPORT_KEY, "30.00", org, branch), "42501");
      await rejected(() => reconcileReceipt(RECONCILE_KEY, results, "30.00", org, branch), "42501");
    }
  });
  it("keeps failed reconciliation atomic without any item response or operation key", async () => {
    await validate(); await exportReceipt();
    await rejected(() => reconcileReceipt(RECONCILE_KEY, results.slice(0, 1)), "23514");
    expect(await batchState()).toMatchObject({ status: "exported", reconciliation_idempotency_key: null });
    const { rows } = await database.query("select response_outcome,response_code,response_message from public.claim_items where claim_batch_id=$1", [BATCH]);
    expect(rows).toEqual([{ response_outcome: null, response_code: null, response_message: null },
      { response_outcome: null, response_code: null, response_message: null }]);
  });
  it("requires current Google session admission and same-session recent AAL2 on exact replay", async () => {
    await validate(); await exportReceipt(); await reconcileReceipt();
    await owner(`update auth.sessions set not_after=clock_timestamp()-interval '1 second' where id='${SESSION}'`);
    await rejected(() => exportReceipt(), "42501"); await rejected(() => reconcileReceipt(), "42501");
  });
  it("preserves claims read RLS without letting direct private receipt calls bypass it", async () => {
    await validate(); await exportReceipt();
    await owner(`delete from public.role_permissions where role_id='10000000-0000-4000-8000-000000000009'
      and permission_id in(select id from public.permissions where permission_key='claims.read')`);
    const { rows } = await database.query(`select private.has_permission($1::uuid,$2::uuid,'claims.manage') as manage,
      private.has_permission($1::uuid,$2::uuid,'claims.read') as read`, [ORG, BRANCH]);
    expect(rows).toEqual([{ manage: true, read: false }]);
    await rejected(() => exportReceipt(), "42501");
    await rejected(() => database.query(`select * from private.export_claim_batch_receipt
      ($1::uuid,$2::uuid,$3::uuid,$4::numeric,$5::uuid)`, [ORG, BRANCH, BATCH, "30.00", EXPORT_KEY]), "42501");
    await rejected(() => reconcileReceipt(), "42501");
  });
  it("checks post-write authority and rolls back the entire export if authority is lost inside the transaction", async () => {
    await validate();
    await owner(`create function pg_temp.invalidate_claim_actor() returns trigger language plpgsql security definer set search_path='' as $$
      begin if old.status='validated' and new.status='exported' then
        update public.profiles set is_active=false where id='${ACTOR}'; end if; return new; end;$$;
      create trigger synthetic_claim_revoke after update on public.claim_batches
      for each row execute function pg_temp.invalidate_claim_actor();`);
    await rejected(() => exportReceipt(), "42501");
    expect(await batchState()).toMatchObject({ status: "validated", export_idempotency_key: null });
    const { rows } = await database.query("select is_active from public.profiles where id=$1", [ACTOR]);
    expect(rows).toEqual([{ is_active: true }]);
    await database.exec("reset role");
    const allocations = await database.query("select count(*)::integer as count from private.claim_service_allocations where claim_batch_id=$1", [BATCH]);
    expect(allocations.rows).toEqual([{ count: 0 }]);
    await database.exec("set role authenticated");
  });
  it("rolls back reconciliation item responses if post-write actor authority is lost", async () => {
    await validate(); await exportReceipt();
    await owner(`create function pg_temp.invalidate_reconciliation_actor() returns trigger language plpgsql security definer set search_path='' as $$
      begin if old.status='exported' and new.status='reconciled' then
        update public.profiles set is_active=false where id='${ACTOR}'; end if; return new; end;$$;
      create trigger synthetic_reconciliation_revoke after update on public.claim_batches
      for each row execute function pg_temp.invalidate_reconciliation_actor();`);
    await rejected(() => reconcileReceipt(), "42501");
    expect(await batchState()).toMatchObject({ status: "exported", reconciliation_idempotency_key: null });
    const { rows } = await database.query(`select count(*)::integer as responded from public.claim_items
      where claim_batch_id=$1::uuid and response_outcome is not null`, [BATCH]);
    expect(rows).toEqual([{ responded: 0 }]);
  });
  it("rolls back the export and allocations if original persisted commit evidence is incomplete", async () => {
    await validate();
    await owner(`create function pg_temp.poison_claim_export_time() returns trigger language plpgsql security definer set search_path='' as $$
      begin if old.status='validated' and new.status='exported' then
        update public.claim_batches set exported_at='infinity'::timestamptz where id=new.id; end if; return new; end;$$;
      create trigger synthetic_claim_receipt_mismatch after update on public.claim_batches
      for each row execute function pg_temp.poison_claim_export_time();`);
    await rejected(() => exportReceipt(), "55000");
    expect(await batchState()).toMatchObject({ status: "validated", export_idempotency_key: null });
    await database.exec("reset role");
    const { rows } = await database.query("select count(*)::integer as allocations from private.claim_service_allocations where claim_batch_id=$1", [BATCH]);
    expect(rows).toEqual([{ allocations: 0 }]);
  });
  it("allows a voided original reconciliation replay only when persisted responses still match the original hash", async () => {
    await validate(); await exportReceipt(); const receipt = await reconcileReceipt();
    await owner(`update public.claim_batches set status='voided' where id='${BATCH}'`);
    expect(await reconcileReceipt()).toEqual({ ...receipt, replayed: true });
    await owner(`update public.claim_items set response_message='Privileged synthetic maintenance change'
      where id='${results[0]!.claim_item_id}'`);
    await rejected(() => reconcileReceipt(), "55000");
  });
  it("checks original snapshot material on voided export and reconciliation replays", async () => {
    await validate(); const exported = await exportReceipt(); const reconciled = await reconcileReceipt();
    await owner(`update public.claim_batches set status='voided' where id='${BATCH}'`);
    expect(await exportReceipt()).toEqual({ ...exported, replayed: true });
    expect(await reconcileReceipt()).toEqual({ ...reconciled, replayed: true });
    // Both batch/item core edits remain guarded after voiding. First prove that
    // ordinary owner SQL is denied, then inject isolated storage corruption by
    // explicitly disabling ONLY this synthetic transaction's snapshot trigger.
    await database.exec("reset role");
    await rejected(() => database.query(`update public.claim_batches set format_version='synthetic-corrupt-format' where id=$1`, [BATCH]), "55000");
    await database.exec("set role authenticated");
    await owner(`alter table public.claim_batches disable trigger claim_batches_protect_snapshot;
      update public.claim_batches set format_version='synthetic-corrupt-format' where id='${BATCH}';
      alter table public.claim_batches enable trigger claim_batches_protect_snapshot;`);
    await rejected(() => exportReceipt(), "55000");
    await rejected(() => reconcileReceipt(), "55000");
  });
  it("exposes authenticated-only invoker RPCs and bounded private definers with empty search paths", async () => {
    const { rows } = await database.query<{ schema: string; definer: boolean; config: string[];
      staff: boolean; anon: boolean; service: boolean }>(`select n.nspname as schema,p.prosecdef as definer,p.proconfig as config,
      has_function_privilege('authenticated',p.oid,'execute') as staff,
      has_function_privilege('anon',p.oid,'execute') as anon,
      has_function_privilege('service_role',p.oid,'execute') as service
      from pg_proc p join pg_namespace n on n.oid=p.pronamespace
      where p.proname in ('export_claim_batch_receipt','reconcile_claim_batch_receipt') order by n.nspname,p.proname`);
    expect(rows).toHaveLength(4);
    for (const row of rows) expect(row).toEqual({ schema: row.schema, definer: row.schema === "private",
      config: ['search_path=""'], staff: true, anon: false, service: false });
  });
});
