import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { bootstrapSql } from "../../../scripts/lib/pglite-bootstrap.mjs";
import { parseClaimValidationDatabaseReceipt } from "./claim-validation-client";

const ORG = "70100000-0000-4000-8000-000000000001";
const BRANCH = "70200000-0000-4000-8000-000000000001";
const ACTOR = "70000000-0000-4000-8000-000000000001";
const SESSION = "70600000-0000-4000-8000-000000000001";
const BATCH = "72000000-0000-4000-8000-000000000001";
const KEY = "49040000-0000-4000-8000-000000000001";
const OTHER = "49040000-0000-4000-8000-000000000002";

describe("claim validation persisted SQL receipt contract", () => {
  let database: PGlite;
  beforeAll(async () => {
    database = new PGlite(); await database.exec(bootstrapSql);
    const directory = resolve("supabase/migrations");
    const migrations = (await readdir(directory)).filter((file) => file.endsWith(".sql") &&
      file <= "20260908004000_claim_validation_receipts.sql").sort();
    expect(migrations.at(-1)).toBe("20260908004000_claim_validation_receipts.sql");
    for (const file of migrations) await database.exec(await readFile(resolve(directory, file), "utf8"));
    await database.exec(await readFile(resolve("supabase/seed.sql"), "utf8"));
    // Reuse the existing synthetic claim fixture verbatim, before its forged
    // defensive-export evidence or assertions. Never copy real client data.
    const source = await readFile(resolve("supabase/tests/atomic_claim_workflows.test.sql"), "utf8");
    const start = source.indexOf("insert into auth.users (");
    const end = source.indexOf("-- Defensive export tests");
    expect(start).toBeGreaterThan(0); expect(end).toBeGreaterThan(start);
    await database.exec(source.slice(start, end));
    await database.query("select set_config('request.jwt.claims',$1,false)", [JSON.stringify({
      sub: ACTOR, role: "authenticated", aal: "aal2", session_id: SESSION,
    })]);
    await database.exec("set role authenticated");
  }, 60_000);
  beforeEach(async () => { await database.exec("begin"); });
  afterEach(async () => { await database.exec("rollback"); });
  afterAll(async () => { await database?.close(); });

  async function validate(key = KEY, amount = "30.00", org = ORG, branch = BRANCH, count = 2) {
    const { rows } = await database.query<{ value: unknown }>(`select to_jsonb(result) as value
      from public.validate_claim_batch_receipt($1::uuid,$2::uuid,$3::uuid,$4::numeric,$5::integer,$6::uuid) result`,
    [org, branch, BATCH, amount, count, key]);
    expect(rows).toHaveLength(1);
    return parseClaimValidationDatabaseReceipt(rows[0]!.value, { claimBatchId: BATCH,
      expectedTotalAmount: amount, expectedItemCount: count, organizationId: org, branchId: branch, databaseIdempotencyKey: key });
  }
  it("projects the exact database JSON with persisted scope and operation evidence", async () => {
    const result = await validate();
    expect(result).toMatchObject({ organization_id: ORG, branch_id: BRANCH, idempotency_key: KEY,
      claim_batch_id: BATCH, total_amount: "30.00", item_count: 2, status: "validated", replayed: false });
    const { rows } = await database.query<{ key: string; hash: string }>(`select
      validation_idempotency_key as key, validation_request_hash as hash from public.claim_batches where id=$1`, [BATCH]);
    expect(result.idempotency_key).toBe(rows[0]!.key); expect(result.request_hash).toBe(rows[0]!.hash);
    expect(await validate()).toEqual({ ...result, replayed: true });
  });
  it("replays original evidence even after the batch is exported", async () => {
    const result = await validate();
    await database.query(`select * from public.export_claim_batch($1::uuid,$2::uuid,$3::uuid,$4::numeric,$5::uuid)`,
      [ORG, BRANCH, BATCH, "30.00", OTHER]);
    expect(await validate()).toEqual({ ...result, replayed: true });
  });
  it("refuses a same-key changed amount", async () => {
    await validate(); await expect(validate(KEY, "31.00")).rejects.toMatchObject({ code: "23505" });
  });
  it("rolls back validation when the confirmed count changes despite an identical amount", async () => {
    await database.exec("savepoint confirmed_count");
    await expect(validate(KEY, "30.00", ORG, BRANCH, 3)).rejects.toMatchObject({ code: "55000" });
    await database.exec("rollback to savepoint confirmed_count");
    const { rows } = await database.query(`select status,validation_idempotency_key from public.claim_batches where id=$1`, [BATCH]);
    expect(rows).toEqual([{ status: "draft", validation_idempotency_key: null }]);
    expect((await validate()).replayed).toBe(false);
  });
  it("refuses to bind a different operation key to an already validated batch", async () => {
    await validate(); await expect(validate(OTHER)).rejects.toMatchObject({ code: "P2001" });
  });
  it("refuses cross-organization or cross-branch receipt reads", async () => {
    await expect(validate(KEY, "30.00", "70100000-0000-4000-8000-000000000002",
      "70200000-0000-4000-8000-000000000002")).rejects.toMatchObject({ code: "42501" });
  });
  it("requires recent same-session MFA even for an exact replay", async () => {
    await validate();
    await database.query("select set_config('request.jwt.claims',$1,true)", [JSON.stringify({
      sub: ACTOR, role: "authenticated", aal: "aal2", session_id: OTHER,
    })]);
    await expect(validate()).rejects.toMatchObject({ code: "42501" });
  });
  it("is an authenticated-only invoker wrapper", async () => {
    const { rows } = await database.query<{ definer: boolean; staff: boolean; anon: boolean }>(`select
      p.prosecdef as definer,
      has_function_privilege('authenticated',p.oid,'execute') as staff,
      has_function_privilege('anon',p.oid,'execute') as anon
      from pg_proc p where p.oid='public.validate_claim_batch_receipt(uuid,uuid,uuid,numeric,integer,uuid)'::regprocedure`);
    expect(rows).toEqual([{ definer: false, staff: true, anon: false }]);
  });
});
