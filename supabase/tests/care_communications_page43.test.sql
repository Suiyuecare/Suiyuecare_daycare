begin;

select plan(38);

select results_eq(
  $$select permission_key collate "C" from public.permissions where permission_key like 'care_communications.%' order by permission_key collate "C"$$,
  $$values
    ('care_communications.correct'::text collate "C"),
    ('care_communications.manage'::text collate "C"),
    ('care_communications.read'::text collate "C")$$,
  'Page 43 exposes narrow read, create and correction permissions'
);

select ok(
  (select bool_and(relrowsecurity and relforcerowsecurity)
   from pg_class where oid in (
     'public.care_communication_versions'::regclass,
     'public.care_communication_recipients'::regclass,
     'public.care_communication_attachments'::regclass,
     'public.care_communication_delivery_events'::regclass,
     'private.care_communication_operations'::regclass
   )),
  'every Page-43 history and replay table forces RLS'
);

select ok(
  not has_table_privilege('authenticated', 'public.care_communication_versions', 'select,insert,update,delete')
  and not has_table_privilege('authenticated', 'public.care_communication_recipients', 'select,insert,update,delete')
  and not has_table_privilege('authenticated', 'public.care_communication_attachments', 'select,insert,update,delete')
  and not has_table_privilege('authenticated', 'public.care_communication_delivery_events', 'select,insert,update,delete')
  and not has_table_privilege('authenticated', 'private.care_communication_operations', 'select,insert,update,delete')
  and not has_table_privilege('service_role', 'public.care_communication_versions', 'select,insert,update,delete'),
  'browser and service roles cannot bypass the Page-43 RPC boundary'
);

select ok(
  has_function_privilege('authenticated', 'public.create_care_communication(uuid,uuid,uuid,text,text,timestamptz,jsonb,uuid)', 'execute')
  and has_function_privilege('authenticated', 'public.correct_care_communication(uuid,uuid,uuid,uuid,uuid,integer,text,text,text,jsonb,uuid)', 'execute')
  and has_function_privilege('authenticated', 'public.care_communication_snapshot(uuid,uuid,uuid,date,date,uuid,text,text,text,text)', 'execute')
  and not has_function_privilege('anon', 'public.care_communication_snapshot(uuid,uuid,uuid,date,date,uuid,text,text,text,text)', 'execute')
  and not has_function_privilege('service_role', 'public.create_care_communication(uuid,uuid,uuid,text,text,timestamptz,jsonb,uuid)', 'execute'),
  'only authenticated callers receive the Page-43 RPC surface'
);

select ok(
  not (select prosecdef from pg_proc where oid = 'public.create_care_communication(uuid,uuid,uuid,text,text,timestamptz,jsonb,uuid)'::regprocedure)
  and not (select prosecdef from pg_proc where oid = 'public.correct_care_communication(uuid,uuid,uuid,uuid,uuid,integer,text,text,text,jsonb,uuid)'::regprocedure)
  and not (select prosecdef from pg_proc where oid = 'public.care_communication_snapshot(uuid,uuid,uuid,date,date,uuid,text,text,text,text)'::regprocedure)
  and (select prosecdef and coalesce(proconfig, '{}'::text[]) @> array['search_path=""']
    from pg_proc where oid = 'private.mutate_care_communication_atomic(text,uuid,uuid,uuid,uuid,uuid,integer,text,text,timestamptz,text,jsonb,uuid)'::regprocedure)
  and (select prosecdef and coalesce(proconfig, '{}'::text[]) @> array['search_path=""']
    from pg_proc where oid = 'private.care_communication_snapshot_response(uuid,uuid,uuid,date,date,uuid,text,text,text,text)'::regprocedure),
  'public wrappers are invokers and private cores are pinned definers'
);

select ok(
  (select count(*) = 5 from pg_trigger where not tgisinternal and tgname in (
    'care_communication_versions_prevent_mutation',
    'care_communication_recipients_prevent_mutation',
    'care_communication_attachments_prevent_mutation',
    'care_communication_delivery_events_prevent_mutation',
    'care_communication_operations_prevent_mutation'
  ))
  and (select count(*) = 4 from pg_trigger where not tgisinternal and tgname in (
    'care_communication_versions_audit_row_change',
    'care_communication_recipients_audit_row_change',
    'care_communication_attachments_audit_row_change',
    'care_communication_delivery_events_audit_row_change'
  )),
  'formal public histories are append-only and use exact row-audit trigger names'
);

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  ('00000000-0000-0000-0000-000000000000', '43000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'care43-manager@example.invalid', '', now(), '{}', '{}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '43000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'care43-supervisor@example.invalid', '', now(), '{}', '{}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '43000000-0000-4000-8000-000000000003', 'authenticated', 'authenticated', 'care43-family@example.invalid', '', now(), '{}', '{}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '43000000-0000-4000-8000-000000000004', 'authenticated', 'authenticated', 'care43-family-care-only@example.invalid', '', now(), '{}', '{}', now(), now());

insert into public.organizations (id, code, name) values
  ('43100000-0000-4000-8000-000000000001', 'care43', '照顧溝通測試機構');
insert into public.branches (id, organization_id, code, name) values
  ('43200000-0000-4000-8000-000000000001', '43100000-0000-4000-8000-000000000001', 'main', '照顧溝通主分支'),
  ('43200000-0000-4000-8000-000000000002', '43100000-0000-4000-8000-000000000001', 'second', '照顧溝通第二分支');
insert into public.profiles (id, display_name, employee_code, kind) values
  ('43000000-0000-4000-8000-000000000001', '照顧溝通管理員', 'M-43', 'staff'),
  ('43000000-0000-4000-8000-000000000002', '照顧溝通主管', 'S-43', 'staff'),
  ('43000000-0000-4000-8000-000000000003', '已授權家屬', null, 'family'),
  ('43000000-0000-4000-8000-000000000004', '未授權訊息家屬', null, 'family');
insert into public.memberships (
  id, organization_id, branch_id, profile_id, status
) values
  ('43300000-0000-4000-8000-000000000001', '43100000-0000-4000-8000-000000000001', null, '43000000-0000-4000-8000-000000000001', 'active'),
  ('43300000-0000-4000-8000-000000000002', '43100000-0000-4000-8000-000000000001', '43200000-0000-4000-8000-000000000001', '43000000-0000-4000-8000-000000000002', 'active'),
  ('43300000-0000-4000-8000-000000000003', '43100000-0000-4000-8000-000000000001', '43200000-0000-4000-8000-000000000001', '43000000-0000-4000-8000-000000000003', 'active'),
  ('43300000-0000-4000-8000-000000000004', '43100000-0000-4000-8000-000000000001', '43200000-0000-4000-8000-000000000001', '43000000-0000-4000-8000-000000000004', 'active');
insert into public.membership_roles (membership_id, role_id) values
  ('43300000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000002'),
  ('43300000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000003'),
  ('43300000-0000-4000-8000-000000000003', '10000000-0000-4000-8000-000000000010'),
  ('43300000-0000-4000-8000-000000000004', '10000000-0000-4000-8000-000000000010');
insert into public.clients (
  id, organization_id, branch_id, client_code, display_name, status,
  admitted_on, ended_on
) values
  ('43400000-0000-4000-8000-000000000001', '43100000-0000-4000-8000-000000000001', '43200000-0000-4000-8000-000000000001', 'CARE-43-A', '合成個案甲', 'active', current_date - 30, null),
  ('43400000-0000-4000-8000-000000000002', '43100000-0000-4000-8000-000000000001', '43200000-0000-4000-8000-000000000001', 'CARE-43-B', '合成個案乙', 'active', current_date - 30, null),
  ('43400000-0000-4000-8000-000000000003', '43100000-0000-4000-8000-000000000001', '43200000-0000-4000-8000-000000000002', 'CARE-43-C', '合成個案丙', 'active', current_date - 30, null);
insert into public.consents (
  id, organization_id, branch_id, client_id, recipient_user_id,
  relationship, scopes, document_version, consented_at, expires_at,
  revoked_at, evidence_hash, created_by
) values
  ('43500000-0000-4000-8000-000000000001', '43100000-0000-4000-8000-000000000001', '43200000-0000-4000-8000-000000000001', '43400000-0000-4000-8000-000000000001', '43000000-0000-4000-8000-000000000003', '主要聯絡人', array['messages.read'], 'care43-v1', clock_timestamp() - interval '1 day', clock_timestamp() + interval '30 days', null, repeat('a', 64), '43000000-0000-4000-8000-000000000001'),
  ('43500000-0000-4000-8000-000000000002', '43100000-0000-4000-8000-000000000001', '43200000-0000-4000-8000-000000000001', '43400000-0000-4000-8000-000000000001', '43000000-0000-4000-8000-000000000004', '其他關係人', array['care.read'], 'care43-care-only-v1', clock_timestamp() - interval '1 day', clock_timestamp() + interval '30 days', null, repeat('b', 64), '43000000-0000-4000-8000-000000000001');

create temporary table care43_times as select
  clock_timestamp() - interval '1 hour' as occurred_at,
  clock_timestamp() - interval '30 seconds' as verified_at;
grant select on care43_times to authenticated;
insert into private.reauth_challenges (
  id, user_id, session_id, nonce_sha256, idempotency_key, issued_jwt_iat,
  created_at, expires_at, consumed_at, consumed_jwt_iat, factor_method,
  factor_verified_at
)
select '43600000-0000-4000-8000-000000000001'::uuid, '43000000-0000-4000-8000-000000000001'::uuid, '43610000-0000-4000-8000-000000000001'::uuid, repeat('c', 64), '43620000-0000-4000-8000-000000000001'::uuid, verified_at - interval '1 minute', verified_at - interval '1 minute', verified_at + interval '5 minutes', verified_at, verified_at, 'totp', verified_at from care43_times
union all
select '43600000-0000-4000-8000-000000000002'::uuid, '43000000-0000-4000-8000-000000000002'::uuid, '43610000-0000-4000-8000-000000000002'::uuid, repeat('d', 64), '43620000-0000-4000-8000-000000000002'::uuid, verified_at - interval '1 minute', verified_at - interval '1 minute', verified_at + interval '5 minutes', verified_at, verified_at, 'totp', verified_at from care43_times;
insert into private.reauth_events (
  user_id, session_id, challenge_id, aal, verification_method, verified_at
)
select '43000000-0000-4000-8000-000000000001'::uuid, '43610000-0000-4000-8000-000000000001'::uuid, '43600000-0000-4000-8000-000000000001'::uuid, 'aal2'::text, 'totp'::text, verified_at from care43_times
union all
select '43000000-0000-4000-8000-000000000002'::uuid, '43610000-0000-4000-8000-000000000002'::uuid, '43600000-0000-4000-8000-000000000002'::uuid, 'aal2'::text, 'totp'::text, verified_at from care43_times;

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"43000000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2","session_id":"43610000-0000-4000-8000-000000000001"}',
  true
);

select ok((
  select not replayed
    and operation_kind = 'create'
    and communication_version = 1
    and record_kind = 'original'
    and recipient_count = 1
    and delivery_status = 'queued'
    and read_status = 'not_configured'
    and family_confirmation_status = 'not_configured'
    and attachment_state = 'none'
  from public.create_care_communication(
    '43100000-0000-4000-8000-000000000001',
    '43200000-0000-4000-8000-000000000001',
    '43400000-0000-4000-8000-000000000001',
    '今日照顧摘要', '午餐後完成步行活動，請登入系統查看。',
    (select occurred_at from care43_times), '[]'::jsonb,
    '43700000-0000-4000-8000-000000000001'
  )
), 'authorized staff creates one immutable queued communication without forged receipts');

reset role;
select ok((
  select count(*) = 1
    and bool_and(recipient_user_id = '43000000-0000-4000-8000-000000000003')
    and bool_and(recipient_profile_kind = 'family')
    and bool_and('messages.read' = any(consent_scopes))
  from public.care_communication_recipients
), 'recipient snapshot includes only the active family messages.read consent');

select ok((
  select count(*) = 1
    and bool_and(event_kind = 'queued')
    and bool_and(channel = 'family_pwa')
    and bool_and(provider_worker_status = 'not_configured')
    and bool_and(family_consumer_status = 'not_configured')
    and bool_and(offline_consumer_status = 'not_configured')
  from public.care_communication_delivery_events
), 'delivery history records only an in-app queue event with unconfigured consumers');

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"43000000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2","session_id":"43610000-0000-4000-8000-000000000001"}',
  true
);
select ok((
  select replayed and communication_version = 1 and recipient_count = 1
  from public.create_care_communication(
    '43100000-0000-4000-8000-000000000001',
    '43200000-0000-4000-8000-000000000001',
    '43400000-0000-4000-8000-000000000001',
    '今日照顧摘要', '午餐後完成步行活動，請登入系統查看。',
    (select occurred_at from care43_times), '[]'::jsonb,
    '43700000-0000-4000-8000-000000000001'
  )
), 'exact create retry returns its original receipt');

reset role;
select is((select count(*)::integer from public.care_communication_versions), 1,
  'an exact retry does not duplicate the formal message');

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"43000000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2","session_id":"43610000-0000-4000-8000-000000000001"}',
  true
);
select throws_ok(
  $$select * from public.create_care_communication(
    '43100000-0000-4000-8000-000000000001',
    '43200000-0000-4000-8000-000000000001',
    '43400000-0000-4000-8000-000000000001',
    '不同內容', '相同操作鍵不得代表不同內容。',
    (select occurred_at from care43_times), '[]'::jsonb,
    '43700000-0000-4000-8000-000000000001'
  )$$,
  '23505', 'care communication idempotency conflict',
  'changed content cannot reuse an actor operation key'
);

select throws_ok(
  $$select * from public.create_care_communication(
    '43100000-0000-4000-8000-000000000001',
    '43200000-0000-4000-8000-000000000001',
    '43400000-0000-4000-8000-000000000001',
    '附件測試', '禁止任意瀏覽器路徑或網址。',
    (select occurred_at from care43_times),
    '[{"reference":"https://example.invalid/file.pdf","sha256":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}]'::jsonb,
    '43700000-0000-4000-8000-000000000002'
  )$$,
  '55000', 'care communication attachment pipeline is not configured',
  'attachments fail closed while trusted upload and scanning are absent'
);

select throws_ok(
  $$select * from public.create_care_communication(
    '43100000-0000-4000-8000-000000000001',
    '43200000-0000-4000-8000-000000000001',
    '43400000-0000-4000-8000-000000000002',
    '沒有收件授權', '不得在沒有訊息授權時建立待送紀錄。',
    (select occurred_at from care43_times), '[]'::jsonb,
    '43700000-0000-4000-8000-000000000003'
  )$$,
  '42501', 'care communication has no authorized family recipient',
  'a client without active messages.read family consent fails closed'
);

select throws_ok(
  $$select * from public.create_care_communication(
    '43100000-0000-4000-8000-000000000001',
    '43200000-0000-4000-8000-000000000001',
    '43400000-0000-4000-8000-000000000003',
    '跨分支個案', '不得跨分支建立照顧溝通。',
    (select occurred_at from care43_times), '[]'::jsonb,
    '43700000-0000-4000-8000-000000000004'
  )$$,
  '42501', null,
  'a client in another branch cannot enter this branch workflow'
);

select ok((
  select matching_total = 1
    and thread_total = 1
    and correction_total = 0
    and queued_total = 1
    and attachment_total = 0
    and jsonb_array_length(items) = 1
    and not items_truncated
    and can_manage and can_correct
    and category_boundary = 'care_communication_only'
    and family_recipient_boundary = 'active_messages_read_consent'
    and attachment_pipeline_status = 'not_configured'
    and provider_worker_status = 'not_configured'
    and family_consumer_status = 'not_configured'
    and offline_consumer_status = 'not_configured'
  from public.care_communication_snapshot(
    '43100000-0000-4000-8000-000000000001',
    '43200000-0000-4000-8000-000000000001'
  )
), 'snapshot reconciles current metrics and all unconfigured integration boundaries');

select is((
  select items -> 0 ->> 'category'
  from public.care_communication_snapshot(
    '43100000-0000-4000-8000-000000000001',
    '43200000-0000-4000-8000-000000000001'
  )
), 'care_communication', 'Page 43 returns only the care communication category');

select is((
  select (items -> 0) ?| array[
    'content_hash', 'author_user_id', 'idempotency_key', 'request_hash',
    'recipient_user_id', 'consent_id', 'correlation_id'
  ]
  from public.care_communication_snapshot(
    '43100000-0000-4000-8000-000000000001',
    '43200000-0000-4000-8000-000000000001'
  )
), false, 'projection omits internal actor, consent, correlation, hash and replay identifiers');

select is((
  select matching_total
  from public.care_communication_snapshot(
    '43100000-0000-4000-8000-000000000001',
    '43200000-0000-4000-8000-000000000001',
    '43400000-0000-4000-8000-000000000001', null, null, null,
    'queued', 'not_configured', '今日照顧', 'search'
  )
), 1::bigint, 'client, queued, confirmation and bounded query filters agree');

select is((
  select matching_total
  from public.care_communication_snapshot(
    '43100000-0000-4000-8000-000000000001',
    '43200000-0000-4000-8000-000000000001',
    '43400000-0000-4000-8000-000000000002'
  )
), 0::bigint, 'a visible client without messages has an honest empty result');

reset role;
create temporary table care43_created as
select result_communication_key as communication_key,
  result_version_id as version_id, result_version as communication_version
from private.care_communication_operations
where actor_user_id = '43000000-0000-4000-8000-000000000001'
  and idempotency_key = '43700000-0000-4000-8000-000000000001';
grant select on care43_created to authenticated;

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"43000000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2","session_id":"43610000-0000-4000-8000-000000000001"}',
  true
);
select ok((
  select not result.replayed
    and result.operation_kind = 'correct'
    and result.communication_key = base.communication_key
    and result.communication_version = 2
    and result.previous_version_id = base.version_id
    and result.record_kind = 'correction'
    and result.delivery_status = 'queued'
    and result.read_status = 'not_configured'
    and result.family_confirmation_status = 'not_configured'
  from care43_created base cross join lateral public.correct_care_communication(
    '43100000-0000-4000-8000-000000000001',
    '43200000-0000-4000-8000-000000000001',
    '43400000-0000-4000-8000-000000000001',
    base.communication_key, base.version_id, base.communication_version,
    '今日照顧摘要（更正）', '午餐後完成室內步行活動，請登入系統查看。',
    '補充活動地點', '[]'::jsonb,
    '43700000-0000-4000-8000-000000000005'
  ) result
), 'correction appends version two without changing the client or receipt boundary');

select ok((
  select result.replayed and result.communication_version = 2
  from care43_created base cross join lateral public.correct_care_communication(
    '43100000-0000-4000-8000-000000000001',
    '43200000-0000-4000-8000-000000000001',
    '43400000-0000-4000-8000-000000000001',
    base.communication_key, base.version_id, base.communication_version,
    '今日照顧摘要（更正）', '午餐後完成室內步行活動，請登入系統查看。',
    '補充活動地點', '[]'::jsonb,
    '43700000-0000-4000-8000-000000000005'
  ) result
), 'exact correction retry returns its original immutable receipt');

select throws_ok(
  $$select *
    from care43_created base cross join lateral public.correct_care_communication(
      '43100000-0000-4000-8000-000000000001',
      '43200000-0000-4000-8000-000000000001',
      '43400000-0000-4000-8000-000000000001',
      base.communication_key, base.version_id, base.communication_version,
      '過期基準', '不得從已被更正的版本再次分叉。',
      '測試過期基準', '[]'::jsonb,
      '43700000-0000-4000-8000-000000000006'
    )$$,
  '40001', 'care communication base version is stale',
  'stale correction base cannot fork the immutable history'
);

reset role;
select ok((
  select count(*) = 2
    and min(occurred_at) = max(occurred_at)
    and count(*) filter (where version = 1 and record_kind = 'original') = 1
    and count(*) filter (where version = 2 and record_kind = 'correction'
      and previous_version_id is not null and correction_reason = '補充活動地點') = 1
  from public.care_communication_versions
  where communication_key = (select communication_key from care43_created)
), 'original and correction remain linked with one unchanged occurrence time');

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"43000000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2","session_id":"43610000-0000-4000-8000-000000000001"}',
  true
);
select ok((
  select matching_total = 2 and thread_total = 1 and correction_total = 1
    and queued_total = 1 and jsonb_array_length(items) = 2
  from public.care_communication_snapshot(
    '43100000-0000-4000-8000-000000000001',
    '43200000-0000-4000-8000-000000000001'
  )
), 'snapshot exposes complete version history while current queued metric counts one thread');

select set_config(
  'request.jwt.claims',
  '{"sub":"43000000-0000-4000-8000-000000000002","role":"authenticated","aal":"aal2","session_id":"43610000-0000-4000-8000-000000000002"}',
  true
);
select ok((
  select not replayed and communication_version = 1
  from public.create_care_communication(
    '43100000-0000-4000-8000-000000000001',
    '43200000-0000-4000-8000-000000000001',
    '43400000-0000-4000-8000-000000000001',
    '今日照顧摘要', '午餐後完成步行活動，請登入系統查看。',
    (select occurred_at from care43_times), '[]'::jsonb,
    '43700000-0000-4000-8000-000000000001'
  )
), 'the same operation key is safely scoped to a different authorized actor');

reset role;
select is((
  select count(*)::integer from private.care_communication_operations
  where idempotency_key = '43700000-0000-4000-8000-000000000001'
), 2, 'actor-scoped idempotency stores independent receipts without collision');

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"43000000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal1","session_id":"43610000-0000-4000-8000-000000000001"}',
  true
);
select throws_ok(
  $$select * from public.care_communication_snapshot(
    '43100000-0000-4000-8000-000000000001',
    '43200000-0000-4000-8000-000000000001'
  )$$,
  '42501', 'care communication snapshot is not permitted',
  'AAL1 cannot read care communication history'
);

select set_config(
  'request.jwt.claims',
  '{"sub":"43000000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2"}',
  true
);
select throws_ok(
  $$select * from public.create_care_communication(
    '43100000-0000-4000-8000-000000000001',
    '43200000-0000-4000-8000-000000000001',
    '43400000-0000-4000-8000-000000000001',
    '缺少近期覆核', '單有 AAL2 仍不能完成高風險寫入。',
    clock_timestamp(), '[]'::jsonb,
    '43700000-0000-4000-8000-000000000007'
  )$$,
  '42501', 'care communication mutation is not permitted',
  'write fails when the session lacks recent challenge-backed AAL2'
);

select set_config(
  'request.jwt.claims',
  '{"sub":"43000000-0000-4000-8000-000000000003","role":"authenticated","aal":"aal2"}',
  true
);
select throws_ok(
  $$select * from public.care_communication_snapshot(
    '43100000-0000-4000-8000-000000000001',
    '43200000-0000-4000-8000-000000000001',
    '43400000-0000-4000-8000-000000000001'
  )$$,
  '42501', 'care communication snapshot is not permitted',
  'the absent family consumer cannot be bypassed through the staff projection'
);

select set_config(
  'request.jwt.claims',
  '{"sub":"43000000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2","session_id":"43610000-0000-4000-8000-000000000001"}',
  true
);
select throws_ok(
  $$select * from public.care_communication_snapshot(
    '43100000-0000-4000-8000-000000000001',
    '43200000-0000-4000-8000-000000000001',
    null, null, null, null, 'delivered', 'all', '', 'view'
  )$$,
  '22023', 'care communication snapshot filters are invalid',
  'unsupported delivered status cannot manufacture a delivery claim'
);

reset role;
select throws_ok(
  $$update public.care_communication_versions
    set subject = '不可覆寫' where version = 1$$,
  '55000', 'care_communication_versions is append-only',
  'formal message versions cannot be updated'
);
select throws_ok(
  $$delete from public.care_communication_delivery_events$$,
  '55000', 'care_communication_delivery_events is append-only',
  'queued delivery evidence cannot be deleted'
);
select throws_ok(
  $$insert into public.care_communication_versions (
      id, organization_id, branch_id, client_id, communication_key, version,
      previous_version_id, record_kind, category, direction,
      client_display_name, client_code, subject, body, occurred_at,
      submitted_at, author_user_id, author_display_name, author_profile_kind,
      correction_reason, attachment_state, recipient_count, delivery_status,
      read_status, family_confirmation_status, content_hash, created_at
    )
    select gen_random_uuid(), organization_id, branch_id, client_id,
      gen_random_uuid(), 1, null, 'original', 'consultant', direction,
      client_display_name, client_code, subject, body, occurred_at,
      clock_timestamp(), author_user_id, author_display_name,
      author_profile_kind, null, 'none', recipient_count, 'queued',
      'not_configured', 'not_configured', repeat('e', 64), clock_timestamp()
    from public.care_communication_versions limit 1$$,
  '23514', null,
  'database classification rejects consultant messages from Page 43'
);

select ok(exists(
  select 1 from public.audit_events
  where table_name = 'care_communication_snapshot'
    and action = 'select'
    and metadata ->> 'interaction' = 'search'
    and not (metadata ?| array['query', 'subject', 'body', 'client_id'])
), 'search access is audited with counts and boundaries but no narrative or client identifier');

select ok(
  (select count(*) >= 3 from public.audit_events
   where table_name = 'public.care_communication_versions' and action = 'insert')
  and (select count(*) >= 3 from public.audit_events
   where table_name = 'public.care_communication_recipients' and action = 'insert')
  and (select count(*) >= 3 from public.audit_events
   where table_name = 'public.care_communication_delivery_events' and action = 'insert'),
  'each immutable public version, recipient and queue event is independently audited'
);

select ok(
  position('pg_advisory_xact_lock' in pg_get_functiondef(
    'private.mutate_care_communication_atomic(text,uuid,uuid,uuid,uuid,uuid,integer,text,text,timestamptz,text,jsonb,uuid)'::regprocedure
  )) > 0
  and position('not exists' in lower(pg_get_functiondef(
    'private.mutate_care_communication_atomic(text,uuid,uuid,uuid,uuid,uuid,integer,text,text,timestamptz,text,jsonb,uuid)'::regprocedure
  ))) > 0,
  'mutation serializes operation keys and rejects stale correction lineage'
);

select ok(
  (select count(*) >= 1 from pg_indexes where schemaname = 'public'
    and tablename = 'care_communication_versions'
    and indexdef like '%organization_id%branch_id%client_id%')
  and (select count(*) >= 1 from pg_indexes where schemaname = 'public'
    and tablename = 'care_communication_recipients'
    and indexdef like '%consent_id%')
  and (select count(*) >= 1 from pg_indexes where schemaname = 'public'
    and tablename = 'care_communication_delivery_events'
    and indexdef like '%recipient_user_id%'),
  'tenant, consent and receipt-correlation foreign-key paths are indexed'
);

select * from finish();
rollback;
