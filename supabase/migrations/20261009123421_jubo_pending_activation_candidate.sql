-- Candidate-only admission review for the 23 reviewed JUBO master shells.
-- This is intentionally NOT an admission endpoint. The current document
-- pipeline has no verified official eligibility / signed service-agreement
-- category, so evidence remains unverified and the existing pending->active
-- trigger stays closed. A later migration needs source-bound proof and a
-- separately reviewed lifecycle transition before enabling formal service.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';

alter table private.jubo_public_pending_links
  add constraint jubo_public_pending_links_id_scope_key unique(id,organization_id,branch_id,client_id);

create table private.jubo_pending_admission_proposals (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  branch_id uuid not null,
  client_id uuid not null,
  pending_link_id uuid not null,
  proposal_version integer not null check(proposal_version between 1 and 1000000),
  expected_client_row_version bigint not null check(expected_client_row_version>0),
  proposed_admitted_on date not null check(proposed_admitted_on between date '2000-01-01' and date '2100-01-01'),
  -- Opaque references and hashes are attestations to be checked by a future
  -- trusted source worker, NOT proof that the referenced documents exist.
  eligibility_reference text not null check(char_length(btrim(eligibility_reference)) between 8 and 240 and eligibility_reference !~ '[[:cntrl:]]'),
  eligibility_sha256 text not null check(eligibility_sha256 ~ '^[a-f0-9]{64}$'),
  eligibility_from date not null,
  eligibility_to date not null,
  agreement_reference text not null check(char_length(btrim(agreement_reference)) between 8 and 240 and agreement_reference !~ '[[:cntrl:]]'),
  agreement_sha256 text not null check(agreement_sha256 ~ '^[a-f0-9]{64}$'),
  source_identity_sha256 text not null check(source_identity_sha256 ~ '^[a-f0-9]{64}$'),
  source_verification_status text not null default 'unverified' check(source_verification_status='unverified'),
  review_reason text not null check(char_length(btrim(review_reason)) between 10 and 1000 and review_reason !~ '[[:cntrl:]]'),
  proposed_by uuid not null references auth.users(id) on delete restrict,
  reauth_challenge_id uuid not null references private.reauth_challenges(id) on delete restrict,
  idempotency_key uuid not null,
  request_sha256 text not null check(request_sha256 ~ '^[a-f0-9]{64}$'),
  proposed_at timestamptz not null default clock_timestamp(),
  foreign key(client_id,organization_id,branch_id) references public.clients(id,organization_id,branch_id) on delete restrict,
  foreign key(pending_link_id,organization_id,branch_id,client_id)
    references private.jubo_public_pending_links(id,organization_id,branch_id,client_id) on delete restrict,
  unique(client_id,proposal_version),
  unique(proposed_by,idempotency_key),
  unique(id,organization_id,branch_id,client_id),
  check(eligibility_to>=eligibility_from and proposed_admitted_on between eligibility_from and eligibility_to)
);
create index jubo_pending_admission_proposals_scope_idx on private.jubo_pending_admission_proposals
  (organization_id,branch_id,client_id,proposal_version desc);
create index jubo_pending_admission_proposals_reauth_idx on private.jubo_pending_admission_proposals(reauth_challenge_id);

create table private.jubo_pending_admission_reviews (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  branch_id uuid not null,
  client_id uuid not null,
  proposal_id uuid not null,
  proposal_sha256 text not null check(proposal_sha256 ~ '^[a-f0-9]{64}$'),
  decision text not null check(decision in ('approved','held','rejected')),
  review_reason text not null check(char_length(btrim(review_reason)) between 10 and 1000 and review_reason !~ '[[:cntrl:]]'),
  reviewed_by uuid not null references auth.users(id) on delete restrict,
  reauth_challenge_id uuid not null references private.reauth_challenges(id) on delete restrict,
  idempotency_key uuid not null,
  request_sha256 text not null check(request_sha256 ~ '^[a-f0-9]{64}$'),
  reviewed_at timestamptz not null default clock_timestamp(),
  foreign key(proposal_id,organization_id,branch_id,client_id)
    references private.jubo_pending_admission_proposals(id,organization_id,branch_id,client_id) on delete restrict,
  unique(proposal_id),
  unique(reviewed_by,idempotency_key)
);
create index jubo_pending_admission_reviews_scope_idx on private.jubo_pending_admission_reviews
  (organization_id,branch_id,client_id,reviewed_at desc);
create index jubo_pending_admission_reviews_reauth_idx on private.jubo_pending_admission_reviews(reauth_challenge_id);

do $tables$ declare t text; begin
  foreach t in array array['jubo_pending_admission_proposals','jubo_pending_admission_reviews'] loop
    execute format('alter table private.%I enable row level security',t);
    execute format('alter table private.%I force row level security',t);
    execute format('revoke all on private.%I from public,anon,authenticated,service_role',t);
    execute format('create trigger %I before update or delete on private.%I for each row execute function private.prevent_import_upload_mutation()',t||'_immutable',t);
    execute format('create trigger %I after insert on private.%I for each row execute function private.audit_row_change()',t||'_audit',t);
  end loop;
end $tables$;

-- The general client-master AAL2 helper currently admits only the pinned
-- executive. This local helper additionally admits an individually approved
-- staff Google session, without relaxing any global authorization function.
create function private.current_jubo_pending_reviewer_challenge()
returns uuid language plpgsql volatile security definer set search_path='' as $$
declare v_session uuid; v_challenge uuid; v_now timestamptz:=clock_timestamp();
begin
  if auth.uid() is null or auth.jwt()->>'aal' is distinct from 'aal2'
    or not (private.is_executive_login_allowed() or private.is_staff_google_session_allowed()) then
    raise exception using errcode='42501',message='JUBO_PENDING_ADMISSION_AAL2_REQUIRED';
  end if;
  begin v_session:=nullif(auth.jwt()->>'session_id','')::uuid;
  exception when invalid_text_representation then
    raise exception using errcode='42501',message='JUBO_PENDING_ADMISSION_AAL2_REQUIRED';
  end;
  select challenge.id into v_challenge from private.reauth_events event
  join private.reauth_challenges challenge on challenge.id=event.challenge_id
    and challenge.user_id=event.user_id and challenge.session_id=event.session_id
  where event.user_id=auth.uid() and event.session_id=v_session and event.aal='aal2'
    and event.revoked_at is null and event.verification_method in ('totp','webauthn','phone')
    and challenge.consumed_at is not null and challenge.invalidated_at is null
    and challenge.factor_method=event.verification_method
    and challenge.factor_verified_at=event.verified_at
    and challenge.factor_verified_at between v_now-interval '15 minutes' and v_now+interval '1 minute'
  order by challenge.factor_verified_at desc,challenge.id desc limit 1
  for share of event,challenge;
  if v_challenge is null then
    raise exception using errcode='42501',message='JUBO_PENDING_ADMISSION_AAL2_REQUIRED';
  end if;
  return v_challenge;
end;
$$;

create function private.require_jubo_pending_admission_reviewer(p_org uuid,p_branch uuid,p_client uuid)
returns uuid language plpgsql volatile security definer set search_path='' as $$
declare v_challenge uuid;
begin
  if auth.uid() is null or p_org is null or p_branch is null or p_client is null
    or not exists(select 1 from public.organizations o join public.branches b
      on b.organization_id=o.id where o.id=p_org and b.id=p_branch and o.is_active and b.is_active)
    or not ((private.has_permission(p_org,p_branch,'clients.read')
      and private.has_permission(p_org,p_branch,'clients.demographics.read')
      and private.has_permission(p_org,p_branch,'clients.manage')
      and private.can_staff_access_client(p_client,'clients.manage'))
      or private.has_routine_intake_access(p_org,p_branch,'profile.update',p_client))
    or not exists(select 1 from public.clients c
      join private.jubo_public_pending_links link on link.client_id=c.id
        and link.organization_id=c.organization_id and link.branch_id=c.branch_id
      join private.jubo_pending_master_rows source_row on source_row.id=link.pending_row_id
      where c.id=p_client and c.organization_id=p_org and c.branch_id=p_branch
        and c.source_system='jubo' and c.status='pending' and c.admitted_on is null
        and c.ended_on is null and source_row.source_status='服務中') then
    raise exception using errcode='42501',message='JUBO_PENDING_ADMISSION_SCOPE_DENIED';
  end if;
  v_challenge:=private.current_jubo_pending_reviewer_challenge();
  return v_challenge;
end;
$$;

create function private.propose_jubo_pending_admission(
  p_org uuid,p_branch uuid,p_client uuid,p_admitted_on date,
  p_eligibility_reference text,p_eligibility_sha256 text,
  p_eligibility_from date,p_eligibility_to date,
  p_agreement_reference text,p_agreement_sha256 text,
  p_expected_client_row_version bigint,p_reason text,p_idempotency_key uuid
) returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare v_client public.clients%rowtype; v_link private.jubo_public_pending_links%rowtype;
  v_identity text; v_challenge uuid; v_previous private.jubo_pending_admission_proposals%rowtype;
  v_result private.jubo_pending_admission_proposals%rowtype; v_request_sha text; v_version integer;
begin
  v_challenge:=private.require_jubo_pending_admission_reviewer(p_org,p_branch,p_client);
  if p_admitted_on is null or p_admitted_on<date '2000-01-01'
    or p_admitted_on>(clock_timestamp() at time zone 'Asia/Taipei')::date
    or p_eligibility_from is null or p_eligibility_to is null
    or p_admitted_on not between p_eligibility_from and p_eligibility_to
    or p_expected_client_row_version is null or p_expected_client_row_version<1
    or p_idempotency_key is null
    or coalesce(char_length(btrim(p_eligibility_reference)),0) not between 8 and 240
    or coalesce(char_length(btrim(p_agreement_reference)),0) not between 8 and 240
    or p_eligibility_reference~'[[:cntrl:]]' or p_agreement_reference~'[[:cntrl:]]'
    or p_eligibility_sha256 is null or p_eligibility_sha256 !~ '^[a-f0-9]{64}$'
    or p_agreement_sha256 is null or p_agreement_sha256 !~ '^[a-f0-9]{64}$'
    or coalesce(char_length(btrim(p_reason)),0) not between 10 and 1000
    or p_reason~'[[:cntrl:]]' then
    raise exception using errcode='22023',message='JUBO_PENDING_ADMISSION_INVALID';
  end if;
  v_request_sha:=encode(sha256(convert_to(jsonb_build_object(
    'org',p_org,'branch',p_branch,'client',p_client,'date',p_admitted_on,
    'eligibilityReference',btrim(p_eligibility_reference),'eligibilitySha',p_eligibility_sha256,
    'from',p_eligibility_from,'to',p_eligibility_to,
    'agreementReference',btrim(p_agreement_reference),'agreementSha',p_agreement_sha256,
    'version',p_expected_client_row_version,'reason',btrim(p_reason))::text,'UTF8')),'hex');
  perform pg_advisory_xact_lock(hashtextextended('jubo-admission-proposal:'||auth.uid()||':'||p_idempotency_key,0));
  select * into v_previous from private.jubo_pending_admission_proposals
    where proposed_by=auth.uid() and idempotency_key=p_idempotency_key;
  if found then
    if v_previous.request_sha256<>v_request_sha then
      raise exception using errcode='23505',message='JUBO_PENDING_ADMISSION_IDEMPOTENCY_CONFLICT';
    end if;
    return jsonb_build_object('proposalId',v_previous.id,'proposalSha256',v_previous.request_sha256,
      'version',v_previous.proposal_version,'status','awaiting_second_review',
      'sourceVerified',false,'admissionEnabled',false,'replayed',true);
  end if;
  select * into v_client from public.clients c
    where c.id=p_client and c.organization_id=p_org and c.branch_id=p_branch for update;
  if v_client.id is null or v_client.status<>'pending' or v_client.admitted_on is not null
    or v_client.ended_on is not null or v_client.row_version<>p_expected_client_row_version then
    raise exception using errcode='40001',message='JUBO_PENDING_ADMISSION_CLIENT_CHANGED';
  end if;
  -- Recheck live membership/branch after the row lock, not only at request start.
  v_challenge:=private.require_jubo_pending_admission_reviewer(p_org,p_branch,p_client);
  select * into v_link from private.jubo_public_pending_links
    where client_id=p_client and organization_id=p_org and branch_id=p_branch;
  select identity_sha256 into v_identity from private.client_intake_identities
    where client_id=p_client and organization_id=p_org and branch_id=p_branch;
  if v_link.id is null or v_identity is null then
    raise exception using errcode='42501',message='JUBO_PENDING_ADMISSION_SOURCE_MISSING';
  end if;
  select coalesce(max(proposal_version),0)+1 into v_version
    from private.jubo_pending_admission_proposals where client_id=p_client;
  insert into private.jubo_pending_admission_proposals(
    organization_id,branch_id,client_id,pending_link_id,proposal_version,
    expected_client_row_version,proposed_admitted_on,eligibility_reference,
    eligibility_sha256,eligibility_from,eligibility_to,agreement_reference,
    agreement_sha256,source_identity_sha256,review_reason,proposed_by,
    reauth_challenge_id,idempotency_key,request_sha256)
  values(p_org,p_branch,p_client,v_link.id,v_version,p_expected_client_row_version,
    p_admitted_on,btrim(p_eligibility_reference),p_eligibility_sha256,
    p_eligibility_from,p_eligibility_to,btrim(p_agreement_reference),
    p_agreement_sha256,v_identity,btrim(p_reason),auth.uid(),v_challenge,
    p_idempotency_key,v_request_sha) returning * into v_result;
  return jsonb_build_object('proposalId',v_result.id,'proposalSha256',v_result.request_sha256,
    'version',v_result.proposal_version,'status','awaiting_second_review',
    'sourceVerified',false,'admissionEnabled',false,'replayed',false);
end;
$$;

create function public.propose_jubo_pending_admission(
  p_org uuid,p_branch uuid,p_client uuid,p_admitted_on date,
  p_eligibility_reference text,p_eligibility_sha256 text,
  p_eligibility_from date,p_eligibility_to date,
  p_agreement_reference text,p_agreement_sha256 text,
  p_expected_client_row_version bigint,p_reason text,p_idempotency_key uuid
) returns jsonb language sql volatile security invoker set search_path='' as $$
  select private.propose_jubo_pending_admission(p_org,p_branch,p_client,p_admitted_on,
    p_eligibility_reference,p_eligibility_sha256,p_eligibility_from,p_eligibility_to,
    p_agreement_reference,p_agreement_sha256,p_expected_client_row_version,p_reason,p_idempotency_key);
$$;

create function private.review_jubo_pending_admission(
  p_org uuid,p_branch uuid,p_client uuid,p_proposal uuid,p_expected_sha256 text,
  p_decision text,p_reason text,p_idempotency_key uuid
) returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare v_challenge uuid; v_client public.clients%rowtype;
  v_proposal private.jubo_pending_admission_proposals%rowtype;
  v_previous private.jubo_pending_admission_reviews%rowtype;
  v_result private.jubo_pending_admission_reviews%rowtype; v_sha text;
begin
  v_challenge:=private.require_jubo_pending_admission_reviewer(p_org,p_branch,p_client);
  if p_proposal is null or p_expected_sha256 is null or p_expected_sha256 !~ '^[a-f0-9]{64}$'
    or p_decision not in ('approved','held','rejected') or p_decision is null
    or p_idempotency_key is null or coalesce(char_length(btrim(p_reason)),0) not between 10 and 1000
    or p_reason~'[[:cntrl:]]' then
    raise exception using errcode='22023',message='JUBO_PENDING_ADMISSION_REVIEW_INVALID';
  end if;
  v_sha:=encode(sha256(convert_to(jsonb_build_object('org',p_org,'branch',p_branch,
    'client',p_client,'proposal',p_proposal,'expectedSha',p_expected_sha256,
    'decision',p_decision,'reason',btrim(p_reason))::text,'UTF8')),'hex');
  perform pg_advisory_xact_lock(hashtextextended('jubo-admission-review:'||auth.uid()||':'||p_idempotency_key,0));
  select * into v_previous from private.jubo_pending_admission_reviews
    where reviewed_by=auth.uid() and idempotency_key=p_idempotency_key;
  if found then
    if v_previous.request_sha256<>v_sha then
      raise exception using errcode='23505',message='JUBO_PENDING_ADMISSION_REVIEW_IDEMPOTENCY_CONFLICT';
    end if;
    return jsonb_build_object('reviewId',v_previous.id,'decision',v_previous.decision,
      'status','source_verification_required','admissionEnabled',false,'replayed',true);
  end if;
  select * into v_client from public.clients c
    where c.id=p_client and c.organization_id=p_org and c.branch_id=p_branch for update;
  v_challenge:=private.require_jubo_pending_admission_reviewer(p_org,p_branch,p_client);
  select * into v_proposal from private.jubo_pending_admission_proposals
    where id=p_proposal and organization_id=p_org and branch_id=p_branch and client_id=p_client;
  if v_client.id is null or v_proposal.id is null or v_proposal.proposed_by=auth.uid()
    or v_client.row_version<>v_proposal.expected_client_row_version
    or v_proposal.request_sha256<>p_expected_sha256
    or v_proposal.source_verification_status<>'unverified'
    or v_proposal.proposal_version<>(select max(proposal_version)
      from private.jubo_pending_admission_proposals where client_id=p_client) then
    raise exception using errcode='42501',message='JUBO_PENDING_ADMISSION_INDEPENDENT_REVIEW_REQUIRED';
  end if;
  if exists(select 1 from private.jubo_pending_admission_reviews where proposal_id=p_proposal) then
    raise exception using errcode='23505',message='JUBO_PENDING_ADMISSION_ALREADY_REVIEWED';
  end if;
  insert into private.jubo_pending_admission_reviews(
    organization_id,branch_id,client_id,proposal_id,proposal_sha256,
    decision,review_reason,reviewed_by,reauth_challenge_id,idempotency_key,request_sha256)
  values(p_org,p_branch,p_client,p_proposal,p_expected_sha256,p_decision,btrim(p_reason),
    auth.uid(),v_challenge,p_idempotency_key,v_sha) returning * into v_result;
  return jsonb_build_object('reviewId',v_result.id,'decision',v_result.decision,
    'status','source_verification_required','admissionEnabled',false,'replayed',false);
end;
$$;

create function public.review_jubo_pending_admission(
  p_org uuid,p_branch uuid,p_client uuid,p_proposal uuid,p_expected_sha256 text,
  p_decision text,p_reason text,p_idempotency_key uuid
) returns jsonb language sql volatile security invoker set search_path='' as $$
  select private.review_jubo_pending_admission(p_org,p_branch,p_client,p_proposal,
    p_expected_sha256,p_decision,p_reason,p_idempotency_key);
$$;

-- Explicit final boundary. No public wrapper or grant exists; even a privileged
-- caller cannot mark a client active until an official source-verification
-- contract, evidence linkage and lifecycle migration are separately reviewed.
create function private.activate_jubo_pending_client_candidate(p_org uuid,p_branch uuid,p_client uuid)
returns jsonb language plpgsql volatile security definer set search_path='' as $$
begin
  raise exception using errcode='42501',message='JUBO_PENDING_ADMISSION_SOURCE_UNCONFIGURED';
end;
$$;

alter function private.current_jubo_pending_reviewer_challenge() owner to postgres;
alter function private.require_jubo_pending_admission_reviewer(uuid,uuid,uuid) owner to postgres;
alter function private.propose_jubo_pending_admission(uuid,uuid,uuid,date,text,text,date,date,text,text,bigint,text,uuid) owner to postgres;
alter function private.review_jubo_pending_admission(uuid,uuid,uuid,uuid,text,text,text,uuid) owner to postgres;
alter function private.activate_jubo_pending_client_candidate(uuid,uuid,uuid) owner to postgres;
revoke all on function private.current_jubo_pending_reviewer_challenge(),
  private.require_jubo_pending_admission_reviewer(uuid,uuid,uuid),
  private.propose_jubo_pending_admission(uuid,uuid,uuid,date,text,text,date,date,text,text,bigint,text,uuid),
  private.review_jubo_pending_admission(uuid,uuid,uuid,uuid,text,text,text,uuid),
  private.activate_jubo_pending_client_candidate(uuid,uuid,uuid)
  from public,anon,authenticated,service_role;
revoke all on function public.propose_jubo_pending_admission(uuid,uuid,uuid,date,text,text,date,date,text,text,bigint,text,uuid),
  public.review_jubo_pending_admission(uuid,uuid,uuid,uuid,text,text,text,uuid)
  from public,anon,authenticated,service_role;
grant execute on function private.propose_jubo_pending_admission(uuid,uuid,uuid,date,text,text,date,date,text,text,bigint,text,uuid),
  private.review_jubo_pending_admission(uuid,uuid,uuid,uuid,text,text,text,uuid),
  public.propose_jubo_pending_admission(uuid,uuid,uuid,date,text,text,date,date,text,text,bigint,text,uuid),
  public.review_jubo_pending_admission(uuid,uuid,uuid,uuid,text,text,text,uuid)
  to authenticated;
comment on function private.activate_jubo_pending_client_candidate(uuid,uuid,uuid) is
  'Fail closed: official eligibility source, signed agreement evidence and a separately reviewed lifecycle transition are not configured. Never infer admission from JUBO first service date.';
commit;
