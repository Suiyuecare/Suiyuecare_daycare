begin;
select plan(9);
-- Template regression only: no account approval, membership or grant is added.
-- Runtime tenant / assigned-client / AAL checks are exercised in the workflow suites.
create temporary view intake_template_permissions as
select r.role_key, coalesce(array_agg(p.permission_key) filter (where p.id is not null), '{}'::text[]) permissions
from public.roles r left join public.role_permissions rp on rp.role_id=r.id
left join public.permissions p on p.id=rp.permission_id
where r.is_system group by r.id;

select is((select count(*)::integer from intake_template_permissions),11,'all eleven templates participate in intake permission matrix');
select results_eq(
 $$select role_key from intake_template_permissions where permissions @> array['clients.read','clients.demographics.read'] order by role_key$$,
 $$values ('branch_supervisor'),('case_manager_social_worker'),('nurse'),('organization_manager')$$,
 'only four templates can read sensitive intake demographics');
select results_eq(
 $$select role_key from intake_template_permissions where permissions @> array['clients.read','clients.demographics.read','clients.manage','clients.view_all','imports.manage','imports.approve'] order by role_key$$,
 $$values ('branch_supervisor'),('organization_manager')$$,
 'CMS creation and approval remain administrator duties');
select results_eq(
 $$select role_key from intake_template_permissions where permissions @> array['clients.read','staff_scheduling.manage'] order by role_key$$,
 $$values ('branch_supervisor'),('organization_manager')$$,
 'weekly schedule write is not granted by a caregiver or driver job title');
select results_eq(
 $$select role_key from intake_template_permissions where permissions @> array['clients.read','clients.demographics.read','abcd_assessments.read','abcd_assessments.manage'] order by role_key$$,
 $$values ('branch_supervisor'),('case_manager_social_worker'),('nurse'),('organization_manager')$$,
 'A demographic form write requires its independent field grant');
select results_eq(
 $$select role_key from intake_template_permissions where permissions @> array['clients.read','abcd_assessments.read','abcd_assessments.manage','health.read','care_records.read'] order by role_key$$,
 $$values ('branch_supervisor'),('care_worker'),('case_manager_social_worker'),('nurse'),('organization_manager'),('professional')$$,
 'B and C clinical draft capabilities do not imply demographic permission');
select results_eq(
 $$select role_key from intake_template_permissions where permissions @> array['clients.read','clients.manage','clients.demographics.read'] order by role_key$$,
 $$values ('branch_supervisor'),('organization_manager')$$,
 'full identity document images require both management and demographic access');
select results_eq(
 $$select role_key from intake_template_permissions where permissions @> array['clients.read','medications.manage'] order by role_key$$,
 $$values ('branch_supervisor'),('nurse'),('organization_manager')$$,
 'medication document upload is separate from clinical document read');
select results_eq(
 $$select role_key from intake_template_permissions where permissions @> array['clients.read','health.write'] order by role_key$$,
 $$values ('branch_supervisor'),('care_worker'),('nurse'),('organization_manager')$$,
 'health document upload retains its existing explicit health-write grant');
select * from finish();
rollback;
