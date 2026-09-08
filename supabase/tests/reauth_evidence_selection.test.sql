begin;

select plan(6);

select ok(
  (
    select count(*) = 1
      and bool_and(
        regexp_replace(lower(pg_get_functiondef(procedure.oid)), '\s+', ' ', 'g')
          like '%order by challenge.factor_verified_at desc, challenge.id desc limit 1%'
      )
    from pg_proc procedure
    join pg_namespace namespace on namespace.oid = procedure.pronamespace
    where namespace.nspname = 'private'
      and procedure.proname = 'require_medication_reauth_evidence'
  ),
  'medication administration selects the latest exact AAL2 evidence deterministically'
);

select ok(
  (
    select count(*) = 2
      and bool_and(
        regexp_replace(lower(pg_get_functiondef(procedure.oid)), '\s+', ' ', 'g')
          like '%order by challenge.factor_verified_at desc, challenge.id desc limit 1%'
      )
    from pg_proc procedure
    join pg_namespace namespace on namespace.oid = procedure.pronamespace
    where namespace.nspname = 'private'
      and procedure.proname in (
        'complete_service_event_atomic',
        'enqueue_staff_notification_atomic'
      )
  ),
  'service signing and notification queueing select the latest exact AAL2 evidence'
);

select ok(
  (
    select count(*) = 2
      and bool_and(
        regexp_replace(lower(pg_get_functiondef(procedure.oid)), '\s+', ' ', 'g')
          like '%order by challenge.factor_verified_at desc, challenge.id desc limit 1%'
      )
    from pg_proc procedure
    join pg_namespace namespace on namespace.oid = procedure.pronamespace
    where namespace.nspname = 'private'
      and procedure.proname in (
        'request_form_publication_atomic',
        'approve_form_publication_atomic'
      )
  ),
  'form publication request and approval select the latest exact AAL2 evidence'
);

select ok(
  (
    select count(*) = 2
      and bool_and(
        regexp_replace(lower(pg_get_functiondef(procedure.oid)), '\s+', ' ', 'g')
          like '%order by challenge.factor_verified_at desc, challenge.id desc limit 1%'
      )
    from pg_proc procedure
    join pg_namespace namespace on namespace.oid = procedure.pronamespace
    where namespace.nspname = 'private'
      and procedure.proname in (
        'request_role_governance_change_atomic',
        'approve_role_governance_change_atomic'
      )
  ),
  'role governance request and approval select the latest exact AAL2 evidence'
);

select ok(
  (
    select count(*) = 2
      and bool_and(
        regexp_replace(lower(pg_get_functiondef(procedure.oid)), '\s+', ' ', 'g')
          like '%order by challenge.factor_verified_at desc, challenge.id desc limit 1%'
      )
    from pg_proc procedure
    join pg_namespace namespace on namespace.oid = procedure.pronamespace
    where namespace.nspname = 'private'
      and procedure.proname in (
        'grant_family_consent_atomic',
        'revoke_family_consent_atomic'
      )
  ),
  'family consent grant and revocation select the latest exact AAL2 evidence'
);

select ok(
  (
    select count(*) = 3
      and bool_and(
        regexp_replace(lower(pg_get_functiondef(procedure.oid)), '\s+', ' ', 'g')
          like '%order by challenge.factor_verified_at desc, challenge.id desc limit 1%'
      )
    from pg_proc procedure
    join pg_namespace namespace on namespace.oid = procedure.pronamespace
    where namespace.nspname = 'private'
      and procedure.proname in (
        'current_client_master_reauth_challenge',
        'require_medication_plan_reauth_evidence',
        'current_client_tocc_reauth_challenge'
      )
  ),
  'client master, medication plan, and TOCC select the latest exact AAL2 evidence'
);

select * from finish();
rollback;
