begin;
select plan(26);

select ok((select relrowsecurity and relforcerowsecurity
  from pg_class where oid='public.questionnaire_assessment_versions'::regclass),
  'questionnaire answer versions force RLS');
select ok(not has_table_privilege('authenticated','public.questionnaire_assessment_versions','select,insert,update,delete'),
  'authenticated users cannot access questionnaire rows directly');
select ok(not has_table_privilege('service_role','public.questionnaire_assessment_versions','select,insert,update,delete'),
  'service role cannot bypass the questionnaire scoped RPC');
select ok(not (select prosecdef from pg_proc where oid='public.mutate_questionnaire_assessment(uuid,uuid,jsonb,uuid)'::regprocedure),
  'public write wrapper is SECURITY INVOKER');
select ok(not (select prosecdef from pg_proc where oid='public.questionnaire_assessment_snapshot(uuid,uuid,text,uuid)'::regprocedure),
  'public snapshot wrapper is SECURITY INVOKER');
select ok((select prosecdef and proconfig @> array['search_path=""']
  from pg_proc where oid='private.mutate_questionnaire_assessment_guarded(uuid,uuid,jsonb,uuid)'::regprocedure),
  'private write core is fixed-search-path SECURITY DEFINER');
select ok(has_function_privilege('authenticated','public.mutate_questionnaire_assessment(uuid,uuid,jsonb,uuid)','execute')
  and has_function_privilege('authenticated','public.questionnaire_assessment_snapshot(uuid,uuid,text,uuid)','execute'),
  'authenticated staff may call only the scoped public functions');
select ok(not has_function_privilege('anon','public.mutate_questionnaire_assessment(uuid,uuid,jsonb,uuid)','execute')
  and not has_function_privilege('anon','public.questionnaire_assessment_snapshot(uuid,uuid,text,uuid)','execute'),
  'anonymous callers cannot use questionnaire RPCs');
select ok(exists(select 1 from pg_trigger where tgrelid='public.questionnaire_assessment_versions'::regclass
  and tgname='questionnaire_assessment_versions_append_only' and not tgisinternal),
  'questionnaire versions are append-only');

select ok(private.questionnaire_answers_valid('spmsq',(
  select jsonb_object_agg('spmsq_'||lpad(n::text,2,'0'),'{"state":"answered","value":"correct"}'::jsonb)
  from generate_series(1,10)n)), 'valid SPMSQ responses are accepted');
select ok(private.questionnaire_answers_valid('gds_15',(
  select jsonb_object_agg('gds_'||lpad(n::text,2,'0'),'{"state":"answered","value":"no"}'::jsonb)
  from generate_series(1,15)n)), 'valid GDS-15 responses are accepted');
select ok(private.questionnaire_answers_valid('barthel_adl',jsonb_build_object(
  'feeding','{"state":"answered","value":"independent"}'::jsonb,
  'bathing','{"state":"answered","value":"independent"}'::jsonb,
  'grooming','{"state":"answered","value":"independent"}'::jsonb,
  'dressing','{"state":"answered","value":"independent"}'::jsonb,
  'bowels','{"state":"answered","value":"continent"}'::jsonb,
  'bladder','{"state":"answered","value":"continent"}'::jsonb,
  'toilet_use','{"state":"answered","value":"independent"}'::jsonb,
  'transfers','{"state":"answered","value":"independent"}'::jsonb,
  'mobility','{"state":"answered","value":"independent"}'::jsonb,
  'stairs','{"state":"answered","value":"independent"}'::jsonb)), 'valid Barthel responses are accepted');
select ok(private.questionnaire_answers_valid('lawton_iadl',jsonb_build_object(
  'telephone','{"state":"answered","value":"telephone_dials_numbers"}'::jsonb,
  'shopping','{"state":"answered","value":"shopping_independent_all"}'::jsonb,
  'food_preparation','{"state":"answered","value":"meal_independent"}'::jsonb,
  'housekeeping','{"state":"answered","value":"housework_independent"}'::jsonb,
  'laundry','{"state":"answered","value":"laundry_all"}'::jsonb,
  'transportation','{"state":"answered","value":"transport_public_or_drive"}'::jsonb,
  'medications','{"state":"answered","value":"medication_independent"}'::jsonb,
  'finances','{"state":"answered","value":"finances_independent"}'::jsonb)),
  'valid IADL responses are accepted');
select ok(private.questionnaire_answers_valid('eat10_swallowing',(
  select jsonb_object_agg('eat10_'||lpad(n::text,2,'0'),'{"state":"answered","value":"0"}'::jsonb)
  from generate_series(1,10)n)), 'valid EAT-10 responses are accepted');
select ok(private.questionnaire_answers_valid('bsrs5',jsonb_build_object(
  'bsrs_01','{"state":"answered","value":"0"}'::jsonb,
  'bsrs_02','{"state":"answered","value":"1"}'::jsonb,
  'bsrs_03','{"state":"answered","value":"2"}'::jsonb,
  'bsrs_04','{"state":"answered","value":"3"}'::jsonb,
  'bsrs_05','{"state":"answered","value":"4"}'::jsonb,
  'bsrs_suicide','{"state":"answered","value":"4"}'::jsonb)), 'valid BSRS-5 and safety responses are accepted');
select ok(private.questionnaire_answers_valid('fall_risk_taipei_115',(
  select jsonb_object_agg('fall_'||lpad(n::text,2,'0'),'{"state":"answered","value":"no"}'::jsonb)
  from generate_series(1,12)n)), 'valid Taipei B12 responses are accepted');
select ok(private.questionnaire_answers_valid('nsi_determine',(
  select jsonb_object_agg('nsi_'||lpad(n::text,2,'0'),'{"state":"answered","value":"no"}'::jsonb)
  from generate_series(1,10)n)), 'valid NSI DETERMINE responses are accepted');
select ok(private.questionnaire_answers_valid('mna_sf',jsonb_build_object(
  'food_intake','{"state":"answered","value":"no_decrease"}'::jsonb,
  'weight_loss','{"state":"answered","value":"no_weight_loss"}'::jsonb,
  'mobility','{"state":"answered","value":"goes_out"}'::jsonb,
  'acute_stress_or_disease','{"state":"answered","value":"no"}'::jsonb,
  'neuropsychological','{"state":"answered","value":"none"}'::jsonb,
  'anthropometry','{"state":"answered","value":"bmi_gte_23"}'::jsonb)), 'valid MNA-SF responses are accepted');

select ok(not private.questionnaire_answers_valid('eat10_swallowing',(
  select jsonb_object_agg('eat10_'||lpad(n::text,2,'0'),
    case when n=1 then '{"state":"answered","value":"5"}'::jsonb else '{"state":"answered","value":"0"}'::jsonb end)
  from generate_series(1,10)n)), 'invalid answer values are rejected');
select ok(not private.questionnaire_answers_valid('spmsq',
  '{"spmsq_01":{"state":"answered","value":"correct"},"unknown":{"state":"answered","value":"correct"}}'::jsonb),
  'unknown or incomplete answer keys are rejected');
select ok(private.questionnaire_context_valid('mna_sf',
  '{"anthropometry":{"state":"answered","value":"bmi_gte_23"}}'::jsonb,
  '{"height_cm":"160","weight_kg":"60"}'::jsonb), 'MNA BMI measurements are validated against the selected band');
select ok(not private.questionnaire_context_valid('mna_sf',
  '{"anthropometry":{"state":"answered","value":"bmi_gte_23"}}'::jsonb,
  '{"height_cm":"160","weight_kg":"50"}'::jsonb), 'MNA mismatched BMI bands are rejected');
select ok(not private.questionnaire_context_valid('mna_sf',
  '{"anthropometry":{"state":"answered","value":"calf_gte_31"}}'::jsonb,
  '{"height_cm":"160","weight_kg":"60","calf_circumference_cm":"32"}'::jsonb),
  'MNA forbids using BMI and calf circumference together');
select ok(exists(select 1 from public.permissions where permission_key='questionnaire_cognition.manage')
  and exists(select 1 from public.permissions where permission_key='questionnaire_nutrition.manage'),
  'scoped questionnaire read/write permissions are registered');
select ok(exists(select 1 from public.role_permissions rp join public.roles r on r.id=rp.role_id
  join public.permissions p on p.id=rp.permission_id where r.role_key='nurse'
    and p.permission_key='questionnaire_nutrition.manage'), 'nurses receive the governed nutrition draft scope');
select ok(exists(select 1 from public.role_permissions rp join public.roles r on r.id=rp.role_id
  join public.permissions p on p.id=rp.permission_id where r.role_key='care_worker'
    and p.permission_key='questionnaire_fall.manage'), 'care workers receive the governed fall draft scope');

select * from finish();
rollback;
