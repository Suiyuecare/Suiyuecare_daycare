begin;
select plan(43);
insert into auth.users(id,aud,role,email,email_confirmed_at,created_at,updated_at) values
 ('b0100000-0000-4000-8000-000000000001','authenticated','authenticated','diary-owner@example.invalid',now()-interval '1 day',now()-interval '1 day',now());
insert into auth.identities(id,provider_id,user_id,identity_data,provider) values
 ('b0200000-0000-4000-8000-000000000001','synthetic-diary-owner','b0100000-0000-4000-8000-000000000001','{"sub":"synthetic-diary-owner","email":"diary-owner@example.invalid","email_verified":true}','google');
insert into auth.sessions(id,user_id,created_at,aal) values
 ('b0300000-0000-4000-8000-000000000001','b0100000-0000-4000-8000-000000000001',now()-interval '3 minutes','aal2');
select set_config('test.diary_amr',floor(extract(epoch from clock_timestamp()-interval '2 minutes'))::text,true);
insert into auth.mfa_amr_claims(id,session_id,created_at,updated_at,authentication_method)
select gen_random_uuid(),'b0300000-0000-4000-8000-000000000001',to_timestamp(current_setting('test.diary_amr')::bigint),to_timestamp(current_setting('test.diary_amr')::bigint),method from unnest(array['oauth','totp']) method;
insert into public.organizations(id,code,name) values('b0500000-0000-4000-8000-000000000001','diary-lifecycle','Synthetic diary organization');
insert into public.branches(id,organization_id,code,name) values('b0600000-0000-4000-8000-000000000001','b0500000-0000-4000-8000-000000000001','main','Synthetic branch');
insert into public.profiles(id,display_name,kind) values('b0100000-0000-4000-8000-000000000001','Synthetic diary owner','staff');
insert into public.memberships(id,organization_id,profile_id,status,starts_at) values('b0700000-0000-4000-8000-000000000001','b0500000-0000-4000-8000-000000000001','b0100000-0000-4000-8000-000000000001','active',now()-interval '1 day');
insert into public.membership_roles(membership_id,role_id) values('b0700000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000002');
insert into public.clients(id,organization_id,branch_id,client_code,display_name,status,admitted_on) values('b0800000-0000-4000-8000-000000000001','b0500000-0000-4000-8000-000000000001','b0600000-0000-4000-8000-000000000001','SYN-DIARY','Synthetic client','active',current_date-10);
insert into private.executive_access_policy(allowed_user_id,allowed_email,google_subject,enabled,approval_reference) values('b0100000-0000-4000-8000-000000000001','diary-owner@example.invalid','synthetic-diary-owner',true,'Synthetic test approval');
insert into private.reauth_challenges(id,user_id,session_id,nonce_sha256,idempotency_key,issued_jwt_iat,issued_jwt_jti,created_at,expires_at,consumed_at,consumed_jwt_iat,consumed_jwt_jti,factor_method,factor_verified_at)
values('b1100000-0000-4000-8000-000000000001','b0100000-0000-4000-8000-000000000001','b0300000-0000-4000-8000-000000000001',repeat('b',64),gen_random_uuid(),clock_timestamp()-interval '2 minutes','before',clock_timestamp()-interval '1 minute',clock_timestamp()+interval '4 minutes',clock_timestamp()-interval '30 seconds',clock_timestamp()-interval '30 seconds','after','totp',clock_timestamp()-interval '30 seconds');
insert into private.reauth_events(user_id,session_id,challenge_id,aal,verification_method,verified_at)
select user_id,session_id,id,'aal2','totp',factor_verified_at from private.reauth_challenges where id='b1100000-0000-4000-8000-000000000001';
create function pg_temp.diary_snapshot() returns jsonb language sql security invoker as $$
 select public.care_diary_snapshot('b0500000-0000-4000-8000-000000000001','b0600000-0000-4000-8000-000000000001','b0800000-0000-4000-8000-000000000001'); $$;
create function pg_temp.diary_action(p_action text,p_key integer,p_version integer default null,p_fields jsonb default null,p_reason text default null) returns jsonb language plpgsql security invoker as $$
declare v_record jsonb;
begin
 v_record:=pg_temp.diary_snapshot()->'records'->0;
 return public.mutate_care_diary('b0500000-0000-4000-8000-000000000001','b0600000-0000-4000-8000-000000000001',p_action,(v_record->>'id')::uuid,coalesce(p_version,(v_record->>'version')::integer),p_fields,p_reason,('b0900000-0000-4000-8000-'||lpad(p_key::text,12,'0'))::uuid);
end; $$;
select ok(not has_table_privilege('authenticated','private.care_diary_operations','select,insert,update,delete'),'operation receipts are not exposed');
select ok(not has_function_privilege('anon','public.mutate_care_diary(uuid,uuid,text,uuid,integer,jsonb,text,uuid)','execute'),'anonymous cannot mutate');
select ok(not has_table_privilege('authenticated','public.care_records','insert,update,delete'),'direct DML remains denied');
select ok(private.care_diary_fields_valid('{"shift":"morning","care_item":"care","note":"observed","abnormal":false,"observations":{"meal":{"state":"unknown"},"water":{"state":"observed","value":0},"toileting":{"state":"not_applicable"},"activity":{"state":"unknown"}}}'),'zero observed water differs from unknown and NA');
select ok(not private.care_diary_fields_valid('{"shift":"morning","care_item":"care","note":"observed","abnormal":false,"observations":{"meal":{"state":"unknown","value":"all"},"water":{"state":"unknown"},"toileting":{"state":"unknown"},"activity":{"state":"unknown"}}}'),'unknown cannot carry a fabricated observed value');
set local role authenticated;
select set_config('request.jwt.claims',jsonb_build_object('sub','b0100000-0000-4000-8000-000000000001','session_id','b0300000-0000-4000-8000-000000000001','aud','authenticated','role','authenticated','aal','aal2','email','diary-owner@example.invalid','is_anonymous',false,'iat',floor(extract(epoch from clock_timestamp())),'exp',floor(extract(epoch from clock_timestamp()+interval '30 minutes')),'amr',jsonb_build_array(jsonb_build_object('method','oauth','timestamp',current_setting('test.diary_amr')::bigint),jsonb_build_object('method','totp','timestamp',current_setting('test.diary_amr')::bigint)))::text,true);
select ok(public.is_executive_login_allowed(),'real admission is enforced with synthetic pinned Google identity');
select lives_ok($$select * from public.record_care_diary_quick_draft('b0500000-0000-4000-8000-000000000001','b0600000-0000-4000-8000-000000000001','b0800000-0000-4000-8000-000000000001',now()-interval '1 hour','{"shift":"morning","care_item":"care","note":"observed","abnormal":false,"observations":{"meal":{"state":"unknown"},"water":{"state":"observed","value":100},"toileting":{"state":"not_applicable"},"activity":{"state":"unknown"}}}','b1000000-0000-4000-8000-000000000001')$$,'quick draft creates atomically');
select is(pg_temp.diary_snapshot()->'records'->0->>'status','draft','new diary is draft');
select throws_ok($$select pg_temp.diary_action('sign',1)$$,'23514','diary transition is not permitted','cannot skip submission');
select throws_ok($$select pg_temp.diary_action('edit',2,99,'{"shift":"morning","care_item":"care","note":"edited","abnormal":false}')$$,'40001','diary version conflict','stale write is rejected');
select is(pg_temp.diary_action('edit',3,null,'{"shift":"morning","care_item":"care","note":"edited","abnormal":false}')->'record'->>'version','2','edit creates revision');
select is(jsonb_array_length(pg_temp.diary_snapshot()->'records'),1,'one event has one current diary');
select is(jsonb_array_length(pg_temp.diary_snapshot()->'history'),2,'old revision retained');
select is((public.mutate_care_diary('b0500000-0000-4000-8000-000000000001','b0600000-0000-4000-8000-000000000001','edit',
 (pg_temp.diary_snapshot()->'history'->0->>'id')::uuid,1,'{"shift":"morning","care_item":"care","note":"edited","abnormal":false}',null,
 'b0900000-0000-4000-8000-000000000003')->>'replayed')::boolean,true,'identical operation replays after the current version advanced');
select throws_ok($$select public.mutate_care_diary('b0500000-0000-4000-8000-000000000001','b0600000-0000-4000-8000-000000000001','edit',
 (pg_temp.diary_snapshot()->'history'->0->>'id')::uuid,1,'{"shift":"morning","care_item":"care","note":"different","abnormal":false}',null,
 'b0900000-0000-4000-8000-000000000003')$$,'23505','diary idempotency conflict','same key different content is blocked');
select is(jsonb_array_length(pg_temp.diary_snapshot()->'history'),2,'failed or replayed operations create no additional revision');
select is(pg_temp.diary_action('submit',4)->'record'->>'status','submitted','submission is not a signature');
select is(pg_temp.diary_snapshot()->'records'->0->'signed_at','null'::jsonb,'submitted remains unsigned');
select throws_ok($$select pg_temp.diary_action('reopen',11,null,null,'')$$,'22023','correction reason is required','return to draft needs a reason');
select is(pg_temp.diary_action('reopen',12,null,null,'Fix draft before signing')->'record'->>'status','draft','submitted may return to a new draft without a signature');
select is(pg_temp.diary_action('submit',13)->'record'->>'status','submitted','returned draft can be resubmitted');
select throws_ok($$select pg_temp.diary_action('edit',5,null,'{"shift":"morning","care_item":"care","note":"overwrite","abnormal":false}')$$,'23514','diary transition is not permitted','submitted content is frozen');
select is(pg_temp.diary_action('sign',6)->'record'->>'status','signed','explicit sign finalizes');
select ok(pg_temp.diary_snapshot()->'records'->0->>'content_hash' ~ '^[a-f0-9]{64}$','signature stores content hash');
select throws_ok($$select pg_temp.diary_action('reopen',14,null,null,'Try to overwrite signed')$$,'23514','diary transition is not permitted','signed records cannot use the return-to-draft shortcut');
select throws_ok($$select pg_temp.diary_action('correct',7,null,null,' ')$$,'22023','correction reason is required','correction requires reason');
select is(pg_temp.diary_action('correct',8,null,null,'Correct same event observation')->'record'->>'status','draft','correction starts unsigned');
select is(pg_temp.diary_snapshot()->'records'->0->'signed_by','null'::jsonb,'correction does not copy signer');
select is(jsonb_array_length(pg_temp.diary_snapshot()->'records'),1,'correction does not create another service event');
select is(pg_temp.diary_action('submit',9)->'record'->>'status','submitted','correction requires resubmission');
select is(pg_temp.diary_action('sign',10)->'record'->>'status','corrected','correction has independent signature');
select is(jsonb_array_length(pg_temp.diary_snapshot()->'records'),1,'all edit submit sign and correction steps still count one current event');
select throws_ok($$select public.care_diary_snapshot('b0500000-0000-4000-8000-000000000001','b0600000-0000-4000-8000-000000000099','b0800000-0000-4000-8000-000000000001')$$,'42501','diary read is not permitted','cross branch direct RPC denied');
-- An explicitly concerning observation may be saved as an incomplete draft,
-- but completion must never silently lose the worker's concern.
select lives_ok($$select * from public.record_care_diary_quick_draft('b0500000-0000-4000-8000-000000000001','b0600000-0000-4000-8000-000000000001','b0800000-0000-4000-8000-000000000001',now()-interval '1 minute','{"shift":"morning","care_item":"concern","note":"","abnormal":false,"observations":{"meal":{"state":"unknown"},"water":{"state":"unknown"},"toileting":{"state":"observed","value":"concern"},"activity":{"state":"unknown"}}}','b1000000-0000-4000-8000-000000000002')$$,'incomplete concerning observation can be kept as draft');
select throws_ok($$select pg_temp.diary_action('submit',20)$$,'23514','diary completion fields are missing','concern cannot complete without note, follow-up and human abnormal confirmation');
select lives_ok($$select pg_temp.diary_action('edit',21,null,'{"shift":"morning","care_item":"concern","note":"Specific observed concern","abnormal":true,"observations":{"meal":{"state":"unknown"},"water":{"state":"unknown"},"toileting":{"state":"observed","value":"concern"},"activity":{"state":"unknown"}}}')$$,'concern draft allows incremental completion');
select throws_ok($$select pg_temp.diary_action('submit',22)$$,'23514','diary completion fields are missing','concern still needs follow-up');
select lives_ok($$select pg_temp.diary_action('edit',23,null,'{"shift":"morning","care_item":"concern","note":"Specific observed concern","follow_up":"Inform responsible nurse","abnormal":false,"observations":{"meal":{"state":"unknown"},"water":{"state":"unknown"},"toileting":{"state":"observed","value":"concern"},"activity":{"state":"unknown"}}}')$$,'note and follow-up can be saved without automatic abnormal inference');
select throws_ok($$select pg_temp.diary_action('submit',24)$$,'23514','diary completion fields are missing','human must explicitly confirm abnormal flag, not inferred by code');
select lives_ok($$select pg_temp.diary_action('edit',25,null,'{"shift":"morning","care_item":"concern","note":"Specific observed concern","follow_up":"Inform responsible nurse","abnormal":true,"observations":{"meal":{"state":"unknown"},"water":{"state":"unknown"},"toileting":{"state":"observed","value":"concern"},"activity":{"state":"unknown"}}}')$$,'fully reviewed concerning observation remains a draft until submitted');
select is(pg_temp.diary_action('submit',26)->'record'->>'status','submitted','complete concern can be submitted');
reset role;
insert into public.roles(id,organization_id,role_key,name,is_active) values
 ('b1200000-0000-4000-8000-000000000001','b0500000-0000-4000-8000-000000000001','inactive_signature_fixture','Synthetic inactive role',false),
 ('b1200000-0000-4000-8000-000000000002','b0500000-0000-4000-8000-000000000001','future_signature_fixture','Synthetic future role',true);
insert into public.membership_roles(membership_id,role_id,assigned_at) values
 ('b0700000-0000-4000-8000-000000000001','b1200000-0000-4000-8000-000000000001',now()-interval '1 day'),
 ('b0700000-0000-4000-8000-000000000001','b1200000-0000-4000-8000-000000000002',now()+interval '1 day');
set local role authenticated;
select is(pg_temp.diary_action('sign',27)->'record'->>'status','signed','properly reviewed concern receives a real signature');
reset role;
select is((select data->'signature_evidence'->'roles' from public.care_records where category='staff/daily-care/care-diary' order by created_at desc,version desc limit 1), '["organization_manager"]'::jsonb,'signature evidence excludes inactive roles and future assignments');
select * from finish();
rollback;
