-- A disabled institution or branch cannot admit, alter, or replay a client
-- lifecycle operation. Keep the existing public contract, grants, AAL2 and
-- immutable transition ledger; this migration changes no business rows.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

do $migration$
declare
  v_source text;
  v_anchor text;
  v_replacement text;
begin
  select pg_get_functiondef(
    'private.transition_client_atomic(uuid,uuid,uuid,public.client_transition_kind,date,text,text,bigint,uuid)'::regprocedure
  ) into v_source;
  v_anchor := $anchor$     or p_expected_branch_id is null
     or not (select private.has_permission($anchor$;
  v_replacement := $replacement$     or p_expected_branch_id is null
     or not exists (
       select 1 from public.organizations organization
       join public.branches branch on branch.organization_id = organization.id
       where organization.id = p_expected_organization_id
         and branch.id = p_expected_branch_id
         and organization.is_active and branch.is_active
     )
     or not (select private.has_permission($replacement$;
  if (length(v_source) - length(replace(v_source, v_anchor, ''))) / length(v_anchor) <> 1 then
    raise exception 'Unexpected lifecycle RPC initial authorization baseline';
  end if;
  v_source := replace(v_source, v_anchor, v_replacement);

  v_anchor := $anchor$  if not found
     or not (select private.can_staff_access_client(p_client_id, 'clients.manage')) then$anchor$;
  v_replacement := $replacement$  -- The client lock can wait while a separate administrator disables the
  -- organization, branch, membership, or session. Use a fresh statement snapshot
  -- after acquiring it, before either the second replay lookup or an insert.
  if not found
     or not (select private.has_recent_aal2(15))
     or not (select private.has_permission(
       p_expected_organization_id, p_expected_branch_id, 'clients.manage'
     ))
     or not exists (
       select 1 from public.organizations organization
       join public.branches branch on branch.organization_id = organization.id
       where organization.id = p_expected_organization_id
         and branch.id = p_expected_branch_id
         and organization.is_active and branch.is_active
     )
     or not (select private.can_staff_access_client(p_client_id, 'clients.manage')) then$replacement$;
  if (length(v_source) - length(replace(v_source, v_anchor, ''))) / length(v_anchor) <> 1 then
    raise exception 'Unexpected lifecycle RPC post-lock authorization baseline';
  end if;
  v_source := replace(v_source, v_anchor, v_replacement);
  execute v_source;

  select pg_get_functiondef('private.validate_client_transition()'::regprocedure) into v_source;
  v_anchor := $anchor$  if not found
     or not (select private.can_staff_access_client(new.client_id, 'clients.manage')) then$anchor$;
  v_replacement := $replacement$  -- Defense in depth for every ledger insert, including trusted internal
  -- callers: the trigger also rechecks live scope and AAL2 after its client lock.
  if not found
     or not (select private.has_recent_aal2(15))
     or not exists (
       select 1 from public.organizations organization
       join public.branches branch on branch.organization_id = organization.id
       where organization.id = v_client.organization_id
         and branch.id = v_client.branch_id
         and organization.is_active and branch.is_active
     )
     or not (select private.can_staff_access_client(new.client_id, 'clients.manage')) then$replacement$;
  if (length(v_source) - length(replace(v_source, v_anchor, ''))) / length(v_anchor) <> 1 then
    raise exception 'Unexpected lifecycle trigger post-lock authorization baseline';
  end if;
  v_source := replace(v_source, v_anchor, v_replacement);
  execute v_source;
end;
$migration$;

-- CREATE OR REPLACE preserves existing function ownership and execute grants.
-- No new public endpoint, permission exception, grant, or mutable ledger path.
commit;
