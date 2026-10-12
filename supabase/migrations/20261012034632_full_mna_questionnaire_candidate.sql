begin;
set local lock_timeout = '5s';

-- Independent local candidate. Preserve every historical catalogue, score
-- function and tenant publication. This migration grants no permission and
-- creates no rule approval, admission, diagnosis or treatment decision.
insert into private.questionnaire_form_catalog(form_key,form_version,form_snapshot,rule_snapshot,catalog_hash)
select item->>'formKey',item->>'formVersion',item->'formSnapshot',item->'ruleSnapshot',
 encode(sha256(convert_to((item->'formSnapshot')::text||':'||(item->'ruleSnapshot')::text,'UTF8')),'hex')
from jsonb_array_elements($full_mna_catalog$[{"formKey":"full_mna","formVersion":"full-mna-chinese-amended-2023-v1","formSnapshot":{"key":"full_mna","version":"full-mna-chinese-amended-2023-v1","title":"完整 MNA 18 題（官方 Chinese amended 2023 候選版）","instructions":"依官方 Chinese amended 2023 的 A–R 順序保存完整回答。F 題使用實測身高、體重計算 BMI；Q／R 分別保存臂圍及小腿圍。K 題保留三個子回答。候選草稿不等於正式評估結果；正式簽署與分類仍須雙人發布規則。","sourceLabel":"MNA 官方 Long MNA Chinese amended 2023；非臺灣核定翻譯版","sourceUrl":"https://www.mna-elderly.com/sites/default/files/2024-10/Long-MNA_AU1.0_chinese.nonMapi.pdf","sourceHash":"cd9d96d2f82fb256ce7999078428f241ac6136afe0dfd5851f3b5997c7add734","scoreVersionId":"full-mna-chinese-amended-2023-v1","allowQualitativeNotes":true,"measurementFields":[{"key":"height_cm","label":"身高（公分）","questionId":"anthropometry"},{"key":"weight_kg","label":"體重（公斤）","questionId":"anthropometry"},{"key":"arm_circumference_cm","label":"上手臂中點臂圍（公分）","questionId":"arm_circumference"},{"key":"calf_circumference_cm","label":"小腿圍（公分）","questionId":"calf_circumference"}],"contextFields":[{"key":"protein_dairy","label":"每天進食至少一份乳製品（牛奶、芝士或乳酪）","questionId":"protein_intake","required":true,"choices":[{"value":"yes","label":"是"},{"value":"no","label":"否"}]},{"key":"protein_legumes_eggs","label":"每週進食兩份以上乾豆類或蛋類","questionId":"protein_intake","required":true,"choices":[{"value":"yes","label":"是"},{"value":"no","label":"否"}]},{"key":"protein_meat_fish_poultry","label":"每天均進食肉類、魚類或家禽類","questionId":"protein_intake","required":true,"choices":[{"value":"yes","label":"是"},{"value":"no","label":"否"}]}],"questions":[{"id":"food_intake","prompt":"A 過去三個月內有沒有因為食慾不振、消化問題、咀嚼或吞嚥困難而減少食量？","choices":[{"value":"severe_decrease","label":"食量嚴重減少","score":0},{"value":"moderate_decrease","label":"食量中度減少","score":1},{"value":"no_decrease","label":"食量沒有改變","score":2}]},{"id":"weight_loss","prompt":"B 過去三個月內體重下降的情況","choices":[{"value":"greater_than_3kg","label":"體重下降大於 3 公斤（6.6 磅）","score":0},{"value":"unknown","label":"不知道","score":1},{"value":"between_1_and_3kg","label":"體重下降 1–3 公斤（2.2–6.6 磅）","score":2},{"value":"no_weight_loss","label":"體重沒有下降","score":3}]},{"id":"mobility","prompt":"C 活動能力","choices":[{"value":"bed_or_chair_bound","label":"需長期臥床或坐輪椅","score":0},{"value":"gets_up_but_does_not_go_out","label":"可以下床或離開輪椅，但不能外出","score":1},{"value":"goes_out","label":"可以外出","score":2}]},{"id":"acute_stress_or_disease","prompt":"D 過去三個月內有沒有受到心理創傷或患上急性疾病？","choices":[{"value":"yes","label":"有","score":0},{"value":"no","label":"沒有","score":2}]},{"id":"neuropsychological","prompt":"E 精神心理問題","choices":[{"value":"severe","label":"嚴重痴呆或抑鬱","score":0},{"value":"mild","label":"輕度痴呆","score":1},{"value":"none","label":"沒有精神心理問題","score":2}]},{"id":"anthropometry","prompt":"F 身體質量指數（BMI）（公斤／米²，kg/m²）","helpText":"完整版本 F 題僅使用 BMI；R 題的小腿圍另外計分，不能代替 F 題。","choices":[{"value":"bmi_lt_19","label":"BMI 低於 19","score":0},{"value":"bmi_19_lt_21","label":"BMI 19 至低於 21","score":1},{"value":"bmi_21_lt_23","label":"BMI 21 至低於 23","score":2},{"value":"bmi_gte_23","label":"BMI 23 或以上","score":3}]},{"id":"independent_living","prompt":"G 是否獨立生活（非居住於療養院或醫院）？","choices":[{"value":"yes","label":"是","score":1},{"value":"no","label":"否","score":0}]},{"id":"prescription_drugs","prompt":"H 每天服用三種以上的處方藥物？","choices":[{"value":"yes","label":"是","score":0},{"value":"no","label":"否","score":1}]},{"id":"pressure_sores","prompt":"I 是否有褥瘡或皮膚潰瘍？","choices":[{"value":"yes","label":"是","score":0},{"value":"no","label":"否","score":1}]},{"id":"full_meals","prompt":"J 每天吃多少次主餐？","choices":[{"value":"one","label":"1 餐","score":0},{"value":"two","label":"2 餐","score":1},{"value":"three","label":"3 餐","score":2}]},{"id":"protein_intake","prompt":"K 蛋白質攝取量指標","helpText":"逐項記錄下列三個子回答，依「是」的數量核對本題選項；任一子回答缺漏，不推估。","choices":[{"value":"zero_or_one_yes","label":"0 或 1 個「是」","score":0},{"value":"two_yes","label":"2 個「是」","score":0.5},{"value":"three_yes","label":"3 個「是」","score":1}]},{"id":"fruit_vegetables","prompt":"L 每天有進食兩份或以上水果或蔬菜？","choices":[{"value":"no","label":"否","score":0},{"value":"yes","label":"是","score":1}]},{"id":"fluid_intake","prompt":"M 每天喝多少流質（水、果汁、咖啡、茶、牛奶……）？","choices":[{"value":"lt_three","label":"少於 3 杯","score":0},{"value":"three_to_five","label":"3 至 5 杯","score":0.5},{"value":"gt_five","label":"多於 5 杯","score":1}]},{"id":"feeding_mode","prompt":"N 進食模式","choices":[{"value":"needs_help","label":"需輔助才能進食","score":0},{"value":"self_with_difficulty","label":"能自行進食但稍有困難","score":1},{"value":"self_without_difficulty","label":"能自行進食","score":2}]},{"id":"self_nutrition","prompt":"O 自我評估營養狀況","choices":[{"value":"malnourished","label":"自覺營養不良","score":0},{"value":"uncertain","label":"不清楚自我的營養狀況","score":1},{"value":"no_problem","label":"自覺沒有營養問題","score":2}]},{"id":"self_health","prompt":"P 與同齡人士相比，病人如何評價自己的健康狀況？","choices":[{"value":"worse","label":"比別人差","score":0},{"value":"unknown","label":"不知道","score":0.5},{"value":"same","label":"和別人一樣","score":1},{"value":"better","label":"比別人更好","score":2}]},{"id":"arm_circumference","prompt":"Q 上手臂中點臂圍（MAC）（公分，cm）","choices":[{"value":"mac_lt_21","label":"MAC 低於 21","score":0},{"value":"mac_21_lt_22","label":"MAC 21 至低於 22","score":0.5},{"value":"mac_gte_22","label":"MAC 22 或以上","score":1}]},{"id":"calf_circumference","prompt":"R 小腿圍（CC）（公分，cm）","choices":[{"value":"calf_lt_31","label":"CC 低於 31","score":0},{"value":"calf_gte_31","label":"CC 31 或以上","score":1}]}]},"ruleSnapshot":{"versionId":"full-mna-chinese-amended-2023-v1","instrument":"full_mna","title":"Long MNA Chinese amended 2023（完整 18 題候選版）","ruleRevision":1,"scoringPolicy":"A–R 共 18 題；A–F 最高 14 分、G–R 最高 16 分、總分 30 分。K、M、P、Q 保留 0.5 分精度；K 保留三個子回答。F 僅使用 BMI，Q／R 分別使用臂圍／小腿圍。任何缺值或 N/A 均不產生總分。官方 Chinese amended 2023 候選實作，不宣稱臺灣核定版；正式結果另須雙人發布。","disclaimer":"本結果只重現指定版本的量表計分，不構成診斷、醫囑或自動處置；應由具權限人員結合完整資料判讀。","sources":[{"label":"Official Long MNA Chinese amended 2023","url":"https://www.mna-elderly.com/sites/default/files/2024-10/Long-MNA_AU1.0_chinese.nonMapi.pdf","sha256":"cd9d96d2f82fb256ce7999078428f241ac6136afe0dfd5851f3b5997c7add734"}],"scoreMin":0,"scoreMax":30,"scoreUnit":"points","items":[{"id":"food_intake","label":"A 過去三個月內有沒有因為食慾不振、消化問題、咀嚼或吞嚥困難而減少食量？","required":true,"allowNotApplicable":false,"choices":[{"value":"severe_decrease","points":0},{"value":"moderate_decrease","points":1},{"value":"no_decrease","points":2}]},{"id":"weight_loss","label":"B 過去三個月內體重下降的情況","required":true,"allowNotApplicable":false,"choices":[{"value":"greater_than_3kg","points":0},{"value":"unknown","points":1},{"value":"between_1_and_3kg","points":2},{"value":"no_weight_loss","points":3}]},{"id":"mobility","label":"C 活動能力","required":true,"allowNotApplicable":false,"choices":[{"value":"bed_or_chair_bound","points":0},{"value":"gets_up_but_does_not_go_out","points":1},{"value":"goes_out","points":2}]},{"id":"acute_stress_or_disease","label":"D 過去三個月內有沒有受到心理創傷或患上急性疾病？","required":true,"allowNotApplicable":false,"choices":[{"value":"yes","points":0},{"value":"no","points":2}]},{"id":"neuropsychological","label":"E 精神心理問題","required":true,"allowNotApplicable":false,"choices":[{"value":"severe","points":0},{"value":"mild","points":1},{"value":"none","points":2}]},{"id":"anthropometry","label":"F 身體質量指數（BMI）（公斤／米²，kg/m²）","required":true,"allowNotApplicable":false,"choices":[{"value":"bmi_lt_19","points":0},{"value":"bmi_19_lt_21","points":1},{"value":"bmi_21_lt_23","points":2},{"value":"bmi_gte_23","points":3}]},{"id":"independent_living","label":"G 是否獨立生活（非居住於療養院或醫院）？","required":true,"allowNotApplicable":false,"choices":[{"value":"yes","points":1},{"value":"no","points":0}]},{"id":"prescription_drugs","label":"H 每天服用三種以上的處方藥物？","required":true,"allowNotApplicable":false,"choices":[{"value":"yes","points":0},{"value":"no","points":1}]},{"id":"pressure_sores","label":"I 是否有褥瘡或皮膚潰瘍？","required":true,"allowNotApplicable":false,"choices":[{"value":"yes","points":0},{"value":"no","points":1}]},{"id":"full_meals","label":"J 每天吃多少次主餐？","required":true,"allowNotApplicable":false,"choices":[{"value":"one","points":0},{"value":"two","points":1},{"value":"three","points":2}]},{"id":"protein_intake","label":"K 蛋白質攝取量指標","required":true,"allowNotApplicable":false,"choices":[{"value":"zero_or_one_yes","points":0},{"value":"two_yes","points":0.5},{"value":"three_yes","points":1}]},{"id":"fruit_vegetables","label":"L 每天有進食兩份或以上水果或蔬菜？","required":true,"allowNotApplicable":false,"choices":[{"value":"no","points":0},{"value":"yes","points":1}]},{"id":"fluid_intake","label":"M 每天喝多少流質（水、果汁、咖啡、茶、牛奶……）？","required":true,"allowNotApplicable":false,"choices":[{"value":"lt_three","points":0},{"value":"three_to_five","points":0.5},{"value":"gt_five","points":1}]},{"id":"feeding_mode","label":"N 進食模式","required":true,"allowNotApplicable":false,"choices":[{"value":"needs_help","points":0},{"value":"self_with_difficulty","points":1},{"value":"self_without_difficulty","points":2}]},{"id":"self_nutrition","label":"O 自我評估營養狀況","required":true,"allowNotApplicable":false,"choices":[{"value":"malnourished","points":0},{"value":"uncertain","points":1},{"value":"no_problem","points":2}]},{"id":"self_health","label":"P 與同齡人士相比，病人如何評價自己的健康狀況？","required":true,"allowNotApplicable":false,"choices":[{"value":"worse","points":0},{"value":"unknown","points":0.5},{"value":"same","points":1},{"value":"better","points":2}]},{"id":"arm_circumference","label":"Q 上手臂中點臂圍（MAC）（公分，cm）","required":true,"allowNotApplicable":false,"choices":[{"value":"mac_lt_21","points":0},{"value":"mac_21_lt_22","points":0.5},{"value":"mac_gte_22","points":1}]},{"id":"calf_circumference","label":"R 小腿圍（CC）（公分，cm）","required":true,"allowNotApplicable":false,"choices":[{"value":"calf_lt_31","points":0},{"value":"calf_gte_31","points":1}]}],"context":[{"id":"protein_dairy","label":"每天進食至少一份乳製品（牛奶、芝士或乳酪）","required":true,"choices":["yes","no"]},{"id":"protein_legumes_eggs","label":"每週進食兩份以上乾豆類或蛋類","required":true,"choices":["yes","no"]},{"id":"protein_meat_fish_poultry","label":"每天均進食肉類、魚類或家禽類","required":true,"choices":["yes","no"]}],"bands":[{"key":"malnourished_full_0_16_5","label":"完整 MNA 少於 17 分參考區間","minInclusive":0,"maxInclusive":16.5,"interpretation":"screening_only"},{"key":"at_risk_full_17_23_5","label":"完整 MNA 17–23.5 分參考區間","minInclusive":17,"maxInclusive":23.5,"interpretation":"screening_only"},{"key":"normal_full_24_30","label":"完整 MNA 24–30 分參考區間","minInclusive":24,"maxInclusive":30,"interpretation":"screening_only"}]}}]$full_mna_catalog$::jsonb) item;

-- Keep the original implementation for the nine existing forms. Replacing
-- the original function OIDs preserves constraints, callers and existing ACLs.
do $preserve$ declare signature text; definition text; original_name text; begin
 foreach signature in array array[
  'private.questionnaire_assessment_authority(uuid,uuid,uuid,text,text)',
  'private.questionnaire_answers_valid(text,jsonb)',
  'private.questionnaire_context_valid(text,jsonb,jsonb)',
  'private.questionnaire_calculation(text,text,jsonb,jsonb)'
 ] loop
  definition := pg_get_functiondef(signature::regprocedure);
  original_name := split_part(split_part(signature, '.', 2), '(', 1);
  execute replace(definition, 'FUNCTION private.' || original_name || '(',
   'FUNCTION private.' || original_name || '_pre_full_mna(');
 end loop;
end $preserve$;
revoke all on function
 private.questionnaire_assessment_authority_pre_full_mna(uuid,uuid,uuid,text,text),
 private.questionnaire_answers_valid_pre_full_mna(text,jsonb),
 private.questionnaire_context_valid_pre_full_mna(text,jsonb,jsonb),
 private.questionnaire_calculation_pre_full_mna(text,text,jsonb,jsonb)
 from public,anon,authenticated,service_role;

create or replace function private.questionnaire_assessment_authority(
 p_org uuid,p_branch uuid,p_client uuid,p_form_key text,p_access text
) returns boolean language sql volatile security definer set search_path='' as $$
 select private.questionnaire_assessment_authority_pre_full_mna(p_org,p_branch,p_client,
  case when p_form_key='full_mna' then 'mna_sf' else p_form_key end,p_access);
$$;

create or replace function private.questionnaire_answers_valid(p_form_key text,p_answers jsonb)
returns boolean language plpgsql immutable security invoker set search_path='' as $$
declare item text; answer jsonb; allowed text[];
 expected text[]:=array['food_intake','weight_loss','mobility','acute_stress_or_disease',
  'neuropsychological','anthropometry','independent_living','prescription_drugs','pressure_sores',
  'full_meals','protein_intake','fruit_vegetables','fluid_intake','feeding_mode','self_nutrition',
  'self_health','arm_circumference','calf_circumference'];
begin
 if p_form_key is distinct from 'full_mna' then
  return private.questionnaire_answers_valid_pre_full_mna(p_form_key,p_answers);
 end if;
 if jsonb_typeof(p_answers) is distinct from 'object' or p_answers-expected<>'{}'::jsonb
  or not (p_answers ?& expected) then return false; end if;
 foreach item in array expected loop
  answer:=p_answers->item;
  if answer='{"state":"missing"}'::jsonb then continue; end if;
  if jsonb_typeof(answer) is distinct from 'object' or answer-array['state','value']<>'{}'::jsonb
   or answer->>'state' is distinct from 'answered'
   or jsonb_typeof(answer->'value') is distinct from 'string' then return false; end if;
  allowed:=case item
   when 'food_intake' then array['severe_decrease','moderate_decrease','no_decrease']
   when 'weight_loss' then array['greater_than_3kg','unknown','between_1_and_3kg','no_weight_loss']
   when 'mobility' then array['bed_or_chair_bound','gets_up_but_does_not_go_out','goes_out']
   when 'acute_stress_or_disease' then array['yes','no']
   when 'neuropsychological' then array['severe','mild','none']
   when 'anthropometry' then array['bmi_lt_19','bmi_19_lt_21','bmi_21_lt_23','bmi_gte_23']
   when 'independent_living' then array['yes','no']
   when 'prescription_drugs' then array['yes','no']
   when 'pressure_sores' then array['yes','no']
   when 'full_meals' then array['one','two','three']
   when 'protein_intake' then array['zero_or_one_yes','two_yes','three_yes']
   when 'fruit_vegetables' then array['yes','no']
   when 'fluid_intake' then array['lt_three','three_to_five','gt_five']
   when 'feeding_mode' then array['needs_help','self_with_difficulty','self_without_difficulty']
   when 'self_nutrition' then array['malnourished','uncertain','no_problem']
   when 'self_health' then array['worse','unknown','same','better']
   when 'arm_circumference' then array['mac_lt_21','mac_21_lt_22','mac_gte_22']
   when 'calf_circumference' then array['calf_lt_31','calf_gte_31'] end;
  if allowed is null or not (answer->>'value'=any(allowed)) then return false; end if;
 end loop;
 return true;
end;
$$;

create or replace function private.questionnaire_context_valid(p_form_key text,p_answers jsonb,p_context jsonb)
returns boolean language plpgsql immutable security invoker set search_path='' as $$
declare item text; input_text text; measurement numeric; bmi numeric; expected text; yes_count integer;
begin
 if p_form_key is distinct from 'full_mna' then
  return private.questionnaire_context_valid_pre_full_mna(p_form_key,p_answers,p_context);
 end if;
 if jsonb_typeof(p_context) is distinct from 'object'
  or p_context-array['qualitative_note','height_cm','weight_kg','arm_circumference_cm',
   'calf_circumference_cm','protein_dairy','protein_legumes_eggs','protein_meat_fish_poultry']<>'{}'::jsonb
  then return false; end if;
 for item,input_text in select e.key,e.value from jsonb_each_text(p_context) e loop
  -- Inputs are strings, consistent with the existing measurement editor.
  if jsonb_typeof(p_context->item) is distinct from 'string' then return false; end if;
  if item='qualitative_note' then
   if char_length(input_text) not between 1 and 3000 or input_text<>btrim(input_text)
    or translate(input_text,E'\n\r\t','')~'[[:cntrl:]]' then return false; end if;
  elsif item in ('protein_dairy','protein_legumes_eggs','protein_meat_fish_poultry') then
   if input_text not in ('yes','no') then return false; end if;
  else
   if input_text !~ '^([0-9]{1,3})(\.[0-9])?$' then return false; end if;
   measurement:=input_text::numeric;
   if item='height_cm' and measurement not between 50 and 240 then return false; end if;
   if item='weight_kg' and measurement not between 20 and 300 then return false; end if;
   if item='arm_circumference_cm' and measurement not between 10 and 80 then return false; end if;
   if item='calf_circumference_cm' and measurement not between 10 and 80 then return false; end if;
  end if;
 end loop;
 if p_answers->'anthropometry'->>'state'='answered' then
  if not(p_context ?& array['height_cm','weight_kg']) then return false; end if;
  bmi:=(p_context->>'weight_kg')::numeric / power((p_context->>'height_cm')::numeric/100,2);
  expected:=case when bmi<19 then 'bmi_lt_19' when bmi<21 then 'bmi_19_lt_21'
   when bmi<23 then 'bmi_21_lt_23' else 'bmi_gte_23' end;
  if p_answers->'anthropometry'->>'value' is distinct from expected then return false; end if;
 end if;
 if p_answers->'arm_circumference'->>'state'='answered' then
  if not(p_context ? 'arm_circumference_cm') then return false; end if;
  measurement:=(p_context->>'arm_circumference_cm')::numeric;
  expected:=case when measurement<21 then 'mac_lt_21' when measurement<22 then 'mac_21_lt_22' else 'mac_gte_22' end;
  if p_answers->'arm_circumference'->>'value' is distinct from expected then return false; end if;
 end if;
 if p_answers->'calf_circumference'->>'state'='answered' then
  if not(p_context ? 'calf_circumference_cm') then return false; end if;
  expected:=case when (p_context->>'calf_circumference_cm')::numeric<31 then 'calf_lt_31' else 'calf_gte_31' end;
  if p_answers->'calf_circumference'->>'value' is distinct from expected then return false; end if;
 end if;
 if p_answers->'protein_intake'->>'state'='answered' then
  if not(p_context ?& array['protein_dairy','protein_legumes_eggs','protein_meat_fish_poultry']) then return false; end if;
  select count(*) into yes_count from jsonb_each_text(p_context)
   where key in ('protein_dairy','protein_legumes_eggs','protein_meat_fish_poultry') and value='yes';
  expected:=case when yes_count<=1 then 'zero_or_one_yes' when yes_count=2 then 'two_yes' else 'three_yes' end;
  if p_answers->'protein_intake'->>'value' is distinct from expected then return false; end if;
 end if;
 return true;
exception when invalid_text_representation or numeric_value_out_of_range then return false;
end;
$$;

-- Fractional points belong only to the full questionnaire. The nine old
-- instruments continue through the unchanged integer implementation.
create or replace function private.questionnaire_calculation(p_form text,p_version text,p_answers jsonb,p_context jsonb)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare catalog private.questionnaire_form_catalog%rowtype; item jsonb; choice jsonb; answer jsonb;
 score numeric:=0; incomplete integer:=0; classification jsonb;
begin
 if p_form is distinct from 'full_mna' then
  return private.questionnaire_calculation_pre_full_mna(p_form,p_version,p_answers,p_context);
 end if;
 if not private.questionnaire_answers_valid(p_form,p_answers)
  or not private.questionnaire_context_valid(p_form,p_answers,p_context) then
  raise exception using errcode='22023',message='invalid full MNA answers or measurement context'; end if;
 select * into strict catalog from private.questionnaire_form_catalog where form_key=p_form and form_version=p_version;
 for item in select value from jsonb_array_elements(catalog.rule_snapshot->'items') loop
  answer:=p_answers->(item->>'id');
  if answer->>'state' is distinct from 'answered' then incomplete:=incomplete+1; continue; end if;
  select value into choice from jsonb_array_elements(item->'choices') where value->>'value'=answer->>'value';
  if choice is null then raise exception using errcode='22023',message='full MNA choice not in rule'; end if;
  score:=score+(choice->>'points')::numeric;
 end loop;
 if incomplete>0 then return jsonb_build_object('status','incomplete','raw',null,'adjusted',null,
  'classification',null,'unit',catalog.rule_snapshot->>'scoreUnit','incompleteCount',incomplete); end if;
 select value into classification from jsonb_array_elements(catalog.rule_snapshot->'bands')
  where score between (value->>'minInclusive')::numeric and (value->>'maxInclusive')::numeric limit 1;
 return jsonb_build_object('status','complete','raw',score,'adjusted',score,
  'classification',classification,'unit',catalog.rule_snapshot->>'scoreUnit','incompleteCount',0);
end;
$$;

-- Extend current guarded definitions, retaining all intervening pending-client
-- and staff admission changes. Anchors fail closed if a prior shape changed.
do $extend$ declare definition text; signature text; anchor text; begin
 foreach signature in array array[
  'private.mutate_questionnaire_assessment_draft_v1(uuid,uuid,jsonb,uuid)',
  'private.questionnaire_assessment_snapshot_guarded(uuid,uuid,text,uuid)',
  'private.authorized_pending_questionnaire_client_ids(uuid,uuid,uuid[])'
 ] loop
  definition:=pg_get_functiondef(signature::regprocedure);
  anchor:='''nsi_determine'',''mna_sf''';
  -- The intake workspace has its own ordered list rather than adjacent NSI/SF.
  if position(anchor in definition)=0 then anchor:='''bsrs5'',''mna_sf'''; end if;
  if position(anchor in definition)=0 then raise exception 'unexpected questionnaire form whitelist: %',signature; end if;
  definition:=replace(definition,anchor,anchor||',''full_mna''');
  if signature like 'private.mutate_questionnaire_assessment_draft_v1%' then
   anchor:='when ''mna_sf'' then ''mna-sf-revised-2009-traditional-chinese-v1'' end;';
   if position(anchor in definition)=0 then raise exception 'unexpected questionnaire version whitelist'; end if;
   definition:=replace(definition,anchor,'when ''full_mna'' then ''full-mna-chinese-amended-2023-v1'' '||anchor);
  end if;
  execute definition;
 end loop;
 definition:=pg_get_functiondef('private.assessment_matrix_snapshot_guarded(uuid,uuid,date,integer,integer)'::regprocedure);
 anchor:='(''mna_sf'',9)';
 if position(anchor in definition)=0 then raise exception 'unexpected assessment matrix forms'; end if;
 execute replace(definition,anchor,anchor||', (''full_mna'',10)');
end $extend$;

alter table public.questionnaire_assessment_versions
 drop constraint questionnaire_assessment_versions_form_key_check,
 drop constraint questionnaire_assessment_versions_form_version_check,
 add constraint questionnaire_assessment_versions_form_key_check check(form_key in (
  'spmsq','gds_15','barthel_adl','lawton_iadl','eat10_swallowing','bsrs5','fall_risk_taipei_115','nsi_determine','mna_sf','full_mna')),
 add constraint questionnaire_assessment_versions_form_version_check check(form_version in (
  'spmsq-pfeiffer-10-education-adjusted-v1','gds-15-strict-complete-v1','barthel-adl-0-100-v1',
  'lawton-iadl-8-domain-expanded-v1','eat10-tw-v1','bsrs5-zh-tw-v1','fall-risk-taipei-community-115-b12-v1',
  'nsi-determine-10-weighted-v1','mna-sf-revised-2009-traditional-chinese-v1','full-mna-chinese-amended-2023-v1')),
 add constraint questionnaire_full_mna_version_check
  check((form_key='full_mna')=(form_version='full-mna-chinese-amended-2023-v1'));

commit;
