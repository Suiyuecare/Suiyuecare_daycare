begin;
set local lock_timeout = '5s';

-- Owner-approved, one-use activation for a pre-provisioned Auth user. No seed,
-- wildcard domain admission, self-selected role, password or forged identity.
create table private.pending_staff_google_activations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references auth.users(id) on delete restrict,
  organization_id uuid not null references public.organizations(id) on delete restrict,
  branch_id uuid not null references public.branches(id) on delete restrict,
  role_id uuid not null references public.roles(id) on delete restrict,
  allowed_email text not null check (allowed_email=lower(btrim(allowed_email))
    and char_length(allowed_email) between 3 and 254 and allowed_email ~ '^[^[:space:]@]+@[^[:space:]@]+$'),
  display_name text not null check (char_length(btrim(display_name)) between 1 and 100 and display_name !~ '[[:cntrl:]]'),
  approved_at timestamptz not null default clock_timestamp(),
  expires_at timestamptz not null default now()+interval '7 days',
  approval_reference text not null check (char_length(btrim(approval_reference)) between 1 and 240
    and approval_reference !~ '[[:cntrl:]]'),
  revoked_at timestamptz,
  activated_at timestamptz,
  activated_session_id uuid,
  check (expires_at>approved_at and expires_at<=approved_at+interval '7 days'),
  check ((activated_at is null)=(activated_session_id is null))
);
create index pending_staff_google_activations_org_idx on private.pending_staff_google_activations(organization_id);
create index pending_staff_google_activations_branch_idx on private.pending_staff_google_activations(branch_id);
create index pending_staff_google_activations_role_idx on private.pending_staff_google_activations(role_id);
alter table private.pending_staff_google_activations enable row level security;
alter table private.pending_staff_google_activations force row level security;
revoke all on private.pending_staff_google_activations from public,anon,authenticated,service_role;

create function private.audit_pending_staff_google_activation() returns trigger
language plpgsql security invoker set search_path='' as $$
declare v_row jsonb; v_old jsonb:='{}'; v_new jsonb:='{}'; v_fields text[];
begin
 if tg_op<>'INSERT' then v_old:=to_jsonb(old); end if;
 if tg_op<>'DELETE' then v_new:=to_jsonb(new); end if;
 if tg_op='UPDATE' and (new.id,new.user_id,new.organization_id,new.branch_id,new.role_id,new.allowed_email,
   new.display_name,new.approved_at,new.expires_at,new.approval_reference)
   is distinct from (old.id,old.user_id,old.organization_id,old.branch_id,old.role_id,old.allowed_email,
   old.display_name,old.approved_at,old.expires_at,old.approval_reference) then
   raise exception using errcode='23514',message='activation approval is immutable';
 end if;
 if tg_op='DELETE' or (tg_op='UPDATE' and (old.activated_at is not null and
   (new.activated_at,new.activated_session_id) is distinct from (old.activated_at,old.activated_session_id)))
   or (tg_op='UPDATE' and old.revoked_at is not null and new.revoked_at is distinct from old.revoked_at) then
   raise exception using errcode='23514',message='activation history is immutable';
 end if;
 if tg_op='UPDATE' and old.activated_at is not null and new.revoked_at is distinct from old.revoked_at then
   raise exception using errcode='23514',message='revoke the active staff grant instead of a consumed activation';
 end if;
 v_row:=case when tg_op='DELETE' then v_old else v_new end;
 select coalesce(array_agg(k order by k),'{}'::text[]) into v_fields from jsonb_object_keys(v_old||v_new) k
   where v_old->k is distinct from v_new->k;
 insert into public.audit_events(organization_id,branch_id,actor_user_id,action,table_name,row_pk,changed_fields,metadata,occurred_at)
 values((v_row->>'organization_id')::uuid,(v_row->>'branch_id')::uuid,auth.uid(),lower(tg_op),
  'private.pending_staff_google_activations',v_row->>'id',v_fields,
  jsonb_build_object('system_actor',auth.uid() is null,'policy_version','staff-activation-v1',
   'authority_path',case when tg_op='INSERT' then 'database_owner_approval' else 'approved_google_activation_or_cancellation' end,
   'approval_reference_sha256',encode(sha256(convert_to(v_row->>'approval_reference','UTF8')),'hex')),clock_timestamp());
 return new;
end; $$;
revoke all on function private.audit_pending_staff_google_activation() from public,anon,authenticated,service_role;
create trigger pending_staff_google_activation_audit after insert or update or delete on private.pending_staff_google_activations
for each row execute function private.audit_pending_staff_google_activation();

create function private.activate_approved_staff_google_account() returns boolean
language plpgsql volatile security definer set search_path='' as $$
declare
 v_invite private.pending_staff_google_activations%rowtype;
 v_subject text;
 v_domain text;
 v_membership uuid;
begin
 if auth.uid() is null or auth.jwt()->>'role' is distinct from 'authenticated' then return false; end if;
 select * into v_invite from private.pending_staff_google_activations
   where user_id=auth.uid() for update;
 if not found or v_invite.revoked_at is not null then return false; end if;
 if v_invite.activated_at is not null then
   -- Never reactivate a revoked grant, disabled profile or changed membership.
   return public.is_staff_login_allowed();
 end if;
 if v_invite.approved_at>clock_timestamp() or v_invite.expires_at<=clock_timestamp()
   or exists(select 1 from private.staff_google_access_grants where allowed_user_id=auth.uid())
   or exists(select 1 from public.profiles where id=auth.uid())
   or not exists(select 1 from public.organizations o join public.branches b on b.organization_id=o.id
     where o.id=v_invite.organization_id and o.is_active and b.id=v_invite.branch_id and b.is_active)
   or not exists(select 1 from public.roles r where r.id=v_invite.role_id and r.is_active and r.is_system
     and r.role_key='branch_supervisor' and (r.organization_id is null or r.organization_id=v_invite.organization_id)) then return false;
 end if;
 v_domain:=split_part(v_invite.allowed_email,'@',2);
 select i.provider_id into v_subject from auth.identities i join auth.users u on u.id=i.user_id
 where u.id=auth.uid() and i.provider='google' and u.email_confirmed_at is not null
   and lower(u.email)=v_invite.allowed_email and i.identity_data->>'sub'=i.provider_id
   and lower(i.identity_data->>'email')=v_invite.allowed_email and i.identity_data->'email_verified'='true'::jsonb;
 if not found then return false; end if;
 -- Provisional insert is inside this subtransaction. The existing strict gate
 -- verifies actual Google identity, live session, AMR and every JWT condition.
 -- Any failed check rolls back the grant and its audit event, not just the UI.
 begin
   insert into private.staff_google_access_grants(allowed_user_id,organization_id,company_email_domain,
     allowed_email,google_subject,enabled,approval_reference)
   values(auth.uid(),v_invite.organization_id,v_domain,v_invite.allowed_email,v_subject,true,v_invite.approval_reference);
   if private.is_staff_google_session_allowed() is not true then
     raise exception using errcode='42501',message='activation denied';
   end if;
   insert into public.profiles(id,display_name,kind,is_active) values(auth.uid(),v_invite.display_name,'staff',true);
   insert into public.memberships(organization_id,branch_id,profile_id,status,starts_at)
     values(v_invite.organization_id,v_invite.branch_id,auth.uid(),'active',now()) returning id into v_membership;
   -- This is execution of an existing owner approval, not self-approval. The
   -- activation audit preserves the approval reference hash and actual caller.
   insert into public.membership_roles(membership_id,role_id) values(v_membership,v_invite.role_id);
   update private.pending_staff_google_activations set activated_at=clock_timestamp(),
     activated_session_id=(auth.jwt()->>'session_id')::uuid where id=v_invite.id;
   if public.is_staff_login_allowed() is not true then
     raise exception using errcode='42501',message='activation denied';
   end if;
   return true;
 exception when check_violation or unique_violation or insufficient_privilege or invalid_text_representation then
   return false;
 end;
end; $$;
alter function private.activate_approved_staff_google_account() owner to postgres;
revoke all on function private.activate_approved_staff_google_account() from public,anon,authenticated,service_role;
grant execute on function private.activate_approved_staff_google_account() to authenticated;
create function public.activate_approved_staff_google_account() returns boolean
language sql volatile security invoker set search_path='' as $$ select private.activate_approved_staff_google_account(); $$;
revoke all on function public.activate_approved_staff_google_account() from public,anon,authenticated,service_role;
grant execute on function public.activate_approved_staff_google_account() to authenticated;
comment on function public.activate_approved_staff_google_account() is
 'Self-only, one-use owner-approved branch manager activation after genuine verified Google OAuth. No caller-selected email, organization, role or assurance.';
commit;
