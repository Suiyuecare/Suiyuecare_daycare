-- Case attendance without a first vital is an exception, never an immediate
-- present row. The private queue is not an attendance source for claims or
-- daily totals; only a scoped director decision creates a formal row.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

-- This is a purpose-limited high-risk grant. Do not give a read-only director
-- attendance.correct, which would also authorize unrelated backfills.
insert into public.permissions(permission_key,description,risk_level)
values('attendance.exception_approve','Approve a no-vital case check-in exception',3)
on conflict(permission_key) do nothing;
insert into public.role_permissions(role_id,permission_id)
select r.id,p.id from public.roles r cross join public.permissions p
where r.is_system and r.role_key='branch_director'
  and p.permission_key='attendance.exception_approve'
on conflict(role_id,permission_id) do nothing;

-- Reading the whole branch and resolving another worker's request require
-- the director's live read grants as well as the role assignment. Revoking a
-- read grant must immediately close both UUID-guessing and broad snapshots.
create function private.has_live_exception_director_scope(
  p_organization_id uuid,p_branch_id uuid,p_require_approval boolean
) returns boolean language sql volatile security definer set search_path='' as $$
  select exists(select 1 from private.routine_staff_scope() s
    join public.roles r on r.id=s.role_id and r.role_key='branch_director' and r.is_active
    where s.organization_id=p_organization_id and s.branch_id=p_branch_id
      and not exists(select 1 from (values('clients.read'),('clients.view_all'),('attendance.read')) needed(key)
        where not exists(select 1 from public.role_permissions rp
          join public.permissions p on p.id=rp.permission_id
          where rp.role_id=r.id and rp.granted_at<=clock_timestamp()
            and p.permission_key=needed.key))
      and (not p_require_approval or exists(select 1 from public.role_permissions rp
        join public.permissions p on p.id=rp.permission_id
        where rp.role_id=r.id and rp.granted_at<=clock_timestamp()
          and p.permission_key='attendance.exception_approve')));
$$;
revoke all on function private.has_live_exception_director_scope(uuid,uuid,boolean)
  from public,anon,authenticated,service_role;
grant execute on function private.has_live_exception_director_scope(uuid,uuid,boolean) to authenticated;

-- The existing executive-only MFA eligibility must not be broadened for all
-- routine staff. Only a currently approved Google branch director with this
-- one purpose-limited permission may begin/record the existing challenge.
create function private.can_begin_exception_director_mfa() returns boolean
language sql volatile security definer set search_path='' as $$
  select coalesce(auth.jwt()->>'aal','') in ('aal1','aal2') and exists(
    select 1 from private.routine_staff_scope() s
    join public.roles r on r.id=s.role_id and r.role_key='branch_director'
    join public.role_permissions rp on rp.role_id=r.id and rp.granted_at<=clock_timestamp()
    join public.permissions p on p.id=rp.permission_id
    where s.branch_id is not null and p.permission_key='attendance.exception_approve'
  );
$$;
-- Evolve the installed MFA functions rather than replacing their bodies.
-- The installed recorder contains the custom-form governance admission,
-- challenge invalidation/freshness checks and replay protections. A copied
-- older function would silently regress those unrelated safety guarantees.
do $$
declare
  v_source text;
  v_changed text;
  v_anchor text;
begin
  v_source:=pg_get_functiondef('private.can_begin_staff_mfa()'::regprocedure);
  v_anchor:='private.is_executive_login_allowed() or private.has_any_custom_governance_scope()';
  if (length(v_source)-length(replace(v_source,v_anchor,'')))<>length(v_anchor) then
    raise exception 'exception MFA admission anchor missing or ambiguous';
  end if;
  v_changed:=replace(v_source,v_anchor,
    'private.is_executive_login_allowed() or private.has_any_custom_governance_scope() or private.can_begin_exception_director_mfa()');
  execute v_changed;

  v_source:=pg_get_functiondef('private.record_aal2_reauth(uuid,text)'::regprocedure);
  v_anchor:='private.is_active_user() or private.has_any_custom_governance_scope()';
  if (length(v_source)-length(replace(v_source,v_anchor,'')))<>2*length(v_anchor)
     or strpos(v_source,'v_challenge.invalidated_at is not null')=0
     or strpos(v_source,'v_challenge.expires_at <= clock_timestamp()')=0
     or strpos(v_source,'and invalidated_at is null and expires_at > clock_timestamp()')=0 then
    raise exception 'exception MFA recorder eligibility or freshness anchor missing';
  end if;
  v_changed:=replace(v_source,v_anchor,
    'private.is_active_user() or private.has_any_custom_governance_scope() or private.can_begin_exception_director_mfa()');
  execute v_changed;
end;$$;

create function private.has_recent_exception_director_aal2() returns boolean
language plpgsql volatile security definer set search_path='' as $$
declare v_session uuid;
begin
  if auth.uid() is null or coalesce(auth.jwt()->>'aal','')<>'aal2'
    or not private.can_begin_exception_director_mfa() then return false; end if;
  begin v_session:=nullif(auth.jwt()->>'session_id','')::uuid;
  exception when invalid_text_representation then return false; end;
  if v_session is null then return false; end if;
  return exists(select 1 from private.reauth_events e
    join private.reauth_challenges c on c.id=e.challenge_id
    where e.user_id=auth.uid() and e.session_id=v_session and e.aal='aal2'
      and e.revoked_at is null and e.verified_at>=clock_timestamp()-interval '15 minutes'
      and c.user_id=e.user_id and c.session_id=e.session_id
      and c.consumed_at is not null and c.factor_verified_at is not null);
end; $$;
create function public.has_recent_exception_director_aal2() returns boolean
language sql volatile security invoker set search_path='' as $$
  select private.has_recent_exception_director_aal2();
$$;
revoke all on function private.can_begin_exception_director_mfa() from public,anon,authenticated,service_role;
revoke all on function private.has_recent_exception_director_aal2() from public,anon,authenticated,service_role;
revoke all on function public.has_recent_exception_director_aal2() from public,anon,authenticated,service_role;
grant execute on function private.can_begin_exception_director_mfa() to authenticated;
grant execute on function private.has_recent_exception_director_aal2() to authenticated;
grant execute on function public.has_recent_exception_director_aal2() to authenticated;

create table private.attendance_exception_requests (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  branch_id uuid not null,
  client_id uuid not null,
  requester_user_id uuid not null references auth.users(id) on delete restrict,
  requested_at timestamptz not null,
  service_date date not null,
  reason_code text not null check (reason_code in ('refused','device_failure','emergency_transfer','measurement_preexisting')),
  reason_note text check (reason_note is null or char_length(btrim(reason_note)) between 1 and 500),
  measurement_id uuid references public.measurements(id) on delete restrict,
  measurement_at timestamptz,
  idempotency_key uuid not null,
  request_hash text not null check (request_hash ~ '^[a-f0-9]{64}$'),
  status text not null default 'pending' check (status in ('pending','approved','rejected','cancelled')),
  resolved_by uuid references auth.users(id) on delete restrict,
  resolved_at timestamptz,
  decision_key uuid,
  decision_hash text check (decision_hash is null or decision_hash ~ '^[a-f0-9]{64}$'),
  decision_note text check (decision_note is null or char_length(btrim(decision_note)) between 1 and 500),
  resolved_arrival_at timestamptz,
  attendance_id uuid,
  created_at timestamptz not null default clock_timestamp(),
  constraint attendance_exception_client_scope_fkey foreign key (client_id,organization_id,branch_id)
    references public.clients(id,organization_id,branch_id) on delete restrict,
  constraint attendance_exception_record_scope_fkey foreign key (attendance_id,organization_id,branch_id,client_id)
    references public.attendance_records(id,organization_id,branch_id,client_id) on delete restrict,
  constraint attendance_exception_request_key unique (organization_id,requester_user_id,idempotency_key),
  constraint attendance_exception_service_date_check check (service_date=(requested_at at time zone 'Asia/Taipei')::date),
  constraint attendance_exception_measurement_check check (
    (reason_code='measurement_preexisting' and measurement_id is not null and measurement_at is not null
      and service_date=(measurement_at at time zone 'Asia/Taipei')::date)
    or (reason_code<>'measurement_preexisting' and measurement_id is null and measurement_at is null)
  ),
  constraint attendance_exception_resolution_check check (
    (status='pending' and resolved_by is null and resolved_at is null and decision_key is null
      and decision_hash is null and decision_note is null and resolved_arrival_at is null and attendance_id is null)
    or (status='approved' and resolved_by is not null and resolved_at is not null
      and decision_key is not null and decision_hash is not null and attendance_id is not null
      and resolved_arrival_at is not null and decision_note is not null
      and service_date=(resolved_arrival_at at time zone 'Asia/Taipei')::date)
    or (status in ('rejected','cancelled') and resolved_by is not null and resolved_at is not null
      and decision_key is not null and decision_hash is not null and resolved_arrival_at is null and attendance_id is null)
  )
);
create unique index attendance_exception_one_pending_per_day
  on private.attendance_exception_requests(client_id,service_date) where status='pending';
create index attendance_exception_branch_day_idx
  on private.attendance_exception_requests(organization_id,branch_id,service_date,status,requested_at);
create index attendance_exception_requester_day_idx
  on private.attendance_exception_requests(requester_user_id,service_date,requested_at);
create index attendance_exception_measurement_idx
  on private.attendance_exception_requests(measurement_id) where measurement_id is not null;
create index attendance_exception_resolver_idx
  on private.attendance_exception_requests(resolved_by) where resolved_by is not null;
create index attendance_exception_attendance_idx
  on private.attendance_exception_requests(attendance_id) where attendance_id is not null;
alter table private.attendance_exception_requests enable row level security;
alter table private.attendance_exception_requests force row level security;
revoke all on table private.attendance_exception_requests from public,anon,authenticated,service_role;

create function private.guard_attendance_exception_update() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
  if old.status<>'pending' or new.id<>old.id or new.organization_id<>old.organization_id
     or new.branch_id<>old.branch_id or new.client_id<>old.client_id
     or new.requester_user_id<>old.requester_user_id or new.requested_at<>old.requested_at
     or new.service_date<>old.service_date or new.reason_code<>old.reason_code
     or new.reason_note is distinct from old.reason_note
     or new.measurement_id is distinct from old.measurement_id
     or new.measurement_at is distinct from old.measurement_at
     or new.idempotency_key<>old.idempotency_key
     or new.request_hash<>old.request_hash or new.created_at<>old.created_at
     or new.status='pending' then
    raise exception using errcode='23514',message='attendance exception request is immutable after submission';
  end if;
  return new;
end; $$;
create trigger attendance_exception_guard_update before update on private.attendance_exception_requests
  for each row execute function private.guard_attendance_exception_update();
create trigger attendance_exception_audit_insert after insert or update on private.attendance_exception_requests
  for each row execute function private.audit_row_change();

-- The approval RPC alone can create this private, transaction-bound intent.
-- Matching ordinary backfill fields or a director role is not sufficient to
-- skip a pending exception. The RPC removes the intent before committing.
create table private.attendance_exception_insert_intents (
  request_id uuid primary key references private.attendance_exception_requests(id) on delete restrict,
  transaction_id bigint not null,
  reviewer_user_id uuid not null,
  attendance_key uuid not null,
  approved_checked_in_at timestamptz not null
);
alter table private.attendance_exception_insert_intents enable row level security;
alter table private.attendance_exception_insert_intents force row level security;
revoke all on table private.attendance_exception_insert_intents from public,anon,authenticated,service_role;

-- Once an exception is pending, the first-vital path must wait until its
-- requester cancels it or the director rejects it. This prevents a normal
-- check-in and an unresolved exception from silently coexisting. The sole
-- insert allowed while pending is the exact director-reviewed exception.
create function private.guard_attendance_pending_exception() returns trigger
language plpgsql security definer set search_path='' as $$
declare v_pending private.attendance_exception_requests%rowtype;
begin
  if new.status<>'present' or new.correction_of_id is not null then return new; end if;
  select * into v_pending from private.attendance_exception_requests x
    where x.client_id=new.client_id and x.service_date=new.service_date and x.status='pending';
  if not found then return new; end if;
  if new.source='staff_backfill' and new.recorded_by=auth.uid()
    and exists(select 1 from private.attendance_exception_insert_intents i
      where i.request_id=v_pending.id and i.transaction_id=txid_current()
        and i.reviewer_user_id=auth.uid() and i.attendance_key=new.idempotency_key
        and i.approved_checked_in_at=new.checked_in_at) then
    return new;
  end if;
  raise exception using errcode='23514',
    message='pending attendance exception must be cancelled or rejected before first-vital arrival';
end; $$;
create trigger attendance_pending_exception_guard before insert on public.attendance_records
  for each row execute function private.guard_attendance_pending_exception();

-- Keep the public attendance RPC invoker. Its private checked delegate retains
-- exact committed retries, but refuses a NEW caregiver check-in without the
-- first-vital transaction. The original private atomic writer is no longer
-- executable by authenticated callers (even if private becomes API-exposed).
create function private.record_attendance_event_checked(
  p_expected_organization_id uuid,p_expected_branch_id uuid,p_client_id uuid,
  p_event_kind text,p_occurred_at timestamptz,p_reason text,p_idempotency_key uuid
) returns table(operation_id uuid,attendance_id uuid,service_date date,
  status public.attendance_status,checked_in_at timestamptz,checked_out_at timestamptz,
  source text,replayed boolean)
language plpgsql volatile security definer set search_path='' as $$
declare v_is_care_worker boolean; v_replay boolean;
begin
  if p_event_kind='check_in' then
    select coalesce(bool_or(r.role_key='care_worker'),false)
    into v_is_care_worker
    from private.routine_staff_scope() s join public.roles r on r.id=s.role_id
    where s.organization_id=p_expected_organization_id
      and (s.branch_id=p_expected_branch_id or s.branch_id is null);
    -- Any active care_worker assignment uses the same first-vital rule, even
    -- if that employee also carries a nursing/social-work role. Other staff
    -- keep their existing independently authorized attendance workflow.
    if v_is_care_worker then
      select exists(select 1 from private.attendance_operations o
        where o.organization_id=p_expected_organization_id and o.actor_user_id=auth.uid()
          and o.idempotency_key=p_idempotency_key) into v_replay;
      if not v_replay then
        raise exception using errcode='42501',message='care worker check-in requires first vital or approved exception';
      end if;
    end if;
  end if;
  return query select * from private.record_attendance_event_atomic(
    p_expected_organization_id,p_expected_branch_id,p_client_id,p_event_kind,
    p_occurred_at,p_reason,p_idempotency_key);
end; $$;
create or replace function public.record_attendance_event(
  p_expected_organization_id uuid,p_expected_branch_id uuid,p_client_id uuid,
  p_event_kind text,p_occurred_at timestamptz,p_reason text,p_idempotency_key uuid
) returns table(operation_id uuid,attendance_id uuid,service_date date,
  status public.attendance_status,checked_in_at timestamptz,checked_out_at timestamptz,
  source text,replayed boolean)
language sql volatile security invoker set search_path='' as $$
  select * from private.record_attendance_event_checked(
    p_expected_organization_id,p_expected_branch_id,p_client_id,p_event_kind,
    p_occurred_at,p_reason,p_idempotency_key);
$$;
revoke all on function private.record_attendance_event_atomic(uuid,uuid,uuid,text,timestamptz,text,uuid)
  from authenticated;
revoke all on function private.record_attendance_event_checked(uuid,uuid,uuid,text,timestamptz,text,uuid)
  from public,anon,authenticated,service_role;
grant execute on function private.record_attendance_event_checked(uuid,uuid,uuid,text,timestamptz,text,uuid)
  to authenticated;

create function private.request_attendance_exception_atomic(
  p_organization_id uuid,p_branch_id uuid,p_client_id uuid,p_expected_service_date date,
  p_reason_code text,p_reason_note text,p_idempotency_key uuid
) returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare
  v_actor uuid:=auth.uid(); v_client public.clients%rowtype;
  v_existing private.attendance_exception_requests%rowtype;
  v_date date; v_now timestamptz; v_note text:=nullif(btrim(p_reason_note),''); v_hash text;
  v_measurement_id uuid; v_measurement_at timestamptz;
begin
  if v_actor is null or p_organization_id is null or p_branch_id is null or p_client_id is null
    or p_expected_service_date is null or not isfinite(p_expected_service_date)
    or p_idempotency_key is null or p_reason_code is null
    or p_reason_code not in ('refused','device_failure','emergency_transfer','measurement_preexisting')
    or char_length(coalesce(v_note,''))>500 then
    raise exception using errcode='22023',message='invalid attendance exception request';
  end if;
  if not exists(select 1 from private.routine_staff_scope() s join public.roles r on r.id=s.role_id
      where s.organization_id=p_organization_id and (s.branch_id=p_branch_id or s.branch_id is null)
        and r.role_key='care_worker') then
    raise exception using errcode='42501',message='care worker role is required';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(
    'attendance-exception-request:'||v_actor::text||':'||p_idempotency_key::text,0));
  select c.* into v_client from public.clients c where c.id=p_client_id
    and c.organization_id=p_organization_id and c.branch_id=p_branch_id for update;
  if not found or not (private.can_staff_access_client(p_client_id,'attendance.write')
    or private.can_routine_staff_access_client(p_client_id,'attendance.write')) then
    raise exception using errcode='42501',message='attendance exception client scope is not permitted';
  end if;
  v_hash:=encode(sha256(convert_to(jsonb_build_object('organization_id',p_organization_id,
    'branch_id',p_branch_id,'client_id',p_client_id,'service_date',p_expected_service_date,
    'reason_code',p_reason_code,
    'reason_note',v_note)::text,'UTF8')),'hex');
  select * into v_existing from private.attendance_exception_requests x
    where x.organization_id=p_organization_id and x.requester_user_id=v_actor
      and x.idempotency_key=p_idempotency_key;
  if found then
    if v_existing.request_hash<>v_hash then
      raise exception using errcode='23505',message='attendance exception idempotency conflict';
    end if;
    return jsonb_build_object('id',v_existing.id,'client_id',v_existing.client_id,
      'service_date',v_existing.service_date,'requested_at',v_existing.requested_at,
      'status',v_existing.status,'attendance_id',v_existing.attendance_id,'replayed',true);
  end if;
  v_now:=clock_timestamp(); v_date:=(v_now at time zone 'Asia/Taipei')::date;
  if p_expected_service_date<>v_date then
    raise exception using errcode='DAA03',message='selected service date is no longer today in Taipei';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(
    'attendance-day:'||p_client_id::text||':'||v_date::text,0));
  if private.client_service_state_on(p_client_id,v_date) is distinct from 'eligible' then
    raise exception using errcode='23514',message='client is not eligible for service today';
  end if;
  if exists(select 1 from public.attendance_records a where a.client_id=p_client_id
    and a.service_date=v_date and a.correction_of_id is null and a.status<>'cancelled') then
    raise exception using errcode='23514',message='attendance already exists for today';
  end if;
  select m.id,m.measured_at into v_measurement_id,v_measurement_at from public.measurements m
    where m.organization_id=p_organization_id and m.branch_id=p_branch_id and m.client_id=p_client_id
      and m.measurement_kind in ('blood_pressure_systolic','blood_pressure_diastolic','pulse','temperature','oxygen_saturation')
      and m.numeric_value is not null and m.measured_at >= (v_date::timestamp at time zone 'Asia/Taipei')
      and m.measured_at < ((v_date+1)::timestamp at time zone 'Asia/Taipei')
      and m.measured_at<=v_now
    order by m.measured_at,m.id limit 1;
  if p_reason_code='measurement_preexisting' and v_measurement_id is null then
    raise exception using errcode='23514',message='no effective first vital exists for measurement reconciliation';
  elsif p_reason_code<>'measurement_preexisting' and v_measurement_id is not null then
    raise exception using errcode='23514',message='first vital exists; request measurement reconciliation';
  end if;
  insert into private.attendance_exception_requests(organization_id,branch_id,client_id,
    requester_user_id,requested_at,service_date,reason_code,reason_note,
    measurement_id,measurement_at,idempotency_key,request_hash)
  values(p_organization_id,p_branch_id,p_client_id,v_actor,v_now,v_date,p_reason_code,v_note,
    v_measurement_id,v_measurement_at,p_idempotency_key,v_hash)
  returning * into v_existing;
  return jsonb_build_object('id',v_existing.id,'client_id',v_existing.client_id,
    'service_date',v_existing.service_date,'requested_at',v_existing.requested_at,
    'status',v_existing.status,'replayed',false);
end; $$;
create function public.request_attendance_exception(
  p_organization_id uuid,p_branch_id uuid,p_client_id uuid,p_expected_service_date date,
  p_reason_code text,p_reason_note text,p_idempotency_key uuid
) returns jsonb language sql volatile security invoker set search_path='' as $$
  select private.request_attendance_exception_atomic(p_organization_id,p_branch_id,p_client_id,p_expected_service_date,
    p_reason_code,p_reason_note,p_idempotency_key);
$$;

create function private.decide_attendance_exception_atomic(
  p_organization_id uuid,p_branch_id uuid,p_request_id uuid,
  p_decision text,p_decision_note text,p_confirmed_arrival_at timestamptz,p_idempotency_key uuid
) returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare
  v_actor uuid:=auth.uid(); v_req private.attendance_exception_requests%rowtype;
  v_client public.clients%rowtype; v_note text:=nullif(btrim(p_decision_note),'');
  v_hash text; v_now timestamptz; v_attendance_id uuid; v_director boolean;
  v_first_measurement_id uuid; v_first_measurement_at timestamptz;
begin
  if v_actor is null or p_organization_id is null or p_branch_id is null
    or p_request_id is null or p_idempotency_key is null
    or p_decision is null or p_decision not in ('approve','reject','cancel')
    or char_length(coalesce(v_note,''))>500
    or (p_decision='reject' and v_note is null)
    or (p_decision<>'approve' and p_confirmed_arrival_at is not null) then
    raise exception using errcode='22023',message='invalid attendance exception decision';
  end if;
  select private.has_live_exception_director_scope(p_organization_id,p_branch_id,false) into v_director;
  select * into v_req from private.attendance_exception_requests x
    where x.id=p_request_id and x.organization_id=p_organization_id and x.branch_id=p_branch_id;
  if not found then raise exception using errcode='42501',message='attendance exception scope is not permitted'; end if;
  if (p_decision='cancel' and v_req.requester_user_id<>v_actor)
    or (p_decision<>'cancel' and (not v_director or v_req.requester_user_id=v_actor)) then
    raise exception using errcode='42501',message='independent branch director decision is required';
  end if;
  if p_decision='cancel' and not exists(
    select 1 from private.routine_staff_scope() s join public.roles r on r.id=s.role_id
    where s.organization_id=p_organization_id and (s.branch_id=p_branch_id or s.branch_id is null)
      and r.role_key='care_worker'
  ) then
    raise exception using errcode='42501',message='active care worker role is required to cancel';
  end if;
  v_hash:=encode(sha256(convert_to(jsonb_build_object('request_id',p_request_id,
    'decision',p_decision,'decision_note',v_note,
    'confirmed_arrival_at',p_confirmed_arrival_at)::text,'UTF8')),'hex');
  -- All attendance writers acquire client then service-day lock before formal
  -- row mutation. Never lock the request first; a concurrent submission can
  -- hold the client and wait on the unique pending index.
  select * into v_client from public.clients c where c.id=v_req.client_id
    and c.organization_id=p_organization_id and c.branch_id=p_branch_id for update;
  if not found then raise exception using errcode='42501',message='attendance exception client scope is not permitted'; end if;
  perform pg_advisory_xact_lock(hashtextextended(
    'attendance-day:'||v_req.client_id::text||':'||v_req.service_date::text,0));
  select * into v_req from private.attendance_exception_requests x
    where x.id=p_request_id and x.organization_id=p_organization_id and x.branch_id=p_branch_id for update;
  if v_req.status<>'pending' then
    if v_req.resolved_by=v_actor and v_req.decision_key=p_idempotency_key
      and v_req.decision_hash=v_hash and v_req.status=(case p_decision
        when 'approve' then 'approved' when 'reject' then 'rejected' else 'cancelled' end) then
      return jsonb_build_object('id',v_req.id,'client_id',v_req.client_id,
        'service_date',v_req.service_date,'status',v_req.status,
        'attendance_id',v_req.attendance_id,'replayed',true);
    end if;
    raise exception using errcode='23514',message='attendance exception already resolved';
  end if;
  v_now:=clock_timestamp();
  if p_decision in ('approve','reject') then
    if not private.has_live_exception_director_scope(p_organization_id,p_branch_id,true) then
      raise exception using errcode='42501',message='attendance exception approval permission is required';
    end if;
    if not private.has_recent_exception_director_aal2() then
      raise exception using errcode='DAA02',message='recent AAL2 is required for attendance exception decision';
    end if;
  end if;
  if p_decision='approve' then
    if p_confirmed_arrival_at is null or v_note is null
      or (p_confirmed_arrival_at at time zone 'Asia/Taipei')::date<>v_req.service_date
      or p_confirmed_arrival_at>v_now then
      raise exception using errcode='22023',message='verified arrival time and reason are required';
    end if;
    if private.client_service_state_on(v_req.client_id,v_req.service_date) is distinct from 'eligible' then
      raise exception using errcode='23514',message='client is not eligible for service on requested day';
    end if;
    if exists(select 1 from public.attendance_records a where a.client_id=v_req.client_id
      and a.service_date=v_req.service_date and a.correction_of_id is null and a.status<>'cancelled') then
      raise exception using errcode='23514',message='attendance already exists for requested service day';
    end if;
    select m.id,m.measured_at into v_first_measurement_id,v_first_measurement_at
    from public.measurements m where m.organization_id=p_organization_id
      and m.branch_id=p_branch_id and m.client_id=v_req.client_id
      and m.measurement_kind in ('blood_pressure_systolic','blood_pressure_diastolic','pulse','temperature','oxygen_saturation')
      and m.numeric_value is not null and m.measured_at<=v_now
      and m.measured_at >= (v_req.service_date::timestamp at time zone 'Asia/Taipei')
      and m.measured_at < ((v_req.service_date+1)::timestamp at time zone 'Asia/Taipei')
    order by m.measured_at,m.id limit 1;
    if v_req.reason_code='measurement_preexisting' then
      if v_first_measurement_id is distinct from v_req.measurement_id
        or v_first_measurement_at is distinct from v_req.measurement_at then
        raise exception using errcode='23514',message='first vital provenance changed; cancel and resubmit exception';
      end if;
    elsif v_first_measurement_id is not null then
      raise exception using errcode='23514',message='effective vital appeared after exception request; review measurement reconciliation';
    end if;
    insert into private.attendance_exception_insert_intents(request_id,transaction_id,reviewer_user_id,attendance_key,approved_checked_in_at)
    values(v_req.id,txid_current(),v_actor,p_idempotency_key,p_confirmed_arrival_at);
    insert into public.attendance_records(organization_id,branch_id,client_id,service_date,status,
      checked_in_at,source,correction_reason,idempotency_key,recorded_by)
    values(p_organization_id,p_branch_id,v_req.client_id,v_req.service_date,'present',
      p_confirmed_arrival_at,'staff_backfill',
      '出勤例外簽到；主任已覆核。申請原因與到場核對依據請查受限的例外申請紀錄。',
      p_idempotency_key,v_actor)
    returning id into v_attendance_id;
    delete from private.attendance_exception_insert_intents where request_id=v_req.id;
  end if;
  update private.attendance_exception_requests x set status=case p_decision
      when 'approve' then 'approved' when 'reject' then 'rejected' else 'cancelled' end,
    resolved_by=v_actor,resolved_at=v_now,decision_key=p_idempotency_key,
    decision_hash=v_hash,decision_note=v_note,
    resolved_arrival_at=case when p_decision='approve' then p_confirmed_arrival_at else null end,
    attendance_id=v_attendance_id
    where x.id=v_req.id;
  return jsonb_build_object('id',v_req.id,'client_id',v_req.client_id,
    'service_date',v_req.service_date,'status',case p_decision
      when 'approve' then 'approved' when 'reject' then 'rejected' else 'cancelled' end,
    'attendance_id',v_attendance_id,'replayed',false);
end; $$;
create function public.decide_attendance_exception(
  p_organization_id uuid,p_branch_id uuid,p_request_id uuid,
  p_decision text,p_decision_note text,p_confirmed_arrival_at timestamptz,p_idempotency_key uuid
) returns jsonb language sql volatile security invoker set search_path='' as $$
  select private.decide_attendance_exception_atomic(p_organization_id,p_branch_id,p_request_id,
    p_decision,p_decision_note,p_confirmed_arrival_at,p_idempotency_key);
$$;

create function private.attendance_exception_snapshot_atomic(
  p_organization_id uuid,p_branch_id uuid,p_service_date date,p_client_id uuid default null
) returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare v_actor uuid:=auth.uid(); v_director boolean; v_caregiver boolean; v_items jsonb;
begin
  if v_actor is null or p_organization_id is null or p_branch_id is null
    or p_service_date is null then
    raise exception using errcode='22023',message='attendance exception scope and date are required';
  end if;
  select private.has_live_exception_director_scope(p_organization_id,p_branch_id,false) into v_director;
  select exists(select 1 from private.routine_staff_scope() s join public.roles r on r.id=s.role_id
    where s.organization_id=p_organization_id and (s.branch_id=p_branch_id or s.branch_id is null)
      and r.role_key='care_worker') into v_caregiver;
  if not v_director and not v_caregiver then
    raise exception using errcode='42501',message='attendance exception scope is not permitted';
  end if;
  if p_client_id is not null and not v_director and not
    (private.can_staff_access_client(p_client_id,'attendance.read')
      or private.can_routine_staff_access_client(p_client_id,'attendance.read')) then
    raise exception using errcode='42501',message='attendance exception client scope is not permitted';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'id',x.id,'client_id',x.client_id,'client_name',c.display_name,
    'client_code',c.client_code,'requester_user_id',x.requester_user_id,
    'requester_name',p.display_name,
    'service_date',x.service_date,'requested_at',x.requested_at,
    'reason_code',x.reason_code,'reason_note',x.reason_note,
    'measurement_at',x.measurement_at,'measurement_source',m.source,
    'resolved_arrival_at',x.resolved_arrival_at,'status',x.status,
    'decision_note',x.decision_note,'resolved_at',x.resolved_at)
    order by x.requested_at desc),'[]'::jsonb) into v_items
  from (select * from private.attendance_exception_requests q
    where q.organization_id=p_organization_id and q.branch_id=p_branch_id
      and q.service_date=p_service_date
      and (p_client_id is null or q.client_id=p_client_id)
      and (v_director or (q.requester_user_id=v_actor and
        (private.can_staff_access_client(q.client_id,'attendance.read')
          or private.can_routine_staff_access_client(q.client_id,'attendance.read'))))
    order by q.requested_at desc limit 200) x
  join public.clients c on c.id=x.client_id and c.organization_id=x.organization_id
    and c.branch_id=x.branch_id
  left join public.measurements m on m.id=x.measurement_id
  join public.profiles p on p.id=x.requester_user_id
  ;
  insert into public.audit_events(organization_id,branch_id,actor_user_id,action,
    table_name,row_pk,changed_fields,metadata)
  values(p_organization_id,p_branch_id,v_actor,'select','attendance_exception_requests',
    coalesce(p_client_id::text,p_service_date::text),array['bounded_requests'],
    jsonb_build_object('operation','attendance_exception_snapshot',
      'service_date',p_service_date,'request_count',jsonb_array_length(v_items),
      'director_scope',v_director));
  return jsonb_build_object('service_date',p_service_date,'requests',v_items,
    'reviewer',v_director);
end; $$;
create function public.attendance_exception_snapshot(
  p_organization_id uuid,p_branch_id uuid,p_service_date date,p_client_id uuid default null
) returns jsonb language sql volatile security invoker set search_path='' as $$
  select private.attendance_exception_snapshot_atomic(
    p_organization_id,p_branch_id,p_service_date,p_client_id);
$$;

revoke all on function private.guard_attendance_exception_update() from public,anon,authenticated,service_role;
revoke all on function private.guard_attendance_pending_exception() from public,anon,authenticated,service_role;
revoke all on function private.request_attendance_exception_atomic(uuid,uuid,uuid,date,text,text,uuid)
  from public,anon,authenticated,service_role;
revoke all on function private.decide_attendance_exception_atomic(uuid,uuid,uuid,text,text,timestamptz,uuid)
  from public,anon,authenticated,service_role;
revoke all on function private.attendance_exception_snapshot_atomic(uuid,uuid,date,uuid)
  from public,anon,authenticated,service_role;
revoke all on function public.request_attendance_exception(uuid,uuid,uuid,date,text,text,uuid)
  from public,anon,authenticated,service_role;
revoke all on function public.decide_attendance_exception(uuid,uuid,uuid,text,text,timestamptz,uuid)
  from public,anon,authenticated,service_role;
revoke all on function public.attendance_exception_snapshot(uuid,uuid,date,uuid)
  from public,anon,authenticated,service_role;
grant execute on function private.request_attendance_exception_atomic(uuid,uuid,uuid,date,text,text,uuid) to authenticated;
grant execute on function private.decide_attendance_exception_atomic(uuid,uuid,uuid,text,text,timestamptz,uuid) to authenticated;
grant execute on function private.attendance_exception_snapshot_atomic(uuid,uuid,date,uuid) to authenticated;
grant execute on function public.request_attendance_exception(uuid,uuid,uuid,date,text,text,uuid) to authenticated;
grant execute on function public.decide_attendance_exception(uuid,uuid,uuid,text,text,timestamptz,uuid) to authenticated;
grant execute on function public.attendance_exception_snapshot(uuid,uuid,date,uuid) to authenticated;

commit;
