begin;
select plan(6);

select ok(
  position('pending' in pg_get_constraintdef(oid)) > 0,
  'SPMSQ candidate draft retains pending admission status'
) from pg_constraint where conname = 'spmsq_assessment_service_status_check';

select ok(
  position('pending' in pg_get_constraintdef(oid)) > 0,
  'GDS candidate draft retains pending admission status'
) from pg_constraint where conname = 'gds_assessment_service_status_check';

select ok(
  position('pending' in pg_get_constraintdef(oid)) > 0,
  'fall-risk candidate draft retains pending admission status'
) from pg_constraint where conname = 'fall_risk_assessment_service_status_check';

select ok(
  position('pending' in pg_get_constraintdef(oid)) > 0,
  'NSI candidate draft retains pending admission status'
) from pg_constraint where conname = 'nsi_nutrition_screening_service_status_check';

select ok(
  position('pending' in pg_get_constraintdef(oid)) > 0,
  'chewing candidate draft retains pending admission status'
) from pg_constraint where conname = 'chewing_assessment_service_status_check';

select ok(
  (select count(*) = 5 from pg_constraint where conname in (
    'spmsq_assessment_service_status_check',
    'gds_assessment_service_status_check',
    'fall_risk_assessment_service_status_check',
    'nsi_nutrition_screening_service_status_check',
    'chewing_assessment_service_status_check'
  )),
  'all five candidate lifecycle constraints remain present'
);

select * from finish();
rollback;
