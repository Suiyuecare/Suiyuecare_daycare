begin;

select plan(24);

select is(
  (
    select count(*)::integer
    from unnest(array[
      'organizations', 'branches', 'profiles', 'permissions', 'roles',
      'role_permissions', 'memberships', 'membership_roles', 'clients',
      'client_assignments', 'consents', 'form_definitions', 'form_versions',
      'care_records', 'attendance_records', 'measurements',
      'medication_plans', 'medication_administrations', 'service_events',
      'claim_batches', 'claim_items', 'import_batches', 'import_operations', 'import_fields',
      'notifications', 'notification_deliveries', 'sync_operations',
      'audit_events'
    ]) expected(table_name)
    where to_regclass('public.' || expected.table_name) is null
  ),
  0,
  'all foundation tables exist'
);

select is(
  (
    select count(*)::integer
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relkind = 'r'
      and c.relname in (
        'organizations', 'branches', 'profiles', 'permissions', 'roles',
        'role_permissions', 'memberships', 'membership_roles', 'clients',
        'client_assignments', 'consents', 'form_definitions', 'form_versions',
        'care_records', 'attendance_records', 'measurements',
        'medication_plans', 'medication_administrations', 'service_events',
        'claim_batches', 'claim_items', 'import_batches', 'import_operations', 'import_fields',
        'notifications', 'notification_deliveries', 'sync_operations',
        'audit_events'
      )
      and not c.relrowsecurity
  ),
  0,
  'RLS is enabled on every application table'
);

select is(
  (
    select count(*)::integer
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relkind = 'r'
      and c.relname in (
        'organizations', 'branches', 'profiles', 'permissions', 'roles',
        'role_permissions', 'memberships', 'membership_roles', 'clients',
        'client_assignments', 'consents', 'form_definitions', 'form_versions',
        'care_records', 'attendance_records', 'measurements',
        'medication_plans', 'medication_administrations', 'service_events',
        'claim_batches', 'claim_items', 'import_batches', 'import_operations', 'import_fields',
        'notifications', 'notification_deliveries', 'sync_operations',
        'audit_events'
      )
      and not c.relforcerowsecurity
  ),
  0,
  'RLS is forced on every application table'
);

select is(
  (
    select count(*)::integer
    from information_schema.tables t
    where t.table_schema = 'public'
      and t.table_name in (
        'organizations', 'branches', 'profiles', 'permissions', 'roles',
        'role_permissions', 'memberships', 'membership_roles', 'clients',
        'client_assignments', 'consents', 'form_definitions', 'form_versions',
        'care_records', 'attendance_records', 'measurements',
        'medication_plans', 'medication_administrations', 'service_events',
        'claim_batches', 'claim_items', 'import_batches', 'import_operations', 'import_fields',
        'notifications', 'notification_deliveries', 'sync_operations',
        'audit_events'
      )
      and (
        has_table_privilege('anon', format('%I.%I', t.table_schema, t.table_name), 'select')
        or has_table_privilege('anon', format('%I.%I', t.table_schema, t.table_name), 'insert')
        or has_table_privilege('anon', format('%I.%I', t.table_schema, t.table_name), 'update')
        or has_table_privilege('anon', format('%I.%I', t.table_schema, t.table_name), 'delete')
      )
  ),
  0,
  'anon has no application table privileges'
);

select ok(
  not has_table_privilege('authenticated', 'public.audit_events', 'insert')
  and not has_table_privilege('authenticated', 'public.audit_events', 'update')
  and not has_table_privilege('authenticated', 'public.audit_events', 'delete'),
  'authenticated cannot forge or mutate audit events'
);

select ok(
  not has_table_privilege('authenticated', 'private.reauth_events', 'select')
  and not has_table_privilege('authenticated', 'private.reauth_events', 'insert')
  and not has_table_privilege('authenticated', 'private.reauth_events', 'update')
  and not has_table_privilege('authenticated', 'private.reauth_events', 'delete')
  and not has_table_privilege('authenticated', 'private.reauth_challenges', 'select')
  and not has_table_privilege('authenticated', 'private.reauth_challenges', 'insert')
  and not has_table_privilege('authenticated', 'private.reauth_challenges', 'update')
  and not has_table_privilege('authenticated', 'private.reauth_challenges', 'delete'),
  'authenticated cannot directly access reauthentication evidence'
);

select ok(
  has_function_privilege('authenticated', 'public.record_aal2_reauth(uuid,text)', 'execute')
  and has_function_privilege('authenticated', 'public.has_recent_aal2(integer)', 'execute'),
  'authenticated can call only the public AAL2 RPC surface'
);

select ok(
  not has_function_privilege('anon', 'public.record_aal2_reauth(uuid,text)', 'execute')
  and not has_function_privilege('anon', 'public.has_recent_aal2(integer)', 'execute'),
  'anon cannot call AAL2 RPCs'
);

select is(
  (
    select count(*)::integer
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where p.prosecdef
      and n.nspname <> 'private'
      and pg_get_userbyid(p.proowner) = current_user
  ),
  0,
  'project-owned SECURITY DEFINER functions live only in private'
);

select is(
  (
    select count(*)::integer
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where p.prosecdef
      and n.nspname = 'private'
      and not coalesce(p.proconfig, '{}'::text[]) @> array['search_path=""']
  ),
  0,
  'every private SECURITY DEFINER function fixes an empty search_path'
);

select is(
  (
    select count(*)::integer
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where p.prosecdef
      and n.nspname = 'private'
      and exists (
        select 1
        from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) acl
        where acl.grantee = 0
          and acl.privilege_type = 'EXECUTE'
      )
  ),
  0,
  'PUBLIC execute is revoked from every private SECURITY DEFINER function'
);

select is(
  (
    select count(*)::integer
    from pg_constraint c
    join pg_class t on t.oid = c.conrelid
    join pg_namespace n on n.oid = t.relnamespace
    cross join lateral unnest(c.conkey) fk_attnum
    where c.contype = 'f'
      and n.nspname in ('public', 'private')
      and not exists (
        select 1
        from pg_index i
        where i.indrelid = c.conrelid
          and fk_attnum = any(i.indkey)
      )
  ),
  0,
  'every foreign-key column participates in an index'
);

select ok(
  exists (
    select 1
    from public.organizations
    where code = 'demo_daycare'
      and settings ->> 'data_classification' = 'synthetic'
  ),
  'local seed data is explicitly synthetic'
);

select ok(
  to_regclass('public.active_memberships') is not null,
  'active_memberships tenant-context interface exists'
);

select ok(
  exists (
    select 1
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname = 'active_memberships'
      and c.relkind = 'v'
      and coalesce(c.reloptions, '{}'::text[]) @> array['security_invoker=true']
  ),
  'active_memberships is a security-invoker view'
);

select ok(
  exists (
    select 1
    from pg_constraint c
    join pg_class t on t.oid = c.conrelid
    join pg_namespace n on n.oid = t.relnamespace
    where n.nspname = 'public'
      and t.relname = 'import_batches'
      and c.contype = 'u'
      and c.conname = 'import_batches_branch_hash_key'
  )
  and exists (
    select 1
    from pg_constraint c
    join pg_class t on t.oid = c.conrelid
    join pg_namespace n on n.oid = t.relnamespace
    where n.nspname = 'public'
      and t.relname = 'import_batches'
      and c.contype = 'u'
      and c.conname = 'import_batches_upload_idempotency_key'
  )
  and exists (
    select 1
    from pg_constraint c
    join pg_class t on t.oid = c.conrelid
    join pg_namespace n on n.oid = t.relnamespace
    where n.nspname = 'public'
      and t.relname = 'import_operations'
      and c.contype = 'u'
      and c.conname = 'import_operations_actor_idempotency_key'
  )
  and exists (
    select 1
    from information_schema.columns column_definition
    where column_definition.table_schema = 'public'
      and column_definition.table_name = 'import_batches'
      and column_definition.column_name = 'staging_payload'
      and column_definition.data_type = 'jsonb'
  ),
  'imports have branch duplicate keys, durable operation idempotency, and normalized staging payloads'
);

select ok(
  exists (
    select 1
    from pg_index x
    join pg_class i on i.oid = x.indexrelid
    join pg_class t on t.oid = x.indrelid
    join pg_namespace n on n.oid = t.relnamespace
    where n.nspname = 'public'
      and t.relname = 'audit_events'
      and i.relname = 'audit_events_line_webhook_event_key'
      and x.indisunique
      and x.indpred is not null
  ),
  'LINE webhook event IDs have a concurrency-safe partial unique index'
);

select ok(
  exists (
    select 1
    from pg_index x
    join pg_class i on i.oid = x.indexrelid
    join pg_class t on t.oid = x.indrelid
    join pg_namespace n on n.oid = t.relnamespace
    where n.nspname = 'private'
      and t.relname = 'reauth_challenges'
      and i.relname = 'reauth_challenges_one_pending_key'
      and x.indisunique
      and x.indpred is not null
  )
  and exists (
    select 1
    from pg_constraint c
    join pg_class t on t.oid = c.conrelid
    join pg_namespace n on n.oid = t.relnamespace
    where n.nspname = 'private'
      and t.relname = 'reauth_events'
      and c.contype = 'u'
      and c.conname = 'reauth_events_challenge_id_key'
  ),
  'reauthentication allows one pending challenge and one completion per challenge'
);

select is(
  (
    select count(*)::integer
    from information_schema.columns c
    where c.table_schema = 'public'
      and c.column_name = 'updated_at'
      and not exists (
        select 1
        from pg_trigger t
        join pg_class r on r.oid = t.tgrelid
        join pg_namespace n on n.oid = r.relnamespace
        where n.nspname = c.table_schema
          and r.relname = c.table_name
          and not t.tgisinternal
          and t.tgname = c.table_name || '_set_updated_at'
      )
  ),
  0,
  'every public updated_at column has a server-time trigger'
);

select is(
  (
    select count(*)::integer
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relkind = 'r'
      and c.relname <> 'audit_events'
      and not exists (
        select 1
        from pg_trigger t
        where t.tgrelid = c.oid
          and not t.tgisinternal
          and t.tgname = c.relname || '_audit_row_change'
      )
  ),
  0,
  'every mutable application table has a mutation-audit trigger'
);

select ok(
  has_function_privilege(
    'service_role',
    'public.issue_aal2_reauth_challenge(uuid,uuid,uuid,text,uuid,timestamptz,text,integer)',
    'execute'
  )
  and not has_function_privilege(
    'authenticated',
    'public.issue_aal2_reauth_challenge(uuid,uuid,uuid,text,uuid,timestamptz,text,integer)',
    'execute'
  ),
  'only the trusted server role can issue reauthentication challenges'
);

select ok(
  pg_get_function_result('public.family_client_summaries()'::regprocedure)
    not ilike '%national_id%'
  and pg_get_function_result('public.family_care_summaries(uuid)'::regprocedure)
    not ilike '%data%'
  and pg_get_function_result('public.family_care_summaries(uuid)'::regprocedure)
    not ilike '%content_hash%',
  'family whitelist RPC signatures exclude identity ciphertext and care payloads'
);

select is(
  (
    select count(*)::integer
    from public.role_permissions rp
    join public.roles r on r.id = rp.role_id
    where r.role_key = 'family'
  ),
  0,
  'family system role has no staff notification or synchronization permissions'
);

select ok(
  not has_table_privilege('authenticated', 'public.import_batches', 'update')
  and not has_table_privilege('authenticated', 'public.import_operations', 'insert')
  and not has_table_privilege('authenticated', 'public.import_operations', 'update')
  and has_function_privilege(
    'authenticated',
    'public.approve_import_staging(uuid,uuid,uuid,bigint,uuid,text)',
    'execute'
  ),
  'staging approval is available only through the atomic RPC surface'
);

select * from finish();
rollback;
