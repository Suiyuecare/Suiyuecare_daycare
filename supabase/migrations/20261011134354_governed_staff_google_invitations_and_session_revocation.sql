begin;
set local lock_timeout='5s';
-- Direct PostgREST RPC calls must pass the same database-owned admission as
-- the application, not merely present an email or a still-valid old JWT.
do $admission$ declare body text; begin
 body:=pg_get_functiondef('private.staff_management_current_authority(uuid,uuid,text)'::regprocedure);
 if position('select p_expected_organization_id is not null' in body)=0
   or position('case when private.is_executive_login_allowed() then' in body)=0 then
  raise exception 'unexpected staff authority definition';end if;
 body:=replace(body,'case when private.is_executive_login_allowed() then',
  'case when public.is_staff_login_allowed() then');
 body:=replace(body,'select p_expected_organization_id is not null',
  'select public.is_staff_login_allowed() and p_expected_organization_id is not null');
 execute body;
end $admission$;

-- Leave existing queued history immutable. New terminations synchronously
-- invalidate native sessions and refresh tokens before returning a receipt.
alter table private.staff_session_revocation_jobs drop constraint staff_session_revocation_job_status_check;
alter table private.staff_session_revocation_jobs add constraint staff_session_revocation_job_status_check check (
 (provider_status='not_configured' and delivery_status='queued' and verification_status='not_verified'
  and completed_at is null and failed_at is null and provider_receipt is null)
 or (provider_status='supabase_native' and delivery_status='completed' and verification_status='verified'
  and completed_at is not null and completed_at<=deadline_at and failed_at is null and provider_receipt is not null)
);
create function private.revoke_staff_native_sessions() returns trigger language plpgsql
security definer set search_path='' as $$
declare removed bigint;
begin
 if not private.staff_management_has_manage_authority(new.organization_id,new.branch_id,'termination',true)
   or not exists(select 1 from public.staff_management_proposals p join public.memberships m
    on m.id=p.target_membership_id and m.profile_id=p.target_profile_id
    where p.id=new.source_proposal_id and p.organization_id=new.organization_id and p.branch_id=new.branch_id
      and p.action='terminate' and p.status='pending' and p.requested_by<>auth.uid()
      and m.id=new.membership_id and m.profile_id=new.profile_id and m.status='ended') then
   raise exception using errcode='42501',message='native session revocation is not authorized';
 end if;
 perform private.require_staff_management_reauth(auth.uid(),clock_timestamp());
 delete from auth.refresh_tokens where user_id=new.profile_id::text;
 delete from auth.sessions where user_id=new.profile_id;
 get diagnostics removed=row_count;
 if exists(select 1 from auth.sessions where user_id=new.profile_id)
   or exists(select 1 from auth.refresh_tokens where user_id=new.profile_id::text) then
   raise exception using errcode='55000',message='native session revocation could not be verified';
 end if;
 new.provider_status:='supabase_native'; new.delivery_status:='completed'; new.verification_status:='verified';
 new.completed_at:=clock_timestamp(); new.failed_at:=null;
 new.provider_receipt:=jsonb_build_object('provider','supabase_native','removed_sessions',removed,
   'verified_no_sessions',true,'verified_no_refresh_tokens',true)::text;
 new.content_hash:=encode(sha256(convert_to(jsonb_build_object('proposal',new.source_proposal_id,
   'membership',new.membership_id,'profile',new.profile_id,'receipt',new.provider_receipt,
   'completed_at',new.completed_at)::text,'UTF8')),'hex');
 return new;
end; $$;
revoke all on function private.revoke_staff_native_sessions() from public,anon,authenticated,service_role;
create trigger staff_session_revocation_native before insert on private.staff_session_revocation_jobs
for each row execute function private.revoke_staff_native_sessions();

create table private.staff_google_invitations (
 id uuid primary key default gen_random_uuid(),
 organization_id uuid not null references public.organizations(id) on delete restrict,
 branch_id uuid not null references public.branches(id) on delete restrict,
 allowed_email text not null check(allowed_email=lower(btrim(allowed_email)) and allowed_email ~ '^[^[:space:]@]+@[^[:space:]@]+$'),
 display_name text not null check(char_length(btrim(display_name)) between 1 and 100 and display_name !~ '[[:cntrl:]]'),
 role_id uuid not null references public.roles(id) on delete restrict,
 requested_by uuid not null references auth.users(id) on delete restrict,
 requested_at timestamptz not null default now(),
 expires_at timestamptz not null default now()+interval '7 days',
 request_key uuid not null, request_hash text not null,
 status text not null default 'pending' check(status in ('pending','approved','rejected')),
 decided_by uuid references auth.users(id) on delete restrict,
 decided_at timestamptz, decision_key uuid, decision_hash text,
 activated_user_id uuid references auth.users(id) on delete restrict,
 activated_at timestamptz,
 unique(organization_id,request_key),unique(organization_id,decision_key),
 check(expires_at>requested_at and expires_at<=requested_at+interval '7 days'),
 check((status='pending' and decided_by is null and decided_at is null and decision_key is null and decision_hash is null)
  or (status<>'pending' and decided_by is not null and decided_by<>requested_by and decided_at is not null
      and decision_key is not null and decision_hash is not null)),
 check((activated_user_id is null)=(activated_at is null)),
 check(activated_at is null or status='approved')
);
create index staff_google_invitations_scope on private.staff_google_invitations(organization_id,branch_id,requested_at desc);
create index staff_google_invitations_role on private.staff_google_invitations(role_id);
create index staff_google_invitations_requester on private.staff_google_invitations(requested_by);
create index staff_google_invitations_decider on private.staff_google_invitations(decided_by);
create index staff_google_invitations_user on private.staff_google_invitations(activated_user_id);
alter table private.staff_google_invitations enable row level security;
alter table private.staff_google_invitations force row level security;
revoke all on private.staff_google_invitations from public,anon,authenticated,service_role;

create function private.protect_staff_google_invitation() returns trigger language plpgsql
security definer set search_path='' as $$
begin
 if tg_op='DELETE' or (tg_op='UPDATE' and
  ((new.id,new.organization_id,new.branch_id,new.allowed_email,new.display_name,new.role_id,new.requested_by,
    new.requested_at,new.expires_at,new.request_key,new.request_hash) is distinct from
   (old.id,old.organization_id,old.branch_id,old.allowed_email,old.display_name,old.role_id,old.requested_by,
    old.requested_at,old.expires_at,old.request_key,old.request_hash)
   or (old.status<>'pending' and (new.status,new.decided_by,new.decided_at,new.decision_key,new.decision_hash)
     is distinct from (old.status,old.decided_by,old.decided_at,old.decision_key,old.decision_hash))
   or (old.activated_at is not null and (new.activated_user_id,new.activated_at)
    is distinct from (old.activated_user_id,old.activated_at)))) then
  raise exception using errcode='55000',message='staff invitation history is immutable';
 end if;
 return new;
end; $$;
revoke all on function private.protect_staff_google_invitation() from public,anon,authenticated,service_role;
create trigger staff_google_invitation_protect before update or delete on private.staff_google_invitations
for each row execute function private.protect_staff_google_invitation();

create function private.staff_google_invitation_mutate(p_org uuid,p_branch uuid,p_action text,p_key uuid,
 p_email text default null,p_name text default null,p_role uuid default null,p_invitation uuid default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare r private.staff_google_invitations%rowtype; h text; domain text;
begin
 if p_action is null or p_action not in ('propose','approve','reject') or p_key is null
  or not private.staff_management_has_manage_authority(p_org,p_branch,'employment',p_action<>'propose')
  or not private.staff_management_has_manage_authority(p_org,p_branch,'roles',p_action<>'propose') then
  raise exception using errcode='42501',message='staff invitation is not permitted';
 end if;
 perform private.require_staff_management_reauth(auth.uid(),clock_timestamp());
 h:=encode(sha256(convert_to(jsonb_build_object('action',p_action,'org',p_org,'branch',p_branch,
   'email',p_email,'name',p_name,'role',p_role,'invitation',p_invitation,'actor',auth.uid())::text,'UTF8')),'hex');
 if p_action='propose' then
  select * into r from private.staff_google_invitations where organization_id=p_org and request_key=p_key for update;
  if found then
   if r.request_hash<>h then raise exception using errcode='23505',message='staff invitation idempotency conflict'; end if;
   return jsonb_build_object('id',r.id,'status',r.status,'expires_at',r.expires_at,'replayed',true);
  end if;
  select split_part(lower(email),'@',2) into domain from auth.users where id=auth.uid();
  if p_email is null or p_email<>lower(btrim(p_email)) or char_length(p_email)>254
    or split_part(p_email,'@',2) is distinct from domain or p_name is null
    or not exists(select 1 from public.branches where id=p_branch and organization_id=p_org and is_active)
    or not exists(select 1 from public.roles where id=p_role and is_active and is_system
      and role_key<>'family' and (organization_id is null or organization_id=p_org)) then
   raise exception using errcode='22023',message='invalid company staff invitation';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_org::text||p_email,0));
  if exists(select 1 from private.staff_google_invitations where organization_id=p_org and allowed_email=p_email
   and status in ('pending','approved') and activated_at is null and expires_at>clock_timestamp()) then
   raise exception using errcode='23505',message='an unexpired staff invitation already exists';
  end if;
  insert into private.staff_google_invitations(organization_id,branch_id,allowed_email,display_name,role_id,
   requested_by,request_key,request_hash) values(p_org,p_branch,p_email,p_name,p_role,auth.uid(),p_key,h) returning * into r;
 else
  select * into r from private.staff_google_invitations where id=p_invitation and organization_id=p_org
   and branch_id=p_branch for update;
  if not found or r.requested_by=auth.uid() then
   raise exception using errcode='42501',message='staff invitation requires an independent approver';
  end if;
  if r.decision_key=p_key and r.decision_hash=h then
   return jsonb_build_object('id',r.id,'status',r.status,'expires_at',r.expires_at,'replayed',true);
  end if;
  if r.status<>'pending' or r.expires_at<=clock_timestamp() then
   raise exception using errcode='40001',message='staff invitation is no longer pending';
  end if;
  update private.staff_google_invitations set status=case p_action when 'approve' then 'approved' else 'rejected' end,
   decided_by=auth.uid(),decided_at=clock_timestamp(),decision_key=p_key,decision_hash=h where id=r.id returning * into r;
 end if;
 insert into public.audit_events(organization_id,branch_id,actor_user_id,action,table_name,row_pk,metadata)
 values(p_org,p_branch,auth.uid(),case when p_action='propose' then 'insert' else 'update' end,'private.staff_google_invitations',r.id::text,
  jsonb_build_object('policy','staff-google-invitation-v1','operation',p_action,'request_hash',r.request_hash,'status',r.status));
 return jsonb_build_object('id',r.id,'status',r.status,'expires_at',r.expires_at,'replayed',false);
end; $$;
create function public.staff_google_invitation_mutate(p_org uuid,p_branch uuid,p_action text,p_key uuid,
 p_email text default null,p_name text default null,p_role uuid default null,p_invitation uuid default null)
returns jsonb language sql security invoker set search_path='' as $$
 select private.staff_google_invitation_mutate(p_org,p_branch,p_action,p_key,p_email,p_name,p_role,p_invitation); $$;
revoke all on function private.staff_google_invitation_mutate(uuid,uuid,text,uuid,text,text,uuid,uuid)
 from public,anon,authenticated,service_role;
grant execute on function private.staff_google_invitation_mutate(uuid,uuid,text,uuid,text,text,uuid,uuid) to authenticated;
revoke all on function public.staff_google_invitation_mutate(uuid,uuid,text,uuid,text,text,uuid,uuid)
 from public,anon,authenticated,service_role;
grant execute on function public.staff_google_invitation_mutate(uuid,uuid,text,uuid,text,text,uuid,uuid) to authenticated;

create function private.staff_google_invitation_list(p_org uuid,p_branch uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare items jsonb;
begin
 if not private.staff_management_has_read_authority(p_org,p_branch) then
  raise exception using errcode='42501',message='staff invitation list is not permitted'; end if;
 select coalesce(jsonb_agg(q),'[]'::jsonb) into items from (
  select i.id,i.allowed_email,i.display_name,r.name as role_name,i.role_id,i.status,i.requested_by,
   i.requested_at,i.expires_at,i.decided_by,i.decided_at,i.activated_at,
   case when i.activated_at is not null then 'activated' when i.expires_at<=clock_timestamp() then 'expired' else i.status end as state
  from private.staff_google_invitations i join public.roles r on r.id=i.role_id
  where i.organization_id=p_org and i.branch_id=p_branch order by i.requested_at desc,i.id limit 100) q;
 insert into public.audit_events(organization_id,branch_id,actor_user_id,action,table_name,metadata)
 values(p_org,p_branch,auth.uid(),'read','private.staff_google_invitations',jsonb_build_object('returned',jsonb_array_length(items)));
 return items;
end; $$;
create function public.staff_google_invitation_list(p_org uuid,p_branch uuid) returns jsonb
language sql security invoker set search_path='' as $$ select private.staff_google_invitation_list(p_org,p_branch); $$;
revoke all on function private.staff_google_invitation_list(uuid,uuid) from public,anon,authenticated,service_role;
revoke all on function public.staff_google_invitation_list(uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function private.staff_google_invitation_list(uuid,uuid) to authenticated;
grant execute on function public.staff_google_invitation_list(uuid,uuid) to authenticated;

-- The genuine Google callback may provision only a previously approved invite.
-- Matching email is not sufficient: the old gate verifies the provider subject,
-- verified email, OAuth AMR and live server-owned session before granting access.
alter function private.activate_approved_staff_google_account() rename to activate_bootstrap_staff_google_account;
create function private.activate_approved_staff_google_account() returns boolean language plpgsql
security definer set search_path='' as $$
declare i private.staff_google_invitations%rowtype; prior private.pending_staff_google_activations%rowtype; email text; role_key text;
begin
 if auth.uid() is null or auth.jwt()->>'role' is distinct from 'authenticated' then return false; end if;
 select * into prior from private.pending_staff_google_activations where user_id=auth.uid() and replaced_at is null for update;
 if found and (prior.activated_at is not null or prior.expires_at>clock_timestamp() or prior.revoked_at is not null) then
  return private.activate_bootstrap_staff_google_account(); end if;
 select lower(u.email) into email from auth.users u join auth.identities x on x.user_id=u.id
  where u.id=auth.uid() and u.email_confirmed_at is not null and x.provider='google'
   and x.identity_data->>'sub'=x.provider_id and x.identity_data->>'email'=lower(u.email)
   and x.identity_data->'email_verified'='true'::jsonb;
 if email is null then return false; end if;
 select * into i from private.staff_google_invitations where allowed_email=email and status='approved'
  and activated_at is null and expires_at>clock_timestamp() order by requested_at desc limit 1 for update;
 if not found then return false; end if;
 select r.role_key into role_key from public.roles r where id=i.role_id and is_active;
 if role_key is null or role_key='family' then return false; end if;
 if prior.id is not null then
  if (prior.organization_id,prior.branch_id,prior.allowed_email) is distinct from
     (i.organization_id,i.branch_id,email) then return false; end if;
  update private.pending_staff_google_activations set replaced_at=clock_timestamp() where id=prior.id;
 end if;
 -- Insert a pinned approval and let the existing verified-session executor
 -- complete provisioning. Nothing accepts caller-supplied identity or role.
 insert into private.pending_staff_google_activations(user_id,organization_id,branch_id,role_id,allowed_email,
  display_name,approved_at,expires_at,approval_reference,replaces_id)
 values(auth.uid(),i.organization_id,i.branch_id,i.role_id,email,i.display_name,clock_timestamp(),
   i.expires_at,'governed-invitation:'||i.id::text,prior.id);
 if not private.activate_bootstrap_staff_google_account() then
  raise exception using errcode='42501',message='approved Google invitation session was rejected'; end if;
 update private.staff_google_invitations set activated_at=clock_timestamp(),activated_user_id=auth.uid() where id=i.id;
 return true;
end; $$;
revoke all on function private.activate_approved_staff_google_account() from public,anon,authenticated,service_role;
grant execute on function private.activate_approved_staff_google_account() to authenticated;
create or replace function public.activate_approved_staff_google_account() returns boolean
language sql volatile security invoker set search_path='' as $$select private.activate_approved_staff_google_account()$$;
-- Expand the executor's role allow-list only after the dual approval pathway
-- above has pinned one actual system role. Bootstrap approvals remain owner-only.
do $update$ declare body text; begin
 body:=pg_get_functiondef('private.activate_bootstrap_staff_google_account()'::regprocedure);
 if position('r.role_key in (''branch_supervisor'',''branch_director'')' in body)=0 then
  raise exception 'unexpected bootstrap activation definition'; end if;
 body:=replace(body,'r.role_key in (''branch_supervisor'',''branch_director'')',
  'r.role_key in (''organization_manager'',''branch_supervisor'',''branch_director'',''nurse'',''case_manager_social_worker'',''care_worker'',''transport_driver'',''professional'',''finance_claims'',''platform_ops'')');
 execute body;
end $update$;
do $snapshot$ declare body text; begin
 body:=pg_get_functiondef('private.staff_management_snapshot_bundle(uuid,uuid,timestamptz,text,uuid,text,text)'::regprocedure);
 if position('''session_revocation_provider_status'', ''not_configured''' in body)=0 then
  raise exception 'unexpected staff snapshot definition';end if;
 body:=replace(body,'''session_revocation_provider_status'', ''not_configured''',
  '''session_revocation_provider_status'', ''supabase_native''');
 body:=replace(body,'''session_revocation_verification_status'', ''not_verified''',
  '''session_revocation_verification_status'', case when v_pending_revocation_total=0 then ''verified'' else ''not_verified'' end');
 execute body;
end $snapshot$;
commit;
