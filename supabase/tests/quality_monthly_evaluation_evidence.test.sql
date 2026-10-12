begin;
select plan(35);
select set_config('test.amr',floor(extract(epoch from clock_timestamp()-interval '2 minutes'))::text,true);
insert into auth.users(id,aud,role,email,email_confirmed_at,created_at,updated_at) values
 ('e1100000-0000-4000-8000-000000000001','authenticated','authenticated','ops-one@example.invalid',now(),now(),now()),
 ('e1100000-0000-4000-8000-000000000002','authenticated','authenticated','ops-two@example.invalid',now(),now(),now());
insert into auth.identities(id,provider_id,user_id,identity_data,provider)
 select gen_random_uuid(),'ops-'||right(id::text,1),id,jsonb_build_object('sub','ops-'||right(id::text,1),'email',email,'email_verified',true),'google'
 from auth.users where id::text like 'e1100000%';
insert into auth.sessions(id,user_id,created_at,aal) values
 ('e1200000-0000-4000-8000-000000000001','e1100000-0000-4000-8000-000000000001',now()-interval '3 minutes','aal2'),
 ('e1200000-0000-4000-8000-000000000002','e1100000-0000-4000-8000-000000000002',now()-interval '3 minutes','aal2');
insert into auth.mfa_amr_claims(id,session_id,created_at,updated_at,authentication_method)
 select gen_random_uuid(),s.id,to_timestamp(current_setting('test.amr')::bigint),to_timestamp(current_setting('test.amr')::bigint),method
 from auth.sessions s cross join unnest(array['oauth','totp'])method where s.user_id::text like 'e1100000%';
insert into public.organizations(id,code,name) values('e1300000-0000-4000-8000-000000000001','ops-fixture','合成機構');
insert into public.branches(id,organization_id,code,name) values
 ('e1400000-0000-4000-8000-000000000001','e1300000-0000-4000-8000-000000000001','one','合成甲'),
 ('e1400000-0000-4000-8000-000000000002','e1300000-0000-4000-8000-000000000001','two','合成乙');
insert into public.profiles(id,display_name,kind) values('e1100000-0000-4000-8000-000000000001','合成經辦','staff'),('e1100000-0000-4000-8000-000000000002','合成覆核','staff');
insert into public.memberships(id,organization_id,branch_id,profile_id,status,starts_at) values
 ('e1500000-0000-4000-8000-000000000001','e1300000-0000-4000-8000-000000000001','e1400000-0000-4000-8000-000000000001','e1100000-0000-4000-8000-000000000001','active',now()-interval '1 year'),
 ('e1500000-0000-4000-8000-000000000002','e1300000-0000-4000-8000-000000000001','e1400000-0000-4000-8000-000000000001','e1100000-0000-4000-8000-000000000002','active',now()-interval '1 year');
insert into public.membership_roles(membership_id,role_id) select m.id,r.id from public.memberships m join public.roles r on r.is_system and r.role_key='branch_supervisor' where m.organization_id='e1300000-0000-4000-8000-000000000001';
insert into private.executive_access_policy(allowed_user_id,allowed_email,google_subject,enabled,approval_reference) values('e1100000-0000-4000-8000-000000000001','ops-one@example.invalid','ops-1',true,'Synthetic ops fixture');
insert into private.staff_google_access_grants(allowed_user_id,organization_id,company_email_domain,allowed_email,google_subject,enabled,approval_reference) values('e1100000-0000-4000-8000-000000000002','e1300000-0000-4000-8000-000000000001','example.invalid','ops-two@example.invalid','ops-2',true,'Synthetic independent reviewer');
insert into private.reauth_challenges(id,user_id,session_id,nonce_sha256,idempotency_key,issued_jwt_iat,created_at,expires_at,consumed_at,consumed_jwt_iat,factor_method,factor_verified_at)
 select ('e1210000-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid,('e1100000-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid,('e1200000-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid,encode(sha256(convert_to('synthetic-operations-reauth:'||i::text,'UTF8')),'hex'),gen_random_uuid(),now()-interval '2 minutes',now()-interval '2 minutes',now()+interval '3 minutes',now()-interval '30 seconds',now()-interval '30 seconds','totp',now()-interval '30 seconds' from generate_series(1,2)i;
insert into private.reauth_events(user_id,session_id,challenge_id,aal,verification_method,verified_at) select user_id,session_id,id,'aal2','totp',factor_verified_at from private.reauth_challenges where id::text like 'e1210000%';
insert into public.clients(id,organization_id,branch_id,client_code,display_name,admitted_on) values
 ('e1600000-0000-4000-8000-000000000001','e1300000-0000-4000-8000-000000000001','e1400000-0000-4000-8000-000000000001','OPS-1','合成一','2026-10-01'),
 ('e1600000-0000-4000-8000-000000000002','e1300000-0000-4000-8000-000000000001','e1400000-0000-4000-8000-000000000002','OPS-2','合成二','2026-10-01');
insert into public.attendance_records(id,organization_id,branch_id,client_id,service_date,status,idempotency_key,recorded_by) values
 ('e1700000-0000-4000-8000-000000000001','e1300000-0000-4000-8000-000000000001','e1400000-0000-4000-8000-000000000001','e1600000-0000-4000-8000-000000000001','2026-10-01','present',gen_random_uuid(),'e1100000-0000-4000-8000-000000000001'),
 ('e1700000-0000-4000-8000-000000000002','e1300000-0000-4000-8000-000000000001','e1400000-0000-4000-8000-000000000001','e1600000-0000-4000-8000-000000000001','2026-10-02','present',gen_random_uuid(),'e1100000-0000-4000-8000-000000000001'),
 ('e1700000-0000-4000-8000-000000000003','e1300000-0000-4000-8000-000000000001','e1400000-0000-4000-8000-000000000001','e1600000-0000-4000-8000-000000000001','2026-10-03','leave',gen_random_uuid(),'e1100000-0000-4000-8000-000000000001'),
 ('e1700000-0000-4000-8000-000000000004','e1300000-0000-4000-8000-000000000001','e1400000-0000-4000-8000-000000000002','e1600000-0000-4000-8000-000000000002','2026-10-01','present',gen_random_uuid(),'e1100000-0000-4000-8000-000000000001');
insert into public.weight_observations(id,organization_id,branch_id,client_id,observed_at,weight_kg,source,recorded_by,recorder_display_name,content_hash) values
 ('e1800000-0000-4000-8000-000000000001','e1300000-0000-4000-8000-000000000001','e1400000-0000-4000-8000-000000000001','e1600000-0000-4000-8000-000000000001','2026-10-01T09:00:00+08:00',60,'合成量測','e1100000-0000-4000-8000-000000000001','合成人員',repeat('a',64)),
 ('e1800000-0000-4000-8000-000000000002','e1300000-0000-4000-8000-000000000001','e1400000-0000-4000-8000-000000000001','e1600000-0000-4000-8000-000000000001','2026-10-02T09:00:00+08:00',61,'合成量測','e1100000-0000-4000-8000-000000000001','合成人員',repeat('b',64));
insert into public.care_records(id,organization_id,branch_id,client_id,record_key,category,occurred_at,data,created_by) values('e1900000-0000-4000-8000-000000000001','e1300000-0000-4000-8000-000000000001','e1400000-0000-4000-8000-000000000001','e1600000-0000-4000-8000-000000000001','e1910000-0000-4000-8000-000000000001','staff/daily-care/care-diary',now(),'{}','e1100000-0000-4000-8000-000000000001');
insert into private.clinical_attachments(id,organization_id,branch_id,client_id,source_kind,source_id,source_version,label,mime_type,file_size_bytes,sha256,object_path,created_by,idempotency_key,input_hash) values('e1920000-0000-4000-8000-000000000001','e1300000-0000-4000-8000-000000000001','e1400000-0000-4000-8000-000000000001','e1600000-0000-4000-8000-000000000001','care_diary','e1900000-0000-4000-8000-000000000001',1,'合成證據','image/png',64,repeat('c',64),'synthetic/evidence.png','e1100000-0000-4000-8000-000000000001',gen_random_uuid(),repeat('d',64));
insert into private.clinical_attachment_scans(attachment_id,verdict,scanner) values('e1920000-0000-4000-8000-000000000001','clean','synthetic-scanner');
create function pg_temp.jwt(i integer) returns text language sql as $$select jsonb_build_object('sub','e1100000-0000-4000-8000-00000000000'||i,'session_id','e1200000-0000-4000-8000-00000000000'||i,'role','authenticated','aud','authenticated','aal','aal2','is_anonymous',false,'email',case i when 1 then 'ops-one@example.invalid' else 'ops-two@example.invalid' end,'iat',floor(extract(epoch from now())),'exp',floor(extract(epoch from now()+interval '30 minutes')),'amr',jsonb_build_array(jsonb_build_object('method','oauth','timestamp',current_setting('test.amr')::bigint),jsonb_build_object('method','totp','timestamp',current_setting('test.amr')::bigint)))::text$$;
create function pg_temp.monthly(snapshot uuid default null,month text default '2026-10') returns jsonb language sql as $$select public.quality_monthly_snapshot('e1300000-0000-4000-8000-000000000001','e1400000-0000-4000-8000-000000000001',month,snapshot)$$;
create function pg_temp.preparation() returns jsonb language sql as $$select public.evaluation_preparation_snapshot('e1300000-0000-4000-8000-000000000001','e1400000-0000-4000-8000-000000000001',1)$$;
create temporary table ops_receipts(k text primary key,v jsonb);grant all on ops_receipts to authenticated;
select ok((select bool_and(relrowsecurity and relforcerowsecurity) from pg_class where oid in('private.quality_monthly_snapshots'::regclass,'private.evaluation_evidence_reviews'::regclass,'private.evaluation_evidence_bundles'::regclass)),'new immutable stores force RLS');
select ok(not has_table_privilege('authenticated','private.evaluation_evidence_reviews','select,insert,update,delete'),'no direct evidence access');
set local role anon;select throws_ok($$select pg_temp.monthly()$$,'42501',null,'anonymous denied');reset role;
select set_config('request.jwt.claims',pg_temp.jwt(1),true);set local role authenticated;
insert into ops_receipts values('monthly',pg_temp.monthly());
select is((select v#>>'{metrics,0,denominator}' from ops_receipts where k='monthly'),'2','denominator excludes leave and other branch');
select is((select v#>>'{metrics,3,numerator}' from ops_receipts where k='monthly'),'1','weight counts distinct measured attendees');
select is((select v#>>'{metrics,3,denominator}' from ops_receipts where k='monthly'),'1','weight denominator is unique monthly attendees');
select is((select v#>>'{metrics,3,rate}' from ops_receipts where k='monthly'),'100.000000','weight coverage preserves formula');
select is(pg_temp.monthly(null,'2026-09')#>'{metrics,0,rate}','null'::jsonb,'empty denominator is unknown not zero percent');
select throws_ok($$select public.quality_monthly_snapshot('e1300000-0000-4000-8000-000000000001','e1400000-0000-4000-8000-000000000002','2026-10',null)$$,'42501',null,'cross branch denied');
insert into ops_receipts select 'frozen',public.quality_monthly_freeze('e1300000-0000-4000-8000-000000000001','e1400000-0000-4000-8000-000000000001','2026-10',v->>'hash','e1930000-0000-4000-8000-000000000001') from ops_receipts where k='monthly';
select is((public.quality_monthly_freeze('e1300000-0000-4000-8000-000000000001','e1400000-0000-4000-8000-000000000001','2026-10',(select v->>'hash' from ops_receipts where k='monthly'),'e1930000-0000-4000-8000-000000000001')->>'snapshotId'),(select v->>'snapshotId' from ops_receipts where k='frozen'),'freeze replay returns same immutable snapshot');
select throws_ok($$select public.quality_monthly_freeze('e1300000-0000-4000-8000-000000000001','e1400000-0000-4000-8000-000000000001','2026-10',repeat('f',64),'e1930000-0000-4000-8000-000000000002')$$,'40001',null,'stale hash cannot freeze');
select is((public.quality_monthly_download('e1300000-0000-4000-8000-000000000001','e1400000-0000-4000-8000-000000000001','2026-10',(select(v->>'snapshotId')::uuid from ops_receipts where k='frozen'))->>'hash'),(select v->>'hash' from ops_receipts where k='frozen'),'export reads identical frozen hash');
reset role;
insert into public.attendance_records(organization_id,branch_id,client_id,service_date,status,idempotency_key,recorded_by) values('e1300000-0000-4000-8000-000000000001','e1400000-0000-4000-8000-000000000001','e1600000-0000-4000-8000-000000000001','2026-10-04','present',gen_random_uuid(),'e1100000-0000-4000-8000-000000000001');
set local role authenticated;
select is(pg_temp.monthly()#>>'{metrics,0,denominator}','3','live source sees next arrival');
select is(pg_temp.monthly((select(v->>'snapshotId')::uuid from ops_receipts where k='frozen'))#>>'{metrics,0,denominator}','2','frozen screen remains identical after live changes');
insert into ops_receipts values('prep',public.evaluation_preparation_mutate('e1300000-0000-4000-8000-000000000001','e1400000-0000-4000-8000-000000000001','{"itemCode":"INTERNAL_01","expectedVersion":0,"ownerUserId":"e1100000-0000-4000-8000-000000000001","dueOn":"2026-10-30","evidenceReference":"e1920000-0000-4000-8000-000000000001","progress":"internal_review_requested","changeReason":"initial"}','e1930000-0000-4000-8000-000000000003'));
select throws_ok($$select public.evaluation_evidence_review('e1300000-0000-4000-8000-000000000001','e1400000-0000-4000-8000-000000000001',(select(v#>>'{result,versionId}')::uuid from ops_receipts where k='prep'),'approved','review_complete','e1930000-0000-4000-8000-000000000004')$$,'42501',null,'author cannot approve own evidence');
select set_config('request.jwt.claims',pg_temp.jwt(2),true);
select throws_ok($$select public.evaluation_evidence_review('e1300000-0000-4000-8000-000000000001','e1400000-0000-4000-8000-000000000001',(select(v#>>'{result,versionId}')::uuid from ops_receipts where k='prep'),'approved','review_complete','e1930000-0000-4000-8000-000000000004')$$,'23514',null,'clean attachment on draft is not approved evidence');
reset role;
insert into public.care_records(id,organization_id,branch_id,client_id,record_key,version,previous_version_id,category,status,occurred_at,data,signed_at,signed_by,signature_purpose,content_hash,created_by) values('e1900000-0000-4000-8000-000000000002','e1300000-0000-4000-8000-000000000001','e1400000-0000-4000-8000-000000000001','e1600000-0000-4000-8000-000000000001','e1910000-0000-4000-8000-000000000001',2,'e1900000-0000-4000-8000-000000000001','staff/daily-care/care-diary','signed',now(),'{}',now(),'e1100000-0000-4000-8000-000000000001','合成簽署',repeat('e',64),'e1100000-0000-4000-8000-000000000001');
set local role authenticated;
insert into ops_receipts values('review',public.evaluation_evidence_review('e1300000-0000-4000-8000-000000000001','e1400000-0000-4000-8000-000000000001',(select(v#>>'{result,versionId}')::uuid from ops_receipts where k='prep'),'approved','review_complete','e1930000-0000-4000-8000-000000000004'));
select is((select v->>'decision' from ops_receipts where k='review'),'approved','independent reviewer confirms exact signed inherited evidence');
select is((public.evaluation_evidence_review('e1300000-0000-4000-8000-000000000001','e1400000-0000-4000-8000-000000000001',(select(v#>>'{result,versionId}')::uuid from ops_receipts where k='prep'),'approved','review_complete','e1930000-0000-4000-8000-000000000004')->>'reviewId'),(select v->>'reviewId' from ops_receipts where k='review'),'review retry does not duplicate');
select is(pg_temp.preparation()->>'approvedTotal','1','approved count derives from latest versions');
select is(pg_temp.preparation()#>>'{reviews,0,evidence,sourceId}','e1900000-0000-4000-8000-000000000002','review hashes signed successor not mutable draft');
insert into ops_receipts values('bundle',public.evaluation_evidence_bundle('e1300000-0000-4000-8000-000000000001','e1400000-0000-4000-8000-000000000001',pg_temp.preparation()->>'collectionHash','e1930000-0000-4000-8000-000000000005'));
select is((select v->>'formalSubmissionEnabled' from ops_receipts where k='bundle'),'false','internal manifest never claims official filing');
select is((public.evaluation_evidence_bundle_read('e1300000-0000-4000-8000-000000000001','e1400000-0000-4000-8000-000000000001',(select(v->>'bundleId')::uuid from ops_receipts where k='bundle'))->>'hash'),(select v->>'hash' from ops_receipts where k='bundle'),'download uses identical immutable manifest');
select throws_ok($$select public.evaluation_evidence_bundle_read('e1300000-0000-4000-8000-000000000001','e1400000-0000-4000-8000-000000000002',(select(v->>'bundleId')::uuid from ops_receipts where k='bundle'))$$,'42501',null,'cross branch manifest denied');
reset role;
select throws_ok($$update private.quality_monthly_snapshots set month='2026-09'$$,'55000',null,'frozen report cannot be overwritten');
select throws_ok($$delete from private.evaluation_evidence_reviews$$,'55000',null,'review evidence cannot be deleted');
select ok(exists(select 1 from public.audit_events where action='export' and table_name='quality_monthly_snapshots'),'explicit export audit stored');
select set_config('request.jwt.claims','{}',true);
delete from public.membership_roles where membership_id='e1500000-0000-4000-8000-000000000002';
insert into public.membership_roles(membership_id,role_id) values('e1500000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000011');
select set_config('request.jwt.claims',pg_temp.jwt(2),true);set local role authenticated;
select is(pg_temp.monthly()->>'branchId','e1400000-0000-4000-8000-000000000001','director can read her own branch monthly report');
select throws_ok($$select public.quality_monthly_snapshot('e1300000-0000-4000-8000-000000000001','e1400000-0000-4000-8000-000000000002','2026-10',null)$$,'42501',null,'director cannot inspect another branch');
reset role;select set_config('request.jwt.claims','{}',true);
update public.profiles set is_active=false where id='e1100000-0000-4000-8000-000000000002';
select set_config('request.jwt.claims',pg_temp.jwt(2),true);set local role authenticated;
select throws_ok($$select pg_temp.preparation()$$,'42501',null,'disabled reviewer loses next-request access');reset role;
select set_config('request.jwt.claims',pg_temp.jwt(2),true);set local role authenticated;
select throws_ok($$select public.evaluation_evidence_review('e1300000-0000-4000-8000-000000000001','e1400000-0000-4000-8000-000000000001',(select(v#>>'{result,versionId}')::uuid from ops_receipts where k='prep'),'approved','review_complete','e1930000-0000-4000-8000-000000000004')$$,'42501',null,'disabled reviewer cannot replay an earlier evidence approval');
select throws_ok($$select public.evaluation_evidence_bundle('e1300000-0000-4000-8000-000000000001','e1400000-0000-4000-8000-000000000001',(select v->>'hash' from ops_receipts where k='bundle'),'e1930000-0000-4000-8000-000000000005')$$,'42501',null,'disabled reviewer cannot read evidence bundle replay');
select throws_ok($$select public.quality_monthly_freeze('e1300000-0000-4000-8000-000000000001','e1400000-0000-4000-8000-000000000001','2026-10',(select v->>'hash' from ops_receipts where k='monthly'),'e1930000-0000-4000-8000-000000000006')$$,'42501',null,'disabled reviewer cannot create a monthly freeze');
reset role;
update auth.sessions set not_after=clock_timestamp()-interval '1 second' where id='e1200000-0000-4000-8000-000000000001';
select set_config('request.jwt.claims',pg_temp.jwt(1),true);set local role authenticated;
select throws_ok($$select public.quality_monthly_freeze('e1300000-0000-4000-8000-000000000001','e1400000-0000-4000-8000-000000000001','2026-10',(select v->>'hash' from ops_receipts where k='monthly'),'e1930000-0000-4000-8000-000000000001')$$,'42501',null,'revoked OAuth session cannot replay a formerly frozen report');
reset role;
select is((select count(*)::integer from private.quality_monthly_snapshots),1,'replay only created one report');
select is((select count(*)::integer from private.evaluation_evidence_bundles),1,'only one immutable evidence manifest');
select * from finish();rollback;
