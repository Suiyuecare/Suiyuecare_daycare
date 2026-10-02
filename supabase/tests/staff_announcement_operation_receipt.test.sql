begin;
select plan(54);
set local time zone 'Asia/Taipei';
-- Synthetic identities, actual admission and same-session MFA evidence. No
-- business/admission function is replaced, including by the portable runner.
select set_config('test.announcement_oauth',floor(extract(epoch from clock_timestamp()-interval '2 minutes'))::text,true);
select set_config('test.announcement_totp',floor(extract(epoch from clock_timestamp()-interval '30 seconds'))::text,true);
insert into auth.users(id,aud,role,email,email_confirmed_at,created_at,updated_at)
select ('db100000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'authenticated','authenticated',
  'announcement-'||n||'@announcements.example.invalid',now()-interval '1 day',now()-interval '1 day',now()
from generate_series(1,3)n;
insert into auth.identities(id,provider_id,user_id,identity_data,provider)
select ('db200000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'synthetic-announcement-google-'||n,
  ('db100000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,
  jsonb_build_object('sub','synthetic-announcement-google-'||n,'email','announcement-'||n||'@announcements.example.invalid',
    'email_verified',true,'hd','announcements.example.invalid'),'google' from generate_series(1,3)n;
insert into auth.sessions(id,user_id,created_at,aal)
select ('db300000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,
  ('db100000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,now()-interval '3 minutes','aal2' from generate_series(1,3)n;
insert into auth.mfa_amr_claims(id,session_id,created_at,updated_at,authentication_method)
select ('db400000-0000-4000-8000-'||lpad((n*10+m)::text,12,'0'))::uuid,
  ('db300000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,
  to_timestamp(current_setting(case m when 1 then 'test.announcement_oauth' else 'test.announcement_totp' end)::bigint),
  to_timestamp(current_setting(case m when 1 then 'test.announcement_oauth' else 'test.announcement_totp' end)::bigint),
  case m when 1 then 'oauth' else 'totp' end from generate_series(1,3)n cross join generate_series(1,2)m;
insert into public.organizations(id,code,name) values
 ('db500000-0000-4000-8000-000000000001','synthetic_announcements','Synthetic announcements'),
 ('db500000-0000-4000-8000-000000000002','synthetic_other_announcements','Synthetic other announcements');
insert into public.branches(id,organization_id,code,name) values
 ('db600000-0000-4000-8000-000000000001','db500000-0000-4000-8000-000000000001','main','Synthetic main'),
 ('db600000-0000-4000-8000-000000000002','db500000-0000-4000-8000-000000000001','second','Synthetic second'),
 ('db600000-0000-4000-8000-000000000003','db500000-0000-4000-8000-000000000002','other','Synthetic other');
insert into public.profiles(id,display_name,kind)
select ('db100000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'Synthetic announcement actor '||n,'staff' from generate_series(1,3)n;
insert into public.memberships(id,organization_id,branch_id,profile_id,status,starts_at)
select ('db700000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,
  case n when 3 then 'db500000-0000-4000-8000-000000000002'::uuid else 'db500000-0000-4000-8000-000000000001'::uuid end,
  case n when 3 then 'db600000-0000-4000-8000-000000000003'::uuid else 'db600000-0000-4000-8000-000000000001'::uuid end,
  ('db100000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'active',now()-interval '1 day' from generate_series(1,3)n;
insert into public.membership_roles(membership_id,role_id)
select m.id,r.id from public.memberships m cross join public.roles r
where m.id::text like 'db700000-%' and r.is_system
  and r.role_key=case when m.profile_id='db100000-0000-4000-8000-000000000002' then 'care_worker' else 'branch_supervisor' end;
insert into private.executive_access_policy(allowed_user_id,allowed_email,google_subject,enabled,approval_reference)
values('db100000-0000-4000-8000-000000000001','announcement-1@announcements.example.invalid',
 'synthetic-announcement-google-1',true,'Synthetic isolated announcement test approval');
insert into private.reauth_challenges(id,user_id,session_id,nonce_sha256,idempotency_key,issued_jwt_iat,
 created_at,expires_at,consumed_at,consumed_jwt_iat,factor_method,factor_verified_at)
values('db800000-0000-4000-8000-000000000001','db100000-0000-4000-8000-000000000001',
 'db300000-0000-4000-8000-000000000001',repeat('a',64),'db900000-0000-4000-8000-000000000001',now()-interval '2 minutes',
 now()-interval '1 minute',now()+interval '4 minutes',to_timestamp(current_setting('test.announcement_totp')::bigint),
 to_timestamp(current_setting('test.announcement_totp')::bigint),'totp',to_timestamp(current_setting('test.announcement_totp')::bigint));
insert into private.reauth_events(user_id,session_id,challenge_id,aal,verification_method,verified_at)
values('db100000-0000-4000-8000-000000000001','db300000-0000-4000-8000-000000000001',
 'db800000-0000-4000-8000-000000000001','aal2','totp',to_timestamp(current_setting('test.announcement_totp')::bigint));

create function pg_temp.announcement_login(p_n integer default 1,p_aal text default 'aal2') returns void language plpgsql as $$begin
 perform set_config('request.jwt.claim.sub','',true);perform set_config('request.jwt.claim.role','',true);
 perform set_config('request.jwt.claims',jsonb_build_object('sub','db100000-0000-4000-8000-'||lpad(p_n::text,12,'0'),
  'session_id','db300000-0000-4000-8000-'||lpad(p_n::text,12,'0'),'role','authenticated','aud','authenticated','aal',p_aal,
  'is_anonymous',false,'email','announcement-'||p_n||'@announcements.example.invalid',
  'iat',floor(extract(epoch from clock_timestamp())),'exp',floor(extract(epoch from clock_timestamp()+interval '30 minutes')),
  'amr',jsonb_build_array(jsonb_build_object('method','oauth','timestamp',current_setting('test.announcement_oauth')::bigint),
    jsonb_build_object('method','totp','timestamp',current_setting('test.announcement_totp')::bigint)))::text,true);
end;$$;


create function pg_temp.receipt(p_action text,p_key uuid,p_nonce uuid default 'dbd00000-0000-4000-8000-000000000001') returns jsonb
language sql as $$select public.staff_announcement_operation_receipt(
 'db500000-0000-4000-8000-000000000001','db600000-0000-4000-8000-000000000001',p_action,p_key,p_nonce);$$;
create temporary table receipt_result(name text primary key,value jsonb);
grant all on receipt_result to authenticated;
create temporary table receipt_ids(name text primary key,id uuid);
grant all on receipt_ids to authenticated;

select ok(has_function_privilege('authenticated','public.staff_announcement_operation_receipt(uuid,uuid,text,uuid,uuid)','execute')
 and not has_function_privilege('anon','public.staff_announcement_operation_receipt(uuid,uuid,text,uuid,uuid)','execute')
 and not has_function_privilege('service_role','public.staff_announcement_operation_receipt(uuid,uuid,text,uuid,uuid)','execute'),
 'receipt wrapper is authenticated-only');
select ok((select not prosecdef from pg_proc where oid='public.staff_announcement_operation_receipt(uuid,uuid,text,uuid,uuid)'::regprocedure)
 and (select prosecdef and proconfig@>array['search_path=""'] from pg_proc where oid='private.staff_announcement_operation_receipt_core(uuid,uuid,text,uuid,uuid)'::regprocedure),
 'public invoker delegates to fixed-path private definer');
select ok(not has_table_privilege('authenticated','private.staff_announcement_operations','select')
 and not has_table_privilege('service_role','public.staff_announcement_versions','select'),'lookup grants no direct table access');
set local role authenticated;
select pg_temp.announcement_login();
insert into receipt_ids select 'draft',version_id from public.create_staff_announcement_draft(
 'db500000-0000-4000-8000-000000000001','db600000-0000-4000-8000-000000000001',null,
 'Private synthetic original title','Private synthetic original body',now()-interval '1 minute',null,
 array['db100000-0000-4000-8000-000000000001','db100000-0000-4000-8000-000000000002']::uuid[],'{}'::uuid[],null,
 'dbc00000-0000-4000-8000-000000000001');
insert into receipt_ids select 'release',version_id from public.publish_staff_announcement(
 'db500000-0000-4000-8000-000000000001','db600000-0000-4000-8000-000000000001',
 (select id from receipt_ids where name='draft'),'dbc00000-0000-4000-8000-000000000002');
select * from public.mark_staff_announcement_read('db500000-0000-4000-8000-000000000001','db600000-0000-4000-8000-000000000001',
 (select id from receipt_ids where name='release'),'dbc00000-0000-4000-8000-000000000003');
insert into receipt_ids select 'revision',version_id from public.create_staff_announcement_draft(
 'db500000-0000-4000-8000-000000000001','db600000-0000-4000-8000-000000000001',
 (select id from receipt_ids where name='release'),'Private synthetic revised title','Private synthetic revised body',
 now()-interval '1 minute',null,array['db100000-0000-4000-8000-000000000001','db100000-0000-4000-8000-000000000002']::uuid[],
 '{}'::uuid[],'Synthetic revision','dbc00000-0000-4000-8000-000000000004');
insert into receipt_ids select 'replacement',version_id from public.publish_staff_announcement(
 'db500000-0000-4000-8000-000000000001','db600000-0000-4000-8000-000000000001',
 (select id from receipt_ids where name='revision'),'dbc00000-0000-4000-8000-000000000005');
insert into receipt_ids select 'withdrawal',version_id from public.withdraw_staff_announcement(
 'db500000-0000-4000-8000-000000000001','db600000-0000-4000-8000-000000000001',
 (select id from receipt_ids where name='replacement'),(select id from receipt_ids where name='replacement'),
 'Private synthetic withdrawal reason','dbc00000-0000-4000-8000-000000000006');
reset role;
select set_config('test.receipt_versions',(select count(*)::text from public.staff_announcement_versions),true);
select set_config('test.receipt_operations',(select count(*)::text from private.staff_announcement_operations),true);
select set_config('test.receipt_recipients',(select count(*)::text from public.staff_announcement_recipients),true);
select set_config('test.receipt_reads',(select count(*)::text from public.staff_announcement_read_receipts),true);
set local role authenticated;
insert into receipt_result values
 ('draft',pg_temp.receipt('draft','dbc00000-0000-4000-8000-000000000001')),
 ('publish',pg_temp.receipt('publish','dbc00000-0000-4000-8000-000000000002')),
 ('read',pg_temp.receipt('read','dbc00000-0000-4000-8000-000000000003')),
 ('revision',pg_temp.receipt('draft','dbc00000-0000-4000-8000-000000000004')),
 ('withdraw',pg_temp.receipt('withdraw','dbc00000-0000-4000-8000-000000000006')),
 ('missing',pg_temp.receipt('draft','dbc00000-0000-4000-8000-000000000009')),
 ('wrongaction',pg_temp.receipt('read','dbc00000-0000-4000-8000-000000000001'));
select ok((select bool_and(value->>'status'='committed' and value->>'persisted'='true' and value->>'demo'='false')
 from receipt_result where name not in ('missing','wrongaction')),'all four own original actions remain provable after replacement and withdrawal');
select is((select value->>'schemaVersion' from receipt_result where name='draft'),'1','strict receipt schema is version one');
select is((select value->>'organizationId' from receipt_result where name='draft'),'db500000-0000-4000-8000-000000000001','exact organization echoed');
select is((select value->>'branchId' from receipt_result where name='draft'),'db600000-0000-4000-8000-000000000001','exact branch echoed');
select is((select value->>'actorUserId' from receipt_result where name='draft'),'db100000-0000-4000-8000-000000000001','actor comes from auth.uid');
select is((select value->>'idempotencyKey' from receipt_result where name='draft'),'dbc00000-0000-4000-8000-000000000001','original operation key echoed');
select is((select value->>'nonce' from receipt_result where name='draft'),'dbd00000-0000-4000-8000-000000000001','caller correlation nonce echoed');
select is((select value->'evidence'->>'versionId' from receipt_result where name='draft'),(select id::text from receipt_ids where name='draft'),'historical draft exact version is not replaced by latest version');
select is((select value->'evidence'->>'version' from receipt_result where name='draft'),'1','original first version preserved');
select ok((select value->'evidence'->'sourceVersionId'='null'::jsonb and value->'evidence'->'releaseVersionId'='null'::jsonb
 from receipt_result where name='draft'),'first draft has explicit null predecessor and release');
select is((select value->'evidence'->>'sourceVersionId' from receipt_result where name='publish'),(select id::text from receipt_ids where name='draft'),'publish identifies exact original draft source');
select is((select value->'evidence'->>'releaseVersionId' from receipt_result where name='publish'),(select id::text from receipt_ids where name='release'),'publish receipt identifies old release, not replacement');
select is((select value->'evidence'->>'sourceVersionId' from receipt_result where name='revision'),(select id::text from receipt_ids where name='release'),'off-filter historical revised draft identifies predecessor');
select is((select value->'evidence'->>'versionId' from receipt_result where name='revision'),(select id::text from receipt_ids where name='revision'),'revision lookup returns exact archived draft');
select is((select value->'evidence'->>'sourceVersionId' from receipt_result where name='withdraw'),(select id::text from receipt_ids where name='replacement'),'withdrawal identifies exact old head');
select is((select value->'evidence'->>'releaseVersionId' from receipt_result where name='withdraw'),(select id::text from receipt_ids where name='replacement'),'withdrawal identifies withdrawn release');
select is((select value->'evidence'->>'sourceVersionId' from receipt_result where name='read'),(select id::text from receipt_ids where name='release'),'read source is exact original release');
select is((select value->'evidence'->>'releaseVersionId' from receipt_result where name='read'),(select id::text from receipt_ids where name='release'),'old read remains provable though current active release changed');
select is((select value->'evidence'->>'version' from receipt_result where name='read'),'2','read version is original release version, not current head');
select ok((select bool_and((value->>'verifiedAt')::timestamptz>=(value->'evidence'->>'recordedAt')::timestamptz
 and (value->>'verifiedAt')::timestamptz>=(value->'evidence'->>'effectiveAt')::timestamptz)
 from receipt_result where name not in ('missing','wrongaction')),'verification clock follows recorded and effective business times');
select is((select value->>'status' from receipt_result where name='missing'),'not_found','missing key has honest not-found status');
select ok((select value->'evidence'='null'::jsonb and value->>'persisted'='false' from receipt_result where name='missing'),'not-found contains no invented proof');
select is((select value->>'status' from receipt_result where name='wrongaction'),'not_found','valid key for another action is not a matched receipt');
select ok((select bool_and(not (value::text ~ 'Private synthetic|audience|request_hash|content_hash|reauth|challenge|recipient'))
 from receipt_result),'receipt JSON has no title body reason audience hash or signing evidence');
select is((select count(*)::integer from jsonb_object_keys((select value from receipt_result where name='draft'))),12,'strict top-level contract has exactly twelve fields');
select is((select count(*)::integer from jsonb_object_keys((select value->'evidence' from receipt_result where name='draft'))),7,'evidence has exactly seven approved metadata fields');
select is((select announcements from public.staff_announcement_management_snapshot_v2('db500000-0000-4000-8000-000000000001',
 'db600000-0000-4000-8000-000000000001',null,'no synthetic match','draft',1,20)),'[]'::jsonb,
 'filtered empty current page does not prevent exact receipt lookup');
select throws_ok($$select pg_temp.receipt('unknown','dbc00000-0000-4000-8000-000000000001')$$,'22023',
 'valid announcement receipt lookup parameters are required','unknown action rejected');
select throws_ok($$select pg_temp.receipt(null,'dbc00000-0000-4000-8000-000000000001')$$,'22023',
 'valid announcement receipt lookup parameters are required','null action rejected');
select throws_ok($$select pg_temp.receipt('draft',null)$$,'22023',
 'valid announcement receipt lookup parameters are required','null key rejected');
select throws_ok($$select pg_temp.receipt('draft','dbc00000-0000-4000-8000-000000000001',null)$$,'22023',
 'valid announcement receipt lookup parameters are required','null nonce rejected');
select throws_ok($$select pg_temp.receipt('draft','not-a-uuid'::uuid)$$,'22P02',
 'invalid input syntax for type uuid: "not-a-uuid"','malformed key cannot become another lookup');
select throws_ok($$select pg_temp.receipt('draft','dbc00000-0000-4000-8000-000000000001','not-a-uuid'::uuid)$$,'22P02',
 'invalid input syntax for type uuid: "not-a-uuid"','malformed nonce rejected before lookup');
select throws_ok($$select public.staff_announcement_operation_receipt(null,
 'db600000-0000-4000-8000-000000000001','draft','dbc00000-0000-4000-8000-000000000001','dbd00000-0000-4000-8000-000000000001')$$,
 '22023','valid announcement receipt lookup parameters are required','null organization rejected');
select throws_ok($$select public.staff_announcement_operation_receipt('db500000-0000-4000-8000-000000000001',
 null,'draft','dbc00000-0000-4000-8000-000000000001','dbd00000-0000-4000-8000-000000000001')$$,
 '22023','valid announcement receipt lookup parameters are required','null branch rejected');
select throws_ok($$select public.staff_announcement_operation_receipt('db500000-0000-4000-8000-000000000001',
 'db600000-0000-4000-8000-000000000002','draft','dbc00000-0000-4000-8000-000000000001','dbd00000-0000-4000-8000-000000000001')$$,
 '42501','announcement operation receipt is not permitted','cross-branch request is denied before lookup');
select throws_ok($$select public.staff_announcement_operation_receipt('db500000-0000-4000-8000-000000000002',
 'db600000-0000-4000-8000-000000000003','draft','dbc00000-0000-4000-8000-000000000001','dbd00000-0000-4000-8000-000000000001')$$,
 '42501','announcement operation receipt is not permitted','cross-organization request is denied before lookup');
select pg_temp.announcement_login(1,'aal1');
select throws_ok($$select pg_temp.receipt('draft','dbc00000-0000-4000-8000-000000000001')$$,
 '42501','announcement operation receipt is not permitted','AAL1 cannot read historical operation evidence');
reset role;
update private.executive_access_policy set allowed_user_id='db100000-0000-4000-8000-000000000002',
 allowed_email='announcement-2@announcements.example.invalid',google_subject='synthetic-announcement-google-2';
set local role authenticated;
select pg_temp.announcement_login(2);
select is(pg_temp.receipt('read','dbc00000-0000-4000-8000-000000000003')->>'status','not_found',
 'another currently admitted actor cannot look up the original actor key');
select throws_ok($$select pg_temp.receipt('draft','dbc00000-0000-4000-8000-000000000001')$$,
 '42501','announcement operation receipt is not permitted','read-only employee has no historical draft management access');
reset role;
update private.executive_access_policy set allowed_user_id='db100000-0000-4000-8000-000000000001',
 allowed_email='announcement-1@announcements.example.invalid',google_subject='synthetic-announcement-google-1';
set local role authenticated;
select pg_temp.announcement_login();
reset role;
update private.reauth_events set revoked_at=clock_timestamp() where user_id='db100000-0000-4000-8000-000000000001';
set local role authenticated;
select throws_ok($$select pg_temp.receipt('publish','dbc00000-0000-4000-8000-000000000002')$$,
 '42501','recent announcement AAL2 evidence is required','revoked current MFA evidence cannot query original publish receipt');
reset role;
-- Consumed challenges are genuinely immutable: do not disable the terminal
-- evidence trigger to manufacture an otherwise unreachable invalidation.
select ok(position('challenge.consumed_at is not null' in pg_get_functiondef(
 'private.staff_announcement_operation_receipt_core(uuid,uuid,text,uuid,uuid)'::regprocedure))>0
 and position('challenge.invalidated_at is null' in pg_get_functiondef(
 'private.staff_announcement_operation_receipt_core(uuid,uuid,text,uuid,uuid)'::regprocedure))>0,
 'historical release challenge validity is explicitly rechecked without replacing immutable evidence');
set local role authenticated;
select is(pg_temp.receipt('draft','dbc00000-0000-4000-8000-000000000001')->>'status','committed',
 'draft lookup does not invent a recent-MFA requirement');
reset role;
select is((select count(*)::text from public.staff_announcement_versions),current_setting('test.receipt_versions'),'receipt lookup adds zero versions');
select is((select count(*)::text from private.staff_announcement_operations),current_setting('test.receipt_operations'),'receipt lookup adds zero operation ledger rows');
select is((select count(*)::text from public.staff_announcement_recipients),current_setting('test.receipt_recipients'),'receipt lookup adds zero audience rows');
select is((select count(*)::text from public.staff_announcement_read_receipts),current_setting('test.receipt_reads'),'receipt lookup adds zero read receipts');
select ok(exists(select 1 from public.audit_events where metadata->>'projection'='page68_own_operation_receipt_v1')
 and not exists(select 1 from public.audit_events where metadata->>'projection'='page68_own_operation_receipt_v1'
 and (metadata::text ~ 'Private synthetic|request_hash|content_hash|idempotency|nonce|title|body|audience')),
 'successful and not-found lookup audits contain minimal metadata only');

create function pg_temp.receipt_audit_fault() returns trigger
language plpgsql security definer set search_path='' as $$begin
 if new.metadata->>'projection'='page68_own_operation_receipt_v1' and current_setting('test.receipt_fault',true)='revoke' then
  update public.memberships set status='suspended' where id='db700000-0000-4000-8000-000000000001';
 end if;return new;end;$$;
create trigger receipt_test_audit_fault before insert on public.audit_events for each row execute function pg_temp.receipt_audit_fault();
select set_config('test.receipt_audits',(select count(*)::text from public.audit_events),true);
set local role authenticated;
select set_config('test.receipt_fault','revoke',true);
select throws_ok($$select pg_temp.receipt('draft','dbc00000-0000-4000-8000-000000000001')$$,
 '42501','announcement operation receipt authority expired after audit','post-audit revocation denies stale evidence');
reset role;
select is((select status from public.memberships where id='db700000-0000-4000-8000-000000000001'),'active',
 'denied lookup rolls back injected admission change');
select is((select count(*)::text from public.audit_events),current_setting('test.receipt_audits'),
 'denied post-audit lookup leaves no successful read audit');
select * from finish();
rollback;
