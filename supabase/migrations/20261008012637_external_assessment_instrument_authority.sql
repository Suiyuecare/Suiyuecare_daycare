begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

-- The external result ledger is intentionally distinct from the official
-- questionnaire drafts. Its permission boundary must nevertheless be at
-- least as narrow as that of the corresponding instrument. Care-record
-- access alone must never reveal cognition, mood or other clinical results.
create function private.external_assessment_instrument_authority(
  p_org uuid, p_branch uuid, p_client uuid, p_instrument text, p_access text
) returns boolean language sql volatile security definer set search_path = '' as $$
  select case
    when p_access is null or p_access not in ('read', 'manage') or p_client is null then false
    when p_instrument = 'spmsq' then
      private.questionnaire_assessment_authority(p_org,p_branch,p_client,'spmsq',p_access)
    when p_instrument = 'gds' then
      private.questionnaire_assessment_authority(p_org,p_branch,p_client,'gds_15',p_access)
    when p_instrument = 'fall_risk' then
      private.questionnaire_assessment_authority(p_org,p_branch,p_client,'fall_risk_taipei_115',p_access)
    when p_instrument = 'nsi' then
      private.questionnaire_assessment_authority(p_org,p_branch,p_client,'nsi_determine',p_access)
    when p_instrument = 'barthel_adl' then
      private.questionnaire_assessment_authority(p_org,p_branch,p_client,'barthel_adl',p_access)
    when p_instrument = 'iadl' then
      private.questionnaire_assessment_authority(p_org,p_branch,p_client,'lawton_iadl',p_access)
    when p_instrument = 'swallowing' then
      private.questionnaire_assessment_authority(p_org,p_branch,p_client,'eat10_swallowing',p_access)
    when p_instrument = 'bsrs' then
      private.questionnaire_assessment_authority(p_org,p_branch,p_client,'bsrs5',p_access)
    when p_instrument = 'mna' then
      private.questionnaire_assessment_authority(p_org,p_branch,p_client,'mna_sf',p_access)
    when p_instrument = 'chewing' then
      private.chewing_client_authority(p_org,p_branch,p_client,
        case when p_access = 'manage' then 'chewing_assessments.manage'
             else 'chewing_assessments.read' end)
    else false
  end;
$$;

-- Preserve the original idempotent write and append-only schema. Replacing
-- the function body rather than wrapping it ensures direct calls to its
-- existing private/public RPC signatures cannot bypass the new guard.
create or replace function private.write_external_assessment_result(
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
  instrument text;
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
  instrument := p_payload->>'instrumentKey';
  if not coalesce(instrument in (
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
  if not private.external_assessment_instrument_authority(p_org,p_branch,p_client,instrument,'manage') then
    raise exception using errcode = '42501', message = 'external result instrument is not permitted';
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
  if not private.external_assessment_instrument_authority(p_org,p_branch,p_client,instrument,'manage') then
    raise exception using errcode = '42501', message = 'external result instrument is not permitted';
  end if;
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
    p_org,p_branch,p_client,instrument,btrim(p_payload->>'externalVersion'),assessed,
    score_value,maximum_value,btrim(p_payload->>'externalResult'),btrim(p_payload->>'performedBy'),
    btrim(p_payload->>'source'),follow_up,nullif(btrim(p_payload->>'followUpNote'),''),request_hash,actor
  ) returning * into result_row;
  insert into private.external_assessment_result_receipts(organization_id,actor_id,idempotency_key,request_hash,result_id)
    values(p_org,actor,p_key,request_hash,result_row.id);
  perform private.assert_custom_response_access(p_org,p_branch,p_client,'care_records.write');
  if not private.external_assessment_instrument_authority(p_org,p_branch,p_client,instrument,'manage') then
    raise exception using errcode = '42501', message = 'external result instrument is not permitted';
  end if;
  insert into public.audit_events(organization_id,branch_id,actor_user_id,action,table_name,row_pk,changed_fields,metadata)
    values(p_org,p_branch,actor,'insert','external_assessment_results',result_row.id::text,
      array['instrument_key','assessed_on','score','maximum_score','follow_up_due_on'],
      jsonb_build_object('instrument_key',result_row.instrument_key,'external_result_only',true));
  return jsonb_build_object('record',private.external_assessment_result_json(result_row),'replayed',false);
end; $$;

create function private.read_external_assessment_results_scoped(
  p_org uuid, p_branch uuid, p_client uuid, p_instrument text
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  records jsonb;
  total integer;
  allowed_instruments text[];
  visible_instruments text[];
  stamp timestamptz := clock_timestamp();
begin
  perform private.assert_custom_response_access(p_org,p_branch,p_client,'care_records.read');
  if p_instrument is not null then
    if not private.external_assessment_instrument_authority(p_org,p_branch,p_client,p_instrument,'read') then
      raise exception using errcode = '42501', message = 'external result instrument is not permitted';
    end if;
    allowed_instruments := array[p_instrument];
  else
    select array_agg(instrument) into allowed_instruments
    from unnest(array['spmsq','gds','fall_risk','nsi','barthel_adl','iadl',
      'swallowing','bsrs','chewing','mna']) instrument
    where private.external_assessment_instrument_authority(p_org,p_branch,p_client,instrument,'read');
    if coalesce(cardinality(allowed_instruments),0) = 0 then
      raise exception using errcode = '42501', message = 'external result instrument is not permitted';
    end if;
  end if;
  with scoped as materialized (
    select r.* from private.external_assessment_results r
     where r.organization_id=p_org and r.branch_id=p_branch and r.client_id=p_client
       and r.instrument_key = any(allowed_instruments)
  ), page as (
    select * from scoped order by assessed_on desc,created_at desc,id desc limit 51
  )
  select (select count(*) from scoped),
    coalesce((select jsonb_agg(private.external_assessment_result_json(r) order by r.assessed_on desc,r.created_at desc,r.id desc) from page r),'[]'),
    (select array_agg(distinct instrument_key) from scoped)
    into total,records,visible_instruments;
  perform private.assert_custom_response_access(p_org,p_branch,p_client,'care_records.read');
  if (p_instrument is not null and not private.external_assessment_instrument_authority(p_org,p_branch,p_client,p_instrument,'read'))
     or exists (select 1 from unnest(coalesce(visible_instruments,array[]::text[])) instrument
       where not private.external_assessment_instrument_authority(p_org,p_branch,p_client,instrument,'read')) then
    raise exception using errcode = '42501', message = 'external result instrument is not permitted';
  end if;
  insert into public.audit_events(organization_id,branch_id,actor_user_id,action,table_name,row_pk,changed_fields,metadata)
    values(p_org,p_branch,auth.uid(),'select','external_assessment_results',p_client::text,'{}',
      jsonb_build_object('loaded',least(jsonb_array_length(records),50),'instrument_key',p_instrument));
  perform private.assert_custom_response_access(p_org,p_branch,p_client,'care_records.read');
  if (p_instrument is not null and not private.external_assessment_instrument_authority(p_org,p_branch,p_client,p_instrument,'read'))
     or exists (select 1 from unnest(coalesce(visible_instruments,array[]::text[])) instrument
       where not private.external_assessment_instrument_authority(p_org,p_branch,p_client,instrument,'read')) then
    raise exception using errcode = '42501', message = 'external result instrument is not permitted';
  end if;
  return jsonb_build_object('clientId',p_client,'records',case when jsonb_array_length(records)>50 then records-50 else records end,
    'total',total,'hasMore',jsonb_array_length(records)>50,'generatedAt',stamp);
end; $$;

-- Existing callers of the three-argument RPC now receive only instrument
-- types they are entitled to see; the four-argument RPC is the recommended
-- exact-instrument endpoint for the form workspace.
create or replace function private.read_external_assessment_results(p_org uuid,p_branch uuid,p_client uuid)
returns jsonb language sql security definer set search_path = '' as $$
  select private.read_external_assessment_results_scoped(p_org,p_branch,p_client,null);
$$;
create function public.read_external_assessment_results(p_org uuid,p_branch uuid,p_client uuid,p_instrument text)
returns jsonb language sql security invoker set search_path = '' as $$
  select private.read_external_assessment_results_scoped(p_org,p_branch,p_client,p_instrument);
$$;

revoke all on function private.external_assessment_instrument_authority(uuid,uuid,uuid,text,text),
  private.read_external_assessment_results_scoped(uuid,uuid,uuid,text),
  public.read_external_assessment_results(uuid,uuid,uuid,text)
  from public,anon,authenticated,service_role;
grant execute on function private.read_external_assessment_results_scoped(uuid,uuid,uuid,text),
  public.read_external_assessment_results(uuid,uuid,uuid,text) to authenticated;

-- The four-argument public RPC is new, so PostgREST must refresh its
-- function signatures and ACLs after this transaction commits.
notify pgrst, 'reload schema';

commit;
