begin;
select plan(62);
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

select ok((select relrowsecurity and relforcerowsecurity from pg_class where oid='private.custom_form_draft_receipts'::regclass),'receipt ledger has forced RLS');
select ok(not has_table_privilege('authenticated','private.custom_form_draft_receipts','select,insert,update,delete') and not has_table_privilege('service_role','private.custom_form_draft_receipts','select,insert,update,delete'),'receipt ledger inaccessible to API roles');
select ok(not has_table_privilege('authenticated','public.form_versions','insert,update,delete') and not has_table_privilege('service_role','public.form_versions','insert,update,delete'),'version DML remains closed');
select ok(not has_table_privilege('authenticated','public.form_definitions','insert,update,delete') and not has_table_privilege('service_role','public.form_definitions','insert,update,delete'),'definition DML remains closed');
select ok(not (select prosecdef from pg_proc where oid='public.save_custom_form_draft(uuid,uuid,uuid,integer,uuid,jsonb)'::regprocedure),'public writer is invoker');
select ok(not (select prosecdef from pg_proc where oid='public.read_custom_form_draft(uuid,uuid,uuid)'::regprocedure),'public reader is invoker');
select ok(has_function_privilege('authenticated','public.save_custom_form_draft(uuid,uuid,uuid,integer,uuid,jsonb)','execute')
 and not has_function_privilege('anon','public.save_custom_form_draft(uuid,uuid,uuid,integer,uuid,jsonb)','execute')
 and not has_function_privilege('service_role','public.save_custom_form_draft(uuid,uuid,uuid,integer,uuid,jsonb)','execute'),'only authenticated can invoke writer');
select pg_temp.custom_login();
set local role authenticated;
select is(public.is_executive_login_allowed(),true,'real verified synthetic Google fixture admitted');
select is(public.has_recent_aal2(15),true,'real immutable reauth evidence present');
select throws_ok($$select pg_temp.custom_save(9,'d9400000-0000-4000-8000-000000000001',1)$$,'42501',null,'official version cannot be edited');
select throws_ok($$select pg_temp.custom_save(9,'d9400000-0000-4000-8000-000000000002',1)$$,'23514',null,'published custom version cannot be edited');
select throws_ok($$select public.read_custom_form_draft('d8500000-0000-4000-8000-000000000001','d8600000-0000-4000-8000-000000000001','d9400000-0000-4000-8000-000000000001')$$,'42501',null,'official version not exposed through draft editor');
select throws_ok($$select public.read_custom_form_draft('d8500000-0000-4000-8000-000000000001','d8600000-0000-4000-8000-000000000001','d9400000-0000-4000-8000-000000000002')$$,'23514',null,'published custom version not exposed as editable draft');
select lives_ok($$select set_config('test.custom_receipt',pg_temp.custom_save()::text,true)$$,'create custom draft atomically');
select is((current_setting('test.custom_receipt')::jsonb->>'revision')::integer,1,'first revision is one');
select is(pg_temp.custom_read()->'payload',current_setting('test.custom_payload')::jsonb,'audited draft read round trips exact bounded schema');
select is(pg_temp.custom_save()->>'replayed','true','identical retry returns original receipt');
select throws_ok($$select pg_temp.custom_save(1,null,null,jsonb_set(current_setting('test.custom_payload')::jsonb,'{name}','"不同表單"'))$$,'23505',null,'different content same key rejected');
select throws_ok($$select pg_temp.custom_save(2)$$,'23505',null,'same namespace cannot create a second definition');
select throws_ok($$select pg_temp.custom_save(2,null,null,null,'d8600000-0000-4000-8000-000000000002')$$,'42501',null,'cross organization branch denied');
select throws_ok($$select pg_temp.custom_save(2,pg_temp.custom_id(),9)$$,'40001',null,'stale baseline cannot overwrite draft');
select lives_ok($$select pg_temp.custom_save(2,pg_temp.custom_id(),1,jsonb_set(current_setting('test.custom_payload')::jsonb,'{schema,fields,0,maxLength}','250'))$$,'update bounded field with baseline revision');
select is((pg_temp.custom_read()->>'revision')::integer,2,'successful update advances revision');
select is(pg_temp.custom_read()->'payload'->'schema'->'fields'->0->>'maxLength','250','saved field change is real');
select throws_ok($$select pg_temp.custom_save(3,pg_temp.custom_id(),1)$$,'40001',null,'old revision after another write is rejected');
select is(pg_temp.custom_save(2,pg_temp.custom_id(),1,jsonb_set(current_setting('test.custom_payload')::jsonb,'{schema,fields,0,maxLength}','250'))->>'replayed','true','update retry works even after baseline has advanced');
select throws_ok($$select pg_temp.custom_save(3,pg_temp.custom_id(),2,jsonb_set(current_setting('test.custom_payload')::jsonb,'{name}','"改名不可改歷史"'))$$,'23514',null,'definition identity cannot rewrite shared history');
select throws_ok($$select pg_temp.custom_save(3,null,1)$$,'22023',null,'create cannot carry existing baseline');
select throws_ok($$select pg_temp.custom_save(3,pg_temp.custom_id(),null)$$,'22023',null,'update requires exact baseline');
select throws_ok($$select pg_temp.custom_save(3,null,null,jsonb_set(current_setting('test.custom_payload')::jsonb,'{formKey}','"official.adl"'))$$,'22023',null,'official namespace cannot be created');
select throws_ok($$select pg_temp.custom_save(3,null,null,jsonb_set(current_setting('test.custom_payload')::jsonb,'{effectiveFrom}','"2026-02-30"'))$$,'22023',null,'invalid calendar day rejected by database');
select throws_ok($$select pg_temp.custom_save(3,null,null,jsonb_set(current_setting('test.custom_payload')::jsonb,'{effectiveTo}','"2026-01-01"'))$$,'22023',null,'backwards effective period rejected');
select throws_ok($$select pg_temp.custom_save(3,null,null,current_setting('test.custom_payload')::jsonb||'{"scoring":{"eval":"run()"}}')$$,'22023',null,'extra top-level executable scoring rejected');
select throws_ok($$select pg_temp.custom_save(3,null,null,jsonb_set(current_setting('test.custom_payload')::jsonb,'{schema,formula}','"run()"'))$$,'22023',null,'extra schema formula rejected');
select throws_ok($$select pg_temp.custom_save(3,null,null,jsonb_set(current_setting('test.custom_payload')::jsonb,'{schema,fields,0,label}','"<script>run()</script>"'))$$,'22023',null,'markup in labels rejected');
select throws_ok($$select pg_temp.custom_save(3,null,null,jsonb_set(current_setting('test.custom_payload')::jsonb,'{schema,fields,0,required}','null'))$$,'22023',null,'null required flag cannot bypass database checks');
select throws_ok($$select pg_temp.custom_save(3,null,null,jsonb_set(current_setting('test.custom_payload')::jsonb,'{schema,fields,0,maxLength}','1.5'))$$,'22023',null,'fractional maximum length rejected');
select throws_ok($$select pg_temp.custom_save(3,null,null,jsonb_set(current_setting('test.custom_payload')::jsonb,'{schema,fields,1,key}','"note"'))$$,'22023',null,'duplicate field code rejected');
select throws_ok($$select pg_temp.custom_save(3,null,null,jsonb_set(current_setting('test.custom_payload')::jsonb,'{schema,fields,0,key}','"constructor"'))$$,'22023',null,'prototype-reserved field code rejected');
select throws_ok($$select pg_temp.custom_save(3,null,null,jsonb_set(current_setting('test.custom_payload')::jsonb,'{schema,fields,1,minimum}','101'))$$,'22023',null,'reversed number bound rejected');
select throws_ok($$select pg_temp.custom_save(3,null,null,jsonb_set(current_setting('test.custom_payload')::jsonb,'{schema,fields,4,options}','["甲","甲"]'))$$,'22023',null,'duplicate choices rejected');
select throws_ok($$select pg_temp.custom_save(3,null,null,jsonb_set(current_setting('test.custom_payload')::jsonb,'{schema,fields}','[]'))$$,'22023',null,'empty form rejected');
select pg_temp.custom_login('aal1');
select throws_ok($$select pg_temp.custom_save(3)$$,'42501',null,'ordinary Google cannot mutate governance drafts without reauth');
select pg_temp.custom_login();
-- Disabling the organization must deny before either a draft read or a receipt
-- replay. Keep the branch, principal, membership and AAL2 evidence active so
-- this exercises the new organization guard, not unrelated admission failures.
reset role;
update public.organizations set is_active=false where id='d8500000-0000-4000-8000-000000000001';
select is((select is_active from public.branches where id='d8600000-0000-4000-8000-000000000001'),true,'disabled-organization fixture retains active branch');
select set_config('test.custom_disabled_fingerprint',pg_temp.custom_mutation_fingerprint(),true);
set local role authenticated;
select is(private.has_permission('d8500000-0000-4000-8000-000000000001',null,'forms.manage'),true,'legacy permission alone does not deny inactive organization');
select throws_ok($$select pg_temp.custom_read()$$,'42501',null,'inactive organization blocks draft read');
select throws_ok($$select pg_temp.custom_save(4,null,null,jsonb_set(current_setting('test.custom_payload')::jsonb,'{formKey}','"tenant.custom.disabled_attempt"'))$$,'42501',null,'inactive organization blocks new draft creation');
select throws_ok($$select pg_temp.custom_save(4,pg_temp.custom_id(),2)$$,'42501',null,'inactive organization blocks current-revision edit');
select throws_ok($$select pg_temp.custom_save()$$,'42501',null,'inactive organization blocks original create receipt replay');
select throws_ok($$select pg_temp.custom_save(2,pg_temp.custom_id(),1,jsonb_set(current_setting('test.custom_payload')::jsonb,'{schema,fields,0,maxLength}','250'))$$,'42501',null,'inactive organization blocks original update receipt replay');
reset role;
select is(pg_temp.custom_mutation_fingerprint(),current_setting('test.custom_disabled_fingerprint'),'denials leave all definitions versions receipts and custom audit records unchanged');
update public.organizations set is_active=true where id='d8500000-0000-4000-8000-000000000001';
set local role authenticated;
select lives_ok($$select pg_temp.custom_read()$$,'reactivated organization restores authorized draft read');
select lives_ok($$select set_config('test.custom_publication',(select request_id::text from public.request_form_publication('d8500000-0000-4000-8000-000000000001','d8600000-0000-4000-8000-000000000001',pg_temp.custom_id(),'d9100000-0000-4000-8000-000000000001')),true)$$,'new custom draft enters unchanged actual publication workflow');
select throws_ok($$select pg_temp.custom_save(3,pg_temp.custom_id(),2)$$,'23514',null,'submitted draft is locked against all edits');
select throws_ok($$select pg_temp.custom_read()$$,'23514',null,'editable read refuses submitted snapshot');
select throws_ok($$select public.approve_form_publication('d8500000-0000-4000-8000-000000000001','d8600000-0000-4000-8000-000000000001',current_setting('test.custom_publication')::uuid,'d9200000-0000-4000-8000-000000000001')$$,'42501',null,'author/requester cannot self approve');
reset role;
select is((select count(*)::integer from private.custom_form_draft_receipts),2,'only successful original create/update produce receipts');
select is((select count(*)::integer from public.audit_events where table_name='custom_form_draft' and action in ('insert','update')),2,'every successful write audited once without retry duplicate');
select ok(exists(select 1 from public.audit_events where table_name='custom_form_draft' and action='select'),'draft reads audited');
select ok(not exists(select 1 from public.audit_events where table_name='custom_form_draft' and metadata::text like '%合成%'),'audit metadata contains no label or draft content');
update private.executive_access_policy set enabled=false;
set local role authenticated;
select throws_ok($$select pg_temp.custom_save()$$,'42501',null,'revocation also blocks receipt replay');
select throws_ok($$select pg_temp.custom_read()$$,'42501',null,'revocation blocks direct read');
reset role;
select * from finish();
rollback;
