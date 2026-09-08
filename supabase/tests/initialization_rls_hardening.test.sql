begin;
select plan(38);

create temporary table initialization_rls_targets (
  schema_name text not null,
  table_name text not null,
  primary key (schema_name, table_name)
);
insert into initialization_rls_targets values
  ('private', 'abnormal_event_operations'),
  ('private', 'claim_service_allocations'),
  ('private', 'feedback_complaint_event_details'),
  ('private', 'feedback_complaint_operations'),
  ('private', 'feedback_complaint_sensitive_versions'),
  ('private', 'feedback_deadline_rule_versions'),
  ('private', 'inventory_item_operations'),
  ('private', 'inventory_movement_operations'),
  ('private', 'inventory_policy_versions'),
  ('private', 'inventory_safety_levels'),
  ('private', 'meeting_action_update_operations'),
  ('private', 'meeting_minute_operations'),
  ('private', 'staff_certificate_exception_approvals'),
  ('private', 'staff_certificate_exception_operations'),
  ('private', 'staff_certificate_exception_requests'),
  ('private', 'staff_certificate_operations'),
  ('private', 'staff_lab_report_operations'),
  ('private', 'staff_tocc_operations'),
  ('private', 'staff_training_record_operations'),
  ('private', 'staff_training_rule_operations'),
  ('private', 'staff_training_rule_proposals'),
  ('private', 'staff_training_rule_versions'),
  ('private', 'staff_vaccination_operations'),
  ('private', 'staff_vital_sign_operations'),
  ('public', 'meeting_action_updates'),
  ('public', 'meeting_minute_versions');

-- One assertion per exact target; missing objects fail rather than disappearing
-- from an inner join and falsely reducing the required coverage.
select ok(
  exists (
    select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = t.schema_name and c.relname = t.table_name
      and c.relkind = 'r' and c.relrowsecurity and c.relforcerowsecurity
      and pg_get_userbyid(c.relowner) = 'postgres'
  ),
  format('%I.%I has ENABLE/FORCE RLS and its original postgres owner', t.schema_name, t.table_name)
) from initialization_rls_targets t order by t.schema_name, t.table_name;

-- 27: This global gate catches future omissions outside the fixed repair list.
select ok(not exists (
  select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname in ('public', 'private') and c.relkind in ('r', 'p')
    and (not c.relrowsecurity or not c.relforcerowsecurity)
), 'every current public/private application table enables and forces RLS');

-- 28
select ok(not exists (
  select 1 from initialization_rls_targets t
  cross join (values ('anon'), ('authenticated'), ('service_role')) r(role_name)
  where t.schema_name = 'private' and has_table_privilege(
    r.role_name, format('%I.%I', t.schema_name, t.table_name),
    'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN'
  )
), 'all 24 internal ledgers keep zero direct API-role privileges');

-- 29
select ok(not exists (
  select 1 from initialization_rls_targets t
  join pg_namespace n on n.nspname = t.schema_name
  join pg_class c on c.relnamespace = n.oid and c.relname = t.table_name
  join pg_policy p on p.polrelid = c.oid
  where t.schema_name = 'private'
), 'internal ledgers remain default-deny without invented permissive policies');

-- 30
select ok(
  not exists (
    select 1 from initialization_rls_targets t
    cross join (values ('anon'), ('authenticated')) r(role_name)
    where t.schema_name = 'public' and has_table_privilege(
      r.role_name, format('%I.%I', t.schema_name, t.table_name),
      'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN'
    )
  ) and (
    select bool_and(has_table_privilege('service_role',
      format('%I.%I', t.schema_name, t.table_name), p.privilege))
    from initialization_rls_targets t
    cross join (values ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE')) p(privilege)
    where t.schema_name = 'public'
  ),
  'meeting direct client denial and existing service CRUD are preserved'
);

-- 31
select is((
  select count(*)::integer from pg_policy p
  join pg_class c on c.oid = p.polrelid
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
    and c.relname in ('meeting_minute_versions', 'meeting_action_updates')
    and p.polcmd = 'r'
    and p.polroles = array[(select oid from pg_roles where rolname = 'authenticated')]
    and pg_get_expr(p.polqual, p.polrelid) like '%meeting_current_authority%'
), 2, 'both original scoped meeting read policies remain in place');

-- 32
select ok(exists (
  select 1 from pg_roles where rolname = 'postgres' and (rolbypassrls or rolsuper)
), 'guarded postgres-owned functions retain their existing RLS bypass capability');

-- Synthetic fixture and temporary grants below exist only inside this local
-- rollback transaction. They demonstrate RLS independently of table ACL denial.
insert into auth.users (id) values ('93f10000-0000-4000-8000-000000000001');
insert into private.feedback_deadline_rule_versions (
  id, organization_id, branch_id, label, source, case_type, risk,
  response_hours, effective_from, published_at, created_by
) values (
  '93f20000-0000-4000-8000-000000000001',
  '20000000-0000-4000-8000-000000000001',
  '21000000-0000-4000-8000-000000000001',
  '合成 RLS 回歸期限', 'staff', 'service', 'standard',
  24, '2026-09-08', now(), '93f10000-0000-4000-8000-000000000001'
);

-- 33
select is((select count(*) from private.feedback_deadline_rule_versions
  where id = '93f20000-0000-4000-8000-000000000001'),
  1::bigint, 'postgres can still maintain a synthetic internal rule behind FORCE RLS');

set local role authenticated;
-- 34
select throws_ok($$select * from private.feedback_deadline_rule_versions$$,
  '42501', null, 'authenticated direct internal-ledger reads are denied by existing ACL');
reset role;

grant select, insert on private.feedback_deadline_rule_versions to authenticated;
set local role authenticated;
-- 35
select is((select count(*) from private.feedback_deadline_rule_versions),
  0::bigint, 'default-deny RLS hides real synthetic rows even if a SELECT grant is accidentally added');
-- 36
select throws_ok($$insert into private.feedback_deadline_rule_versions (
  id, organization_id, branch_id, label, source, case_type, risk,
  response_hours, effective_from, published_at, created_by
) values (
  '93f20000-0000-4000-8000-000000000002',
  '20000000-0000-4000-8000-000000000001',
  '21000000-0000-4000-8000-000000000001',
  '不可寫入的合成期限', 'staff', 'service', 'standard',
  24, '2026-09-09', now(), '93f10000-0000-4000-8000-000000000001'
)$$, '42501', null, 'default-deny RLS rejects INSERT even if an INSERT grant is accidentally added');
reset role;

set local role service_role;
-- 37
select throws_ok($$select * from private.feedback_deadline_rule_versions$$,
  '42501', null, 'service role RLS bypass does not invent direct internal-table ACL grants');
reset role;
-- 38
select is((select count(*) from private.feedback_deadline_rule_versions
  where id in ('93f20000-0000-4000-8000-000000000001', '93f20000-0000-4000-8000-000000000002')),
  1::bigint, 'denied access leaves the original synthetic evidence unchanged');

select * from finish();
rollback;
