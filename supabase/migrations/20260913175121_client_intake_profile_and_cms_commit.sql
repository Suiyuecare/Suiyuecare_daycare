-- Governed intake: the source of truth is an immutable worker completion, never
-- a browser-supplied parser result. Local supplement and central field ownership
-- remain distinct; this workflow does not admit clients or sign clinical records.
begin;
set local lock_timeout = '5s';

create table private.client_intake_versions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null, branch_id uuid not null, client_id uuid not null,
  version bigint not null check(version > 0),
  profile jsonb not null check(jsonb_typeof(profile)='object' and octet_length(profile::text)<=65536),
  field_authority jsonb not null check(jsonb_typeof(field_authority)='object'),
  source_batch_id uuid references private.import_upload_completions(id) on delete restrict,
  actor_user_id uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default clock_timestamp(),
  unique(client_id,version),
  foreign key(client_id,organization_id,branch_id) references public.clients(id,organization_id,branch_id) on delete restrict,
  foreign key(source_batch_id,organization_id,branch_id) references private.import_upload_reservations(id,organization_id,branch_id) on delete restrict
);
create index client_intake_versions_scope_idx on private.client_intake_versions(organization_id,branch_id,client_id,version desc);
create index client_intake_versions_source_idx on private.client_intake_versions(source_batch_id);
create index client_intake_versions_actor_idx on private.client_intake_versions(actor_user_id);

create table private.client_intake_identities (
  organization_id uuid not null, branch_id uuid not null, client_id uuid not null,
  identity_sha256 text not null check(identity_sha256 ~ '^[a-f0-9]{64}$'),
  created_at timestamptz not null default clock_timestamp(),
  primary key(organization_id,identity_sha256),
  unique(client_id),
  foreign key(client_id,organization_id,branch_id) references public.clients(id,organization_id,branch_id) on delete restrict
);
create index client_intake_identities_scope_idx on private.client_intake_identities(branch_id,organization_id);

create table private.client_intake_operations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null, branch_id uuid not null, client_id uuid not null,
  actor_user_id uuid not null references auth.users(id) on delete restrict,
  idempotency_key uuid not null, request_sha256 text not null check(request_sha256 ~ '^[a-f0-9]{64}$'),
  operation_kind text not null check(operation_kind in('create_manual','update_profile','commit_cms')),
  reauth_challenge_id uuid not null references private.reauth_challenges(id) on delete restrict,
  source_batch_id uuid references private.import_upload_completions(id) on delete restrict,
  source_payload_sha256 text check(source_payload_sha256 ~ '^[a-f0-9]{64}$'),
  source_review_reason text check(char_length(btrim(source_review_reason)) between 10 and 1000),
  decisions jsonb not null default '[]' check(jsonb_typeof(decisions)='array'),
  receipt jsonb not null check(jsonb_typeof(receipt)='object'),
  created_at timestamptz not null default clock_timestamp(),
  unique(actor_user_id,idempotency_key), unique(source_batch_id),
  foreign key(client_id,organization_id,branch_id) references public.clients(id,organization_id,branch_id) on delete restrict,
  foreign key(source_batch_id,organization_id,branch_id) references private.import_upload_reservations(id,organization_id,branch_id) on delete restrict
);
create index client_intake_operations_scope_idx on private.client_intake_operations(organization_id,branch_id,client_id);
create index client_intake_operations_reauth_idx on private.client_intake_operations(reauth_challenge_id);

do $tables$ declare t text; begin
  foreach t in array array['client_intake_versions','client_intake_identities','client_intake_operations'] loop
    execute format('alter table private.%I enable row level security',t);
    execute format('alter table private.%I force row level security',t);
    execute format('revoke all on private.%I from public,anon,authenticated,service_role',t);
    execute format('create trigger %I before update or delete on private.%I for each row execute function private.prevent_import_upload_mutation()',t||'_immutable',t);
    execute format('create trigger %I after insert on private.%I for each row execute function private.audit_row_change()',t||'_audit',t);
  end loop;
end $tables$;

create function private.intake_central_keys() returns text[]
language sql immutable security invoker set search_path='' as $$
select array['displayName','dateOfBirth','identityNumber','sex','cmsLevel','disability']::text[];
$$;

create function private.intake_date(p_value text) returns date
language plpgsql immutable security invoker set search_path='' as $$
declare v_date date;
begin
  if p_value is null or p_value='' then return null; end if;
  if p_value !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then
    raise exception using errcode='22023',message='INTAKE_INVALID_DATE'; end if;
  begin v_date:=p_value::date;
  exception when invalid_datetime_format or datetime_field_overflow then
    raise exception using errcode='22023',message='INTAKE_INVALID_DATE'; end;
  if to_char(v_date,'YYYY-MM-DD')<>p_value or not isfinite(v_date) then
    raise exception using errcode='22023',message='INTAKE_INVALID_DATE'; end if;
  return v_date;
end;
$$;

create function private.validate_intake_profile(p_profile jsonb) returns jsonb
language plpgsql volatile security invoker set search_path='' as $$
declare p jsonb; k text; v jsonb; c jsonb; contacts jsonb:='[]'; d date; v_today date:=(clock_timestamp() at time zone 'Asia/Taipei')::date;
begin
  if p_profile is null or jsonb_typeof(p_profile)<>'object' or octet_length(p_profile::text)>65536
    or exists(select 1 from jsonb_object_keys(p_profile) x where x<>all(array[
      'displayName','clientCode','dateOfBirth','identityNumber','sex','phone','registeredAddress',
      'residentialAddress','cmsLevel','disability','contacts','consent','notes'])) then
    raise exception using errcode='22023',message='INTAKE_INVALID_PROFILE'; end if;
  p:=jsonb_build_object('dateOfBirth',null,'identityNumber',null,'sex','unknown','phone',null,
    'registeredAddress',null,'residentialAddress',null,'cmsLevel',null,'disability',null,
    'contacts','[]'::jsonb,'consent',jsonb_build_object('status','pending','confirmedOn',null),'notes',null)||p_profile;
  for k,v in select key,value from jsonb_each(p) where key<>all(array['cmsLevel','contacts','consent']) loop
    if jsonb_typeof(v) not in('string','null') or (jsonb_typeof(v)='string' and
      ((case when k='notes' then translate(v#>>'{}',E'\n\r\t','') else v#>>'{}' end) ~ '[[:cntrl:]]'
      or char_length(v#>>'{}')>case k when 'notes' then 4000 when 'registeredAddress' then 500 when 'residentialAddress' then 500 when 'disability' then 500 when 'phone' then 80 else 120 end)) then
      raise exception using errcode='22023',message='INTAKE_INVALID_PROFILE'; end if;
    if jsonb_typeof(v)='string' then p:=jsonb_set(p,array[k],to_jsonb(btrim(v#>>'{}'))); end if;
  end loop;
  if coalesce(char_length(p->>'displayName'),0) not between 1 and 120
    or coalesce(char_length(p->>'clientCode'),0) not between 1 and 64
    or (p->>'sex') is null or (p->>'sex') not in('male','female','other','unknown') then
    raise exception using errcode='22023',message='INTAKE_INVALID_PROFILE'; end if;
  d:=private.intake_date(p->>'dateOfBirth');
  if d is not null and (d<date '1900-01-01' or d>v_today) then
    raise exception using errcode='22023',message='INTAKE_INVALID_DATE'; end if;
  p:=jsonb_set(p,'{dateOfBirth}',coalesce(to_jsonb(d),'null'::jsonb));
  if nullif(p->>'identityNumber','') is not null then
    p:=jsonb_set(p,'{identityNumber}',to_jsonb(upper(p->>'identityNumber')));
    if p->>'identityNumber' !~ '^[A-Z][A-Z0-9]{7,19}$' then
      raise exception using errcode='22023',message='INTAKE_INVALID_IDENTITY'; end if;
  else p:=jsonb_set(p,'{identityNumber}','null'); end if;
  if p->'cmsLevel'<>'null'::jsonb and (jsonb_typeof(p->'cmsLevel')<>'number'
    or (p->>'cmsLevel') !~ '^[1-8]$') then
    raise exception using errcode='22023',message='INTAKE_INVALID_PROFILE'; end if;
  if jsonb_typeof(p->'contacts') is distinct from 'array' or jsonb_array_length(p->'contacts')>10 then
    raise exception using errcode='22023',message='INTAKE_INVALID_CONTACTS'; end if;
  for c in select value from jsonb_array_elements(p->'contacts') loop
    if jsonb_typeof(c)<>'object' or exists(select 1 from jsonb_object_keys(c) x where x<>all(array[
      'name','relationship','phone','address','isPrimary','isEmergency']))
      or coalesce(char_length(btrim(c->>'name')),0) not between 1 and 120 then
      raise exception using errcode='22023',message='INTAKE_INVALID_CONTACTS'; end if;
    for k,v in select key,value from jsonb_each(c) loop
      if (k in('isPrimary','isEmergency') and jsonb_typeof(v)<>'boolean') or
        (k not in('isPrimary','isEmergency') and (jsonb_typeof(v) not in('string','null')
          or char_length(v#>>'{}')>case k when 'phone' then 80 when 'address' then 500 else 120 end or (v#>>'{}')~'[[:cntrl:]]')) then
        raise exception using errcode='22023',message='INTAKE_INVALID_CONTACTS'; end if;
    end loop;
    contacts:=contacts||jsonb_build_array(jsonb_build_object('relationship',null,'phone',null,'address',null,'isPrimary',false,'isEmergency',false)||c);
  end loop;
  p:=jsonb_set(p,'{contacts}',contacts);
  if (select count(*) from jsonb_array_elements(p->'contacts') contact_entry where contact_entry->'isPrimary'='true'::jsonb)>1 then
    raise exception using errcode='22023',message='INTAKE_INVALID_CONTACTS'; end if;
  c:=p->'consent';
  if jsonb_typeof(c) is distinct from 'object' or exists(select 1 from jsonb_object_keys(c) x where x not in('status','confirmedOn'))
    or (c->>'status') is null or c->>'status' not in('pending','confirmed','declined')
    or (c ? 'confirmedOn' and jsonb_typeof(c->'confirmedOn') not in('string','null')) then
    raise exception using errcode='22023',message='INTAKE_INVALID_CONSENT'; end if;
  d:=private.intake_date(c->>'confirmedOn');
  if (c->>'status'='confirmed' and d is null) or d>v_today
    or (c->>'status'<>'confirmed' and d is not null) then
    raise exception using errcode='22023',message='INTAKE_INVALID_CONSENT'; end if;
  p:=jsonb_set(p,'{consent}',jsonb_build_object('status',c->>'status','confirmedOn',d));
  return p;
end;
$$;

create function private.require_intake_authority(p_org uuid,p_branch uuid,p_client uuid,p_write boolean)
returns uuid language plpgsql volatile security definer set search_path='' as $$
declare k text; v_challenge uuid;
begin
  if auth.uid() is null or p_org is null or p_branch is null or not exists(
    select 1 from public.branches b join public.organizations o on o.id=b.organization_id
    where b.id=p_branch and o.id=p_org and b.is_active and o.is_active) then
    raise exception using errcode='42501',message='INTAKE_ACCESS_DENIED'; end if;
  foreach k in array array['clients.read','clients.demographics.read'] loop
    if not(private.has_permission(p_org,p_branch,k) or (not p_write and private.has_executive_read_permission(p_org,p_branch,k))) then
      raise exception using errcode='42501',message='INTAKE_ACCESS_DENIED'; end if;
  end loop;
  if p_client is not null and (not exists(select 1 from public.clients where id=p_client and organization_id=p_org and branch_id=p_branch)
    or not(private.can_staff_access_client(p_client,'clients.read') or (not p_write and private.can_executive_read_client(p_client,'clients.read')))) then
    raise exception using errcode='42501',message='INTAKE_ACCESS_DENIED'; end if;
  if p_write then
    if not private.has_permission(p_org,p_branch,'clients.manage') or
      (p_client is null and not private.has_permission(p_org,p_branch,'clients.view_all')) or
      (p_client is not null and not private.can_staff_access_client(p_client,'clients.manage')) then
      raise exception using errcode='42501',message='INTAKE_ACCESS_DENIED'; end if;
    v_challenge:=private.current_client_master_reauth_challenge();
  end if;
  return v_challenge;
end;
$$;

create function private.client_intake_snapshot(p_org uuid,p_branch uuid,p_client uuid) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare c public.clients%rowtype; v private.client_intake_versions%rowtype; result jsonb;
begin
  perform private.require_intake_authority(p_org,p_branch,p_client,false);
  if p_client is null then raise exception using errcode='22023',message='INTAKE_CLIENT_REQUIRED'; end if;
  select * into c from public.clients where id=p_client and organization_id=p_org and branch_id=p_branch;
  select * into v from private.client_intake_versions where client_id=c.id order by version desc limit 1;
  result:=jsonb_build_object('clientId',c.id,'profileVersion',coalesce(v.version,0),'clientRowVersion',c.row_version,
    'pending',c.admitted_on is null,'status',c.status,'profile',coalesce(v.profile,jsonb_build_object(
      'displayName',c.display_name,'clientCode',c.client_code,'dateOfBirth',c.date_of_birth,
      'identityNumber',null,'sex','unknown','phone',null,'registeredAddress',null,'residentialAddress',null,
      'cmsLevel',null,'disability',null,'contacts','[]'::jsonb,'consent',jsonb_build_object('status','pending','confirmedOn',null),'notes',null)),
    'fieldAuthority',coalesce(v.field_authority,'{}'::jsonb),'sourceBatchId',v.source_batch_id);
  insert into public.audit_events(organization_id,branch_id,actor_user_id,action,table_name,row_pk,changed_fields,metadata)
    values(p_org,p_branch,auth.uid(),'select','private.client_intake_versions',p_client::text,'{}',
      jsonb_build_object('projection','intake_profile_v1','profile_version',coalesce(v.version,0)));
  return result;
end;
$$;

create function private.write_intake_profile(p_org uuid,p_branch uuid,p_operation uuid,p_client uuid,
  p_expected_version bigint,p_expected_client_version bigint,p_profile jsonb) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare c public.clients%rowtype; v private.client_intake_versions%rowtype; op private.client_intake_operations%rowtype;
  challenge uuid; p jsonb; k text; h text; ih text; result jsonb; authority jsonb:='{}'; kind text;
begin
  challenge:=private.require_intake_authority(p_org,p_branch,p_client,true);
  if p_operation is null then raise exception using errcode='22023',message='INTAKE_INVALID_INPUT'; end if;
  p:=private.validate_intake_profile(p_profile); kind:=case when p_client is null then 'create_manual' else 'update_profile' end;
  h:=encode(sha256(convert_to(jsonb_build_object('kind',kind,'org',p_org,'branch',p_branch,'client',p_client,
    'version',p_expected_version,'clientVersion',p_expected_client_version,'profile',p)::text,'UTF8')),'hex');
  perform pg_advisory_xact_lock(hashtextextended('intake-operation:'||auth.uid()||':'||p_operation,0));
  select * into op from private.client_intake_operations where actor_user_id=auth.uid() and idempotency_key=p_operation;
  if found then
    if op.request_sha256<>h then raise exception using errcode='23505',message='INTAKE_IDEMPOTENCY_CONFLICT'; end if;
    return op.receipt||jsonb_build_object('replayed',true);
  end if;
  if p_client is not null then
    select * into c from public.clients where id=p_client and organization_id=p_org and branch_id=p_branch for update;
    select * into v from private.client_intake_versions where client_id=c.id order by version desc limit 1;
    if p_expected_version is distinct from coalesce(v.version,0) or p_expected_client_version is distinct from c.row_version then
      raise exception using errcode='40001',message='INTAKE_VERSION_CONFLICT'; end if;
    if c.status not in('active','suspended') then raise exception using errcode='42501',message='INTAKE_CLIENT_CLOSED'; end if;
    authority:=coalesce(v.field_authority,'{}'::jsonb);
    foreach k in array private.intake_central_keys() loop
      if (authority->>k='central' and v.profile->k is distinct from p->k) or
        (v.version is null and c.source_system<>'local' and
          ((k='displayName' and c.display_name is distinct from p->>k) or (k='dateOfBirth' and to_jsonb(c.date_of_birth) is distinct from nullif(p->k,'null'::jsonb)))) then
        raise exception using errcode='42501',message='INTAKE_CENTRAL_FIELD_PROTECTED'; end if;
    end loop;
    if v.profile->>'identityNumber' is not null and v.profile->>'identityNumber' is distinct from p->>'identityNumber' then
      raise exception using errcode='42501',message='INTAKE_IDENTITY_IMMUTABLE'; end if;
  end if;
  if p->>'identityNumber' is not null then
    ih:=encode(sha256(convert_to(p->>'identityNumber','UTF8')),'hex');
    perform pg_advisory_xact_lock(hashtextextended('intake-identity:'||p_org||':'||ih,0));
    if exists(select 1 from private.client_intake_identities where organization_id=p_org and identity_sha256=ih
      and client_id is distinct from p_client) then
      raise exception using errcode='23505',message='INTAKE_IDENTITY_ALREADY_EXISTS'; end if;
  end if;
  if p_client is null then
    insert into public.clients(organization_id,branch_id,client_code,display_name,date_of_birth,status,admitted_on,source_system)
      values(p_org,p_branch,p->>'clientCode',p->>'displayName',private.intake_date(p->>'dateOfBirth'),'active',null,'local') returning * into c;
  else
    update public.clients set client_code=p->>'clientCode',display_name=p->>'displayName',date_of_birth=private.intake_date(p->>'dateOfBirth'),
      row_version=c.row_version+1,updated_at=clock_timestamp() where id=c.id returning * into c;
  end if;
  if ih is not null and not exists(select 1 from private.client_intake_identities where client_id=c.id) then
    insert into private.client_intake_identities(organization_id,branch_id,client_id,identity_sha256) values(p_org,p_branch,c.id,ih);
  end if;
  for k in select jsonb_object_keys(p) loop
    if not(authority ? k) then authority:=authority||jsonb_build_object(k,'local'); end if;
  end loop;
  insert into private.client_intake_versions(organization_id,branch_id,client_id,version,profile,field_authority,source_batch_id,actor_user_id)
    values(p_org,p_branch,c.id,coalesce(v.version,0)+1,p,authority,v.source_batch_id,auth.uid());
  result:=jsonb_build_object('clientId',c.id,'profileVersion',coalesce(v.version,0)+1,'clientRowVersion',c.row_version,
    'pending',c.admitted_on is null,'replayed',false,'operationId',p_operation);
  insert into private.client_intake_operations(organization_id,branch_id,client_id,actor_user_id,idempotency_key,request_sha256,
    operation_kind,reauth_challenge_id,receipt) values(p_org,p_branch,c.id,auth.uid(),p_operation,h,kind,challenge,result);
  perform private.require_intake_authority(p_org,p_branch,c.id,true);
  return result;
end;
$$;

-- A reviewed field selector is still not permission to relabel arbitrary data.
-- Source section + exact label + parser path/mapping key are server validated.
create function private.cms_intake_field_target(p_field jsonb) returns text
language plpgsql immutable security invoker set search_path='' as $$
declare s text:=p_field->'source'->>'sectionCode'; l text:=p_field->'source'->>'label'; path text:=p_field->'source'->>'parentPath';
begin
  if p_field->>'mappingVersion' is distinct from 'central-care-plan-html@1' or coalesce(p_field->>'mappingState','') not in('mapped','conflict')
    or path is null or not starts_with(path,s||'/')
    or p_field->>'mappingKey' is distinct from s||chr(31)||l||chr(31)||path
    or p_field->>'targetPath' is null or not starts_with(p_field->>'targetPath','central.'||lower(s)||'.') then return null; end if;
  if s in('CLIENT_BASIC','ASSESSMENT_A') then
    case l
      when '姓名' then return 'displayName'; when '個案姓名' then return 'displayName'; when '個案姓名 傳統姓名' then return 'displayName';
      when '出生日期' then return 'dateOfBirth'; when '出生年月日' then return 'dateOfBirth'; when '生日' then return 'dateOfBirth'; when '個案生日' then return 'dateOfBirth';
      when '身分證字號' then return 'identityNumber'; when '身份證字號' then return 'identityNumber'; when '身分證號' then return 'identityNumber'; when '身分證/居留證字號' then return 'identityNumber'; when '個案身分證' then return 'identityNumber';
      when '性別' then return 'sex'; when '聯絡電話' then return 'phone'; when '電話' then return 'phone'; when '手機' then return 'phone'; when '個案電話' then return 'phone';
      when '戶籍地址' then return 'registeredAddress'; when '戶籍地址 ※ (里、鄰、郵遞區號非必填)' then return 'registeredAddress';
      when '居住地址' then return 'residentialAddress'; when '現居地址' then return 'residentialAddress'; when '居住(通訊)地址 ※ (里、鄰、郵遞區號非必填)' then return 'residentialAddress';
      when '身心障礙等級' then return 'disability'; when '身心障礙證明' then return 'disability'; else null;
    end case;
  end if;
  if s in('ASSESSMENT_RESULT','CLIENT_BASIC') and l in('CMS等級','CMS 等級','CMS失能等級','長照需要等級','失能等級') then return 'cmsLevel'; end if;
  if s='CARE_PLAN' and l ~ '^CMS等級(?: ※ 此計畫已計算[0-9]+次)?$' then return 'cmsLevel'; end if;
  if s='ICF' and l in('障礙程度','身心障礙手冊/證明') then return 'disability'; end if;
  if s='PRIMARY_CONTACT' then
    case l when '姓名' then return 'primaryContactName'; when '聯絡人姓名' then return 'primaryContactName';
      when '關係' then return 'primaryContactRelationship'; when '與個案關係' then return 'primaryContactRelationship'; when '聯絡人與需要服務者關係或身分' then return 'primaryContactRelationship';
      when '電話' then return 'primaryContactPhone'; when '聯絡電話' then return 'primaryContactPhone'; when '手機' then return 'primaryContactPhone';
      when '聯絡人電話(H)' then return 'primaryContactPhone'; when '聯絡人電話(O)' then return 'primaryContactPhone'; when '聯絡人手機' then return 'primaryContactPhone';
      when '地址' then return 'primaryContactAddress'; when '聯絡地址' then return 'primaryContactAddress'; when '聯絡人地址' then return 'primaryContactAddress'; else null; end case;
  end if;
  return null;
end;
$$;

create function private.cms_intake_source_value(p_target text,p_value text) returns jsonb
language plpgsql volatile security invoker set search_path='' as $$
declare v text:=btrim(p_value); a text[]; y integer; d date;
begin
  if v is null or v='' or char_length(v)>(case
    when p_target in('phone','primaryContactPhone') then 80
    when p_target in('registeredAddress','residentialAddress','primaryContactAddress','disability') then 500
    else 120 end) or v ~ '[[:cntrl:]]' then
    raise exception using errcode='22023',message='INTAKE_SOURCE_VALUE_INVALID'; end if;
  if p_target='dateOfBirth' then
    a:=regexp_match(v,'^([0-9]{2,4})[-/.年]([0-9]{1,2})[-/.月]([0-9]{1,2})日?$');
    if a is null then raise exception using errcode='22023',message='INTAKE_SOURCE_VALUE_INVALID'; end if;
    y:=a[1]::integer; if char_length(a[1])<=3 then y:=y+1911; end if;
    d:=private.intake_date(y::text||'-'||lpad(a[2],2,'0')||'-'||lpad(a[3],2,'0'));
    if d<date '1900-01-01' or d>(clock_timestamp() at time zone 'Asia/Taipei')::date then
      raise exception using errcode='22023',message='INTAKE_SOURCE_VALUE_INVALID'; end if;
    return to_jsonb(d);
  elsif p_target='sex' then
    case v when '男' then return '"male"'; when '男性' then return '"male"'; when '女' then return '"female"'; when '女性' then return '"female"';
      when '其他' then return '"other"'; when '未詳' then return '"unknown"'; else
        raise exception using errcode='22023',message='INTAKE_SOURCE_VALUE_INVALID'; end case;
  elsif p_target='cmsLevel' then
    a:=regexp_match(v,'^(?:CMS[ ]*)?(?:第)?([1-8])(?:級)?$');
    if a is null then raise exception using errcode='22023',message='INTAKE_SOURCE_VALUE_INVALID'; end if;
    return to_jsonb(a[1]::integer);
  elsif p_target='identityNumber' then
    v:=upper(v);
    if v !~ '^[A-Z][A-Z0-9]{7,19}$' then raise exception using errcode='22023',message='INTAKE_SOURCE_IDENTITY_INVALID'; end if;
  end if;
  return to_jsonb(v);
end;
$$;

-- A known official effective/approval date is comparable; upload/completion time
-- is not. Missing, conflicting or invalid evidence deliberately returns null.
create function private.cms_intake_official_date(p_payload jsonb) returns date
language plpgsql volatile security invoker set search_path='' as $$
declare f jsonb; d date; result date; s text; l text; path text;
begin
  for f in select value from jsonb_array_elements(p_payload->'fields') loop
    s:=f->'source'->>'sectionCode'; l:=f->'source'->>'label'; path:=f->'source'->>'parentPath';
    if s='CARE_PLAN' and l in('核定日期','核定日','計畫生效日期') then
      if f->>'mappingVersion' is distinct from 'central-care-plan-html@1' or f->>'mappingState' is distinct from 'mapped'
        or f->'warnings' is distinct from '[]'::jsonb or path is distinct from 'CARE_PLAN/table.table.table-bordered/tbody/tr'
        or f->>'mappingKey' is distinct from s||chr(31)||l||chr(31)||path then return null; end if;
      begin d:=(private.cms_intake_source_value('dateOfBirth',f->>'normalizedValue')#>>'{}')::date;
      exception when sqlstate '22023' then return null; end;
      if result is not null and result<>d then return null; end if;
      result:=d;
    end if;
  end loop;
  return result;
end;
$$;

-- Convert independently so a missing optional source is displayed for review,
-- not a first surprise at commit. Aggregate in one SQL pass, not O(n²) JSON appends.
create function private.cms_intake_preview_field(p_field jsonb) returns jsonb
language plpgsql volatile security invoker set search_path='' as $$
declare target text; converted jsonb; warning text;
begin
  target:=private.cms_intake_field_target(p_field);
  if target is not null then
    begin
      if p_field->'warnings' is distinct from '[]'::jsonb then warning:='INTAKE_SOURCE_REVIEW_REQUIRED';
      else converted:=private.cms_intake_source_value(target,p_field->>'normalizedValue'); end if;
    exception when sqlstate '22023' then warning:='INTAKE_SOURCE_VALUE_INVALID'; end;
  end if;
  return p_field||jsonb_build_object('intakeTarget',target,'intakeValue',converted,'intakeWarning',warning);
end;
$$;

create function private.cms_intake_preview(p_org uuid,p_branch uuid,p_batch uuid,p_client uuid) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare source private.import_upload_completions%rowtype; preview jsonb; current_profile jsonb; fields jsonb:='[]'; op private.client_intake_operations%rowtype;
  source_date date; current_source_date date;
begin
  perform private.require_intake_authority(p_org,p_branch,p_client,false);
  if not private.has_permission(p_org,p_branch,'imports.manage') then raise exception using errcode='42501',message='INTAKE_ACCESS_DENIED'; end if;
  select * into source from private.import_upload_completions where id=p_batch and organization_id=p_org and branch_id=p_branch;
  if not found then raise exception using errcode='42501',message='INTAKE_SOURCE_UNAVAILABLE'; end if;
  select * into op from private.client_intake_operations where source_batch_id=p_batch;
  if op.id is not null then perform private.require_intake_authority(p_org,p_branch,op.client_id,false); end if;
  if p_client is not null then current_profile:=private.client_intake_snapshot(p_org,p_branch,p_client); end if;
  source_date:=private.cms_intake_official_date(source.parsed_payload);
  if current_profile->>'sourceBatchId' is not null then
    select private.cms_intake_official_date(parsed_payload) into current_source_date
      from private.import_upload_completions where id=(current_profile->>'sourceBatchId')::uuid;
  end if;
  select coalesce(jsonb_agg(private.cms_intake_preview_field(entry.value) order by entry.ordinality),'[]'::jsonb)
    into fields from jsonb_array_elements(source.parsed_payload->'fields') with ordinality entry(value,ordinality);
  preview:=jsonb_build_object('batchId',source.id,'payloadSha256',source.payload_sha256,
    'mappingVersion',source.parsed_payload->>'mappingVersion','fields',fields,'sections',source.parsed_payload->'sections',
    'warnings',source.parsed_payload->'warnings','conflicts',source.parsed_payload->'conflicts',
    'current',current_profile,'imported',op.id is not null,'importReceipt',op.receipt,
    'sourceReviewRequired',p_client is not null,'sourceOfficialDate',source_date,'currentSourceOfficialDate',current_source_date,
    'sourceIsOlder',coalesce(source_date<current_source_date,false));
  insert into public.audit_events(organization_id,branch_id,actor_user_id,action,table_name,row_pk,changed_fields,metadata)
    values(p_org,p_branch,auth.uid(),'select','private.import_upload_completions',p_batch::text,'{}',jsonb_build_object('projection','cms_intake_preview_v1'));
  return preview;
end;
$$;

-- Recover an existing upload across browser restarts without relaxing actor-key
-- immutability or performing a second S3 write. Hash is computed by the server.
create function private.find_cms_intake_source(p_org uuid,p_branch uuid,p_file_sha256 text) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare reservation private.import_upload_reservations%rowtype; completion private.import_upload_completions%rowtype;
  imported_client uuid; result jsonb;
begin
  perform private.require_intake_authority(p_org,p_branch,null,false);
  if not private.has_permission(p_org,p_branch,'imports.manage') then
    raise exception using errcode='42501',message='INTAKE_ACCESS_DENIED'; end if;
  if p_file_sha256 is null or p_file_sha256 !~ '^[a-f0-9]{64}$' then
    raise exception using errcode='22023',message='INTAKE_INVALID_INPUT'; end if;
  select * into reservation from private.import_upload_reservations where organization_id=p_org and branch_id=p_branch
    and file_sha256=p_file_sha256 and mapping_version='central-care-plan-html@1';
  if found then
    select * into completion from private.import_upload_completions where id=reservation.id;
    select client_id into imported_client from private.client_intake_operations where source_batch_id=reservation.id;
    if imported_client is not null and not(private.can_staff_access_client(imported_client,'clients.read')
      or private.can_executive_read_client(imported_client,'clients.read')) then imported_client:=null; end if;
    result:=jsonb_build_object('status',case when completion.id is null then 'queued' else 'completed' end,
      'reservationId',reservation.id,'payloadSha256',completion.payload_sha256,'clientId',imported_client);
  end if;
  insert into public.audit_events(organization_id,branch_id,actor_user_id,action,table_name,row_pk,changed_fields,metadata)
    values(p_org,p_branch,auth.uid(),'select','private.import_upload_reservations',reservation.id::text,'{}',
      jsonb_build_object('projection','cms_source_lookup_v1','matched',reservation.id is not null));
  return result;
end;
$$;

create function private.commit_cms_intake(p_org uuid,p_branch uuid,p_operation uuid,p_batch uuid,p_payload_sha256 text,
  p_client uuid,p_expected_version bigint,p_expected_client_version bigint,p_client_code text,p_decisions jsonb,p_source_review_reason text default null) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare source private.import_upload_completions%rowtype; c public.clients%rowtype; v private.client_intake_versions%rowtype;
  op private.client_intake_operations%rowtype; challenge uuid; h text; ih text; p jsonb; authority jsonb:='{}'; f jsonb; decision jsonb;
  target text; value jsonb; identity_value text; result jsonb; touched text[]:='{}'; contact jsonb:='{}';
  source_date date; current_source_date date;
begin
  challenge:=private.require_intake_authority(p_org,p_branch,p_client,true);
  perform private.require_import_upload_authority(p_org,p_branch);
  if not private.has_permission(p_org,p_branch,'imports.approve') then raise exception using errcode='42501',message='INTAKE_ACCESS_DENIED'; end if;
  if p_operation is null or p_batch is null or p_payload_sha256 is null or p_payload_sha256 !~ '^[a-f0-9]{64}$'
    or p_decisions is null or jsonb_typeof(p_decisions)<>'array' or jsonb_array_length(p_decisions) not between 2 and 30
    or p_client_code is null or char_length(btrim(p_client_code)) not between 1 and 64
    or (p_client is null and (p_expected_version is not null or p_expected_client_version is not null))
    or (p_source_review_reason is not null and (char_length(btrim(p_source_review_reason)) not between 10 and 1000
      or translate(p_source_review_reason,E'\n\r\t','')~'[[:cntrl:]]')) then
    raise exception using errcode='22023',message='INTAKE_INVALID_INPUT'; end if;
  h:=encode(sha256(convert_to(jsonb_build_object('org',p_org,'branch',p_branch,'batch',p_batch,'payload',p_payload_sha256,
    'client',p_client,'version',p_expected_version,'clientVersion',p_expected_client_version,'clientCode',p_client_code,'decisions',p_decisions,
    'sourceReviewReason',p_source_review_reason)::text,'UTF8')),'hex');
  perform pg_advisory_xact_lock(hashtextextended('intake-operation:'||auth.uid()||':'||p_operation,0));
  select * into op from private.client_intake_operations where actor_user_id=auth.uid() and idempotency_key=p_operation;
  if found then
    if op.request_sha256<>h then raise exception using errcode='23505',message='INTAKE_IDEMPOTENCY_CONFLICT'; end if;
    return op.receipt||jsonb_build_object('replayed',true);
  end if;
  select * into source from private.import_upload_completions where id=p_batch and organization_id=p_org and branch_id=p_branch for update;
  if not found then raise exception using errcode='42501',message='INTAKE_SOURCE_UNAVAILABLE'; end if;
  if source.payload_sha256<>p_payload_sha256 then raise exception using errcode='40001',message='INTAKE_SOURCE_VERSION_CONFLICT'; end if;
  if exists(select 1 from private.client_intake_operations where source_batch_id=p_batch) then
    raise exception using errcode='23505',message='INTAKE_SOURCE_ALREADY_IMPORTED'; end if;
  if source.parsed_payload->>'mappingVersion' is distinct from 'central-care-plan-html@1'
    or exists(select 1 from jsonb_array_elements(source.parsed_payload->'fields') x group by x->>'id' having count(*)<>1)
    or exists(select 1 from jsonb_array_elements(source.parsed_payload->'fields') x where coalesce(x->>'id','')='') then
    raise exception using errcode='22023',message='INTAKE_SOURCE_INVALID'; end if;
  if p_client is not null then
    select * into c from public.clients where id=p_client and organization_id=p_org and branch_id=p_branch for update;
    select * into v from private.client_intake_versions where client_id=c.id order by version desc limit 1;
    if p_expected_version is distinct from coalesce(v.version,0) or p_expected_client_version is distinct from c.row_version then
      raise exception using errcode='40001',message='INTAKE_VERSION_CONFLICT'; end if;
    if p_source_review_reason is null then raise exception using errcode='22023',message='INTAKE_SOURCE_CHRONOLOGY_REVIEW_REQUIRED'; end if;
    source_date:=private.cms_intake_official_date(source.parsed_payload);
    if v.source_batch_id is not null then
      select private.cms_intake_official_date(parsed_payload) into current_source_date
        from private.import_upload_completions where id=v.source_batch_id;
      if source_date is not null and current_source_date is not null and source_date<current_source_date then
        raise exception using errcode='22023',message='INTAKE_SOURCE_OLDER_THAN_CURRENT'; end if;
    end if;
    if c.status not in('active','suspended') then raise exception using errcode='42501',message='INTAKE_CLIENT_CLOSED'; end if;
    p:=coalesce(v.profile,jsonb_build_object('displayName',c.display_name,'clientCode',c.client_code,'dateOfBirth',c.date_of_birth));
    authority:=coalesce(v.field_authority,'{}'::jsonb);
  else p:=jsonb_build_object('clientCode',p_client_code); end if;
  for decision in select x from jsonb_array_elements(p_decisions) x loop
    if jsonb_typeof(decision)<>'object' or exists(select 1 from jsonb_object_keys(decision) x where x not in('fieldId','target','choice'))
      or decision->>'choice' is null or decision->>'choice' not in('use_source','keep_current') then
      raise exception using errcode='22023',message='INTAKE_DECISION_INVALID'; end if;
    select x into f from jsonb_array_elements(source.parsed_payload->'fields') x where x->>'id'=decision->>'fieldId';
    target:=private.cms_intake_field_target(f);
    if f is null or target is null or target is distinct from decision->>'target' or target=any(touched) then
      raise exception using errcode='22023',message='INTAKE_DECISION_INVALID'; end if;
    touched:=array_append(touched,target);
    if target='identityNumber' or decision->>'choice'='use_source' then
      if f->'warnings' is distinct from '[]'::jsonb then raise exception using errcode='22023',message='INTAKE_SOURCE_REVIEW_REQUIRED'; end if;
      value:=private.cms_intake_source_value(target,f->>'normalizedValue');
    end if;
    if target='identityNumber' then identity_value:=value#>>'{}'; end if;
    if decision->>'choice'='keep_current' then
      if p_client is null and target in('displayName','identityNumber') then
        raise exception using errcode='22023',message='INTAKE_DECISION_INVALID'; end if;
      continue;
    end if;
    if starts_with(target,'primaryContact') then
      if p_client is not null and coalesce(p->'contacts','[]'::jsonb)<>'[]'::jsonb then
        raise exception using errcode='42501',message='INTAKE_LOCAL_FIELD_PROTECTED'; end if;
      contact:=contact||jsonb_build_object(case target when 'primaryContactName' then 'name' when 'primaryContactRelationship' then 'relationship'
        when 'primaryContactPhone' then 'phone' else 'address' end,value);
    else
      if p_client is not null and not(target=any(private.intake_central_keys())) and nullif(p->target,'null'::jsonb) is not null
        and p->target<>to_jsonb(''::text) and p->target is distinct from value then
        raise exception using errcode='42501',message='INTAKE_LOCAL_FIELD_PROTECTED'; end if;
      p:=p||jsonb_build_object(target,value); authority:=authority||jsonb_build_object(target,'central');
    end if;
  end loop;
  if identity_value is null or not('displayName'=any(touched)) then
    raise exception using errcode='22023',message='INTAKE_SOURCE_IDENTITY_REQUIRED'; end if;
  if exists(select 1 from jsonb_array_elements(source.parsed_payload->'fields') field_entry
    where private.cms_intake_field_target(field_entry) is not null and not(private.cms_intake_field_target(field_entry)=any(touched))) then
    raise exception using errcode='22023',message='INTAKE_DECISIONS_INCOMPLETE'; end if;
  ih:=encode(sha256(convert_to(identity_value,'UTF8')),'hex');
  perform pg_advisory_xact_lock(hashtextextended('intake-identity:'||p_org||':'||ih,0));
  if p_client is not null then
    if not exists(select 1 from private.client_intake_identities where client_id=p_client and organization_id=p_org and identity_sha256=ih) then
      raise exception using errcode='42501',message='INTAKE_IDENTITY_MISMATCH'; end if;
    if p_client_code is distinct from c.client_code then raise exception using errcode='42501',message='INTAKE_LOCAL_FIELD_PROTECTED'; end if;
  elsif exists(select 1 from private.client_intake_identities where organization_id=p_org and identity_sha256=ih) then
    raise exception using errcode='23505',message='INTAKE_IDENTITY_ALREADY_EXISTS';
  end if;
  if contact<>'{}'::jsonb then
    if coalesce(contact->>'name','')='' then raise exception using errcode='22023',message='INTAKE_CONTACT_NAME_REQUIRED'; end if;
    p:=p||jsonb_build_object('contacts',jsonb_build_array(contact||jsonb_build_object('isPrimary',true,'isEmergency',false)));
    authority:=authority||jsonb_build_object('contacts','central');
  end if;
  p:=private.validate_intake_profile(p||jsonb_build_object('clientCode',p_client_code));
  if p_client is null then
    insert into public.clients(organization_id,branch_id,client_code,display_name,date_of_birth,status,admitted_on,source_system,source_updated_at)
      values(p_org,p_branch,p->>'clientCode',p->>'displayName',private.intake_date(p->>'dateOfBirth'),'active',null,'central_cms',source.completed_at) returning * into c;
    insert into private.client_intake_identities(organization_id,branch_id,client_id,identity_sha256) values(p_org,p_branch,c.id,ih);
  else
    update public.clients set display_name=p->>'displayName',date_of_birth=private.intake_date(p->>'dateOfBirth'),source_system='central_cms',
      source_updated_at=source.completed_at,row_version=c.row_version+1,updated_at=clock_timestamp() where id=c.id returning * into c;
  end if;
  for target in select jsonb_object_keys(p) loop
    if not(authority ? target) then authority:=authority||jsonb_build_object(target,'local'); end if;
  end loop;
  insert into private.client_intake_versions(organization_id,branch_id,client_id,version,profile,field_authority,source_batch_id,actor_user_id)
    values(p_org,p_branch,c.id,coalesce(v.version,0)+1,p,authority,p_batch,auth.uid());
  result:=jsonb_build_object('clientId',c.id,'profileVersion',coalesce(v.version,0)+1,'clientRowVersion',c.row_version,
    'pending',c.admitted_on is null,'replayed',false,'formallyImported',true,'batchId',p_batch,'operationId',p_operation);
  insert into private.client_intake_operations(organization_id,branch_id,client_id,actor_user_id,idempotency_key,request_sha256,operation_kind,
    reauth_challenge_id,source_batch_id,source_payload_sha256,source_review_reason,decisions,receipt)
    values(p_org,p_branch,c.id,auth.uid(),p_operation,h,'commit_cms',challenge,p_batch,p_payload_sha256,p_source_review_reason,p_decisions,result);
  perform private.require_intake_authority(p_org,p_branch,c.id,true);
  perform private.require_import_upload_authority(p_org,p_branch);
  return result;
end;
$$;

create function public.create_intake_client(p_org uuid,p_branch uuid,p_operation uuid,p_profile jsonb) returns jsonb
language sql volatile security invoker set search_path='' as $$
select private.write_intake_profile(p_org,p_branch,p_operation,null,null,null,p_profile);
$$;
create function public.update_intake_profile(p_org uuid,p_branch uuid,p_operation uuid,p_client uuid,p_expected_version bigint,p_expected_client_version bigint,p_profile jsonb) returns jsonb
language plpgsql volatile security invoker set search_path='' as $$
begin
  if p_client is null then raise exception using errcode='22023',message='INTAKE_CLIENT_REQUIRED'; end if;
  return private.write_intake_profile(p_org,p_branch,p_operation,p_client,p_expected_version,p_expected_client_version,p_profile);
end;
$$;
create function public.client_intake_snapshot(p_org uuid,p_branch uuid,p_client uuid) returns jsonb
language sql volatile security invoker set search_path='' as $$ select private.client_intake_snapshot(p_org,p_branch,p_client); $$;
create function public.cms_intake_preview(p_org uuid,p_branch uuid,p_batch uuid,p_client uuid) returns jsonb
language sql volatile security invoker set search_path='' as $$ select private.cms_intake_preview(p_org,p_branch,p_batch,p_client); $$;
create function public.find_cms_intake_source(p_org uuid,p_branch uuid,p_file_sha256 text) returns jsonb
language sql volatile security invoker set search_path='' as $$ select private.find_cms_intake_source(p_org,p_branch,p_file_sha256); $$;
create function public.commit_cms_intake(p_org uuid,p_branch uuid,p_operation uuid,p_batch uuid,p_payload_sha256 text,
  p_client uuid,p_expected_version bigint,p_expected_client_version bigint,p_client_code text,p_decisions jsonb,p_source_review_reason text default null) returns jsonb
language sql volatile security invoker set search_path='' as $$
select private.commit_cms_intake(p_org,p_branch,p_operation,p_batch,p_payload_sha256,p_client,p_expected_version,p_expected_client_version,p_client_code,p_decisions,p_source_review_reason);
$$;

-- Do not allow the previous scalar editor to bypass versioned profile history.
-- Legacy clients without a profile continue through their unchanged workflow.
create or replace function private.update_local_client_guarded(
  p_expected_organization_id uuid,p_expected_branch_id uuid,p_client_id uuid,
  p_client_code text,p_display_name text,p_date_of_birth date,p_expected_row_version bigint,p_idempotency_key uuid
) returns table(operation_id uuid,client_id uuid,row_version bigint,replayed boolean)
language plpgsql volatile security definer set search_path='' as $$
begin
  if not private.has_permission(p_expected_organization_id,p_expected_branch_id,'clients.read')
    or not private.has_permission(p_expected_organization_id,p_expected_branch_id,'clients.manage')
    or not private.has_permission(p_expected_organization_id,p_expected_branch_id,'clients.demographics.read')
    or not private.can_staff_access_client(p_client_id,'clients.manage') then
    raise exception using errcode='42501',message='local client update requires current assignment, read, manage, and demographic field authority';
  end if;
  if exists(select 1 from private.client_intake_versions v where v.client_id=p_client_id) then
    raise exception using errcode='42501',message='INTAKE_USE_PROFILE_WORKFLOW'; end if;
  return query select updated.operation_id,updated.client_id,updated.row_version,updated.replayed
    from private.update_local_client_atomic(p_expected_organization_id,p_expected_branch_id,p_client_id,
      p_client_code,p_display_name,p_date_of_birth,p_expected_row_version,p_idempotency_key) updated;
end;
$$;

do $acl$ declare fn regprocedure; begin
  for fn in select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname in('private','public') and p.proname=any(array['intake_central_keys','intake_date','validate_intake_profile',
      'require_intake_authority','client_intake_snapshot','write_intake_profile','cms_intake_field_target','cms_intake_source_value',
      'cms_intake_preview','find_cms_intake_source','commit_cms_intake','cms_intake_official_date','cms_intake_preview_field','create_intake_client','update_intake_profile']) loop
    execute format('alter function %s owner to postgres',fn);
    execute format('revoke all on function %s from public,anon,authenticated,service_role',fn);
  end loop;
end $acl$;
grant execute on function public.create_intake_client(uuid,uuid,uuid,jsonb),
  public.update_intake_profile(uuid,uuid,uuid,uuid,bigint,bigint,jsonb), public.client_intake_snapshot(uuid,uuid,uuid),
  public.cms_intake_preview(uuid,uuid,uuid,uuid), public.commit_cms_intake(uuid,uuid,uuid,uuid,text,uuid,bigint,bigint,text,jsonb,text),
  public.find_cms_intake_source(uuid,uuid,text),private.find_cms_intake_source(uuid,uuid,text),
  private.write_intake_profile(uuid,uuid,uuid,uuid,bigint,bigint,jsonb), private.client_intake_snapshot(uuid,uuid,uuid),
  private.cms_intake_preview(uuid,uuid,uuid,uuid), private.commit_cms_intake(uuid,uuid,uuid,uuid,text,uuid,bigint,bigint,text,jsonb,text)
to authenticated;

comment on table private.client_intake_versions is 'Append-only sensitive intake profile history. Demographic permission and assigned scope required. Not clinical signatures or official centre assessments.';
comment on function public.commit_cms_intake(uuid,uuid,uuid,uuid,text,uuid,bigint,bigint,text,jsonb,text) is 'Atomic CMS promotion from immutable worker-attested staging. Explicit source field decisions, exact identity and row versions; preserves local records and full source history. Does not admit or sign.';
commit;
