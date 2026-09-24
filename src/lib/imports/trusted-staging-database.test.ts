import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";

import { PGlite } from "@electric-sql/pglite";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi, type Mock } from "vitest";

import { bootstrapSql } from "../../../scripts/lib/pglite-bootstrap.mjs";
import type { ImportActor, HtmlImportFile } from "./types";
import type { ArchivedObject } from "./worm-archive";
import { stageTrustedHtmlImport, type StagingRpcClient, type TrustedStagingDependencies } from "./trusted-staging";

vi.mock("server-only", () => ({}));

const actor: ImportActor = {
  organizationId: "a9050000-0000-4000-8000-000000000001",
  branchId: "a9060000-0000-4000-8000-000000000001",
  userId: "a9010000-0000-4000-8000-000000000001",
  assuranceLevel: "aal2", recentAal2At: new Date().toISOString(),
};
const session = "a9030000-0000-4000-8000-000000000001";
const fixture = (): HtmlImportFile => ({
  fileName: "synthetic-central.html", mimeType: "text/html",
  bytes: new TextEncoder().encode('<!doctype html><html><body><h5>申請表</h5><table><tr><th>測試欄位</th><td>合成值，不是真人</td></tr></table><h5>未識別區段</h5><table><tr><th>保留內容</th><td>合成未知值</td></tr></table><script>fetch("https://example.invalid")</script></body></html>'),
});

// Real migration/RPC JSON crosses the TypeScript boundary. Only AWS is faked;
// all authentication rows are synthetic and CEO admission is never overridden.
describe("trusted staging TypeScript to local PostgreSQL contract", () => {
  let db: PGlite;
  let claims: string;
  let dependencies: TrustedStagingDependencies;
  let archive: Mock<TrustedStagingDependencies["archive"]["archive"]>;

  beforeAll(async () => {
    db = new PGlite();
    await db.exec(bootstrapSql);
    for (const file of (await readdir(resolve("supabase/migrations"))).filter((name) => name.endsWith(".sql")).sort()) {
      await db.exec(await readFile(resolve("supabase/migrations", file), "utf8"));
    }
    await db.exec(await readFile(resolve("supabase/seed.sql"), "utf8"));
    await db.query(`insert into auth.users(id,aud,role,email,email_confirmed_at,created_at,updated_at)
      values($1,'authenticated','authenticated','staging-executive@example.invalid',now()-interval '1 day',now()-interval '1 day',now())`, [actor.userId]);
    await db.query(`insert into auth.sessions(id,user_id,created_at,aal) values($1,$2,now()-interval '3 minutes','aal2')`, [session, actor.userId]);
    await db.query(`insert into auth.identities(id,provider_id,user_id,identity_data,provider) values
      ('a9020000-0000-4000-8000-000000000001','staging-synthetic-subject',$1,
      '{"sub":"staging-synthetic-subject","email":"staging-executive@example.invalid","email_verified":true}','google')`, [actor.userId]);
    const amr = Math.floor(Date.now() / 1000) - 60;
    await db.query(`insert into auth.mfa_amr_claims(id,session_id,created_at,updated_at,authentication_method) values
      ('a9040000-0000-4000-8000-000000000001',$1,to_timestamp($2),to_timestamp($2),'oauth'),
      ('a9040000-0000-4000-8000-000000000002',$1,to_timestamp($2),to_timestamp($2),'totp')`, [session, amr]);
    await db.query(`insert into private.executive_access_policy(allowed_user_id,allowed_email,google_subject,enabled,approval_reference)
      values($1,'staging-executive@example.invalid','staging-synthetic-subject',true,'synthetic local test policy')`, [actor.userId]);
    await db.query(`insert into public.organizations(id,code,name) values($1,'trusted_staging_contract','合成匯入機構')`, [actor.organizationId]);
    await db.query(`insert into public.branches(id,organization_id,code,name) values($1,$2,'main','合成分支')`, [actor.branchId, actor.organizationId]);
    await db.query(`insert into public.profiles(id,display_name,kind) values($1,'合成操作員','staff')`, [actor.userId]);
    await db.query(`insert into public.memberships(id,organization_id,branch_id,profile_id,status,starts_at)
      values('a9070000-0000-4000-8000-000000000001',$1,$2,$3,'active',now()-interval '1 day')`, [actor.organizationId, actor.branchId, actor.userId]);
    await db.exec(`insert into public.membership_roles(membership_id,role_id)
      select 'a9070000-0000-4000-8000-000000000001',id from public.roles where role_key='organization_manager' and is_system;
      insert into private.reauth_challenges(id,user_id,session_id,nonce_sha256,idempotency_key,issued_jwt_iat,
      created_at,expires_at,consumed_at,consumed_jwt_iat,factor_method,factor_verified_at) values
      ('a9090000-0000-4000-8000-000000000001','${actor.userId}','${session}',repeat('a',64),gen_random_uuid(),now()-interval '3 minutes',
      now()-interval '2 minutes',now()+interval '2 minutes',now()-interval '1 minute',now()-interval '1 minute','totp',now()-interval '1 minute');
      insert into private.reauth_events(user_id,session_id,challenge_id,aal,verification_method,verified_at)
      select user_id,session_id,id,'aal2','totp',factor_verified_at from private.reauth_challenges
      where id='a9090000-0000-4000-8000-000000000001';`);
    claims = JSON.stringify({
      sub: actor.userId, session_id: session, aud: "authenticated", role: "authenticated", aal: "aal2",
      is_anonymous: false, email: "staging-executive@example.invalid", iat: amr + 60, exp: amr + 1800,
      amr: [{ method: "oauth", timestamp: amr }, { method: "totp", timestamp: amr }],
    });
  }, 60_000);

  const client = (worker: boolean): StagingRpcClient => ({
    async rpc(name, parameters) {
      // Each RPC has its own savepoint, mimicking request transaction rollback;
      // outer per-test rollback keeps all fixtures isolated and local.
      await db.exec("reset role; savepoint rpc_request");
      await db.query("select set_config('request.jwt.claims',$1,true)", [worker ? '{"role":"service_role"}' : claims]);
      await db.exec(worker ? "set local role service_role" : "set local role authenticated");
      try {
        let rows: Array<{ value: unknown }>;
        if (name === "reserve_import_upload" && !worker) {
          ({ rows } = await db.query<{ value: unknown }>(`select public.reserve_import_upload($1,$2,$3,$4,$5,$6,$7,$8) as value`, [
            parameters.p_expected_organization_id, parameters.p_expected_branch_id, parameters.p_idempotency_key,
            parameters.p_file_sha256, parameters.p_file_name, parameters.p_mime_type, parameters.p_file_size_bytes, parameters.p_mapping_version,
          ]));
        } else if (name === "complete_import_upload" && worker) {
          ({ rows } = await db.query<{ value: unknown }>(`select public.complete_import_upload($1,$2,$3::jsonb) as value`, [
            parameters.p_reservation_id, parameters.p_parsed_payload, JSON.stringify(parameters.p_archive_reference),
          ]));
        } else throw new Error("Unexpected synthetic RPC");
        await db.exec("reset role; release savepoint rpc_request");
        return { data: rows[0]!.value, error: null };
      } catch (error) {
        await db.exec("rollback to savepoint rpc_request; reset role; release savepoint rpc_request");
        return { data: null, error };
      }
    },
  });

  beforeEach(async () => {
    await db.exec("begin");
    archive = vi.fn<TrustedStagingDependencies["archive"]["archive"]>(async (scope, id, bytes, sha, createdAt): Promise<ArchivedObject> => {
      const retention = new Date(createdAt); retention.setUTCFullYear(retention.getUTCFullYear() + 7);
      return {
        key: `organizations/${scope.organizationId}/branches/${scope.branchId}/central-html/${sha}/${id}.html`,
        versionId: "synthetic-object-v1", retainUntil: retention.toISOString(), sha256: sha,
        createdAt: createdAt.toISOString(), byteLength: bytes.byteLength,
      };
    });
    dependencies = { userClient: client(false), workerClient: client(true), archive: { archive } };
  });
  afterEach(async () => { await db.exec("rollback"); });
  afterAll(async () => { await db?.close(); });

  async function counts() {
    const { rows } = await db.query<{ reservations: number; completions: number; clients: number; legacy: number }>(`select
      (select count(*)::integer from private.import_upload_reservations) as reservations,
      (select count(*)::integer from private.import_upload_completions) as completions,
      (select count(*)::integer from public.clients) as clients,
      (select count(*)::integer from public.import_batches) as legacy`);
    return rows[0]!;
  }
  it("stores the real static parse and unknown content privately, returning only a checked staging receipt", async () => {
    const before = await counts();
    const receipt = await stageTrustedHtmlImport(dependencies, actor, fixture(), "contract-key");
    expect(receipt).toMatchObject({ status: "completed", staging_only: true, formally_imported: false, replayed: false });
    expect(await counts()).toEqual({ ...before, reservations: before.reservations + 1, completions: before.completions + 1 });
    const { rows } = await db.query<{ valid: boolean }>(`select
      parsed_payload->'security'->>'externalRequestCount'='0'
      and parsed_payload->'security'->>'scriptElementsBlocked'='1'
      and exists(select 1 from jsonb_array_elements(parsed_payload->'fields') f where f->>'normalizedValue'='合成未知值')
      and payload_sha256=$2 as valid from private.import_upload_completions where id=$1`, [receipt.reservation_id, receipt.payload_sha256]);
    expect(rows[0]!.valid).toBe(true);
    expect(JSON.stringify(receipt)).not.toMatch(/合成|rawValue|authorization_claims|file_name/u);
  });
  it("recovers the exact database receipt after a lost completion response without another archive write", async () => {
    const worker = dependencies.workerClient;
    dependencies.workerClient = { async rpc(name, params) {
      await worker.rpc(name, params);
      throw new Error("Synthetic response lost after database commit");
    } };
    await expect(stageTrustedHtmlImport(dependencies, actor, fixture(), "lost-response")).rejects.toMatchObject({ code: "IMPORT_STAGING_RESULT_UNKNOWN" });
    const first = await db.query<{ receipt: Record<string, unknown> }>("select receipt from private.import_upload_completions");
    const retry = await stageTrustedHtmlImport(dependencies, actor, fixture(), "lost-response");
    expect(retry).toEqual({ ...first.rows[0]!.receipt, replayed: true });
    expect(archive).toHaveBeenCalledTimes(1);
    expect((await counts()).completions).toBe(1);
  });
  it("keeps the reservation creation time and key unchanged when archive response is initially unavailable", async () => {
    archive.mockRejectedValueOnce(new Error("Synthetic archive failure"));
    await expect(stageTrustedHtmlImport(dependencies, actor, fixture(), "archive-retry")).rejects.toMatchObject({ code: "IMPORT_STAGING_ARCHIVE_UNCONFIRMED" });
    expect((await counts()).completions).toBe(0);
    const retry = await stageTrustedHtmlImport(dependencies, actor, fixture(), "archive-retry");
    expect(retry.replayed).toBe(false);
    expect(archive.mock.calls[1]![1]).toBe(archive.mock.calls[0]![1]);
    expect(archive.mock.calls[1]![4]).toEqual(archive.mock.calls[0]![4]);
    expect((await counts()).reservations).toBe(1);
  });
  it("rechecks revoked membership after archive, leaving only a reservation for reconciliation", async () => {
    const implementation = archive.getMockImplementation()!;
    archive.mockImplementation(async (...args) => {
      const result = await implementation(...args);
      await db.exec("update public.memberships set status='suspended' where id='a9070000-0000-4000-8000-000000000001'");
      return result;
    });
    const before = await counts();
    await expect(stageTrustedHtmlImport(dependencies, actor, fixture(), "revoke-before-complete")).rejects.toMatchObject({ code: "IMPORT_STAGING_DENIED" });
    expect(await counts()).toEqual({ ...before, reservations: before.reservations + 1 });
    expect(archive).toHaveBeenCalledTimes(1);
  });
  it("does not archive a second copy when another operation tries the same source", async () => {
    await stageTrustedHtmlImport(dependencies, actor, fixture(), "source-first");
    await expect(stageTrustedHtmlImport(dependencies, actor, fixture(), "source-second")).rejects.toMatchObject({ code: "IMPORT_STAGING_DUPLICATE" });
    expect(archive).toHaveBeenCalledTimes(1);
  });
  it("rolls back completion and audit together when the persistence trigger fails", async () => {
    await db.exec(`create function pg_temp.fail_staging_completion() returns trigger language plpgsql as $$
      begin raise exception 'Synthetic transaction fault'; end $$;
      create trigger zz_fail_staging_completion after insert on private.import_upload_completions
      for each row execute function pg_temp.fail_staging_completion();`);
    const before = await counts();
    await expect(stageTrustedHtmlImport(dependencies, actor, fixture(), "fault-rollback")).rejects.toMatchObject({ code: "IMPORT_STAGING_RESULT_UNKNOWN" });
    expect(await counts()).toEqual({ ...before, reservations: before.reservations + 1 });
    const result = await db.query<{ count: number }>("select count(*)::integer from public.audit_events where table_name='private.import_upload_completions'");
    expect(result.rows[0]!.count).toBe(0);
    expect(archive).toHaveBeenCalledTimes(1);
  });
});
