begin;

select plan(51);

select results_eq(
  $$select permission_key collate "C" from public.permissions
    where permission_key like 'complaints.%' order by permission_key collate "C"$$,
  $$values ('complaints.close'::text collate "C"),
    ('complaints.manage'::text collate "C"),
    ('complaints.read'::text collate "C"),
    ('complaints.sensitive'::text collate "C")$$,
  'Page 56 exposes four narrow complaint permissions'
);

select ok(
  exists(select 1 from public.role_permissions rp
    join public.roles r on r.id=rp.role_id
    join public.permissions p on p.id=rp.permission_id
    where r.role_key='case_manager_social_worker' and p.permission_key='complaints.manage')
  and not exists(select 1 from public.role_permissions rp
    join public.roles r on r.id=rp.role_id
    join public.permissions p on p.id=rp.permission_id
    where r.role_key='case_manager_social_worker'
      and p.permission_key in ('complaints.sensitive','complaints.close')),
  'ordinary case managers can process but cannot read sensitive text or close'
);

select is((select count(*)::integer from pg_class where oid in (
  'public.feedback_complaint_cases'::regclass,
  'public.feedback_complaint_events'::regclass
) and relrowsecurity and relforcerowsecurity),2,
  'both browser-visible immutable stores force RLS');

select ok(
  not has_table_privilege('authenticated','public.feedback_complaint_cases','select,insert,update,delete')
  and not has_table_privilege('authenticated','public.feedback_complaint_events','select,insert,update,delete')
  and not has_table_privilege('service_role','private.feedback_complaint_sensitive_versions','select')
  and not has_table_privilege('service_role','private.feedback_complaint_operations','select'),
  'browser roles cannot bypass audited RPCs and private stores have no service bypass grant'
);

select ok(
  has_function_privilege('authenticated',
    'public.submit_feedback_complaint(uuid,uuid,uuid,timestamptz,text,text,text,text,uuid)','execute')
  and has_function_privilege('authenticated',
    'public.append_feedback_complaint_event(uuid,uuid,text,uuid,integer,uuid,text,uuid,text,text,text,text,text,text,uuid)','execute')
  and has_function_privilege('authenticated',
    'public.feedback_complaint_snapshot(uuid,uuid,date,date,text,text,text,text,text,text)','execute')
  and not has_function_privilege('anon',
    'public.submit_feedback_complaint(uuid,uuid,uuid,timestamptz,text,text,text,text,uuid)','execute')
  and not has_function_privilege('service_role',
    'public.feedback_complaint_snapshot(uuid,uuid,date,date,text,text,text,text,text,text)','execute'),
  'only authenticated callers receive the narrow Page-56 RPC surface'
);

select ok(
  not (select prosecdef from pg_proc where oid=
    'public.submit_feedback_complaint(uuid,uuid,uuid,timestamptz,text,text,text,text,uuid)'::regprocedure)
  and not (select prosecdef from pg_proc where oid=
    'public.append_feedback_complaint_event(uuid,uuid,text,uuid,integer,uuid,text,uuid,text,text,text,text,text,text,uuid)'::regprocedure)
  and not (select prosecdef from pg_proc where oid=
    'public.feedback_complaint_snapshot(uuid,uuid,date,date,text,text,text,text,text,text)'::regprocedure)
  and (select prosecdef and coalesce(proconfig,'{}'::text[]) @> array['search_path=""']
    from pg_proc where oid=
    'private.submit_feedback_complaint_guarded(uuid,uuid,uuid,timestamptz,text,text,text,text,uuid)'::regprocedure)
  and (select prosecdef and coalesce(proconfig,'{}'::text[]) @> array['search_path=""']
    from pg_proc where oid=
    'private.append_feedback_complaint_event_guarded(uuid,uuid,text,uuid,integer,uuid,text,uuid,text,text,text,text,text,text,uuid)'::regprocedure),
  'public wrappers are invokers while guarded definers pin an empty search path'
);

select is((select count(*)::integer from pg_trigger where not tgisinternal and tgname in (
  'feedback_deadline_rules_append_only','feedback_complaint_cases_append_only',
  'feedback_complaint_events_append_only','feedback_sensitive_versions_append_only',
  'feedback_event_details_append_only','feedback_operations_append_only'
)),6,'all Page-56 evidence stores reject update and delete');

select is((select count(*)::integer from pg_trigger where not tgisinternal and tgname in (
  'feedback_deadline_rules_audit_row_change','feedback_complaint_cases_audit_row_change',
  'feedback_complaint_events_audit_row_change','feedback_sensitive_versions_audit_row_change',
  'feedback_event_details_audit_row_change','feedback_operations_audit_row_change'
)),6,'all Page-56 inserts have exact row audit triggers');

select ok(
  exists(select 1 from pg_indexes where schemaname='private'
    and tablename='feedback_complaint_operations'
    and indexdef ~ 'actor_user_id, idempotency_key')
  and exists(select 1 from pg_indexes where schemaname='public'
    and tablename='feedback_complaint_events'
    and indexdef ~ 'organization_id, branch_id, case_id, version DESC'),
  'idempotency and current-chain lookups are indexed');

select is((select count(*)::integer from private.feedback_deadline_rule_versions),0,
  'migration seeds no unapproved production deadline rule');

-- Synthetic identities and case content only.
insert into auth.users(instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,
  raw_app_meta_data,raw_user_meta_data,created_at,updated_at) values
  ('00000000-0000-0000-0000-000000000000','56010000-0000-4000-8000-000000000001','authenticated','authenticated','page56-manager-a@example.invalid','',now(),'{}','{}',now(),now()),
  ('00000000-0000-0000-8000-000000000000','56010000-0000-4000-8000-000000000002','authenticated','authenticated','page56-social-a@example.invalid','',now(),'{}','{}',now(),now()),
  ('00000000-0000-0000-8000-000000000000','56010000-0000-4000-8000-000000000003','authenticated','authenticated','page56-manager-b@example.invalid','',now(),'{}','{}',now(),now());
insert into public.organizations(id,code,name) values
  ('56020000-0000-4000-8000-000000000001','page56_a','申訴合成機構甲'),
  ('56020000-0000-4000-8000-000000000002','page56_b','申訴合成機構乙');
insert into public.branches(id,organization_id,code,name) values
  ('56030000-0000-4000-8000-000000000001','56020000-0000-4000-8000-000000000001','main','申訴合成分支甲'),
  ('56030000-0000-4000-8000-000000000002','56020000-0000-4000-8000-000000000002','main','申訴合成分支乙');
insert into public.profiles(id,display_name,kind,employee_code) values
  ('56010000-0000-4000-8000-000000000001','合成申訴主管甲','staff','P56-A'),
  ('56010000-0000-4000-8000-000000000002','合成社工甲','staff','P56-S'),
  ('56010000-0000-4000-8000-000000000003','合成申訴主管乙','staff','P56-B');
insert into public.memberships(id,organization_id,branch_id,profile_id,status,starts_at) values
  ('56040000-0000-4000-8000-000000000001','56020000-0000-4000-8000-000000000001','56030000-0000-4000-8000-000000000001','56010000-0000-4000-8000-000000000001','active',now()-interval '1 year'),
  ('56040000-0000-4000-8000-000000000002','56020000-0000-4000-8000-000000000001','56030000-0000-4000-8000-000000000001','56010000-0000-4000-8000-000000000002','active',now()-interval '1 year'),
  ('56040000-0000-4000-8000-000000000003','56020000-0000-4000-8000-000000000002','56030000-0000-4000-8000-000000000002','56010000-0000-4000-8000-000000000003','active',now()-interval '1 year');
insert into public.membership_roles(membership_id,role_id)
select membership_id, role.id from (values
  ('56040000-0000-4000-8000-000000000001'::uuid,'branch_supervisor'),
  ('56040000-0000-4000-8000-000000000002'::uuid,'case_manager_social_worker'),
  ('56040000-0000-4000-8000-000000000003'::uuid,'branch_supervisor')
) chosen(membership_id,role_key)
join public.roles role on role.organization_id is null and role.role_key=chosen.role_key;

insert into private.reauth_challenges(id,user_id,session_id,nonce_sha256,idempotency_key,
  issued_jwt_iat,created_at,expires_at,consumed_at,consumed_jwt_iat,
  factor_method,factor_verified_at) values
  ('56050000-0000-4000-8000-000000000001','56010000-0000-4000-8000-000000000001','56051000-0000-4000-8000-000000000001',repeat('a',64),'56052000-0000-4000-8000-000000000001',now()-interval '2 minutes',now()-interval '2 minutes',now()+interval '5 minutes',now()-interval '30 seconds',now()-interval '30 seconds','totp',now()-interval '30 seconds');
insert into private.reauth_events(user_id,session_id,challenge_id,aal,verification_method,verified_at) values
  ('56010000-0000-4000-8000-000000000001','56051000-0000-4000-8000-000000000001','56050000-0000-4000-8000-000000000001','aal2','totp',now()-interval '30 seconds');

insert into private.feedback_deadline_rule_versions(
  id,organization_id,branch_id,label,source,case_type,risk,response_hours,
  effective_from,effective_through,published_at,retired_at,created_by
) values
  ('56060000-0000-4000-8000-000000000001','56020000-0000-4000-8000-000000000001','56030000-0000-4000-8000-000000000001','合成家屬服務 48 小時','family','service','standard',48,current_date-1,null,now()-interval '1 day',null,'56010000-0000-4000-8000-000000000001'),
  ('56060000-0000-4000-8000-000000000002','56020000-0000-4000-8000-000000000001','56030000-0000-4000-8000-000000000001','合成家屬安全高風險 48 小時','family','safety','high',48,current_date-1,null,now()-interval '1 day',null,'56010000-0000-4000-8000-000000000001'),
  ('56060000-0000-4000-8000-000000000003','56020000-0000-4000-8000-000000000001','56030000-0000-4000-8000-000000000001','合成匿名意見 1 小時','anonymous','feedback','standard',1,current_date-1,null,now()-interval '1 day',null,'56010000-0000-4000-8000-000000000001');

set local role authenticated;
select set_config('request.jwt.claims','{"sub":"56010000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal1","session_id":"56051000-0000-4000-8000-000000000001"}',true);

select throws_ok($$select * from public.submit_feedback_complaint(
  '56020000-0000-4000-8000-000000000001','56030000-0000-4000-8000-000000000001',
  '56060000-0000-4000-8000-000000000001',now()-interval '1 hour','合成陳述人',
  'feedback@example.invalid','合成主旨','合成案件內容','56070000-0000-4000-8000-000000000001')$$,
  '42501','feedback complaint intake is not permitted',
  'AAL1 cannot intake a complaint');

select set_config('request.jwt.claims','{"sub":"56010000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2","session_id":"56051000-0000-4000-8000-000000000001"}',true);

select throws_ok($$select * from public.submit_feedback_complaint(
  '56020000-0000-4000-8000-000000000002','56030000-0000-4000-8000-000000000002',
  '56060000-0000-4000-8000-000000000001',now()-interval '1 hour',null,null,
  '跨範圍主旨','跨範圍內容','56070000-0000-4000-8000-000000000002')$$,
  '42501','feedback complaint intake is not permitted',
  'cross-tenant scope is rejected before rule or content use');

select throws_ok($$select * from public.submit_feedback_complaint(
  '56020000-0000-4000-8000-000000000001','56030000-0000-4000-8000-000000000001',
  '56060000-0000-4000-8000-000000000099',now()-interval '1 hour',null,null,
  '無規則主旨','無規則內容','56070000-0000-4000-8000-000000000003')$$,
  '23514','an exact published feedback deadline rule is required',
  'intake fails closed without the selected exact published rule');

select throws_ok($$select * from public.feedback_complaint_snapshot(
  '56020000-0000-4000-8000-000000000001','56030000-0000-4000-8000-000000000001',
  null,null,'all','all','all','all','invalid-status',null)$$,
  '22023','feedback complaint snapshot filters are invalid',
  'database snapshot independently validates strict filters');

create temporary table page56_main_create as select * from public.submit_feedback_complaint(
  '56020000-0000-4000-8000-000000000001','56030000-0000-4000-8000-000000000001',
  '56060000-0000-4000-8000-000000000001',now()-interval '1 hour','合成陳述人甲',
  'page56-contact@example.invalid','主要合成主旨','主要合成案件內容',
  '56070000-0000-4000-8000-000000000010');

select ok((select not replayed and action='create' and version=1 and status='received'
  and effective_risk='standard' from page56_main_create),
  'configured intake returns a correlated first immutable receipt');

reset role;
select ok((select case_number ~ '^FC-[0-9]{8}-[A-F0-9]{8}$'
  and due_at > now()+interval '46 hours' and due_at < now()+interval '48 hours'
  from page56_main_create)
  and exists(select 1 from public.feedback_complaint_cases complaint
    where complaint.id=(select case_id from page56_main_create)
      and complaint.source='family' and complaint.case_type='service'
      and complaint.deadline_rule_id='56060000-0000-4000-8000-000000000001'),
  'server generates the unique number and locks source, type, risk, rule and deadline');
set local role authenticated;

select ok((select replayed and case_id=(select case_id from page56_main_create)
  and event_id=(select event_id from page56_main_create)
  from public.submit_feedback_complaint(
    '56020000-0000-4000-8000-000000000001','56030000-0000-4000-8000-000000000001',
    '56060000-0000-4000-8000-000000000001',
    now()-interval '1 hour',
    '合成陳述人甲','page56-contact@example.invalid','主要合成主旨','主要合成案件內容',
    '56070000-0000-4000-8000-000000000010')),
  'an exact retry returns the original case and event');

select throws_ok($$select * from public.submit_feedback_complaint(
  '56020000-0000-4000-8000-000000000001','56030000-0000-4000-8000-000000000001',
  '56060000-0000-4000-8000-000000000001',
  now()-interval '1 hour',
  '合成陳述人甲',null,'變更後主旨','主要合成案件內容',
  '56070000-0000-4000-8000-000000000010')$$,
  '23505','feedback complaint idempotency key reused with different content',
  'a changed intake cannot reuse the same actor key');

reset role;
select ok(
  (select count(*)=1 from public.feedback_complaint_events
    where case_id=(select case_id from page56_main_create))
  and (select count(*)=1 from private.feedback_complaint_sensitive_versions
    where case_id=(select case_id from page56_main_create))
  and (select count(*)=1 from private.feedback_complaint_operations
    where case_id=(select case_id from page56_main_create)),
  'first intake commits one case event, one sensitive version and one operation receipt');

select ok((select count(*) >= 4 from public.audit_events
  where organization_id='56020000-0000-4000-8000-000000000001'
    and table_name in ('public.feedback_complaint_cases','public.feedback_complaint_events',
      'private.feedback_complaint_sensitive_versions','private.feedback_complaint_operations')),
  'intake writes row-level audit evidence for every committed store');

set local role authenticated;

select throws_ok($$select * from public.append_feedback_complaint_event(
  '56020000-0000-4000-8000-000000000001','56030000-0000-4000-8000-000000000001','assign',
  (select case_id from page56_main_create),2,'56040000-0000-4000-8000-000000000002','合成指派',
  null,null,null,null,null,null,null,'56070000-0000-4000-8000-000000000011')$$,
  '40001','feedback complaint expected version is stale',
  'a stale expected version cannot append an assignment');

select throws_ok($$select * from public.append_feedback_complaint_event(
  '56020000-0000-4000-8000-000000000001','56030000-0000-4000-8000-000000000001','assign',
  (select case_id from page56_main_create),1,'56040000-0000-4000-8000-000000000003','跨範圍承辦',
  null,null,null,null,null,null,null,'56070000-0000-4000-8000-000000000012')$$,
  '23514','feedback complaint assignee is not active and authorized',
  'an assignee outside the tenant cannot be attached');

create temporary table page56_assign as select * from public.append_feedback_complaint_event(
  '56020000-0000-4000-8000-000000000001','56030000-0000-4000-8000-000000000001','assign',
  (select case_id from page56_main_create),1,'56040000-0000-4000-8000-000000000002','合成指派理由',
  null,null,null,null,null,null,null,'56070000-0000-4000-8000-000000000013');

reset role;
select ok((select not replayed and version=2 and status='assigned' from page56_assign)
  and exists(select 1 from public.feedback_complaint_events event
    where event.id=(select event_id from page56_assign)
      and event.assignee_membership_id='56040000-0000-4000-8000-000000000002'),
  'assignment appends version two with the authorized assignee');
set local role authenticated;

select ok((select replayed and event_id=(select event_id from page56_assign)
  from public.append_feedback_complaint_event(
    '56020000-0000-4000-8000-000000000001','56030000-0000-4000-8000-000000000001','assign',
    (select case_id from page56_main_create),1,'56040000-0000-4000-8000-000000000002','合成指派理由',
    null,null,null,null,null,null,null,'56070000-0000-4000-8000-000000000013')),
  'assignment replay works even though the current chain version advanced');

create temporary table page56_progress as select * from public.append_feedback_complaint_event(
  '56020000-0000-4000-8000-000000000001','56030000-0000-4000-8000-000000000001','progress',
  (select case_id from page56_main_create),2,null,'合成處理進度與證據',
  null,null,null,null,null,null,null,'56070000-0000-4000-8000-000000000014');

select ok((select not replayed and version=3 and status='in_progress' from page56_progress),
  'progress appends version three with an in-progress state');

reset role;
select ok(exists(select 1 from public.feedback_complaint_events event
  join private.feedback_complaint_event_details detail on detail.event_id=event.id
  where event.id=(select event_id from page56_progress)
    and event.assignee_membership_id='56040000-0000-4000-8000-000000000002'
    and detail.note='合成處理進度與證據'),
  'progress carries the assignee and preserves its narrative in a private detail');
set local role authenticated;

select set_config('request.jwt.claims','{"sub":"56010000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2","session_id":"56051000-0000-4000-8000-000000000099"}',true);
select throws_ok($$select * from public.append_feedback_complaint_event(
  '56020000-0000-4000-8000-000000000001','56030000-0000-4000-8000-000000000001','correct',
  (select case_id from page56_main_create),3,null,null,(select event_id from page56_progress),
  '合成更正理由','合成陳述人甲',null,'更正主旨','更正完整內容',null,
  '56070000-0000-4000-8000-000000000015')$$,
  '42501','recent same-session AAL2 is required',
  'correction rejects AAL2 evidence from another session');

select set_config('request.jwt.claims','{"sub":"56010000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2","session_id":"56051000-0000-4000-8000-000000000001"}',true);
select throws_ok($$select * from public.append_feedback_complaint_event(
  '56020000-0000-4000-8000-000000000001','56030000-0000-4000-8000-000000000001','correct',
  (select case_id from page56_main_create),3,null,null,'56090000-0000-4000-8000-000000000099',
  '合成更正理由','合成陳述人甲',null,'更正主旨','更正完整內容',null,
  '56070000-0000-4000-8000-000000000016')$$,
  '23514','feedback complaint correction target is invalid',
  'a correction must reference an event in the same case');

create temporary table page56_correction as select * from public.append_feedback_complaint_event(
  '56020000-0000-4000-8000-000000000001','56030000-0000-4000-8000-000000000001','correct',
  (select case_id from page56_main_create),3,null,null,(select event_id from page56_progress),
  '合成更正理由','合成陳述人甲',null,'更正後合成主旨','更正後完整合成內容',null,
  '56070000-0000-4000-8000-000000000017');

reset role;
select ok((select not replayed and version=4 from page56_correction)
  and exists(select 1 from public.feedback_complaint_events event
    where event.id=(select event_id from page56_correction)
      and event.event_type='correction'
      and event.corrected_event_id=(select event_id from page56_progress)),
  'correction appends an event linked to its exact target');

select ok((select count(*)=2 and min(version)=1 and max(version)=2
  and count(distinct subject)=2
  from private.feedback_complaint_sensitive_versions
  where case_id=(select case_id from page56_main_create)),
  'correction preserves the original sensitive content and adds a full new version');
set local role authenticated;

create temporary table page56_sensitive_snapshot as select * from public.feedback_complaint_snapshot(
  '56020000-0000-4000-8000-000000000001','56030000-0000-4000-8000-000000000001',
  null,null,'all','all','all','all','all',null);
select ok((select can_view_sensitive and deadline_rule_status='configured'
  and escalation_evaluation_status='server_clock'
  and escalation_delivery_status='not_configured' and export_status='not_configured'
  and exists(select 1 from jsonb_array_elements(items) item
    where item->>'case_number'=(select case_number from page56_main_create)
      and item->>'subject'='更正後合成主旨'
      and (item->>'sensitive_masked')::boolean=false
      and (item->>'chain_version')::integer=4
      and jsonb_array_length(item->'timeline')=4)
  from page56_sensitive_snapshot),
  'authorized snapshot exposes only the latest sensitive version plus the immutable chain and honest boundaries');

select set_config('request.jwt.claims','{"sub":"56010000-0000-4000-8000-000000000002","role":"authenticated","aal":"aal2","session_id":"56051000-0000-4000-8000-000000000002"}',true);
create temporary table page56_masked_snapshot as select * from public.feedback_complaint_snapshot(
  '56020000-0000-4000-8000-000000000001','56030000-0000-4000-8000-000000000001',
  null,null,'all','all','all','all','all',null);
select ok((select not can_view_sensitive and jsonb_array_length(items)=1
  and not exists(select 1 from jsonb_array_elements(items) item
    where (item->>'sensitive_masked')::boolean=false or item->>'subject' is not null
      or item->>'reporter_contact' is not null)
  and not exists(select 1 from jsonb_array_elements(items) item,
    lateral jsonb_array_elements(item->'timeline') event
    where event->>'note' is not null or (event->>'sensitive_masked')::boolean=false)
  from page56_masked_snapshot),
  'case manager snapshot masks case content and every event detail in the database');

select is((select matching_total::integer from public.feedback_complaint_snapshot(
  '56020000-0000-4000-8000-000000000001','56030000-0000-4000-8000-000000000001',
  null,null,'all','all','all','all','all','更正後合成主旨')),0,
  'masked users cannot search secret subject text');

select is((select matching_total::integer from public.feedback_complaint_snapshot(
  '56020000-0000-4000-8000-000000000001','56030000-0000-4000-8000-000000000001',
  null,null,'all','all','all','all','all',(select case_number from page56_main_create))),1,
  'masked users can still search non-sensitive case numbers');

select throws_ok($$select * from public.feedback_complaint_cases$$,
  '42501',null,
  'case managers cannot bypass the audited snapshot through Data API tables');

select set_config('request.jwt.claims','{"sub":"56010000-0000-4000-8000-000000000003","role":"authenticated","aal":"aal2","session_id":"56051000-0000-4000-8000-000000000003"}',true);
select throws_ok($$select * from public.feedback_complaint_events$$,
  '42501',null,'another tenant also receives no direct event-table access');

select throws_ok($$select * from public.feedback_complaint_snapshot(
  '56020000-0000-4000-8000-000000000001','56030000-0000-4000-8000-000000000001',
  null,null,'all','all','all','all','all',null)$$,
  '42501','feedback complaint snapshot is not permitted',
  'another tenant cannot ask the RPC for the first tenant snapshot');

select set_config('request.jwt.claims','{"sub":"56010000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2","session_id":"56051000-0000-4000-8000-000000000099"}',true);
select throws_ok($$select * from public.append_feedback_complaint_event(
  '56020000-0000-4000-8000-000000000001','56030000-0000-4000-8000-000000000001','close',
  (select case_id from page56_main_create),4,null,null,null,null,null,null,null,null,
  '合成結案結果','56070000-0000-4000-8000-000000000018')$$,
  '42501','recent same-session AAL2 is required',
  'close rejects missing recent same-session AAL2 evidence');

select set_config('request.jwt.claims','{"sub":"56010000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2","session_id":"56051000-0000-4000-8000-000000000001"}',true);
create temporary table page56_close as select * from public.append_feedback_complaint_event(
  '56020000-0000-4000-8000-000000000001','56030000-0000-4000-8000-000000000001','close',
  (select case_id from page56_main_create),4,null,null,null,null,null,null,null,null,
  '合成結案結果與回覆證據','56070000-0000-4000-8000-000000000019');
select ok((select not replayed and version=5 and status='closed' from page56_close),
  'authorized close appends a terminal version-five event');

select ok((select replayed and event_id=(select event_id from page56_close)
  from public.append_feedback_complaint_event(
    '56020000-0000-4000-8000-000000000001','56030000-0000-4000-8000-000000000001','close',
    (select case_id from page56_main_create),4,null,null,null,null,null,null,null,null,
    '合成結案結果與回覆證據','56070000-0000-4000-8000-000000000019')),
  'exact close retry returns the terminal receipt without a second event');

select throws_ok($$select * from public.append_feedback_complaint_event(
  '56020000-0000-4000-8000-000000000001','56030000-0000-4000-8000-000000000001','progress',
  (select case_id from page56_main_create),5,null,'結案後不得追加',null,null,null,null,null,null,null,
  '56070000-0000-4000-8000-000000000020')$$,
  '23514','closed feedback complaint cannot be extended',
  'a terminal chain cannot be extended');

reset role;
select ok((select count(*)=5 and count(distinct version)=5 and min(version)=1 and max(version)=5
  from public.feedback_complaint_events where case_id=(select case_id from page56_main_create))
  and exists(select 1 from public.feedback_complaint_events
    where id=(select event_id from page56_progress) and event_type='progress'),
  'the complete immutable event chain remains present after correction and close');
set local role authenticated;

select throws_ok($$update public.feedback_complaint_cases set case_number='FC-20000101-DEADBEEF'
  where id=(select case_id from page56_main_create)$$,
  '42501',null,'authenticated users cannot update immutable case identity directly');

create temporary table page56_high_create as select * from public.submit_feedback_complaint(
  '56020000-0000-4000-8000-000000000001','56030000-0000-4000-8000-000000000001',
  '56060000-0000-4000-8000-000000000002',now()-interval '30 minutes',null,null,
  '高風險合成主旨','高風險合成內容','56070000-0000-4000-8000-000000000021');
reset role;
select ok((select status='escalated' and effective_risk='high' from page56_high_create)
  and exists(select 1 from public.feedback_complaint_events event
    where event.id=(select event_id from page56_high_create)
      and event.automatic_reason='high_risk'),
  'high-risk intake is escalated by the database immediately');
set local role authenticated;

create temporary table page56_overdue_create as select * from public.submit_feedback_complaint(
  '56020000-0000-4000-8000-000000000001','56030000-0000-4000-8000-000000000001',
  '56060000-0000-4000-8000-000000000003',now()-interval '2 hours',null,null,
  '逾期合成主旨','逾期合成內容','56070000-0000-4000-8000-000000000022');
reset role;
select ok((select status='escalated' and effective_risk='high' and due_at < now()
  from page56_overdue_create)
  and exists(select 1 from public.feedback_complaint_events event
    where event.id=(select event_id from page56_overdue_create)
      and event.automatic_reason='overdue'),
  'past server-derived deadline escalates intake without a client override');
set local role authenticated;

create temporary table page56_final_snapshot as select * from public.feedback_complaint_snapshot(
  '56020000-0000-4000-8000-000000000001','56030000-0000-4000-8000-000000000001',
  null,null,'all','all','all','all','all',null);
select ok((select case_total=3 and high_risk_total=2 and in_progress_total=2
  and overdue_total=1 from page56_final_snapshot),
  'snapshot metrics reconcile closed, high-risk and overdue cases on the same filtered set');

select ok((select not (item->>'overdue')::boolean
  and item->>'status'='closed' and item->>'escalation_reason' is null
  from page56_final_snapshot,
  lateral jsonb_array_elements(items) item
  where item->>'case_number'=(select case_number from page56_main_create)),
  'closed cases never become overdue again in the current projection');

reset role;

select ok((select count(*) >= 5 from public.audit_events
  where organization_id='56020000-0000-4000-8000-000000000001'
    and table_name='public.feedback_complaint_snapshot'
    and action='select'
    and metadata->>'page'='56'),
  'each snapshot read leaves Page-56 permission and query audit evidence');

select ok((select count(*)=3 from private.feedback_complaint_operations
  where case_id=(select case_id from page56_main_create)
    and action in ('assign','progress','correct'))
  and (select count(*)=1 from private.feedback_complaint_operations
    where case_id=(select case_id from page56_main_create) and action='close'),
  'every successful mutation has one immutable actor-scoped operation receipt');

select ok(not exists(select 1 from private.feedback_complaint_event_details detail
  join public.feedback_complaint_events event on event.id=detail.event_id
  where event.case_id=(select case_id from page56_main_create) and btrim(detail.note)=''),
  'private narratives never store empty placeholder evidence');
set local role authenticated;

select throws_ok($$select * from public.feedback_complaint_snapshot(
  '56020000-0000-4000-8000-000000000001','56030000-0000-4000-8000-000000000001',
  null,null,'all','all','all','not-a-uuid','all',null)$$,
  '22023','feedback complaint assignee filter is invalid',
  'database rejects malformed assignee UUID filters');

select * from finish();
rollback;
