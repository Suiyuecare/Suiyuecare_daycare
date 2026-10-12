
begin;
set local lock_timeout = '5s';

insert into public.permissions(permission_key,description,risk_level)
select prefix||'.sign','Sign complete, versioned questionnaire assessments',3
from unnest(array['questionnaire_cognition','questionnaire_adl','questionnaire_swallowing',
 'questionnaire_emotion','questionnaire_fall','questionnaire_nutrition']) prefix
on conflict(permission_key) do nothing;
insert into public.role_permissions(role_id,permission_id)
select rp.role_id,sign_permission.id from public.role_permissions rp
join public.permissions manage_permission on manage_permission.id=rp.permission_id
join public.permissions sign_permission
 on sign_permission.permission_key=replace(manage_permission.permission_key,'.manage','.sign')
join public.roles role on role.id=rp.role_id and role.is_system
where manage_permission.permission_key like 'questionnaire_%.manage'
 and role.role_key in ('organization_manager','branch_supervisor','branch_director','case_manager_social_worker','nurse','professional')
on conflict(role_id,permission_id) do nothing;

create function private.questionnaire_sign_authority(p_org uuid,p_branch uuid,p_client uuid,p_form text)
returns boolean language sql volatile security definer set search_path='' as $$
 select private.questionnaire_assessment_authority(p_org,p_branch,p_client,p_form,'manage')
  and private.questionnaire_assessment_permission(p_org,p_branch,case p_form
   when 'spmsq' then 'questionnaire_cognition.sign'
   when 'gds_15' then 'questionnaire_emotion.sign'
   when 'bsrs5' then 'questionnaire_emotion.sign'
   when 'barthel_adl' then 'questionnaire_adl.sign'
   when 'lawton_iadl' then 'questionnaire_adl.sign'
   when 'eat10_swallowing' then 'questionnaire_swallowing.sign'
   when 'fall_risk_taipei_115' then 'questionnaire_fall.sign'
   else 'questionnaire_nutrition.sign' end);
$$;

create function private.questionnaire_reauth()
returns uuid language plpgsql volatile security definer set search_path='' as $$
declare v_session uuid; v_challenge uuid; v_now timestamptz:=clock_timestamp();
begin
 if auth.uid() is null or coalesce(auth.jwt()->>'aal','')<>'aal2'
  or not public.is_staff_login_allowed() then
  raise exception using errcode='42501',message='questionnaire requires recent same-session AAL2';
 end if;
 begin v_session:=nullif(auth.jwt()->>'session_id','')::uuid;
 exception when invalid_text_representation then
  raise exception using errcode='42501',message='questionnaire requires recent same-session AAL2'; end;
 select c.id into v_challenge from private.reauth_challenges c
 join private.reauth_events e on e.challenge_id=c.id and e.user_id=c.user_id and e.session_id=c.session_id
 where e.user_id=auth.uid() and e.session_id=v_session and e.aal='aal2' and e.revoked_at is null
  and c.consumed_at is not null and c.invalidated_at is null
  and e.verification_method in ('totp','webauthn','phone')
  and c.factor_method=e.verification_method and c.factor_verified_at=e.verified_at
  and c.factor_verified_at between v_now-interval '15 minutes' and v_now+interval '1 minute'
 order by c.factor_verified_at desc,c.id desc limit 1 for share of c,e;
 if v_challenge is null then
  raise exception using errcode='42501',message='questionnaire requires recent same-session AAL2';
 end if;
 return v_challenge;
end; $$;

create table private.questionnaire_rule_publications (
 id uuid primary key default gen_random_uuid(), organization_id uuid not null,
 branch_id uuid not null, form_key text not null, form_version text not null,
 catalog_hash text not null, effective_from date not null, effective_to date,
 evidence_reference text not null check(length(btrim(evidence_reference)) between 1 and 300),
 requested_by uuid not null references auth.users(id) on delete restrict,
 requested_at timestamptz not null default clock_timestamp(),
 requested_reauth uuid not null references private.reauth_challenges(id) on delete restrict,
 request_key uuid not null, request_hash text not null,
 approved_by uuid references auth.users(id) on delete restrict, approved_at timestamptz,
 approved_reauth uuid references private.reauth_challenges(id) on delete restrict,
 approval_key uuid, approval_hash text,
 foreign key(branch_id,organization_id) references public.branches(id,organization_id) on delete restrict,
 foreign key(form_key,form_version) references private.questionnaire_form_catalog(form_key,form_version) on delete restrict,
 unique(requested_by,request_key), unique(approved_by,approval_key),
 check(effective_to is null or effective_to>=effective_from),
 check((approved_by is null and approved_at is null and approved_reauth is null and approval_key is null and approval_hash is null)
  or (approved_by is not null and approved_by<>requested_by and approved_at is not null
   and approved_reauth is not null and approved_reauth<>requested_reauth and approval_key is not null and approval_hash is not null))
);
alter table private.questionnaire_rule_publications enable row level security;
alter table private.questionnaire_rule_publications force row level security;
revoke all on private.questionnaire_rule_publications from public,anon,authenticated,service_role;
create function private.protect_questionnaire_rule_publication()
returns trigger language plpgsql security invoker set search_path='' as $$
begin
 if tg_op='DELETE' or old.approved_by is not null
  or (to_jsonb(new)-array['approved_by','approved_at','approved_reauth','approval_key','approval_hash'])
   is distinct from (to_jsonb(old)-array['approved_by','approved_at','approved_reauth','approval_key','approval_hash'])
  or new.approved_by is null then
  raise exception using errcode='55000',message='questionnaire publication is immutable';
 end if;
 return new;
end; $$;
create trigger questionnaire_rule_publications_immutable before update or delete on private.questionnaire_rule_publications
for each row execute function private.protect_questionnaire_rule_publication();
create trigger questionnaire_rule_publications_audit after insert or update on private.questionnaire_rule_publications
for each row execute function private.audit_row_change();

create function private.questionnaire_rule_authority(p_org uuid,p_branch uuid,p_form text,p_version text,p_date date)
returns jsonb language sql volatile security definer set search_path='' as $$
 select jsonb_build_object('publicationId',p.id,'catalogHash',p.catalog_hash,
  'effectiveFrom',p.effective_from,'effectiveTo',p.effective_to,
  'requestedBy',p.requested_by,'approvedBy',p.approved_by,'approvedAt',p.approved_at)
 from private.questionnaire_rule_publications p
 join private.questionnaire_form_catalog c on c.form_key=p.form_key and c.form_version=p.form_version and c.catalog_hash=p.catalog_hash
 where p.organization_id=p_org and p.branch_id=p_branch and p.form_key=p_form and p.form_version=p_version
  and p.approved_by is not null and p.effective_from<=p_date
  and (p.effective_to is null or p.effective_to>=p_date)
 order by p.effective_from desc,p.approved_at desc limit 1;
$$;

-- The fixed formula reproduces the catalogue. Client-provided scores are never accepted.
create function private.questionnaire_calculation(p_form text,p_version text,p_answers jsonb,p_context jsonb)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare c private.questionnaire_form_catalog%rowtype; item jsonb; choice jsonb; answer jsonb;
 raw_score integer:=0; adjusted integer; classification jsonb; incomplete integer:=0;
begin
 select * into strict c from private.questionnaire_form_catalog where form_key=p_form and form_version=p_version;
 for item in select value from jsonb_array_elements(c.rule_snapshot->'items') loop
  answer:=p_answers->(item->>'id');
  if answer->>'state'<>'answered' then incomplete:=incomplete+1; continue; end if;
  select value into choice from jsonb_array_elements(item->'choices') where value->>'value'=answer->>'value';
  if choice is null then raise exception using errcode='22023',message='questionnaire choice not in rule'; end if;
  raw_score:=raw_score+(choice->>'points')::integer;
 end loop;
 if p_form='spmsq' and not (p_context ? 'education_adjustment') then incomplete:=incomplete+1; end if;
 if incomplete>0 then return jsonb_build_object('status','incomplete','raw',null,'adjusted',null,
  'classification',null,'unit',c.rule_snapshot->>'scoreUnit','incompleteCount',incomplete); end if;
 adjusted:=raw_score;
 if p_form='spmsq' then
  adjusted:=greatest(0,least(10,raw_score+case p_context->>'education_adjustment'
   when 'grade_school_or_less' then -1 when 'beyond_high_school' then 1 else 0 end));
 end if;
 select value into classification from jsonb_array_elements(c.rule_snapshot->'bands')
 where adjusted between (value->>'minInclusive')::integer and (value->>'maxInclusive')::integer limit 1;
 return jsonb_build_object('status','complete','raw',raw_score,'adjusted',adjusted,
  'classification',classification,'unit',c.rule_snapshot->>'scoreUnit','incompleteCount',0);
end; $$;

alter table public.questionnaire_assessment_versions
 drop constraint questionnaire_assessment_versions_record_state_check;
alter table public.questionnaire_assessment_versions
 add constraint questionnaire_assessment_versions_record_state_check check(record_state in ('draft','submitted','signed')),
 add column form_snapshot jsonb,
 add column rule_snapshot jsonb,
 add column result_snapshot jsonb,
 add column rule_publication_id uuid references private.questionnaire_rule_publications(id) on delete restrict,
 add column correction_of_version_id uuid references public.questionnaire_assessment_versions(id) on delete restrict,
 add column change_reason text,
 add column follow_up_due_on date,
 add column signed_at timestamptz,
 add column signed_by uuid references auth.users(id) on delete restrict,
 add column signer_display_name text,
 add column signer_role_keys text[],
 add column signature_hash text,
 add constraint questionnaire_signature_evidence_check check(
  (record_state<>'signed' and signed_at is null and signed_by is null and signer_display_name is null and signer_role_keys is null and signature_hash is null)
  or (record_state='signed' and signed_at is not null and signed_by is not null and signer_display_name is not null
    and signature_hash ~ '^[a-f0-9]{64}$' and write_reauth_challenge_id is not null
    and form_snapshot is not null and rule_snapshot is not null and result_snapshot is not null
    and rule_publication_id is not null and signer_role_keys is not null and cardinality(signer_role_keys)>0)),
 add constraint questionnaire_follow_up_due_check check(follow_up_due_on is null or follow_up_due_on>=assessed_on),
 add constraint questionnaire_correction_reason_check check(correction_of_version_id is null or length(btrim(change_reason)) between 1 and 500);
create index questionnaire_rule_publications_scope_idx
 on private.questionnaire_rule_publications(organization_id,branch_id,form_key,effective_from);
create index questionnaire_versions_publication_idx on public.questionnaire_assessment_versions(rule_publication_id) where rule_publication_id is not null;
create index questionnaire_versions_correction_idx on public.questionnaire_assessment_versions(correction_of_version_id) where correction_of_version_id is not null;
create index questionnaire_versions_signed_by_idx on public.questionnaire_assessment_versions(signed_by) where signed_by is not null;

create function private.questionnaire_correction_lineage()
returns trigger language plpgsql security definer set search_path='' as $$
declare prior public.questionnaire_assessment_versions%rowtype;
begin
 if new.previous_version_id is not null and new.record_state='draft' then
  select * into prior from public.questionnaire_assessment_versions where id=new.previous_version_id;
  if prior.correction_of_version_id is not null then
   new.correction_of_version_id:=coalesce(new.correction_of_version_id,prior.correction_of_version_id);
   new.change_reason:=coalesce(new.change_reason,prior.change_reason);
   new.follow_up_due_on:=coalesce(new.follow_up_due_on,prior.follow_up_due_on);
  end if;
 end if;
 return new;
end; $$;
create trigger questionnaire_correction_lineage before insert on public.questionnaire_assessment_versions
for each row execute function private.questionnaire_correction_lineage();

alter function private.mutate_questionnaire_assessment_guarded(uuid,uuid,jsonb,uuid)
 rename to mutate_questionnaire_assessment_draft_v1;
revoke all on function private.mutate_questionnaire_assessment_draft_v1(uuid,uuid,jsonb,uuid)
 from public,anon,authenticated,service_role;

create function private.mutate_questionnaire_assessment_guarded(
 p_expected_organization_id uuid,p_expected_branch_id uuid,p_payload jsonb,p_idempotency_key uuid
) returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare actor uuid:=auth.uid(); action text; client uuid; form text; previous uuid; episode uuid; baseline integer;
 prior public.questionnaire_assessment_versions%rowtype; result public.questionnaire_assessment_versions%rowtype;
 operation private.questionnaire_assessment_operations%rowtype; catalog private.questionnaire_form_catalog%rowtype;
 request_hash text; receipt jsonb; result_calculation jsonb; rule_authority jsonb; challenge uuid;
 stamp timestamptz:=clock_timestamp(); display_name text; reason text; follow_up date; state text; correction uuid; signer_roles text[];
begin
 if p_expected_organization_id is null or p_expected_branch_id is null or p_idempotency_key is null
  or jsonb_typeof(p_payload) is distinct from 'object' then
  raise exception using errcode='22023',message='invalid questionnaire payload'; end if;
 action:=p_payload->>'action'; form:=p_payload->>'form_key';
 if not coalesce(action in ('create','revise','submit','sign','return','correct'),false) then
  raise exception using errcode='22023',message='invalid questionnaire action'; end if;
 begin
  client:=(p_payload->>'client_id')::uuid; previous:=nullif(p_payload->>'previous_version_id','')::uuid;
  episode:=nullif(p_payload->>'assessment_key','')::uuid; baseline:=coalesce((p_payload->>'expected_version')::integer,0);
 exception when invalid_text_representation or numeric_value_out_of_range then
  raise exception using errcode='22023',message='invalid questionnaire baseline'; end;
 if client is null or not private.questionnaire_assessment_authority(p_expected_organization_id,p_expected_branch_id,client,form,'manage') then
  raise exception using errcode='42501',message='questionnaire operation not authorized'; end if;
 -- Serialize operation replay first, then the episode. Both guards are rechecked after waits.
 perform pg_advisory_xact_lock(hashtextextended('questionnaire-operation:'||actor||':'||p_idempotency_key,0));
 if action='create' then
  if not private.questionnaire_assessment_authority(p_expected_organization_id,p_expected_branch_id,client,form,'manage') then
   raise exception using errcode='42501',message='questionnaire authority expired'; end if;
  return private.mutate_questionnaire_assessment_draft_v1(p_expected_organization_id,p_expected_branch_id,p_payload,p_idempotency_key);
 end if;
 if episode is null or previous is null or baseline<1 then raise exception using errcode='22023',message='missing questionnaire baseline'; end if;
 perform pg_advisory_xact_lock(hashtextextended('questionnaire-episode:'||p_expected_organization_id||':'||episode,0));
 select * into prior from public.questionnaire_assessment_versions v where v.id=previous and v.assessment_key=episode
  and v.organization_id=p_expected_organization_id and v.branch_id=p_expected_branch_id
  and v.client_id=client and v.form_key=form and v.version=baseline for share;
 if not found then raise exception using errcode='42501',message='questionnaire baseline not authorized'; end if;
 if not private.questionnaire_assessment_authority(p_expected_organization_id,p_expected_branch_id,client,form,'manage') then
  raise exception using errcode='42501',message='questionnaire authority expired'; end if;
 if action='revise' then
  -- Exact retries remain legal after a newer lifecycle step; no new edit may overwrite signed/submitted content.
  if prior.record_state<>'draft' then raise exception using errcode='55000',message='questionnaire is immutable outside draft'; end if;
  return private.mutate_questionnaire_assessment_draft_v1(p_expected_organization_id,p_expected_branch_id,p_payload,p_idempotency_key);
 end if;
 if p_payload-array['action','client_id','form_key','assessment_key','previous_version_id','expected_version','reason','follow_up_due_on','safety_acknowledged']<>'{}'::jsonb then
  raise exception using errcode='22023',message='invalid questionnaire lifecycle keys'; end if;
 reason:=nullif(btrim(p_payload->>'reason'),'');
 if reason is not null and (length(reason)>500 or translate(reason,E'\n\r\t','')~'[[:cntrl:]]') then
  raise exception using errcode='22023',message='invalid questionnaire reason'; end if;
 begin follow_up:=nullif(p_payload->>'follow_up_due_on','')::date;
 exception when invalid_datetime_format or datetime_field_overflow then
  raise exception using errcode='22023',message='invalid questionnaire follow-up date'; end;
 if follow_up is not null and (follow_up<prior.assessed_on or follow_up>date '2200-12-31') then
  raise exception using errcode='22023',message='invalid questionnaire follow-up date'; end if;
 if action in ('sign','correct','return') then
  if not private.questionnaire_sign_authority(p_expected_organization_id,p_expected_branch_id,client,form) then
   raise exception using errcode='42501',message='questionnaire signer not authorized'; end if;
  challenge:=private.questionnaire_reauth();
 end if;
 request_hash:=encode(sha256(convert_to(jsonb_build_object('organization',p_expected_organization_id,
  'branch',p_expected_branch_id,'payload',p_payload)::text,'UTF8')),'hex');
 select * into operation from private.questionnaire_assessment_operations o
 where o.actor_user_id=actor and o.idempotency_key=p_idempotency_key;
 if found then
  if operation.request_hash<>request_hash then raise exception using errcode='23505',message='questionnaire idempotency key reused'; end if;
  return operation.receipt||jsonb_build_object('replayed',true);
 end if;
 if exists(select 1 from public.questionnaire_assessment_versions v where v.previous_version_id=previous) then
  raise exception using errcode='40001',message='questionnaire baseline changed'; end if;
 if baseline>=1000000 then raise exception using errcode='22003',message='questionnaire version exhausted'; end if;
 select * into strict catalog from private.questionnaire_form_catalog where form_key=form and form_version=prior.form_version;
 result_calculation:=private.questionnaire_calculation(form,prior.form_version,prior.answers,prior.context);
 correction:=prior.correction_of_version_id;
 if action='submit' then
  if prior.record_state<>'draft' then raise exception using errcode='55000',message='only draft can be submitted'; end if;
  if exists(select 1 from jsonb_each(prior.answers) a where a.value->>'state'='missing')
   or (form='spmsq' and not (prior.context ? 'education_adjustment')) then
   raise exception using errcode='22023',message='questionnaire required answers missing'; end if;
  if form='bsrs5' and (prior.answers->'bsrs_suicide'->>'value')::integer>0
    and p_payload->'safety_acknowledged' is distinct from 'true'::jsonb then
   raise exception using errcode='22023',message='questionnaire safety concern needs acknowledgement'; end if;
  state:='submitted';
 elsif action='sign' then
  if prior.record_state<>'submitted' then raise exception using errcode='55000',message='only submitted assessment can be signed'; end if;
  rule_authority:=private.questionnaire_rule_authority(p_expected_organization_id,p_expected_branch_id,form,prior.form_version,prior.assessed_on);
  if rule_authority is null then raise exception using errcode='55000',message='questionnaire rule has not been independently published'; end if;
  state:='signed'; follow_up:=prior.follow_up_due_on;
 elsif action='return' then
  if prior.record_state<>'submitted' or reason is null then
   raise exception using errcode='22023',message='return needs submitted record and reason'; end if;
  state:='draft'; follow_up:=prior.follow_up_due_on;
 else
  if prior.record_state<>'signed' or reason is null then
   raise exception using errcode='22023',message='correction needs signed record and reason'; end if;
  state:='draft'; correction:=prior.id; follow_up:=prior.follow_up_due_on;
 end if;
 select p.display_name into display_name from public.profiles p where p.id=actor and p.is_active;
 select array_agg(distinct r.role_key order by r.role_key) into signer_roles from public.memberships m
 join public.membership_roles mr on mr.membership_id=m.id and mr.assigned_at<=clock_timestamp()
 join public.roles r on r.id=mr.role_id and r.is_active and (r.organization_id is null or r.organization_id=p_expected_organization_id)
 where m.profile_id=actor and m.organization_id=p_expected_organization_id and (m.branch_id is null or m.branch_id=p_expected_branch_id)
 and m.status='active' and m.starts_at<=clock_timestamp() and (m.ends_at is null or m.ends_at>clock_timestamp());
 if display_name is null then raise exception using errcode='42501',message='questionnaire actor unavailable'; end if;
 if not private.questionnaire_assessment_authority(p_expected_organization_id,p_expected_branch_id,client,form,'manage')
  or (action in ('sign','correct','return') and not private.questionnaire_sign_authority(p_expected_organization_id,p_expected_branch_id,client,form)) then
  raise exception using errcode='42501',message='questionnaire authority expired'; end if;
 insert into public.questionnaire_assessment_versions(
  organization_id,branch_id,client_id,form_key,form_version,assessment_key,version,previous_version_id,
  assessed_on,answers,context,record_state,content_hash,author_user_id,author_display_name,created_at,
  write_reauth_challenge_id,form_snapshot,rule_snapshot,result_snapshot,rule_publication_id,
  correction_of_version_id,change_reason,follow_up_due_on,signed_at,signed_by,signer_display_name,signer_role_keys,signature_hash
 ) values(p_expected_organization_id,p_expected_branch_id,client,form,prior.form_version,episode,baseline+1,previous,
  prior.assessed_on,prior.answers,prior.context,state,prior.content_hash,actor,display_name,stamp,challenge,
  catalog.form_snapshot,catalog.rule_snapshot,result_calculation,
  case when state='signed' then (rule_authority->>'publicationId')::uuid else null end,
  correction,coalesce(reason,prior.change_reason),follow_up,
  case when state='signed' then stamp else null end,case when state='signed' then actor else null end,
  case when state='signed' then display_name else null end,
  case when state='signed' then signer_roles else null end,
  case when state='signed' then encode(sha256(convert_to(jsonb_build_object('contentHash',prior.content_hash,
   'formSnapshot',catalog.form_snapshot,'ruleSnapshot',catalog.rule_snapshot,'resultSnapshot',result_calculation,
   'authority',rule_authority,'signer',actor,'signerRoles',signer_roles,'version',baseline+1,'signedAt',stamp,
   'reauth',challenge,'purpose','questionnaire_assessment_signature')::text,'UTF8')),'hex') else null end
 ) returning * into result;
 receipt:=jsonb_build_object('action',action,'clientId',client,'formKey',form,'assessmentKey',episode,
  'versionId',result.id,'version',result.version,'recordState',state,'assessedOn',prior.assessed_on,
  'contentHash',prior.content_hash,'committedAt',stamp,'replayed',false);
 insert into private.questionnaire_assessment_operations(id,organization_id,branch_id,client_id,actor_user_id,
  idempotency_key,request_hash,result_version_id,result_form_key,result_assessment_key,receipt)
 values(gen_random_uuid(),p_expected_organization_id,p_expected_branch_id,client,actor,p_idempotency_key,
  request_hash,result.id,form,episode,receipt);
 if not private.questionnaire_assessment_authority(p_expected_organization_id,p_expected_branch_id,client,form,'manage')
  or (action in ('sign','correct','return') and (not private.questionnaire_sign_authority(p_expected_organization_id,p_expected_branch_id,client,form)
   or private.questionnaire_reauth() is null)) then
  raise exception using errcode='42501',message='questionnaire authority expired'; end if;
 return receipt;
end; $$;

-- The public invoker must be replaced: its original SQL dependency binds to
-- the renamed draft function, which is deliberately no longer executable.
create or replace function public.mutate_questionnaire_assessment(
 p_expected_organization_id uuid,p_expected_branch_id uuid,p_payload jsonb,p_idempotency_key uuid
) returns jsonb language sql volatile security invoker set search_path='' as $$
 select private.mutate_questionnaire_assessment_guarded(p_expected_organization_id,p_expected_branch_id,p_payload,p_idempotency_key);
$$;

revoke all on function private.questionnaire_sign_authority(uuid,uuid,uuid,text),
 private.questionnaire_reauth(),private.protect_questionnaire_rule_publication(),
 private.questionnaire_correction_lineage(),
 private.questionnaire_rule_authority(uuid,uuid,text,text,date),private.questionnaire_calculation(text,text,jsonb,jsonb),
 private.mutate_questionnaire_assessment_guarded(uuid,uuid,jsonb,uuid)
 from public,anon,authenticated,service_role;
grant execute on function private.mutate_questionnaire_assessment_guarded(uuid,uuid,jsonb,uuid) to authenticated;

commit;
