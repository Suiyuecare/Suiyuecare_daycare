begin;
select plan(111);
select set_config('test.weekly_amr',floor(extract(epoch from clock_timestamp()-interval '2 minutes'))::text,true);
insert into auth.users(id,aud,role,email,email_confirmed_at,created_at,updated_at) values('c2100000-0000-4000-8000-000000000001','authenticated','authenticated','weekly-manager@example.invalid',now(),now(),now());
insert into auth.identities(id,provider_id,user_id,identity_data,provider) values(gen_random_uuid(),'weekly-manager','c2100000-0000-4000-8000-000000000001','{"sub":"weekly-manager","email":"weekly-manager@example.invalid","email_verified":true}','google');
insert into auth.sessions(id,user_id,created_at,aal) values('c2200000-0000-4000-8000-000000000001','c2100000-0000-4000-8000-000000000001',now()-interval '3 minutes','aal2');
insert into auth.mfa_amr_claims(id,session_id,created_at,updated_at,authentication_method)
select gen_random_uuid(),'c2200000-0000-4000-8000-000000000001',to_timestamp(current_setting('test.weekly_amr')::bigint),to_timestamp(current_setting('test.weekly_amr')::bigint),method from unnest(array['oauth','totp'])method;
insert into public.organizations(id,code,name) values('c2300000-0000-4000-8000-000000000001','weekly-synthetic','合成機構');
insert into public.branches(id,organization_id,code,name) values('c2400000-0000-4000-8000-000000000001','c2300000-0000-4000-8000-000000000001','main','合成分支');
insert into public.profiles(id,display_name,kind) values('c2100000-0000-4000-8000-000000000001','合成主管','staff');
insert into public.memberships(id,organization_id,branch_id,profile_id,status,starts_at) values('c2500000-0000-4000-8000-000000000001','c2300000-0000-4000-8000-000000000001','c2400000-0000-4000-8000-000000000001','c2100000-0000-4000-8000-000000000001','active',now()-interval '1 year');
insert into public.membership_roles(membership_id,role_id) values('c2500000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000003');
insert into public.clients(id,organization_id,branch_id,client_code,display_name,admitted_on) values('c2600000-0000-4000-8000-000000000001','c2300000-0000-4000-8000-000000000001','c2400000-0000-4000-8000-000000000001','C-1','合成個案',(now() at time zone 'Asia/Taipei')::date);
insert into private.reauth_challenges(id,user_id,session_id,nonce_sha256,idempotency_key,issued_jwt_iat,created_at,expires_at,consumed_at,consumed_jwt_iat,factor_method,factor_verified_at)
values('c2700000-0000-4000-8000-000000000001','c2100000-0000-4000-8000-000000000001','c2200000-0000-4000-8000-000000000001',repeat('1',64),gen_random_uuid(),now()-interval '2 minutes',now()-interval '2 minutes',now()+interval '5 minutes',now()-interval '1 minute',now()-interval '1 minute','totp',now()-interval '1 minute');
insert into private.reauth_events(user_id,session_id,challenge_id,aal,verification_method,verified_at) values('c2100000-0000-4000-8000-000000000001','c2200000-0000-4000-8000-000000000001','c2700000-0000-4000-8000-000000000001','aal2','totp',now()-interval '1 minute');
select set_config('request.jwt.claims',jsonb_build_object('sub','c2100000-0000-4000-8000-000000000001','session_id','c2200000-0000-4000-8000-000000000001','role','authenticated','aud','authenticated','aal','aal2','is_anonymous',false,'email','weekly-manager@example.invalid','iat',floor(extract(epoch from now())),'exp',floor(extract(epoch from now()+interval '30 minutes')),'amr',jsonb_build_array(jsonb_build_object('method','oauth','timestamp',current_setting('test.weekly_amr')::bigint),jsonb_build_object('method','totp','timestamp',current_setting('test.weekly_amr')::bigint)))::text,true);

-- This new suite runs actual Google admission, not the legacy test bypass.
create function pg_temp.lifecycle(p_extra jsonb default '{}') returns jsonb language sql as $$
 select receipt from public.change_client_document_disposition('c2300000-0000-4000-8000-000000000001','c2400000-0000-4000-8000-000000000001',
 jsonb_build_object('clientId','c2600000-0000-4000-8000-000000000001','documentId','d0100000-0000-4000-8000-000000000001','category','identity_front','expectedReviewRevision',0,'disposition','reviewed','reason','合成文件逐筆核對','idempotency_key','d0200000-0000-4000-8000-000000000001')||p_extra);
$$;
create function pg_temp.history(p_cursor uuid default null,p_category text default null,p_limit integer default 50,p_client uuid default 'c2600000-0000-4000-8000-000000000001') returns jsonb language sql as $$
 select payload from public.client_document_history('c2300000-0000-4000-8000-000000000001','c2400000-0000-4000-8000-000000000001',p_client,p_category,p_cursor,p_limit);
$$;
create function pg_temp.latest_category() returns jsonb language sql as $$
 select payload->'rows'->0 from public.client_documents_snapshot('c2300000-0000-4000-8000-000000000001','c2400000-0000-4000-8000-000000000001','c2600000-0000-4000-8000-000000000001');
$$;
create function pg_temp.report_state(p_key text default 'identity_front') returns text language sql as $$
 select c->>'state' from jsonb_array_elements(public.intake_completeness_snapshot('c2300000-0000-4000-8000-000000000001','c2400000-0000-4000-8000-000000000001',(clock_timestamp() at time zone 'Asia/Taipei')::date)->'rows') r,
 jsonb_array_elements(r->'checks') c where r->>'clientId'='c2600000-0000-4000-8000-000000000001' and c->>'key'=p_key;
$$;
create function pg_temp.legacy_review(p_expected integer,p_decision text default 'reviewed') returns jsonb language sql as $$
 select receipt from public.review_client_document('c2300000-0000-4000-8000-000000000001','c2400000-0000-4000-8000-000000000001',
 jsonb_build_object('clientId','c2600000-0000-4000-8000-000000000001','category','identity_front','expectedDocumentVersion',2,'expectedReviewVersion',p_expected,'decision',p_decision,'reason','合成類別核對','idempotency_key',gen_random_uuid()));
$$;
create function pg_temp.download(p_id uuid default 'd0100000-0000-4000-8000-000000000002') returns jsonb language sql as $$
 select payload from public.prepare_client_document_download('c2300000-0000-4000-8000-000000000001','c2400000-0000-4000-8000-000000000001','c2600000-0000-4000-8000-000000000001',p_id);
$$;
insert into public.clients(id,organization_id,branch_id,client_code,display_name,admitted_on) values('c2600000-0000-4000-8000-000000000002','c2300000-0000-4000-8000-000000000001','c2400000-0000-4000-8000-000000000001','C-2','合成其他個案',current_date);
-- 203 attachments with identical timestamps exercise the tie-breaker, not only dates.
insert into private.client_document_versions(id,organization_id,branch_id,client_id,category,version,sha256,mime_type,file_size_bytes,object_path,created_by,idempotency_key,input_hash,created_at,document_label)
select ('d0100000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'c2300000-0000-4000-8000-000000000001','c2400000-0000-4000-8000-000000000001','c2600000-0000-4000-8000-000000000001',
 case when n<=2 then 'identity_front' else 'medication_plan' end,case when n<=2 then n else n-2 end,encode(sha256(convert_to(n::text,'UTF8')),'hex'),'application/pdf',128,'synthetic-lifecycle/'||n,
 'c2100000-0000-4000-8000-000000000001',gen_random_uuid(),repeat('a',64),now()-interval '1 day','合成附件 '||n from generate_series(1,203)n;
insert into private.client_document_scan_results(document_id,verdict,scanner) select id,case when version=201 then 'infected' else 'clean' end,'synthetic-scanner' from private.client_document_versions;

select ok((select bool_and(relrowsecurity and relforcerowsecurity) from pg_class where relname in ('client_document_disposition_events','client_document_disposition_receipts','client_document_history_snapshots','client_document_history_items','client_document_history_cursors')),'all new evidence/receipt/cursor tables force RLS');
select ok(not has_table_privilege('authenticated','private.client_document_disposition_events','select,insert,update,delete'),'browser cannot bypass lifecycle RPC');
select ok(not has_table_privilege('service_role','private.client_document_history_items','select,insert,update,delete'),'worker cannot directly read history manifests');
select ok(not has_function_privilege('anon','public.client_document_history(uuid,uuid,uuid,text,uuid,integer)','execute'),'anonymous history entry is not executable');
select ok(not has_function_privilege('service_role','public.change_client_document_disposition(uuid,uuid,jsonb)','execute'),'worker cannot change review disposition');
select ok(not (select prosecdef from pg_proc where oid='public.client_document_history(uuid,uuid,uuid,text,uuid,integer)'::regprocedure),'public history entry remains invoker');
select ok(not (select prosecdef from pg_proc where oid='public.change_client_document_disposition(uuid,uuid,jsonb)'::regprocedure),'public lifecycle entry remains invoker');
select ok(not has_function_privilege('authenticated','private.client_document_current_disposition(uuid)','execute'),'unscoped effective-state helper is not browser callable');
select ok(not has_function_privilege('authenticated','private.prune_expired_client_document_history(uuid,uuid,uuid)','execute'),'no browser cleanup or purge entry is granted');
set local role authenticated;
select throws_ok($$select pg_temp.history()$$,'42501',null,'unapproved Google history read denied');
select throws_ok($$select pg_temp.lifecycle()$$,'42501',null,'unapproved Google lifecycle write denied');
reset role;
insert into private.executive_access_policy(allowed_user_id,allowed_email,google_subject,enabled,approval_reference) values('c2100000-0000-4000-8000-000000000001','weekly-manager@example.invalid','weekly-manager',true,'synthetic document lifecycle test');
set local role authenticated;
select is(pg_temp.lifecycle()->>'reviewRevision','1','per-document first review has independent revision one');
select is(pg_temp.lifecycle()->>'replayed','true','same-key replay reuses immutable receipt');
select throws_ok($$select pg_temp.lifecycle('{"reason":"合成修改後理由"}')$$,'23505',null,'changed payload cannot reuse operation key');
select throws_ok($$select pg_temp.lifecycle(jsonb_build_object('idempotency_key',gen_random_uuid()))$$,'40001',null,'stale per-file revision is rejected');
select throws_ok($$select pg_temp.lifecycle('{"category":"health_exam"}')$$,'42501',null,'caller cannot spoof the actual document category');
select throws_ok($$select pg_temp.lifecycle('{"clientId":"c2600000-0000-4000-8000-000000000002"}')$$,'42501',null,'wrong-client document ID is rejected before receipt lookup');
select throws_ok($$select pg_temp.lifecycle('{"reason":"x"}')$$,'22023',null,'review requires a meaningful reason');
select throws_ok($$select pg_temp.lifecycle('{"extra":true}')$$,'22023',null,'unknown input keys are rejected');
select throws_ok($$select pg_temp.lifecycle('{"expectedReviewRevision":1000000}')$$,'22023',null,'revision upper bound cannot create an unreadable next revision');
select throws_ok($$select pg_temp.lifecycle(jsonb_build_object('documentId','d0100000-0000-4000-8000-000000000203','category','medication_plan','idempotency_key',gen_random_uuid()))$$,'22023',null,'infected document cannot be marked reviewed');
select is(pg_temp.lifecycle(jsonb_build_object('documentId','d0100000-0000-4000-8000-000000000203','category','medication_plan','disposition','needs_replacement','idempotency_key',gen_random_uuid()))->>'reviewRevision','1','infected document can be explicitly flagged for replacement');
select is(pg_temp.latest_category()->>'status','needs_review','reviewing older file does not review latest category document');
select is(pg_temp.report_state(),'pending','reviewing older file does not complete latest-document report');
select lives_ok($$select pg_temp.legacy_review(0)$$,'existing latest-category review remains compatible');
select is(pg_temp.latest_category()->>'status','reviewed','legacy category decision remains visible');
select is(pg_temp.report_state(),'complete','legacy category read remains compatible in completeness report');
select is(pg_temp.lifecycle(jsonb_build_object('documentId','d0100000-0000-4000-8000-000000000002','disposition','inactive','reason','合成停用理由','idempotency_key','d0200000-0000-4000-8000-000000000002'))->>'reviewRevision','1','latest attachment deactivation is independently versioned');
select is(pg_temp.latest_category()->>'status','needs_replacement','inactive latest file cannot still display reviewed category');
select is(pg_temp.latest_category()->>'documentDisposition','inactive','latest-card overlay identifies inactive exactly');
select is(pg_temp.latest_category()->>'reviewReason','合成類別核對','legacy reviewReason retains original category review semantics');
select is(pg_temp.latest_category()->>'documentReviewReason','合成停用理由','latest per-file reason stays separate from category annotation');
select is(pg_temp.report_state(),'replacement','inactive latest file cannot count complete');
select lives_ok($$select pg_temp.legacy_review(1)$$,'legacy category review RPC remains compatible after inactivity');
select is(pg_temp.latest_category()->>'status','needs_replacement','later legacy review cannot silently revive inactive attachment');
select is(pg_temp.report_state(),'replacement','later legacy review cannot silently clear report replacement');
select is(pg_temp.download()->>'historicalOnly','true','clean inactive attachment remains explicitly historical download');
select is(pg_temp.download()->>'disposition','inactive','download reply carries the live disposition');
select is(pg_temp.download('d0100000-0000-4000-8000-000000000001')->>'historicalOnly','false','new same-category upload does not silently supersede a reviewed attachment');
select is(pg_temp.lifecycle(jsonb_build_object('documentId','d0100000-0000-4000-8000-000000000002','expectedReviewRevision',1,'disposition','reviewed','reason','合成重新覆核採用','idempotency_key',gen_random_uuid()))->>'reviewRevision','2','explicit new reasoned review can restore a clean file');
select is(pg_temp.report_state(),'complete','explicit latest review restores only latest-document completion');
select is(pg_temp.latest_category()->>'documentReviewRevision','2','latest-card overlay exposes correct per-file baseline');
select lives_ok($$select pg_temp.legacy_review(2,'not_applicable')$$,'legacy category annotation can remain separately recorded');
select is(pg_temp.latest_category()->>'categoryReviewDecision','not_applicable','raw category decision is exposed independently of effective file status');
select is(pg_temp.latest_category()->>'status','reviewed','explicit per-file review takes precedence over category annotation');
select is(pg_temp.report_state(),'complete','report uses the same per-file-positive precedence as snapshot');
select is(pg_temp.latest_category()->>'documentReviewReason','合成重新覆核採用','per-file reason exposed separately for receipt verification');
select is(pg_temp.download()->>'historicalOnly','false','restored latest evidence is no longer inactive historical-only');
select lives_ok($$select pg_temp.lifecycle(jsonb_build_object('documentId','d0100000-0000-4000-8000-000000000003','category','medication_plan','idempotency_key',gen_random_uuid()))$$,'first concurrent medication attachment can be independently reviewed');
select lives_ok($$select pg_temp.lifecycle(jsonb_build_object('documentId','d0100000-0000-4000-8000-000000000004','category','medication_plan','idempotency_key',gen_random_uuid()))$$,'second concurrent medication attachment can be independently reviewed');
select is(pg_temp.download('d0100000-0000-4000-8000-000000000003')->>'historicalOnly','false','first independently reviewed medication attachment is not implicitly historical');
select is(pg_temp.download('d0100000-0000-4000-8000-000000000004')->>'historicalOnly','false','second independently reviewed medication attachment also remains nonhistorical');
select lives_ok($$select pg_temp.lifecycle(jsonb_build_object('documentId','d0100000-0000-4000-8000-000000000003','category','medication_plan','expectedReviewRevision',1,'disposition','inactive','idempotency_key',gen_random_uuid()))$$,'only selected medication attachment is made inactive');
select is(pg_temp.download('d0100000-0000-4000-8000-000000000003')->>'historicalOnly','true','selected inactive medication attachment is explicitly historical');
select is(pg_temp.download('d0100000-0000-4000-8000-000000000004')->>'historicalOnly','false','deactivating another attachment leaves this evidence unchanged');
select is((select item->>'historicalOnly' from jsonb_array_elements(pg_temp.history(null,'identity_front')->'rows')item where item->>'id'='d0100000-0000-4000-8000-000000000001'),'false','history likewise does not infer supersession from category upload sequence');

select set_config('test.history_first',pg_temp.history()::text,true);
select is(jsonb_array_length(current_setting('test.history_first')::jsonb->'rows'),50,'first metadata page is bounded to default fifty');
select is(current_setting('test.history_first')::jsonb->>'pageSize','50','page size echoed for response validation');
select is(current_setting('test.history_first')::jsonb->'rows'->0->>'id','d0100000-0000-4000-8000-000000000203','equal-timestamp ordering uses UUID descending tie-breaker');
select is(current_setting('test.history_first')::jsonb->'rows'->0->>'disposition','needs_replacement','snapshot freezes actual per-document disposition');
select ok((current_setting('test.history_first')::jsonb->>'nextCursor') is not null,'page 1 supplies a scoped cursor');
select ok((current_setting('test.history_first')::jsonb->>'expiresAt')::timestamptz-(current_setting('test.history_first')::jsonb->>'generatedAt')::timestamptz=interval '5 minutes','history expiry is exactly five minutes');
select ok(current_setting('test.history_first') not like '%objectPath%' and current_setting('test.history_first') not like '%sha256%' and current_setting('test.history_first') not like '%synthetic-lifecycle/%','no storage keys or file hashes in metadata history');
select throws_ok($$select pg_temp.history(null,null,0)$$,'22023',null,'zero limit rejected');
select throws_ok($$select pg_temp.history(null,null,101)$$,'22023',null,'oversize limit rejected');
select throws_ok($$select pg_temp.history(null,'unexpected')$$,'22023',null,'unknown category rejected');
select throws_ok($$select pg_temp.history(gen_random_uuid())$$,'22023',null,'invented cursor rejected');
select throws_ok($$select pg_temp.history((current_setting('test.history_first')::jsonb->>'nextCursor')::uuid,'identity_front')$$,'22023',null,'cross-category cursor substitution rejected');
select throws_ok($$select pg_temp.history((current_setting('test.history_first')::jsonb->>'nextCursor')::uuid,null,50,'c2600000-0000-4000-8000-000000000002')$$,'22023',null,'cursor cannot be reused for another authorized client');
select throws_ok($$select public.client_document_history('c2300000-0000-4000-8000-000000000001',gen_random_uuid(),'c2600000-0000-4000-8000-000000000001',null,null,50)$$,'42501',null,'cross-branch history denied');
select is(jsonb_array_length(pg_temp.history(null,'identity_front')->'rows'),2,'optional category filter returns only matching attachments');
select is(pg_temp.history(null,null,100,'c2600000-0000-4000-8000-000000000002')->>'nextCursor',null,'empty case history terminates without phantom cursor');
reset role;
-- Insert after snapshot with a deliberately older timestamp. A plain timestamp
-- high-water cursor would leak it into later pages; the frozen manifest does not.
insert into private.client_document_versions(id,organization_id,branch_id,client_id,category,version,sha256,mime_type,file_size_bytes,object_path,created_by,idempotency_key,input_hash,created_at)
values('d0100000-0000-4000-8000-000000000204','c2300000-0000-4000-8000-000000000001','c2400000-0000-4000-8000-000000000001','c2600000-0000-4000-8000-000000000001','medication_plan',202,repeat('d',64),'application/pdf',128,'synthetic-lifecycle/later','c2100000-0000-4000-8000-000000000001',gen_random_uuid(),repeat('a',64),now()-interval '2 days');
create temporary table gathered_history(payload jsonb);
grant all on table gathered_history to authenticated;
set local role authenticated;
insert into gathered_history values(current_setting('test.history_first')::jsonb);
do $$ declare page jsonb:=current_setting('test.history_first')::jsonb;steps integer:=0;begin
 while page->>'nextCursor' is not null loop
  page:=pg_temp.history((page->>'nextCursor')::uuid);insert into gathered_history values(page);steps:=steps+1;
  if steps>10 then raise exception 'cursor did not terminate';end if;
 end loop;
end;$$;
select is((select count(*)::integer from gathered_history,jsonb_array_elements(payload->'rows')),203,'all 203 original attachments reachable beyond old 200-row cap');
select is((select count(distinct item->>'id')::integer from gathered_history,jsonb_array_elements(payload->'rows')item),203,'no duplicate across equal timestamps and five pages');
select ok(not exists(select 1 from gathered_history,jsonb_array_elements(payload->'rows')item where item->>'id'='d0100000-0000-4000-8000-000000000204'),'later insertion excluded even when backdated');
select is((select count(distinct payload->>'snapshotId')::integer from gathered_history),1,'all continuation pages share one exact snapshot');
select is(jsonb_array_length(pg_temp.history((current_setting('test.history_first')::jsonb->>'nextCursor')::uuid)->'rows'),50,'replaying cursor returns same bounded page');
select lives_ok($$select pg_temp.lifecycle(jsonb_build_object('documentId','d0100000-0000-4000-8000-000000000002','expectedReviewRevision',2,'disposition','inactive','idempotency_key',gen_random_uuid()))$$,'new lifecycle event after snapshot persists independently');
select is((select item->>'disposition' from jsonb_array_elements(pg_temp.history((select (payload->>'nextCursor')::uuid from gathered_history where payload->'rows'->0->>'id'='d0100000-0000-4000-8000-000000000053'))->'rows')item where item->>'id'='d0100000-0000-4000-8000-000000000002'),'reviewed','later event does not mutate frozen history disposition');
select is((select item->>'disposition' from jsonb_array_elements(pg_temp.history(null,'identity_front')->'rows')item where item->>'id'='d0100000-0000-4000-8000-000000000002'),'inactive','fresh history exposes newly changed live disposition');
reset role;
select ok(not exists(select 1 from public.audit_events where table_name like 'client_document%' and metadata::text like '%合成%'),'audit contains no raw review reason or document labels');
select throws_ok($$update private.client_document_disposition_events set reason='合成竄改理由'$$,'55000',null,'lifecycle event is immutable even for table owner');
select throws_ok($$delete from private.client_document_disposition_receipts$$,'55000',null,'idempotent receipt cannot be deleted');
select throws_ok($$update private.client_document_history_items set payload='{}'$$,'55000',null,'frozen history cannot be overwritten');
select throws_ok($$delete from private.client_document_history_cursors$$,'55000',null,'issued cursor cannot be deleted silently');
insert into private.client_document_versions(id,organization_id,branch_id,client_id,category,version,sha256,mime_type,file_size_bytes,object_path,created_by,idempotency_key,input_hash,valid_until)
values('d0100000-0000-4000-8000-000000000205','c2300000-0000-4000-8000-000000000001','c2400000-0000-4000-8000-000000000001','c2600000-0000-4000-8000-000000000001','medication_plan',203,repeat('e',64),'application/pdf',128,'synthetic-lifecycle/expired','c2100000-0000-4000-8000-000000000001',gen_random_uuid(),repeat('a',64),(clock_timestamp() at time zone 'Asia/Taipei')::date-1);
insert into private.client_document_scan_results(document_id,verdict,scanner) values('d0100000-0000-4000-8000-000000000205','clean','synthetic-scanner');
set local role authenticated;
select lives_ok($$select pg_temp.lifecycle(jsonb_build_object('documentId','d0100000-0000-4000-8000-000000000205','category','medication_plan','idempotency_key',gen_random_uuid()))$$,'reviewing an expired artifact does not rewrite its immutable dates');
select is(pg_temp.download('d0100000-0000-4000-8000-000000000205')->>'historicalOnly','true','expired clean attachment download is historical even after review');
select is((select item->>'historicalOnly' from jsonb_array_elements(pg_temp.history(null,'medication_plan')->'rows')item where item->>'id'='d0100000-0000-4000-8000-000000000205'),'true','history applies Taiwan-date expiry consistently');
select is(pg_temp.report_state('medication_plan'),'expired','expired reviewed latest attachment cannot complete the report');
reset role;
select set_config('test.lifecycle_aal2',current_setting('request.jwt.claims'),true);
select set_config('request.jwt.claims',(current_setting('request.jwt.claims')::jsonb||'{"aal":"aal1"}')::text,true);
set local role authenticated;
select throws_ok($$select pg_temp.lifecycle()$$,'42501',null,'AAL1 cannot replay or mutate disposition');
select lives_ok($$select pg_temp.history(null,'medication_plan')$$,'approved Google metadata read keeps existing no-reauth behavior');
select is(pg_temp.history(null,'medication_plan')->'rows'->0->>'canManage','false','AAL1 metadata is explicitly read-only');
select throws_ok($$select pg_temp.history(null,'identity_front')$$,'42501',null,'AAL1 does not invent clients.manage privilege for identity images');
reset role;
select set_config('request.jwt.claims',current_setting('test.lifecycle_aal2'),true);
update public.organizations set is_active=false where id='c2300000-0000-4000-8000-000000000001';
set local role authenticated;
select throws_ok($$select pg_temp.lifecycle()$$,'42501',null,'inactive organization blocks receipt replay');
select throws_ok($$select pg_temp.history()$$,'42501',null,'inactive organization blocks new snapshot');
select throws_ok($$select pg_temp.history((current_setting('test.history_first')::jsonb->>'nextCursor')::uuid)$$,'42501',null,'inactive organization blocks issued cursor');
select throws_ok($$select pg_temp.latest_category()$$,'42501',null,'inactive organization blocks legacy category snapshot');
select throws_ok($$select pg_temp.download()$$,'42501',null,'inactive organization blocks download');
reset role;
update public.organizations set is_active=true where id='c2300000-0000-4000-8000-000000000001';
insert into private.client_document_history_snapshots(id,organization_id,branch_id,client_id,actor_user_id,generated_at,expires_at)
values('d0300000-0000-4000-8000-000000000001','c2300000-0000-4000-8000-000000000001','c2400000-0000-4000-8000-000000000001','c2600000-0000-4000-8000-000000000001','c2100000-0000-4000-8000-000000000001',now()-interval '6 minutes',now()-interval '1 minute');
insert into private.client_document_history_cursors(id,snapshot_id,after_ordinal) values('d0400000-0000-4000-8000-000000000001','d0300000-0000-4000-8000-000000000001',1);
set local role authenticated;
select throws_ok($$select pg_temp.history('d0400000-0000-4000-8000-000000000001')$$,'55000',null,'expired snapshot requires an explicit fresh start');
reset role;
-- The next legitimate fresh read can remove at most three same-actor expired
-- navigation snapshots, never current evidence or another actor's cache.
insert into auth.users(id,aud,role,email,email_confirmed_at,created_at,updated_at) values('d0500000-0000-4000-8000-000000000001','authenticated','authenticated','synthetic-other-history@example.invalid',now(),now(),now());
insert into public.profiles(id,display_name,kind) values('d0500000-0000-4000-8000-000000000001','合成其他閱覽者','staff');
insert into private.client_document_history_snapshots(id,organization_id,branch_id,client_id,actor_user_id,generated_at,expires_at)
select ('d0300000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'c2300000-0000-4000-8000-000000000001','c2400000-0000-4000-8000-000000000001','c2600000-0000-4000-8000-000000000001',
 case when n=5 then 'd0500000-0000-4000-8000-000000000001'::uuid else 'c2100000-0000-4000-8000-000000000001'::uuid end,now()-interval '6 minutes',now()-interval '1 minute' from generate_series(2,5)n;
insert into private.client_document_history_items(snapshot_id,ordinal,document_id,category,payload)
select id,1,'d0100000-0000-4000-8000-000000000001','identity_front','{}' from private.client_document_history_snapshots where id::text like 'd0300000%';
select set_config('test.lifecycle_event_count',(select count(*)::text from private.client_document_disposition_events),true);
select set_config('test.lifecycle_receipt_count',(select count(*)::text from private.client_document_disposition_receipts),true);
set local role authenticated;
select lives_ok($$select pg_temp.history(null,'identity_front')$$,'fresh authorized read safely prunes expired navigation manifests');
reset role;
select is((select count(*)::integer from private.client_document_history_snapshots where actor_user_id='c2100000-0000-4000-8000-000000000001' and expires_at<=clock_timestamp()),1,'cleanup is bounded to three expired snapshots per read');
select is((select count(*)::integer from private.client_document_history_snapshots where actor_user_id='d0500000-0000-4000-8000-000000000001'),1,'cleanup cannot remove another actor navigation snapshot');
select is((select count(*)::text from private.client_document_disposition_events),current_setting('test.lifecycle_event_count'),'ephemeral cleanup never deletes per-document event evidence');
select is((select count(*)::text from private.client_document_disposition_receipts),current_setting('test.lifecycle_receipt_count'),'ephemeral cleanup never deletes idempotency receipts');
select ok(exists(select 1 from public.audit_events where table_name='client_document_history_cache' and action='delete' and metadata->>'snapshot_count'='3'),'bounded cache cleanup records only safe counts in audit');
delete from public.role_permissions where role_id='10000000-0000-4000-8000-000000000003' and permission_id=(select id from public.permissions where permission_key='clients.demographics.read');
set local role authenticated;
select throws_ok($$select pg_temp.lifecycle()$$,'42501',null,'revoked identity field grant blocks idempotent replay');
select throws_ok($$select pg_temp.history(null,'identity_front')$$,'42501',null,'revoked identity field grant blocks filtered history');
select throws_ok($$select pg_temp.history((current_setting('test.history_first')::jsonb->>'nextCursor')::uuid)$$,'42501',null,'revoked category blocks old mixed-category cursor, not partial leaked page');
select is((select count(*)::integer from jsonb_array_elements(pg_temp.history()->'rows')r where r->>'category'='identity_front'),0,'fresh authorized history omits revoked category');
reset role;
insert into private.client_document_versions(organization_id,branch_id,client_id,category,version,sha256,mime_type,file_size_bytes,object_path,created_by,idempotency_key,input_hash)
select 'c2300000-0000-4000-8000-000000000001','c2400000-0000-4000-8000-000000000001','c2600000-0000-4000-8000-000000000002','medication_plan',n,
 encode(sha256(convert_to(n::text,'UTF8')),'hex'),'application/pdf',128,'synthetic-limit/'||n,'c2100000-0000-4000-8000-000000000001',gen_random_uuid(),repeat('a',64) from generate_series(1,5001)n;
select set_config('test.history_snapshot_count',(select count(*)::text from private.client_document_history_snapshots),true);
set local role authenticated;
select throws_ok($$select pg_temp.history(null,null,100,'c2600000-0000-4000-8000-000000000002')$$,'54000',null,'over 5000 items fails explicitly, never silently truncates');
reset role;
select is((select count(*)::text from private.client_document_history_snapshots),current_setting('test.history_snapshot_count'),'limit failure rolls back manifest and read audit');
select * from finish();
rollback;
