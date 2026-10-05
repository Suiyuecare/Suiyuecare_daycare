begin;
select plan(58);

-- Synthetic, owner-approved Google identities only. No production session or data.
select set_config('test.tocc_amr',floor(extract(epoch from clock_timestamp()-interval '2 minutes'))::text,true);
insert into auth.users(id,aud,role,email,email_confirmed_at,created_at,updated_at)
values('e0100000-0000-4000-8000-000000000001','authenticated','authenticated',
  'tocc@care.example.invalid',now()-interval '1 day',now()-interval '1 day',now());
insert into auth.identities(id,provider_id,user_id,identity_data,provider)
values('e0200000-0000-4000-8000-000000000001','synthetic-tocc-worker',
  'e0100000-0000-4000-8000-000000000001',
  '{"sub":"synthetic-tocc-worker","email":"tocc@care.example.invalid","email_verified":true,"hd":"care.example.invalid"}','google');
insert into auth.sessions(id,user_id,created_at,aal) values
 ('e0300000-0000-4000-8000-000000000001','e0100000-0000-4000-8000-000000000001',now()-interval '3 minutes','aal1'),
 ('e0300000-0000-4000-8000-000000000002','e0100000-0000-4000-8000-000000000001',now()-interval '3 minutes','aal2');
insert into auth.mfa_amr_claims(id,session_id,created_at,updated_at,authentication_method)
select gen_random_uuid(),'e0300000-0000-4000-8000-000000000001',
  to_timestamp(current_setting('test.tocc_amr')::bigint),to_timestamp(current_setting('test.tocc_amr')::bigint),'oauth';
insert into auth.mfa_amr_claims(id,session_id,created_at,updated_at,authentication_method)
select gen_random_uuid(),'e0300000-0000-4000-8000-000000000002',
  to_timestamp(current_setting('test.tocc_amr')::bigint),to_timestamp(current_setting('test.tocc_amr')::bigint),method
from (values('oauth'),('totp')) factor(method);
insert into public.organizations(id,code,name) values
 ('e0500000-0000-4000-8000-000000000001','tocc_draft_org','Synthetic TOCC organization'),
 ('e0500000-0000-4000-8000-000000000002','tocc_draft_foreign','Synthetic other organization');
insert into public.branches(id,organization_id,code,name) values
 ('e0600000-0000-4000-8000-000000000001','e0500000-0000-4000-8000-000000000001','main','Main'),
 ('e0600000-0000-4000-8000-000000000002','e0500000-0000-4000-8000-000000000001','second','Second'),
 ('e0600000-0000-4000-8000-000000000003','e0500000-0000-4000-8000-000000000002','foreign','Foreign');
insert into public.profiles(id,display_name,kind) values
 ('e0100000-0000-4000-8000-000000000001','Synthetic TOCC worker','staff');
insert into public.memberships(id,organization_id,branch_id,profile_id,status,starts_at)
values('e0700000-0000-4000-8000-000000000001','e0500000-0000-4000-8000-000000000001',
 'e0600000-0000-4000-8000-000000000001','e0100000-0000-4000-8000-000000000001',
 'active',now()-interval '1 day');
insert into public.membership_roles(membership_id,role_id)
values('e0700000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000006');
insert into public.clients(id,organization_id,branch_id,client_code,display_name,admitted_on)
values
 ('e0800000-0000-4000-8000-000000000001','e0500000-0000-4000-8000-000000000001','e0600000-0000-4000-8000-000000000001','TOCC-1','Assigned',current_date-10),
 ('e0800000-0000-4000-8000-000000000002','e0500000-0000-4000-8000-000000000001','e0600000-0000-4000-8000-000000000001','TOCC-2','Unassigned',current_date-10),
 ('e0800000-0000-4000-8000-000000000003','e0500000-0000-4000-8000-000000000001','e0600000-0000-4000-8000-000000000002','TOCC-3','Other branch',current_date-10),
 ('e0800000-0000-4000-8000-000000000004','e0500000-0000-4000-8000-000000000002','e0600000-0000-4000-8000-000000000003','TOCC-4','Other tenant',current_date-10);
insert into public.client_assignments(organization_id,branch_id,client_id,assignee_user_id,assignment_kind,starts_at)
values('e0500000-0000-4000-8000-000000000001','e0600000-0000-4000-8000-000000000001',
 'e0800000-0000-4000-8000-000000000001','e0100000-0000-4000-8000-000000000001','tocc_test',now()-interval '1 day');

create function pg_temp.claims(p_aal text default 'aal1') returns boolean language plpgsql security invoker as $$
declare v_session uuid;
begin
 v_session:=case when p_aal='aal2' then 'e0300000-0000-4000-8000-000000000002'::uuid
   else 'e0300000-0000-4000-8000-000000000001'::uuid end;
 perform set_config('request.jwt.claims',jsonb_build_object(
  'sub','e0100000-0000-4000-8000-000000000001','session_id',v_session,
  'aud','authenticated','role','authenticated','aal',p_aal,
  'email','tocc@care.example.invalid','is_anonymous',false,
  'iat',floor(extract(epoch from clock_timestamp())),
  'exp',floor(extract(epoch from clock_timestamp()+interval '30 minutes')),
  'amr',case when p_aal='aal2' then jsonb_build_array(
    jsonb_build_object('method','oauth','timestamp',current_setting('test.tocc_amr')::bigint),
    jsonb_build_object('method','totp','timestamp',current_setting('test.tocc_amr')::bigint))
    else jsonb_build_array(jsonb_build_object('method','oauth','timestamp',
      current_setting('test.tocc_amr')::bigint)) end)::text,true);
 return public.is_staff_login_allowed();
end; $$;
create function pg_temp.payload(p_client uuid default 'e0800000-0000-4000-8000-000000000001',
  p_draft uuid default 'e0900000-0000-4000-8000-000000000001',
  p_previous jsonb default null,p_summary text default null)
returns jsonb language sql stable as $$
 select jsonb_build_object('client_id',p_client,'draft_key',p_draft,
  'previous_version_id',p_previous->'versionId',
  'expected_version',coalesce((p_previous->>'version')::integer,0),
  'expected_content_hash',p_previous->'contentHash',
  'assessment_date',(now() at time zone 'Asia/Taipei')::date,
  'result_status','clear','symptom_summary',p_summary,'risk_summary',null,
  'evidence_status','not_required','action_status','none_required');
$$;
create function pg_temp.save(p_action text,p_payload jsonb,
  p_key uuid default 'e0a00000-0000-4000-8000-000000000001')
returns jsonb language sql volatile as $$
 select public.save_client_tocc_draft('e0500000-0000-4000-8000-000000000001',
  'e0600000-0000-4000-8000-000000000001',p_action,p_payload,p_key);
$$;
create temporary table saved_drafts(label text primary key,receipt jsonb not null);
grant select,insert on saved_drafts to authenticated;
create function pg_temp.formal_count() returns integer language sql security definer as $$
 select count(*)::integer from public.client_tocc_assessments; $$;
create function pg_temp.draft_version_count() returns integer language sql security definer as $$
 select count(*)::integer from private.client_tocc_draft_versions; $$;
create function pg_temp.signature_count() returns integer language sql security definer as $$
 select count(*)::integer from private.client_tocc_draft_signatures; $$;
create function pg_temp.draft_audit_count() returns integer language sql security definer as $$
 select count(*)::integer from public.audit_events where table_name in
 ('private.client_tocc_draft_versions','private.client_tocc_draft_operations'); $$;
create function pg_temp.formal_has_challenge() returns boolean language sql security definer as $$
 select signature_reauth_challenge_id='e0b00000-0000-4000-8000-000000000001'
 from public.client_tocc_assessments limit 1; $$;

select ok((select bool_and(relrowsecurity and relforcerowsecurity) from pg_class
 where oid in ('private.client_tocc_draft_versions'::regclass,
 'private.client_tocc_draft_operations'::regclass,'private.client_tocc_draft_signatures'::regclass)),
 'all new TOCC draft tables force RLS');
select ok(not has_table_privilege('authenticated','private.client_tocc_draft_versions','select,insert,update,delete')
 and not has_table_privilege('service_role','private.client_tocc_draft_versions','select,insert,update,delete'),
 'API roles cannot access raw draft tables');
select ok(not has_function_privilege('anon','public.save_client_tocc_draft(uuid,uuid,text,jsonb,uuid)','execute')
 and has_function_privilege('authenticated','public.save_client_tocc_draft(uuid,uuid,text,jsonb,uuid)','execute')
 and not has_function_privilege('anon','public.sign_client_tocc_draft(uuid,uuid,uuid,uuid,integer,text,uuid)','execute'),
 'only authenticated role can call scoped draft writers');
select ok((select bool_and(not prosecdef and proconfig @> array['search_path=""']) from pg_proc
 where oid in ('public.save_client_tocc_draft(uuid,uuid,text,jsonb,uuid)'::regprocedure,
  'public.sign_client_tocc_draft(uuid,uuid,uuid,uuid,integer,text,uuid)'::regprocedure)),
 'public draft APIs are invoker functions');

set local role authenticated;
select is(pg_temp.claims(),false,'unapproved Google AAL1 cannot enter');
select is(public.has_client_tocc_draft_access('e0500000-0000-4000-8000-000000000001',
 'e0600000-0000-4000-8000-000000000001',null,true),false,'unapproved draft access denied');
select throws_ok($$select pg_temp.save('create',pg_temp.payload())$$,'42501',null,
 'unapproved staff cannot directly create a draft');
reset role;
select set_config('request.jwt.claims','{}',true);
insert into private.staff_google_access_grants(allowed_user_id,organization_id,
 company_email_domain,allowed_email,google_subject,enabled,approval_reference)
values('e0100000-0000-4000-8000-000000000001',
 'e0500000-0000-4000-8000-000000000001','care.example.invalid',
 'tocc@care.example.invalid','synthetic-tocc-worker',true,'Synthetic TOCC approval');
set local role authenticated;
select is(pg_temp.claims(),true,'owner-approved Google AAL1 session admitted');
select is(public.has_recent_aal2(15),false,'AAL1 draft session has no forged AAL2');
select is(public.has_client_tocc_draft_access('e0500000-0000-4000-8000-000000000001',
 'e0600000-0000-4000-8000-000000000001',
 'e0800000-0000-4000-8000-000000000001',true),true,'assigned TOCC writer allowed');
select is(public.has_client_tocc_draft_access('e0500000-0000-4000-8000-000000000001',
 'e0600000-0000-4000-8000-000000000001',
 'e0800000-0000-4000-8000-000000000002',true),false,'unassigned client denied');
select is(public.has_client_tocc_draft_access('e0500000-0000-4000-8000-000000000001',
 'e0600000-0000-4000-8000-000000000002',null,true),false,'other branch denied');
select is(public.has_client_tocc_draft_access('e0500000-0000-4000-8000-000000000002',
 'e0600000-0000-4000-8000-000000000003',null,true),false,'other tenant denied');
reset role;
insert into public.role_permissions(role_id,permission_id)
select '10000000-0000-4000-8000-000000000006',id from public.permissions
where permission_key='clients.view_all';
set local role authenticated;
select is(public.has_client_tocc_draft_access('e0500000-0000-4000-8000-000000000001',
 'e0600000-0000-4000-8000-000000000001',
 'e0800000-0000-4000-8000-000000000002',false),true,
 'branch view_all retains read access to an unassigned client');
select is(public.has_client_tocc_draft_access('e0500000-0000-4000-8000-000000000001',
 'e0600000-0000-4000-8000-000000000001',
 'e0800000-0000-4000-8000-000000000002',true),false,
 'branch view_all never authorizes an unassigned AAL1 draft write');
select throws_ok($$select pg_temp.save('create',pg_temp.payload(
 'e0800000-0000-4000-8000-000000000002'),gen_random_uuid())$$,
 '42501',null,'direct RPC rejects view_all writer lacking current case assignment');
select is(pg_temp.claims('aal2'),true,'view_all worker can also hold a genuine AAL2 session');
select is(public.has_client_tocc_draft_access('e0500000-0000-4000-8000-000000000001',
 'e0600000-0000-4000-8000-000000000001',
 'e0800000-0000-4000-8000-000000000002',false),true,
 'AAL2 view_all retains read access to an unassigned client');
select is(public.has_client_tocc_draft_access('e0500000-0000-4000-8000-000000000001',
 'e0600000-0000-4000-8000-000000000001',
 'e0800000-0000-4000-8000-000000000002',true),false,
 'AAL2 view_all cannot write an unassigned unsigned draft');
select throws_ok($$select pg_temp.save('create',pg_temp.payload(
 'e0800000-0000-4000-8000-000000000002'),gen_random_uuid())$$,
 '42501',null,'AAL2 direct RPC rejects unassigned view_all draft writer');
select is(pg_temp.claims(),true,'restore AAL1 worker after AAL2 negative tests');
reset role;
delete from public.role_permissions where role_id='10000000-0000-4000-8000-000000000006'
 and permission_id=(select id from public.permissions where permission_key='clients.view_all');
set local role authenticated;
insert into saved_drafts(label,receipt) select 'v1',pg_temp.save('create',pg_temp.payload());
select is((select (receipt->>'version')::integer from saved_drafts where label='v1'),1,
 'AAL1 creates unsigned draft version one');
select is(pg_temp.formal_count(),0,
 'draft creation does not create a signed formal record');
select is(pg_temp.save('create',pg_temp.payload())->>'replayed','true',
 'same actor key and content replay exactly');
select throws_ok($$select pg_temp.save('create',pg_temp.payload(
 'e0800000-0000-4000-8000-000000000001','e0900000-0000-4000-8000-000000000001',null,'changed'))$$,
 '23505',null,'same idempotency key with different content conflicts');
select throws_ok($$select pg_temp.save('create',pg_temp.payload(
 'e0800000-0000-4000-8000-000000000002'),gen_random_uuid())$$,
 '42501',null,'unassigned client direct mutation denied');
select throws_ok($$select pg_temp.save('create',pg_temp.payload(
 'e0800000-0000-4000-8000-000000000003'),gen_random_uuid())$$,
 '42501',null,'other branch client direct mutation denied');
select throws_ok($$select pg_temp.save('create',pg_temp.payload(
 'e0800000-0000-4000-8000-000000000004'),gen_random_uuid())$$,
 '42501',null,'other tenant client direct mutation denied');
select throws_ok($$select pg_temp.save('create',pg_temp.payload()||'{"result_status":"monitor"}'::jsonb,gen_random_uuid())$$,
 '22023',null,'server rejects non-clear draft without summary');
select is((select count(*)::integer from public.client_tocc_draft_snapshot(
 'e0500000-0000-4000-8000-000000000001','e0600000-0000-4000-8000-000000000001')),1,
 'draft snapshot shows only authorized latest draft');
select throws_ok($$select * from public.client_tocc_draft_snapshot(
 'e0500000-0000-4000-8000-000000000001','e0600000-0000-4000-8000-000000000001',102,0)$$,
 '22023',null,'draft snapshot rejects unbounded page size');
select throws_ok($$select public.sign_client_tocc_draft(
 'e0500000-0000-4000-8000-000000000001','e0600000-0000-4000-8000-000000000001',
 'e0900000-0000-4000-8000-000000000001',
 (select (receipt->>'versionId')::uuid from saved_drafts where label='v1'),1,
 (select receipt->>'contentHash' from saved_drafts where label='v1'),gen_random_uuid())$$,
 '42501',null,'AAL1 cannot sign even a valid draft');
insert into saved_drafts(label,receipt)
select 'v2',pg_temp.save('revise',pg_temp.payload(
 'e0800000-0000-4000-8000-000000000001','e0900000-0000-4000-8000-000000000001',
 (select receipt from saved_drafts where label='v1'),'manual note'),
 'e0a00000-0000-4000-8000-000000000002');
select is((select (receipt->>'version')::integer from saved_drafts where label='v2'),2,
 'AAL1 revision appends version two');
select throws_ok($$select pg_temp.save('revise',pg_temp.payload(
 'e0800000-0000-4000-8000-000000000001','e0900000-0000-4000-8000-000000000001',
 (select receipt from saved_drafts where label='v1'),'stale'),gen_random_uuid())$$,
 'PT409',null,'stale version/hash returns non-retryable conflict');
select is(pg_temp.draft_version_count(),2,
 'revision preserves both immutable versions');
select ok(pg_temp.draft_audit_count()>=4,
 'draft versions and exact-replay operations are audited');
select is(pg_temp.claims('aal2'),true,
 'approved Google worker can have a genuine AAL2 session');
select is(public.can_sign_client_tocc_draft('e0500000-0000-4000-8000-000000000001',
 'e0600000-0000-4000-8000-000000000001'),false,
 'routine worker AAL2 without original formal permission cannot sign');
select throws_ok($$select public.sign_client_tocc_draft(
 'e0500000-0000-4000-8000-000000000001','e0600000-0000-4000-8000-000000000001',
 'e0900000-0000-4000-8000-000000000001',
 (select (receipt->>'versionId')::uuid from saved_drafts where label='v2'),2,
 (select receipt->>'contentHash' from saved_drafts where label='v2'),gen_random_uuid())$$,
 '42501',null,'routine worker genuine AAL2 still lacks formal signature authority');
reset role;
select throws_ok($$update private.client_tocc_draft_versions set version=9$$,'55000',null,
 'database owner cannot mutate draft history');
select set_config('request.jwt.claims','{}',true);
insert into private.executive_access_policy(allowed_user_id,allowed_email,google_subject,enabled,approval_reference)
values('e0100000-0000-4000-8000-000000000001','tocc@care.example.invalid',
 'synthetic-tocc-worker',true,'Synthetic AAL2 sign fixture');
insert into private.reauth_challenges(id,user_id,session_id,nonce_sha256,
 idempotency_key,issued_jwt_iat,created_at,expires_at,consumed_at,
 consumed_jwt_iat,factor_method,factor_verified_at)
values('e0b00000-0000-4000-8000-000000000001','e0100000-0000-4000-8000-000000000001',
 'e0300000-0000-4000-8000-000000000002',repeat('a',64),
 'e0b00000-0000-4000-8000-000000000002',now()-interval '3 minutes',
 now()-interval '2 minutes',now()+interval '5 minutes',now()-interval '30 seconds',
 now()-interval '30 seconds','totp',now()-interval '30 seconds');
insert into private.reauth_events(user_id,session_id,challenge_id,aal,verification_method,verified_at)
values('e0100000-0000-4000-8000-000000000001',
 'e0300000-0000-4000-8000-000000000002',
 'e0b00000-0000-4000-8000-000000000001','aal2','totp',now()-interval '30 seconds');
set local role authenticated;
select is(pg_temp.claims('aal2'),true,'same approved Google person with real AAL2 admitted');
select is(public.can_sign_client_tocc_draft('e0500000-0000-4000-8000-000000000001',
 'e0600000-0000-4000-8000-000000000001'),true,'formal TOCC signer preflight uses live AAL2 evidence');
select throws_ok($$select public.sign_client_tocc_draft(
 'e0500000-0000-4000-8000-000000000001','e0600000-0000-4000-8000-000000000001',
 'e0900000-0000-4000-8000-000000000001',
 (select (receipt->>'versionId')::uuid from saved_drafts where label='v1'),1,
 (select receipt->>'contentHash' from saved_drafts where label='v1'),gen_random_uuid())$$,
 'PT409',null,'stale sign request uses non-retryable conflict code');
create temporary table signed_receipt as select public.sign_client_tocc_draft(
 'e0500000-0000-4000-8000-000000000001','e0600000-0000-4000-8000-000000000001',
 'e0900000-0000-4000-8000-000000000001',
 (select (receipt->>'versionId')::uuid from saved_drafts where label='v2'),2,
 (select receipt->>'contentHash' from saved_drafts where label='v2'),
 'e0a00000-0000-4000-8000-000000000003') receipt;
select is((select receipt->>'replayed' from signed_receipt),'false',
 'AAL2 signing converts the frozen latest draft once');
select is(pg_temp.formal_count(),1,
 'one existing formal signed TOCC row was created');
select ok(pg_temp.formal_has_challenge(),'formal row preserves real same-session challenge');
select is(pg_temp.signature_count(),1,
 'draft-to-formal link is immutable and unique');
select is((select public.sign_client_tocc_draft(
 'e0500000-0000-4000-8000-000000000001','e0600000-0000-4000-8000-000000000001',
 'e0900000-0000-4000-8000-000000000001',
 (select (receipt->>'versionId')::uuid from saved_drafts where label='v2'),2,
 (select receipt->>'contentHash' from saved_drafts where label='v2'),
 'e0a00000-0000-4000-8000-000000000003')->>'replayed'),'true',
 'same signature key returns exact replay');
select throws_ok($$select public.sign_client_tocc_draft(
 'e0500000-0000-4000-8000-000000000001','e0600000-0000-4000-8000-000000000001',
 'e0900000-0000-4000-8000-000000000001',
 (select (receipt->>'versionId')::uuid from saved_drafts where label='v2'),2,
 (select receipt->>'contentHash' from saved_drafts where label='v2'),
 gen_random_uuid())$$,'23505',null,'different sign key cannot sign same draft twice');
select throws_ok($$select pg_temp.save('revise',pg_temp.payload(
 'e0800000-0000-4000-8000-000000000001','e0900000-0000-4000-8000-000000000001',
 (select receipt from saved_drafts where label='v2'),'late edit'),gen_random_uuid())$$,
 '23505',null,'signed draft cannot be revised');
select is((select count(*)::integer from public.client_tocc_draft_snapshot(
 'e0500000-0000-4000-8000-000000000001','e0600000-0000-4000-8000-000000000001'
 ) where signed_assessment_id is not null),1,'snapshot distinguishes signed draft from pending');
select is((select (pg_temp.save('create',pg_temp.payload(
 'e0800000-0000-4000-8000-000000000001','e0900000-0000-4000-8000-000000000005'),
 gen_random_uuid())->>'version')::integer),1,'second draft key can be created after prior signature');
select is((select count(*)::integer from public.client_tocc_draft_snapshot(
 'e0500000-0000-4000-8000-000000000001','e0600000-0000-4000-8000-000000000001',1,0)),1,
 'draft snapshot page size one returns one authorized latest row');
select is((select count(*)::integer from public.client_tocc_draft_snapshot(
 'e0500000-0000-4000-8000-000000000001','e0600000-0000-4000-8000-000000000001',1,1)),1,
 'draft snapshot second page remains reachable');
select is((select count(*)::integer from public.client_tocc_draft_snapshot(
 'e0500000-0000-4000-8000-000000000001','e0600000-0000-4000-8000-000000000001',1,2)),0,
 'draft snapshot exposes exact end of pagination');
reset role;
update public.client_assignments set ends_at=clock_timestamp()-interval '1 minute'
 where client_id='e0800000-0000-4000-8000-000000000001'
   and assignee_user_id='e0100000-0000-4000-8000-000000000001';
set local role authenticated;
select is(public.has_client_tocc_draft_access('e0500000-0000-4000-8000-000000000001',
 'e0600000-0000-4000-8000-000000000001',
 'e0800000-0000-4000-8000-000000000001',true),false,
 'revoked case assignment immediately removes draft write access');
select is((select count(*)::integer from public.client_tocc_draft_snapshot(
 'e0500000-0000-4000-8000-000000000001','e0600000-0000-4000-8000-000000000001')),0,
 'revoked case assignment removes existing drafts from projection');
select throws_ok($$select pg_temp.save('create',pg_temp.payload(
 'e0800000-0000-4000-8000-000000000001','e0900000-0000-4000-8000-000000000006'),
 gen_random_uuid())$$,'42501',null,'revoked case cannot create another unsigned draft');
reset role;
select * from finish();
rollback;
