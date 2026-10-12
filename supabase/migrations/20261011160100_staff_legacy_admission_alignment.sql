begin;
set local lock_timeout='5s';
-- Replace obsolete executive-only *admission*, not role, tenant, assignment,
-- AAL or signing predicates. Each approved employee still needs its own live
-- native Google/portal session and the original operation-specific permissions.
do $align$ declare signature text; definition text; replacement text; begin
 foreach signature in array array[
  'private.nursing_authority(uuid,uuid,uuid,text)',
  'private.data_inventory_authorized(uuid,uuid)',
  'private.is_active_user()'
 ] loop
  definition:=pg_get_functiondef(signature::regprocedure);
  if position('case when private.is_executive_login_allowed() then' in definition)=0 then
   raise exception 'unexpected legacy admission definition: %',signature;
  end if;
  replacement:=case when signature='private.is_active_user()'
   then 'case when (public.is_staff_login_allowed() or public.is_family_login_allowed()) then'
   else 'case when public.is_staff_login_allowed() then' end;
  execute replace(definition,'case when private.is_executive_login_allowed() then',replacement);
 end loop;
 definition:=pg_get_functiondef('private.can_begin_staff_mfa()'::regprocedure);
 if position('private.is_executive_login_allowed() or private.has_any_custom_governance_scope()' in definition)=0 then
  raise exception 'unexpected MFA admission definition'; end if;
 execute replace(definition,
  'private.is_executive_login_allowed() or private.has_any_custom_governance_scope()',
  'public.is_staff_login_allowed() or private.has_any_custom_governance_scope()');
 definition:=pg_get_functiondef('private.require_candidate_assessment_draft_evidence(uuid,timestamptz)'::regprocedure);
 if position('and private.is_executive_login_allowed()' in definition)=0 then
  raise exception 'unexpected candidate draft admission definition'; end if;
 execute replace(definition,'and private.is_executive_login_allowed()',
  'and public.is_staff_login_allowed()');
end $align$;
comment on function private.require_candidate_assessment_draft_evidence(uuid,timestamptz) is
 'Unsigned candidate drafts only: exact approved native staff session may use AAL1; caller must separately check form/client scope. No signature, publication or clinical decision is authorized.';
commit;
