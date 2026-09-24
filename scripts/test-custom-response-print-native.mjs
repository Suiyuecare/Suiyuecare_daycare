// Native PostgreSQL validation in a disposable local cluster. Never accepts a URL
// or connects to a hosted database. Auth and Storage schemas are synthetic fixtures.
// Run: CUSTOM_PRINT_NATIVE_PG_BIN=/absolute/postgres/bin node scripts/test-custom-response-print-native.mjs
// Scope: immutable print snapshots, exact replay, live permission/Google/session
// revocation while waiting, and assignment expiry during an audited download.
import { spawn, spawnSync } from "node:child_process";
import { mkdtemp, readFile, readdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { bootstrapSql } from "./lib/pglite-bootstrap.mjs";

const root = resolve(import.meta.dirname, "..");
const binaries = process.env.CUSTOM_PRINT_NATIVE_PG_BIN ?? process.env.INTAKE_NATIVE_PG_BIN;
if (!binaries || !binaries.startsWith("/")) {
  throw new Error("Set CUSTOM_PRINT_NATIVE_PG_BIN (or INTAKE_NATIVE_PG_BIN) to an existing absolute native PostgreSQL bin directory.");
}
const runtime = await mkdtemp("/tmp/daycare-form-print-native.");
const data = join(runtime, "data");
const port = "55446";
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
const holdLock = async (lockSql) => {
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
    ${lockSql};select 'NATIVE_LOCK_READY='||pg_backend_pid();\n`);
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
const waitForWaiters = async (holderPid, applicationNames) => {
  if (!Number.isInteger(holderPid) || applicationNames.some((name) => !/^native_document_[a-z0-9_]+$/.test(name))) throw new Error("Invalid synthetic advisory wait probe.");
  const deadline = Date.now() + 10_000;
  const names = applicationNames.map((name) => `'${name}'`).join(",");
  while (Date.now() < deadline) {
    const waiting = Number(sql(`select count(*) from pg_stat_activity where application_name in (${names})
      and wait_event_type='Lock' and cardinality(pg_blocking_pids(pid))>0
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
  run(join(binaries, "pg_ctl"), ["-D", data, "-l", join(runtime, "server.log"), "-o", `-k ${runtime} -p ${port} -c listen_addresses='' -c statement_timeout=60000`, "-w", "start"]);
  started = true;
  sql(bootstrapSql);
  sql("create schema storage;create table storage.buckets(id text primary key,name text not null,public boolean not null default false,file_size_limit bigint,allowed_mime_types text[]);create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text not null references storage.buckets(id),name text not null);alter table storage.objects enable row level security;");
  const migrations=(await readdir(join(root,"supabase/migrations"))).filter(name=>name.endsWith(".sql")).sort();
  for (const name of migrations) sql(await readFile(join(root,"supabase/migrations",name),"utf8"));
  sql(await readFile(join(root,"supabase/seed.sql"),"utf8"));
  console.log(`Native migration compilation: ${migrations.length}/${migrations.length}.`);
  sql(run("/usr/bin/tar",["-xOf",join(root,"node_modules/@electric-sql/pglite/dist/pgtap.tar.gz"),"share/postgresql/extension/pgtap--1.3.5.sql"]));
  const suite=await readFile(join(root,"supabase/tests/custom_response_print_snapshots.test.sql"),"utf8");
  const suiteOutput=sql(suite);
  const expected=Number(suite.match(/select plan\((\d+)\)/)?.[1]);
  const passed=suiteOutput.split("\n").filter(line=>/^ok \d+\b/.test(line)).length;
  if(passed!==expected||/^not ok |^# Looks like/m.test(suiteOutput))throw new Error("Native suite failed: "+suiteOutput);
  console.log("Native print snapshot assertions: "+passed+"/"+expected+".");
  const fixture=suite.slice(0,suite.indexOf("select ok((select relrowsecurity")).replaceAll("pg_temp.","private.print_native_");
  const setup=sql(fixture+"select private.print_native_custom_login();select 'JWT='||current_setting('request.jwt.claims');select 'INPUT='||current_setting('test.response_input');commit;");
  const jwt=setup.split("\n").find(line=>line.startsWith("JWT="))?.slice(4);
  const input=JSON.parse(setup.split("\n").find(line=>line.startsWith("INPUT="))?.slice(6)??"null");
  if(!jwt||!input)throw new Error("Missing synthetic authentication fixture");
  const quote=value=>"'"+String(value).replaceAll("'","''")+"'";
  const org="d8500000-0000-4000-8000-000000000001";
  const branch="d8600000-0000-4000-8000-000000000001";
  const client="d9500000-0000-4000-8000-000000000001";
  const actor="d8100000-0000-4000-8000-000000000001";
  const key=n=>"da100000-0000-4000-8000-"+String(n).padStart(12,"0");
  const claims="select set_config('request.jwt.claims',"+quote(jwt)+",true);set local role authenticated;";
  const receipt=output=>JSON.parse(output.split("\n").find(line=>line.startsWith("RESULT="))?.slice(7)??"null");
  const response=receipt(sql("begin;"+claims+"select 'RESULT='||public.write_custom_form_response("+[org,branch,client,key(99),JSON.stringify(input)].map(quote).join(",")+")::text;commit;"))?.record;
  if(!response)throw new Error("Response fixture not saved");
  const prepare=(n,name)=>"begin;set local application_name="+quote(name)+";"+claims+
    "select 'RESULT='||public.prepare_custom_response_print("+[org,branch,client,response.id,key(n)].map(quote).join(",")+")::text;commit;";
  const lockFor=n=>"select pg_advisory_xact_lock(hashtextextended("+quote("custom-response-print:"+org+":"+actor+":"+key(n))+",0))";
  const duplicates=["native_document_print_duplicate_a","native_document_print_duplicate_b"];
  const duplicateHolder=await holdLock(lockFor(1));
  const duplicatePending=duplicates.map(name=>concurrentSql(prepare(1,name)));
  try { await waitForWaiters(0,duplicates); } finally { await duplicateHolder.release(); }
  const duplicateResults=await Promise.all(duplicatePending);
  if(duplicateResults.some(r=>r.status!==0))throw new Error("Duplicate race failed "+JSON.stringify(duplicateResults));
  const receipts=duplicateResults.map(r=>receipt(r.stdout));
  if(receipts[0]?.jobId!==receipts[1]?.jobId||receipts.filter(r=>r.replayed).length!==1||
    JSON.stringify({...receipts[0],replayed:false})!==JSON.stringify({...receipts[1],replayed:false}))
    throw new Error("Duplicate print snapshot invariant failed");
  if(Number(sql("select count(*) from private.custom_response_print_jobs").trim())!==1)throw new Error("Duplicate print jobs persisted");
  console.log("Native observed duplicate export: one immutable job, exact snapshot/hash/expiry, one replay.");

  sql("delete from public.role_permissions where role_id='10000000-0000-4000-8000-000000000002' and permission_id=(select id from public.permissions where permission_key='clients.view_all');"+
    "insert into public.client_assignments(organization_id,branch_id,client_id,assignee_user_id,assignment_kind,starts_at) values("+
    [org,branch,client,actor,"synthetic-print-native"].map(quote).join(",")+",clock_timestamp()-interval '1 day');");
  const assignmentWhere=" where client_id="+quote(client)+" and assignee_user_id="+quote(actor);
  const scenarios=[
    {name:"assignment",revoke:"update public.client_assignments set ends_at=clock_timestamp()"+assignmentWhere,restore:"update public.client_assignments set ends_at=null"+assignmentWhere},
    {name:"google",revoke:"update private.executive_access_policy set enabled=false",restore:"update private.executive_access_policy set enabled=true"},
    {name:"session",revoke:"update auth.sessions set not_after=clock_timestamp() where id='d8300000-0000-4000-8000-000000000001'",restore:"update auth.sessions set not_after=null where id='d8300000-0000-4000-8000-000000000001'"},
    {name:"permission",revoke:"update public.role_permissions set granted_at=clock_timestamp()+interval '1 minute' where role_id='10000000-0000-4000-8000-000000000002' and permission_id=(select id from public.permissions where permission_key='document_printing.manage')",restore:"update public.role_permissions set granted_at=clock_timestamp()-interval '1 minute' where role_id='10000000-0000-4000-8000-000000000002' and permission_id=(select id from public.permissions where permission_key='document_printing.manage')"},
  ];
  let n=2;
  for(const scenario of scenarios){
    for(const replay of [false,true]){
      const currentKey=replay?1:n++;
      const name="native_document_print_"+scenario.name+"_"+(replay?"replay":"new");
      const beforeAudit=Number(sql("select count(*) from public.audit_events where table_name='custom_response_print_jobs'").trim());
      const holder=await holdLock(lockFor(currentKey));
      const pending=concurrentSql(prepare(currentKey,name));
      let probeError;
      try {
        await waitForWaiters(holder.pid,[name]);
        sql(scenario.revoke+";");
      } catch(error){probeError=error;} finally { await holder.release(); }
      const result=await pending;
      sql(scenario.restore+";");
      if(probeError)throw probeError;
      if(result.status===0||!result.stderr.includes("42501")||/^RESULT=/m.test(result.stdout))throw new Error("Revoked print returned a receipt: "+name+" "+result.stderr);
      if(Number(sql("select count(*) from private.custom_response_print_jobs").trim())!==1||
        Number(sql("select count(*) from public.audit_events where table_name='custom_response_print_jobs'").trim())!==beforeAudit)
        throw new Error("Revoked print persisted snapshot or audit: "+name);
    }
  }
  console.log("Native observed authorization revocation: assignment, Google grant, session and print permission; new jobs and exact replays all denied after lock waits (8 races).");

  for(const replay of [false,true]){
    const challengeId="da300000-0000-4000-8000-"+(replay?"000000000002":"000000000001");
    const currentKey=replay?1:n++;
    // A consumed synthetic challenge close to the 15-minute boundary. Its
    // timestamps are inserted once, never rewritten through an immutability
    // bypass. The existing helper checks the real same-session evidence.
    sql("insert into private.reauth_challenges(id,user_id,session_id,nonce_sha256,idempotency_key,issued_jwt_iat,issued_jwt_jti,created_at,expires_at,consumed_at,consumed_jwt_iat,consumed_jwt_jti,factor_method,factor_verified_at) values("+
      [challengeId,actor,"d8300000-0000-4000-8000-000000000001"].map(quote).join(",")+",repeat("+quote(replay?"d":"c")+",64),"+quote(challengeId)+
      ",now()-interval '17 minutes','near-before',now()-interval '16 minutes',now()-interval '11 minutes',now()-interval '15 minutes'+interval '1 second',now()-interval '15 minutes'+interval '1 second','near-after','totp',now()-interval '15 minutes'+interval '1 second');"+
      "update private.reauth_events set challenge_id="+quote(challengeId)+",verified_at=(select factor_verified_at from private.reauth_challenges where id="+quote(challengeId)+") where user_id="+quote(actor)+";");
    const expires=Number(sql("select extract(epoch from factor_verified_at+interval '15 minutes')*1000 from private.reauth_challenges where id="+quote(challengeId)).trim());
    const holder=await holdLock(lockFor(currentKey));
    const name="native_document_print_reauth_"+(replay?"replay":"new");
    const pending=concurrentSql(prepare(currentKey,name));
    let expiryProbeError;
    try{
      await waitForWaiters(holder.pid,[name]);
      while(Number(sql("select extract(epoch from clock_timestamp())*1000").trim())<=expires)
        await new Promise(resolveWait=>setTimeout(resolveWait,25));
    }catch(error){expiryProbeError=error;}finally{await holder.release();}
    const result=await pending;
    sql("update private.reauth_events set challenge_id='d8800000-0000-4000-8000-000000000001',verified_at=(select factor_verified_at from private.reauth_challenges where id='d8800000-0000-4000-8000-000000000001') where user_id="+quote(actor)+";");
    if(expiryProbeError)throw expiryProbeError;
    if(result.status===0||!result.stderr.includes("42501")||/^RESULT=/m.test(result.stdout))throw new Error("Expired second factor exposed a snapshot: "+result.stderr);
    if(Number(sql("select count(*) from private.custom_response_print_jobs").trim())!==1)throw new Error("Expired second factor stored a job");
  }
  console.log("Native observed 15-minute reauthentication expiry during lock waits: new export and replay denied (2 races).");

  // Block the audit INSERT, let the actual assignment time window expire, then
  // ensure the final scope check rolls back that audit and returns no PDF model.
  sql("update public.client_assignments set ends_at=clock_timestamp()+interval '1 second'"+assignmentWhere);
  const expiry=sql("select extract(epoch from ends_at)*1000 from public.client_assignments"+assignmentWhere).trim();
  const auditBefore=Number(sql("select count(*) from public.audit_events where table_name='custom_response_print_jobs' and action='export'").trim());
  const auditHolder=await holdLock("lock table public.audit_events in share mode");
  const job=receipts[0];
  const readName="native_document_print_read_expiry";
  const readPending=concurrentSql("begin;set local application_name="+quote(readName)+";"+claims+
    "select 'RESULT='||public.read_custom_response_print("+[org,branch,job.jobId,job.snapshotHash].map(quote).join(",")+")::text;commit;");
  let probeError;
  try {
    await waitForWaiters(auditHolder.pid,[readName]);
    const deadline=Date.now()+5000;
    while(Number(sql("select extract(epoch from clock_timestamp())*1000").trim())<=Number(expiry)){
      if(Date.now()>deadline)throw new Error("Assignment wall clock expiry did not arrive");
      await new Promise(resolveWait=>setTimeout(resolveWait,25));
    }
  }catch(error){probeError=error;}finally{await auditHolder.release();}
  const readResult=await readPending;
  if(probeError)throw probeError;
  if(readResult.status===0||!readResult.stderr.includes("42501")||/^RESULT=/m.test(readResult.stdout))throw new Error("Read after audit wait exposed revoked snapshot: "+readResult.stderr);
  if(Number(sql("select count(*) from public.audit_events where table_name='custom_response_print_jobs' and action='export'").trim())!==auditBefore)
    throw new Error("Rejected download audit was not rolled back");
  console.log("Native observed download expiry after audit lock wait: denied, no snapshot returned and audit rolled back.");
  console.log("Native custom response print acceptance: "+expected+" SQL assertions and 12 observed two-session races.");
} finally {
  if(started)run(join(binaries,"pg_ctl"),["-D",data,"-m","fast","-w","stop"]);
}
