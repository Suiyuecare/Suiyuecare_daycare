begin;
select plan(35);

select ok((select prosecdef and proconfig @> array['search_path=""']
 from pg_proc where oid='private.questionnaire_assessment_snapshot_guarded(uuid,uuid,text,uuid)'::regprocedure),
 'replaced private snapshot retains SECURITY DEFINER with an empty search path');
select ok(has_function_privilege('authenticated',
 'private.questionnaire_assessment_snapshot_guarded(uuid,uuid,text,uuid)','execute')
 and not has_function_privilege('anon',
 'private.questionnaire_assessment_snapshot_guarded(uuid,uuid,text,uuid)','execute')
 and not has_function_privilege('service_role',
 'private.questionnaire_assessment_snapshot_guarded(uuid,uuid,text,uuid)','execute'),
 'replacing the function preserves the narrow existing EXECUTE grants');

-- Synthetic Google identity and case data only; exercise the actual admission,
-- scope and public RPCs under the authenticated role.
select set_config('test.questionnaire_amr',floor(extract(epoch from now()-interval '2 minutes'))::text,true);
insert into auth.users(id,aud,role,email,email_confirmed_at,created_at,updated_at) values
 ('b9100000-0000-4000-8000-000000000001','authenticated','authenticated','questionnaire@example.invalid',now()-interval '1 day',now()-interval '1 day',now());
insert into auth.identities(id,provider_id,user_id,identity_data,provider) values
 ('b9200000-0000-4000-8000-000000000001','synthetic-questionnaire-google','b9100000-0000-4000-8000-000000000001',
  '{"sub":"synthetic-questionnaire-google","email":"questionnaire@example.invalid","email_verified":true}','google');
insert into auth.sessions(id,user_id,created_at,aal) values
 ('b9300000-0000-4000-8000-000000000001','b9100000-0000-4000-8000-000000000001',now()-interval '3 minutes','aal1');
insert into auth.mfa_amr_claims(id,session_id,created_at,updated_at,authentication_method) values
 ('b9400000-0000-4000-8000-000000000001','b9300000-0000-4000-8000-000000000001',
  to_timestamp(current_setting('test.questionnaire_amr')::bigint),
  to_timestamp(current_setting('test.questionnaire_amr')::bigint),'oauth');
insert into public.organizations(id,code,name) values
 ('b9500000-0000-4000-8000-000000000001','questionnaire_test','合成量表機構'),
 ('b9500000-0000-4000-8000-000000000002','questionnaire_other','合成他機構');
insert into public.branches(id,organization_id,code,name) values
 ('b9600000-0000-4000-8000-000000000001','b9500000-0000-4000-8000-000000000001','main','合成第一分支'),
 ('b9600000-0000-4000-8000-000000000002','b9500000-0000-4000-8000-000000000001','second','合成第二分支'),
 ('b9600000-0000-4000-8000-000000000003','b9500000-0000-4000-8000-000000000002','foreign','合成他機構分支');
insert into public.profiles(id,display_name,kind) values
 ('b9100000-0000-4000-8000-000000000001','合成評估員','staff');
insert into public.memberships(id,organization_id,branch_id,profile_id,status,starts_at) values
 ('b9700000-0000-4000-8000-000000000001','b9500000-0000-4000-8000-000000000001',
  'b9600000-0000-4000-8000-000000000001','b9100000-0000-4000-8000-000000000001','active',now()-interval '1 day');
insert into public.membership_roles(membership_id,role_id) values
 ('b9700000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000002');
insert into private.executive_access_policy(allowed_user_id,allowed_email,google_subject,enabled,approval_reference) values
 ('b9100000-0000-4000-8000-000000000001','questionnaire@example.invalid',
  'synthetic-questionnaire-google',true,'synthetic questionnaire snapshot test');
insert into public.clients(id,organization_id,branch_id,client_code,display_name,status,admitted_on,ended_on) values
 ('b9800000-0000-4000-8000-000000000001','b9500000-0000-4000-8000-000000000001',
  'b9600000-0000-4000-8000-000000000001','SYN-Q-A','合成甲','active',current_date-10,null),
 ('b9800000-0000-4000-8000-000000000002','b9500000-0000-4000-8000-000000000001',
  'b9600000-0000-4000-8000-000000000001','SYN-Q-B','合成乙','suspended',current_date-10,null),
 ('b9800000-0000-4000-8000-000000000003','b9500000-0000-4000-8000-000000000001',
  'b9600000-0000-4000-8000-000000000002','SYN-Q-C','合成跨分支', 'active',current_date-10,null),
 ('b9800000-0000-4000-8000-000000000004','b9500000-0000-4000-8000-000000000002',
  'b9600000-0000-4000-8000-000000000003','SYN-Q-D','合成跨機構','active',current_date-10,null),
 ('b9800000-0000-4000-8000-000000000005','b9500000-0000-4000-8000-000000000001',
  'b9600000-0000-4000-8000-000000000001','SYN-Q-E','合成已結案','closed',current_date-10,current_date);

create function pg_temp.questionnaire_login() returns void language plpgsql security invoker as $$
begin
 perform set_config('request.jwt.claim.sub','',true);
 perform set_config('request.jwt.claim.role','',true);
 perform set_config('request.jwt.claims',jsonb_build_object(
  'sub','b9100000-0000-4000-8000-000000000001',
  'session_id','b9300000-0000-4000-8000-000000000001',
  'role','authenticated','aud','authenticated','aal','aal1','is_anonymous',false,
  'email','questionnaire@example.invalid','iat',floor(extract(epoch from clock_timestamp())),
  'exp',floor(extract(epoch from clock_timestamp()+interval '30 minutes')),
  'amr',jsonb_build_array(jsonb_build_object('method','oauth',
    'timestamp',current_setting('test.questionnaire_amr')::bigint)))::text,true);
end;
$$;
create function pg_temp.questionnaire_snapshot(
 p_form text default 'spmsq',p_client uuid default null,
 p_org uuid default 'b9500000-0000-4000-8000-000000000001',
 p_branch uuid default 'b9600000-0000-4000-8000-000000000001'
) returns jsonb language sql security invoker as $$
 select public.questionnaire_assessment_snapshot(p_org,p_branch,p_form,p_client);
$$;
create function pg_temp.questionnaire_client(p_snapshot jsonb,p_client uuid)
returns jsonb language sql immutable as $$
 select item from jsonb_array_elements(p_snapshot->'clients') item
 where item->>'clientId'=p_client::text;
$$;
create function pg_temp.spmsq_answers(p_first text) returns jsonb language sql immutable as $$
 select jsonb_object_agg('spmsq_'||lpad(n::text,2,'0'),
  jsonb_build_object('state','answered','value',case when n=1 then p_first else 'correct' end))
 from generate_series(1,10)n;
$$;
create function pg_temp.save_spmsq(p_operation integer,p_client uuid,p_assessed_on date,
 p_first text,p_note text default null,p_previous jsonb default null)
returns jsonb language sql security invoker as $$
 select public.mutate_questionnaire_assessment(
  'b9500000-0000-4000-8000-000000000001','b9600000-0000-4000-8000-000000000001',
  jsonb_build_object('action',case when p_previous is null then 'create' else 'revise' end,
   'client_id',p_client,'form_key','spmsq','form_version','spmsq-pfeiffer-10-education-adjusted-v1',
   'assessed_on',p_assessed_on,'answers',pg_temp.spmsq_answers(p_first),
   'context',case when p_note is null then '{}'::jsonb else jsonb_build_object('qualitative_note',p_note) end)
   || case when p_previous is null then '{}'::jsonb else jsonb_build_object(
    'assessment_key',p_previous->>'assessmentKey','previous_version_id',p_previous->>'versionId',
    'expected_version',(p_previous->>'version')::integer) end,
  ('b9e00000-0000-4000-8000-'||lpad(p_operation::text,12,'0'))::uuid);
$$;

select pg_temp.questionnaire_login();
set local role authenticated;
select ok(public.is_staff_login_allowed(),'synthetic approved Google staff admission succeeds');
select is((pg_temp.questionnaire_snapshot(form)->>'matchingTotal')::integer,2,
 'authorized active and suspended client roster works for '||form)
from unnest(array['spmsq','gds_15','barthel_adl','lawton_iadl','eat10_swallowing','bsrs5',
 'fall_risk_taipei_115','nsi_determine','mna_sf']) form;
select is(pg_temp.questionnaire_client(pg_temp.questionnaire_snapshot(),
 'b9800000-0000-4000-8000-000000000005'),null::jsonb,'closed client absent from roster');
select throws_ok($$select pg_temp.questionnaire_snapshot('spmsq','b9800000-0000-4000-8000-000000000005')$$,
 '42501',null,'closed selected client fails closed');
select throws_ok($$select pg_temp.questionnaire_snapshot('spmsq','b9800000-0000-4000-8000-000000000003')$$,
 '42501',null,'cross-branch selected client denied');
select throws_ok($$select pg_temp.questionnaire_snapshot('spmsq',null,
 'b9500000-0000-4000-8000-000000000001','b9600000-0000-4000-8000-000000000002')$$,
 '42501',null,'branch-limited staff cannot request another branch roster');
select throws_ok($$select pg_temp.questionnaire_snapshot('spmsq','b9800000-0000-4000-8000-000000000004')$$,
 '42501',null,'cross-organization selected client denied');

select set_config('test.questionnaire_first',pg_temp.save_spmsq(1,
 'b9800000-0000-4000-8000-000000000001',(clock_timestamp() at time zone 'Asia/Taipei')::date-1,
 'correct','合成甲較新評估')::text,true);
select set_config('test.questionnaire_second',pg_temp.save_spmsq(2,
 'b9800000-0000-4000-8000-000000000001',(clock_timestamp() at time zone 'Asia/Taipei')::date-2,
 'incorrect','合成甲較舊評估')::text,true);
select set_config('test.questionnaire_other',pg_temp.save_spmsq(3,
 'b9800000-0000-4000-8000-000000000002',(clock_timestamp() at time zone 'Asia/Taipei')::date-1,
 'incorrect','合成乙私有評估')::text,true);
select set_config('test.questionnaire_revision',pg_temp.save_spmsq(4,
 'b9800000-0000-4000-8000-000000000001',(clock_timestamp() at time zone 'Asia/Taipei')::date-1,
 'correct','合成甲較新評估修訂',current_setting('test.questionnaire_first')::jsonb)::text,true);
select isnt(current_setting('test.questionnaire_first')::jsonb->>'assessmentKey',
 current_setting('test.questionnaire_second')::jsonb->>'assessmentKey',
 'two legal create operations retain distinct assessment histories');
select is((pg_temp.questionnaire_snapshot()->>'matchingTotal')::integer,2,
 'two histories for the same client do not break unselected roster');
select ok(pg_temp.questionnaire_snapshot()::text not like '%"answers"%' and
 pg_temp.questionnaire_snapshot()::text not like '%"context"%',
 'unselected roster serializes no answer or context payload');
select ok((select bool_and(item->'latest'='null'::jsonb)
 from jsonb_array_elements(pg_temp.questionnaire_snapshot()->'clients') item),
 'all unselected client entries have null draft details');
select is((pg_temp.questionnaire_snapshot('spmsq','b9800000-0000-4000-8000-000000000001')->>'matchingTotal')::integer,
 2,'selected client snapshot keeps both authorized selector options');
select is(pg_temp.questionnaire_client(pg_temp.questionnaire_snapshot('spmsq','b9800000-0000-4000-8000-000000000001'),
 'b9800000-0000-4000-8000-000000000001')->'latest'->>'assessmentKey',
 current_setting('test.questionnaire_first')::jsonb->>'assessmentKey',
 'latest clinical assessment date wins over a later-saved older assessment');
select is((pg_temp.questionnaire_client(pg_temp.questionnaire_snapshot('spmsq','b9800000-0000-4000-8000-000000000001'),
 'b9800000-0000-4000-8000-000000000001')->'latest'->>'version')::integer,2,
 'latest version within selected assessment history is returned');
select is(pg_temp.questionnaire_client(pg_temp.questionnaire_snapshot('spmsq','b9800000-0000-4000-8000-000000000001'),
 'b9800000-0000-4000-8000-000000000001')->'latest'->'context'->>'qualitative_note',
 '合成甲較新評估修訂','selected draft contains only its current version content');
select is(pg_temp.questionnaire_client(pg_temp.questionnaire_snapshot('spmsq','b9800000-0000-4000-8000-000000000001'),
 'b9800000-0000-4000-8000-000000000002')->'latest','null'::jsonb,
 'other authorized selector option has no draft content');
select ok(pg_temp.questionnaire_snapshot('spmsq','b9800000-0000-4000-8000-000000000001')::text
 not like '%合成乙私有評估%', 'selected A payload excludes B qualitative answers');
select is(pg_temp.questionnaire_client(pg_temp.questionnaire_snapshot('spmsq','b9800000-0000-4000-8000-000000000002'),
 'b9800000-0000-4000-8000-000000000002')->'latest'->'context'->>'qualitative_note',
 '合成乙私有評估','switching to B loads B draft');
select is(pg_temp.questionnaire_client(pg_temp.questionnaire_snapshot('spmsq','b9800000-0000-4000-8000-000000000002'),
 'b9800000-0000-4000-8000-000000000001')->'latest','null'::jsonb,
 'switching to B does not include A draft');
reset role;
select is((select metadata->>'answer_scope' from public.audit_events
 where metadata->>'workflow'='questionnaire_assessment_snapshot_v2'
 order by occurred_at desc,id desc limit 1),'selected_client_only',
 'audit metadata states the selected-only answer scope');

insert into public.clients(id,organization_id,branch_id,client_code,display_name,admitted_on)
select ('b98f0000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,
 'b9500000-0000-4000-8000-000000000001','b9600000-0000-4000-8000-000000000001',
 'SYN-Q-BULK-'||n,'合成大量個案 '||n,current_date-10
from generate_series(1,498)n;
set local role authenticated;
select is((pg_temp.questionnaire_snapshot()->>'matchingTotal')::integer,500,
 '500-client authorized selector remains complete');
select ok(pg_temp.questionnaire_snapshot()::text not like '%"answers"%',
 '500-client unselected roster still serializes no answer payload');
reset role;

delete from public.role_permissions where role_id='10000000-0000-4000-8000-000000000002'
 and permission_id=(select id from public.permissions where permission_key='clients.view_all');
insert into public.client_assignments(organization_id,branch_id,client_id,assignee_user_id,assignment_kind,starts_at)
values('b9500000-0000-4000-8000-000000000001','b9600000-0000-4000-8000-000000000001',
 'b9800000-0000-4000-8000-000000000001','b9100000-0000-4000-8000-000000000001','synthetic',now()-interval '1 day');
set local role authenticated;
select is((pg_temp.questionnaire_snapshot()->>'matchingTotal')::integer,1,
 'without view_all only assigned clients appear in the roster');
select throws_ok($$select pg_temp.questionnaire_snapshot('spmsq','b9800000-0000-4000-8000-000000000002')$$,
 '42501',null,'unassigned selected client remains denied');
select is(pg_temp.questionnaire_client(pg_temp.questionnaire_snapshot('spmsq','b9800000-0000-4000-8000-000000000001'),
 'b9800000-0000-4000-8000-000000000002'),null::jsonb,
 'selected assigned client response omits other same-branch client');

select * from finish();
rollback;
