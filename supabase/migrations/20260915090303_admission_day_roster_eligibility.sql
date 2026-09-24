begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

-- A client card is not an admission. Reconstruct the requested service day from
-- explicit admission dates and immutable effective-dated lifecycle events.
-- End/suspension dates are inclusive blocking boundaries. No transition is
-- inserted and no existing client status/date is silently changed.
create function private.client_service_state_on(p_client uuid,p_date date)
returns text language plpgsql stable security definer set search_path='' as $$
declare c public.clients; v_state public.client_status;
begin
 if p_date is null or not isfinite(p_date) or p_date<date '2000-01-01' or p_date>date '2100-01-01' then
  raise exception using errcode='22023',message='invalid client service date';end if;
 select * into c from public.clients where id=p_client;
 if not found then return 'inactive';end if;
 if c.admitted_on is null or p_date<c.admitted_on then return 'not_admitted';end if;
 if c.ended_on is not null and p_date>=c.ended_on then return 'inactive';end if;
 select t.to_status into v_state from public.client_transitions t
 where t.client_id=p_client and t.organization_id=c.organization_id and t.branch_id=c.branch_id and t.effective_on<=p_date
 order by t.effective_on desc,t.resulting_row_version desc limit 1;
 if not found then
  -- Legacy admitted clients may have an initial suspend/close event but no
  -- earlier admit event. Its immutable from_status establishes that interval.
  select t.from_status into v_state from public.client_transitions t
  where t.client_id=p_client and t.organization_id=c.organization_id and t.branch_id=c.branch_id
  order by t.effective_on,t.resulting_row_version limit 1;
  if not found then v_state:=c.status;end if;
 end if;
 return case when v_state='active' then 'eligible' else 'inactive' end;
end;$$;
create index client_transitions_service_day_idx on public.client_transitions(client_id,effective_on desc,resulting_row_version desc);

create function private.assert_care_roster_authority(p_org uuid,p_branch uuid,p_client uuid default null)
returns void language plpgsql volatile security definer set search_path='' as $$
begin
 if auth.uid() is null or not private.has_recent_aal2(15)
  or not private.has_permission(p_org,p_branch,'staff_scheduling.manage')
  or not private.has_permission(p_org,p_branch,'clients.view_all')
  or not private.has_permission(p_org,p_branch,'clients.read')
  or not exists(select 1 from public.organizations o join public.branches b on b.organization_id=o.id and b.is_active
   where o.id=p_org and o.is_active and b.id=p_branch)
  or (p_client is not null and (not exists(select 1 from public.clients where id=p_client and organization_id=p_org and branch_id=p_branch)
   or not private.can_staff_access_client(p_client,'clients.read')))
 then raise exception using errcode='42501',message='daily allocation is not permitted';end if;
end;$$;

create function private.care_roster_target_authorized(p_org uuid,p_branch uuid,p_client uuid,p_staff uuid,p_from timestamptz,p_to timestamptz)
returns boolean language sql volatile security definer set search_path='' as $$
 select p_staff is null or exists(
  select 1 from public.memberships m join public.profiles p on p.id=m.profile_id and p.is_active and p.kind='staff'
  join public.membership_roles mr on mr.membership_id=m.id and mr.assigned_at<=clock_timestamp()
  join public.roles r on r.id=mr.role_id and r.is_active
  join public.role_permissions rp on rp.role_id=r.id and rp.granted_at<=clock_timestamp()
  join public.permissions permission on permission.id=rp.permission_id
  where m.profile_id=p_staff and m.organization_id=p_org and (m.branch_id is null or m.branch_id=p_branch)
   and m.status='active' and m.starts_at<=p_from and (m.ends_at is null or m.ends_at>=p_to)
   and (r.organization_id is null or r.organization_id=p_org) and permission.permission_key='clients.read'
   and (exists(select 1 from public.role_permissions rp2 join public.permissions p2 on p2.id=rp2.permission_id
    where rp2.role_id=r.id and rp2.granted_at<=clock_timestamp() and p2.permission_key='clients.view_all')
    or exists(select 1 from public.client_assignments a where a.client_id=p_client and a.organization_id=p_org and a.branch_id=p_branch
     and a.assignee_user_id=p_staff and a.starts_at<=p_from and (a.ends_at is null or a.ends_at>=p_to)))
 );
$$;

create or replace function private.save_care_roster_guarded(p_organization_id uuid,p_branch_id uuid,p_input jsonb)
returns table(receipt jsonb) language plpgsql volatile security definer set search_path='' as $$
declare v_actor uuid:=auth.uid();v_client uuid;v_staff uuid;v_date date;v_shift text;
 v_expected integer;v_version integer;v_hash text;v_key uuid;v_previous private.care_roster_operations;
 v_id uuid;v_receipt jsonb;v_from timestamptz;v_to timestamptz;v_eligibility text;
begin
 perform private.assert_care_roster_authority(p_organization_id,p_branch_id,null);
 if jsonb_typeof(p_input) is distinct from 'object'
   or not (p_input ?& array['clientId','staffUserId','serviceDate','shift','expectedVersion','state','sourceNote','tasks','approved','idempotency_key'])
   or p_input-array['clientId','staffUserId','serviceDate','shift','expectedVersion','state','sourceNote','tasks','approved','idempotency_key']<>'{}'::jsonb
   or p_input->'approved' is distinct from 'true'::jsonb
   or jsonb_typeof(p_input->'clientId') is distinct from 'string'
   or jsonb_typeof(p_input->'serviceDate') is distinct from 'string'
   or jsonb_typeof(p_input->'idempotency_key') is distinct from 'string'
   or jsonb_typeof(p_input->'staffUserId') not in ('null','string')
   or jsonb_typeof(p_input->'expectedVersion') is distinct from 'number'
   or coalesce(p_input->>'expectedVersion','')!~'^[0-9]{1,7}$'
   or coalesce(p_input->>'serviceDate','')!~'^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
   or jsonb_typeof(p_input->'shift') is distinct from 'string'
   or jsonb_typeof(p_input->'state') is distinct from 'string'
   or jsonb_typeof(p_input->'sourceNote') is distinct from 'string'
   or p_input->>'shift' not in ('morning','afternoon')
   or p_input->>'state' not in ('scheduled','cancelled')
   or char_length(btrim(p_input->>'sourceNote')) not between 3 and 300
   or (p_input->>'sourceNote') ~ '[[:cntrl:]]'
   or jsonb_typeof(p_input->'tasks') is distinct from 'array'
   or jsonb_array_length(p_input->'tasks')>5 then
  raise exception using errcode='22023',message='invalid daily allocation'; end if;
 if exists(select 1 from jsonb_array_elements(p_input->'tasks') t where jsonb_typeof(t)<>'string' or t#>>'{}' not in ('temperature','pulse','blood_pressure','oxygen_saturation','care_diary'))
   or (select count(*)<>count(distinct t) from jsonb_array_elements(p_input->'tasks') t) then
  raise exception using errcode='22023',message='invalid daily task'; end if;
 v_client:=(p_input->>'clientId')::uuid; v_staff:=(p_input->>'staffUserId')::uuid;
 v_date:=(p_input->>'serviceDate')::date; v_shift:=p_input->>'shift';
 v_expected:=(p_input->>'expectedVersion')::integer; v_key:=(p_input->>'idempotency_key')::uuid;
 if v_client is null or v_date is null or v_expected is null or v_expected<0 or v_key is null
   or v_expected>1000000 or v_date<date '2000-01-01' or v_date>date '2100-01-01'
   or to_char(v_date,'YYYY-MM-DD')<>p_input->>'serviceDate' then raise exception using errcode='22023',message='invalid allocation key'; end if;
 v_from:=(v_date::text||case when v_shift='morning' then ' 00:00:00' else ' 12:00:00' end)::timestamp at time zone 'Asia/Taipei';
 v_to:=v_from+interval '12 hours';

 perform private.assert_care_roster_authority(p_organization_id,p_branch_id,v_client);
 v_hash:=encode(sha256(convert_to(jsonb_build_object('branch',p_branch_id,'input',p_input)::text,'UTF8')),'hex');
 perform pg_advisory_xact_lock(hashtextextended(p_organization_id::text||v_actor::text||v_key::text,0));
 perform private.assert_care_roster_authority(p_organization_id,p_branch_id,v_client);
 select * into v_previous from private.care_roster_operations where organization_id=p_organization_id and actor_id=v_actor and idempotency_key=v_key;
 if found then
  if v_previous.input_hash<>v_hash then raise exception using errcode='23505',message='operation key conflict';end if;
  -- Receipt proves the original operation, not current service eligibility.
  return query select v_previous.receipt||jsonb_build_object('replayed',true);return;
 end if;
 -- Lifecycle RPCs lock this same row before appending a transition. A roster
 -- waiting behind suspension/closure must observe the committed effective state.
 perform 1 from public.clients where id=v_client and organization_id=p_organization_id and branch_id=p_branch_id for update;
 perform private.assert_care_roster_authority(p_organization_id,p_branch_id,v_client);
 perform pg_advisory_xact_lock(hashtextextended(v_client::text||v_date::text||v_shift,0));
 perform private.assert_care_roster_authority(p_organization_id,p_branch_id,v_client);
 select coalesce(max(version),0) into v_version from private.care_roster_versions where client_id=v_client and service_date=v_date and shift=v_shift;
 if v_version<>v_expected then raise exception using errcode='40001',message='allocation version changed';end if;
 v_eligibility:=private.client_service_state_on(v_client,v_date);
 if p_input->>'state'='scheduled' then
  if v_eligibility<>'eligible' then raise exception using errcode='23514',message='client is not admitted for this service date';end if;
  if not private.care_roster_target_authorized(p_organization_id,p_branch_id,v_client,v_staff,v_from,v_to) then
   raise exception using errcode='42501',message='staff does not already have client authorization';end if;
 elsif v_version=0 then
  raise exception using errcode='22023',message='cancellation requires an existing allocation';
 end if;
 insert into private.care_roster_versions(organization_id,branch_id,client_id,service_date,shift,staff_user_id,version,state,source_note,tasks,created_by)
 values(p_organization_id,p_branch_id,v_client,v_date,v_shift,v_staff,v_version+1,p_input->>'state',btrim(p_input->>'sourceNote'),p_input->'tasks',v_actor) returning id into v_id;
 v_receipt:=jsonb_build_object('id',v_id,'clientId',v_client,'serviceDate',v_date,'shift',v_shift,'version',v_version+1,'replayed',false);
 insert into private.care_roster_operations values(p_organization_id,v_actor,v_key,v_hash,v_receipt);
 insert into public.audit_events(organization_id,branch_id,actor_user_id,action,table_name,row_pk,changed_fields,metadata)
 values(p_organization_id,p_branch_id,v_actor,'insert','care_roster_versions',v_id::text,array['allocation'],jsonb_build_object('version',v_version+1,'task_count',jsonb_array_length(p_input->'tasks')));
 return query select v_receipt;
end;
$$;



-- These functions keep their public wire contracts; only eligibility/state
-- overlays and live active-organization checks change. Validate anchors before
-- replacing the reviewed baseline body, so an unexpected version fails atomically.
do $$ declare source text;old_fragment text;new_fragment text;begin
 source:=pg_get_functiondef('private.client_weekly_days(uuid,date,integer)'::regprocedure);
 old_fragment:='v_rows jsonb:=''[]''; v_i integer;';
 if position(old_fragment in source)=0 then raise exception 'weekly state declaration anchor missing';end if;
 source:=replace(source,old_fragment,'v_rows jsonb:=''[]''; v_i integer;v_service_state text;');
 old_fragment:='if v_c.status<>''active'' or (v_c.ended_on is not null and v_date>v_c.ended_on) then v_state:=''inactive''; v_day:=null;'||chr(10)||
  '  elsif v_c.admitted_on is null or v_date<v_c.admitted_on then v_state:=''not_admitted''; v_day:=null;';
 if position(old_fragment in source)=0 then raise exception 'weekly service eligibility anchor missing';end if;
 new_fragment:='v_service_state:=private.client_service_state_on(p_client,v_date);'||chr(10)||
  '  if v_service_state<>''eligible'' then v_state:=v_service_state;v_day:=null;';
 source:=replace(source,old_fragment,new_fragment);
 execute source;

 source:=pg_get_functiondef('private.care_roster_snapshot_guarded(uuid,uuid,date)'::regprocedure);
 old_fragment:='if auth.uid() is null or p_service_date is null';
 if position(old_fragment in source)=0 then raise exception 'roster snapshot scope anchor missing';end if;
 source:=replace(source,old_fragment,'if auth.uid() is null or p_service_date is null or not isfinite(p_service_date) or p_service_date<date ''2000-01-01'' or p_service_date>date ''2100-01-01'''||chr(10)||
  ' or not exists(select 1 from public.organizations where id=p_organization_id and is_active)');
 old_fragment:='select r.*,p.display_name as staff_name';
 if position(old_fragment in source)=0 then raise exception 'roster row eligibility anchor missing';end if;
 source:=replace(source,old_fragment,old_fragment||',private.client_service_state_on(r.client_id,p_service_date) as service_eligibility');
 old_fragment:='where (v_manager or r.staff_user_id=auth.uid()) and private.care_roster_can_read(r.client_id,''clients.read'')';
 if position(old_fragment in source)=0 then raise exception 'roster worker eligibility anchor missing';end if;
 source:=replace(source,old_fragment,old_fragment||chr(10)||' and (v_manager or private.client_service_state_on(r.client_id,p_service_date)=''eligible'')');
 old_fragment:='v_access:=private.care_roster_can_read(v_r.client_id,case when v_kind=''care_diary''';
 if position(old_fragment in source)=0 then raise exception 'roster blocked evidence anchor missing';end if;
 source:=replace(source,old_fragment,'v_access:=v_r.service_eligibility=''eligible'' and private.care_roster_can_read(v_r.client_id,case when v_kind=''care_diary''');
 old_fragment:='''sourceNote'',v_r.source_note,''tasks'',v_tasks';
 if position(old_fragment in source)=0 then raise exception 'roster eligibility response anchor missing';end if;
 source:=replace(source,old_fragment,old_fragment||',''isServiceEligible'',v_r.service_eligibility=''eligible'',''serviceEligibility'',v_r.service_eligibility');
 execute source;

 source:=pg_get_functiondef('private.client_weekly_snapshot_guarded(uuid,uuid,uuid,date)'::regprocedure);
 old_fragment:='if auth.uid() is null or p_from is null';
 if position(old_fragment in source)=0 then raise exception 'weekly snapshot organization anchor missing';end if;
 source:=replace(source,old_fragment,'if not exists(select 1 from public.organizations where id=p_organization_id and is_active) or auth.uid() is null or p_from is null');
 execute source;
 source:=pg_get_functiondef('private.client_weekly_projection_guarded(uuid,uuid,date)'::regprocedure);
 old_fragment:='if auth.uid() is null or p_date is null';
 if position(old_fragment in source)=0 then raise exception 'weekly projection organization anchor missing';end if;
 source:=replace(source,old_fragment,'if not exists(select 1 from public.organizations where id=p_organization_id and is_active) or auth.uid() is null or p_date is null');
 execute source;
end;$$;

revoke all on function private.client_service_state_on(uuid,date),private.assert_care_roster_authority(uuid,uuid,uuid),
 private.care_roster_target_authorized(uuid,uuid,uuid,uuid,timestamptz,timestamptz) from public,anon,authenticated,service_role;
comment on function private.client_service_state_on(uuid,date) is 'Effective-day eligibility for planning only; never creates admission, attendance, clinical evidence, qualifications or a claim.';
commit;
