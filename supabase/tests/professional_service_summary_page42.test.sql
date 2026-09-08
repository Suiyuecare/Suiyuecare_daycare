begin;

select plan(36);

select is(
  (select count(*) from public.permissions where permission_key in (
    'professional_service_summary.read',
    'professional_service_summary.export'
  )),
  2::bigint,
  'page 42 publishes exactly two dedicated permissions'
);

select ok(
  not exists (
    select 1
    from public.role_permissions role_permission
    join public.roles role on role.id = role_permission.role_id
    join public.permissions permission
      on permission.id = role_permission.permission_id
    where role.role_key not in (
      'organization_manager', 'branch_supervisor', 'professional'
    )
      and permission.permission_key in (
        'professional_service_summary.read',
        'professional_service_summary.export'
      )
  ),
  'summary permissions are restricted to the three intended role templates'
);

select ok(
  not has_table_privilege(
    'authenticated', 'private.professional_service_summary_snapshots',
    'select,insert,update,delete'
  )
  and not has_table_privilege(
    'service_role', 'private.professional_service_summary_snapshots',
    'select,insert,update,delete'
  )
  and (select relrowsecurity and relforcerowsecurity
    from pg_class
    where oid = 'private.professional_service_summary_snapshots'::regclass),
  'snapshot table forces RLS and browser or service roles have no direct access'
);

select ok(
  has_function_privilege(
    'authenticated',
    'public.professional_service_summary_snapshot(uuid,uuid,date,uuid,text,text)',
    'execute'
  )
  and has_function_privilege(
    'authenticated',
    'public.professional_service_summary_export_snapshot(uuid,uuid,uuid)',
    'execute'
  )
  and not has_function_privilege(
    'service_role',
    'public.professional_service_summary_export_snapshot(uuid,uuid,uuid)',
    'execute'
  ),
  'only authenticated callers receive both exact public RPC signatures'
);

select ok(
  not (select prosecdef from pg_proc where oid =
    'public.professional_service_summary_snapshot(uuid,uuid,date,uuid,text,text)'::regprocedure)
  and not (select prosecdef from pg_proc where oid =
    'public.professional_service_summary_export_snapshot(uuid,uuid,uuid)'::regprocedure)
  and (select prosecdef and coalesce(proconfig, '{}'::text[]) @>
      array['search_path=""']
    from pg_proc where oid =
    'private.create_professional_service_summary_snapshot(uuid,uuid,date,uuid,text,text)'::regprocedure),
  'public wrappers are invoker and private core is pinned security definer'
);

select ok(
  not has_function_privilege(
    'public',
    'private.professional_service_summary_bundle(uuid,uuid,date,uuid,text,text,timestamptz)',
    'execute'
  )
  and not has_function_privilege(
    'authenticated',
    'private.professional_service_summary_bundle(uuid,uuid,date,uuid,text,text,timestamptz)',
    'execute'
  ),
  'the raw cross-source bundle is never directly callable'
);

select is(
  (select count(*) from pg_trigger
    where not tgisinternal
      and tgname = 'professional_service_summary_snapshots_immutable'),
  1::bigint,
  'stored summary payloads reject in-place updates'
);

select ok(
  not exists (
    select 1
    from pg_constraint constraint_row
    cross join lateral unnest(constraint_row.conkey) fk_attnum
    where constraint_row.contype = 'f'
      and constraint_row.conrelid =
        'private.professional_service_summary_snapshots'::regclass
      and not exists (
        select 1 from pg_index index_row
        where index_row.indrelid = constraint_row.conrelid
          and fk_attnum = any(index_row.indkey)
      )
  ),
  'every snapshot foreign-key column participates in an index'
);

select ok(
  position('ordinal <= 300' in pg_get_functiondef(
    'private.professional_service_summary_bundle(uuid,uuid,date,uuid,text,text,timestamptz)'::regprocedure
  )) > 0
  and position('ordinal <= 200' in pg_get_functiondef(
    'private.professional_service_summary_bundle(uuid,uuid,date,uuid,text,text,timestamptz)'::regprocedure
  )) > 0,
  'details and client options have explicit server-side bounds'
);

select ok(
  position('candidate_only' in pg_get_functiondef(
    'private.professional_service_summary_bundle(uuid,uuid,date,uuid,text,text,timestamptz)'::regprocedure
  )) > 0
  and position('license_required_not_configured' in pg_get_functiondef(
    'private.professional_service_summary_bundle(uuid,uuid,date,uuid,text,text,timestamptz)'::regprocedure
  )) > 0
  and position('missing_schedule_claim' in pg_get_functiondef(
    'private.professional_service_summary_bundle(uuid,uuid,date,uuid,text,text,timestamptz)'::regprocedure
  )) > 0,
  'unfinished source domains and unavailable schedule claims are explicit'
);

insert into auth.users (id, aud, role, email, created_at, updated_at) values
  ('42000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'page42.actor@example.invalid', now(), now()),
  ('42000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'page42.other@example.invalid', now(), now());

insert into public.organizations (id, code, name) values
  ('42100000-0000-4000-8000-000000000001', 'page42_org', '合成專業彙整機構');

insert into public.branches (id, organization_id, code, name) values
  ('42200000-0000-4000-8000-000000000001', '42100000-0000-4000-8000-000000000001', 'main', '合成主分支'),
  ('42200000-0000-4000-8000-000000000002', '42100000-0000-4000-8000-000000000001', 'other', '合成其他分支');

insert into public.profiles (id, display_name, kind) values
  ('42000000-0000-4000-8000-000000000001', '合成專業人員甲', 'professional'),
  ('42000000-0000-4000-8000-000000000002', '合成專業人員乙', 'professional');

insert into public.memberships (
  id, organization_id, branch_id, profile_id, status
) values
  ('42300000-0000-4000-8000-000000000001', '42100000-0000-4000-8000-000000000001', '42200000-0000-4000-8000-000000000001', '42000000-0000-4000-8000-000000000001', 'active'),
  ('42300000-0000-4000-8000-000000000002', '42100000-0000-4000-8000-000000000001', '42200000-0000-4000-8000-000000000001', '42000000-0000-4000-8000-000000000002', 'active');

insert into public.membership_roles (membership_id, role_id) values
  ('42300000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000007'),
  ('42300000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000007');

insert into public.clients (
  id, organization_id, branch_id, client_code, display_name, status,
  admitted_on, ended_on
) values
  ('42400000-0000-4000-8000-000000000001', '42100000-0000-4000-8000-000000000001', '42200000-0000-4000-8000-000000000001', 'P42-1', '合成指派個案', 'active', current_date - 90, null),
  ('42400000-0000-4000-8000-000000000002', '42100000-0000-4000-8000-000000000001', '42200000-0000-4000-8000-000000000001', 'P42-2', '合成未指派個案', 'active', current_date - 60, null),
  ('42400000-0000-4000-8000-000000000003', '42100000-0000-4000-8000-000000000001', '42200000-0000-4000-8000-000000000002', 'P42-3', '合成其他分支個案', 'active', current_date - 30, null);

insert into public.client_assignments (
  id, organization_id, branch_id, client_id, assignee_user_id,
  assignment_kind
) values (
  '42500000-0000-4000-8000-000000000001',
  '42100000-0000-4000-8000-000000000001',
  '42200000-0000-4000-8000-000000000001',
  '42400000-0000-4000-8000-000000000001',
  '42000000-0000-4000-8000-000000000001',
  'professional-service-summary'
);

insert into private.reauth_challenges (
  id, user_id, session_id, nonce_sha256, idempotency_key,
  issued_jwt_iat, created_at, expires_at, consumed_at, consumed_jwt_iat,
  factor_method, factor_verified_at
) values
  ('42600000-0000-4000-8000-000000000001', '42000000-0000-4000-8000-000000000001', '42610000-0000-4000-8000-000000000001', repeat('4', 64), '42620000-0000-4000-8000-000000000001', clock_timestamp() - interval '2 minutes', clock_timestamp() - interval '2 minutes', clock_timestamp() + interval '6 minutes', clock_timestamp() - interval '30 seconds', clock_timestamp() - interval '30 seconds', 'totp', clock_timestamp() - interval '30 seconds'),
  ('42600000-0000-4000-8000-000000000002', '42000000-0000-4000-8000-000000000002', '42610000-0000-4000-8000-000000000002', repeat('5', 64), '42620000-0000-4000-8000-000000000002', clock_timestamp() - interval '2 minutes', clock_timestamp() - interval '2 minutes', clock_timestamp() + interval '6 minutes', clock_timestamp() - interval '30 seconds', clock_timestamp() - interval '30 seconds', 'totp', clock_timestamp() - interval '30 seconds');

insert into private.reauth_events (
  user_id, session_id, challenge_id, aal, verification_method, verified_at
) values
  ('42000000-0000-4000-8000-000000000001', '42610000-0000-4000-8000-000000000001', '42600000-0000-4000-8000-000000000001', 'aal2', 'totp', (select factor_verified_at from private.reauth_challenges where id = '42600000-0000-4000-8000-000000000001')),
  ('42000000-0000-4000-8000-000000000002', '42610000-0000-4000-8000-000000000002', '42600000-0000-4000-8000-000000000002', 'aal2', 'totp', (select factor_verified_at from private.reauth_challenges where id = '42600000-0000-4000-8000-000000000002'));

insert into public.occupational_therapy_assessment_versions (
  id, organization_id, branch_id, client_id, assessment_key, version,
  previous_version_id, record_state, assessed_on, therapist_user_id,
  therapist_display_name, service_status_at_assessment,
  reassessment_due_on, due_basis, measurements, functional_observation,
  goals, recommendations, follow_up_plan, form_basis,
  form_version_reference, correction_reason, signed_at, signed_by,
  signer_display_name, signer_role_keys, signature_purpose,
  signature_reauth_challenge_id, content_hash
) values (
  '42700000-0000-4000-8000-000000000001',
  '42100000-0000-4000-8000-000000000001',
  '42200000-0000-4000-8000-000000000001',
  '42400000-0000-4000-8000-000000000001',
  '42710000-0000-4000-8000-000000000001', 1, null, 'draft',
  current_date - 2, '42000000-0000-4000-8000-000000000001',
  '合成專業人員甲', 'active', current_date + 10,
  '合成示例：人工排定複評',
  '[{"name":"合成人工觀察","state":"text","value":"合成評估內容","unit":null,"reason":null}]'::jsonb,
  '合成功能觀察', '合成目標', '合成建議', '合成追蹤',
  'manual_unstandardized', 'manual-occupational-therapy-v1', null,
  null, null, null, null, null, null, repeat('a', 64)
);

create temporary table summary_result (
  snapshot_id uuid, snapshot_hash text, expires_at timestamptz, payload jsonb
);
create temporary table completed_result (like summary_result);
create temporary table professional_result (like summary_result);
create temporary table client_result (like summary_result);
create temporary table export_result (like summary_result);
grant select, insert on summary_result, completed_result, professional_result,
  client_result, export_result to authenticated;

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"42000000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal1","session_id":"42610000-0000-4000-8000-000000000001"}',
  true
);

select throws_ok($$select * from public.professional_service_summary_snapshot(
  '42100000-0000-4000-8000-000000000001',
  '42200000-0000-4000-8000-000000000001',
  date_trunc('month', current_date)::date
)$$, '42501', 'professional service summary snapshot is not permitted',
  'snapshot reads require AAL2');

select set_config(
  'request.jwt.claims',
  '{"sub":"42000000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2","session_id":"42610000-0000-4000-8000-000000000001"}',
  true
);

select throws_ok($$select * from public.professional_service_summary_snapshot(
  '42100000-0000-4000-8000-000000000001',
  '42200000-0000-4000-8000-000000000002',
  date_trunc('month', current_date)::date
)$$, '42501', 'professional service summary snapshot is not permitted',
  'branch-scoped professional cannot read another branch');

select throws_ok($$select * from public.professional_service_summary_snapshot(
  '42100000-0000-4000-8000-000000000001',
  '42200000-0000-4000-8000-000000000001',
  date_trunc('month', current_date)::date,
  '42400000-0000-4000-8000-000000000002'
)$$, '42501', 'professional service summary client filter is not permitted',
  'an explicit unassigned-client filter fails closed');

select throws_ok($$select * from public.professional_service_summary_snapshot(
  '42100000-0000-4000-8000-000000000001',
  '42200000-0000-4000-8000-000000000001', current_date
)$$, '42501', 'professional service summary snapshot is not permitted',
  'a non-month-start date fails closed');

select throws_ok($$select * from public.professional_service_summary_snapshot(
  '42100000-0000-4000-8000-000000000001',
  '42200000-0000-4000-8000-000000000001',
  date_trunc('month', current_date)::date, null, 'invented', 'all'
)$$, '42501', 'professional service summary snapshot is not permitted',
  'an unknown professional filter fails closed');

select throws_ok($$select * from public.professional_service_summary_snapshot(
  '42100000-0000-4000-8000-000000000001',
  '42200000-0000-4000-8000-000000000001',
  date_trunc('month', current_date)::date, null, 'all', 'invented'
)$$, '42501', 'professional service summary snapshot is not permitted',
  'an unknown status filter fails closed');

insert into summary_result
select * from public.professional_service_summary_snapshot(
  '42100000-0000-4000-8000-000000000001',
  '42200000-0000-4000-8000-000000000001',
  date_trunc('month', current_date)::date
);

select is((select count(*) from summary_result), 1::bigint,
  'a valid request creates one actor-scoped snapshot row');

select ok(
  (select snapshot_id is not null and snapshot_hash ~ '^[a-f0-9]{64}$'
    and expires_at > clock_timestamp() from summary_result),
  'snapshot response carries an id hash and future expiry'
);

select ok(
  (select payload ->> 'organization_id' =
      '42100000-0000-4000-8000-000000000001'
    and payload ->> 'branch_id' =
      '42200000-0000-4000-8000-000000000001'
    and payload ->> 'month' = to_char(current_date, 'YYYY-MM')
    from summary_result),
  'snapshot payload repeats the exact tenant branch and month boundary'
);

select ok(
  (select payload ->> 'source_configuration_count' = '9'
    and payload ->> 'configured_source_count' = '7'
    and payload ->> 'not_configured_source_count' = '2'
    and payload ->> 'missing_schedule_claim' = 'not_made'
    from summary_result),
  'all Pages 33 through 41 are accounted for without inventing two blocked domains'
);

select is(
  (select jsonb_array_length(payload -> 'items') from summary_result),
  1,
  'only the assigned client authoritative source item is visible'
);

select ok(
  (select payload #>> '{items,0,source_page}' = '33'
    and payload #>> '{items,0,summary_status}' = 'pending'
    and payload #>> '{items,0,status_reason}' = '評估草稿待簽署'
    and payload #>> '{items,0,client_display_name}' = '合成指派個案'
    from summary_result),
  'the source item carries a textual pending state and its assigned client'
);

select ok(
  (select payload #>> '{metrics,expected}' = '1'
    and payload #>> '{metrics,completed}' = '0'
    and payload #>> '{metrics,pending}' = '1'
    and payload #>> '{metrics,overdue}' = '0'
    and payload ->> 'item_total' = '1'
    from summary_result),
  'summary metrics exactly reconcile to the same detail snapshot'
);

select ok(
  (select jsonb_array_length(payload -> 'client_options') = 1
    and payload #>> '{client_options,0,client_id}' =
      '42400000-0000-4000-8000-000000000001'
    from summary_result),
  'client options exclude unassigned and cross-branch people'
);

select matches(
  (select payload #>> '{items,0,source_href}' from summary_result),
  '^/app/staff/professional-care/occupational-assessment[?]client=42400000-0000-4000-8000-000000000001$',
  'detail provides an internal source drilldown with the exact client id'
);

insert into completed_result
select * from public.professional_service_summary_snapshot(
  '42100000-0000-4000-8000-000000000001',
  '42200000-0000-4000-8000-000000000001',
  date_trunc('month', current_date)::date, null, 'all', 'completed'
);

select ok(
  (select payload ->> 'item_total' = '0'
    and payload #>> '{metrics,expected}' = '0'
    and jsonb_array_length(payload -> 'items') = 0
    from completed_result),
  'status filtering recomputes both details and metrics from one filtered set'
);

insert into professional_result
select * from public.professional_service_summary_snapshot(
  '42100000-0000-4000-8000-000000000001',
  '42200000-0000-4000-8000-000000000001',
  date_trunc('month', current_date)::date,
  null, 'physical_therapy', 'all'
);

select is(
  (select (payload ->> 'item_total')::bigint from professional_result),
  0::bigint,
  'professional-kind filtering excludes unrelated source rows'
);

insert into client_result
select * from public.professional_service_summary_snapshot(
  '42100000-0000-4000-8000-000000000001',
  '42200000-0000-4000-8000-000000000001',
  date_trunc('month', current_date)::date,
  '42400000-0000-4000-8000-000000000001', 'all', 'all'
);

select is(
  (select (payload ->> 'item_total')::bigint from client_result),
  1::bigint,
  'an assigned-client filter preserves the matching detail and total'
);

select set_config(
  'request.jwt.claims',
  '{"sub":"42000000-0000-4000-8000-000000000002","role":"authenticated","aal":"aal2","session_id":"42610000-0000-4000-8000-000000000002"}',
  true
);

select throws_ok(format(
  'select * from public.professional_service_summary_export_snapshot(%L,%L,%L)',
  '42100000-0000-4000-8000-000000000001',
  '42200000-0000-4000-8000-000000000001',
  (select snapshot_id from summary_result)
), '42501', 'professional service summary export is not permitted',
  'another authorized actor cannot export the first actor snapshot');

select set_config(
  'request.jwt.claims',
  '{"sub":"42000000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2","session_id":"42610000-0000-4000-8000-000000000099"}',
  true
);

select throws_ok(format(
  'select * from public.professional_service_summary_export_snapshot(%L,%L,%L)',
  '42100000-0000-4000-8000-000000000001',
  '42200000-0000-4000-8000-000000000001',
  (select snapshot_id from summary_result)
), '42501', 'professional service summary export is not permitted',
  'export rejects AAL2 that is not recent in the same session');

select set_config(
  'request.jwt.claims',
  '{"sub":"42000000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2","session_id":"42610000-0000-4000-8000-000000000001"}',
  true
);

insert into export_result
select * from public.professional_service_summary_export_snapshot(
  '42100000-0000-4000-8000-000000000001',
  '42200000-0000-4000-8000-000000000001',
  (select snapshot_id from summary_result)
);

select is((select count(*) from export_result), 1::bigint,
  'same-session recent AAL2 permits one export response');

select ok(
  (select exported.snapshot_id = original.snapshot_id
    and exported.snapshot_hash = original.snapshot_hash
    and exported.payload = original.payload
    from export_result exported cross join summary_result original),
  'export returns the exact persisted UI detail and metric payload'
);

reset role;

select ok(
  (select snapshot.actor_user_id =
      '42000000-0000-4000-8000-000000000001'::uuid
    and snapshot.payload_hash = result.snapshot_hash
    and snapshot.payload = result.payload
    and snapshot.expires_at <= snapshot.created_at + interval '15 minutes'
    from private.professional_service_summary_snapshots snapshot
    join summary_result result on result.snapshot_id = snapshot.id),
  'the private snapshot is actor bound hashed and time bounded'
);

select ok(
  exists (
    select 1 from public.audit_events audit
    join summary_result result on result.snapshot_id::text = audit.row_pk
    where audit.action = 'select'
      and audit.table_name = 'professional_service_summary_snapshots'
      and audit.metadata ->> 'snapshot_hash' = result.snapshot_hash
      and audit.metadata ->> 'filter_values_logged' = 'false'
      and audit.metadata ->> 'client_names_logged' = 'false'
      and audit.metadata::text not like '%合成指派個案%'
  ),
  'snapshot access audit stores counts and hash without names or filter values'
);

select ok(
  exists (
    select 1 from public.audit_events audit
    join summary_result result on result.snapshot_id::text = audit.row_pk
    where audit.action = 'export'
      and audit.metadata ->> 'snapshot_hash' = result.snapshot_hash
      and audit.metadata ->> 'filter_values_logged' = 'false'
      and audit.metadata ->> 'client_names_logged' = 'false'
      and audit.metadata::text not like '%合成指派個案%'
  ),
  'export audit preserves snapshot identity without names or filters'
);

select throws_ok(format(
  'update private.professional_service_summary_snapshots set expires_at = expires_at + interval ''1 second'' where id = %L',
  (select snapshot_id from summary_result)
), '55000', 'professional service summary snapshot is immutable',
  'even the table owner cannot rewrite a created snapshot');

select * from finish();
rollback;
