-- The care-diary workflow is append-only. Original and corrected signatures are
-- separate rows; submitted diary revisions are explicitly unsigned.
alter type public.record_status add value if not exists 'submitted';
alter type public.record_status add value if not exists 'corrected';
alter table public.care_records drop constraint care_records_signature_check;
alter table public.care_records add constraint care_records_signature_check check (
  ((status::text='draft' or (category='staff/daily-care/care-diary' and status::text='submitted'))
    and signed_at is null and signed_by is null and content_hash is null)
  or (status::text not in ('draft','submitted') and signed_at is not null and signed_by is not null
    and content_hash ~ '^[a-f0-9]{64}$' and char_length(btrim(signature_purpose))>0)
  or (category<>'staff/daily-care/care-diary' and status::text='submitted' and signed_at is not null
    and signed_by is not null and content_hash ~ '^[a-f0-9]{64}$' and char_length(btrim(signature_purpose))>0)
);

create table private.care_diary_operations (
  organization_id uuid not null references public.organizations(id),
  branch_id uuid not null references public.branches(id),
  actor_user_id uuid not null references auth.users(id),
  idempotency_key uuid not null,
  request_hash text not null check(request_hash ~ '^[a-f0-9]{64}$'),
  result_id uuid not null references public.care_records(id),
  created_at timestamptz not null default clock_timestamp(),
  primary key(organization_id,actor_user_id,idempotency_key)
);
-- Leading FK indexes also support branch-scoped audit and result lookups.
create index care_diary_operations_branch_idx on private.care_diary_operations(branch_id,organization_id,created_at desc);
create index care_diary_operations_actor_idx on private.care_diary_operations(actor_user_id,created_at desc);
create index care_diary_operations_result_idx on private.care_diary_operations(result_id);
alter table private.care_diary_operations enable row level security;
alter table private.care_diary_operations force row level security;
revoke all on private.care_diary_operations from public,anon,authenticated,service_role;

create function private.care_diary_fields_valid(p_fields jsonb) returns boolean
language plpgsql immutable security invoker set search_path='' as $$
declare v_key text; v_entry jsonb; v_state text;
begin
  if p_fields is null or jsonb_typeof(p_fields)<>'object'
    or not p_fields ?& array['shift','care_item','note','abnormal']
    or p_fields-array['shift','care_item','note','abnormal','follow_up','observations']<>'{}'::jsonb
    or coalesce(p_fields->>'shift','') not in ('morning','afternoon','full_day')
    or jsonb_typeof(p_fields->'care_item')<>'string' or char_length(btrim(p_fields->>'care_item')) not between 1 and 120
    or jsonb_typeof(p_fields->'note')<>'string' or char_length(p_fields->>'note')>2000
    or jsonb_typeof(p_fields->'abnormal')<>'boolean'
    or (p_fields?'follow_up' and (jsonb_typeof(p_fields->'follow_up')<>'string' or char_length(p_fields->>'follow_up')>1000)) then return false; end if;
  if not p_fields?'observations' then return true; end if;
  if jsonb_typeof(p_fields->'observations')<>'object'
    or not (p_fields->'observations') ?& array['meal','water','toileting','activity']
    or (p_fields->'observations')-array['meal','water','toileting','activity']<>'{}'::jsonb then return false; end if;
  foreach v_key in array array['meal','water','toileting','activity'] loop
    v_entry:=p_fields->'observations'->v_key; v_state:=v_entry->>'state';
    if jsonb_typeof(v_entry)<>'object' or coalesce(v_state,'') not in ('observed','unknown','not_applicable') then return false; end if;
    if v_state<>'observed' then
      if v_entry-array['state']<>'{}'::jsonb then return false; end if;
    else
      if not v_entry?'value' or v_entry-array['state','value']<>'{}'::jsonb then return false; end if;
      if v_key='water' then
        if jsonb_typeof(v_entry->'value')<>'number' or (v_entry->>'value')::numeric not between 0 and 5000
          or trunc((v_entry->>'value')::numeric)<>(v_entry->>'value')::numeric then return false; end if;
      elsif jsonb_typeof(v_entry->'value')<>'string' or
        (v_key='meal' and (v_entry->>'value') not in ('none','quarter','half','three_quarters','all')) or
        (v_key='toileting' and (v_entry->>'value') not in ('independent','assisted','not_needed','concern')) or
        (v_key='activity' and (v_entry->>'value') not in ('participated','partial','declined','resting')) then return false; end if;
    end if;
  end loop;
  return true;
end; $$;

create function private.care_diary_record_json(p_row public.care_records) returns jsonb
language sql stable security invoker set search_path='' as $$
select jsonb_build_object('id',p_row.id,'record_key',p_row.record_key,'version',p_row.version,
  'client_id',p_row.client_id,'status',p_row.status,'occurred_at',p_row.occurred_at,
  'fields',p_row.data->'fields','previous_version_id',p_row.previous_version_id,
  'correction_reason',p_row.correction_reason,'signed_at',p_row.signed_at,'signed_by',p_row.signed_by,
  'content_hash',p_row.content_hash,'created_by',p_row.created_by,'created_at',p_row.created_at,
  'correction_source_id',p_row.data->'correction_source_id');
$$;

create function private.care_diary_lifecycle_atomic(
 p_expected_organization_id uuid,p_expected_branch_id uuid,p_action text,
 p_record_id uuid,p_base_version integer,p_fields jsonb,p_reason text,p_idempotency_key uuid
) returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare v_actor uuid:=auth.uid(); v_previous public.care_records%rowtype;
 v_result public.care_records%rowtype; v_operation private.care_diary_operations%rowtype;
 v_permission text; v_hash text; v_status public.record_status; v_data jsonb;
 v_now timestamptz; v_challenge uuid; v_reason text; v_signed_at timestamptz; v_signed_by uuid;
 v_content_hash text; v_roles jsonb;
begin
 if v_actor is null or p_expected_organization_id is null or p_expected_branch_id is null
   or p_record_id is null or p_idempotency_key is null or p_base_version is null or p_base_version<1
   or p_action is null or p_action not in ('edit','submit','sign','correct','reopen') then
   raise exception using errcode='22023',message='invalid diary operation'; end if;
 v_permission:=case when p_action='sign' then 'care_records.sign' else 'care_records.write' end;
 if coalesce(auth.jwt()->>'aal','')<>'aal2' or not private.has_permission(p_expected_organization_id,p_expected_branch_id,v_permission)
   or not private.has_permission(p_expected_organization_id,p_expected_branch_id,'care_records.read') then
   raise exception using errcode='42501',message='diary operation is not permitted'; end if;
 select * into v_previous from public.care_records r where r.id=p_record_id
  and r.organization_id=p_expected_organization_id and r.branch_id=p_expected_branch_id
  and r.category='staff/daily-care/care-diary';
 if not found or not private.can_staff_access_client(v_previous.client_id,v_permission)
  or not private.can_staff_access_client(v_previous.client_id,'care_records.read') then
  raise exception using errcode='42501',message='diary operation is not permitted'; end if;
 if p_action='edit' and not private.care_diary_fields_valid(p_fields) then
  raise exception using errcode='22023',message='invalid diary fields'; end if;
 if p_action<>'edit' and p_fields is not null then raise exception using errcode='22023',message='unexpected diary fields'; end if;
 if p_action in ('correct','reopen') and (p_reason is null or char_length(btrim(p_reason)) not between 1 and 1000) then
  raise exception using errcode='22023',message='correction reason is required'; end if;
 v_hash:=encode(sha256(convert_to(jsonb_build_object('action',p_action,'id',p_record_id,'base_version',p_base_version,
  'fields',p_fields,'reason',p_reason,'branch',p_expected_branch_id)::text,'UTF8')),'hex');
 perform pg_advisory_xact_lock(hashtextextended('diary-op:'||p_expected_organization_id||':'||v_actor||':'||p_idempotency_key,0));
 select * into v_operation from private.care_diary_operations o where o.organization_id=p_expected_organization_id
  and o.actor_user_id=v_actor and o.idempotency_key=p_idempotency_key;
 if found then
  if v_operation.request_hash<>v_hash or v_operation.branch_id<>p_expected_branch_id then
    raise exception using errcode='23505',message='diary idempotency conflict'; end if;
  select * into strict v_result from public.care_records where id=v_operation.result_id;
  return jsonb_build_object('record',private.care_diary_record_json(v_result),'replayed',true);
 end if;
 perform pg_advisory_xact_lock(hashtextextended('diary-record:'||v_previous.organization_id||':'||v_previous.record_key,0));
 if v_previous.version<>p_base_version or exists(select 1 from public.care_records r
   where r.organization_id=v_previous.organization_id and r.record_key=v_previous.record_key and r.version>p_base_version) then
   raise exception using errcode='40001',message='diary version conflict'; end if;
 if (p_action='edit' and v_previous.status<>'draft') or (p_action='submit' and v_previous.status<>'draft')
   or (p_action='sign' and v_previous.status<>'submitted') or (p_action='correct' and v_previous.status not in ('signed','corrected'))
   or (p_action='reopen' and v_previous.status<>'submitted') then
   raise exception using errcode='23514',message='diary transition is not permitted'; end if;
 v_now:=clock_timestamp();
 if p_action='edit' then v_data:=jsonb_build_object('fields',p_fields); v_status:='draft'; v_reason:='草稿修訂';
 elsif p_action='correct' then
   -- This is a correction to the SAME event, not a new observation. Keep content
   -- for explicit review, clear signatures and retain the signed source link.
   v_data:=jsonb_build_object('fields',v_previous.data->'fields','correction_source_id',v_previous.id);
   v_status:='draft'; v_reason:=btrim(p_reason);
 elsif p_action='reopen' then
   v_data:=v_previous.data-'_request'; v_status:='draft'; v_reason:=btrim(p_reason);
 else
   v_data:=v_previous.data-'_request';
   if not private.care_diary_fields_valid(v_data->'fields') or
      (coalesce(btrim(v_data->'fields'->>'note'),'')='' and not exists(select 1
        from jsonb_each(coalesce(v_data->'fields'->'observations','{}'::jsonb)) observed where observed.value->>'state'='observed')) or
      ((v_data->'fields'->>'abnormal')::boolean and coalesce(btrim(v_data->'fields'->>'follow_up'),'')='') or
      (v_data->'fields'->'observations'->'toileting'->>'state'='observed'
       and v_data->'fields'->'observations'->'toileting'->>'value'='concern'
       and (coalesce(btrim(v_data->'fields'->>'note'),'')=''
         or coalesce(btrim(v_data->'fields'->>'follow_up'),'')=''
         or v_data->'fields'->'abnormal' is distinct from 'true'::jsonb)) then
     raise exception using errcode='23514',message='diary completion fields are missing'; end if;
   v_status:=case when p_action='submit' then 'submitted'::public.record_status
     when v_data?'correction_source_id' then 'corrected'::public.record_status else 'signed'::public.record_status end;
   v_reason:=case when p_action='submit' then '提交確認' else '本人確認簽署' end;
 end if;
 if p_action='edit' and v_previous.data?'correction_source_id' then v_data:=v_data||jsonb_build_object('correction_source_id',v_previous.data->'correction_source_id'); end if;
 if p_action='sign' then
  v_challenge:=private.require_case_service_record_reauth(v_actor,v_now);
  select coalesce(jsonb_agg(distinct role.role_key),'[]'::jsonb) into v_roles
   from public.memberships membership join public.membership_roles assigned on assigned.membership_id=membership.id
   join public.roles role on role.id=assigned.role_id where membership.profile_id=v_actor
   and membership.organization_id=p_expected_organization_id and membership.status='active'
   and membership.starts_at<=v_now and (membership.ends_at is null or membership.ends_at>v_now)
   and (membership.branch_id is null or membership.branch_id=p_expected_branch_id)
   and role.is_active and assigned.assigned_at<=v_now
   and (role.organization_id is null or role.organization_id=p_expected_organization_id);
  v_data:=v_data||jsonb_build_object('signature_evidence',jsonb_build_object('challenge_id',v_challenge,
    'aal','aal2','verified',true,'roles',v_roles,'purpose','本人確認本次照顧觀察與處置'));
  v_signed_at:=v_now; v_signed_by:=v_actor;
  v_content_hash:=encode(sha256(convert_to(jsonb_build_object('client_id',v_previous.client_id,
    'occurred_at',v_previous.occurred_at,'version',v_previous.version+1,'data',v_data)::text,'UTF8')),'hex');
 end if;
 insert into public.care_records(organization_id,branch_id,client_id,record_key,version,previous_version_id,
  category,status,occurred_at,data,source_system,created_by,correction_reason,signed_at,signed_by,signature_purpose,content_hash)
 values(v_previous.organization_id,v_previous.branch_id,v_previous.client_id,v_previous.record_key,v_previous.version+1,v_previous.id,
  v_previous.category,v_status,v_previous.occurred_at,v_data,'local',v_actor,v_reason,v_signed_at,v_signed_by,
  case when p_action='sign' then '本人確認本次照顧觀察與處置' end,v_content_hash) returning * into v_result;
 insert into private.care_diary_operations(organization_id,branch_id,actor_user_id,idempotency_key,request_hash,result_id)
 values(p_expected_organization_id,p_expected_branch_id,v_actor,p_idempotency_key,v_hash,v_result.id);
 return jsonb_build_object('record',private.care_diary_record_json(v_result),'replayed',false);
end; $$;

create function public.mutate_care_diary(p_expected_organization_id uuid,p_expected_branch_id uuid,p_action text,
 p_record_id uuid,p_base_version integer,p_fields jsonb,p_reason text,p_idempotency_key uuid)
returns jsonb language sql volatile security invoker set search_path='' as $$
 select private.care_diary_lifecycle_atomic(p_expected_organization_id,p_expected_branch_id,p_action,p_record_id,p_base_version,p_fields,p_reason,p_idempotency_key);
$$;

create function private.care_diary_snapshot(p_expected_organization_id uuid,p_expected_branch_id uuid,p_client_id uuid)
returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare v_records jsonb; v_history jsonb;
begin
 if auth.uid() is null or not private.has_permission(p_expected_organization_id,p_expected_branch_id,'care_records.read')
  or not private.can_staff_access_client(p_client_id,'care_records.read') or not exists(select 1 from public.clients
   where id=p_client_id and organization_id=p_expected_organization_id and branch_id=p_expected_branch_id) then
   raise exception using errcode='42501',message='diary read is not permitted'; end if;
 select coalesce(jsonb_agg(private.care_diary_record_json(r) order by r.occurred_at desc,r.version desc),'[]'::jsonb) into v_records
 from public.care_records r where r.organization_id=p_expected_organization_id and r.branch_id=p_expected_branch_id
  and r.client_id=p_client_id and r.category='staff/daily-care/care-diary'
  and not exists(select 1 from public.care_records n where n.organization_id=r.organization_id and n.record_key=r.record_key and n.version>r.version);
 select coalesce(jsonb_agg(jsonb_build_object('id',r.id,'record_key',r.record_key,'version',r.version,'status',r.status,
  'previous_version_id',r.previous_version_id,'created_at',r.created_at,'correction_reason',r.correction_reason,
  'signed_at',r.signed_at,'signed_by',r.signed_by,'content_hash',r.content_hash) order by r.created_at,r.version),'[]'::jsonb) into v_history
 from public.care_records r where r.organization_id=p_expected_organization_id and r.branch_id=p_expected_branch_id
  and r.client_id=p_client_id and r.category='staff/daily-care/care-diary';
 insert into public.audit_events(organization_id,branch_id,actor_user_id,action,table_name,metadata)
 values(p_expected_organization_id,p_expected_branch_id,auth.uid(),'select','public.care_records',jsonb_build_object('operation','diary_lifecycle_snapshot'));
 return jsonb_build_object('records',v_records,'history',v_history);
end; $$;
create function public.care_diary_snapshot(p_expected_organization_id uuid,p_expected_branch_id uuid,p_client_id uuid)
returns jsonb language sql volatile security invoker set search_path='' as $$
 select private.care_diary_snapshot(p_expected_organization_id,p_expected_branch_id,p_client_id);
$$;

-- Preserve the original positional RPC for legacy/offline payloads. The new
-- wrapper adds optional structured observations within the same transaction.
create function private.record_care_diary_quick_draft(p_expected_organization_id uuid,p_expected_branch_id uuid,
 p_client_id uuid,p_occurred_at timestamptz,p_fields jsonb,p_idempotency_key uuid)
returns table(id uuid,version integer,status public.record_status,replayed boolean)
language plpgsql volatile security definer set search_path='' as $$
declare v_result record; v_existing jsonb;
begin
 if not private.care_diary_fields_valid(p_fields) then raise exception using errcode='22023',message='invalid diary fields'; end if;
 select * into v_result from private.record_care_diary_draft_atomic(p_expected_organization_id,p_expected_branch_id,p_client_id,
  p_occurred_at,p_fields->>'shift',p_fields->>'care_item',p_fields->>'note',(p_fields->>'abnormal')::boolean,p_fields->>'follow_up',p_idempotency_key);
 select data->'fields'->'observations' into v_existing from public.care_records r where r.id=v_result.id;
 if v_result.replayed then
  if v_existing is distinct from p_fields->'observations' then raise exception using errcode='23505',message='diary idempotency conflict'; end if;
 elsif p_fields?'observations' then
  update public.care_records r set data=jsonb_set(r.data,'{fields,observations}',p_fields->'observations') where r.id=v_result.id;
 end if;
 return query select v_result.id,v_result.version,v_result.status,v_result.replayed;
end; $$;
create function public.record_care_diary_quick_draft(p_expected_organization_id uuid,p_expected_branch_id uuid,
 p_client_id uuid,p_occurred_at timestamptz,p_fields jsonb,p_idempotency_key uuid)
returns table(id uuid,version integer,status public.record_status,replayed boolean)
language sql volatile security invoker set search_path='' as $$
 select * from private.record_care_diary_quick_draft(p_expected_organization_id,p_expected_branch_id,p_client_id,p_occurred_at,p_fields,p_idempotency_key);
$$;

revoke all on function private.care_diary_fields_valid(jsonb),private.care_diary_record_json(public.care_records) from public,anon,authenticated,service_role;
revoke all on function private.care_diary_lifecycle_atomic(uuid,uuid,text,uuid,integer,jsonb,text,uuid),public.mutate_care_diary(uuid,uuid,text,uuid,integer,jsonb,text,uuid),
 private.care_diary_snapshot(uuid,uuid,uuid),public.care_diary_snapshot(uuid,uuid,uuid),
 private.record_care_diary_quick_draft(uuid,uuid,uuid,timestamptz,jsonb,uuid),public.record_care_diary_quick_draft(uuid,uuid,uuid,timestamptz,jsonb,uuid)
 from public,anon,authenticated,service_role;
grant execute on function private.care_diary_lifecycle_atomic(uuid,uuid,text,uuid,integer,jsonb,text,uuid),public.mutate_care_diary(uuid,uuid,text,uuid,integer,jsonb,text,uuid),
 private.care_diary_snapshot(uuid,uuid,uuid),public.care_diary_snapshot(uuid,uuid,uuid),
 private.record_care_diary_quick_draft(uuid,uuid,uuid,timestamptz,jsonb,uuid),public.record_care_diary_quick_draft(uuid,uuid,uuid,timestamptz,jsonb,uuid)
 to authenticated;

-- Page 54 already excludes parent revisions. Extend that same frozen snapshot
-- formula to independently signed corrections and the canonical abnormal field.
do $$ declare definition text; begin
 select pg_get_functiondef('private.daily_service_summary_payload_v2(uuid,uuid,date,uuid,text,timestamptz)'::regprocedure) into definition;
 definition:=replace(definition,'count(*) filter(where status=''signed'')::bigint completed_count,',
   'count(*) filter(where status::text in (''signed'',''corrected'') and signed_at is not null)::bigint completed_count,');
 definition:=replace(definition,'count(*) filter(where status<>''signed'')::bigint pending_count,',
   'count(*) filter(where status::text not in (''signed'',''corrected''))::bigint pending_count,');
 definition:=replace(definition,'coalesce((data->>''hasAbnormalFlag'')::boolean,false)',
   'coalesce((data->''fields''->>''abnormal'')::boolean,(data->>''hasAbnormalFlag'')::boolean,false)');
 execute definition;
end $$;
