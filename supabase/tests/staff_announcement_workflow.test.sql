begin;

select plan(55);

select ok(
  to_regclass('public.staff_announcement_versions') is not null
  and to_regclass('public.staff_announcement_recipients') is not null
  and to_regclass('public.staff_announcement_read_receipts') is not null
  and to_regclass('private.staff_announcement_operations') is not null,
  'page 68 has dedicated immutable versions, recipients, receipts, and actor operation ledger'
);
select is(
  (select count(*)::integer from pg_class where oid in (
    'public.staff_announcement_versions'::regclass,
    'public.staff_announcement_recipients'::regclass,
    'public.staff_announcement_read_receipts'::regclass,
    'private.staff_announcement_operations'::regclass
  ) and relrowsecurity and relforcerowsecurity),
  4,
  'all announcement business and private ledger tables force RLS'
);
select ok(
  not has_table_privilege('authenticated','public.staff_announcement_versions','select')
  and not has_table_privilege('authenticated','public.staff_announcement_versions','insert')
  and not has_table_privilege('authenticated','public.staff_announcement_recipients','select')
  and not has_table_privilege('authenticated','public.staff_announcement_read_receipts','insert')
  and not has_table_privilege('service_role','private.staff_announcement_operations','select'),
  'authenticated and service callers have no direct announcement table path'
);
select ok(
  has_function_privilege('authenticated','public.create_staff_announcement_draft(uuid,uuid,uuid,text,text,timestamptz,timestamptz,uuid[],uuid[],text,uuid)','execute')
  and has_function_privilege('authenticated','public.publish_staff_announcement(uuid,uuid,uuid,uuid)','execute')
  and has_function_privilege('authenticated','public.withdraw_staff_announcement(uuid,uuid,uuid,uuid,text,uuid)','execute')
  and has_function_privilege('authenticated','public.mark_staff_announcement_read(uuid,uuid,uuid,uuid)','execute')
  and has_function_privilege('authenticated','public.staff_announcement_management_snapshot(uuid,uuid,uuid)','execute')
  and not has_function_privilege('anon','public.publish_staff_announcement(uuid,uuid,uuid,uuid)','execute'),
  'only authenticated callers receive the five narrow public interfaces'
);
select ok(
  (select bool_and(not prosecdef) from pg_proc where oid in (
    'public.create_staff_announcement_draft(uuid,uuid,uuid,text,text,timestamptz,timestamptz,uuid[],uuid[],text,uuid)'::regprocedure,
    'public.publish_staff_announcement(uuid,uuid,uuid,uuid)'::regprocedure,
    'public.withdraw_staff_announcement(uuid,uuid,uuid,uuid,text,uuid)'::regprocedure,
    'public.mark_staff_announcement_read(uuid,uuid,uuid,uuid)'::regprocedure,
    'public.staff_announcement_management_snapshot(uuid,uuid,uuid)'::regprocedure
  )),
  'public wrappers are SECURITY INVOKER and do not violate the private-only definer invariant'
);
select ok(
  has_function_privilege('authenticated','private.create_staff_announcement_draft_atomic(uuid,uuid,uuid,text,text,timestamptz,timestamptz,uuid[],uuid[],text,uuid)','execute')
  and has_function_privilege('authenticated','private.publish_staff_announcement_atomic(uuid,uuid,uuid,uuid)','execute')
  and has_function_privilege('authenticated','private.withdraw_staff_announcement_atomic(uuid,uuid,uuid,uuid,text,uuid)','execute')
  and has_function_privilege('authenticated','private.mark_staff_announcement_read_atomic(uuid,uuid,uuid,uuid)','execute')
  and has_function_privilege('authenticated','private.staff_announcement_management_snapshot_core(uuid,uuid,uuid)','execute')
  and not has_function_privilege('anon','private.publish_staff_announcement_atomic(uuid,uuid,uuid,uuid)','execute')
  and (select bool_and(prosecdef and coalesce(proconfig,'{}'::text[]) @> array['search_path=""'])
    from pg_proc where oid in (
      'private.create_staff_announcement_draft_atomic(uuid,uuid,uuid,text,text,timestamptz,timestamptz,uuid[],uuid[],text,uuid)'::regprocedure,
      'private.publish_staff_announcement_atomic(uuid,uuid,uuid,uuid)'::regprocedure,
      'private.withdraw_staff_announcement_atomic(uuid,uuid,uuid,uuid,text,uuid)'::regprocedure,
      'private.mark_staff_announcement_read_atomic(uuid,uuid,uuid,uuid)'::regprocedure,
      'private.staff_announcement_management_snapshot_core(uuid,uuid,uuid)'::regprocedure
    )),
  'only authenticated receives the five required private definer cores and every core pins an empty search path'
);
select ok(
  pg_get_function_arguments('public.publish_staff_announcement(uuid,uuid,uuid,uuid)'::regprocedure)
    !~ '(actor|challenge|recipient|hash|version|created)'
  and pg_get_function_result('public.staff_announcement_management_snapshot(uuid,uuid,uuid)'::regprocedure)
    !~ '(challenge|content_hash|created_by|request_hash|idempotency)',
  'callers cannot supply signing evidence and snapshots omit internal evidence and hashes'
);
select is(
  (select count(*)::integer from pg_trigger where not tgisinternal and tgname in (
    'staff_announcement_versions_validate_chain',
    'staff_announcement_versions_prevent_mutation',
    'staff_announcement_recipients_prevent_mutation',
    'staff_announcement_read_receipts_prevent_mutation',
    'staff_announcement_operations_prevent_mutation'
  )),
  5,
  'lineage and all four history stores reject mutation or invalid forks'
);
select is(
  (select count(*)::integer from pg_trigger where not tgisinternal and tgname in (
    'staff_announcement_versions_audit_row_change',
    'staff_announcement_recipients_audit_row_change',
    'staff_announcement_read_receipts_audit_row_change',
    'staff_announcement_operations_audit_row_change'
  )),
  4,
  'every page-68 history store has an exact audit trigger'
);
select ok(
  position('v_draft.expires_at<=v_now' in replace(pg_get_functiondef(
    'private.publish_staff_announcement_atomic(uuid,uuid,uuid,uuid)'::regprocedure
  ),' ','')) > 0
  and position('v_challenge:=private.require_staff_announcement_reauth' in replace(pg_get_functiondef(
    'private.publish_staff_announcement_atomic(uuid,uuid,uuid,uuid)'::regprocedure
  ),' ','')) > position('v_draft.expires_at<=v_now' in replace(pg_get_functiondef(
    'private.publish_staff_announcement_atomic(uuid,uuid,uuid,uuid)'::regprocedure
  ),' ','')),
  'release rechecks expiry after audience preparation and before final AAL2 evidence and insert'
);
select ok(
  position('staff_announcement_management_bundle' in pg_get_functiondef(
    'private.staff_announcement_management_snapshot_core(uuid,uuid,uuid)'::regprocedure
  )) > 0
  and position('aggregate and recipient detail changed' in pg_get_functiondef(
    'private.staff_announcement_management_snapshot_core(uuid,uuid,uuid)'::regprocedure
  )) > 0
  and position('expired after audit' in pg_get_functiondef(
    'private.staff_announcement_management_snapshot_core(uuid,uuid,uuid)'::regprocedure
  )) > 0,
  'one audited management bundle buffers aggregate and detail then performs a post-audit recheck'
);
select ok(
  position('available_total' in pg_get_functiondef(
    'private.staff_announcement_management_bundle(uuid,uuid,uuid,boolean,timestamptz,uuid)'::regprocedure
  )) > 0
  and position('items_truncated' in pg_get_functiondef(
    'private.staff_announcement_management_bundle(uuid,uuid,uuid,boolean,timestamptz,uuid)'::regprocedure
  )) > 0,
  'the bounded 100-row bundle separately exposes full available totals and truncation'
);

insert into auth.users (
  instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,
  raw_app_meta_data,raw_user_meta_data,created_at,updated_at
) values
  ('00000000-0000-0000-0000-000000000000','a6800000-0000-4000-8000-000000000001','authenticated','authenticated','page68-manager@example.invalid','',now(),'{}','{}',now(),now()),
  ('00000000-0000-0000-0000-000000000000','a6800000-0000-4000-8000-000000000002','authenticated','authenticated','page68-reader@example.invalid','',now(),'{}','{}',now(),now()),
  ('00000000-0000-0000-0000-000000000000','a6800000-0000-4000-8000-000000000003','authenticated','authenticated','page68-role@example.invalid','',now(),'{}','{}',now(),now()),
  ('00000000-0000-0000-0000-000000000000','a6800000-0000-4000-8000-000000000004','authenticated','authenticated','page68-other-branch@example.invalid','',now(),'{}','{}',now(),now()),
  ('00000000-0000-0000-0000-000000000000','a6800000-0000-4000-8000-000000000005','authenticated','authenticated','page68-other-org@example.invalid','',now(),'{}','{}',now(),now());

insert into public.organizations(id,code,name) values
  ('a6810000-0000-4000-8000-000000000001','page68_a','第68頁機構 A'),
  ('a6810000-0000-4000-8000-000000000002','page68_b','第68頁機構 B');
insert into public.branches(id,organization_id,code,name) values
  ('a6820000-0000-4000-8000-000000000001','a6810000-0000-4000-8000-000000000001','main','A 主分支'),
  ('a6820000-0000-4000-8000-000000000002','a6810000-0000-4000-8000-000000000001','other','A 其他分支'),
  ('a6820000-0000-4000-8000-000000000003','a6810000-0000-4000-8000-000000000002','main','B 主分支');
insert into public.profiles(id,display_name,kind,employee_code) values
  ('a6800000-0000-4000-8000-000000000001','公告管理員','staff','A68-M'),
  ('a6800000-0000-4000-8000-000000000002','公告收件照服員','staff','A68-R'),
  ('a6800000-0000-4000-8000-000000000003','公告角色收件人','professional','A68-P'),
  ('a6800000-0000-4000-8000-000000000004','其他分支員工','staff','A68-O'),
  ('a6800000-0000-4000-8000-000000000005','其他機構員工','staff','A68-B');
insert into public.memberships(id,organization_id,branch_id,profile_id,status) values
  ('a6830000-0000-4000-8000-000000000001','a6810000-0000-4000-8000-000000000001','a6820000-0000-4000-8000-000000000001','a6800000-0000-4000-8000-000000000001','active'),
  ('a6830000-0000-4000-8000-000000000002','a6810000-0000-4000-8000-000000000001','a6820000-0000-4000-8000-000000000001','a6800000-0000-4000-8000-000000000002','active'),
  ('a6830000-0000-4000-8000-000000000003','a6810000-0000-4000-8000-000000000001','a6820000-0000-4000-8000-000000000001','a6800000-0000-4000-8000-000000000003','active'),
  ('a6830000-0000-4000-8000-000000000004','a6810000-0000-4000-8000-000000000001','a6820000-0000-4000-8000-000000000002','a6800000-0000-4000-8000-000000000004','active'),
  ('a6830000-0000-4000-8000-000000000005','a6810000-0000-4000-8000-000000000002','a6820000-0000-4000-8000-000000000003','a6800000-0000-4000-8000-000000000005','active');
insert into public.membership_roles(membership_id,role_id) values
  ('a6830000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000003'),
  ('a6830000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000006'),
  ('a6830000-0000-4000-8000-000000000003','10000000-0000-4000-8000-000000000006'),
  ('a6830000-0000-4000-8000-000000000004','10000000-0000-4000-8000-000000000006'),
  ('a6830000-0000-4000-8000-000000000005','10000000-0000-4000-8000-000000000006');

insert into private.reauth_challenges(
  id,user_id,session_id,nonce_sha256,idempotency_key,issued_jwt_iat,
  created_at,expires_at,consumed_at,consumed_jwt_iat,factor_method,factor_verified_at
) values (
  'a6840000-0000-4000-8000-000000000001','a6800000-0000-4000-8000-000000000001',
  'a6850000-0000-4000-8000-000000000001',repeat('a',64),
  'a6860000-0000-4000-8000-000000000001',now()-interval '2 minutes',
  now()-interval '2 minutes',now()+interval '4 minutes',now()-interval '30 seconds',
  now()-interval '30 seconds','totp',now()-interval '30 seconds'
);
insert into private.reauth_events(user_id,session_id,challenge_id,aal,verification_method,verified_at)
values('a6800000-0000-4000-8000-000000000001','a6850000-0000-4000-8000-000000000001',
  'a6840000-0000-4000-8000-000000000001','aal2','totp',now()-interval '30 seconds');

set local role authenticated;
select set_config('request.jwt.claims','{"sub":"a6800000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal1","session_id":"a6850000-0000-4000-8000-000000000001"}',true);
select throws_ok(
  $$select * from public.staff_announcement_management_snapshot('a6810000-0000-4000-8000-000000000001','a6820000-0000-4000-8000-000000000001',null)$$,
  '42501','announcement management snapshot is not permitted','AAL1 staff cannot read the announcement snapshot'
);
select throws_ok(
  $$select * from public.create_staff_announcement_draft('a6810000-0000-4000-8000-000000000001','a6820000-0000-4000-8000-000000000001',null,'標題','內容',now()+interval '1 hour',null,array['a6800000-0000-4000-8000-000000000002']::uuid[],'{}'::uuid[],null,'a6870000-0000-4000-8000-000000000001')$$,
  '42501','announcement draft is not permitted','AAL1 staff cannot create a draft'
);

select set_config('request.jwt.claims','{"sub":"a6800000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2","session_id":"a6850000-0000-4000-8000-000000000001"}',true);
select throws_ok(
  $$select * from public.create_staff_announcement_draft('a6810000-0000-4000-8000-000000000001','a6820000-0000-4000-8000-000000000002',null,'','',now(),null,'{}'::uuid[],'{}'::uuid[],null,'a6870000-0000-4000-8000-000000000002')$$,
  '42501','announcement draft is not permitted','cross-branch authority is rejected before invalid body content'
);
select throws_ok(
  $$select * from public.create_staff_announcement_draft('a6810000-0000-4000-8000-000000000002','a6820000-0000-4000-8000-000000000003',null,'','',now(),null,'{}'::uuid[],'{}'::uuid[],null,'a6870000-0000-4000-8000-000000000003')$$,
  '42501','announcement draft is not permitted','cross-tenant authority is rejected before invalid body content'
);
select ok(
  (select version=1 and previous_version_id is null and version_state='draft' and not replayed
  from public.create_staff_announcement_draft(
    'a6810000-0000-4000-8000-000000000001','a6820000-0000-4000-8000-000000000001',null,
    '員工公告','第一行\n第二行',now()-interval '1 minute',null,
    array['a6800000-0000-4000-8000-000000000002']::uuid[],array['10000000-0000-4000-8000-000000000006']::uuid[],null,
    'a6870000-0000-4000-8000-000000000010')),
  'authorized manager creates immutable draft version one'
);

reset role;
create temporary table page68_ids as
select id draft_id,announcement_key,publish_at,
  null::uuid release_id,null::uuid revision_id,null::uuid withdrawal_id,
  null::uuid expired_draft_id,null::uuid audience_draft_id
from public.staff_announcement_versions
where version=1 and title='員工公告';
grant select on page68_ids to authenticated;
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"a6800000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2","session_id":"a6850000-0000-4000-8000-000000000001"}',true);

select ok(
  (select version=1 and replayed from public.create_staff_announcement_draft(
    'a6810000-0000-4000-8000-000000000001','a6820000-0000-4000-8000-000000000001',null,
    '員工公告','第一行\n第二行',(select publish_at from page68_ids),null,
    array['a6800000-0000-4000-8000-000000000002']::uuid[],array['10000000-0000-4000-8000-000000000006']::uuid[],null,
    'a6870000-0000-4000-8000-000000000010')),
  'an exact actor-scoped draft replay returns the immutable first receipt'
);
select throws_ok(
  $$select * from public.create_staff_announcement_draft(
    'a6810000-0000-4000-8000-000000000001','a6820000-0000-4000-8000-000000000001',null,
    '內容不同','內容',(select publish_at from page68_ids),null,
    array['a6800000-0000-4000-8000-000000000002']::uuid[],array['10000000-0000-4000-8000-000000000006']::uuid[],null,
    'a6870000-0000-4000-8000-000000000010')$$,
  '23505','announcement idempotency conflict','same actor key rejects changed draft content'
);
select throws_ok(
  $$insert into public.staff_announcement_versions(
    organization_id,branch_id,announcement_key,version,version_state,title,body,publish_at,
    audience_branch_id,audience_user_ids,audience_role_ids,recipient_count,content_hash,created_by,created_at
  ) values('a6810000-0000-4000-8000-000000000001','a6820000-0000-4000-8000-000000000001',gen_random_uuid(),1,'draft','繞過','繞過',now(),
    'a6820000-0000-4000-8000-000000000001',array['a6800000-0000-4000-8000-000000000002']::uuid[],'{}'::uuid[],0,repeat('a',64),'a6800000-0000-4000-8000-000000000001',now())$$,
  '42501',null,'direct announcement table writes are denied'
);

select ok(
  (select version=2 and draft_version_id=(select draft_id from page68_ids)
      and recipient_count=2 and not replayed
  from public.publish_staff_announcement(
    'a6810000-0000-4000-8000-000000000001','a6820000-0000-4000-8000-000000000001',
    (select draft_id from page68_ids),'a6870000-0000-4000-8000-000000000011')),
  'first release freezes the union of direct and governed-role active staff exactly once'
);

reset role;
update page68_ids set release_id=(
  select id from public.staff_announcement_versions
  where announcement_key=(select announcement_key from page68_ids) and version=2
);
select is(
  (select count(*)::integer from public.staff_announcement_recipients where release_version_id=(select release_id from page68_ids)),
  2,'release recipient snapshot de-duplicates direct plus role resolution'
);
select results_eq(
  $$select recipient_display_name collate "C",resolution_kind collate "C" from public.staff_announcement_recipients
    where release_version_id=(select release_id from page68_ids)
    order by recipient_display_name collate "C"$$,
  $$values('公告收件照服員'::text collate "C",'direct_and_role'::text collate "C"),('公告角色收件人'::text collate "C",'role'::text collate "C")$$,
  'recipient snapshot records exact names and direct-versus-role provenance'
);
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"a6800000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2","session_id":"a6850000-0000-4000-8000-000000000001"}',true);
select ok(
  (select version=2 and replayed from public.publish_staff_announcement(
    'a6810000-0000-4000-8000-000000000001','a6820000-0000-4000-8000-000000000001',
    (select draft_id from page68_ids),'a6870000-0000-4000-8000-000000000011')),
  'exact publish replay is one result and reports replayed true'
);
select throws_ok(
  $$select * from public.publish_staff_announcement(
    'a6810000-0000-4000-8000-000000000001','a6820000-0000-4000-8000-000000000001',gen_random_uuid(),
    'a6870000-0000-4000-8000-000000000011')$$,
  '23505','announcement idempotency conflict','publish key cannot be changed to another target'
);

select ok(
  (select version=1 from public.create_staff_announcement_draft(
    'a6810000-0000-4000-8000-000000000001','a6820000-0000-4000-8000-000000000001',null,
    '已過期草稿','不得發布',now()-interval '2 hours',now()-interval '1 hour',
    array['a6800000-0000-4000-8000-000000000002']::uuid[],'{}'::uuid[],null,
    'a6870000-0000-4000-8000-000000000012')),
  'draft may preserve an explicit historical schedule without pretending it is publishable'
);
reset role;
update page68_ids set expired_draft_id=(select id from public.staff_announcement_versions where title='已過期草稿');
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"a6800000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2","session_id":"a6850000-0000-4000-8000-000000000001"}',true);
select throws_ok(
  $$select * from public.publish_staff_announcement(
    'a6810000-0000-4000-8000-000000000001','a6820000-0000-4000-8000-000000000001',
    (select expired_draft_id from page68_ids),
    'a6870000-0000-4000-8000-000000000013')$$,
  '22023','announcement expiry must still be in the future at release','new release rejects a draft whose expiry already passed'
);

select ok(
  (select version=1 from public.create_staff_announcement_draft(
    'a6810000-0000-4000-8000-000000000001','a6820000-0000-4000-8000-000000000001',null,
    '受眾失效草稿','發布前停用',now()+interval '2 hours',null,
    array['a6800000-0000-4000-8000-000000000003']::uuid[],'{}'::uuid[],null,
    'a6870000-0000-4000-8000-000000000014')),
  'active direct staff can be selected for a draft'
);
reset role;
update page68_ids set audience_draft_id=(select id from public.staff_announcement_versions where title='受眾失效草稿');
select set_config('request.jwt.claims','{}',true);
update public.profiles set is_active=false where id='a6800000-0000-4000-8000-000000000003';
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"a6800000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2","session_id":"a6850000-0000-4000-8000-000000000001"}',true);
select throws_ok(
  $$select * from public.publish_staff_announcement(
    'a6810000-0000-4000-8000-000000000001','a6820000-0000-4000-8000-000000000001',
    (select audience_draft_id from page68_ids),
    'a6870000-0000-4000-8000-000000000015')$$,
  '42501','announcement audience changed before release','release revalidates selected active staff instead of freezing a stale audience'
);
reset role;
select set_config('request.jwt.claims','{}',true);
update public.profiles set is_active=true where id='a6800000-0000-4000-8000-000000000003';

set local role authenticated;
select set_config('request.jwt.claims','{"sub":"a6800000-0000-4000-8000-000000000002","role":"authenticated","aal":"aal2"}',true);
select results_eq(
  $$select (announcements->0->>'lifecycle') collate "C",jsonb_array_length(staff_options),jsonb_array_length(role_options),
      (summary->>'available_total')::integer,(summary->>'items_truncated')::boolean
    from public.staff_announcement_management_snapshot(
      'a6810000-0000-4000-8000-000000000001','a6820000-0000-4000-8000-000000000001',null)$$,
  $$values('published'::text collate "C",0,0,1,false)$$,
  'ordinary recipient sees only own currently published release data and no management audience options'
);
select throws_ok(
  $$select * from public.staff_announcement_management_snapshot(
    'a6810000-0000-4000-8000-000000000001','a6820000-0000-4000-8000-000000000002',null)$$,
  '42501','announcement management snapshot is not permitted','reader cannot substitute another branch'
);
select throws_ok(
  $$select * from public.staff_announcement_management_snapshot(
    'a6810000-0000-4000-8000-000000000001','a6820000-0000-4000-8000-000000000001',
    (select release_id from page68_ids))$$,
  '42501','announcement recipient detail is not permitted','ordinary reader cannot request staff recipient detail'
);
select ok(
  (select not replayed from public.mark_staff_announcement_read(
    'a6810000-0000-4000-8000-000000000001','a6820000-0000-4000-8000-000000000001',
    (select release_id from page68_ids),
    'a6870000-0000-4000-8000-000000000020')),
  'recipient creates one actual read receipt without a delivery guess'
);
select ok(
  (select replayed from public.mark_staff_announcement_read(
    'a6810000-0000-4000-8000-000000000001','a6820000-0000-4000-8000-000000000001',
    (select release_id from page68_ids),
    'a6870000-0000-4000-8000-000000000020')),
  'exact read replay returns the original immutable receipt'
);
select throws_ok(
  $$select * from public.mark_staff_announcement_read(
    'a6810000-0000-4000-8000-000000000001','a6820000-0000-4000-8000-000000000001',gen_random_uuid(),
    'a6870000-0000-4000-8000-000000000020')$$,
  '23505','announcement idempotency conflict','read key rejects changed release content'
);
select throws_ok(
  $$insert into public.staff_announcement_read_receipts(
    release_version_id,organization_id,branch_id,announcement_key,recipient_user_id,read_at
  ) select release_id,'a6810000-0000-4000-8000-000000000001','a6820000-0000-4000-8000-000000000001',
      announcement_key,'a6800000-0000-4000-8000-000000000003',now()
    from page68_ids$$,
  '42501',null,'recipient cannot forge another staff members read receipt directly'
);

select set_config('request.jwt.claims','{"sub":"a6800000-0000-4000-8000-000000000003","role":"authenticated","aal":"aal2"}',true);
select ok(
  (select not replayed from public.mark_staff_announcement_read(
    'a6810000-0000-4000-8000-000000000001','a6820000-0000-4000-8000-000000000001',
    (select release_id from page68_ids),
    'a6870000-0000-4000-8000-000000000020')),
  'the same idempotency UUID is actor scoped and does not collide across recipients'
);

select set_config('request.jwt.claims','{"sub":"a6800000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2","session_id":"a6850000-0000-4000-8000-000000000001"}',true);
select results_eq(
  $$select jsonb_array_length(selected_recipients),
      (owner.item->>'recipient_count')::integer,
      (owner.item->>'read_count')::integer,
      (select count(*)::integer from jsonb_array_elements(selected_recipients) item where item.value->'read_at'<>'null'::jsonb),
      delivery_boundary collate "C",expiry_rule collate "C"
    from public.staff_announcement_management_snapshot(
      'a6810000-0000-4000-8000-000000000001','a6820000-0000-4000-8000-000000000001',
      (select release_id from page68_ids)) snapshot
    cross join lateral (
      select item from jsonb_array_elements(snapshot.announcements) item
      where item->>'active_release_version_id'=(select release_id::text from page68_ids)
    ) owner$$,
  $$values(2,2,2,2,'staff_portal_read_receipts_only'::text collate "C",'explicit_datetime_or_explicit_no_expiry'::text collate "C")$$,
  'single audited manager bundle proves aggregate and exact recipient read-detail parity'
);
reset role;
select is(
  (select count(*)::integer from public.audit_events where table_name='staff_announcement_management_snapshot'
    and organization_id='a6810000-0000-4000-8000-000000000001'
    and branch_id='a6820000-0000-4000-8000-000000000001'),
  2,'management and recipient snapshot reads are audited in the exact scope'
);
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"a6800000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2","session_id":"a6850000-0000-4000-8000-000000000001"}',true);

select ok(
  (select version=3 and previous_version_id=(select release_id from page68_ids)
  from public.create_staff_announcement_draft(
    'a6810000-0000-4000-8000-000000000001','a6820000-0000-4000-8000-000000000001',
    (select release_id from page68_ids),
    '員工公告新版','新內容',now()+interval '2 hours',null,
    array['a6800000-0000-4000-8000-000000000002']::uuid[],'{}'::uuid[],'更新發布內容',
    'a6870000-0000-4000-8000-000000000021')),
  'content change appends an immutable draft after the published version'
);
reset role;
update page68_ids set revision_id=(
  select id from public.staff_announcement_versions
  where announcement_key=(select announcement_key from page68_ids) and version=3
);
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"a6800000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2","session_id":"a6850000-0000-4000-8000-000000000001"}',true);
select throws_ok(
  $$select * from public.create_staff_announcement_draft(
    'a6810000-0000-4000-8000-000000000001','a6820000-0000-4000-8000-000000000001',
    (select release_id from page68_ids),
    '競態分支','內容',now()+interval '3 hours',null,array['a6800000-0000-4000-8000-000000000002']::uuid[],'{}'::uuid[],'錯誤分支',
    'a6870000-0000-4000-8000-000000000022')$$,
  '40001','announcement predecessor is no longer terminal','concurrent-style second fork from the same predecessor fails closed'
);

select ok(
  (select version=4
      and previous_version_id=(select revision_id from page68_ids)
      and withdrawn_release_version_id=(select release_id from page68_ids)
      and not replayed
  from public.withdraw_staff_announcement(
    'a6810000-0000-4000-8000-000000000001','a6820000-0000-4000-8000-000000000001',
    (select revision_id from page68_ids),
    (select release_id from page68_ids),
    '新版尚待確認，先撤回目前發布版','a6870000-0000-4000-8000-000000000023')),
  'withdrawal appends after a pending draft and requires the exact active release and reason'
);
reset role;
update page68_ids set withdrawal_id=(
  select id from public.staff_announcement_versions
  where announcement_key=(select announcement_key from page68_ids) and version=4
);
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"a6800000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2","session_id":"a6850000-0000-4000-8000-000000000001"}',true);
select ok(
  (select version=4 and replayed from public.withdraw_staff_announcement(
    'a6810000-0000-4000-8000-000000000001','a6820000-0000-4000-8000-000000000001',
    (select revision_id from page68_ids),
    (select release_id from page68_ids),
    '新版尚待確認，先撤回目前發布版','a6870000-0000-4000-8000-000000000023')),
  'exact withdrawal replay executes only once and returns replayed true'
);
reset role;
select is(
  (select withdrawal_reason from public.staff_announcement_versions where announcement_key=(select announcement_key from page68_ids) and version=4),
  '新版尚待確認，先撤回目前發布版','withdrawal reason is frozen on the immutable withdrawal version'
);
select throws_ok(
  $$update public.staff_announcement_versions set title='覆寫' where announcement_key=(select announcement_key from page68_ids) and version=2$$,
  '55000','staff announcement history is immutable','published content cannot be overwritten'
);
select throws_ok(
  $$delete from public.staff_announcement_recipients where release_version_id=(select release_id from page68_ids)$$,
  '55000','staff announcement history is immutable','frozen recipient snapshot cannot be deleted'
);
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"a6800000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2","session_id":"a6850000-0000-4000-8000-000000000001"}',true);
select results_eq(
  $$select (owner.item->>'lifecycle') collate "C",
      (owner.item->>'read_count')::integer,jsonb_array_length(selected_recipients)
    from public.staff_announcement_management_snapshot(
      'a6810000-0000-4000-8000-000000000001','a6820000-0000-4000-8000-000000000001',
      (select release_id from page68_ids)) snapshot
    cross join lateral (
      select item from jsonb_array_elements(snapshot.announcements) item
      where item->>'active_release_version_id'=(select release_id::text from page68_ids)
    ) owner$$,
  $$values('withdrawn'::text collate "C",2,2)$$,
  'withdrawn lifecycle preserves historical actual read totals and recipient detail without claiming delivery'
);

select set_config('request.jwt.claims','{"sub":"a6800000-0000-4000-8000-000000000002","role":"authenticated","aal":"aal2"}',true);
select is(
  (select jsonb_array_length(announcements) from public.staff_announcement_management_snapshot(
    'a6810000-0000-4000-8000-000000000001','a6820000-0000-4000-8000-000000000001',null)),
  0,'withdrawn publication disappears from ordinary recipient view'
);
reset role;
select set_config('request.jwt.claims','{}',true);
update public.profiles set is_active=false where id='a6800000-0000-4000-8000-000000000002';
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"a6800000-0000-4000-8000-000000000002","role":"authenticated","aal":"aal2"}',true);
select throws_ok(
  $$select * from public.mark_staff_announcement_read(
    'a6810000-0000-4000-8000-000000000001','a6820000-0000-4000-8000-000000000001',
    (select release_id from page68_ids),
    'a6870000-0000-4000-8000-000000000020')$$,
  '42501','announcement read receipt is not permitted','exact read replay still requires current active actor authority'
);

select set_config('request.jwt.claims','{"sub":"a6800000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2","session_id":"a6850000-0000-4000-8000-000000000099"}',true);
select throws_ok(
  $$select * from public.withdraw_staff_announcement(
    'a6810000-0000-4000-8000-000000000001','a6820000-0000-4000-8000-000000000001',
    (select revision_id from page68_ids),
    (select release_id from page68_ids),
    '新版尚待確認，先撤回目前發布版','a6870000-0000-4000-8000-000000000023')$$,
  '42501','recent announcement AAL2 evidence is required','exact withdrawal replay still requires fresh same-session AAL2'
);

reset role;
select is(
  (select count(*)::integer from public.staff_announcement_versions where announcement_key=(select announcement_key from page68_ids)),
  4,'lineage contains exactly draft, release, pending draft, and withdrawal versions'
);
select is(
  (select count(*)::integer from public.staff_announcement_read_receipts where release_version_id=(
    select release_id from page68_ids
  )),2,'read totals come only from two actual immutable recipient receipts'
);
select is(
  (select count(*)::integer from private.staff_announcement_operations where result_announcement_key=(select announcement_key from page68_ids)),
  6,'actor-scoped ledger stores exactly first draft, publish, two reads, revision, and withdrawal operations'
);
select ok(
  (select bool_and(content_hash ~ '^[a-f0-9]{64}$') from public.staff_announcement_versions where announcement_key=(select announcement_key from page68_ids))
  and (select count(*)::integer from public.staff_announcement_versions where announcement_key=(select announcement_key from page68_ids) and action_reauth_challenge_id is not null)=2,
  'all versions have hashes while only publish and withdrawal freeze immutable AAL2 evidence'
);
select ok(
  (select count(*)::integer from public.audit_events where table_name in (
    'public.staff_announcement_versions','public.staff_announcement_recipients','public.staff_announcement_read_receipts'
  ) and organization_id='a6810000-0000-4000-8000-000000000001') >= 10,
  'version, recipient and actual-read writes generate scoped audit events'
);

select * from finish();
rollback;
