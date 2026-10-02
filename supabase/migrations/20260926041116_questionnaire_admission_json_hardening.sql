begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

-- Admission is tenant-scoped, not merely a global successful login. Preserve
-- the separately pinned executive path and individually approved Google AAL1
-- staff path, including their actual session/AMR checks and active scope.
create or replace function private.questionnaire_assessment_authority(
  p_org uuid, p_branch uuid, p_client uuid, p_form_key text, p_access text
) returns boolean language sql volatile security definer set search_path = '' as $$
  with required_permission as (
    select case
      when p_form_key = 'spmsq' and p_access in ('read','manage') then 'questionnaire_cognition'
      when p_form_key in ('barthel_adl','lawton_iadl') and p_access in ('read','manage') then 'questionnaire_adl'
      when p_form_key = 'eat10_swallowing' and p_access in ('read','manage') then 'questionnaire_swallowing'
      when p_form_key in ('bsrs5','gds_15') and p_access in ('read','manage') then 'questionnaire_emotion'
      when p_form_key = 'fall_risk_taipei_115' and p_access in ('read','manage') then 'questionnaire_fall'
      when p_form_key in ('nsi_determine','mna_sf') and p_access in ('read','manage') then 'questionnaire_nutrition'
      else null end as permission_key
  )
  select coalesce(auth.uid() is not null
    and (exists(select 1 from private.executive_reader_scope() s
          where s.organization_id=p_org and (s.branch_id is null or s.branch_id=p_branch))
      or exists(select 1 from private.routine_staff_scope() s
          where s.organization_id=p_org and (s.branch_id is null or s.branch_id=p_branch)))
    and (select permission_key is not null from required_permission)
    and exists(select 1 from public.profiles p
      where p.id=auth.uid() and p.is_active and p.kind in ('staff','professional'))
    and exists(select 1 from public.branches b join public.organizations o on o.id=b.organization_id
      where b.id=p_branch and b.organization_id=p_org and b.is_active and o.is_active)
    and private.questionnaire_assessment_permission(p_org,p_branch,'clients.read')
    and private.questionnaire_assessment_permission(p_org,p_branch,(select permission_key from required_permission)||'.read')
    and private.questionnaire_assessment_permission(p_org,p_branch,(select permission_key from required_permission)||'.'||p_access)
    and (p_client is null or (
      exists(select 1 from public.clients c where c.id=p_client and c.organization_id=p_org and c.branch_id=p_branch)
      and (private.questionnaire_assessment_permission(p_org,p_branch,'clients.view_all')
        or exists(select 1 from public.client_assignments a where a.client_id=p_client
          and a.organization_id=p_org and a.branch_id=p_branch and a.assignee_user_id=auth.uid()
          and a.starts_at<=clock_timestamp() and (a.ends_at is null or a.ends_at>clock_timestamp())))
    )),false);
$$;

-- Keep the registered choices and legacy not-applicable policy. Only malformed
-- JSON representations are rejected; values are never coerced or rewritten.
create or replace function private.questionnaire_answers_valid(p_form_key text, p_answers jsonb)
returns boolean language plpgsql immutable security invoker set search_path = '' as $$
declare v_key text; v_answer jsonb; v_value text; v_allowed text[]; v_expected text[];
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
    else null end;
  if v_expected is null or p_answers-v_expected<>'{}'::jsonb or not(p_answers ?& v_expected) then return false; end if;
  foreach v_key in array v_expected loop
    v_answer:=p_answers->v_key;
    if jsonb_typeof(v_answer) is distinct from 'object'
      or jsonb_typeof(v_answer->'state') is distinct from 'string'
      or v_answer-array['state','value','reason']<>'{}'::jsonb then return false; end if;
    if v_answer->>'state'='missing' then
      if v_answer<>'{"state":"missing"}'::jsonb then return false; end if;
      continue;
    elsif v_answer->>'state'='not_applicable' then
      if p_form_key in ('eat10_swallowing','bsrs5','gds_15','spmsq')
        or jsonb_typeof(v_answer->'reason') is distinct from 'string'
        or char_length(v_answer->>'reason') not between 1 and 500
        or v_answer->>'reason'<>btrim(v_answer->>'reason')
        or translate(v_answer->>'reason',E'\n\r\t','')~'[[:cntrl:]]'
        or v_answer-array['state','reason']<>'{}'::jsonb then return false; end if;
      continue;
    elsif v_answer->>'state' is distinct from 'answered'
      or v_answer-array['state','value']<>'{}'::jsonb
      or jsonb_typeof(v_answer->'value') is distinct from 'string' then return false;
    end if;
    v_value:=v_answer->>'value';
    if p_form_key='spmsq' then v_allowed:=array['correct','incorrect'];
    elsif p_form_key='gds_15' then v_allowed:=array['yes','no'];
    elsif p_form_key in ('eat10_swallowing','bsrs5') then v_allowed:=array['0','1','2','3','4'];
    elsif p_form_key in ('fall_risk_taipei_115','nsi_determine') then v_allowed:=array['yes','no'];
    elsif p_form_key='barthel_adl' then v_allowed:=case v_key
      when 'feeding' then array['unable','needs_help','independent'] when 'bathing' then array['dependent','independent']
      when 'grooming' then array['dependent','independent'] when 'dressing' then array['unable','needs_help','independent']
      when 'bowels' then array['incontinent','occasional_accident','continent'] when 'bladder' then array['incontinent','occasional_accident','continent']
      when 'toilet_use' then array['dependent','needs_help','independent'] when 'transfers' then array['unable','major_help','minor_help','independent']
      when 'mobility' then array['immobile','wheelchair_independent','walks_with_help','independent'] when 'stairs' then array['unable','needs_help','independent'] end;
    elsif p_form_key='lawton_iadl' then v_allowed:=case v_key
      when 'telephone' then array['telephone_dials_numbers','telephone_familiar_numbers','telephone_answer_only','telephone_unable']
      when 'shopping' then array['shopping_independent_all','shopping_small_items_only','shopping_accompanied','shopping_unable']
      when 'food_preparation' then array['meal_independent','meal_prepared_ingredients','meal_reheat_or_inadequate','meal_needs_prepared']
      when 'housekeeping' then array['housework_independent','housework_light_tasks','housework_below_standard','housework_all_help','housework_unable']
      when 'laundry' then array['laundry_all','laundry_small_items','laundry_needs_help']
      when 'transportation' then array['transport_public_or_drive','transport_taxi_only','transport_with_companion','transport_private_with_help','transport_unable_to_leave']
      when 'medications' then array['medication_independent','medication_prepared','medication_needs_help']
      when 'finances' then array['finances_independent','finances_daily_only','finances_unable'] end;
    elsif p_form_key='mna_sf' then v_allowed:=case v_key
      when 'food_intake' then array['severe_decrease','moderate_decrease','no_decrease']
      when 'weight_loss' then array['greater_than_3kg','unknown','between_1_and_3kg','no_weight_loss']
      when 'mobility' then array['bed_or_chair_bound','gets_up_but_does_not_go_out','goes_out']
      when 'acute_stress_or_disease' then array['yes','no'] when 'neuropsychological' then array['severe','mild','none']
      when 'anthropometry' then array['bmi_lt_19','bmi_19_lt_21','bmi_21_lt_23','bmi_gte_23','calf_lt_31','calf_gte_31'] end;
    end if;
    if v_allowed is null or not(v_value=any(v_allowed)) then return false; end if;
  end loop;
  return true;
end;
$$;

create or replace function private.questionnaire_context_valid(p_form_key text, p_answers jsonb, p_context jsonb)
returns boolean language plpgsql immutable security invoker set search_path = '' as $$
declare v_key text; v_text text; v_json jsonb; v_number numeric; v_expected text;
  v_height numeric; v_weight numeric; v_calf numeric; v_bmi numeric;
begin
  if jsonb_typeof(p_context) is distinct from 'object' then return false; end if;
  for v_key,v_json in select key,value from jsonb_each(p_context) loop
    if jsonb_typeof(v_json) is distinct from 'string' then return false; end if;
  end loop;
  if p_context ? 'qualitative_note' then
    v_text:=p_context->>'qualitative_note';
    if char_length(v_text) not between 1 and 3000 or v_text<>btrim(v_text)
      or translate(v_text,E'\n\r\t','')~'[[:cntrl:]]' then return false; end if;
  end if;
  if p_form_key='spmsq' then
    if p_context-array['education_adjustment','qualitative_note']<>'{}'::jsonb then return false; end if;
    return coalesce(not(p_context ? 'education_adjustment')
      or p_context->>'education_adjustment' in ('grade_school_or_less','middle_or_high_school','beyond_high_school'),false);
  end if;
  if p_form_key<>'mna_sf' then return p_context-array['qualitative_note']='{}'::jsonb; end if;
  for v_key,v_text in select key,value from jsonb_each_text(p_context) loop
    if v_key='qualitative_note' then continue; end if;
    if v_key not in ('height_cm','weight_kg','calf_circumference_cm') or v_text!~'^([0-9]{1,3})(\.[0-9])?$' then return false; end if;
    v_number:=v_text::numeric;
    if v_key='height_cm' and v_number not between 50 and 240 then return false; end if;
    if v_key='weight_kg' and v_number not between 20 and 300 then return false; end if;
    if v_key='calf_circumference_cm' and v_number not between 10 and 80 then return false; end if;
  end loop;
  if coalesce(p_answers->'anthropometry'->>'state','')<>'answered' then return true; end if;
  v_expected:=p_answers->'anthropometry'->>'value';
  if v_expected like 'bmi_%' then
    if not(p_context ? 'height_cm') or not(p_context ? 'weight_kg') or p_context ? 'calf_circumference_cm' then return false; end if;
    v_height:=(p_context->>'height_cm')::numeric; v_weight:=(p_context->>'weight_kg')::numeric;
    v_bmi:=v_weight/power(v_height/100,2);
    if v_expected='bmi_lt_19' then return coalesce(v_bmi<19,false); end if;
    if v_expected='bmi_19_lt_21' then return coalesce(v_bmi>=19 and v_bmi<21,false); end if;
    if v_expected='bmi_21_lt_23' then return coalesce(v_bmi>=21 and v_bmi<23,false); end if;
    if v_expected='bmi_gte_23' then return coalesce(v_bmi>=23,false); end if;
    return false;
  end if;
  if v_expected in ('calf_lt_31','calf_gte_31') then
    if not(p_context ? 'calf_circumference_cm') or p_context ? 'height_cm' or p_context ? 'weight_kg' then return false; end if;
    v_calf:=(p_context->>'calf_circumference_cm')::numeric;
    return coalesce((v_expected='calf_lt_31' and v_calf<31) or (v_expected='calf_gte_31' and v_calf>=31),false);
  end if;
  return false;
exception when invalid_text_representation or numeric_value_out_of_range then return false;
end;
$$;

-- Replace the old function-dependent checks rather than falsely retaining their
-- validated flag after changing validator behavior. NOT VALID preserves every
-- historical row but enforces strict JSON on all subsequent writes.
do $$ declare v_constraint record; v_count integer:=0; begin
  for v_constraint in select conname from pg_catalog.pg_constraint
    where conrelid='public.questionnaire_assessment_versions'::regclass and contype='c'
      and (pg_catalog.pg_get_constraintdef(oid) like '%questionnaire_answers_valid(%'
        or pg_catalog.pg_get_constraintdef(oid) like '%questionnaire_context_valid(%')
  loop
    execute format('alter table public.questionnaire_assessment_versions drop constraint %I',v_constraint.conname);
    v_count:=v_count+1;
  end loop;
  if v_count<>2 then raise exception 'unexpected questionnaire JSON constraint layout'; end if;
end; $$;
alter table public.questionnaire_assessment_versions
  add constraint questionnaire_answers_strict_json check (private.questionnaire_answers_valid(form_key,answers) is true) not valid,
  add constraint questionnaire_context_strict_json check (private.questionnaire_context_valid(form_key,answers,context) is true) not valid;

alter function private.questionnaire_assessment_authority(uuid,uuid,uuid,text,text) owner to postgres;
alter function private.questionnaire_answers_valid(text,jsonb) owner to postgres;
alter function private.questionnaire_context_valid(text,jsonb,jsonb) owner to postgres;
revoke all on function private.questionnaire_assessment_authority(uuid,uuid,uuid,text,text),
  private.questionnaire_answers_valid(text,jsonb),private.questionnaire_context_valid(text,jsonb,jsonb)
  from public,anon,authenticated,service_role;
comment on constraint questionnaire_answers_strict_json on public.questionnaire_assessment_versions is
  'Upgrade gate: inventory invalid historical drafts without exporting answers; obtain data-owner reviewed corrections before VALIDATE CONSTRAINT and backup/restore acceptance. Never silently delete or coerce immutable history.';
comment on constraint questionnaire_context_strict_json on public.questionnaire_assessment_versions is
  'Upgrade gate: NOT VALID preserves old rows only, not permission for new malformed writes. Historical violations remain fail-closed at read contracts and require data-owner review before validation/restore acceptance.';
commit;
