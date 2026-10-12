begin;
select plan(54);
select ok(not has_table_privilege('authenticated','private.questionnaire_form_catalog','select,insert,update,delete'), 'catalogue has no direct browser access');
select ok(not has_table_privilege('service_role','private.questionnaire_rule_publications','select,insert,update,delete'), 'service role cannot manufacture publication approvals');
select is((select count(*) from private.questionnaire_form_catalog),10::bigint,'all ten question catalogues available, including independent full MNA');
select is((select count(*) from private.questionnaire_rule_publications),0::bigint,'migration invents no clinical rule approvals');
select ok(not has_function_privilege('authenticated','private.mutate_questionnaire_assessment_draft_v1(uuid,uuid,jsonb,uuid)','execute'),'legacy draft mutator cannot bypass signed state');
select ok(not exists(select 1 from public.roles r join public.role_permissions rp on rp.role_id=r.id join public.permissions p on p.id=rp.permission_id where r.role_key='care_worker' and p.permission_key like 'questionnaire_%.sign'),'care worker cannot sign professional questionnaire results');
select is((select count(*) from public.roles r join public.role_permissions rp on rp.role_id=r.id join public.permissions p on p.id=rp.permission_id
 where r.role_key='branch_director' and r.is_system and p.permission_key like 'questionnaire_%'),18::bigint,'director has the eighteen scoped read, manage and sign capabilities for all nine forms');
select is((select count(*) from public.roles r join public.role_permissions rp on rp.role_id=r.id join public.permissions p on p.id=rp.permission_id
 where r.role_key='care_worker' and r.is_system and p.permission_key like 'questionnaire_%'),4::bigint,'care worker retains only the original ADL and fall draft permissions');

insert into public.organizations(id,code,name) values ('c1500000-0000-4000-8000-000000000001','q-life','合成評估機構');
insert into public.branches(id,organization_id,code,name) values
 ('c1600000-0000-4000-8000-000000000001','c1500000-0000-4000-8000-000000000001','alpha','合成分支甲'),
 ('c1600000-0000-4000-8000-000000000002','c1500000-0000-4000-8000-000000000001','beta','合成分支乙');
insert into auth.users(id,aud,role,email,email_confirmed_at,created_at,updated_at)
select ('c1100000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'authenticated','authenticated',
 'q'||n||'@example.invalid',now()-interval '1 day',now()-interval '1 day',now() from generate_series(1,3)n;
insert into auth.identities(id,provider_id,user_id,identity_data,provider)
select ('c1200000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'q-google-'||n,
 ('c1100000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,
 jsonb_build_object('sub','q-google-'||n,'email','q'||n||'@example.invalid','email_verified',true),'google' from generate_series(1,3)n;
insert into auth.sessions(id,user_id,created_at,aal)
select ('c1300000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,
 ('c1100000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,now()-interval '3 minutes','aal2' from generate_series(1,3)n;
select set_config('test.q_oauth',floor(extract(epoch from now()-interval '2 minutes'))::text,true);
select set_config('test.q_totp',floor(extract(epoch from now()-interval '30 seconds'))::text,true);
insert into auth.mfa_amr_claims(id,session_id,created_at,updated_at,authentication_method)
select ('c1400000-0000-4000-8000-'||lpad((n*10+m)::text,12,'0'))::uuid,
 ('c1300000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,
 to_timestamp(current_setting(case when m=1 then 'test.q_oauth' else 'test.q_totp' end)::bigint),
 to_timestamp(current_setting(case when m=1 then 'test.q_oauth' else 'test.q_totp' end)::bigint),
 case when m=1 then 'oauth' else 'totp' end from generate_series(1,3)n cross join generate_series(1,2)m;
insert into public.profiles(id,display_name,kind)
select ('c1100000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'合成治理員'||n,'staff' from generate_series(1,3)n;
insert into public.memberships(id,organization_id,branch_id,profile_id,status,starts_at)
select ('c1700000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'c1500000-0000-4000-8000-000000000001',
 'c1600000-0000-4000-8000-000000000001',('c1100000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'active',now()-interval '1 day' from generate_series(1,3)n;
insert into public.membership_roles(membership_id,role_id)
select ('c1700000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,r.id from generate_series(1,2)n cross join public.roles r where r.role_key='organization_manager' and r.is_system;
insert into public.membership_roles(membership_id,role_id)
select 'c1700000-0000-4000-8000-000000000003',r.id from public.roles r where r.role_key='branch_director' and r.is_system;
insert into private.staff_google_access_grants(allowed_user_id,organization_id,company_email_domain,allowed_email,google_subject,enabled,approval_reference)
select ('c1100000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'c1500000-0000-4000-8000-000000000001','example.invalid',
 'q'||n||'@example.invalid','q-google-'||n,true,'合成權限審核'||n from generate_series(1,3)n;
insert into private.reauth_challenges(id,user_id,session_id,nonce_sha256,idempotency_key,issued_jwt_iat,created_at,expires_at,
 consumed_at,consumed_jwt_iat,factor_method,factor_verified_at)
select ('c1900000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,('c1100000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,
 ('c1300000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,repeat(n::text,64),
 ('c1910000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,now()-interval '2 minutes',now()-interval '2 minutes',now()+interval '5 minutes',
 now()-interval '30 seconds',now()-interval '30 seconds','totp',to_timestamp(current_setting('test.q_totp')::bigint) from generate_series(1,3)n;
insert into private.reauth_events(user_id,session_id,challenge_id,aal,verification_method,verified_at)
select user_id,session_id,id,'aal2','totp',factor_verified_at from private.reauth_challenges where id::text like 'c1900000%';
insert into public.clients(id,organization_id,branch_id,client_code,display_name,status,admitted_on) values
 ('c1800000-0000-4000-8000-000000000001','c1500000-0000-4000-8000-000000000001','c1600000-0000-4000-8000-000000000001','Q-1','合成個案甲','active',current_date-300),
 ('c1800000-0000-4000-8000-000000000002','c1500000-0000-4000-8000-000000000001','c1600000-0000-4000-8000-000000000002','Q-2','合成跨分支個案','active',current_date-300);
create temporary table q_receipts(label text primary key,receipt jsonb); grant select,insert on q_receipts to authenticated;
create function pg_temp.q_login(n integer,level text default 'aal2') returns void language plpgsql as $$
begin
 perform set_config('request.jwt.claim.sub','',true); perform set_config('request.jwt.claim.role','',true);
 perform set_config('request.jwt.claims',jsonb_build_object('sub','c1100000-0000-4000-8000-'||lpad(n::text,12,'0'),
 'session_id','c1300000-0000-4000-8000-'||lpad(n::text,12,'0'),'role','authenticated','aud','authenticated','aal',level,'is_anonymous',false,
 'email','q'||n||'@example.invalid','iat',floor(extract(epoch from clock_timestamp())), 'exp',floor(extract(epoch from clock_timestamp()+interval '30 minutes')),
 'amr',jsonb_build_array(jsonb_build_object('method','oauth','timestamp',current_setting('test.q_oauth')::bigint))
  ||case when level='aal2' then jsonb_build_array(jsonb_build_object('method','totp','timestamp',current_setting('test.q_totp')::bigint)) else '[]'::jsonb end)::text,true);
end; $$;
create function pg_temp.q_create(day date,complete boolean default true) returns jsonb language sql as $$
 select jsonb_build_object('action','create','client_id','c1800000-0000-4000-8000-000000000001','form_key','spmsq',
 'form_version','spmsq-pfeiffer-10-education-adjusted-v1','assessed_on',day,
 'answers',(select jsonb_object_agg('spmsq_'||lpad(n::text,2,'0'),case when not complete and n=1 then '{"state":"missing"}'::jsonb else '{"state":"answered","value":"correct"}'::jsonb end) from generate_series(1,10)n),
 'context','{"education_adjustment":"grade_school_or_less"}'::jsonb);
$$;
create function pg_temp.q_transition(action text,base text) returns jsonb language sql as $$
 select jsonb_build_object('action',action,'client_id','c1800000-0000-4000-8000-000000000001','form_key','spmsq',
 'assessment_key',receipt->>'assessmentKey','previous_version_id',receipt->>'versionId','expected_version',(receipt->>'version')::integer)
 from q_receipts where label=base;
$$;
create function pg_temp.q_write(body jsonb,n integer) returns jsonb language sql as $$
 select public.mutate_questionnaire_assessment('c1500000-0000-4000-8000-000000000001','c1600000-0000-4000-8000-000000000001',body,
 ('c1e00000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid);
$$;
create function pg_temp.q_rules(body jsonb,n integer) returns jsonb language sql as $$
 select public.publish_questionnaire_rule('c1500000-0000-4000-8000-000000000001','c1600000-0000-4000-8000-000000000001',body,
 ('c1f00000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid);
$$;
create function pg_temp.q_workspace(version uuid default null,month date default null,new_assessment boolean default false) returns jsonb language sql as $$
 select public.questionnaire_assessment_workspace_snapshot('c1500000-0000-4000-8000-000000000001','c1600000-0000-4000-8000-000000000001','spmsq',
 'c1800000-0000-4000-8000-000000000001',version,month,new_assessment,1);
$$;

select pg_temp.q_login(1,'aal1'); set local role authenticated;
select ok(public.is_staff_login_allowed(),'approved Google AAL1 user can start assessments');
insert into q_receipts values('incomplete',pg_temp.q_write(pg_temp.q_create(current_date,false),1));
select is((select receipt->>'recordState' from q_receipts where label='incomplete'),'draft','partial answers save a draft');
select throws_ok($$select pg_temp.q_write(pg_temp.q_transition('submit','incomplete'),2)$$,'22023',null,'missing answer cannot be submitted');
insert into q_receipts values('current',pg_temp.q_write(pg_temp.q_create(current_date),3));
insert into q_receipts values('past',pg_temp.q_write(pg_temp.q_create((date_trunc('month',current_date)-interval '1 month')::date),4));
select isnt((select receipt->>'assessmentKey' from q_receipts where label='current'),(select receipt->>'assessmentKey' from q_receipts where label='past'),'same case monthly assessments retain independent episode IDs');
select is((pg_temp.q_workspace(null,(date_trunc('month',current_date)-interval '1 month')::date)->'clients'->0->'latest'->>'versionId'),(select receipt->>'versionId' from q_receipts where label='past'),'monthly deep link selects that month, not newer assessment');
select is(pg_temp.q_workspace(null,(date_trunc('month',current_date)-interval '2 months')::date)->'clients'->0->'latest','null'::jsonb,'empty month never falls back to another month');
select is(pg_temp.q_workspace(null,null,true)->'clients'->0->'latest','null'::jsonb,'new assessment explicitly starts empty');
select is((pg_temp.q_workspace()->>'historyTotal')::integer,3,'history lists separate episodes');
select pg_temp.q_login(3,'aal1');
select ok((select bool_and((public.questionnaire_assessment_workspace_snapshot('c1500000-0000-4000-8000-000000000001',
 'c1600000-0000-4000-8000-000000000001',form,'c1800000-0000-4000-8000-000000000001',null,null,false,1)->>'canSign')::boolean)
 from unnest(array['spmsq','gds_15','barthel_adl','lawton_iadl','eat10_swallowing',
 'bsrs5','fall_risk_taipei_115','nsi_determine','mna_sf']) form),'director can read/manage/sign every one of the nine forms in their own branch');
select throws_ok($$select public.questionnaire_assessment_workspace_snapshot('c1500000-0000-4000-8000-000000000001',
 'c1600000-0000-4000-8000-000000000002','spmsq','c1800000-0000-4000-8000-000000000002',null,null,false,1)$$,
 '42501',null,'director assessment permissions never expand to another branch');
select throws_ok($$select public.questionnaire_rule_governance_snapshot('c1500000-0000-4000-8000-000000000001',
 'c1600000-0000-4000-8000-000000000001')$$,'42501',null,'clinical director duties do not invent rule publication authority');
insert into q_receipts values('director-draft',pg_temp.q_write(pg_temp.q_create(current_date-1),20));
select is((select receipt->>'recordState' from q_receipts where label='director-draft'),'draft','director can actually create an assessment using approved Google AAL1');
select pg_temp.q_login(1,'aal1');
insert into q_receipts values('submitted',pg_temp.q_write(pg_temp.q_transition('submit','current')||jsonb_build_object('follow_up_due_on',current_date+30),5));
select is((select receipt->>'recordState' from q_receipts where label='submitted'),'submitted','complete AAL1 assessment is submitted without fake score approval');
select throws_ok($$select pg_temp.q_write(pg_temp.q_transition('sign','submitted'),6)$$,'42501',null,'AAL1 cannot sign');
select throws_ok($$select pg_temp.q_rules('{"action":"request","form_key":"spmsq","form_version":"spmsq-pfeiffer-10-education-adjusted-v1","effective_from":"2026-01-01","evidence_reference":"合成審查文件"}',1)$$,'42501',null,'AAL1 cannot publish rules');
select pg_temp.q_login(1);
select throws_ok($$select pg_temp.q_write(pg_temp.q_transition('sign','submitted'),6)$$,'55000',null,'recent factor alone does not replace rule publication');
select throws_ok($$select pg_temp.q_write(pg_temp.q_transition('revise','submitted'),7)$$,'55000',null,'submitted answer payload cannot be overwritten');
insert into q_receipts values('publication',pg_temp.q_rules(jsonb_build_object('action','request','form_key','spmsq','form_version','spmsq-pfeiffer-10-education-adjusted-v1',
 'effective_from',current_date-365,'evidence_reference','合成題本及公式審查文件'),2));
select is((select receipt->>'status' from q_receipts where label='publication'),'pending','first governance person creates pending proposal only');
select throws_ok($$select pg_temp.q_rules(jsonb_build_object('action','approve','publication_id',(select receipt->>'publicationId' from q_receipts where label='publication')),3)$$,'42501',null,'proposer cannot approve own rule');
select pg_temp.q_login(2);
select lives_ok($$select pg_temp.q_rules(jsonb_build_object('action','approve','publication_id',(select receipt->>'publicationId' from q_receipts where label='publication')),3)$$,'second actual authorized approver publishes rule');
select is((pg_temp.q_rules(jsonb_build_object('action','approve','publication_id',(select receipt->>'publicationId' from q_receipts where label='publication')),3)->>'replayed')::boolean,true,'rule approval replay is idempotent');
select pg_temp.q_login(3);
insert into q_receipts values('signed',pg_temp.q_write(pg_temp.q_transition('sign','submitted'),6));
select is((select receipt->>'recordState' from q_receipts where label='signed'),'signed','director can actually sign with a published rule and real recent factor');
select is((pg_temp.q_write(pg_temp.q_transition('sign','submitted'),6)->>'replayed')::boolean,true,'signature replay returns same receipt');
select is(pg_temp.q_workspace((select (receipt->>'versionId')::uuid from q_receipts where label='signed'))->'clients'->0->'latest'->'resultSnapshot'->>'adjusted','0','signed result freezes server-computed educational adjustment');
select is(pg_temp.q_workspace((select (receipt->>'versionId')::uuid from q_receipts where label='signed'))->'clients'->0->'latest'->>'recordState','signed','signed state is selectable by exact version');
select is(pg_temp.q_workspace((select (receipt->>'versionId')::uuid from q_receipts where label='current'))->'clients'->0->'latest'->>'isLatest','false','prior historical version cannot be edited');
select pg_temp.q_login(1);
select throws_ok($$select pg_temp.q_write(pg_temp.q_transition('correct','signed'),8)$$,'22023',null,'signed correction requires reason');
insert into q_receipts values('corrected',pg_temp.q_write(pg_temp.q_transition('correct','signed')||'{"reason":"合成更正原因"}',9));
select is((select receipt->>'recordState' from q_receipts where label='corrected'),'draft','correction appends a draft, retaining signed original');
select is(pg_temp.q_workspace((select (receipt->>'versionId')::uuid from q_receipts where label='corrected'))->'clients'->0->'latest'->>'correctionOfVersionId',
 (select receipt->>'versionId' from q_receipts where label='signed'),'correction links exact signed source');
insert into q_receipts values('corrected-revised',pg_temp.q_write(pg_temp.q_create(current_date)||pg_temp.q_transition('revise','corrected'),21));
select is(pg_temp.q_workspace((select (receipt->>'versionId')::uuid from q_receipts where label='corrected-revised'))->'clients'->0->'latest'->>'correctionOfVersionId',
 (select receipt->>'versionId' from q_receipts where label='signed'),'editing a correction draft retains the exact signed correction lineage');
select is(pg_temp.q_workspace((select (receipt->>'versionId')::uuid from q_receipts where label='corrected-revised'))->'clients'->0->'latest'->>'changeReason',
 '合成更正原因','editing a correction draft cannot discard its correction reason');
select throws_ok($$select public.questionnaire_assessment_workspace_snapshot('c1500000-0000-4000-8000-000000000001','c1600000-0000-4000-8000-000000000001','spmsq',
 'c1800000-0000-4000-8000-000000000002',null,null,false,1)$$,'42501',null,'cross branch selection denied');
select throws_ok($$select pg_temp.q_workspace('c1ff0000-0000-4000-8000-000000000099')$$,'42501',null,'unknown exact version fails closed');
select throws_ok($$select public.questionnaire_rule_governance_snapshot('c1500000-0000-4000-8000-000000000001','c1600000-0000-4000-8000-000000000002')$$,'42501',null,'governance cannot publish another branch');
insert into q_receipts values('overlap',pg_temp.q_rules(jsonb_build_object('action','request','form_key','spmsq','form_version','spmsq-pfeiffer-10-education-adjusted-v1',
 'effective_from',current_date,'evidence_reference','合成重疊審查'),4));
select pg_temp.q_login(2);
select throws_ok($$select pg_temp.q_rules(jsonb_build_object('action','approve','publication_id',(select receipt->>'publicationId' from q_receipts where label='overlap')),5)$$,'23P01',null,'approved effective periods cannot overlap');
reset role;
select ok((select record_state='signed' and form_snapshot is not null and rule_snapshot is not null and result_snapshot is not null
 and signed_by is not null and write_reauth_challenge_id is not null and signature_hash~'^[a-f0-9]{64}$'
 from public.questionnaire_assessment_versions where id=(select (receipt->>'versionId')::uuid from q_receipts where label='signed')),'signed version stores immutable content, formula, result and signer evidence');
select is((select signer_role_keys from public.questionnaire_assessment_versions where id=(select (receipt->>'versionId')::uuid from q_receipts where label='signed')),
 array['branch_director']::text[],'signature preserves the actual director role, not a fabricated nursing credential');
select throws_ok($$update public.questionnaire_assessment_versions set context='{}' where id=(select (receipt->>'versionId')::uuid from q_receipts where label='signed')$$,'55000',null,'signed update denied even to database owner');
select throws_ok($$delete from public.questionnaire_assessment_versions where id=(select (receipt->>'versionId')::uuid from q_receipts where label='signed')$$,'55000',null,'signed delete denied');
select throws_ok($$update private.questionnaire_rule_publications set evidence_reference='changed' where approved_by is not null$$,'55000',null,'approved publication proof cannot be edited');
select throws_ok($$update private.questionnaire_form_catalog set rule_snapshot='{}' where form_key='spmsq'$$,'55000',null,'fixed formula snapshot cannot be edited');
select is((select count(*) from public.questionnaire_assessment_versions where organization_id='c1500000-0000-4000-8000-000000000001'),8::bigint,'duplicate operations produce no extra record');
select ok((select count(*)>0 from public.audit_events where organization_id='c1500000-0000-4000-8000-000000000001' and table_name='private.questionnaire_rule_publications'),'rule requests and approvals are audited');
update private.reauth_events set revoked_at=clock_timestamp() where user_id='c1100000-0000-4000-8000-000000000001';
select pg_temp.q_login(1); set local role authenticated;
select throws_ok($$select pg_temp.q_write(pg_temp.q_transition('sign','submitted'),6)$$,'42501',null,'signature replay requires currently unrevoked factor evidence');
reset role;
select set_config('request.jwt.claims','{}',true);
update public.profiles set is_active=false where id='c1100000-0000-4000-8000-000000000001';
select pg_temp.q_login(1);
set local role authenticated;
select throws_ok($$select pg_temp.q_workspace()$$,'42501',null,'disabled account loses assessment read access');
select throws_ok($$select public.questionnaire_rule_governance_snapshot('c1500000-0000-4000-8000-000000000001','c1600000-0000-4000-8000-000000000001')$$,'42501',null,'disabled account loses publication authority');
reset role;
select * from finish(); rollback;
