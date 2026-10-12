
begin;
set local lock_timeout='5s';

-- The institution director may perform the approved assessment duties in the
-- director's own branch. This does not create a nursing licence, a medication
-- qualification, an organization-wide membership, or a rule publication vote.
insert into public.role_permissions(role_id,permission_id)
select r.id,p.id from public.roles r cross join public.permissions p
where r.is_system and r.organization_id is null and r.role_key='branch_director'
 and p.permission_key in (
  'questionnaire_cognition.read','questionnaire_cognition.manage','questionnaire_cognition.sign',
  'questionnaire_adl.read','questionnaire_adl.manage','questionnaire_adl.sign',
  'questionnaire_swallowing.read','questionnaire_swallowing.manage','questionnaire_swallowing.sign',
  'questionnaire_emotion.read','questionnaire_emotion.manage','questionnaire_emotion.sign',
  'questionnaire_fall.read','questionnaire_fall.manage','questionnaire_fall.sign',
  'questionnaire_nutrition.read','questionnaire_nutrition.manage','questionnaire_nutrition.sign'
 )
on conflict(role_id,permission_id) do nothing;

comment on function private.questionnaire_sign_authority(uuid,uuid,uuid,text)
is 'Live, scoped assessment signature authorization. Institution directors stay branch-scoped; care workers gain no additional questionnaire authority. Actual rule publication and same-session reauthentication remain separate signature preconditions.';
commit;
