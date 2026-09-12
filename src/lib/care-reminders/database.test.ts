import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { bootstrapSql } from "../../../scripts/lib/pglite-bootstrap.mjs";
import { parseCentralCareHtml } from "@/lib/imports/parser";
import { validateHtmlImportFile } from "@/lib/imports/validation";
import { CARE_REMINDER_RULES, suggestCareReminders } from "./rules";
import { reminderSnapshotSchema, reminderReceiptSchema } from "./contracts";

const org = "a0500000-0000-4000-8000-000000000001";
const branch = "a0600000-0000-4000-8000-000000000001";
const clientId = "ae000000-0000-4000-8000-000000000001";
const otherClient = "ae000000-0000-4000-8000-000000000002";
const actor = "a0100000-0000-4000-8000-000000000001";
const fixture = (value = "需要協助", extra = "") => parseCentralCareHtml(validateHtmlImportFile({ fileName: "synthetic.html", mimeType: "text/html",
  bytes: new TextEncoder().encode(`<html><h5>E.日常活動功能</h5><table><tr><th>移位</th><td>${value}</td></tr>${extra}</table></html>`),
}), "central-care-plan-html@1");

describe("CMS care reminders real scoped PostgreSQL boundary", () => {
  let db: PGlite;
  beforeAll(async () => {
    db = new PGlite(); await db.exec(bootstrapSql);
    for (const file of (await readdir(resolve("supabase/migrations"))).filter((name) => name.endsWith(".sql")).sort()) await db.exec(await readFile(resolve("supabase/migrations", file), "utf8"));
    await db.exec(await readFile(resolve("supabase/seed.sql"), "utf8"));
    // Reuse synthetic real-Auth fixture only, not admission bypasses or tests.
    const existing = await readFile(resolve("supabase/tests/trusted_import_upload_staging.test.sql"), "utf8");
    const start = existing.indexOf("-- Synthetic fixtures");
    const end = existing.indexOf("select ok(not has_table_privilege");
    if (start < 0 || end <= start) throw new Error("Synthetic fixture boundary changed");
    await db.exec(existing.slice(start, end));
    await db.query(`insert into public.clients(id,organization_id,branch_id,client_code,display_name,status)
      values($1,$2,$3,'attention-main','合成提醒個案','active'),($4,$2,'a0600000-0000-4000-8000-000000000002','attention-other','合成他分支個案','active')`, [clientId,org,branch,otherClient]);
  }, 60000);
  beforeEach(async () => { await db.exec("begin; select set_config('test.import_amr',(select floor(extract(epoch from min(created_at)))::text from auth.mfa_amr_claims),true); select pg_temp.import_login();"); });
  afterEach(async () => { await db.exec("rollback"); });
  afterAll(async () => { await db?.close(); });
  async function scalar<T>(sql: string, args: unknown[] = []) { return (await db.query<{value:T}>(sql, args)).rows[0]!.value; }
  async function rpc<T>(sql: string, args: unknown[] = []): Promise<T> {
    await db.exec("savepoint reminder_rpc; set local role authenticated");
    try { const result = await scalar<T>(sql,args); await db.exec("reset role; release savepoint reminder_rpc"); return result; }
    catch (error) { await db.exec("rollback to savepoint reminder_rpc; reset role; release savepoint reminder_rpc"); throw error; }
  }
  async function stage(parsed = fixture(), number = 1) {
    await db.exec("select pg_temp.import_login()");
    const reservation = await rpc<{reservation_id:string}>("select pg_temp.reserve_upload($1,'synthetic.html',$2) as value", [number, number.toString(16).repeat(64)]);
    await db.query("select set_config('test.import_reservation',$1,true),set_config('test.import_payload',$2,true)",[JSON.stringify(reservation),JSON.stringify(parsed)]);
    await db.exec("set local role service_role; select pg_temp.worker_context()");
    const completed = await scalar<{payload_sha256:string}>("select pg_temp.complete_upload() as value");
    await db.exec("reset role; select pg_temp.import_login()");
    return { id: reservation.reservation_id, hash: completed.payload_sha256 };
  }
  async function generate(batch: {id:string;hash:string}, key = "af000000-0000-4000-8000-000000000001", overrides: Record<string,unknown> = {}) {
    const payload = { action:"generate", client_id:clientId, batch_id:batch.id, client_version:1, payload_sha256:batch.hash,
      identity_confirmed:true, reason:"已用穩定識別資料核對合成個案",idempotency_key:key,...overrides };
    return rpc("select public.mutate_care_reminders($1,$2,$3::jsonb,$4) as value",[org,branch,JSON.stringify(payload),key]);
  }
  const snapshot = () => rpc("select public.care_reminder_snapshot($1,$2,$3) as value",[org,branch,clientId]);
  async function review(id:string, action="confirm", status="pending_review", key="af000000-0000-4000-8000-000000000002") {
    const payload = {action,client_id:clientId,reminder_id:id,expected_status:status,reason:"已核對目前照顧計畫，保存人工審查結果",idempotency_key:key};
    return rpc("select public.mutate_care_reminders($1,$2,$3::jsonb,$4) as value",[org,branch,JSON.stringify(payload),key]);
  }
  it("keeps preview and persistence rules identical", async () => {
    expect(await scalar("select private.care_reminder_rules_v1() as value")).toEqual(CARE_REMINDER_RULES);
    for(const value of ["需要協助","不需要協助","不適用","","1","需要協助但已恢復","<script>需要協助</script>"]) {
      const parsed=fixture(value);
      expect(await scalar("select private.derive_care_reminders_v1($1::jsonb) as value",[JSON.stringify(parsed)])).toEqual(suggestCareReminders(parsed.fields,parsed.mappingVersion));
    }
    for (const rule of CARE_REMINDER_RULES) {
      // Dictionary aliases were verified locally from form structure only;
      // these synthetic fixtures contain no real-client source content.
      const label = rule.labels.at(-1)!;
      for (const value of rule.values) {
        const heading = rule.section === "ASSESSMENT_C" ? "C.個案溝通能力" : "E.日常活動功能";
        const parsed = parseCentralCareHtml(validateHtmlImportFile({fileName:"synthetic-coded.html",mimeType:"text/html",
          bytes:new TextEncoder().encode(`<html><h5>${heading}</h5><table><tr><th>${label}</th><td>${value}</td></tr></table></html>`)}),"central-care-plan-html@1");
        const expected = suggestCareReminders(parsed.fields, parsed.mappingVersion);
        expect(expected).toHaveLength(1);
        expect(await scalar("select private.derive_care_reminders_v1($1::jsonb) as value",[JSON.stringify(parsed)])).toEqual(expected);
      }
    }
  });
  it("creates provenance candidates only from trusted source, requires review, and never formally imports", async () => {
    const batch=await stage(); const result=reminderReceiptSchema.parse(await generate(batch));
    expect(result).toMatchObject({affected:1,formally_imported:false,replayed:false});
    const before=reminderSnapshotSchema.parse(await snapshot());
    expect(before.reminders[0]).toMatchObject({status:"pending_review",source_kind:"trusted_staging",reviewed_at:null});
    await review(before.reminders[0]!.id);
    const after=reminderSnapshotSchema.parse(await snapshot());
    expect(after.reminders[0]).toMatchObject({status:"confirmed",reviewed_by:actor});
    expect(await scalar("select count(*)::int as value from public.import_batches")).toBe(0);
    expect(await scalar("select row_version::int as value from public.clients where id=$1",[clientId])).toBe(1);
  });
  it("does not expose private raw tables, grants no anonymous RPC and keeps public wrappers invoker", async()=>{
    expect(await scalar("select has_table_privilege('authenticated','private.care_reminders','select') as value")).toBe(false);
    expect(await scalar("select has_function_privilege('anon','public.care_reminder_snapshot(uuid,uuid,uuid)','execute') as value")).toBe(false);
    expect(await scalar("select prosecdef as value from pg_proc where oid='public.mutate_care_reminders(uuid,uuid,jsonb,uuid)'::regprocedure")).toBe(false);
    expect(await scalar("select bool_and(relrowsecurity and relforcerowsecurity) as value from pg_class where oid in ('private.care_reminders'::regclass,'private.care_reminder_reviews'::regclass,'private.care_reminder_generations'::regclass,'private.care_reminder_operations'::regclass)")).toBe(true);
  });
  it("denies foreign branch and denies missing health-field permission",async()=>{
    await expect(rpc("select public.care_reminder_snapshot($1,$2,$3) as value",[org,branch,otherClient])).rejects.toMatchObject({code:"42501"});
    await db.exec("delete from public.role_permissions where role_id='10000000-0000-4000-8000-000000000002' and permission_id=(select id from public.permissions where permission_key='health.read')");
    await expect(snapshot()).rejects.toMatchObject({code:"42501"});
  });
  it("keeps pending suggestions invisible without reviewer permissions",async()=>{
    await generate(await stage());
    await db.exec("delete from public.role_permissions where role_id='10000000-0000-4000-8000-000000000002' and permission_id=(select id from public.permissions where permission_key='imports.approve')");
    expect(reminderSnapshotSchema.parse(await snapshot())).toMatchObject({reviewer:false,reminders:[],sources:[]});
  });
  it("care-worker role reads only assigned confirmed reminders, never raw source selection or pending candidates",async()=>{
    await generate(await stage()); const s=reminderSnapshotSchema.parse(await snapshot()); await review(s.reminders[0]!.id);
    await db.exec("delete from public.membership_roles where membership_id='a0700000-0000-4000-8000-000000000001'; insert into public.membership_roles(membership_id,role_id) values('a0700000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000006')");
    await expect(snapshot()).rejects.toMatchObject({code:"42501"});
    await db.query("insert into public.client_assignments(organization_id,branch_id,client_id,assignee_user_id,assignment_kind,starts_at) values($1,$2,$3,$4,'primary',clock_timestamp()-interval '1 minute')",[org,branch,clientId,actor]);
    const worker=reminderSnapshotSchema.parse(await snapshot());
    expect(worker.reviewer).toBe(false); expect(worker.sources).toEqual([]);
    expect(worker.reminders).toHaveLength(1); expect(worker.reminders[0]!.status).toBe("confirmed");
    await expect(review(s.reminders[0]!.id,"dismiss","confirmed","af000000-0000-4000-8000-000000000099")).rejects.toMatchObject({code:"42501"});
  });
  it("rejects browser-created fields, wrong hashes, other clients, stale versions and missing identity check",async()=>{
    const batch=await stage();
    for(const patch of [{fields:fixture().fields},{payload_sha256:"f".repeat(64)},{client_id:otherClient},{client_version:2},{identity_confirmed:false}]) await expect(generate(batch,undefined,patch)).rejects.toBeDefined();
    expect(await scalar("select count(*)::int as value from private.care_reminders")).toBe(0);
  });
  it("same operation is idempotent and signed/confirmed source records cannot be overwritten",async()=>{
    const batch=await stage(); await generate(batch);
    expect(reminderReceiptSchema.parse(await generate(batch)).replayed).toBe(true);
    const s=reminderSnapshotSchema.parse(await snapshot()); await review(s.reminders[0]!.id);
    await expect(db.query("update private.care_reminders set body='tampered'")).rejects.toMatchObject({code:"55000"});
    // Roll back failed owner DML savepoint is covered by each independent test.
  });
  it("blocks conflicting options",async()=>{
    const parsed=fixture("需要協助",'<tr><th>移位</th><td>不需要協助</td></tr>');
    expect(reminderReceiptSchema.parse(await generate(await stage(parsed))).affected).toBe(0);
    expect(reminderSnapshotSchema.parse(await snapshot()).reminders).toEqual([]);
  });
  it("new source supersedes pending suggestions but preserves confirmed reminders with source-change warning",async()=>{
    await generate(await stage()); const original=reminderSnapshotSchema.parse(await snapshot()).reminders[0]!;
    await review(original.id);
    await generate(await stage(fixture("完全依賴"),2),"af000000-0000-4000-8000-000000000003");
    const s=reminderSnapshotSchema.parse(await snapshot());
    expect(s.reminders.find(r=>r.id===original.id)).toMatchObject({status:"confirmed",source_changed:true,source:{sourceValue:"需要協助"}});
    expect(s.reminders.filter(r=>r.status==="pending_review")).toHaveLength(1);
  });
  it("a source replacement blocks review of stale pending candidates and retains only the new review queue",async()=>{
    await generate(await stage()); const old=reminderSnapshotSchema.parse(await snapshot()).reminders[0]!;
    await generate(await stage(fixture("完全依賴"),2),"af000000-0000-4000-8000-000000000003");
    await expect(review(old.id)).rejects.toMatchObject({code:"40001"});
    const s=reminderSnapshotSchema.parse(await snapshot()); expect(s.reminders).toHaveLength(1);
    expect(s.reminders[0]!.id).not.toBe(old.id);
  });
  it("rejects revoked sessions and keeps source content out of audit metadata",async()=>{
    await generate(await stage());
    expect(await scalar("select bool_and(metadata::text not like '%需要協助%' and metadata::text not like '%穩定識別%') as value from public.audit_events where table_name like 'private.care_reminder%'")).toBe(true);
    await db.exec("delete from auth.mfa_amr_claims where session_id='a0300000-0000-4000-8000-000000000001'; delete from auth.sessions where id='a0300000-0000-4000-8000-000000000001'");
    await expect(snapshot()).rejects.toMatchObject({code:"42501"});
  });
});
