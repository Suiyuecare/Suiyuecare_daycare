begin;

select plan(21);

select ok(
  not (
    select procedure.prosecdef
    from pg_proc procedure
    where procedure.oid =
      'private.profile_kind_accepts_role(public.profile_kind,text,boolean)'::regprocedure
  )
  and (
    select procedure.prosecdef
    from pg_proc procedure
    where procedure.oid =
      'private.validate_membership_role_scope()'::regprocedure
  )
  and (
    select procedure.prosecdef
    from pg_proc procedure
    where procedure.oid =
      'private.validate_role_request_profile_kind()'::regprocedure
  )
  and (
    select procedure.prosecdef
    from pg_proc procedure
    where procedure.oid =
      'private.prevent_profile_kind_role_mismatch()'::regprocedure
  )
  and (
    select procedure.prosecdef
    from pg_proc procedure
    where procedure.oid =
      'private.prevent_role_identity_mismatch()'::regprocedure
  ),
  'table-reading trigger functions are private definers and the pure compatibility rule is an invoker'
);

select is(
  (
    select count(*)::integer
    from pg_trigger trigger_row
    where not trigger_row.tgisinternal
      and trigger_row.tgname in (
        'membership_roles_validate_scope',
        'role_governance_requests_validate_profile_kind',
        'profiles_prevent_role_audience_mismatch',
        'roles_prevent_profile_kind_mismatch'
      )
  ),
  4,
  'assignment, request, profile-kind, and role-identity changes all have database guards'
);

select ok(
  not has_function_privilege(
    'authenticated',
    'private.profile_kind_accepts_role(public.profile_kind,text,boolean)',
    'execute'
  )
  and not has_function_privilege(
    'authenticated',
    'private.validate_membership_role_scope()',
    'execute'
  )
  and not has_function_privilege(
    'authenticated',
    'private.validate_role_request_profile_kind()',
    'execute'
  )
  and not has_function_privilege(
    'service_role',
    'private.validate_role_request_profile_kind()',
    'execute'
  ),
  'compatibility helpers cannot be invoked as application RPCs'
);

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  ('00000000-0000-0000-0000-000000000000', 'fa100000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'role-boundary-staff@example.invalid', '', now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'fa100000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'role-boundary-family@example.invalid', '', now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'fa100000-0000-4000-8000-000000000003', 'authenticated', 'authenticated', 'role-boundary-platform@example.invalid', '', now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'fa100000-0000-4000-8000-000000000004', 'authenticated', 'authenticated', 'role-boundary-professional@example.invalid', '', now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now());

insert into public.organizations (id, code, name) values
  ('fa200000-0000-4000-8000-000000000001', 'role_kind_a', '角色身分邊界 A'),
  ('fa200000-0000-4000-8000-000000000002', 'role_kind_b', '角色身分邊界 B');

insert into public.branches (id, organization_id, code, name) values
  ('fa300000-0000-4000-8000-000000000001', 'fa200000-0000-4000-8000-000000000001', 'main', '角色身分 A 主分支'),
  ('fa300000-0000-4000-8000-000000000002', 'fa200000-0000-4000-8000-000000000002', 'main', '角色身分 B 主分支');

insert into public.profiles (id, display_name, kind) values
  ('fa100000-0000-4000-8000-000000000001', '一般員工', 'staff'),
  ('fa100000-0000-4000-8000-000000000002', '家屬帳號', 'family'),
  ('fa100000-0000-4000-8000-000000000003', '平台維運', 'platform'),
  ('fa100000-0000-4000-8000-000000000004', '專業人員', 'professional');

insert into public.memberships (
  id, organization_id, branch_id, profile_id, status
) values
  ('fa400000-0000-4000-8000-000000000001', 'fa200000-0000-4000-8000-000000000001', null, 'fa100000-0000-4000-8000-000000000001', 'active'),
  ('fa400000-0000-4000-8000-000000000002', 'fa200000-0000-4000-8000-000000000001', null, 'fa100000-0000-4000-8000-000000000002', 'active'),
  ('fa400000-0000-4000-8000-000000000003', 'fa200000-0000-4000-8000-000000000001', null, 'fa100000-0000-4000-8000-000000000003', 'active'),
  ('fa400000-0000-4000-8000-000000000004', 'fa200000-0000-4000-8000-000000000001', null, 'fa100000-0000-4000-8000-000000000004', 'active');

insert into public.roles (
  id, organization_id, role_key, name, description, is_system
) values
  ('fa500000-0000-4000-8000-000000000001', 'fa200000-0000-4000-8000-000000000001', 'custom_clinical', '自訂臨床角色', '一般機構自訂角色', false),
  ('fa500000-0000-4000-8000-000000000002', 'fa200000-0000-4000-8000-000000000002', 'other_tenant', '他機構角色', '跨機構測試', false);

select lives_ok(
  $$insert into public.membership_roles (membership_id, role_id)
    values ('fa400000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000002')$$,
  'staff profiles can receive tenant-operational system roles'
);

select lives_ok(
  $$insert into public.membership_roles (membership_id, role_id)
    values ('fa400000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000010')$$,
  'family profiles can receive only the reserved family role'
);

select lives_ok(
  $$insert into public.membership_roles (membership_id, role_id)
    values ('fa400000-0000-4000-8000-000000000003', '10000000-0000-4000-8000-000000000001')$$,
  'platform profiles can receive only the reserved platform role'
);

select lives_ok(
  $$insert into public.membership_roles (membership_id, role_id)
    values ('fa400000-0000-4000-8000-000000000004', 'fa500000-0000-4000-8000-000000000001')$$,
  'non-family tenant professionals can receive tenant custom roles'
);

select throws_ok(
  $$insert into public.membership_roles (membership_id, role_id)
    values ('fa400000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000002')$$,
  '23514', 'profile kind and role audience are incompatible',
  'a family profile cannot receive organization-manager authority'
);

select throws_ok(
  $$insert into public.membership_roles (membership_id, role_id)
    values ('fa400000-0000-4000-8000-000000000002', 'fa500000-0000-4000-8000-000000000001')$$,
  '23514', 'profile kind and role audience are incompatible',
  'a family profile cannot receive a tenant custom role'
);

select throws_ok(
  $$insert into public.membership_roles (membership_id, role_id)
    values ('fa400000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000010')$$,
  '23514', 'profile kind and role audience are incompatible',
  'a staff profile cannot be projected into the family audience'
);

select throws_ok(
  $$insert into public.membership_roles (membership_id, role_id)
    values ('fa400000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001')$$,
  '23514', 'profile kind and role audience are incompatible',
  'a staff profile cannot receive the platform role'
);

select throws_ok(
  $$insert into public.membership_roles (membership_id, role_id)
    values ('fa400000-0000-4000-8000-000000000003', '10000000-0000-4000-8000-000000000010')$$,
  '23514', 'profile kind and role audience are incompatible',
  'a platform profile cannot be projected into the family audience'
);

select throws_ok(
  $$insert into public.membership_roles (membership_id, role_id)
    values ('fa400000-0000-4000-8000-000000000003', 'fa500000-0000-4000-8000-000000000001')$$,
  '23514', 'profile kind and role audience are incompatible',
  'a platform profile cannot receive a tenant custom role'
);

select throws_ok(
  $$insert into public.role_governance_requests (
      id, organization_id, branch_id, operation, target_role_id,
      target_membership_id, status, requested_by,
      requested_reauth_challenge_id, request_idempotency_key, request_hash
    ) values (
      'fa600000-0000-4000-8000-000000000001',
      'fa200000-0000-4000-8000-000000000001',
      'fa300000-0000-4000-8000-000000000001',
      'assign_role',
      '10000000-0000-4000-8000-000000000002',
      'fa400000-0000-4000-8000-000000000002',
      'pending',
      'fa100000-0000-4000-8000-000000000001',
      'fa700000-0000-4000-8000-000000000001',
      'fa800000-0000-4000-8000-000000000001',
      repeat('a', 64)
    )$$,
  '23514', 'profile kind and role audience are incompatible',
  'an incompatible assignment is rejected before entering the approval queue'
);

select is(
  (select count(*)::integer from public.role_governance_requests
   where id = 'fa600000-0000-4000-8000-000000000001'),
  0,
  'a rejected incompatible request leaves no governance ledger row'
);

select throws_ok(
  $$update public.profiles set kind = 'family'
    where id = 'fa100000-0000-4000-8000-000000000001'$$,
  '23514', 'profile kind change conflicts with an assigned role audience',
  'an assigned staff account cannot be reclassified into the family audience'
);

select is(
  (select kind::text from public.profiles
   where id = 'fa100000-0000-4000-8000-000000000001'),
  'staff',
  'a rejected profile reclassification changes no profile data'
);

select throws_ok(
  $$update public.roles set role_key = 'family'
    where id = 'fa500000-0000-4000-8000-000000000001'$$,
  '23514', 'role identity change conflicts with an assigned profile kind',
  'an assigned custom role cannot be renamed into a reserved audience'
);

select is(
  (select role_key from public.roles
   where id = 'fa500000-0000-4000-8000-000000000001'),
  'custom_clinical',
  'a rejected role identity change leaves the role key unchanged'
);

select throws_ok(
  $$insert into public.membership_roles (membership_id, role_id)
    values ('fa400000-0000-4000-8000-000000000004', 'fa500000-0000-4000-8000-000000000002')$$,
  '23514', 'tenant role and membership must belong to the same organization',
  'profile compatibility does not weaken the existing tenant boundary'
);

select is(
  (select count(*)::integer from public.membership_roles
   where membership_id::text like 'fa400000-%'),
  4,
  'only the four explicitly compatible assignments were persisted'
);

select * from finish();
rollback;
