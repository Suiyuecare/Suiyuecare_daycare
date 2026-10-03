begin;
set local lock_timeout = '5s';

-- Keep the expired approval immutable. A replacement is a new, separately
-- approved row; only the expired, unused predecessor may be marked replaced.
alter table private.pending_staff_google_activations
  add column replaced_at timestamptz,
  add column replaces_id uuid references private.pending_staff_google_activations(id) on delete restrict,
  add constraint pending_staff_activation_replacement_state
    check (replaced_at is null or activated_at is null);
alter table private.pending_staff_google_activations
  drop constraint pending_staff_google_activations_user_id_key;
create unique index pending_staff_google_activations_current_user_idx
  on private.pending_staff_google_activations(user_id) where replaced_at is null;
create index pending_staff_google_activations_replaces_idx
  on private.pending_staff_google_activations(replaces_id);

create or replace function private.audit_pending_staff_google_activation() returns trigger
language plpgsql security invoker set search_path='' as $$
declare v_row jsonb; v_old jsonb:='{}'; v_new jsonb:='{}'; v_fields text[];
  predecessor private.pending_staff_google_activations%rowtype;
begin
 if tg_op='INSERT' then
   if new.replaced_at is not null then
     raise exception using errcode='23514',message='new approval cannot already be replaced';
   end if;
   if new.replaces_id is null then
     if exists(select 1 from private.pending_staff_google_activations a
       where a.user_id=new.user_id and a.id<>new.id) then
       raise exception using errcode='23514',message='replacement must cite expired approval';
     end if;
   else
     select * into predecessor from private.pending_staff_google_activations
       where id=new.replaces_id;
     if not found or predecessor.user_id is distinct from new.user_id
       or predecessor.organization_id is distinct from new.organization_id
       or predecessor.branch_id is distinct from new.branch_id
       or predecessor.allowed_email is distinct from new.allowed_email
       or predecessor.replaced_at is null or predecessor.activated_at is not null
       or predecessor.expires_at>new.approved_at then
       raise exception using errcode='23514',message='invalid approval predecessor';
     end if;
   end if;
 else
   v_old:=to_jsonb(old);
 end if;
 if tg_op<>'DELETE' then v_new:=to_jsonb(new); end if;
 if tg_op='UPDATE' and (new.id,new.user_id,new.organization_id,new.branch_id,new.role_id,new.allowed_email,
   new.display_name,new.approved_at,new.expires_at,new.approval_reference,new.replaces_id)
   is distinct from (old.id,old.user_id,old.organization_id,old.branch_id,old.role_id,old.allowed_email,
   old.display_name,old.approved_at,old.expires_at,old.approval_reference,old.replaces_id) then
   raise exception using errcode='23514',message='activation approval is immutable';
 end if;
 if tg_op='UPDATE' and new.replaced_at is distinct from old.replaced_at and
   (old.replaced_at is not null or new.replaced_at is null or old.activated_at is not null
    or old.expires_at>clock_timestamp() or new.replaced_at<old.expires_at
    or new.replaced_at>clock_timestamp()+interval '5 seconds') then
   raise exception using errcode='23514',message='only expired unused approval can be replaced';
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
  jsonb_build_object('system_actor',auth.uid() is null,'policy_version','staff-activation-renewal-v1',
   'authority_path',case when tg_op='INSERT' then 'database_owner_approval' else 'approved_google_activation_or_replacement' end,
   'approval_reference_sha256',encode(sha256(convert_to(v_row->>'approval_reference','UTF8')),'hex'),
   'replaces_id',v_row->>'replaces_id'),clock_timestamp());
 return new;
end; $$;
alter function private.audit_pending_staff_google_activation() owner to postgres;
revoke all on function private.audit_pending_staff_google_activation() from public,anon,authenticated,service_role;

-- The role, branch and Google-subject checks remain the same. Only the
-- superseded approval is excluded from selection.
create or replace function private.activate_approved_staff_google_account() returns boolean
language plpgsql volatile security definer set search_path='' as $$
declare v_invite private.pending_staff_google_activations%rowtype; v_subject text; v_domain text; v_membership uuid;
begin
 if auth.uid() is null or auth.jwt()->>'role' is distinct from 'authenticated' then return false; end if;
 select * into v_invite from private.pending_staff_google_activations
   where user_id=auth.uid() and replaced_at is null for update;
 if not found or v_invite.revoked_at is not null then return false; end if;
 if v_invite.activated_at is not null then return public.is_staff_login_allowed(); end if;
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
 'Self-only, one-use owner-approved director or manager activation; expired approvals can be replaced without rewriting history.';

commit;
