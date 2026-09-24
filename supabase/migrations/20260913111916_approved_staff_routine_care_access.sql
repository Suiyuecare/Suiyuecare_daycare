-- First-batch, individually approved Google staff access. No account is seeded.
-- The owner must verify and approve each immutable Auth UUID / Google subject
-- and organization. This is NOT an invitation endpoint or an AAL2 substitute.
-- Existing executive admission and every privileged permission root stay intact.
create table private.staff_google_access_grants (
  allowed_user_id uuid primary key references auth.users(id) on delete restrict,
  organization_id uuid not null references public.organizations(id) on delete restrict,
  company_email_domain text not null check (
    company_email_domain=lower(btrim(company_email_domain))
    and char_length(company_email_domain) between 3 and 253
    and company_email_domain ~ '^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$'
    and company_email_domain not in ('gmail.com','googlemail.com')
  ),
  allowed_email text not null check (
    allowed_email=lower(btrim(allowed_email)) and char_length(allowed_email) between 3 and 254
    and allowed_email ~ '^[^[:space:]@]+@[^[:space:]@]+$'
  ),
  google_subject text not null unique check (
    google_subject=btrim(google_subject) and char_length(google_subject) between 1 and 255
    and google_subject !~ '[^ -~]'
  ),
  enabled boolean not null default false,
  approved_at timestamptz not null default clock_timestamp(),
  expires_at timestamptz,
  approval_reference text not null check (
    char_length(btrim(approval_reference)) between 1 and 240 and approval_reference !~ '[[:cntrl:]]'
  ),
  check (expires_at is null or expires_at>approved_at),
  check (split_part(allowed_email,'@',2)=company_email_domain)
);
create index staff_google_access_grants_organization_idx on private.staff_google_access_grants(organization_id);
alter table private.staff_google_access_grants enable row level security;
alter table private.staff_google_access_grants force row level security;
revoke all on table private.staff_google_access_grants from public,anon,authenticated,service_role;

-- This table's key is allowed_user_id, not id. Audit the affected stable UUID
-- even after revocation/deletion, never the email, Google subject or raw approval
-- reference. A database-owner operation without Auth context is explicitly a
-- system actor; it must not be presented as an identified human or dual approval.
create function private.audit_staff_google_access_grant() returns trigger
language plpgsql security invoker set search_path='' as $$
declare v_old jsonb:='{}'; v_new jsonb:='{}'; v_row jsonb; v_fields text[];
begin
 if tg_op<>'INSERT' then v_old:=to_jsonb(old); end if;
 if tg_op<>'DELETE' then v_new:=to_jsonb(new); end if;
 if tg_op='UPDATE' and (new.allowed_user_id is distinct from old.allowed_user_id
   or new.organization_id is distinct from old.organization_id) then
  raise exception using errcode='23514',message='staff approval identity and organization are immutable';
 end if;
 v_row:=case when tg_op='DELETE' then v_old else v_new end;
 select coalesce(array_agg(k order by k),'{}'::text[]) into v_fields
 from jsonb_object_keys(v_old||v_new) k where v_old->k is distinct from v_new->k;
 insert into public.audit_events(organization_id,actor_user_id,action,table_name,row_pk,changed_fields,metadata,occurred_at)
 values((v_row->>'organization_id')::uuid,auth.uid(),lower(tg_op),'private.staff_google_access_grants',
  v_row->>'allowed_user_id',v_fields,jsonb_build_object('system_actor',auth.uid() is null,
   'authority_path','database_owner_provisioning',
   'approval_reference_sha256',encode(sha256(convert_to(v_row->>'approval_reference','UTF8')),'hex')),clock_timestamp());
 if tg_op='DELETE' then return old; end if; return new;
end;
$$;
alter function private.audit_staff_google_access_grant() owner to postgres;
revoke all on function private.audit_staff_google_access_grant() from public,anon,authenticated,service_role;
create trigger staff_google_access_grants_audit after insert or update or delete on private.staff_google_access_grants
for each row execute function private.audit_staff_google_access_grant();

-- Further definitions below retain explicit search paths and self-only checks.
create function private.is_staff_google_session_allowed()
returns boolean language plpgsql volatile security definer set search_path = '' as $$
declare
  v_now timestamptz := clock_timestamp();
  v_claims jsonb := auth.jwt();
  v_user_id uuid;
  v_session_id uuid;
  v_issued_at timestamptz;
  v_expires_at timestamptz;
  v_entry jsonb;
  v_method text;
  v_amr_time bigint;
  v_has_oauth boolean := false;
  v_has_totp boolean := false;
  v_policy private.staff_google_access_grants%rowtype;
begin
  if jsonb_typeof(v_claims) is distinct from 'object'
    or v_claims->>'role' is distinct from 'authenticated'
    or v_claims->>'aud' is distinct from 'authenticated'
    or v_claims->'is_anonymous' is distinct from 'false'::jsonb
    or coalesce(v_claims->>'aal','') not in ('aal1','aal2')
    or v_claims ? 'client_id'
    or coalesce(v_claims->>'sub','') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    or coalesce(v_claims->>'session_id','') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    or jsonb_typeof(v_claims->'iat') is distinct from 'number'
    or jsonb_typeof(v_claims->'exp') is distinct from 'number'
    or coalesce(v_claims->>'iat','') !~ '^[0-9]{1,11}$'
    or coalesce(v_claims->>'exp','') !~ '^[0-9]{1,11}$'
    or jsonb_typeof(v_claims->'amr') is distinct from 'array' then
    return false;
  end if;
  v_user_id := auth.uid();
  v_session_id := (v_claims->>'session_id')::uuid;
  v_issued_at := to_timestamp((v_claims->>'iat')::double precision);
  v_expires_at := to_timestamp((v_claims->>'exp')::double precision);
  if v_user_id is null or v_issued_at < v_now - interval '1 hour'
    or v_issued_at > v_now + interval '1 minute'
    or v_expires_at <= v_now or v_expires_at <= v_issued_at
    or jsonb_array_length(v_claims->'amr') not between 1 and 8 then return false; end if;

  -- Owner-approved stable identity, never a domain or user_metadata grant.
  select * into v_policy from private.staff_google_access_grants
    where allowed_user_id=v_user_id and enabled and approved_at<=v_now
      and (expires_at is null or expires_at>v_now);
  if not found or lower(coalesce(v_claims->>'email','')) <> v_policy.allowed_email then return false; end if;

  if not exists (
    select 1 from auth.users u join auth.sessions s on s.user_id=u.id
    where u.id=v_user_id and not u.is_anonymous and u.deleted_at is null
      and u.email_confirmed_at is not null
      and lower(coalesce(u.email,''))=v_policy.allowed_email
      and (u.banned_until is null or u.banned_until<=v_now)
      and s.id=v_session_id and s.created_at is not null and s.created_at<=v_now
      and s.oauth_client_id is null
      and (s.not_after is null or s.not_after>v_now)
      and v_issued_at>=s.created_at-interval '1 minute'
      and (v_claims->>'aal'<>'aal2' or s.aal::text='aal2')
  ) then return false; end if;

  -- Supabase-owned identities, not editable raw_user_meta_data. A residual
  -- email identity from supported admin pre-provisioning is not a login grant.
  -- Other OAuth providers and manual identity linking must remain disabled.
  if (select count(*) from auth.identities i where i.user_id=v_user_id and i.provider='google') <> 1
    or exists (select 1 from auth.identities i where i.user_id=v_user_id and i.provider not in ('google','email'))
    or not exists (
      select 1 from auth.identities i where i.user_id=v_user_id and i.provider='google'
        and i.provider_id=v_policy.google_subject
        and i.identity_data->>'sub'=v_policy.google_subject
        -- A company Google account does not require a paid Workspace subscription.
        -- If Google supplies hd it must match; absent hd is not identity evidence.
        -- Exact pinned user / subject / verified email remain mandatory below.
        and (not (i.identity_data ? 'hd') or lower(coalesce(i.identity_data->>'hd',''))=v_policy.company_email_domain)
        and lower(coalesce(i.identity_data->>'email',''))=v_policy.allowed_email
        and i.identity_data->'email_verified'='true'::jsonb
    ) then return false; end if;

  -- AMR is attached to this actual Auth session. A linked Google identity or
  -- app_metadata.provider alone cannot turn a password/OTP session into OAuth.
  -- Auth currently derives JWT AMR timestamps from mfa_amr_claims.updated_at.
  for v_entry in select value from jsonb_array_elements(v_claims->'amr') loop
    v_method := v_entry->>'method';
    if jsonb_typeof(v_entry) is distinct from 'object'
      or coalesce(v_method,'') not in ('oauth','totp','token_refresh')
      or jsonb_typeof(v_entry->'timestamp') is distinct from 'number'
      or coalesce(v_entry->>'timestamp','') !~ '^[0-9]{1,11}$' then return false; end if;
    v_amr_time := (v_entry->>'timestamp')::bigint;
    if to_timestamp(v_amr_time)>v_now+interval '1 minute' or not exists (
      select 1 from auth.mfa_amr_claims a
      where a.session_id=v_session_id and a.authentication_method=v_method
        and floor(extract(epoch from a.updated_at))=v_amr_time
    ) then return false; end if;
    v_has_oauth := v_has_oauth or v_method='oauth';
    v_has_totp := v_has_totp or v_method='totp';
  end loop;
  if not v_has_oauth or (v_claims->>'aal'='aal2' and not v_has_totp)
    or exists (select 1 from auth.mfa_amr_claims a where a.session_id=v_session_id
      and a.authentication_method not in ('oauth','totp','token_refresh')) then return false; end if;
  return true;
exception when invalid_text_representation or numeric_value_out_of_range or datetime_field_overflow then
  return false;
end;
$$;


create function private.routine_staff_scope()
returns table(membership_id uuid, organization_id uuid, branch_id uuid, role_id uuid)
language plpgsql volatile security definer set search_path='' as $$
begin
 if private.is_staff_google_session_allowed() is not true then return; end if;
 return query
 select m.id,m.organization_id,m.branch_id,r.id
 from private.staff_google_access_grants g
 join public.profiles p on p.id=g.allowed_user_id and p.is_active and p.kind in ('staff','professional','driver','finance')
 join public.memberships m on m.profile_id=p.id and m.organization_id=g.organization_id
 join public.organizations o on o.id=m.organization_id and o.is_active
 join public.membership_roles mr on mr.membership_id=m.id and mr.assigned_at<=clock_timestamp()
 join public.roles r on r.id=mr.role_id and r.is_active
 where g.allowed_user_id=auth.uid() and g.enabled and g.approved_at<=clock_timestamp()
  and (g.expires_at is null or g.expires_at>clock_timestamp())
  and m.status='active' and m.starts_at<=clock_timestamp() and (m.ends_at is null or m.ends_at>clock_timestamp())
  and r.role_key not in ('family','platform_ops')
  and (r.organization_id is null or r.organization_id=m.organization_id)
  and exists(select 1 from public.branches b where b.organization_id=m.organization_id
   and b.is_active and (m.branch_id is null or m.branch_id=b.id));
end;
$$;

create function private.is_active_routine_staff()
returns boolean language sql volatile security definer set search_path='' as $$
 select exists(select 1 from private.routine_staff_scope());
$$;

create function private.has_routine_staff_permission(p_organization_id uuid,p_branch_id uuid,p_permission_key text)
returns boolean language sql volatile security definer set search_path='' as $$
 select coalesce(p_permission_key in (
  'clients.read','clients.view_all','attendance.read','attendance.write',
  'health.read','health.write','care_records.read','care_records.write','services.read'
 ) and exists(
  select 1 from private.routine_staff_scope() s
  join public.role_permissions rp on rp.role_id=s.role_id and rp.granted_at<=clock_timestamp()
  join public.permissions p on p.id=rp.permission_id and p.permission_key=p_permission_key
  where s.organization_id=p_organization_id
   and ((p_branch_id is null and s.branch_id is null)
    or (p_branch_id is not null and (s.branch_id is null or s.branch_id=p_branch_id)
     and exists(select 1 from public.branches b where b.id=p_branch_id
      and b.organization_id=p_organization_id and b.is_active)))
 ),false);
$$;

create function private.can_routine_staff_access_client(p_client_id uuid,p_permission_key text)
returns boolean language sql volatile security definer set search_path='' as $$
 select exists(select 1 from public.clients c where c.id=p_client_id
  and private.has_routine_staff_permission(c.organization_id,c.branch_id,'clients.read')
  and private.has_routine_staff_permission(c.organization_id,c.branch_id,p_permission_key)
  and (private.has_routine_staff_permission(c.organization_id,c.branch_id,'clients.view_all')
   or exists(select 1 from public.client_assignments a where a.client_id=c.id
    and a.organization_id=c.organization_id and a.branch_id=c.branch_id and a.assignee_user_id=auth.uid()
    and a.starts_at<=clock_timestamp() and (a.ends_at is null or a.ends_at>clock_timestamp()))));
$$;

create function public.is_staff_login_allowed()
returns boolean language sql volatile security invoker set search_path='' as $$
 select private.is_active_executive_reader() or private.is_active_routine_staff();
$$;
comment on function public.is_staff_login_allowed() is
 'Self-only CEO-or-individually-approved staff Google admission. No role grant, AAL2 claim or unrestricted write authority.';

create function public.has_routine_care_access(target_org_id uuid,target_branch_id uuid,target_permission text)
returns boolean language sql volatile security invoker set search_path='' as $$
 select coalesce(target_org_id is not null and target_branch_id is not null
  and target_permission in ('attendance.write','health.write','care_records.write','care_records.read')
  and private.has_routine_staff_permission(target_org_id,target_branch_id,'clients.read')
  and private.has_routine_staff_permission(target_org_id,target_branch_id,target_permission),false);
$$;
comment on function public.has_routine_care_access(uuid,uuid,text) is
 'Current effective self scope for three routine write keys and diary read only. Every mutation must independently check its target client and operation.';

alter function private.is_staff_google_session_allowed() owner to postgres;
alter function private.routine_staff_scope() owner to postgres;
alter function private.is_active_routine_staff() owner to postgres;
alter function private.has_routine_staff_permission(uuid,uuid,text) owner to postgres;
alter function private.can_routine_staff_access_client(uuid,text) owner to postgres;
revoke all on function private.is_staff_google_session_allowed(),private.routine_staff_scope(),
 private.is_active_routine_staff(),private.has_routine_staff_permission(uuid,uuid,text),
 private.can_routine_staff_access_client(uuid,text),public.is_staff_login_allowed(),
 public.has_routine_care_access(uuid,uuid,text) from public,anon,authenticated,service_role;
grant execute on function private.is_staff_google_session_allowed(),private.routine_staff_scope(),
 private.is_active_routine_staff(),private.has_routine_staff_permission(uuid,uuid,text),
 private.can_routine_staff_access_client(uuid,text),public.is_staff_login_allowed(),
 public.has_routine_care_access(uuid,uuid,text) to authenticated;

-- SELECT-only policy additions. No direct business DML or raw identity grants.
create policy routine_staff_organizations_select on public.organizations for select to authenticated
using (is_active and exists(select 1 from private.routine_staff_scope() s where s.organization_id=id));
create policy routine_staff_branches_select on public.branches for select to authenticated
using (is_active and exists(select 1 from private.routine_staff_scope() s
  where s.organization_id=branches.organization_id and (s.branch_id is null or s.branch_id=branches.id)));
create policy routine_staff_profiles_select on public.profiles for select to authenticated
using (id=(select auth.uid()) and (select private.is_active_routine_staff()));
create policy routine_staff_memberships_select on public.memberships for select to authenticated
using (exists(select 1 from private.routine_staff_scope() s where s.membership_id=id));
create policy routine_staff_membership_roles_select on public.membership_roles for select to authenticated
using (exists(select 1 from private.routine_staff_scope() s
  where s.membership_id=membership_roles.membership_id and s.role_id=membership_roles.role_id));
create policy routine_staff_roles_select on public.roles for select to authenticated
using (exists(select 1 from private.routine_staff_scope() s where s.role_id=id));
create policy routine_staff_role_permissions_select on public.role_permissions for select to authenticated
using (granted_at<=clock_timestamp() and exists(select 1 from private.routine_staff_scope() s where s.role_id=role_permissions.role_id));
create policy routine_staff_permissions_select on public.permissions for select to authenticated
using (exists(select 1 from private.routine_staff_scope() s
  join public.role_permissions rp on rp.role_id=s.role_id
  where rp.permission_id=permissions.id and rp.granted_at<=clock_timestamp()));

-- Dashboard source rows retain their existing per-source permission and
-- assignment scope. New SELECT policy does not satisfy an INSERT/UPDATE policy.
create policy routine_staff_attendance_select on public.attendance_records for select to authenticated
using ((select private.can_routine_staff_access_client(client_id,'attendance.read')));
create policy routine_staff_measurements_select on public.measurements for select to authenticated
using ((select private.can_routine_staff_access_client(client_id,'health.read')));
create policy routine_staff_care_records_select on public.care_records for select to authenticated
using (category='staff/daily-care/care-diary' and (select private.can_routine_staff_access_client(client_id,'care_records.read')));
create policy routine_staff_service_events_select on public.service_events for select to authenticated
using ((select private.can_routine_staff_access_client(client_id,'services.read')));

-- Case-center "assigned to me" reads the existing assignment source directly.
-- This exposes only the caller's current effective assignments, not assignment
-- management or other employees. The helper independently validates the exact
-- organization, branch and client scope using owner-protected source rows.
create policy routine_staff_client_assignments_select on public.client_assignments for select to authenticated
using (assignee_user_id=(select auth.uid()) and starts_at<=clock_timestamp()
 and (ends_at is null or ends_at>clock_timestamp())
 and (select private.can_routine_staff_access_client(client_id,'clients.read')));


create or replace view public.active_memberships
with (security_invoker=true, security_barrier=true) as
select m.organization_id,m.branch_id,p.display_name,
  coalesce(array_agg(distinct r.role_key order by r.role_key)
    filter(where r.role_key is not null),'{}'::text[]) as role_keys,
  coalesce(array_agg(distinct permission.permission_key order by permission.permission_key)
    filter(where permission.permission_key is not null),'{}'::text[]) as scopes,
  m.profile_id as user_id
from public.memberships m
join public.profiles p on p.id=m.profile_id
left join public.membership_roles mr on mr.membership_id=m.id
left join public.roles r on r.id=mr.role_id and r.is_active
left join public.role_permissions rp on rp.role_id=r.id
left join public.permissions permission on permission.id=rp.permission_id
where m.profile_id=(select auth.uid())
  and ((select private.is_active_user()) or (select private.is_active_executive_reader()) or (select private.is_active_routine_staff()))
  and p.is_active and m.status='active' and m.starts_at<=now()
  and (m.ends_at is null or m.ends_at>now())
group by m.id,m.organization_id,m.branch_id,p.display_name,m.profile_id;


-- Same RPC contracts, validators, row locks, idempotency and immutable history.
-- Only explicit routine guards change. Backfill, sign, correct and reopen keep
-- the original permission and real AAL2 / recent-challenge paths.
create or replace function private.record_attendance_event_atomic(
  p_expected_organization_id uuid,
  p_expected_branch_id uuid,
  p_client_id uuid,
  p_event_kind text,
  p_occurred_at timestamptz,
  p_reason text,
  p_idempotency_key uuid
)
returns table(
  operation_id uuid,
  attendance_id uuid,
  service_date date,
  status public.attendance_status,
  checked_in_at timestamptz,
  checked_out_at timestamptz,
  source text,
  replayed boolean
)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_now timestamptz;
  v_service_date date;
  v_reason text := nullif(btrim(p_reason), '');
  v_is_backfill boolean;
  v_source text;
  v_request_hash text;
  v_client public.clients%rowtype;
  v_attendance public.attendance_records%rowtype;
  v_existing private.attendance_operations%rowtype;
  v_operation private.attendance_operations%rowtype;
begin
  if v_actor is null
     or p_expected_organization_id is null
     or p_expected_branch_id is null
     or p_client_id is null
     or p_event_kind is null
     or p_occurred_at is null
     or p_idempotency_key is null then
    raise exception using
      errcode = '22023',
      message = 'organization, branch, client, event, occurrence, and idempotency key are required';
  end if;

  if p_event_kind not in ('check_in', 'check_out', 'absent', 'leave') then
    raise exception using
      errcode = '22023',
      message = 'unsupported attendance event kind';
  end if;

  if char_length(coalesce(v_reason, '')) > 1000 then
    raise exception using
      errcode = '22023',
      message = 'attendance reason exceeds one thousand characters';
  end if;

  if coalesce(auth.jwt() ->> 'aal', '') <> 'aal2'
     and not public.has_routine_care_access(p_expected_organization_id,p_expected_branch_id,'attendance.write') then
    raise exception using
      errcode = '42501',
      message = 'AAL2 is required for attendance writes';
  end if;

  v_service_date := (p_occurred_at at time zone 'Asia/Taipei')::date;

  -- First serialize an actor's retry token. Calls using the same token but a
  -- different client/day cannot race the unique ledger key.
  perform pg_advisory_xact_lock(
    hashtextextended(
      'attendance-operation:' || v_actor::text || ':' || p_idempotency_key::text,
      0
    )
  );

  select client.*
    into v_client
  from public.clients client
  where client.id = p_client_id
    and client.organization_id = p_expected_organization_id
    and client.branch_id = p_expected_branch_id
  for update;

  if not found
     or not (select (private.can_staff_access_client(p_client_id, 'attendance.write')
       or private.can_routine_staff_access_client(p_client_id,'attendance.write'))) then
    raise exception using
      errcode = '42501',
      message = 'attendance client scope is not permitted';
  end if;

  -- The client row and this day-specific advisory lock are always acquired in
  -- the same order, keeping duplicate attendance checks race-safe.
  perform pg_advisory_xact_lock(
    hashtextextended(
      'attendance-day:' || p_client_id::text || ':' || v_service_date::text,
      0
    )
  );

  -- Hash only after the actor, client, and service-day lock domains are held.
  -- This keeps conflict and exact-replay resolution inside the same ordering
  -- used by every attendance mutation.
  v_request_hash := encode(
    sha256(
      convert_to(
        jsonb_build_object(
          'schema_version', 1,
          'organization_id', p_expected_organization_id,
          'branch_id', p_expected_branch_id,
          'client_id', p_client_id,
          'event_kind', p_event_kind,
          -- Epoch text is stable across PostgreSQL session TimeZone changes,
          -- so the same instant always produces the same replay hash.
          'occurred_at_epoch', extract(epoch from p_occurred_at)::text,
          'reason', v_reason
        )::text,
        'UTF8'
      )
    ),
    'hex'
  );

  select operation.*
    into v_existing
  from private.attendance_operations operation
  where operation.organization_id = v_client.organization_id
    and operation.actor_user_id = v_actor
    and operation.idempotency_key = p_idempotency_key;

  if found then
    if v_existing.request_hash <> v_request_hash then
      raise exception using
        errcode = '23505',
        message = 'attendance event idempotency conflict';
    end if;

    return query
    select
      v_existing.id,
      v_existing.attendance_id,
      v_existing.service_date,
      v_existing.result_status,
      v_existing.result_checked_in_at,
      v_existing.result_checked_out_at,
      v_existing.source,
      true;
    return;
  end if;

  -- Time-sensitive policy is evaluated only for a genuinely new mutation and
  -- uses a timestamp captured after all lock waits. A committed exact replay
  -- therefore remains observable even after the time/backfill boundary moves.
  v_now := clock_timestamp();
  if p_occurred_at > v_now + interval '5 minutes' then
    raise exception using
      errcode = '22023',
      message = 'attendance event cannot be more than five minutes in the future';
  end if;

  v_is_backfill := v_now - p_occurred_at > interval '15 minutes';
  if v_is_backfill then
    if v_reason is null then
      raise exception using
        errcode = '22023',
        message = 'a non-empty reason is required for attendance backfill';
    end if;
    if not (select private.has_permission(
      v_client.organization_id,
      v_client.branch_id,
      'attendance.correct'
    )) or not (select private.has_recent_aal2(15)) then
      raise exception using
        errcode = '42501',
        message = 'attendance backfill requires correction permission and recent AAL2';
    end if;
    v_source := 'staff_backfill';
  else
    v_source := 'staff';
  end if;

  if v_client.status <> 'active'
     or v_client.admitted_on is null
     or v_client.admitted_on > v_service_date
     or (v_client.ended_on is not null and v_client.ended_on < v_service_date) then
    raise exception using
      errcode = '23514',
      message = 'client is not active, admitted, and unended on the service date';
  end if;

  select attendance.*
    into v_attendance
  from public.attendance_records attendance
  where attendance.client_id = v_client.id
    and attendance.service_date = v_service_date
    and attendance.correction_of_id is null
    and attendance.status <> 'cancelled'
  for update;

  if p_event_kind = 'check_in' then
    if found then
      raise exception using
        errcode = '23514',
        message = 'duplicate attendance exists for the client and service date';
    end if;

    insert into public.attendance_records (
      organization_id,
      branch_id,
      client_id,
      service_date,
      status,
      checked_in_at,
      checked_out_at,
      source,
      correction_reason,
      idempotency_key,
      recorded_by
    ) values (
      v_client.organization_id,
      v_client.branch_id,
      v_client.id,
      v_service_date,
      'present',
      p_occurred_at,
      null,
      v_source,
      case when v_is_backfill then v_reason else null end,
      p_idempotency_key,
      v_actor
    )
    returning * into v_attendance;
  elsif p_event_kind = 'check_out' then
    if not found
       or v_attendance.status <> 'present'
       or v_attendance.checked_in_at is null
       or v_attendance.checked_out_at is not null then
      raise exception using
        errcode = '23514',
        message = 'check-out requires one open present attendance row';
    end if;
    if p_occurred_at < v_attendance.checked_in_at then
      raise exception using
        errcode = '23514',
        message = 'check-out cannot precede check-in';
    end if;

    update public.attendance_records attendance
    set
      checked_out_at = p_occurred_at,
      source = case
        when v_source = 'staff_backfill' then 'staff_backfill'
        else attendance.source
      end,
      correction_reason = coalesce(
        attendance.correction_reason,
        case when v_is_backfill then v_reason else null end
      )
    where attendance.id = v_attendance.id
      and attendance.checked_out_at is null
    returning * into v_attendance;

    if not found then
      raise exception using
        errcode = '40001',
        message = 'attendance check-out compare-and-swap failed';
    end if;
  else
    if found then
      raise exception using
        errcode = '23514',
        message = 'duplicate attendance exists for the client and service date';
    end if;

    insert into public.attendance_records (
      organization_id,
      branch_id,
      client_id,
      service_date,
      status,
      checked_in_at,
      checked_out_at,
      source,
      correction_reason,
      idempotency_key,
      recorded_by
    ) values (
      v_client.organization_id,
      v_client.branch_id,
      v_client.id,
      v_service_date,
      p_event_kind::public.attendance_status,
      null,
      null,
      v_source,
      case when v_is_backfill then v_reason else null end,
      p_idempotency_key,
      v_actor
    )
    returning * into v_attendance;
  end if;

  insert into private.attendance_operations (
    organization_id,
    branch_id,
    client_id,
    attendance_id,
    actor_user_id,
    event_kind,
    occurred_at,
    service_date,
    reason,
    source,
    idempotency_key,
    request_hash,
    result_status,
    result_checked_in_at,
    result_checked_out_at
  ) values (
    v_client.organization_id,
    v_client.branch_id,
    v_client.id,
    v_attendance.id,
    v_actor,
    p_event_kind,
    p_occurred_at,
    v_service_date,
    v_reason,
    v_source,
    p_idempotency_key,
    v_request_hash,
    v_attendance.status,
    v_attendance.checked_in_at,
    v_attendance.checked_out_at
  )
  returning * into v_operation;

  return query
  select
    v_operation.id,
    v_operation.attendance_id,
    v_operation.service_date,
    v_operation.result_status,
    v_operation.result_checked_in_at,
    v_operation.result_checked_out_at,
    v_operation.source,
    false;
end;
$$;

create or replace function private.record_vital_set_atomic(
  p_expected_organization_id uuid,
  p_expected_branch_id uuid,
  p_client_id uuid,
  p_measured_at timestamptz,
  p_idempotency_key uuid,
  p_systolic numeric default null,
  p_diastolic numeric default null,
  p_pulse numeric default null,
  p_temperature numeric default null,
  p_oxygen_saturation numeric default null
)
returns table(
  id uuid,
  measurement_kind text,
  replayed boolean
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_client public.clients%rowtype;
  v_expected_count integer;
  v_existing_count integer;
  v_request_hash text;
  v_now timestamptz;
begin
  if v_actor is null
     or p_expected_organization_id is null
     or p_expected_branch_id is null
     or p_client_id is null
     or p_measured_at is null
     or p_idempotency_key is null then
    raise exception using errcode = '22023', message = 'client, measurement time, and idempotency key are required';
  end if;

  if coalesce(auth.jwt() ->> 'aal', '') <> 'aal2'
     and not public.has_routine_care_access(p_expected_organization_id,p_expected_branch_id,'health.write') then
    raise exception using errcode = '42501', message = 'an AAL2 staff session is required';
  end if;

  if (p_systolic is null) <> (p_diastolic is null) then
    raise exception using errcode = '22023', message = 'systolic and diastolic pressure must be recorded together';
  end if;

  v_expected_count :=
    (case when p_systolic is null then 0 else 1 end)
    + (case when p_diastolic is null then 0 else 1 end)
    + (case when p_pulse is null then 0 else 1 end)
    + (case when p_temperature is null then 0 else 1 end)
    + (case when p_oxygen_saturation is null then 0 else 1 end);

  if v_expected_count = 0
     or (p_systolic is not null and (
       p_systolic::text in ('NaN', 'Infinity', '-Infinity')
       or p_systolic <> trunc(p_systolic)
     ))
     or (p_diastolic is not null and (
       p_diastolic::text in ('NaN', 'Infinity', '-Infinity')
       or p_diastolic <> trunc(p_diastolic)
     ))
     or (p_pulse is not null and (
       p_pulse::text in ('NaN', 'Infinity', '-Infinity')
       or p_pulse <> trunc(p_pulse)
     ))
     or (p_temperature is not null and (
       p_temperature::text in ('NaN', 'Infinity', '-Infinity')
       or p_temperature <> trunc(p_temperature, 1)
     ))
     or (p_oxygen_saturation is not null and (
       p_oxygen_saturation::text in ('NaN', 'Infinity', '-Infinity')
       or p_oxygen_saturation <> trunc(p_oxygen_saturation)
     ))
     or (p_systolic is not null and p_systolic not between 20 and 350)
     or (p_diastolic is not null and p_diastolic not between 10 and 250)
     or (p_pulse is not null and p_pulse not between 10 and 350)
     or (p_temperature is not null and p_temperature not between 20 and 50)
     or (p_oxygen_saturation is not null and p_oxygen_saturation not between 1 and 100) then
    raise exception using errcode = '22023', message = 'one or more vital-sign values are outside the technical input range';
  end if;

  select client.* into v_client
  from public.clients client
  where client.id = p_client_id
    and client.organization_id = p_expected_organization_id
    and client.branch_id = p_expected_branch_id
  -- Lifecycle transitions update this same row. FOR UPDATE (rather than KEY
  -- SHARE) prevents a concurrent close/death transition from committing after
  -- we read an active state but before the measurement rows are inserted.
  for update;

  if not found
     or not (select (private.can_staff_access_client(p_client_id, 'health.write')
       or private.can_routine_staff_access_client(p_client_id,'health.write'))) then
    raise exception using errcode = '42501', message = 'vital-sign recording is not permitted';
  end if;

  -- Serialize replays before looking for existing rows. The lock key contains
  -- no personal data and is stable only for this organization/actor/set.
  perform pg_advisory_xact_lock(
    hashtextextended(
      v_client.organization_id::text || ':' || v_actor::text || ':' || p_idempotency_key::text,
      0
    )
  );

  v_request_hash := encode(
    sha256(
      convert_to(
        jsonb_build_object(
          'schema_version', 1,
          'organization_id', p_expected_organization_id,
          'branch_id', p_expected_branch_id,
          'client_id', p_client_id,
          'measured_at', to_char(
            p_measured_at at time zone 'UTC',
            'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'
          ),
          'values', jsonb_strip_nulls(
            jsonb_build_object(
              'systolic', p_systolic::integer,
              'diastolic', p_diastolic::integer,
              'pulse', p_pulse::integer,
              'temperature', case
                when p_temperature is null then null
                else to_char(p_temperature, 'FM990.0')
              end,
              'oxygen_saturation', p_oxygen_saturation::integer
            )
          )
        )::text,
        'UTF8'
      )
    ),
    'hex'
  );

  select count(*)::integer into v_existing_count
  from public.measurements measurement
  where measurement.organization_id = v_client.organization_id
    and measurement.recorded_by = v_actor
    and measurement.measurement_set_id = p_idempotency_key;

  if v_existing_count > 0 then
    if v_existing_count <> v_expected_count
       or exists (
         select 1
         from public.measurements measurement
         where measurement.organization_id = v_client.organization_id
           and measurement.recorded_by = v_actor
           and measurement.measurement_set_id = p_idempotency_key
           and (
             measurement.client_id <> p_client_id
             or measurement.measured_at <> p_measured_at
             or measurement.request_hash is distinct from v_request_hash
           )
       ) then
      raise exception using errcode = '23505', message = 'vital-sign idempotency conflict';
    end if;

    return query
      select measurement.id, measurement.measurement_kind, true
      from public.measurements measurement
      where measurement.organization_id = v_client.organization_id
        and measurement.recorded_by = v_actor
        and measurement.measurement_set_id = p_idempotency_key
      order by measurement.measurement_kind;
    return;
  end if;

  -- Time and lifecycle gates apply only to a new mutation. An exact retry must
  -- remain observable after 24 hours or a later lifecycle transition, while
  -- still requiring the caller's current permission to this client. Capture
  -- one clock value after every possible lock wait so both bounds use the same
  -- decision instant.
  v_now := clock_timestamp();
  if p_measured_at < v_now - interval '24 hours'
     or p_measured_at > v_now + interval '5 minutes' then
    raise exception using errcode = '22023', message = 'measurement time is outside the allowed 24-hour window';
  end if;

  if v_client.status <> 'active'
     or v_client.admitted_on is null
     or v_client.ended_on is not null
     or (p_measured_at at time zone 'Asia/Taipei')::date < v_client.admitted_on then
    raise exception using errcode = '42501', message = 'vital-sign recording is not permitted';
  end if;

  return query
    with values_to_insert(measurement_kind, numeric_value, unit) as (
      values
        ('blood_pressure_systolic', p_systolic, 'mmHg'),
        ('blood_pressure_diastolic', p_diastolic, 'mmHg'),
        ('pulse', p_pulse, 'bpm'),
        ('temperature', p_temperature, '°C'),
        ('oxygen_saturation', p_oxygen_saturation, '%')
    ), inserted as (
      insert into public.measurements (
        organization_id,
        branch_id,
        client_id,
        measurement_kind,
        measured_at,
        numeric_value,
        unit,
        context,
        source,
        recorded_by,
        idempotency_key,
        measurement_set_id,
        request_hash
      )
      select
        v_client.organization_id,
        v_client.branch_id,
        v_client.id,
        input.measurement_kind,
        p_measured_at,
        input.numeric_value,
        input.unit,
        jsonb_build_object(
          '_request', jsonb_build_object(
            'schema_version', 1,
            'measurement_set_id', p_idempotency_key,
            'idempotency_hash', v_request_hash
          )
        ),
        'staff',
        v_actor,
        private.measurement_row_idempotency(
          v_client.organization_id,
          v_actor,
          p_idempotency_key,
          input.measurement_kind
        ),
        p_idempotency_key,
        v_request_hash
      from values_to_insert input
      where input.numeric_value is not null
      returning measurements.id, measurements.measurement_kind
    )
    select inserted.id, inserted.measurement_kind, false
    from inserted
    order by inserted.measurement_kind;
end;
$$;

create or replace function private.record_care_diary_draft_atomic(
  p_expected_organization_id uuid,
  p_expected_branch_id uuid,
  p_client_id uuid,
  p_occurred_at timestamptz,
  p_shift text,
  p_care_item text,
  p_note text,
  p_abnormal boolean,
  p_follow_up text,
  p_idempotency_key uuid
)
returns table(
  id uuid,
  version integer,
  status public.record_status,
  replayed boolean
)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_client public.clients%rowtype;
  v_existing public.care_records%rowtype;
  v_created public.care_records%rowtype;
  v_now timestamptz;
  v_care_item text := btrim(p_care_item);
  v_note text := btrim(coalesce(p_note, ''));
  v_follow_up text := nullif(btrim(p_follow_up), '');
  v_fields jsonb;
  v_request_hash text;
  v_data jsonb;
begin
  if v_actor is null
     or p_expected_organization_id is null
     or p_expected_branch_id is null
     or p_client_id is null
     or p_occurred_at is null
     or p_idempotency_key is null
     or p_shift is null
     or p_shift not in ('morning', 'afternoon', 'full_day')
     or p_care_item is null
     or octet_length(v_care_item) not between 1 and 480
     or octet_length(v_note) > 8000
     or p_abnormal is null
     or (v_follow_up is not null and octet_length(v_follow_up) > 4000) then
    raise exception using errcode = '22023', message = 'valid care diary draft fields are required';
  end if;

  if (coalesce(auth.jwt() ->> 'aal', '') <> 'aal2'
     or not (select private.has_permission(
       p_expected_organization_id,
       p_expected_branch_id,
       'care_records.write'
     ))) and not public.has_routine_care_access(p_expected_organization_id,p_expected_branch_id,'care_records.write') then
    raise exception using errcode = '42501', message = 'care diary draft is not permitted';
  end if;

  v_fields := jsonb_strip_nulls(jsonb_build_object(
    'shift', p_shift,
    'care_item', v_care_item,
    'note', v_note,
    'abnormal', p_abnormal,
    'follow_up', v_follow_up
  ));
  v_request_hash := encode(
    sha256(convert_to(jsonb_build_object(
      'schema_version', 1,
      'organization_id', p_expected_organization_id,
      'branch_id', p_expected_branch_id,
      'actor_user_id', v_actor,
      'client_id', p_client_id,
      'occurred_at', to_char(
        p_occurred_at at time zone 'UTC',
        'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'
      ),
      'category', 'staff/daily-care/care-diary',
      'fields', v_fields
    )::text, 'UTF8')),
    'hex'
  );
  v_data := jsonb_build_object(
    'fields', v_fields,
    '_request', jsonb_build_object(
      'schema_version', 1,
      'idempotency_hash', v_request_hash,
      'page_slug', 'staff/daily-care/care-diary'
    )
  );

  perform pg_advisory_xact_lock(hashtextextended(
    'care-diary:' || p_expected_organization_id::text || ':' ||
    v_actor::text || ':' || p_idempotency_key::text,
    0
  ));

  select record.* into v_existing
  from public.care_records record
  where record.organization_id = p_expected_organization_id
    and record.record_key = p_idempotency_key
    and record.version = 1
  for update;

  if found then
    if v_existing.branch_id <> p_expected_branch_id
       or v_existing.client_id <> p_client_id
       or v_existing.created_by <> v_actor
       or v_existing.category <> 'staff/daily-care/care-diary'
       or v_existing.status <> 'draft'
       or v_existing.occurred_at <> p_occurred_at
       or v_existing.data -> '_request' ->> 'idempotency_hash' is distinct from v_request_hash then
      raise exception using errcode = '23505', message = 'care diary idempotency conflict';
    end if;

    if not (select (private.can_staff_access_client(v_existing.client_id, 'care_records.write')
       or private.can_routine_staff_access_client(v_existing.client_id,'care_records.write'))) then
      raise exception using errcode = '42501', message = 'care diary replay is not permitted';
    end if;

    return query select v_existing.id, v_existing.version, v_existing.status, true;
    return;
  end if;

  select client.* into v_client
  from public.clients client
  where client.id = p_client_id
    and client.organization_id = p_expected_organization_id
    and client.branch_id = p_expected_branch_id
  for update;

  if not found
     or not (select (private.can_staff_access_client(p_client_id, 'care_records.write')
       or private.can_routine_staff_access_client(p_client_id,'care_records.write'))) then
    raise exception using errcode = '42501', message = 'care diary draft is not permitted';
  end if;

  v_now := clock_timestamp();
  if p_occurred_at < v_now - interval '24 hours'
     or p_occurred_at > v_now + interval '5 minutes' then
    raise exception using errcode = '22023', message = 'care diary time is outside the allowed 24-hour draft window';
  end if;

  if v_client.status <> 'active'
     or v_client.admitted_on is null
     or v_client.admitted_on > (p_occurred_at at time zone 'Asia/Taipei')::date
     or (
       v_client.ended_on is not null
       and v_client.ended_on <= (p_occurred_at at time zone 'Asia/Taipei')::date
     ) then
    raise exception using errcode = '23514', message = 'care diary requires an active admitted client';
  end if;

  insert into public.care_records (
    organization_id,
    branch_id,
    client_id,
    record_key,
    version,
    category,
    status,
    occurred_at,
    data,
    source_system,
    created_by
  ) values (
    p_expected_organization_id,
    p_expected_branch_id,
    p_client_id,
    p_idempotency_key,
    1,
    'staff/daily-care/care-diary',
    'draft',
    p_occurred_at,
    v_data,
    'local',
    v_actor
  )
  returning * into v_created;

  return query select v_created.id, v_created.version, v_created.status, false;
end;
$$;

create or replace function private.care_diary_lifecycle_atomic(
 p_expected_organization_id uuid,p_expected_branch_id uuid,p_action text,
 p_record_id uuid,p_base_version integer,p_fields jsonb,p_reason text,p_idempotency_key uuid
) returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare v_actor uuid:=auth.uid(); v_previous public.care_records%rowtype;
 v_result public.care_records%rowtype; v_operation private.care_diary_operations%rowtype;
 v_permission text; v_hash text; v_status public.record_status; v_data jsonb;
 v_now timestamptz; v_challenge uuid; v_reason text; v_signed_at timestamptz; v_signed_by uuid;
 v_content_hash text; v_roles jsonb;
begin
 if v_actor is null or p_expected_organization_id is null or p_expected_branch_id is null
   or p_record_id is null or p_idempotency_key is null or p_base_version is null or p_base_version<1
   or p_action is null or p_action not in ('edit','submit','sign','correct','reopen') then
   raise exception using errcode='22023',message='invalid diary operation'; end if;
 v_permission:=case when p_action='sign' then 'care_records.sign' else 'care_records.write' end;
 if (coalesce(auth.jwt()->>'aal','')<>'aal2' or not private.has_permission(p_expected_organization_id,p_expected_branch_id,v_permission)
   or not private.has_permission(p_expected_organization_id,p_expected_branch_id,'care_records.read'))
   and not (p_action in ('edit','submit')
    and public.has_routine_care_access(p_expected_organization_id,p_expected_branch_id,'care_records.write')
    and private.has_routine_staff_permission(p_expected_organization_id,p_expected_branch_id,'care_records.read')) then
   raise exception using errcode='42501',message='diary operation is not permitted'; end if;
 select * into v_previous from public.care_records r where r.id=p_record_id
  and r.organization_id=p_expected_organization_id and r.branch_id=p_expected_branch_id
  and r.category='staff/daily-care/care-diary';
 if not found or not (
   (private.can_staff_access_client(v_previous.client_id,v_permission)
    and private.can_staff_access_client(v_previous.client_id,'care_records.read'))
   or (p_action in ('edit','submit')
    and private.can_routine_staff_access_client(v_previous.client_id,'care_records.write')
    and private.can_routine_staff_access_client(v_previous.client_id,'care_records.read'))) then
  raise exception using errcode='42501',message='diary operation is not permitted'; end if;
 if p_action='edit' and not private.care_diary_fields_valid(p_fields) then
  raise exception using errcode='22023',message='invalid diary fields'; end if;
 if p_action<>'edit' and p_fields is not null then raise exception using errcode='22023',message='unexpected diary fields'; end if;
 if p_action in ('correct','reopen') and (p_reason is null or char_length(btrim(p_reason)) not between 1 and 1000) then
  raise exception using errcode='22023',message='correction reason is required'; end if;
 v_hash:=encode(sha256(convert_to(jsonb_build_object('action',p_action,'id',p_record_id,'base_version',p_base_version,
  'fields',p_fields,'reason',p_reason,'branch',p_expected_branch_id)::text,'UTF8')),'hex');
 perform pg_advisory_xact_lock(hashtextextended('diary-op:'||p_expected_organization_id||':'||v_actor||':'||p_idempotency_key,0));
 select * into v_operation from private.care_diary_operations o where o.organization_id=p_expected_organization_id
  and o.actor_user_id=v_actor and o.idempotency_key=p_idempotency_key;
 if found then
  if v_operation.request_hash<>v_hash or v_operation.branch_id<>p_expected_branch_id then
    raise exception using errcode='23505',message='diary idempotency conflict'; end if;
  select * into strict v_result from public.care_records where id=v_operation.result_id;
  return jsonb_build_object('record',private.care_diary_record_json(v_result),'replayed',true);
 end if;
 perform pg_advisory_xact_lock(hashtextextended('diary-record:'||v_previous.organization_id||':'||v_previous.record_key,0));
 if v_previous.version<>p_base_version or exists(select 1 from public.care_records r
   where r.organization_id=v_previous.organization_id and r.record_key=v_previous.record_key and r.version>p_base_version) then
   raise exception using errcode='40001',message='diary version conflict'; end if;
 if (p_action='edit' and v_previous.status<>'draft') or (p_action='submit' and v_previous.status<>'draft')
   or (p_action='sign' and v_previous.status<>'submitted') or (p_action='correct' and v_previous.status not in ('signed','corrected'))
   or (p_action='reopen' and v_previous.status<>'submitted') then
   raise exception using errcode='23514',message='diary transition is not permitted'; end if;
 v_now:=clock_timestamp();
 if p_action='edit' then v_data:=jsonb_build_object('fields',p_fields); v_status:='draft'; v_reason:='草稿修訂';
 elsif p_action='correct' then
   -- This is a correction to the SAME event, not a new observation. Keep content
   -- for explicit review, clear signatures and retain the signed source link.
   v_data:=jsonb_build_object('fields',v_previous.data->'fields','correction_source_id',v_previous.id);
   v_status:='draft'; v_reason:=btrim(p_reason);
 elsif p_action='reopen' then
   v_data:=v_previous.data-'_request'; v_status:='draft'; v_reason:=btrim(p_reason);
 else
   v_data:=v_previous.data-'_request';
   if not private.care_diary_fields_valid(v_data->'fields') or
      (coalesce(btrim(v_data->'fields'->>'note'),'')='' and not exists(select 1
        from jsonb_each(coalesce(v_data->'fields'->'observations','{}'::jsonb)) observed where observed.value->>'state'='observed')) or
      ((v_data->'fields'->>'abnormal')::boolean and coalesce(btrim(v_data->'fields'->>'follow_up'),'')='') or
      (v_data->'fields'->'observations'->'toileting'->>'state'='observed'
       and v_data->'fields'->'observations'->'toileting'->>'value'='concern'
       and (coalesce(btrim(v_data->'fields'->>'note'),'')=''
         or coalesce(btrim(v_data->'fields'->>'follow_up'),'')=''
         or v_data->'fields'->'abnormal' is distinct from 'true'::jsonb)) then
     raise exception using errcode='23514',message='diary completion fields are missing'; end if;
   v_status:=case when p_action='submit' then 'submitted'::public.record_status
     when v_data?'correction_source_id' then 'corrected'::public.record_status else 'signed'::public.record_status end;
   v_reason:=case when p_action='submit' then '提交確認' else '本人確認簽署' end;
 end if;
 if p_action='edit' and v_previous.data?'correction_source_id' then v_data:=v_data||jsonb_build_object('correction_source_id',v_previous.data->'correction_source_id'); end if;
 if p_action='sign' then
  v_challenge:=private.require_case_service_record_reauth(v_actor,v_now);
  select coalesce(jsonb_agg(distinct role.role_key),'[]'::jsonb) into v_roles
   from public.memberships membership join public.membership_roles assigned on assigned.membership_id=membership.id
   join public.roles role on role.id=assigned.role_id where membership.profile_id=v_actor
   and membership.organization_id=p_expected_organization_id and membership.status='active'
   and membership.starts_at<=v_now and (membership.ends_at is null or membership.ends_at>v_now)
   and (membership.branch_id is null or membership.branch_id=p_expected_branch_id)
   and role.is_active and assigned.assigned_at<=v_now
   and (role.organization_id is null or role.organization_id=p_expected_organization_id);
  v_data:=v_data||jsonb_build_object('signature_evidence',jsonb_build_object('challenge_id',v_challenge,
    'aal','aal2','verified',true,'roles',v_roles,'purpose','本人確認本次照顧觀察與處置'));
  v_signed_at:=v_now; v_signed_by:=v_actor;
  v_content_hash:=encode(sha256(convert_to(jsonb_build_object('client_id',v_previous.client_id,
    'occurred_at',v_previous.occurred_at,'version',v_previous.version+1,'data',v_data)::text,'UTF8')),'hex');
 end if;
 insert into public.care_records(organization_id,branch_id,client_id,record_key,version,previous_version_id,
  category,status,occurred_at,data,source_system,created_by,correction_reason,signed_at,signed_by,signature_purpose,content_hash)
 values(v_previous.organization_id,v_previous.branch_id,v_previous.client_id,v_previous.record_key,v_previous.version+1,v_previous.id,
  v_previous.category,v_status,v_previous.occurred_at,v_data,'local',v_actor,v_reason,v_signed_at,v_signed_by,
  case when p_action='sign' then '本人確認本次照顧觀察與處置' end,v_content_hash) returning * into v_result;
 insert into private.care_diary_operations(organization_id,branch_id,actor_user_id,idempotency_key,request_hash,result_id)
 values(p_expected_organization_id,p_expected_branch_id,v_actor,p_idempotency_key,v_hash,v_result.id);
 return jsonb_build_object('record',private.care_diary_record_json(v_result),'replayed',false);
end; $$;

create or replace function private.care_diary_snapshot(p_expected_organization_id uuid,p_expected_branch_id uuid,p_client_id uuid)
returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare v_records jsonb; v_history jsonb;
begin
 if auth.uid() is null or not (private.has_permission(p_expected_organization_id,p_expected_branch_id,'care_records.read')
  or private.has_routine_staff_permission(p_expected_organization_id,p_expected_branch_id,'care_records.read'))
  or not (private.can_staff_access_client(p_client_id,'care_records.read')
  or private.can_routine_staff_access_client(p_client_id,'care_records.read')) or not exists(select 1 from public.clients
   where id=p_client_id and organization_id=p_expected_organization_id and branch_id=p_expected_branch_id) then
   raise exception using errcode='42501',message='diary read is not permitted'; end if;
 select coalesce(jsonb_agg(private.care_diary_record_json(r) order by r.occurred_at desc,r.version desc),'[]'::jsonb) into v_records
 from public.care_records r where r.organization_id=p_expected_organization_id and r.branch_id=p_expected_branch_id
  and r.client_id=p_client_id and r.category='staff/daily-care/care-diary'
  and not exists(select 1 from public.care_records n where n.organization_id=r.organization_id and n.record_key=r.record_key and n.version>r.version);
 select coalesce(jsonb_agg(jsonb_build_object('id',r.id,'record_key',r.record_key,'version',r.version,'status',r.status,
  'previous_version_id',r.previous_version_id,'created_at',r.created_at,'correction_reason',r.correction_reason,
  'signed_at',r.signed_at,'signed_by',r.signed_by,'content_hash',r.content_hash) order by r.created_at,r.version),'[]'::jsonb) into v_history
 from public.care_records r where r.organization_id=p_expected_organization_id and r.branch_id=p_expected_branch_id
  and r.client_id=p_client_id and r.category='staff/daily-care/care-diary';
 insert into public.audit_events(organization_id,branch_id,actor_user_id,action,table_name,metadata)
 values(p_expected_organization_id,p_expected_branch_id,auth.uid(),'select','public.care_records',jsonb_build_object('operation','diary_lifecycle_snapshot'));
 return jsonb_build_object('records',v_records,'history',v_history);
end; $$;

create or replace function private.client_directory_snapshot(
  p_expected_organization_id uuid,
  p_expected_branch_id uuid,
  p_purpose public.client_directory_purpose,
  p_page_size integer default 200,
  p_after_client_code text default null,
  p_after_client_id uuid default null,
  p_exact_client_id uuid default null
)
returns table(
  client_id uuid,
  organization_id uuid,
  branch_id uuid,
  client_code text,
  display_name text,
  status public.client_status,
  admitted_on date,
  ended_on date,
  row_version bigint,
  updated_at timestamptz,
  visible_count bigint,
  has_more boolean
)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_required_permission text;
  v_result_count integer;
  v_reviewed_read_purpose boolean;
begin
  v_reviewed_read_purpose := p_purpose in (
    'case_center','core_daily','blood_glucose','client_registry',
    'client_lifecycle','care_plans','service_usage','medication_plan'
  );
  -- offline_sync remains the original AAL2/sync.use boundary.
  v_required_permission := case p_purpose
    when 'blood_glucose' then 'health.read'
    when 'care_plans' then 'care_plans.read'
    when 'service_usage' then 'services.read'
    when 'offline_sync' then 'sync.use'
    when 'medication_plan' then 'medications.read'
    else 'clients.read'
  end;

  if v_actor is null
     or p_expected_organization_id is null
     or p_expected_branch_id is null
     or p_purpose is null
     or p_page_size is null
     or p_page_size not between 1 and 200
     or ((p_after_client_code is null) <> (p_after_client_id is null))
     or (p_after_client_code is not null and (
       char_length(p_after_client_code) not between 1 and 64
       or p_after_client_code <> btrim(p_after_client_code)
       or p_after_client_code ~ '[[:cntrl:]]'
     ))
     or (p_exact_client_id is not null and p_after_client_id is not null)
     or not exists (
       select 1
       from public.branches branch
       where branch.id = p_expected_branch_id
         and branch.organization_id = p_expected_organization_id
         and branch.is_active
     )
     or not (select private.has_permission(
       p_expected_organization_id,
       p_expected_branch_id,
       'clients.read'
     ) or (v_reviewed_read_purpose and private.has_executive_read_permission(
       p_expected_organization_id,p_expected_branch_id,'clients.read'
     )) or (p_purpose in ('case_center','core_daily','blood_glucose','service_usage')
      and private.has_routine_staff_permission(p_expected_organization_id,p_expected_branch_id,'clients.read')))
     or not (select private.has_permission(
       p_expected_organization_id,
       p_expected_branch_id,
       v_required_permission
     ) or (v_reviewed_read_purpose and private.has_executive_read_permission(
       p_expected_organization_id,p_expected_branch_id,v_required_permission
     )) or (p_purpose in ('case_center','core_daily','blood_glucose','service_usage')
      and private.has_routine_staff_permission(p_expected_organization_id,p_expected_branch_id,v_required_permission))) then
    raise exception using
      errcode = '42501',
      message = 'client directory snapshot is not permitted in the selected tenant context';
  end if;

  return query
    with visible as materialized (
      select
        client.id,
        client.organization_id,
        client.branch_id,
        client.client_code,
        client.display_name,
        client.status,
        client.admitted_on,
        client.ended_on,
        client.row_version,
        client.updated_at
      from public.clients client
      where client.organization_id = p_expected_organization_id
        and client.branch_id = p_expected_branch_id
        and (p_exact_client_id is null or client.id = p_exact_client_id)
        and (select private.can_staff_access_client(client.id, 'clients.read')
          or (v_reviewed_read_purpose and private.can_executive_read_client(client.id,'clients.read'))
          or (p_purpose in ('case_center','core_daily','blood_glucose','service_usage')
            and private.can_routine_staff_access_client(client.id,'clients.read')))
    ),
    paged as materialized (
      select visible.*
      from visible
      where p_after_client_code is null
         or (visible.client_code, visible.id) >
            (p_after_client_code, p_after_client_id)
      order by visible.client_code, visible.id
      limit p_page_size + 1
    )
    select
      paged.id,
      paged.organization_id,
      paged.branch_id,
      paged.client_code,
      paged.display_name,
      paged.status,
      paged.admitted_on,
      paged.ended_on,
      paged.row_version,
      paged.updated_at,
      (select count(*)::bigint from visible),
      (select count(*) > p_page_size from paged)
    from paged
    order by paged.client_code, paged.id
    limit p_page_size;

  get diagnostics v_result_count = row_count;

  insert into public.audit_events (
    organization_id,
    branch_id,
    actor_user_id,
    action,
    table_name,
    row_pk,
    changed_fields,
    metadata
  ) values (
    p_expected_organization_id,
    p_expected_branch_id,
    v_actor,
    'select',
    'clients',
    null,
    '{}'::text[],
    jsonb_build_object(
      'projection', 'client_directory_minimal',
      'purpose', p_purpose,
      'result_count', v_result_count,
      'page_size', p_page_size,
      'has_cursor', p_after_client_id is not null,
      'exact_lookup', p_exact_client_id is not null
    )
  );
end;
$$;
-- Existing roster management stays privileged; new staff can read self rows only.
create or replace function private.care_roster_can_read(p_client uuid,p_permission text) returns boolean
language sql volatile security definer set search_path='' as $$
 select auth.uid() is not null and (private.can_staff_access_client(p_client,p_permission)
   or private.can_executive_read_client(p_client,p_permission)
   or private.can_routine_staff_access_client(p_client,p_permission));
$$;

create or replace function private.care_roster_snapshot_guarded(p_organization_id uuid,p_branch_id uuid,p_service_date date)
returns table(payload jsonb) language plpgsql volatile security definer set search_path='' as $$
declare v_manager boolean; v_rows jsonb:='[]'; v_staff jsonb:='[]'; v_r record; v_tasks jsonb;
 v_kind text; v_at timestamptz; v_from timestamptz; v_to timestamptz; v_access boolean;
begin
 if auth.uid() is null or p_service_date is null
 or not exists(select 1 from public.branches b where b.id=p_branch_id and b.organization_id=p_organization_id and b.is_active)
 or not (
   private.has_permission(p_organization_id,p_branch_id,'clients.read')
   or private.has_executive_read_permission(p_organization_id,p_branch_id,'clients.read')
   or private.has_routine_staff_permission(p_organization_id,p_branch_id,'clients.read')
 ) then raise exception using errcode='42501',message='daily allocation snapshot not permitted'; end if;
 v_manager:=private.care_roster_manager(p_organization_id,p_branch_id);
 for v_r in select r.*,p.display_name as staff_name from (
   select distinct on(client_id,shift) * from private.care_roster_versions
   where organization_id=p_organization_id and branch_id=p_branch_id and service_date=p_service_date
   order by client_id,shift,version desc
 ) r left join public.profiles p on p.id=r.staff_user_id
 where (v_manager or r.staff_user_id=auth.uid()) and private.care_roster_can_read(r.client_id,'clients.read')
 loop
  v_from:=(p_service_date::text||case when v_r.shift='morning' then ' 00:00:00' else ' 12:00:00' end)::timestamp at time zone 'Asia/Taipei';
  v_to:=v_from+interval '12 hours'; v_tasks:='[]';
  for v_kind in select jsonb_array_elements_text(v_r.tasks) loop
   v_at:=null;
   v_access:=private.care_roster_can_read(v_r.client_id,case when v_kind='care_diary' then 'care_records.read' else 'health.read' end);
   if v_access and v_kind='care_diary' then
    select max(c.occurred_at) into v_at from public.care_records c where c.organization_id=p_organization_id and c.branch_id=p_branch_id and c.client_id=v_r.client_id
     and c.category='staff/daily-care/care-diary' and c.status in ('signed','corrected') and c.signed_at is not null
     and c.occurred_at>=v_from and c.occurred_at<v_to
     and not exists(select 1 from public.care_records newer where newer.organization_id=c.organization_id and newer.record_key=c.record_key and newer.version>c.version);
   elsif v_access and v_kind='blood_pressure' then
    select max(m.measured_at) into v_at from public.measurements m where m.organization_id=p_organization_id and m.branch_id=p_branch_id and m.client_id=v_r.client_id
     and m.measurement_kind='blood_pressure_systolic' and m.measured_at>=v_from and m.measured_at<v_to and m.numeric_value is not null
     and exists(select 1 from public.measurements d where d.organization_id=m.organization_id and d.branch_id=m.branch_id and d.client_id=m.client_id
       and d.measured_at=m.measured_at and d.measurement_kind='blood_pressure_diastolic' and d.numeric_value is not null);
   elsif v_access then
    select max(m.measured_at) into v_at from public.measurements m where m.organization_id=p_organization_id and m.branch_id=p_branch_id and m.client_id=v_r.client_id
      and m.measurement_kind=v_kind and m.numeric_value is not null and m.measured_at>=v_from and m.measured_at<v_to;
   end if;
   v_tasks:=v_tasks||jsonb_build_array(jsonb_build_object('kind',v_kind,'status',case when not v_access then 'restricted' when v_at is null then 'pending' else 'recorded' end,'evidenceAt',v_at));
  end loop;
  v_rows:=v_rows||jsonb_build_array(jsonb_build_object('id',v_r.id,'clientId',v_r.client_id,'staffUserId',v_r.staff_user_id,'staffName',v_r.staff_name,
   'serviceDate',v_r.service_date,'shift',v_r.shift,'version',v_r.version,'state',v_r.state,'sourceNote',v_r.source_note,'tasks',v_tasks));
 end loop;
 if v_manager then
  select coalesce(jsonb_agg(jsonb_build_object('userId',p.id,'name',p.display_name) order by p.display_name),'[]') into v_staff
  from public.profiles p where p.is_active and p.kind='staff' and exists(select 1 from public.memberships m
    where m.profile_id=p.id and m.organization_id=p_organization_id and (m.branch_id is null or m.branch_id=p_branch_id)
      and m.status='active' and m.starts_at<=now() and (m.ends_at is null or m.ends_at>now()));
 end if;
 insert into public.audit_events(organization_id,branch_id,actor_user_id,action,table_name,row_pk,changed_fields,metadata)
 values(p_organization_id,p_branch_id,auth.uid(),'select','care_roster_snapshot',p_branch_id::text,array['bounded_snapshot'],jsonb_build_object('service_date',p_service_date,'row_count',jsonb_array_length(v_rows)));
 return query select jsonb_build_object('manager',v_manager,'assignments',v_rows,'staffOptions',v_staff);
end;
$$;
