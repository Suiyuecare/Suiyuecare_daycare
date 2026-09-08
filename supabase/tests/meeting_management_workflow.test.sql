begin;

select plan(47);

-- 1
select ok(
  has_function_privilege('authenticated', 'public.meeting_management_snapshot(uuid,uuid)', 'execute')
  and has_function_privilege(
    'authenticated',
    'public.record_signed_meeting_minutes(uuid,uuid,uuid,uuid,text,text,text,timestamptz,timestamptz,uuid[],jsonb,jsonb,jsonb,jsonb,uuid)',
    'execute'
  )
  and has_function_privilege(
    'authenticated',
    'public.append_meeting_action_update(uuid,uuid,uuid,uuid,uuid,uuid,text,text,uuid)',
    'execute'
  )
  and not has_function_privilege('anon', 'public.meeting_management_snapshot(uuid,uuid)', 'execute')
  and has_function_privilege(
    'authenticated',
    'private.record_signed_meeting_minutes_guarded(uuid,uuid,uuid,uuid,text,text,text,timestamptz,timestamptz,uuid[],jsonb,jsonb,jsonb,jsonb,uuid)',
    'execute'
  )
  and has_function_privilege(
    'authenticated',
    'private.append_meeting_action_update_guarded(uuid,uuid,uuid,uuid,uuid,uuid,text,text,uuid)',
    'execute'
  )
  and has_function_privilege(
    'authenticated', 'private.meeting_management_snapshot_response(uuid,uuid)', 'execute'
  )
  and not has_function_privilege(
    'authenticated', 'private.meeting_management_snapshot_bundle(uuid,uuid,timestamptz)', 'execute'
  )
  and not has_function_privilege(
    'authenticated', 'private.meeting_current_authority(uuid,uuid,text,boolean)', 'execute'
  ),
  'authenticated can execute invoker wrappers and only their three guarded private cores'
);

-- 2
select ok(
  not has_table_privilege('authenticated', 'public.meeting_minute_versions', 'select')
  and not has_table_privilege('authenticated', 'public.meeting_minute_versions', 'insert')
  and not has_table_privilege('authenticated', 'public.meeting_minute_versions', 'update')
  and not has_table_privilege('authenticated', 'public.meeting_minute_versions', 'delete')
  and not has_table_privilege('authenticated', 'public.meeting_action_updates', 'select')
  and not has_table_privilege('authenticated', 'public.meeting_action_updates', 'insert'),
  'authenticated users cannot bypass guarded append-only writers'
);

-- 3
select ok(
  exists (select 1 from pg_trigger where tgname = 'meeting_minute_versions_append_only' and not tgisinternal)
  and exists (select 1 from pg_trigger where tgname = 'meeting_action_updates_append_only' and not tgisinternal)
  and exists (select 1 from pg_trigger where tgname = 'meeting_minute_versions_audit_row_change' and not tgisinternal)
  and exists (select 1 from pg_trigger where tgname = 'meeting_action_updates_audit_row_change' and not tgisinternal),
  'signed minutes and action updates both have append-only and exact audit triggers'
);

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  ('00000000-0000-0000-0000-000000000000', '75a10000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'meeting-manager@example.invalid', '', now(), '{"provider":"email","providers":["email"]}', '{}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '75a10000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'meeting-attendee@example.invalid', '', now(), '{"provider":"email","providers":["email"]}', '{}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '75a10000-0000-4000-8000-000000000003', 'authenticated', 'authenticated', 'meeting-responsible@example.invalid', '', now(), '{"provider":"email","providers":["email"]}', '{}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '75a10000-0000-4000-8000-000000000004', 'authenticated', 'authenticated', 'meeting-other@example.invalid', '', now(), '{"provider":"email","providers":["email"]}', '{}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '75a10000-0000-4000-8000-000000000005', 'authenticated', 'authenticated', 'meeting-inactive@example.invalid', '', now(), '{"provider":"email","providers":["email"]}', '{}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '75a10000-0000-4000-8000-000000000006', 'authenticated', 'authenticated', 'meeting-reader@example.invalid', '', now(), '{"provider":"email","providers":["email"]}', '{}', now(), now());

insert into public.organizations (id, code, name) values
  ('75a20000-0000-4000-8000-000000000001', 'meeting_a', '會議測試機構'),
  ('75a20000-0000-4000-8000-000000000002', 'meeting_b', '其他測試機構');

insert into public.branches (id, organization_id, code, name) values
  ('75a30000-0000-4000-8000-000000000001', '75a20000-0000-4000-8000-000000000001', 'main', '會議主分支'),
  ('75a30000-0000-4000-8000-000000000002', '75a20000-0000-4000-8000-000000000001', 'other', '會議其他分支'),
  ('75a30000-0000-4000-8000-000000000003', '75a20000-0000-4000-8000-000000000002', 'main', '其他機構分支');

insert into public.profiles (id, display_name, kind, employee_code) values
  ('75a10000-0000-4000-8000-000000000001', '會議主管', 'staff', 'M-001'),
  ('75a10000-0000-4000-8000-000000000002', '出席護理師', 'professional', 'M-002'),
  ('75a10000-0000-4000-8000-000000000003', '行動負責人', 'staff', 'M-003'),
  ('75a10000-0000-4000-8000-000000000004', '其他分支員工', 'driver', 'M-004'),
  ('75a10000-0000-4000-8000-000000000005', '停用員工', 'staff', 'M-005'),
  ('75a10000-0000-4000-8000-000000000006', '唯讀員工', 'staff', 'M-006');

insert into public.memberships (id, organization_id, branch_id, profile_id, status) values
  ('75a40000-0000-4000-8000-000000000001', '75a20000-0000-4000-8000-000000000001', '75a30000-0000-4000-8000-000000000001', '75a10000-0000-4000-8000-000000000001', 'active'),
  ('75a40000-0000-4000-8000-000000000002', '75a20000-0000-4000-8000-000000000001', '75a30000-0000-4000-8000-000000000001', '75a10000-0000-4000-8000-000000000002', 'active'),
  ('75a40000-0000-4000-8000-000000000003', '75a20000-0000-4000-8000-000000000001', null, '75a10000-0000-4000-8000-000000000003', 'active'),
  ('75a40000-0000-4000-8000-000000000004', '75a20000-0000-4000-8000-000000000001', '75a30000-0000-4000-8000-000000000002', '75a10000-0000-4000-8000-000000000004', 'active'),
  ('75a40000-0000-4000-8000-000000000005', '75a20000-0000-4000-8000-000000000001', '75a30000-0000-4000-8000-000000000001', '75a10000-0000-4000-8000-000000000005', 'suspended'),
  ('75a40000-0000-4000-8000-000000000006', '75a20000-0000-4000-8000-000000000001', '75a30000-0000-4000-8000-000000000001', '75a10000-0000-4000-8000-000000000006', 'active');

insert into public.membership_roles (membership_id, role_id) values
  ('75a40000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000002'),
  ('75a40000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000007'),
  ('75a40000-0000-4000-8000-000000000003', '10000000-0000-4000-8000-000000000006'),
  ('75a40000-0000-4000-8000-000000000004', '10000000-0000-4000-8000-000000000008'),
  ('75a40000-0000-4000-8000-000000000005', '10000000-0000-4000-8000-000000000006'),
  ('75a40000-0000-4000-8000-000000000006', '10000000-0000-4000-8000-000000000006');

select set_config(
  'test.meeting_verified_at',
  (clock_timestamp() - interval '30 seconds')::text,
  true
);

insert into private.reauth_challenges (
  id, user_id, session_id, nonce_sha256, idempotency_key, issued_jwt_iat,
  issued_jwt_jti, created_at, expires_at, consumed_at, consumed_jwt_iat,
  consumed_jwt_jti, factor_method, factor_verified_at
) values (
  '75a50000-0000-4000-8000-000000000001',
  '75a10000-0000-4000-8000-000000000001',
  '75a51000-0000-4000-8000-000000000001', repeat('7', 64),
  '75a52000-0000-4000-8000-000000000001',
  clock_timestamp() - interval '2 minutes', 'meeting-before',
  clock_timestamp() - interval '1 minute', clock_timestamp() + interval '4 minutes',
  current_setting('test.meeting_verified_at')::timestamptz,
  current_setting('test.meeting_verified_at')::timestamptz,
  'meeting-after', 'totp', current_setting('test.meeting_verified_at')::timestamptz
);

insert into private.reauth_events (
  user_id, session_id, challenge_id, aal, verification_method, verified_at
) values (
  '75a10000-0000-4000-8000-000000000001',
  '75a51000-0000-4000-8000-000000000001',
  '75a50000-0000-4000-8000-000000000001',
  'aal2', 'totp', current_setting('test.meeting_verified_at')::timestamptz
);

select set_config(
  'test.meeting_starts_at', (clock_timestamp() - interval '2 hours')::text, true
);
select set_config(
  'test.meeting_ends_at', (clock_timestamp() - interval '1 hour')::text, true
);
select set_config(
  'test.meeting_due_date',
  (((clock_timestamp() at time zone 'Asia/Taipei')::date - 1)::text), true
);

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"75a10000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal1","session_id":"75a51000-0000-4000-8000-000000000001"}', true);

-- 4
select throws_ok(
  $$select * from public.meeting_management_snapshot(
    '75a20000-0000-4000-8000-000000000001', '75a30000-0000-4000-8000-000000000001'
  )$$,
  '42501','meeting snapshot is not permitted',
  'AAL1 cannot read the meeting snapshot at the database boundary'
);

-- 5
select throws_ok(
  $$select * from public.record_signed_meeting_minutes(
    '75a20000-0000-4000-8000-000000000001','75a30000-0000-4000-8000-000000000001',null,null,null,
    '機構自訂類型','第一次會議',clock_timestamp()-interval '2 hours',clock_timestamp()-interval '1 hour',
    array['75a10000-0000-4000-8000-000000000001']::uuid[], '[]'::jsonb,
    '[{"item_id":"75aa0000-0000-4000-8000-000000000001","item_order":1,"topic":"議程"}]'::jsonb,
    '[]'::jsonb,'[]'::jsonb,'75a60000-0000-4000-8000-000000000001'
  )$$,
  '42501','meeting minute signing is not permitted','AAL1 cannot sign meeting minutes'
);

select set_config('request.jwt.claims', '{"sub":"75a10000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2","session_id":"75a51000-0000-4000-8000-000000000099"}', true);

-- 6
select throws_ok(
  $$select * from public.record_signed_meeting_minutes(
    '75a20000-0000-4000-8000-000000000001','75a30000-0000-4000-8000-000000000001',null,null,null,
    '機構自訂類型','錯誤工作階段',clock_timestamp()-interval '2 hours',clock_timestamp()-interval '1 hour',
    array['75a10000-0000-4000-8000-000000000001']::uuid[], '[]'::jsonb,
    '[{"item_id":"75aa0000-0000-4000-8000-000000000001","item_order":1,"topic":"議程"}]'::jsonb,
    '[]'::jsonb,'[]'::jsonb,'75a60000-0000-4000-8000-000000000002'
  )$$,
  '42501','current meeting AAL2 evidence is required','signing requires current immutable AAL2 evidence from the same session'
);

select set_config('request.jwt.claims', '{"sub":"75a10000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2","session_id":"75a51000-0000-4000-8000-000000000001"}', true);

select results_eq(
  $$select meeting_total, overdue_action_total from public.meeting_management_snapshot(
    '75a20000-0000-4000-8000-000000000001', '75a30000-0000-4000-8000-000000000001'
  )$$,
  $$values (0, 0)$$,
  'AAL2 read authority returns an empty audited snapshot'
);

-- 7
select throws_ok(
  $$select * from public.record_signed_meeting_minutes(
    '75a20000-0000-4000-8000-000000000001','75a30000-0000-4000-8000-000000000001',null,null,null,
    '機構自訂類型','尚未結束會議',clock_timestamp()-interval '1 hour',clock_timestamp()+interval '1 hour',
    array['75a10000-0000-4000-8000-000000000001']::uuid[], '[]'::jsonb,
    '[{"item_id":"75aa0000-0000-4000-8000-000000000001","item_order":1,"topic":"議程"}]'::jsonb,
    '[]'::jsonb,'[]'::jsonb,'75a60000-0000-4000-8000-000000000003'
  )$$,
  '22023','meeting minutes cannot be signed before the meeting ends','new minutes cannot be signed before the meeting ends'
);

-- 8
select throws_ok(
  $$select * from public.record_signed_meeting_minutes(
    '75a20000-0000-4000-8000-000000000001','75a30000-0000-4000-8000-000000000001',null,null,null,
    '機構自訂類型','倒置時間',clock_timestamp()-interval '1 hour',clock_timestamp()-interval '2 hours',
    array['75a10000-0000-4000-8000-000000000001']::uuid[], '[]'::jsonb,
    '[{"item_id":"75aa0000-0000-4000-8000-000000000001","item_order":1,"topic":"議程"}]'::jsonb,
    '[]'::jsonb,'[]'::jsonb,'75a60000-0000-4000-8000-000000000004'
  )$$,
  '22023','meeting minute input is invalid','impossible meeting time ranges are rejected'
);

-- 9
select throws_ok(
  $$select * from public.record_signed_meeting_minutes(
    '75a20000-0000-4000-8000-000000000001','75a30000-0000-4000-8000-000000000001',null,null,null,
    '機構自訂類型','重複出席',clock_timestamp()-interval '2 hours',clock_timestamp()-interval '1 hour',
    array['75a10000-0000-4000-8000-000000000001','75a10000-0000-4000-8000-000000000001']::uuid[], '[]'::jsonb,
    '[{"item_id":"75aa0000-0000-4000-8000-000000000001","item_order":1,"topic":"議程"}]'::jsonb,
    '[]'::jsonb,'[]'::jsonb,'75a60000-0000-4000-8000-000000000005'
  )$$,
  '22023','meeting minute input is invalid','duplicate staff attendee ids are rejected rather than canonicalized'
);

-- 10
select throws_ok(
  $$select * from public.record_signed_meeting_minutes(
    '75a20000-0000-4000-8000-000000000001','75a30000-0000-4000-8000-000000000001',null,null,null,
    '機構自訂類型','空 JSON',clock_timestamp()-interval '2 hours',clock_timestamp()-interval '1 hour',
    array['75a10000-0000-4000-8000-000000000001']::uuid[], null,
    null,'[]'::jsonb,null,'75a60000-0000-4000-8000-000000000006'
  )$$,
  '22023','meeting minute input is invalid','SQL null JSON arrays are explicitly rejected'
);

-- 11
select throws_ok(
  $$select * from public.record_signed_meeting_minutes(
    '75a20000-0000-4000-8000-000000000001','75a30000-0000-4000-8000-000000000001',null,null,null,
    '機構自訂類型','停用出席',clock_timestamp()-interval '2 hours',clock_timestamp()-interval '1 hour',
    array['75a10000-0000-4000-8000-000000000005']::uuid[], '[]'::jsonb,
    '[{"item_id":"75aa0000-0000-4000-8000-000000000001","item_order":1,"topic":"議程"}]'::jsonb,
    '[]'::jsonb,'[]'::jsonb,'75a60000-0000-4000-8000-000000000007'
  )$$,
  '42501','meeting staff attendee is outside active branch scope','inactive staff cannot be recorded as an attendee'
);

-- 12
select throws_ok(
  $$select * from public.record_signed_meeting_minutes(
    '75a20000-0000-4000-8000-000000000001','75a30000-0000-4000-8000-000000000001',null,null,null,
    '機構自訂類型','停用負責人',clock_timestamp()-interval '2 hours',clock_timestamp()-interval '1 hour',
    array['75a10000-0000-4000-8000-000000000001']::uuid[], '[]'::jsonb,
    '[{"item_id":"75aa0000-0000-4000-8000-000000000001","item_order":1,"topic":"議程"}]'::jsonb,
    '[]'::jsonb,
    '[{"action_id":"75ad0000-0000-4000-8000-000000000001","item_order":1,"action":"追蹤","responsible_user_id":"75a10000-0000-4000-8000-000000000005","due_date":"2026-09-01"}]'::jsonb,
    '75a60000-0000-4000-8000-000000000008'
  )$$,
  '42501','meeting action responsible is outside active branch scope','inactive staff cannot own an action'
);

-- 13
select throws_ok(
  $$select * from public.record_signed_meeting_minutes(
    '75a20000-0000-4000-8000-000000000001','75a30000-0000-4000-8000-000000000001',null,null,null,
    '機構自訂類型','重複行動',clock_timestamp()-interval '2 hours',clock_timestamp()-interval '1 hour',
    array['75a10000-0000-4000-8000-000000000001']::uuid[], '[]'::jsonb,
    '[{"item_id":"75aa0000-0000-4000-8000-000000000001","item_order":1,"topic":"議程"}]'::jsonb,
    '[]'::jsonb,
    '[{"action_id":"75ad0000-0000-4000-8000-000000000001","item_order":1,"action":"A","responsible_user_id":"75a10000-0000-4000-8000-000000000003","due_date":"2026-09-01"},{"action_id":"75ad0000-0000-4000-8000-000000000001","item_order":2,"action":"B","responsible_user_id":"75a10000-0000-4000-8000-000000000003","due_date":"2026-09-02"}]'::jsonb,
    '75a60000-0000-4000-8000-000000000009'
  )$$,
  '22023','action items are invalid or duplicated','duplicate action ids are rejected'
);

-- 14
select results_eq(
  $$select minute_version, previous_version_id, replayed from public.record_signed_meeting_minutes(
    '75a20000-0000-4000-8000-000000000001','75a30000-0000-4000-8000-000000000001',null,null,null,
    '機構自訂類型','月例會議',current_setting('test.meeting_starts_at')::timestamptz,current_setting('test.meeting_ends_at')::timestamptz,
    array['75a10000-0000-4000-8000-000000000001','75a10000-0000-4000-8000-000000000002']::uuid[], '["外部督導"]'::jsonb,
    '[{"item_id":"75aa0000-0000-4000-8000-000000000001","item_order":1,"topic":"服務品質"}]'::jsonb,
    '[{"decision_id":"75ab0000-0000-4000-8000-000000000001","item_order":1,"decision":"完成改善追蹤"}]'::jsonb,
    jsonb_build_array(jsonb_build_object('action_id','75ad0000-0000-4000-8000-000000000001','item_order',1,'action','完成改善報告','responsible_user_id','75a10000-0000-4000-8000-000000000003','due_date',current_setting('test.meeting_due_date'))),
    '75a60000-0000-4000-8000-000000000010'
  )$$,
  $$values (1, null::uuid, false)$$,
  'one guarded request creates the first immutable signed version'
);

reset role;
-- 15
select results_eq(
  $$select signer_display_name, signer_role_keys, signature_purpose,
           signature_reauth_challenge_id,
           content_hash ~ '^[a-f0-9]{64}$', signed_at = created_at
    from public.meeting_minute_versions where version = 1$$,
  $$values ('會議主管'::text, array['organization_manager']::text[], '會議紀錄簽署'::text,
    '75a50000-0000-4000-8000-000000000001'::uuid, true, true)$$,
  'signed row freezes signer name, actual role keys, purpose, hash, and immutable AAL2 evidence'
);

-- 16
select results_eq(
  $$select staff_attendees -> 1 ->> 'display_name',
           external_attendees -> 0 ->> 'attendee_kind',
           external_attendees -> 0 ->> 'name',
           action_items -> 0 ->> 'responsible_display_name'
    from public.meeting_minute_versions where version = 1$$,
  $$values ('出席護理師'::text, 'external'::text, '外部督導'::text, '行動負責人'::text)$$,
  'staff and responsible names are server-derived while external attendees are explicitly labeled'
);

-- 17
select throws_ok(
  $$update public.meeting_minute_versions set title = '覆寫' where version = 1$$,
  '23514','meeting_minute_versions is append-only; create a correction or action update',
  'signed minutes cannot be updated even by a direct privileged write'
);
-- 18
select throws_ok(
  $$delete from public.meeting_minute_versions where version = 1$$,
  '23514','meeting_minute_versions is append-only; create a correction or action update',
  'signed minutes cannot be deleted'
);
select set_config(
  'test.meeting_key',
  (select meeting_key::text from public.meeting_minute_versions where version = 1), true
);
select set_config(
  'test.meeting_version_1',
  (select id::text from public.meeting_minute_versions where version = 1), true
);
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"75a10000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2","session_id":"75a51000-0000-4000-8000-000000000001"}', true);

-- 19
select results_eq(
  $$select minute_version, previous_version_id, replayed from public.record_signed_meeting_minutes(
    '75a20000-0000-4000-8000-000000000001','75a30000-0000-4000-8000-000000000001',null,null,null,
    '機構自訂類型','月例會議',current_setting('test.meeting_starts_at')::timestamptz,current_setting('test.meeting_ends_at')::timestamptz,
    array['75a10000-0000-4000-8000-000000000001','75a10000-0000-4000-8000-000000000002']::uuid[], '["外部督導"]'::jsonb,
    '[{"item_id":"75aa0000-0000-4000-8000-000000000001","item_order":1,"topic":"服務品質"}]'::jsonb,
    '[{"decision_id":"75ab0000-0000-4000-8000-000000000001","item_order":1,"decision":"完成改善追蹤"}]'::jsonb,
    jsonb_build_array(jsonb_build_object('action_id','75ad0000-0000-4000-8000-000000000001','item_order',1,'action','完成改善報告','responsible_user_id','75a10000-0000-4000-8000-000000000003','due_date',current_setting('test.meeting_due_date'))),
    '75a60000-0000-4000-8000-000000000010'
  )$$,
  $$values (1, null::uuid, true)$$,
  'exact actor-scoped replay returns the persisted signed receipt'
);

-- 20
select throws_ok(
  $$select * from public.record_signed_meeting_minutes(
    '75a20000-0000-4000-8000-000000000001','75a30000-0000-4000-8000-000000000001',null,null,null,
    '機構自訂類型','內容改變',clock_timestamp()-interval '2 hours',clock_timestamp()-interval '1 hour',
    array['75a10000-0000-4000-8000-000000000001','75a10000-0000-4000-8000-000000000002']::uuid[], '["外部督導"]'::jsonb,
    '[{"item_id":"75aa0000-0000-4000-8000-000000000001","item_order":1,"topic":"服務品質"}]'::jsonb,
    '[]'::jsonb,'[]'::jsonb,'75a60000-0000-4000-8000-000000000010'
  )$$,
  '23505','meeting minute idempotency conflict','changed content cannot reuse a meeting operation key'
);

-- 21
select results_eq(
  $$select meeting_total, jsonb_array_length(meetings), action_total,
           (select sum(jsonb_array_length(item -> 'action_items'))::integer from jsonb_array_elements(meetings) item),
           overdue_action_total,
           (select count(*)::integer from jsonb_array_elements(meetings) item,
             lateral jsonb_array_elements(item -> 'action_items') action where (action ->> 'is_overdue')::boolean),
           snapshot_date = (generated_at at time zone 'Asia/Taipei')::date,
           meeting_type_policy, retention_policy, escalation_policy, notification_delivery
    from public.meeting_management_snapshot(
      '75a20000-0000-4000-8000-000000000001','75a30000-0000-4000-8000-000000000001'
    )$$,
  $$values (1,1,1,1,1,1,true,'institution_owned_unconfigured'::text,
    'institution_owned_unconfigured'::text,'institution_owned_unconfigured'::text,'none_not_sent'::text)$$,
  'snapshot aggregates exactly match loaded details and overdue uses its own Taipei date'
);

-- 22
reset role;
select ok(
  exists (
    select 1 from public.audit_events
    where table_name = 'meeting_management_snapshot'
      and metadata ->> 'snapshot_fingerprint' ~ '^[a-f0-9]{64}$'
      and metadata ->> 'external_notification_sent' = 'false'
      and metadata::text not like '%月例會議%'
      and metadata::text not like '%外部督導%'
  ),
  'audited bounded snapshot records a fingerprint and counts without minute content or a notification claim'
);

set local role authenticated;

select set_config('request.jwt.claims', '{"sub":"75a10000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal1","session_id":"75a51000-0000-4000-8000-000000000001"}', true);
select throws_ok(
  $$select * from public.append_meeting_action_update(
    '75a20000-0000-4000-8000-000000000001','75a30000-0000-4000-8000-000000000001',
    current_setting('test.meeting_key')::uuid,
    current_setting('test.meeting_version_1')::uuid,
    '75ad0000-0000-4000-8000-000000000001',null,'in_progress','AAL1 嘗試',
    '75a70000-0000-4000-8000-000000000009'
  )$$,
  '42501','meeting action update is not permitted',
  'AAL1 cannot append meeting action progress at the database boundary'
);
select set_config('request.jwt.claims', '{"sub":"75a10000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2","session_id":"75a51000-0000-4000-8000-000000000001"}', true);

-- 23
select results_eq(
  $$select update_sequence,
           meeting_key = current_setting('test.meeting_key')::uuid,
           minute_version_id = current_setting('test.meeting_version_1')::uuid,
           previous_update_id, progress_status, replayed
    from public.append_meeting_action_update(
    '75a20000-0000-4000-8000-000000000001','75a30000-0000-4000-8000-000000000001',
    current_setting('test.meeting_key')::uuid,
    current_setting('test.meeting_version_1')::uuid,
    '75ad0000-0000-4000-8000-000000000001',null,'in_progress','處理中',
    '75a70000-0000-4000-8000-000000000001'
  )$$,
  $$values (1,true,true,null::uuid,'in_progress'::text,false)$$,
  'action progress appends the first ledger row'
);

reset role;
select set_config(
  'test.meeting_update_1',
  (select id::text from public.meeting_action_updates where sequence = 1), true
);
-- 24
select results_eq(
  $$select count(*)::integer,
           (select count(*)::integer from public.meeting_action_updates),
           (select progress_status from public.meeting_action_updates where sequence=1)
    from public.meeting_minute_versions$$,
  $$values (1,1,'in_progress'::text)$$,
  'action progress is separate and does not rewrite or duplicate signed minutes'
);
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"75a10000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2","session_id":"75a51000-0000-4000-8000-000000000001"}', true);

-- 25
select results_eq(
  $$select update_sequence, replayed from public.append_meeting_action_update(
    '75a20000-0000-4000-8000-000000000001','75a30000-0000-4000-8000-000000000001',
    current_setting('test.meeting_key')::uuid,
    current_setting('test.meeting_version_1')::uuid,
    '75ad0000-0000-4000-8000-000000000001',null,'in_progress','處理中',
    '75a70000-0000-4000-8000-000000000001'
  )$$,
  $$values (1,true)$$,
  'action update exact replay returns the persisted ledger receipt'
);

-- 26
select throws_ok(
  $$select * from public.append_meeting_action_update(
    '75a20000-0000-4000-8000-000000000001','75a30000-0000-4000-8000-000000000001',
    current_setting('test.meeting_key')::uuid,
    current_setting('test.meeting_version_1')::uuid,
    '75ad0000-0000-4000-8000-000000000001',null,'completed','改變內容',
    '75a70000-0000-4000-8000-000000000001'
  )$$,
  '23505','meeting action update idempotency conflict','changed action progress cannot reuse an operation key'
);

-- 27
select throws_ok(
  $$select * from public.append_meeting_action_update(
    '75a20000-0000-4000-8000-000000000001','75a30000-0000-4000-8000-000000000001',
    current_setting('test.meeting_key')::uuid,
    current_setting('test.meeting_version_1')::uuid,
    '75ad0000-0000-4000-8000-000000000001',null,'completed','完成',
    '75a70000-0000-4000-8000-000000000002'
  )$$,
  '40001','meeting action update version conflict','action updates require the exact previous ledger id'
);

-- 28
select results_eq(
  $$select update_sequence,
           previous_update_id = current_setting('test.meeting_update_1')::uuid,
           progress_status, replayed from public.append_meeting_action_update(
    '75a20000-0000-4000-8000-000000000001','75a30000-0000-4000-8000-000000000001',
    current_setting('test.meeting_key')::uuid,
    current_setting('test.meeting_version_1')::uuid,
    '75ad0000-0000-4000-8000-000000000001',
    current_setting('test.meeting_update_1')::uuid,
    'completed','完成','75a70000-0000-4000-8000-000000000003'
  )$$,
  $$values (2,true,'completed'::text,false)$$,
  'a current expected version appends the next action update'
);

reset role;
select set_config(
  'test.meeting_update_2',
  (select id::text from public.meeting_action_updates where sequence = 2), true
);
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"75a10000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2","session_id":"75a51000-0000-4000-8000-000000000001"}', true);

-- 29
select results_eq(
  $$select overdue_action_total, open_action_total,
           meetings -> 0 -> 'action_items' -> 0 ->> 'progress_status',
           meetings -> 0 -> 'action_items' -> 0 ->> 'is_overdue',
           meetings -> 0 -> 'action_items' -> 0 ->> 'local_work_item',
           meetings -> 0 -> 'action_items' -> 0 ->> 'external_notification_sent'
    from public.meeting_management_snapshot(
      '75a20000-0000-4000-8000-000000000001','75a30000-0000-4000-8000-000000000001'
    )$$,
  $$values (0,0,'completed'::text,'false'::text,'false'::text,'false'::text)$$,
  'latest completion removes the local overdue item without claiming an external message'
);

reset role;
-- 30
select throws_ok(
  $$update public.meeting_action_updates set progress_status='cancelled' where sequence=1$$,
  '23514','meeting_action_updates is append-only; create a correction or action update',
  'action progress cannot be rewritten'
);
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"75a10000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2","session_id":"75a51000-0000-4000-8000-000000000001"}', true);

-- 31
select throws_ok(
  $$select * from public.record_signed_meeting_minutes(
    '75a20000-0000-4000-8000-000000000001','75a30000-0000-4000-8000-000000000001',
    current_setting('test.meeting_key')::uuid,current_setting('test.meeting_version_1')::uuid,'企劃文字更正',
    '機構自訂類型','月例會議',clock_timestamp()-interval '2 hours',clock_timestamp()-interval '1 hour',
    array['75a10000-0000-4000-8000-000000000001','75a10000-0000-4000-8000-000000000002']::uuid[], '["外部督導"]'::jsonb,
    '[{"item_id":"75aa0000-0000-4000-8000-000000000001","item_order":1,"topic":"服務品質"}]'::jsonb,
    '[]'::jsonb,
    jsonb_build_array(jsonb_build_object('action_id','75ad0000-0000-4000-8000-000000000001','item_order',1,'action','改掉原行動','responsible_user_id','75a10000-0000-4000-8000-000000000003','due_date',current_setting('test.meeting_due_date'))),
    '75a60000-0000-4000-8000-000000000011'
  )$$,
  '23514','existing meeting actions must be retained with identical identity','a correction cannot reuse an action id for changed identity'
);

-- 32
select throws_ok(
  $$select * from public.record_signed_meeting_minutes(
    '75a20000-0000-4000-8000-000000000001','75a30000-0000-4000-8000-000000000001',
    current_setting('test.meeting_key')::uuid,current_setting('test.meeting_version_1')::uuid,'移除行動',
    '機構自訂類型','月例會議',clock_timestamp()-interval '2 hours',clock_timestamp()-interval '1 hour',
    array['75a10000-0000-4000-8000-000000000001','75a10000-0000-4000-8000-000000000002']::uuid[], '["外部督導"]'::jsonb,
    '[{"item_id":"75aa0000-0000-4000-8000-000000000001","item_order":1,"topic":"服務品質"}]'::jsonb,
    '[]'::jsonb,'[]'::jsonb,'75a60000-0000-4000-8000-000000000012'
  )$$,
  '23514','existing meeting actions must be retained with identical identity','an old action cannot be silently removed from a correction'
);

-- 33
select results_eq(
  $$select minute_version,
           previous_version_id = current_setting('test.meeting_version_1')::uuid,
           replayed from public.record_signed_meeting_minutes(
    '75a20000-0000-4000-8000-000000000001','75a30000-0000-4000-8000-000000000001',
    current_setting('test.meeting_key')::uuid,current_setting('test.meeting_version_1')::uuid,'補充決議文字',
    '機構自訂類型','月例會議（更正版）',clock_timestamp()-interval '2 hours',clock_timestamp()-interval '1 hour',
    array['75a10000-0000-4000-8000-000000000001','75a10000-0000-4000-8000-000000000002']::uuid[], '["外部督導"]'::jsonb,
    '[{"item_id":"75aa0000-0000-4000-8000-000000000001","item_order":1,"topic":"服務品質"}]'::jsonb,
    '[{"decision_id":"75ab0000-0000-4000-8000-000000000001","item_order":1,"decision":"完成改善追蹤並留存證據"}]'::jsonb,
    jsonb_build_array(jsonb_build_object('action_id','75ad0000-0000-4000-8000-000000000001','item_order',1,'action','完成改善報告','responsible_user_id','75a10000-0000-4000-8000-000000000003','due_date',current_setting('test.meeting_due_date'))),
    '75a60000-0000-4000-8000-000000000013'
  )$$,
  $$values (2,true,false)$$,
  'a valid correction appends the one terminal child and preserves action identity'
);

reset role;
select set_config(
  'test.meeting_version_2',
  (select id::text from public.meeting_minute_versions where version = 2), true
);
-- 34
select results_eq(
  $$select count(*)::integer, max(version),
           count(*) filter (where not exists (
             select 1 from public.meeting_minute_versions child where child.previous_version_id = minute.id
           ))::integer
    from public.meeting_minute_versions minute$$,
  $$values (2,2,1)$$,
  'the prior signed version remains and the meeting chain has exactly one terminal version'
);
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"75a10000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2","session_id":"75a51000-0000-4000-8000-000000000001"}', true);

reset role;
update public.memberships
set status = 'suspended'
where id in (
  '75a40000-0000-4000-8000-000000000002',
  '75a40000-0000-4000-8000-000000000003'
);
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"75a10000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2","session_id":"75a51000-0000-4000-8000-000000000001"}', true);

select results_eq(
  $$select minute_version,
           previous_version_id = current_setting('test.meeting_version_2')::uuid,
           replayed from public.record_signed_meeting_minutes(
    '75a20000-0000-4000-8000-000000000001','75a30000-0000-4000-8000-000000000001',
    current_setting('test.meeting_key')::uuid,current_setting('test.meeting_version_2')::uuid,'離職後補正決議',
    '機構自訂類型','月例會議（人員離職後更正）',current_setting('test.meeting_starts_at')::timestamptz,current_setting('test.meeting_ends_at')::timestamptz,
    array['75a10000-0000-4000-8000-000000000001','75a10000-0000-4000-8000-000000000002']::uuid[], '["外部督導"]'::jsonb,
    '[{"item_id":"75aa0000-0000-4000-8000-000000000001","item_order":1,"topic":"服務品質"}]'::jsonb,
    '[{"decision_id":"75ab0000-0000-4000-8000-000000000001","item_order":1,"decision":"補正後仍保留歷史人員證據"}]'::jsonb,
    jsonb_build_array(jsonb_build_object('action_id','75ad0000-0000-4000-8000-000000000001','item_order',1,'action','完成改善報告','responsible_user_id','75a10000-0000-4000-8000-000000000003','due_date',current_setting('test.meeting_due_date'))),
    '75a60000-0000-4000-8000-000000000015'
  )$$,
  $$values (3,true,false)$$,
  'a correction reuses immutable attendee and responsible snapshots after those historical staff leave'
);

reset role;
select set_config(
  'test.meeting_version_3',
  (select id::text from public.meeting_minute_versions where version = 3), true
);
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"75a10000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2","session_id":"75a51000-0000-4000-8000-000000000001"}', true);

select throws_ok(
  $$select * from public.record_signed_meeting_minutes(
    '75a20000-0000-4000-8000-000000000001','75a30000-0000-4000-8000-000000000001',
    current_setting('test.meeting_key')::uuid,current_setting('test.meeting_version_3')::uuid,'嘗試新增離職負責人',
    '機構自訂類型','不得新增離職負責人',current_setting('test.meeting_starts_at')::timestamptz,current_setting('test.meeting_ends_at')::timestamptz,
    array['75a10000-0000-4000-8000-000000000001','75a10000-0000-4000-8000-000000000002']::uuid[], '["外部督導"]'::jsonb,
    '[{"item_id":"75aa0000-0000-4000-8000-000000000001","item_order":1,"topic":"服務品質"}]'::jsonb,
    '[]'::jsonb,
    jsonb_build_array(
      jsonb_build_object('action_id','75ad0000-0000-4000-8000-000000000001','item_order',1,'action','完成改善報告','responsible_user_id','75a10000-0000-4000-8000-000000000003','due_date',current_setting('test.meeting_due_date')),
      jsonb_build_object('action_id','75ad0000-0000-4000-8000-000000000002','item_order',2,'action','新增工作','responsible_user_id','75a10000-0000-4000-8000-000000000003','due_date',current_setting('test.meeting_due_date'))
    ),
    '75a60000-0000-4000-8000-000000000016'
  )$$,
  '42501','meeting action responsible is outside active branch scope',
  'a departed historical responsible cannot be assigned to a newly introduced action'
);

-- 35
select throws_ok(
  $$select * from public.record_signed_meeting_minutes(
    '75a20000-0000-4000-8000-000000000001','75a30000-0000-4000-8000-000000000001',
    current_setting('test.meeting_key')::uuid,current_setting('test.meeting_version_1')::uuid,'競爭更正',
    '機構自訂類型','分叉版本',clock_timestamp()-interval '2 hours',clock_timestamp()-interval '1 hour',
    array['75a10000-0000-4000-8000-000000000001']::uuid[], '[]'::jsonb,
    '[{"item_id":"75aa0000-0000-4000-8000-000000000001","item_order":1,"topic":"議程"}]'::jsonb,
    '[]'::jsonb,
    jsonb_build_array(jsonb_build_object('action_id','75ad0000-0000-4000-8000-000000000001','item_order',1,'action','完成改善報告','responsible_user_id','75a10000-0000-4000-8000-000000000003','due_date',current_setting('test.meeting_due_date'))),
    '75a60000-0000-4000-8000-000000000014'
  )$$,
  '23514','meeting correction must extend the terminal version','a stale concurrent correction fork is rejected'
);

-- 36
select throws_ok(
  $$select * from public.append_meeting_action_update(
    '75a20000-0000-4000-8000-000000000001','75a30000-0000-4000-8000-000000000001',
    current_setting('test.meeting_key')::uuid,
    current_setting('test.meeting_version_1')::uuid,
    '75ad0000-0000-4000-8000-000000000001',
    current_setting('test.meeting_update_2')::uuid,
    'completed','舊版本','75a70000-0000-4000-8000-000000000004'
  )$$,
  '40001','meeting action version is stale','action updates cannot target a non-terminal minute version'
);

-- 37
select throws_ok(
  $$select * from public.meeting_management_snapshot(
    '75a20000-0000-4000-8000-000000000001','75a30000-0000-4000-8000-000000000002'
  )$$,
  '42501','meeting snapshot is not permitted','another branch cannot be substituted into the snapshot'
);

select set_config('request.jwt.claims', '{"sub":"75a10000-0000-4000-8000-000000000006","role":"authenticated","aal":"aal2"}', true);
-- 38
select throws_ok(
  $$select * from public.append_meeting_action_update(
    '75a20000-0000-4000-8000-000000000001','75a30000-0000-4000-8000-000000000001',
    current_setting('test.meeting_key')::uuid,current_setting('test.meeting_version_2')::uuid,
    '75ad0000-0000-4000-8000-000000000001',current_setting('test.meeting_update_2')::uuid,
    'completed','唯讀嘗試','75a70000-0000-4000-8000-000000000005'
  )$$,
  '42501','meeting action update is not permitted','meetings.read does not grant action management'
);

reset role;
update public.profiles set display_name = '主管新名稱' where id = '75a10000-0000-4000-8000-000000000001';
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"75a10000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2","session_id":"75a51000-0000-4000-8000-000000000001"}', true);
-- 39
select results_eq(
  $$select meetings -> 0 ->> 'signer_display_name', meetings -> 0 -> 'signer_role_keys'
    from public.meeting_management_snapshot(
      '75a20000-0000-4000-8000-000000000001','75a30000-0000-4000-8000-000000000001'
    )$$,
  $$values ('會議主管'::text, '["organization_manager"]'::jsonb)$$,
  'snapshot uses immutable signer name and role evidence rather than current profile text'
);

reset role;
insert into public.meeting_minute_versions (
  organization_id, branch_id, meeting_key, version, previous_version_id,
  correction_reason, meeting_type, title, starts_at, ends_at,
  staff_attendees, external_attendees, agenda_items, decisions, action_items,
  signed_at, signed_by, signer_display_name, signer_role_keys,
  signature_purpose, signature_reauth_challenge_id, content_hash, created_at
)
select
  '75a20000-0000-4000-8000-000000000001'::uuid,
  '75a30000-0000-4000-8000-000000000001'::uuid,
  gen_random_uuid(), 1, null, null, '容量測試', '歷史會議 ' || series.number,
  '2020-01-01 01:00:00+00'::timestamptz + series.number * interval '1 day',
  '2020-01-01 02:00:00+00'::timestamptz + series.number * interval '1 day',
  '[{"attendee_kind":"staff","user_id":"75a10000-0000-4000-8000-000000000001","display_name":"會議主管","profile_kind":"staff","membership_scope":"branch"}]'::jsonb,
  '[]'::jsonb,
  jsonb_build_array(jsonb_build_object(
    'item_id', gen_random_uuid(), 'item_order', 1, 'topic', '容量測試議程'
  )),
  '[]'::jsonb,
  case when series.number = 1 then jsonb_build_array(jsonb_build_object(
    'action_id', '75ad0000-0000-4000-8000-000000000099',
    'item_order', 1,
    'action', '截斷範圍外待辦',
    'responsible_user_id', '75a10000-0000-4000-8000-000000000001',
    'responsible_display_name', '會議主管',
    'due_date', '2020-01-01'
  )) else '[]'::jsonb end,
  '2026-01-01 00:00:00+00'::timestamptz,
  '75a10000-0000-4000-8000-000000000001'::uuid,
  '會議主管', array['organization_manager']::text[], '會議紀錄簽署',
  '75a50000-0000-4000-8000-000000000001'::uuid,
  repeat('a', 64), '2026-01-01 00:00:00+00'::timestamptz
from generate_series(1, 101) as series(number);

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"75a10000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2","session_id":"75a51000-0000-4000-8000-000000000001"}', true);
select results_eq(
  $$select meeting_total, jsonb_array_length(meetings), meeting_available_total,
           meetings_truncated, correction_total, action_total, open_action_total,
           overdue_action_total,
           (select sum(jsonb_array_length(item -> 'action_items'))::integer
            from jsonb_array_elements(meetings) item)
    from public.meeting_management_snapshot(
      '75a20000-0000-4000-8000-000000000001','75a30000-0000-4000-8000-000000000001'
    )$$,
  $$values (100,100,102::bigint,true,1,2,1,1,1)$$,
  'bounded detail reports 100 of 102 while full terminal aggregates include an overdue action outside the loaded rows'
);

reset role;
update public.memberships set status='suspended' where id='75a40000-0000-4000-8000-000000000001';
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"75a10000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2","session_id":"75a51000-0000-4000-8000-000000000001"}', true);
-- 40
select throws_ok(
  $$select * from public.record_signed_meeting_minutes(
    '75a20000-0000-4000-8000-000000000001','75a30000-0000-4000-8000-000000000001',null,null,null,
    '機構自訂類型','月例會議',current_setting('test.meeting_starts_at')::timestamptz,current_setting('test.meeting_ends_at')::timestamptz,
    array['75a10000-0000-4000-8000-000000000001','75a10000-0000-4000-8000-000000000002']::uuid[], '["外部督導"]'::jsonb,
    '[{"item_id":"75aa0000-0000-4000-8000-000000000001","item_order":1,"topic":"服務品質"}]'::jsonb,
    '[{"decision_id":"75ab0000-0000-4000-8000-000000000001","item_order":1,"decision":"完成改善追蹤"}]'::jsonb,
    jsonb_build_array(jsonb_build_object('action_id','75ad0000-0000-4000-8000-000000000001','item_order',1,'action','完成改善報告','responsible_user_id','75a10000-0000-4000-8000-000000000003','due_date',current_setting('test.meeting_due_date'))),
    '75a60000-0000-4000-8000-000000000010'
  )$$,
  '42501','meeting minute signing is not permitted','a revoked actor cannot replay a signed receipt'
);

reset role;
-- 41
select is(
  (select count(*)::integer from public.audit_events where table_name='meeting_minute_versions' and action in ('sign','correct')),
  3,
  'each committed signed version has one sign or correction audit event'
);

-- 42
select ok(
  exists (
    select 1 from public.audit_events
    where table_name='meeting_action_updates'
      and metadata ->> 'external_notification_sent' = 'false'
      and metadata::text not like '%處理中%'
      and metadata::text not like '%完成%'
  ),
  'action audit metadata is bounded and never claims an external notification'
);

select * from finish();
rollback;
