-- Review-only care attention suggestions. No formal CMS promotion, care-plan,
-- dosage, diet order, or clinical-signature table is changed by this migration.
-- Browser never submits clinical fields. SQL reads immutable trusted staging.
create function private.care_reminder_rules_v1() returns jsonb
language sql immutable security invoker set search_path = '' as $rules$
select '[{"id":"cms.explicit_meal_assistance","section":"ASSESSMENT_E","labels":["進食","吃飯","E1.吃飯 ※ (不包含自行準備食物、餐具或盛裝食物等)"],"values":["需要協助","需部分協助","完全依賴","2.需要一些協助 ※ 5分"],"title":"進食協助需確認","text":"請依現行已核准照顧計畫確認進食協助方式；本提醒不指定飲食質地或改變餐食。"},{"id":"cms.explicit_transfer_assistance","section":"ASSESSMENT_E","labels":["移位","上下床移位","E8.移位"],"values":["需要協助","需部分協助","完全依賴","2.移位時需少部分協助或提醒 ※ 10分"],"title":"移位協助需確認","text":"移位前請確認現行照顧計畫中的協助方式、人力與輔具；未確認時請詢問負責專業人員。"},{"id":"cms.explicit_toileting_assistance","section":"ASSESSMENT_E","labels":["如廁","上廁所","E7.上廁所"],"values":["需要協助","需部分協助","完全依賴","2.需協助整理衣物或使用衛生紙或需協助清理便盆(尿壺) ※ 5分"],"title":"如廁協助需確認","text":"請依現行照顧計畫確認如廁協助與隱私安排，並記錄當次實際觀察。"},{"id":"cms.explicit_communication_assistance","section":"ASSESSMENT_C","labels":["溝通能力","表達能力","C4.個案表達能力(包含語言或非語言)"],"values":["需要協助","需部分協助","無法表達","2.僅可表達簡單的意思","3.雖能表達簡單的意思,但多數難以理解"],"title":"溝通方式需確認","text":"照顧前請確認個案適用的溝通方式，給予表達時間；無法確認需求時請向負責人核對。"}]'::jsonb;
$rules$;

create table private.care_reminder_generations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null, branch_id uuid not null, client_id uuid not null,
  batch_id uuid not null unique, actor_user_id uuid not null references auth.users(id),
  client_version bigint not null check(client_version>0),
  payload_sha256 text not null check(payload_sha256 ~ '^[a-f0-9]{64}$'),
  identity_confirmation_reason text not null check(char_length(btrim(identity_confirmation_reason)) between 5 and 1000),
  created_at timestamptz not null default clock_timestamp(),
  foreign key(client_id,organization_id,branch_id) references public.clients(id,organization_id,branch_id),
  foreign key(batch_id,organization_id,branch_id) references private.import_upload_reservations(id,organization_id,branch_id)
);
create index care_reminder_generations_client_idx on private.care_reminder_generations(client_id,organization_id,branch_id,created_at desc);
create index care_reminder_generations_actor_idx on private.care_reminder_generations(actor_user_id,created_at desc);
create table private.care_reminders (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null, branch_id uuid not null, client_id uuid not null,
  generation_id uuid not null references private.care_reminder_generations(id),
  batch_id uuid not null references private.import_upload_completions(id),
  rule_id text not null, rule_version text not null check(rule_version='cms-explicit-attention@1'),
  title text not null, body text not null, source jsonb not null check(jsonb_typeof(source)='object'),
  created_at timestamptz not null default clock_timestamp(),
  foreign key(client_id,organization_id,branch_id) references public.clients(id,organization_id,branch_id),
  unique(generation_id,rule_id)
);
create index care_reminders_client_idx on private.care_reminders(client_id,organization_id,branch_id,generation_id);
create index care_reminders_batch_idx on private.care_reminders(batch_id);
create table private.care_reminder_reviews (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null, branch_id uuid not null,
  reminder_id uuid not null references private.care_reminders(id),
  actor_user_id uuid not null references auth.users(id),
  decision text not null check(decision in('confirmed','dismissed')),
  reason text not null check(char_length(btrim(reason)) between 5 and 1000),
  created_at timestamptz not null default clock_timestamp()
);
create index care_reminder_reviews_latest_idx on private.care_reminder_reviews(reminder_id,created_at desc);
create index care_reminder_reviews_actor_idx on private.care_reminder_reviews(actor_user_id,created_at desc);
create table private.care_reminder_operations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null, branch_id uuid not null,
  actor_user_id uuid not null references auth.users(id), idempotency_key uuid not null,
  payload_sha256 text not null, receipt jsonb not null, created_at timestamptz not null default clock_timestamp(),
  unique(actor_user_id,idempotency_key)
);
do $tables$ declare t text; begin
  foreach t in array array['care_reminder_generations','care_reminders','care_reminder_reviews','care_reminder_operations'] loop
    execute format('alter table private.%I enable row level security',t);
    execute format('alter table private.%I force row level security',t);
    execute format('revoke all on private.%I from public,anon,authenticated,service_role',t);
    execute format('create trigger %I before update or delete on private.%I for each row execute function private.prevent_import_upload_mutation()',t||'_immutable',t);
    execute format('create trigger %I after insert on private.%I for each row execute function private.audit_row_change()',t||'_audit',t);
  end loop;
end $tables$;

create function private.can_read_care_reminders(p_client_id uuid)
returns boolean language sql volatile security definer set search_path='' as $$
select auth.uid() is not null
  and (private.can_staff_access_client(p_client_id,'clients.read') or private.can_executive_read_client(p_client_id,'clients.read'))
  and (private.can_staff_access_client(p_client_id,'health.read') or private.can_executive_read_client(p_client_id,'health.read'))
  and (private.can_staff_access_client(p_client_id,'care_records.read') or private.can_executive_read_client(p_client_id,'care_records.read'));
$$;
create function private.can_review_care_reminders(p_client_id uuid,p_org uuid,p_branch uuid)
returns boolean language sql volatile security definer set search_path='' as $$
select private.can_read_care_reminders(p_client_id)
  and private.has_permission(p_org,p_branch,'imports.approve')
  and private.has_permission(p_org,p_branch,'care_records.sign')
  and private.has_permission(p_org,p_branch,'imports.manage');
$$;

-- The same deliberately narrow explicit-option dictionary is parity-tested
-- against the TypeScript preview. Conflicting, masked, empty, warning-bearing,
-- unknown and unsupported numeric options never become clinical conclusions.
create function private.derive_care_reminders_v1(p_payload jsonb)
returns jsonb language plpgsql immutable security invoker set search_path='' as $$
declare r jsonb; f jsonb; candidates jsonb; first_field jsonb; bad boolean; result jsonb:='[]';
begin
  if p_payload->>'mappingVersion' is distinct from 'central-care-plan-html@1'
    or jsonb_typeof(p_payload->'fields') is distinct from 'array'
    or jsonb_typeof(p_payload->'conflicts') is distinct from 'array' then return result; end if;
  for r in select value from jsonb_array_elements(private.care_reminder_rules_v1()) loop
    select coalesce(jsonb_agg(value),'[]') into candidates from jsonb_array_elements(p_payload->'fields')
    where value->'source'->>'sectionCode'=r->>'section' and r->'labels' ? (value->'source'->>'label');
    if jsonb_array_length(candidates)=0 then continue; end if;
    first_field:=candidates->0; bad:=false;
    for f in select value from jsonb_array_elements(candidates) loop
      if f->>'mappingState' is distinct from 'mapped'
        or f->>'mappingVersion' is distinct from 'central-care-plan-html@1'
        or f->'warnings' is distinct from '[]'::jsonb
        or f->'source'->>'parentPath' is null
        or not starts_with(f->'source'->>'parentPath',(r->>'section')||'/')
        or f->>'mappingKey' is distinct from (r->>'section')||chr(31)||(f->'source'->>'label')||chr(31)||(f->'source'->>'parentPath')
        or f->>'targetPath' is null or not starts_with(f->>'targetPath','central.'||lower(r->>'section')||'.')
        or not (r->'values' ? coalesce(f->>'normalizedValue',''))
        or f->>'normalizedValue' is distinct from first_field->>'normalizedValue'
        or exists(select 1 from jsonb_array_elements(p_payload->'conflicts') c where c->>'mappingKey'=f->>'mappingKey')
      then bad:=true; end if;
    end loop;
    if bad then continue; end if;
    result:=result||jsonb_build_array(jsonb_build_object('ruleId',r->>'id','ruleVersion','cms-explicit-attention@1',
      'title',r->>'title','text',r->>'text','fieldId',first_field->>'id',
      'sectionCode',first_field->'source'->>'sectionCode','label',first_field->'source'->>'label',
      'parentPath',first_field->'source'->>'parentPath','targetPath',first_field->>'targetPath',
      'mappingKey',first_field->>'mappingKey','sourceValue',first_field->>'normalizedValue'));
  end loop;
  return result;
end;
$$;

create function private.care_reminder_snapshot(p_org uuid,p_branch uuid,p_client uuid)
returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare v_client public.clients%rowtype; reviewer boolean; records jsonb; sources jsonb; latest uuid;
begin
  select * into v_client from public.clients where id=p_client and organization_id=p_org and branch_id=p_branch;
  if not found or not private.can_read_care_reminders(p_client) then
    raise exception using errcode='42501',message='CARE_REMINDER_ACCESS_DENIED'; end if;
  reviewer:=private.can_review_care_reminders(p_client,p_org,p_branch);
  select batch_id into latest from private.care_reminder_generations where client_id=p_client order by created_at desc,id desc limit 1;
  select coalesce(jsonb_agg(jsonb_build_object(
    'id',r.id,'batch_id',r.batch_id,'client_id',r.client_id,'rule_id',r.rule_id,'rule_version',r.rule_version,
    'title',r.title,'text',r.body,'source',r.source,'status',coalesce(review.decision,'pending_review'),
    'source_kind','trusted_staging','source_changed',r.batch_id is distinct from latest,
    'imported_at',c.completed_at,'reviewed_at',review.created_at,'reviewed_by',review.actor_user_id
  ) order by r.created_at desc,r.rule_id),'[]') into records
  from private.care_reminders r join private.import_upload_completions c on c.id=r.batch_id
  left join lateral(select v.* from private.care_reminder_reviews v where v.reminder_id=r.id order by v.created_at desc,v.id desc limit 1) review on true
  where r.client_id=p_client and r.organization_id=p_org and r.branch_id=p_branch
    and (review.decision='confirmed' or (reviewer and r.batch_id=latest));
  sources:='[]';
  if reviewer then
    select coalesce(jsonb_agg(jsonb_build_object('id',s.id,'completed_at',s.completed_at,'file_name',s.file_name,
      'payload_sha256',s.payload_sha256,'associated_client_id',s.associated_client_id) order by s.completed_at desc),'[]') into sources
    from (select c.id,c.completed_at,r.file_name,c.payload_sha256,g.client_id associated_client_id
      from private.import_upload_completions c join private.import_upload_reservations r on r.id=c.id
      left join private.care_reminder_generations g on g.batch_id=c.id
      where c.organization_id=p_org and c.branch_id=p_branch and (g.client_id is null or g.client_id=p_client)
      order by c.completed_at desc limit 50) s;
  end if;
  insert into public.audit_events(organization_id,branch_id,actor_user_id,action,table_name,row_pk,metadata)
  values(p_org,p_branch,auth.uid(),'select','private.care_reminders',p_client::text,
    jsonb_build_object('projection','reviewed_attention','result_count',jsonb_array_length(records),'reviewer',reviewer));
  return jsonb_build_object('client_id',p_client,'client_version',v_client.row_version,'reviewer',reviewer,
    'generated_at',clock_timestamp(),'formally_imported',false,'reminders',records,'sources',sources);
end;
$$;

create function private.mutate_care_reminders(p_org uuid,p_branch uuid,p_payload jsonb,p_key uuid)
returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare v_client uuid; v_action text; v_batch uuid; v_source private.import_upload_completions%rowtype;
  v_generation private.care_reminder_generations%rowtype; r private.care_reminders%rowtype;
  op private.care_reminder_operations%rowtype; v_hash text; v_reason text; v_current text; v_latest uuid;
  candidate jsonb; v_count integer:=0; receipt jsonb; v_version bigint;
begin
  if auth.uid() is null or p_payload is null or jsonb_typeof(p_payload)<>'object' or octet_length(p_payload::text)>8192
    or p_key is null then raise exception using errcode='22023',message='CARE_REMINDER_INVALID_INPUT'; end if;
  begin v_client:=(p_payload->>'client_id')::uuid; exception when invalid_text_representation then
    raise exception using errcode='22023',message='CARE_REMINDER_INVALID_INPUT'; end;
  if not exists(select 1 from public.clients where id=v_client and organization_id=p_org and branch_id=p_branch)
    or not private.can_review_care_reminders(v_client,p_org,p_branch) then
    raise exception using errcode='42501',message='CARE_REMINDER_ACCESS_DENIED'; end if;
  perform private.current_client_master_reauth_challenge();
  v_action:=p_payload->>'action'; v_reason:=btrim(p_payload->>'reason');
  if v_action is null or v_action not in('generate','confirm','dismiss') or v_reason is null or char_length(v_reason) not between 5 and 1000
    or p_payload->>'idempotency_key' is distinct from p_key::text then
    raise exception using errcode='22023',message='CARE_REMINDER_INVALID_INPUT'; end if;
  v_hash:=encode(sha256(convert_to(p_payload::text,'UTF8')),'hex');
  perform pg_advisory_xact_lock(hashtextextended('care-reminder-operation:'||auth.uid()||':'||p_key,0));
  select * into op from private.care_reminder_operations where actor_user_id=auth.uid() and idempotency_key=p_key;
  if found then
    if op.payload_sha256<>v_hash or op.organization_id<>p_org or op.branch_id<>p_branch then
      raise exception using errcode='23505',message='CARE_REMINDER_IDEMPOTENCY_CONFLICT'; end if;
    return op.receipt||jsonb_build_object('replayed',true);
  end if;
  -- One client lock serializes generations and reviews, preventing a review of
  -- a source replaced while the user was reading the candidate.
  perform pg_advisory_xact_lock(hashtextextended('care-reminder-client:'||v_client,0));
  if v_action='generate' then
    if (select count(*) from jsonb_object_keys(p_payload))<>8 or not(p_payload ?& array['action','client_id','batch_id','client_version','payload_sha256','identity_confirmed','reason','idempotency_key'])
      or p_payload->'identity_confirmed' is distinct from 'true'::jsonb then
      raise exception using errcode='22023',message='CARE_REMINDER_INVALID_INPUT';
    end if;
    begin v_batch:=(p_payload->>'batch_id')::uuid; v_version:=(p_payload->>'client_version')::bigint;
    exception when invalid_text_representation or numeric_value_out_of_range then raise exception using errcode='22023',message='CARE_REMINDER_INVALID_INPUT'; end;
    select * into v_source from private.import_upload_completions where id=v_batch and organization_id=p_org and branch_id=p_branch;
    if not found then raise exception using errcode='42501',message='CARE_REMINDER_SOURCE_UNAVAILABLE'; end if;
    if v_source.payload_sha256 is distinct from p_payload->>'payload_sha256'
      or not exists(select 1 from public.clients where id=v_client and row_version=v_version and status='active') then
      raise exception using errcode='40001',message='CARE_REMINDER_SOURCE_CHANGED'; end if;
    select * into v_generation from private.care_reminder_generations where batch_id=v_batch;
    if found then
      if v_generation.client_id<>v_client then raise exception using errcode='42501',message='CARE_REMINDER_SOURCE_UNAVAILABLE'; end if;
    else
      if exists(select 1 from private.care_reminder_generations g join private.import_upload_completions c on c.id=g.batch_id
        where g.client_id=v_client and c.completed_at>=v_source.completed_at) then
        raise exception using errcode='40001',message='CARE_REMINDER_OLDER_SOURCE'; end if;
      insert into private.care_reminder_generations(organization_id,branch_id,client_id,batch_id,actor_user_id,client_version,payload_sha256,identity_confirmation_reason)
      values(p_org,p_branch,v_client,v_batch,auth.uid(),v_version,v_source.payload_sha256,v_reason) returning * into v_generation;
      for candidate in select value from jsonb_array_elements(private.derive_care_reminders_v1(v_source.parsed_payload)) loop
        insert into private.care_reminders(organization_id,branch_id,client_id,generation_id,batch_id,rule_id,rule_version,title,body,source)
        values(p_org,p_branch,v_client,v_generation.id,v_batch,candidate->>'ruleId',candidate->>'ruleVersion',
          candidate->>'title',candidate->>'text',candidate - array['ruleId','ruleVersion','title','text']);
        v_count:=v_count+1;
      end loop;
    end if;
  else
    if (select count(*) from jsonb_object_keys(p_payload))<>6 or not(p_payload ?& array['action','client_id','reminder_id','reason','expected_status','idempotency_key']) then
      raise exception using errcode='22023',message='CARE_REMINDER_INVALID_INPUT'; end if;
    begin select * into r from private.care_reminders where id=(p_payload->>'reminder_id')::uuid and client_id=v_client
      and organization_id=p_org and branch_id=p_branch;
    exception when invalid_text_representation then raise exception using errcode='22023',message='CARE_REMINDER_INVALID_INPUT'; end;
    if not found then raise exception using errcode='42501',message='CARE_REMINDER_ACCESS_DENIED'; end if;
    select decision into v_current from private.care_reminder_reviews where reminder_id=r.id order by created_at desc,id desc limit 1;
    v_current:=coalesce(v_current,'pending_review');
    select batch_id into v_latest from private.care_reminder_generations where client_id=v_client order by created_at desc,id desc limit 1;
    if p_payload->>'expected_status' is distinct from v_current or v_current='dismissed'
      or (v_action='confirm' and (v_current<>'pending_review' or r.batch_id<>v_latest))
      or (v_current='pending_review' and r.batch_id<>v_latest) then
      raise exception using errcode='40001',message='CARE_REMINDER_SOURCE_CHANGED'; end if;
    insert into private.care_reminder_reviews(organization_id,branch_id,reminder_id,actor_user_id,decision,reason)
    values(p_org,p_branch,r.id,auth.uid(),case when v_action='confirm' then 'confirmed' else 'dismissed' end,v_reason);
    v_count:=1;
  end if;
  receipt:=jsonb_build_object('client_id',v_client,'action',v_action,'idempotency_key',p_key,'replayed',false,
    'formally_imported',false,'affected',v_count);
  insert into private.care_reminder_operations(organization_id,branch_id,actor_user_id,idempotency_key,payload_sha256,receipt)
  values(p_org,p_branch,auth.uid(),p_key,v_hash,receipt);
  return receipt;
end;
$$;

create function public.care_reminder_snapshot(p_expected_organization_id uuid,p_expected_branch_id uuid,p_client_id uuid)
returns jsonb language sql volatile security invoker set search_path='' as $$
select private.care_reminder_snapshot(p_expected_organization_id,p_expected_branch_id,p_client_id);
$$;
create function public.mutate_care_reminders(p_expected_organization_id uuid,p_expected_branch_id uuid,p_payload jsonb,p_idempotency_key uuid)
returns jsonb language sql volatile security invoker set search_path='' as $$
select private.mutate_care_reminders(p_expected_organization_id,p_expected_branch_id,p_payload,p_idempotency_key);
$$;
revoke all on function private.care_reminder_rules_v1(),private.derive_care_reminders_v1(jsonb),
  private.can_read_care_reminders(uuid),private.can_review_care_reminders(uuid,uuid,uuid),
  private.care_reminder_snapshot(uuid,uuid,uuid),private.mutate_care_reminders(uuid,uuid,jsonb,uuid),
  public.care_reminder_snapshot(uuid,uuid,uuid),public.mutate_care_reminders(uuid,uuid,jsonb,uuid)
  from public,anon,authenticated,service_role;
grant execute on function private.care_reminder_snapshot(uuid,uuid,uuid),private.mutate_care_reminders(uuid,uuid,jsonb,uuid),
  public.care_reminder_snapshot(uuid,uuid,uuid),public.mutate_care_reminders(uuid,uuid,jsonb,uuid) to authenticated;
