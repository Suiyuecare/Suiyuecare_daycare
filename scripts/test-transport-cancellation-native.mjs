// Native PostgreSQL validation in a disposable local cluster. Never accepts a URL
// or connects to a hosted database. Auth and Storage schemas are synthetic fixtures.
import { spawn, spawnSync } from "node:child_process";
import { mkdtemp, readFile, readdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { bootstrapSql } from "./lib/pglite-bootstrap.mjs";

const root = resolve(import.meta.dirname, "..");
const binaries = process.env.INTAKE_NATIVE_PG_BIN;
if (!binaries || !binaries.startsWith("/")) {
  throw new Error("Set INTAKE_NATIVE_PG_BIN to an existing absolute native PostgreSQL bin directory.");
}
const runtime = await mkdtemp("/tmp/daycare-cancellation-native.");
const data = join(runtime, "data");
const port = "55442";
const env = {
  PATH: process.env.PATH,
  LANG: "en_US.UTF-8",
  LC_ALL: "en_US.UTF-8",
  PGHOST: runtime,
  PGPORT: port,
  PGUSER: "postgres",
  PGDATABASE: "postgres",
  PGCONNECT_TIMEOUT: "5",
};
const run = (file, args, input) => {
  const result = spawnSync(file, args, { cwd: root, env, input, encoding: "utf8", maxBuffer: 32 * 1024 * 1024, timeout: 120_000 });
  if (result.error || result.status !== 0) throw new Error(`${file.split("/").at(-1)} failed: ${result.error?.message ?? result.stderr}`);
  return result.stdout;
};
const sql = (input) => run(join(binaries, "psql"), ["-X", "-q", "-A", "-t", "-v", "ON_ERROR_STOP=1"], input);
const concurrentSql = (input) => new Promise((resolveResult) => {
  const child = spawn(join(binaries, "psql"), ["-X", "-q", "-A", "-t", "-v", "ON_ERROR_STOP=1", "-v", "VERBOSITY=verbose"], { cwd: root, env });
  let stdout = ""; let stderr = "";
  child.stdout.on("data", (value) => { stdout += value; });
  child.stderr.on("data", (value) => { stderr += value; });
  child.on("error", (error) => resolveResult({ status: -1, stdout, stderr: error.message }));
  child.on("close", (status) => resolveResult({ status, stdout, stderr }));
  child.stdin.end(input);
});
// Keep one real connection open until the test has observed the competing
// sessions waiting on its advisory lock. No timing-only sleep establishes proof.
const holdAdvisoryLock = async (keySql) => {
  const child = spawn(join(binaries, "psql"), ["-X", "-q", "-A", "-t", "-v", "ON_ERROR_STOP=1"], { cwd: root, env });
  let stdout = ""; let stderr = ""; let released = false;
  let markReady; let failReady;
  const ready = new Promise((resolveReady, rejectReady) => { markReady = resolveReady; failReady = rejectReady; });
  const completion = new Promise((resolveCompletion) => {
    child.stdout.on("data", (value) => {
      stdout += value;
      const match = stdout.match(/^NATIVE_LOCK_READY=(\d+)$/m);
      if (match) markReady(Number(match[1]));
    });
    child.stderr.on("data", (value) => { stderr += value; });
    child.on("error", (error) => { failReady(error); resolveCompletion({ status: -1 }); });
    child.on("close", (status) => {
      failReady(new Error("Native advisory lock holder ended before readiness."));
      resolveCompletion({ status });
    });
  });
  const timeout = setTimeout(() => failReady(new Error("Native advisory lock holder readiness timed out.")), 10_000);
  child.stdin.write(`begin;set local application_name='native_document_lock_holder';
    select pg_advisory_xact_lock(${keySql});select 'NATIVE_LOCK_READY='||pg_backend_pid();\n`);
  let pid;
  try { pid = await ready; }
  catch (error) { child.stdin.end("rollback;\n"); await completion; throw error; }
  finally { clearTimeout(timeout); }
  return { pid, release: async () => {
    if (released) return;
    released = true; child.stdin.end("commit;\n");
    const result = await completion;
    if (result.status !== 0) throw new Error(`Native advisory lock holder failed: ${stderr}`);
  } };
};
const waitForAdvisoryWaiters = async (holderPid, applicationNames) => {
  if (!Number.isInteger(holderPid) || applicationNames.some((name) => !/^native_document_[a-z0-9_]+$/.test(name))) throw new Error("Invalid synthetic advisory wait probe.");
  const deadline = Date.now() + 10_000;
  const names = applicationNames.map((name) => `'${name}'`).join(",");
  while (Date.now() < deadline) {
    const waiting = Number(sql(`select count(*) from pg_stat_activity where application_name in (${names})
      and wait_event_type='Lock' and wait_event='advisory' and cardinality(pg_blocking_pids(pid))>0
      and (${holderPid}=0 or ${holderPid}=any(pg_blocking_pids(pid)));`).trim());
    if (waiting === applicationNames.length) return;
    await new Promise((resolveWait) => setTimeout(resolveWait, 25));
  }
  throw new Error("Native document writers were not observed waiting on the held advisory lock.");
};
let started = false;
try {
  console.log(run(join(binaries, "postgres"), ["--version"]).trim());
  run(join(binaries, "initdb"), ["-D", data, "-U", "postgres", "--auth-local=trust", "--auth-host=reject", "--no-locale", "--encoding=UTF8"]);
  run(join(binaries, "pg_ctl"), ["-D", data, "-l", join(runtime, "server.log"), "-o", `-k ${runtime} -p 55442 -c listen_addresses='' -c statement_timeout=60000`, "-w", "start"]);
  started = true;
  sql(bootstrapSql);
  sql("create schema storage;create table storage.buckets(id text primary key,name text not null,public boolean not null default false,file_size_limit bigint,allowed_mime_types text[]);create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text not null references storage.buckets(id),name text not null);alter table storage.objects enable row level security;");
  const migrations = (await readdir(join(root, "supabase/migrations"))).filter((name) => name.endsWith(".sql")).sort();
  for (const name of migrations) sql(await readFile(join(root, "supabase/migrations", name), "utf8"));
  sql(await readFile(join(root, "supabase/seed.sql"), "utf8"));
  console.log(`Native migration compilation: ${migrations.length}/${migrations.length}.`);
  sql(run("/usr/bin/tar", ["-xOf", join(root, "node_modules/@electric-sql/pglite/dist/pgtap.tar.gz"), "share/postgresql/extension/pgtap--1.3.5.sql"]));
  const suite = await readFile(join(root, "supabase/tests/transport_trip_cancellation.test.sql"), "utf8");
  const output = sql(suite);
  const expected = Number(suite.match(/select plan\((\d+)\)/)?.[1]);
  const passed = output.split("\n").filter((line) => /^ok \d+\b/.test(line)).length;
  if (passed !== expected || /^not ok |^# Looks like/m.test(output)) throw new Error(`Cancellation native suite failed ${passed}/${expected}: ${output}`);
  console.log(`Native cancellation assertions: ${passed}/${expected}.`);
  // Provision only synthetic test fixtures in this disposable cluster.
  const fixture = suite.slice(0,suite.indexOf("select ok(not has_table_privilege('authenticated','private.transport_trip_cancellations'"))
    .replaceAll("pg_temp.","private.cancel_native_")
    .replace("create temp table first_trip", "create table first_trip");
  const setup = sql(fixture+"select 'JWT='||current_setting('request.jwt.claims');commit;");
  const jwt = setup.split("\n").find((line) => line.startsWith("JWT="))?.slice(4);
  if (!jwt) throw new Error("Missing synthetic claims");
  const claims = `select set_config('request.jwt.claims','${jwt.replaceAll("'","''")}',true);set local role authenticated;`;
  const sid = (category,n=1) => `d7${String(category).padStart(2,"0")}0000-0000-4000-8000-${String(n).padStart(12,"0")}`;
  const payload = (n,id) => JSON.stringify({ trip_version_id:id,expected_trip_key:sid(90,n),expected_version:1,
    expected_content_hash:"a".repeat(64),expected_conflict_count:0,expected_rule_version_id:sid(80),reason:"因車輛故障取消並安排替代交通" });
  const cancel = (n,id,key,name) => `begin;set local application_name='${name}';${claims}select 'RESULT='||to_jsonb(r)::text from public.cancel_transport_trip_plan('${sid(30)}','${sid(40)}','${payload(n,id)}','${sid(99,key)}')r;commit;`;
  const start = (n,id,name) => `begin;set local application_name='${name}';${claims}select to_jsonb(r)::text from public.mutate_transport_execution('${sid(30)}','${sid(40)}',jsonb_build_object('event_type','trip_started','plan_version_id','${id}','expected_trip_key','${sid(90,n)}','expected_plan_content_hash',repeat('a',64),'expected_sequence',0,'occurred_at','2026-09-15T08:00:00+08:00','client_id',null,'note',null,'resolves_pairing',false),'${sid(98,n)}')r;commit;`;
  const receipt = (result) => JSON.parse(result.stdout.split("\n").find((line) => line.startsWith("RESULT="))?.slice(7)??"null");
  const id1 = sql("select id from first_trip;").trim();
  const hold1 = await holdAdvisoryLock(`hashtextextended('transport-trip:${sid(90)}',47)`);
  const duplicateNames = ["native_document_cancel_a","native_document_cancel_b"];
  const duplicates = [concurrentSql(cancel(1,id1,1,duplicateNames[0]))];
  await waitForAdvisoryWaiters(hold1.pid,[duplicateNames[0]]);
  duplicates.push(concurrentSql(cancel(1,id1,1,duplicateNames[1])));
  // The second writer waits on the first writer's idempotency lock, not the trip holder.
  await waitForAdvisoryWaiters(0,duplicateNames);
  await hold1.release();
  const results = await Promise.all(duplicates);const receipts=results.map(receipt);
  if(results.some(r=>r.status!==0)||receipts.some(r=>!r)||receipts[0].operation_id!==receipts[1].operation_id||receipts.filter(r=>r.replayed).length!==1)throw new Error("Concurrent duplicate cancellation failed");
  const id2=sql("select private.cancel_native_trip(2,1,array[1]);").trim();
  const hold2=await holdAdvisoryLock(`hashtextextended('transport-trip:${sid(90,2)}',47)`);
  const work2=concurrentSql(cancel(2,id2,2,"native_document_cancel_first"));
  await waitForAdvisoryWaiters(hold2.pid,["native_document_cancel_first"]);
  const start2=concurrentSql(start(2,id2,"native_document_start_second"));
  await waitForAdvisoryWaiters(0,["native_document_cancel_first","native_document_start_second"]);
  await hold2.release();
  const [c2,s2]=await Promise.all([work2,start2]);
  if(c2.status!==0||s2.status===0||!s2.stderr.includes("40001"))throw new Error(`Cancel-first race failed: ${c2.stderr} ${s2.stderr}`);
  const id3=sql("select private.cancel_native_trip(3,1,array[1]);").trim();
  const hold3=await holdAdvisoryLock(`hashtextextended('transport-trip:${sid(90,3)}',47)`);
  const work3=concurrentSql(start(3,id3,"native_document_start_first"));
  await waitForAdvisoryWaiters(hold3.pid,["native_document_start_first"]);
  const cancel3=concurrentSql(cancel(3,id3,3,"native_document_cancel_second"));
  await waitForAdvisoryWaiters(0,["native_document_start_first","native_document_cancel_second"]);
  await hold3.release();
  const [s3,c3]=await Promise.all([work3,cancel3]);
  if(s3.status!==0||c3.status===0||!c3.stderr.includes("P4701"))throw new Error(`Start-first race failed: ${s3.stderr} ${c3.stderr}`);
  console.log("Native observed races passed: duplicate key -> one cancellation/shared receipt; cancellation first -> start rejected; start first -> cancellation rejected.");
  // A scoped approver must lose passenger authority immediately when the
  // assignment is revoked while waiting for a vehicle/driver/client lock.
  const id4=sql("select private.cancel_native_trip(4,1,array[1]);").trim();
  sql(`delete from public.role_permissions where role_id='10000000-0000-4000-8000-000000000003'
    and permission_id=(select id from public.permissions where permission_key='clients.view_all');
    insert into public.client_assignments(organization_id,branch_id,client_id,assignee_user_id,assignment_kind,starts_at)
    values('${sid(30)}','${sid(40)}','${sid(60)}','${sid(10)}','care',clock_timestamp()-interval '1 year');`);
  const initialScope=sql(`begin;${claims}select private.can_staff_access_client('${sid(60)}','transport_plans.read');rollback;`).trim().split("\n").at(-1);
  if(initialScope!=="t")throw new Error("Synthetic scoped approver lacks the initial passenger assignment.");
  const hold4=await holdAdvisoryLock(`hashtextextended('transport-vehicle:${sid(40)}:van',47)`);
  let cancelled4;
  const work4=concurrentSql(cancel(4,id4,4,"native_document_cancel_revoked_passenger"));
  try {
    await waitForAdvisoryWaiters(hold4.pid,["native_document_cancel_revoked_passenger"]);
    sql(`update public.client_assignments set ends_at=clock_timestamp()
      where client_id='${sid(60)}' and assignee_user_id='${sid(10)}' and ends_at is null;`);
  } finally { await hold4.release(); }
  cancelled4=await work4;
  if(cancelled4.status===0||!cancelled4.stderr.includes("42501")||!cancelled4.stderr.includes("passenger scope changed"))
    throw new Error(`Passenger revoke-while-waiting must deny cancellation: ${cancelled4.stderr} ${cancelled4.stdout}`);
  const cancellationCount=Number(sql(`select count(*) from private.transport_trip_cancellations where trip_key='${sid(90,4)}';`).trim());
  if(cancellationCount!==0)throw new Error("Revoked passenger cancellation wrote an immutable cancellation record.");
  console.log("Native observed passenger revocation race passed: assignment revoked during vehicle lock wait -> 42501 and zero cancellation records.");
  // Receipt replay must not disclose a previous result after the same scope
  // has been revoked while waiting on the idempotency lock.
  sql(`update public.client_assignments set ends_at=null
    where client_id='${sid(60)}' and assignee_user_id='${sid(10)}';`);
  const initial5=await concurrentSql(cancel(4,id4,5,"native_document_cancel_before_replay"));
  if(initial5.status!==0||!receipt(initial5))throw new Error(`Replay race setup cancellation failed: ${initial5.stderr}`);
  const hold5=await holdAdvisoryLock(`hashtextextended('transport-cancel-operation:${sid(10)}:${sid(99,5)}',47)`);
  const work5=concurrentSql(cancel(4,id4,5,"native_document_replay_revoked_passenger"));
  try {
    await waitForAdvisoryWaiters(hold5.pid,["native_document_replay_revoked_passenger"]);
    sql(`update public.client_assignments set ends_at=clock_timestamp()
      where client_id='${sid(60)}' and assignee_user_id='${sid(10)}' and ends_at is null;`);
  } finally { await hold5.release(); }
  const replay5=await work5;
  if(replay5.status===0||!replay5.stderr.includes("42501")||!replay5.stderr.includes("passenger scope denied"))
    throw new Error(`Passenger revoke-while-waiting must deny replay: ${replay5.stderr} ${replay5.stdout}`);
  const replayCancellationCount=Number(sql(`select count(*) from private.transport_trip_cancellations where trip_key='${sid(90,4)}';`).trim());
  if(replayCancellationCount!==1)throw new Error("Denied replay changed the original cancellation history.");
  console.log("Native observed receipt revocation race passed: assignment revoked during operation lock wait -> 42501 and original cancellation preserved.");
  // Hold only the cancellation's audit write. A full audit-table lock would
  // prevent the revocation connection from committing its own audited update.
  sql("create function private.cancel_native_audit_wait() returns trigger language plpgsql set search_path='' as $$begin "+
    "if new.table_name='private.transport_trip_cancellations' and current_setting('application_name') like 'native_document_cancel_audit_%' then "+
    "perform pg_advisory_xact_lock(hashtextextended('synthetic-cancellation-audit-boundary',47)); end if;return new;end;$$;"+
    "create trigger cancel_native_audit_wait before insert on public.audit_events for each row execute function private.cancel_native_audit_wait();");
  const auditLock="hashtextextended('synthetic-cancellation-audit-boundary',47)";
  const auditCount=()=>Number(sql("select count(*) from public.audit_events where table_name='private.transport_trip_cancellations'").trim());
  const restoreAssignment=()=>sql(`update public.client_assignments set ends_at=null where client_id='${sid(60)}' and assignee_user_id='${sid(10)}';`);
  restoreAssignment();
  const id6=sql("select private.cancel_native_trip(5,1,array[1]);").trim();
  const beforeAudit6=auditCount();
  const hold6=await holdAdvisoryLock(auditLock);
  const work6=concurrentSql(cancel(5,id6,6,"native_document_cancel_audit_revoke"));
  let probe6;
  try {
    await waitForAdvisoryWaiters(hold6.pid,["native_document_cancel_audit_revoke"]);
    sql(`update public.client_assignments set ends_at=clock_timestamp() where client_id='${sid(60)}' and assignee_user_id='${sid(10)}' and ends_at is null;`);
  } catch(error) { probe6=error; } finally { await hold6.release(); }
  const result6=await work6;
  if(probe6)throw probe6;
  if(result6.status===0||!result6.stderr.includes("42501")||/^RESULT=/m.test(result6.stdout)||
    Number(sql(`select count(*) from private.transport_trip_cancellations where trip_key='${sid(90,5)}';`).trim())!==0||auditCount()!==beforeAudit6)
    throw new Error(`Post-audit revoked assignment must roll back cancellation and audit: ${result6.stderr}`);
  restoreAssignment();
  const id7=sql("select private.cancel_native_trip(6,1,array[1]);").trim();
  const challenge7=sid(70,7);
  sql(`insert into private.reauth_challenges(id,user_id,session_id,nonce_sha256,idempotency_key,issued_jwt_iat,created_at,expires_at,consumed_at,consumed_jwt_iat,factor_method,factor_verified_at)
    values('${challenge7}','${sid(10)}','${sid(20)}',repeat('7',64),'${challenge7}',now()-interval '17 minutes',now()-interval '16 minutes',now()-interval '11 minutes',
    now()-interval '15 minutes'+interval '2 seconds',now()-interval '15 minutes'+interval '2 seconds','totp',now()-interval '15 minutes'+interval '2 seconds');
    update private.reauth_events set challenge_id='${challenge7}',verified_at=(select factor_verified_at from private.reauth_challenges where id='${challenge7}') where user_id='${sid(10)}';`);
  const expiry7=Number(sql(`select extract(epoch from factor_verified_at+interval '15 minutes')*1000 from private.reauth_challenges where id='${challenge7}';`).trim());
  const beforeAudit7=auditCount();
  const hold7=await holdAdvisoryLock(auditLock);
  const work7=concurrentSql(cancel(6,id7,7,"native_document_cancel_audit_expiry"));
  let probe7;
  try {
    await waitForAdvisoryWaiters(hold7.pid,["native_document_cancel_audit_expiry"]);
    const deadline=Date.now()+5000;
    while(Number(sql("select extract(epoch from clock_timestamp())*1000").trim())<=expiry7) {
      if(Date.now()>deadline)throw new Error("Synthetic cancellation reauth boundary did not arrive.");
      await new Promise(resolveWait=>setTimeout(resolveWait,25));
    }
  } catch(error) { probe7=error; } finally { await hold7.release(); }
  const result7=await work7;
  if(probe7)throw probe7;
  if(result7.status===0||!result7.stderr.includes("42501")||/^RESULT=/m.test(result7.stdout)||
    Number(sql(`select count(*) from private.transport_trip_cancellations where trip_key='${sid(90,6)}';`).trim())!==0||auditCount()!==beforeAudit7)
    throw new Error(`Post-audit reauth expiry must roll back cancellation and audit: ${result7.stderr}`);
  console.log("Native observed post-audit revocation and real 15-minute reauth expiry both denied with zero cancellation/audit writes. Total observed races: 7.");
} finally {
  if(started)run(join(binaries,"pg_ctl"),["-D",data,"-m","fast","-w","stop"]);
}
