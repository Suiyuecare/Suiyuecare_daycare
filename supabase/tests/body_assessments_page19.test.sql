begin;
select plan(32);
select ok((select bool_and(relrowsecurity and relforcerowsecurity) from pg_class where oid in
 ('public.body_assessment_versions'::regclass,'private.body_assessment_operations'::regclass)),'both ledgers force RLS');
select ok(not has_table_privilege('authenticated','public.body_assessment_versions','select,insert,update,delete')
 and not has_table_privilege('service_role','public.body_assessment_versions','select,insert,update,delete'),'no direct browser or service role table access');
select ok(has_function_privilege('authenticated','public.mutate_body_assessment(uuid,uuid,jsonb,uuid)','execute')
 and not has_function_privilege('anon','public.mutate_body_assessment(uuid,uuid,jsonb,uuid)','execute')
 and not has_function_privilege('service_role','public.mutate_body_assessment(uuid,uuid,jsonb,uuid)','execute'),'only authenticated RPC access');
select ok(not (select prosecdef from pg_proc where oid='public.mutate_body_assessment(uuid,uuid,jsonb,uuid)'::regprocedure)
 and (select prosecdef and proconfig @> array['search_path=""'] from pg_proc where oid='private.mutate_body_assessment_guarded(uuid,uuid,jsonb,uuid)'::regprocedure),'invoker wrapper and constrained private definer');
select ok(not private.body_observations_valid('[{"area":"back","state":"missing","description":null,"reason":null,"disposition":null}]',false),'missing observations need reason');
select ok(not private.body_observations_valid('[{"area":"back","state":"normal","description":null,"reason":null,"disposition":null},{"area":"back","state":"normal","description":null,"reason":null,"disposition":null}]',false),'duplicate body areas denied');
select ok(private.body_observations_valid('[{"area":"back","state":"abnormal","description":null,"reason":null,"disposition":null}]',false)
 and not private.body_observations_valid('[{"area":"back","state":"abnormal","description":null,"reason":null,"disposition":null}]',true),'abnormal draft can be incomplete but cannot be signed');

insert into auth.users(id,aud,role,email,created_at,updated_at) values
 ('19000000-1000-4000-8000-000000000001','authenticated','authenticated','body-worker@example.invalid',now(),now()),
 ('19000000-1000-4000-8000-000000000002','authenticated','authenticated','body-outsider@example.invalid',now(),now());
insert into public.organizations(id,code,name) values('19000000-2000-4000-8000-000000000001','body-test','合成身體觀察機構');
insert into public.branches(id,organization_id,code,name) values
 ('19000000-3000-4000-8000-000000000001','19000000-2000-4000-8000-000000000001','main','合成主分支'),
 ('19000000-3000-4000-8000-000000000002','19000000-2000-4000-8000-000000000001','other','合成他分支');
insert into public.profiles(id,display_name,kind) values
 ('19000000-1000-4000-8000-000000000001','合成照服員','staff'),('19000000-1000-4000-8000-000000000002','合成未指派員工','staff');
insert into public.memberships(id,organization_id,branch_id,profile_id,status) values
 ('19000000-4000-4000-8000-000000000001','19000000-2000-4000-8000-000000000001','19000000-3000-4000-8000-000000000001','19000000-1000-4000-8000-000000000001','active'),
 ('19000000-4000-4000-8000-000000000002','19000000-2000-4000-8000-000000000001','19000000-3000-4000-8000-000000000001','19000000-1000-4000-8000-000000000002','active');
insert into public.membership_roles(membership_id,role_id) select m.id,r.id from public.memberships m cross join public.roles r
 where m.organization_id='19000000-2000-4000-8000-000000000001' and r.is_system and r.role_key='care_worker';
insert into public.clients(id,organization_id,branch_id,client_code,display_name,status,admitted_on) values
 ('19000000-5000-4000-8000-000000000001','19000000-2000-4000-8000-000000000001','19000000-3000-4000-8000-000000000001','BODY-1','合成個案甲','active',current_date-30),
 ('19000000-5000-4000-8000-000000000002','19000000-2000-4000-8000-000000000001','19000000-3000-4000-8000-000000000001','BODY-2','合成未指派個案','active',current_date-30);
insert into public.client_assignments(id,organization_id,branch_id,client_id,assignee_user_id,assignment_kind) values
 ('19000000-6000-4000-8000-000000000001','19000000-2000-4000-8000-000000000001','19000000-3000-4000-8000-000000000001','19000000-5000-4000-8000-000000000001','19000000-1000-4000-8000-000000000001','daily-care');
create temporary table body_results(label text primary key, receipt jsonb);
grant select,insert on body_results to authenticated;
create function pg_temp.body_payload(p_action text default 'create',p_base text default null,p_complete boolean default false) returns jsonb language sql as $$
 select jsonb_build_object('action',p_action,'client_id','19000000-5000-4000-8000-000000000001',
  'assessment_key',r.receipt->'assessment_key','previous_version_id',r.receipt->'version_id','expected_version',coalesce((r.receipt->>'version')::integer,0),
  'expected_content_hash',r.receipt->'content_hash','reason',case when p_action='sign' then '本人確認已核對所選部位的人工觀察與處置' else '合成測試人工確認與紀錄理由' end)
  || case when p_action='sign' then '{}'::jsonb else jsonb_build_object('instrument','manual_nonstandard_body_observation_v1',
   'observed_at','2026-09-07T01:00:00.000Z','observations',jsonb_build_array(jsonb_build_object('area','left_arm','state','abnormal',
    'description',case when p_complete then '合成手臂泛紅觀察' end,'reason',null,'disposition',case when p_complete then '合成人員已確認並安排追蹤' end))) end
 from (select (select receipt from body_results where label=p_base) as receipt) r;
$$;
create function pg_temp.body_mutate(p_body jsonb,p_key integer) returns jsonb language sql as $$
 select to_jsonb(r) from public.mutate_body_assessment('19000000-2000-4000-8000-000000000001','19000000-3000-4000-8000-000000000001',p_body,
  ('19000000-8000-4000-8000-'||lpad(p_key::text,12,'0'))::uuid) r;
$$;

set local role authenticated;
select set_config('request.jwt.claims','{"sub":"19000000-1000-4000-8000-000000000001","role":"authenticated","aal":"aal1","session_id":"19000000-7000-4000-8000-000000000001"}',true);
select throws_ok($$select pg_temp.body_mutate(pg_temp.body_payload(),1)$$,'42501','body assessment operation is not permitted','AAL1 denied');
select set_config('request.jwt.claims','{"sub":"19000000-1000-4000-8000-000000000001","role":"authenticated","aal":"aal2","session_id":"19000000-7000-4000-8000-000000000001"}',true);
select throws_ok($$select * from public.body_assessment_snapshot('19000000-2000-4000-8000-000000000001','19000000-3000-4000-8000-000000000002')$$,
 '42501','body assessment snapshot is not permitted','other branch denied');
select throws_ok($$select pg_temp.body_mutate(pg_temp.body_payload()||'{"client_id":"19000000-5000-4000-8000-000000000002"}',1)$$,
 '42501','body assessment client is not permitted','unassigned client denied');
select throws_ok($$select pg_temp.body_mutate(pg_temp.body_payload()||'{"automatic_score":0}',1)$$,
 '22023','invalid body assessment payload','unknown score key denied at database');
insert into body_results values('draft',pg_temp.body_mutate(pg_temp.body_payload(),1));
select is((select receipt->>'record_state' from body_results where label='draft'),'draft','create persists draft');
select is((pg_temp.body_mutate(pg_temp.body_payload(),1)->>'replayed')::boolean,true,'actor-bound exact request replay');
select throws_ok($$select pg_temp.body_mutate(pg_temp.body_payload()||'{"reason":"不同建立內容"}',1)$$,
 '23505','body assessment idempotency conflict','changed content cannot reuse key');
select throws_ok($$select pg_temp.body_mutate(pg_temp.body_payload('sign','draft'),2)$$,
 '42501','body assessment requires recent same-session AAL2','sign denied without recent factor evidence');
reset role;
insert into private.reauth_challenges(id,user_id,session_id,nonce_sha256,idempotency_key,issued_jwt_iat,created_at,expires_at,
 consumed_at,consumed_jwt_iat,factor_method,factor_verified_at) values
 ('19000000-9000-4000-8000-000000000001','19000000-1000-4000-8000-000000000001','19000000-7000-4000-8000-000000000001',repeat('a',64),
 '19000000-9000-4000-8000-000000000002',clock_timestamp()-interval '2 minutes',clock_timestamp()-interval '2 minutes',clock_timestamp()+interval '5 minutes',
 clock_timestamp()-interval '30 seconds',clock_timestamp()-interval '30 seconds','totp',clock_timestamp()-interval '30 seconds');
insert into private.reauth_events(user_id,session_id,challenge_id,aal,verification_method,verified_at)
select user_id,session_id,id,'aal2','totp',factor_verified_at from private.reauth_challenges where id='19000000-9000-4000-8000-000000000001';
set local role authenticated;
select throws_ok($$select pg_temp.body_mutate(pg_temp.body_payload('sign','draft'),2)$$,'23514',
 'abnormal body observations require description and human disposition before signing','incomplete abnormal observations cannot sign');
insert into body_results values('revised',pg_temp.body_mutate(pg_temp.body_payload('revise','draft',true),3));
select is((select receipt->>'version' from body_results where label='revised'),'2','draft revision appends version');
select throws_ok($$select pg_temp.body_mutate(pg_temp.body_payload('revise','draft',true),4)$$,
 '40001','body assessment version is stale','stale previous version denied');
insert into body_results values('signed',pg_temp.body_mutate(pg_temp.body_payload('sign','revised'),5));
select is((select receipt->>'record_state' from body_results where label='signed'),'signed','completed observations sign');
select throws_ok($$select pg_temp.body_mutate(pg_temp.body_payload('revise','signed',true),6)$$,
 '23514','body assessment state transition is invalid','signed content cannot be draft-revised');
insert into body_results values('corrected',pg_temp.body_mutate(pg_temp.body_payload('correct','signed',true),7));
select is((select receipt->>'version' from body_results where label='corrected'),'4','correction appends fourth version');
select is((select jsonb_array_length(records->0->'history') from public.body_assessment_snapshot('19000000-2000-4000-8000-000000000001','19000000-3000-4000-8000-000000000001')),3,'snapshot includes prior content versions');
select is((select client_total from public.body_assessment_snapshot('19000000-2000-4000-8000-000000000001','19000000-3000-4000-8000-000000000001')),1::bigint,'snapshot lists assigned clients only');
select is((select attachment_status from public.body_assessment_snapshot('19000000-2000-4000-8000-000000000001','19000000-3000-4000-8000-000000000001')),'not_configured','attachment provider is honestly absent');
select ok((select receipt->'request_payload'=pg_temp.body_payload('correct','signed',true)
 and receipt->>'actor_user_id'='19000000-1000-4000-8000-000000000001' and receipt->>'client_id'='19000000-5000-4000-8000-000000000001'
 from body_results where label='corrected'),'receipt binds original request actor and client');
reset role;
select is((select count(*) from public.body_assessment_versions where organization_id='19000000-2000-4000-8000-000000000001'),4::bigint,'retry does not duplicate versions');
select throws_ok($$update public.body_assessment_versions set reason='attempt overwrite' where organization_id='19000000-2000-4000-8000-000000000001'$$,
 '55000','body assessment history is append-only','updates denied even to owner');
select throws_ok($$delete from private.body_assessment_operations where organization_id='19000000-2000-4000-8000-000000000001'$$,
 '55000','body assessment history is append-only','receipt ledger cannot be deleted');
update private.reauth_events set revoked_at=clock_timestamp() where user_id='19000000-1000-4000-8000-000000000001';
set local role authenticated;
select throws_ok($$select pg_temp.body_mutate(pg_temp.body_payload('sign','revised'),5)$$,
 '42501','body assessment requires recent same-session AAL2','signed replay requires current unrevoked factor evidence');
reset role;
update public.client_assignments set starts_at=clock_timestamp()-interval '1 hour',ends_at=clock_timestamp()-interval '1 second' where id='19000000-6000-4000-8000-000000000001';
set local role authenticated;
select throws_ok($$select pg_temp.body_mutate(pg_temp.body_payload(),1)$$,
 '42501','body assessment client is not permitted','assignment expiry blocks old draft receipt replay');
select is((select matching_total from public.body_assessment_snapshot('19000000-2000-4000-8000-000000000001','19000000-3000-4000-8000-000000000001')),0::bigint,'expired assignment removes records from snapshot');
reset role;
update public.organizations set is_active=false where id='19000000-2000-4000-8000-000000000001';
set local role authenticated;
select throws_ok($$select * from public.body_assessment_snapshot('19000000-2000-4000-8000-000000000001','19000000-3000-4000-8000-000000000001')$$,
 '42501','body assessment snapshot is not permitted','inactive organization is denied');
reset role;
select * from finish();
rollback;
