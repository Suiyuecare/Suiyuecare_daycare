-- Candidate only. Attach a complete intake-profile v1 to each reviewed JUBO
-- public pending client in the *same transaction* as its source link. This
-- augments, but does not enable, the owner-only promotion candidate. No
-- admission date, attendance, clinical act or signed assessment is inferred.
begin;
set local lock_timeout = '5s';

create table private.jubo_intake_profile_sources (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  branch_id uuid not null,
  promotion_id uuid not null,
  promotion_link_id uuid not null unique,
  client_id uuid not null unique,
  intake_version_id uuid not null unique references private.client_intake_versions(id) on delete restrict,
  pair_id uuid not null,
  master_source_row_id uuid not null unique,
  monthly_source_row_id uuid,
  master_source_row_sha256 text not null check (master_source_row_sha256 ~ '^[a-f0-9]{64}$'),
  profile_sha256 text not null check (profile_sha256 ~ '^[a-f0-9]{64}$'),
  mapping_review_sha256 text not null check (mapping_review_sha256 ~ '^[a-f0-9]{64}$'),
  source_sheet_row integer not null check (source_sheet_row > 0),
  source_field_indices jsonb not null check (jsonb_typeof(source_field_indices)='object'),
  warning_codes text[] not null check (warning_codes <@ array[
    'MISSING_MONTHLY_SUMMARY','MISSING_DATE_OF_BIRTH','MISSING_CONTACT_PHONE','REVIEW_SOURCE_NORMALIZATION',
    'REVIEW_WEEKLY_SCHEDULE','REVIEW_TRANSPORT','REVIEW_ABCD_ASSESSMENTS',
    'REVIEW_IDENTITY_DOCUMENT','REVIEW_MEDICATION_EVIDENCE',
    'REVIEW_HEALTH_EXAM','REVIEW_CONSENT']::text[]),
  normalization_field_indices jsonb not null check (jsonb_typeof(normalization_field_indices)='object'),
  mapping_version text not null check (mapping_version = 'jubo-master-monthly-202610-v2'),
  parser_version text not null check (char_length(btrim(parser_version)) between 8 and 80),
  created_at timestamptz not null default clock_timestamp(),
  foreign key (promotion_id,organization_id,branch_id)
    references private.jubo_public_pending_promotions(id,organization_id,branch_id) on delete restrict,
  foreign key (pair_id,organization_id,branch_id)
    references private.jubo_verified_source_pairs(id,organization_id,branch_id) on delete restrict,
  foreign key (master_source_row_id,organization_id,branch_id)
    references private.jubo_source_rows(id,organization_id,branch_id) on delete restrict,
  foreign key (monthly_source_row_id,organization_id,branch_id)
    references private.jubo_source_rows(id,organization_id,branch_id) on delete restrict,
  foreign key (client_id,organization_id,branch_id)
    references public.clients(id,organization_id,branch_id) on delete restrict
);
create index jubo_intake_profile_sources_scope_idx on private.jubo_intake_profile_sources
  (organization_id,branch_id,promotion_id);
create index jubo_intake_profile_sources_pair_idx on private.jubo_intake_profile_sources(pair_id);
create index jubo_intake_profile_sources_monthly_idx on private.jubo_intake_profile_sources(monthly_source_row_id)
  where monthly_source_row_id is not null;
alter table private.jubo_intake_profile_sources enable row level security;
alter table private.jubo_intake_profile_sources force row level security;
revoke all on private.jubo_intake_profile_sources from public,anon,authenticated,service_role;
create trigger jubo_intake_profile_sources_immutable before update or delete
  on private.jubo_intake_profile_sources for each row
  execute function private.prevent_import_upload_mutation();
create trigger jubo_intake_profile_sources_audit after insert
  on private.jubo_intake_profile_sources for each row execute function private.audit_row_change();

-- V1 approvals bind only original source rows. They cannot authorize the V2
-- display transformation. This intentionally has no browser/service-role
-- grants or publication RPC: a separate AAL2 review workflow must be built
-- and accepted before any real pending-client promotion is possible.
create table private.jubo_profile_mapping_v2_reviews (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  branch_id uuid not null,
  pair_id uuid not null,
  master_source_row_id uuid not null,
  review_version integer not null check (review_version>0),
  source_row_sha256 text not null check (source_row_sha256 ~ '^[a-f0-9]{64}$'),
  mapping_review_sha256 text not null check (mapping_review_sha256 ~ '^[a-f0-9]{64}$'),
  mapping_version text not null check (mapping_version='jubo-master-monthly-202610-v2'),
  decision text not null check (decision in ('approved','held','rejected')),
  review_reason text not null check (char_length(btrim(review_reason)) between 10 and 1000),
  reviewer_user_id uuid not null references auth.users(id) on delete restrict,
  reauth_challenge_id uuid not null references private.reauth_challenges(id) on delete restrict,
  reviewed_at timestamptz not null default clock_timestamp(),
  foreign key (pair_id,organization_id,branch_id)
    references private.jubo_verified_source_pairs(id,organization_id,branch_id) on delete restrict,
  foreign key (master_source_row_id,organization_id,branch_id)
    references private.jubo_source_rows(id,organization_id,branch_id) on delete restrict,
  unique(pair_id,master_source_row_id,review_version)
);
create index jubo_profile_mapping_v2_reviews_latest_idx on private.jubo_profile_mapping_v2_reviews
  (pair_id,master_source_row_id,review_version desc);
create index jubo_profile_mapping_v2_reviews_reauth_idx on private.jubo_profile_mapping_v2_reviews
  (reauth_challenge_id);
alter table private.jubo_profile_mapping_v2_reviews enable row level security;
alter table private.jubo_profile_mapping_v2_reviews force row level security;
revoke all on private.jubo_profile_mapping_v2_reviews from public,anon,authenticated,service_role;
create trigger jubo_profile_mapping_v2_reviews_immutable before update or delete
  on private.jubo_profile_mapping_v2_reviews for each row
  execute function private.prevent_import_upload_mutation();
create trigger jubo_profile_mapping_v2_reviews_audit after insert
  on private.jubo_profile_mapping_v2_reviews for each row execute function private.audit_row_change();

-- Source values in v1 are not automatically editable just because they are
-- tagged jubo_export rather than central. In particular, merely adding
-- 'pending' to the generic write_intake_profile status predicate must not
-- allow a manager to overwrite them. A reviewed local supplement path with a
-- narrow field allowlist is a separate release gate, not implemented here.
create function private.guard_jubo_pending_profile_version() returns trigger
language plpgsql volatile security definer set search_path='' as $$
begin
  if new.source_batch_id is null and exists(
    select 1 from private.jubo_intake_profile_sources source_link
    where source_link.client_id=new.client_id) then
    raise exception using errcode='42501',
      message='JUBO_PENDING_PROFILE_SUPPLEMENT_NOT_PUBLISHED';
  end if;
  return new;
end;
$$;
create trigger aa_jubo_pending_profile_version_guard before insert
  on private.client_intake_versions for each row
  execute function private.guard_jubo_pending_profile_version();

-- Match the mapped text contract of the server-only JuboImportPlan. Numbers,
-- objects and arrays in text columns are not silently coerced into strings.
create function private.jubo_plan_text(p_values jsonb,p_index integer) returns text
language plpgsql immutable security invoker set search_path='' as $$
declare v jsonb;
begin
  if jsonb_typeof(p_values) <> 'array' or p_index < 0 or p_index >= jsonb_array_length(p_values) then
    raise exception using errcode='22023',message='JUBO_PROFILE_SOURCE_INVALID';
  end if;
  v:=p_values->p_index;
  if v is null or jsonb_typeof(v)='null' then return null; end if;
  if jsonb_typeof(v)<>'string' then
    raise exception using errcode='22023',message='JUBO_PROFILE_SOURCE_INVALID';
  end if;
  return nullif(btrim(pg_catalog.normalize(v#>>'{}','NFKC')),'');
end;
$$;

create function private.jubo_contact_display_text(p_values jsonb,p_index integer) returns text
language plpgsql immutable security invoker set search_path='' as $$
declare v text;
begin
  v:=private.jubo_plan_text(p_values,p_index);
  -- Preserve boundaries between source lines rather than concatenating
  -- potentially distinct people or phone numbers. Original bytes stay in
  -- jubo_source_rows.raw_values for mandatory human review.
  return pg_catalog.regexp_replace(v,'[[:cntrl:]]+',' / ','g');
end;
$$;

create function private.jubo_normalization_evidence(p_values jsonb) returns jsonb
language plpgsql immutable security invoker set search_path='' as $$
declare v_nfkc jsonb:='[]'::jsonb; v_separator jsonb:='[]'::jsonb;
  v_index integer; v_raw text;
begin
  if jsonb_typeof(p_values)<>'array' or jsonb_array_length(p_values)<>95 then
    raise exception using errcode='22023',message='JUBO_PROFILE_SOURCE_INVALID';
  end if;
  foreach v_index in array array[2,3,23,25,32,35,48,54,78,79,80,81] loop
    v_raw:=p_values->>v_index;
    if v_raw is not null and pg_catalog.normalize(v_raw,'NFKC') is distinct from v_raw then
      v_nfkc:=v_nfkc||to_jsonb(v_index);
    end if;
    if v_index in (78,79,80,81) and v_raw ~ '[[:cntrl:]]' then
      v_separator:=v_separator||to_jsonb(v_index);
    end if;
  end loop;
  return jsonb_build_object('nfkc',v_nfkc,'contactSeparator',v_separator);
end;
$$;

create function private.jubo_profile_from_master(
  p_values jsonb,p_pending private.jubo_pending_master_rows,p_client_code text
) returns jsonb language plpgsql volatile security invoker set search_path='' as $$
declare v_identity text; v_cms_text text; v_cms integer;
  v_primary_name text; v_primary_phone text; v_proxy_name text; v_proxy_phone text;
  v_contacts jsonb:='[]'::jsonb; v_profile jsonb;
begin
  if jsonb_array_length(p_values)<>95 or p_pending.admitted_on is not null
    or p_pending.care_eligible or p_client_code is null then
    raise exception using errcode='22023',message='JUBO_PROFILE_SOURCE_INVALID';
  end if;
  v_identity:=upper(regexp_replace(coalesce(private.jubo_plan_text(p_values,25),''),
    '[[:space:]-]','','g'));
  v_identity:=replace(v_identity,'－','');
  if v_identity !~ '^[A-Z][A-Z0-9]{7,19}$'
    or encode(sha256(convert_to(v_identity,'UTF8')),'hex')<>p_pending.identity_sha256
    or private.jubo_plan_text(p_values,2) is distinct from p_pending.display_name
    or private.jubo_source_date_iso(p_values->>23) is distinct from p_pending.date_of_birth
    or private.jubo_source_sex(p_values->>3) is distinct from p_pending.sex then
    raise exception using errcode='22023',message='JUBO_PROFILE_SOURCE_MISMATCH';
  end if;
  v_cms_text:=regexp_replace(coalesce(p_values->>48,''),'[[:space:]]','','g');
  if v_cms_text<>'' then
    if v_cms_text !~ '^(第)?[1-8](級)?$' then
      raise exception using errcode='22023',message='JUBO_PROFILE_CMS_INVALID';
    end if;
    v_cms:=regexp_replace(v_cms_text,'^(第)?([1-8])(級)?$','\2')::integer;
  end if;
  if jsonb_typeof(p_values->48) not in ('null','string','number') then
    raise exception using errcode='22023',message='JUBO_PROFILE_CMS_INVALID';
  end if;
  v_primary_name:=private.jubo_contact_display_text(p_values,78);
  v_primary_phone:=private.jubo_contact_display_text(p_values,79);
  v_proxy_name:=private.jubo_contact_display_text(p_values,80);
  v_proxy_phone:=private.jubo_contact_display_text(p_values,81);
  if (v_primary_name is null and v_primary_phone is not null)
    or (v_proxy_name is null and v_proxy_phone is not null) then
    raise exception using errcode='22023',message='JUBO_PROFILE_CONTACT_INVALID';
  end if;
  if v_primary_name is not null then
    v_contacts:=v_contacts||jsonb_build_array(jsonb_build_object('name',v_primary_name,
      'relationship','','phone',coalesce(v_primary_phone,''),'address','',
      'isPrimary',true,'isEmergency',false));
  end if;
  if v_proxy_name is not null then
    v_contacts:=v_contacts||jsonb_build_array(jsonb_build_object('name',v_proxy_name,
      'relationship','','phone',coalesce(v_proxy_phone,''),'address','',
      'isPrimary',false,'isEmergency',false));
  end if;
  v_profile:=jsonb_build_object(
    'displayName',p_pending.display_name,'clientCode',p_client_code,
    'dateOfBirth',p_pending.date_of_birth::text,'identityNumber',v_identity,
    'sex',p_pending.sex,'phone',null,
    'registeredAddress',private.jubo_plan_text(p_values,32),
    'residentialAddress',private.jubo_plan_text(p_values,35),
    'cmsLevel',v_cms,'disability',private.jubo_plan_text(p_values,54),
    'contacts',v_contacts,'consent',jsonb_build_object('status','pending','confirmedOn',null),
    'notes','');
  return private.validate_intake_profile(v_profile);
end;
$$;

create function private.jubo_profile_mapping_fingerprint(
  p_values jsonb,p_pending private.jubo_pending_master_rows
) returns text language plpgsql volatile security invoker set search_path='' as $$
declare v_profile jsonb; v_normalization jsonb; v_row_sha text;
begin
  -- clientCode is generated only at public creation. Exclude it from the
  -- reviewed display digest so the pre-promotion candidate is deterministic.
  v_profile:=private.jubo_profile_from_master(p_values,p_pending,'JUBO-REVIEW-CANDIDATE');
  v_normalization:=private.jubo_normalization_evidence(p_values);
  v_row_sha:=encode(sha256(convert_to(p_values::text,'UTF8')),'hex');
  return encode(sha256(convert_to(jsonb_build_object(
    'mappingVersion','jubo-master-monthly-202610-v2',
    'sourceRowSha256',v_row_sha,
    'displayProfile',v_profile-'clientCode',
    'normalization',v_normalization)::text,'UTF8')),'hex');
end;
$$;

create function private.create_jubo_pending_intake_profile() returns trigger
language plpgsql volatile security definer set search_path='' as $$
declare v_promotion private.jubo_public_pending_promotions%rowtype;
  v_pending private.jubo_pending_master_rows%rowtype;
  v_pair private.jubo_verified_source_pairs%rowtype;
  v_master private.jubo_source_rows%rowtype;
  v_monthly private.jubo_source_rows%rowtype;
  v_client public.clients%rowtype;
  v_profile jsonb; v_version uuid; v_authority jsonb; v_warnings text[]:='{}';
  v_normalization jsonb; v_mapping_fingerprint text;
  v_mapping_review private.jubo_profile_mapping_v2_reviews%rowtype;
begin
  -- The private table is ungranted to API roles. The transaction marker also
  -- binds this side-effect to the reviewed promotion that inserted the link.
  if current_setting('app.jubo_pending_promotion_id',true)
      is distinct from new.promotion_id::text then
    raise exception using errcode='42501',message='JUBO_PROFILE_REVIEWED_PROMOTION_REQUIRED';
  end if;
  select * into v_promotion from private.jubo_public_pending_promotions
    where id=new.promotion_id and organization_id=new.organization_id
      and branch_id=new.branch_id;
  select * into v_pair from private.jubo_verified_source_pairs
    where id=v_promotion.pair_id and organization_id=new.organization_id
      and branch_id=new.branch_id;
  select * into v_pending from private.jubo_pending_master_rows
    where id=new.pending_row_id and operation_id=v_promotion.pending_operation_id
      and organization_id=new.organization_id and branch_id=new.branch_id;
  select * into v_master from private.jubo_source_rows
    where id=v_pending.source_row_id and batch_id=v_pair.master_batch_id
      and organization_id=new.organization_id and branch_id=new.branch_id;
  select * into v_client from public.clients
    where id=new.client_id and organization_id=new.organization_id
      and branch_id=new.branch_id and status='pending' and admitted_on is null
      and ended_on is null and source_system='jubo';
  if v_promotion.id is null or v_pair.id is null or v_pending.id is null
    or v_master.id is null or v_client.id is null
    or v_master.row_sha256 <> encode(sha256(convert_to(v_master.raw_values::text,'UTF8')),'hex')
    or exists(select 1 from private.client_intake_versions where client_id=new.client_id) then
    raise exception using errcode='22023',message='JUBO_PROFILE_SOURCE_MISMATCH';
  end if;
  if v_pending.monthly_source_row_id is not null then
    select * into v_monthly from private.jubo_source_rows
      where id=v_pending.monthly_source_row_id and batch_id=v_pair.monthly_batch_id
        and identity_sha256=v_pending.identity_sha256
        and organization_id=new.organization_id and branch_id=new.branch_id;
    if v_monthly.id is null then
      raise exception using errcode='22023',message='JUBO_PROFILE_SOURCE_MISMATCH';
    end if;
  end if;
  v_mapping_fingerprint:=private.jubo_profile_mapping_fingerprint(v_master.raw_values,v_pending);
  select * into v_mapping_review from private.jubo_profile_mapping_v2_reviews
    where pair_id=v_pair.id and master_source_row_id=v_master.id
      and organization_id=new.organization_id and branch_id=new.branch_id
    order by review_version desc limit 1;
  if v_mapping_review.id is null or v_mapping_review.decision<>'approved'
    or v_mapping_review.source_row_sha256<>v_master.row_sha256
    or v_mapping_review.mapping_review_sha256<>v_mapping_fingerprint then
    raise exception using errcode='42501',message='JUBO_PROFILE_MAPPING_V2_REVIEW_REQUIRED';
  end if;
  v_profile:=private.jubo_profile_from_master(v_master.raw_values,v_pending,v_client.client_code);
  v_normalization:=private.jubo_normalization_evidence(v_master.raw_values);
  if jsonb_array_length(v_normalization->'nfkc')>0
    or jsonb_array_length(v_normalization->'contactSeparator')>0 then
    v_warnings:=array_append(v_warnings,'REVIEW_SOURCE_NORMALIZATION');
  end if;
  if v_pending.monthly_source_row_id is null then
    v_warnings:=array_append(v_warnings,'MISSING_MONTHLY_SUMMARY');
  end if;
  if v_profile->'dateOfBirth'='null'::jsonb then
    v_warnings:=array_append(v_warnings,'MISSING_DATE_OF_BIRTH');
  end if;
  if exists(select 1 from jsonb_array_elements(v_profile->'contacts') contact_entry
    where nullif(contact_entry->>'phone','') is null) then
    v_warnings:=array_append(v_warnings,'MISSING_CONTACT_PHONE');
  end if;
  v_warnings:=v_warnings||array['REVIEW_WEEKLY_SCHEDULE','REVIEW_TRANSPORT',
    'REVIEW_ABCD_ASSESSMENTS','REVIEW_IDENTITY_DOCUMENT',
    'REVIEW_MEDICATION_EVIDENCE','REVIEW_HEALTH_EXAM','REVIEW_CONSENT'];
  -- JUBO is a reviewed vendor export, not the central CMS system of record.
  -- A later central import may supersede official fields after explicit review.
  v_authority:=jsonb_build_object(
    'displayName','jubo_export','dateOfBirth','jubo_export','identityNumber','jubo_export',
    'sex','jubo_export','registeredAddress','jubo_export',
    'residentialAddress','jubo_export','cmsLevel','jubo_export',
    'disability','jubo_export','contacts','jubo_export',
    'clientCode','local','phone','unverified','consent','unverified','notes','local');
  insert into private.client_intake_versions(organization_id,branch_id,client_id,
    version,profile,field_authority,actor_user_id)
    values(new.organization_id,new.branch_id,new.client_id,1,v_profile,
      v_authority,v_promotion.actor_user_id) returning id into v_version;
  insert into private.jubo_intake_profile_sources(organization_id,branch_id,
    promotion_id,promotion_link_id,client_id,intake_version_id,pair_id,
    master_source_row_id,monthly_source_row_id,master_source_row_sha256,
    profile_sha256,mapping_review_sha256,source_sheet_row,source_field_indices,warning_codes,
    normalization_field_indices,mapping_version,parser_version)
    values(new.organization_id,new.branch_id,new.promotion_id,new.id,new.client_id,
      v_version,v_pair.id,v_master.id,v_pending.monthly_source_row_id,
      v_master.row_sha256,encode(sha256(convert_to(v_profile::text,'UTF8')),'hex'),
      v_mapping_fingerprint,
      v_master.source_row_number,
      jsonb_build_object('displayName',2,'sex',3,'dateOfBirth',23,
        'identityNumber',25,'registeredAddress',32,'residentialAddress',35,
        'cmsLevel',48,'disability',54,'contacts',jsonb_build_array(78,79,80,81)),
      v_warnings,v_normalization,
      'jubo-master-monthly-202610-v2',v_pair.parser_version);
  return new;
end;
$$;
create trigger jubo_public_pending_profile after insert on private.jubo_public_pending_links
  for each row execute function private.create_jubo_pending_intake_profile();

revoke all on function private.jubo_plan_text(jsonb,integer)
  from public,anon,authenticated,service_role;
revoke all on function private.jubo_contact_display_text(jsonb,integer)
  from public,anon,authenticated,service_role;
revoke all on function private.jubo_normalization_evidence(jsonb)
  from public,anon,authenticated,service_role;
revoke all on function private.guard_jubo_pending_profile_version()
  from public,anon,authenticated,service_role;
revoke all on function private.jubo_profile_from_master(jsonb,private.jubo_pending_master_rows,text)
  from public,anon,authenticated,service_role;
revoke all on function private.jubo_profile_mapping_fingerprint(jsonb,private.jubo_pending_master_rows)
  from public,anon,authenticated,service_role;
revoke all on function private.create_jubo_pending_intake_profile()
  from public,anon,authenticated,service_role;
comment on table private.jubo_intake_profile_sources is
  'Candidate-only immutable JUBO source evidence for intake profile v1; no service authorization.';
commit;
