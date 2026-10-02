// Native, Unix-socket-only synthetic repository gate. The shared bootstrap
// models local Auth metadata; genuine authorization predicates remain intact.
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile, readdir, writeFile } from "node:fs/promises";
import { writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { bootstrapSql } from "./lib/pglite-bootstrap.mjs";
import { createNativeTestRuntime } from "./lib/native-test-cleanup.mjs";

const root = resolve(import.meta.dirname, "..");
const binaries = process.env.INTAKE_NATIVE_PG_BIN;
if (!binaries?.startsWith("/")) throw new Error("Set INTAKE_NATIVE_PG_BIN to an absolute PostgreSQL 17.11+ bin directory; no hosted URL is accepted.");
const { runtime, data, cleanupNativeData } = await createNativeTestRuntime("/tmp/daycare-import-recovery-native.");
const env = { PATH: process.env.PATH, LANG: "en_US.UTF-8", LC_ALL: "en_US.UTF-8", PGHOST: runtime,
  PGPORT: "55471", PGUSER: "postgres", PGDATABASE: "postgres", PGCONNECT_TIMEOUT: "5" };
const args = ["-X", "-q", "-A", "-t", "-v", "ON_ERROR_STOP=1", "-v", "VERBOSITY=verbose"];
const run = (file, argv, input) => {
  const result = spawnSync(file, argv, { cwd: root, env, input, encoding: "utf8", maxBuffer: 32 * 1024 * 1024, timeout: 30000 });
  if (result.error || result.status !== 0) {
    if (file.endsWith('/psql')) writeFileSync(join(runtime,'failed-synthetic-sql-output.txt'),result.stdout??'');
    throw new Error(`${file.split("/").at(-1)} failed: ${result.error?.message ?? result.stderr}`);
  }
  return result.stdout;
};
const sql = input => run(join(binaries, "psql"), args, input);
const quote = value => `'${String(value).replaceAll("'", "''")}'`;
const marker = (output, key) => {
  const line = output.split("\n").find(value => value.startsWith(`${key}=`));
  assert.ok(line, `Missing synthetic ${key} marker`); return line.slice(key.length + 1);
};
const children = new Set(), holders = new Set(), childCompletions = new WeakMap();
function connection() {
  const child = spawn(join(binaries, "psql"), args, { cwd: root, env }); children.add(child);
  let stdout = "", stderr = "";
  const completed = new Promise(done => {
    child.stdout.on("data", value => { stdout += value; }); child.stderr.on("data", value => { stderr += value; });
    child.on("error", error => done({ status: -1, stdout, stderr: error.message }));
    child.on("close", status => { children.delete(child); done({ status, stdout, stderr }); });
  });
  childCompletions.set(child,completed);
  return { child, completed, output: () => stdout };
}
const concurrent = input => { const current = connection(); current.child.stdin.end(input); return current.completed; };
async function hold(statement) {
  const current = connection(); let released = false;
  const holder = { release: async () => {
    if (released) return; released = true; current.child.stdin.end("commit;\n");
    const result = await current.completed; holders.delete(holder); assert.equal(result.status, 0, result.stderr);
  } };
  holders.add(holder);
  current.child.stdin.write(`begin;set local application_name='native_recovery_holder';${statement};select 'READY='||pg_backend_pid();\n`);
  const deadline = Date.now() + 10000;
  while (!/^READY=\d+$/m.test(current.output())) {
    if (current.child.exitCode !== null || Date.now() > deadline) throw new Error("Owned native holder did not become ready.");
    await new Promise(done => setTimeout(done, 25));
  }
  holder.pid = Number(marker(current.output(), "READY")); return holder;
}
async function blocked(names, holderPid) {
  assert.ok(names.length > 0 && names.every(name => /^native_recovery_[a-z_]+$/u.test(name)));
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    const waiting = JSON.parse(sql(`select coalesce(jsonb_agg(jsonb_build_object('pid',pid,'name',application_name,'waitEvent',wait_event,
      'blockers',pg_blocking_pids(pid))),'[]'::jsonb) from pg_stat_activity where application_name in (${names.map(quote).join(",")})
      and wait_event_type='Lock' and ${holderPid}=any(pg_blocking_pids(pid));`).trim());
    if (waiting.length === names.length && names.every(name => waiting.some(row => row.name === name))) return waiting;
    await new Promise(done => setTimeout(done, 25));
  }
  throw new Error("Actual independent backend blocking was not observed.");
}
const result = output => { assert.equal(output.status, 0, output.stderr); return JSON.parse(marker(output.stdout, "RESULT")); };
const denied = (output, code) => { assert.notEqual(output.status, 0); assert.match(output.stderr, new RegExp(`\\b${code}\\b`)); assert.doesNotMatch(output.stdout, /^RESULT=/m); };
const evidence = { syntheticOnly: true, hostedConnections: 0, externalNetworkRequests: 0, authorizationReplacements: 0,
  migrations: [], probes: [], assertions: [], runnerSha256: createHash("sha256").update(await readFile(import.meta.filename)).digest("hex") };
let started = false, testFailure;
try {
  const engine = run(join(binaries, "postgres"), ["--version"]).trim();
  const version = engine.match(/^postgres \(PostgreSQL\) 17\.(\d+)(?:\s|$)/u);
  assert.ok(version && Number(version[1]) >= 11, "PostgreSQL 17.11+ security minor required"); evidence.engine = engine;
  run(join(binaries, "initdb"), ["-D", data, "-U", "postgres", "--auth-local=trust", "--auth-host=reject", "--no-locale", "--encoding=UTF8"]);
  run(join(binaries, "pg_ctl"), ["-D", data, "-l", join(runtime, "server.log"), "-o",
    `-k ${runtime} -p ${env.PGPORT} -c listen_addresses='' -c timezone=UTC -c statement_timeout=15000 -c idle_in_transaction_session_timeout=30000 -c max_wal_size=128MB -c min_wal_size=32MB`, "-w", "start"]); started = true;
  sql(bootstrapSql);
  sql(`create schema storage;
    create table storage.buckets(id text primary key,name text not null,public boolean not null default false,file_size_limit bigint,allowed_mime_types text[]);
    create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text not null references storage.buckets(id),name text not null,
      metadata jsonb,created_at timestamptz not null default clock_timestamp(),updated_at timestamptz not null default clock_timestamp(),unique(bucket_id,name));
    alter table storage.objects enable row level security;grant usage on schema storage to anon,authenticated,service_role;
    grant all on storage.objects to anon,authenticated,service_role;`);
  const allMigrations = (await readdir(join(root, "supabase/migrations"))).filter(name => name.endsWith(".sql")).sort();
  assert.equal(allMigrations.length, 160, "Current repository must contain the complete 160-migration chain");
  assert.deepEqual(allMigrations.slice(153), [
    "20260928033352_abcd_selected_client_option.sql", "20260928044255_abcd_operation_recovery.sql",
    "20260928045335_abcd_routine_draft_aal1.sql", "20260928050459_abcd_assessment_client_search.sql",
    "20261001173654_care_diary_shift_time_guard.sql",
    "20261002052536_questionnaire_resume_summary.sql",
    "20261002074215_questionnaire_assessment_date_lookup.sql",
  ]);
  const migrations = allMigrations.slice(0, 153);
  assert.equal(migrations.length, 153); assert.equal(migrations.at(-1), "20260927171515_import_upload_operation_locator.sql");
  const fingerprint = () => sql(`select md5(jsonb_build_object('clients',(select jsonb_agg(to_jsonb(x)order by x.id)from public.clients x),
    'measurements',(select jsonb_agg(to_jsonb(x)order by x.id)from public.measurements x),
    'forms',(select jsonb_agg(to_jsonb(x)order by x.id)from public.form_versions x),
    'roles',(select jsonb_agg(to_jsonb(x)order by x.id)from public.roles x))::text)`).trim();
  let previous;
  for (const [index, name] of migrations.entries()) {
    const source = await readFile(join(root, "supabase/migrations", name), "utf8"); assert.ok(source.trim(), `Migration ${name} is not frozen`);
    if (index === 150) { sql(await readFile(join(root, "supabase/seed.sql"), "utf8")); previous = fingerprint(); }
    sql(source); evidence.migrations.push({ name, sha256: createHash("sha256").update(source).digest("hex") });
  }
  assert.ok(previous); assert.equal(fingerprint(), previous, "150-to-153 cannot alter existing seeded business data");
  evidence.upgrade = { from: 150, to: 153, businessFingerprint: previous, unchanged: true };
  sql(run("/usr/bin/tar", ["-xOf", join(root, "node_modules/@electric-sql/pglite/dist/pgtap.tar.gz"), "share/postgresql/extension/pgtap--1.3.5.sql"]));
  const testPath = join(root, "supabase/tests/import_upload_recovery.test.sql"); const testSource = await readFile(testPath, "utf8");
  evidence.testSha256 = createHash("sha256").update(testSource).digest("hex");
  const tap = sql(testSource); const expected = Number(testSource.match(/select\s+plan\((\d+)\)/iu)?.[1] ?? tap.match(/^1\.\.(\d+)$/mu)?.[1]);
  const passed = tap.split("\n").filter(line => /^ok \d+\b/u.test(line)).length;
  assert.ok(expected > 1); assert.equal(passed, expected, tap); assert.doesNotMatch(tap, /^not ok \d+\b|^# Looks like/mu);
  evidence.pgTapAssertions = passed;
  const sentinel = "-- NATIVE_FIXTURE_END"; assert.ok(testSource.includes(sentinel));
  const prefix = testSource.slice(0, testSource.indexOf(sentinel)).replace(/select\s+(?:plan\(\d+\)|no_plan\(\));/iu, "");
  const setup = sql(`${prefix}\nselect pg_temp.ur_login(1,'aal2',3);select 'JWT='||current_setting('request.jwt.claims');select 'PARSED='||pg_temp.ur_parsed()::text;commit;`);
  const jwt = marker(setup, "JWT"), parsed = JSON.parse(marker(setup, "PARSED"));

  const org="f2200000-0000-4000-8000-000000000001",branch="f2300000-0000-4000-8000-000000000001",actor="f2100000-0000-4000-8000-000000000001";
  const oldClaims=JSON.stringify({...JSON.parse(jwt),session_id:"f2120000-0000-4000-8000-000000000001",aal:"aal1"});
  const newClaims=JSON.stringify({...JSON.parse(jwt),aal:"aal1"});
  const transaction=(call,name,claims=newClaims,role="authenticated")=>{
    assert.match(name,/^native_recovery_[a-z_]+$/u);assert.ok(["authenticated","service_role"].includes(role));
    return `begin;set local application_name=${quote(name)};select set_config('request.jwt.claims',${quote(claims)},true);set local role ${role};${call};commit;`;
  };
  const uuid=label=>{const b=createHash("sha256").update(label).digest().subarray(0,16);b[6]=(b[6]&15)|80;b[8]=(b[8]&63)|128;const h=b.toString("hex");return `${h.slice(0,8)}-${h.slice(8,12)}-${h.slice(12,16)}-${h.slice(16,20)}-${h.slice(20)}`;};
  const counts=()=>JSON.parse(sql(`select jsonb_build_object('recoveries',(select count(*)from private.import_upload_recoveries),'terminal',(select count(*)from private.import_upload_recovery_completions),'completions',(select count(*)from private.import_upload_completions),'clients',(select count(*)from public.clients),'plans',(select count(*)from public.authorized_care_plans),'careRecords',(select count(*)from public.care_records),'medications',(select count(*)from public.medication_administrations),'audit',(select count(*)from public.audit_events where table_name in('private.import_upload_recoveries','private.import_upload_recovery_completions','private.import_upload_completions')))`).trim());
  const recoveryLock=key=>`select pg_advisory_xact_lock(hashtextextended(${quote("import-recovery-key:"+actor+":"+key)},0))`;
  const originalLock=key=>`select pg_advisory_xact_lock(hashtextextended(${quote("import-upload-key:"+actor+":"+key)},0))`;
  const stage=async(label,expireOriginal=true)=>{
    const key=uuid("original:"+label),sha=createHash("sha256").update("bytes:"+label).digest("hex");
    sql("update auth.sessions set not_after=null where id='f2120000-0000-4000-8000-000000000001'");
    const r=result(await concurrent(transaction(`select 'RESULT='||public.reserve_intake_import_upload('${org}','${branch}','${key}','${sha}','synthetic.html','text/html',128,'central-care-plan-html@1')::text`,"native_recovery_original",oldClaims)));
    if(expireOriginal)sql("update auth.sessions set not_after=clock_timestamp()-interval '1 second' where id='f2120000-0000-4000-8000-000000000001'");
    const archive={key:`organizations/${org}/branches/${branch}/central-html/${sha}/${r.reservation_id}.html`,sha256:sha,versionId:"synthetic-recovery-worm-v1",byteLength:128,createdAt:r.created_at,retainUntil:JSON.parse(sql(`select to_jsonb(${quote(r.created_at)}::timestamptz+interval '7 years')::text`).trim())};
    return {key,reservation:r,archive};
  };
  const authorizeCall=(s,key)=>`select 'RESULT='||public.reserve_import_upload_recovery('${org}','${branch}','${s.reservation.reservation_id}','${s.key}','${key}','${s.reservation.file_sha256}','synthetic.html','text/html',128,'central-care-plan-html@1','routine-intake')::text`;
  const completeCall=(r,s)=>`select 'RESULT='||public.complete_recovered_import_upload('${r.recovery_id}',${quote(JSON.stringify(parsed))},${quote(JSON.stringify(s.archive))}::jsonb)::text`;
  const worker=(call,name)=>concurrent(transaction(call,name,'{"role":"service_role"}',"service_role"));
  const readCall=key=>`select 'RESULT='||coalesce(public.import_upload_recovery_receipt('${org}','${branch}','${key}','routine-intake'),'null'::jsonb)::text`;
  const original=await stage("same-key");
  const key=uuid("recovery:same-key"),before=counts(),holder=await hold(recoveryLock(key));
  const a=concurrent(transaction(authorizeCall(original,key),"native_recovery_authorize_a")),b=concurrent(transaction(authorizeCall(original,key),"native_recovery_authorize_b"));
  const waits=await blocked(["native_recovery_authorize_a","native_recovery_authorize_b"],holder.pid);await holder.release();
  const authorized=(await Promise.all([a,b])).map(result);
  assert.equal(authorized.filter(r=>r.replayed).length,1);assert.equal(authorized[0].recovery_id,authorized[1].recovery_id);
  assert.deepEqual({...authorized[0],replayed:false},{...authorized[1],replayed:false});assert.equal(counts().recoveries,before.recoveries+1);
  evidence.probes.push({name:"same_actor_recovery_key",waiters:waits,oneImmutableAttempt:true});
  const workerHolder=await hold(recoveryLock(key)),workerBefore=counts();
  const wa=worker(completeCall(authorized[0],original),"native_recovery_worker_a"),wb=worker(completeCall(authorized[0],original),"native_recovery_worker_b");
  const workerWait=await blocked(["native_recovery_worker_a","native_recovery_worker_b"],workerHolder.pid);await workerHolder.release();
  const receipts=(await Promise.all([wa,wb])).map(result);assert.equal(receipts.filter(r=>r.replayed).length,1);
  assert.deepEqual({...receipts[0],replayed:false},{...receipts[1],replayed:false});
  assert.equal(counts().terminal,workerBefore.terminal+1);assert.equal(counts().completions,workerBefore.completions+1);
  const proven=result(await concurrent(transaction(readCall(key),"native_recovery_exact_read")));
  assert.equal(proven.status,"completed");assert.deepEqual(proven.receipt,{...receipts[0],replayed:false});assert.equal(proven.created_at,original.reservation.created_at);
  evidence.probes.push({name:"two_workers_one_original_completion",waiters:workerWait,completionCount:1,originalTimestampRetained:true});

  const rev=await stage("revoke-key"),revKey=uuid("recovery:revoke-key"),revHolder=await hold(recoveryLock(revKey)),revBefore=counts();
  const revPending=concurrent(transaction(authorizeCall(rev,revKey),"native_recovery_revoke_wait")),revWait=await blocked(["native_recovery_revoke_wait"],revHolder.pid);
  sql("update public.memberships set status='suspended' where id='f2400000-0000-4000-8000-000000000001'");
  await revHolder.release();denied(await revPending,"42501");assert.deepEqual(counts(),revBefore);
  sql("update public.memberships set status='active' where id='f2400000-0000-4000-8000-000000000001'");
  evidence.probes.push({name:"revoke_during_recovery_key_wait",waiters:revWait,sqlstate:"42501",zeroTransactionChanges:true});
  sql(`create function public.native_recovery_audit_pause()returns trigger language plpgsql as $$begin
    if(current_setting('application_name')='native_recovery_audit_authorize' and new.table_name='private.import_upload_recoveries' and new.action='insert')
     or(current_setting('application_name')='native_recovery_audit_worker' and new.table_name='private.import_upload_completions' and new.action='insert')
     or(current_setting('application_name')='native_recovery_audit_read' and new.metadata->>'projection'='import_recovery_receipt_v1')
    then perform pg_advisory_xact_lock(811731511);end if;return new;end$$;
    create trigger native_recovery_audit_pause before insert on public.audit_events for each row execute function public.native_recovery_audit_pause();`);
  const post=await stage("revoke-postinsert"),postKey=uuid("recovery:postinsert"),postHolder=await hold("select pg_advisory_xact_lock(811731511)"),postBefore=counts();
  const postPending=concurrent(transaction(authorizeCall(post,postKey),"native_recovery_audit_authorize")),postWait=await blocked(["native_recovery_audit_authorize"],postHolder.pid);
  sql(`update private.executive_access_policy set enabled=false where allowed_user_id='${actor}'`);
  await postHolder.release();denied(await postPending,"42501");assert.deepEqual(counts(),postBefore);
  sql(`update private.executive_access_policy set enabled=true where allowed_user_id='${actor}'`);
  evidence.probes.push({name:"revoke_after_recovery_insert",waiters:postWait,sqlstate:"42501",allInsertAndAuditRolledBack:true});
  const postAuthorized=result(await concurrent(transaction(authorizeCall(post,postKey),"native_recovery_reauthorize")));
  const completionHolder=await hold("select pg_advisory_xact_lock(811731511)"),completionBefore=counts();
  const completionPending=worker(completeCall(postAuthorized,post),"native_recovery_audit_worker"),completionWait=await blocked(["native_recovery_audit_worker"],completionHolder.pid);
  sql("update auth.sessions set not_after=clock_timestamp()-interval '1 second' where id='f2120000-0000-4000-8000-000000000003'");
  await completionHolder.release();denied(await completionPending,"42501");assert.deepEqual(counts(),completionBefore);
  sql("update auth.sessions set not_after=null where id='f2120000-0000-4000-8000-000000000003'");
  evidence.probes.push({name:"session_expiry_after_completion_insert",waiters:completionWait,sqlstate:"42501",originalAndTerminalCompletionRolledBack:true});
  const readHolder=await hold("select pg_advisory_xact_lock(811731511)"),readBefore=counts();
  const readPending=concurrent(transaction(readCall(key),"native_recovery_audit_read")),readWait=await blocked(["native_recovery_audit_read"],readHolder.pid);
  sql(`update public.branches set is_active=false where id='${branch}'`);
  await readHolder.release();denied(await readPending,"42501");assert.deepEqual(counts(),readBefore);
  sql(`update public.branches set is_active=true where id='${branch}';drop trigger native_recovery_audit_pause on public.audit_events;drop function public.native_recovery_audit_pause()`);
  evidence.probes.push({name:"branch_revoke_before_receipt_output",waiters:readWait,sqlstate:"42501",noReceiptDisclosed:true});
  const short=await stage("jwt-expiry"),shortKey=uuid("recovery:jwt-expiry");
  const exp=Math.floor(Date.now()/1000)+3,shortClaims=JSON.stringify({...JSON.parse(newClaims),exp});
  const shortAuthorized=result(await concurrent(transaction(authorizeCall(short,shortKey),"native_recovery_short_authorize",shortClaims)));
  assert.ok(Date.parse(shortAuthorized.expires_at)<=exp*1000);
  const expiryHolder=await hold(originalLock(short.key)),expiryBefore=counts();
  const expiryPending=worker(completeCall(shortAuthorized,short),"native_recovery_expiry_wait"),expiryWait=await blocked(["native_recovery_expiry_wait"],expiryHolder.pid);
  const expiryDeadline=Date.now()+7000;
  while(sql(`select clock_timestamp()>${quote(shortAuthorized.expires_at)}::timestamptz`).trim()!=="t"){assert.ok(Date.now()<expiryDeadline);await new Promise(done=>setTimeout(done,25));}
  await expiryHolder.release();denied(await expiryPending,"42501");assert.deepEqual(counts(),expiryBefore);
  evidence.probes.push({name:"captured_jwt_expiry_during_original_lock_wait",waiters:expiryWait,sqlstate:"42501",immutableUnknownRetained:true});

  evidence.adapterSources=[];
  for(const name of ["trusted-recovery.ts","recovery-model.ts","production-repository.ts","production-model.ts","reauth.ts","trusted-staging.ts","validation.ts","parser.ts","service.ts","types.ts","errors.ts","worm-archive.ts"]){
    evidence.adapterSources.push({name:"src/lib/imports/"+name,sha256:createHash("sha256").update(await readFile(join(root,"src/lib/imports",name))).digest("hex")});
  }
  const adapterPath=join(runtime,"recovery-roundtrip.cjs");
  const adapterSource=String.raw`
const assert=require("node:assert/strict"),fs=require("node:fs"),path=require("node:path"),cp=require("node:child_process");
const cfg=${JSON.stringify({root,binaries,env,args,jwt,org,branch,actor})};
const Module=require("node:module"),req=Module.createRequire(path.join(cfg.root,"package.json")),ts=req("typescript"),crypto=require("node:crypto");
const oldResolve=Module._resolveFilename,oldLoad=Module._load;
Module._resolveFilename=function(name,parent,...rest){if(name.startsWith("@/"))name=path.join(cfg.root,"src",name.slice(2));return oldResolve.call(this,name,parent,...rest);};
Module._load=function(name,...rest){return name==="server-only"?{}:oldLoad.call(this,name,...rest);};
require.extensions[".ts"]=(module,name)=>module._compile(ts.transpileModule(fs.readFileSync(name,"utf8"),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText,name);
const {recoverTrustedHtmlImport,readTrustedUploadRecovery}=req(path.join(cfg.root,"src/lib/imports/trusted-recovery.ts"));
const {stageTrustedIntakeHtmlImport,stageTrustedHtmlImport,trustedUploadOperationId}=req(path.join(cfg.root,"src/lib/imports/trusted-staging.ts"));
const {revalidateGeneralImportActor}=req(path.join(cfg.root,"src/lib/imports/reauth.ts"));
const {GeneralProductionImportRepository}=req(path.join(cfg.root,"src/lib/imports/production-repository.ts"));
const {deterministicBatchId}=req(path.join(cfg.root,"src/lib/imports/service.ts"));
const q=v=>"'"+String(v).replaceAll("'","''")+"'";
const sql=statement=>{
 const r=cp.spawnSync(path.join(cfg.binaries,"psql"),cfg.args,{cwd:cfg.root,env:cfg.env,input:statement,encoding:"utf8",timeout:15000,maxBuffer:16*1024*1024});
 if(r.error)throw new Error("Local RPC transport failed");
 return r;
};
const checked=statement=>{const r=sql(statement);assert.equal(r.status,0,r.stderr);return r.stdout;};
const signatures={
 reserve_intake_import_upload:["p_expected_organization_id","p_expected_branch_id","p_idempotency_key","p_file_sha256","p_file_name","p_mime_type","p_file_size_bytes","p_mapping_version"],
 reserve_import_upload:["p_expected_organization_id","p_expected_branch_id","p_idempotency_key","p_file_sha256","p_file_name","p_mime_type","p_file_size_bytes","p_mapping_version"],
 complete_import_upload:["p_reservation_id","p_parsed_payload","p_archive_reference"],
 reserve_import_upload_recovery:["p_org","p_branch","p_reservation","p_original_operation","p_recovery_operation","p_file_sha256","p_file_name","p_mime_type","p_file_size_bytes","p_mapping_version","p_mode"],
 import_upload_recovery_receipt:["p_org","p_branch","p_recovery_operation","p_mode"],
 complete_recovered_import_upload:["p_recovery","p_parsed_payload","p_archive_reference"],
 has_routine_intake_access:["target_org_id","target_branch_id","target_action","target_client_id"],
 general_import_repository_authorize:["p_org","p_branch","p_action"],
 general_import_repository_attach:["p_org","p_branch","p_batch","p_reservation","p_key"],
 general_import_repository_read:["p_org","p_branch","p_batch"],
 general_import_repository_find_upload:["p_org","p_branch","p_key"]
};
const calls={},claimsNew=JSON.parse(cfg.jwt),claimsOld={...claimsNew,session_id:"f2120000-0000-4000-8000-000000000001"};
const client=(role,claims)=>({rpc:async(name,input)=>{
 assert.ok(Object.hasOwn(signatures,name));assert.deepEqual(Object.keys(input).sort(),[...signatures[name]].sort());
 calls[role+":"+name]=(calls[role+":"+name]||0)+1;
 const p=signatures[name].map(k=>input[k]===null?"null":typeof input[k]==="number"?String(input[k]):typeof input[k]==="object"?q(JSON.stringify(input[k]))+"::jsonb":q(input[k]));
 const r=sql("begin;set local application_name='native_recovery_adapter';select set_config('request.jwt.claims',"+q(JSON.stringify(role==="authenticated"?claims:{role:"service_role"}))+",true);set local role "+role+";select 'RESULT='||coalesce(to_jsonb(public."+name+"("+p.join(",")+")),'null'::jsonb)::text;commit;");
 if(r.status!==0)return {data:null,error:{code:r.stderr.match(/ERROR:\s+([A-Z0-9]{5}):/)?.[1]||"XX000"}};
 const line=r.stdout.split("\n").find(v=>v.startsWith("RESULT="));assert.ok(line);return {data:JSON.parse(line.slice(7)),error:null};
}});
const user=client("authenticated",{...claimsNew,aal:"aal1"}),oldUser=client("authenticated",{...claimsOld,aal:"aal1"}),generalUser=client("authenticated",claimsNew),oldGeneral=client("authenticated",claimsOld),worker=client("service_role",{role:"service_role"});
const stored=new Map();let archiveCalls=0,puts=0;
const archive={archive:async(scope,id,bytes,sha,created)=>{
 assert.equal(scope.organizationId,cfg.org);assert.equal(scope.branchId,cfg.branch);assert.equal(crypto.createHash("sha256").update(bytes).digest("hex"),sha);
 archiveCalls++;const retain=new Date(created);retain.setUTCFullYear(retain.getUTCFullYear()+7);
 const reference={key:"organizations/"+cfg.org+"/branches/"+cfg.branch+"/central-html/"+sha+"/"+id+".html",versionId:"synthetic-coordinator-worm-v1",sha256:sha,createdAt:created.toISOString(),retainUntil:retain.toISOString(),byteLength:bytes.byteLength};
 if(stored.has(id)){assert.deepEqual(stored.get(id).bytes,Uint8Array.from(bytes));assert.deepEqual(stored.get(id).reference,reference);}
 else{stored.set(id,{bytes:Uint8Array.from(bytes),reference});puts++;}
 return structuredClone(reference);
},read:async(_scope,id,reference)=>{assert.deepEqual(stored.get(id).reference,reference);return Uint8Array.from(stored.get(id).bytes);}};
const actor={organizationId:cfg.org,branchId:cfg.branch,userId:cfg.actor,assuranceLevel:"aal1",recentAal2At:null};
const routineAuth=async()=>{const r=await user.rpc("has_routine_intake_access",{target_org_id:cfg.org,target_branch_id:cfg.branch,target_action:"cms.stage",target_client_id:null});assert.equal(r.error,null);assert.equal(r.data,true);return {...actor};};
const metadata=key=>{const id=trustedUploadOperationId(actor,key);const s=checked("select row_to_json(r)::text from private.import_upload_reservations r where actor_user_id="+q(cfg.actor)+" and idempotency_key="+q(id));return JSON.parse(s.trim());};
const originalDigest=r=>crypto.createHash("sha256").update(JSON.stringify(r)).digest("hex");
const file=(label)=>({fileName:label+".html",mimeType:"text/html",bytes:Buffer.from("<!doctype html><html><head><meta charset=utf-8><script>globalThis.SYNTHETIC_RECOVERY_EXECUTED=true</script></head><body><h5>需要服務者基本資料</h5><table><tr><th>個案姓名</th><td>Synthetic "+label+"</td></tr></table><img src='https://external.example.invalid/no-request'><form action='https://external.example.invalid/no-submit'></form></body></html>")});
const prepareOld=()=>checked("update auth.sessions set not_after=null where id='f2120000-0000-4000-8000-000000000001'");
const expireOld=()=>checked("update auth.sessions set not_after=clock_timestamp()-interval '1 second' where id='f2120000-0000-4000-8000-000000000001'");
const failBeforeWorker={rpc:async(name)=>{assert.equal(name,"complete_import_upload");throw new Error("Synthetic lost transport before database completion");}};
(async()=>{
 prepareOld();
 const routineFile=file("routine"),rawKey="native-coordinator-routine-original";
 await assert.rejects(stageTrustedIntakeHtmlImport({userClient:oldUser,workerClient:failBeforeWorker,archive},actor,routineFile,rawKey));
 const original=metadata(rawKey),originalHash=originalDigest(original);assert.equal(puts,1);expireOld();
 const input={reservationId:original.id,originalOperationKey:rawKey,recoveryOperationKey:"f2800000-0000-4000-8000-000000000001"};
 let lostReceipt;
 const lostAckWorker={rpc:async(name,args)=>{assert.equal(name,"complete_recovered_import_upload");const r=await worker.rpc(name,args);assert.equal(r.error,null);lostReceipt=r.data;throw new Error("Synthetic lost ACK after database commit");}};
 await assert.rejects(recoverTrustedHtmlImport({userClient:user,workerClient:lostAckWorker,archive,reauthorize:routineAuth},actor,routineFile,input,"routine-intake"),e=>e.code==="IMPORT_RECOVERY_RESULT_UNKNOWN");
 assert.equal(puts,1);assert.equal(lostReceipt.formally_imported,false);
 const beforeRead={...calls},archiveBeforeRead=archiveCalls,proof=await readTrustedUploadRecovery(user,actor,input.recoveryOperationKey,"routine-intake");
 assert.equal(proof.status,"completed");assert.deepEqual(proof.receipt,lostReceipt);assert.equal(archiveCalls,archiveBeforeRead);
 assert.equal(calls["service_role:complete_recovered_import_upload"],beforeRead["service_role:complete_recovered_import_upload"]);
 const replay=await recoverTrustedHtmlImport({userClient:user,workerClient:worker,archive,reauthorize:routineAuth},actor,routineFile,input,"routine-intake");
 assert.deepEqual(replay,lostReceipt);assert.equal(archiveCalls,archiveBeforeRead);assert.equal(puts,1);assert.equal(originalDigest(metadata(rawKey)),originalHash);
 const unknown=await readTrustedUploadRecovery(user,actor,"f2800000-0000-4000-8000-000000000099","routine-intake");assert.equal(unknown,null);

 prepareOld();
 let generalActor={...actor,assuranceLevel:"aal2"};
 generalActor=await revalidateGeneralImportActor(generalActor,"write",oldGeneral);
 const generalFile=file("general"),generalKey="native-coordinator-general-original";
 await assert.rejects(stageTrustedHtmlImport({userClient:oldGeneral,workerClient:failBeforeWorker,archive},generalActor,generalFile,generalKey));
 const generalOriginal=metadata(generalKey),generalHash=originalDigest(generalOriginal);assert.equal(puts,2);expireOld();
 generalActor=await revalidateGeneralImportActor(generalActor,"write",generalUser);
 const repo=()=>new GeneralProductionImportRepository({userClient:generalUser,workerClient:worker,archive,actor:generalActor,permission:"upload",reauthorize:p=>revalidateGeneralImportActor(generalActor,p==="preview"?"read":p==="approve"?"approve":"write",generalUser)});
 const generalInput={reservationId:generalOriginal.id,originalOperationKey:generalKey,recoveryOperationKey:"f2800000-0000-4000-8000-000000000002"};
 const result=await repo().recoverQueuedUpload(generalFile,generalInput);
 assert.equal(result.batch.id,deterministicBatchId(generalActor,generalKey));assert.equal(result.batch.version,1);assert.equal(result.duplicate,false);assert.equal(puts,2);
 const priorWorker=calls["service_role:complete_recovered_import_upload"],priorArchive=archiveCalls;
 const again=await repo().recoverQueuedUpload(generalFile,generalInput);assert.equal(again.replayed,true);assert.deepEqual(again.batch,result.batch);
 assert.equal(calls["service_role:complete_recovered_import_upload"],priorWorker);assert.equal(archiveCalls,priorArchive);
 assert.equal(originalDigest(metadata(generalKey)),generalHash);assert.equal(globalThis.SYNTHETIC_RECOVERY_EXECUTED,undefined);
 assert.equal(result.batch.security.externalRequestCount,0);assert.ok(result.batch.security.scriptElementsBlocked>0);assert.ok(result.batch.security.externalReferencesBlocked>0);
 console.log("ADAPTER="+JSON.stringify({calls,archiveCalls,immutablePutObjectCount:puts,originalReservationUnchanged:true,lostAcknowledgementReadVerified:true,readDidNotCompleteOrArchive:true,generalBatchIdOriginal:true,generalVersion:1,formalClientPromotion:false,externalNetworkRequests:0,parserScriptExecution:0}));
})().catch(e=>{console.error(e);process.exitCode=1;});
`;
  await writeFile(adapterPath,adapterSource);
  const adapterBefore=counts(),adapterOutput=run(process.execPath,[adapterPath]);
  evidence.adapterRoundtrip=JSON.parse(marker(adapterOutput,"ADAPTER"));
  const adapterAfter=counts();
  for(const name of ["clients","plans","careRecords","medications"])assert.equal(adapterAfter[name],adapterBefore[name]);
  evidence.adapterRoundtrip.businessChanges=0;
  for(const source of evidence.adapterSources)assert.equal(createHash("sha256").update(await readFile(join(root,source.name))).digest("hex"),source.sha256,"Adapter source changed during native verification");

  evidence.fixtureCounts=counts();
  evidence.fixtureScope={organizationId:org,branchId:branch,actorUserId:actor};
  for(const migration of evidence.migrations)assert.equal(createHash("sha256").update(await readFile(join(root,"supabase/migrations",migration.name))).digest("hex"),migration.sha256,"Migration changed during native verification");
  assert.equal(createHash("sha256").update(await readFile(testPath)).digest("hex"),evidence.testSha256);
  assert.equal(createHash("sha256").update(await readFile(import.meta.filename)).digest("hex"),evidence.runnerSha256);
  evidence.limitations=["Synthetic local SQL/Auth only; immutable archive bytes/transport substituted in memory, not hosted WORM activation","Targeted real database races, not universal revocation serialization or formal CMS client promotion","Actual checked-in TS-to-SQL coordinator/repository chain, not authenticated production HTTP/UI workflow"];
  console.log(`${engine}; exact153migrations; ${passed}/${expected}pgTAP; native evidence ${join(runtime,"evidence.json")}`);
} catch(error){testFailure=error;throw error;}
finally{
  const cleanupErrors=[];
  for(const holder of [...holders]){try{await holder.release();}catch(error){cleanupErrors.push(error);}}
  for(const child of children)child.kill("SIGTERM");
  for(const child of [...children]){
    let timer;try{await Promise.race([childCompletions.get(child),new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error("Owned native client did not stop")),5000);})]);}
    catch(error){cleanupErrors.push(error);}finally{clearTimeout(timer);}
  }
  if(testFailure)await writeFile(join(runtime,"failure.json"),JSON.stringify({syntheticOnly:true,error:testFailure.message,evidence},null,2));
  let stopped=false;
  const cleanup=await cleanupNativeData({started,testFailure,cleanupErrors,stop:()=>{run(join(binaries,"pg_ctl"),["-D",data,"-m","fast","-w","stop"]);stopped=true;}});
  evidence.cleanup={ownedClusterStopped:stopped,ownedClientProcessesRemaining:children.size,ownedLockHoldersRemaining:holders.size,dataStatus:cleanup.status,logsAndEvidenceRetained:true};
  await writeFile(join(runtime,testFailure?"failure-cleanup.json":"evidence.json"),JSON.stringify(evidence,null,2));
}
