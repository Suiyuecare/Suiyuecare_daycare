-- Candidate only. This depends on 20261009102101 and must not ship until
-- the public pending-client status/parsers and all operational paths pass QA.
-- A pending person can accumulate assessment DRAFTS, not a signed, submitted,
-- approved, printed, or exported formal record.
begin;
set local lock_timeout = '5s';

create function private.assert_jubo_pending_private_client_boundary(
  p_organization_id uuid,
  p_branch_id uuid,
  p_client_id uuid,
  p_is_assessment_draft boolean
) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_status public.client_status;
begin
  if p_organization_id is null or p_branch_id is null or p_client_id is null
    or p_is_assessment_draft is null then
    raise exception using errcode = '42501',
      message = 'JUBO_PRIVATE_CLIENT_SCOPE_MISMATCH';
  end if;

  select client.status into v_status
    from public.clients client
   where client.id = p_client_id
     and client.organization_id = p_organization_id
     and client.branch_id = p_branch_id;
  if not found then
    raise exception using errcode = '42501',
      message = 'JUBO_PRIVATE_CLIENT_SCOPE_MISMATCH';
  end if;

  if v_status = 'pending' and not p_is_assessment_draft then
    raise exception using errcode = '23514',
      message = 'JUBO_PENDING_CLIENT_FORMAL_WORKFLOW_DENIED';
  end if;
end;
$$;

create function private.guard_jubo_pending_private_client_write() returns trigger
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_is_assessment_draft boolean;
begin
  if tg_op <> 'INSERT' or tg_nargs <> 1
    or tg_argv[0] not in ('draft', 'custom_response', 'formal') then
    raise exception using errcode = '42501',
      message = 'JUBO_PRIVATE_GATE_CONFIGURATION_INVALID';
  end if;

  v_is_assessment_draft := case tg_argv[0]
    when 'draft' then true
    when 'custom_response' then to_jsonb(new)->>'status' = 'draft'
    else false
  end;
  perform private.assert_jubo_pending_private_client_boundary(
    new.organization_id, new.branch_id, new.client_id, v_is_assessment_draft
  );
  return new;
end;
$$;

-- Before-insert triggers protect privileged writer functions and owner/direct
-- writes alike. The target tables are not exposed to anon/authenticated or
-- service_role; no new Data API grants are introduced.
create trigger jubo_pending_private_draft_gate
  before insert on private.custom_form_responses
  for each row execute function private.guard_jubo_pending_private_client_write('custom_response');
create trigger jubo_pending_private_draft_gate
  before insert on private.taipei_abcd_draft_versions
  for each row execute function private.guard_jubo_pending_private_client_write('draft');
create trigger jubo_pending_private_draft_gate
  before insert on private.taipei_abcd_draft_operations
  for each row execute function private.guard_jubo_pending_private_client_write('draft');

create trigger jubo_pending_private_formal_gate
  before insert on private.taipei_abcd_review_events
  for each row execute function private.guard_jubo_pending_private_client_write('formal');
create trigger jubo_pending_private_formal_gate
  before insert on private.taipei_abcd_export_snapshots
  for each row execute function private.guard_jubo_pending_private_client_write('formal');
create trigger jubo_pending_private_formal_gate
  before insert on private.custom_response_print_jobs
  for each row execute function private.guard_jubo_pending_private_client_write('formal');

revoke all on function private.assert_jubo_pending_private_client_boundary(uuid, uuid, uuid, boolean)
  from public, anon, authenticated, service_role;
revoke all on function private.guard_jubo_pending_private_client_write()
  from public, anon, authenticated, service_role;
comment on function private.assert_jubo_pending_private_client_boundary(uuid, uuid, uuid, boolean) is
  'Candidate-only private form boundary: pending permits draft storage, rejects formal output; exact org/branch/client scope required.';
commit;
