begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

-- Institution-only, bounded form authoring. No formula interpreter, clinical
-- scoring, official namespace authoring, direct DML, or publication bypass.
alter table public.form_versions add column draft_revision integer not null default 1
  check (draft_revision > 0);

create table private.custom_form_draft_receipts (
  organization_id uuid not null references public.organizations(id) on delete restrict,
  branch_id uuid not null,
  actor_id uuid not null references auth.users(id) on delete restrict,
  idempotency_key uuid not null,
  request_hash text not null check (request_hash ~ '^[a-f0-9]{64}$'),
  form_version_id uuid not null references public.form_versions(id) on delete restrict,
  definition_id uuid not null references public.form_definitions(id) on delete restrict,
  revision integer not null check (revision > 0),
  created_at timestamptz not null default clock_timestamp(),
  primary key (organization_id, actor_id, idempotency_key),
  foreign key (branch_id, organization_id) references public.branches(id, organization_id) on delete restrict
);
create index custom_form_draft_receipts_version_idx on private.custom_form_draft_receipts(form_version_id);
create index custom_form_draft_receipts_definition_idx on private.custom_form_draft_receipts(definition_id);
create index custom_form_draft_receipts_branch_idx on private.custom_form_draft_receipts(branch_id,organization_id);
create index custom_form_draft_receipts_actor_idx on private.custom_form_draft_receipts(actor_id);
alter table private.custom_form_draft_receipts enable row level security;
alter table private.custom_form_draft_receipts force row level security;
revoke all on private.custom_form_draft_receipts from public, anon, authenticated, service_role;

create function private.custom_form_plain_text(p_value jsonb,p_max integer)
returns boolean language sql immutable security invoker set search_path='' as $$
 select coalesce(jsonb_typeof(p_value)='string'
   and length(p_value #>> '{}') between 1 and p_max
   and btrim(p_value #>> '{}')=(p_value #>> '{}')
   and (p_value #>> '{}') !~ '[<>[:cntrl:]]',false);
$$;

create function private.validate_custom_form_payload(p_payload jsonb)
returns void language plpgsql immutable security invoker set search_path='' as $$
declare f jsonb; o jsonb; keys text[]:='{}'; opts text[]; field_type text; from_date date; to_date date;
begin
 if p_payload is null or octet_length(p_payload::text)>65536
   or jsonb_typeof(p_payload) is distinct from 'object'
   or p_payload - array['formKey','name','category','effectiveFrom','effectiveTo','schema'] <> '{}'::jsonb
   or not (p_payload ?& array['formKey','name','category','effectiveFrom','effectiveTo','schema'])
   or not coalesce((p_payload->>'formKey') ~ '^tenant\.custom\.[a-z][a-z0-9_]{1,59}$',false)
   or not private.custom_form_plain_text(p_payload->'name',120)
   or not coalesce(p_payload->>'category' in ('照顧表單','品質表單','行政表單'),false)
   or jsonb_typeof(p_payload->'schema') is distinct from 'object'
   or (p_payload->'schema') - array['builder','fields'] <> '{}'::jsonb
   or p_payload->'schema'->>'builder' is distinct from 'tenant-custom.v1'
   or jsonb_typeof(p_payload->'schema'->'fields') is distinct from 'array'
 then raise exception using errcode='22023',message='invalid custom form payload'; end if;
 if jsonb_array_length(p_payload->'schema'->'fields') not between 1 and 40
 then raise exception using errcode='22023',message='custom forms require one to forty fields'; end if;
 begin
  if p_payload->'effectiveFrom' <> 'null'::jsonb then
   if jsonb_typeof(p_payload->'effectiveFrom') <> 'string' or (p_payload->>'effectiveFrom') !~ '^\d{4}-\d{2}-\d{2}$' then raise exception 'invalid date'; end if;
   from_date := (p_payload->>'effectiveFrom')::date;
   if from_date not between date '1900-01-01' and date '2200-12-31' then raise exception 'invalid date'; end if;
  end if;
  if p_payload->'effectiveTo' <> 'null'::jsonb then
   if jsonb_typeof(p_payload->'effectiveTo') <> 'string' or (p_payload->>'effectiveTo') !~ '^\d{4}-\d{2}-\d{2}$' then raise exception 'invalid date'; end if;
   to_date := (p_payload->>'effectiveTo')::date;
   if from_date is null or to_date < from_date or to_date > date '2200-12-31' then raise exception 'invalid date'; end if;
  end if;
 exception when others then raise exception using errcode='22023',message='invalid custom form period'; end;
 for f in select value from jsonb_array_elements(p_payload->'schema'->'fields') loop
  field_type:=f->>'type';
  if jsonb_typeof(f) is distinct from 'object'
    or not (f ?& array['key','label','required','type'])
    or not coalesce((f->>'key') ~ '^[a-z][a-z0-9_]{0,39}$',false)
    or jsonb_typeof(f->'key') is distinct from 'string'
    or (f->>'key') in ('constructor','prototype')
    or not private.custom_form_plain_text(f->'label',120)
    or jsonb_typeof(f->'required') is distinct from 'boolean'
    or not coalesce(field_type in ('text','number','date','boolean','select'),false)
    or (f->>'key')=any(keys)
  then raise exception using errcode='22023',message='invalid or duplicate custom field'; end if;
  keys:=array_append(keys,f->>'key');
  if field_type='text' then
   if f - array['key','label','required','type','maxLength'] <> '{}'::jsonb
     or jsonb_typeof(f->'maxLength') is distinct from 'number'
   then raise exception using errcode='22023',message='invalid custom text constraints'; end if;
   if (f->>'maxLength')::numeric not between 1 and 4000 or (f->>'maxLength')::numeric <> trunc((f->>'maxLength')::numeric)
   then raise exception using errcode='22023',message='invalid custom text length'; end if;
  elsif field_type='number' then
   if f - array['key','label','required','type','minimum','maximum'] <> '{}'::jsonb
     or jsonb_typeof(f->'minimum') is distinct from 'number' or jsonb_typeof(f->'maximum') is distinct from 'number'
   then raise exception using errcode='22023',message='invalid custom number constraints'; end if;
   if (f->>'minimum')::numeric not between -1000000000 and 1000000000
     or (f->>'maximum')::numeric not between -1000000000 and 1000000000
     or (f->>'minimum')::numeric > (f->>'maximum')::numeric
   then raise exception using errcode='22023',message='invalid custom number range'; end if;
  elsif field_type='select' then
   if f - array['key','label','required','type','options'] <> '{}'::jsonb
     or jsonb_typeof(f->'options') is distinct from 'array'
   then raise exception using errcode='22023',message='invalid custom selection'; end if;
   if jsonb_array_length(f->'options') not between 2 and 20
   then raise exception using errcode='22023',message='invalid custom option count'; end if;
   opts:='{}';
   for o in select value from jsonb_array_elements(f->'options') loop
    if not private.custom_form_plain_text(o,80) or (o #>> '{}')=any(opts)
    then raise exception using errcode='22023',message='invalid or duplicate custom option'; end if;
    opts:=array_append(opts,o #>> '{}');
   end loop;
  elsif f - array['key','label','required','type'] <> '{}'::jsonb then
   raise exception using errcode='22023',message='unsupported custom field settings';
  end if;
 end loop;
end;
$$;

create function private.assert_custom_form_authority(p_org uuid,p_branch uuid,p_write boolean)
returns void language plpgsql volatile security invoker set search_path='' as $$
begin
 if auth.uid() is null or p_org is null or p_branch is null
   or not exists(select 1 from public.branches b
     join public.organizations o on o.id=b.organization_id and o.is_active
     where b.id=p_branch and b.organization_id=p_org and b.is_active)
   or not (select private.has_permission(p_org,null,'forms.manage'))
   or not (select private.has_permission(p_org,p_branch,'forms.manage'))
   or (p_write and (coalesce(auth.jwt()->>'aal','')<>'aal2' or not (select private.has_recent_aal2(15))))
 then raise exception using errcode='42501',message='custom form governance is not authorized'; end if;
end;
$$;

create function private.save_custom_form_draft_atomic(
 p_expected_organization_id uuid,p_expected_branch_id uuid,p_form_version_id uuid,
 p_base_revision integer,p_idempotency_key uuid,p_payload jsonb)
returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare v public.form_versions%rowtype; d public.form_definitions%rowtype;
 r private.custom_form_draft_receipts%rowtype; h text; actor uuid:=auth.uid();
begin
 perform private.assert_custom_form_authority(p_expected_organization_id,p_expected_branch_id,true);
 if p_idempotency_key is null or (p_form_version_id is null)<>(p_base_revision is null)
   or p_base_revision<1 then raise exception using errcode='22023',message='invalid draft identity'; end if;
 perform private.validate_custom_form_payload(p_payload);
 h:=encode(sha256(convert_to(jsonb_build_object('branch',p_expected_branch_id,'version',p_form_version_id,
   'baseRevision',p_base_revision,'payload',p_payload)::text,'UTF8')),'hex');
 perform pg_advisory_xact_lock(hashtextextended('custom-form-save:'||p_expected_organization_id::text||':'||actor::text||':'||p_idempotency_key::text,0));
 select * into r from private.custom_form_draft_receipts where organization_id=p_expected_organization_id and actor_id=actor and idempotency_key=p_idempotency_key;
 if found then
  if r.request_hash<>h or r.branch_id<>p_expected_branch_id then raise exception using errcode='23505',message='custom form idempotency conflict'; end if;
  perform private.assert_custom_form_authority(p_expected_organization_id,p_expected_branch_id,true);
  return jsonb_build_object('formVersionId',r.form_version_id,'definitionId',r.definition_id,'revision',r.revision,'status','draft','replayed',true);
 end if;
 if p_form_version_id is null then
  insert into public.form_definitions(organization_id,form_key,name,category,is_official)
   values(p_expected_organization_id,p_payload->>'formKey',p_payload->>'name',p_payload->>'category',false) returning * into d;
  insert into public.form_versions(form_definition_id,version,status,effective_from,effective_to,schema_json,scoring_json)
   values(d.id,1,'draft',(p_payload->>'effectiveFrom')::date,(p_payload->>'effectiveTo')::date,p_payload->'schema','{}') returning * into v;
 else
  -- Same version->definition lock order as publication request. Never lock a
  -- publication row here: pending evidence is append-only and blocks edits.
  select * into v from public.form_versions where id=p_form_version_id for update;
  if not found then raise exception using errcode='42501',message='custom form outside authorized scope'; end if;
  select * into d from public.form_definitions where id=v.form_definition_id and organization_id=p_expected_organization_id and not is_official for share;
  if not found then raise exception using errcode='42501',message='custom form outside authorized scope'; end if;
  if d.form_key !~ '^tenant\.custom\.[a-z][a-z0-9_]{1,59}$'
    or v.schema_json->>'builder' is distinct from 'tenant-custom.v1'
    or v.status<>'draft' or v.scoring_json<>'{}'::jsonb
    or exists(select 1 from public.form_publication_requests q where q.form_version_id=v.id)
  then raise exception using errcode='23514',message='custom draft is locked or unsupported'; end if;
  if v.draft_revision<>p_base_revision then raise exception using errcode='40001',message='custom draft revision conflict'; end if;
  if d.form_key<>p_payload->>'formKey' or d.name<>p_payload->>'name' or d.category<>p_payload->>'category'
  then raise exception using errcode='23514',message='definition identity is immutable'; end if;
  update public.form_versions set effective_from=(p_payload->>'effectiveFrom')::date,
    effective_to=(p_payload->>'effectiveTo')::date,schema_json=p_payload->'schema',draft_revision=draft_revision+1
    where id=v.id returning * into v;
 end if;
 perform private.assert_custom_form_authority(p_expected_organization_id,p_expected_branch_id,true);
 insert into private.custom_form_draft_receipts(organization_id,branch_id,actor_id,idempotency_key,request_hash,form_version_id,definition_id,revision)
  values(p_expected_organization_id,p_expected_branch_id,actor,p_idempotency_key,h,v.id,d.id,v.draft_revision);
 insert into public.audit_events(organization_id,branch_id,actor_user_id,action,table_name,row_pk,changed_fields,metadata)
  values(p_expected_organization_id,p_expected_branch_id,actor,case when p_form_version_id is null then 'insert' else 'update' end,
   'custom_form_draft',v.id::text,array['schema_json','effective_from','effective_to','draft_revision'],
   jsonb_build_object('revision',v.draft_revision,'field_count',jsonb_array_length(v.schema_json->'fields')));
 return jsonb_build_object('formVersionId',v.id,'definitionId',d.id,'revision',v.draft_revision,'status','draft','replayed',false);
end;
$$;

create function private.read_custom_form_draft_response(p_expected_organization_id uuid,p_expected_branch_id uuid,p_form_version_id uuid)
returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare v public.form_versions%rowtype; d public.form_definitions%rowtype; payload jsonb;
begin
 perform private.assert_custom_form_authority(p_expected_organization_id,p_expected_branch_id,false);
 select * into v from public.form_versions where id=p_form_version_id for share;
 if not found then raise exception using errcode='42501',message='custom form outside authorized scope'; end if;
 select * into d from public.form_definitions where id=v.form_definition_id and organization_id=p_expected_organization_id and not is_official for share;
 if not found then raise exception using errcode='42501',message='custom form outside authorized scope'; end if;
 if v.status<>'draft' or v.scoring_json<>'{}'::jsonb or exists(select 1 from public.form_publication_requests q where q.form_version_id=v.id)
 then raise exception using errcode='23514',message='custom draft is locked'; end if;
 payload:=jsonb_build_object('formKey',d.form_key,'name',d.name,'category',d.category,
  'effectiveFrom',v.effective_from,'effectiveTo',v.effective_to,'schema',v.schema_json);
 perform private.validate_custom_form_payload(payload);
 perform private.assert_custom_form_authority(p_expected_organization_id,p_expected_branch_id,false);
 insert into public.audit_events(organization_id,branch_id,actor_user_id,action,table_name,row_pk,changed_fields,metadata)
  values(p_expected_organization_id,p_expected_branch_id,auth.uid(),'select','custom_form_draft',v.id::text,'{}',jsonb_build_object('revision',v.draft_revision));
 return jsonb_build_object('formVersionId',v.id,'definitionId',d.id,'revision',v.draft_revision,'version',v.version,'status','draft','payload',payload);
end;
$$;

create function public.save_custom_form_draft(p_expected_organization_id uuid,p_expected_branch_id uuid,p_form_version_id uuid,p_base_revision integer,p_idempotency_key uuid,p_payload jsonb)
returns jsonb language sql volatile security invoker set search_path='' as $$
 select private.save_custom_form_draft_atomic(p_expected_organization_id,p_expected_branch_id,p_form_version_id,p_base_revision,p_idempotency_key,p_payload);
$$;
create function public.read_custom_form_draft(p_expected_organization_id uuid,p_expected_branch_id uuid,p_form_version_id uuid)
returns jsonb language sql volatile security invoker set search_path='' as $$
 select private.read_custom_form_draft_response(p_expected_organization_id,p_expected_branch_id,p_form_version_id);
$$;
revoke all on function private.custom_form_plain_text(jsonb,integer),private.validate_custom_form_payload(jsonb),private.assert_custom_form_authority(uuid,uuid,boolean)
 from public,anon,authenticated,service_role;
revoke all on function private.save_custom_form_draft_atomic(uuid,uuid,uuid,integer,uuid,jsonb),private.read_custom_form_draft_response(uuid,uuid,uuid),
 public.save_custom_form_draft(uuid,uuid,uuid,integer,uuid,jsonb),public.read_custom_form_draft(uuid,uuid,uuid)
 from public,anon,authenticated,service_role;
grant execute on function private.save_custom_form_draft_atomic(uuid,uuid,uuid,integer,uuid,jsonb),private.read_custom_form_draft_response(uuid,uuid,uuid),
 public.save_custom_form_draft(uuid,uuid,uuid,integer,uuid,jsonb),public.read_custom_form_draft(uuid,uuid,uuid) to authenticated;
-- Application roles still have no definition/version or receipt direct DML.
commit;
