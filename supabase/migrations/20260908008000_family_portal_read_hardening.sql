-- Family portal read hardening.
--
-- Legacy consent rows remain immutable migration evidence, but they are not
-- evidence-bound grants and must never authorize a family read. Every family
-- read predicate below requires an exact version-1 grant whose one-time proof
-- was consumed by the grant actor for that exact consent. Wildcard scopes are
-- intentionally not recognized.

create or replace function private.has_current_governed_family_consent(
  p_client_id uuid,
  p_consent_scope text
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    p_client_id is not null
    and p_consent_scope = any(array[
      'client.read',
      'care.read',
      'health.summary',
      'schedule.read',
      'billing.read',
      'documents.read',
      'messages.read'
    ]::text[])
    and (select private.is_family_user())
    and exists (
      select 1
      from public.consents consent
      join private.family_consent_verification_evidence evidence
        on evidence.id = consent.verification_evidence_id
       and evidence.organization_id = consent.organization_id
       and evidence.branch_id = consent.branch_id
       and evidence.client_id = consent.client_id
       and evidence.recipient_user_id = consent.recipient_user_id
       and evidence.relationship = consent.relationship
       and evidence.scopes = consent.scopes
       and evidence.document_version = consent.document_version
       and evidence.consent_expires_at is not distinct from consent.expires_at
       and evidence.evidence_hash = consent.evidence_hash
       and evidence.consumed_consent_id = consent.id
       and evidence.consumed_by = consent.created_by
       and evidence.consumed_at is not null
       and evidence.consumed_at >= evidence.verified_at
       and evidence.consumed_at <= evidence.expires_at
      join private.reauth_challenges challenge
        on challenge.id = consent.grant_reauth_challenge_id
       and challenge.user_id = consent.created_by
       and challenge.consumed_at is not null
       and challenge.factor_verified_at is not null
       and challenge.factor_method in ('totp', 'webauthn', 'phone')
      where consent.client_id = p_client_id
        and consent.recipient_user_id = (select auth.uid())
        and consent.workflow_version = 1
        and consent.consented_at <= statement_timestamp()
        and (consent.expires_at is null or consent.expires_at > statement_timestamp())
        and consent.revoked_at is null
        and p_consent_scope = any(consent.scopes)
        and not ('*' = any(consent.scopes))
    );
$$;

comment on function private.has_current_governed_family_consent(uuid, text) is
  'Checks one exact current evidence-bound family consent scope; legacy and wildcard grants never authorize reads.';

create or replace function private.can_read_client(
  p_client_id uuid,
  p_staff_permission_key text,
  p_consent_scope text
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    (select auth.uid()) is not null
    and (
      (select private.can_staff_access_client(
        p_client_id,
        p_staff_permission_key
      ))
      or (select private.has_current_governed_family_consent(
        p_client_id,
        p_consent_scope
      ))
    );
$$;

create or replace function private.family_client_summaries()
returns table(
  client_id uuid,
  branch_id uuid,
  display_name text,
  client_status public.client_status,
  admitted_on date,
  updated_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    client.id,
    client.branch_id,
    client.display_name,
    client.status,
    client.admitted_on,
    client.updated_at
  from public.clients client
  where (select private.has_current_governed_family_consent(
    client.id,
    'client.read'
  ));
$$;

-- No family-visible care publication table/version exists yet. A signed care
-- record is an internal clinical finalization state, not evidence that the
-- institution approved it for family disclosure. Returning zero rows keeps
-- Page 84/86 fail closed, including when an older signed version has since
-- been corrected or voided. A later dedicated publication migration must
-- replace this function with a bounded terminal-version projection.
create or replace function private.family_care_summaries(p_client_id uuid)
returns table(
  record_id uuid,
  category text,
  occurred_at timestamptz,
  effective_from timestamptz,
  effective_to timestamptz,
  signed_at timestamptz,
  updated_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    record.id,
    record.category,
    record.occurred_at,
    record.effective_from,
    record.effective_to,
    record.signed_at,
    record.updated_at
  from public.care_records record
  where record.client_id = p_client_id
    and (select private.has_current_governed_family_consent(
      record.client_id,
      'care.read'
    ))
    and false;
$$;

comment on function private.family_care_summaries(uuid) is
  'Fail-closed family care metadata boundary until an explicit institution-approved publication model exists.';

revoke all on function private.has_current_governed_family_consent(uuid, text)
  from public, anon, authenticated, service_role;
revoke all on function private.can_read_client(uuid, text, text)
  from public, anon, authenticated, service_role;
revoke all on function private.family_client_summaries()
  from public, anon, authenticated, service_role;
revoke all on function private.family_care_summaries(uuid)
  from public, anon, authenticated, service_role;

-- Existing RLS policies and public SECURITY INVOKER wrappers call these
-- private boundaries as authenticated. The new primitive itself remains
-- private to the definer functions so callers cannot use it as an oracle.
grant execute on function private.can_read_client(uuid, text, text)
  to authenticated;
grant execute on function private.family_client_summaries()
  to authenticated;
grant execute on function private.family_care_summaries(uuid)
  to authenticated;

