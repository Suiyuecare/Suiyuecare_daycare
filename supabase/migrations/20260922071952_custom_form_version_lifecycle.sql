begin;
set local lock_timeout='5s';
set local statement_timeout='30s';

-- Retirement changes availability, never a published schema or its original dates.
create table private.custom_form_lifecycle_events (
 id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id),
 branch_id uuid not null, form_version_id uuid not null references public.form_versions(id),
 action text not null check(action in ('clone','request_retirement','approve_retirement','reject_retirement')),
 request_id uuid references private.custom_form_lifecycle_events(id),
 new_version_id uuid references public.form_versions(id), actor_id uuid not null references auth.users(id),
 reason text not null check(length(reason) between 5 and 1000), effective_through date,
 challenge_id uuid not null references private.reauth_challenges(id), created_at timestamptz not null,
 foreign key(branch_id,organization_id) references public.branches(id,organization_id),
 check((action in ('approve_retirement','reject_retirement'))=(request_id is not null)),
 check((action='clone')=(new_version_id is not null)),
 check((action='approve_retirement')=(effective_through is not null))
);
create unique index custom_lifecycle_one_decision on private.custom_form_lifecycle_events(request_id) where request_id is not null;
create unique index custom_lifecycle_one_retirement on private.custom_form_lifecycle_events(form_version_id) where action='approve_retirement';
create index custom_lifecycle_scope_idx on private.custom_form_lifecycle_events(organization_id,branch_id,form_version_id,created_at desc);
create index custom_lifecycle_version_idx on private.custom_form_lifecycle_events(form_version_id);
create index custom_lifecycle_branch_idx on private.custom_form_lifecycle_events(branch_id,organization_id);
create index custom_lifecycle_new_idx on private.custom_form_lifecycle_events(new_version_id);
create index custom_lifecycle_actor_idx on private.custom_form_lifecycle_events(actor_id);
create index custom_lifecycle_challenge_idx on private.custom_form_lifecycle_events(challenge_id);
create table private.custom_form_lifecycle_receipts (
 organization_id uuid not null references public.organizations(id), actor_id uuid not null references auth.users(id),
 idempotency_key uuid not null, request_hash text not null check(request_hash~'^[a-f0-9]{64}$'),
 event_id uuid not null references private.custom_form_lifecycle_events(id), primary key(organization_id,actor_id,idempotency_key)
);
create index custom_lifecycle_receipt_actor_idx on private.custom_form_lifecycle_receipts(actor_id);
create index custom_lifecycle_receipt_event_idx on private.custom_form_lifecycle_receipts(event_id);
alter table private.custom_form_lifecycle_events enable row level security;
alter table private.custom_form_lifecycle_events force row level security;
alter table private.custom_form_lifecycle_receipts enable row level security;
alter table private.custom_form_lifecycle_receipts force row level security;
revoke all on private.custom_form_lifecycle_events,private.custom_form_lifecycle_receipts from public,anon,authenticated,service_role;
create trigger custom_lifecycle_event_immutable before update or delete on private.custom_form_lifecycle_events
 for each row execute function private.reject_custom_response_mutation();
create trigger custom_lifecycle_receipt_immutable before update or delete on private.custom_form_lifecycle_receipts
 for each row execute function private.reject_custom_response_mutation();

create function private.has_live_custom_governance_scope(p_org uuid,p_branch uuid)
returns boolean language plpgsql volatile security definer set search_path='' as $$
declare stamp timestamptz:=clock_timestamp();
begin
 return p_org is not null and p_branch is not null
 and exists(select 1 from public.branches b join public.organizations o on o.id=b.organization_id and o.is_active where b.id=p_branch and b.organization_id=p_org and b.is_active)
 and (coalesce(private.is_executive_login_allowed(),false) or (coalesce(private.is_staff_google_session_allowed(),false)
   and exists(select 1 from private.staff_google_access_grants g where g.allowed_user_id=auth.uid() and g.organization_id=p_org
    and g.enabled and g.approved_at<=stamp and (g.expires_at is null or g.expires_at>stamp))))
 and exists(select 1 from public.profiles p join public.memberships m on m.profile_id=p.id
   join public.membership_roles mr on mr.membership_id=m.id
   join public.roles r on r.id=mr.role_id and r.is_active
   join public.role_permissions rp on rp.role_id=r.id
   join public.permissions permission on permission.id=rp.permission_id and permission.permission_key='forms.manage'
   where p.id=auth.uid() and p.is_active and p.kind<>'family' and m.organization_id=p_org and m.branch_id is null
    and m.status='active' and m.starts_at<=stamp and (m.ends_at is null or m.ends_at>stamp)
    and mr.assigned_at<=stamp and rp.granted_at<=stamp and r.role_key not in ('platform_ops','family') and (r.organization_id is null or r.organization_id=p_org));
end;$$;

create function private.has_any_custom_governance_scope()
returns boolean language sql volatile security definer set search_path='' as $$
 select exists(select 1 from public.branches b where private.has_live_custom_governance_scope(b.organization_id,b.id));
$$;

-- Same immutable challenge requirements, deliberately independent of the old
-- executive-only global permission root. This proof grants no clinical powers.
create function private.custom_governance_reauth_challenge()
returns uuid language plpgsql volatile security definer set search_path='' as $$
declare result uuid; stamp timestamptz:=clock_timestamp(); session_uuid uuid; verified timestamptz;
begin
 if coalesce(auth.jwt()->>'aal','')<>'aal2' or not private.has_any_custom_governance_scope() then
  raise exception using errcode='42501',message='real recent governance AAL2 required'; end if;
 session_uuid:=(auth.jwt()->>'session_id')::uuid;
 select c.id,c.factor_verified_at into result,verified from private.reauth_events e join private.reauth_challenges c
  on c.id=e.challenge_id and c.user_id=e.user_id and c.session_id=e.session_id
  where e.user_id=auth.uid() and e.session_id=session_uuid and e.aal='aal2' and e.revoked_at is null
   and e.verification_method in ('totp','webauthn','phone') and c.consumed_at is not null and c.invalidated_at is null
   and c.factor_method=e.verification_method and c.factor_verified_at=e.verified_at
   and c.factor_verified_at>=stamp-interval '15 minutes' and c.factor_verified_at<=stamp+interval '1 minute'
  order by c.factor_verified_at desc,c.id desc limit 1 for share of e,c;
 stamp:=clock_timestamp();
 if result is null or verified<stamp-interval '15 minutes' or verified>stamp+interval '1 minute' or not private.has_any_custom_governance_scope()
 then raise exception using errcode='42501',message='real recent governance AAL2 required'; end if;
 return result;
end;$$;

create function private.assert_custom_lifecycle_authority(p_org uuid,p_branch uuid,p_write boolean)
returns void language plpgsql volatile security definer set search_path='' as $$
begin
 if not coalesce(private.has_live_custom_governance_scope(p_org,p_branch),false) then raise exception using errcode='42501',message='live custom form governance authority required'; end if;
 if p_write then perform private.custom_governance_reauth_challenge(); end if;
end;$$;

create function private.has_custom_governance_permission(p_org uuid,p_branch uuid,p_permission text)
returns boolean language sql volatile security definer set search_path='' as $$
 select coalesce(p_permission='forms.manage' and case when p_branch is not null then private.has_live_custom_governance_scope(p_org,p_branch)
 else exists(select 1 from public.branches b where b.organization_id=p_org and private.has_live_custom_governance_scope(p_org,b.id)) end,false);
$$;
create function private.has_recent_custom_governance_aal2(p_minutes integer)
returns boolean language plpgsql volatile security definer set search_path='' as $$
begin
 if p_minutes<>15 then return false; end if;
 perform private.custom_governance_reauth_challenge(); return true;
exception when insufficient_privilege then return false; end;$$;

create or replace function private.assert_custom_form_authority(p_org uuid,p_branch uuid,p_write boolean)
returns void language plpgsql volatile security invoker set search_path='' as $$
begin perform private.assert_custom_lifecycle_authority(p_org,p_branch,p_write); end;$$;

create function public.has_custom_form_governance_access(p_org uuid,p_branch uuid,p_write boolean)
returns boolean language plpgsql volatile security invoker set search_path='' as $$
begin perform private.assert_custom_lifecycle_authority(p_org,p_branch,p_write); return true;
exception when insufficient_privilege then return false; end;$$;

create function private.custom_form_lifecycle_event_json(e private.custom_form_lifecycle_events)
returns jsonb language sql stable security invoker set search_path='' as $$
 select jsonb_build_object('id',e.id,'formVersionId',e.form_version_id,'branchId',e.branch_id,'branchName',(select b.name from public.branches b where b.id=e.branch_id and b.organization_id=e.organization_id),'action',e.action,'requestId',e.request_id,
 'newVersionId',e.new_version_id,'actorId',e.actor_id,'reason',e.reason,'effectiveThrough',e.effective_through,
 'createdAt',e.created_at,'byCurrentUser',e.actor_id=auth.uid());
$$;

create function private.custom_form_effective_through(p_version uuid,p_original date)
returns date language sql stable security definer set search_path='' as $$
 select least(p_original,(select e.effective_through from private.custom_form_lifecycle_events e where e.form_version_id=p_version and e.action='approve_retirement'));
$$;

-- A retired transition is allowed only after its immutable independent decision exists.
create or replace function private.prevent_published_form_mutation()
returns trigger language plpgsql security invoker set search_path='' as $$
begin
 if old.status<>'draft' then
  if tg_op='UPDATE' and old.status='published' and new.status='retired'
   and (to_jsonb(new)-array['status','updated_at'])=(to_jsonb(old)-array['status','updated_at'])
   and exists(select 1 from private.custom_form_lifecycle_events e join private.custom_form_lifecycle_events q on q.id=e.request_id
    where e.form_version_id=old.id and e.action='approve_retirement' and q.action='request_retirement'
     and e.actor_id<>q.actor_id and e.challenge_id<>q.challenge_id)
  then return new; end if;
  raise exception using errcode='55000',message='published form versions are immutable; create a new version';
 end if;
 if tg_op='DELETE' then return old; end if;
 return new;
end;$$;

create function private.write_custom_form_lifecycle_atomic(p_org uuid,p_branch uuid,p_key uuid,p_input jsonb)
returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare v public.form_versions%rowtype; d public.form_definitions%rowtype; n public.form_versions%rowtype;
 e private.custom_form_lifecycle_events%rowtype; q private.custom_form_lifecycle_events%rowtype;
 r private.custom_form_lifecycle_receipts%rowtype; actor uuid:=auth.uid(); kind text; h text; challenge uuid;
 stamp timestamptz; source_id uuid; request_uuid uuid; reason text; through_day date; next_number integer;
begin
 perform private.assert_custom_lifecycle_authority(p_org,p_branch,true);
 if p_key is null or p_input is null or jsonb_typeof(p_input)<>'object' or octet_length(p_input::text)>8192
  or p_input-array['action','formVersionId','requestId','reason']<>'{}'::jsonb
  or not(p_input ?& array['action','formVersionId','requestId','reason'])
  or not private.custom_form_plain_text(p_input->'reason',1000) or length(p_input->>'reason')<5
  or not coalesce(p_input->>'action' in ('clone','request_retirement','approve_retirement','reject_retirement'),false)
 then raise exception using errcode='22023',message='invalid form lifecycle request'; end if;
 begin
  kind:=p_input->>'action'; source_id:=(p_input->>'formVersionId')::uuid; request_uuid:=(p_input->>'requestId')::uuid;
 exception when others then raise exception using errcode='22023',message='invalid form lifecycle identity'; end;
 if source_id is null or ((kind in ('approve_retirement','reject_retirement'))<>(request_uuid is not null)) then
  raise exception using errcode='22023',message='invalid form lifecycle request identity'; end if;
 reason:=p_input->>'reason';
 h:=encode(sha256(convert_to(jsonb_build_object('branch',p_branch,'input',p_input)::text,'UTF8')),'hex');
 perform pg_advisory_xact_lock(hashtextextended('custom-form-lifecycle:'||p_org::text||':'||actor::text||':'||p_key::text,0));
 select * into r from private.custom_form_lifecycle_receipts where organization_id=p_org and actor_id=actor and idempotency_key=p_key;
 if found then
  perform private.assert_custom_lifecycle_authority(p_org,p_branch,true);
  if r.request_hash<>h then raise exception using errcode='23505',message='lifecycle idempotency conflict'; end if;
  select * into e from private.custom_form_lifecycle_events where id=r.event_id;
  return jsonb_build_object('event',private.custom_form_lifecycle_event_json(e),'replayed',true);
 end if;
 select * into v from public.form_versions where id=source_id;
 select * into d from public.form_definitions where id=v.form_definition_id and organization_id=p_org and not is_official;
 if d.id is null or d.form_key !~ '^tenant\.custom\.[a-z][a-z0-9_]{1,59}$' or v.schema_json->>'builder' is distinct from 'tenant-custom.v1' or v.scoring_json<>'{}'::jsonb
 then raise exception using errcode='42501',message='custom form outside governed scope'; end if;
 -- Shared with publication; version row lock also excludes new response writes.
 perform pg_advisory_xact_lock(hashtextextended('form-publish-definition:'||d.id::text,0));
 select * into v from public.form_versions where id=source_id for update;
 select * into d from public.form_definitions where id=v.form_definition_id and organization_id=p_org and not is_official for share;
 perform private.assert_custom_lifecycle_authority(p_org,p_branch,true);
 stamp:=clock_timestamp(); challenge:=private.custom_governance_reauth_challenge();
 if kind='clone' then
  if v.status not in ('published','retired') or exists(select 1 from public.form_versions where form_definition_id=d.id and status='draft')
   then raise exception using errcode='23514',message='clone requires historical source and no existing draft'; end if;
  select coalesce(max(version),0)+1 into next_number from public.form_versions where form_definition_id=d.id;
  insert into public.form_versions(form_definition_id,version,status,effective_from,effective_to,schema_json,scoring_json)
   values(d.id,next_number,'draft',null,null,v.schema_json,'{}') returning * into n;
 elsif kind='request_retirement' then
  if v.status<>'published' or v.effective_from is null or v.effective_from>(stamp at time zone 'Asia/Taipei')::date
   or exists(select 1 from private.custom_form_lifecycle_events pending where pending.form_version_id=v.id and pending.action='request_retirement'
    and not exists(select 1 from private.custom_form_lifecycle_events decision where decision.request_id=pending.id))
  then raise exception using errcode='23514',message='version is not active published or has pending retirement'; end if;
 else
  select * into q from private.custom_form_lifecycle_events where id=request_uuid and organization_id=p_org
   and form_version_id=v.id and action='request_retirement';
  if q.id is null or q.actor_id=actor or q.challenge_id=challenge then raise exception using errcode='42501',message='independent scoped retirement approval required'; end if;
  if v.status<>'published' or exists(select 1 from private.custom_form_lifecycle_events where request_id=q.id)
   then raise exception using errcode='23514',message='retirement request already decided'; end if;
  if kind='approve_retirement' then through_day:=(stamp at time zone 'Asia/Taipei')::date; end if;
 end if;
 perform private.assert_custom_lifecycle_authority(p_org,p_branch,true);
 insert into private.custom_form_lifecycle_events(organization_id,branch_id,form_version_id,action,request_id,new_version_id,actor_id,reason,effective_through,challenge_id,created_at)
  values(p_org,p_branch,v.id,kind,request_uuid,n.id,actor,reason,through_day,challenge,stamp) returning * into e;
 if kind='approve_retirement' then update public.form_versions set status='retired' where id=v.id; end if;
 insert into private.custom_form_lifecycle_receipts values(p_org,actor,p_key,h,e.id);
 insert into public.audit_events(organization_id,branch_id,actor_user_id,action,table_name,row_pk,changed_fields,metadata)
  values(p_org,p_branch,actor,'insert','custom_form_lifecycle',e.id::text,array['action'],jsonb_build_object('action',kind,'form_version_id',v.id));
 perform private.assert_custom_lifecycle_authority(p_org,p_branch,true);
 return jsonb_build_object('event',private.custom_form_lifecycle_event_json(e),'replayed',false);
end;$$;

create function private.read_custom_form_lifecycle_scoped(p_org uuid,p_branch uuid,p_version uuid)
returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare rows jsonb; total integer;
begin
 perform private.assert_custom_lifecycle_authority(p_org,p_branch,false);
 if not exists(select 1 from public.form_versions v join public.form_definitions d on d.id=v.form_definition_id
   where v.id=p_version and d.organization_id=p_org and not d.is_official and d.form_key like 'tenant.custom.%')
 then raise exception using errcode='42501',message='custom form outside governed scope'; end if;
 select count(*) into total from private.custom_form_lifecycle_events where organization_id=p_org and form_version_id=p_version;
 select coalesce(jsonb_agg(private.custom_form_lifecycle_event_json(e) order by e.created_at desc,e.id desc),'[]') into rows
  from(select * from private.custom_form_lifecycle_events where organization_id=p_org and form_version_id=p_version order by created_at desc,id desc limit 100)e;
 perform private.assert_custom_lifecycle_authority(p_org,p_branch,false);
 insert into public.audit_events(organization_id,branch_id,actor_user_id,action,table_name,row_pk,changed_fields,metadata)
  values(p_org,p_branch,auth.uid(),'select','custom_form_lifecycle',p_version::text,'{}',jsonb_build_object('count',jsonb_array_length(rows)));
 perform private.assert_custom_lifecycle_authority(p_org,p_branch,false);
 return jsonb_build_object('formVersionId',p_version,'events',rows,'total',total,'truncated',total>100);
end;$$;

create function public.write_custom_form_lifecycle(p_org uuid,p_branch uuid,p_key uuid,p_input jsonb)
returns jsonb language sql volatile security invoker set search_path='' as $$ select private.write_custom_form_lifecycle_atomic(p_org,p_branch,p_key,p_input); $$;
create function public.read_custom_form_lifecycle(p_org uuid,p_branch uuid,p_version uuid)
returns jsonb language sql volatile security invoker set search_path='' as $$ select private.read_custom_form_lifecycle_scoped(p_org,p_branch,p_version); $$;
revoke all on function private.has_live_custom_governance_scope(uuid,uuid),private.has_any_custom_governance_scope(),private.custom_governance_reauth_challenge(),private.assert_custom_lifecycle_authority(uuid,uuid,boolean),private.custom_form_lifecycle_event_json(private.custom_form_lifecycle_events),private.custom_form_effective_through(uuid,date),public.has_custom_form_governance_access(uuid,uuid,boolean) from public,anon,authenticated,service_role;
revoke all on function private.has_custom_governance_permission(uuid,uuid,text),private.has_recent_custom_governance_aal2(integer) from public,anon,authenticated,service_role;
grant execute on function private.assert_custom_lifecycle_authority(uuid,uuid,boolean),public.has_custom_form_governance_access(uuid,uuid,boolean) to authenticated;
revoke all on function public.write_custom_form_lifecycle(uuid,uuid,uuid,jsonb),public.read_custom_form_lifecycle(uuid,uuid,uuid),private.write_custom_form_lifecycle_atomic(uuid,uuid,uuid,jsonb),private.read_custom_form_lifecycle_scoped(uuid,uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.write_custom_form_lifecycle(uuid,uuid,uuid,jsonb),public.read_custom_form_lifecycle(uuid,uuid,uuid),private.write_custom_form_lifecycle_atomic(uuid,uuid,uuid,jsonb),private.read_custom_form_lifecycle_scoped(uuid,uuid,uuid) to authenticated;

-- Preserve historical hashes/dates. Only overlap and governance projections use
-- the explicit approved cutoff; old response schema snapshots remain untouched.
do $$ declare source text; changed text; signature text; begin
 source:=pg_get_functiondef('private.approve_form_publication_atomic(uuid,uuid,uuid,uuid)'::regprocedure);
 changed:=replace(source,'coalesce(other.effective_to, ''infinity''::date)','coalesce(private.custom_form_effective_through(other.id, other.effective_to), ''infinity''::date)');
 if changed=source then raise exception 'publication overlap anchor missing'; end if; execute changed;
 source:=pg_get_functiondef('private.approve_form_publication_atomic(uuid,uuid,uuid,uuid)'::regprocedure);
 changed:=replace(source,'and v_version.status = ''published''','and v_version.status in (''published'', ''retired'')');
 if changed=source then raise exception 'publication historical replay anchor missing'; end if; execute changed;
 source:=pg_get_functiondef('private.form_governance_snapshot_response(uuid,uuid)'::regprocedure);
 changed:=replace(source,E'      version.effective_to,',E'      private.custom_form_effective_through(version.id,version.effective_to) as effective_to,');
 if changed=source then raise exception 'governance cutoff anchor missing'; end if; execute changed;
 -- Only these form-governance RPCs acquire the narrowly scoped second-person
 -- authority; global permission, finance and clinical roots stay unchanged.
 foreach signature in array array['private.request_form_publication_atomic(uuid,uuid,uuid,uuid)',
  'private.approve_form_publication_atomic(uuid,uuid,uuid,uuid)','private.form_governance_snapshot_response(uuid,uuid)'] loop
  source:=pg_get_functiondef(signature::regprocedure);
  changed:=replace(replace(source,'private.has_permission(','private.has_custom_governance_permission('),'private.has_recent_aal2(','private.has_recent_custom_governance_aal2(');
  if changed=source then raise exception 'governance authority anchor missing'; end if;
  if signature like '%publication_atomic%' then
   changed:=replace(changed,'return query',E'perform private.assert_custom_lifecycle_authority(p_expected_organization_id,p_expected_branch_id,true);\n  return query');
  end if;
  execute changed;
 end loop;
 source:=pg_get_functiondef('private.can_begin_staff_mfa()'::regprocedure);
 changed:=replace(source,'if not private.is_executive_login_allowed() then return false; end if;',
  'if not (private.is_executive_login_allowed() or private.has_any_custom_governance_scope()) then return false; end if;');
 if changed=source then raise exception 'MFA admission anchor missing'; end if; execute changed;
 source:=pg_get_functiondef('private.record_aal2_reauth(uuid,text)'::regprocedure);
 changed:=replace(source,'(select private.is_active_user())','(select private.is_active_user() or private.has_any_custom_governance_scope())');
 changed:=replace(changed,E'  update private.reauth_challenges\n',E'  if not (private.is_active_user() or private.has_any_custom_governance_scope()) then return false; end if;\n  update private.reauth_challenges\n');
 if strpos(changed,E'  if not found\n     or v_factor_at')=0 then raise exception 'MFA lock freshness anchor missing'; end if;
 changed:=replace(changed,E'  if not found\n     or v_factor_at',E'  if not found\n     or v_challenge.expires_at <= clock_timestamp()\n     or v_challenge.invalidated_at is not null\n     or v_challenge.consumed_at is not null\n     or v_factor_at');
 changed:=replace(changed,E'    and consumed_at is null;',E'    and consumed_at is null and invalidated_at is null and expires_at > clock_timestamp();');
 if changed=source then raise exception 'MFA evidence anchor missing'; end if; execute changed;
 foreach signature in array array['private.save_custom_form_draft_atomic(uuid,uuid,uuid,integer,uuid,jsonb)', 'private.read_custom_form_draft_response(uuid,uuid,uuid)'] loop
  source:=pg_get_functiondef(signature::regprocedure);
  changed:=replace(source,'return jsonb_build_object(',format(E'perform private.assert_custom_form_authority(p_expected_organization_id,p_expected_branch_id,%s);\n return jsonb_build_object(',case when signature like '%save_%' then 'true' else 'false' end));
  if changed=source then raise exception 'draft post-audit authority anchor missing'; end if; execute changed;
 end loop;
end;$$;
commit;
