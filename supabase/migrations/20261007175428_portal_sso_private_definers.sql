begin;

-- Keep the existing PostgREST RPC signatures, but move the privileged bodies
-- out of the exposed public schema. ALTER preserves their audited logic and
-- existing object dependencies without copying or weakening any checks.
alter function public.claim_portal_sso_ticket(text,text,text,timestamptz)
  set schema private;
alter function public.is_portal_sso_first_activation_pending(text,text)
  set schema private;
alter function public.bind_portal_sso_session(text,uuid)
  set schema private;

-- A function's default EXECUTE includes PUBLIC. Reapply the narrow ACL after
-- moving it, even though ALTER FUNCTION normally preserves existing grants.
revoke all on function private.claim_portal_sso_ticket(text,text,text,timestamptz)
  from public,anon,authenticated,service_role;
revoke all on function private.is_portal_sso_first_activation_pending(text,text)
  from public,anon,authenticated,service_role;
revoke all on function private.bind_portal_sso_session(text,uuid)
  from public,anon,authenticated,service_role;
grant execute on function private.claim_portal_sso_ticket(text,text,text,timestamptz)
  to service_role;
grant execute on function private.is_portal_sso_first_activation_pending(text,text)
  to service_role;
grant execute on function private.bind_portal_sso_session(text,uuid)
  to service_role;

-- PostgREST still resolves the exact RPC names and named arguments used by
-- the existing server admin.rpc calls. These invoker facades cannot elevate
-- anon/authenticated, and their private callees still validate the identity,
-- invitation, ticket and Auth session independently.
create function public.claim_portal_sso_ticket(
  p_jti_sha256 text,p_google_sub text,p_email text,p_expires_at timestamptz
) returns uuid language sql volatile security invoker set search_path='' as $$
  select private.claim_portal_sso_ticket(p_jti_sha256,p_google_sub,p_email,p_expires_at);
$$;
revoke all on function public.claim_portal_sso_ticket(text,text,text,timestamptz)
  from public,anon,authenticated,service_role;
grant execute on function public.claim_portal_sso_ticket(text,text,text,timestamptz)
  to service_role;

create function public.is_portal_sso_first_activation_pending(
  p_email text,p_google_sub text
) returns boolean language sql volatile security invoker set search_path='' as $$
  select private.is_portal_sso_first_activation_pending(p_email,p_google_sub);
$$;
revoke all on function public.is_portal_sso_first_activation_pending(text,text)
  from public,anon,authenticated,service_role;
grant execute on function public.is_portal_sso_first_activation_pending(text,text)
  to service_role;

create function public.bind_portal_sso_session(
  p_jti_sha256 text,p_session_id uuid
) returns boolean language sql volatile security invoker set search_path='' as $$
  select private.bind_portal_sso_session(p_jti_sha256,p_session_id);
$$;
revoke all on function public.bind_portal_sso_session(text,uuid)
  from public,anon,authenticated,service_role;
grant execute on function public.bind_portal_sso_session(text,uuid)
  to service_role;

comment on function public.claim_portal_sso_ticket(text,text,text,timestamptz) is
  'Service-role-only RPC facade for the private Portal SSO ticket claim.';
comment on function public.is_portal_sso_first_activation_pending(text,text) is
  'Service-role-only RPC facade for the private first-activation classifier.';
comment on function public.bind_portal_sso_session(text,uuid) is
  'Service-role-only RPC facade for the private Portal SSO session binding.';

-- The exposed RPC objects have new OIDs after the move. Refresh PostgREST's
-- function signatures and ACLs only after this transaction commits.
notify pgrst, 'reload schema';

commit;
