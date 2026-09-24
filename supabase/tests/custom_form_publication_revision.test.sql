begin;
select plan(82);
-- Entirely synthetic Auth metadata; real admission/permission/reauth functions.
select set_config('test.custom_amr',floor(extract(epoch from now()-interval '2 minutes'))::text,true);
insert into auth.users(id,aud,role,email,email_confirmed_at,created_at,updated_at) values
 ('d8100000-0000-4000-8000-000000000001','authenticated','authenticated','custom-form@example.invalid',now()-interval '1 day',now()-interval '1 day',now());
insert into auth.identities(id,provider_id,user_id,identity_data,provider) values
 ('d8200000-0000-4000-8000-000000000001','synthetic-custom-google','d8100000-0000-4000-8000-000000000001',
  '{"sub":"synthetic-custom-google","email":"custom-form@example.invalid","email_verified":true}','google');
insert into auth.sessions(id,user_id,created_at,aal) values
 ('d8300000-0000-4000-8000-000000000001','d8100000-0000-4000-8000-000000000001',now()-interval '3 minutes','aal2');
insert into auth.mfa_amr_claims(id,session_id,created_at,updated_at,authentication_method)
 select ('d8400000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'d8300000-0000-4000-8000-000000000001',
 to_timestamp(current_setting('test.custom_amr')::bigint),to_timestamp(current_setting('test.custom_amr')::bigint),
 case n when 1 then 'oauth' else 'totp' end from generate_series(1,2)n;
insert into public.organizations(id,code,name) values
 ('d8500000-0000-4000-8000-000000000001','custom_form_test','合成表單機構'),('d8500000-0000-4000-8000-000000000002','custom_other_test','合成其他機構');
insert into public.branches(id,organization_id,code,name) values
 ('d8600000-0000-4000-8000-000000000001','d8500000-0000-4000-8000-000000000001','main','合成分支'),
 ('d8600000-0000-4000-8000-000000000002','d8500000-0000-4000-8000-000000000002','other','合成他機構分支');
insert into public.profiles(id,display_name,kind) values ('d8100000-0000-4000-8000-000000000001','合成表單管理員','staff');
insert into public.memberships(id,organization_id,profile_id,status,starts_at) values
 ('d8700000-0000-4000-8000-000000000001','d8500000-0000-4000-8000-000000000001','d8100000-0000-4000-8000-000000000001','active',now()-interval '1 day');
insert into public.membership_roles(membership_id,role_id) values
 ('d8700000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000002');
insert into private.executive_access_policy(allowed_user_id,allowed_email,google_subject,enabled,approval_reference) values
 ('d8100000-0000-4000-8000-000000000001','custom-form@example.invalid','synthetic-custom-google',true,'synthetic test approval only');
insert into private.reauth_challenges(id,user_id,session_id,nonce_sha256,idempotency_key,issued_jwt_iat,issued_jwt_jti,
 created_at,expires_at,consumed_at,consumed_jwt_iat,consumed_jwt_jti,factor_method,factor_verified_at) values
 ('d8800000-0000-4000-8000-000000000001','d8100000-0000-4000-8000-000000000001','d8300000-0000-4000-8000-000000000001',repeat('a',64),
 'd8900000-0000-4000-8000-000000000001',now()-interval '2 minutes','before',now()-interval '1 minute',now()+interval '4 minutes',
 now()-interval '30 seconds',now()-interval '30 seconds','after','totp',now()-interval '30 seconds');
insert into private.reauth_events(user_id,session_id,challenge_id,aal,verification_method,verified_at) values
 ('d8100000-0000-4000-8000-000000000001','d8300000-0000-4000-8000-000000000001','d8800000-0000-4000-8000-000000000001','aal2','totp',now()-interval '30 seconds');
create function pg_temp.custom_login(p_aal text default 'aal2') returns void language plpgsql security invoker as $$
begin
 perform set_config('request.jwt.claim.sub','',true); perform set_config('request.jwt.claim.role','',true);
 perform set_config('request.jwt.claims',jsonb_build_object('sub','d8100000-0000-4000-8000-000000000001','session_id','d8300000-0000-4000-8000-000000000001',
  'role','authenticated','aud','authenticated','aal',p_aal,'is_anonymous',false,'email','custom-form@example.invalid',
  'iat',floor(extract(epoch from now())),'exp',floor(extract(epoch from now()+interval '30 minutes')),
  'amr',jsonb_build_array(jsonb_build_object('method','oauth','timestamp',current_setting('test.custom_amr')::bigint),
   jsonb_build_object('method','totp','timestamp',current_setting('test.custom_amr')::bigint)))::text,true);
end;$$;
select set_config('test.custom_payload','{"formKey":"tenant.custom.daily_check","name":"合成機構表單","category":"行政表單","effectiveFrom":"2026-09-14","effectiveTo":null,"schema":{"builder":"tenant-custom.v1","fields":[{"key":"note","label":"合成文字","required":true,"type":"text","maxLength":500},{"key":"count","label":"合成數字","required":true,"type":"number","minimum":0,"maximum":100},{"key":"day","label":"合成日期","required":false,"type":"date"},{"key":"yes","label":"合成是非","required":true,"type":"boolean"},{"key":"choice","label":"合成選擇","required":false,"type":"select","options":["甲","乙"]}]}}',true);
create function pg_temp.custom_save(p_n integer default 1,p_id uuid default null,p_revision integer default null,p_payload jsonb default null,p_branch uuid default 'd8600000-0000-4000-8000-000000000001') returns jsonb language sql security invoker as $$
 select public.save_custom_form_draft('d8500000-0000-4000-8000-000000000001',p_branch,p_id,p_revision,
 ('d9000000-0000-4000-8000-'||lpad(p_n::text,12,'0'))::uuid,coalesce(p_payload,current_setting('test.custom_payload')::jsonb));$$;
create function pg_temp.custom_id() returns uuid language sql as $$select (current_setting('test.custom_receipt')::jsonb->>'formVersionId')::uuid;$$;
create function pg_temp.custom_read() returns jsonb language sql security invoker as $$
 select public.read_custom_form_draft('d8500000-0000-4000-8000-000000000001','d8600000-0000-4000-8000-000000000001',pg_temp.custom_id());$$;
create function pg_temp.custom_mutation_fingerprint() returns text language sql security invoker as $$
 select md5(jsonb_build_object(
  'definitions',(select jsonb_agg(to_jsonb(d) order by d.id) from public.form_definitions d),
  'versions',(select jsonb_agg(to_jsonb(v) order by v.id) from public.form_versions v),
  'receipts',(select jsonb_agg(to_jsonb(r) order by r.organization_id,r.actor_id,r.idempotency_key) from private.custom_form_draft_receipts r),
  'audit_count',(select count(*) from public.audit_events where table_name='custom_form_draft')
 )::text);
$$;
insert into public.form_definitions(id,organization_id,form_key,name,category,is_official) values
 ('d9300000-0000-4000-8000-000000000001',null,'official.synthetic','合成官方表單','官方表單',true),
 ('d9300000-0000-4000-8000-000000000002','d8500000-0000-4000-8000-000000000001','tenant.custom.historical','合成已發布表單','行政表單',false);
insert into public.form_versions(id,form_definition_id,version,status,effective_from,schema_json,scoring_json,published_at,published_by) values
 ('d9400000-0000-4000-8000-000000000001','d9300000-0000-4000-8000-000000000001',1,'draft','2026-01-01','{"fields":[]}','{}',null,null),
 ('d9400000-0000-4000-8000-000000000002','d9300000-0000-4000-8000-000000000002',1,'published','2026-01-01',current_setting('test.custom_payload')::jsonb->'schema','{}',now(),'d8100000-0000-4000-8000-000000000001');


insert into auth.users(id,aud,role,email,email_confirmed_at,created_at,updated_at) values
 ('d8100000-0000-4000-8000-000000000011','authenticated','authenticated','second@example.invalid',now()-interval '1 day',now()-interval '1 day',now());
insert into auth.identities(id,provider_id,user_id,identity_data,provider) values
 ('d8200000-0000-4000-8000-000000000011','synthetic-second-google','d8100000-0000-4000-8000-000000000011',
  '{"sub":"synthetic-second-google","email":"second@example.invalid","email_verified":true}','google');
insert into auth.sessions(id,user_id,created_at,aal) values
 ('d8300000-0000-4000-8000-000000000011','d8100000-0000-4000-8000-000000000011',now()-interval '3 minutes','aal2');
insert into auth.mfa_amr_claims(id,session_id,created_at,updated_at,authentication_method)
 select ('d8410000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'d8300000-0000-4000-8000-000000000011',
 to_timestamp(current_setting('test.custom_amr')::bigint),to_timestamp(current_setting('test.custom_amr')::bigint),
 case n when 1 then 'oauth' else 'totp' end from generate_series(1,2)n;

insert into public.profiles(id,display_name,kind) values('d8100000-0000-4000-8000-000000000011','合成第二人','staff');
insert into public.memberships(id,organization_id,profile_id,status,starts_at) values('d8700000-0000-4000-8000-000000000011','d8500000-0000-4000-8000-000000000001','d8100000-0000-4000-8000-000000000011','active',now()-interval '1 day');
insert into public.membership_roles(membership_id,role_id) values('d8700000-0000-4000-8000-000000000011','10000000-0000-4000-8000-000000000002');
insert into private.staff_google_access_grants(allowed_user_id,organization_id,company_email_domain,allowed_email,google_subject,enabled,approval_reference)
 values('d8100000-0000-4000-8000-000000000011','d8500000-0000-4000-8000-000000000001','example.invalid','second@example.invalid','synthetic-second-google',true,'synthetic second approver');
insert into private.reauth_challenges(id,user_id,session_id,nonce_sha256,idempotency_key,issued_jwt_iat,issued_jwt_jti,
 created_at,expires_at,consumed_at,consumed_jwt_iat,consumed_jwt_jti,factor_method,factor_verified_at) values
 ('d8800000-0000-4000-8000-000000000011','d8100000-0000-4000-8000-000000000011','d8300000-0000-4000-8000-000000000011',repeat('b',64),
 'd8900000-0000-4000-8000-000000000011',now()-interval '2 minutes','before',now()-interval '1 minute',now()+interval '4 minutes',
 now()-interval '30 seconds',now()-interval '30 seconds','after','totp',now()-interval '30 seconds');
insert into private.reauth_events(user_id,session_id,challenge_id,aal,verification_method,verified_at) values
 ('d8100000-0000-4000-8000-000000000011','d8300000-0000-4000-8000-000000000011','d8800000-0000-4000-8000-000000000011','aal2','totp',now()-interval '30 seconds');

create function pg_temp.second_login() returns void language plpgsql as $$ begin
 perform pg_temp.custom_login();
 perform set_config('request.jwt.claims',replace(replace(replace(current_setting('request.jwt.claims'),'000000000001','000000000011'),'custom-form@example.invalid','second@example.invalid'),'synthetic-custom-google','synthetic-second-google'),true);
end;$$;
insert into public.branches(id,organization_id,code,name) values('d8600000-0000-4000-8000-000000000003','d8500000-0000-4000-8000-000000000001','second','合成第二分支');
create function pg_temp.lifecycle(p_action text default 'clone',p_n integer default 1,p_request uuid default null,p_reason text default '合成改版原因',p_version uuid default 'd9400000-0000-4000-8000-000000000002',p_branch uuid default 'd8600000-0000-4000-8000-000000000001') returns jsonb language sql as $$
 select public.write_custom_form_lifecycle('d8500000-0000-4000-8000-000000000001',p_branch,
 ('d9900000-0000-4000-8000-'||lpad(p_n::text,12,'0'))::uuid,
 jsonb_build_object('action',p_action,'formVersionId',p_version,'requestId',p_request,'reason',p_reason));$$;
create function pg_temp.lifecycle_read() returns jsonb language sql as $$
 select public.read_custom_form_lifecycle('d8500000-0000-4000-8000-000000000001','d8600000-0000-4000-8000-000000000001','d9400000-0000-4000-8000-000000000002');$$;
insert into public.clients(id,organization_id,branch_id,client_code,display_name) values('db300000-0000-4000-8000-000000000001','d8500000-0000-4000-8000-000000000001','d8600000-0000-4000-8000-000000000001','SYN-1','合成填答個案');
create function pg_temp.lifecycle_response(p_n integer,p_previous uuid default null,p_revision integer default null,p_action text default 'save') returns jsonb language sql as $$
 select public.write_custom_form_response('d8500000-0000-4000-8000-000000000001','d8600000-0000-4000-8000-000000000001','db300000-0000-4000-8000-000000000001',('db400000-0000-4000-8000-'||lpad(p_n::text,12,'0'))::uuid,
 jsonb_build_object('action',p_action,'formVersionId','d9400000-0000-4000-8000-000000000002','previousId',p_previous,'baseRevision',p_revision,'serviceDate',(clock_timestamp() at time zone 'Asia/Taipei')::date,
 'answers',case when p_action='save' then '{"note":{"state":"answered","value":"合成填答"},"count":{"state":"answered","value":0},"yes":{"state":"answered","value":false}}'::jsonb else null end,'reason',case when p_action='correct' then '合成更正原因' else null end));$$;

create function pg_temp.pub_write(p_action text,p_n integer,p_request uuid default null,p_revision integer default null,p_reason text default null,p_version uuid default null)
returns jsonb language sql as $$
 select public.write_custom_form_publication_v2('d8500000-0000-4000-8000-000000000001','d8600000-0000-4000-8000-000000000001',
 ('dc100000-0000-4000-8000-'||lpad(p_n::text,12,'0'))::uuid,jsonb_build_object('action',p_action,'formVersionId',coalesce(p_version,pg_temp.custom_id()),'requestId',p_request,'baseRevision',p_revision,'reason',p_reason));
$$;
create function pg_temp.pub_request(p_setting text default 'test.pub1') returns uuid language sql as $$
 select (current_setting(p_setting)::jsonb->'event'->>'requestId')::uuid;
$$;
create function pg_temp.pub_history() returns jsonb language sql as $$
 select public.read_custom_form_publication_history_v2('d8500000-0000-4000-8000-000000000001','d8600000-0000-4000-8000-000000000001',pg_temp.custom_id());
$$;
-- All use the exact custom namespace; only the real valid builder is eligible.
insert into public.form_definitions(id,organization_id,form_key,name,category,is_official)
 select ('dc300000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'d8500000-0000-4000-8000-000000000001',
 'tenant.custom.legacy_'||n,'合成不相容舊表單'||n,'行政表單',false from generate_series(1,3)n;
insert into public.form_versions(id,form_definition_id,version,status,effective_from,schema_json,scoring_json)
 select ('dc400000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,('dc300000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,1,'draft','2026-09-01',
 case n when 1 then '{"fields":[{"key":"legacy"}]}'::jsonb when 2 then current_setting('test.custom_payload')::jsonb->'schema'
 else '{"builder":"tenant-custom.v1","fields":[]}'::jsonb end,
 case n when 2 then '{"legacy_score":1}'::jsonb else '{}'::jsonb end from generate_series(1,3)n;
select ok((select relrowsecurity and relforcerowsecurity from pg_class where oid='private.custom_form_publication_snapshots'::regclass),'snapshots force RLS');
select ok((select relrowsecurity and relforcerowsecurity from pg_class where oid='private.custom_form_publication_events'::regclass),'events force RLS');
select ok((select relrowsecurity and relforcerowsecurity from pg_class where oid='private.custom_form_publication_receipts'::regclass),'receipts force RLS');
select ok(not has_table_privilege('authenticated','private.custom_form_publication_snapshots','select,insert,update,delete'),'no direct snapshot access');
select ok(not has_table_privilege('service_role','private.custom_form_publication_events','select,insert,update,delete'),'service role cannot bypass evidence');
select ok(not has_function_privilege('anon','public.write_custom_form_publication_v2(uuid,uuid,uuid,jsonb)','execute'),'anonymous RPC closed');
select ok(not has_function_privilege('service_role','public.write_custom_form_publication_v2(uuid,uuid,uuid,jsonb)','execute'),'service RPC closed');
select pg_temp.custom_login();
set local role authenticated;
select set_config('test.custom_receipt',pg_temp.custom_save(30)::text,true);
select is((select row->>'custom_builder_eligible' from public.form_governance_snapshot_v2('d8500000-0000-4000-8000-000000000001','d8600000-0000-4000-8000-000000000001') s,lateral jsonb_array_elements(s.versions) row where row->>'id'=pg_temp.custom_id()::text),'true','valid custom builder explicitly eligible');
select is((select count(*) from public.form_governance_snapshot_v2('d8500000-0000-4000-8000-000000000001','d8600000-0000-4000-8000-000000000001') s,lateral jsonb_array_elements(s.versions) row where row->>'id' like 'dc400000-%' and row->>'custom_builder_eligible'='false'),3::bigint,'nonbuilder scored and invalid schemas never selected by prefix alone');
select throws_ok($$select pg_temp.pub_write('request',41,null,1,null,'dc400000-0000-4000-8000-000000000001')$$,'42501',null,'exact-prefix nonbuilder stays outside v2');
select throws_ok($$select pg_temp.pub_write('request',42,null,1,null,'dc400000-0000-4000-8000-000000000002')$$,'42501',null,'exact-prefix scored form stays outside v2');
select throws_ok($$select public.read_custom_form_publication_history_v2('d8500000-0000-4000-8000-000000000001','d8600000-0000-4000-8000-000000000001','dc400000-0000-4000-8000-000000000003')$$,'42501',null,'invalid claimed builder fails same full validator as capability flag');
select is(pg_temp.pub_history()->>'currentDraftRevision','1','editable draft exposes revision one');
select is(pg_temp.pub_history()->'currentDraft',current_setting('test.custom_payload')::jsonb,'read shows exact current editable payload');
select is(pg_temp.pub_history()->>'total','0','no fabricated publication evidence');
select throws_ok($$select pg_temp.pub_write('request',1,null,2)$$,'40001',null,'stale submit revision rejected');
select lives_ok($$select set_config('test.pub1',pg_temp.pub_write('request',2,null,1)::text,true)$$,'request freezes draft version and revision');
select is(pg_temp.pub_write('request',2,null,1)->>'replayed','true','request retry replays');
select is(pg_temp.pub_history()->'currentDraft','null'::jsonb,'pending draft is not editable');
select is(pg_temp.pub_history()->'requests'->0->'payload',current_setting('test.custom_payload')::jsonb,'request preserves full submitted fields');
select is(pg_temp.pub_history()->'requests'->0->>'baseRevision','1','request immutable baseline saved');
select throws_ok($$select pg_temp.custom_read()$$,'23514',null,'legacy draft read locks pending');
select throws_ok($$select pg_temp.custom_save(31,pg_temp.custom_id(),1)$$,'23514',null,'legacy draft write locks pending');
select throws_ok($$select pg_temp.pub_write('approve',3,pg_temp.pub_request())$$,'42501',null,'requester cannot self approve');
select throws_ok($$select pg_temp.pub_write('return',3,pg_temp.pub_request(),null,'合成退回原因')$$,'42501',null,'requester cannot self return');
select throws_ok($$select pg_temp.pub_write('withdraw',3,pg_temp.pub_request(),null,'短')$$,'22023',null,'reason minimum enforced');
select throws_ok($$select pg_temp.pub_write('withdraw',3,pg_temp.pub_request(),null,'<script>合成原因</script>')$$,'22023',null,'markup reason rejected');
select pg_temp.second_login();
select throws_ok($$select pg_temp.pub_write('withdraw',3,pg_temp.pub_request(),null,'合成撤回原因')$$,'42501',null,'other actor cannot withdraw');
select lives_ok($$select set_config('test.return1',pg_temp.pub_write('return',4,pg_temp.pub_request(),null,'合成欄位需要修正')::text,true)$$,'independent reviewer returns for correction');
select is(pg_temp.pub_write('return',4,pg_temp.pub_request(),null,'合成欄位需要修正')->'event',current_setting('test.return1')::jsonb->'event','return replay preserves exact immutable event');
select throws_ok($$select pg_temp.pub_write('return',4,pg_temp.pub_request(),null,'不同原因不得覆寫')$$,'23505',null,'same key changed reason denied');
select throws_ok($$select pg_temp.pub_write('approve',5,pg_temp.pub_request())$$,'23514',null,'terminal request never approved');
select throws_ok($$select * from public.approve_form_publication('d8500000-0000-4000-8000-000000000001','d8600000-0000-4000-8000-000000000001',pg_temp.pub_request(),'dc200000-0000-4000-8000-000000000001')$$,'23514',null,'legacy approval cannot approve returned request');
select pg_temp.custom_login();
select is(pg_temp.pub_write('request',2,null,1)->>'requestStatus','returned','old requester retry reports original terminal status');
select is(pg_temp.pub_write('request',2,null,1)->'event',current_setting('test.pub1')::jsonb->'event','old request event never rewritten');
select is(pg_temp.pub_history()->>'total','1','replay did not resubmit');
select is((select publication_total from public.form_governance_snapshot('d8500000-0000-4000-8000-000000000001','d8600000-0000-4000-8000-000000000001')),0::bigint,'v1 totals exclude closed history');
select is((select publication_total from public.form_governance_snapshot_v2('d8500000-0000-4000-8000-000000000001','d8600000-0000-4000-8000-000000000001')),1::bigint,'v2 latest closed request included');
select is((select publications->0->>'status' from public.form_governance_snapshot_v2('d8500000-0000-4000-8000-000000000001','d8600000-0000-4000-8000-000000000001')),'returned','v2 closed status projected');
select is(pg_temp.pub_history()->'requests'->0->'events'->1->>'reason','合成欄位需要修正','reason is preserved in audited history');
select lives_ok($$select pg_temp.custom_read()$$,'returned draft readable in existing editor');
select throws_ok($$select pg_temp.pub_write('request',6,null,1)$$,'40001',null,'cannot resubmit unchanged returned revision');
select set_config('test.updated_payload',jsonb_set(current_setting('test.custom_payload')::jsonb,'{schema,fields,0,label}','"合成修正後文字"')::text,true);
select lives_ok($$select pg_temp.custom_save(32,pg_temp.custom_id(),1,current_setting('test.updated_payload')::jsonb)$$,'save revised draft with base revision');
select is(pg_temp.pub_history()->'requests'->0->'payload',current_setting('test.custom_payload')::jsonb,'saved edit leaves original submitted snapshot unchanged');
select is(pg_temp.pub_history()->'currentDraft',current_setting('test.updated_payload')::jsonb,'current editor sees revised draft');
select lives_ok($$select set_config('test.pub2',pg_temp.pub_write('request',7,null,2)::text,true)$$,'corrected revision creates new request');
select isnt(pg_temp.pub_request('test.pub2'),pg_temp.pub_request(),'resubmission uses new stable request id');
select is(pg_temp.pub_history()->'requests'->0->>'previousRequestId',pg_temp.pub_request()::text,'resubmission links old request');
select is(pg_temp.pub_history()->>'total','2','two immutable submission rounds preserved');
select is((select publication_total from public.form_governance_snapshot_v2('d8500000-0000-4000-8000-000000000001','d8600000-0000-4000-8000-000000000001')),1::bigint,'v2 list counts latest request only');
select is((select pending_total from public.form_governance_snapshot_v2('d8500000-0000-4000-8000-000000000001','d8600000-0000-4000-8000-000000000003')),1::bigint,'org-wide latest pending count across branch');
select is(pg_temp.pub_write('request',2,null,1)->>'requestStatus','returned','old retry stays terminal after another submission');
select throws_ok($$select pg_temp.pub_write('request',8,null,2)$$,'23505',null,'duplicate different-key pending submission blocked');
select lives_ok($$select set_config('test.withdraw2',pg_temp.pub_write('withdraw',9,pg_temp.pub_request('test.pub2'),null,'合成重新確認欄位')::text,true)$$,'requester withdraws own pending request');
select is(pg_temp.pub_write('withdraw',9,pg_temp.pub_request('test.pub2'),null,'合成重新確認欄位')->>'replayed','true','withdraw replay exact');
select throws_ok($$select pg_temp.pub_write('withdraw',10,pg_temp.pub_request('test.pub2'),null,'合成重新確認欄位')$$,'23514',null,'second terminal decision denied');
select lives_ok($$select pg_temp.custom_save(33,pg_temp.custom_id(),2,current_setting('test.updated_payload')::jsonb)$$,'withdrawn draft becomes editable');
select throws_ok($$select pg_temp.pub_write('request',11,null,3)$$,'40001',null,'unchanged save does not meet correction requirement');
select set_config('test.updated_payload',jsonb_set(current_setting('test.updated_payload')::jsonb,'{schema,fields,0,label}','"合成最終修正文字"')::text,true);
select pg_temp.custom_save(35,pg_temp.custom_id(),3,current_setting('test.updated_payload')::jsonb);
select lives_ok($$select set_config('test.pub3',pg_temp.pub_write('request',11,null,4)::text,true)$$,'new explicit changed revision may resubmit');
select pg_temp.second_login();
select lives_ok($$select set_config('test.approve3',pg_temp.pub_write('approve',12,pg_temp.pub_request('test.pub3'))::text,true)$$,'second reviewer approves final corrected request');
select is(pg_temp.pub_write('approve',12,pg_temp.pub_request('test.pub3'))->>'replayed','true','approval event replay preserves evidence');
select is(pg_temp.pub_history()->>'currentStatus','published','approved version is published');
select is(pg_temp.pub_history()->'currentDraft','null'::jsonb,'published version never editable');
select is(pg_temp.pub_history()->'requests'->0->>'status','approved','latest approval visible');
select is(pg_temp.pub_history()->'requests'->1->>'status','withdrawn','prior withdrawal visible');
select is(pg_temp.pub_history()->'requests'->2->>'status','returned','original return visible');
select is(pg_temp.pub_history()->'requests'->0->'payload',current_setting('test.updated_payload')::jsonb,'approved snapshot is corrected content');
select is((select pending_total from public.form_governance_snapshot_v2('d8500000-0000-4000-8000-000000000001','d8600000-0000-4000-8000-000000000001')),0::bigint,'no pending after approval');
select throws_ok($$select pg_temp.custom_save(34,pg_temp.custom_id(),3,current_setting('test.updated_payload')::jsonb)$$,'23514',null,'published form cannot be rewritten');
select throws_ok($$select pg_temp.pub_write('return',13,pg_temp.pub_request('test.pub3'),null,'已發布不得退回')$$,'23514',null,'published approved request cannot return');
select throws_ok($$select public.read_custom_form_publication_history_v2('d8500000-0000-4000-8000-000000000002','d8600000-0000-4000-8000-000000000002',pg_temp.custom_id())$$,'42501',null,'cross organization history denied');
select throws_ok($$select public.read_custom_form_publication_history_v2('d8500000-0000-4000-8000-000000000001','d8600000-0000-4000-8000-000000000001','d9400000-0000-4000-8000-000000000001')$$,'42501',null,'official history not editable/read through custom endpoint');
select pg_temp.custom_login();
select set_config('test.cross_draft',pg_temp.custom_save(40,null,null,jsonb_set(current_setting('test.custom_payload')::jsonb,'{formKey}','"tenant.custom.cross_branch"'))::text,true);
select set_config('test.cross_request',pg_temp.pub_write('request',14,null,1,null,(current_setting('test.cross_draft')::jsonb->>'formVersionId')::uuid)::text,true);
select pg_temp.second_login();
select lives_ok($$select set_config('test.cross_approved',public.write_custom_form_publication_v2('d8500000-0000-4000-8000-000000000001','d8600000-0000-4000-8000-000000000003','dc100000-0000-4000-8000-000000000015',jsonb_build_object('action','approve','formVersionId',current_setting('test.cross_draft')::jsonb->'formVersionId','requestId',current_setting('test.cross_request')::jsonb->'event'->'requestId','baseRevision',null,'reason',null))::text,true)$$,'org-wide second reviewer may approve a request from another branch');
select is(current_setting('test.cross_approved')::jsonb->'event'->>'branchId','d8600000-0000-4000-8000-000000000001','approval immutable branch preserves original request branch');
select is(current_setting('test.cross_approved')::jsonb->>'requestStatus','approved','cross branch approval confirms published state');
select pg_temp.custom_login('aal1');
select throws_ok($$select pg_temp.pub_write('request',2,null,1)$$,'42501',null,'AAL1 cannot replay mutations');
select pg_temp.custom_login();
reset role;
select throws_ok($$update private.custom_form_publication_snapshots set content=content$$,'55000',null,'snapshot updates always rejected');
select throws_ok($$delete from private.custom_form_publication_events$$,'55000',null,'event deletion rejected');
select throws_ok($$update private.custom_form_publication_receipts set request_hash=request_hash$$,'55000',null,'receipt rewrite rejected');
select throws_ok($$delete from public.form_publication_requests where id=pg_temp.pub_request()$$,'55000',null,'old request evidence cannot be removed');
update auth.sessions set not_after=clock_timestamp() where id='d8300000-0000-4000-8000-000000000011';
select pg_temp.second_login();
set local role authenticated;
select throws_ok($$select pg_temp.pub_write('approve',12,pg_temp.pub_request('test.pub3'))$$,'42501',null,'session expiry invalidates replay');
select throws_ok($$select pg_temp.pub_history()$$,'42501',null,'session expiry invalidates history');
reset role;
select * from finish();
rollback;
