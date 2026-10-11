begin;
set local lock_timeout = '5s';

-- Admission and recipient checks must independently reject inactive tenants.
-- Calling is_active_user here would recreate the family admission cycle.
do $patch$
declare
  body text;
  anchor text;
begin
  body := pg_get_functiondef('private.family_recipient_has_consent(uuid,uuid,uuid,uuid,text)'::regprocedure);
  anchor := 'and c.organization_id=p_org and c.branch_id=p_branch and c.client_id=p_client';
  if position(anchor in body) = 0 then
    raise exception 'Family recipient scope patch anchor missing';
  end if;
  body := replace(body, anchor, anchor || $predicate$
    and exists (
      select 1 from public.organizations tenant
      join public.branches branch on branch.organization_id=tenant.id
      join public.clients client on client.organization_id=tenant.id and client.branch_id=branch.id
      where tenant.id=p_org and tenant.is_active and branch.id=p_branch and branch.is_active
        and client.id=p_client
    )
  $predicate$);
  execute body;

  body := pg_get_functiondef('private.family_tenant_context(uuid,uuid)'::regprocedure);
  anchor := 'and p.kind=''family'' and p.is_active and m.status=''active''';
  if position(anchor in body) = 0 then
    raise exception 'Family context active scope patch anchor missing';
  end if;
  body := replace(body, anchor, anchor || ' and o.is_active and b.is_active');
  execute body;
end;
$patch$;

comment on function private.family_recipient_has_consent(uuid,uuid,uuid,uuid,text)
is 'Evidence-bound exact family recipient authorization, independently requiring an active organization and branch without recursive employee/family admission calls.';
commit;
