-- Page 21: server-held write intent for a response lost across a full reload.
-- The reservation commits before the existing immutable mutation transaction.
-- A missing reservation is never evidence that an earlier HTTP request cannot
-- still arrive; callers must not automatically create a new operation key.
begin;
set local lock_timeout = '5s';

create table private.abcd_assessment_reservations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  branch_id uuid not null,
  client_id uuid not null,
  actor_user_id uuid not null references auth.users(id) on delete restrict,
  idempotency_key uuid not null,
  operation text not null check (operation in ('create','revise','sign','correct')),
  action text not null check (action in ('save_assessment','sign_assessment','correct_assessment')),
  assessment_type text not null check (assessment_type in ('A','B','C','D')),
  assessment_year integer not null check (assessment_year between 2000 and 2200),
  baseline_version integer not null check (baseline_version between 0 and 1000000),
  request_hash text not null check (request_hash ~ '^[a-f0-9]{64}$'),
  created_at timestamptz not null default clock_timestamp(),
  expires_at timestamptz not null default (clock_timestamp()+interval '24 hours'),
  constraint abcd_reservation_actor_key unique (actor_user_id,idempotency_key),
  constraint abcd_reservation_scope unique (id,organization_id,branch_id),
  constraint abcd_reservation_client_scope foreign key (client_id,organization_id,branch_id)
    references public.clients(id,organization_id,branch_id) on delete restrict,
  constraint abcd_reservation_lifetime check (expires_at>created_at and expires_at<=created_at+interval '24 hours')
);
create index abcd_reservation_actor_recent on private.abcd_assessment_reservations
  (actor_user_id,organization_id,branch_id,created_at desc);
create index abcd_reservation_client_recent on private.abcd_assessment_reservations
  (actor_user_id,organization_id,branch_id,client_id,created_at desc);
-- Expiring content lives apart from the append-only locator and receipt hash.
-- A 24h expiry alone does not erase bytes; the privileged purge below does.
create table private.abcd_assessment_reservation_payloads (
  id uuid primary key,
  organization_id uuid not null,
  branch_id uuid not null,
  request_payload jsonb not null check (jsonb_typeof(request_payload)='object'),
  constraint abcd_reservation_payload_scope foreign key (id,organization_id,branch_id)
    references private.abcd_assessment_reservations(id,organization_id,branch_id)
    on delete restrict
);
create index abcd_reservation_payload_scope_idx
  on private.abcd_assessment_reservation_payloads (organization_id,branch_id,id);
alter table private.abcd_assessment_reservations enable row level security;
alter table private.abcd_assessment_reservations force row level security;
alter table private.abcd_assessment_reservation_payloads enable row level security;
alter table private.abcd_assessment_reservation_payloads force row level security;
revoke all on private.abcd_assessment_reservations from public,anon,authenticated,service_role;
revoke all on private.abcd_assessment_reservation_payloads from public,anon,authenticated,service_role;
create trigger abcd_reservation_append_only before update or delete
  on private.abcd_assessment_reservations for each row
  execute function private.abcd_assessment_history_is_append_only();
create trigger abcd_reservation_audit_row_change after insert
  on private.abcd_assessment_reservations for each row execute function private.audit_row_change();
create trigger abcd_reservation_payload_audit after insert or delete
  on private.abcd_assessment_reservation_payloads for each row execute function private.audit_row_change();

create function private.purge_expired_abcd_reservation_payloads(p_limit integer default 500)
returns integer language plpgsql volatile security definer set search_path='' as $$
declare v_removed integer;
begin
  if p_limit not between 1 and 500 then
    raise exception using errcode='22023',message='ABCD purge limit is invalid';
  end if;
  with expired as (
    select payload.id from private.abcd_assessment_reservation_payloads payload
    join private.abcd_assessment_reservations reservation on reservation.id=payload.id
    where reservation.expires_at<=clock_timestamp()
    order by reservation.expires_at,payload.id limit p_limit
    for update of payload skip locked
  )
  delete from private.abcd_assessment_reservation_payloads payload
  using expired where payload.id=expired.id;
  get diagnostics v_removed=row_count;
  return v_removed;
end;$$;

create function private.reserve_abcd_assessment_operation(
  p_expected_organization_id uuid,p_expected_branch_id uuid,p_operation text,
  p_action text,p_payload jsonb,p_idempotency_key uuid
) returns uuid language plpgsql volatile security definer set search_path='' as $$
declare v_actor uuid:=auth.uid();v_client uuid;v_type text;v_year integer;v_baseline integer;
  v_hash text;v_existing private.abcd_assessment_reservations%rowtype;v_id uuid;
  v_existing_payload jsonb;
begin
  if p_expected_organization_id is null or p_expected_branch_id is null or v_actor is null
    or p_idempotency_key is null or jsonb_typeof(p_payload)<>'object'
    or octet_length(p_payload::text)>49152
    or not ((p_operation in ('create','revise') and p_action='save_assessment'
        and p_payload->>'mode'=p_operation)
      or (p_operation='sign' and p_action='sign_assessment')
      or (p_operation='correct' and p_action='correct_assessment')) then
    raise exception using errcode='22023',message='ABCD reservation input is invalid';
  end if;
  begin
    v_client:=(p_payload->>'client_id')::uuid;
    v_year:=(p_payload->>'assessment_year')::integer;
    v_baseline:=(p_payload->>'expected_version')::integer;
  exception when invalid_text_representation or numeric_value_out_of_range then
    raise exception using errcode='22023',message='ABCD reservation identity is invalid';
  end;
  v_type:=p_payload->>'assessment_type';
  if v_client is null or v_type not in ('A','B','C','D') or v_year not between 2000 and 2200
    or v_baseline not between 0 and 1000000
    or not private.abcd_assessment_client_authority(p_expected_organization_id,
      p_expected_branch_id,v_client,'abcd_assessments.read')
    or not private.abcd_assessment_client_authority(p_expected_organization_id,
      p_expected_branch_id,v_client,'abcd_assessments.manage') then
    raise exception using errcode='42501',message='ABCD reservation scope is not permitted';
  end if;
  if p_operation in ('sign','correct') then
    perform private.require_abcd_assessment_reauth(v_actor,clock_timestamp());
  end if;
  v_hash:=encode(sha256(convert_to(jsonb_build_object(
    'schema_version',1,'action',p_action,'organization_id',p_expected_organization_id,
    'branch_id',p_expected_branch_id,'payload',p_payload)::text,'UTF8')),'hex');
  perform pg_advisory_xact_lock(hashtextextended(
    'abcd-assessment-reservation:'||v_actor::text||':'||p_idempotency_key::text,0));
  select * into v_existing from private.abcd_assessment_reservations
    where actor_user_id=v_actor and idempotency_key=p_idempotency_key;
  if v_existing.id is not null then
    if v_existing.expires_at<=clock_timestamp() then
      raise exception using errcode='55000',message='ABCD reservation has expired';
    end if;
    select request_payload into v_existing_payload
      from private.abcd_assessment_reservation_payloads where id=v_existing.id;
    if v_existing.organization_id<>p_expected_organization_id
      or v_existing.branch_id<>p_expected_branch_id or v_existing.client_id<>v_client
      or v_existing.operation<>p_operation or v_existing.action<>p_action
      or v_existing.request_hash<>v_hash or v_existing_payload is distinct from p_payload then
      raise exception using errcode='23505',message='ABCD reservation idempotency conflict';
    end if;
    return v_existing.id;
  end if;
  if exists (select 1 from private.abcd_assessment_operations operation
    where operation.actor_user_id=v_actor and operation.idempotency_key=p_idempotency_key
      and (operation.request_hash<>v_hash
        or operation.organization_id<>p_expected_organization_id
        or operation.branch_id<>p_expected_branch_id
        or operation.client_id<>v_client)) then
    raise exception using errcode='23505',message='ABCD reservation conflicts with a prior operation';
  end if;
  insert into private.abcd_assessment_reservations (
    organization_id,branch_id,client_id,actor_user_id,idempotency_key,operation,action,
    assessment_type,assessment_year,baseline_version,request_hash)
  values (p_expected_organization_id,p_expected_branch_id,v_client,v_actor,p_idempotency_key,
    p_operation,p_action,v_type,v_year,v_baseline,v_hash) returning id into v_id;
  insert into private.abcd_assessment_reservation_payloads (
    id,organization_id,branch_id,request_payload) values (
    v_id,p_expected_organization_id,p_expected_branch_id,p_payload);
  return v_id;
end;$$;

create function private.abcd_assessment_recovery_snapshot(
  p_expected_organization_id uuid,p_expected_branch_id uuid,p_client_id uuid default null
) returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare v_actor uuid:=auth.uid();v_result jsonb;
begin
  if p_expected_organization_id is null or p_expected_branch_id is null
    or not private.abcd_assessment_current_authority(p_expected_organization_id,
      p_expected_branch_id,'abcd_assessments.read')
    or not private.abcd_assessment_current_authority(p_expected_organization_id,
      p_expected_branch_id,'abcd_assessments.manage')
    or (p_client_id is not null and (
      not private.abcd_assessment_client_authority(p_expected_organization_id,
        p_expected_branch_id,p_client_id,'abcd_assessments.read')
      or not private.abcd_assessment_client_authority(p_expected_organization_id,
        p_expected_branch_id,p_client_id,'abcd_assessments.manage'))) then
    raise exception using errcode='42501',message='ABCD recovery read is not permitted';
  end if;
  with visible as (
    select reservation.*,operation.id as committed_operation_id,
      operation.result_committed_at
    from private.abcd_assessment_reservations reservation
    left join private.abcd_assessment_operations operation
      on operation.actor_user_id=reservation.actor_user_id
      and operation.idempotency_key=reservation.idempotency_key
      and operation.request_hash=reservation.request_hash
      and operation.organization_id=reservation.organization_id
      and operation.branch_id=reservation.branch_id
      and operation.client_id=reservation.client_id
    where reservation.actor_user_id=v_actor
      and reservation.organization_id=p_expected_organization_id
      and reservation.branch_id=p_expected_branch_id
      and reservation.created_at>=clock_timestamp()-interval '24 hours'
      and (p_client_id is null or reservation.client_id=p_client_id)
      and private.abcd_assessment_client_authority(p_expected_organization_id,
        p_expected_branch_id,reservation.client_id,'abcd_assessments.read')
      and private.abcd_assessment_client_authority(p_expected_organization_id,
        p_expected_branch_id,reservation.client_id,'abcd_assessments.manage')
  ), page as (
    select * from visible
    order by (committed_operation_id is null) desc,created_at desc,id desc limit 20
  )
  select jsonb_build_object('organization_id',p_expected_organization_id,
    'branch_id',p_expected_branch_id,'client_id',p_client_id,'generated_at',clock_timestamp(),
    'absence_is_final',false,
    'truncated',(select count(*)>20 from visible),
    'pending_truncated',(select count(*)>20 from visible where committed_operation_id is null),
    'operations',coalesce(jsonb_agg(jsonb_build_object(
      'reservation_id',page.id,'client_id',page.client_id,
      'operation',page.operation,'assessment_type',page.assessment_type,
      'assessment_year',page.assessment_year,'baseline_version',page.baseline_version,'state',
        case when page.committed_operation_id is null then 'pending' else 'committed' end,
      'created_at',page.created_at,'committed_at',page.result_committed_at)
      order by (page.committed_operation_id is null) desc,page.created_at desc,page.id desc),'[]'::jsonb))
    into v_result from page;
  insert into public.audit_events (organization_id,branch_id,actor_user_id,action,
    table_name,row_pk,changed_fields,metadata) values (
    p_expected_organization_id,p_expected_branch_id,v_actor,'select',
    'abcd_assessment_reservations','recovery_snapshot',array[]::text[],
    jsonb_build_object('workflow','abcd_recovery_v1','client_filter_used',p_client_id is not null,
      'narrative_logged',false));
  if not private.abcd_assessment_current_authority(p_expected_organization_id,
      p_expected_branch_id,'abcd_assessments.read') then
    raise exception using errcode='42501',message='ABCD recovery authority expired';
  end if;
  return v_result;
end;$$;

create function private.resume_abcd_assessment_operation(
  p_expected_organization_id uuid,p_expected_branch_id uuid,p_reservation_id uuid
) returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare v_actor uuid:=auth.uid();v_reservation private.abcd_assessment_reservations%rowtype;
  v_receipt jsonb;v_payload jsonb;v_hash text;
begin
  if p_reservation_id is null or p_expected_organization_id is null or p_expected_branch_id is null then
    raise exception using errcode='22023',message='ABCD recovery request is invalid';
  end if;
  select * into v_reservation from private.abcd_assessment_reservations
    where id=p_reservation_id and actor_user_id=v_actor
      and organization_id=p_expected_organization_id and branch_id=p_expected_branch_id;
  if v_reservation.id is null
    or not private.abcd_assessment_client_authority(p_expected_organization_id,
      p_expected_branch_id,v_reservation.client_id,'abcd_assessments.read')
    or not private.abcd_assessment_client_authority(p_expected_organization_id,
      p_expected_branch_id,v_reservation.client_id,'abcd_assessments.manage') then
    raise exception using errcode='42501',message='ABCD recovery continuation is not permitted';
  end if;
  if v_reservation.operation in ('sign','correct') then
    perform private.require_abcd_assessment_reauth(v_actor,clock_timestamp());
  end if;
  if v_reservation.expires_at<=clock_timestamp() then
    raise exception using errcode='55000',message='ABCD reservation continuation has expired';
  end if;
  select request_payload into v_payload from private.abcd_assessment_reservation_payloads
    where id=v_reservation.id;
  if v_payload is null then
    raise exception using errcode='55000',message='ABCD reservation content is unavailable';
  end if;
  v_hash:=encode(sha256(convert_to(jsonb_build_object(
    'schema_version',1,'action',v_reservation.action,
    'organization_id',v_reservation.organization_id,
    'branch_id',v_reservation.branch_id,'payload',v_payload)::text,'UTF8')),'hex');
  if v_hash<>v_reservation.request_hash
    or v_payload->>'client_id'<>v_reservation.client_id::text
    or v_payload->>'assessment_type'<>v_reservation.assessment_type
    or (v_payload->>'assessment_year')::integer<>v_reservation.assessment_year
    or (v_payload->>'expected_version')::integer<>v_reservation.baseline_version then
    raise exception using errcode='55000',message='ABCD reservation content is inconsistent';
  end if;
  select to_jsonb(result) into v_receipt from private.mutate_abcd_assessment_guarded(
    v_reservation.organization_id,v_reservation.branch_id,v_reservation.action,
    v_payload,v_reservation.idempotency_key) result;
  if v_receipt is null or v_receipt->>'client_id'<>v_reservation.client_id::text
    or v_receipt->>'idempotency_key'<>v_reservation.idempotency_key::text
    or v_receipt->>'action'<>v_reservation.action then
    raise exception using errcode='55000',message='ABCD recovery receipt is inconsistent';
  end if;
  return jsonb_build_object('receipt',v_receipt,'request',
    jsonb_build_object('action',v_reservation.action,'payload',v_payload,
      'idempotency_key',v_reservation.idempotency_key));
end;$$;

create function public.reserve_abcd_assessment_operation(
  p_expected_organization_id uuid,p_expected_branch_id uuid,p_operation text,
  p_action text,p_payload jsonb,p_idempotency_key uuid
) returns uuid language sql volatile security invoker set search_path='' as $$
  select private.reserve_abcd_assessment_operation(p_expected_organization_id,
    p_expected_branch_id,p_operation,p_action,p_payload,p_idempotency_key);
$$;
create function public.abcd_assessment_recovery_snapshot(
  p_expected_organization_id uuid,p_expected_branch_id uuid,p_client_id uuid default null
) returns jsonb language sql volatile security invoker set search_path='' as $$
  select private.abcd_assessment_recovery_snapshot(p_expected_organization_id,
    p_expected_branch_id,p_client_id);
$$;
create function public.resume_abcd_assessment_operation(
  p_expected_organization_id uuid,p_expected_branch_id uuid,p_reservation_id uuid
) returns jsonb language sql volatile security invoker set search_path='' as $$
  select private.resume_abcd_assessment_operation(p_expected_organization_id,
    p_expected_branch_id,p_reservation_id);
$$;
-- The older public mutation RPC must not remain an alternate way to create
-- unlocatable writes. A committed pre-rollout operation may still replay with
-- its original key; every new operation requires the exact actor-bound,
-- unexpired server reservation before entering the immutable mutation core.
create or replace function private.mutate_abcd_assessment_reserved(
  p_expected_organization_id uuid,p_expected_branch_id uuid,
  p_action text,p_payload jsonb,p_idempotency_key uuid
) returns table(organization_id uuid,branch_id uuid,client_id uuid,
  operation_id uuid,idempotency_key uuid,action text,assessment_key uuid,
  version_id uuid,version integer,assessment_state text,assessment_type text,
  assessment_year integer,previous_version_id uuid,source_content_hash text,
  content_hash text,record_payload jsonb,committed_at timestamptz,replayed boolean)
language plpgsql volatile security definer set search_path='' as $$
declare v_actor uuid:=auth.uid();v_hash text;
begin
  if v_actor is null or p_expected_organization_id is null or p_expected_branch_id is null
    or p_idempotency_key is null or jsonb_typeof(p_payload)<>'object' then
    raise exception using errcode='42501',message='ABCD mutation reservation is required';
  end if;
  v_hash:=encode(sha256(convert_to(jsonb_build_object(
    'schema_version',1,'action',p_action,'organization_id',p_expected_organization_id,
    'branch_id',p_expected_branch_id,'payload',p_payload)::text,'UTF8')),'hex');
  if not exists (select 1 from private.abcd_assessment_reservations reservation
      join private.abcd_assessment_reservation_payloads saved on saved.id=reservation.id
        and saved.organization_id=reservation.organization_id and saved.branch_id=reservation.branch_id
      where reservation.actor_user_id=v_actor and reservation.idempotency_key=p_idempotency_key
        and reservation.organization_id=p_expected_organization_id
        and reservation.branch_id=p_expected_branch_id and reservation.action=p_action
        and reservation.request_hash=v_hash and saved.request_payload=p_payload
        and reservation.expires_at>clock_timestamp())
    and not exists (select 1 from private.abcd_assessment_operations operation
      where operation.actor_user_id=v_actor and operation.idempotency_key=p_idempotency_key
        and operation.organization_id=p_expected_organization_id
        and operation.branch_id=p_expected_branch_id and operation.action=p_action
        and operation.request_hash=v_hash) then
    raise exception using errcode='42501',message='ABCD mutation reservation is required';
  end if;
  return query select * from private.mutate_abcd_assessment_guarded(
    p_expected_organization_id,p_expected_branch_id,p_action,p_payload,p_idempotency_key);
end;$$;
create or replace function public.mutate_abcd_assessment(
  p_expected_organization_id uuid,p_expected_branch_id uuid,
  p_action text,p_payload jsonb,p_idempotency_key uuid
) returns table(organization_id uuid,branch_id uuid,client_id uuid,
  operation_id uuid,idempotency_key uuid,action text,assessment_key uuid,
  version_id uuid,version integer,assessment_state text,assessment_type text,
  assessment_year integer,previous_version_id uuid,source_content_hash text,
  content_hash text,record_payload jsonb,committed_at timestamptz,replayed boolean)
language sql volatile security invoker set search_path='' as $$
  select * from private.mutate_abcd_assessment_reserved(
    p_expected_organization_id,p_expected_branch_id,p_action,p_payload,p_idempotency_key);
$$;
-- Authenticated clients can call the public guarded wrapper, not the private
-- core directly. SECURITY DEFINER wrappers above and the recovery function
-- continue to invoke the core; it rechecks live actor, client and AAL2.
revoke execute on function private.mutate_abcd_assessment_guarded(uuid,uuid,text,jsonb,uuid)
  from authenticated;
revoke all on function private.mutate_abcd_assessment_reserved(uuid,uuid,text,jsonb,uuid)
  from public,anon,service_role;
grant execute on function private.mutate_abcd_assessment_reserved(uuid,uuid,text,jsonb,uuid)
  to authenticated;
revoke all on function private.purge_expired_abcd_reservation_payloads(integer)
  from public,anon,authenticated,service_role;
revoke all on function private.reserve_abcd_assessment_operation(uuid,uuid,text,text,jsonb,uuid),
  private.abcd_assessment_recovery_snapshot(uuid,uuid,uuid),
  private.resume_abcd_assessment_operation(uuid,uuid,uuid),
  public.reserve_abcd_assessment_operation(uuid,uuid,text,text,jsonb,uuid),
  public.abcd_assessment_recovery_snapshot(uuid,uuid,uuid),
  public.resume_abcd_assessment_operation(uuid,uuid,uuid)
  from public,anon,service_role;
grant execute on function private.reserve_abcd_assessment_operation(uuid,uuid,text,text,jsonb,uuid),
  private.abcd_assessment_recovery_snapshot(uuid,uuid,uuid),
  private.resume_abcd_assessment_operation(uuid,uuid,uuid),
  public.reserve_abcd_assessment_operation(uuid,uuid,text,text,jsonb,uuid),
  public.abcd_assessment_recovery_snapshot(uuid,uuid,uuid),
  public.resume_abcd_assessment_operation(uuid,uuid,uuid)
  to authenticated;
commit;
