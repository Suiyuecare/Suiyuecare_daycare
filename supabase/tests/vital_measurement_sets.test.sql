begin;

select plan(29);

select ok(
  exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'measurements'
      and column_name = 'measurement_set_id'
  )
  and exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'measurements'
      and column_name = 'request_hash'
  ),
  'measurement sets retain their set id and canonical request hash'
);

select ok(
  exists (
    select 1
    from pg_class index_relation
    join pg_index index_definition
      on index_definition.indexrelid = index_relation.oid
    where index_relation.relname = 'measurements_actor_set_kind_key'
      and index_definition.indisunique
  ),
  'one actor can store at most one row per set and measurement kind'
);

select ok(
  has_function_privilege(
    'authenticated',
    'public.record_vital_set(uuid,uuid,uuid,timestamptz,uuid,numeric,numeric,numeric,numeric,numeric)',
    'execute'
  )
  and not has_function_privilege(
    'anon',
    'public.record_vital_set(uuid,uuid,uuid,timestamptz,uuid,numeric,numeric,numeric,numeric,numeric)',
    'execute'
  )
  and not (
    select procedure.prosecdef
    from pg_proc procedure
    where procedure.oid =
      'public.record_vital_set(uuid,uuid,uuid,timestamptz,uuid,numeric,numeric,numeric,numeric,numeric)'::regprocedure
  ),
  'the public vital writer is an authenticated-only SECURITY INVOKER wrapper'
);

select is(
  pg_get_function_identity_arguments(
    'public.record_vital_set(uuid,uuid,uuid,timestamptz,uuid,numeric,numeric,numeric,numeric,numeric)'::regprocedure
  ),
  'p_expected_organization_id uuid, p_expected_branch_id uuid, p_client_id uuid, p_measured_at timestamp with time zone, p_idempotency_key uuid, p_systolic numeric, p_diastolic numeric, p_pulse numeric, p_temperature numeric, p_oxygen_saturation numeric',
  'the vital RPC requires trusted current organization and branch context'
);

select ok(
  (
    select procedure.prosecdef
    from pg_proc procedure
    where procedure.oid =
      'private.record_vital_set_atomic(uuid,uuid,uuid,timestamptz,uuid,numeric,numeric,numeric,numeric,numeric)'::regprocedure
  )
  and has_function_privilege(
    'authenticated',
    'private.record_vital_set_atomic(uuid,uuid,uuid,timestamptz,uuid,numeric,numeric,numeric,numeric,numeric)',
    'execute'
  )
  and not has_function_privilege(
    'anon',
    'private.record_vital_set_atomic(uuid,uuid,uuid,timestamptz,uuid,numeric,numeric,numeric,numeric,numeric)',
    'execute'
  ),
  'the private definer is reachable only through an authenticated invocation'
);

select ok(
  not has_table_privilege('authenticated', 'public.measurements', 'insert')
  and not has_table_privilege('authenticated', 'public.measurements', 'update'),
  'authenticated callers cannot bypass the atomic writer with direct mutations'
);

select ok(
  (
    select
      position('for update;' in function_definition) > 0
      and position('v_now := clock_timestamp()' in function_definition)
        > position('return;' in function_definition)
      and position('v_now := clock_timestamp()' in function_definition)
        > position('for update;' in function_definition)
      and position(
        'measurement time is outside the allowed 24-hour window'
        in function_definition
      ) > position('v_now := clock_timestamp()' in function_definition)
    from (
      select pg_get_functiondef(
        'private.record_vital_set_atomic(uuid,uuid,uuid,timestamptz,uuid,numeric,numeric,numeric,numeric,numeric)'::regprocedure
      ) as function_definition
    ) definition
  ),
  'new vital writes lock lifecycle state and evaluate time only after exact replay'
);

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  ('00000000-0000-0000-0000-000000000000', '61000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'vital-a1@example.invalid', '', now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000000', '61000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'vital-a2@example.invalid', '', now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000000', '61000000-0000-4000-8000-000000000003', 'authenticated', 'authenticated', 'vital-b1@example.invalid', '', now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now());

insert into public.organizations (id, code, name) values
  ('62000000-0000-4000-8000-000000000001', 'vital_org_a', '量測測試機構 A'),
  ('62000000-0000-4000-8000-000000000002', 'vital_org_b', '量測測試機構 B');

insert into public.branches (id, organization_id, code, name) values
  ('63000000-0000-4000-8000-000000000001', '62000000-0000-4000-8000-000000000001', 'main', '量測 A 主分支'),
  ('63000000-0000-4000-8000-000000000002', '62000000-0000-4000-8000-000000000002', 'main', '量測 B 主分支');

insert into public.profiles (id, display_name, kind) values
  ('61000000-0000-4000-8000-000000000001', '量測 A 人員一', 'staff'),
  ('61000000-0000-4000-8000-000000000002', '量測 A 人員二', 'staff'),
  ('61000000-0000-4000-8000-000000000003', '量測 B 人員一', 'staff');

insert into public.memberships (
  id, organization_id, branch_id, profile_id, status
) values
  ('64000000-0000-4000-8000-000000000001', '62000000-0000-4000-8000-000000000001', null, '61000000-0000-4000-8000-000000000001', 'active'),
  ('64000000-0000-4000-8000-000000000002', '62000000-0000-4000-8000-000000000001', null, '61000000-0000-4000-8000-000000000002', 'active'),
  ('64000000-0000-4000-8000-000000000003', '62000000-0000-4000-8000-000000000002', null, '61000000-0000-4000-8000-000000000003', 'active'),
  -- The same actor also has legitimate access to organization B. The RPC must
  -- still honor the currently selected organization/branch context supplied by
  -- trusted server code instead of treating any accessible client as in scope.
  ('64000000-0000-4000-8000-000000000004', '62000000-0000-4000-8000-000000000002', null, '61000000-0000-4000-8000-000000000001', 'active');

insert into public.membership_roles (membership_id, role_id) values
  ('64000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000002'),
  ('64000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000002'),
  ('64000000-0000-4000-8000-000000000003', '10000000-0000-4000-8000-000000000002'),
  ('64000000-0000-4000-8000-000000000004', '10000000-0000-4000-8000-000000000002');

insert into public.clients (
  id, organization_id, branch_id, client_code, display_name, status,
  admitted_on, ended_on, source_system
) values
  ('65000000-0000-4000-8000-000000000001', '62000000-0000-4000-8000-000000000001', '63000000-0000-4000-8000-000000000001', 'VITAL-A-001', '量測個案 A1', 'active', (clock_timestamp() at time zone 'Asia/Taipei')::date - 10, null, 'test'),
  ('65000000-0000-4000-8000-000000000002', '62000000-0000-4000-8000-000000000001', '63000000-0000-4000-8000-000000000001', 'VITAL-A-002', '量測個案 A2', 'closed', (clock_timestamp() at time zone 'Asia/Taipei')::date - 10, (clock_timestamp() at time zone 'Asia/Taipei')::date - 1, 'test'),
  ('65000000-0000-4000-8000-000000000003', '62000000-0000-4000-8000-000000000001', '63000000-0000-4000-8000-000000000001', 'VITAL-A-003', '量測個案 A3', 'active', null, null, 'test'),
  ('65000000-0000-4000-8000-000000000004', '62000000-0000-4000-8000-000000000002', '63000000-0000-4000-8000-000000000002', 'VITAL-B-001', '量測個案 B1', 'active', (clock_timestamp() at time zone 'Asia/Taipei')::date - 10, null, 'test');

-- Model an already-committed request whose client was later closed and whose
-- measured time is now outside the new-write window. Exact replay must remain
-- available to a caller who still has current read/write scope.
with replay_payload as (
  select encode(
    sha256(
      convert_to(
        jsonb_build_object(
          'schema_version', 1,
          'organization_id', '62000000-0000-4000-8000-000000000001'::uuid,
          'branch_id', '63000000-0000-4000-8000-000000000001'::uuid,
          'client_id', '65000000-0000-4000-8000-000000000002'::uuid,
          'measured_at', to_char(
            (now() - interval '25 hours') at time zone 'UTC',
            'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'
          ),
          'values', jsonb_build_object('pulse', 74)
        )::text,
        'UTF8'
      )
    ),
    'hex'
  ) as request_hash
)
insert into public.measurements (
  organization_id, branch_id, client_id, measurement_kind, measured_at,
  numeric_value, unit, context, source, recorded_by, idempotency_key,
  measurement_set_id, request_hash
)
select
  '62000000-0000-4000-8000-000000000001',
  '63000000-0000-4000-8000-000000000001',
  '65000000-0000-4000-8000-000000000002',
  'pulse', now() - interval '25 hours', 74, 'bpm',
  jsonb_build_object(
    '_request', jsonb_build_object(
      'schema_version', 1,
      'measurement_set_id', '66000000-0000-4000-8000-000000000009'::uuid,
      'idempotency_hash', replay_payload.request_hash
    )
  ),
  'staff',
  '61000000-0000-4000-8000-000000000001',
  private.measurement_row_idempotency(
    '62000000-0000-4000-8000-000000000001',
    '61000000-0000-4000-8000-000000000001',
    '66000000-0000-4000-8000-000000000009',
    'pulse'
  ),
  '66000000-0000-4000-8000-000000000009',
  replay_payload.request_hash
from replay_payload;

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"61000000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal1"}'::text,
  true
);

select throws_ok(
  $$select * from public.record_vital_set(
      '62000000-0000-4000-8000-000000000001',
      '63000000-0000-4000-8000-000000000001',
      '65000000-0000-4000-8000-000000000001', now() - interval '1 hour',
      '66000000-0000-4000-8000-000000000001', null, null, 72, null, null
    )$$,
  '42501',
  'an AAL2 staff session is required',
  'AAL1 cannot record a vital-sign set through the database RPC'
);

select set_config(
  'request.jwt.claims',
  '{"sub":"61000000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2"}'::text,
  true
);

select results_eq(
  $$select measurement_kind, replayed
    from public.record_vital_set(
      '62000000-0000-4000-8000-000000000001',
      '63000000-0000-4000-8000-000000000001',
      '65000000-0000-4000-8000-000000000002', now() - interval '25 hours',
      '66000000-0000-4000-8000-000000000009', null, null, 74, null, null
    )$$,
  $$values ('pulse'::text, true)$$,
  'an exact committed request replays after both the 24-hour window and a later terminal lifecycle state'
);

select results_eq(
  $$select measurement_kind, replayed
    from public.record_vital_set(
      '62000000-0000-4000-8000-000000000001',
      '63000000-0000-4000-8000-000000000001',
      '65000000-0000-4000-8000-000000000001', now() - interval '1 hour',
      '66000000-0000-4000-8000-000000000010', 128, 76, null, null, null
    )$$,
  $$values
    ('blood_pressure_diastolic'::text, false),
    ('blood_pressure_systolic'::text, false)$$,
  'an authorized actor atomically records a paired blood-pressure set'
);

select results_eq(
  $$select measurement_kind, numeric_value, unit, source,
           recorded_by, request_hash ~ '^[a-f0-9]{64}$'
    from public.measurements
    where measurement_set_id = '66000000-0000-4000-8000-000000000010'
    order by measurement_kind$$,
  $$values
    ('blood_pressure_diastolic'::text, 76::numeric, 'mmHg'::text, 'staff'::text,
     '61000000-0000-4000-8000-000000000001'::uuid, true),
    ('blood_pressure_systolic'::text, 128::numeric, 'mmHg'::text, 'staff'::text,
     '61000000-0000-4000-8000-000000000001'::uuid, true)$$,
  'the stored rows derive scope, actor, unit, source, value, and hash on the server'
);

select results_eq(
  $$select measurement_kind, replayed
    from public.record_vital_set(
      '62000000-0000-4000-8000-000000000001',
      '63000000-0000-4000-8000-000000000001',
      '65000000-0000-4000-8000-000000000001', now() - interval '1 hour',
      '66000000-0000-4000-8000-000000000010', 128.0, 76.00, null, null, null
    )$$,
  $$values
    ('blood_pressure_diastolic'::text, true),
    ('blood_pressure_systolic'::text, true)$$,
  'the exact semantic request replays even when numeric scales differ'
);

select is(
  (
    select count(*)::integer
    from public.measurements
    where measurement_set_id = '66000000-0000-4000-8000-000000000010'
  ),
  2,
  'an exact replay creates no duplicate measurement rows'
);

select throws_ok(
  $$select * from public.record_vital_set(
      '62000000-0000-4000-8000-000000000001',
      '63000000-0000-4000-8000-000000000001',
      '65000000-0000-4000-8000-000000000001', now() - interval '1 hour',
      '66000000-0000-4000-8000-000000000010', 129, 76, null, null, null
    )$$,
  '23505',
  'vital-sign idempotency conflict',
  'reusing a set key for changed content is rejected'
);

select throws_ok(
  $$select * from public.record_vital_set(
      '62000000-0000-4000-8000-000000000001',
      '63000000-0000-4000-8000-000000000001',
      '65000000-0000-4000-8000-000000000001', now(),
      '66000000-0000-4000-8000-000000000011', 120, null, null, null, null
    )$$,
  '22023',
  'systolic and diastolic pressure must be recorded together',
  'blood pressure must be supplied as a pair'
);

select throws_ok(
  $$select * from public.record_vital_set(
      '62000000-0000-4000-8000-000000000001',
      '63000000-0000-4000-8000-000000000001',
      '65000000-0000-4000-8000-000000000001', now(),
      '66000000-0000-4000-8000-000000000012', null, null, 72.5, null, null
    )$$,
  '22023',
  'one or more vital-sign values are outside the technical input range',
  'integer vital kinds reject fractional precision in the database'
);

select throws_ok(
  $$select * from public.record_vital_set(
      '62000000-0000-4000-8000-000000000001',
      '63000000-0000-4000-8000-000000000001',
      '65000000-0000-4000-8000-000000000001', now(),
      '66000000-0000-4000-8000-000000000013', null, null, null, 36.66, null
    )$$,
  '22023',
  'one or more vital-sign values are outside the technical input range',
  'temperature rejects more than one decimal place in the database'
);

select throws_ok(
  $$select * from public.record_vital_set(
      '62000000-0000-4000-8000-000000000001',
      '63000000-0000-4000-8000-000000000001',
      '65000000-0000-4000-8000-000000000001', now(),
      '66000000-0000-4000-8000-000000000014', null, null, 'NaN'::numeric, null, null
    )$$,
  '22023',
  'one or more vital-sign values are outside the technical input range',
  'non-finite numeric input is rejected explicitly'
);

select throws_ok(
  $$select * from public.record_vital_set(
      '62000000-0000-4000-8000-000000000001',
      '63000000-0000-4000-8000-000000000001',
      '65000000-0000-4000-8000-000000000001', now(),
      '66000000-0000-4000-8000-000000000015', null, null, null, null, 101
    )$$,
  '22023',
  'one or more vital-sign values are outside the technical input range',
  'a value outside the broad technical input range is rejected'
);

select throws_ok(
  $$select * from public.record_vital_set(
      '62000000-0000-4000-8000-000000000001',
      '63000000-0000-4000-8000-000000000001',
      '65000000-0000-4000-8000-000000000002', now(),
      '66000000-0000-4000-8000-000000000016', null, null, 72, null, null
    )$$,
  '42501',
  'vital-sign recording is not permitted',
  'a terminal client cannot receive a new measurement'
);

select throws_ok(
  $$select * from public.record_vital_set(
      '62000000-0000-4000-8000-000000000001',
      '63000000-0000-4000-8000-000000000001',
      '65000000-0000-4000-8000-000000000003', now(),
      '66000000-0000-4000-8000-000000000017', null, null, 72, null, null
    )$$,
  '42501',
  'vital-sign recording is not permitted',
  'an active client without an admission cannot receive a measurement'
);

select throws_ok(
  $$select * from public.record_vital_set(
      '62000000-0000-4000-8000-000000000001',
      '63000000-0000-4000-8000-000000000001',
      '65000000-0000-4000-8000-000000000004', now(),
      '66000000-0000-4000-8000-000000000018', null, null, 72, null, null
    )$$,
  '42501',
  'vital-sign recording is not permitted',
  'the selected tenant context rejects a client the actor can access in another organization'
);

set local timezone = 'UTC';

select results_eq(
  $$select measurement_kind, replayed
    from public.record_vital_set(
      '62000000-0000-4000-8000-000000000001',
      '63000000-0000-4000-8000-000000000001',
      '65000000-0000-4000-8000-000000000001', now() - interval '30 minutes',
      '66000000-0000-4000-8000-000000000020', null, null, 73, 36.6, 98
    )$$,
  $$values
    ('oxygen_saturation'::text, false),
    ('pulse'::text, false),
    ('temperature'::text, false)$$,
  'a canonical multi-kind set can be recorded in a UTC database session'
);

set local timezone = 'Asia/Taipei';

select results_eq(
  $$select measurement_kind, replayed
    from public.record_vital_set(
      '62000000-0000-4000-8000-000000000001',
      '63000000-0000-4000-8000-000000000001',
      '65000000-0000-4000-8000-000000000001', now() - interval '30 minutes',
      '66000000-0000-4000-8000-000000000020', null, null, 73.0, 36.60, 98.0
    )$$,
  $$values
    ('oxygen_saturation'::text, true),
    ('pulse'::text, true),
    ('temperature'::text, true)$$,
  'the same instant and values replay after the session time zone changes'
);

select is(
  (
    select count(distinct request_hash)::integer
    from public.measurements
    where measurement_set_id = '66000000-0000-4000-8000-000000000020'
  ),
  1,
  'every row in a vital set stores one canonical request hash'
);

select set_config(
  'request.jwt.claims',
  '{"sub":"61000000-0000-4000-8000-000000000002","role":"authenticated","aal":"aal2"}'::text,
  true
);

select results_eq(
  $$select measurement_kind, replayed
    from public.record_vital_set(
      '62000000-0000-4000-8000-000000000001',
      '63000000-0000-4000-8000-000000000001',
      '65000000-0000-4000-8000-000000000001', now() - interval '30 minutes',
      '66000000-0000-4000-8000-000000000020', null, null, 73, 36.6, 98
    )$$,
  $$values
    ('oxygen_saturation'::text, false),
    ('pulse'::text, false),
    ('temperature'::text, false)$$,
  'a second authorized actor may safely use the same caller-provided set UUID'
);

select is(
  (
    select count(distinct idempotency_key)::integer
    from public.measurements
    where organization_id = '62000000-0000-4000-8000-000000000001'
      and measurement_set_id = '66000000-0000-4000-8000-000000000020'
  ),
  6,
  'row idempotency UUIDs include the actor and do not collide within a tenant'
);

select throws_ok(
  $$insert into public.measurements (
      organization_id, branch_id, client_id, measurement_kind, measured_at,
      numeric_value, unit, recorded_by, idempotency_key
    ) values (
      '62000000-0000-4000-8000-000000000001',
      '63000000-0000-4000-8000-000000000001',
      '65000000-0000-4000-8000-000000000001', 'pulse', now(), 70, 'bpm',
      '61000000-0000-4000-8000-000000000002',
      '66000000-0000-4000-8000-000000000030'
    )$$,
  '42501',
  null,
  'direct measurement insert is denied after the atomic RPC is installed'
);

select throws_ok(
  $$update public.measurements
    set numeric_value = 999
    where organization_id = '62000000-0000-4000-8000-000000000001'$$,
  '42501',
  null,
  'direct measurement update is denied after the atomic RPC is installed'
);

select * from finish();
rollback;
