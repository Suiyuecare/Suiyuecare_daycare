-- Candidate only: one source-bound, purpose-bound human preview and decision
-- per JUBO v2 intake-profile mapping. This does not grant public promotion.
begin;
set local lock_timeout = '5s';

create table private.jubo_profile_mapping_v2_previews (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  branch_id uuid not null,
  pair_id uuid not null,
  master_source_row_id uuid not null,
  actor_user_id uuid not null references auth.users(id) on delete restrict,
  actor_session_id uuid not null,
  reauth_challenge_id uuid not null references private.reauth_challenges(id) on delete restrict,
  review_purpose text not null check (review_purpose='jubo_intake_profile_mapping_v2'),
  source_row_sha256 text not null check (source_row_sha256 ~ '^[a-f0-9]{64}$'),
  mapping_review_sha256 text not null check (mapping_review_sha256 ~ '^[a-f0-9]{64}$'),
  presented_payload_sha256 text not null check (presented_payload_sha256 ~ '^[a-f0-9]{64}$'),
  presented_at timestamptz not null default clock_timestamp(),
  expires_at timestamptz not null,
  foreign key (pair_id,organization_id,branch_id)
    references private.jubo_verified_source_pairs(id,organization_id,branch_id) on delete restrict,
  foreign key (master_source_row_id,organization_id,branch_id)
    references private.jubo_source_rows(id,organization_id,branch_id) on delete restrict,
  check (expires_at > presented_at and expires_at <= presented_at + interval '15 minutes')
);
create index jubo_profile_v2_previews_scope_idx on private.jubo_profile_mapping_v2_previews
  (organization_id,branch_id,pair_id,master_source_row_id,presented_at desc);
create index jubo_profile_v2_previews_actor_idx on private.jubo_profile_mapping_v2_previews
  (actor_user_id,actor_session_id,expires_at desc);
alter table private.jubo_profile_mapping_v2_previews enable row level security;
alter table private.jubo_profile_mapping_v2_previews force row level security;
revoke all on private.jubo_profile_mapping_v2_previews from public,anon,authenticated,service_role;
create trigger jubo_profile_v2_previews_immutable before update or delete
  on private.jubo_profile_mapping_v2_previews for each row
  execute function private.prevent_import_upload_mutation();
create trigger jubo_profile_v2_previews_audit after insert
  on private.jubo_profile_mapping_v2_previews for each row execute function private.audit_row_change();

alter table private.jubo_profile_mapping_v2_reviews
  add column review_purpose text not null
    check (review_purpose='jubo_intake_profile_mapping_v2'),
  add column preview_id uuid not null unique
    references private.jubo_profile_mapping_v2_previews(id) on delete restrict,
  add column presented_payload_sha256 text not null
    check (presented_payload_sha256 ~ '^[a-f0-9]{64}$'),
  add column idempotency_key uuid not null,
  add column request_sha256 text not null
    check (request_sha256 ~ '^[a-f0-9]{64}$'),
  add constraint jubo_profile_v2_review_actor_key unique (reviewer_user_id,idempotency_key);

-- The fixed purpose is checked at both entry points and persisted with the
-- exact evidence digest. This is not a claim that a server can prove what a
-- human visually read; the UI must present the returned original/display pair.
create function private.require_jubo_profile_v2_reviewer(p_org uuid,p_branch uuid)
returns uuid language plpgsql volatile security definer set search_path='' as $$
begin
  perform private.require_intake_authority(p_org,p_branch,null,false);
  if auth.uid() is null
    or not private.has_permission(p_org,p_branch,'clients.read')
    or not private.has_permission(p_org,p_branch,'clients.demographics.read')
    or not private.has_permission(p_org,p_branch,'clients.manage')
    or not private.has_permission(p_org,p_branch,'clients.view_all')
    or not private.has_permission(p_org,p_branch,'imports.approve') then
    raise exception using errcode='42501',message='JUBO_PROFILE_V2_REVIEW_DENIED';
  end if;
  return private.current_client_master_reauth_challenge();
end;
$$;

create function private.preview_jubo_profile_mapping_v2(
  p_org uuid,p_branch uuid,p_pair uuid,p_source_row uuid,p_purpose text
) returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare v_challenge uuid; v_session uuid; v_pair private.jubo_verified_source_pairs%rowtype;
  v_pending_operation private.jubo_pending_master_operations%rowtype;
  v_pending private.jubo_pending_master_rows%rowtype;
  v_source private.jubo_source_rows%rowtype;
  v_v1 private.jubo_master_row_reviews%rowtype;
  v_profile jsonb; v_normalization jsonb; v_payload jsonb;
  v_fingerprint text; v_payload_sha text; v_preview uuid; v_now timestamptz;
begin
  v_challenge:=private.require_jubo_profile_v2_reviewer(p_org,p_branch);
  if p_pair is null or p_source_row is null
    or p_purpose is distinct from 'jubo_intake_profile_mapping_v2' then
    raise exception using errcode='22023',message='JUBO_PROFILE_V2_PREVIEW_INVALID';
  end if;
  v_session:=(auth.jwt()->>'session_id')::uuid;
  select * into v_pair from private.jubo_verified_source_pairs
    where id=p_pair and organization_id=p_org and branch_id=p_branch;
  select * into v_pending_operation from private.jubo_pending_master_operations
    where pair_id=p_pair and organization_id=p_org and branch_id=p_branch;
  select * into v_source from private.jubo_source_rows
    where id=p_source_row and batch_id=v_pair.master_batch_id
      and organization_id=p_org and branch_id=p_branch;
  select * into v_pending from private.jubo_pending_master_rows
    where operation_id=v_pending_operation.id and source_row_id=p_source_row
      and organization_id=p_org and branch_id=p_branch;
  select * into v_v1 from private.jubo_master_row_reviews
    where pair_id=p_pair and source_row_id=p_source_row
      and organization_id=p_org and branch_id=p_branch
    order by review_version desc limit 1;
  if v_pair.id is null or v_pending_operation.id is null
    or v_source.id is null or v_pending.id is null
    or v_v1.id is null or v_v1.decision<>'approved'
    or v_v1.source_row_sha256<>v_source.row_sha256
    or v_source.row_sha256<>encode(sha256(convert_to(v_source.raw_values::text,'UTF8')),'hex')
    or exists(select 1 from private.jubo_public_pending_promotions where pair_id=p_pair) then
    raise exception using errcode='42501',message='JUBO_PROFILE_V2_SOURCE_UNAVAILABLE';
  end if;
  v_profile:=private.jubo_profile_from_master(v_source.raw_values,v_pending,'JUBO-REVIEW-CANDIDATE');
  v_normalization:=private.jubo_normalization_evidence(v_source.raw_values);
  v_fingerprint:=private.jubo_profile_mapping_fingerprint(v_source.raw_values,v_pending);
  v_payload:=jsonb_build_object(
    'reviewPurpose',p_purpose,'mappingVersion','jubo-master-monthly-202610-v2',
    'pairId',p_pair,'sourceRowId',p_source_row,'sourceSheetRow',v_source.source_row_number,
    'sourceRowSha256',v_source.row_sha256,'mappingReviewSha256',v_fingerprint,
    'monthlySourceRowId',v_pending.monthly_source_row_id,
    'originalMappedValues',jsonb_build_object(
      'displayName',jsonb_build_object('index',2,'value',v_source.raw_values->2),
      'sex',jsonb_build_object('index',3,'value',v_source.raw_values->3),
      'dateOfBirth',jsonb_build_object('index',23,'value',v_source.raw_values->23),
      'identityNumber',jsonb_build_object('index',25,'value',v_source.raw_values->25),
      'registeredAddress',jsonb_build_object('index',32,'value',v_source.raw_values->32),
      'residentialAddress',jsonb_build_object('index',35,'value',v_source.raw_values->35),
      'cmsLevel',jsonb_build_object('index',48,'value',v_source.raw_values->48),
      'disability',jsonb_build_object('index',54,'value',v_source.raw_values->54),
      'primaryContactName',jsonb_build_object('index',78,'value',v_source.raw_values->78),
      'primaryContactPhone',jsonb_build_object('index',79,'value',v_source.raw_values->79),
      'proxyName',jsonb_build_object('index',80,'value',v_source.raw_values->80),
      'proxyPhone',jsonb_build_object('index',81,'value',v_source.raw_values->81)),
    'displayProfile',v_profile-'clientCode',
    'normalizationFieldIndices',v_normalization,
    'normalizationRequiresConfirmation',
      jsonb_array_length(v_normalization->'nfkc')>0
        or jsonb_array_length(v_normalization->'contactSeparator')>0);
  v_payload_sha:=encode(sha256(convert_to(v_payload::text,'UTF8')),'hex');
  if private.current_client_master_reauth_challenge()<>v_challenge then
    raise exception using errcode='42501',message='JUBO_PROFILE_V2_REAUTH_EXPIRED';
  end if;
  v_now:=clock_timestamp();
  insert into private.jubo_profile_mapping_v2_previews(
    organization_id,branch_id,pair_id,master_source_row_id,actor_user_id,
    actor_session_id,reauth_challenge_id,review_purpose,source_row_sha256,
    mapping_review_sha256,presented_payload_sha256,presented_at,expires_at)
  values(p_org,p_branch,p_pair,p_source_row,auth.uid(),v_session,v_challenge,
    p_purpose,v_source.row_sha256,v_fingerprint,v_payload_sha,v_now,v_now+interval '15 minutes')
  returning id into v_preview;
  return v_payload||jsonb_build_object('previewId',v_preview,
    'previewSha256',v_payload_sha,'expiresAt',v_now+interval '15 minutes');
end;
$$;

create function public.preview_jubo_profile_mapping_v2(
  p_org uuid,p_branch uuid,p_pair uuid,p_source_row uuid,p_purpose text
) returns jsonb language sql volatile security invoker set search_path='' as $$
  select private.preview_jubo_profile_mapping_v2(p_org,p_branch,p_pair,p_source_row,p_purpose);
$$;

create function private.review_jubo_profile_mapping_v2(
  p_org uuid,p_branch uuid,p_pair uuid,p_source_row uuid,p_preview uuid,
  p_expected_source_sha256 text,p_expected_fingerprint text,p_expected_preview_sha256 text,
  p_purpose text,p_decision text,p_reason text,p_idempotency_key uuid
) returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare v_challenge uuid; v_session uuid; v_preview private.jubo_profile_mapping_v2_previews%rowtype;
  v_source private.jubo_source_rows%rowtype; v_pending private.jubo_pending_master_rows%rowtype;
  v_pair private.jubo_verified_source_pairs%rowtype;
  v_v1 private.jubo_master_row_reviews%rowtype;
  v_previous private.jubo_profile_mapping_v2_reviews%rowtype;
  v_result private.jubo_profile_mapping_v2_reviews%rowtype;
  v_reason text:=btrim(p_reason); v_fingerprint text; v_request_sha text;
  v_version integer;
begin
  v_challenge:=private.require_jubo_profile_v2_reviewer(p_org,p_branch);
  if p_pair is null or p_source_row is null or p_preview is null
    or p_idempotency_key is null or p_expected_source_sha256 is null
    or p_expected_source_sha256 !~ '^[a-f0-9]{64}$'
    or p_expected_fingerprint is null or p_expected_fingerprint !~ '^[a-f0-9]{64}$'
    or p_expected_preview_sha256 is null or p_expected_preview_sha256 !~ '^[a-f0-9]{64}$'
    or p_purpose is distinct from 'jubo_intake_profile_mapping_v2'
    or p_decision is null or p_decision not in ('approved','held','rejected')
    or v_reason is null or char_length(v_reason) not between 10 and 1000 then
    raise exception using errcode='22023',message='JUBO_PROFILE_V2_REVIEW_INVALID';
  end if;
  v_session:=(auth.jwt()->>'session_id')::uuid;
  -- Public promotion locks this same pair row. A held/rejected supersession
  -- must serialize before or after the whole promotion, never mid-loop.
  select * into v_pair from private.jubo_verified_source_pairs
    where id=p_pair and organization_id=p_org and branch_id=p_branch for update;
  select * into v_source from private.jubo_source_rows
    where id=p_source_row and batch_id=v_pair.master_batch_id
      and organization_id=p_org and branch_id=p_branch for update;
  select * into v_pending from private.jubo_pending_master_rows
    where source_row_id=p_source_row and organization_id=p_org and branch_id=p_branch;
  select * into v_v1 from private.jubo_master_row_reviews
    where pair_id=p_pair and source_row_id=p_source_row
      and organization_id=p_org and branch_id=p_branch
    order by review_version desc limit 1;
  if v_pair.id is null or v_source.id is null or v_pending.id is null
    or v_v1.id is null or v_v1.decision<>'approved'
    or v_v1.source_row_sha256<>v_source.row_sha256
    or exists(select 1 from private.jubo_public_pending_promotions where pair_id=p_pair) then
    raise exception using errcode='42501',message='JUBO_PROFILE_V2_SOURCE_UNAVAILABLE';
  end if;
  v_fingerprint:=private.jubo_profile_mapping_fingerprint(v_source.raw_values,v_pending);
  select * into v_preview from private.jubo_profile_mapping_v2_previews
    where id=p_preview and organization_id=p_org and branch_id=p_branch
      and pair_id=p_pair and master_source_row_id=p_source_row
      and actor_user_id=auth.uid() and actor_session_id=v_session for share;
  if v_preview.id is null or v_preview.expires_at<=clock_timestamp()
    or v_preview.review_purpose<>p_purpose
    or v_preview.reauth_challenge_id<>v_challenge
    or v_source.row_sha256<>p_expected_source_sha256
    or v_source.row_sha256<>v_preview.source_row_sha256
    or v_source.row_sha256<>encode(sha256(convert_to(v_source.raw_values::text,'UTF8')),'hex')
    or v_fingerprint<>p_expected_fingerprint
    or v_fingerprint<>v_preview.mapping_review_sha256
    or v_preview.presented_payload_sha256<>p_expected_preview_sha256 then
    raise exception using errcode='42501',message='JUBO_PROFILE_V2_PREVIEW_MISMATCH';
  end if;
  v_request_sha:=encode(sha256(convert_to(jsonb_build_object(
    'org',p_org,'branch',p_branch,'pair',p_pair,'row',p_source_row,
    'preview',p_preview,'sourceSha',p_expected_source_sha256,
    'fingerprint',p_expected_fingerprint,'previewSha',p_expected_preview_sha256,
    'purpose',p_purpose,'decision',p_decision,'reason',v_reason)::text,'UTF8')),'hex');
  perform pg_advisory_xact_lock(hashtextextended('jubo-profile-v2:'||auth.uid()||':'||p_idempotency_key,0));
  select * into v_previous from private.jubo_profile_mapping_v2_reviews
    where reviewer_user_id=auth.uid() and idempotency_key=p_idempotency_key;
  if v_previous.id is not null then
    if v_previous.request_sha256<>v_request_sha then
      raise exception using errcode='23505',message='JUBO_PROFILE_V2_IDEMPOTENCY_CONFLICT';
    end if;
    return jsonb_build_object('reviewId',v_previous.id,'reviewVersion',v_previous.review_version,
      'decision',v_previous.decision,'replayed',true);
  end if;
  if exists(select 1 from private.jubo_profile_mapping_v2_reviews where preview_id=p_preview) then
    raise exception using errcode='23505',message='JUBO_PROFILE_V2_PREVIEW_ALREADY_REVIEWED';
  end if;
  if private.current_client_master_reauth_challenge()<>v_challenge
    or v_preview.expires_at<=clock_timestamp() then
    raise exception using errcode='42501',message='JUBO_PROFILE_V2_REAUTH_EXPIRED';
  end if;
  select coalesce(max(review_version),0)+1 into v_version
    from private.jubo_profile_mapping_v2_reviews
    where pair_id=p_pair and master_source_row_id=p_source_row;
  insert into private.jubo_profile_mapping_v2_reviews(
    organization_id,branch_id,pair_id,master_source_row_id,review_version,
    source_row_sha256,mapping_review_sha256,mapping_version,decision,review_reason,
    reviewer_user_id,reauth_challenge_id,review_purpose,preview_id,
    presented_payload_sha256,idempotency_key,request_sha256)
  values(p_org,p_branch,p_pair,p_source_row,v_version,p_expected_source_sha256,
    p_expected_fingerprint,'jubo-master-monthly-202610-v2',p_decision,v_reason,
    auth.uid(),v_challenge,p_purpose,p_preview,p_expected_preview_sha256,
    p_idempotency_key,v_request_sha) returning * into v_result;
  return jsonb_build_object('reviewId',v_result.id,'reviewVersion',v_result.review_version,
    'decision',v_result.decision,'replayed',false);
end;
$$;

create function public.review_jubo_profile_mapping_v2(
  p_org uuid,p_branch uuid,p_pair uuid,p_source_row uuid,p_preview uuid,
  p_expected_source_sha256 text,p_expected_fingerprint text,p_expected_preview_sha256 text,
  p_purpose text,p_decision text,p_reason text,p_idempotency_key uuid
) returns jsonb language sql volatile security invoker set search_path='' as $$
  select private.review_jubo_profile_mapping_v2(p_org,p_branch,p_pair,p_source_row,p_preview,
    p_expected_source_sha256,p_expected_fingerprint,p_expected_preview_sha256,
    p_purpose,p_decision,p_reason,p_idempotency_key);
$$;

alter function private.require_jubo_profile_v2_reviewer(uuid,uuid) owner to postgres;
alter function private.preview_jubo_profile_mapping_v2(uuid,uuid,uuid,uuid,text) owner to postgres;
alter function private.review_jubo_profile_mapping_v2(uuid,uuid,uuid,uuid,uuid,text,text,text,text,text,text,uuid) owner to postgres;
revoke all on function private.require_jubo_profile_v2_reviewer(uuid,uuid)
  from public,anon,authenticated,service_role;
revoke all on function private.preview_jubo_profile_mapping_v2(uuid,uuid,uuid,uuid,text)
  from public,anon,authenticated,service_role;
revoke all on function private.review_jubo_profile_mapping_v2(uuid,uuid,uuid,uuid,uuid,text,text,text,text,text,text,uuid)
  from public,anon,authenticated,service_role;
revoke all on function public.preview_jubo_profile_mapping_v2(uuid,uuid,uuid,uuid,text)
  from public,anon,authenticated,service_role;
revoke all on function public.review_jubo_profile_mapping_v2(uuid,uuid,uuid,uuid,uuid,text,text,text,text,text,text,uuid)
  from public,anon,authenticated,service_role;
grant execute on function private.preview_jubo_profile_mapping_v2(uuid,uuid,uuid,uuid,text)
  to authenticated;
grant execute on function private.review_jubo_profile_mapping_v2(uuid,uuid,uuid,uuid,uuid,text,text,text,text,text,text,uuid)
  to authenticated;
grant execute on function public.preview_jubo_profile_mapping_v2(uuid,uuid,uuid,uuid,text)
  to authenticated;
grant execute on function public.review_jubo_profile_mapping_v2(uuid,uuid,uuid,uuid,uuid,text,text,text,text,text,text,uuid)
  to authenticated;
comment on function public.review_jubo_profile_mapping_v2(uuid,uuid,uuid,uuid,uuid,text,text,text,text,text,text,uuid) is
  'Candidate only: review one exact JUBO v2 profile mapping after same-session AAL2 preview. No promotion or care authorization.';
commit;
