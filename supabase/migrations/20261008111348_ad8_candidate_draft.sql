-- AD8 is a candidate answer-only draft. Keep the existing append-only,
-- assigned-client/RLS/idempotency boundary; do not activate scoring or signing.
-- Wording basis: Taitung County Health Bureau AD8 form, 110-04-30 revision.

alter table public.questionnaire_assessment_versions
  drop constraint questionnaire_assessment_versions_form_key_check;
alter table public.questionnaire_assessment_versions
  add constraint questionnaire_assessment_versions_form_key_check
  check (form_key in ('spmsq','gds_15','barthel_adl','lawton_iadl','eat10_swallowing','bsrs5',
    'fall_risk_taipei_115','nsi_determine','mna_sf','ad8'));
alter table public.questionnaire_assessment_versions
  drop constraint questionnaire_assessment_versions_form_version_check;
alter table public.questionnaire_assessment_versions
  add constraint questionnaire_assessment_versions_form_version_check
  check (form_version in ('spmsq-pfeiffer-10-education-adjusted-v1','gds-15-strict-complete-v1',
    'barthel-adl-0-100-v1','lawton-iadl-8-domain-expanded-v1','eat10-tw-v1','bsrs5-zh-tw-v1',
    'fall-risk-taipei-community-115-b12-v1','nsi-determine-10-weighted-v1',
    'mna-sf-revised-2009-traditional-chinese-v1','ad8-taitung-1100430-candidate-v1'));

create or replace function private.questionnaire_assessment_authority(
  p_org uuid, p_branch uuid, p_client uuid, p_form_key text, p_access text
) returns boolean
language sql volatile security definer set search_path = '' as $$
  with required_permission as (
    select case
      when p_form_key in ('spmsq','ad8') and p_access in ('read','manage')
        then 'questionnaire_cognition'
      when p_form_key in ('barthel_adl','lawton_iadl') and p_access in ('read','manage')
        then 'questionnaire_adl'
      when p_form_key = 'eat10_swallowing' and p_access in ('read','manage')
        then 'questionnaire_swallowing'
      when p_form_key in ('bsrs5','gds_15') and p_access in ('read','manage')
        then 'questionnaire_emotion'
      when p_form_key = 'fall_risk_taipei_115' and p_access in ('read','manage')
        then 'questionnaire_fall'
      when p_form_key in ('nsi_determine','mna_sf') and p_access in ('read','manage')
        then 'questionnaire_nutrition'
      else null
    end as permission_key
  )
  select auth.uid() is not null
    and public.is_staff_login_allowed()
    and (select permission_key is not null from required_permission)
    and exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.is_active and p.kind in ('staff', 'professional')
    )
    and exists (
      select 1 from public.branches b join public.organizations o on o.id = b.organization_id
      where b.id = p_branch and b.organization_id = p_org and b.is_active and o.is_active
    )
    and private.questionnaire_assessment_permission(p_org, p_branch, 'clients.read')
    and private.questionnaire_assessment_permission(p_org, p_branch, (select permission_key from required_permission) || '.read')
    and private.questionnaire_assessment_permission(p_org, p_branch, (select permission_key from required_permission) || '.' || p_access)
    and (p_client is null or (
      exists (select 1 from public.clients c
        where c.id = p_client and c.organization_id = p_org and c.branch_id = p_branch)
      and (private.questionnaire_assessment_permission(p_org, p_branch, 'clients.view_all')
        or exists (select 1 from public.client_assignments a
          where a.client_id = p_client and a.organization_id = p_org
            and a.branch_id = p_branch and a.assignee_user_id = auth.uid()
            and a.starts_at <= clock_timestamp()
            and (a.ends_at is null or a.ends_at > clock_timestamp())))
    ));
$$;

create or replace function private.mutate_questionnaire_assessment_guarded(
  p_expected_organization_id uuid, p_expected_branch_id uuid,
  p_payload jsonb, p_idempotency_key uuid
) returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  v_actor uuid := auth.uid(); v_action text; v_client uuid; v_form text; v_form_version text;
  v_assessment_key uuid; v_previous uuid; v_expected integer; v_assessed_on date;
  v_answers jsonb; v_context jsonb; v_hash text; v_request_hash text;
  v_display_name text; v_now timestamptz := clock_timestamp(); v_prior public.questionnaire_assessment_versions%rowtype;
  v_result public.questionnaire_assessment_versions%rowtype; v_operation private.questionnaire_assessment_operations%rowtype;
  v_receipt jsonb; v_operation_id uuid := gen_random_uuid(); v_form_version_expected text;
begin
  if p_expected_organization_id is null or p_expected_branch_id is null or p_idempotency_key is null
    or jsonb_typeof(p_payload) is distinct from 'object' then
    raise exception using errcode = '22023', message = 'invalid questionnaire assessment payload';
  end if;
  v_action := p_payload->>'action';
  if v_action is null or v_action not in ('create','revise') then raise exception using errcode = '22023', message = 'invalid questionnaire action'; end if;
  v_form := p_payload->>'form_key';
  if v_form not in ('spmsq','gds_15','barthel_adl','lawton_iadl','eat10_swallowing','bsrs5','fall_risk_taipei_115','nsi_determine','mna_sf','ad8')
    or not private.questionnaire_assessment_authority(p_expected_organization_id, p_expected_branch_id, null, v_form, 'manage') then
    raise exception using errcode = '42501', message = 'questionnaire assessment is not permitted';
  end if;
  if p_payload ?| array['signature','score','classification','diagnosis','treatment','signed_by','signed_at'] then
    raise exception using errcode = '22023', message = 'draft endpoint does not accept score or signature fields';
  end if;
  if v_action = 'create' then
    if p_payload - array['action','client_id','form_key','form_version','assessed_on','answers','context'] <> '{}'::jsonb then
      raise exception using errcode = '22023', message = 'invalid questionnaire create keys';
    end if;
  else
    if p_payload - array['action','client_id','form_key','form_version','assessment_key','previous_version_id','expected_version','assessed_on','answers','context'] <> '{}'::jsonb then
      raise exception using errcode = '22023', message = 'invalid questionnaire revise keys';
    end if;
  end if;
  begin
    v_client := (p_payload->>'client_id')::uuid;
    v_assessment_key := nullif(p_payload->>'assessment_key','')::uuid;
    v_previous := nullif(p_payload->>'previous_version_id','')::uuid;
    v_expected := coalesce((p_payload->>'expected_version')::integer, 0);
    v_assessed_on := (p_payload->>'assessed_on')::date;
  exception when invalid_text_representation or numeric_value_out_of_range then
    raise exception using errcode = '22023', message = 'invalid questionnaire identifiers or date';
  end;
  v_form_version := p_payload->>'form_version';
  v_answers := p_payload->'answers'; v_context := coalesce(p_payload->'context','{}'::jsonb);
  v_form_version_expected := case v_form
    when 'spmsq' then 'spmsq-pfeiffer-10-education-adjusted-v1'
    when 'gds_15' then 'gds-15-strict-complete-v1'
    when 'barthel_adl' then 'barthel-adl-0-100-v1'
    when 'lawton_iadl' then 'lawton-iadl-8-domain-expanded-v1'
    when 'eat10_swallowing' then 'eat10-tw-v1'
    when 'bsrs5' then 'bsrs5-zh-tw-v1'
    when 'fall_risk_taipei_115' then 'fall-risk-taipei-community-115-b12-v1'
    when 'nsi_determine' then 'nsi-determine-10-weighted-v1'
    when 'mna_sf' then 'mna-sf-revised-2009-traditional-chinese-v1'
    when 'ad8' then 'ad8-taitung-1100430-candidate-v1' end;
  if v_form_version_expected is null or v_form_version is distinct from v_form_version_expected
    or v_client is null or v_assessed_on is null or v_assessed_on > (v_now at time zone 'Asia/Taipei')::date
    or jsonb_typeof(v_context) is distinct from 'object'
    or not private.questionnaire_answers_valid(v_form, v_answers) then
    raise exception using errcode = '22023', message = 'invalid questionnaire answers or governance version';
  end if;
  if not private.questionnaire_assessment_authority(p_expected_organization_id, p_expected_branch_id, v_client, v_form, 'manage') then
    raise exception using errcode = '42501', message = 'questionnaire client is not assigned or authorized';
  end if;
  if v_action = 'create' and (v_assessment_key is not null or v_previous is not null or v_expected <> 0) then
    raise exception using errcode = '22023', message = 'invalid create baseline';
  elsif v_action = 'revise' and (v_assessment_key is null or v_previous is null or v_expected < 1) then
    raise exception using errcode = '22023', message = 'invalid revise baseline';
  end if;
  v_hash := encode(sha256(convert_to(jsonb_build_object(
    'form_key',v_form,'form_version',v_form_version,'assessed_on',v_assessed_on,
    'answers',v_answers,'context',v_context
  )::text,'UTF8')),'hex');
  v_request_hash := encode(sha256(convert_to(jsonb_build_object(
    'action',v_action,'client_id',v_client,'form_key',v_form,'form_version',v_form_version,
    'assessment_key',v_assessment_key,'previous_version_id',v_previous,'expected_version',v_expected,
    'assessed_on',v_assessed_on,'answers',v_answers,'context',v_context
  )::text,'UTF8')),'hex');
  select * into v_operation from private.questionnaire_assessment_operations o
  where o.actor_user_id = v_actor and o.idempotency_key = p_idempotency_key for update;
  if found then
    if v_operation.request_hash <> v_request_hash then raise exception using errcode = '23505', message = 'idempotency key reused'; end if;
    return v_operation.receipt || jsonb_build_object('replayed',true);
  end if;
  if v_action = 'create' then
    v_assessment_key := gen_random_uuid();
    v_expected := 0;
  else
    select * into v_prior from public.questionnaire_assessment_versions r
      where r.id = v_previous and r.assessment_key = v_assessment_key
        and r.organization_id = p_expected_organization_id and r.branch_id = p_expected_branch_id
        and r.client_id = v_client and r.form_key = v_form and r.version = v_expected for update;
    if not found or exists(select 1 from public.questionnaire_assessment_versions child where child.previous_version_id = v_previous) then
      raise exception using errcode = '40001', message = 'questionnaire baseline changed';
    end if;
  end if;
  if v_expected >= 1000000 then raise exception using errcode = '22003', message = 'questionnaire version exhausted'; end if;
  select coalesce(nullif(btrim(p.display_name),''), split_part(u.email,'@',1), '員工') into v_display_name
  from public.profiles p left join auth.users u on u.id = p.id where p.id = v_actor;
  if v_display_name is null then raise exception using errcode = '42501', message = 'inactive questionnaire author'; end if;
  insert into public.questionnaire_assessment_versions(
    organization_id,branch_id,client_id,form_key,form_version,assessment_key,version,previous_version_id,
    assessed_on,answers,context,record_state,content_hash,author_user_id,author_display_name,write_reauth_challenge_id,created_at
  ) values (
    p_expected_organization_id,p_expected_branch_id,v_client,v_form,v_form_version,v_assessment_key,v_expected+1,
    case when v_action='create' then null else v_previous end,v_assessed_on,v_answers,v_context,'draft',v_hash,
    v_actor,v_display_name,null,v_now
  ) returning * into v_result;
  v_receipt := jsonb_build_object('action',v_action,'clientId',v_client,'formKey',v_form,
    'assessmentKey',v_assessment_key,'versionId',v_result.id,'version',v_result.version,
    'recordState','draft','assessedOn',v_assessed_on,'contentHash',v_hash,'committedAt',v_now,'replayed',false);
  insert into private.questionnaire_assessment_operations(
    id,organization_id,branch_id,client_id,actor_user_id,idempotency_key,request_hash,
    result_version_id,result_form_key,result_assessment_key,receipt
  ) values (v_operation_id,p_expected_organization_id,p_expected_branch_id,v_client,v_actor,p_idempotency_key,
    v_request_hash,v_result.id,v_form,v_assessment_key,v_receipt);
  return v_receipt;
end;
$$;

create or replace function private.questionnaire_answers_valid(p_form_key text, p_answers jsonb)
returns boolean language plpgsql immutable security invoker set search_path = '' as $$
declare v_key text; v_answer jsonb; v_value text; v_allowed text[];
  v_expected text[];
begin
  if jsonb_typeof(p_answers) is distinct from 'object' then return false; end if;
  v_expected := case p_form_key
    when 'spmsq' then array['spmsq_01','spmsq_02','spmsq_03','spmsq_04','spmsq_05','spmsq_06','spmsq_07','spmsq_08','spmsq_09','spmsq_10']
    when 'gds_15' then array['gds_01','gds_02','gds_03','gds_04','gds_05','gds_06','gds_07','gds_08','gds_09','gds_10','gds_11','gds_12','gds_13','gds_14','gds_15']
    when 'barthel_adl' then array['feeding','bathing','grooming','dressing','bowels','bladder','toilet_use','transfers','mobility','stairs']
    when 'lawton_iadl' then array['telephone','shopping','food_preparation','housekeeping','laundry','transportation','medications','finances']
    when 'eat10_swallowing' then array['eat10_01','eat10_02','eat10_03','eat10_04','eat10_05','eat10_06','eat10_07','eat10_08','eat10_09','eat10_10']
    when 'bsrs5' then array['bsrs_01','bsrs_02','bsrs_03','bsrs_04','bsrs_05','bsrs_suicide']
    when 'fall_risk_taipei_115' then array['fall_01','fall_02','fall_03','fall_04','fall_05','fall_06','fall_07','fall_08','fall_09','fall_10','fall_11','fall_12']
    when 'nsi_determine' then array['nsi_01','nsi_02','nsi_03','nsi_04','nsi_05','nsi_06','nsi_07','nsi_08','nsi_09','nsi_10']
    when 'mna_sf' then array['food_intake','weight_loss','mobility','acute_stress_or_disease','neuropsychological','anthropometry']
    when 'ad8' then array['ad8_01','ad8_02','ad8_03','ad8_04','ad8_05','ad8_06','ad8_07','ad8_08']
    else null end;
  if v_expected is null or p_answers - v_expected <> '{}'::jsonb
    or not (p_answers ?& v_expected) then return false; end if;
  foreach v_key in array v_expected loop
    v_answer := p_answers->v_key;
    if jsonb_typeof(v_answer) is distinct from 'object'
      or v_answer - array['state','value','reason'] <> '{}'::jsonb then return false; end if;
    if v_answer->>'state' = 'missing' then
      if v_answer <> '{"state":"missing"}'::jsonb then return false; end if;
      continue;
    elsif v_answer->>'state' = 'not_applicable' then
      if p_form_key in ('eat10_swallowing','bsrs5','gds_15','spmsq','ad8')
        or v_answer->>'reason' is null or char_length(v_answer->>'reason') not between 1 and 500
        or v_answer->>'reason' <> btrim(v_answer->>'reason')
        or translate(v_answer->>'reason', E'\n\r\t', '') ~ '[[:cntrl:]]'
        or v_answer - array['state','reason'] <> '{}'::jsonb then return false; end if;
      continue;
    elsif v_answer->>'state' <> 'answered'
      or v_answer - array['state','value'] <> '{}'::jsonb
      or jsonb_typeof(v_answer->'value') is distinct from 'string' then return false;
    end if;
    v_value := v_answer->>'value';
    if p_form_key = 'spmsq' then
      if v_value not in ('correct','incorrect') then return false; end if;
    elsif p_form_key = 'ad8' then
      if v_value not in ('changed','unchanged','unknown') then return false; end if;
    elsif p_form_key = 'gds_15' then
      if v_value not in ('yes','no') then return false; end if;
    elsif p_form_key in ('eat10_swallowing','bsrs5') then
      if v_value not in ('0','1','2','3','4') then return false; end if;
    elsif p_form_key in ('fall_risk_taipei_115','nsi_determine') then
      if v_value not in ('yes','no') then return false; end if;
    elsif p_form_key = 'barthel_adl' then
      v_allowed := case v_key
        when 'feeding' then array['unable','needs_help','independent']
        when 'bathing' then array['dependent','independent']
        when 'grooming' then array['dependent','independent']
        when 'dressing' then array['unable','needs_help','independent']
        when 'bowels' then array['incontinent','occasional_accident','continent']
        when 'bladder' then array['incontinent','occasional_accident','continent']
        when 'toilet_use' then array['dependent','needs_help','independent']
        when 'transfers' then array['unable','major_help','minor_help','independent']
        when 'mobility' then array['immobile','wheelchair_independent','walks_with_help','independent']
        when 'stairs' then array['unable','needs_help','independent'] end;
      if not v_value = any(v_allowed) then return false; end if;
    elsif p_form_key = 'lawton_iadl' then
      v_allowed := case v_key
        when 'telephone' then array['telephone_dials_numbers','telephone_familiar_numbers','telephone_answer_only','telephone_unable']
        when 'shopping' then array['shopping_independent_all','shopping_small_items_only','shopping_accompanied','shopping_unable']
        when 'food_preparation' then array['meal_independent','meal_prepared_ingredients','meal_reheat_or_inadequate','meal_needs_prepared']
        when 'housekeeping' then array['housework_independent','housework_light_tasks','housework_below_standard','housework_all_help','housework_unable']
        when 'laundry' then array['laundry_all','laundry_small_items','laundry_needs_help']
        when 'transportation' then array['transport_public_or_drive','transport_taxi_only','transport_with_companion','transport_private_with_help','transport_unable_to_leave']
        when 'medications' then array['medication_independent','medication_prepared','medication_needs_help']
        when 'finances' then array['finances_independent','finances_daily_only','finances_unable']
      end;
      if v_allowed is null or not v_value = any(v_allowed) then return false; end if;
    elsif p_form_key = 'mna_sf' then
      v_allowed := case v_key
        when 'food_intake' then array['severe_decrease','moderate_decrease','no_decrease']
        when 'weight_loss' then array['greater_than_3kg','unknown','between_1_and_3kg','no_weight_loss']
        when 'mobility' then array['bed_or_chair_bound','gets_up_but_does_not_go_out','goes_out']
        when 'acute_stress_or_disease' then array['yes','no']
        when 'neuropsychological' then array['severe','mild','none']
        when 'anthropometry' then array['bmi_lt_19','bmi_19_lt_21','bmi_21_lt_23','bmi_gte_23','calf_lt_31','calf_gte_31']
      end;
      if v_allowed is null or not v_value = any(v_allowed) then return false; end if;
    end if;
  end loop;
  return true;
end;
$$;

-- Preserve the later v2 roster-only snapshot contract: answer payloads are
-- returned only after one authorized client is explicitly selected.
create or replace function private.questionnaire_assessment_snapshot_guarded(
  p_org uuid, p_branch uuid, p_form_key text, p_client uuid default null
) returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare v_result jsonb;
begin
  if p_form_key not in ('spmsq','gds_15','barthel_adl','lawton_iadl','eat10_swallowing','bsrs5','fall_risk_taipei_115','nsi_determine','mna_sf','ad8')
    or not private.questionnaire_assessment_authority(p_org,p_branch,p_client,p_form_key,'read') then
    raise exception using errcode = '42501', message = 'questionnaire snapshot is not permitted';
  end if;

  with visible_clients as materialized (
    select c.id as client_id,c.display_name,c.status
    from public.clients c
    where c.organization_id=p_org and c.branch_id=p_branch
      and c.status in ('active','suspended')
      and (private.questionnaire_assessment_permission(p_org,p_branch,'clients.view_all') or exists (
        select 1 from public.client_assignments a where a.client_id=c.id and a.organization_id=p_org
          and a.branch_id=p_branch and a.assignee_user_id=auth.uid() and a.starts_at<=clock_timestamp()
          and (a.ends_at is null or a.ends_at>clock_timestamp())))
  ), terminal_versions as materialized (
    select distinct on (v.assessment_key) v.*
    from public.questionnaire_assessment_versions v
    join visible_clients c on c.client_id=v.client_id
    where p_client is not null and v.client_id=p_client
      and v.organization_id=p_org and v.branch_id=p_branch and v.form_key=p_form_key
    order by v.assessment_key,v.version desc
  ), selected_latest as materialized (
    select * from terminal_versions
    order by assessed_on desc,created_at desc,assessment_key,version desc
    limit 1
  )
  select jsonb_build_object(
    'formKey',p_form_key,'generatedAt',clock_timestamp(),
    'clients',(select coalesce(jsonb_agg(jsonb_build_object(
      'clientId',c.client_id,'displayName',c.display_name,'serviceStatus',c.status,
      'latest',case when c.client_id=p_client then (select jsonb_build_object(
        'assessmentKey',l.assessment_key,'versionId',l.id,'version',l.version,
        'formVersion',l.form_version,'assessedOn',l.assessed_on,'answers',l.answers,'context',l.context,
        'recordState',l.record_state,'authorDisplayName',l.author_display_name,'createdAt',l.created_at,
        'contentHash',l.content_hash) from selected_latest l) else null end
    ) order by c.display_name collate "C",c.client_id),'[]'::jsonb) from visible_clients c),
    'matchingTotal',(select count(*) from visible_clients)) into v_result;

  if p_client is not null and not exists (
    select 1 from jsonb_array_elements(v_result->'clients') item
    where item->>'clientId'=p_client::text
  ) then
    raise exception using errcode = '42501', message = 'questionnaire client is not selectable';
  end if;

  insert into public.audit_events(organization_id,branch_id,actor_user_id,action,table_name,row_pk,changed_fields,metadata)
  values(p_org,p_branch,auth.uid(),'select','questionnaire_assessment_versions','snapshot',array[]::text[],
    jsonb_build_object('workflow','questionnaire_assessment_snapshot_v2','form_key',p_form_key,
      'row_count',coalesce(jsonb_array_length(v_result->'clients'),0),
      'answers_excluded',p_client is null,
      'answer_scope',case when p_client is null then 'none' else 'selected_client_only' end));
  return v_result;
end;
$$;

comment on table public.questionnaire_assessment_versions is
  'Append-only fixed questionnaire drafts, including candidate-only AD8 answers. No score, diagnosis, referral, or signature is produced.';
