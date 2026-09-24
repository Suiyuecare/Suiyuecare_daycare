-- Approved Google login may read the reviewed tenant/dashboard projections at
-- AAL1. This is NOT an AAL2 substitute: no existing write, export, signing,
-- reauthentication, clinical-authority or dual-review helper is replaced.
-- Every new policy is SELECT-only on this explicit twelve-table allowlist.

create function private.executive_reader_scope()
returns table(membership_id uuid, organization_id uuid, branch_id uuid, role_id uuid)
language plpgsql volatile security definer set search_path = '' as $$
begin
  -- Verify the real session once before touching scope or casting auth.uid().
  if private.is_executive_login_allowed() is not true then return; end if;
  return query select m.id, m.organization_id, m.branch_id, r.id
  from public.profiles p
  join public.memberships m on m.profile_id=p.id
  join public.organizations o on o.id=m.organization_id and o.is_active
  join public.membership_roles mr on mr.membership_id=m.id
  join public.roles r on r.id=mr.role_id and r.is_active
  where
    -- Independent owner-pinned principal check also keeps legacy local test
    -- admission stubs from activating this new read policy for other staff.
    (select count(*) from private.executive_access_policy)=1
    and exists(select 1 from private.executive_access_policy policy
      where policy.id and policy.enabled and policy.allowed_user_id=auth.uid()
        and policy.approved_at<=clock_timestamp())
    and p.id=auth.uid() and p.is_active
    and p.kind in ('staff','professional','driver','finance')
    and m.status='active' and m.starts_at<=clock_timestamp()
    and (m.ends_at is null or m.ends_at>clock_timestamp())
    and mr.assigned_at<=clock_timestamp()
    and r.role_key not in ('family','platform_ops')
    and (r.organization_id is null or r.organization_id=m.organization_id)
    and exists(select 1 from public.branches b where b.organization_id=m.organization_id
      and b.is_active and (m.branch_id is null or b.id=m.branch_id));
end;
$$;

create function private.is_active_executive_reader()
returns boolean language sql volatile security definer set search_path = '' as $$
  select exists(select 1 from private.executive_reader_scope());
$$;

create function private.has_executive_read_permission(p_organization_id uuid, p_branch_id uuid, p_permission_key text)
returns boolean language sql volatile security definer set search_path = '' as $$
  select coalesce(p_permission_key in (
    'clients.read','clients.view_all','attendance.read','health.read',
    'care_records.read','services.read','care_plans.read','medications.read'
  ) and exists (
    select 1 from private.executive_reader_scope() scope
    join public.role_permissions rp on rp.role_id=scope.role_id
    join public.permissions permission on permission.id=rp.permission_id
    where scope.organization_id=p_organization_id
      and rp.granted_at<=clock_timestamp() and permission.permission_key=p_permission_key
      and ((p_branch_id is null and scope.branch_id is null)
        or (p_branch_id is not null and (scope.branch_id is null or scope.branch_id=p_branch_id)
          and exists(select 1 from public.branches b where b.id=p_branch_id
            and b.organization_id=p_organization_id and b.is_active)))
  ),false);
$$;

create function private.can_executive_read_client(p_client_id uuid, p_permission_key text)
returns boolean language sql volatile security definer set search_path = '' as $$
  select exists(select 1 from public.clients c where c.id=p_client_id
    and private.has_executive_read_permission(c.organization_id,c.branch_id,p_permission_key)
    and (private.has_executive_read_permission(c.organization_id,c.branch_id,'clients.view_all')
      or exists(select 1 from public.client_assignments a
        where a.client_id=c.id and a.organization_id=c.organization_id and a.branch_id=c.branch_id
          and a.assignee_user_id=auth.uid() and a.starts_at<=clock_timestamp()
          and (a.ends_at is null or a.ends_at>clock_timestamp()))));
$$;

alter function private.executive_reader_scope() owner to postgres;
alter function private.is_active_executive_reader() owner to postgres;
alter function private.has_executive_read_permission(uuid,uuid,text) owner to postgres;
alter function private.can_executive_read_client(uuid,text) owner to postgres;
revoke all on function private.executive_reader_scope() from public,anon,authenticated,service_role;
revoke all on function private.is_active_executive_reader() from public,anon,authenticated,service_role;
revoke all on function private.has_executive_read_permission(uuid,uuid,text) from public,anon,authenticated,service_role;
revoke all on function private.can_executive_read_client(uuid,text) from public,anon,authenticated,service_role;
grant execute on function private.executive_reader_scope() to authenticated;
grant execute on function private.is_active_executive_reader() to authenticated;
grant execute on function private.has_executive_read_permission(uuid,uuid,text) to authenticated;
grant execute on function private.can_executive_read_client(uuid,text) to authenticated;

-- Self-context only. Do not grant raw clients, auth metadata, allowlist,
-- attachments, demographic fields, other users' memberships or profiles.
create policy executive_reader_organizations_select on public.organizations for select to authenticated
using (is_active and exists(select 1 from private.executive_reader_scope() s where s.organization_id=id));
create policy executive_reader_branches_select on public.branches for select to authenticated
using (is_active and exists(select 1 from private.executive_reader_scope() s
  where s.organization_id=branches.organization_id and (s.branch_id is null or s.branch_id=branches.id)));
create policy executive_reader_profiles_select on public.profiles for select to authenticated
using (id=(select auth.uid()) and (select private.is_active_executive_reader()));
create policy executive_reader_memberships_select on public.memberships for select to authenticated
using (exists(select 1 from private.executive_reader_scope() s where s.membership_id=id));
create policy executive_reader_membership_roles_select on public.membership_roles for select to authenticated
using (exists(select 1 from private.executive_reader_scope() s
  where s.membership_id=membership_roles.membership_id and s.role_id=membership_roles.role_id));
create policy executive_reader_roles_select on public.roles for select to authenticated
using (exists(select 1 from private.executive_reader_scope() s where s.role_id=id));
create policy executive_reader_role_permissions_select on public.role_permissions for select to authenticated
using (granted_at<=clock_timestamp() and exists(select 1 from private.executive_reader_scope() s where s.role_id=role_permissions.role_id));
create policy executive_reader_permissions_select on public.permissions for select to authenticated
using (exists(select 1 from private.executive_reader_scope() s
  join public.role_permissions rp on rp.role_id=s.role_id
  where rp.permission_id=permissions.id and rp.granted_at<=clock_timestamp()));

-- Dashboard source rows retain their existing per-source permission and
-- assignment scope. New SELECT policy does not satisfy an INSERT/UPDATE policy.
create policy executive_reader_attendance_select on public.attendance_records for select to authenticated
using ((select private.can_executive_read_client(client_id,'attendance.read')));
create policy executive_reader_measurements_select on public.measurements for select to authenticated
using ((select private.can_executive_read_client(client_id,'health.read')));
create policy executive_reader_care_records_select on public.care_records for select to authenticated
using ((select private.can_executive_read_client(client_id,'care_records.read')));
create policy executive_reader_service_events_select on public.service_events for select to authenticated
using ((select private.can_executive_read_client(client_id,'services.read')));

-- Preserve the current-user view contract and RLS-invoker/barrier semantics.
-- Existing AAL2 users keep their original path. Additional AAL1 rows can only
-- originate from the effective self-role scope above.
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
  and ((select private.is_active_user()) or (select private.is_active_executive_reader()))
  and p.is_active and m.status='active' and m.starts_at<=now()
  and (m.ends_at is null or m.ends_at>now())
group by m.id,m.organization_id,m.branch_id,p.display_name,m.profile_id;

comment on function private.is_active_executive_reader() is
  'Approved pinned executive with an active self role scope. Read admission only; does not confer AAL2 or authorize writes.';
comment on function private.has_executive_read_permission(uuid,uuid,text) is
  'Explicit read-key allowlist for reviewed dashboard and minimal-client projections only; never use as write/export authority.';

-- Keep the existing pagination, field minimization, scope and audit contract.
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
     )))
     or not (select private.has_permission(
       p_expected_organization_id,
       p_expected_branch_id,
       v_required_permission
     ) or (v_reviewed_read_purpose and private.has_executive_read_permission(
       p_expected_organization_id,p_expected_branch_id,v_required_permission
     ))) then
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
          or (v_reviewed_read_purpose and private.can_executive_read_client(client.id,'clients.read')))
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
