begin;
set local lock_timeout = '5s';

-- The owner-approved invite may now name the existing single-site director
-- template. It still cannot choose an organization, branch, role or identity
-- during login, and never grants nursing/social-work privileges implicitly.
create or replace function private.activate_approved_staff_google_account() returns boolean
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
   return public.is_staff_login_allowed();
 end if;
 if v_invite.approved_at>clock_timestamp() or v_invite.expires_at<=clock_timestamp()
   or exists(select 1 from private.staff_google_access_grants where allowed_user_id=auth.uid())
   or exists(select 1 from public.profiles where id=auth.uid())
   or not exists(select 1 from public.organizations o join public.branches b on b.organization_id=o.id
     where o.id=v_invite.organization_id and o.is_active and b.id=v_invite.branch_id and b.is_active)
   or not exists(select 1 from public.roles r where r.id=v_invite.role_id and r.is_active and r.is_system
     and r.role_key in ('branch_supervisor','branch_director')
     and (r.organization_id is null or r.organization_id=v_invite.organization_id)) then return false;
 end if;
 v_domain:=split_part(v_invite.allowed_email,'@',2);
 select i.provider_id into v_subject from auth.identities i join auth.users u on u.id=i.user_id
 where u.id=auth.uid() and i.provider='google' and u.email_confirmed_at is not null
   and lower(u.email)=v_invite.allowed_email and i.identity_data->>'sub'=i.provider_id
   and lower(i.identity_data->>'email')=v_invite.allowed_email and i.identity_data->'email_verified'='true'::jsonb;
 if not found then return false; end if;
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
comment on function public.activate_approved_staff_google_account() is
 'Self-only, one-use owner-approved single-branch manager or director activation after verified Google OAuth. No caller-selected email, organization, role or assurance.';

commit;
