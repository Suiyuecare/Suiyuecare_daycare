-- Local demonstration seed only. All people and identifiers are fictional and
-- intentionally contain no production personal data.

insert into public.organizations (
  id,
  code,
  name,
  settings
) values (
  '20000000-0000-4000-8000-000000000001',
  'demo_daycare',
  '範例日照中心',
  '{"demo":true,"data_classification":"synthetic"}'::jsonb
)
on conflict (id) do nothing;

insert into public.branches (
  id,
  organization_id,
  code,
  name,
  capacity,
  settings
) values (
  '21000000-0000-4000-8000-000000000001',
  '20000000-0000-4000-8000-000000000001',
  'main',
  '範例本館',
  30,
  '{"demo":true}'::jsonb
)
on conflict (id) do nothing;

insert into public.clients (
  id,
  organization_id,
  branch_id,
  client_code,
  external_key,
  display_name,
  status,
  admitted_on,
  source_system
) values
  (
    '22000000-0000-4000-8000-000000000001',
    '20000000-0000-4000-8000-000000000001',
    '21000000-0000-4000-8000-000000000001',
    'DEMO-001',
    'SYNTHETIC-001',
    '範例個案甲',
    'active',
    '2026-01-05',
    'demo_seed'
  ),
  (
    '22000000-0000-4000-8000-000000000002',
    '20000000-0000-4000-8000-000000000001',
    '21000000-0000-4000-8000-000000000001',
    'DEMO-002',
    'SYNTHETIC-002',
    '範例個案乙',
    'active',
    '2026-01-12',
    'demo_seed'
  )
on conflict (id) do nothing;

insert into public.form_definitions (
  id,
  organization_id,
  form_key,
  name,
  category,
  is_official
) values (
  '23000000-0000-4000-8000-000000000001',
  '20000000-0000-4000-8000-000000000001',
  'demo.vital_sign_note',
  '範例生命徵象備註表',
  'health',
  false
)
on conflict (id) do nothing;

insert into public.form_versions (
  id,
  form_definition_id,
  version,
  status,
  schema_json,
  scoring_json
) values (
  '23100000-0000-4000-8000-000000000001',
  '23000000-0000-4000-8000-000000000001',
  1,
  'draft',
  '{"fields":[{"key":"note","type":"text","required":false}]}'::jsonb,
  '{}'::jsonb
)
on conflict (id) do nothing;

insert into public.measurements (
  id,
  organization_id,
  branch_id,
  client_id,
  measurement_kind,
  measured_at,
  numeric_value,
  unit,
  context,
  source,
  idempotency_key
) values
  (
    '24000000-0000-4000-8000-000000000001',
    '20000000-0000-4000-8000-000000000001',
    '21000000-0000-4000-8000-000000000001',
    '22000000-0000-4000-8000-000000000001',
    'body_temperature',
    '2026-01-15 09:00:00+08',
    36.5,
    'Cel',
    '{"demo":true}'::jsonb,
    'demo_seed',
    '24100000-0000-4000-8000-000000000001'
  ),
  (
    '24000000-0000-4000-8000-000000000002',
    '20000000-0000-4000-8000-000000000001',
    '21000000-0000-4000-8000-000000000001',
    '22000000-0000-4000-8000-000000000002',
    'body_weight',
    '2026-01-15 09:05:00+08',
    60.2,
    'kg',
    '{"demo":true}'::jsonb,
    'demo_seed',
    '24100000-0000-4000-8000-000000000002'
  )
on conflict (organization_id, idempotency_key) do nothing;
