begin;
set local lock_timeout='5s';

-- Preparation and independent review only. A reference/SHA is a declaration,
-- not verification of eligibility or a signed agreement. The final promotion
-- remains fail-closed and no clinical/attendance/transport guard is changed.
alter table private.jubo_operator_master_links add constraint jubo_operator_link_scoped_id
 unique(id,organization_id,branch_id,client_id);
alter table private.jubo_pending_admission_proposals alter column pending_link_id drop not null;
alter table private.jubo_pending_admission_proposals
 add column operator_master_link_id uuid,
 add column source_binding jsonb check(source_binding is null or jsonb_typeof(source_binding)='object'),
 add column expected_intake_version bigint check(expected_intake_version is null or expected_intake_version>=0),
 add constraint jubo_admission_exact_source check(num_nonnulls(pending_link_id,operator_master_link_id)=1),
 add constraint jubo_admission_operator_source_fk foreign key(operator_master_link_id,organization_id,branch_id,client_id)
 references private.jubo_operator_master_links(id,organization_id,branch_id,client_id) on delete restrict;
create index jubo_admission_operator_source_idx on private.jubo_pending_admission_proposals(operator_master_link_id)
 where operator_master_link_id is not null;

create function private.jubo_admission_preparation_source(p_org uuid,p_branch uuid,p_client uuid)
returns jsonb language sql stable security definer set search_path='' as $$
 select coalesce(
 (select jsonb_build_object('kind','reviewed_export','linkId',l.id,'identitySha256',r.identity_sha256,
  'rowSha256',s.master_source_row_sha256,'mappingSha256',s.mapping_review_sha256,'sourceStatus',r.source_status)
  from private.jubo_public_pending_links l join private.jubo_pending_master_rows r on r.id=l.pending_row_id
   and r.organization_id=l.organization_id and r.branch_id=l.branch_id
  join private.jubo_intake_profile_sources s on s.promotion_link_id=l.id and s.client_id=l.client_id
   and s.organization_id=l.organization_id and s.branch_id=l.branch_id
  where l.client_id=p_client and l.organization_id=p_org and l.branch_id=p_branch),
 (select jsonb_build_object('kind','operator_master','linkId',l.id,'identitySha256',l.identity_sha256,
  'rowSha256',l.source_row_sha256,'datasetSha256',op.dataset_sha256,'sourceStatus',l.source_status)
  from private.jubo_operator_master_links l join private.jubo_operator_imports op on op.id=l.operation_id
   and op.organization_id=l.organization_id and op.branch_id=l.branch_id
  where l.client_id=p_client and l.organization_id=p_org and l.branch_id=p_branch
   and op.execution_mode='database_operator'
   and op.authorization_reference='direct-owner-authorization:20261011:23-master-17-reconcile'
   and op.dataset_sha256='21cd8a0b789c1b159a0cfdf7c80983a8a016602d9253a7335062df64708173da'));
$$;
revoke all on function private.jubo_admission_preparation_source(uuid,uuid,uuid) from public,anon,authenticated,service_role;

create function private.jubo_admission_preparation_authority(p_org uuid,p_branch uuid,p_client uuid)
returns boolean language sql volatile security definer set search_path='' as $$
 select private.jubo_pending_questionnaire_scope(p_org,p_branch,p_client)
  and private.has_routine_intake_access(p_org,p_branch,'profile.update',p_client)
  and private.jubo_admission_preparation_source(p_org,p_branch,p_client) is not null;
$$;
revoke all on function private.jubo_admission_preparation_authority(uuid,uuid,uuid) from public,anon,authenticated,service_role;

create or replace function private.require_jubo_pending_admission_reviewer(p_org uuid,p_branch uuid,p_client uuid)
returns uuid language plpgsql volatile security definer set search_path='' as $$
begin
 if not private.jubo_admission_preparation_authority(p_org,p_branch,p_client)
  or private.jubo_admission_preparation_source(p_org,p_branch,p_client)->>'sourceStatus' is distinct from '服務中' then
  raise exception using errcode='42501',message='JUBO_PENDING_ADMISSION_SCOPE_DENIED'; end if;
 return private.current_jubo_pending_reviewer_challenge();
end; $$;

-- A director's role is checked from active native membership, not supplied
-- email, UI role or a database-operator provenance record.
create function private.jubo_admission_independent_director(p_org uuid,p_branch uuid)
returns boolean language sql volatile security definer set search_path='' as $$
 select public.is_staff_login_allowed() and exists(select 1 from public.profiles p
  join public.memberships m on m.profile_id=p.id join public.membership_roles mr on mr.membership_id=m.id
  join public.roles r on r.id=mr.role_id where p.id=auth.uid() and p.is_active and p.kind='staff'
   and m.organization_id=p_org and (m.branch_id is null or m.branch_id=p_branch)
   and m.status='active' and m.starts_at<=clock_timestamp() and (m.ends_at is null or m.ends_at>clock_timestamp())
   and mr.assigned_at<=clock_timestamp() and r.is_active and r.is_system and r.role_key='branch_director');
$$;
revoke all on function private.jubo_admission_independent_director(uuid,uuid) from public,anon,authenticated,service_role;

do $patch$ declare d text; anchor text; begin
 d:=pg_get_functiondef('private.propose_jubo_pending_admission(uuid,uuid,uuid,date,text,text,date,date,text,text,bigint,text,uuid)'::regprocedure);
 anchor:='v_identity text; v_challenge uuid;';
 if position(anchor in d)=0 then raise exception 'unexpected admission proposal declaration'; end if;
 d:=replace(d,anchor,'v_source jsonb; v_intake_version bigint; '||anchor);
 anchor:=$old$  select * into v_link from private.jubo_public_pending_links
    where client_id=p_client and organization_id=p_org and branch_id=p_branch;
  select identity_sha256 into v_identity from private.client_intake_identities
    where client_id=p_client and organization_id=p_org and branch_id=p_branch;
  if v_link.id is null or v_identity is null then$old$;
 if position(anchor in d)=0 then raise exception 'unexpected admission proposal source'; end if;
 d:=replace(d,anchor,$new$  v_source:=private.jubo_admission_preparation_source(p_org,p_branch,p_client);
  v_identity:=v_source->>'identitySha256';
  if v_source->>'kind'='reviewed_export' then v_link.id:=(v_source->>'linkId')::uuid; end if;
  select coalesce(max(version),0) into v_intake_version from private.client_intake_versions
   where client_id=p_client and organization_id=p_org and branch_id=p_branch;
  if v_source is null or v_identity is null then$new$);
 anchor:='reauth_challenge_id,idempotency_key,request_sha256)';
 if position(anchor in d)=0 then raise exception 'unexpected admission proposal columns'; end if;
 d:=replace(d,anchor,'reauth_challenge_id,idempotency_key,request_sha256,operator_master_link_id,source_binding,expected_intake_version)');
 anchor:='p_idempotency_key,v_request_sha) returning * into v_result;';
 if position(anchor in d)=0 then raise exception 'unexpected admission proposal values'; end if;
 d:=replace(d,anchor,'p_idempotency_key,v_request_sha,case when v_source->>''kind''=''operator_master'' then (v_source->>''linkId'')::uuid end,v_source,v_intake_version) returning * into v_result;');
 execute d;
 d:=pg_get_functiondef('private.review_jubo_pending_admission(uuid,uuid,uuid,uuid,text,text,text,uuid)'::regprocedure);
 anchor:='  v_challenge:=private.require_jubo_pending_admission_reviewer(p_org,p_branch,p_client);';
 if position(anchor in d)=0 then raise exception 'unexpected admission review authority'; end if;
 d:=replace(d,anchor,anchor||E'\n  if not private.jubo_admission_independent_director(p_org,p_branch) then\n    raise exception using errcode=''42501'',message=''JUBO_PENDING_ADMISSION_INDEPENDENT_REVIEW_REQUIRED''; end if;');
 anchor:='  if v_client.id is null or v_proposal.id is null or v_proposal.proposed_by=auth.uid()';
 if position(anchor in d)=0 then raise exception 'unexpected independent admission review'; end if;
 d:=replace(d,anchor,anchor||E'\n    or not private.jubo_admission_independent_director(p_org,p_branch)\n    or v_proposal.source_binding is null\n    or v_proposal.source_binding is distinct from private.jubo_admission_preparation_source(p_org,p_branch,p_client)\n    or v_proposal.expected_intake_version is distinct from (select coalesce(max(version),0) from private.client_intake_versions where client_id=p_client and organization_id=p_org and branch_id=p_branch)');
 execute d;
end $patch$;

create function private.jubo_admission_preparation_snapshot(p_org uuid,p_branch uuid,p_client uuid)
returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare c public.clients%rowtype; source jsonb; proposals jsonb; intake_version bigint;
begin
 if not private.jubo_admission_preparation_authority(p_org,p_branch,p_client) then
  raise exception using errcode='42501',message='JUBO_PENDING_ADMISSION_SCOPE_DENIED'; end if;
 select * into c from public.clients where id=p_client and organization_id=p_org and branch_id=p_branch;
 source:=private.jubo_admission_preparation_source(p_org,p_branch,p_client);
 select coalesce(max(version),0) into intake_version from private.client_intake_versions where client_id=p_client;
 select coalesce(jsonb_agg(jsonb_build_object('id',p.id,'version',p.proposal_version,
  'sha256',p.request_sha256,'clientRowVersion',p.expected_client_row_version,
  'admittedOn',p.proposed_admitted_on,'eligibilityReference',p.eligibility_reference,
  'eligibilitySha256',p.eligibility_sha256,'eligibilityFrom',p.eligibility_from,'eligibilityTo',p.eligibility_to,
  'agreementReference',p.agreement_reference,'agreementSha256',p.agreement_sha256,
  'reason',p.review_reason,'proposedAt',p.proposed_at,'ownProposal',p.proposed_by=auth.uid(),
  'reviewDecision',r.decision,'reviewReason',r.review_reason,
  'canReview',coalesce(r.id is null and p.proposed_by<>auth.uid() and private.jubo_admission_independent_director(p_org,p_branch)
   and source->>'sourceStatus'='服務中' and p.expected_client_row_version=c.row_version
   and p.expected_intake_version=intake_version and p.source_binding=source
   and p.proposal_version=(select max(proposal_version) from private.jubo_pending_admission_proposals where client_id=p_client),false)
  ) order by p.proposal_version desc),'[]'::jsonb) into proposals
 from (select * from private.jubo_pending_admission_proposals where client_id=p_client
   and organization_id=p_org and branch_id=p_branch order by proposal_version desc limit 20) p
 left join private.jubo_pending_admission_reviews r on r.proposal_id=p.id;
 return jsonb_build_object('clientId',c.id,'clientRowVersion',c.row_version,'intakeVersion',intake_version,
  'sourceKind',source->>'kind','sourceStatus',source->>'sourceStatus',
  'canSubmit',source->>'sourceStatus'='服務中','admissionEnabled',false,'sourceVerified',false,'proposals',proposals);
end; $$;
create function public.jubo_admission_preparation_snapshot(p_org uuid,p_branch uuid,p_client uuid)
returns jsonb language sql volatile security invoker set search_path='' as $$
 select private.jubo_admission_preparation_snapshot(p_org,p_branch,p_client);
$$;
revoke all on function private.jubo_admission_preparation_snapshot(uuid,uuid,uuid),
 public.jubo_admission_preparation_snapshot(uuid,uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function private.jubo_admission_preparation_snapshot(uuid,uuid,uuid),
 public.jubo_admission_preparation_snapshot(uuid,uuid,uuid) to authenticated;
comment on function public.jubo_admission_preparation_snapshot(uuid,uuid,uuid) is
 'Scoped native staff preparation/readback. Independent director review is not admission; eligibility references and SHA declarations are not verified document evidence.';
commit;
