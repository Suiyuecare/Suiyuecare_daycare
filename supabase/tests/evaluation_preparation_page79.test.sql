begin;
set local time zone 'Asia/Taipei';
select plan(26);
select ok((select bool_and(relrowsecurity and relforcerowsecurity) from pg_class where oid in
  ('private.evaluation_preparation_versions'::regclass,'private.evaluation_preparation_operations'::regclass)),
  'internal preparation streams force RLS');
select ok(not has_table_privilege('authenticated','private.evaluation_preparation_versions','select,insert,update,delete')
  and not has_table_privilege('service_role','private.evaluation_preparation_operations','select,insert,update,delete'),
  'no direct table access');
select ok(not has_function_privilege('anon','public.evaluation_preparation_mutate(uuid,uuid,jsonb,uuid)','execute')
  and has_function_privilege('authenticated','public.evaluation_preparation_mutate(uuid,uuid,jsonb,uuid)','execute'),
  'only authenticated can invoke mutation');

insert into auth.users(id) values
  ('79000000-0000-4000-8000-000000000001'),('79000000-0000-4000-8000-000000000002'),
  ('79000000-0000-4000-8000-000000000003');
insert into public.organizations(id,code,name) values
  ('79100000-0000-4000-8000-000000000001','evaluation-a','合成評鑑機構'),
  ('79100000-0000-4000-8000-000000000002','evaluation-b','合成其他機構');
insert into public.branches(id,organization_id,code,name) values
  ('79200000-0000-4000-8000-000000000001','79100000-0000-4000-8000-000000000001','main','合成分支甲'),
  ('79200000-0000-4000-8000-000000000002','79100000-0000-4000-8000-000000000001','other','合成分支乙'),
  ('79200000-0000-4000-8000-000000000003','79100000-0000-4000-8000-000000000002','main','合成機構乙分支');
insert into public.profiles(id,display_name,kind) values
  ('79000000-0000-4000-8000-000000000001','合成評鑑主管','staff'),
  ('79000000-0000-4000-8000-000000000002','合成其他分支員工','staff'),
  ('79000000-0000-4000-8000-000000000003','合成家屬','family');
insert into public.memberships(id,organization_id,branch_id,profile_id,status,starts_at) values
  ('79300000-0000-4000-8000-000000000001','79100000-0000-4000-8000-000000000001','79200000-0000-4000-8000-000000000001','79000000-0000-4000-8000-000000000001','active',now()-interval '1 day'),
  ('79300000-0000-4000-8000-000000000002','79100000-0000-4000-8000-000000000001','79200000-0000-4000-8000-000000000002','79000000-0000-4000-8000-000000000002','active',now()-interval '1 day'),
  ('79300000-0000-4000-8000-000000000003','79100000-0000-4000-8000-000000000001','79200000-0000-4000-8000-000000000001','79000000-0000-4000-8000-000000000003','active',now()-interval '1 day');
insert into public.membership_roles(membership_id,role_id)
  select m.id,r.id from public.memberships m join public.roles r on r.is_system
    and r.role_key=(case when m.profile_id='79000000-0000-4000-8000-000000000003' then 'family' else 'branch_supervisor' end)
  where m.organization_id='79100000-0000-4000-8000-000000000001';

create temporary table evaluation_test_data(k text primary key,v jsonb);
insert into evaluation_test_data values('initial',
  '{"itemCode":"WANHUA_01","expectedVersion":0,"ownerUserId":null,"dueOn":null,"evidenceReference":null,"progress":"collecting","changeReason":"initial"}');
grant select,insert,update on evaluation_test_data to authenticated;

set local role authenticated;
select set_config('request.jwt.claims','{}',true);
select throws_ok($$select public.evaluation_preparation_snapshot('79100000-0000-4000-8000-000000000001','79200000-0000-4000-8000-000000000001',1)$$,
  '42501','evaluation preparation snapshot denied','no user denied');
select set_config('request.jwt.claims','{"sub":"79000000-0000-4000-8000-000000000001","aal":"aal1"}',true);
select throws_ok($$select public.evaluation_preparation_snapshot('79100000-0000-4000-8000-000000000001','79200000-0000-4000-8000-000000000001',1)$$,
  '42501','evaluation preparation snapshot denied','AAL1 denied');
select set_config('request.jwt.claims','{"sub":"79000000-0000-4000-8000-000000000003","aal":"aal2"}',true);
select throws_ok($$select public.evaluation_preparation_snapshot('79100000-0000-4000-8000-000000000001','79200000-0000-4000-8000-000000000001',1)$$,
  '42501','evaluation preparation snapshot denied','family denied');
select set_config('request.jwt.claims','{"sub":"79000000-0000-4000-8000-000000000001","aal":"aal2"}',true);
select throws_ok($$select public.evaluation_preparation_snapshot('79100000-0000-4000-8000-000000000001','79200000-0000-4000-8000-000000000002',1)$$,
  '42501','evaluation preparation snapshot denied','other branch denied');
select throws_ok($$select public.evaluation_preparation_snapshot('79100000-0000-4000-8000-000000000002','79200000-0000-4000-8000-000000000003',1)$$,
  '42501','evaluation preparation snapshot denied','other organization denied');
insert into evaluation_test_data select 'first', public.evaluation_preparation_mutate(
  '79100000-0000-4000-8000-000000000001','79200000-0000-4000-8000-000000000001',v,
  '79800000-0000-4000-8000-000000000001') from evaluation_test_data where k='initial';
select is((select v#>>'{result,version}' from evaluation_test_data where k='first'),'1','initial version persisted');
select is((public.evaluation_preparation_mutate('79100000-0000-4000-8000-000000000001',
  '79200000-0000-4000-8000-000000000001',(select v from evaluation_test_data where k='initial'),
  '79800000-0000-4000-8000-000000000001')->>'replayed')::boolean,true,'exact operation replayed');
select is((public.evaluation_preparation_snapshot('79100000-0000-4000-8000-000000000001',
  '79200000-0000-4000-8000-000000000001',1)#>>'{items,0,version}'),'1',
  'replay did not create another version');
select throws_ok($$select public.evaluation_preparation_mutate('79100000-0000-4000-8000-000000000001',
  '79200000-0000-4000-8000-000000000001',jsonb_set((select v from evaluation_test_data where k='initial'),'{itemCode}','"WANHUA_02"'),
  '79800000-0000-4000-8000-000000000001')$$,'23505','evaluation preparation idempotency conflict','key cannot be reused for other content');
select throws_ok($$select public.evaluation_preparation_mutate('79100000-0000-4000-8000-000000000001',
  '79200000-0000-4000-8000-000000000001',(select v from evaluation_test_data where k='initial'),
  '79800000-0000-4000-8000-000000000002')$$,'40001','evaluation preparation version stale','stale version blocked');
select throws_ok($$select public.evaluation_preparation_mutate('79100000-0000-4000-8000-000000000001',
  '79200000-0000-4000-8000-000000000001',
  '{"itemCode":"WANHUA_01","expectedVersion":1,"ownerUserId":null,"dueOn":null,"evidenceReference":null,"progress":"internal_review_requested","changeReason":"progress_changed"}',
  '79800000-0000-4000-8000-000000000003')$$,'23514','evaluation preparation checklist incomplete','review requires owner date and evidence');
select throws_ok($$select public.evaluation_preparation_mutate('79100000-0000-4000-8000-000000000001',
  '79200000-0000-4000-8000-000000000001',
  '{"itemCode":"WANHUA_01","expectedVersion":1,"ownerUserId":"79000000-0000-4000-8000-000000000002","dueOn":"2026-12-31","evidenceReference":"79700000-0000-4000-8000-000000000001","progress":"internal_review_requested","changeReason":"progress_changed"}',
  '79800000-0000-4000-8000-000000000004')$$,'23514','evaluation preparation checklist incomplete','other-branch owner rejected');
insert into evaluation_test_data values('revision',
  '{"itemCode":"WANHUA_01","expectedVersion":1,"ownerUserId":"79000000-0000-4000-8000-000000000001","dueOn":"2026-12-31","evidenceReference":"79700000-0000-4000-8000-000000000001","progress":"internal_review_requested","changeReason":"progress_changed"}');
insert into evaluation_test_data select 'second',public.evaluation_preparation_mutate(
  '79100000-0000-4000-8000-000000000001','79200000-0000-4000-8000-000000000001',v,
  '79800000-0000-4000-8000-000000000005') from evaluation_test_data where k='revision';
select is((select v#>>'{result,version}' from evaluation_test_data where k='second'),'2','revision creates next version');
select is((public.evaluation_preparation_snapshot('79100000-0000-4000-8000-000000000001',
  '79200000-0000-4000-8000-000000000001',1)->>'total')::integer,1,'snapshot counts item once');
select is((public.evaluation_preparation_snapshot('79100000-0000-4000-8000-000000000001',
  '79200000-0000-4000-8000-000000000001',1)#>>'{items,0,progress}'),'internal_review_requested','snapshot projects latest progress');
select is((public.evaluation_preparation_snapshot('79100000-0000-4000-8000-000000000001',
  '79200000-0000-4000-8000-000000000001',1)->>'sourceStatus'),'applicability_unapproved','official applicability remains unapproved');
select is((public.evaluation_preparation_snapshot('79100000-0000-4000-8000-000000000001',
  '79200000-0000-4000-8000-000000000001',1)->>'formalSubmissionEnabled')::boolean,false,'formal submission disabled');
select throws_ok($$select * from private.evaluation_preparation_versions$$,'42501',null,'direct read denied');
reset role;
update public.memberships set ends_at=clock_timestamp()-interval '1 second'
  where id='79300000-0000-4000-8000-000000000001';
set local role authenticated;
select throws_ok($$select public.evaluation_preparation_snapshot('79100000-0000-4000-8000-000000000001',
  '79200000-0000-4000-8000-000000000001',1)$$,
  '42501','evaluation preparation snapshot denied','revoked membership immediately denies read');
reset role;
update public.memberships set ends_at=null where id='79300000-0000-4000-8000-000000000001';
delete from public.role_permissions where role_id='10000000-0000-4000-8000-000000000003'
  and permission_id=(select id from public.permissions where permission_key='audit.view');
set local role authenticated;
select throws_ok($$select public.evaluation_preparation_snapshot('79100000-0000-4000-8000-000000000001',
  '79200000-0000-4000-8000-000000000001',1)$$,
  '42501','evaluation preparation snapshot denied','revoked audit permission immediately denies read');
reset role;
select throws_ok($$update private.evaluation_preparation_versions set progress='collecting' where item_code='WANHUA_01'$$,
  '55000','evaluation preparation is append-only','even owner cannot overwrite');
select is((select count(*) from private.evaluation_preparation_versions where item_code='WANHUA_01'),2::bigint,
  'only two intended versions persisted');
select ok(not exists(select 1 from public.audit_events where table_name='private.evaluation_preparation_versions'
  and metadata::text like '%79700000%'),'audit metadata never includes evidence UUID');
select * from finish();
rollback;
