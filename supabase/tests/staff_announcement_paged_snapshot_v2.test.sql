begin;
select plan(68);
set local time zone 'Asia/Taipei';
-- Synthetic identities, actual admission and same-session MFA evidence. No
-- business/admission function is replaced, including by the portable runner.
select set_config('test.announcement_oauth',floor(extract(epoch from clock_timestamp()-interval '2 minutes'))::text,true);
select set_config('test.announcement_totp',floor(extract(epoch from clock_timestamp()-interval '30 seconds'))::text,true);
insert into auth.users(id,aud,role,email,email_confirmed_at,created_at,updated_at)
select ('db100000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'authenticated','authenticated',
  'announcement-'||n||'@announcements.example.invalid',now()-interval '1 day',now()-interval '1 day',now()
from generate_series(1,3)n;
insert into auth.identities(id,provider_id,user_id,identity_data,provider)
select ('db200000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'synthetic-announcement-google-'||n,
  ('db100000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,
  jsonb_build_object('sub','synthetic-announcement-google-'||n,'email','announcement-'||n||'@announcements.example.invalid',
    'email_verified',true,'hd','announcements.example.invalid'),'google' from generate_series(1,3)n;
insert into auth.sessions(id,user_id,created_at,aal)
select ('db300000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,
  ('db100000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,now()-interval '3 minutes','aal2' from generate_series(1,3)n;
insert into auth.mfa_amr_claims(id,session_id,created_at,updated_at,authentication_method)
select ('db400000-0000-4000-8000-'||lpad((n*10+m)::text,12,'0'))::uuid,
  ('db300000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,
  to_timestamp(current_setting(case m when 1 then 'test.announcement_oauth' else 'test.announcement_totp' end)::bigint),
  to_timestamp(current_setting(case m when 1 then 'test.announcement_oauth' else 'test.announcement_totp' end)::bigint),
  case m when 1 then 'oauth' else 'totp' end from generate_series(1,3)n cross join generate_series(1,2)m;
insert into public.organizations(id,code,name) values
 ('db500000-0000-4000-8000-000000000001','synthetic_announcements','Synthetic announcements'),
 ('db500000-0000-4000-8000-000000000002','synthetic_other_announcements','Synthetic other announcements');
insert into public.branches(id,organization_id,code,name) values
 ('db600000-0000-4000-8000-000000000001','db500000-0000-4000-8000-000000000001','main','Synthetic main'),
 ('db600000-0000-4000-8000-000000000002','db500000-0000-4000-8000-000000000001','second','Synthetic second'),
 ('db600000-0000-4000-8000-000000000003','db500000-0000-4000-8000-000000000002','other','Synthetic other');
insert into public.profiles(id,display_name,kind)
select ('db100000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'Synthetic announcement actor '||n,'staff' from generate_series(1,3)n;
insert into public.memberships(id,organization_id,branch_id,profile_id,status,starts_at)
select ('db700000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,
  case n when 3 then 'db500000-0000-4000-8000-000000000002'::uuid else 'db500000-0000-4000-8000-000000000001'::uuid end,
  case n when 3 then 'db600000-0000-4000-8000-000000000003'::uuid else 'db600000-0000-4000-8000-000000000001'::uuid end,
  ('db100000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'active',now()-interval '1 day' from generate_series(1,3)n;
insert into public.membership_roles(membership_id,role_id)
select m.id,r.id from public.memberships m cross join public.roles r
where m.id::text like 'db700000-%' and r.is_system
  and r.role_key=case when m.profile_id='db100000-0000-4000-8000-000000000002' then 'care_worker' else 'branch_supervisor' end;
insert into private.executive_access_policy(allowed_user_id,allowed_email,google_subject,enabled,approval_reference)
values('db100000-0000-4000-8000-000000000001','announcement-1@announcements.example.invalid',
 'synthetic-announcement-google-1',true,'Synthetic isolated announcement test approval');
insert into private.reauth_challenges(id,user_id,session_id,nonce_sha256,idempotency_key,issued_jwt_iat,
 created_at,expires_at,consumed_at,consumed_jwt_iat,factor_method,factor_verified_at)
values('db800000-0000-4000-8000-000000000001','db100000-0000-4000-8000-000000000001',
 'db300000-0000-4000-8000-000000000001',repeat('a',64),'db900000-0000-4000-8000-000000000001',now()-interval '2 minutes',
 now()-interval '1 minute',now()+interval '4 minutes',to_timestamp(current_setting('test.announcement_totp')::bigint),
 to_timestamp(current_setting('test.announcement_totp')::bigint),'totp',to_timestamp(current_setting('test.announcement_totp')::bigint));
insert into private.reauth_events(user_id,session_id,challenge_id,aal,verification_method,verified_at)
values('db100000-0000-4000-8000-000000000001','db300000-0000-4000-8000-000000000001',
 'db800000-0000-4000-8000-000000000001','aal2','totp',to_timestamp(current_setting('test.announcement_totp')::bigint));

create function pg_temp.announcement_login(p_n integer default 1,p_aal text default 'aal2') returns void language plpgsql as $$begin
 perform set_config('request.jwt.claim.sub','',true);perform set_config('request.jwt.claim.role','',true);
 perform set_config('request.jwt.claims',jsonb_build_object('sub','db100000-0000-4000-8000-'||lpad(p_n::text,12,'0'),
  'session_id','db300000-0000-4000-8000-'||lpad(p_n::text,12,'0'),'role','authenticated','aud','authenticated','aal',p_aal,
  'is_anonymous',false,'email','announcement-'||p_n||'@announcements.example.invalid',
  'iat',floor(extract(epoch from clock_timestamp())),'exp',floor(extract(epoch from clock_timestamp()+interval '30 minutes')),
  'amr',jsonb_build_array(jsonb_build_object('method','oauth','timestamp',current_setting('test.announcement_oauth')::bigint),
    jsonb_build_object('method','totp','timestamp',current_setting('test.announcement_totp')::bigint)))::text,true);
end;$$;
create function pg_temp.announcement_page(p_page integer default 1,p_size integer default 20,p_query text default '',p_status text default 'all',p_release uuid default null)
returns jsonb language sql as $$select to_jsonb(row) from public.staff_announcement_management_snapshot_v2(
 'db500000-0000-4000-8000-000000000001','db600000-0000-4000-8000-000000000001',p_release,p_query,p_status,p_page,p_size) row;$$;
create function pg_temp.announcement_fixture(p_start integer,p_end integer) returns void language sql as $$
 insert into public.staff_announcement_versions(id,organization_id,branch_id,announcement_key,version,version_state,title,body,
  publish_at,audience_branch_id,audience_user_ids,recipient_count,content_hash,created_by,created_at)
 select ('dba00000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'db500000-0000-4000-8000-000000000001',
 'db600000-0000-4000-8000-000000000001',('dbb00000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,1,'draft',
 case n when 250 then 'Literal %_\\ Needle' else 'Synthetic announcement '||n end,'Synthetic body '||n,
 now()-interval '1 day','db600000-0000-4000-8000-000000000001',
 array['db100000-0000-4000-8000-000000000001','db100000-0000-4000-8000-000000000002']::uuid[],
 0,repeat('a',64),'db100000-0000-4000-8000-000000000001',now()-interval '2 days'
 from generate_series(p_start,p_end)n;
$$;
create temporary table announcement_results(name text primary key,result jsonb);
grant all on announcement_results to authenticated;
select pg_temp.announcement_fixture(1,101);

select ok(has_function_privilege('authenticated','public.staff_announcement_management_snapshot_v2(uuid,uuid,uuid,text,text,integer,integer)','execute')
 and not has_function_privilege('anon','public.staff_announcement_management_snapshot_v2(uuid,uuid,uuid,text,text,integer,integer)','execute')
 and not has_function_privilege('service_role','public.staff_announcement_management_snapshot_v2(uuid,uuid,uuid,text,text,integer,integer)','execute'),
 'v2 is authenticated-only, not a service-role fallback');
select ok(not has_function_privilege('authenticated','private.staff_announcement_management_bundle_v2(uuid,uuid,uuid,boolean,timestamptz,uuid,text,text,integer,integer)','execute'),
 'callers cannot bypass auth by supplying another actor or management flag to the bundle');
select ok((select not prosecdef from pg_proc where oid='public.staff_announcement_management_snapshot_v2(uuid,uuid,uuid,text,text,integer,integer)'::regprocedure)
 and (select prosecdef and proconfig@>array['search_path=""'] from pg_proc where oid='private.staff_announcement_management_snapshot_v2_core(uuid,uuid,uuid,text,text,integer,integer)'::regprocedure),
 'public invoker and pinned private definer match the existing security boundary');
set local role authenticated;
select pg_temp.announcement_login();
insert into announcement_results values('101',pg_temp.announcement_page()),('101-last',pg_temp.announcement_page(6));
select is((select (result->'summary'->>'available_total')::integer from announcement_results where name='101'),101,'101 announcements are counted before pagination');
select is((select (result->'summary'->>'matching_total')::integer from announcement_results where name='101'),101,'101 matching announcements are counted server-side');
select is((select jsonb_array_length(result->'announcements') from announcement_results where name='101'),20,'default page is 20 rows');
select is((select result->'pagination' from announcement_results where name='101-last'),'{"page":6,"page_size":20,"total_pages":6,"range_start":101,"range_end":101}'::jsonb,'the 101st announcement is reachable on the last page');
select is((select result->'announcements'->0->>'version_id' from announcement_results where name='101-last'),'dba00000-0000-4000-8000-000000000101','equal-time ties sort by announcement key without UUID aggregation reorder');
reset role;
select pg_temp.announcement_fixture(102,250);
set local role authenticated;
select pg_temp.announcement_login();
insert into announcement_results values('250',pg_temp.announcement_page()),('250-last',pg_temp.announcement_page(13)),('250-clamp',pg_temp.announcement_page(10000)),
 ('literal',pg_temp.announcement_page(1,20,'%_\\ needle')),('empty',pg_temp.announcement_page(10000,20,'no synthetic match'));
select is((select count(distinct item.value->>'version_id')::integer
 from generate_series(1,13) requested_page
 cross join lateral jsonb_array_elements(pg_temp.announcement_page(requested_page)->'announcements') item),250,
 'all 250 authorized items are reachable exactly once through server pagination');
select is((select (result->'summary'->>'available_total')::integer from announcement_results where name='250'),250,'250 authorized announcements are not silently capped at 100');
select is((select jsonb_array_length(result->'announcements') from announcement_results where name='250-last'),10,'the 250-row dataset has ten items on page 13');
select is((select result->'announcements'->9->>'version_id' from announcement_results where name='250-last'),'dba00000-0000-4000-8000-000000000250','the 250th original version is reachable');
select is((select result->'pagination' from announcement_results where name='250-clamp'),'{"page":13,"page_size":20,"total_pages":13,"range_start":241,"range_end":250}'::jsonb,'oversized requested page clamps to current last page');
select is((select (result->'summary'->>'matching_total')::integer from announcement_results where name='literal'),1,'literal case-insensitive search finds a record beyond original 100');
select is((select result->'announcements'->0->>'version_id' from announcement_results where name='literal'),'dba00000-0000-4000-8000-000000000250','percent underscore and backslash are literal search text');
select is((select (result->'summary'->>'draft_total')::integer from announcement_results where name='literal'),250,'global metrics are not accidentally reduced to filtered or page counts');
select is((select result->'pagination' from announcement_results where name='empty'),'{"page":1,"page_size":20,"total_pages":1,"range_start":0,"range_end":0}'::jsonb,'empty result has page 1 and range 0–0');
select is((select jsonb_array_length(result->'announcements') from announcement_results where name='empty'),0,'empty search never falls back to another scope or unfiltered data');
select is((pg_temp.announcement_page(1,20,' Literal')->'summary'->>'matching_total')::integer,0,'query whitespace is literal and not silently normalized');
select is(jsonb_array_length(pg_temp.announcement_page(1,50)->'announcements'),50,'50-row page is supported');
select is(jsonb_array_length(pg_temp.announcement_page(1,100)->'announcements'),100,'100-row page is supported');
select is((pg_temp.announcement_page(1,20,'','draft')->'summary'->>'matching_total')::integer,250,'lifecycle filter is applied to full authorized scope');
select is((pg_temp.announcement_page(1,20,'','published')->'summary'->>'matching_total')::integer,0,'published filter does not mistake unreleased drafts for releases');
select throws_ok($$select pg_temp.announcement_page(0)$$,'22023','valid announcement search and pagination parameters are required','page zero rejected');
select throws_ok($$select pg_temp.announcement_page(10001)$$,'22023','valid announcement search and pagination parameters are required','page over 10000 rejected');
select throws_ok($$select pg_temp.announcement_page(null)$$,'22023','valid announcement search and pagination parameters are required','null page rejected');
select throws_ok($$select pg_temp.announcement_page(1,21)$$,'22023','valid announcement search and pagination parameters are required','unsupported size rejected');
select throws_ok($$select pg_temp.announcement_page(1,null)$$,'22023','valid announcement search and pagination parameters are required','null size rejected');
select throws_ok($$select pg_temp.announcement_page(1,20,repeat('a',121))$$,'22023','valid announcement search and pagination parameters are required','query over 120 characters rejected');
select throws_ok($$select pg_temp.announcement_page(1,20,null)$$,'22023','valid announcement search and pagination parameters are required','null query rejected');
select throws_ok($$select pg_temp.announcement_page(1,20,E'bad\nquery')$$,'22023','valid announcement search and pagination parameters are required','query control characters rejected');
select throws_ok($$select pg_temp.announcement_page(1,20,'','unknown')$$,'22023','valid announcement search and pagination parameters are required','unknown lifecycle rejected');
select throws_ok($$select pg_temp.announcement_page(1,20,'',null)$$,'22023','valid announcement search and pagination parameters are required','null lifecycle rejected');
select lives_ok($$select pg_temp.announcement_page(1,20,repeat('😀',120))$$,'120 Unicode characters accepted regardless of UTF16 width');
select throws_ok($$select * from public.staff_announcement_management_snapshot_v2('db500000-0000-4000-8000-000000000001','db600000-0000-4000-8000-000000000002',null,'','all',0,21)$$,
 '42501','announcement management snapshot is not permitted','cross-branch denial precedes invalid filter disclosure');
select throws_ok($$select * from public.staff_announcement_management_snapshot_v2('db500000-0000-4000-8000-000000000002','db600000-0000-4000-8000-000000000003')$$,
 '42501','announcement management snapshot is not permitted','cross-tenant data and counts are denied');
select pg_temp.announcement_login(1,'aal1');
select throws_ok($$select pg_temp.announcement_page()$$,'42501','announcement management snapshot is not permitted','AAL1 read remains denied');
select pg_temp.announcement_login();
select ok((select version=2 and recipient_count=2 from public.publish_staff_announcement(
 'db500000-0000-4000-8000-000000000001','db600000-0000-4000-8000-000000000001','dba00000-0000-4000-8000-000000000250','dbc00000-0000-4000-8000-000000000001')),
 'the 250th old draft publishes through existing direct-scoped atomic RPC');
reset role;
select set_config('test.announcement_release',(select id::text from public.staff_announcement_versions where announcement_key='dbb00000-0000-4000-8000-000000000250' and version=2),true);
set local role authenticated;
select pg_temp.announcement_login();
insert into announcement_results values('selected-outside',pg_temp.announcement_page(2,20,'Synthetic announcement 1','draft',current_setting('test.announcement_release')::uuid));
select is((select result->'selected_announcement'->>'active_release_version_id' from announcement_results where name='selected-outside'),current_setting('test.announcement_release'),'selected release ownership is independent of current page and filters');
select is((select jsonb_array_length(result->'selected_recipients') from announcement_results where name='selected-outside'),2,'selected recipients remain complete outside current page');
select ok((select not exists(select 1 from jsonb_array_elements(result->'announcements') item where item.value->>'active_release_version_id'=current_setting('test.announcement_release')) from announcement_results where name='selected-outside'),'off-page detail does not insert unrelated row into filtered page');
select throws_ok($$select pg_temp.announcement_page(1,20,'','all','dba00000-0000-4000-8000-000000000249')$$,
 '42501','selected announcement release is outside current scope','draft cannot masquerade as release owner');
select throws_ok($$select pg_temp.announcement_page(1,20,'','all','ffffffff-ffff-4fff-8fff-ffffffffffff')$$,
 '42501','selected announcement release is outside current scope','unknown selected release rejected');
select ok((select not replayed from public.mark_staff_announcement_read('db500000-0000-4000-8000-000000000001','db600000-0000-4000-8000-000000000001',
 current_setting('test.announcement_release')::uuid,'dbc00000-0000-4000-8000-000000000002')),'direct old release can record actual recipient read');
select is((pg_temp.announcement_page(2,20,'','all',current_setting('test.announcement_release')::uuid)->'selected_announcement'->>'read_count')::integer,1,'selected owner aggregate agrees with read receipt detail');
select ok((select version=3 from public.create_staff_announcement_draft('db500000-0000-4000-8000-000000000001','db600000-0000-4000-8000-000000000001',
 current_setting('test.announcement_release')::uuid,'Private pending title','Private pending body',now()-interval '1 day',null,
 array['db100000-0000-4000-8000-000000000001','db100000-0000-4000-8000-000000000002']::uuid[],'{}'::uuid[],
 'Synthetic revision','dbc00000-0000-4000-8000-000000000003')),'old release is editable through exact scoped predecessor not page membership');
reset role;
select set_config('test.announcement_latest',(select id::text from public.staff_announcement_versions where announcement_key='dbb00000-0000-4000-8000-000000000250' and version=3),true);
update private.executive_access_policy set allowed_user_id='db100000-0000-4000-8000-000000000002',allowed_email='announcement-2@announcements.example.invalid',google_subject='synthetic-announcement-google-2';
set local role authenticated;
select pg_temp.announcement_login(2);
insert into announcement_results values('reader',pg_temp.announcement_page());
select is((select (result->'summary'->>'available_total')::integer from announcement_results where name='reader'),1,'reader never receives hidden drafts in counts');
select is((select result->'announcements'->0->>'title' from announcement_results where name='reader'),'Literal %_\\ Needle','recipient sees released content not pending draft');
select is((pg_temp.announcement_page(1,20,'Private pending')->'summary'->>'matching_total')::integer,0,'reader search does not inspect private draft title or body');
select ok((select result->'staff_options'='[]'::jsonb and result->'role_options'='[]'::jsonb and result->'selected_announcement'='null'::jsonb from announcement_results where name='reader'),'reader receives no staff audience options or selected-owner detail');
select throws_ok($$select pg_temp.announcement_page(1,20,'','all',current_setting('test.announcement_release')::uuid)$$,
 '42501','announcement recipient detail is not permitted','reader cannot enumerate other recipients by selecting release');
select throws_ok($$select * from public.publish_staff_announcement('db500000-0000-4000-8000-000000000001','db600000-0000-4000-8000-000000000001','dba00000-0000-4000-8000-000000000249','dbc00000-0000-4000-8000-000000000004')$$,
 '42501','announcement release is not permitted','reader cannot publish directly by old scoped ID');
reset role;
update private.executive_access_policy set allowed_user_id='db100000-0000-4000-8000-000000000001',allowed_email='announcement-1@announcements.example.invalid',google_subject='synthetic-announcement-google-1';
set local role authenticated;
select pg_temp.announcement_login();
select ok((select version=4 from public.withdraw_staff_announcement('db500000-0000-4000-8000-000000000001','db600000-0000-4000-8000-000000000001',
 current_setting('test.announcement_latest')::uuid,current_setting('test.announcement_release')::uuid,'Synthetic withdrawal','dbc00000-0000-4000-8000-000000000005')),
 'off-page original release can be withdrawn using exact latest/release IDs');
select ok((select replayed from public.withdraw_staff_announcement('db500000-0000-4000-8000-000000000001','db600000-0000-4000-8000-000000000001',
 current_setting('test.announcement_latest')::uuid,current_setting('test.announcement_release')::uuid,'Synthetic withdrawal','dbc00000-0000-4000-8000-000000000005')),
 'withdrawal exact replay remains authorized after latest version advances');
select is((pg_temp.announcement_page(1,20,'','withdrawn')->'summary'->>'matching_total')::integer,1,'withdrawn lifecycle filter uses current release state');
reset role;
update private.executive_access_policy set allowed_user_id='db100000-0000-4000-8000-000000000002',allowed_email='announcement-2@announcements.example.invalid',google_subject='synthetic-announcement-google-2';
set local role authenticated;
select pg_temp.announcement_login(2);
select is((pg_temp.announcement_page()->'summary'->>'available_total')::integer,0,'withdrawn release disappears from ordinary reader data and counts');
reset role;
update private.executive_access_policy set allowed_user_id='db100000-0000-4000-8000-000000000001',allowed_email='announcement-1@announcements.example.invalid',google_subject='synthetic-announcement-google-1';
set local role authenticated;
select pg_temp.announcement_login();
select is((pg_temp.announcement_page(13,20,'','withdrawn')->'pagination'->>'page')::integer,1,'page clamps back to one after filters shrink matching dataset');
reset role;
select ok(not exists(select 1 from public.audit_events where metadata->>'projection'='page68_staff_announcement_management_v2'
 and (metadata::text like '%Literal%' or metadata::text like '%Synthetic body%' or metadata ? 'query')),'search audits omit literal query and announcement content');
select ok(exists(select 1 from public.audit_events where metadata->>'projection'='page68_staff_announcement_management_v2'
 and metadata->>'announcement_available_total'='250' and metadata->>'query_present'='true'),'every filtered snapshot records bounded counts and query-presence audit');
select ok(not has_table_privilege('authenticated','public.staff_announcement_versions','select')
 and not has_table_privilege('service_role','public.staff_announcement_read_receipts','insert'),'v2 adds no direct business table privileges');

-- Test-owned fault injection runs only in this rolled-back synthetic transaction.
-- The actual authority and snapshot functions are never substituted.
create function pg_temp.announcement_audit_fault() returns trigger
language plpgsql security definer set search_path='' as $$begin
 if new.metadata->>'projection'='page68_staff_announcement_management_v2' then
  if current_setting('test.announcement_fault',true)='revoke' then
   update public.memberships set status='suspended'
    where id='db700000-0000-4000-8000-000000000001';
  elsif current_setting('test.announcement_fault',true)='page' then
   perform pg_temp.announcement_fixture(251,251);
  end if;
 end if;
 return new;
end;$$;
create trigger announcement_test_audit_fault before insert on public.audit_events
for each row execute function pg_temp.announcement_audit_fault();
select set_config('test.announcement_audits',(select count(*)::text from public.audit_events),true);
set local role authenticated;
select set_config('test.announcement_fault','revoke',true);
select throws_ok($$select pg_temp.announcement_page()$$,'42501','announcement management snapshot expired after audit',
 'authority revoked by audit hook blocks the previously authorized snapshot');
reset role;
select is((select status from public.memberships where id='db700000-0000-4000-8000-000000000001'),'active',
 'failed read rolls back the synthetic role change');
select is((select count(*)::text from public.audit_events),current_setting('test.announcement_audits'),
 'denied post-audit snapshot commits no audit event');
set local role authenticated;
select set_config('test.announcement_fault','page',true);
select throws_ok($$select pg_temp.announcement_page()$$,'42501','announcement management snapshot expired after audit',
 'matching count changed by audit hook blocks stale page and totals');
reset role;
select is((select count(*)::integer from public.staff_announcement_versions where id='dba00000-0000-4000-8000-000000000251'),0,
 'failed stale snapshot commits no injected business row');
select is((select count(*)::text from public.audit_events),current_setting('test.announcement_audits'),
 'failed stale snapshot commits no audit event');
drop trigger announcement_test_audit_fault on public.audit_events;
select set_config('test.announcement_fault','',true);

-- Exact lifecycle boundaries use the production projection with an explicit
-- synthetic timestamp. No wall-clock sleep or alternate lifecycle formula.
insert into public.staff_announcement_versions(id,organization_id,branch_id,announcement_key,version,version_state,title,body,
 publish_at,expires_at,audience_branch_id,audience_user_ids,recipient_count,action_reauth_challenge_id,content_hash,created_by,created_at)
values('dba00000-0000-4000-8000-000000000252','db500000-0000-4000-8000-000000000001',
 'db600000-0000-4000-8000-000000000001','dbb00000-0000-4000-8000-000000000252',1,'release','Synthetic boundary','Synthetic boundary',
 '2030-01-01T00:00:00Z','2030-01-02T00:00:00Z','db600000-0000-4000-8000-000000000001',
 array['db100000-0000-4000-8000-000000000001']::uuid[],1,'db800000-0000-4000-8000-000000000001',repeat('a',64),'db100000-0000-4000-8000-000000000001','2029-12-01T00:00:00Z');
select is((select lifecycle from private.staff_announcement_snapshot_rows(
 'db500000-0000-4000-8000-000000000001','db600000-0000-4000-8000-000000000001','db100000-0000-4000-8000-000000000001',true,'2030-01-01T00:00:00Z')
 where announcement_key='dbb00000-0000-4000-8000-000000000252'),'published','publication begins at the exact scheduled boundary');
select is((select lifecycle from private.staff_announcement_snapshot_rows(
 'db500000-0000-4000-8000-000000000001','db600000-0000-4000-8000-000000000001','db100000-0000-4000-8000-000000000001',true,'2030-01-02T00:00:00Z')
 where announcement_key='dbb00000-0000-4000-8000-000000000252'),'expired','release expires at the exact expiry boundary');
select finish();
rollback;
