begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

-- This ledger records a result already obtained from an institution-approved
-- paper/external instrument. It deliberately stores no questionnaire items,
-- answer keys, score rules, diagnoses, signatures, or care decisions.
create table private.external_assessment_results (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  branch_id uuid not null,
  client_id uuid not null references public.clients(id),
  instrument_key text not null check (instrument_key in (
    'spmsq', 'gds', 'fall_risk', 'nsi', 'barthel_adl', 'iadl',
    'swallowing', 'bsrs', 'chewing', 'mna'
  )),
  external_version text not null check (length(external_version) between 1 and 80),
  assessed_on date not null,
  score numeric(8,2),
  maximum_score numeric(8,2),
  external_result text not null check (length(external_result) between 1 and 500),
  performed_by text not null check (length(performed_by) between 1 and 120),
  source text not null check (length(source) between 1 and 120),
  follow_up_due_on date,
  follow_up_note text check (follow_up_note is null or length(follow_up_note) <= 500),
  content_hash text not null check (content_hash ~ '^[a-f0-9]{64}$'),
  actor_id uuid not null references auth.users(id),
  created_at timestamptz not null default clock_timestamp(),
  foreign key (branch_id, organization_id)
    references public.branches(id, organization_id),
  check ((score is null) = (maximum_score is null)),
  check (score is null or (score >= 0 and maximum_score > 0 and score <= maximum_score)),
  check (assessed_on between date '1900-01-01' and date '2200-12-31'),
  check (follow_up_due_on is null or follow_up_due_on between date '1900-01-01' and date '2200-12-31')
);
create index external_assessment_results_client_idx
  on private.external_assessment_results (organization_id, branch_id, client_id, assessed_on desc, created_at desc);
create table private.external_assessment_result_receipts (
  organization_id uuid not null references public.organizations(id),
  actor_id uuid not null references auth.users(id),
  idempotency_key uuid not null,
  request_hash text not null check (request_hash ~ '^[a-f0-9]{64}$'),
  result_id uuid not null references private.external_assessment_results(id),
  primary key (organization_id, actor_id, idempotency_key)
);
alter table private.external_assessment_results enable row level security;
alter table private.external_assessment_results force row level security;
alter table private.external_assessment_result_receipts enable row level security;
alter table private.external_assessment_result_receipts force row level security;
revoke all on private.external_assessment_results, private.external_assessment_result_receipts
  from public, anon, authenticated, service_role;

create function private.reject_external_assessment_mutation()
returns trigger language plpgsql set search_path = '' as $$
begin
  raise exception using errcode = '23514', message = 'external assessment result history is append only';
end; $$;
create trigger external_assessment_results_append_only
  before update or delete on private.external_assessment_results
  for each row execute function private.reject_external_assessment_mutation();
create trigger external_assessment_result_receipts_append_only
  before update or delete on private.external_assessment_result_receipts
  for each row execute function private.reject_external_assessment_mutation();

create function private.external_assessment_result_json(r private.external_assessment_results)
returns jsonb language sql stable set search_path = '' as $$
  select jsonb_build_object(
    'id', r.id, 'clientId', r.client_id, 'instrumentKey', r.instrument_key,
    'externalVersion', r.external_version, 'assessedOn', r.assessed_on,
    'score', r.score, 'maximumScore', r.maximum_score,
    'externalResult', r.external_result, 'performedBy', r.performed_by,
    'source', r.source, 'followUpDueOn', r.follow_up_due_on,
    'followUpNote', r.follow_up_note, 'actorId', r.actor_id, 'createdAt', r.created_at
  );
$$;

create function private.write_external_assessment_result(
  p_org uuid, p_branch uuid, p_client uuid, p_key uuid, p_payload jsonb
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := auth.uid();
  request_hash text;
  receipt private.external_assessment_result_receipts%rowtype;
  result_row private.external_assessment_results%rowtype;
  assessed date;
  follow_up date;
  score_value numeric(8,2);
  maximum_value numeric(8,2);
  stamp timestamptz := clock_timestamp();
begin
  perform private.assert_custom_response_access(p_org, p_branch, p_client, 'care_records.write');
  if actor is null or p_key is null or jsonb_typeof(p_payload) is distinct from 'object'
     or octet_length(p_payload::text) > 12000
     or p_payload - array['instrumentKey','externalVersion','assessedOn','score','maximumScore',
        'externalResult','performedBy','source','followUpDueOn','followUpNote'] <> '{}'::jsonb
     or not (p_payload ?& array['instrumentKey','externalVersion','assessedOn','score','maximumScore',
        'externalResult','performedBy','source','followUpDueOn','followUpNote']) then
    raise exception using errcode = '22023', message = 'invalid external result payload';
  end if;
  if not coalesce(p_payload->>'instrumentKey' in (
      'spmsq','gds','fall_risk','nsi','barthel_adl','iadl','swallowing','bsrs','chewing','mna'
    ), false)
     or jsonb_typeof(p_payload->'externalVersion') is distinct from 'string'
     or length(btrim(p_payload->>'externalVersion')) not between 1 and 80
     or (p_payload->>'externalVersion') ~ '[[:cntrl:]<>]'
     or jsonb_typeof(p_payload->'externalResult') is distinct from 'string'
     or length(btrim(p_payload->>'externalResult')) not between 1 and 500
     or (p_payload->>'externalResult') ~ '[[:cntrl:]<>]'
     or jsonb_typeof(p_payload->'performedBy') is distinct from 'string'
     or length(btrim(p_payload->>'performedBy')) not between 1 and 120
     or (p_payload->>'performedBy') ~ '[[:cntrl:]<>]'
     or jsonb_typeof(p_payload->'source') is distinct from 'string'
     or length(btrim(p_payload->>'source')) not between 1 and 120
     or (p_payload->>'source') ~ '[[:cntrl:]<>]' then
    raise exception using errcode = '22023', message = 'invalid external result fields';
  end if;
  begin
    if not coalesce((p_payload->>'assessedOn') ~ '^\d{4}-\d{2}-\d{2}$', false) then raise exception 'date'; end if;
    assessed := (p_payload->>'assessedOn')::date;
    if assessed < date '1900-01-01' or assessed > (stamp at time zone 'Asia/Taipei')::date then raise exception 'date'; end if;
    if p_payload->'followUpDueOn' = 'null'::jsonb then follow_up := null;
    else
      if not coalesce((p_payload->>'followUpDueOn') ~ '^\d{4}-\d{2}-\d{2}$', false) then raise exception 'date'; end if;
      follow_up := (p_payload->>'followUpDueOn')::date;
      if follow_up < date '1900-01-01' or follow_up > date '2200-12-31' then raise exception 'date'; end if;
    end if;
    if p_payload->'score' = 'null'::jsonb then score_value := null;
    else
      if jsonb_typeof(p_payload->'score') is distinct from 'number' then raise exception 'number'; end if;
      score_value := (p_payload->>'score')::numeric;
    end if;
    if p_payload->'maximumScore' = 'null'::jsonb then maximum_value := null;
    else
      if jsonb_typeof(p_payload->'maximumScore') is distinct from 'number' then raise exception 'number'; end if;
      maximum_value := (p_payload->>'maximumScore')::numeric;
    end if;
  exception when others then
    raise exception using errcode = '22023', message = 'invalid external result date or number';
  end;
  if (score_value is null) <> (maximum_value is null)
     or (score_value is not null and (score_value < 0 or maximum_value <= 0 or score_value > maximum_value
       or score_value > 100000 or maximum_value > 100000
       or score_value <> trunc(score_value,2) or maximum_value <> trunc(maximum_value,2)))
     or (p_payload->'followUpNote' <> 'null'::jsonb and (
       jsonb_typeof(p_payload->'followUpNote') is distinct from 'string'
       or length(p_payload->>'followUpNote') > 500
       or (p_payload->>'followUpNote') ~ '[[:cntrl:]<>]')) then
    raise exception using errcode = '22023', message = 'invalid external result values';
  end if;

  request_hash := encode(sha256(convert_to(jsonb_build_object(
    'org',p_org,'branch',p_branch,'client',p_client,'payload',p_payload
  )::text,'UTF8')),'hex');
  perform pg_advisory_xact_lock(hashtextextended('external-assessment-result:'||p_org||':'||actor||':'||p_key,0));
  perform private.assert_custom_response_access(p_org,p_branch,p_client,'care_records.write');
  select * into receipt from private.external_assessment_result_receipts
   where organization_id=p_org and actor_id=actor and idempotency_key=p_key;
  if found then
    if receipt.request_hash <> request_hash then
      raise exception using errcode = '23505', message = 'external result idempotency conflict';
    end if;
    select * into strict result_row from private.external_assessment_results where id=receipt.result_id;
    return jsonb_build_object('record',private.external_assessment_result_json(result_row),'replayed',true);
  end if;

  insert into private.external_assessment_results(
    organization_id,branch_id,client_id,instrument_key,external_version,assessed_on,score,maximum_score,
    external_result,performed_by,source,follow_up_due_on,follow_up_note,content_hash,actor_id
  ) values (
    p_org,p_branch,p_client,p_payload->>'instrumentKey',btrim(p_payload->>'externalVersion'),assessed,
    score_value,maximum_value,btrim(p_payload->>'externalResult'),btrim(p_payload->>'performedBy'),
    btrim(p_payload->>'source'),follow_up,nullif(btrim(p_payload->>'followUpNote'),''),request_hash,actor
  ) returning * into result_row;
  insert into private.external_assessment_result_receipts(organization_id,actor_id,idempotency_key,request_hash,result_id)
    values(p_org,actor,p_key,request_hash,result_row.id);
  perform private.assert_custom_response_access(p_org,p_branch,p_client,'care_records.write');
  insert into public.audit_events(organization_id,branch_id,actor_user_id,action,table_name,row_pk,changed_fields,metadata)
    values(p_org,p_branch,actor,'insert','external_assessment_results',result_row.id::text,
      array['instrument_key','assessed_on','score','maximum_score','follow_up_due_on'],
      jsonb_build_object('instrument_key',result_row.instrument_key,'external_result_only',true));
  return jsonb_build_object('record',private.external_assessment_result_json(result_row),'replayed',false);
end; $$;

create function private.read_external_assessment_results(p_org uuid,p_branch uuid,p_client uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare records jsonb; total integer; stamp timestamptz := clock_timestamp();
begin
  perform private.assert_custom_response_access(p_org,p_branch,p_client,'care_records.read');
  with scoped as materialized (
    select r.* from private.external_assessment_results r
     where r.organization_id=p_org and r.branch_id=p_branch and r.client_id=p_client
  ), page as (
    select * from scoped order by assessed_on desc,created_at desc,id desc limit 51
  )
  select (select count(*) from scoped),
    coalesce((select jsonb_agg(private.external_assessment_result_json(r) order by r.assessed_on desc,r.created_at desc,r.id desc) from page r),'[]')
    into total,records;
  perform private.assert_custom_response_access(p_org,p_branch,p_client,'care_records.read');
  insert into public.audit_events(organization_id,branch_id,actor_user_id,action,table_name,row_pk,changed_fields,metadata)
    values(p_org,p_branch,auth.uid(),'select','external_assessment_results',p_client::text,'{}',
      jsonb_build_object('loaded',least(jsonb_array_length(records),50)));
  perform private.assert_custom_response_access(p_org,p_branch,p_client,'care_records.read');
  return jsonb_build_object('clientId',p_client,'records',case when jsonb_array_length(records)>50 then records-50 else records end,
    'total',total,'hasMore',jsonb_array_length(records)>50,'generatedAt',stamp);
end; $$;

create function public.write_external_assessment_result(p_org uuid,p_branch uuid,p_client uuid,p_key uuid,p_payload jsonb)
returns jsonb language sql security invoker set search_path = '' as $$
  select private.write_external_assessment_result(p_org,p_branch,p_client,p_key,p_payload);
$$;
create function public.read_external_assessment_results(p_org uuid,p_branch uuid,p_client uuid)
returns jsonb language sql security invoker set search_path = '' as $$
  select private.read_external_assessment_results(p_org,p_branch,p_client);
$$;

revoke all on function private.reject_external_assessment_mutation(),
  private.external_assessment_result_json(private.external_assessment_results),
  private.write_external_assessment_result(uuid,uuid,uuid,uuid,jsonb),
  private.read_external_assessment_results(uuid,uuid,uuid),
  public.write_external_assessment_result(uuid,uuid,uuid,uuid,jsonb),
  public.read_external_assessment_results(uuid,uuid,uuid)
  from public,anon,authenticated,service_role;
grant execute on function private.write_external_assessment_result(uuid,uuid,uuid,uuid,jsonb),
  private.read_external_assessment_results(uuid,uuid,uuid),
  public.write_external_assessment_result(uuid,uuid,uuid,uuid,jsonb),
  public.read_external_assessment_results(uuid,uuid,uuid) to authenticated;
commit;
