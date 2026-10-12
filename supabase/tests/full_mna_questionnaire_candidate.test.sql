begin;
select plan(72);

-- Native Google/session admission remains enabled. All identities, clients,
-- publications and responses below are synthetic and roll back together.
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
create temporary table full_baseline as
 select form_key,form_version,catalog_hash from private.questionnaire_form_catalog where form_key<>'full_mna';

select is((select count(*) from private.questionnaire_form_catalog where form_key='full_mna'),1::bigint,'one independent full candidate catalogue');
select is((select jsonb_array_length(form_snapshot->'questions') from private.questionnaire_form_catalog where form_key='full_mna'),18,'full MNA retains A through R');
select is((select rule_snapshot->>'scoreMax' from private.questionnaire_form_catalog where form_key='full_mna'),'30','full maximum is thirty');
select is((select form_snapshot->>'sourceHash' from private.questionnaire_form_catalog where form_key='full_mna'),'cd9d96d2f82fb256ce7999078428f241ac6136afe0dfd5851f3b5997c7add734','official full source identity is frozen separately');
select is((select count(*) from private.questionnaire_rule_publications where form_key='full_mna'),0::bigint,'migration invents no full MNA publication');
select ok(not has_table_privilege('authenticated','private.questionnaire_form_catalog','select,insert,update,delete'),'catalogue stays inaccessible directly');
select ok(not has_function_privilege('authenticated','private.questionnaire_calculation_pre_full_mna(text,text,jsonb,jsonb)','execute'),'original score implementation stays private');
select ok(private.questionnaire_answers_valid('full_mna',pg_temp.full_answers()),'all full choices accepted');
select ok(private.questionnaire_answers_valid('full_mna',pg_temp.full_missing()),'all missing full answers may remain a draft');
select ok(not private.questionnaire_answers_valid('full_mna',pg_temp.full_answers()-'full_meals'),'omitted answer key rejected');
select ok(not private.questionnaire_answers_valid('full_mna',pg_temp.full_answers()||'{"extra":{"state":"missing"}}'),'unknown answer key rejected');
select ok(not private.questionnaire_answers_valid('full_mna',pg_temp.full_answers()||pg_temp.full_choice('anthropometry','calf_gte_31')),'full F rejects SF calf substitute');
select ok(not private.questionnaire_answers_valid('full_mna',pg_temp.full_answers()||'{"food_intake":{"state":"not_applicable","reason":"合成"}}'),'required full question cannot become N/A');
select ok(private.questionnaire_context_valid('full_mna',pg_temp.full_missing(),'{}'),'missing measurements allowed with missing responses');
select ok(private.questionnaire_context_valid('full_mna',pg_temp.full_answers(),pg_temp.full_context()),'full BMI MAC CC and protein context can coexist');
select ok(not private.questionnaire_context_valid('full_mna',pg_temp.full_answers(),pg_temp.full_context()-'height_cm'),'answered BMI requires measured height');
select ok(not private.questionnaire_context_valid('full_mna',pg_temp.full_answers(),pg_temp.full_context()||'{"weight_kg":"50"}'),'answered BMI band must match measurement');
select ok(not private.questionnaire_context_valid('full_mna',pg_temp.full_answers(),pg_temp.full_context()-'arm_circumference_cm'),'answered Q requires measured arm');
select ok(not private.questionnaire_context_valid('full_mna',pg_temp.full_answers(),pg_temp.full_context()-'calf_circumference_cm'),'answered R requires measured calf');
select ok(not private.questionnaire_context_valid('full_mna',pg_temp.full_answers(),pg_temp.full_context()-'protein_dairy'),'answered K requires all three components');
select ok(not private.questionnaire_context_valid('full_mna',pg_temp.full_answers(),pg_temp.full_context()||'{"protein_dairy":"no"}'),'K aggregate must match component count');
select ok(not private.questionnaire_context_valid('full_mna',pg_temp.full_answers(),pg_temp.full_context()||'{"protein_dairy":"unknown"}'),'invalid protein component rejected');
select ok(not private.questionnaire_context_valid('full_mna',pg_temp.full_answers(),pg_temp.full_context()||'{"arm_circumference_cm":22}'),'measurement input remains string typed');
select ok(not private.questionnaire_context_valid('full_mna',pg_temp.full_answers(),pg_temp.full_context()||'{"score":"30"}'),'score cannot hide in context');
select is((pg_temp.full_score(pg_temp.full_answers())->>'raw')::numeric,30::numeric,'full independent maximum scores thirty');
select is((pg_temp.full_score(pg_temp.full_answers(false),pg_temp.full_context(false))->>'raw')::numeric,0::numeric,'full independent minimum scores zero');
select is((pg_temp.full_score(pg_temp.full_missing(),'{}')->>'status'),'incomplete','missing responses have no total');
select is(pg_temp.full_score(pg_temp.full_missing(),'{}')->'raw','null'::jsonb,'incomplete raw score stays null');
select is((pg_temp.full_score(pg_temp.full_answers()||pg_temp.full_choice('protein_intake','two_yes'),pg_temp.full_context()||'{"protein_dairy":"no"}')->>'raw')::numeric,29.5::numeric,'K half point is exact');
select is((pg_temp.full_score(pg_temp.full_answers()||pg_temp.full_choice('fluid_intake','three_to_five'))->>'raw')::numeric,29.5::numeric,'M half point is exact');
select is((pg_temp.full_score(pg_temp.full_answers()||pg_temp.full_choice('self_health','unknown'))->>'raw')::numeric,28.5::numeric,'P half point is exact');
select is((pg_temp.full_score(pg_temp.full_answers()||pg_temp.full_choice('arm_circumference','mac_21_lt_22'),pg_temp.full_context()||'{"arm_circumference_cm":"21"}')->>'raw')::numeric,29.5::numeric,'Q lower half point boundary is exact');
select ok(private.questionnaire_context_valid('full_mna',pg_temp.full_answers()||pg_temp.full_choice('arm_circumference','mac_21_lt_22'),pg_temp.full_context()||'{"arm_circumference_cm":"21.9"}'),'Q 21.9 stays in half point interval');
select ok(not private.questionnaire_context_valid('full_mna',pg_temp.full_answers()||pg_temp.full_choice('arm_circumference','mac_21_lt_22'),pg_temp.full_context()||'{"arm_circumference_cm":"22"}'),'Q 22 excludes half point interval');
select is((pg_temp.full_score(pg_temp.full_answers()||pg_temp.full_choice('calf_circumference','calf_lt_31'),pg_temp.full_context()||'{"calf_circumference_cm":"30.9"}')->>'raw')::numeric,29::numeric,'R below31 contributes zero rather than SF points');
select is(pg_temp.full_score(pg_temp.full_answers())->'classification'->>'key','normal_full_24_30','thirty uses full normal band');
select is(pg_temp.full_score(pg_temp.full_answers()||pg_temp.full_choice('weight_loss','greater_than_3kg')||pg_temp.full_choice('anthropometry','bmi_lt_19'),pg_temp.full_context()||'{"weight_kg":"45"}')->'classification'->>'key','normal_full_24_30','twenty four enters full normal band');
select is(pg_temp.full_score(pg_temp.full_answers()||pg_temp.full_choice('weight_loss','greater_than_3kg')||pg_temp.full_choice('anthropometry','bmi_lt_19')||pg_temp.full_choice('protein_intake','two_yes'),pg_temp.full_context()||'{"weight_kg":"45","protein_dairy":"no"}')->'classification'->>'key','at_risk_full_17_23_5','23.5 remains at risk rather than rounding up');
select is(pg_temp.full_score(pg_temp.full_answers()||pg_temp.full_choice('food_intake','severe_decrease')||pg_temp.full_choice('weight_loss','greater_than_3kg')||pg_temp.full_choice('mobility','bed_or_chair_bound')||pg_temp.full_choice('acute_stress_or_disease','yes')||pg_temp.full_choice('neuropsychological','severe')||pg_temp.full_choice('anthropometry','bmi_19_lt_21'),pg_temp.full_context()||'{"weight_kg":"50"}')->'classification'->>'key','at_risk_full_17_23_5','seventeen enters full at risk band');
select is(pg_temp.full_score(pg_temp.full_answers()||pg_temp.full_choice('food_intake','severe_decrease')||pg_temp.full_choice('weight_loss','greater_than_3kg')||pg_temp.full_choice('mobility','bed_or_chair_bound')||pg_temp.full_choice('acute_stress_or_disease','yes')||pg_temp.full_choice('neuropsychological','severe')||pg_temp.full_choice('anthropometry','bmi_19_lt_21')||pg_temp.full_choice('protein_intake','two_yes'),pg_temp.full_context()||'{"weight_kg":"50","protein_dairy":"no"}')->'classification'->>'key','malnourished_full_0_16_5','16.5 remains in lower full band');
select ok(not private.questionnaire_answers_valid('mna_sf',pg_temp.full_answers()),'full answer set does not alias to SF');
select is(private.questionnaire_calculation('mna_sf','mna-sf-revised-2009-traditional-chinese-v1',pg_temp.full_answers()-array['independent_living','prescription_drugs','pressure_sores','full_meals','protein_intake','fruit_vegetables','fluid_intake','feeding_mode','self_nutrition','self_health','arm_circumference','calf_circumference'],'{"height_cm":"160","weight_kg":"60"}')->>'raw','14','old SF integer maximum remains fourteen');
select is((select count(*) from public.questionnaire_assessment_versions),0::bigint,'score previews write no assessment records');

insert into public.organizations(id,code,name) values ('fb150000-0000-4000-8000-000000000001','full-synthetic','合成完整量表機構');
insert into public.branches(id,organization_id,code,name) values
 ('fb160000-0000-4000-8000-000000000001','fb150000-0000-4000-8000-000000000001','alpha','合成甲'),
 ('fb160000-0000-4000-8000-000000000002','fb150000-0000-4000-8000-000000000001','beta','合成乙');
insert into auth.users(id,aud,role,email,email_confirmed_at,created_at,updated_at)
select ('fb110000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'authenticated','authenticated',
 'full'||n||'@example.invalid',now()-interval '1 day',now()-interval '1 day',now() from generate_series(1,2)n;
insert into auth.identities(id,provider_id,user_id,identity_data,provider)
select ('fb120000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'full-google-'||n,
 ('fb110000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,
 jsonb_build_object('sub','full-google-'||n,'email','full'||n||'@example.invalid','email_verified',true),'google' from generate_series(1,2)n;
insert into auth.sessions(id,user_id,created_at,aal)
select ('fb130000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,
 ('fb110000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,now()-interval '3 minutes','aal2' from generate_series(1,2)n;
select set_config('test.full_oauth',floor(extract(epoch from now()-interval '2 minutes'))::text,true);
select set_config('test.full_totp',floor(extract(epoch from now()-interval '30 seconds'))::text,true);
insert into auth.mfa_amr_claims(id,session_id,created_at,updated_at,authentication_method)
select ('fb140000-0000-4000-8000-'||lpad((n*10+m)::text,12,'0'))::uuid,
 ('fb130000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,
 to_timestamp(current_setting(case when m=1 then 'test.full_oauth' else 'test.full_totp' end)::bigint),
 to_timestamp(current_setting(case when m=1 then 'test.full_oauth' else 'test.full_totp' end)::bigint),
 case when m=1 then 'oauth' else 'totp' end from generate_series(1,2)n cross join generate_series(1,2)m;
insert into public.profiles(id,display_name,kind)
select ('fb110000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'合成管理員'||n,'staff' from generate_series(1,2)n;
insert into public.memberships(id,organization_id,branch_id,profile_id,status,starts_at)
select ('fb170000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'fb150000-0000-4000-8000-000000000001',
 'fb160000-0000-4000-8000-000000000001',('fb110000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'active',now()-interval '1 day' from generate_series(1,2)n;
insert into public.membership_roles(membership_id,role_id)
select ('fb170000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,r.id from generate_series(1,2)n cross join public.roles r where r.role_key=case when n=1 then 'organization_manager' else 'nurse' end and r.is_system;
insert into private.staff_google_access_grants(allowed_user_id,organization_id,company_email_domain,allowed_email,google_subject,enabled,approval_reference)
select ('fb110000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'fb150000-0000-4000-8000-000000000001','example.invalid',
 'full'||n||'@example.invalid','full-google-'||n,true,'synthetic explicit approval' from generate_series(1,2)n;
insert into private.reauth_challenges(id,user_id,session_id,nonce_sha256,idempotency_key,issued_jwt_iat,created_at,expires_at,
 consumed_at,consumed_jwt_iat,factor_method,factor_verified_at)
select ('fb190000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,('fb110000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,
 ('fb130000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,repeat(n::text,64),gen_random_uuid(),
 now()-interval '2 minutes',now()-interval '2 minutes',now()+interval '5 minutes',
 now()-interval '30 seconds',now()-interval '30 seconds','totp',to_timestamp(current_setting('test.full_totp')::bigint) from generate_series(1,2)n;
insert into private.reauth_events(user_id,session_id,challenge_id,aal,verification_method,verified_at)
select user_id,session_id,id,'aal2','totp',factor_verified_at from private.reauth_challenges where id::text like 'fb190000%';
insert into public.clients(id,organization_id,branch_id,client_code,display_name,status,admitted_on) values
 ('fb180000-0000-4000-8000-000000000001','fb150000-0000-4000-8000-000000000001','fb160000-0000-4000-8000-000000000001','FULL-1','合成甲個案','active',current_date-300),
 ('fb180000-0000-4000-8000-000000000002','fb150000-0000-4000-8000-000000000001','fb160000-0000-4000-8000-000000000001','FULL-2','合成乙個案','active',current_date-300),
 ('fb180000-0000-4000-8000-000000000003','fb150000-0000-4000-8000-000000000001','fb160000-0000-4000-8000-000000000002','FULL-3','合成跨分支個案','active',current_date-300);
create temporary table full_receipts(label text primary key,receipt jsonb); grant select,insert on full_receipts to authenticated;
create function pg_temp.full_login(n integer default 1) returns void language plpgsql as $$
begin
 perform set_config('request.jwt.claims',jsonb_build_object('sub','fb110000-0000-4000-8000-'||lpad(n::text,12,'0'),
 'session_id','fb130000-0000-4000-8000-'||lpad(n::text,12,'0'),'role','authenticated','aud','authenticated','aal','aal2','is_anonymous',false,
 'email','full'||n||'@example.invalid','iat',floor(extract(epoch from clock_timestamp())), 'exp',floor(extract(epoch from clock_timestamp()+interval '30 minutes')),
 'amr',jsonb_build_array(jsonb_build_object('method','oauth','timestamp',current_setting('test.full_oauth')::bigint),
  jsonb_build_object('method','totp','timestamp',current_setting('test.full_totp')::bigint)))::text,true);
end; $$;
create function pg_temp.full_create(a jsonb default pg_temp.full_answers(),c jsonb default pg_temp.full_context(),client text default 'fb180000-0000-4000-8000-000000000001') returns jsonb language sql as $$
 select jsonb_build_object('action','create','client_id',client,'form_key','full_mna','form_version','full-mna-chinese-amended-2023-v1','assessed_on',current_date,'answers',a,'context',c);
$$;
create function pg_temp.full_transition(action text,base text) returns jsonb language sql as $$
 select jsonb_build_object('action',action,'client_id','fb180000-0000-4000-8000-000000000001','form_key','full_mna',
 'assessment_key',receipt->>'assessmentKey','previous_version_id',receipt->>'versionId','expected_version',(receipt->>'version')::integer)
 from full_receipts where label=base;
$$;
create function pg_temp.full_write(body jsonb,n integer) returns jsonb language sql as $$
 select public.mutate_questionnaire_assessment('fb150000-0000-4000-8000-000000000001','fb160000-0000-4000-8000-000000000001',body,
 ('fb1e0000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid);
$$;
create function pg_temp.full_workspace(client uuid default 'fb180000-0000-4000-8000-000000000001',version uuid default null) returns jsonb language sql as $$
 select public.questionnaire_assessment_workspace_snapshot('fb150000-0000-4000-8000-000000000001','fb160000-0000-4000-8000-000000000001','full_mna',client,version,null,false,1);
$$;

select pg_temp.full_login();
select is(private.questionnaire_assessment_authority('fb150000-0000-4000-8000-000000000001','fb160000-0000-4000-8000-000000000001','fb180000-0000-4000-8000-000000000001','full_mna','manage'),private.questionnaire_assessment_authority('fb150000-0000-4000-8000-000000000001','fb160000-0000-4000-8000-000000000001','fb180000-0000-4000-8000-000000000001','mna_sf','manage'),'full reuses exactly the existing nutrition authority');
set local role authenticated;
select ok(public.is_staff_login_allowed(),'real approved Google admission is required and satisfied');
insert into full_receipts values('missing',pg_temp.full_write(pg_temp.full_create(pg_temp.full_missing(),'{}'),1));
select is((select receipt->>'recordState' from full_receipts where label='missing'),'draft','incomplete full answers save ordinary draft');
select throws_ok($$select pg_temp.full_write(pg_temp.full_transition('submit','missing'),2)$$,'22023',null,'missing full answers cannot submit');
insert into full_receipts values('complete',pg_temp.full_write(pg_temp.full_create()||pg_temp.full_transition('revise','missing'),3));
select is((select receipt->>'version' from full_receipts where label='complete'),'2','full revision appends version two');
select is(jsonb_array_length(pg_temp.full_workspace()->'history'->0->'versions'),2,'full history contains both versions');
select is((select c->'latest'->>'isLatest' from jsonb_array_elements(pg_temp.full_workspace('fb180000-0000-4000-8000-000000000001',(select (receipt->>'versionId')::uuid from full_receipts where label='missing'))->'clients') c where c->>'clientId'='fb180000-0000-4000-8000-000000000001'),'false','historical full version is read only');
insert into full_receipts values('other',pg_temp.full_write(pg_temp.full_create(pg_temp.full_answers(),pg_temp.full_context(),'fb180000-0000-4000-8000-000000000002'),4));
select ok(not exists(select 1 from jsonb_array_elements(pg_temp.full_workspace()->'clients') c where c->>'clientId'='fb180000-0000-4000-8000-000000000002' and c->'latest'<>'null'::jsonb),'same branch roster omits another client answer payload');
select throws_ok($$select pg_temp.full_workspace('fb180000-0000-4000-8000-000000000001',(select (receipt->>'versionId')::uuid from full_receipts where label='other'))$$,'42501',null,'same branch exact version cannot leak another client');
select throws_ok($$select pg_temp.full_workspace('fb180000-0000-4000-8000-000000000003')$$,'42501',null,'another branch full scope denied');
select throws_ok($$select pg_temp.full_write(pg_temp.full_create()||'{"score":30}',5)$$,'22023',null,'full draft cannot accept supplied score');
insert into full_receipts values('submitted',pg_temp.full_write(pg_temp.full_transition('submit','complete'),6));
select is((select receipt->>'recordState' from full_receipts where label='submitted'),'submitted','complete full candidate can submit without clinical approval');
select throws_ok($$select pg_temp.full_write(pg_temp.full_transition('sign','submitted'),7)$$,'55000',null,'full sign fails before independent publication');
insert into full_receipts values('pending-rule',public.publish_questionnaire_rule('fb150000-0000-4000-8000-000000000001','fb160000-0000-4000-8000-000000000001',
 jsonb_build_object('action','request','form_key','full_mna','form_version','full-mna-chinese-amended-2023-v1','effective_from',current_date-365,'evidence_reference','合成候選待審核'),gen_random_uuid()));
select is((select receipt->>'status' from full_receipts where label='pending-rule'),'pending','rule request records pending only');
select throws_ok($$select pg_temp.full_write(pg_temp.full_transition('sign','submitted'),7)$$,'55000',null,'pending publication cannot sign');
select throws_ok($$select public.publish_questionnaire_rule('fb150000-0000-4000-8000-000000000001','fb160000-0000-4000-8000-000000000001',jsonb_build_object('action','approve','publication_id',(select receipt->>'publicationId' from full_receipts where label='pending-rule')),gen_random_uuid())$$,'42501',null,'requestor cannot approve own full rule');
reset role;
select is((select count(*) from private.questionnaire_rule_publications where form_key='full_mna' and approved_by is not null),0::bigint,'test does not manufacture clinical approval');
select is((select count(*) from public.questionnaire_assessment_versions where form_key='full_mna' and record_state='signed'),0::bigint,'candidate records are never signed automatically');
select is((select count(*) from full_baseline b join private.questionnaire_form_catalog c using(form_key,form_version,catalog_hash)),9::bigint,'all nine original catalogue identities remain unchanged');
select throws_ok($$update private.questionnaire_form_catalog set rule_snapshot='{}' where form_key='full_mna'$$,'55000',null,'full candidate rule remains immutable');
select throws_ok($$update public.questionnaire_assessment_versions set context='{}' where form_key='full_mna'$$,'55000',null,'full response history remains append only');
select ok(not has_function_privilege('anon','public.mutate_questionnaire_assessment(uuid,uuid,jsonb,uuid)','execute'),'anonymous callers gain no full draft permission');
select ok(not has_table_privilege('service_role','public.questionnaire_assessment_versions','select,insert,update,delete'),'service role gains no direct full record access');
select pg_temp.full_login(2); set local role authenticated;
select ok(public.is_staff_login_allowed(),'assigned nurse uses real native Google admission');
select throws_ok($$select pg_temp.full_workspace()$$,'42501',null,'nutrition permission alone cannot read an unassigned full case');
reset role;
insert into public.client_assignments(organization_id,branch_id,client_id,assignee_user_id,assignment_kind,starts_at)
 values('fb150000-0000-4000-8000-000000000001','fb160000-0000-4000-8000-000000000001',
 'fb180000-0000-4000-8000-000000000001','fb110000-0000-4000-8000-000000000002','synthetic-full',now()-interval '1 day');
set local role authenticated;
select is(pg_temp.full_workspace()->>'matchingTotal','1','assigned nurse receives only assigned full roster');
select throws_ok($$select pg_temp.full_workspace('fb180000-0000-4000-8000-000000000002')$$,'42501',null,'same branch unassigned full case stays denied');
reset role;
update public.client_assignments set ends_at=clock_timestamp()-interval '1 second'
 where assignee_user_id='fb110000-0000-4000-8000-000000000002';
set local role authenticated;
select throws_ok($$select pg_temp.full_workspace()$$,'42501',null,'expired assignment removes full questionnaire access');
reset role;
select set_config('request.jwt.claims','{}',true); set local role authenticated;
select throws_ok($$select pg_temp.full_workspace()$$,'42501',null,'full workspace fails closed without native Google admission');
reset role;
select * from finish();
rollback;
