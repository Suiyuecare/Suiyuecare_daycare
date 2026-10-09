-- Recover an uncertain director draft by the exact, immutable original operation.
-- Reading the latest form revision cannot prove an earlier write once a second
-- director has appended another revision. This RPC never creates a draft.
begin;
set local lock_timeout = '5s';

create function private.jubo_pending_director_exact_receipt(
  p_org uuid, p_branch uuid, p_client uuid, p_idempotency_key uuid
) returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare v_row private.jubo_pending_director_draft_revisions%rowtype;
  v_found boolean;
begin
  if auth.uid() is null or p_org is null or p_branch is null or p_client is null
    or p_idempotency_key is null or not exists(
      select 1 from private.routine_staff_scope() scope
      join public.roles role on role.id = scope.role_id and role.is_system
        and role.role_key = 'branch_director' and role.is_active
      join public.branches branch on branch.id = p_branch
        and branch.organization_id = p_org and branch.is_active
      join public.organizations organization on organization.id = p_org
        and organization.is_active
      where scope.organization_id = p_org and scope.branch_id = p_branch
        and not exists (
          select 1 from (values ('clients.read'), ('clients.view_all'),
            ('clients.intake_draft.manage'), ('clients.jubo_pending_source.read')) needed(permission_key)
          where not exists (
            select 1 from public.role_permissions rp
            join public.permissions permission on permission.id = rp.permission_id
            where rp.role_id = role.id and rp.granted_at <= clock_timestamp()
              and permission.permission_key = needed.permission_key
          )
        )
    ) then
    raise exception using errcode = '42501', message = 'JUBO_PENDING_DRAFT_ACCESS_DENIED';
  end if;

  -- The actor/tenant/branch/client/key equality is essential: a director may
  -- only resolve their own already-submitted operation, including if a newer
  -- revision was appended or the client subsequently left pending intake.
  select * into v_row from private.jubo_pending_director_draft_revisions row
  where row.actor_user_id = auth.uid() and row.organization_id = p_org
    and row.branch_id = p_branch and row.client_id = p_client
    and row.idempotency_key = p_idempotency_key;
  v_found := found;

  insert into public.audit_events(organization_id, branch_id, actor_user_id,
    action, table_name, row_pk, changed_fields, metadata)
  values (p_org, p_branch, auth.uid(), 'select',
    'private.jubo_pending_director_draft_revisions',
    case when v_found then v_row.id::text else p_client::text end,
    '{}'::text[], jsonb_build_object('projection', 'pending_director_exact_receipt_v1',
      'found', v_found));

  if not v_found then return jsonb_build_object('found', false); end if;
  return jsonb_build_object('found', true, 'clientId', v_row.client_id,
    'expectedRevision', v_row.revision - 1, 'payload', v_row.payload,
    'receipt', jsonb_build_object('draftId', v_row.id, 'revision', v_row.revision,
      'kind', v_row.draft_kind, 'formKey', v_row.form_key,
      'replayed', true, 'formalRecord', false));
end;
$$;

create function public.jubo_pending_director_exact_receipt(
  p_org uuid, p_branch uuid, p_client uuid, p_idempotency_key uuid
) returns jsonb language sql volatile security invoker set search_path = '' as $$
  select private.jubo_pending_director_exact_receipt(
    p_org, p_branch, p_client, p_idempotency_key);
$$;

revoke all on function private.jubo_pending_director_exact_receipt(uuid, uuid, uuid, uuid),
  public.jubo_pending_director_exact_receipt(uuid, uuid, uuid, uuid)
from public, anon, authenticated, service_role;
grant execute on function private.jubo_pending_director_exact_receipt(uuid, uuid, uuid, uuid),
  public.jubo_pending_director_exact_receipt(uuid, uuid, uuid, uuid)
to authenticated;

commit;
