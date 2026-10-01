begin;
select plan(15);

select is(
  (select convalidated from pg_constraint where conname = 'care_records_local_diary_shift_time_check'),
  false,
  'historical rows are not scanned or rewritten by the new check'
);

-- Synthetic records only. Testing at fixed Taipei instants avoids clock-time
-- dependence and verifies the exact noon boundary.
insert into auth.users (id, aud, role, email, email_confirmed_at, created_at, updated_at)
values ('e1000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated',
  'shift-guard@example.invalid', now(), now(), now());
insert into public.organizations (id, code, name)
values ('e2000000-0000-4000-8000-000000000001', 'shift-guard-synthetic', 'Synthetic shift guard');
insert into public.branches (id, organization_id, code, name)
values ('e3000000-0000-4000-8000-000000000001', 'e2000000-0000-4000-8000-000000000001',
  'main', 'Synthetic branch');
insert into public.clients (id, organization_id, branch_id, client_code, display_name, status, admitted_on)
values ('e4000000-0000-4000-8000-000000000001', 'e2000000-0000-4000-8000-000000000001',
  'e3000000-0000-4000-8000-000000000001', 'SHIFT-TEST-1', 'Synthetic client', 'active', '2026-01-01');

select lives_ok($$insert into public.care_records
  (organization_id, branch_id, client_id, record_key, category, occurred_at, data, created_by)
  values ('e2000000-0000-4000-8000-000000000001', 'e3000000-0000-4000-8000-000000000001',
    'e4000000-0000-4000-8000-000000000001', 'e5000000-0000-4000-8000-000000000001',
    'staff/daily-care/care-diary', '2026-10-01 11:59:59+08',
    '{"fields":{"shift":"morning"}}', 'e1000000-0000-4000-8000-000000000001')$$,
  'morning draft at 11:59:59 Taipei is accepted');

select lives_ok($$insert into public.care_records
  (organization_id, branch_id, client_id, record_key, category, occurred_at, data, created_by)
  values ('e2000000-0000-4000-8000-000000000001', 'e3000000-0000-4000-8000-000000000001',
    'e4000000-0000-4000-8000-000000000001', 'e5000000-0000-4000-8000-000000000002',
    'staff/daily-care/care-diary', '2026-10-01 12:00:00+08',
    '{"fields":{"shift":"afternoon"}}', 'e1000000-0000-4000-8000-000000000001')$$,
  'afternoon draft at 12:00 Taipei is accepted');

select lives_ok($$insert into public.care_records
  (organization_id, branch_id, client_id, record_key, category, occurred_at, data, created_by)
  values ('e2000000-0000-4000-8000-000000000001', 'e3000000-0000-4000-8000-000000000001',
    'e4000000-0000-4000-8000-000000000001', 'e5000000-0000-4000-8000-000000000003',
    'staff/daily-care/care-diary', '2026-10-01 13:00:00+08',
    '{"fields":{"shift":"full_day"}}', 'e1000000-0000-4000-8000-000000000001')$$,
  'full-day label is allowed at any event time without asserting both roster shifts');

select throws_ok($$insert into public.care_records
  (organization_id, branch_id, client_id, category, occurred_at, data, created_by)
  values ('e2000000-0000-4000-8000-000000000001', 'e3000000-0000-4000-8000-000000000001',
    'e4000000-0000-4000-8000-000000000001', 'staff/daily-care/care-diary',
    '2026-10-01 12:00:00+08', '{"fields":{"shift":"morning"}}',
    'e1000000-0000-4000-8000-000000000001')$$,
  '23514', null, 'morning label cannot mark an afternoon event');

select throws_ok($$insert into public.care_records
  (organization_id, branch_id, client_id, category, occurred_at, data, created_by)
  values ('e2000000-0000-4000-8000-000000000001', 'e3000000-0000-4000-8000-000000000001',
    'e4000000-0000-4000-8000-000000000001', 'staff/daily-care/care-diary',
    '2026-10-01 11:59:59+08', '{"fields":{"shift":"afternoon"}}',
    'e1000000-0000-4000-8000-000000000001')$$,
  '23514', null, 'afternoon label cannot mark a morning event');

select throws_ok($$insert into public.care_records
  (organization_id, branch_id, client_id, category, occurred_at, data, created_by)
  values ('e2000000-0000-4000-8000-000000000001', 'e3000000-0000-4000-8000-000000000001',
    'e4000000-0000-4000-8000-000000000001', 'staff/daily-care/care-diary',
    '2026-10-01 13:00:00+08', '{"fields":{"shift":"night"}}',
    'e1000000-0000-4000-8000-000000000001')$$,
  '23514', null, 'an unknown structured shift is denied');

select throws_ok($$insert into public.care_records
  (organization_id, branch_id, client_id, category, occurred_at, data, created_by)
  values ('e2000000-0000-4000-8000-000000000001', 'e3000000-0000-4000-8000-000000000001',
    'e4000000-0000-4000-8000-000000000001', 'staff/daily-care/care-diary',
    '2026-10-01 13:00:00+08',
    '{"fields":{},"_request":{"page_slug":"staff/daily-care/care-diary"}}',
    'e1000000-0000-4000-8000-000000000001')$$,
  '23514', null, 'a canonical new draft cannot omit its shift');

select throws_ok($$update public.care_records
  set data = jsonb_set(data, '{fields,shift}', '"afternoon"'::jsonb)
  where record_key = 'e5000000-0000-4000-8000-000000000001'$$,
  '23514', null, 'changing an existing morning draft into the wrong shift is denied');

select lives_ok($$insert into public.care_records
  (organization_id, branch_id, client_id, record_key, version, previous_version_id,
   category, occurred_at, data, created_by, correction_reason)
  select organization_id, branch_id, client_id, record_key, 2, id,
    category, occurred_at, '{"fields":{"shift":"morning"}}', created_by, 'Synthetic draft edit'
  from public.care_records where record_key = 'e5000000-0000-4000-8000-000000000001'
    and version = 1$$,
  'a consistent draft revision is accepted');

select throws_ok($$insert into public.care_records
  (organization_id, branch_id, client_id, record_key, version, previous_version_id,
   category, status, occurred_at, data, created_by, correction_reason, signed_at,
   signed_by, signature_purpose, content_hash)
  select organization_id, branch_id, client_id, record_key, 2, id,
    category, 'signed', occurred_at, '{"fields":{"shift":"morning"}}', created_by,
    'Synthetic signature', now(), created_by, 'Synthetic sign', repeat('a', 64)
  from public.care_records where record_key = 'e5000000-0000-4000-8000-000000000002'
    and version = 1$$,
  '23514', null, 'a signed revision cannot carry a shift conflicting with its event time');

select lives_ok($$insert into public.care_records
  (organization_id, branch_id, client_id, record_key, version, previous_version_id,
   category, status, occurred_at, data, created_by, correction_reason, signed_at,
   signed_by, signature_purpose, content_hash)
  select organization_id, branch_id, client_id, record_key, 2, id,
    category, 'signed', occurred_at, '{"fields":{"shift":"full_day"}}', created_by,
    'Synthetic signature', now(), created_by, 'Synthetic sign', repeat('a', 64)
  from public.care_records where record_key = 'e5000000-0000-4000-8000-000000000003'
    and version = 1$$,
  'a consistent signed revision remains possible');

select lives_ok($$insert into public.care_records
  (organization_id, branch_id, client_id, record_key, category, occurred_at, data, created_by)
  values ('e2000000-0000-4000-8000-000000000001', 'e3000000-0000-4000-8000-000000000001',
    'e4000000-0000-4000-8000-000000000001', 'e5000000-0000-4000-8000-000000000004',
    'staff/daily-care/care-diary', '2026-10-01 13:00:00+08',
    '{"shift":"morning","note":"Legacy diary shape"}',
    'e1000000-0000-4000-8000-000000000001')$$,
  'legacy diary shape without fields.shift remains insertable for compatibility');

select is(
  (select data ->> 'note' from public.care_records
   where record_key = 'e5000000-0000-4000-8000-000000000004'),
  'Legacy diary shape', 'legacy content remains readable without rewrite'
);

select lives_ok($$insert into public.care_records
  (organization_id, branch_id, client_id, category, occurred_at, data, created_by)
  values ('e2000000-0000-4000-8000-000000000001', 'e3000000-0000-4000-8000-000000000001',
    'e4000000-0000-4000-8000-000000000001', 'restricted/clinical',
    '2026-10-01 13:00:00+08', '{"fields":{"shift":"morning"}}',
    'e1000000-0000-4000-8000-000000000001')$$,
  'unrelated record categories are unaffected');

select * from finish();
rollback;
