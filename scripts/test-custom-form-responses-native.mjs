// Native PostgreSQL validation in a disposable local cluster. Never accepts a URL
// or connects to a hosted database. Auth and Storage schemas are synthetic fixtures.
// Run: CUSTOM_FORM_NATIVE_PG_BIN=/absolute/postgres/bin node scripts/test-custom-form-responses-native.mjs
// Scope: compile migrations; run SQL assertions; observe duplicate-key, shared-base,
// assignment-revoked-during-lock-wait races for writes and receipt replays, and
// final audit-lock checks for reads, writes and expiring signature evidence.
import { spawn, spawnSync } from "node:child_process";
import { mkdtemp, readFile, readdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { bootstrapSql } from "./lib/pglite-bootstrap.mjs";

const root = resolve(import.meta.dirname, "..");
const binaries = process.env.CUSTOM_FORM_NATIVE_PG_BIN ?? process.env.INTAKE_NATIVE_PG_BIN;
if (!binaries || !binaries.startsWith("/")) {
  throw new Error("Set CUSTOM_FORM_NATIVE_PG_BIN (or INTAKE_NATIVE_PG_BIN) to an existing absolute native PostgreSQL bin directory.");
}
const runtime = await mkdtemp("/tmp/daycare-form-response-native.");
const data = join(runtime, "data");
const port = "55443";
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
const holdTransactionLock = async (lockSql) => {
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
const holdAdvisoryLock = (keySql) => holdTransactionLock(`select pg_advisory_xact_lock(${keySql})`);
const waitForAdvisoryWaiters = async (holderPid, applicationNames, lockEvent = "advisory") => {
  if (!Number.isInteger(holderPid) || applicationNames.some((name) => !/^native_document_[a-z0-9_]+$/.test(name))) throw new Error("Invalid synthetic advisory wait probe.");
  if (!["advisory", "relation"].includes(lockEvent)) throw new Error("Invalid lock wait event.");
  const deadline = Date.now() + 10_000;
  const names = applicationNames.map((name) => `'${name}'`).join(",");
  while (Date.now() < deadline) {
    const waiting = Number(sql(`select count(*) from pg_stat_activity where application_name in (${names})
      and wait_event_type='Lock' and wait_event='${lockEvent}' and cardinality(pg_blocking_pids(pid))>0
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
  const migrations = (await readdir(join(root, "supabase/migrations"))).filter((name) => name.endsWith(".sql")).sort();
  for (const name of migrations) sql(await readFile(join(root, "supabase/migrations", name), "utf8"));
  sql(await readFile(join(root, "supabase/seed.sql"), "utf8"));
  console.log(`Native migration compilation: ${migrations.length}/${migrations.length}.`);
  sql(run("/usr/bin/tar", ["-xOf", join(root, "node_modules/@electric-sql/pglite/dist/pgtap.tar.gz"), "share/postgresql/extension/pgtap--1.3.5.sql"]));

  const suite=await readFile(join(root,'supabase/tests/custom_form_responses.test.sql'),'utf8');
  const output=sql(suite);
  const expected=Number(suite.match(/select plan\((\d+)\)/)?.[1]);
  const passed=output.split('\n').filter(line=>/^ok \d+\b/.test(line)).length;
  if(passed!==expected||/^not ok |^# Looks like/m.test(output))throw new Error('Native suite failed: '+output);
  console.log('Native form response assertions: '+passed+'/'+expected+'.');
  const fixture=suite.slice(0,suite.indexOf('select ok((select relrowsecurity'))
    .replaceAll('pg_temp.','private.response_native_');
  const setup=sql(fixture+"select private.response_native_custom_login();select 'JWT='||current_setting('request.jwt.claims');select 'INPUT='||current_setting('test.response_input');commit;");
  const jwt=setup.split('\n').find(line=>line.startsWith('JWT='))?.slice(4);
  const input=JSON.parse(setup.split('\n').find(line=>line.startsWith('INPUT='))?.slice(6)??'null');
  if(!jwt||!input)throw new Error('Missing synthetic claims or payload');
  const quote=value=>"'"+String(value).replaceAll("'","''")+"'";
  const org='d8500000-0000-4000-8000-000000000001';
  const branch='d8600000-0000-4000-8000-000000000001';
  const client='d9500000-0000-4000-8000-000000000001';
  const actor='d8100000-0000-4000-8000-000000000001';
  const key=n=>'d9600000-0000-4000-8000-'+String(n).padStart(12,'0');
  const claims="select set_config('request.jwt.claims',"+quote(jwt)+",true);set local role authenticated;";
  const write=(n,payload,name)=>"begin;set local application_name="+quote(name)+";"+claims+
    "select 'RESULT='||public.write_custom_form_response("+[org,branch,client,key(n),JSON.stringify(payload)].map(quote).join(',')+")::text;commit;";
  const receipt=result=>JSON.parse(result.stdout.split('\n').find(line=>line.startsWith('RESULT='))?.slice(7)??'null');
  const duplicateNames=['native_document_form_duplicate_a','native_document_form_duplicate_b'];
  const opKey="hashtextextended("+quote('custom-response-op:'+org+':'+actor+':'+key(1))+",0)";
  const opHolder=await holdAdvisoryLock(opKey);
  const duplicates=duplicateNames.map(name=>concurrentSql(write(1,input,name)));
  let duplicateProbeError;
  try{await waitForAdvisoryWaiters(0,duplicateNames);}catch(error){duplicateProbeError=error;}finally{await opHolder.release();}
  const duplicateResults=await Promise.all(duplicates);
  if(duplicateResults.some(r=>r.status!==0))throw new Error('Duplicate request failed: '+JSON.stringify(duplicateResults));
  if(duplicateProbeError)throw duplicateProbeError;
  const receipts=duplicateResults.map(receipt);
  if(receipts[0]?.record?.id!==receipts[1]?.record?.id||receipts.filter(r=>r.replayed).length!==1)
    throw new Error('Duplicate race failed exact replay invariant');
  const count=Number(sql("select count(*) from private.custom_form_responses;").trim());
  if(count!==1)throw new Error('Duplicate race stored '+count+' rows');
  console.log('Native observed duplicate-key race passed: one ledger revision, one exact replay, identical response id.');
  const base=receipts[0].record;
  const editInput={...input,previousId:base.id,baseRevision:1,answers:{note:{state:'answered',value:'合成競態修訂'}}};
  const chainKey="hashtextextended("+quote('custom-response-chain:'+org+':'+base.recordKey)+",0)";
  const chainHolder=await holdAdvisoryLock(chainKey);
  const editNames=['native_document_form_edit_a','native_document_form_edit_b'];
  const edits=editNames.map((name,index)=>concurrentSql(write(index+2,editInput,name)));
  try{await waitForAdvisoryWaiters(0,editNames);}finally{await chainHolder.release();}
  const editResults=await Promise.all(edits);
  const success=editResults.filter(r=>r.status===0);
  const failure=editResults.filter(r=>r.status!==0);
  if(success.length!==1||failure.length!==1||!failure[0].stderr.includes('40001')||receipt(success[0])?.record?.revision!==2)
    throw new Error('Competing revision race failed: '+JSON.stringify(editResults));
  const ledgerCount=Number(sql("select count(*) from private.custom_form_responses;").trim());
  const receiptCount=Number(sql("select count(*) from private.custom_response_receipts;").trim());
  if(ledgerCount!==2||receiptCount!==2)throw new Error('Failed competing write persisted evidence or receipt');
  console.log('Native observed shared-base race passed: one revision 2, other SQLSTATE 40001, two total revisions/receipts.');
  // Retain the real AAL2 admission and role helpers, but make the synthetic
  // manager assignment-scoped. The legacy helper intentionally still uses now();
  // the response boundary must catch a revocation committed after request start.
  sql("delete from public.role_permissions where role_id='10000000-0000-4000-8000-000000000002'"+
    " and permission_id=(select id from public.permissions where permission_key='clients.view_all');"+
    "insert into public.client_assignments(organization_id,branch_id,client_id,assignee_user_id,assignment_kind,starts_at) values("+
    [org,branch,client,actor,'synthetic-native-form'].map(quote).join(',')+",clock_timestamp()-interval '1 year');");
  const latest=receipt(success[0]).record;
  const nextInput={...editInput,previousId:latest.id,baseRevision:2};
  const assignmentWhere=" where client_id="+quote(client)+" and assignee_user_id="+quote(actor);
  const assertNoNewEvidence=()=>{
    if(Number(sql('select count(*) from private.custom_form_responses;').trim())!==2||
       Number(sql('select count(*) from private.custom_response_receipts;').trim())!==2)
      throw new Error('Revoked assignment persisted a response revision or receipt');
  };
  for(const scenario of [
    {name:'native_document_form_revoke_write',lock:chainKey,key:4,payload:nextInput},
    {name:'native_document_form_revoke_replay',lock:opKey,key:1,payload:input},
  ]){
    sql('update public.client_assignments set ends_at=null'+assignmentWhere+';');
    const holder=await holdAdvisoryLock(scenario.lock);
    const pending=concurrentSql(write(scenario.key,scenario.payload,scenario.name));
    let probeError;
    try{
      await waitForAdvisoryWaiters(holder.pid,[scenario.name]);
      sql('update public.client_assignments set ends_at=clock_timestamp()'+assignmentWhere+';');
    }catch(error){probeError=error;}finally{await holder.release();}
    const result=await pending;
    if(probeError)throw probeError;
    if(result.status===0||!result.stderr.includes('42501')||/^RESULT=/m.test(result.stdout))
      throw new Error('Assignment revocation must deny '+scenario.name+': '+result.stderr);
    assertNoNewEvidence();
  }
  console.log('Native observed assignment revocation races passed: chain-wait write and operation-wait replay both 42501, no new evidence or returned receipt.');

  // A fixture-only BEFORE INSERT hook holds precisely the response audit write.
  // A whole audit-table lock would also block the second connection's own
  // assignment-revocation audit and could not establish a committed revocation.
  sql("create function private.response_native_audit_wait() returns trigger language plpgsql set search_path='' as $$begin "+
    "if new.table_name='custom_form_responses' and current_setting('application_name') like 'native_document_form_audit_%' then "+
    "perform pg_advisory_xact_lock(hashtextextended('synthetic-response-audit-boundary',0)); end if;return new;end;$$;"+
    "create trigger response_native_audit_wait before insert on public.audit_events for each row execute function private.response_native_audit_wait();");
  const auditLock="hashtextextended('synthetic-response-audit-boundary',0)";
  const auditCount=()=>Number(sql("select count(*) from public.audit_events where table_name='custom_form_responses'").trim());
  for(const operation of ['write','read']) {
    sql('update public.client_assignments set ends_at=null'+assignmentWhere+';');
    const beforeAudit=auditCount();
    const auditHolder=await holdAdvisoryLock(auditLock);
    const name='native_document_form_audit_'+operation+'_revoke';
    const request=operation==='write' ? write(20,nextInput,name) :
      'begin;set local application_name='+quote(name)+';'+claims+
      "select 'RESULT='||public.read_custom_form_responses("+[org,branch,client].map(quote).join(',')+")::text;commit;";
    const pending=concurrentSql(request);
    let probeError;
    try {
      await waitForAdvisoryWaiters(auditHolder.pid,[name]);
      // The request was admitted and has reached the actual audit INSERT.
      // Commit revocation from a different connection before releasing it.
      sql('update public.client_assignments set ends_at=clock_timestamp()'+assignmentWhere+';');
    } catch(error) { probeError=error; } finally { await auditHolder.release(); }
    const result=await pending;
    if(probeError)throw probeError;
    if(result.status===0||!result.stderr.includes('42501')||/^RESULT=/m.test(result.stdout))
      throw new Error('Audit-wait revocation must discard '+operation+' result: '+result.stderr);
    assertNoNewEvidence();
    if(auditCount()!==beforeAudit)throw new Error('Revoked audit-wait '+operation+' retained its audit entry');
  }
  console.log('Native observed post-audit assignment revocation: write and read both 42501, no ledger/receipt/audit growth or returned data (2 races).');

  sql('update public.client_assignments set ends_at=null'+assignmentWhere+';');
  const completeInput={...input,answers:{note:{state:'answered',value:'合成簽署競態草稿'},count:{state:'answered',value:0},yes:{state:'answered',value:false}}};
  const completeResult=await concurrentSql(write(21,completeInput,'native_document_form_sign_fixture'));
  if(completeResult.status!==0)throw new Error('Could not prepare synthetic sign fixture: '+completeResult.stderr);
  const complete=receipt(completeResult).record;
  const signInput={...completeInput,action:'sign',answers:null,previousId:complete.id,baseRevision:1};
  const challengeId='d9800000-0000-4000-8000-000000000001';
  // Insert once near the real 15-minute boundary; do not rewrite immutable
  // consumed challenges or weaken the production evidence guards.
  sql("insert into private.reauth_challenges(id,user_id,session_id,nonce_sha256,idempotency_key,issued_jwt_iat,issued_jwt_jti,created_at,expires_at,consumed_at,consumed_jwt_iat,consumed_jwt_jti,factor_method,factor_verified_at) values("+
    [challengeId,actor,'d8300000-0000-4000-8000-000000000001'].map(quote).join(',')+",repeat('d',64),"+quote(challengeId)+
    ",now()-interval '17 minutes','near-before',now()-interval '16 minutes',now()-interval '11 minutes',now()-interval '15 minutes'+interval '2 seconds',now()-interval '15 minutes'+interval '2 seconds','near-after','totp',now()-interval '15 minutes'+interval '2 seconds');"+
    'update private.reauth_events set challenge_id='+quote(challengeId)+',verified_at=(select factor_verified_at from private.reauth_challenges where id='+quote(challengeId)+') where user_id='+quote(actor)+';');
  const expiry=Number(sql("select extract(epoch from factor_verified_at+interval '15 minutes')*1000 from private.reauth_challenges where id="+quote(challengeId)).trim());
  const beforeSignAudit=auditCount();
  const signAuditHolder=await holdAdvisoryLock(auditLock);
  const signName='native_document_form_audit_sign_expiry';
  const signPending=concurrentSql(write(22,signInput,signName));
  let signProbeError;
  try {
    await waitForAdvisoryWaiters(signAuditHolder.pid,[signName]);
    const deadline=Date.now()+5000;
    while(Number(sql('select extract(epoch from clock_timestamp())*1000').trim())<=expiry) {
      if(Date.now()>deadline)throw new Error('Synthetic signature freshness boundary did not arrive.');
      await new Promise(resolveWait=>setTimeout(resolveWait,25));
    }
  } catch(error) { signProbeError=error; } finally { await signAuditHolder.release(); }
  const signResult=await signPending;
  if(signProbeError)throw signProbeError;
  if(signResult.status===0||!signResult.stderr.includes('42501')||/^RESULT=/m.test(signResult.stdout))
    throw new Error('Post-audit signature expiry must deny: '+signResult.stderr);
  if(Number(sql('select count(*) from private.custom_form_responses').trim())!==3||
    Number(sql('select count(*) from private.custom_response_receipts').trim())!==3||auditCount()!==beforeSignAudit||
    Number(sql("select count(*) from private.custom_form_responses where status='signed'").trim())!==0)
    throw new Error('Expired signature retained ledger, receipt, signature or audit evidence');
  console.log('Native observed post-audit 15-minute signature expiry: SQLSTATE 42501, unsigned source preserved, signature/receipt/audit fully rolled back. Total observed races: 7.');
}finally{
  if(started)run(join(binaries,'pg_ctl'),['-D',data,'-m','fast','-w','stop']);
}
