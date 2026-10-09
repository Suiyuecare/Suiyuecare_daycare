-- A reviewed JUBO master can be pending admission. These five instruments
-- store candidate drafts only; their formal signature functions stay blocked.
-- Preserve the source lifecycle state on each immutable draft version.
begin;

alter table public.spmsq_assessment_versions
  drop constraint spmsq_assessment_service_status_check,
  add constraint spmsq_assessment_service_status_check check (
    service_status_at_assessment in (
      'pending', 'active', 'suspended', 'transferred', 'closed', 'deceased'
    )
  );

alter table public.gds_assessment_versions
  drop constraint gds_assessment_service_status_check,
  add constraint gds_assessment_service_status_check check (
    service_status_at_assessment in (
      'pending', 'active', 'suspended', 'transferred', 'closed', 'deceased'
    )
  );

alter table public.fall_risk_assessment_versions
  drop constraint fall_risk_assessment_service_status_check,
  add constraint fall_risk_assessment_service_status_check check (
    service_status_at_assessment in (
      'pending', 'active', 'suspended', 'transferred', 'closed', 'deceased'
    )
  );

alter table public.nsi_nutrition_screening_versions
  drop constraint nsi_nutrition_screening_service_status_check,
  add constraint nsi_nutrition_screening_service_status_check check (
    service_status_at_assessment in (
      'pending', 'active', 'suspended', 'transferred', 'closed', 'deceased'
    )
  );

alter table public.chewing_assessment_versions
  drop constraint chewing_assessment_service_status_check,
  add constraint chewing_assessment_service_status_check check (
    service_status_at_assessment in (
      'pending', 'active', 'suspended', 'transferred', 'closed', 'deceased'
    )
  );

commit;
