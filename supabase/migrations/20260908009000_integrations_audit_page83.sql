-- Page 83: bounded, redacted, immutable read projection over persisted
-- integration activity and audit evidence. This migration intentionally adds
-- no provider registry, retry, deactivation, reconciliation, or cloud command.

create or replace function private.integrations_audit_resource_category(
  p_table_name text
)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when p_table_name in (
      'audit_events', 'integrations_audit_snapshot',
      'roles', 'role_permissions', 'permissions', 'memberships',
      'public.roles', 'public.role_permissions', 'public.permissions',
      'public.memberships',
      'form_definitions', 'form_versions', 'form_publication_requests',
      'role_governance_snapshot', 'form_governance_snapshot',
      'authorized_care_plan_view_snapshot',
      'public.form_definitions', 'public.form_versions',
      'public.form_publication_requests'
    ) then 'governance'
    when p_table_name in (
      'import_batches', 'import_operations', 'import_fields', 'public.import_batches',
      'public.import_operations', 'public.import_fields'
    ) then 'import'
    when p_table_name in (
      'notifications', 'notification_deliveries',
      'notification_center_snapshot', 'push_notification_management_snapshot',
      'push_notification_recipient_preview',
      'public.notifications', 'public.notification_deliveries'
    ) then 'notification'
    when p_table_name in (
      'sync_operations', 'public.sync_operations'
    ) then 'sync'
    when p_table_name in (
      'claim_batches', 'claim_items', 'public.claim_batches', 'public.claim_items'
    ) then 'claim'
    when p_table_name in (
      'care_communication_versions', 'care_communication_recipients',
      'care_communication_attachments', 'care_communication_delivery_events',
      'care_communication_snapshot', 'consultant_message_snapshot',
      'public.care_communication_versions',
      'public.care_communication_recipients',
      'public.care_communication_attachments',
      'public.care_communication_delivery_events',
      'private.care_communication_operations'
    ) then 'communication'
    when p_table_name in (
      'interprofessional_consultation_events',
      'interprofessional_consultation_outbox',
      'interprofessional_consultation_snapshot',
      'referral_events', 'referral_notification_outbox',
      'referral_management_snapshot', 'case_conference_versions',
      'case_conference_snapshot',
      'physical_therapy_assessment_versions',
      'occupational_therapy_assessment_versions',
      'physical_therapy_service_record_versions',
      'occupational_therapy_service_record_versions',
      'professional_service_summary_snapshots',
      'public.interprofessional_consultation_events',
      'public.interprofessional_consultation_outbox',
      'public.referral_events', 'public.referral_notification_outbox',
      'public.case_conference_versions',
      'public.physical_therapy_assessment_versions',
      'public.occupational_therapy_assessment_versions',
      'public.physical_therapy_service_record_versions',
      'public.occupational_therapy_service_record_versions',
      'private.interprofessional_consultation_operations',
      'private.referral_operations', 'private.case_conference_operations',
      'private.physical_therapy_assessment_operations',
      'private.occupational_therapy_assessment_operations',
      'private.physical_therapy_service_operations',
      'private.occupational_therapy_service_operations',
      'private.professional_service_summary_snapshots'
    ) then 'professional_service'
    when p_table_name in (
      'clients', 'client_assignments', 'client_transitions', 'consents',
      'public.clients', 'public.client_assignments',
      'public.client_transitions', 'public.consents'
    ) then 'client'
    when p_table_name in (
      'profiles', 'public.profiles',
      'staff_employment_versions', 'staff_management_proposals',
      'staff_schedule_versions', 'staff_schedule_decisions',
      'staff_training_record_versions', 'staff_certificate_versions',
      'staff_vaccination_versions', 'staff_tocc_versions',
      'staff_vital_sign_versions', 'staff_lab_report_versions',
      'staff_announcement_versions', 'staff_announcement_recipients',
      'staff_announcement_read_receipts',
      'staff_management_snapshot', 'staff_scheduling_snapshot',
      'staff_training_snapshot', 'staff_certificate_snapshot',
      'staff_vaccination_snapshot', 'staff_tocc_snapshot',
      'staff_vital_sign_snapshot', 'staff_lab_report_snapshot',
      'staff_announcement_snapshot', 'staff_announcement_audience_options',
      'public.staff_employment_versions', 'public.staff_management_proposals',
      'public.staff_schedule_versions', 'public.staff_schedule_decisions',
      'public.staff_training_record_versions', 'public.staff_certificate_versions',
      'public.staff_vaccination_versions', 'public.staff_tocc_versions',
      'public.staff_vital_sign_versions', 'public.staff_lab_report_versions',
      'public.staff_announcement_versions', 'public.staff_announcement_recipients',
      'public.staff_announcement_read_receipts',
      'private.staff_session_revocation_jobs', 'private.staff_role_request_versions',
      'private.staff_scheduling_rule_versions', 'private.staff_scheduling_operations',
      'private.staff_training_rule_proposals', 'private.staff_training_rule_versions',
      'private.staff_training_record_operations', 'private.staff_training_rule_operations',
      'private.staff_certificate_operations',
      'private.staff_certificate_exception_requests',
      'private.staff_certificate_exception_approvals',
      'private.staff_certificate_exception_operations',
      'private.staff_vaccination_operations', 'private.staff_tocc_operations',
      'private.staff_vital_sign_operations', 'private.staff_lab_report_operations',
      'private.staff_announcement_operations'
    ) then 'staff'
    when p_table_name in (
      'care_records', 'service_events', 'client_service_plans',
      'authorized_care_plans', 'medication_plans', 'medication_administrations',
      'measurements', 'insulin_governance_versions', 'insulin_plan_designations',
      'insulin_administration_events', 'insulin_administration_snapshot',
      'individual_service_plans', 'case_service_record_versions',
      'client_inspection_report_versions', 'client_vaccination_versions',
      'client_tocc_assessments', 'abcd_assessment_versions',
      'adaptation_assessment_versions', 'chewing_assessment_versions',
      'fall_risk_assessment_versions', 'gds_assessment_versions',
      'mna_assessment_versions', 'psychosocial_assessment_versions',
      'spmsq_assessment_versions', 'public.care_records',
      'public.service_events', 'public.client_service_plans',
      'public.authorized_care_plans', 'public.medication_plans',
      'public.medication_administrations', 'public.measurements',
      'public.insulin_governance_versions', 'public.insulin_plan_designations',
      'public.insulin_administration_events', 'public.individual_service_plans',
      'public.case_service_record_versions', 'public.client_inspection_report_versions',
      'public.client_vaccination_versions', 'public.client_tocc_assessments',
      'public.abcd_assessment_versions', 'public.adaptation_assessment_versions',
      'public.chewing_assessment_versions', 'public.fall_risk_assessment_versions',
      'public.gds_assessment_versions', 'public.mna_assessment_versions',
      'public.psychosocial_assessment_versions', 'public.spmsq_assessment_versions',
      'private.medication_plan_operations', 'private.medication_plan_terminations',
      'private.medication_administration_operations',
      'private.insulin_administration_operations',
      'private.individual_service_plan_operations',
      'private.case_service_record_operations',
      'private.client_inspection_report_operations',
      'private.client_vaccination_operations',
      'private.client_tocc_operations', 'private.client_tocc_batch_operations',
      'private.abcd_assessment_operations', 'private.adaptation_assessment_operations',
      'private.chewing_assessment_operations', 'private.fall_risk_assessment_operations',
      'private.gds_assessment_operations', 'private.mna_assessment_operations',
      'private.psychosocial_assessment_operations', 'private.spmsq_assessment_operations'
    ) then 'care'
    when p_table_name in (
      'billing_fee_item_versions', 'billing_invoices', 'billing_invoice_lines',
      'billing_ledger_entries', 'billing_receipts',
      'billing_reconciliation_runs', 'billing_management_snapshot',
      'public.billing_fee_item_versions', 'public.billing_invoices',
      'public.billing_invoice_lines', 'public.billing_ledger_entries',
      'public.billing_receipts', 'public.billing_reconciliation_runs',
      'private.billing_operations'
    ) then 'billing'
    when p_table_name in (
      'attendance_records', 'transport_trip_plan_versions',
      'transport_trip_plan_decisions', 'transport_execution_streams',
      'transport_execution_events', 'transport_trip_plan_snapshot',
      'transport_execution_snapshot', 'inventory_items',
      'inventory_item_status_events', 'inventory_batches', 'inventory_movements',
      'inventory_management_snapshot', 'meal_requirement_versions',
      'meal_plan_versions', 'meal_management_snapshot',
      'public.attendance_records', 'public.transport_trip_plan_versions',
      'public.transport_trip_plan_decisions', 'public.transport_execution_streams',
      'public.transport_execution_events', 'public.inventory_items',
      'public.inventory_item_status_events', 'public.inventory_batches',
      'public.inventory_movements', 'public.meal_requirement_versions',
      'public.meal_plan_versions', 'private.attendance_operations',
      'private.transport_policy_versions', 'private.transport_plan_operations',
      'private.transport_execution_operations', 'private.inventory_policy_versions',
      'private.inventory_safety_levels', 'private.inventory_item_operations',
      'private.inventory_movement_operations', 'private.meal_management_operations'
    ) then 'operations'
    else 'other'
  end;
$$;

create or replace function private.integrations_audit_safe_record_id(
  p_table_name text,
  p_row_pk text
)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select case
    when p_table_name in (
      'organizations', 'branches', 'profiles', 'memberships', 'roles',
      'clients', 'client_assignments', 'client_transitions', 'consents',
      'form_definitions', 'form_versions', 'form_publication_requests',
      'care_records', 'measurements', 'service_events',
      'claim_batches', 'claim_items', 'import_batches', 'import_operations',
      'notifications', 'notification_deliveries', 'sync_operations',
      'authorized_care_plans', 'client_service_plans',
      'care_communication_versions', 'care_communication_delivery_events',
      'interprofessional_consultation_events', 'interprofessional_consultation_outbox',
      'referral_events', 'referral_notification_outbox',
      'case_conference_versions', 'physical_therapy_assessment_versions',
      'occupational_therapy_assessment_versions',
      'physical_therapy_service_record_versions',
      'occupational_therapy_service_record_versions',
      'staff_employment_versions', 'staff_management_proposals',
      'staff_schedule_versions', 'staff_schedule_decisions',
      'staff_training_record_versions', 'staff_certificate_versions',
      'staff_vaccination_versions', 'staff_tocc_versions',
      'staff_vital_sign_versions', 'staff_lab_report_versions',
      'staff_announcement_versions', 'staff_announcement_recipients',
      'staff_announcement_read_receipts',
      'billing_fee_item_versions', 'billing_invoices', 'billing_invoice_lines',
      'billing_ledger_entries', 'billing_receipts', 'billing_reconciliation_runs',
      'attendance_records', 'transport_trip_plan_versions',
      'transport_trip_plan_decisions', 'transport_execution_streams',
      'transport_execution_events', 'inventory_items',
      'inventory_item_status_events', 'inventory_batches', 'inventory_movements',
      'meal_requirement_versions', 'meal_plan_versions',
      'insulin_governance_versions', 'insulin_plan_designations',
      'insulin_administration_events', 'individual_service_plans',
      'case_service_record_versions', 'client_inspection_report_versions',
      'client_vaccination_versions', 'client_tocc_assessments',
      'abcd_assessment_versions', 'adaptation_assessment_versions',
      'chewing_assessment_versions', 'fall_risk_assessment_versions',
      'gds_assessment_versions', 'mna_assessment_versions',
      'psychosocial_assessment_versions', 'spmsq_assessment_versions',
      'integrations_audit_snapshot',
      'public.organizations', 'public.branches', 'public.profiles',
      'public.memberships', 'public.roles', 'public.clients',
      'public.client_assignments', 'public.client_transitions',
      'public.consents', 'public.form_definitions', 'public.form_versions',
      'public.form_publication_requests', 'public.care_records',
      'public.measurements', 'public.service_events', 'public.claim_batches',
      'public.claim_items', 'public.import_batches', 'public.import_operations',
      'public.notifications', 'public.notification_deliveries',
      'public.sync_operations', 'public.authorized_care_plans',
      'public.client_service_plans', 'public.care_communication_versions',
      'public.care_communication_delivery_events',
      'public.interprofessional_consultation_events',
      'public.interprofessional_consultation_outbox', 'public.referral_events',
      'public.referral_notification_outbox', 'public.case_conference_versions',
      'public.physical_therapy_assessment_versions',
      'public.occupational_therapy_assessment_versions',
      'public.physical_therapy_service_record_versions',
      'public.occupational_therapy_service_record_versions',
      'public.staff_employment_versions', 'public.staff_management_proposals',
      'public.staff_schedule_versions', 'public.staff_schedule_decisions',
      'public.staff_training_record_versions', 'public.staff_certificate_versions',
      'public.staff_vaccination_versions', 'public.staff_tocc_versions',
      'public.staff_vital_sign_versions', 'public.staff_lab_report_versions',
      'public.staff_announcement_versions', 'public.staff_announcement_recipients',
      'public.staff_announcement_read_receipts',
      'public.billing_fee_item_versions', 'public.billing_invoices',
      'public.billing_invoice_lines', 'public.billing_ledger_entries',
      'public.billing_receipts', 'public.billing_reconciliation_runs',
      'public.attendance_records', 'public.transport_trip_plan_versions',
      'public.transport_trip_plan_decisions', 'public.transport_execution_streams',
      'public.transport_execution_events', 'public.inventory_items',
      'public.inventory_item_status_events', 'public.inventory_batches',
      'public.inventory_movements', 'public.meal_requirement_versions',
      'public.meal_plan_versions',
      'public.insulin_governance_versions', 'public.insulin_plan_designations',
      'public.insulin_administration_events', 'public.individual_service_plans',
      'public.case_service_record_versions',
      'public.client_inspection_report_versions',
      'public.client_vaccination_versions', 'public.client_tocc_assessments',
      'public.abcd_assessment_versions', 'public.adaptation_assessment_versions',
      'public.chewing_assessment_versions', 'public.fall_risk_assessment_versions',
      'public.gds_assessment_versions', 'public.mna_assessment_versions',
      'public.psychosocial_assessment_versions', 'public.spmsq_assessment_versions',
      'private.interprofessional_consultation_operations',
      'private.referral_operations', 'private.case_conference_operations',
      'private.physical_therapy_assessment_operations',
      'private.occupational_therapy_assessment_operations',
      'private.physical_therapy_service_operations',
      'private.occupational_therapy_service_operations',
      'private.professional_service_summary_snapshots',
      'private.staff_session_revocation_jobs', 'private.staff_role_request_versions',
      'private.staff_scheduling_rule_versions', 'private.staff_scheduling_operations',
      'private.staff_training_rule_proposals', 'private.staff_training_rule_versions',
      'private.staff_training_record_operations', 'private.staff_training_rule_operations',
      'private.staff_certificate_operations',
      'private.staff_certificate_exception_requests',
      'private.staff_certificate_exception_approvals',
      'private.staff_certificate_exception_operations',
      'private.staff_vaccination_operations', 'private.staff_tocc_operations',
      'private.staff_vital_sign_operations', 'private.staff_lab_report_operations',
      'private.staff_announcement_operations', 'private.billing_operations',
      'private.attendance_operations', 'private.transport_policy_versions',
      'private.transport_plan_operations', 'private.transport_execution_operations',
      'private.inventory_policy_versions', 'private.inventory_safety_levels',
      'private.inventory_item_operations', 'private.inventory_movement_operations',
      'private.meal_management_operations'
    ) and lower(coalesce(p_row_pk, '')) ~
      '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      then jsonb_build_object('kind', 'uuid', 'value', lower(p_row_pk))
    when p_table_name in (
      'permissions', 'import_fields', 'public.permissions', 'public.import_fields'
    )
      and coalesce(p_row_pk, '') ~ '^(0|[1-9][0-9]{0,18})$'
      then jsonb_build_object('kind', 'number', 'value', p_row_pk)
    else null
  end;
$$;

create or replace function private.integrations_audit_snapshot_bundle(
  p_expected_organization_id uuid,
  p_expected_branch_id uuid,
  p_start_date date,
  p_end_date date,
  p_window_start timestamptz,
  p_window_end_exclusive timestamptz,
  p_integration_key text,
  p_activity_state text,
  p_audit_action text,
  p_resource_category text,
  p_actor_user_id uuid,
  p_correlation_id uuid,
  p_generated_at timestamptz,
  p_stale_after timestamptz
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with source_catalog(source_order, integration_key, source_path) as (
    values
      (1, 'central_html_import'::text,
        '/app/staff/governance/central-html-import'::text),
      (2, 'notification_delivery'::text,
        '/app/staff/communication/push-notifications'::text),
      (3, 'pwa_sync'::text, null::text),
      (4, 'claims'::text,
        '/app/staff/service-management/claims'::text),
      (5, 'consultation_notification_outbox'::text,
        '/app/staff/professional-care/consultations'::text),
      (6, 'referral_notification_outbox'::text,
        '/app/staff/professional-care/referrals'::text),
      (7, 'family_communication_delivery'::text,
        '/app/staff/communication/care-communication'::text)
  ),
  raw_signals as materialized (
    select
      batch.id as signal_id,
      'central_html_import'::text as integration_key,
      batch.updated_at as occurred_at,
      case
        when batch.status = 'validation_failed' then 'failed'
        when batch.status = 'mapping_required' then 'pending'
        when batch.status in ('queued', 'parsed', 'ready_for_approval') then 'pending'
        else 'completed'
      end::text as signal_state,
      batch.upload_idempotency_key as correlation_id,
      case
        when batch.status = 'validation_failed' then 'import_validation_failed'
        when batch.status = 'mapping_required' then 'import_mapping_required'
        else null
      end::text as error_category,
      case
        when batch.status = 'validation_failed' and batch.failure_code is not null then 'redacted'
        when batch.status in ('validation_failed', 'mapping_required') then 'available'
        else 'not_applicable'
      end::text as error_code_status
    from public.import_batches batch
    where batch.organization_id = p_expected_organization_id
      and batch.branch_id = p_expected_branch_id
      and batch.updated_at >= p_window_start
      and batch.updated_at < p_window_end_exclusive
      and batch.updated_at <= p_generated_at
      and (p_correlation_id is null or
        batch.upload_idempotency_key = p_correlation_id)

    union all

    select
      delivery.id,
      'notification_delivery'::text,
      delivery.updated_at,
      case
        when delivery.status = 'failed' then 'failed'
        when delivery.status in ('queued', 'sent') then 'pending'
        when delivery.status = 'suppressed' then 'suppressed'
        else 'completed'
      end::text,
      delivery.idempotency_key,
      case when delivery.status = 'failed'
        then 'notification_delivery_failed' else null end::text,
      case
        when delivery.status = 'failed' and delivery.error_code is not null then 'redacted'
        when delivery.status = 'failed' then 'available'
        else 'not_applicable'
      end::text
    from public.notification_deliveries delivery
    where delivery.organization_id = p_expected_organization_id
      and delivery.branch_id = p_expected_branch_id
      and delivery.updated_at >= p_window_start
      and delivery.updated_at < p_window_end_exclusive
      and delivery.updated_at <= p_generated_at
      and (p_correlation_id is null or delivery.idempotency_key = p_correlation_id)

    union all

    select
      operation.id,
      'pwa_sync'::text,
      operation.updated_at,
      case operation.status
        when 'pending' then 'pending'
        when 'applied' then 'completed'
        when 'conflict' then 'conflict'
        else 'rejected'
      end::text,
      operation.idempotency_key,
      case operation.status
        when 'conflict' then 'sync_conflict'
        when 'rejected' then 'sync_rejected'
        else null
      end::text,
      case
        when operation.status = 'conflict' and operation.conflict_details is not null then 'redacted'
        when operation.status in ('conflict', 'rejected') then 'available'
        else 'not_applicable'
      end::text
    from public.sync_operations operation
    where operation.organization_id = p_expected_organization_id
      and operation.branch_id = p_expected_branch_id
      and operation.updated_at >= p_window_start
      and operation.updated_at < p_window_end_exclusive
      and operation.updated_at <= p_generated_at
      and (p_correlation_id is null or operation.idempotency_key = p_correlation_id)

    union all

    select
      batch.id,
      'claims'::text,
      batch.updated_at,
      case
        when batch.status = 'rejected' then 'rejected'
        when batch.status in ('draft', 'validated', 'exported', 'submitted') then 'pending'
        when batch.status = 'voided' then 'suppressed'
        else 'completed'
      end::text,
      null::uuid,
      case when batch.status = 'rejected' then 'claim_rejected' else null end::text,
      case when batch.status = 'rejected' then 'available'
        else 'not_applicable' end::text
    from public.claim_batches batch
    where batch.organization_id = p_expected_organization_id
      and batch.branch_id = p_expected_branch_id
      and batch.updated_at >= p_window_start
      and batch.updated_at < p_window_end_exclusive
      and batch.updated_at <= p_generated_at
      and p_correlation_id is null

    union all

    select
      queued.id,
      'consultation_notification_outbox'::text,
      queued.queued_at,
      'queued_unconfigured'::text,
      queued.correlation_id,
      'external_delivery_not_configured'::text,
      'available'::text
    from public.interprofessional_consultation_outbox queued
    where queued.organization_id = p_expected_organization_id
      and queued.branch_id = p_expected_branch_id
      and queued.queued_at >= p_window_start
      and queued.queued_at < p_window_end_exclusive
      and queued.queued_at <= p_generated_at
      and (p_correlation_id is null or queued.correlation_id = p_correlation_id)

    union all

    select
      queued.id,
      'referral_notification_outbox'::text,
      queued.queued_at,
      'queued_unconfigured'::text,
      queued.correlation_id,
      'external_delivery_not_configured'::text,
      'available'::text
    from public.referral_notification_outbox queued
    where queued.organization_id = p_expected_organization_id
      and queued.branch_id = p_expected_branch_id
      and queued.queued_at >= p_window_start
      and queued.queued_at < p_window_end_exclusive
      and queued.queued_at <= p_generated_at
      and (p_correlation_id is null or queued.correlation_id = p_correlation_id)

    union all

    select
      delivery.id,
      'family_communication_delivery'::text,
      delivery.occurred_at,
      'queued_unconfigured'::text,
      delivery.correlation_id,
      'external_delivery_not_configured'::text,
      'available'::text
    from public.care_communication_delivery_events delivery
    where delivery.organization_id = p_expected_organization_id
      and delivery.branch_id = p_expected_branch_id
      and delivery.occurred_at >= p_window_start
      and delivery.occurred_at < p_window_end_exclusive
      and delivery.occurred_at <= p_generated_at
      and (p_correlation_id is null or delivery.correlation_id = p_correlation_id)
  ),
  bounded_signals as materialized (
    select signal.*
    from raw_signals signal
    where signal.occurred_at >= p_window_start
      and signal.occurred_at < p_window_end_exclusive
      and signal.occurred_at <= p_generated_at
      and (p_correlation_id is null or signal.correlation_id = p_correlation_id)
  ),
  source_metrics as (
    select
      signal.integration_key,
      count(*)::bigint as record_total,
      count(*) filter (where signal.signal_state in (
        'failed', 'conflict', 'rejected', 'queued_unconfigured'
      ) or signal.error_category = 'import_mapping_required')::bigint as attention_total,
      count(*) filter (where signal.signal_state in (
        'pending', 'queued_unconfigured'
      ))::bigint as pending_total,
      max(signal.occurred_at) as latest_activity_at
    from bounded_signals signal
    group by signal.integration_key
  ),
  inventory_all as materialized (
    select
      catalog.source_order,
      catalog.integration_key,
      catalog.source_path,
      case
        when coalesce(metrics.attention_total, 0) > 0 then 'attention'
        when coalesce(metrics.record_total, 0) > 0 then 'observed'
        else 'no_activity'
      end::text as activity_state,
      coalesce(metrics.record_total, 0)::bigint as record_total,
      coalesce(metrics.attention_total, 0)::bigint as attention_total,
      coalesce(metrics.pending_total, 0)::bigint as pending_total,
      metrics.latest_activity_at
    from source_catalog catalog
    left join source_metrics metrics using (integration_key)
  ),
  inventory_visible as materialized (
    select inventory.*
    from inventory_all inventory
    where (p_integration_key = 'all' or inventory.integration_key = p_integration_key)
      and (p_activity_state = 'all' or inventory.activity_state = p_activity_state)
  ),
  inventory_result as (
    select
      count(*)::bigint as matching_total,
      coalesce(jsonb_agg(jsonb_build_object(
        'integration_key', inventory.integration_key,
        'source_path', inventory.source_path,
        'activity_state', inventory.activity_state,
        'record_total', inventory.record_total,
        'attention_total', inventory.attention_total,
        'pending_total', inventory.pending_total,
        'latest_activity_at', inventory.latest_activity_at,
        'governance_status', 'unconfigured',
        'provider_region_status', 'unconfigured',
        'owner_status', 'unconfigured',
        'retry_command_status', 'unconfigured',
        'deactivation_command_status', 'unconfigured',
        'reconciliation_command_status', 'unconfigured'
      ) order by inventory.source_order), '[]'::jsonb) as items
    from inventory_visible inventory
  ),
  signal_filtered as materialized (
    select signal.*, catalog.source_path
    from bounded_signals signal
    join inventory_visible inventory
      on inventory.integration_key = signal.integration_key
    join source_catalog catalog
      on catalog.integration_key = signal.integration_key
  ),
  signal_total as (
    select count(*)::bigint as value from signal_filtered
  ),
  signal_limited as (
    select signal.*
    from signal_filtered signal
    order by signal.occurred_at desc, signal.integration_key, signal.signal_id
    limit 100
  ),
  signal_result as (
    select coalesce(jsonb_agg(jsonb_build_object(
      'signal_id', signal.signal_id,
      'integration_key', signal.integration_key,
      'occurred_at', signal.occurred_at,
      'state', signal.signal_state,
      'correlation_id', signal.correlation_id,
      'error_category', signal.error_category,
      'error_code_status', signal.error_code_status,
      'source_path', signal.source_path
    ) order by signal.occurred_at desc, signal.integration_key, signal.signal_id), '[]'::jsonb) as items
    from signal_limited signal
  ),
  audit_filtered as materialized (
    select
      event.id,
      event.occurred_at,
      event.action,
      private.integrations_audit_resource_category(event.table_name) as resource_category,
      event.actor_user_id,
      private.integrations_audit_safe_record_id(event.table_name, event.row_pk) as record_id,
      case when lower(coalesce(event.request_id, '')) ~
        '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
        then lower(event.request_id)::uuid else null end as request_id,
      event.idempotency_key
    from public.audit_events event
    where event.organization_id = p_expected_organization_id
      and event.branch_id = p_expected_branch_id
      and event.occurred_at >= p_window_start
      and event.occurred_at < p_window_end_exclusive
      and event.occurred_at <= p_generated_at
      and (p_audit_action = 'all' or event.action = p_audit_action)
      and (p_resource_category = 'all' or
        private.integrations_audit_resource_category(event.table_name) = p_resource_category)
      and (p_actor_user_id is null or event.actor_user_id = p_actor_user_id)
      and (p_correlation_id is null or event.idempotency_key = p_correlation_id or
        lower(coalesce(event.request_id, '')) = p_correlation_id::text)
  ),
  audit_total as (
    select count(*)::bigint as value from audit_filtered
  ),
  audit_limited as (
    select event.*
    from audit_filtered event
    order by event.occurred_at desc, event.id desc
    limit 200
  ),
  audit_result as (
    select coalesce(jsonb_agg(jsonb_build_object(
      'audit_event_id', event.id::text,
      'occurred_at', event.occurred_at,
      'action', event.action,
      'resource_category', event.resource_category,
      'actor_user_id', event.actor_user_id,
      'record_id', event.record_id,
      'request_id', event.request_id,
      'idempotency_key', event.idempotency_key
    ) order by event.occurred_at desc, event.id desc), '[]'::jsonb) as items
    from audit_limited event
  )
  select jsonb_build_object(
    'schema_version', 'page83-integrations-audit.v1',
    'organization_id', p_expected_organization_id,
    'branch_id', p_expected_branch_id,
    'generated_at', p_generated_at,
    'stale_after', p_stale_after,
    'window', jsonb_build_object(
      'start_date', p_start_date,
      'end_date', p_end_date,
      'time_zone', 'Asia/Taipei'
    ),
    'filters', jsonb_build_object(
      'start_date', p_start_date,
      'end_date', p_end_date,
      'integration_key', p_integration_key,
      'activity_state', p_activity_state,
      'audit_action', p_audit_action,
      'resource_category', p_resource_category,
      'actor_user_id', p_actor_user_id,
      'correlation_id', p_correlation_id
    ),
    'inventory', inventory_result.items,
    'inventory_matching_total', inventory_result.matching_total,
    'signals', signal_result.items,
    'signal_matching_total', signal_total.value,
    'signals_truncated', signal_total.value > 100,
    'audit_events', audit_result.items,
    'audit_matching_total', audit_total.value,
    'audit_events_truncated', audit_total.value > 200,
    'options', jsonb_build_object(
      'integration_keys', to_jsonb(array[
        'all', 'central_html_import', 'notification_delivery', 'pwa_sync', 'claims',
        'consultation_notification_outbox', 'referral_notification_outbox',
        'family_communication_delivery'
      ]::text[]),
      'activity_states', to_jsonb(array[
        'all', 'observed', 'attention', 'no_activity'
      ]::text[]),
      'audit_actions', to_jsonb(array[
        'all', 'select', 'insert', 'update', 'delete', 'export', 'print', 'sign',
        'correct', 'permission_change', 'rule_change', 'integration'
      ]::text[]),
      'resource_categories', to_jsonb(array[
        'all', 'governance', 'import', 'notification', 'sync', 'claim',
        'communication', 'professional_service', 'client', 'staff', 'care',
        'billing', 'operations', 'other'
      ]::text[])
    ),
    'bounds', jsonb_build_object(
      'max_date_window_days', 90,
      'max_signal_rows', 100,
      'max_audit_rows', 200,
      'max_snapshot_bytes', 1048576
    ),
    'access_requirements', jsonb_build_object(
      'permission', 'audit.view',
      'employee_aal2_required', true,
      'recent_same_session_aal2_required', true,
      'recent_maximum_age_minutes', 15
    ),
    'capabilities', jsonb_build_object(
      'integration_registry_status', 'unconfigured',
      'provider_regional_compliance_status', 'unconfigured',
      'owner_assignment_status', 'unconfigured',
      'retry_commands_status', 'unconfigured',
      'deactivation_commands_status', 'unconfigured',
      'reconciliation_commands_status', 'unconfigured',
      'payload_inspection_status', 'prohibited',
      'mutation_status', 'read_only'
    ),
    'consistency_status', 'single_database_statement_snapshot',
    'demo', false
  )
  from inventory_result
  cross join signal_total
  cross join signal_result
  cross join audit_total
  cross join audit_result;
$$;

create or replace function private.integrations_audit_snapshot(
  p_expected_organization_id uuid,
  p_expected_branch_id uuid,
  p_start_date date,
  p_end_date date,
  p_integration_key text default 'all',
  p_activity_state text default 'all',
  p_audit_action text default 'all',
  p_resource_category text default 'all',
  p_actor_user_id uuid default null,
  p_correlation_id uuid default null
)
returns table(
  snapshot_id uuid,
  snapshot_hash text,
  generated_at timestamptz,
  stale_after timestamptz,
  snapshot_json text
)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_now timestamptz := clock_timestamp();
  v_stale_after timestamptz := v_now + interval '60 seconds';
  v_snapshot_id uuid := gen_random_uuid();
  v_integration_key text := lower(coalesce(nullif(btrim(p_integration_key), ''), 'all'));
  v_activity_state text := lower(coalesce(nullif(btrim(p_activity_state), ''), 'all'));
  v_audit_action text := lower(coalesce(nullif(btrim(p_audit_action), ''), 'all'));
  v_resource_category text := lower(coalesce(nullif(btrim(p_resource_category), ''), 'all'));
  v_window_start timestamptz;
  v_window_end_exclusive timestamptz;
  v_payload jsonb;
  v_snapshot_json text;
  v_snapshot_hash text;
  v_signal_count bigint;
  v_audit_count bigint;
begin
  if v_actor is null
     or p_expected_organization_id is null
     or p_expected_branch_id is null
     or p_start_date is null
     or p_end_date is null
     or p_start_date > p_end_date
     or (p_end_date - p_start_date) not between 0 and 89
     or extract(year from p_start_date) not between 2000 and 2200
     or extract(year from p_end_date) not between 2000 and 2200
     or v_integration_key not in (
       'all', 'central_html_import', 'notification_delivery', 'pwa_sync', 'claims',
       'consultation_notification_outbox', 'referral_notification_outbox',
       'family_communication_delivery'
     )
     or v_activity_state not in ('all', 'observed', 'attention', 'no_activity')
     or v_audit_action not in (
       'all', 'select', 'insert', 'update', 'delete', 'export', 'print', 'sign',
       'correct', 'permission_change', 'rule_change', 'integration'
     )
     or v_resource_category not in (
       'all', 'governance', 'import', 'notification', 'sync', 'claim',
       'communication', 'professional_service', 'client', 'staff', 'care',
       'billing', 'operations', 'other'
     )
     or coalesce(auth.jwt() ->> 'aal', '') <> 'aal2'
     or not exists (
       select 1
       from public.profiles profile
       where profile.id = v_actor
         and profile.is_active
         and profile.kind in ('staff', 'professional', 'driver', 'finance')
     )
     or not exists (
       select 1
       from public.branches branch
       where branch.id = p_expected_branch_id
         and branch.organization_id = p_expected_organization_id
         and branch.is_active
     )
     or not (select private.has_permission(
       p_expected_organization_id, p_expected_branch_id, 'audit.view'
     ))
     or not (select private.has_recent_aal2(15)) then
    raise exception using errcode = '42501',
      message = 'integrations audit snapshot is not permitted';
  end if;

  v_window_start := p_start_date::timestamp at time zone 'Asia/Taipei';
  v_window_end_exclusive := (p_end_date + 1)::timestamp at time zone 'Asia/Taipei';

  -- The source inventory, full counts, bounded rows, options and audit search
  -- are all materialized by this one statement snapshot. The later read-audit
  -- insert contains only count and filter-presence evidence.
  select private.integrations_audit_snapshot_bundle(
    p_expected_organization_id,
    p_expected_branch_id,
    p_start_date,
    p_end_date,
    v_window_start,
    v_window_end_exclusive,
    v_integration_key,
    v_activity_state,
    v_audit_action,
    v_resource_category,
    p_actor_user_id,
    p_correlation_id,
    v_now,
    v_stale_after
  ) into v_payload;

  if v_payload is null
     or octet_length(convert_to(v_payload::text, 'UTF8')) > 1048576 then
    raise exception using errcode = '54000',
      message = 'integrations audit snapshot exceeds safe bounds';
  end if;

  v_snapshot_json := v_payload::text;
  v_snapshot_hash := encode(sha256(convert_to(v_snapshot_json, 'UTF8')), 'hex');
  v_signal_count := (v_payload ->> 'signal_matching_total')::bigint;
  v_audit_count := (v_payload ->> 'audit_matching_total')::bigint;

  insert into public.audit_events (
    organization_id, branch_id, actor_user_id, action, table_name, row_pk,
    changed_fields, metadata
  ) values (
    p_expected_organization_id,
    p_expected_branch_id,
    v_actor,
    'select',
    'integrations_audit_snapshot',
    v_snapshot_id::text,
    '{}'::text[],
    jsonb_build_object(
      'projection', 'page83_integrations_audit_v1',
      'signal_count', v_signal_count,
      'audit_event_count', v_audit_count,
      'date_filter_present', true,
      'integration_filter_present', v_integration_key <> 'all',
      'activity_state_filter_present', v_activity_state <> 'all',
      'audit_action_filter_present', v_audit_action <> 'all',
      'resource_filter_present', v_resource_category <> 'all',
      'actor_filter_present', p_actor_user_id is not null,
      'correlation_filter_present', p_correlation_id is not null,
      'filter_values_logged', false,
      'payload_logged', false,
      'metadata_projected', false
    )
  );

  if coalesce(auth.jwt() ->> 'aal', '') <> 'aal2'
     or not exists (
       select 1
       from public.profiles profile
       where profile.id = v_actor
         and profile.is_active
         and profile.kind in ('staff', 'professional', 'driver', 'finance')
     )
     or not exists (
       select 1
       from public.branches branch
       where branch.id = p_expected_branch_id
         and branch.organization_id = p_expected_organization_id
         and branch.is_active
     )
     or not (select private.has_permission(
       p_expected_organization_id, p_expected_branch_id, 'audit.view'
     ))
     or not (select private.has_recent_aal2(15)) then
    raise exception using errcode = '42501',
      message = 'integrations audit authority expired';
  end if;

  return query select
    v_snapshot_id,
    v_snapshot_hash,
    v_now,
    v_stale_after,
    v_snapshot_json;
end;
$$;

create or replace function public.integrations_audit_snapshot(
  p_expected_organization_id uuid,
  p_expected_branch_id uuid,
  p_start_date date,
  p_end_date date,
  p_integration_key text default 'all',
  p_activity_state text default 'all',
  p_audit_action text default 'all',
  p_resource_category text default 'all',
  p_actor_user_id uuid default null,
  p_correlation_id uuid default null
)
returns table(
  snapshot_id uuid,
  snapshot_hash text,
  generated_at timestamptz,
  stale_after timestamptz,
  snapshot_json text
)
language sql
volatile
security invoker
set search_path = ''
as $$
  select * from private.integrations_audit_snapshot(
    p_expected_organization_id,
    p_expected_branch_id,
    p_start_date,
    p_end_date,
    p_integration_key,
    p_activity_state,
    p_audit_action,
    p_resource_category,
    p_actor_user_id,
    p_correlation_id
  );
$$;

create index integrations_audit_import_time_idx
  on public.import_batches (organization_id, branch_id, updated_at desc, id);
create index integrations_audit_delivery_time_idx
  on public.notification_deliveries (organization_id, branch_id, updated_at desc, id);
create index integrations_audit_sync_time_idx
  on public.sync_operations (organization_id, branch_id, updated_at desc, id);
create index integrations_audit_claim_time_idx
  on public.claim_batches (organization_id, branch_id, updated_at desc, id);
create index integrations_audit_consultation_outbox_time_idx
  on public.interprofessional_consultation_outbox (
    organization_id, branch_id, queued_at desc, id
  );
create index integrations_audit_referral_outbox_time_idx
  on public.referral_notification_outbox (
    organization_id, branch_id, queued_at desc, id
  );
create index integrations_audit_communication_time_idx
  on public.care_communication_delivery_events (
    organization_id, branch_id, occurred_at desc, id
  );

-- Page83 is the only authenticated read boundary for the audit ledger. The
-- legacy table grant exposed arbitrary metadata, changed fields and raw row
-- identifiers despite its RLS scope predicate. SECURITY DEFINER application
-- RPCs and the service-role LINE webhook retain their existing access.
revoke select on table public.audit_events from public, anon, authenticated;

revoke all on function private.integrations_audit_resource_category(text)
  from public, anon, authenticated, service_role;
revoke all on function private.integrations_audit_safe_record_id(text, text)
  from public, anon, authenticated, service_role;
revoke all on function private.integrations_audit_snapshot_bundle(
  uuid, uuid, date, date, timestamptz, timestamptz, text, text, text, text,
  uuid, uuid, timestamptz, timestamptz
) from public, anon, authenticated, service_role;
revoke all on function private.integrations_audit_snapshot(
  uuid, uuid, date, date, text, text, text, text, uuid, uuid
) from public, anon, service_role;
revoke all on function public.integrations_audit_snapshot(
  uuid, uuid, date, date, text, text, text, text, uuid, uuid
) from public, anon, authenticated, service_role;
grant execute on function private.integrations_audit_snapshot(
  uuid, uuid, date, date, text, text, text, text, uuid, uuid
) to authenticated;
grant execute on function public.integrations_audit_snapshot(
  uuid, uuid, date, date, text, text, text, text, uuid, uuid
) to authenticated;

comment on function public.integrations_audit_snapshot(
  uuid, uuid, date, date, text, text, text, text, uuid, uuid
) is
  'Returns one bounded Page83 snapshot of persisted integration activity and redacted audit identifiers. Provider governance and all mutation commands remain explicitly unconfigured.';
