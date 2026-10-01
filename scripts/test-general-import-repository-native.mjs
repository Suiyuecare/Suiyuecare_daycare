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
const { runtime, data, cleanupNativeData } = await createNativeTestRuntime("/tmp/daycare-general-import-native.");
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
  current.child.stdin.write(`begin;set local application_name='native_general_holder';${statement};select 'READY='||pg_backend_pid();\n`);
  const deadline = Date.now() + 10000;
  while (!/^READY=\d+$/m.test(current.output())) {
    if (current.child.exitCode !== null || Date.now() > deadline) throw new Error("Owned native holder did not become ready.");
    await new Promise(done => setTimeout(done, 25));
  }
  holder.pid = Number(marker(current.output(), "READY")); return holder;
}
async function blocked(names, holderPid) {
  assert.ok(names.length > 0 && names.every(name => /^native_general_[a-z_]+$/u.test(name)));
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
  assert.equal(allMigrations.length, 158, "Current repository must contain the complete 158-migration chain");
  assert.deepEqual(allMigrations.slice(153), [
    "20260928033352_abcd_selected_client_option.sql", "20260928044255_abcd_operation_recovery.sql",
    "20260928045335_abcd_routine_draft_aal1.sql", "20260928050459_abcd_assessment_client_search.sql",
    "20261001173654_care_diary_shift_time_guard.sql",
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
    if (index === 149) { sql(await readFile(join(root, "supabase/seed.sql"), "utf8")); previous = fingerprint(); }
    sql(source); evidence.migrations.push({ name, sha256: createHash("sha256").update(source).digest("hex") });
  }
  assert.ok(previous); assert.equal(fingerprint(), previous, "149-to-153 cannot alter existing seeded business data");
  evidence.upgrade = { from: 149, to: 153, businessFingerprint: previous, unchanged: true };
  sql(run("/usr/bin/tar", ["-xOf", join(root, "node_modules/@electric-sql/pglite/dist/pgtap.tar.gz"), "share/postgresql/extension/pgtap--1.3.5.sql"]));
  const testPath = join(root, "supabase/tests/general_import_repository.test.sql"); const testSource = await readFile(testPath, "utf8");
  evidence.testSha256 = createHash("sha256").update(testSource).digest("hex");
  const tap = sql(testSource); const expected = Number(testSource.match(/select\s+plan\((\d+)\)/iu)?.[1] ?? tap.match(/^1\.\.(\d+)$/mu)?.[1]);
  const passed = tap.split("\n").filter(line => /^ok \d+\b/u.test(line)).length;
  assert.ok(expected > 1); assert.equal(passed, expected, tap); assert.doesNotMatch(tap, /^not ok \d+\b|^# Looks like/mu);
  evidence.pgTapAssertions = passed;
  const sentinel = "-- NATIVE_FIXTURE_END"; assert.ok(testSource.includes(sentinel));
  const prefix = testSource.slice(0, testSource.indexOf(sentinel)).replace(/select\s+(?:plan\(\d+\)|no_plan\(\));/iu, "");
  const setup = sql(`${prefix}\nselect pg_temp.gi_login();select 'JWT='||current_setting('request.jwt.claims');select 'PARSED='||pg_temp.gi_parsed()::text;commit;`);
  const jwt = marker(setup, "JWT"), parsed = JSON.parse(marker(setup, "PARSED"));
  const org = "f1200000-0000-4000-8000-000000000001", branch = "f1300000-0000-4000-8000-000000000001", actor = "f1100000-0000-4000-8000-000000000001";
  const transaction = (call, name, claims = jwt, role = "authenticated") => {
    assert.match(name, /^native_general_[a-z_]+$/u); assert.ok(["authenticated", "service_role"].includes(role));
    return `begin;set local application_name=${quote(name)};select set_config('request.jwt.claims',${quote(claims)},true);set local role ${role};${call};commit;`;
  };
  const counts = () => JSON.parse(sql(`select jsonb_build_object('sources',(select count(*)from private.general_import_repository_sources),
    'versions',(select count(*)from private.general_import_repository_versions),'operations',(select count(*)from private.general_import_repository_operations),
    'clients',(select count(*)from public.clients),'carePlans',(select count(*)from public.authorized_care_plans),
    'audit',(select count(*)from public.audit_events where table_name like '%general_import_repository%'))`).trim());
  const uuid = value => {
    const bytes = createHash('sha256').update(value).digest().subarray(0,16);
    bytes[6]=(bytes[6]&15)|80;bytes[8]=(bytes[8]&63)|128;
    const hex=bytes.toString('hex');return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
  };
  const batch = key => uuid([org,branch,actor,key].join('\x1f'));
  const reserveUuid = key => uuid(JSON.stringify(['trusted-html-upload/v1',org,branch,actor,key]));
  const readCall = id => `select 'RESULT='||coalesce(public.general_import_repository_read('${org}','${branch}','${id}'),'null'::jsonb)::text`;
  const attachCall = source => `select 'RESULT='||public.general_import_repository_attach('${org}','${branch}','${source.batchId}','${source.reservation.reservation_id}',${quote(source.key)})::text`;
  const reparseCall = (id,key,expected) => `select 'RESULT='||public.general_import_repository_reparse('${org}','${branch}','${id}',${quote(JSON.stringify(parsed))}::jsonb,'ready_for_approval',${quote(key)},${expected})::text`;
  const operationLock = key => `select pg_advisory_xact_lock(hashtextextended(${quote(`general-import-operation:${actor}:${key}`)},0))`;
  const batchLock = id => `select pg_advisory_xact_lock(hashtextextended(${quote(`general-import-batch:${id}`)},0))`;
  let ordinal=0;
  const stage = async key => {
    const sha = createHash('sha256').update(`synthetic-native-${++ordinal}`).digest('hex');
    const reservation = result(await concurrent(transaction(`select 'RESULT='||public.reserve_import_upload('${org}','${branch}','${reserveUuid(key)}','${sha}','synthetic.html','text/html',128,'central-care-plan-html@1')::text`,'native_general_reserve')));
    const archive = {key:`organizations/${org}/branches/${branch}/central-html/${sha}/${reservation.reservation_id}.html`,
      versionId:'synthetic-native-worm',sha256:sha,createdAt:reservation.created_at,byteLength:128,
      retainUntil:JSON.parse(sql(`select to_jsonb(${quote(reservation.created_at)}::timestamptz+interval '7 years')::text`).trim())};
    const completed=result(await concurrent(transaction(`select 'RESULT='||public.complete_import_upload('${reservation.reservation_id}',${quote(JSON.stringify(parsed))},${quote(JSON.stringify(archive))}::jsonb)::text`,'native_general_complete','{"role":"service_role"}','service_role')));
    assert.equal(completed.formally_imported,false);assert.equal(completed.staging_only,true);
    return {key,batchId:batch(key),reservation,archive};
  };
  const original=await stage('native-original');
  const firstCounts=counts();
  const uploadHolder=await hold(operationLock(original.key));
  const uploadA=concurrent(transaction(attachCall(original),'native_general_attach_a'));
  const uploadB=concurrent(transaction(attachCall(original),'native_general_attach_b'));
  const uploadWait=await blocked(['native_general_attach_a','native_general_attach_b'],uploadHolder.pid);
  await uploadHolder.release();
  const uploaded=await Promise.all([uploadA,uploadB]);
  const uploadResults=uploaded.map(result);
  assert.equal(uploadResults.filter(value=>value.replayed===false).length,1);
  assert.equal(uploadResults.filter(value=>value.replayed===true).length,1);
  assert.deepEqual(uploadResults[0].batch,uploadResults[1].batch);
  const afterUpload=counts();assert.equal(afterUpload.sources,firstCounts.sources+1);assert.equal(afterUpload.versions,firstCounts.versions+1);assert.equal(afterUpload.operations,firstCounts.operations+1);
  evidence.probes.push({name:'same_actor_key_attach',waiters:uploadWait,outcomes:uploadResults.map(value=>({replayed:value.replayed,version:value.batch.version})),singleImmutableReceipt:true});

  const reparseHolder=await hold(batchLock(original.batchId));
  const parseA=concurrent(transaction(reparseCall(original.batchId,'native-reparse-a',1),'native_general_reparse_a'));
  const parseB=concurrent(transaction(reparseCall(original.batchId,'native-reparse-b',1),'native_general_reparse_b'));
  const parseWait=await blocked(['native_general_reparse_a','native_general_reparse_b'],reparseHolder.pid);
  await reparseHolder.release();
  const parsedResults=await Promise.all([parseA,parseB]);
  assert.equal(parsedResults.filter(value=>value.status===0).length,1);
  const failedParse=parsedResults.find(value=>value.status!==0);denied(failedParse,'40001');
  const savedParse=result(parsedResults.find(value=>value.status===0));assert.equal(savedParse.version,2);
  const afterParse=counts();assert.equal(afterParse.versions,afterUpload.versions+1);assert.equal(afterParse.operations,afterUpload.operations+1);
  const historical=result(await concurrent(transaction(`select 'RESULT='||public.general_import_repository_find_upload('${org}','${branch}',${quote(original.key)})::text`,'native_general_historical')));
  assert.equal(historical.batch.version,1);assert.deepEqual(historical.batch,uploadResults[0].batch);
  evidence.probes.push({name:'reparse_compare_and_swap',waiters:parseWait,outcomes:[{committedVersion:2},{sqlstate:'40001'}],historicalUploadVersion:1});

  const revoked=await stage('native-before-lock-revoke');
  const revokeHolder=await hold(operationLock(revoked.key));
  const revokeBefore=counts();
  const revokePending=concurrent(transaction(attachCall(revoked),'native_general_revoke_wait'));
  const revokeWait=await blocked(['native_general_revoke_wait'],revokeHolder.pid);
  sql(`update public.memberships set status='ended' where id='f1400000-0000-4000-8000-000000000001'`);
  await revokeHolder.release();denied(await revokePending,'42501');
  assert.deepEqual(counts(),revokeBefore,'revoked waiting upload inserts and audits must all roll back');
  sql(`update public.memberships set status='active' where id='f1400000-0000-4000-8000-000000000001'`);
  evidence.probes.push({name:'actual_membership_revoke_during_operation_wait',waiters:revokeWait,sqlstate:'42501',zeroRepositoryAndBusinessChanges:true});

  // Test-only audit hook creates a deterministic post-insert wait; it never
  // replaces authorization/source predicates or manipulates their return values.
  sql(`create function public.native_general_audit_pause()returns trigger language plpgsql as $$begin
    if new.table_name='private.general_import_repository_sources' and new.metadata->>'projection'='general_import_repository_v1'
      and current_setting('application_name')like 'native_general_audit_%' then perform pg_advisory_xact_lock(811731501);end if;return new;end$$;
    create trigger native_general_audit_pause before insert on public.audit_events for each row execute function public.native_general_audit_pause();`);
  const postInsert=await stage('native-after-insert-revoke');
  const auditHolder=await hold('select pg_advisory_xact_lock(811731501)');
  const beforeAudit=counts();
  const auditPending=concurrent(transaction(attachCall(postInsert),'native_general_audit_write'));
  const auditWait=await blocked(['native_general_audit_write'],auditHolder.pid);
  sql(`update private.executive_access_policy set enabled=false where allowed_user_id='${actor}'`);
  await auditHolder.release();denied(await auditPending,'42501');assert.deepEqual(counts(),beforeAudit);
  sql(`update private.executive_access_policy set enabled=true where allowed_user_id='${actor}'`);
  evidence.probes.push({name:'actual_executive_revoke_after_insert_before_response',waiters:auditWait,sqlstate:'42501',transactionRolledBack:true});

  const readHolder=await hold('select pg_advisory_xact_lock(811731501)');
  const beforeRead=counts();
  const readPending=concurrent(transaction(readCall(original.batchId),'native_general_audit_read'));
  const readWait=await blocked(['native_general_audit_read'],readHolder.pid);
  sql(`update public.branches set is_active=false where id='${branch}'`);
  await readHolder.release();denied(await readPending,'42501');assert.deepEqual(counts(),beforeRead);
  sql(`update public.branches set is_active=true where id='${branch}';drop trigger native_general_audit_pause on public.audit_events;drop function public.native_general_audit_pause()`);
  evidence.probes.push({name:'branch_revoke_before_read_response',waiters:readWait,sqlstate:'42501',noSnapshotDisclosed:true});

  // A fresh child receives only loopback Unix-socket configuration and the
  // synthetic JWT. It transpiles the checked-in adapter/contracts, calls real
  // SQL RPCs, and substitutes only external WORM byte transport, not authority.
  evidence.adapterSources=[];
  for(const name of ['production-repository.ts','production-model.ts','reauth.ts','trusted-staging.ts','validation.ts','parser.ts','service.ts','types.ts','errors.ts','worm-archive.ts']){
    evidence.adapterSources.push({name:`src/lib/imports/${name}`,sha256:createHash('sha256').update(await readFile(join(root,'src/lib/imports',name))).digest('hex')});
  }
  const adapterPath=join(runtime,'adapter-roundtrip.cjs');
  const adapterSource=String.raw`
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process');
const cfg=${JSON.stringify({root,binaries,env,args,jwt,org,branch,actor,batchId:original.batchId,parsed})};
const Module=require('node:module'),req=Module.createRequire(path.join(cfg.root,'package.json')),ts=req('typescript');
const oldResolve=Module._resolveFilename,oldLoad=Module._load;
Module._resolveFilename=function(name,parent,...rest){if(name.startsWith('@/'))name=path.join(cfg.root,'src',name.slice(2));return oldResolve.call(this,name,parent,...rest);};
Module._load=function(name,...rest){return name==='server-only'?{}:oldLoad.call(this,name,...rest);};
require.extensions['.ts']=(module,name)=>module._compile(ts.transpileModule(fs.readFileSync(name,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText,name);
const {GeneralProductionImportRepository}=req(path.join(cfg.root,'src/lib/imports/production-repository.ts'));
const {revalidateGeneralImportActor}=req(path.join(cfg.root,'src/lib/imports/reauth.ts'));
const {uploadHtmlImport,reparseHtmlImport,approveHtmlImport}=req(path.join(cfg.root,'src/lib/imports/service.ts'));
const q=value=>"'"+String(value).replaceAll("'","''")+"'";
const signatures={
general_import_repository_authorize:['p_org','p_branch','p_action'],
general_import_repository_read:['p_org','p_branch','p_batch'],
general_import_repository_find_hash:['p_org','p_branch','p_sha'],
general_import_repository_find_upload:['p_org','p_branch','p_key'],
general_import_repository_attach:['p_org','p_branch','p_batch','p_reservation','p_key'],
general_import_repository_duplicate:['p_org','p_branch','p_batch','p_file_sha256','p_file_name','p_mime_type','p_key'],
general_import_repository_find_reparse:['p_org','p_branch','p_batch','p_parsed','p_status','p_key'],
general_import_repository_reparse:['p_org','p_branch','p_batch','p_parsed','p_status','p_key','p_expected_version'],
general_import_repository_approve:['p_org','p_branch','p_batch','p_expected_version','p_resolutions','p_key'],
reserve_import_upload:['p_expected_organization_id','p_expected_branch_id','p_idempotency_key','p_file_sha256','p_file_name','p_mime_type','p_file_size_bytes','p_mapping_version'],
complete_import_upload:['p_reservation_id','p_parsed_payload','p_archive_reference']};
const calls={};
const client=role=>({rpc:async(name,input)=>{
 assert.ok(Object.hasOwn(signatures,name),'unapproved RPC');assert.deepEqual(Object.keys(input).sort(),[...signatures[name]].sort());
 calls[role+':'+name]=(calls[role+':'+name]||0)+1;
 const params=signatures[name].map(k=>input[k]===null?'null':typeof input[k]==='number'?String(input[k]):typeof input[k]==='object'?q(JSON.stringify(input[k]))+'::jsonb':q(input[k]));
 const statement="begin;set local application_name='native_general_adapter';select set_config('request.jwt.claims',"+q(role==='authenticated'?cfg.jwt:'{"role":"service_role"}')+",true);set local role "+role+";select 'RESULT='||coalesce(public."+name+'('+params.join(',')+"),'null'::jsonb)::text;commit;";
 const output=cp.spawnSync(path.join(cfg.binaries,'psql'),cfg.args,{cwd:cfg.root,env:cfg.env,input:statement,encoding:'utf8',timeout:15000,maxBuffer:16*1024*1024});
 if(output.error)throw new Error('local RPC transport failed');
 if(output.status!==0)return{data:null,error:{code:output.stderr.match(/ERROR:\s+([A-Z0-9]{5}):/)?.[1]||'XX000'}};
 const line=output.stdout.split('\n').find(x=>x.startsWith('RESULT='));assert.ok(line,'RPC result required');return{data:JSON.parse(line.slice(7)),error:null};
}});
const user=client('authenticated'),worker=client('service_role');
let actor={organizationId:cfg.org,branchId:cfg.branch,userId:cfg.actor,assuranceLevel:'aal2',recentAal2At:null};
const bytesByReservation=new Map();let archives=0,reads=0;
const archive={archive:async(scope,reservationId,bytes,sha,created)=>{
 const owned=Uint8Array.from(bytes);const prior=bytesByReservation.get(reservationId);
 if(prior)assert.deepEqual(prior,owned);else bytesByReservation.set(reservationId,owned);
 archives++;const retain=new Date(created);retain.setUTCFullYear(retain.getUTCFullYear()+7);
 return{key:'organizations/'+scope.organizationId+'/branches/'+scope.branchId+'/central-html/'+sha+'/'+reservationId+'.html',versionId:'synthetic-adapter-immutable-v1',sha256:sha,createdAt:created.toISOString(),retainUntil:retain.toISOString(),byteLength:owned.byteLength};
},read:async(scope,reservationId,reference)=>{assert.equal(scope.organizationId,cfg.org);assert.equal(scope.branchId,cfg.branch);assert.equal(reference.versionId,'synthetic-adapter-immutable-v1');reads++;const bytes=bytesByReservation.get(reservationId);assert.ok(bytes);return Uint8Array.from(bytes);}};
const repo=permission=>new GeneralProductionImportRepository({userClient:user,workerClient:worker,archive,actor,permission,reauthorize:p=>revalidateGeneralImportActor(actor,p==='preview'?'read':p==='approve'?'approve':'write',user)});
(async()=>{
 actor=await revalidateGeneralImportActor(actor,'write',user);
 const initial=await repo('preview').findById(actor,cfg.batchId);assert.equal(initial.version,2);
 const historical=await repo('upload').findByOperationKey(actor,'native-original');assert.equal(historical.batch.version,1);assert.equal(historical.replayed,true);
 const file={fileName:'adapter.html',mimeType:'text/html',bytes:Buffer.from('<!doctype html><html><head><meta charset=utf-8><script>globalThis.SYNTHETIC_IMPORT_EXECUTED=true</script></head><body><h5>需要服務者基本資料</h5><table><tr><th>個案姓名</th><td>Synthetic adapter subject</td></tr></table><img src="https://external.example.invalid/no-request"><form action="https://external.example.invalid/no-submit"></form></body></html>')};
 const uploaded=await uploadHtmlImport(repo('upload'),actor,file,'adapter-original');assert.equal(uploaded.batch.version,1);assert.equal(uploaded.duplicate,false);assert.equal(archives,1);
 const replay=await uploadHtmlImport(repo('upload'),actor,file,'adapter-original');assert.equal(replay.replayed,true);assert.equal(replay.batch.version,1);assert.equal(archives,1);
 const duplicate=await uploadHtmlImport(repo('upload'),actor,{...file,fileName:'adapter-second.html'},'adapter-duplicate');assert.equal(duplicate.duplicate,true);assert.equal(archives,1);
 const reparsed=await reparseHtmlImport(repo('reparse'),actor,uploaded.batch.id,{mappingVersion:'central-care-plan-html@1',idempotencyKey:'adapter-reparse'});assert.equal(reparsed.version,2);assert.ok(reads>0);
 const currentActor=await revalidateGeneralImportActor(actor,'approve',user);
 const approved=await approveHtmlImport(repo('approve'),currentActor,uploaded.batch.id,{idempotencyKey:'adapter-approval',conflictResolutions:{}});
 assert.equal(approved.staging_only,true);assert.equal(approved.formally_imported,false);
 const after=await repo('preview').findById(actor,uploaded.batch.id);assert.equal(after.version,3);assert.ok(after.approval);assert.equal(after.status,'ready_for_approval');
 assert.equal(globalThis.SYNTHETIC_IMPORT_EXECUTED,undefined);assert.equal(after.security.externalRequestCount,0);assert.ok(after.security.scriptElementsBlocked>0);assert.ok(after.security.externalReferencesBlocked>0);
 const originalAgain=await repo('upload').findByOperationKey(actor,'adapter-original');assert.equal(originalAgain.batch.version,1);
 const originalReparse=await repo('reparse').findReparseOperation(actor,uploaded.batch.id,{mappingVersion:after.mappingVersion,contentFingerprint:after.contentFingerprint,sections:after.sections,fields:after.fields,warnings:after.warnings,conflicts:after.conflicts,security:after.security},after.status,'adapter-reparse');assert.equal(originalReparse.version,2);
 process.stdout.write('ADAPTER='+JSON.stringify({realSqlRpcCalls:calls,immutableSyntheticArchiveWrites:archives,integrityCheckedArchiveReads:reads,versions:[1,2,3],historicalVersions:[1,2],formallyImported:false,sourceAdapter:'src/lib/imports/production-repository.ts'})+'\n');
})().catch(error=>{process.stderr.write(String(error?.stack||error)+'\n');process.exitCode=1;});
`;
  await writeFile(adapterPath,adapterSource);
  const adapterBefore=counts();
  const adapterOutput=run(process.execPath,[adapterPath]);
  evidence.adapterRoundtrip=JSON.parse(marker(adapterOutput,'ADAPTER'));
  const adapterAfter=counts();assert.equal(adapterAfter.clients,adapterBefore.clients);assert.equal(adapterAfter.carePlans,adapterBefore.carePlans);
  evidence.adapterRoundtrip.businessChanges=0;
  evidence.adapterRoundtrip.adapterSha256=createHash('sha256').update(await readFile(join(root,'src/lib/imports/production-repository.ts'))).digest('hex');
  evidence.fixtureCounts = counts();
  evidence.fixtureScope = { organizationId: org, branchId: branch, actorUserId: actor };
  evidence.parsedFingerprint = parsed.contentFingerprint;
  assert.ok(evidence.probes.length > 0, "A compile-only run is not the native repository concurrency gate");
  for (const migration of evidence.migrations) assert.equal(createHash("sha256").update(await readFile(join(root, "supabase/migrations", migration.name))).digest("hex"), migration.sha256, `Migration changed during native verification: ${migration.name}`);
  for(const source of evidence.adapterSources)assert.equal(createHash('sha256').update(await readFile(join(root,source.name))).digest('hex'),source.sha256,`Adapter source changed during native verification: ${source.name}`);
  assert.equal(createHash("sha256").update(await readFile(testPath)).digest("hex"), evidence.testSha256);
  assert.equal(createHash("sha256").update(await readFile(import.meta.filename)).digest("hex"), evidence.runnerSha256);
  evidence.limitations = ["Synthetic local SQL/Auth only; not hosted Auth, real S3 bytes/WORM activation, scanner or formal client promotion", "Lock probes are targeted races, not 50-person HTTP load or universal revocation serialization"];
  await writeFile(join(runtime, "evidence.json"), JSON.stringify(evidence, null, 2));
  console.log(`${engine}; exact153migrations; ${passed}/${expected}pgTAP; native evidence ${join(runtime, "evidence.json")}`);
} catch (error) {
  testFailure = error; throw error;
} finally {
  const cleanupErrors = [];
  for (const holder of [...holders]) { try { await holder.release(); } catch (error) { cleanupErrors.push(error); } }
  for (const child of children) child.kill("SIGTERM");
  for(const child of [...children]){
    let timer;
    try{await Promise.race([childCompletions.get(child),new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('Owned native client did not stop')),5000);})]);}
    catch(error){cleanupErrors.push(error);}finally{clearTimeout(timer);}
  }
  if (testFailure) { try { await writeFile(join(runtime, "failure.json"), JSON.stringify({ syntheticOnly: true, error: testFailure.message, evidence }, null, 2)); } catch (error) { cleanupErrors.push(error); } }
  let stopped=false;
  const cleanup=await cleanupNativeData({ started, testFailure, cleanupErrors, stop: () => {
    run(join(binaries, "pg_ctl"), ["-D", data, "-m", "fast", "-w", "stop"]);stopped=true;
  } });
  evidence.cleanup={ownedClusterStopped:stopped,ownedClientProcessesRemaining:children.size,ownedLockHoldersRemaining:holders.size,dataStatus:cleanup.status,logsAndEvidenceRetained:true};
  await writeFile(join(runtime,testFailure?'failure-cleanup.json':'evidence.json'),JSON.stringify(evidence,null,2));
}
