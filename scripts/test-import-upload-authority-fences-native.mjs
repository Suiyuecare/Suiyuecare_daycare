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
const { runtime, data, cleanupNativeData } = await createNativeTestRuntime("/tmp/daycare-import-authority-fences-native.");
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
  current.child.stdin.write(`begin;set local application_name='native_fences_holder';${statement};select 'READY='||pg_backend_pid();\n`);
  const deadline = Date.now() + 10000;
  while (!/^READY=\d+$/m.test(current.output())) {
    if (current.child.exitCode !== null || Date.now() > deadline) throw new Error("Owned native holder did not become ready.");
    await new Promise(done => setTimeout(done, 25));
  }
  holder.pid = Number(marker(current.output(), "READY")); return holder;
}
async function blocked(names, holderPid) {
  assert.ok(names.length > 0 && names.every(name => /^native_fences_[a-z_]+$/u.test(name)));
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
const digest=value=>createHash("sha256").update(value).digest("hex");
const uuid=label=>{
 const bytes=createHash("sha256").update(label).digest().subarray(0,16);
 bytes[6]=(bytes[6]&15)|80;bytes[8]=(bytes[8]&63)|128;const h=bytes.toString("hex");
 return[h.slice(0,8),h.slice(8,12),h.slice(12,16),h.slice(16,20),h.slice(20)].join("-");
};
try{
 const engine=run(join(binaries,"postgres"),["--version"]).trim(),version=engine.match(/^postgres \(PostgreSQL\) 17\.(\d+)(?:\s|$)/u);
 assert.ok(version&&Number(version[1])>=11,"PostgreSQL17.11+ security minor required");evidence.engine=engine;
 run(join(binaries,"initdb"),["-D",data,"-U","postgres","--auth-local=trust","--auth-host=reject","--no-locale","--encoding=UTF8"]);
 run(join(binaries,"pg_ctl"),["-D",data,"-l",join(runtime,"server.log"),"-o",
  `-k ${runtime} -p ${env.PGPORT} -c listen_addresses='' -c timezone=UTC -c statement_timeout=15000 -c idle_in_transaction_session_timeout=30000 -c max_wal_size=128MB -c min_wal_size=32MB`,"-w","start"]);started=true;
 sql(bootstrapSql);
 sql(`create schema storage;create table storage.buckets(id text primary key,name text not null,public boolean not null default false,file_size_limit bigint,allowed_mime_types text[]);
 create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text not null references storage.buckets(id),name text not null,metadata jsonb,
 created_at timestamptz not null default clock_timestamp(),updated_at timestamptz not null default clock_timestamp(),unique(bucket_id,name));
 alter table storage.objects enable row level security;grant usage on schema storage to anon,authenticated,service_role;
 grant all on storage.objects to anon,authenticated,service_role;`);
 const names=(await readdir(join(root,"supabase/migrations"))).filter(n=>n.endsWith(".sql")).sort();
 assert.equal(names.length,153);assert.equal(names.at(-1),"20260927171515_import_upload_operation_locator.sql");
 assert.equal(names[151],"20260927163540_import_upload_authority_fences.sql");
 // Deliberately compile only151 first: no mocks or recreated admission guards.
 for(const name of names.slice(0,151)){
  const source=await readFile(join(root,"supabase/migrations",name),"utf8");assert.ok(source.trim());
  sql(source);evidence.migrations.push({name,sha256:digest(source)});
 }
 sql(await readFile(join(root,"supabase/seed.sql"),"utf8"));
 sql(run("/usr/bin/tar",["-xOf",join(root,"node_modules/@electric-sql/pglite/dist/pgtap.tar.gz"),"share/postgresql/extension/pgtap--1.3.5.sql"]));
 const testPath=join(root,"supabase/tests/import_upload_authority_fences.test.sql"),testSource=await readFile(testPath,"utf8");
 evidence.testSha256=digest(testSource);
 const sentinel="-- NATIVE_FIXTURE_END";assert.ok(testSource.includes(sentinel));
 const prefix=testSource.slice(0,testSource.indexOf(sentinel)).replace(/select\s+plan\(\d+\);/iu,"");
 const setup=sql(`${prefix}select 'PARSED='||pg_temp.af_parsed()::text;commit;`);
 const parsed=JSON.parse(marker(setup,"PARSED"));
 const org="f3200000-0000-4000-8000-000000000001",branch="f3300000-0000-4000-8000-000000000001",
  actor="f3100000-0000-4000-8000-000000000001",membership="f3400000-0000-4000-8000-000000000001";
 const transaction=(call,name,claims,role="authenticated")=>{
  assert.match(name,/^native_fences_[a-z_]+$/u);assert.ok(["authenticated","service_role"].includes(role));
  return`begin;set local application_name=${quote(name)};select set_config('request.jwt.claims',${quote(JSON.stringify(claims))},true);set local role ${role};${call};commit;`;
 };
 const reserveCall=(mode,key,sha)=>`select 'RESULT='||public.${mode==="general"?"reserve_import_upload":"reserve_intake_import_upload"}('${org}','${branch}','${key}','${sha}','synthetic.html','text/html',128,'central-care-plan-html@1')::text`;
 const archive=reservation=>({key:`organizations/${org}/branches/${branch}/central-html/${reservation.file_sha256}/${reservation.reservation_id}.html`,
  versionId:"synthetic-fence-worm-v1",sha256:reservation.file_sha256,byteLength:128,createdAt:reservation.created_at,
  retainUntil:JSON.parse(sql(`select to_jsonb(${quote(reservation.created_at)}::timestamptz+interval '7 years')::text`).trim())});
 const completeCall=reservation=>`select 'RESULT='||public.complete_import_upload('${reservation.reservation_id}',${quote(JSON.stringify(parsed))},${quote(JSON.stringify(archive(reservation)))}::jsonb)::text`;
 const moduleCounts=()=>JSON.parse(sql(`select jsonb_build_object(
  'reservations',(select count(*)from private.import_upload_reservations),'completions',(select count(*)from private.import_upload_completions),
  'audit',(select count(*)from public.audit_events where table_name in('private.import_upload_reservations','private.import_upload_completions')),
  'clients',(select count(*)from public.clients),'plans',(select count(*)from public.authorized_care_plans),
  'careRecords',(select count(*)from public.care_records),'medications',(select count(*)from public.medication_administrations))`).trim());
 const exactOperation=key=>JSON.parse(sql(`select jsonb_build_object(
  'reservations',(select count(*)from private.import_upload_reservations where actor_user_id='${actor}'and idempotency_key='${key}'),
  'completions',(select count(*)from private.import_upload_completions c join private.import_upload_reservations r on r.id=c.id where r.actor_user_id='${actor}'and r.idempotency_key='${key}'))`).trim());
 const actualClaims=(label,mode,event)=>{
  const session=uuid("fence-session:"+label),challenge=uuid("fence-challenge:"+label);
  const timing=JSON.parse(sql(`select jsonb_build_object('now',floor(extract(epoch from clock_timestamp()))::bigint,
   'oauth',floor(extract(epoch from clock_timestamp()-interval '20 minutes'))::bigint,
   'factor',floor(extract(epoch from clock_timestamp()))::bigint-${event==="mfa"?896:30})`).trim());
  const factor=timing.factor,expires=timing.now+(event==="jwt"?4:1800);
  sql(`insert into auth.sessions(id,user_id,created_at,aal)values('${session}','${actor}',to_timestamp(${timing.oauth}-30),'${mode==="general"?"aal2":"aal1"}');
   insert into auth.mfa_amr_claims(id,session_id,created_at,updated_at,authentication_method)
   values('${uuid("fence-oauth:"+label)}','${session}',to_timestamp(${timing.oauth}),to_timestamp(${timing.oauth}),'oauth');
   ${mode==="general"?`insert into auth.mfa_amr_claims(id,session_id,created_at,updated_at,authentication_method)
    values('${uuid("fence-factor:"+label)}','${session}',to_timestamp(${factor}),to_timestamp(${factor}),'totp');
    insert into private.reauth_challenges(id,user_id,session_id,nonce_sha256,idempotency_key,issued_jwt_iat,created_at,expires_at,
     consumed_at,consumed_jwt_iat,factor_method,factor_verified_at)
    values('${challenge}','${actor}','${session}','${digest(label)}','${uuid("fence-nonce:"+label)}',to_timestamp(${factor}-120),
     to_timestamp(${factor}-60),to_timestamp(${factor}+240),to_timestamp(${factor}),to_timestamp(${factor}),'totp',to_timestamp(${factor}));
    insert into private.reauth_events(user_id,session_id,challenge_id,aal,verification_method,verified_at)
    values('${actor}','${session}','${challenge}','aal2','totp',to_timestamp(${factor}));`:""}`);
  const claims={sub:actor,session_id:session,aud:"authenticated",role:"authenticated",aal:mode==="general"?"aal2":"aal1",
   email:"recovery1@care.example.invalid",is_anonymous:false,iat:timing.now,exp:expires,
   amr:[{method:"oauth",timestamp:timing.oauth},...(mode==="general"?[{method:"totp",timestamp:factor}]:[])]};
  return{claims,session,challenge,expiresAt:expires,factorExpiresAt:factor+900};
 };
 const pause=811731522;
 // This timing barrier intercepts only owned INSERT audit, never Auth predicates.
 sql(`create function public.native_fences_audit_pause()returns trigger language plpgsql as $$begin
  if(current_setting('application_name')='native_fences_audit_reserve'and new.table_name='private.import_upload_reservations'and new.action='insert')
   or(current_setting('application_name')='native_fences_audit_complete'and new.table_name='private.import_upload_completions'and new.action='insert')
  then perform pg_advisory_xact_lock(${pause});end if;return new;end$$;
  create trigger native_fences_audit_pause before insert on public.audit_events for each row execute function public.native_fences_audit_pause();`);
 const waitForActualClock=async epoch=>{
  const deadline=Date.now()+10000;
  while(Date.now()<deadline){
   const current=Number(sql("select extract(epoch from clock_timestamp())").trim());
   if(current>epoch)return current;
   await new Promise(done=>setTimeout(done,25));
  }
  throw new Error("Real database authority deadline did not pass within bounded probe.");
 };
 const scenarios=[
  {name:"general_key_revoke",mode:"general",stage:"key",event:"revoke"},
  {name:"general_content_revoke",mode:"general",stage:"content",event:"revoke"},
  {name:"general_key_jwt_expiry",mode:"general",stage:"key",event:"jwt"},
  {name:"general_content_mfa_expiry",mode:"general",stage:"content",event:"mfa"},
  {name:"routine_existing_key_revoke",mode:"routine",stage:"key",event:"revoke",existing:true},
  {name:"routine_insert_revoke",mode:"routine",stage:"insert",event:"revoke"},
  {name:"routine_insert_jwt_expiry",mode:"routine",stage:"insert",event:"jwt"},
  {name:"general_insert_revoke",mode:"general",stage:"insert",event:"revoke"},
  {name:"general_insert_mfa_expiry",mode:"general",stage:"insert",event:"mfa"},
  {name:"general_insert_jwt_expiry",mode:"general",stage:"insert",event:"jwt"},
  {name:"routine_completion_revoke",mode:"routine",stage:"complete",event:"revoke"},
  {name:"routine_completion_jwt_expiry",mode:"routine",stage:"complete",event:"jwt"},
  {name:"general_completion_revoke",mode:"general",stage:"complete",event:"revoke"},
  {name:"general_completion_jwt_expiry",mode:"general",stage:"complete",event:"jwt"},
  {name:"general_completion_mfa_expiry",mode:"general",stage:"complete",event:"mfa"},
  {name:"general_rowlock_revoke_control",mode:"general",stage:"row",event:"revoke",control:true},
  {name:"routine_rowlock_revoke_control",mode:"routine",stage:"row",event:"revoke",control:true},
  {name:"routine_new_key_revoke_control",mode:"routine",stage:"key",event:"revoke",control:true},
  {name:"routine_new_content_revoke_control",mode:"routine",stage:"content",event:"revoke",control:true},
 ];
 async function runProbe(probe,patched){
  const label=(patched?"152:":"151:")+probe.name,key=uuid("fence-operation:"+label),sha=digest("fence-bytes:"+label);
  const auth=actualClaims(label,probe.mode,probe.event);
  let reservation;
  const completing=probe.stage==="complete"||probe.stage==="row";
  if(probe.existing||completing)reservation=result(await concurrent(transaction(reserveCall(probe.mode,key,sha),"native_fences_prepare",auth.claims)));
  const before=moduleCounts(),operationBefore=exactOperation(key);
  const statement=probe.stage==="key"?`select pg_advisory_xact_lock(hashtextextended('import-upload-key:${actor}:${key}',0))`:
   probe.stage==="content"?`select pg_advisory_xact_lock(hashtextextended('import-upload-content:${org}:${branch}:${sha}:central-care-plan-html@1',0))`:
   probe.stage==="row"?`select id from private.import_upload_reservations where id='${reservation.reservation_id}'for update`:
   `select pg_advisory_xact_lock(${pause})`;
  const holder=await hold(statement),name=probe.stage==="insert"?"native_fences_audit_reserve":probe.stage==="complete"?"native_fences_audit_complete":"native_fences_wait";
  const pending=concurrent(transaction(completing?completeCall(reservation):reserveCall(probe.mode,key,sha),name,
   completing?{role:"service_role"}:auth.claims,completing?"service_role":"authenticated"));
  const waiters=await blocked([name],holder.pid);
  let actualDeadlineObservedAt=null;
  if(probe.event==="revoke")sql(`update public.memberships set status='suspended'where id='${membership}'`);
  else actualDeadlineObservedAt=await waitForActualClock(probe.event==="jwt"?auth.expiresAt:auth.factorExpiresAt);
  const postB=moduleCounts();assert.deepEqual(postB,before,"Independent authorization mutation must not alter module-specific audit/data counts");
  await holder.release();const output=await pending,mustDeny=patched||probe.control;
  if(mustDeny){denied(output,"42501");assert.deepEqual(moduleCounts(),before,"Denied exact operation and INSERT audit fully roll back");
   assert.deepEqual(exactOperation(key),operationBefore,"Denied exact actor/key source and completion counts remain unchanged");}
  else{
   const disclosed=result(output);assert.equal(disclosed.reservation_id,reservation?.reservation_id??disclosed.reservation_id);
   if(probe.existing){assert.equal(disclosed.replayed,true);assert.deepEqual(moduleCounts(),before);}
   else if(completing){assert.equal(moduleCounts().completions,before.completions+1);assert.equal(disclosed.staging_only,true);assert.equal(disclosed.formally_imported,false);}
   else assert.equal(moduleCounts().reservations,before.reservations+1);
  }
  if(probe.event==="revoke")sql(`update public.memberships set status='active'where id='${membership}'`);
  const after=moduleCounts();for(const field of["clients","plans","careRecords","medications"])assert.equal(after[field],before[field]);
  evidence.probes.push({name:probe.name,baseline:!patched,expectedOutcome:mustDeny?"42501":"UNSAFE_SUCCESS",actualOutcome:output.status===0?"UNSAFE_SUCCESS":"42501",
   actualBlockedBackends:waiters,holderPid:holder.pid,authorityEvent:probe.event,deadlineEpoch:probe.event==="jwt"?auth.expiresAt:probe.event==="mfa"?auth.factorExpiresAt:null,
   actualDatabaseClockAfterDeadline:actualDeadlineObservedAt,originalOperationBefore:operationBefore,originalOperationAfter:exactOperation(key),
   moduleCountsBefore:before,moduleCountsAfter:after,moduleAuditExcludesIndependentRevocation:true,formalBusinessWrites:0,noReceiptDisclosed:mustDeny?!/^RESULT=/m.test(output.stdout):false});
  console.log(`${patched?"152 GREEN":"151 "+(probe.control?"GREEN control":"RED reproduced")}: ${probe.name}`);
 }
 for(const probe of scenarios)await runProbe(probe,false);
 evidence.baseline={migrations:151,redReproductions:15,alreadyGreenControls:4,independentBackendLocksObserved:true,authorizationReplacements:0};
 await writeFile(join(runtime,"baseline-151.json"),JSON.stringify(evidence,null,2));
 console.log(`151 baseline evidence: ${join(runtime,"baseline-151.json")}`);
 const catalogs=(includeAuthorityBodies=false)=>JSON.parse(sql(`select jsonb_build_object('relations',(select jsonb_agg(jsonb_build_object('oid',c.oid,'acl',c.relacl,'rls',c.relrowsecurity,'force',c.relforcerowsecurity)order by c.oid)from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname in('private','public')),
  'policies',(select jsonb_agg(to_jsonb(p)order by p.oid)from pg_policy p),
  'functions',(select jsonb_object_agg(p.oid::text,jsonb_build_object('security',p.prosecdef,'owner',p.proowner,'config',p.proconfig,'acl',p.proacl,'definition',
   case when ${!includeAuthorityBodies} and n.nspname='private'and p.proname in('reserve_import_upload','reserve_intake_import_upload','complete_import_upload')then null else pg_get_functiondef(p.oid)end))
   from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in('private','public')and p.prokind='f'))`).trim());
 const priorCatalog=catalogs(),businessBefore=moduleCounts(),patchName=names[151],patchSource=await readFile(join(root,"supabase/migrations",patchName),"utf8");
 assert.ok(patchSource.trim(),"152 must be frozen before upgrade");sql(patchSource);evidence.migrations.push({name:patchName,sha256:digest(patchSource)});
 const afterCatalog=catalogs();assert.deepEqual(afterCatalog.relations,priorCatalog.relations);assert.deepEqual(afterCatalog.policies,priorCatalog.policies);
 for(const[oid,value]of Object.entries(priorCatalog.functions))assert.deepEqual(afterCatalog.functions[oid],value,`Existing function ${oid} ACL/security/global body changed`);
 assert.deepEqual(moduleCounts(),businessBefore);
 evidence.upgrade={from:151,to:152,existingRelationsAclRlsUnchanged:true,allPolicyRowsUnchanged:true,allExistingFunctionSecurityAclUnchanged:true,allGlobalAuthorityBodiesUnchanged:true,businessUnchanged:true};
 // The fixed functional fixture uses a distinct f4 namespace and rolls back.
 // Keep genuine single-executive policy; do not add a fake allow-two-users gate.
 const tapSource=testSource.replaceAll("f3","f4").replaceAll("recovery_import_test","fence_functional_test").replaceAll("recovery_import_foreign","fence_functional_foreign")
  .replaceAll("synthetic-recovery-","synthetic-fence-functional-").replaceAll("'recovery'||n","'fencefunctional'||n")
  .replaceAll("'recovery1@care.example.invalid'","'fencefunctional1@care.example.invalid'")
  .replaceAll("repeat(n::text,64)","repeat((n+4)::text,64)").replaceAll("repeat('3',64)","repeat('7',64)");
 const tap=sql(`begin;delete from private.executive_access_policy;${tapSource.replace(/^begin;\s*/u,"").replace(/rollback;\s*$/u,"")}rollback;`);
 const expected=Number(testSource.match(/select\s+plan\((\d+)\)/iu)?.[1]),passed=tap.split("\n").filter(l=>/^ok \d+\b/u.test(l)).length;
 assert.equal(passed,expected,tap);assert.doesNotMatch(tap,/^not ok \d+\b|^# Looks like/mu);evidence.pgTapAssertions=passed;
 for(const probe of scenarios)await runProbe(probe,true);
 // Keep the actual151→152 race comparison intact; then compile153 and prove
 // it leaves every existing function body, ACL/RLS/policy and business row intact.
 const locatorPriorCatalog=catalogs(true),locatorBusinessBefore=moduleCounts(),locatorName=names[152];
 const locatorSource=await readFile(join(root,"supabase/migrations",locatorName),"utf8");
 assert.ok(locatorSource.trim(),"153 must be frozen before upgrade");sql(locatorSource);
 evidence.migrations.push({name:locatorName,sha256:digest(locatorSource)});
 const locatorAfterCatalog=catalogs(true);
 assert.deepEqual(locatorAfterCatalog.relations,locatorPriorCatalog.relations);
 assert.deepEqual(locatorAfterCatalog.policies,locatorPriorCatalog.policies);
 for(const[oid,value]of Object.entries(locatorPriorCatalog.functions))assert.deepEqual(locatorAfterCatalog.functions[oid],value,`153 changed existing function ${oid}`);
 assert.deepEqual(moduleCounts(),locatorBusinessBefore);
 evidence.locatorUpgrade={from:152,to:153,allExistingBodiesAndAclUnchanged:true,relationsAclRlsUnchanged:true,policiesUnchanged:true,businessUnchanged:true};
 for(const source of evidence.migrations)assert.equal(digest(await readFile(join(root,"supabase/migrations",source.name))),source.sha256,"Migration changed during verification");
 assert.equal(digest(await readFile(testPath)),evidence.testSha256);assert.equal(digest(await readFile(import.meta.filename)),evidence.runnerSha256);
 evidence.sourceHashCount=evidence.migrations.length+2;
 evidence.limitations=["Synthetic native Auth/session/AMR and archive reference only; no hosted provider/WORM/HTTP/UI proof",
  "Observed actual clock and independent backend blocking for listed gates, not universal all-transaction revocation serialization",
  "152 does not promote CMS data to formal clients, alter official forms, or activate a hosted service"];
 console.log(`${engine}; exact153migrations; 151 RED15+controls4 ->152 GREEN19; ${passed}/${expected}pgTAP; ${join(runtime,"evidence.json")}`);
}catch(error){testFailure=error;throw error;}
finally{
 const cleanupErrors=[];
 for(const holder of[...holders]){try{await holder.release();}catch(error){cleanupErrors.push(error);}}
 for(const child of children)child.kill("SIGTERM");
 for(const child of[...children]){
  let timer;try{await Promise.race([childCompletions.get(child),new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error("Owned native client did not stop")),5000);})]);}
  catch(error){cleanupErrors.push(error);}finally{clearTimeout(timer);}
 }
 if(testFailure)await writeFile(join(runtime,"failure.json"),JSON.stringify({syntheticOnly:true,error:testFailure.message,evidence},null,2));
 let stopped=false;const cleanup=await cleanupNativeData({started,testFailure,cleanupErrors,stop:()=>{run(join(binaries,"pg_ctl"),["-D",data,"-m","fast","-w","stop"]);stopped=true;}});
 evidence.cleanup={ownedClusterStopped:stopped,ownedClientProcessesRemaining:children.size,ownedLockHoldersRemaining:holders.size,dataStatus:cleanup.status,logsAndEvidenceRetained:true};
 await writeFile(join(runtime,testFailure?"failure-cleanup.json":"evidence.json"),JSON.stringify(evidence,null,2));
}
