begin;

select plan(36);

select results_eq(
  $$select permission_key collate "C" from public.permissions where permission_key like 'consultant_messages.%' order by permission_key collate "C"$$,
  $$values
    ('consultant_messages.manage'::text collate "C"),
    ('consultant_messages.read'::text collate "C"),
    ('consultant_messages.receive'::text collate "C")$$,
  'page 76 exposes separate read, manage and professional receive permissions'
);

select ok(
  (select bool_and(relrowsecurity and relforcerowsecurity)
   from pg_class where oid in (
     'public.consultant_messages'::regclass,
     'public.consultant_message_recipients'::regclass,
     'public.consultant_message_attachments'::regclass,
     'public.consultant_message_receipt_events'::regclass,
     'private.consultant_message_operations'::regclass
   )),
  'every Page-76 data and replay table forces RLS'
);

select ok(
  not has_table_privilege('authenticated', 'public.consultant_messages', 'select,insert,update,delete')
  and not has_table_privilege('authenticated', 'public.consultant_message_recipients', 'select,insert,update,delete')
  and not has_table_privilege('authenticated', 'public.consultant_message_attachments', 'select,insert,update,delete')
  and not has_table_privilege('authenticated', 'public.consultant_message_receipt_events', 'select,insert,update,delete')
  and not has_table_privilege('authenticated', 'private.consultant_message_operations', 'select,insert,update,delete')
  and not has_table_privilege('service_role', 'public.consultant_messages', 'select,insert,update,delete'),
  'direct table access is denied to browser and service roles'
);

select ok(
  has_function_privilege('authenticated', 'public.create_consultant_message(uuid,uuid,text,text,timestamptz,uuid[],jsonb,uuid)', 'execute')
  and has_function_privilege('authenticated', 'public.acknowledge_consultant_message(uuid,uuid,uuid,text,uuid)', 'execute')
  and has_function_privilege('authenticated', 'public.consultant_message_snapshot(uuid,uuid,uuid,date,date,text,text,text)', 'execute')
  and not has_function_privilege('anon', 'public.consultant_message_snapshot(uuid,uuid,uuid,date,date,text,text,text)', 'execute')
  and not has_function_privilege('service_role', 'public.create_consultant_message(uuid,uuid,text,text,timestamptz,uuid[],jsonb,uuid)', 'execute'),
  'only authenticated callers receive the Page-76 RPC surface'
);

select ok(
  not (select prosecdef from pg_proc where oid = 'public.create_consultant_message(uuid,uuid,text,text,timestamptz,uuid[],jsonb,uuid)'::regprocedure)
  and not (select prosecdef from pg_proc where oid = 'public.acknowledge_consultant_message(uuid,uuid,uuid,text,uuid)'::regprocedure)
  and not (select prosecdef from pg_proc where oid = 'public.consultant_message_snapshot(uuid,uuid,uuid,date,date,text,text,text)'::regprocedure)
  and (select prosecdef and coalesce(proconfig, '{}'::text[]) @> array['search_path=""']
    from pg_proc where oid = 'private.create_consultant_message_atomic(uuid,uuid,text,text,timestamptz,uuid[],jsonb,uuid)'::regprocedure)
  and (select prosecdef and coalesce(proconfig, '{}'::text[]) @> array['search_path=""']
    from pg_proc where oid = 'private.consultant_message_snapshot_response(uuid,uuid,uuid,date,date,text,text,text)'::regprocedure),
  'public wrappers are invoker and private cores are pinned definers'
);

select ok(
  (select count(*) = 5 from pg_trigger where not tgisinternal and tgname in (
    'consultant_messages_prevent_mutation',
    'consultant_message_recipients_prevent_mutation',
    'consultant_message_attachments_prevent_mutation',
    'consultant_message_receipts_prevent_mutation',
    'consultant_message_operations_prevent_mutation'
  )),
  'all formal message, recipient, attachment, receipt and replay rows are append-only'
);

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  ('00000000-0000-0000-0000-000000000000', '76000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'manager76@example.invalid', '', now(), '{}', '{}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '76000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'consultant76@example.invalid', '', now(), '{}', '{}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '76000000-0000-4000-8000-000000000003', 'authenticated', 'authenticated', 'other-consultant76@example.invalid', '', now(), '{}', '{}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '76000000-0000-4000-8000-000000000004', 'authenticated', 'authenticated', 'second-branch76@example.invalid', '', now(), '{}', '{}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '76000000-0000-4000-8000-000000000005', 'authenticated', 'authenticated', 'family76@example.invalid', '', now(), '{}', '{}', now(), now());

insert into public.organizations (id, code, name) values
  ('76100000-0000-4000-8000-000000000001', 'page76_a', '顧問訊息測試機構'),
  ('76100000-0000-4000-8000-000000000002', 'page76_b', '顧問訊息其他機構');
insert into public.branches (id, organization_id, code, name) values
  ('76200000-0000-4000-8000-000000000001', '76100000-0000-4000-8000-000000000001', 'main', '顧問訊息主分支'),
  ('76200000-0000-4000-8000-000000000002', '76100000-0000-4000-8000-000000000001', 'second', '顧問訊息第二分支'),
  ('76200000-0000-4000-8000-000000000003', '76100000-0000-4000-8000-000000000002', 'main', '顧問訊息他機構分支');
insert into public.profiles (id, display_name, employee_code, kind) values
  ('76000000-0000-4000-8000-000000000001', '顧問訊息管理員', 'M-76', 'staff'),
  ('76000000-0000-4000-8000-000000000002', '職能顧問', 'OT-76', 'professional'),
  ('76000000-0000-4000-8000-000000000003', '營養顧問', 'NU-76', 'professional'),
  ('76000000-0000-4000-8000-000000000004', '他分支顧問', 'PT-76', 'professional'),
  ('76000000-0000-4000-8000-000000000005', '顧問訊息家屬', null, 'family');
insert into public.memberships (
  id, organization_id, branch_id, profile_id, status
) values
  ('76300000-0000-4000-8000-000000000001', '76100000-0000-4000-8000-000000000001', '76200000-0000-4000-8000-000000000001', '76000000-0000-4000-8000-000000000001', 'active'),
  ('76300000-0000-4000-8000-000000000002', '76100000-0000-4000-8000-000000000001', '76200000-0000-4000-8000-000000000001', '76000000-0000-4000-8000-000000000002', 'active'),
  ('76300000-0000-4000-8000-000000000003', '76100000-0000-4000-8000-000000000001', '76200000-0000-4000-8000-000000000001', '76000000-0000-4000-8000-000000000003', 'active'),
  ('76300000-0000-4000-8000-000000000004', '76100000-0000-4000-8000-000000000001', '76200000-0000-4000-8000-000000000002', '76000000-0000-4000-8000-000000000004', 'active'),
  ('76300000-0000-4000-8000-000000000005', '76100000-0000-4000-8000-000000000001', '76200000-0000-4000-8000-000000000001', '76000000-0000-4000-8000-000000000005', 'active');
insert into public.membership_roles (membership_id, role_id) values
  ('76300000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000002'),
  ('76300000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000007'),
  ('76300000-0000-4000-8000-000000000003', '10000000-0000-4000-8000-000000000007'),
  ('76300000-0000-4000-8000-000000000004', '10000000-0000-4000-8000-000000000007'),
  ('76300000-0000-4000-8000-000000000005', '10000000-0000-4000-8000-000000000010');

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"76000000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2"}',
  true
);

select ok((
  select not replayed
    and category = 'consultant'
    and recipient_count = 1
    and message_id is not null
    and published_at is not null
  from public.create_consultant_message(
    '76100000-0000-4000-8000-000000000001',
    '76200000-0000-4000-8000-000000000001',
    '個案服務討論',
    '請顧問登入系統查看本次討論內容。',
    '2026-09-01T09:00:00+08'::timestamptz,
    array['76000000-0000-4000-8000-000000000002'::uuid],
    '[]'::jsonb,
    '76400000-0000-4000-8000-000000000001'
  )
), 'authorized staff creates one consultant-only in-app message');

select ok((
  select replayed and category = 'consultant' and recipient_count = 1
  from public.create_consultant_message(
    '76100000-0000-4000-8000-000000000001',
    '76200000-0000-4000-8000-000000000001',
    '個案服務討論',
    '請顧問登入系統查看本次討論內容。',
    '2026-09-01T09:00:00+08'::timestamptz,
    array['76000000-0000-4000-8000-000000000002'::uuid],
    '[]'::jsonb,
    '76400000-0000-4000-8000-000000000001'
  )
), 'exact create retry returns the stored receipt without a duplicate');

select throws_ok(
  $$select * from public.create_consultant_message(
    '76100000-0000-4000-8000-000000000001',
    '76200000-0000-4000-8000-000000000001',
    '不同主旨', '不同內容', clock_timestamp() - interval '10 minutes',
    array['76000000-0000-4000-8000-000000000002'::uuid], '[]'::jsonb,
    '76400000-0000-4000-8000-000000000001'
  )$$,
  '23505', 'consultant message idempotency conflict',
  'changed content cannot reuse a confirmed idempotency key'
);

select throws_ok(
  $$select * from public.create_consultant_message(
    '76100000-0000-4000-8000-000000000001',
    '76200000-0000-4000-8000-000000000001',
    '附件測試', '不可繞過上傳掃描管線', clock_timestamp(),
    array['76000000-0000-4000-8000-000000000002'::uuid],
    '[{"reference":"https://example.invalid/file.pdf","sha256":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}]'::jsonb,
    '76400000-0000-4000-8000-000000000002'
  )$$,
  '55000', 'consultant message attachment pipeline is not configured',
  'an arbitrary URL and hash fail closed while the trusted attachment pipeline is absent'
);

select throws_ok(
  $$select * from public.create_consultant_message(
    '76100000-0000-4000-8000-000000000001',
    '76200000-0000-4000-8000-000000000001',
    '跨分支收件', '不可跨分支凍結收件人', clock_timestamp(),
    array['76000000-0000-4000-8000-000000000004'::uuid], '[]'::jsonb,
    '76400000-0000-4000-8000-000000000003'
  )$$,
  '42501', 'consultant message recipient is outside the active professional scope',
  'a different branch professional cannot be frozen as a recipient'
);

select ok((
  select message_total = 1
    and unread_total = 1
    and confirmation_pending_total = 1
    and attachment_total = 0
    and jsonb_array_length(items) = 1
    and not items_truncated
    and can_manage
    and jsonb_array_length(recipient_options) = 2
    and category_boundary = 'consultant_only'
    and delivery_boundary = 'in_app_only'
    and attachment_pipeline_status = 'not_configured'
    and attachment_scan_status = 'not_configured'
  from public.consultant_message_snapshot(
    '76100000-0000-4000-8000-000000000001',
    '76200000-0000-4000-8000-000000000001'
  )
), 'manager snapshot metrics, consultant options and explicit integration boundaries reconcile');

select is((
  select items -> 0 ->> 'category'
  from public.consultant_message_snapshot(
    '76100000-0000-4000-8000-000000000001',
    '76200000-0000-4000-8000-000000000001'
  )
), 'consultant', 'the dedicated projection can only return consultant category rows');

select is((
  select (items -> 0) ?| array[
    'content_hash', 'author_user_id', 'request_hash',
    'idempotency_key', 'attachment_sha256', 'recipient_membership_id'
  ]
  from public.consultant_message_snapshot(
    '76100000-0000-4000-8000-000000000001',
    '76200000-0000-4000-8000-000000000001'
  )
), false, 'message projections omit hashes, replay keys and internal membership identifiers');

select is((
  select message_total
  from public.consultant_message_snapshot(
    '76100000-0000-4000-8000-000000000001',
    '76200000-0000-4000-8000-000000000001',
    '76000000-0000-4000-8000-000000000003', null, null,
    'all', '', 'search'
  )
), 0::bigint, 'manager consultant filter uses the frozen recipient snapshot exactly');

select is((
  select message_total
  from public.consultant_message_snapshot(
    '76100000-0000-4000-8000-000000000001',
    '76200000-0000-4000-8000-000000000001',
    null, null, null, 'all', '個案服務', 'search'
  )
), 1::bigint, 'bounded subject/body search finds only authorized consultant messages');

reset role;
create temporary table created_consultant_message as
select message_id
from private.consultant_message_operations
where idempotency_key = '76400000-0000-4000-8000-000000000001';
grant select on created_consultant_message to authenticated;
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"76000000-0000-4000-8000-000000000002","role":"authenticated","aal":"aal2"}',
  true
);

select ok((
  select message_total = 1
    and unread_total = 1
    and confirmation_pending_total = 1
    and not can_manage
    and recipient_options = '[]'::jsonb
    and jsonb_array_length(items -> 0 -> 'recipients') = 1
    and (items -> 0 ->> 'actor_is_recipient')::boolean
  from public.consultant_message_snapshot(
    '76100000-0000-4000-8000-000000000001',
    '76200000-0000-4000-8000-000000000001'
  )
), 'recipient sees only own frozen recipient detail and receives no management options');

select throws_ok(
  $$select * from public.consultant_message_snapshot(
    '76100000-0000-4000-8000-000000000001',
    '76200000-0000-4000-8000-000000000001',
    '76000000-0000-4000-8000-000000000003'
  )$$,
  '42501', 'consultant message snapshot consultant filter is not permitted',
  'a recipient cannot probe a different consultant filter'
);

select ok((
  select not replayed and category = 'consultant' and action = 'read'
    and read_at is not null and confirmed_at is null
  from public.acknowledge_consultant_message(
    '76100000-0000-4000-8000-000000000001',
    '76200000-0000-4000-8000-000000000001',
    (select message_id from created_consultant_message),
    'read', '76500000-0000-4000-8000-000000000001'
  )
), 'recipient appends an actual read receipt');

select ok((
  select replayed and action = 'read' and read_at is not null
  from public.acknowledge_consultant_message(
    '76100000-0000-4000-8000-000000000001',
    '76200000-0000-4000-8000-000000000001',
    (select message_id from created_consultant_message),
    'read', '76500000-0000-4000-8000-000000000001'
  )
), 'exact read retry reuses its immutable operation receipt');

select throws_ok(
  $$select * from public.acknowledge_consultant_message(
    '76100000-0000-4000-8000-000000000001',
    '76200000-0000-4000-8000-000000000001',
    (select message_id from created_consultant_message),
    'confirm', '76500000-0000-4000-8000-000000000001'
  )$$,
  '23505', 'consultant message idempotency conflict',
  'one idempotency key cannot change from read to confirm'
);

select ok((
  select not replayed and action = 'confirm'
    and read_at is not null and confirmed_at is not null
  from public.acknowledge_consultant_message(
    '76100000-0000-4000-8000-000000000001',
    '76200000-0000-4000-8000-000000000001',
    (select message_id from created_consultant_message),
    'confirm', '76500000-0000-4000-8000-000000000002'
  )
), 'recipient appends confirmation without rewriting the original read time');

select ok((
  select unread_total = 0 and confirmation_pending_total = 0
    and (items -> 0 ->> 'actor_read_at') is not null
    and (items -> 0 ->> 'actor_confirmed_at') is not null
    and (items -> 0 ->> 'read_count')::integer = 1
    and (items -> 0 ->> 'confirmed_count')::integer = 1
  from public.consultant_message_snapshot(
    '76100000-0000-4000-8000-000000000001',
    '76200000-0000-4000-8000-000000000001'
  )
), 'read and confirmation metrics use the same receipt snapshot');

select set_config(
  'request.jwt.claims',
  '{"sub":"76000000-0000-4000-8000-000000000003","role":"authenticated","aal":"aal2"}',
  true
);
select is((
  select message_total from public.consultant_message_snapshot(
    '76100000-0000-4000-8000-000000000001',
    '76200000-0000-4000-8000-000000000001'
  )
), 0::bigint, 'same-branch consultant without a frozen recipient row sees no message content');

select set_config(
  'request.jwt.claims',
  '{"sub":"76000000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2"}',
  true
);
select throws_ok(
  $$select * from public.acknowledge_consultant_message(
    '76100000-0000-4000-8000-000000000001',
    '76200000-0000-4000-8000-000000000001',
    (select message_id from created_consultant_message),
    'read', '76500000-0000-4000-8000-000000000003'
  )$$,
  '42501', 'consultant message acknowledgement is not permitted',
  'staff management visibility never lets a staff actor forge a consultant receipt'
);

select throws_ok(
  $$select * from public.consultant_message_snapshot(
    '76100000-0000-4000-8000-000000000001',
    '76200000-0000-4000-8000-000000000002'
  )$$,
  '42501', 'consultant message snapshot is not permitted',
  'same-organization branch substitution fails closed'
);

select set_config(
  'request.jwt.claims',
  '{"sub":"76000000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal1"}',
  true
);
select throws_ok(
  $$select * from public.consultant_message_snapshot(
    '76100000-0000-4000-8000-000000000001',
    '76200000-0000-4000-8000-000000000001'
  )$$,
  '42501', 'consultant message snapshot is not permitted',
  'AAL1 cannot read Page 76'
);
select throws_ok(
  $$select * from private.consultant_message_snapshot_response(
    '76100000-0000-4000-8000-000000000001',
    '76200000-0000-4000-8000-000000000001'
  )$$,
  '42501', 'consultant message snapshot is not permitted',
  'direct private core execution retains all fail-closed checks'
);

reset role;
select ok(
  exists (
    select 1 from public.audit_events
    where table_name = 'consultant_message_snapshot'
      and action = 'select'
      and metadata ->> 'projection' = 'page76_consultant_only_v1'
      and metadata ->> 'category' = 'consultant'
      and metadata ->> 'delivery_boundary' = 'in_app_only'
      and metadata ->> 'attachment_pipeline_status' = 'not_configured'
      and not metadata ?| array['query', 'subject', 'body', 'recipient_user_id']
  ),
  'every successful view writes a minimized consultant-only audit event without message content'
);

select throws_ok(
  $$update public.consultant_messages set subject = '不可覆寫' where subject = '個案服務討論'$$,
  '55000', 'consultant_messages is append-only',
  'message history cannot be updated'
);
select throws_ok(
  $$delete from public.consultant_message_receipt_events where receipt_kind = 'read'$$,
  '55000', 'consultant_message_receipt_events is append-only',
  'read evidence cannot be deleted'
);
select throws_ok(
  $$update private.consultant_message_operations set action = action$$,
  '55000', 'consultant_message_operations is append-only',
  'operation receipts cannot be rewritten even by the migration role'
);
select throws_ok(
  $$insert into public.consultant_messages (
    organization_id, branch_id, category, subject, body, occurred_at,
    published_at, author_user_id, author_display_name, author_profile_kind,
    recipient_count, content_hash, created_at
  ) values (
    '76100000-0000-4000-8000-000000000001',
    '76200000-0000-4000-8000-000000000001',
    'general', '混入一般訊息', '不可寫入', now(), now(),
    '76000000-0000-4000-8000-000000000001', '顧問訊息管理員', 'staff',
    1, repeat('a', 64), now()
  )$$,
  '23514', null,
  'database category constraint prevents general messages from entering the stream'
);

insert into public.consultant_messages (
  organization_id, branch_id, category, subject, body, occurred_at,
  published_at, author_user_id, author_display_name, author_profile_kind,
  recipient_count, content_hash, created_at
)
select
  '76100000-0000-4000-8000-000000000001',
  '76200000-0000-4000-8000-000000000001',
  'consultant', '歷史顧問訊息 ' || series, '合成歷史內容',
  clock_timestamp() - make_interval(mins => series),
  clock_timestamp(), '76000000-0000-4000-8000-000000000001',
  '顧問訊息管理員', 'staff', 1, repeat('b', 64), clock_timestamp()
from generate_series(1, 101) series;
insert into public.consultant_message_recipients (
  organization_id, branch_id, message_id, recipient_user_id,
  recipient_membership_id, recipient_display_name, recipient_employee_code,
  recipient_profile_kind, role_names, frozen_at
)
select
  message.organization_id, message.branch_id, message.id,
  '76000000-0000-4000-8000-000000000002',
  '76300000-0000-4000-8000-000000000002',
  '職能顧問', 'OT-76', 'professional', array['專業人員'], clock_timestamp()
from public.consultant_messages message
where message.subject like '歷史顧問訊息 %';

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"76000000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2"}',
  true
);
select ok((
  select message_total = 101
    and jsonb_array_length(items) = 100
    and items_truncated
    and unread_total = 101
    and confirmation_pending_total = 101
  from public.consultant_message_snapshot(
    '76100000-0000-4000-8000-000000000001',
    '76200000-0000-4000-8000-000000000001',
    null, null, null, 'all', '歷史顧問訊息', 'search'
  )
), 'full metrics remain truthful when consultant history is bounded at 100 rows');

select set_config(
  'request.jwt.claims',
  '{"sub":"76000000-0000-4000-8000-000000000005","role":"authenticated","aal":"aal2"}',
  true
);
select throws_ok(
  $$select * from public.consultant_message_snapshot(
    '76100000-0000-4000-8000-000000000001',
    '76200000-0000-4000-8000-000000000001'
  )$$,
  '42501', 'consultant message snapshot is not permitted',
  'family profile cannot cross into the staff consultant message entry point'
);

reset role;
update public.memberships
set status = 'ended', ends_at = clock_timestamp() + interval '1 second'
where id = '76300000-0000-4000-8000-000000000002';
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"76000000-0000-4000-8000-000000000002","role":"authenticated","aal":"aal2"}',
  true
);
select throws_ok(
  $$select * from public.acknowledge_consultant_message(
    '76100000-0000-4000-8000-000000000001',
    '76200000-0000-4000-8000-000000000001',
    (select message_id from created_consultant_message),
    'read', '76500000-0000-4000-8000-000000000001'
  )$$,
  '42501', 'consultant message acknowledgement is not permitted',
  'revoked professional cannot use an exact replay as a stale authorization path'
);

select * from finish();
rollback;
