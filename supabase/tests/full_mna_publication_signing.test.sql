begin;
select plan(28);

-- Isolated synthetic local regression only. No authority functions are replaced,
-- no hosted data is accessed, and every identity, publication and result rolls back.
create function pg_temp.full_answers(p_best boolean default true) returns jsonb language sql as $$
 select jsonb_object_agg(k,jsonb_build_object('state','answered','value',case when p_best then best else worst end))
 from (values
  ('food_intake','no_decrease','severe_decrease'),
  ('weight_loss','no_weight_loss','greater_than_3kg'),
  ('mobility','goes_out','bed_or_chair_bound'),
  ('acute_stress_or_disease','no','yes'),
  ('neuropsychological','none','severe'),
  ('anthropometry','bmi_gte_23','bmi_lt_19'),
  ('independent_living','yes','no'),
  ('prescription_drugs','no','yes'),
  ('pressure_sores','no','yes'),
  ('full_meals','three','one'),
  ('protein_intake','three_yes','zero_or_one_yes'),
  ('fruit_vegetables','yes','no'),
  ('fluid_intake','gt_five','lt_three'),
  ('feeding_mode','self_without_difficulty','needs_help'),
  ('self_nutrition','no_problem','malnourished'),
  ('self_health','better','worse'),
  ('arm_circumference','mac_gte_22','mac_lt_21'),
  ('calf_circumference','calf_gte_31','calf_lt_31')
 ) a(k,best,worst);
$$;
create function pg_temp.full_context(p_best boolean default true) returns jsonb language sql as $$
 select case when p_best then
  '{"height_cm":"160","weight_kg":"60","arm_circumference_cm":"22","calf_circumference_cm":"31","protein_dairy":"yes","protein_legumes_eggs":"yes","protein_meat_fish_poultry":"yes"}'::jsonb
 else
  '{"height_cm":"160","weight_kg":"45","arm_circumference_cm":"20.9","calf_circumference_cm":"30.9","protein_dairy":"no","protein_legumes_eggs":"no","protein_meat_fish_poultry":"no"}'::jsonb end;
$$;
create function pg_temp.full_choice(k text,v text) returns jsonb language sql as $$
 select jsonb_build_object(k,jsonb_build_object('state','answered','value',v));
$$;
create function pg_temp.full_missing() returns jsonb language sql as $$
 select jsonb_object_agg(key,'{"state":"missing"}'::jsonb) from jsonb_each(pg_temp.full_answers());
$$;
create function pg_temp.full_score(a jsonb,c jsonb default pg_temp.full_context()) returns jsonb language sql as $$
 select private.questionnaire_calculation('full_mna','full-mna-chinese-amended-2023-v1',a,c);
$$;

insert into public.organizations(id,code,name) values ('fc150000-0000-4000-8000-000000000001','full-synthetic','合成完整量表機構');
insert into public.branches(id,organization_id,code,name) values
 ('fc160000-0000-4000-8000-000000000001','fc150000-0000-4000-8000-000000000001','alpha','合成甲'),
 ('fc160000-0000-4000-8000-000000000002','fc150000-0000-4000-8000-000000000001','beta','合成乙');
insert into auth.users(id,aud,role,email,email_confirmed_at,created_at,updated_at)
select ('fc110000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'authenticated','authenticated',
 'full'||n||'@example.invalid',now()-interval '1 day',now()-interval '1 day',now() from generate_series(1,2)n;
insert into auth.identities(id,provider_id,user_id,identity_data,provider)
select ('fc120000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'full-google-'||n,
 ('fc110000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,
 jsonb_build_object('sub','full-google-'||n,'email','full'||n||'@example.invalid','email_verified',true),'google' from generate_series(1,2)n;
insert into auth.sessions(id,user_id,created_at,aal)
select ('fc130000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,
 ('fc110000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,now()-interval '3 minutes','aal2' from generate_series(1,2)n;
select set_config('test.full_oauth',floor(extract(epoch from now()-interval '2 minutes'))::text,true);
select set_config('test.full_totp',floor(extract(epoch from now()-interval '30 seconds'))::text,true);
insert into auth.mfa_amr_claims(id,session_id,created_at,updated_at,authentication_method)
select ('fc140000-0000-4000-8000-'||lpad((n*10+m)::text,12,'0'))::uuid,
 ('fc130000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,
 to_timestamp(current_setting(case when m=1 then 'test.full_oauth' else 'test.full_totp' end)::bigint),
 to_timestamp(current_setting(case when m=1 then 'test.full_oauth' else 'test.full_totp' end)::bigint),
 case when m=1 then 'oauth' else 'totp' end from generate_series(1,2)n cross join generate_series(1,2)m;
insert into public.profiles(id,display_name,kind)
select ('fc110000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'合成管理員'||n,'staff' from generate_series(1,2)n;
insert into public.memberships(id,organization_id,branch_id,profile_id,status,starts_at)
select ('fc170000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'fc150000-0000-4000-8000-000000000001',
 'fc160000-0000-4000-8000-000000000001',('fc110000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'active',now()-interval '1 day' from generate_series(1,2)n;
insert into public.membership_roles(membership_id,role_id)
select ('fc170000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,r.id from generate_series(1,2)n cross join public.roles r where r.role_key='organization_manager' and r.is_system;
insert into private.staff_google_access_grants(allowed_user_id,organization_id,company_email_domain,allowed_email,google_subject,enabled,approval_reference)
select ('fc110000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'fc150000-0000-4000-8000-000000000001','example.invalid',
 'full'||n||'@example.invalid','full-google-'||n,true,'synthetic explicit approval' from generate_series(1,2)n;
insert into private.reauth_challenges(id,user_id,session_id,nonce_sha256,idempotency_key,issued_jwt_iat,created_at,expires_at,
 consumed_at,consumed_jwt_iat,factor_method,factor_verified_at)
select ('fc190000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,('fc110000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,
 ('fc130000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,repeat(n::text,64),gen_random_uuid(),
 now()-interval '2 minutes',now()-interval '2 minutes',now()+interval '5 minutes',
 now()-interval '30 seconds',now()-interval '30 seconds','totp',to_timestamp(current_setting('test.full_totp')::bigint) from generate_series(1,2)n;
insert into private.reauth_events(user_id,session_id,challenge_id,aal,verification_method,verified_at)
select user_id,session_id,id,'aal2','totp',factor_verified_at from private.reauth_challenges where id::text like 'fc190000%';
insert into public.clients(id,organization_id,branch_id,client_code,display_name,status,admitted_on) values
 ('fc180000-0000-4000-8000-000000000001','fc150000-0000-4000-8000-000000000001','fc160000-0000-4000-8000-000000000001','FULL-1','合成甲個案','active',current_date-300),
 ('fc180000-0000-4000-8000-000000000002','fc150000-0000-4000-8000-000000000001','fc160000-0000-4000-8000-000000000001','FULL-2','合成乙個案','active',current_date-300),
 ('fc180000-0000-4000-8000-000000000003','fc150000-0000-4000-8000-000000000001','fc160000-0000-4000-8000-000000000002','FULL-3','合成跨分支個案','active',current_date-300);
create temporary table full_receipts(label text primary key,receipt jsonb); grant select,insert on full_receipts to authenticated;
create function pg_temp.full_login(n integer default 1) returns void language plpgsql as $$
begin
 perform set_config('request.jwt.claims',jsonb_build_object('sub','fc110000-0000-4000-8000-'||lpad(n::text,12,'0'),
 'session_id','fc130000-0000-4000-8000-'||lpad(n::text,12,'0'),'role','authenticated','aud','authenticated','aal','aal2','is_anonymous',false,
 'email','full'||n||'@example.invalid','iat',floor(extract(epoch from clock_timestamp())), 'exp',floor(extract(epoch from clock_timestamp()+interval '30 minutes')),
 'amr',jsonb_build_array(jsonb_build_object('method','oauth','timestamp',current_setting('test.full_oauth')::bigint),
  jsonb_build_object('method','totp','timestamp',current_setting('test.full_totp')::bigint)))::text,true);
end; $$;
create function pg_temp.full_create(a jsonb default pg_temp.full_answers(),c jsonb default pg_temp.full_context(),client text default 'fc180000-0000-4000-8000-000000000001') returns jsonb language sql as $$
 select jsonb_build_object('action','create','client_id',client,'form_key','full_mna','form_version','full-mna-chinese-amended-2023-v1','assessed_on',current_date,'answers',a,'context',c);
$$;
create function pg_temp.full_transition(action text,base text) returns jsonb language sql as $$
 select jsonb_build_object('action',action,'client_id','fc180000-0000-4000-8000-000000000001','form_key','full_mna',
 'assessment_key',receipt->>'assessmentKey','previous_version_id',receipt->>'versionId','expected_version',(receipt->>'version')::integer)
 from full_receipts where label=base;
$$;
create function pg_temp.full_write(body jsonb,n integer) returns jsonb language sql as $$
 select public.mutate_questionnaire_assessment('fc150000-0000-4000-8000-000000000001','fc160000-0000-4000-8000-000000000001',body,
 ('fc1e0000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid);
$$;
create function pg_temp.full_workspace(client uuid default 'fc180000-0000-4000-8000-000000000001',version uuid default null) returns jsonb language sql as $$
 select public.questionnaire_assessment_workspace_snapshot('fc150000-0000-4000-8000-000000000001','fc160000-0000-4000-8000-000000000001','full_mna',client,version,null,false,1);
$$;



-- Both identities use real native Google admission and consumed TOTP evidence.
-- This isolated synthetic publication is not a clinical release or human approval.
create function pg_temp.full_selected() returns jsonb language sql as $$
 select c from jsonb_array_elements(pg_temp.full_workspace()->'clients') c
 where c->>'clientId'='fc180000-0000-4000-8000-000000000001';
$$;
select pg_temp.full_login(1);
set local role authenticated;
select ok(public.is_staff_login_allowed(),'synthetic requester satisfies native Google admission');
insert into full_receipts values('draft',pg_temp.full_write(pg_temp.full_create(),1));
select is((select receipt->>'recordState' from full_receipts where label='draft'),'draft','full candidate saves a complete draft');
insert into full_receipts values('submitted',pg_temp.full_write(pg_temp.full_transition('submit','draft'),2));
select is((select receipt->>'recordState' from full_receipts where label='submitted'),'submitted','full candidate submits through guarded action');
select throws_ok($$select pg_temp.full_write(pg_temp.full_transition('sign','submitted'),3)$$,'55000',null,'absence of publication still blocks full signature');
insert into full_receipts values('pending-rule',public.publish_questionnaire_rule('fc150000-0000-4000-8000-000000000001','fc160000-0000-4000-8000-000000000001',
 jsonb_build_object('action','request','form_key','full_mna','form_version','full-mna-chinese-amended-2023-v1','effective_from',current_date-365,'evidence_reference','SYNTHETIC ROLLBACK ONLY - full MNA regression'),
 'fc1f0000-0000-4000-8000-000000000001'));
select is((select receipt->>'status' from full_receipts where label='pending-rule'),'pending','synthetic request does not self-publish');
select throws_ok($$select public.publish_questionnaire_rule('fc150000-0000-4000-8000-000000000001','fc160000-0000-4000-8000-000000000001',jsonb_build_object('action','approve','publication_id',(select receipt->>'publicationId' from full_receipts where label='pending-rule')),'fc1f0000-0000-4000-8000-000000000002')$$,'42501',null,'same requester cannot approve own full rule');
select throws_ok($$select pg_temp.full_write(pg_temp.full_transition('sign','submitted'),3)$$,'55000',null,'pending rule still blocks full signature');
select pg_temp.full_login(2);
select ok(public.is_staff_login_allowed(),'independent approver satisfies native Google admission');
insert into full_receipts values('approved-rule',public.publish_questionnaire_rule('fc150000-0000-4000-8000-000000000001','fc160000-0000-4000-8000-000000000001',
 jsonb_build_object('action','approve','publication_id',(select receipt->>'publicationId' from full_receipts where label='pending-rule')),'fc1f0000-0000-4000-8000-000000000002'));
select is((select receipt->>'status' from full_receipts where label='approved-rule'),'approved','independent second identity approves full rule');
select pg_temp.full_login(1);
select ok((pg_temp.full_selected()->'latest'->>'ruleAvailable')::boolean,'exact selected client sees approved full rule');
select ok((pg_temp.full_workspace()->>'canSign')::boolean,'full sign authority remains reachable without bypass');
select set_config('request.jwt.claims',(current_setting('request.jwt.claims')::jsonb||'{"aal":"aal1"}'::jsonb)::text,true);
select throws_ok($$select pg_temp.full_write(pg_temp.full_transition('sign','submitted'),3)$$,'42501',null,'approved rule does not waive AAL2 signature requirement');
reset role;
-- Two additional native sessions: one lacks any reauthentication evidence;
-- one has genuine consumed evidence whose factor is older than 15 minutes.
insert into auth.sessions(id,user_id,created_at,aal)
select ('fc130000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,
 'fc110000-0000-4000-8000-000000000001',now()-interval '30 minutes','aal2' from generate_series(3,4)n;
insert into auth.mfa_amr_claims(id,session_id,created_at,updated_at,authentication_method)
select gen_random_uuid(),('fc130000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,
 to_timestamp(current_setting(case when m=1 then 'test.full_oauth' else 'test.full_totp' end)::bigint),
 to_timestamp(current_setting(case when m=1 then 'test.full_oauth' else 'test.full_totp' end)::bigint),
 case when m=1 then 'oauth' else 'totp' end from generate_series(3,4)n cross join generate_series(1,2)m;
insert into private.reauth_challenges(id,user_id,session_id,nonce_sha256,idempotency_key,issued_jwt_iat,created_at,expires_at,
 consumed_at,consumed_jwt_iat,factor_method,factor_verified_at)
values('fc190000-0000-4000-8000-000000000004','fc110000-0000-4000-8000-000000000001',
 'fc130000-0000-4000-8000-000000000004',repeat('4',64),gen_random_uuid(),now()-interval '25 minutes',
 now()-interval '25 minutes',now()-interval '15 minutes',now()-interval '20 minutes',now()-interval '20 minutes','totp',now()-interval '20 minutes');
insert into private.reauth_events(user_id,session_id,challenge_id,aal,verification_method,verified_at)
select user_id,session_id,id,'aal2','totp',factor_verified_at from private.reauth_challenges where id='fc190000-0000-4000-8000-000000000004';
select pg_temp.full_login(1);
select set_config('request.jwt.claims',(current_setting('request.jwt.claims')::jsonb||'{"session_id":"fc130000-0000-4000-8000-000000000003"}'::jsonb)::text,true);
set local role authenticated;
select ok(public.is_staff_login_allowed(),'native fresh-factor session without reauth remains admitted');
select throws_ok($$select pg_temp.full_write(pg_temp.full_transition('sign','submitted'),3)$$,'42501',null,'another sessions proof cannot authorize current full signature');
select set_config('request.jwt.claims',(current_setting('request.jwt.claims')::jsonb||'{"session_id":"fc130000-0000-4000-8000-000000000004"}'::jsonb)::text,true);
select ok(public.is_staff_login_allowed(),'expired questionnaire evidence does not impersonate admission failure');
select throws_ok($$select pg_temp.full_write(pg_temp.full_transition('sign','submitted'),3)$$,'42501',null,'old consumed same-session factor cannot sign full questionnaire');
select pg_temp.full_login(1);
insert into full_receipts values('signed-max',pg_temp.full_write(pg_temp.full_transition('sign','submitted'),3));
select is((select receipt->>'recordState' from full_receipts where label='signed-max'),'signed','recent AAL2 and independent publication allow full signature');
select is((pg_temp.full_selected()->'latest'->'resultSnapshot'->>'raw')::numeric,30::numeric,'exact selected signed maximum remains thirty');
insert into full_receipts values('half-draft',pg_temp.full_write(pg_temp.full_create(pg_temp.full_answers()||pg_temp.full_choice('fluid_intake','three_to_five')),4));
select is((select receipt->>'recordState' from full_receipts where label='half-draft'),'draft','fractional full assessment begins separate draft');
insert into full_receipts values('half-submit',pg_temp.full_write(pg_temp.full_transition('submit','half-draft'),5));
select is((select receipt->>'recordState' from full_receipts where label='half-submit'),'submitted','fractional full assessment submits');
insert into full_receipts values('half-sign',pg_temp.full_write(pg_temp.full_transition('sign','half-submit'),6));
select is((select receipt->>'recordState' from full_receipts where label='half-sign'),'signed','fractional full assessment signs through original public action');
select is((pg_temp.full_selected()->'latest'->'resultSnapshot'->>'raw')::numeric,29.5::numeric,'signed Full raw snapshot preserves half point');
select is((pg_temp.full_selected()->'latest'->'resultSnapshot'->>'adjusted')::numeric,29.5::numeric,'signed Full adjusted snapshot never rounds to integer');
select is(pg_temp.full_selected()->'latest'->'resultSnapshot'->'classification'->>'key','normal_full_24_30','signed classification uses Full thirty-point bands');
select is(pg_temp.full_selected()->'latest'->'formSnapshot'->>'sourceHash','cd9d96d2f82fb256ce7999078428f241ac6136afe0dfd5851f3b5997c7add734','signed form retains exact official source identity');
select is(pg_temp.full_workspace()->>'historyTotal','2','both signed full episodes remain in exact client history');
reset role;
select is((select count(*) from private.questionnaire_rule_publications where form_key='full_mna' and requested_by<>approved_by and approved_reauth<>requested_reauth),1::bigint,'publication retains distinct identities and consumed proofs');
select is((select count(*) from public.questionnaire_assessment_versions where form_key='full_mna' and record_state='signed'),2::bigint,'only explicit guarded signatures create signed test records');
select * from finish();
rollback;

