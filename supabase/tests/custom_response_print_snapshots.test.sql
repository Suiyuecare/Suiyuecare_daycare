begin;
select plan(67);
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


insert into public.clients(id,organization_id,branch_id,client_code,display_name) values
 ('d9500000-0000-4000-8000-000000000001','d8500000-0000-4000-8000-000000000001','d8600000-0000-4000-8000-000000000001','synthetic','合成個案'),
 ('d9500000-0000-4000-8000-000000000002','d8500000-0000-4000-8000-000000000002','d8600000-0000-4000-8000-000000000002','other','他機構合成個案');
select set_config('test.response_input',jsonb_build_object('action','save','formVersionId','d9400000-0000-4000-8000-000000000002',
 'previousId',null,'baseRevision',null,'serviceDate',(now() at time zone 'Asia/Taipei')::date,'answers','{}'::jsonb,'reason',null)::text,true);
create function pg_temp.response_save(n integer, p_input jsonb default null, client_id uuid default 'd9500000-0000-4000-8000-000000000001') returns jsonb language sql security invoker as $$
 select public.write_custom_form_response('d8500000-0000-4000-8000-000000000001','d8600000-0000-4000-8000-000000000001',client_id,
 ('d9600000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,coalesce(p_input,current_setting('test.response_input')::jsonb));$$;
create function pg_temp.response_read() returns jsonb language sql security invoker as $$
 select public.read_custom_form_responses('d8500000-0000-4000-8000-000000000001','d8600000-0000-4000-8000-000000000001','d9500000-0000-4000-8000-000000000001');$$;

-- Additional in-tenant branch and peer actor are synthetic; neither receives
-- authority from an email address or JWT metadata.
insert into public.branches(id,organization_id,code,name) values
 ('d8600000-0000-4000-8000-000000000003','d8500000-0000-4000-8000-000000000001','second','合成第二分支');
insert into public.clients(id,organization_id,branch_id,client_code,display_name) values
 ('d9500000-0000-4000-8000-000000000003','d8500000-0000-4000-8000-000000000001','d8600000-0000-4000-8000-000000000003','second','合成第二分支個案');
insert into auth.users(id,aud,role,email,email_confirmed_at,created_at,updated_at) values
 ('d8100000-0000-4000-8000-000000000003','authenticated','authenticated','print-peer@example.invalid',now(),now(),now());
insert into public.profiles(id,display_name,kind) values ('d8100000-0000-4000-8000-000000000003','合成其他員工','staff');
create function pg_temp.print_prepare(n integer default 1, response_id uuid default null,
 client_id uuid default 'd9500000-0000-4000-8000-000000000001',
 branch_id uuid default 'd8600000-0000-4000-8000-000000000001',
 organization_id uuid default 'd8500000-0000-4000-8000-000000000001') returns jsonb language sql as $$
 select public.prepare_custom_response_print(organization_id,branch_id,client_id,
 coalesce(response_id,(current_setting('test.print_source')::jsonb->'record'->>'id')::uuid),
 ('da100000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid);$$;
create function pg_temp.print_read(j jsonb default null, h text default null) returns jsonb language sql as $$
 select public.read_custom_response_print('d8500000-0000-4000-8000-000000000001','d8600000-0000-4000-8000-000000000001',
 (coalesce(j,current_setting('test.print_job')::jsonb)->>'jobId')::uuid,
 coalesce(h,coalesce(j,current_setting('test.print_job')::jsonb)->>'snapshotHash'));$$;

select ok((select relrowsecurity and relforcerowsecurity from pg_class where oid='private.custom_response_print_jobs'::regclass),'print snapshot table forced RLS');
select ok(not has_table_privilege('authenticated','private.custom_response_print_jobs','select,insert,update,delete'),'authenticated cannot bypass print RPC');
select ok(not has_table_privilege('service_role','private.custom_response_print_jobs','select,insert,update,delete'),'service role cannot bypass print RPC');
select ok(not has_function_privilege('anon','public.prepare_custom_response_print(uuid,uuid,uuid,uuid,uuid)','execute'),'anonymous prepare forbidden');
select ok(not has_function_privilege('service_role','public.read_custom_response_print(uuid,uuid,uuid,text)','execute'),'service role read forbidden');
select ok(not (select prosecdef from pg_proc where oid='public.prepare_custom_response_print(uuid,uuid,uuid,uuid,uuid)'::regprocedure),'public prepare is invoker');
select ok(not (select prosecdef from pg_proc where oid='public.read_custom_response_print(uuid,uuid,uuid,text)'::regprocedure),'public read is invoker');

select pg_temp.custom_login();
set local role authenticated;
select set_config('test.print_source',pg_temp.response_save(1,current_setting('test.response_input')::jsonb||
 '{"answers":{"note":{"state":"answered","value":"合成列印答案"},"count":{"state":"answered","value":0},"yes":{"state":"answered","value":false},"day":{"state":"missing"},"choice":{"state":"not_applicable","reason":"合成情境"}}}')::text,true);
select lives_ok($$select set_config('test.print_job',pg_temp.print_prepare()::text,true)$$,'save draft print snapshot');
select is(current_setting('test.print_job')::jsonb->>'replayed','false','first prepare not replayed');
select is(current_setting('test.print_job')::jsonb->'snapshot'->'response',current_setting('test.print_source')::jsonb->'record','entire draft response exactly matches saved version');
select is(current_setting('test.print_job')::jsonb->'snapshot'->>'clientName','合成個案','authorized client name present');
select is(current_setting('test.print_job')::jsonb->'snapshot'->>'formKey','tenant.custom.historical','real custom namespace preserved');
select ok(not(current_setting('test.print_job')::jsonb->'snapshot' ?| array['nationalId','dateOfBirth','email','phone']),'unnecessary identifiers not included');
select is((current_setting('test.print_job')::jsonb->>'expiresAt')::timestamptz-(current_setting('test.print_job')::jsonb->>'createdAt')::timestamptz,interval '5 minutes','five minute link TTL is server-controlled');
select is(pg_temp.print_prepare()-'replayed',current_setting('test.print_job')::jsonb-'replayed','retry reuses immutable job including original expiry');
select is(pg_temp.print_prepare()->>'replayed','true','retry marked replayed');
select is(pg_temp.print_read()-'replayed',current_setting('test.print_job')::jsonb-'replayed','download reads exact stored snapshot');
select lives_ok($$select pg_temp.print_read()$$,'repeated authorized read allowed without extending TTL');
select throws_ok($$select pg_temp.print_read(null,repeat('f',64))$$,'42501',null,'forged snapshot hash refused');
select throws_ok($$select pg_temp.print_read(null,'not-a-hash')$$,'22023',null,'malformed hash refused');
select throws_ok($$select pg_temp.print_prepare(1,'da200000-0000-4000-8000-000000000099')$$,'23505',null,'same actor/key different response rejected');
select throws_ok($$select pg_temp.print_prepare(2,null,'d9500000-0000-4000-8000-000000000002')$$,'42501',null,'foreign tenant client rejected');
select throws_ok($$select pg_temp.print_prepare(2,null,'d9500000-0000-4000-8000-000000000001','d8600000-0000-4000-8000-000000000003')$$,'42501',null,'client/branch mismatch rejected');
select throws_ok($$select public.read_custom_response_print('d8500000-0000-4000-8000-000000000002','d8600000-0000-4000-8000-000000000002',(current_setting('test.print_job')::jsonb->>'jobId')::uuid,current_setting('test.print_job')::jsonb->>'snapshotHash')$$,'42501',null,'foreign tenant read rejected');
select set_config('request.jwt.claims',jsonb_set(current_setting('request.jwt.claims')::jsonb,'{sub}','"d8100000-0000-4000-8000-000000000003"')::text,true);
select throws_ok($$select pg_temp.print_read()$$,'42501',null,'different requester cannot use job/hash');
select pg_temp.custom_login('aal1');
select throws_ok($$select pg_temp.print_prepare()$$,'42501',null,'AAL1 cannot replay export even if previously prepared');
select throws_ok($$select pg_temp.print_read()$$,'42501',null,'AAL1 cannot download');
select pg_temp.custom_login();
reset role;
select is((select count(*)::integer from private.custom_response_print_jobs),1,'idempotency creates one immutable snapshot');
select is((select count(*)::integer from public.audit_events where table_name='custom_response_print_jobs' and action='export' and metadata->>'operation'='read_authorization_check'),2,'two snapshot reads record two access checks, not two completed downloads');
select ok(not exists(select 1 from public.audit_events where table_name='custom_response_print_jobs' and metadata->>'operation' in ('download','download_success','render_success')),'read RPC never claims rendering or browser download succeeded');
select ok(not exists(select 1 from public.audit_events where table_name='custom_response_print_jobs' and metadata::text ~ '合成|answers|clientName|preparedByName'),'audit metadata contains no names or answers');
select throws_ok($$update private.custom_response_print_jobs set snapshot='{}'$$,'23514',null,'stored snapshot cannot be rewritten');
select throws_ok($$delete from private.custom_response_print_jobs$$,'23514',null,'stored snapshot cannot be deleted');

update private.executive_access_policy set enabled=false;
set local role authenticated;
select throws_ok($$select pg_temp.print_prepare()$$,'42501',null,'revoked Google admission rejects receipt replay');
select throws_ok($$select pg_temp.print_read()$$,'42501',null,'revoked Google admission rejects download');
reset role;
update private.executive_access_policy set enabled=true;
update auth.sessions set not_after=clock_timestamp()-interval '1 second' where id='d8300000-0000-4000-8000-000000000001';
set local role authenticated;
select throws_ok($$select pg_temp.print_prepare()$$,'42501',null,'expired session rejects receipt replay');
select throws_ok($$select pg_temp.print_read()$$,'42501',null,'expired session rejects download');
reset role;
update auth.sessions set not_after=null where id='d8300000-0000-4000-8000-000000000001';
update private.reauth_events set revoked_at=clock_timestamp() where user_id='d8100000-0000-4000-8000-000000000001';
set local role authenticated;
select throws_ok($$select pg_temp.print_prepare()$$,'42501',null,'revoked second factor rejects receipt replay');
select throws_ok($$select pg_temp.print_read()$$,'42501',null,'revoked second factor rejects download');
reset role;
update private.reauth_events set revoked_at=null where user_id='d8100000-0000-4000-8000-000000000001';
delete from public.role_permissions where role_id='10000000-0000-4000-8000-000000000002' and permission_id in(select id from public.permissions where permission_key='document_printing.access');
set local role authenticated;
select throws_ok($$select pg_temp.print_prepare()$$,'42501',null,'removed print permission rejects replay');
select throws_ok($$select pg_temp.print_read()$$,'42501',null,'removed print permission rejects download');
reset role;
insert into public.role_permissions(role_id,permission_id) select '10000000-0000-4000-8000-000000000002',id from public.permissions where permission_key='document_printing.access';
delete from public.role_permissions where role_id='10000000-0000-4000-8000-000000000002' and permission_id in(select id from public.permissions where permission_key='document_printing.manage');
set local role authenticated;
select throws_ok($$select pg_temp.print_prepare()$$,'42501',null,'prepare still requires manage permission on replay');
select lives_ok($$select pg_temp.print_read()$$,'already prepared download needs access but not manage');
reset role;
insert into public.role_permissions(role_id,permission_id) select '10000000-0000-4000-8000-000000000002',id from public.permissions where permission_key='document_printing.manage';
update public.role_permissions set granted_at=clock_timestamp()+interval '1 minute' where role_id='10000000-0000-4000-8000-000000000002' and permission_id in(select id from public.permissions where permission_key='document_printing.read');
set local role authenticated;
select throws_ok($$select pg_temp.print_prepare()$$,'42501',null,'not-yet-effective print read grant rejects replay');
select throws_ok($$select pg_temp.print_read()$$,'42501',null,'not-yet-effective print read grant rejects download');
reset role;
update public.role_permissions set granted_at=clock_timestamp()-interval '1 minute' where role_id='10000000-0000-4000-8000-000000000002' and permission_id in(select id from public.permissions where permission_key='document_printing.read');
delete from public.role_permissions where role_id='10000000-0000-4000-8000-000000000002' and permission_id in(select id from public.permissions where permission_key='care_records.read');
set local role authenticated;
select throws_ok($$select pg_temp.print_prepare()$$,'42501',null,'document permissions alone cannot expose care response');
select throws_ok($$select pg_temp.print_read()$$,'42501',null,'download still needs care read');
reset role;
insert into public.role_permissions(role_id,permission_id) select '10000000-0000-4000-8000-000000000002',id from public.permissions where permission_key='care_records.read';
update public.branches set is_active=false where id='d8600000-0000-4000-8000-000000000001';
set local role authenticated;
select throws_ok($$select pg_temp.print_prepare()$$,'42501',null,'closed branch rejects exact replay');
select throws_ok($$select pg_temp.print_read()$$,'42501',null,'closed branch rejects download');
reset role;
update public.branches set is_active=true where id='d8600000-0000-4000-8000-000000000001';
-- Switch this same actual authenticated principal to assignment-limited scope.
delete from public.role_permissions where role_id='10000000-0000-4000-8000-000000000002' and permission_id in(select id from public.permissions where permission_key='clients.view_all');
insert into public.client_assignments(organization_id,branch_id,client_id,assignee_user_id,assignment_kind,starts_at)
 values('d8500000-0000-4000-8000-000000000001','d8600000-0000-4000-8000-000000000001','d9500000-0000-4000-8000-000000000001','d8100000-0000-4000-8000-000000000001','synthetic-print',clock_timestamp()-interval '1 day');
set local role authenticated;
select lives_ok($$select pg_temp.print_prepare()$$,'authorized client assignment can export');
select throws_ok($$select pg_temp.print_prepare(2,null,'d9500000-0000-4000-8000-000000000003','d8600000-0000-4000-8000-000000000003')$$,'42501',null,'unassigned client in another branch denied');
reset role;
update public.client_assignments set ends_at=clock_timestamp()-interval '1 millisecond' where assignment_kind='synthetic-print';
set local role authenticated;
select throws_ok($$select pg_temp.print_prepare()$$,'42501',null,'wall-clock expired assignment rejects exact replay');
select throws_ok($$select pg_temp.print_read()$$,'42501',null,'wall-clock expired assignment rejects download');
reset role;
update public.client_assignments set ends_at=null where assignment_kind='synthetic-print';
update public.memberships set ends_at=clock_timestamp()-interval '1 millisecond' where id='d8700000-0000-4000-8000-000000000001';
set local role authenticated;
select throws_ok($$select pg_temp.print_prepare()$$,'42501',null,'wall-clock expired membership rejects exact replay');
reset role;
update public.memberships set ends_at=null where id='d8700000-0000-4000-8000-000000000001';
-- Seed a pre-expired immutable synthetic job; never disable immutable triggers.
insert into private.custom_response_print_jobs(organization_id,branch_id,client_id,response_id,actor_id,reauth_challenge_id,idempotency_key,request_hash,snapshot,snapshot_hash,created_at,expires_at)
 select organization_id,branch_id,client_id,response_id,actor_id,reauth_challenge_id,'da100000-0000-4000-8000-000000000099',request_hash,snapshot,snapshot_hash,clock_timestamp()-interval '6 minutes',clock_timestamp()-interval '1 minute' from private.custom_response_print_jobs limit 1;
select set_config('test.print_expired',(select private.custom_response_print_json(j,false)::text from private.custom_response_print_jobs j where idempotency_key='da100000-0000-4000-8000-000000000099'),true);
set local role authenticated;
select throws_ok($$select pg_temp.print_prepare(99)$$,'55000',null,'expired prepare receipt cannot be revived');
select throws_ok($$select pg_temp.print_read(current_setting('test.print_expired')::jsonb)$$,'55000',null,'expired snapshot cannot be downloaded');

select set_config('test.print_signed',pg_temp.response_save(2,current_setting('test.response_input')::jsonb||jsonb_build_object('action','sign','answers',null,'previousId',current_setting('test.print_source')::jsonb->'record'->'id','baseRevision',1))::text,true);
select lives_ok($$select set_config('test.print_signed_job',pg_temp.print_prepare(2,(current_setting('test.print_signed')::jsonb->'record'->>'id')::uuid)::text,true)$$,'signed response gets separate immutable snapshot');
select is(current_setting('test.print_signed_job')::jsonb->'snapshot'->'response',current_setting('test.print_signed')::jsonb->'record','signed snapshot includes exact original signature evidence');
select is(pg_temp.print_read()->'snapshot'->'response'->>'status','draft','old draft job is not silently upgraded after signing');
select is(pg_temp.print_prepare(3)->'snapshot'->'response',current_setting('test.print_source')::jsonb->'record','historical draft remains printable without rewriting it');
select is(pg_temp.print_read(current_setting('test.print_signed_job')::jsonb)->'snapshot'->'response'->'answers'->'count'->'value','0'::jsonb,'zero survives signed export');
select is(pg_temp.print_read(current_setting('test.print_signed_job')::jsonb)->'snapshot'->'response'->'answers'->'yes'->'value','false'::jsonb,'false survives signed export');
select is(pg_temp.print_read(current_setting('test.print_signed_job')::jsonb)->'snapshot'->'response'->'answers'->'day'->>'state','missing','missing remains distinct in signed export');
select is(pg_temp.print_read(current_setting('test.print_signed_job')::jsonb)->'snapshot'->'response'->'answers'->'choice'->>'state','not_applicable','NA remains distinct in signed export');
reset role;
select is((select count(*)::integer from private.custom_form_responses),2,'export never mutates response history');
select ok(not exists(select 1 from private.custom_response_print_jobs where snapshot_hash<>encode(sha256(convert_to(snapshot::text,'UTF8')),'hex')),'all stored snapshot hashes match immutable content');
select ok(not exists(select 1 from pg_constraint fk where fk.conrelid='private.custom_response_print_jobs'::regclass and fk.contype='f'
 and not exists(select 1 from pg_index i where i.indrelid=fk.conrelid and i.indisvalid and i.indkey::smallint[] @> fk.conkey)),'all print job foreign keys indexed');
select * from finish();
rollback;
