// Real PostgreSQL / Unix socket / synthetic approved Google identities only.
// Authorization predicates and immutable business guards are never replaced.
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { readFile, readdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { bootstrapSql } from "./lib/pglite-bootstrap.mjs";
import { createNativeTestRuntime } from "./lib/native-test-cleanup.mjs";

const root = resolve(import.meta.dirname, "..");
const binaries = process.env.INTAKE_NATIVE_PG_BIN;
if (!binaries?.startsWith("/")) throw new Error("Set INTAKE_NATIVE_PG_BIN to an absolute PostgreSQL 17 bin directory. No hosted URL is accepted.");
const { runtime, data, cleanupNativeData } = await createNativeTestRuntime("/tmp/daycare-social-work-admission-native.");
const env = { PATH: process.env.PATH, LANG: "en_US.UTF-8", LC_ALL: "en_US.UTF-8", PGHOST: runtime, PGPORT: "55471", PGUSER: "postgres", PGDATABASE: "postgres", PGCONNECT_TIMEOUT: "5" };
const args = ["-X", "-q", "-A", "-t", "-v", "ON_ERROR_STOP=1", "-v", "VERBOSITY=verbose"];
const execute = (file, argv, input) => spawnSync(file, argv, { cwd: root, env, input, encoding: "utf8", maxBuffer: 32 * 1024 * 1024, timeout: 120_000 });
const run = (file, argv, input) => {
  const result = execute(file, argv, input);
  if (result.error || result.status !== 0) throw new Error(`${file.split("/").at(-1)} failed: ${result.error?.message ?? result.stderr}`);
  return result.stdout;
};
const sql = (input) => run(join(binaries, "psql"), args, input);
const quote = (value) => value === null || value === undefined ? "null" : `'${String(value).replaceAll("'", "''")}'`;
const marker = (output, name) => { const row = output.split("\n").find((line) => line.startsWith(`${name}=`)); assert.ok(row, `Missing ${name}`); return row.slice(name.length + 1); };
const concurrent = (input) => new Promise((resolveResult) => {
  const child = spawn(join(binaries, "psql"), args, { cwd: root, env });
  let stdout = ""; let stderr = "";
  child.stdout.on("data", (chunk) => { stdout += chunk; }); child.stderr.on("data", (chunk) => { stderr += chunk; });
  child.on("error", (error) => resolveResult({ status: -1, stdout, stderr: error.message }));
  child.on("close", (status) => resolveResult({ status, stdout, stderr })); child.stdin.end(input);
});
const holders = new Set();
const hold = async (statement) => {
  const child = spawn(join(binaries, "psql"), args, { cwd: root, env });
  let resolveReady; let rejectReady; let stdout = ""; let stderr = ""; let released = false;
  const ready = new Promise((a, b) => { resolveReady = a; rejectReady = b; });
  const completion = new Promise((resolveCompletion) => {
    child.stdout.on("data", (chunk) => { stdout += chunk; if (/^READY=\d+$/m.test(stdout)) resolveReady(Number(marker(stdout, "READY"))); });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", (error) => { rejectReady(error); resolveCompletion(-1); });
    child.on("close", (status) => { rejectReady(new Error("Owned lock holder ended before readiness.")); resolveCompletion(status); });
  });
  const holder = { release: async () => { if (released) return; released = true; child.stdin.end("commit;\n"); const status = await completion; holders.delete(holder); assert.equal(status, 0, stderr); } };
  holders.add(holder); const timer = setTimeout(() => rejectReady(new Error("Owned lock readiness timed out.")), 10_000);
  child.stdin.write(`begin;${statement};select 'READY='||pg_backend_pid();\n`);
  try { holder.pid = await ready; return holder; } finally { clearTimeout(timer); }
};
const waitForBlocked = async (name, count = 1) => {
  assert.match(name, /^native_social_[a-z_]+$/); const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const rows = JSON.parse(sql(`select coalesce(jsonb_agg(jsonb_build_object('pid',pid,'name',application_name,'blockers',pg_blocking_pids(pid))),'[]'::jsonb) from pg_stat_activity where application_name=${quote(name)} and wait_event_type='Lock' and cardinality(pg_blocking_pids(pid))>0;`).trim());
    if (rows.length === count && new Set(rows.map((row) => row.pid)).size === count) return rows;
    await new Promise((resume) => setTimeout(resume, 25));
  }
  throw new Error(`Expected ${count} genuinely blocked independent backends: ${name}`);
};
const waitForDatabase = async (predicate) => {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) { if (sql(`select (${predicate});`).trim() === "t") return; await new Promise((resume) => setTimeout(resume, 25)); }
  throw new Error("Wall-clock database boundary was not observed.");
};
const receipt = (result) => { assert.equal(result.status, 0, result.stderr); return JSON.parse(marker(result.stdout, "RECEIPT")); };
const denied = (result, state = "42501") => { assert.notEqual(result.status, 0); assert.match(result.stderr, new RegExp(state)); assert.doesNotMatch(result.stdout, /^RECEIPT=/m); };
const probes = [];
const org = "dc500000-0000-4000-8000-000000000001";
const branch = "dc600000-0000-4000-8000-000000000001";
const actor = "dc100000-0000-4000-8000-000000000001";
const session = "dc300000-0000-4000-8000-000000000001";
const client = "dcb00000-0000-4000-8000-000000000001";
const assignment = "dcc00000-0000-4000-8000-000000000001";
const key = (n) => `dcd00000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const counts = () => JSON.parse(sql(`select jsonb_build_object(
 'psVersions',(select count(*) from public.psychosocial_assessment_versions),'psOperations',(select count(*) from private.psychosocial_assessment_operations),
 'swVersions',(select count(*) from public.social_work_service_record_versions),'swOperations',(select count(*) from private.social_work_record_operations),
 'followEvents',(select count(*) from public.social_work_follow_up_events),'followOperations',(select count(*) from private.social_work_follow_up_operations),
 'audits',(select count(*) from public.audit_events where action<>'select' and table_name in('public.psychosocial_assessment_versions','public.social_work_service_record_versions','public.social_work_follow_up_events','psychosocial_assessment_versions','social_work_service_record_versions','social_work_follow_up_events')))::text;`).trim());
let started = false; let testFailure;
try {
  const engine = run(join(binaries, "postgres"), ["--version"]).trim(); assert.match(engine, /PostgreSQL\) 17\./);
  run(join(binaries, "initdb"), ["-D", data, "-U", "postgres", "--auth-local=trust", "--auth-host=reject", "--no-locale", "--encoding=UTF8"]);
  run(join(binaries, "pg_ctl"), ["-D", data, "-l", join(runtime, "server.log"), "-o", `-k ${runtime} -p ${env.PGPORT} -c listen_addresses='' -c statement_timeout=60000`, "-w", "start"]); started = true;
  sql(bootstrapSql);
  sql(`create schema storage;create table storage.buckets(id text primary key,name text not null,public boolean not null default false,file_size_limit bigint,allowed_mime_types text[]);
    create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text not null references storage.buckets(id),name text not null);
    alter table storage.objects enable row level security;grant usage on schema storage to anon,authenticated,service_role;grant all on storage.objects to anon,authenticated,service_role;`);
  const migrations = (await readdir(join(root, "supabase/migrations"))).filter((name) => name.endsWith(".sql")).sort();
  const admissionMigrations = migrations.filter((name) => name.endsWith("_social_work_approved_staff_admission.sql")); assert.equal(admissionMigrations.length, 1);
  const newMigration = admissionMigrations[0];
  // Later migrations can depend on this additive careModule. Historical RED uses
  // only its predecessors; latest GREEN then compiles the remainder in order.
  for (const name of migrations.filter((name) => name < newMigration)) sql(await readFile(join(root, "supabase/migrations", name), "utf8"));
  sql(await readFile(join(root, "supabase/seed.sql"), "utf8"));
  sql(run("/usr/bin/tar", ["-xOf", join(root, "node_modules/@electric-sql/pglite/dist/pgtap.tar.gz"), "share/postgresql/extension/pgtap--1.3.5.sql"]));
  const source = await readFile(join(root, "supabase/tests/social_work_approved_staff_admission.test.sql"), "utf8");
  const boundary = source.indexOf("\nselect ok("); assert.ok(boundary > 0);
  const fixture = source.slice(0, boundary).replace(/select\s+plan\(\d+\);/i, "");

  const snapshots = {
    ps: `public.psychosocial_assessment_snapshot('${org}','${branch}',null,null,null,'all')`,
    sw: `public.social_work_service_snapshot('${org}','${branch}',null,null,null,null,null)`,
  };
  for (const careModule of ["ps","sw"]) {
    const baseline = execute(join(binaries,"psql"),args,`${fixture}\nselect pg_temp.referral_login(1);set local role authenticated;
      select 'ADMITTED='||public.is_staff_login_allowed();select * from ${snapshots[careModule]};rollback;`);
    assert.match(baseline.stdout,/^ADMITTED=true$/m);denied(baseline);assert.match(baseline.stderr,/snapshot is not permitted/);
  }
  console.log("Baseline RED: genuinely approved non-CEO social worker denied Pages 28/29 (42501).");
  for (const name of migrations.filter(name=>name>=newMigration)) sql(await readFile(join(root,"supabase/migrations",name),"utf8"));
  const expected=Number(source.match(/select\s+plan\((\d+)\)/i)?.[1]);assert.ok(expected>0);
  const output=sql(source);const actual=output.split("\n").filter(line=>/^ok \d+\b/.test(line)).length;
  assert.equal(actual,expected);assert.doesNotMatch(output,/^not ok \d+\b|^# Looks like/m);
  console.log(`Latest-schema native GREEN: ${migrations.length} exact migrations, ${actual}/${expected} pgTAP assertions.`);
  const setup=sql(`${fixture}\nselect pg_temp.referral_login(1);select 'JWT='||current_setting('request.jwt.claims');
   select 'DATE='||current_date-1;commit;`);
  let jwt=marker(setup,"JWT");const claims=JSON.parse(jwt);const date=marker(setup,"DATE");
  const authenticated=(body,name="native_social_control",claim=jwt)=>{
   assert.match(name,/^native_social_[a-z_]+$/);
   return `begin;set local time zone 'Asia/Taipei';set local application_name=${quote(name)};select set_config('request.jwt.claims',${quote(claim)},true);set local role authenticated;${body};commit;`;
  };
  const dimensions=JSON.stringify({family_relationships:{state:"provided",detail:"Synthetic family evidence"},social_support:{state:"missing",detail:null},
   social_participation:{state:"not_applicable",detail:null},communication_context:{state:"provided",detail:"Synthetic communication evidence"},resource_access:{state:"missing",detail:null}});
  const mutation=(careModule,action,operationKey,source=null,content="Synthetic human social assessment")=>{
   const chain=careModule==="ps"?"assessment_key":"record_key";const version=careModule==="ps"?"assessment_version":"record_version";
   const common=[quote(org),quote(branch),quote(client)];const sourceArgs=source?[quote(source[chain]),quote(source.version_id),source[version]]:[];
   const psContent=[quote(date),`(${quote(date)}::date+31)`,quote("Synthetic human reassessment scheduling"),`${quote(dimensions)}::jsonb`,quote(content),quote("manual-psychosocial-v1")];
   const swContent=[`${quote(date+"T00:00:00+08:00")}::timestamptz`,quote("Synthetic social service"),quote(content),quote("Synthetic human service outcome")];
   const names=careModule==="ps"?{create:"create_psychosocial_assessment_draft",revise:"revise_psychosocial_assessment_draft",sign:"sign_psychosocial_assessment",correct:"correct_psychosocial_assessment"}:
    {create:"create_social_work_service_draft",revise:"revise_social_work_service_draft",sign:"sign_social_work_service_record",correct:"correct_social_work_service_record"};
   const args=[...common,...sourceArgs,...(action==="sign"?[]:careModule==="ps"?psContent:swContent),...(action==="correct"?[quote("Synthetic correction evidence")]:[]),quote(operationKey)];
   return `select 'RECEIPT='||row_to_json(result)::text from public.${names[action]}(${args.join(",")}) result`;
  };
  const write=(name,careModule,action,operationKey,source=null,content)=>concurrent(authenticated(mutation(careModule,action,operationKey,source,content),name));
  const operationPrefix={ps:"psychosocial-operation",sw:"social-work-record-operation"};
  const streamPrefix={ps:"psychosocial-chain",sw:"social-work-record-chain"};
  assert.equal(marker(sql(authenticated("select 'BEGIN='||public.can_begin_staff_mfa()","native_social_begin",JSON.stringify({...claims,aal:"aal1"}))),"BEGIN"),"true");
  const issue = (n) => { const challenge = `dc800000-0000-4000-8000-${String(n).padStart(12, "0")}`;
    const nonceHash = n.toString(16).padStart(64, "0");
    sql(`begin;set local role service_role;select * from public.issue_aal2_reauth_challenge('${challenge}','${actor}','${session}','${nonceHash}','${key(900 + n)}',clock_timestamp()-interval '60 seconds','synthetic-before',300);commit;`);
    const timestamp = Number(sql("select floor(extract(epoch from clock_timestamp()));").trim());
    sql(`update auth.mfa_amr_claims set updated_at=to_timestamp(${timestamp}) where session_id='${session}' and authentication_method='totp';`);
    jwt = JSON.stringify({ ...claims, iat: timestamp, amr: claims.amr.map((entry) => entry.method === "totp" ? { ...entry, timestamp } : entry) });
    return { challenge, timestamp, body: `select public.record_aal2_reauth('${challenge}','${nonceHash}')` };
  };
  const acquired = issue(99);
  assert.equal(sql(authenticated(acquired.body)).trim().split("\n").at(-1), "t");
  const proof = JSON.parse(marker(sql(authenticated(`select 'EVIDENCE='||public.social_work_recent_aal2_evidence('${org}','${branch}')::text`)), "EVIDENCE"));
  assert.deepEqual(Object.keys(proof).sort(), ["actorUserId", "branchId", "organizationId", "verifiedAt"]);
  assert.equal(proof.actorUserId, actor); assert.equal(Date.parse(proof.verifiedAt), acquired.timestamp * 1000);
  assert.deepEqual(JSON.parse(marker(sql(authenticated("select 'GENERIC='||jsonb_build_object('active',private.is_active_user(),'recent',public.has_recent_aal2(15))::text")), "GENERIC")), { active: false, recent: false });
  assert.equal(sql(authenticated(acquired.body)).trim().split("\n").at(-1), "f");



  const chains={};
  for (const [index,careModule] of ["ps","sw"].entries()) {
    const base=index*10+1;const name=`native_social_${careModule}_same_key`;
    const held=await hold(`select pg_advisory_xact_lock(hashtextextended('${operationPrefix[careModule]}:${actor}:${key(base)}',0))`);
    const a=write(name,careModule,"create",key(base));const b=write(name,careModule,"create",key(base));
    try{probes.push({name:`${careModule}_same_key_two_independent_backends`,waiters:await waitForBlocked(name,2)});}finally{await held.release();}
    const results=[receipt(await a),receipt(await b)];assert.equal(results[0].version_id,results[1].version_id);
    assert.deepEqual(results.map(x=>x.replayed).sort(),[false,true]);let last=results[0];const first=last;
    denied(await write(`native_social_${careModule}_wrong_body`,careModule,"create",key(base),null,"Changed synthetic payload"),"23505");
    const chainKey=careModule==="ps"?"assessment_key":"record_key";const versionKey=careModule==="ps"?"assessment_version":"record_version";
    const stream=await hold(`select pg_advisory_xact_lock(hashtextextended('${streamPrefix[careModule]}:${org}:${branch}:${last[chainKey]}',0))`);
    const reviseName=`native_social_${careModule}_same_predecessor`;
    const revisions=[write(reviseName,careModule,"revise",key(base+1),last),write(reviseName,careModule,"revise",key(base+5),last)];
    try{probes.push({name:`${careModule}_different_keys_same_predecessor_one_success`,waiters:await waitForBlocked(reviseName,2)});}finally{await stream.release();}
    const revised=await Promise.all(revisions);assert.equal(revised.filter(x=>x.status===0).length,1);const winner=revised.findIndex(x=>x.status===0);
    denied(revised[1-winner],"40001");const draft=receipt(revised[winner]);assert.equal(draft[versionKey],2);
    last=receipt(await write(`native_social_${careModule}_sign`,careModule,"sign",key(base+2),draft));assert.equal(last[versionKey],3);
    const signed=last;last=receipt(await write(`native_social_${careModule}_correct`,careModule,"correct",key(base+3),last));assert.equal(last[versionKey],4);
    assert.equal(receipt(await write(`native_social_${careModule}_replay_sign`,careModule,"sign",key(base+2),draft)).version_id,signed.version_id);
    chains[careModule]={first,draft,signed,corrected:last,base};
  }
  const follow=(action,n,sequence)=>`select 'RECEIPT='||row_to_json(result)::text from public.mutate_social_work_follow_up(
    ${quote(action)},'${org}','${branch}','${client}','${chains.sw.corrected.record_key}','${chains.sw.corrected.version_id}',${sequence},
    ${action==="track"?`(${quote(date)}::date+4)`:"null"},${action==="track"?quote("Synthetic follow-up plan"):"null"},
    ${action==="complete_follow_up"?quote("Synthetic human follow-up result"):"null"},${action==="cancel_follow_up"?quote("Synthetic cancellation evidence"):"null"},'${key(n)}') result`;
  for(const [i,action]of["track","complete_follow_up","track","cancel_follow_up"].entries()){
    const result=receipt(await concurrent(authenticated(follow(action,31+i,i))));assert.equal(result.follow_up_sequence,i+1);
  }
  const expectedCounts=counts();assert.equal(expectedCounts.psVersions,4);assert.equal(expectedCounts.swVersions,4);assert.equal(expectedCounts.psOperations,4);assert.equal(expectedCounts.swOperations,4);assert.equal(expectedCounts.followEvents,4);assert.equal(expectedCounts.followOperations,4);
  for(const careModule of["ps","sw"])for(const [name,revoke,restore]of[
   ["grant",`update private.staff_google_access_grants set enabled=false where allowed_user_id='${actor}'`,`update private.staff_google_access_grants set enabled=true where allowed_user_id='${actor}'`],
   ["session",`update auth.sessions set not_after=clock_timestamp()-interval '1 minute' where id='${session}'`,`update auth.sessions set not_after=null where id='${session}'`],
   ["assignment",`update public.client_assignments set ends_at=clock_timestamp()-interval '1 minute' where id='${assignment}'`,`update public.client_assignments set ends_at=null where id='${assignment}'`],
  ]){
   const held=await hold(`select pg_advisory_xact_lock(hashtextextended('${operationPrefix[careModule]}:${actor}:${key(chains[careModule].base)}',0))`);
   const app=`native_social_${careModule}_revoke_${name}`;const pending=write(app,careModule,"create",key(chains[careModule].base));
   try{probes.push({name:`${careModule}_${name}_revoked_during_original_key_wait`,waiters:await waitForBlocked(app)});sql(revoke+";");}finally{await held.release();}
   denied(await pending);assert.deepEqual(counts(),expectedCounts);sql(restore+";");
  }
  sql(`create schema native_social_test;`);
  for(const [index,careModule]of["ps","sw"].entries()){
   const table=careModule==="ps"?"psychosocial_assessment_versions":"social_work_service_record_versions";
   sql(`create function native_social_test.pause_${careModule}_write()returns trigger language plpgsql set search_path='' as $$begin
    if new.table_name='public.${table}' then perform pg_advisory_xact_lock(hashtextextended('native-social-write-pause',0));end if;return new;end;$$;
    create trigger native_social_pause_write before insert on public.audit_events for each row execute function native_social_test.pause_${careModule}_write();`);
   const held=await hold("select pg_advisory_xact_lock(hashtextextended('native-social-write-pause',0))");const app=`native_social_${careModule}_post_version`;
   const pending=write(app,careModule,"create",key(50+index));
   try{probes.push({name:`${careModule}_assignment_revoked_after_clinical_version_insert`,waiters:await waitForBlocked(app)});sql(`update public.client_assignments set ends_at=clock_timestamp()-interval '1 minute' where id='${assignment}';`);}finally{await held.release();}
   denied(await pending);assert.deepEqual(counts(),expectedCounts);
   sql(`update public.client_assignments set ends_at=null where id='${assignment}';drop trigger native_social_pause_write on public.audit_events;`);
   sql(`create function native_social_test.pause_${careModule}_read()returns trigger language plpgsql set search_path='' as $$begin
    if new.action='select' and new.table_name='${table}' then perform pg_advisory_xact_lock(hashtextextended('native-social-read-pause',0));end if;return new;end;$$;
    create trigger native_social_pause_read before insert on public.audit_events for each row execute function native_social_test.pause_${careModule}_read();`);
   const before=sql(`select count(*) from public.audit_events where action='select' and table_name='${table}';`).trim();
   const readHeld=await hold("select pg_advisory_xact_lock(hashtextextended('native-social-read-pause',0))");const readApp=`native_social_${careModule}_snapshot`;
   const pendingRead=concurrent(authenticated(`select 'READ='||row_to_json(result)::text from ${snapshots[careModule]}result`,readApp));
   try{probes.push({name:`${careModule}_assignment_revoked_during_complete_snapshot_audit`,waiters:await waitForBlocked(readApp)});sql(`update public.client_assignments set ends_at=clock_timestamp()-interval '1 minute' where id='${assignment}';`);}finally{await readHeld.release();}
   const rejected=await pendingRead;denied(rejected);assert.doesNotMatch(rejected.stdout,/^READ=/m);
   assert.equal(sql(`select count(*) from public.audit_events where action='select' and table_name='${table}';`).trim(),before);assert.deepEqual(counts(),expectedCounts);
   sql(`update public.client_assignments set ends_at=null where id='${assignment}';drop trigger native_social_pause_read on public.audit_events;`);
  }
  for(const [index,careModule]of["ps","sw"].entries()){
   const nearExpiry=Number(sql("select floor(extract(epoch from clock_timestamp()-interval '898 seconds'));").trim());const originalJwt=jwt;
   const expiryChallenge=`dc800000-0000-4000-8000-${String(96+index).padStart(12,"0")}`;
   sql(`insert into private.reauth_challenges(id,user_id,session_id,nonce_sha256,idempotency_key,issued_jwt_iat,issued_jwt_jti,created_at,expires_at,consumed_at,consumed_jwt_iat,consumed_jwt_jti,factor_method,factor_verified_at)
    values('${expiryChallenge}','${actor}','${session}',repeat('${index===0?'e':'d'}',64),'${key(996+index)}',to_timestamp(${nearExpiry}-2),'synthetic-old',to_timestamp(${nearExpiry}-1),to_timestamp(${nearExpiry}+300),to_timestamp(${nearExpiry}),to_timestamp(${nearExpiry}),'synthetic-new','totp',to_timestamp(${nearExpiry}));
    update private.reauth_events set challenge_id='${expiryChallenge}',verified_at=to_timestamp(${nearExpiry}) where user_id='${actor}';
    update auth.mfa_amr_claims set updated_at=to_timestamp(${nearExpiry}) where session_id='${session}' and authentication_method='totp';`);
   jwt=JSON.stringify({...JSON.parse(jwt),amr:JSON.parse(jwt).amr.map(e=>e.method==="totp"?{...e,timestamp:nearExpiry}:e)});
   const held=await hold(`select id from private.reauth_challenges where id='${expiryChallenge}' for update`);
   const app=`native_social_${careModule}_evidence_expiry`;const pending=write(app,careModule,"sign",key(chains[careModule].base+2),chains[careModule].draft);
   try{probes.push({name:`${careModule}_verification_expires_during_real_challenge_lock_wait`,waiters:await waitForBlocked(app)});await waitForDatabase(`clock_timestamp()>to_timestamp(${nearExpiry})+interval '15 minutes'`);}finally{await held.release();}
   denied(await pending);assert.deepEqual(counts(),expectedCounts);
   sql(`update private.reauth_events set challenge_id='${acquired.challenge}',verified_at=to_timestamp(${acquired.timestamp}) where user_id='${actor}';update auth.mfa_amr_claims set updated_at=to_timestamp(${acquired.timestamp}) where session_id='${session}' and authentication_method='totp';`);jwt=originalJwt;
  }

  sql(`create function native_social_test.pause_reauth()returns trigger language plpgsql set search_path='' as $$begin
   if new.user_id='${actor}'::uuid then perform pg_advisory_xact_lock(hashtextextended('native-social-mfa-pause',0));end if;return new;end;$$;
   create trigger native_social_pause_reauth after insert or update on private.reauth_events for each row execute function native_social_test.pause_reauth();`);
  const setPermission=(permission,effective)=>sql(`update public.role_permissions set granted_at=clock_timestamp()+interval '${effective?"-1 minute":"1 hour"}'
   where role_id in(select id from public.roles where role_key='case_manager_social_worker' and is_system) and permission_id in(select id from public.permissions where permission_key=${quote(permission)});`);
  const eligibility=()=>JSON.parse(sql(`begin;select set_config('request.jwt.claims',${quote(jwt)},true);select jsonb_build_object(
   'executive',private.is_executive_login_allowed(),'custom',private.has_any_custom_governance_scope(),'nursing',private.has_any_nursing_mfa_scope(),
   'referral',private.has_any_referral_mfa_scope(),'social_work',private.has_any_social_work_mfa_scope())::text;commit;`).trim().split("\n").at(-1));
  // Capture the eligible module AFTER acquiring the actual challenge row lock,
  // not from a stale pre-lock check. Initially only social work is effective;
  // during the wait only referral becomes effective, which is the selected path.
  setPermission("social_work_records.sign",true);setPermission("referral_management.read",false);
  const lockFresh=issue(105);
  const challengeHeld=await hold(`select id from private.reauth_challenges where id='${lockFresh.challenge}' for update`);
  const afterLock=concurrent(authenticated(lockFresh.body,"native_social_selection_after_challenge_lock"));
  try{
   probes.push({name:"MFA_module_selected_after_real_challenge_lock",waiters:await waitForBlocked("native_social_selection_after_challenge_lock")});
   setPermission("social_work_records.sign",false);setPermission("referral_management.read",true);
  }finally{await challengeHeld.release();}
  const afterLockResult=await afterLock;assert.equal(afterLockResult.status,0,afterLockResult.stderr);assert.equal(afterLockResult.stdout.trim().split("\n").at(-1),"t");
  assert.equal(sql(`select consumed_at is not null from private.reauth_challenges where id='${lockFresh.challenge}';`).trim(),"t");
  assert.equal(sql(authenticated(`select public.social_work_recent_aal2_evidence('${org}','${branch}') is null`)).trim().split("\n").at(-1),"t");
  assert.equal(Date.parse(marker(sql(authenticated(`select 'REFERRAL='||(public.referral_recent_aal2_evidence('${org}','${branch}')->>'verifiedAt')`)),"REFERRAL")),Date.parse(sql(`select factor_verified_at from private.reauth_challenges where id='${lockFresh.challenge}';`).trim()));
  for(const[index,path]of["social_work","referral"].entries()){
   const socialFirst=path==="social_work";setPermission("social_work_records.sign",socialFirst);setPermission("referral_management.read",!socialFirst);
   assert.deepEqual(eligibility(),{executive:false,custom:false,nursing:false,referral:!socialFirst,social_work:socialFirst});
   const fresh=issue(100+index);const prior=sql(`select challenge_id from private.reauth_events where user_id='${actor}' and session_id='${session}';`).trim();
   const held=await hold("select pg_advisory_xact_lock(hashtextextended('native-social-mfa-pause',0))");const app=`native_social_selected_${path}`;
   const pending=concurrent(authenticated(fresh.body,app));
   try{probes.push({name:`selected_${path}_revoked_after_evidence_insert_without_fallthrough`,waiters:await waitForBlocked(app)});
    setPermission("social_work_records.sign",!socialFirst);setPermission("referral_management.read",socialFirst);
    assert.deepEqual(eligibility(),{executive:false,custom:false,nursing:false,referral:socialFirst,social_work:!socialFirst});
   }finally{await held.release();}
   denied(await pending);assert.equal(sql(`select consumed_at is null from private.reauth_challenges where id='${fresh.challenge}';`).trim(),"t");
   assert.equal(sql(`select challenge_id from private.reauth_events where user_id='${actor}' and session_id='${session}';`).trim(),prior);assert.deepEqual(counts(),expectedCounts);
  }
  setPermission("social_work_records.sign",true);setPermission("referral_management.read",true);
  // Admission can disappear after the challenge was consumed and its event
  // written. Observe that actual boundary; the whole MFA transaction must
  // roll back, including both terminal evidence and the previous receipt.
  for (const [index, [name, revoke, restore]] of [
    ["grant", `update private.staff_google_access_grants set enabled=false where allowed_user_id='${actor}'`, `update private.staff_google_access_grants set enabled=true where allowed_user_id='${actor}'`],
    ["session", `update auth.sessions set not_after=clock_timestamp()-interval '1 minute' where id='${session}'`, `update auth.sessions set not_after=null where id='${session}'`],
  ].entries()) {
    const fresh = issue(102 + index);
    const originalEvidence = sql(`select row_to_json(result)::text from private.reauth_events result where user_id='${actor}' and session_id='${session}';`).trim();
    const mfaHolder = await hold("select pg_advisory_xact_lock(hashtextextended('native-social-mfa-pause',0))");
    const mfaWrite = concurrent(authenticated(fresh.body, `native_social_mfa_${name}`));
    try {
      probes.push({ name: `${name}_revoked_after_mfa_event_insert`, waiters: await waitForBlocked(`native_social_mfa_${name}`) });
      sql(`${revoke};`);
    } finally { await mfaHolder.release(); }
    denied(await mfaWrite);
    assert.equal(sql(`select consumed_at is null from private.reauth_challenges where id='${fresh.challenge}';`).trim(), "t");
    assert.equal(sql(`select row_to_json(result)::text from private.reauth_events result where user_id='${actor}' and session_id='${session}';`).trim(), originalEvidence);
    assert.deepEqual(counts(), expectedCounts);
    sql(`${restore};`);
  }
  sql("drop trigger native_social_pause_reauth on private.reauth_events;");
  await writeFile(join(runtime,"evidence.json"),JSON.stringify({engine,migrations:migrations.length,pgTapAssertions:actual,
   baseline:{approvedSocialWorker:true,psychosocialSnapshotSqlState:"42501",socialWorkSnapshotSqlState:"42501"},probes,finalCounts:counts(),
   mfaAcquisition:true,scopedEvidence:proof,authPredicateReplacements:0,externalConnections:0,hostedVerification:false,httpLoadTest:false},null,2));
  console.log(`Native social-work admission: RED/GREEN, genuine MFA/full workflows and ${probes.length} observed independent-backend probes. Evidence: ${runtime}/evidence.json`);
} catch (error) {
  testFailure = error;
  throw error;
} finally {
  const cleanupErrors = []; for (const holder of holders) { try { await holder.release(); } catch (error) { cleanupErrors.push(error); } }
  await cleanupNativeData({ started, testFailure, cleanupErrors, stop: () => run(join(binaries, "pg_ctl"), ["-D", data, "-m", "fast", "-w", "stop"]) });
}
