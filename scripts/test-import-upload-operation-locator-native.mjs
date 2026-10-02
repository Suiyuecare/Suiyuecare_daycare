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
const { runtime, data, cleanupNativeData } = await createNativeTestRuntime("/tmp/daycare-import-operation-locator-native.");
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
  current.child.stdin.write(`begin;set local application_name='native_locator_holder';${statement};select 'READY='||pg_backend_pid();\n`);
  const deadline = Date.now() + 10000;
  while (!/^READY=\d+$/m.test(current.output())) {
    if (current.child.exitCode !== null || Date.now() > deadline) throw new Error("Owned native holder did not become ready.");
    await new Promise(done => setTimeout(done, 25));
  }
  holder.pid = Number(marker(current.output(), "READY")); return holder;
}
async function blocked(names, holderPid) {
  assert.ok(names.length > 0 && names.every(name => /^native_locator_[a-z_]+$/u.test(name)));
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


let started=false,testFailure;
const digest=value=>createHash("sha256").update(value).digest("hex");
const uuid=label=>{
 const b=createHash("sha256").update(label).digest().subarray(0,16);b[6]=(b[6]&15)|80;b[8]=(b[8]&63)|128;
 const h=b.toString("hex");return[h.slice(0,8),h.slice(8,12),h.slice(12,16),h.slice(16,20),h.slice(20)].join("-");
};
try{
 const engine=run(join(binaries,"postgres"),["--version"]).trim(),version=engine.match(/^postgres \(PostgreSQL\) 17\.(\d+)(?:\s|$)/u);
 assert.ok(version&&Number(version[1])>=11,"PostgreSQL17.11+ security minor required");evidence.engine=engine;
 run(join(binaries,"initdb"),["-D",data,"-U","postgres","--auth-local=trust","--auth-host=reject","--no-locale","--encoding=UTF8"]);
 run(join(binaries,"pg_ctl"),["-D",data,"-l",join(runtime,"server.log"),"-o",
  `-k ${runtime} -p ${env.PGPORT} -c listen_addresses='' -c timezone=UTC -c statement_timeout=15000 -c idle_in_transaction_session_timeout=30000 -c max_wal_size=128MB -c min_wal_size=32MB`,"-w","start"]);started=true;
 sql(bootstrapSql);
 sql(`create schema storage;create table storage.buckets(id text primary key,name text not null,public boolean not null default false,file_size_limit bigint,allowed_mime_types text[]);
  create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text not null references storage.buckets(id),name text not null,
  metadata jsonb,created_at timestamptz not null default clock_timestamp(),updated_at timestamptz not null default clock_timestamp(),unique(bucket_id,name));
  alter table storage.objects enable row level security;grant usage on schema storage to anon,authenticated,service_role;
  grant all on storage.objects to anon,authenticated,service_role;`);
 const allNames=(await readdir(join(root,"supabase/migrations"))).filter(n=>n.endsWith(".sql")).sort();
 assert.equal(allNames.length,160,"Current repository must contain the complete 160-migration chain");
 assert.deepEqual(allNames.slice(153),[
  "20260928033352_abcd_selected_client_option.sql","20260928044255_abcd_operation_recovery.sql",
  "20260928045335_abcd_routine_draft_aal1.sql","20260928050459_abcd_assessment_client_search.sql",
  "20261001173654_care_diary_shift_time_guard.sql",
  "20261002052536_questionnaire_resume_summary.sql",
  "20261002074215_questionnaire_assessment_date_lookup.sql",
 ]);
 const names=allNames.slice(0,153);
 assert.equal(names.length,153);assert.equal(names.at(-1),"20260927171515_import_upload_operation_locator.sql");
 const catalogs=()=>JSON.parse(sql(`select jsonb_build_object(
  'relations',(select jsonb_agg(jsonb_build_object('oid',c.oid,'acl',c.relacl,'rls',c.relrowsecurity,'force',c.relforcerowsecurity)order by c.oid)
    from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname in('private','public')),
  'policies',(select jsonb_agg(to_jsonb(p)order by p.oid)from pg_policy p),
  'functions',(select jsonb_object_agg(p.oid::text,jsonb_build_object('security',p.prosecdef,'owner',p.proowner,'config',p.proconfig,'acl',p.proacl,'definition',pg_get_functiondef(p.oid)))
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in('private','public')and p.prokind='f'))`).trim());
 const business=()=>sql(`select md5(jsonb_build_object('clients',(select jsonb_agg(to_jsonb(x)order by x.id)from public.clients x),
  'measurements',(select jsonb_agg(to_jsonb(x)order by x.id)from public.measurements x),
  'forms',(select jsonb_agg(to_jsonb(x)order by x.id)from public.form_versions x),
  'roles',(select jsonb_agg(to_jsonb(x)order by x.id)from public.roles x))::text)`).trim();
 for(const name of names.slice(0,152)){
  const source=await readFile(join(root,"supabase/migrations",name),"utf8");assert.ok(source.trim());
  sql(source);evidence.migrations.push({name,sha256:digest(source)});
 }
 const sourceChain=["supabase/seed.sql","scripts/lib/pglite-bootstrap.mjs","scripts/lib/native-test-cleanup.mjs"];
 evidence.sharedSources=[];
 for(const name of sourceChain)evidence.sharedSources.push({name,sha256:digest(await readFile(join(root,name)))});
 sql(await readFile(join(root,"supabase/seed.sql"),"utf8"));
 const beforeCatalog=catalogs(),beforeBusiness=business(),name=names.at(-1),source=await readFile(join(root,"supabase/migrations",name),"utf8");
 assert.ok(source.trim(),"153 must be frozen before actual verification");sql(source);evidence.migrations.push({name,sha256:digest(source)});
 const afterCatalog=catalogs();assert.deepEqual(afterCatalog.relations,beforeCatalog.relations);assert.deepEqual(afterCatalog.policies,beforeCatalog.policies);
 for(const[oid,row]of Object.entries(beforeCatalog.functions))assert.deepEqual(afterCatalog.functions[oid],row,"153 cannot replace an old admission/RPC or widen old function ACL/security");
 assert.equal(business(),beforeBusiness);evidence.upgrade={from:152,to:153,businessFingerprint:beforeBusiness,businessUnchanged:true,
  allExistingFunctionBodiesAclSecurityUnchanged:true,allExistingRelationsAclRlsUnchanged:true,allPolicyRowsUnchanged:true};
 sql(run("/usr/bin/tar",["-xOf",join(root,"node_modules/@electric-sql/pglite/dist/pgtap.tar.gz"),"share/postgresql/extension/pgtap--1.3.5.sql"]));
 // Reuse the unchanged foundation contract: project-owned definers belong only
 // to private, fixed search_path and no PUBLIC execute; never weaken its test9.
 const foundationPath=join(root,"supabase/tests/foundation_schema.test.sql"),foundationSource=await readFile(foundationPath,"utf8");
 evidence.sharedSources.push({name:"supabase/tests/foundation_schema.test.sql",sha256:digest(foundationSource)});
 const foundationTap=sql(foundationSource),foundationExpected=Number(foundationSource.match(/select\s+plan\((\d+)\)/iu)?.[1]);
 const foundationPassed=foundationTap.split("\n").filter(l=>/^ok \d+\b/u.test(l)).length;
 assert.equal(foundationPassed,foundationExpected,foundationTap);assert.doesNotMatch(foundationTap,/^not ok \d+\b|^# Looks like/mu);
 evidence.foundationAssertions=foundationPassed;
 const testPath=join(root,"supabase/tests/import_upload_operation_locator.test.sql"),testSource=await readFile(testPath,"utf8");
 evidence.testSha256=digest(testSource);
 const tap=sql(testSource),expected=Number(testSource.match(/select\s+plan\((\d+)\)/iu)?.[1]),passed=tap.split("\n").filter(l=>/^ok \d+\b/u.test(l)).length;
 assert.ok(expected>1);assert.equal(passed,expected,tap);assert.doesNotMatch(tap,/^not ok \d+\b|^# Looks like/mu);evidence.pgTapAssertions=passed;
 const sentinel="-- NATIVE_FIXTURE_END";assert.ok(testSource.includes(sentinel));
 const prefix=testSource.slice(0,testSource.indexOf(sentinel)).replace(/select\s+plan\(\d+\);/iu,"");
 const setup=sql(`${prefix}select pg_temp.ol_login(1,'aal2',3);select 'JWT='||current_setting('request.jwt.claims');select 'PARSED='||pg_temp.ol_parsed()::text;commit;`);
 const baseClaims=JSON.parse(marker(setup,"JWT")),parsed=JSON.parse(marker(setup,"PARSED"));
 const org="f5200000-0000-4000-8000-000000000001",branch="f5300000-0000-4000-8000-000000000001",actor="f5100000-0000-4000-8000-000000000001",
  membership="f5400000-0000-4000-8000-000000000001";
 const transaction=(call,name,claims=baseClaims,role="authenticated")=>{
  assert.match(name,/^native_locator_[a-z_]+$/u);assert.ok(["authenticated","service_role"].includes(role));
  return`begin;set local application_name=${quote(name)};select set_config('request.jwt.claims',${quote(JSON.stringify(claims))},true);set local role ${role};${call};commit;`;
 };
 const reserveCall=(mode,key,sha)=>`select 'RESULT='||public.${mode==="general"?"reserve_import_upload":"reserve_intake_import_upload"}('${org}','${branch}','${key}','${sha}','synthetic.html','text/html',128,'central-care-plan-html@1')::text`;
 const readCall=(key,mode)=>`select 'RESULT='||coalesce(public.import_upload_operation_receipt('${org}','${branch}','${key}','${mode}'),'null'::jsonb)::text`;
 const completeCall=r=>{
  const archive={key:`organizations/${org}/branches/${branch}/central-html/${r.file_sha256}/${r.reservation_id}.html`,sha256:r.file_sha256,versionId:"synthetic-locator-worm-v1",
   byteLength:128,createdAt:r.created_at,retainUntil:JSON.parse(sql(`select to_jsonb(${quote(r.created_at)}::timestamptz+interval '7 years')::text`).trim())};
  return`select 'RESULT='||public.complete_import_upload('${r.reservation_id}',${quote(JSON.stringify(parsed))},${quote(JSON.stringify(archive))}::jsonb)::text`;
 };
 const counts=()=>JSON.parse(sql(`select jsonb_build_object('reservations',(select count(*)from private.import_upload_reservations),
  'completions',(select count(*)from private.import_upload_completions),'recoveries',(select count(*)from private.import_upload_recoveries),
  'recoveryCompletions',(select count(*)from private.import_upload_recovery_completions),
  'locatorAudit',(select count(*)from public.audit_events where metadata->>'projection'='import_upload_operation_receipt_v1'),
  'clients',(select count(*)from public.clients),'plans',(select count(*)from public.authorized_care_plans),'careRecords',(select count(*)from public.care_records),
  'medications',(select count(*)from public.medication_administrations))`).trim());
 const freshClaims=(label,mode,jwtExpiry=false)=>{
  const session=uuid("locator-session:"+label),challenge=uuid("locator-challenge:"+label);
  const timing=JSON.parse(sql(`select jsonb_build_object('now',floor(extract(epoch from clock_timestamp()))::bigint,
   'oauth',floor(extract(epoch from clock_timestamp()-interval '3 minutes'))::bigint,
   'factor',floor(extract(epoch from clock_timestamp()-interval '30 seconds'))::bigint)`).trim());
  sql(`insert into auth.sessions(id,user_id,created_at,aal)values('${session}','${actor}',to_timestamp(${timing.oauth}-30),'${mode==="general"?"aal2":"aal1"}');
   insert into auth.mfa_amr_claims(id,session_id,created_at,updated_at,authentication_method)
    values('${uuid("locator-oauth:"+label)}','${session}',to_timestamp(${timing.oauth}),to_timestamp(${timing.oauth}),'oauth');
   ${mode==="general"?`insert into auth.mfa_amr_claims(id,session_id,created_at,updated_at,authentication_method)
    values('${uuid("locator-factor:"+label)}','${session}',to_timestamp(${timing.factor}),to_timestamp(${timing.factor}),'totp');
    insert into private.reauth_challenges(id,user_id,session_id,nonce_sha256,idempotency_key,issued_jwt_iat,created_at,expires_at,consumed_at,consumed_jwt_iat,factor_method,factor_verified_at)
    values('${challenge}','${actor}','${session}','${digest(label)}','${uuid("locator-nonce:"+label)}',to_timestamp(${timing.factor}-120),
      to_timestamp(${timing.factor}-60),to_timestamp(${timing.factor}+240),to_timestamp(${timing.factor}),to_timestamp(${timing.factor}),'totp',to_timestamp(${timing.factor}));
    insert into private.reauth_events(user_id,session_id,challenge_id,aal,verification_method,verified_at)
     values('${actor}','${session}','${challenge}','aal2','totp',to_timestamp(${timing.factor}));`:""}`);
  const expires=timing.now+(jwtExpiry?4:1800);
  return{session,expires,claims:{sub:actor,session_id:session,aud:"authenticated",role:"authenticated",aal:mode==="general"?"aal2":"aal1",
   email:"recovery1@care.example.invalid",is_anonymous:false,iat:timing.now,exp:expires,
   amr:[{method:"oauth",timestamp:timing.oauth},...(mode==="general"?[{method:"totp",timestamp:timing.factor}]:[])]}};
 };
 const pause=811731533;
 sql(`create function public.native_locator_audit_pause()returns trigger language plpgsql as $$begin
  if current_setting('application_name')='native_locator_audit_read'and new.metadata->>'projection'='import_upload_operation_receipt_v1'
  then perform pg_advisory_xact_lock(${pause});end if;return new;end$$;
  create trigger native_locator_audit_pause before insert on public.audit_events for each row execute function public.native_locator_audit_pause();`);
 const deadlineObserved=async epoch=>{
  const bound=Date.now()+10000;
  while(Date.now()<bound){const now=Number(sql("select extract(epoch from clock_timestamp())").trim());if(now>epoch)return now;await new Promise(done=>setTimeout(done,25));}
  throw new Error("Actual database JWT deadline did not pass within owned probe bound.");
 };
 const probes=[
  {mode:"routine-intake",event:"revoke"},{mode:"routine-intake",event:"session"},{mode:"routine-intake",event:"jwt"},
  {mode:"general",event:"revoke"},{mode:"general",event:"session"},{mode:"general",event:"jwt"},
  {mode:"routine-intake",event:"completion_appears"},{mode:"general",event:"completion_appears"},
  {mode:"routine-intake",event:"source_appears"},{mode:"routine-intake",event:"completion_content_changes"}
 ];
 for(const probe of probes){
  const label=probe.mode+":"+probe.event,key=uuid("locator-operation:"+label),sha=digest("locator-bytes:"+label),
   auth=freshClaims(label,probe.mode,probe.event==="jwt");
  let reservation;
  if(probe.event!=="source_appears")reservation=result(await concurrent(transaction(reserveCall(probe.mode,key,sha),"native_locator_prepare",auth.claims)));
  if(probe.event==="completion_content_changes")result(await concurrent(transaction(completeCall(reservation),"native_locator_prepare_complete",{role:"service_role"},"service_role")));
  const before=counts(),holder=await hold(`select pg_advisory_xact_lock(${pause})`);
  const pending=concurrent(transaction(readCall(key,probe.mode),"native_locator_audit_read",auth.claims));
  const waits=await blocked(["native_locator_audit_read"],holder.pid);
  let actualClock=null;
  if(probe.event==="revoke")sql(`update public.memberships set status='suspended'where id='${membership}'`);
  else if(probe.event==="session")sql(`update auth.sessions set not_after=clock_timestamp()-interval '1 second'where id='${auth.session}'`);
  else if(probe.event==="jwt")actualClock=await deadlineObserved(auth.expires);
  else if(probe.event==="completion_appears")result(await concurrent(transaction(completeCall(reservation),"native_locator_independent_worker",{role:"service_role"},"service_role")));
  else if(probe.event==="source_appears")result(await concurrent(transaction(reserveCall(probe.mode,key,sha),"native_locator_independent_reserve",auth.claims)));
  else sql(`begin;alter table private.import_upload_completions disable trigger import_upload_completion_immutable;
   update private.import_upload_completions set parsed_payload=jsonb_set(parsed_payload,'{fields,0,rawValue}','"SYNTHETIC_CHANGED_LOCATOR_CONTENT"')where id='${reservation.reservation_id}';
   alter table private.import_upload_completions enable trigger import_upload_completion_immutable;commit;`);
  const afterIndependent=counts();assert.equal(afterIndependent.locatorAudit,before.locatorAudit,"B must not create the pending actor read audit");
  await holder.release();const output=await pending,code=probe.event.endsWith("appears")||probe.event==="completion_content_changes"?"40001":"42501";
  denied(output,code);assert.deepEqual(counts(),afterIndependent,"Aborted locator returns no stale source and rolls back only its own audit");
  if(probe.event==="revoke")sql(`update public.memberships set status='active'where id='${membership}'`);
  for(const field of["clients","plans","careRecords","medications","recoveries","recoveryCompletions"])assert.equal(afterIndependent[field],before[field]);
  evidence.probes.push({name:label,waiters:waits,holderPid:holder.pid,sqlstate:code,noResultDisclosed:true,ownAuditRolledBack:true,
   countsBefore:before,countsAfterIndependent:afterIndependent,countsAfter:counts(),actualJwtDeadline:probe.event==="jwt"?auth.expires:null,
   actualDatabaseClockAfterDeadline:actualClock,authPredicateReplacement:false,formalBusinessWrites:0});
  console.log(`153 GREEN: ${label} (${code})`);
 }
 const lookupKey=uuid("locator-positive-original"),sha=digest("locator-positive-bytes"),original=freshClaims("locator-positive-original","routine-intake"),
  current=freshClaims("locator-positive-current","routine-intake");
 const reservation=result(await concurrent(transaction(reserveCall("routine-intake",lookupKey,sha),"native_locator_positive_reserve",original.claims)));
 const receipt=result(await concurrent(transaction(completeCall(reservation),"native_locator_positive_complete",{role:"service_role"},"service_role")));
 sql(`update auth.sessions set not_after=clock_timestamp()-interval '1 second'where id='${original.session}'`);
 const before=counts(),projection=result(await concurrent(transaction(readCall(lookupKey,"routine-intake"),"native_locator_positive_read",current.claims)));
 assert.equal(projection.original_operation_id,lookupKey);assert.equal(projection.reservation_id,reservation.reservation_id);assert.equal(projection.status,"completed");
 assert.deepEqual(projection.receipt,{...receipt,replayed:false});assert.equal(projection.created_at,reservation.created_at);
 assert.equal(projection.formally_imported,false);assert.equal(projection.staging_only,true);
 assert.doesNotMatch(JSON.stringify(projection),/SYNTHETIC_LOCATOR_SECRET|parsed_payload|archive_reference|authorization_claims/u);
 const after=counts();assert.deepEqual({...after,locatorAudit:before.locatorAudit},before);assert.equal(after.locatorAudit,before.locatorAudit+1);
 evidence.positiveRead={originalSessionExpired:true,newActualGoogleAal1:true,exactOriginalKeyAndReceipt:true,sourceContentExcluded:true,uploadArchiveOrCompletionWrites:0,
  newRecoveryRows:0,formalBusinessWrites:0,selectAuditCount:1};
 for(const m of evidence.migrations)assert.equal(digest(await readFile(join(root,"supabase/migrations",m.name))),m.sha256,"Migration changed during real native verification");
 for(const s of evidence.sharedSources)assert.equal(digest(await readFile(join(root,s.name))),s.sha256,"Shared fixture/bootstrap/cleanup source changed");
 assert.equal(digest(await readFile(testPath)),evidence.testSha256);assert.equal(digest(await readFile(import.meta.filename)),evidence.runnerSha256);
 evidence.sourceHashCount=evidence.migrations.length+evidence.sharedSources.length+2;
 evidence.limitations=["Native synthetic Auth and archive reference only; no hosted WORM/production HTTP/UI proof",
  "Source hash binds stored original serialized-TEXT hash to immutable receipt; JSONB cannot reproduce original byte spelling",
  "Listed independent-backend audit races only, not a proof of universal transaction serialization or formal client promotion"];
 console.log(`${engine}; exact153migrations; ${passed}/${expected}pgTAP; ${probes.length}actualauditwaitprobes; ${join(runtime,"evidence.json")}`);
}catch(error){testFailure=error;throw error;}
finally{
 const errors=[];
 for(const holder of[...holders]){try{await holder.release();}catch(error){errors.push(error);}}
 for(const child of children)child.kill("SIGTERM");
 for(const child of[...children]){let timer;try{await Promise.race([childCompletions.get(child),new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error("Owned client did not stop")),5000);})]);}
 catch(error){errors.push(error);}finally{clearTimeout(timer);}}
 if(testFailure)await writeFile(join(runtime,"failure.json"),JSON.stringify({syntheticOnly:true,error:testFailure.message,evidence},null,2));
 let stopped=false;const cleanup=await cleanupNativeData({started,testFailure,cleanupErrors:errors,stop:()=>{run(join(binaries,"pg_ctl"),["-D",data,"-m","fast","-w","stop"]);stopped=true;}});
 evidence.cleanup={ownedClusterStopped:stopped,ownedClientProcessesRemaining:children.size,ownedLockHoldersRemaining:holders.size,dataStatus:cleanup.status,logsAndEvidenceRetained:true};
 await writeFile(join(runtime,testFailure?"failure-cleanup.json":"evidence.json"),JSON.stringify(evidence,null,2));
}
