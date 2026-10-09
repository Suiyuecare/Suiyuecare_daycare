begin;
select plan(15);

select ok(
  (select prosecdef and coalesce(proconfig,'{}'::text[]) @> array['search_path=""']
   from pg_proc where oid = 'private.assert_client_ids_service_day_locked(uuid,uuid,date,uuid[])'::regprocedure)
  and not has_function_privilege('anon',
    'private.assert_client_ids_service_day_locked(uuid,uuid,date,uuid[])','execute')
  and not has_function_privilege('authenticated',
    'private.assert_client_ids_service_day_locked(uuid,uuid,date,uuid[])','execute')
  and not has_function_privilege('service_role',
    'private.assert_client_ids_service_day_locked(uuid,uuid,date,uuid[])','execute'),
  'array guard is restricted to internal database execution'
);

select is((select count(*)::integer from pg_trigger where not tgisinternal
  and tgname in ('activity_participants_service_day_guard',
    'meal_attendees_service_day_guard',
    'selected_calendar_clients_service_day_guard',
    'document_print_client_service_day_guard')),
  4, 'four formal participant and document tables have insert guards');

insert into auth.users(instance_id,id,aud,role,email,encrypted_password,
  email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
values ('00000000-0000-0000-0000-000000000000',
  '97610000-0000-4000-8000-000000000001','authenticated','authenticated',
  'pending-array-worker@example.invalid','',now(),'{}','{}',now(),now());
insert into public.organizations(id,code,name) values
  ('97620000-0000-4000-8000-000000000001','arr_a','合成陣列機構 A');
insert into public.branches(id,organization_id,code,name) values
  ('97630000-0000-4000-8000-000000000001','97620000-0000-4000-8000-000000000001','main','合成 A 分支'),
  ('97630000-0000-4000-8000-000000000002','97620000-0000-4000-8000-000000000001','other','合成 B 分支');
insert into public.profiles(id,display_name,kind) values
  ('97610000-0000-4000-8000-000000000001','合成照護員','staff');
insert into public.clients(id,organization_id,branch_id,client_code,display_name,status,admitted_on) values
  ('97640000-0000-4000-8000-000000000001','97620000-0000-4000-8000-000000000001','97630000-0000-4000-8000-000000000001','A-1','已收案','active',current_date-30),
  ('97640000-0000-4000-8000-000000000002','97620000-0000-4000-8000-000000000001','97630000-0000-4000-8000-000000000001','A-2','待收案','active',null),
  ('97640000-0000-4000-8000-000000000003','97620000-0000-4000-8000-000000000001','97630000-0000-4000-8000-000000000001','A-3','暫停','suspended',current_date-30),
  ('97640000-0000-4000-8000-000000000004','97620000-0000-4000-8000-000000000001','97630000-0000-4000-8000-000000000002','B-1','他分支','active',current_date-30);

select lives_ok($$select private.assert_client_ids_service_day_locked(
  '97620000-0000-4000-8000-000000000001',
  '97630000-0000-4000-8000-000000000001',current_date,
  array['97640000-0000-4000-8000-000000000001'::uuid])$$,
  'an admitted in-scope client remains eligible');

select lives_ok($$select private.assert_client_ids_service_day_locked(
  '97620000-0000-4000-8000-000000000001',
  '97630000-0000-4000-8000-000000000001',current_date,
  '{}'::uuid[])$$,
  'an institutional activity with no selected clients remains possible');

select throws_ok($$select private.assert_client_ids_service_day_locked(
  '97620000-0000-4000-8000-000000000001',
  '97630000-0000-4000-8000-000000000001',current_date,
  array['97640000-0000-4000-8000-000000000002'::uuid])$$,
  '23514','client is not admitted for formal service day',
  'an active shell without an admission date cannot be selected');

select throws_ok($$select private.assert_client_ids_service_day_locked(
  '97620000-0000-4000-8000-000000000001',
  '97630000-0000-4000-8000-000000000001',current_date,
  array['97640000-0000-4000-8000-000000000003'::uuid])$$,
  '23514','client is not admitted for formal service day',
  'a suspended client cannot be selected');

select throws_ok($$select private.assert_client_ids_service_day_locked(
  '97620000-0000-4000-8000-000000000001',
  '97630000-0000-4000-8000-000000000001',current_date,
  array['97640000-0000-4000-8000-000000000004'::uuid])$$,
  '23514','client is not admitted for formal service day',
  'another branch cannot be selected');

select throws_ok($$select private.assert_client_ids_service_day_locked(
  '97620000-0000-4000-8000-000000000001',
  '97630000-0000-4000-8000-000000000001',current_date,
  array['97640000-0000-4000-8000-000000000099'::uuid])$$,
  '23514','client is not admitted for formal service day',
  'a nonexistent client cannot be selected');

select throws_ok($$select private.assert_client_ids_service_day_locked(
  '97620000-0000-4000-8000-000000000001',
  '97630000-0000-4000-8000-000000000001',current_date,
  array[null::uuid])$$,
  '23514','client list is not valid for formal service',
  'a null UUID is rejected');

select throws_ok($$select private.assert_client_ids_service_day_locked(
  '97620000-0000-4000-8000-000000000001',
  '97630000-0000-4000-8000-000000000001',current_date,
  array['97640000-0000-4000-8000-000000000001'::uuid,
    '97640000-0000-4000-8000-000000000001'::uuid])$$,
  '23514','client list is not valid for formal service',
  'duplicate client IDs are rejected');

select throws_ok($$select private.assert_client_ids_service_day_locked(
  '97620000-0000-4000-8000-000000000001',
  '97630000-0000-4000-8000-000000000001',date '1999-01-01',
  array['97640000-0000-4000-8000-000000000001'::uuid])$$,
  '23514','client list is not valid for formal service',
  'invalid service dates fail closed');

select throws_ok($$insert into public.activity_schedule_versions(
  organization_id,branch_id,activity_id,version,previous_version_id,revision_reason,
  activity_type,title,search_summary,location,starts_at,ends_at,responsible_user_id,
  responsible_display_name,capacity,participants,created_by,creator_display_name,
  created_at,content_hash)
values ('97620000-0000-4000-8000-000000000001',
  '97630000-0000-4000-8000-000000000001',gen_random_uuid(),1,null,null,
  '健康促進','待收案不可排入','合成資料','活動室',
  clock_timestamp()+interval '2 days',clock_timestamp()+interval '2 days 1 hour',
  '97610000-0000-4000-8000-000000000001','合成照護員',10,
  '[{"client_id":"97640000-0000-4000-8000-000000000002"}]'::jsonb,
  '97610000-0000-4000-8000-000000000001','合成照護員',clock_timestamp(),repeat('a',64))$$,
  '23514','client is not admitted for formal service day',
  'a direct activity insert cannot bypass the pending-client guard');

select lives_ok($$insert into public.activity_schedule_versions(
  organization_id,branch_id,activity_id,version,previous_version_id,revision_reason,
  activity_type,title,search_summary,location,starts_at,ends_at,responsible_user_id,
  responsible_display_name,capacity,participants,created_by,creator_display_name,
  created_at,content_hash)
values ('97620000-0000-4000-8000-000000000001',
  '97630000-0000-4000-8000-000000000001',gen_random_uuid(),1,null,null,
  '健康促進','已收案可排入','合成資料','活動室',
  clock_timestamp()+interval '2 days',clock_timestamp()+interval '2 days 1 hour',
  '97610000-0000-4000-8000-000000000001','合成照護員',10,
  '[{"client_id":"97640000-0000-4000-8000-000000000001"}]'::jsonb,
  '97610000-0000-4000-8000-000000000001','合成照護員',clock_timestamp(),repeat('b',64))$$,
  'an admitted client can still be scheduled in an activity');

select is((select count(*)::integer from public.activity_schedule_versions
  where organization_id='97620000-0000-4000-8000-000000000001'),1,
  'rejected direct activity write leaves no partial formal record');

select ok(position('assert_client_ids_service_day_locked' in
  pg_get_functiondef('private.guard_meal_attendees_service_day()'::regprocedure))>0
  and position('assert_client_ids_service_day_locked' in
  pg_get_functiondef('private.guard_document_print_client_service_day()'::regprocedure))>0
  and position('assert_client_ids_service_day_locked' in
  pg_get_functiondef('private.guard_selected_calendar_clients_service_day()'::regprocedure))>0,
  'meal, document and selected calendar inserts reuse the same locked guard');

select * from finish();
rollback;
