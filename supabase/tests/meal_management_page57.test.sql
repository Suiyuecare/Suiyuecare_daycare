begin;

select plan(37);

select results_eq(
  $$select permission_key collate "C" from public.permissions
    where permission_key like 'meals.%' order by permission_key collate "C"$$,
  $$values ('meals.confirm'::text collate "C"),
    ('meals.manage'::text collate "C"),('meals.read'::text collate "C")$$,
  'Page 57 exposes three narrow meal-management permissions'
);

select ok(exists(
  select 1 from public.role_permissions rp
  join public.roles r on r.id=rp.role_id
  join public.permissions p on p.id=rp.permission_id
  where r.role_key='nurse' and p.permission_key='meals.confirm'
) and not exists(
  select 1 from public.role_permissions rp
  join public.roles r on r.id=rp.role_id
  join public.permissions p on p.id=rp.permission_id
  where r.role_key='care_worker' and p.permission_key='meals.confirm'
), 'confirmation is narrower than ordinary meal-plan management');

select is((select count(*)::integer from pg_class where oid in (
  'public.meal_requirement_versions'::regclass,
  'public.meal_plan_versions'::regclass,
  'private.meal_management_operations'::regclass
) and relrowsecurity and relforcerowsecurity),3,'all Page-57 stores force RLS');

select ok(
  not has_table_privilege('authenticated','public.meal_requirement_versions','select,insert,update,delete')
  and not has_table_privilege('authenticated','public.meal_plan_versions','select,insert,update,delete')
  and not has_table_privilege('service_role','private.meal_management_operations','select,insert,update,delete'),
  'browser and service roles cannot bypass guarded meal RPCs'
);

select ok(
  has_function_privilege('authenticated','public.mutate_meal_management(uuid,uuid,text,jsonb,uuid)','execute')
  and has_function_privilege('authenticated','public.meal_management_snapshot(uuid,uuid,date,text,text,text)','execute')
  and not has_function_privilege('anon','public.mutate_meal_management(uuid,uuid,text,jsonb,uuid)','execute')
  and not has_function_privilege('service_role','public.meal_management_snapshot(uuid,uuid,date,text,text,text)','execute'),
  'only authenticated callers receive the narrow public RPC surface'
);

select ok(
  not (select prosecdef from pg_proc where oid='public.mutate_meal_management(uuid,uuid,text,jsonb,uuid)'::regprocedure)
  and not (select prosecdef from pg_proc where oid='public.meal_management_snapshot(uuid,uuid,date,text,text,text)'::regprocedure)
  and (select prosecdef and coalesce(proconfig,'{}'::text[]) @> array['search_path=""']
    from pg_proc where oid='private.mutate_meal_management_guarded(uuid,uuid,text,jsonb,uuid)'::regprocedure)
  and (select prosecdef and coalesce(proconfig,'{}'::text[]) @> array['search_path=""']
    from pg_proc where oid='private.meal_management_snapshot_response(uuid,uuid,date,text,text,text)'::regprocedure),
  'public wrappers are invokers and private cores are pinned definers'
);

select is((select count(*)::integer from pg_trigger where not tgisinternal and tgname in (
  'meal_requirement_versions_append_only','meal_plan_versions_append_only',
  'meal_management_operations_append_only'
)),3,'requirements, plans, and receipts are append-only');

select is((select count(*)::integer from pg_trigger where not tgisinternal and tgname in (
  'meal_requirement_versions_audit_row_change','meal_plan_versions_audit_row_change',
  'meal_management_operations_audit_row_change'
)),3,'all committed Page-57 streams have exact audit triggers');

select ok(exists(select 1 from pg_indexes where schemaname='private'
  and tablename='meal_management_operations' and indexdef ~ '\(actor_user_id, idempotency_key\)'),
  'operation actor and idempotency lookup is indexed');

select ok(private.meal_reference_items_are_valid('[]'::jsonb,true)
  and not private.meal_reference_items_are_valid('[]'::jsonb,false),
  'explicit empty disclosure lists are valid only when the state permits them');

select ok(not private.meal_reference_items_are_valid(
  '[{"code":"peanut","label":"花生"},{"code":"peanut","label":"花生重複"}]'::jsonb,false),
  'duplicate structured reference codes fail closed');

-- Synthetic identities and tenant data only.
insert into auth.users(instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,
  raw_app_meta_data,raw_user_meta_data,created_at,updated_at) values
  ('00000000-0000-0000-0000-000000000000','57010000-0000-4000-8000-000000000001','authenticated','authenticated','page57-manager-a@example.invalid','',now(),'{}','{}',now(),now()),
  ('00000000-0000-0000-0000-000000000000','57010000-0000-4000-8000-000000000002','authenticated','authenticated','page57-manager-b@example.invalid','',now(),'{}','{}',now(),now());
insert into public.organizations(id,code,name) values
  ('57020000-0000-4000-8000-000000000001','page57_a','餐食合成機構甲'),
  ('57020000-0000-4000-8000-000000000002','page57_b','餐食合成機構乙');
insert into public.branches(id,organization_id,code,name) values
  ('57030000-0000-4000-8000-000000000001','57020000-0000-4000-8000-000000000001','main','餐食合成分支甲'),
  ('57030000-0000-4000-8000-000000000002','57020000-0000-4000-8000-000000000002','main','餐食合成分支乙');
insert into public.profiles(id,display_name,kind,employee_code) values
  ('57010000-0000-4000-8000-000000000001','合成餐食主管甲','staff','P57-A'),
  ('57010000-0000-4000-8000-000000000002','合成餐食主管乙','staff','P57-B');
insert into public.memberships(id,organization_id,branch_id,profile_id,status) values
  ('57040000-0000-4000-8000-000000000001','57020000-0000-4000-8000-000000000001','57030000-0000-4000-8000-000000000001','57010000-0000-4000-8000-000000000001','active'),
  ('57040000-0000-4000-8000-000000000002','57020000-0000-4000-8000-000000000002','57030000-0000-4000-8000-000000000002','57010000-0000-4000-8000-000000000002','active');
insert into public.membership_roles(membership_id,role_id) values
  ('57040000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000002'),
  ('57040000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000002');
insert into public.clients(id,organization_id,branch_id,client_code,display_name,status,admitted_on) values
  ('57060000-0000-4000-8000-000000000001','57020000-0000-4000-8000-000000000001','57030000-0000-4000-8000-000000000001','P57-A-001','合成餐食個案甲','active','2026-01-01'),
  ('57060000-0000-4000-8000-000000000002','57020000-0000-4000-8000-000000000001','57030000-0000-4000-8000-000000000001','P57-A-002','合成餐食個案乙','active','2026-01-01'),
  ('57060000-0000-4000-8000-000000000003','57020000-0000-4000-8000-000000000002','57030000-0000-4000-8000-000000000002','P57-B-001','合成他機構個案','active','2026-01-01');

insert into private.reauth_challenges(id,user_id,session_id,nonce_sha256,idempotency_key,
  issued_jwt_iat,created_at,expires_at,consumed_at,consumed_jwt_iat,
  factor_method,factor_verified_at) values
  ('57050000-0000-4000-8000-000000000001','57010000-0000-4000-8000-000000000001','57051000-0000-4000-8000-000000000001',repeat('a',64),'57052000-0000-4000-8000-000000000001',now()-interval '2 minutes',now()-interval '2 minutes',now()+interval '5 minutes',now()-interval '30 seconds',now()-interval '30 seconds','totp',now()-interval '30 seconds'),
  ('57050000-0000-4000-8000-000000000002','57010000-0000-4000-8000-000000000002','57051000-0000-4000-8000-000000000002',repeat('b',64),'57052000-0000-4000-8000-000000000002',now()-interval '2 minutes',now()-interval '2 minutes',now()+interval '5 minutes',now()-interval '30 seconds',now()-interval '30 seconds','totp',now()-interval '30 seconds');
insert into private.reauth_events(user_id,session_id,challenge_id,aal,verification_method,verified_at) values
  ('57010000-0000-4000-8000-000000000001','57051000-0000-4000-8000-000000000001','57050000-0000-4000-8000-000000000001','aal2','totp',now()-interval '30 seconds'),
  ('57010000-0000-4000-8000-000000000002','57051000-0000-4000-8000-000000000002','57050000-0000-4000-8000-000000000002','aal2','totp',now()-interval '30 seconds');

set local role authenticated;
select set_config('request.jwt.claims','{"sub":"57010000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal1","session_id":"57051000-0000-4000-8000-000000000001"}',true);

select throws_ok($$select * from public.mutate_meal_management(
  '57020000-0000-4000-8000-000000000001','57030000-0000-4000-8000-000000000001','set_requirement',
  '{"client_id":"57060000-0000-4000-8000-000000000001","previous_version_id":null,"expected_version":0,"effective_from":"2026-09-02","texture_state":"recorded","texture_label":"軟質","allergy_status":"recorded","allergens":[{"code":"peanut","label":"花生"}],"contraindication_status":"none_declared","contraindications":[],"note":null}',
  '57070000-0000-4000-8000-000000000001')$$,'42501','meal operation is not permitted',
  'AAL1 is rejected before a requirement can be committed');

select set_config('request.jwt.claims','{"sub":"57010000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2","session_id":"57051000-0000-4000-8000-000000000001"}',true);

select throws_ok($$select * from public.mutate_meal_management(
  '57020000-0000-4000-8000-000000000002','57030000-0000-4000-8000-000000000002','set_requirement','{}',
  '57070000-0000-4000-8000-000000000002')$$,'42501','meal operation is not permitted',
  'cross-tenant scope is rejected before payload inspection');

select ok((select payload->>'client_total'='2' and payload->>'matching_plan_total'='0'
  and payload->>'special_texture_total' is null
  and payload->>'texture_taxonomy_status'='manual_unstandardized'
  and payload->>'offline_status'='not_configured'
  from public.meal_management_snapshot('57020000-0000-4000-8000-000000000001',
    '57030000-0000-4000-8000-000000000001','2026-09-02','all','','all')),
  'initial bounded snapshot invents no plan, taxonomy, or offline capability');

create temporary table page57_req_a1 as select * from public.mutate_meal_management(
  '57020000-0000-4000-8000-000000000001','57030000-0000-4000-8000-000000000001','set_requirement',
  '{"client_id":"57060000-0000-4000-8000-000000000001","previous_version_id":null,"expected_version":0,"effective_from":"2026-09-02","texture_state":"recorded","texture_label":"軟質","allergy_status":"recorded","allergens":[{"code":"peanut","label":"花生"}],"contraindication_status":"none_declared","contraindications":[],"note":"合成需求"}',
  '57070000-0000-4000-8000-000000000010');

select ok((select not replayed and action='set_requirement' and entity_type='requirement'
  and client_id='57060000-0000-4000-8000-000000000001' and version=1 and status='recorded'
  from page57_req_a1),'first requirement returns a correlated immutable receipt');

select ok((select replayed and entity_id=(select entity_id from page57_req_a1)
  from public.mutate_meal_management(
    '57020000-0000-4000-8000-000000000001','57030000-0000-4000-8000-000000000001','set_requirement',
    '{"client_id":"57060000-0000-4000-8000-000000000001","previous_version_id":null,"expected_version":0,"effective_from":"2026-09-02","texture_state":"recorded","texture_label":"軟質","allergy_status":"recorded","allergens":[{"code":"peanut","label":"花生"}],"contraindication_status":"none_declared","contraindications":[],"note":"合成需求"}',
    '57070000-0000-4000-8000-000000000010')),
  'exact actor-scoped requirement retry returns the original receipt');

select throws_ok($$select * from public.mutate_meal_management(
  '57020000-0000-4000-8000-000000000001','57030000-0000-4000-8000-000000000001','set_requirement',
  '{"client_id":"57060000-0000-4000-8000-000000000001","previous_version_id":null,"expected_version":0,"effective_from":"2026-09-03","texture_state":"recorded","texture_label":"軟質","allergy_status":"recorded","allergens":[{"code":"peanut","label":"花生"}],"contraindication_status":"none_declared","contraindications":[],"note":"合成需求"}',
  '57070000-0000-4000-8000-000000000010')$$,'23505','meal idempotency conflict',
  'changed payload cannot reuse the same actor key');

select throws_ok($$select * from public.mutate_meal_management(
  '57020000-0000-4000-8000-000000000001','57030000-0000-4000-8000-000000000001','set_requirement',
  '{"client_id":"57060000-0000-4000-8000-000000000002","previous_version_id":null,"expected_version":0,"effective_from":"2026-09-02","texture_state":"recorded","texture_label":null,"allergy_status":"none_declared","allergens":[],"contraindication_status":"none_declared","contraindications":[],"note":null}',
  '57070000-0000-4000-8000-000000000011')$$,'23514','meal requirement is invalid',
  'recorded texture cannot silently omit its label');

create temporary table page57_req_b1 as select * from public.mutate_meal_management(
  '57020000-0000-4000-8000-000000000001','57030000-0000-4000-8000-000000000001','set_requirement',
  '{"client_id":"57060000-0000-4000-8000-000000000002","previous_version_id":null,"expected_version":0,"effective_from":"2026-09-02","texture_state":"missing","texture_label":null,"allergy_status":"unknown","allergens":[],"contraindication_status":"unknown","contraindications":[],"note":null}',
  '57070000-0000-4000-8000-000000000012');
select ok((select version=1 and client_id='57060000-0000-4000-8000-000000000002'
  from page57_req_b1),'unknown and missing states remain explicit instead of becoming empty facts');

select throws_ok($$select * from public.mutate_meal_management(
  '57020000-0000-4000-8000-000000000001','57030000-0000-4000-8000-000000000001','set_requirement',
  jsonb_build_object('client_id','57060000-0000-4000-8000-000000000001','previous_version_id',null,
    'expected_version',0,'effective_from','2026-09-02','texture_state','recorded','texture_label','軟質',
    'allergy_status','recorded','allergens','[{"code":"peanut","label":"花生"}]'::jsonb,
    'contraindication_status','none_declared','contraindications','[]'::jsonb,'note',null),
  '57070000-0000-4000-8000-000000000013')$$,'40001','meal requirement version conflict',
  'stale requirement version is rejected');

create temporary table page57_req_a2 as select * from public.mutate_meal_management(
  '57020000-0000-4000-8000-000000000001','57030000-0000-4000-8000-000000000001','set_requirement',
  jsonb_build_object('client_id','57060000-0000-4000-8000-000000000001',
    'previous_version_id',(select entity_id from page57_req_a1),'expected_version',1,
    'effective_from','2026-09-02','texture_state','recorded','texture_label','軟質',
    'allergy_status','recorded','allergens','[{"code":"peanut","label":"花生"}]'::jsonb,
    'contraindication_status','none_declared','contraindications','[]'::jsonb,'note','合成第二版'),
  '57070000-0000-4000-8000-000000000014');
select ok((select version=2 and stable_key=(select stable_key from page57_req_a1)
  and entity_id<>(select entity_id from page57_req_a1) from page57_req_a2),
  'requirement revision appends a new version under the stable key');

reset role;
insert into public.attendance_records(id,organization_id,branch_id,client_id,service_date,status,
  checked_in_at,idempotency_key,recorded_by) values
  ('57080000-0000-4000-8000-000000000001','57020000-0000-4000-8000-000000000001','57030000-0000-4000-8000-000000000001','57060000-0000-4000-8000-000000000001','2026-09-02','present','2026-09-02 08:00+08','57081000-0000-4000-8000-000000000001','57010000-0000-4000-8000-000000000001'),
  ('57080000-0000-4000-8000-000000000002','57020000-0000-4000-8000-000000000001','57030000-0000-4000-8000-000000000001','57060000-0000-4000-8000-000000000002','2026-09-02','present','2026-09-02 08:05+08','57081000-0000-4000-8000-000000000002','57010000-0000-4000-8000-000000000001');
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"57010000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2","session_id":"57051000-0000-4000-8000-000000000001"}',true);

create temporary table page57_plan1 as select * from public.mutate_meal_management(
  '57020000-0000-4000-8000-000000000001','57030000-0000-4000-8000-000000000001','save_plan',
  '{"previous_version_id":null,"expected_version":0,"service_date":"2026-09-02","meal_kind":"lunch","menu_title":"合成花生米食","ingredients":[{"code":"peanut","label":"花生"},{"code":"rice","label":"米"}],"extra_portions":1}',
  '57070000-0000-4000-8000-000000000020');
select ok((select not replayed and status='review' and attendance_count=2
  and conflict_count=4 and planned_portion_total=3 from page57_plan1),
  'menu review freezes two attendees, one extra portion, and four exact conflicts');

select ok((select payload->>'matching_plan_total'='1'
  and payload->>'expected_portion_total'='3' and payload->>'conflict_total'='4'
  and jsonb_array_length(payload->'plans'->0->'assignment_snapshot')=2
  from public.meal_management_snapshot('57020000-0000-4000-8000-000000000001',
    '57030000-0000-4000-8000-000000000001','2026-09-02','lunch','','with_conflicts')),
  'review snapshot reconciles the same plan, assignments, portions, and conflicts');

reset role;
select ok((select count(*)=1 and max(conflict->>'kind')='allergen_match'
  from public.meal_plan_versions plan,
    lateral jsonb_array_elements(plan.conflict_snapshot) conflict
  where plan.id=(select entity_id from page57_plan1)
    and conflict->>'client_id'='57060000-0000-4000-8000-000000000001'),
  'structured exact ingredient code creates one allergen match without fuzzy duplication');

set local role authenticated;
select set_config('request.jwt.claims','{"sub":"57010000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2","session_id":"57051000-0000-4000-8000-000000000001"}',true);

select ok((select replayed and entity_id=(select entity_id from page57_plan1)
  from public.mutate_meal_management(
    '57020000-0000-4000-8000-000000000001','57030000-0000-4000-8000-000000000001','save_plan',
    '{"previous_version_id":null,"expected_version":0,"service_date":"2026-09-02","meal_kind":"lunch","menu_title":"合成花生米食","ingredients":[{"code":"peanut","label":"花生"},{"code":"rice","label":"米"}],"extra_portions":1}',
    '57070000-0000-4000-8000-000000000020')),
  'exact plan retry returns the original frozen review');

select throws_ok($$select * from public.mutate_meal_management(
  '57020000-0000-4000-8000-000000000001','57030000-0000-4000-8000-000000000001','complete_plan',
  jsonb_build_object('plan_version_id',(select entity_id from page57_plan1),'expected_version',1,
    'resolutions','[]'::jsonb,'actual_portions',jsonb_build_array(
      jsonb_build_object('client_id','57060000-0000-4000-8000-000000000001','portions',1),
      jsonb_build_object('client_id','57060000-0000-4000-8000-000000000002','portions',1)),
    'extra_actual_portions',0,'variance_reason',null),
  '57070000-0000-4000-8000-000000000021')$$,'23514',
  'every conflict and attendee requires one completion decision',
  'completion refuses unresolved conflicts');

reset role;
create temporary table page57_completion_payload as
select jsonb_build_object(
  'plan_version_id',plan.id,'expected_version',plan.version,
  'resolutions',(select jsonb_agg(jsonb_build_object(
    'conflict_key',conflict->>'key','disposition','substituted','note','合成替代餐確認')
    order by conflict->>'key') from jsonb_array_elements(plan.conflict_snapshot) conflict),
  'actual_portions',jsonb_build_array(
    jsonb_build_object('client_id','57060000-0000-4000-8000-000000000001','portions',1),
    jsonb_build_object('client_id','57060000-0000-4000-8000-000000000002','portions',1)),
  'extra_actual_portions',0,'variance_reason',null
) payload from public.meal_plan_versions plan where plan.id=(select entity_id from page57_plan1);
grant select on page57_completion_payload to authenticated;

set local role authenticated;
select set_config('request.jwt.claims','{"sub":"57010000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2","session_id":"57051000-0000-4000-8000-000000000001"}',true);
create temporary table page57_plan2 as select * from public.mutate_meal_management(
  '57020000-0000-4000-8000-000000000001','57030000-0000-4000-8000-000000000001','complete_plan',
  (select payload from page57_completion_payload),'57070000-0000-4000-8000-000000000022');
select ok((select not replayed and status='prepared' and version=2
  and attendance_count=2 and actual_portion_total=2 from page57_plan2),
  'authorized completion appends a prepared version with exact actual portions');

select ok((select replayed and entity_id=(select entity_id from page57_plan2)
  from public.mutate_meal_management(
    '57020000-0000-4000-8000-000000000001','57030000-0000-4000-8000-000000000001','complete_plan',
    (select payload from page57_completion_payload),'57070000-0000-4000-8000-000000000022')),
  'exact completion retry returns the same prepared evidence');

select ok((select payload->>'matching_plan_total'='1'
  and payload->>'expected_portion_total'='3' and payload->>'actual_portion_total'='2'
  and payload->'plans'->0->>'status'='prepared'
  from public.meal_management_snapshot('57020000-0000-4000-8000-000000000001',
    '57030000-0000-4000-8000-000000000001','2026-09-02','lunch','','all')),
  'terminal snapshot replaces review with prepared version and preserves planned versus actual totals');

reset role;
select throws_ok($$update public.meal_plan_versions set menu_title='竄改' where id=(select entity_id from page57_plan2)$$,
  '55000','meal requirements, plans, and operation evidence are append-only',
  'prepared plan cannot be overwritten');

set local role authenticated;
select set_config('request.jwt.claims','{"sub":"57010000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2","session_id":"57051000-0000-4000-8000-000000000001"}',true);
select throws_ok($$insert into public.meal_requirement_versions(
  organization_id,branch_id,client_id,requirement_key,version,effective_from,
  texture_state,allergy_status,allergens,contraindication_status,contraindications,
  recorded_by,recorded_at,content_hash
) values ('57020000-0000-4000-8000-000000000001','57030000-0000-4000-8000-000000000001',
  '57060000-0000-4000-8000-000000000001',gen_random_uuid(),1,'2026-09-02','missing',
  'unknown','[]','unknown','[]','57010000-0000-4000-8000-000000000001',now(),repeat('a',64))$$,
  '42501',null,'authenticated callers cannot insert around the guarded workflow');

select throws_ok($$select * from public.meal_management_snapshot(
  '57020000-0000-4000-8000-000000000002','57030000-0000-4000-8000-000000000002',
  '2026-09-02','all','','all')$$,'42501','meal snapshot is not permitted',
  'cross-tenant meal snapshot is rejected');

reset role;
select is((select count(*)::integer from public.meal_requirement_versions),3,
  'two clients retain three immutable requirement versions');
select is((select count(*)::integer from public.meal_plan_versions),2,
  'review and prepared plan versions are both retained');
select is((select count(*)::integer from private.meal_management_operations),5,
  'only successful logical operations produce receipts');
select ok((select bool_and(content_hash ~ '^[a-f0-9]{64}$')
  from public.meal_requirement_versions) and (select bool_and(content_hash ~ '^[a-f0-9]{64}$'
  and attendance_snapshot_hash ~ '^[a-f0-9]{64}$') from public.meal_plan_versions),
  'all requirement and plan evidence carries deterministic hashes');
select ok((select count(*) >= 10 from public.audit_events
  where table_name in ('public.meal_requirement_versions','public.meal_plan_versions',
    'private.meal_management_operations','meal_management_snapshot')),
  'meal inserts and bounded reads leave audit evidence');

select * from finish();
rollback;
