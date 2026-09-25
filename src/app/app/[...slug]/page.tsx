import type { Metadata } from "next";
import { Suspense } from "react";
import { DailyExpectedClients, DailyExpectedClientsLoading } from "@/components/client-weekly/daily-expected-clients";
import { ShieldX } from "lucide-react";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { DashboardWorkspace } from "@/components/workspace/dashboard-workspace";
import { parseDailyWorkSelection } from "@/lib/core-care/selection-query";
import { canUseRoutineCare } from "@/lib/auth/routine-care";
import { canUseRoutineCompletion } from "@/lib/auth/routine-completion";
import { OpeningReadinessWorkspace } from "@/components/opening-readiness/opening-readiness-workspace";
import { loadOpeningReadinessSnapshot } from "@/lib/opening-readiness/snapshot";
import { canViewOpeningReadiness } from "@/lib/opening-readiness/types";
import { OperationalWorkspace } from "@/components/workspace/operational-workspace";
import { AssessmentEntryWorkspace } from "@/components/assessments/assessment-entry-workspace";
import { externalAssessmentInstruments, type ExternalAssessmentInstrument } from "@/lib/external-assessment-results/contract";
import { ImportWorkspace } from "@/components/imports/import-workspace";
import { SyntheticImportPreview } from "@/components/imports/synthetic-import-preview";
import { IntegrationsAuditWorkspace } from "@/components/integrations-audit/integrations-audit-workspace";
import { FinanceConfigurationPanel } from "@/components/integrations-audit/finance-configuration-panel";
import { inspectFinanceConfiguration } from "@/lib/store-overview/finance-configuration";
import { canReadStoreOverview } from "@/lib/store-overview/access";
import { DataInventoryWorkspace } from "@/components/data-inventory/data-inventory-workspace";
import { loadDataInventorySnapshot } from "@/lib/data-inventory/snapshot";
import type { DataInventorySnapshot } from "@/lib/data-inventory/types";
import { defaultIntegrationsAuditFilters, parseIntegrationsAuditQuery } from "@/lib/integrations-audit/query";
import { IntegrationsAuditSnapshotError, loadIntegrationsAuditSnapshot } from "@/lib/integrations-audit/snapshot";
import { CoreDailyWorkspace } from "@/components/core-care/core-daily-workspace";
import { CaseCenterWorkspace } from "@/components/core-care/case-center-workspace";
import { ClientMasterWorkspace } from "@/components/clients/client-master-workspace";
import { ClientLifecycleWorkspace } from "@/components/clients/client-lifecycle-workspace";
import { ClientServicePlanWorkspace } from "@/components/client-service-plan-workflow/client-service-plan-workspace";
import { CaseServiceRecordsWorkspace } from "@/components/case-service-records/case-service-records-workspace";
import { emptyCaseServiceRecordFilters, parseCaseServiceRecordFilters } from "@/lib/case-service-records/query";
import { CaseServiceRecordSnapshotError, loadCaseServiceRecordSnapshot } from "@/lib/case-service-records/snapshot";
import { emptyClientServicePlanFilters, parseClientServicePlanFilters } from "@/lib/client-service-plan-workflow/query";
import { ClientServicePlanSnapshotError, loadClientServicePlanSnapshot } from "@/lib/client-service-plan-workflow/snapshot";
import { AuthorizedCarePlanViewWorkspace } from "@/components/authorized-care-plan-view/authorized-care-plan-view-workspace";
import { defaultAuthorizedCarePlanFilters, parseAuthorizedCarePlanFilters } from "@/lib/authorized-care-plan-view/query";
import { AuthorizedCarePlanViewSnapshotError, loadAuthorizedCarePlanViewSnapshot } from "@/lib/authorized-care-plan-view/snapshot";
import { BloodGlucoseWorkspace } from "@/components/blood-glucose/blood-glucose-workspace";
import { InsulinAdministrationsWorkspace } from "@/components/insulin-administrations/insulin-administrations-workspace";
import { ClientToccWorkspace } from "@/components/client-tocc/client-tocc-workspace";
import { MedicationRecordsWorkspace } from "@/components/medications/medication-records-workspace";
import { MedicationPlansWorkspace } from "@/components/medication-plans/medication-plans-workspace";
import { ClaimsWorkspace } from "@/components/service-management/claims-workspace";
import { ServiceUsageWorkspace } from "@/components/service-management/service-usage-workspace";
import { FormRuleVersionsWorkspace } from "@/components/form-governance/form-rule-versions-workspace";
import { hasCustomFormGovernanceAccess } from "@/lib/form-governance/lifecycle-auth";
import { RoleGovernanceWorkspace } from "@/components/role-governance/role-governance-workspace";
import { NotificationCenterWorkspace } from "@/components/notification-center/notification-center-workspace";
import { PushNotificationsWorkspace } from "@/components/push-notifications/push-notifications-workspace";
import { IndividualServicePlanWorkspace } from "@/components/individual-service-plans/individual-service-plan-workspace";
import { SocialResourcesWorkspace } from "@/components/social-resources/social-resources-workspace";
import { StaffAnnouncementsWorkspace } from "@/components/staff-announcements/staff-announcements-workspace";
import { FallEventsWorkspace } from "@/components/fall-events/fall-events-workspace";
import { WeightManagementWorkspace } from "@/components/weight-management/weight-management-workspace";
import { InfectionEventsWorkspace } from "@/components/infection-events/infection-events-workspace";
import { AbnormalEventsWorkspace } from "@/components/abnormal-events/abnormal-events-workspace";
import { MeetingManagementWorkspace } from "@/components/meetings/meeting-management-workspace";
import { ActivityManagementWorkspace } from "@/components/activities/activity-management-workspace";
import { InventoryManagementWorkspace } from "@/components/inventory/inventory-management-workspace";
import { SocialWorkRecordsWorkspace } from "@/components/social-work-records/social-work-records-workspace";
import { PsychosocialAssessmentsWorkspace } from "@/components/psychosocial-assessments/psychosocial-assessments-workspace";
import { AdaptationAssessmentsWorkspace } from "@/components/adaptation-assessments/adaptation-assessments-workspace";
import { OccupationalTherapyAssessmentsWorkspace } from "@/components/occupational-therapy-assessments/occupational-therapy-assessments-workspace";
import { PhysicalTherapyAssessmentsWorkspace } from "@/components/physical-therapy-assessments/physical-therapy-assessments-workspace";
import { PhysicalTherapyServicesWorkspace } from "@/components/physical-therapy-services/physical-therapy-services-workspace";
import { OccupationalTherapyServicesWorkspace } from "@/components/occupational-therapy-services/occupational-therapy-services-workspace";
import { ProfessionalServiceSummaryWorkspace } from "@/components/professional-service-summary/professional-service-summary-workspace";
import { DailyServiceSummaryWorkspace } from "@/components/daily-service-summary/daily-service-summary-workspace";
import { SpmsqAssessmentsWorkspace } from "@/components/spmsq-assessments/spmsq-assessments-workspace";
import { GdsAssessmentsWorkspace } from "@/components/gds-assessments/gds-assessments-workspace";
import { FallRiskAssessmentsWorkspace } from "@/components/fall-risk-assessments/fall-risk-assessments-workspace";
import { NsiNutritionScreeningsWorkspace } from "@/components/nsi-nutrition-screenings/nsi-nutrition-screenings-workspace";
import { BehaviorEventsWorkspace } from "@/components/behavior-events/behavior-events-workspace";
import { AbcdAssessmentsWorkspace } from "@/components/abcd-assessments/abcd-assessments-workspace";
import { ClientInspectionReportsWorkspace } from "@/components/client-inspection-reports/client-inspection-reports-workspace";
import { ClientVaccinationsWorkspace } from "@/components/client-vaccinations/client-vaccinations-workspace";
import { ChewingAssessmentsWorkspace } from "@/components/chewing-assessments/chewing-assessments-workspace";
import { MnaAssessmentsWorkspace } from "@/components/mna-assessments/mna-assessments-workspace";
import { QuestionnaireAssessmentsWorkspace } from "@/components/questionnaire-assessments/questionnaire-assessment-editor";
import { getQuestionnaireForm } from "@/lib/questionnaire-assessments/forms";
import { loadQuestionnaireSnapshot, QuestionnaireSnapshotError } from "@/lib/questionnaire-assessments/snapshot";
import type { QuestionnaireFormKey, QuestionnaireSnapshot } from "@/lib/questionnaire-assessments/types";
import { StaffTrainingWorkspace } from "@/components/staff-training/staff-training-workspace";
import { StaffCertificatesWorkspace } from "@/components/staff-certificates/staff-certificates-workspace";
import { StaffVaccinationsWorkspace } from "@/components/staff-vaccinations/staff-vaccinations-workspace";
import { StaffToccWorkspace } from "@/components/staff-tocc/staff-tocc-workspace";
import { StaffLabReportsWorkspace } from "@/components/staff-lab-reports/staff-lab-reports-workspace";
import { StaffVitalSignsWorkspace } from "@/components/staff-vital-signs/staff-vital-signs-workspace";
import { ConsultantMessagesWorkspace } from "@/components/consultant-messages/consultant-messages-workspace";
import { CareCommunicationsWorkspace } from "@/components/care-communications/care-communications-workspace";
import { ReassuranceCalendarWorkspace } from "@/components/reassurance-calendar/reassurance-calendar-workspace";
import { InterprofessionalConsultationsWorkspace } from "@/components/interprofessional-consultations/interprofessional-consultations-workspace";
import { CaseConferencesWorkspace } from "@/components/case-conferences/case-conferences-workspace";
import { ReferralManagementWorkspace } from "@/components/referral-management/referral-management-workspace";
import { ExternalHealthDevicesWorkspace } from "@/components/external-health-devices/external-health-devices-workspace";
import { HandHygieneWorkspace } from "@/components/hand-hygiene/hand-hygiene-workspace";
import { OrganizationProfileWorkspace } from "@/components/organization-profile/organization-profile-workspace";
import { StaffManagementWorkspace } from "@/components/staff-management/staff-management-workspace";
import { DocumentPrintingWorkspace } from "@/components/document-printing/document-printing-workspace";
import { StaffSchedulingWorkspace } from "@/components/staff-scheduling/staff-scheduling-workspace";
import { BillingManagementWorkspace } from "@/components/billing-management/billing-management-workspace";
import { MealManagementWorkspace } from "@/components/meal-management/meal-management-workspace";
import { TransportPlansWorkspace } from "@/components/transport-plans/transport-plans-workspace";
import { TransportExecutionWorkspace } from "@/components/transport-execution/transport-execution-workspace";
import { FeedbackComplaintsWorkspace } from "@/components/feedback-complaints/feedback-complaints-workspace";
import { hasRecentAal2, requireTenantContext } from "@/lib/auth/context";
import {
  canAccessCatalogPage,
  getModule,
  getPageBySlug,
  staffPages,
} from "@/lib/catalog";
import { buildDemoRecords } from "@/lib/demo/fixtures";
import { parseServiceDate } from "@/lib/core-care/date";
import { filterDailyCareSnapshotByClient } from "@/lib/core-care/projection";
import {
  CoreCareSnapshotError,
  loadDailyCareSnapshot,
} from "@/lib/core-care/snapshot";
import { isCoreDailyPage } from "@/lib/core-care/types";
import { loadCareRosterSnapshot } from "@/lib/care-roster/snapshot";
import { CareReminderCard } from "@/components/care-reminders/care-reminder-card";
import { CareDiaryLifecycle } from "@/components/core-care/care-diary-lifecycle";
import { env, isSyntheticPreviewMode, isSyntheticReadMode } from "@/lib/env";
import {
  filterBloodGlucoseSnapshot,
} from "@/lib/blood-glucose/projection";
import {
  BloodGlucoseSnapshotError,
  loadBloodGlucoseSnapshot,
} from "@/lib/blood-glucose/snapshot";
import type {
  BloodGlucoseClientSummary,
  BloodGlucoseMeasurementStatus,
} from "@/lib/blood-glucose/types";
import {
  loadInsulinAdministrationSnapshot,
  InsulinAdministrationSnapshotError,
} from "@/lib/insulin-administrations/snapshot";
import {
  INSULIN_SHIFTS,
  INSULIN_STATE_FILTERS,
  type InsulinFilters,
  type InsulinShift,
  type InsulinStateFilter,
} from "@/lib/insulin-administrations/types";
import { filterClientToccSnapshot } from "@/lib/client-tocc/projection";
import {
  ClientToccSnapshotError,
  loadClientToccSnapshot,
} from "@/lib/client-tocc/snapshot";
import {
  CLIENT_TOCC_RESULT_STATUSES,
  type ClientToccOption,
  type ClientToccResultFilter,
  type ClientToccValidityFilter,
} from "@/lib/client-tocc/types";
import {
  filterMedicationAdministrationSnapshot,
  medicationClientOptions,
} from "@/lib/medications/projection";
import {
  loadMedicationAdministrationSnapshot,
  MedicationAdministrationSnapshotError,
} from "@/lib/medications/snapshot";
import {
  MEDICATION_STATUS_FILTERS,
  type MedicationClientOption,
  type MedicationStatusFilter,
} from "@/lib/medications/types";
import {
  loadMedicationPlanSnapshot,
  MedicationPlanSnapshotError,
} from "@/lib/medication-plans/snapshot";
import {
  MEDICATION_PLAN_LIFECYCLE_STATES,
  type MedicationPlanLifecycleFilter,
} from "@/lib/medication-plans/types";
import {
  caseCenterHref,
  parseCaseCenterFilters,
} from "@/lib/case-center/query";
import {
  CaseCenterRegistryError,
  loadCaseCenterSnapshot,
} from "@/lib/case-center/registry";
import {
  BLOOD_GLUCOSE_MEAL_CONTEXTS,
  type BloodGlucoseMealContext,
} from "@/lib/integrations/blood-glucose";
import {
  hasClientMasterWriteAuthority,
} from "@/lib/clients/master";
import {
  ClientMasterSnapshotError,
  loadClientMasterSnapshot,
} from "@/lib/clients/master-snapshot";
import type {
  ClientMasterSourceFilter,
  ClientMasterStatusFilter,
} from "@/lib/clients/master-types";
import {
  ClientLifecycleSnapshotError,
  loadClientLifecycleSnapshot,
} from "@/lib/clients/lifecycle-registry";
import {
  CLIENT_LIFECYCLE_STATUSES,
  CLIENT_TRANSITION_KINDS,
  type ClientLifecycleStatusFilter,
  type ClientLifecycleStatus,
  type ClientTransitionKind,
} from "@/lib/clients/types";
import {
  loadClaimReadSnapshot,
  loadServiceUsageSnapshot,
  ServiceManagementSnapshotError,
} from "@/lib/service-management/snapshot";
import type {
  ClaimStatus,
  ServiceEventStatus,
} from "@/lib/service-management/types";
import {
  FormGovernanceSnapshotError,
  loadFormGovernanceSnapshot,
} from "@/lib/form-governance/snapshot";
import type {
  FormGovernanceScopeFilter,
  FormGovernanceStatusFilter,
} from "@/lib/form-governance/types";
import {
  loadRoleGovernanceSnapshot,
  RoleGovernanceSnapshotError,
} from "@/lib/role-governance/snapshot";
import { filterNotificationCenterSnapshot } from "@/lib/notification-center/projection";
import {
  loadNotificationCenterSnapshot,
  NotificationCenterSnapshotError,
} from "@/lib/notification-center/snapshot";
import {
  NOTIFICATION_CENTER_STATUS_FILTERS,
  type NotificationCenterPriorityFilter,
  type NotificationCenterStatusFilter,
} from "@/lib/notification-center/types";
import {
  loadPushNotificationManagementSnapshot,
  PushNotificationManagementSnapshotError,
} from "@/lib/push-notifications/snapshot";
import {
  PUSH_NOTIFICATION_HISTORY_STATUS_FILTERS,
  type PushNotificationHistoryStatusFilter,
} from "@/lib/push-notifications/types";
import { isPlanMonth, taipeiPlanMonth } from "@/lib/individual-service-plans/date";
import { filterIndividualServicePlanSnapshot } from "@/lib/individual-service-plans/projection";
import {
  IndividualServicePlanSnapshotError,
  loadIndividualServicePlanSnapshot,
} from "@/lib/individual-service-plans/snapshot";
import {
  INDIVIDUAL_PLAN_PROGRESS,
  type IndividualPlanProgress,
} from "@/lib/individual-service-plans/types";
import {
  loadSocialResourceSnapshot,
  SocialResourceSnapshotError,
} from "@/lib/social-resources/snapshot";
import type {
  SocialResourceFilters,
  SocialResourceStatusFilter,
} from "@/lib/social-resources/types";
import { filterStaffAnnouncementSnapshot } from "@/lib/staff-announcements/projection";
import {
  loadStaffAnnouncementSnapshot,
  StaffAnnouncementSnapshotError,
} from "@/lib/staff-announcements/snapshot";
import {
  STAFF_ANNOUNCEMENT_LIFECYCLES,
  type StaffAnnouncementStatusFilter,
} from "@/lib/staff-announcements/types";
import {
  FallEventSnapshotError,
  loadFallEventSnapshot,
} from "@/lib/fall-events/snapshot";
import type {
  FallEventFilters,
  FallHandlingStatusFilter,
} from "@/lib/fall-events/types";
import {
  InfectionEventSnapshotError,
  loadInfectionEventSnapshot,
} from "@/lib/infection-events/snapshot";
import type {
  InfectionClusterMode,
  InfectionEventFilters,
  InfectionHandlingStatusFilter,
} from "@/lib/infection-events/types";
import {
  AbnormalEventSnapshotError,
  loadAbnormalEventSnapshot,
} from "@/lib/abnormal-events/snapshot";
import type {
  AbnormalAffectedTargetFilter,
  AbnormalEventFilters,
  AbnormalHandlingStatusFilter,
} from "@/lib/abnormal-events/types";
import {
  loadWeightManagementSnapshot,
  WeightManagementSnapshotError,
} from "@/lib/weight-management/snapshot";
import {
  WEIGHT_ALERT_FILTERS,
  WEIGHT_CHANGE_DIRECTIONS,
  type WeightAlertFilter,
  type WeightChangeDirectionFilter,
  type WeightManagementFilters,
} from "@/lib/weight-management/types";
import { isMeetingCalendarDate } from "@/lib/meetings/date";
import { filterMeetingManagementSnapshot } from "@/lib/meetings/projection";
import {
  loadMeetingManagementSnapshot,
  MeetingManagementSnapshotError,
} from "@/lib/meetings/snapshot";
import type {
  MeetingFilters,
  MeetingStatusFilter,
} from "@/lib/meetings/types";
import {
  ActivitySnapshotError,
  loadActivityManagementSnapshot,
} from "@/lib/activities/snapshot";
import {
  ACTIVITY_STATUSES,
  type ActivityFilters,
  type ActivityStatusFilter,
} from "@/lib/activities/types";
import {
  loadInventoryManagementSnapshot,
  InventoryManagementSnapshotError,
} from "@/lib/inventory/snapshot";
import {
  INVENTORY_EXPIRY_FILTERS,
  INVENTORY_MOVEMENT_TYPES,
  type InventoryExpiryFilter,
  type InventoryFilters,
  type InventoryMovementFilter,
} from "@/lib/inventory/types";
import {
  loadSocialWorkRecordSnapshot,
  SocialWorkRecordSnapshotError,
} from "@/lib/social-work-records/snapshot";
import type { SocialWorkRecordFilters } from "@/lib/social-work-records/types";
import {
  loadPsychosocialAssessmentSnapshot,
  PsychosocialAssessmentSnapshotError,
} from "@/lib/psychosocial-assessments/snapshot";
import {
  CLIENT_SERVICE_STATUSES as PSYCHOSOCIAL_CLIENT_SERVICE_STATUSES,
  type ClientServiceStatus as PsychosocialClientServiceStatus,
  type PsychosocialAssessmentFilters,
} from "@/lib/psychosocial-assessments/types";
import {
  loadAdaptationAssessmentSnapshot,
  AdaptationAssessmentSnapshotError,
} from "@/lib/adaptation-assessments/snapshot";
import {
  ADAPTATION_STATUSES,
  CLIENT_SERVICE_STATUSES,
  type AdaptationAssessmentFilters,
  type AdaptationStatus,
  type ClientServiceStatus,
} from "@/lib/adaptation-assessments/types";
import {
  loadOccupationalTherapyAssessmentSnapshot,
  OccupationalTherapyAssessmentSnapshotError,
} from "@/lib/occupational-therapy-assessments/snapshot";
import {
  CLIENT_SERVICE_STATUSES as OCCUPATIONAL_THERAPY_CLIENT_SERVICE_STATUSES,
  type ClientServiceStatus as OccupationalTherapyClientServiceStatus,
  type OccupationalTherapyAssessmentFilters,
} from "@/lib/occupational-therapy-assessments/types";
import {
  loadPhysicalTherapyAssessmentSnapshot,
  PhysicalTherapyAssessmentSnapshotError,
} from "@/lib/physical-therapy-assessments/snapshot";
import {
  parsePhysicalTherapyAssessmentFilters,
} from "@/lib/physical-therapy-assessments/query";
import {
  loadPhysicalTherapyServiceSnapshot,
  PhysicalTherapyServiceSnapshotError,
} from "@/lib/physical-therapy-services/snapshot";
import { parsePhysicalTherapyServiceQuery } from "@/lib/physical-therapy-services/query";
import type { PhysicalTherapyServiceFilters } from "@/lib/physical-therapy-services/types";
import {
  loadOccupationalTherapyServiceSnapshot,
  OccupationalTherapyServiceSnapshotError,
} from "@/lib/occupational-therapy-services/snapshot";
import { parseOccupationalTherapyServiceQuery } from "@/lib/occupational-therapy-services/query";
import type { OccupationalTherapyServiceFilters } from "@/lib/occupational-therapy-services/types";
import {
  loadProfessionalServiceSummarySnapshot,
  ProfessionalServiceSummarySnapshotError,
} from "@/lib/professional-service-summary/snapshot";
import { parseProfessionalServiceSummaryQuery } from "@/lib/professional-service-summary/query";
import {
  DailyServiceSummarySnapshotError,
  loadDailyServiceSummarySnapshot,
} from "@/lib/daily-service-summary/snapshot";
import { parseDailyServiceSummaryQuery } from "@/lib/daily-service-summary/query";
import {
  loadSpmsqAssessmentSnapshot,
  SpmsqAssessmentSnapshotError,
} from "@/lib/spmsq-assessments/snapshot";
import type { SpmsqAssessmentFilters } from "@/lib/spmsq-assessments/types";
import {
  GdsAssessmentSnapshotError,
  loadGdsAssessmentSnapshot,
} from "@/lib/gds-assessments/snapshot";
import { parseGdsAssessmentFilters } from "@/lib/gds-assessments/query";
import {
  FallRiskAssessmentSnapshotError,
  loadFallRiskAssessmentSnapshot,
} from "@/lib/fall-risk-assessments/snapshot";
import { parseFallRiskAssessmentFilters } from "@/lib/fall-risk-assessments/query";
import {
  loadNsiNutritionScreeningSnapshot,
  NsiNutritionScreeningSnapshotError,
} from "@/lib/nsi-nutrition-screenings/snapshot";
import { parseNsiNutritionScreeningFilters } from "@/lib/nsi-nutrition-screenings/query";
import { parseBehaviorEventFilters } from "@/lib/behavior-events/query";
import {
  BehaviorEventSnapshotError,
  loadBehaviorEventSnapshot,
} from "@/lib/behavior-events/snapshot";
import { emptyAbcdAssessmentFilters, parseAbcdAssessmentFilters } from "@/lib/abcd-assessments/query";
import {
  AbcdAssessmentSnapshotError,
  loadAbcdAssessmentSnapshot,
} from "@/lib/abcd-assessments/snapshot";
import { parseClientInspectionReportFilters } from "@/lib/client-inspection-reports/query";
import {
  ClientInspectionReportSnapshotError,
  loadClientInspectionReportSnapshot,
} from "@/lib/client-inspection-reports/snapshot";
import { parseClientVaccinationFilters } from "@/lib/client-vaccinations/query";
import {
  ClientVaccinationSnapshotError,
  loadClientVaccinationSnapshot,
} from "@/lib/client-vaccinations/snapshot";
import {
  ChewingAssessmentSnapshotError,
  loadChewingAssessmentSnapshot,
} from "@/lib/chewing-assessments/snapshot";
import { parseChewingAssessmentFilters } from "@/lib/chewing-assessments/query";
import {
  loadMnaAssessmentSnapshot,
  MnaAssessmentSnapshotError,
} from "@/lib/mna-assessments/snapshot";
import { parseMnaAssessmentFilters } from "@/lib/mna-assessments/query";
import { isStaffTrainingCalendarDate } from "@/lib/staff-training/date";
import {
  loadStaffTrainingSnapshot,
  StaffTrainingSnapshotError,
} from "@/lib/staff-training/snapshot";
import {
  STAFF_TRAINING_STATUSES,
  type StaffTrainingFilters,
  type StaffTrainingStatusFilter,
} from "@/lib/staff-training/types";
import {
  loadStaffCertificateSnapshot,
  StaffCertificateSnapshotError,
} from "@/lib/staff-certificates/snapshot";
import {
  STAFF_CERTIFICATE_STATUS_FILTERS,
  type StaffCertificateFilters,
  type StaffCertificateStatusFilter,
} from "@/lib/staff-certificates/types";
import { isStaffVaccinationDate } from "@/lib/staff-vaccinations/date";
import {
  loadStaffVaccinationSnapshot,
  StaffVaccinationSnapshotError,
} from "@/lib/staff-vaccinations/snapshot";
import {
  STAFF_VACCINATION_STATUS_FILTERS,
  type StaffVaccinationFilters,
  type StaffVaccinationStatusFilter,
} from "@/lib/staff-vaccinations/types";
import { isStaffToccDate } from "@/lib/staff-tocc/date";
import {
  loadStaffToccSnapshot,
  StaffToccSnapshotError,
} from "@/lib/staff-tocc/snapshot";
import {
  STAFF_TOCC_ATTENTION_FILTERS,
  STAFF_TOCC_DISPOSITION_FILTERS,
  STAFF_TOCC_VALIDITY_FILTERS,
  type StaffToccAttentionFilter,
  type StaffToccDispositionFilter,
  type StaffToccFilters,
  type StaffToccValidityFilter,
} from "@/lib/staff-tocc/types";
import { isStaffLabReportDate } from "@/lib/staff-lab-reports/date";
import {
  loadStaffLabReportSnapshot,
  StaffLabReportSnapshotError,
} from "@/lib/staff-lab-reports/snapshot";
import {
  STAFF_LAB_REPORT_DUPLICATE_FILTERS,
  STAFF_LAB_REPORT_EVIDENCE_FILTERS,
  STAFF_LAB_REPORT_VALIDITY_FILTERS,
  type StaffLabReportDuplicateFilter,
  type StaffLabReportEvidenceFilter,
  type StaffLabReportFilters,
  type StaffLabReportValidityFilter,
} from "@/lib/staff-lab-reports/types";
import { isStaffVitalSignDate } from "@/lib/staff-vital-signs/date";
import {
  loadStaffVitalSignSnapshot,
  StaffVitalSignSnapshotError,
} from "@/lib/staff-vital-signs/snapshot";
import {
  STAFF_VITAL_SIGN_STATE_FILTERS,
  type StaffVitalSignFilters,
  type StaffVitalSignStateFilter,
} from "@/lib/staff-vital-signs/types";
import {
  ConsultantMessageSnapshotError,
  loadConsultantMessageSnapshot,
} from "@/lib/consultant-messages/snapshot";
import {
  CONSULTANT_MESSAGE_STATUSES,
  type ConsultantMessageFilters,
  type ConsultantMessageStatus,
} from "@/lib/consultant-messages/types";
import {
  CareCommunicationSnapshotError,
  loadCareCommunicationSnapshot,
} from "@/lib/care-communications/snapshot";
import {
  CARE_COMMUNICATION_CONFIRMATION_FILTERS,
  CARE_COMMUNICATION_DELIVERY_FILTERS,
  type CareCommunicationConfirmationFilter,
  type CareCommunicationDeliveryFilter,
  type CareCommunicationFilters,
} from "@/lib/care-communications/types";
import {
  loadReassuranceCalendarSnapshot,
  ReassuranceCalendarSnapshotError,
} from "@/lib/reassurance-calendar/snapshot";
import {
  REASSURANCE_CALENDAR_CATEGORIES,
  REASSURANCE_CALENDAR_STATUSES,
  type ReassuranceCalendarCategory,
  type ReassuranceCalendarFilters,
  type ReassuranceCalendarStatusFilter,
} from "@/lib/reassurance-calendar/types";
import {
  loadInterprofessionalConsultationSnapshot,
  InterprofessionalConsultationSnapshotError,
} from "@/lib/interprofessional-consultations/snapshot";
import {
  CONSULTATION_DEADLINE_FILTERS,
  CONSULTATION_STATUSES,
  CONSULTATION_URGENCIES,
  type ConsultationDeadlineFilter,
  type ConsultationStatus,
  type ConsultationUrgency,
  type InterprofessionalConsultationFilters,
} from "@/lib/interprofessional-consultations/types";
import {
  CaseConferenceSnapshotError,
  loadCaseConferenceSnapshot,
} from "@/lib/case-conferences/snapshot";
import {
  CASE_CONFERENCE_ACTION_STATUSES,
  CASE_CONFERENCE_STATUSES,
  type CaseConferenceActionStatus,
  type CaseConferenceFilters,
  type CaseConferenceStatus,
} from "@/lib/case-conferences/types";
import {
  loadReferralManagementSnapshot,
  ReferralManagementSnapshotError,
} from "@/lib/referral-management/snapshot";
import {
  REFERRAL_RECEIVING_UNIT_MODES,
  REFERRAL_STATUSES,
  type ReferralManagementFilters,
  type ReferralReceivingUnitMode,
  type ReferralStatus,
} from "@/lib/referral-management/types";
import { isExternalHealthDate } from "@/lib/external-health-devices/date";
import {
  ExternalHealthDeviceSnapshotError,
  loadExternalHealthDeviceSnapshot,
} from "@/lib/external-health-devices/snapshot";
import {
  EXTERNAL_HEALTH_DEVICE_STATUSES,
  EXTERNAL_HEALTH_MATCH_STATUSES,
  type ExternalHealthDeviceFilters,
  type ExternalHealthDeviceStatus,
  type ExternalHealthMatchStatus,
} from "@/lib/external-health-devices/types";
import { isHandHygieneCalendarDate } from "@/lib/hand-hygiene/date";
import {
  HandHygieneSnapshotError,
  loadHandHygieneSnapshot,
} from "@/lib/hand-hygiene/snapshot";
import {
  HAND_HYGIENE_EVENT_KINDS,
  HAND_HYGIENE_MATCH_STATUSES,
  type HandHygieneEventKind,
  type HandHygieneFilters,
  type HandHygieneMatchStatus,
} from "@/lib/hand-hygiene/types";
import { isOrganizationProfileDate } from "@/lib/organization-profile/date";
import {
  loadOrganizationProfileSnapshot,
  OrganizationProfileSnapshotError,
} from "@/lib/organization-profile/snapshot";
import {
  ORGANIZATION_PROFILE_STATUS_FILTERS,
  type OrganizationProfileFilters,
  type OrganizationProfileStatusFilter,
} from "@/lib/organization-profile/types";
import { parseStaffManagementFilters } from "@/lib/staff-management/query";
import {
  loadStaffManagementSnapshot,
  StaffManagementSnapshotError,
} from "@/lib/staff-management/snapshot";
import { parseDocumentPrintingFilters } from "@/lib/document-printing/query";
import {
  loadDocumentPrintingSnapshot,
  DocumentPrintingSnapshotError,
} from "@/lib/document-printing/snapshot";
import { parseStaffSchedulingFilters } from "@/lib/staff-scheduling/query";
import {
  loadStaffSchedulingSnapshot,
  StaffSchedulingSnapshotError,
} from "@/lib/staff-scheduling/snapshot";
import { parseBillingManagementFilters } from "@/lib/billing-management/query";
import {
  BillingManagementSnapshotError,
  loadBillingManagementSnapshot,
} from "@/lib/billing-management/snapshot";
import { parseMealManagementFilters } from "@/lib/meal-management/query";
import {
  loadMealManagementSnapshot,
  MealManagementSnapshotError,
} from "@/lib/meal-management/snapshot";
import { parseTransportPlanFilters } from "@/lib/transport-plans/query";
import {
  loadTransportPlanSnapshot,
  TransportPlanSnapshotError,
} from "@/lib/transport-plans/snapshot";
import { parseTransportExecutionFilters } from "@/lib/transport-execution/query";
import {
  loadTransportExecutionSnapshot,
  TransportExecutionSnapshotError,
} from "@/lib/transport-execution/snapshot";
import { parseFeedbackComplaintFilters } from "@/lib/feedback-complaints/query";
import { ReportsWorkspace } from "@/components/reports/reports-workspace";
import { buildOperationalReportLinks, buildReportEntries, parseReportPeriods } from "@/lib/reports/entry";
import { BodyAssessmentsWorkspace } from "@/components/body-assessments/body-assessments-workspace";
import { parseBodyAssessmentFilters } from "@/lib/body-assessments/query";
import { BodyAssessmentSnapshotError, loadBodyAssessmentSnapshot } from "@/lib/body-assessments/snapshot";
import { NursingAssessmentsWorkspace } from "@/components/nursing-assessments/nursing-assessments-workspace";
import { loadNursingAssessmentSnapshot } from "@/lib/nursing-assessments/snapshot";
import {
  FeedbackComplaintSnapshotError,
  loadFeedbackComplaintSnapshot,
} from "@/lib/feedback-complaints/snapshot";

export function generateStaticParams() {
  return staffPages.map((page) => ({ slug: page.slug.split("/") }));
}

export async function generateMetadata({
  params,
}: PageProps<"/app/[...slug]">): Promise<Metadata> {
  const { slug } = await params;
  const page = getPageBySlug(slug.join("/"));
  return page ? { title: page.title, description: page.description } : {};
}

export default async function StaffCatalogPage({
  params,
  searchParams,
}: PageProps<"/app/[...slug]">) {
  const { slug } = await params;
  const query = await searchParams;
  const page = getPageBySlug(slug.join("/"));
  if (!page || page.surface !== "staff") notFound();
  const context = await requireTenantContext("staff");

  if (!canAccessCatalogPage(context, page)) {
    return (
      <section
        aria-labelledby="access-denied-title"
        className="empty-card"
        style={{ margin: "clamp(32px, 8vw, 96px) auto" }}
      >
        <span className="empty-card__icon empty-card__icon--warning">
          <ShieldX aria-hidden="true" />
        </span>
        <p className="eyebrow">無權限</p>
        <h1 id="access-denied-title">這個功能不在您的資料範圍內</h1>
        <p>系統未載入此頁資料。若工作需要使用，請由機構管理員調整角色與有效範圍。</p>
        <Link className="button button--secondary" href="/app/staff/workspace/dashboard">
          返回工作儀表板
        </Link>
      </section>
    );
  }

  if (page.number === 1) {
    const serviceDate = parseServiceDate(
      typeof query.date === "string" ? query.date : undefined,
    );
    const rosterPromise = loadCareRosterSnapshot(context, serviceDate).catch(() => undefined);
    let snapshot = null;
    let loadError = false;
    try {
      snapshot = await loadDailyCareSnapshot(context, serviceDate);
    } catch (error) {
      if (!(error instanceof CoreCareSnapshotError)) throw error;
      loadError = true;
    }
    return (
      <><DashboardWorkspace
        canOpenReadiness={canViewOpeningReadiness(context) && (context.demo || context.scopes.includes("organization_profile.read"))}
        canViewManagementDetails={context.demo || context.scopes.includes("audit.view")}
        loadError={loadError}
        serviceDate={serviceDate}
        snapshot={snapshot}
        roster={await rosterPromise}
      />
      <Suspense fallback={<DailyExpectedClientsLoading />}><DailyExpectedClients context={context} serviceDate={serviceDate} /></Suspense></>
    );
  }

  if (page.number === 2) {
    const filters = parseCaseCenterFilters(query);
    let snapshot = null;
    let loadError = false;
    try {
      snapshot = await loadCaseCenterSnapshot(context, filters);
    } catch (error) {
      if (!(error instanceof CaseCenterRegistryError)) throw error;
      loadError = true;
    }
    if (snapshot && snapshot.page !== filters.page) {
      redirect(caseCenterHref({ ...filters, page: snapshot.page }));
    }
    return (
      <CaseCenterWorkspace
        canOpenIntake={context.demo || ["clients.read", "clients.demographics.read"].every((scope) => context.scopes.includes(scope))}
        allowedDailyPages={staffPages.filter((entry) => [46, 3, 6].includes(entry.number) && canAccessCatalogPage(context, entry)).map((entry) => entry.number)}
        canViewSummary={staffPages.some((entry) => entry.number === 54 && canAccessCatalogPage(context, entry))}
        filters={filters}
        loadError={loadError}
        page={page}
        snapshot={snapshot}
      />
    );
  }

  if (page.number === 4) {
    const serviceDate = parseServiceDate(
      typeof query.date === "string" ? query.date : undefined,
    );
    const requestedClient =
      typeof query.client === "string" ? query.client : undefined;
    const selectedClientId =
      requestedClient &&
      requestedClient !== "all" &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(
        requestedClient,
      )
        ? requestedClient
        : undefined;
    const requestedContext =
      typeof query.context === "string" ? query.context : undefined;
    const mealContext =
      requestedContext &&
      BLOOD_GLUCOSE_MEAL_CONTEXTS.includes(
        requestedContext as BloodGlucoseMealContext,
      )
        ? (requestedContext as BloodGlucoseMealContext)
        : undefined;
    const requestedStatus =
      typeof query.status === "string" ? query.status : "all";
    const measurementStatus: BloodGlucoseMeasurementStatus = [
      "all",
      "measured",
      "unmeasured",
    ].includes(requestedStatus)
      ? (requestedStatus as BloodGlucoseMeasurementStatus)
      : "all";
    let snapshot = null;
    let allClients: BloodGlucoseClientSummary[] = [];
    let loadError = false;
    try {
      const unfiltered = await loadBloodGlucoseSnapshot(context, serviceDate);
      allClients = [...unfiltered.clients];
      snapshot = filterBloodGlucoseSnapshot(unfiltered, {
        clientId: selectedClientId,
        mealContext,
        measurementStatus,
      });
    } catch (error) {
      if (!(error instanceof BloodGlucoseSnapshotError)) throw error;
      loadError = true;
    }
    return (
      <BloodGlucoseWorkspace
        allClients={allClients}
        canWrite={context.demo || (context.assuranceLevel === "aal2" && context.scopes.includes("health.write"))}
        writeUnavailableReason={!context.demo && context.assuranceLevel !== "aal2"
          ? "本批一般帳號尚未開放新增血糖紀錄。您可查閱授權資料；需要登錄時，請交由已核准且完成身分確認的人員處理。" : undefined}
        loadError={loadError}
        mealContext={mealContext}
        measurementStatus={measurementStatus}
        page={page}
        selectedClientId={selectedClientId}
        serviceDate={serviceDate}
        snapshot={snapshot}
      />
    );
  }

  if (page.number === 5) {
    const serviceDate = parseServiceDate(
      typeof query.date === "string" ? query.date : undefined,
    );
    const requestedShift = typeof query.shift === "string" ? query.shift : "all";
    const shift: InsulinShift = INSULIN_SHIFTS.includes(requestedShift as InsulinShift)
      ? requestedShift as InsulinShift : "all";
    const requestedState = typeof query.state === "string" ? query.state : "all";
    const state: InsulinStateFilter = INSULIN_STATE_FILTERS.includes(
      requestedState as InsulinStateFilter,
    ) ? requestedState as InsulinStateFilter : "all";
    const requestedClient = typeof query.client === "string" ? query.client : "";
    const clientId = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu
      .test(requestedClient) ? requestedClient.toLowerCase() : null;
    const filters: InsulinFilters = { serviceDate, shift, clientId, state };
    const hasMutationPermission = [
      "insulin_administrations.execute",
      "insulin_administrations.verify",
      "insulin_administrations.authorize_late",
    ].some((permission) => context.scopes.includes(permission));
    let snapshot = null;
    let loadError = false;
    try {
      const recentAal2 = context.demo || !hasMutationPermission
        ? context.demo : await hasRecentAal2();
      snapshot = await loadInsulinAdministrationSnapshot(context, filters, recentAal2);
    } catch (error) {
      if (!(error instanceof InsulinAdministrationSnapshotError)) throw error;
      loadError = true;
    }
    return <InsulinAdministrationsWorkspace filters={filters} loadError={loadError}
      page={page} snapshot={snapshot} />;
  }

  if (page.number === 7) {
    const serviceDate = parseServiceDate(
      typeof query.date === "string" ? query.date : undefined,
    );
    const requestedClient =
      typeof query.client === "string" ? query.client : undefined;
    const selectedClientId =
      requestedClient &&
      requestedClient !== "all" &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(
        requestedClient,
      )
        ? requestedClient
        : undefined;
    const requestedStatus =
      typeof query.status === "string" ? query.status : "all";
    const status: MedicationStatusFilter = MEDICATION_STATUS_FILTERS.includes(
      requestedStatus as MedicationStatusFilter,
    )
      ? (requestedStatus as MedicationStatusFilter)
      : "all";
    const canRecord =
      context.demo || context.scopes.includes("medications.administer");
    const canVerify =
      context.demo || context.scopes.includes("medications.verify");
    let snapshot = null;
    let allClients: MedicationClientOption[] = [];
    let recentAal2 = context.demo;
    let loadError = false;
    try {
      const [unfiltered, aal2] = await Promise.all([
        loadMedicationAdministrationSnapshot(context, serviceDate),
        context.demo || (!canRecord && !canVerify)
          ? Promise.resolve(context.demo)
          : hasRecentAal2(),
      ]);
      allClients = medicationClientOptions(unfiltered);
      snapshot = filterMedicationAdministrationSnapshot(unfiltered, {
        clientId: selectedClientId,
        status,
      });
      recentAal2 = aal2;
    } catch (error) {
      if (!(error instanceof MedicationAdministrationSnapshotError)) throw error;
      loadError = true;
    }
    return (
      <MedicationRecordsWorkspace
        allClients={allClients}
        canRecord={canRecord}
        canVerify={canVerify}
        currentUserId={context.userId}
        hasRecentAal2={recentAal2}
        loadError={loadError}
        page={page}
        selectedClientId={selectedClientId}
        serviceDate={serviceDate}
        snapshot={snapshot}
        status={status}
      />
    );
  }

  if (page.number === 8) {
    const requestedClient =
      typeof query.client === "string" &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(
        query.client,
      )
        ? query.client.toLowerCase()
        : undefined;
    const requestedStatus =
      typeof query.status === "string" ? query.status : "all";
    const status: MedicationPlanLifecycleFilter =
      requestedStatus === "all" ||
      MEDICATION_PLAN_LIFECYCLE_STATES.includes(
        requestedStatus as (typeof MEDICATION_PLAN_LIFECYCLE_STATES)[number],
      )
        ? (requestedStatus as MedicationPlanLifecycleFilter)
        : "all";
    const searchQuery =
      typeof query.q === "string" ? query.q.slice(0, 120) : "";
    const canManage =
      !context.demo &&
      context.scopes.includes("clients.read") &&
      context.scopes.includes("medications.read") &&
      context.scopes.includes("medications.manage");
    let snapshot = null;
    let recentAal2 = false;
    let loadError = false;
    try {
      [snapshot, recentAal2] = await Promise.all([
        loadMedicationPlanSnapshot(context, requestedClient),
        canManage ? hasRecentAal2() : Promise.resolve(false),
      ]);
    } catch (error) {
      if (!(error instanceof MedicationPlanSnapshotError)) throw error;
      loadError = true;
    }
    return (
      <MedicationPlansWorkspace
        canManage={canManage}
        hasRecentAal2={recentAal2}
        loadError={loadError}
        page={page}
        query={searchQuery}
        snapshot={snapshot}
        status={status}
      />
    );
  }

  if (page.number === 9) {
    const searchQuery =
      typeof query.q === "string" ? query.q.slice(0, 120) : "";
    const requestedValidity =
      typeof query.validity === "string" ? query.validity : "all";
    const validity: ClientToccValidityFilter = [
      "all",
      "current",
      "expired",
      "no_record",
    ].includes(requestedValidity)
      ? (requestedValidity as ClientToccValidityFilter)
      : "all";
    const requestedResult =
      typeof query.result === "string" ? query.result : "all";
    const result: ClientToccResultFilter =
      requestedResult === "all" ||
      CLIENT_TOCC_RESULT_STATUSES.includes(
        requestedResult as (typeof CLIENT_TOCC_RESULT_STATUSES)[number],
      )
        ? (requestedResult as ClientToccResultFilter)
        : "all";
    const canWrite =
      !context.demo &&
      context.scopes.includes("clients.read") &&
      context.scopes.includes("health.write");
    let snapshot = null;
    let allClients: ClientToccOption[] = [];
    let recentAal2 = false;
    let loadError = false;
    try {
      const [unfiltered, aal2] = await Promise.all([
        loadClientToccSnapshot(context),
        canWrite ? hasRecentAal2() : Promise.resolve(false),
      ]);
      allClients = unfiltered.clients.map((client) => ({
        id: client.clientId,
        code: client.clientCode,
        name: client.displayName,
        clientStatus: client.clientStatus,
        admittedOn: client.admittedOn,
        endedOn: client.endedOn,
        canRecord: client.canRecord,
      }));
      snapshot = filterClientToccSnapshot(unfiltered, {
        query: searchQuery,
        validity,
        result,
      });
      recentAal2 = aal2;
    } catch (error) {
      if (!(error instanceof ClientToccSnapshotError)) throw error;
      loadError = true;
    }
    return (
      <ClientToccWorkspace
        allClients={allClients}
        canWrite={canWrite}
        hasRecentAal2={recentAal2}
        loadError={loadError}
        page={page}
        query={searchQuery}
        result={result}
        snapshot={snapshot}
        validity={validity}
      />
    );
  }

  if (page.number === 10) {
    const requestedMonth = typeof query.month === "string" ? query.month : "";
    const planMonth = isPlanMonth(requestedMonth)
      ? requestedMonth
      : taipeiPlanMonth();
    const searchQuery = typeof query.q === "string" ? query.q.slice(0, 120) : "";
    const requestedResponsible =
      typeof query.responsible === "string" ? query.responsible : "all";
    const responsible =
      requestedResponsible === "all" ||
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(requestedResponsible)
        ? requestedResponsible.toLowerCase()
        : "all";
    const requestedProgress = typeof query.progress === "string" ? query.progress : "all";
    const progress: "all" | IndividualPlanProgress =
      requestedProgress === "all" || INDIVIDUAL_PLAN_PROGRESS.includes(requestedProgress as IndividualPlanProgress)
        ? (requestedProgress as "all" | IndividualPlanProgress)
        : "all";
    const canWrite =
      !context.demo &&
      context.scopes.includes("clients.read") &&
      context.scopes.includes("care_plans.write") &&
      context.scopes.includes("care_plans.sign");
    let snapshot = null;
    let recentAal2 = false;
    let loadError = false;
    try {
      const [unfiltered, aal2] = await Promise.all([
        loadIndividualServicePlanSnapshot(context, planMonth),
        canWrite ? hasRecentAal2() : Promise.resolve(false),
      ]);
      snapshot = filterIndividualServicePlanSnapshot(unfiltered, {
        query: searchQuery,
        responsible,
        progress,
      });
      recentAal2 = aal2;
    } catch (error) {
      if (!(error instanceof IndividualServicePlanSnapshotError)) throw error;
      loadError = true;
    }
    return (
      <IndividualServicePlanWorkspace
        canWrite={canWrite}
        hasRecentAal2={recentAal2}
        loadError={loadError}
        page={page}
        progress={progress}
        query={searchQuery}
        responsible={responsible}
        snapshot={snapshot}
      />
    );
  }

  if ([11, 12, 13, 14, 15, 16, 17, 18, 36].includes(page.number)) {
    const formKeyByPage: Record<number, QuestionnaireFormKey> = {
      11: "spmsq",
      12: "gds_15",
      13: "fall_risk_taipei_115",
      14: "nsi_determine",
      15: "barthel_adl",
      16: "lawton_iadl",
      17: "eat10_swallowing",
      18: "bsrs5",
      36: "mna_sf",
    };
    const formKey = formKeyByPage[page.number]!;
    const form = getQuestionnaireForm(formKey)!;
    const requestedClient = typeof query.client === "string" ? query.client : "";
    const validClientId = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(requestedClient)
      ? requestedClient.toLowerCase() : null;
    const invalidFilters = Boolean(requestedClient && !validClientId) ||
      Object.keys(query).some((key) => key !== "client");
    const prefix = formKey === "spmsq"
      ? "questionnaire_cognition"
      : formKey === "barthel_adl" || formKey === "lawton_iadl"
        ? "questionnaire_adl"
        : formKey === "eat10_swallowing"
          ? "questionnaire_swallowing"
          : formKey === "bsrs5" || formKey === "gds_15"
            ? "questionnaire_emotion"
            : formKey === "fall_risk_taipei_115"
              ? "questionnaire_fall"
              : "questionnaire_nutrition";
    const canManage = !context.demo && context.scopes.includes("clients.read") &&
      context.scopes.includes(`${prefix}.read`) && context.scopes.includes(`${prefix}.manage`);
    let snapshot: QuestionnaireSnapshot | null = null;
    let loadError = invalidFilters;
    if (context.demo) {
      snapshot = {
        formKey,
        generatedAt: new Date().toISOString(),
        matchingTotal: 1,
        demo: true,
        clients: [{
          clientId: "00000000-0000-4000-8000-000000000015",
          displayName: "合成測試個案（非真實資料）",
          serviceStatus: "active",
          latest: null,
        }],
      };
    } else if (!invalidFilters) {
      try {
        snapshot = await loadQuestionnaireSnapshot(context, formKey, validClientId);
      } catch (error) {
        if (!(error instanceof QuestionnaireSnapshotError)) throw error;
        loadError = true;
      }
    }
    return <QuestionnaireAssessmentsWorkspace
      assessorName={context.displayName}
      canManage={canManage}
      form={form}
      loadError={loadError}
      pageTitle={page.title}
      selectedClientId={validClientId}
      snapshot={snapshot}
    />;
  }

  if (page.number === 11) {
    const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
    const requestedClient = typeof query.client === "string" ? query.client : "";
    const requestedPreview = typeof query.preview === "string"
      ? query.preview : "all";
    const previewStatus: SpmsqAssessmentFilters["previewStatus"] = [
      "all", "candidate_complete", "incomplete", "not_assessed",
    ].includes(requestedPreview)
      ? requestedPreview as SpmsqAssessmentFilters["previewStatus"] : "all";
    const requestedEducation = typeof query.education === "string"
      ? query.education : "all";
    const educationState: SpmsqAssessmentFilters["educationState"] = [
      "all", "answered", "missing", "not_applicable",
    ].includes(requestedEducation)
      ? requestedEducation as SpmsqAssessmentFilters["educationState"] : "all";
    const filters: SpmsqAssessmentFilters = {
      clientId: uuidPattern.test(requestedClient)
        ? requestedClient.toLowerCase() : null,
      previewStatus,
      educationState,
    };
    const canManage = !context.demo && context.scopes.includes("clients.read") &&
      context.scopes.includes("assessments.read") &&
      context.scopes.includes("assessments.manage");
    let snapshot = null;
    let loadError = false;
    try {
      snapshot = await loadSpmsqAssessmentSnapshot(context, filters);
    } catch (error) {
      if (!(error instanceof SpmsqAssessmentSnapshotError)) throw error;
      loadError = true;
    }
    return <SpmsqAssessmentsWorkspace canManage={canManage} filters={filters}
      loadError={loadError} page={page}
      snapshot={snapshot} />;
  }

  if (page.number === 12) {
    const { filters, invalidFilters } = parseGdsAssessmentFilters(query);
    const canManage = !context.demo && context.scopes.includes("clients.read") &&
      context.scopes.includes("gds_assessments.read") &&
      context.scopes.includes("gds_assessments.manage");
    let snapshot = null;
    let loadError = false;
    if (invalidFilters) {
      loadError = true;
    } else {
      try {
        snapshot = await loadGdsAssessmentSnapshot(context, filters);
      } catch (error) {
        if (!(error instanceof GdsAssessmentSnapshotError)) throw error;
        loadError = true;
      }
    }
    return <GdsAssessmentsWorkspace canManage={canManage} filters={filters}
      loadError={loadError} page={page}
      snapshot={snapshot} />;
  }

  if (page.number === 13) {
    const { filters, invalidFilters } = parseFallRiskAssessmentFilters(query);
    const canManage = !context.demo && context.scopes.includes("clients.read") &&
      context.scopes.includes("fall_risk_assessments.read") &&
      context.scopes.includes("fall_risk_assessments.manage");
    let snapshot = null;
    let loadError = invalidFilters;
    if (!invalidFilters) {
      try {
        snapshot = await loadFallRiskAssessmentSnapshot(context, filters);
      } catch (error) {
        if (!(error instanceof FallRiskAssessmentSnapshotError)) throw error;
        loadError = true;
      }
    }
    return <FallRiskAssessmentsWorkspace canManage={canManage} filters={filters}
      loadError={loadError} page={page}
      snapshot={snapshot} />;
  }

  if (page.number === 14) {
    const { filters, invalidFilters } = parseNsiNutritionScreeningFilters(query);
    const canManage = !context.demo && context.scopes.includes("clients.read") &&
      context.scopes.includes("nsi_nutrition_screenings.read") &&
      context.scopes.includes("nsi_nutrition_screenings.manage");
    let snapshot = null;
    let loadError = invalidFilters;
    if (!invalidFilters) {
      try {
        snapshot = await loadNsiNutritionScreeningSnapshot(context, filters);
      } catch (error) {
        if (!(error instanceof NsiNutritionScreeningSnapshotError)) throw error;
        loadError = true;
      }
    }
    return <NsiNutritionScreeningsWorkspace canManage={canManage}
      filters={filters} loadError={loadError}
      page={page} snapshot={snapshot} />;
  }

  if ([15, 16, 18, 36].includes(page.number)) {
    const requestedClient = typeof query.client === "string" &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(query.client)
      ? query.client.toLowerCase() : null;
    const requestedInstrument: Record<number, ExternalAssessmentInstrument> = {
      15: "barthel_adl", 16: "iadl", 18: "bsrs", 36: "mna",
    };
    const entryHref = `/app/staff/assessments/swallowing${requestedClient
      ? `?client=${encodeURIComponent(requestedClient)}&externalInstrument=${requestedInstrument[page.number]}`
      : `?externalInstrument=${requestedInstrument[page.number]}`}#external-result-entry`;
    return <section className="empty-card" role="status">
      <h1>{page.title}：外部結果登錄</h1>
      <p>可在評估入口選擇個案，登錄經核准紙本／外部工具的原始結果；系統不提供題目或自動計分。</p>
      <Link className="button button--primary" href={entryHref}>{requestedClient ? "登錄外部結果" : "先選個案並登錄結果"}</Link>
    </section>;
  }

  if (page.number === 17) {
    const requestedClient = typeof query.client === "string" ? query.client : "";
    const selectedClientId = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(requestedClient)
      ? requestedClient.toLowerCase() : null;
    let clients: Awaited<ReturnType<typeof loadClientMasterSnapshot>>["clients"] = [];
    let loadError = !context.demo && !context.scopes.includes("clients.read");
    if (!loadError) {
      try {
        clients = (await loadClientMasterSnapshot(context)).clients.filter((client) =>
          !["transferred", "closed", "deceased"].includes(client.status));
      } catch (error) {
        if (!(error instanceof ClientMasterSnapshotError)) throw error;
        loadError = true;
      }
    }
    // Keep the one-client-first entry limited to workflows that have a scoped
    // draft/manual-record write path. Standardized scales without an approved
    // instrument and persistence workflow remain explicitly unavailable below.
    const entryPageNumbers = new Set([11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 28, 32, 33, 34, 35, 36, 51]);
    const entryPages = staffPages.filter((candidate) => entryPageNumbers.has(candidate.number) &&
      canAccessCatalogPage(context, candidate));
    const unavailablePageNumbers = new Set<number>();
    const unavailablePages = staffPages.filter((candidate) => unavailablePageNumbers.has(candidate.number) &&
      canAccessCatalogPage(context, candidate));
    const requestedInstrument = typeof query.externalInstrument === "string" &&
      Object.hasOwn(externalAssessmentInstruments, query.externalInstrument)
      ? query.externalInstrument as ExternalAssessmentInstrument : null;
    let canReadExternalResults = false;
    let canWriteExternalResults = false;
    if (!context.demo) {
      [canReadExternalResults, canWriteExternalResults] = await Promise.all([
        canUseRoutineCare(context, "care_records.read"),
        canUseRoutineCare(context, "care_records.write"),
      ]);
    }
    return <AssessmentEntryWorkspace clients={clients} error={loadError}
      pages={entryPages} unavailablePages={unavailablePages} selectedClientId={selectedClientId}
      initialExternalInstrument={requestedInstrument} canReadExternalResults={canReadExternalResults}
      canWriteExternalResults={canWriteExternalResults} />;
  }

  if (page.number === 20) {
    const parameters = new URLSearchParams();
    for (const [key, value] of Object.entries(query)) {
      if (Array.isArray(value)) value.forEach((item) => parameters.append(key, item));
      else if (typeof value === "string") parameters.append(key, value);
    }
    let filters = parseBehaviorEventFilters(new URLSearchParams());
    let loadError = false;
    try { filters = parseBehaviorEventFilters(parameters); }
    catch { loadError = true; }
    const baseAuthority = !context.demo && context.assuranceLevel === "aal2" &&
      context.scopes.includes("clients.read") && context.scopes.includes("behavior_events.read");
    const canManage = baseAuthority && context.scopes.includes("behavior_events.manage");
    const canSign = baseAuthority && context.scopes.includes("behavior_events.sign");
    let snapshot = null;
    let recentAal2 = false;
    if (!loadError) {
      try {
        [snapshot, recentAal2] = await Promise.all([
          loadBehaviorEventSnapshot(context, filters),
          canSign ? hasRecentAal2() : Promise.resolve(false),
        ]);
      } catch (error) {
        if (!(error instanceof BehaviorEventSnapshotError)) throw error;
        loadError = true;
      }
    }
    return <BehaviorEventsWorkspace canManage={canManage} canSign={canSign}
      filters={filters} hasRecentAal2={recentAal2} loadError={loadError}
      page={page} snapshot={snapshot} />;
  }

  if (page.number === 21) {
    const parameters = new URLSearchParams();
    for (const [key, value] of Object.entries(query)) {
      if (Array.isArray(value)) value.forEach((item) => parameters.append(key, item));
      else if (typeof value === "string") parameters.append(key, value);
    }
    let filters = emptyAbcdAssessmentFilters();
    let loadError = false;
    try { filters = parseAbcdAssessmentFilters(parameters); }
    catch { loadError = true; }
    const canManage = !context.demo && context.assuranceLevel === "aal2" &&
      context.scopes.includes("clients.read") && context.scopes.includes("abcd_assessments.read") &&
      context.scopes.includes("abcd_assessments.manage");
    let snapshot = null;
    let recentAal2 = false;
    if (!loadError) {
      try {
        [snapshot, recentAal2] = await Promise.all([
          loadAbcdAssessmentSnapshot(context, filters),
          canManage ? hasRecentAal2() : Promise.resolve(false),
        ]);
      } catch (error) {
        if (!(error instanceof AbcdAssessmentSnapshotError)) throw error;
        loadError = true;
      }
    }
    return <AbcdAssessmentsWorkspace canManage={canManage} filters={filters}
      hasRecentAal2={recentAal2} loadError={loadError} page={page} snapshot={snapshot} />;
  }

  if (page.number === 22) {
    const parameters = new URLSearchParams();
    for (const [key, value] of Object.entries(query)) {
      if (Array.isArray(value)) value.forEach((item) => parameters.append(key, item));
      else if (typeof value === "string") parameters.append(key, value);
    }
    let filters = parseClientInspectionReportFilters(new URLSearchParams());
    let loadError = false;
    try { filters = parseClientInspectionReportFilters(parameters); }
    catch { loadError = true; }
    const hasAal2 = context.demo || context.assuranceLevel === "aal2";
    const baseAuthority = !context.demo && hasAal2 &&
      ["clients.read", "health.read", "client_reports.read"].every((permission) =>
        context.scopes.includes(permission));
    const canManage = baseAuthority && context.scopes.includes("client_reports.manage");
    let snapshot = null;
    let recentAal2 = false;
    if (!loadError && hasAal2) {
      try {
        [snapshot, recentAal2] = await Promise.all([
          loadClientInspectionReportSnapshot(context, filters),
          canManage ? hasRecentAal2() : Promise.resolve(false),
        ]);
      } catch (error) {
        if (!(error instanceof ClientInspectionReportSnapshotError)) throw error;
        loadError = true;
      }
    }
    return <ClientInspectionReportsWorkspace canManage={canManage}
      filters={filters} hasAal2={hasAal2} hasRecentAal2={recentAal2}
      loadError={loadError} page={page} snapshot={snapshot} />;
  }

  if (page.number === 23) {
    const { filters, invalid } = parseClientVaccinationFilters(query);
    const canManage = !context.demo &&
      ["clients.read", "client_vaccinations.read", "client_vaccinations.manage"]
        .every((permission) => context.scopes.includes(permission));
    let snapshot = null;
    let recentAal2 = false;
    let loadError = invalid;
    if (!invalid) {
      try {
        [snapshot, recentAal2] = await Promise.all([
          loadClientVaccinationSnapshot(context, filters),
          canManage ? hasRecentAal2() : Promise.resolve(false),
        ]);
      } catch (error) {
        if (!(error instanceof ClientVaccinationSnapshotError)) throw error;
        loadError = true;
      }
    }
    return <ClientVaccinationsWorkspace canManage={canManage}
      filters={filters} hasRecentAal2={recentAal2} loadError={loadError}
      page={page} snapshot={snapshot} />;
  }

  if (page.number === 54) {
    const { filters, invalid } = parseDailyServiceSummaryQuery(query);
    const canExport = context.demo || (
      context.scopes.includes("clients.read") &&
      context.scopes.includes("daily_service_summary.read") &&
      context.scopes.includes("daily_service_summary.export")
    );
    let snapshot = null;
    let recentAal2 = context.demo;
    let loadError = invalid;
    if (!invalid) {
      try {
        [snapshot, recentAal2] = await Promise.all([
          loadDailyServiceSummarySnapshot(context, filters),
          canExport ? hasRecentAal2() : Promise.resolve(false),
        ]);
      } catch (error) {
        if (!(error instanceof DailyServiceSummarySnapshotError)) throw error;
        loadError = true;
      }
    }
    return <DailyServiceSummaryWorkspace canExport={canExport}
      filters={filters} hasRecentAal2={recentAal2} loadError={loadError}
      page={page} snapshot={snapshot} />;
  }

  if (isCoreDailyPage(page)) {
    const { serviceDate, selectedClientId, selectedShift, invalid } = parseDailyWorkSelection(query);
    if (invalid) return <section className="empty-card core-care-state" role="alert">
      <h1>請重新選擇個案、日期與班別</h1>
      <p>連結中的個案、日期或班別格式不正確，系統沒有替您選擇其他個案或班別。</p>
      <Link className="button button--secondary" href="/app/staff/workspace/dashboard">回到今日工作</Link>
    </section>;
    let snapshot = null;
    let loadError = false;
    try {
      snapshot = await loadDailyCareSnapshot(context, serviceDate);
    } catch (error) {
      if (!(error instanceof CoreCareSnapshotError)) throw error;
      loadError = true;
    }
    if (snapshot && selectedClientId) {
      snapshot = filterDailyCareSnapshotByClient(snapshot, selectedClientId);
    }
    const writePermission = page.number === 3 ? "health.write" : page.number === 6
      ? "care_records.write" : page.number === 46 ? "attendance.write" : null;
    const [canWriteRoutine, canReadDiary] = await Promise.all([
      writePermission ? canUseRoutineCare(context, writePermission) : Promise.resolve(false),
      page.number === 6 ? canUseRoutineCare(context, "care_records.read") : Promise.resolve(false),
    ]);
    return (
      <CoreDailyWorkspace
        clientAttention={snapshot?.sourceAccess.clients && selectedClientId && snapshot.clients.some((client) => client.clientId === selectedClientId)
          ? <CareReminderCard clientId={selectedClientId} context={context} /> : undefined}
        diaryLifecycle={page.number === 6 && snapshot?.sourceAccess.careDiaries && selectedClientId && snapshot.clients.some((client) => client.clientId === selectedClientId)
          ? <CareDiaryLifecycle clientId={selectedClientId} readEnabled={canReadDiary} enabled={canWriteRoutine}
            canRevise={!context.demo && context.assuranceLevel === "aal2" && context.scopes.includes("care_records.write")}
            canSign={!context.demo && context.assuranceLevel === "aal2" && context.scopes.includes("care_records.sign")} demo={context.demo} /> : undefined}
        canViewManagementDetails={context.demo || context.scopes.includes("audit.view")}
        canWrite={canWriteRoutine}
        loadError={loadError}
        moduleTitle={getModule(page.moduleId).title}
        page={page}
        serviceDate={serviceDate}
        selectedClientId={selectedClientId}
        selectedShift={selectedShift}
        snapshot={snapshot}
      />
    );
  }

  if (page.number === 47) {
    const parameters = new URLSearchParams();
    for (const [key, value] of Object.entries(query)) {
      if (Array.isArray(value)) value.forEach((item) => parameters.append(key, item));
      else if (typeof value === "string") parameters.append(key, value);
    }
    const fallbackDate = parseServiceDate(undefined);
    let filters = parseTransportPlanFilters(new URLSearchParams(), fallbackDate);
    let invalidFilters = false;
    try {
      filters = parseTransportPlanFilters(parameters, fallbackDate);
    } catch {
      invalidFilters = true;
    }
    const baseAuthority = !context.demo && context.assuranceLevel === "aal2" &&
      ["clients.read", "transport_plans.read"].every((scope) =>
        context.scopes.includes(scope));
    const canManage = baseAuthority && context.scopes.includes("transport_plans.manage");
    const canApprove = baseAuthority && context.scopes.includes("transport_plans.approve");
    const canOverride = canApprove && context.scopes.includes("transport_plans.override");
    let snapshot = null;
    let recentAal2 = false;
    let loadError = invalidFilters;
    if (!loadError) {
      try {
        [snapshot, recentAal2] = await Promise.all([
          loadTransportPlanSnapshot(context, filters),
          canManage || canApprove || canOverride ? hasRecentAal2() : Promise.resolve(false),
        ]);
      } catch (error) {
        if (!(error instanceof TransportPlanSnapshotError)) throw error;
        loadError = true;
      }
    }
    return <><TransportPlansWorkspace canApprove={canApprove} canManage={canManage}
      canOverride={canOverride} currentUserId={context.userId} filters={filters}
      hasRecentAal2={recentAal2} loadError={loadError} page={page}
      snapshot={snapshot} /><Suspense fallback={<DailyExpectedClientsLoading />}><DailyExpectedClients context={context} serviceDate={filters.serviceDate} mode="transport" /></Suspense></>;
  }

  if (page.number === 48) {
    const parameters = new URLSearchParams();
    for (const [key, value] of Object.entries(query)) {
      if (Array.isArray(value)) value.forEach((item) => parameters.append(key, item));
      else if (typeof value === "string") parameters.append(key, value);
    }
    const fallbackDate = parseServiceDate(undefined);
    let filters = parseTransportExecutionFilters(new URLSearchParams(), fallbackDate);
    let invalidFilters = false;
    try {
      filters = parseTransportExecutionFilters(parameters, fallbackDate);
    } catch {
      invalidFilters = true;
    }
    const baseAuthority = !context.demo && context.assuranceLevel === "aal2" &&
      ["clients.read", "transport_execution.read"].every((scope) =>
        context.scopes.includes(scope));
    const canRecord = baseAuthority && context.scopes.includes("transport_execution.record");
    const canRecordException = baseAuthority &&
      context.scopes.includes("transport_execution.exception");
    const canComplete = baseAuthority && context.scopes.includes("transport_execution.complete");
    const canManageAny = baseAuthority && context.scopes.includes("transport_execution.manage_any");
    let snapshot = null;
    let recentAal2 = false;
    let loadError = invalidFilters;
    if (!loadError) {
      try {
        [snapshot, recentAal2] = await Promise.all([
          loadTransportExecutionSnapshot(context, filters),
          canRecordException || canComplete ? hasRecentAal2() : Promise.resolve(false),
        ]);
      } catch (error) {
        if (!(error instanceof TransportExecutionSnapshotError)) throw error;
        loadError = true;
      }
    }
    return <TransportExecutionWorkspace canComplete={canComplete}
      canManageAny={canManageAny} canRecord={canRecord}
      canRecordException={canRecordException} currentUserId={context.userId}
      filters={filters} hasRecentAal2={recentAal2} loadError={loadError}
      page={page} snapshot={snapshot} />;
  }

  if (page.number === 56) {
    const parameters = new URLSearchParams();
    for (const [key, value] of Object.entries(query)) {
      if (Array.isArray(value)) value.forEach((item) => parameters.append(key, item));
      else if (typeof value === "string") parameters.append(key, value);
    }
    let filters = parseFeedbackComplaintFilters(new URLSearchParams());
    let invalidFilters = false;
    try {
      filters = parseFeedbackComplaintFilters(parameters);
    } catch {
      invalidFilters = true;
    }
    const baseAuthority = !context.demo && context.assuranceLevel === "aal2" &&
      context.scopes.includes("complaints.read");
    const canManage = baseAuthority && context.scopes.includes("complaints.manage");
    const canCorrect = canManage && context.scopes.includes("complaints.sensitive");
    const canClose = baseAuthority && context.scopes.includes("complaints.close");
    let snapshot = null;
    let recentAal2 = false;
    let loadError = invalidFilters;
    if (!loadError) {
      try {
        [snapshot, recentAal2] = await Promise.all([
          loadFeedbackComplaintSnapshot(context, filters),
          canCorrect || canClose ? hasRecentAal2() : Promise.resolve(false),
        ]);
      } catch (error) {
        if (!(error instanceof FeedbackComplaintSnapshotError)) throw error;
        loadError = true;
      }
    }
    return <FeedbackComplaintsWorkspace canClose={canClose}
      canCorrect={canCorrect} canManage={canManage} filters={filters}
      hasRecentAal2={recentAal2} loadError={loadError} page={page}
      snapshot={snapshot} />;
  }

  if (page.number === 57) {
    const parameters = new URLSearchParams();
    for (const [key, value] of Object.entries(query)) {
      if (Array.isArray(value)) value.forEach((item) => parameters.append(key, item));
      else if (typeof value === "string") parameters.append(key, value);
    }
    const fallbackDate = parseServiceDate(undefined);
    let filters = parseMealManagementFilters(new URLSearchParams(), fallbackDate);
    let invalidFilters = false;
    try {
      filters = parseMealManagementFilters(parameters, fallbackDate);
    } catch {
      invalidFilters = true;
    }
    const baseScopes = ["clients.read", "attendance.read", "health.read", "meals.read"];
    const baseAuthority = !context.demo && baseScopes.every((scope) =>
      context.scopes.includes(scope));
    const canManage = baseAuthority && context.scopes.includes("meals.manage");
    const canConfirm = baseAuthority && context.scopes.includes("meals.confirm");
    let snapshot = null;
    let recentAal2 = false;
    let loadError = invalidFilters;
    if (!loadError) {
      try {
        [snapshot, recentAal2] = await Promise.all([
          loadMealManagementSnapshot(context, filters),
          canManage || canConfirm ? hasRecentAal2() : Promise.resolve(false),
        ]);
      } catch (error) {
        if (!(error instanceof MealManagementSnapshotError)) throw error;
        loadError = true;
      }
    }
    return <MealManagementWorkspace canConfirm={canConfirm}
      canManage={canManage} filters={filters} hasRecentAal2={recentAal2}
      loadError={loadError} page={page} snapshot={snapshot} />;
  }

  if (page.number === 58) {
    const requestedStatus = typeof query.status === "string" ? query.status : "all";
    const status: OrganizationProfileStatusFilter =
      ORGANIZATION_PROFILE_STATUS_FILTERS.includes(
        requestedStatus as OrganizationProfileStatusFilter,
      ) ? requestedStatus as OrganizationProfileStatusFilter : "all";
    const requestedEffectiveOn = typeof query.effectiveOn === "string"
      ? query.effectiveOn : "";
    const effectiveOn = requestedEffectiveOn &&
      isOrganizationProfileDate(requestedEffectiveOn) ? requestedEffectiveOn : null;
    const requestedQuery = typeof query.q === "string" ? query.q : "";
    const cleanQuery = requestedQuery.length <= 120 &&
      !/[\u0000-\u001f\u007f]/u.test(requestedQuery) ? requestedQuery.trim() : "";
    const filters: OrganizationProfileFilters = { status, effectiveOn, query: cleanQuery };
    const invalidFilters = !ORGANIZATION_PROFILE_STATUS_FILTERS.includes(
      requestedStatus as OrganizationProfileStatusFilter,
    ) || (requestedEffectiveOn !== "" && effectiveOn === null) ||
      requestedQuery.length > 120 || /[\u0000-\u001f\u007f]/u.test(requestedQuery);
    const fieldScopes = ["organization_profile.permit.manage",
      "organization_profile.services.manage", "organization_profile.rates.manage",
      "organization_profile.capacity.manage", "organization_profile.contact.manage"];
    const canManage = !context.demo && context.assuranceLevel === "aal2" &&
      context.scopes.includes("organization_profile.read") &&
      context.scopes.includes("organization_profile.manage") &&
      fieldScopes.every((scope) => context.scopes.includes(scope));
    const canApprove = !context.demo && context.assuranceLevel === "aal2" &&
      context.scopes.includes("organization_profile.read") &&
      context.scopes.includes("organization_profile.approve") &&
      fieldScopes.every((scope) => context.scopes.includes(scope));
    let snapshot = null;
    let recentAal2 = false;
    let loadError = invalidFilters;
    if (!loadError) {
      try {
        [snapshot, recentAal2] = await Promise.all([
          loadOrganizationProfileSnapshot(context, filters),
          canManage || canApprove ? hasRecentAal2() : Promise.resolve(false),
        ]);
      } catch (error) {
        if (!(error instanceof OrganizationProfileSnapshotError)) throw error;
        loadError = true;
      }
    }
    const openingReadiness = !invalidFilters && canViewOpeningReadiness(context)
      ? await loadOpeningReadinessSnapshot(context, effectiveOn ?? parseServiceDate(undefined)) : null;
    return <OrganizationProfileWorkspace canApprove={canApprove}
      openingReadiness={openingReadiness ? <div id="opening-readiness"><OpeningReadinessWorkspace snapshot={openingReadiness} /></div> : undefined}
      canManage={canManage} currentUserId={context.userId} filters={filters}
      hasRecentAal2={recentAal2} loadError={loadError} page={page}
      snapshot={snapshot} />;
  }

  if (page.number === 59) {
    const { filters, invalid: invalidFilters } = parseStaffManagementFilters(query);
    const hasScopes = (...required: string[]) =>
      required.every((scope) => context.scopes.includes(scope));
    const actionBase = !context.demo && context.assuranceLevel === "aal2" &&
      hasScopes("staff_management.read", "staff_management.manage",
        "staff_management.identity.read");
    const canManageEmployment = actionBase && hasScopes(
      "staff_management.employment.read", "staff_management.employment.manage");
    const canApproveEmployment = canManageEmployment &&
      hasScopes("staff_management.approve");
    const canTerminate = actionBase && hasScopes(
      "staff_management.employment.read", "staff_management.termination.manage");
    const canApproveTermination = canTerminate && hasScopes("staff_management.approve");
    const canManageRoles = actionBase && hasScopes(
      "staff_management.roles.read", "staff_management.roles.manage", "roles.manage");
    const canApproveRoles = canManageRoles && hasScopes("staff_management.approve");
    const hasAnyAction = canManageEmployment || canApproveEmployment || canTerminate ||
      canApproveTermination || canManageRoles || canApproveRoles;
    let snapshot = null;
    let loadError = invalidFilters;
    let recentAal2 = false;
    if (!loadError) {
      try {
        [snapshot, recentAal2] = await Promise.all([
          loadStaffManagementSnapshot(context, filters),
          hasAnyAction ? hasRecentAal2() : Promise.resolve(false),
        ]);
      } catch (error) {
        if (!(error instanceof StaffManagementSnapshotError)) throw error;
        loadError = true;
      }
    }
    return <StaffManagementWorkspace
      canApproveEmployment={canApproveEmployment}
      canApproveRoles={canApproveRoles}
      canApproveTermination={canApproveTermination}
      canManageEmployment={canManageEmployment}
      canManageRoles={canManageRoles}
      canTerminate={canTerminate}
      currentUserId={context.userId}
      filters={filters}
      hasRecentAal2={recentAal2}
      loadError={loadError}
      page={page}
      snapshot={snapshot}
    />;
  }

  if (page.number === 60) {
    const requestedStatus =
      typeof query.status === "string" ? query.status : "all";
    const status: ClientMasterStatusFilter =
      requestedStatus === "pending_admission" ||
      (requestedStatus !== "all" &&
        CLIENT_LIFECYCLE_STATUSES.includes(
          requestedStatus as ClientLifecycleStatus,
        ))
        ? (requestedStatus as ClientMasterStatusFilter)
        : "all";
    const requestedSource =
      typeof query.source === "string" ? query.source : "all";
    const source: ClientMasterSourceFilter = ["all", "central", "local"].includes(
      requestedSource,
    )
      ? (requestedSource as ClientMasterSourceFilter)
      : "all";
    const searchQuery =
      typeof query.q === "string" ? query.q.slice(0, 120) : "";
    const interaction =
      searchQuery.trim() || status !== "all" || source !== "all"
        ? "search"
        : "view";
    let snapshot = null;
    let recentAal2 = false;
    let loadError = false;
    const canManage =
      !context.demo &&
      hasClientMasterWriteAuthority(context.scopes, "update");
    const canCreate =
      !context.demo &&
      hasClientMasterWriteAuthority(context.scopes, "create");
    try {
      [snapshot, recentAal2] = await Promise.all([
        loadClientMasterSnapshot(context, interaction),
        canManage ? hasRecentAal2() : Promise.resolve(false),
      ]);
    } catch (error) {
      if (!(error instanceof ClientMasterSnapshotError)) throw error;
      loadError = true;
    }
    return (
      <ClientMasterWorkspace
        canCreate={canCreate}
        canManage={canManage}
        hasRecentAal2={recentAal2}
        loadError={loadError}
        page={page}
        query={searchQuery}
        snapshot={snapshot}
        source={source}
        status={status}
      />
    );
  }

  if (page.number === 24) {
    const validDate = (value: unknown) => {
      if (typeof value !== "string") return null;
      return parseServiceDate(value, new Date("2000-01-01T00:00:00Z")) === value
        ? value
        : null;
    };
    const dateFrom = validDate(query.from);
    const dateTo = validDate(query.to);
    const invalidRange = dateFrom !== null && dateTo !== null && dateFrom > dateTo;
    const requestedStatus = typeof query.status === "string" ? query.status : "all";
    const handlingStatus: FallHandlingStatusFilter = [
      "all", "reported", "in_progress", "closed",
    ].includes(requestedStatus)
      ? requestedStatus as FallHandlingStatusFilter
      : "all";
    const requestedInjury = typeof query.injury === "string" ? query.injury.trim() : "";
    const requestedClient = typeof query.client === "string" ? query.client : "";
    const clientId = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(requestedClient)
      ? requestedClient.toLowerCase()
      : null;
    const filters: FallEventFilters = {
      dateFrom,
      dateTo,
      injuryDegree: requestedInjury && requestedInjury.length <= 240
        ? requestedInjury
        : null,
      handlingStatus,
      clientId,
    };
    const canManage = !context.demo &&
      context.scopes.includes("clients.read") &&
      context.scopes.includes("quality_events.manage");
    const canClose = !context.demo &&
      context.scopes.includes("clients.read") &&
      context.scopes.includes("quality_events.close");
    let snapshot = null;
    let recentAal2 = false;
    let loadError = invalidRange;
    if (!invalidRange) {
      try {
        [snapshot, recentAal2] = await Promise.all([
          loadFallEventSnapshot(context, filters),
          canClose ? hasRecentAal2() : Promise.resolve(false),
        ]);
      } catch (error) {
        if (!(error instanceof FallEventSnapshotError)) throw error;
        loadError = true;
      }
    }
    return (
      <FallEventsWorkspace
        canClose={canClose}
        canManage={canManage}
        filters={filters}
        hasRecentAal2={recentAal2}
        loadError={loadError}
        page={page}
        snapshot={snapshot}
      />
    );
  }

  if (page.number === 25) {
    const validDate = (value: unknown) => {
      if (typeof value !== "string") return null;
      return parseServiceDate(value, new Date("2000-01-01T00:00:00Z")) === value ? value : null;
    };
    const dateFrom = validDate(query.from);
    const dateTo = validDate(query.to);
    const invalidRange = dateFrom !== null && dateTo !== null && dateFrom > dateTo;
    const requestedStatus = typeof query.status === "string" ? query.status : "all";
    const handlingStatus: InfectionHandlingStatusFilter = ["all", "reported", "in_progress", "closed"].includes(requestedStatus)
      ? requestedStatus as InfectionHandlingStatusFilter : "all";
    const requestedType = typeof query.infection === "string" ? query.infection.trim() : "";
    const requestedClient = typeof query.client === "string" ? query.client : "";
    const requestedCluster = typeof query.cluster === "string" ? query.cluster : "";
    const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
    const clientId = uuidPattern.test(requestedClient) ? requestedClient.toLowerCase() : null;
    const clusterId = uuidPattern.test(requestedCluster) ? requestedCluster.toLowerCase() : null;
    const clusterMode: InfectionClusterMode = requestedCluster === "__unlinked__" ? "unlinked"
      : requestedCluster === "__linked__" || clusterId ? "linked" : "all";
    const filters: InfectionEventFilters = {
      dateFrom, dateTo, infectionType: requestedType && requestedType.length <= 240 ? requestedType : null,
      handlingStatus, clientId, clusterMode, clusterId,
    };
    const canManage = !context.demo && context.scopes.includes("clients.read") && context.scopes.includes("quality_events.manage");
    const canClose = !context.demo && context.scopes.includes("clients.read") && context.scopes.includes("quality_events.close");
    let snapshot = null;
    let recentAal2 = false;
    let loadError = invalidRange;
    if (!invalidRange) {
      try {
        [snapshot, recentAal2] = await Promise.all([
          loadInfectionEventSnapshot(context, filters),
          canClose ? hasRecentAal2() : Promise.resolve(false),
        ]);
      } catch (error) {
        if (!(error instanceof InfectionEventSnapshotError)) throw error;
        loadError = true;
      }
    }
    return <InfectionEventsWorkspace canClose={canClose} canManage={canManage} filters={filters}
      hasRecentAal2={recentAal2} loadError={loadError} page={page} snapshot={snapshot} />;
  }

  if (page.number === 26) {
    const currentMonth = taipeiPlanMonth();
    const requestedMonth = typeof query.month === "string" ? query.month : currentMonth;
    const selectedMonth = isPlanMonth(requestedMonth) && requestedMonth <= currentMonth
      ? requestedMonth
      : currentMonth;
    const requestedClient = typeof query.client === "string" ? query.client : "";
    const clientId = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(requestedClient)
      ? requestedClient.toLowerCase()
      : null;
    const requestedDirection = typeof query.direction === "string" ? query.direction : "all";
    const changeDirection = WEIGHT_CHANGE_DIRECTIONS.includes(requestedDirection as WeightChangeDirectionFilter)
      ? requestedDirection as WeightChangeDirectionFilter
      : "all";
    const requestedAlert = typeof query.alert === "string" ? query.alert : "all";
    const alertStatus = WEIGHT_ALERT_FILTERS.includes(requestedAlert as WeightAlertFilter)
      ? requestedAlert as WeightAlertFilter
      : "all";
    const filters: WeightManagementFilters = {
      targetMonth: `${selectedMonth}-01`, clientId, changeDirection, alertStatus,
    };
    const canManage = !context.demo && context.scopes.includes("clients.read") && context.scopes.includes("quality_events.manage");
    let snapshot = null;
    let recentAal2 = false;
    let loadError = false;
    try {
      [snapshot, recentAal2] = await Promise.all([
        loadWeightManagementSnapshot(context, filters),
        canManage ? hasRecentAal2() : Promise.resolve(false),
      ]);
    } catch (error) {
      if (!(error instanceof WeightManagementSnapshotError)) throw error;
      loadError = true;
    }
    return <WeightManagementWorkspace canManage={canManage} currentMonth={currentMonth} filters={filters} hasRecentAal2={recentAal2} loadError={loadError} page={page} snapshot={snapshot} />;
  }

  if (page.number === 27) {
    const validDate = (value: unknown) => {
      if (typeof value !== "string") return null;
      return parseServiceDate(value, new Date("2000-01-01T00:00:00Z")) === value
        ? value
        : null;
    };
    const dateFrom = validDate(query.from);
    const dateTo = validDate(query.to);
    const invalidRange = dateFrom !== null && dateTo !== null && dateFrom > dateTo;
    const requestedStatus = typeof query.status === "string" ? query.status : "all";
    const handlingStatus: AbnormalHandlingStatusFilter = [
      "all", "reported", "in_progress", "closed",
    ].includes(requestedStatus)
      ? requestedStatus as AbnormalHandlingStatusFilter
      : "all";
    const requestedAffected = typeof query.affected === "string" ? query.affected : "all";
    const affectedTargetKind: AbnormalAffectedTargetFilter = [
      "all", "client", "staff", "visitor", "facility", "other",
    ].includes(requestedAffected)
      ? requestedAffected as AbnormalAffectedTargetFilter
      : "all";
    const requestedType = typeof query.type === "string" ? query.type.trim() : "";
    const filters: AbnormalEventFilters = {
      dateFrom,
      dateTo,
      eventType: requestedType && requestedType.length <= 240 ? requestedType : null,
      affectedTargetKind,
      handlingStatus,
    };
    const canManage = !context.demo && context.scopes.includes("clients.read") &&
      context.scopes.includes("quality_events.manage");
    const canClose = !context.demo && context.scopes.includes("clients.read") &&
      context.scopes.includes("quality_events.close");
    let snapshot = null;
    let recentAal2 = false;
    let loadError = invalidRange;
    if (!invalidRange) {
      try {
        [snapshot, recentAal2] = await Promise.all([
          loadAbnormalEventSnapshot(context, filters),
          canClose ? hasRecentAal2() : Promise.resolve(false),
        ]);
      } catch (error) {
        if (!(error instanceof AbnormalEventSnapshotError)) throw error;
        loadError = true;
      }
    }
    return <AbnormalEventsWorkspace canClose={canClose} canManage={canManage}
      filters={filters} hasRecentAal2={recentAal2} loadError={loadError}
      page={page} snapshot={snapshot} />;
  }

  if (page.number === 28) {
    const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
    const requestedClient = typeof query.client === "string" ? query.client : "";
    const requestedResponsible = typeof query.responsible === "string"
      ? query.responsible
      : "";
    const requestedService = typeof query.service === "string" ? query.service : "";
    const serviceStatus = PSYCHOSOCIAL_CLIENT_SERVICE_STATUSES.includes(
      requestedService as PsychosocialClientServiceStatus,
    )
      ? requestedService as PsychosocialClientServiceStatus
      : null;
    const requestedDue = typeof query.due === "string" ? query.due : "all";
    const dueStatus: PsychosocialAssessmentFilters["dueStatus"] = [
      "all", "due", "upcoming", "not_assessed",
    ].includes(requestedDue)
      ? requestedDue as PsychosocialAssessmentFilters["dueStatus"]
      : "all";
    const filters: PsychosocialAssessmentFilters = {
      clientId: uuidPattern.test(requestedClient)
        ? requestedClient.toLowerCase()
        : null,
      responsibleUserId: uuidPattern.test(requestedResponsible)
        ? requestedResponsible.toLowerCase()
        : null,
      serviceStatus,
      dueStatus,
    };
    const canManage = !context.demo && context.scopes.includes("clients.read") &&
      context.scopes.includes("social_work_records.read") &&
      context.scopes.includes("social_work_records.manage");
    const canSign = !context.demo && context.scopes.includes("clients.read") &&
      context.scopes.includes("social_work_records.read") &&
      context.scopes.includes("social_work_records.sign");
    let snapshot = null;
    let recentAal2 = false;
    let loadError = false;
    try {
      [snapshot, recentAal2] = await Promise.all([
        loadPsychosocialAssessmentSnapshot(context, filters),
        canSign ? hasRecentAal2() : Promise.resolve(false),
      ]);
    } catch (error) {
      if (!(error instanceof PsychosocialAssessmentSnapshotError)) throw error;
      loadError = true;
    }
    return <PsychosocialAssessmentsWorkspace
      canManage={canManage}
      canSign={canSign}
      filters={filters}
      hasRecentAal2={recentAal2}
      loadError={loadError}
      page={page}
      snapshot={snapshot}
    />;
  }

  if (page.number === 29) {
    const validDate = (value: unknown) => {
      if (typeof value !== "string") return null;
      return parseServiceDate(value, new Date("2000-01-01T00:00:00Z")) === value
        ? value : null;
    };
    const dateFrom = validDate(query.from);
    const dateTo = validDate(query.to);
    const invalidRange = dateFrom !== null && dateTo !== null && dateFrom > dateTo;
    const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
    const requestedClient = typeof query.client === "string" ? query.client : "";
    const requestedAuthor = typeof query.author === "string" ? query.author : "";
    const requestedType = typeof query.type === "string" ? query.type.trim() : "";
    const filters: SocialWorkRecordFilters = {
      dateFrom,
      dateTo,
      clientId: uuidPattern.test(requestedClient) ? requestedClient.toLowerCase() : null,
      authorUserId: uuidPattern.test(requestedAuthor) ? requestedAuthor.toLowerCase() : null,
      serviceType: requestedType.length > 0 && requestedType.length <= 120 &&
        !/[\u0000-\u001f\u007f]/u.test(requestedType) ? requestedType : null,
    };
    const canManage = !context.demo && context.scopes.includes("clients.read") &&
      context.scopes.includes("social_work_records.read") &&
      context.scopes.includes("social_work_records.manage");
    const canSign = !context.demo && context.scopes.includes("clients.read") &&
      context.scopes.includes("social_work_records.read") &&
      context.scopes.includes("social_work_records.sign");
    let snapshot = null;
    let recentAal2 = false;
    let loadError = invalidRange;
    if (!invalidRange) {
      try {
        [snapshot, recentAal2] = await Promise.all([
          loadSocialWorkRecordSnapshot(context, filters),
          canSign ? hasRecentAal2() : Promise.resolve(false),
        ]);
      } catch (error) {
        if (!(error instanceof SocialWorkRecordSnapshotError)) throw error;
        loadError = true;
      }
    }
    return <SocialWorkRecordsWorkspace canManage={canManage} canSign={canSign}
      filters={filters} hasRecentAal2={recentAal2} loadError={loadError}
      page={page} snapshot={snapshot} />;
  }

  if (page.number === 30) {
    const validDate = (value: unknown) => {
      if (typeof value !== "string") return null;
      return parseServiceDate(value, new Date("2000-01-01T00:00:00Z")) === value ? value : null;
    };
    const dateFrom = validDate(query.from);
    const dateTo = validDate(query.to);
    const invalidRange = dateFrom !== null && dateTo !== null && dateFrom > dateTo;
    const requestedStatus = typeof query.status === "string" ? query.status : "all";
    const status: ActivityStatusFilter = requestedStatus === "all" || ACTIVITY_STATUSES.includes(requestedStatus as (typeof ACTIVITY_STATUSES)[number])
      ? requestedStatus as ActivityStatusFilter : "all";
    const requestedType = typeof query.type === "string" ? query.type.trim() : "";
    const requestedClient = typeof query.client === "string" ? query.client : "";
    const quickClientId = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(requestedClient)
      ? requestedClient.toLowerCase() : null;
    const filters: ActivityFilters = {
      dateFrom, dateTo, activityType: requestedType && requestedType !== "all" && requestedType.length <= 120 ? requestedType : null,
      status, query: typeof query.q === "string" ? query.q.slice(0, 120) : "", quickClientId,
    };
    const canManage = !context.demo && context.scopes.includes("clients.read") && context.scopes.includes("activity.manage");
    const canCancel = canManage && context.scopes.includes("activity.cancel");
    let snapshot = null;
    let recentAal2 = false;
    let loadError = invalidRange;
    if (!invalidRange) {
      try {
        [snapshot, recentAal2] = await Promise.all([
          loadActivityManagementSnapshot(context, filters),
          canCancel ? hasRecentAal2() : Promise.resolve(false),
        ]);
      } catch (error) {
        if (!(error instanceof ActivitySnapshotError)) throw error;
        loadError = true;
      }
    }
    return <ActivityManagementWorkspace canCancel={canCancel} canManage={canManage}
      filters={filters} hasRecentAal2={recentAal2} loadError={loadError}
      page={page} snapshot={snapshot} />;
  }

  if (page.number === 31) {
    const requestedYear = typeof query.year === "string" ? query.year : "";
    const referenceYear = /^\d{4}$/u.test(requestedYear) &&
      Number(requestedYear) >= 2000 && Number(requestedYear) <= 2200
      ? Number(requestedYear)
      : null;
    const requestedStatus = typeof query.status === "string" ? query.status : "all";
    const status: SocialResourceStatusFilter = ["all", "active", "inactive"].includes(
      requestedStatus,
    ) ? requestedStatus as SocialResourceStatusFilter : "all";
    const requestedType = typeof query.type === "string" ? query.type.trim() : "";
    const requestedAudience = typeof query.audience === "string"
      ? query.audience.trim()
      : "";
    const filters: SocialResourceFilters = {
      referenceYear,
      resourceType: requestedType && requestedType.length <= 80 ? requestedType : null,
      status,
      audience:
        requestedAudience && requestedAudience.length <= 500
          ? requestedAudience
          : null,
      query: typeof query.q === "string" ? query.q.slice(0, 120) : "",
    };
    let snapshot = null;
    let loadError = false;
    try {
      snapshot = await loadSocialResourceSnapshot(context, filters);
    } catch (error) {
      if (!(error instanceof SocialResourceSnapshotError)) throw error;
      loadError = true;
    }
    return (
      <SocialResourcesWorkspace
        canManage={
          !context.demo && context.scopes.includes("social_resources.manage")
        }
        filters={filters}
        loadError={loadError}
        page={page}
        snapshot={snapshot}
      />
    );
  }

  if (page.number === 32) {
    const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
    const requestedClient = typeof query.client === "string" ? query.client : "";
    const requestedService = typeof query.service === "string" ? query.service : "";
    const serviceStatus = CLIENT_SERVICE_STATUSES.includes(
      requestedService as ClientServiceStatus,
    ) ? requestedService as ClientServiceStatus : null;
    const requestedPresence = typeof query.assessment === "string"
      ? query.assessment : "all";
    const assessmentPresence: AdaptationAssessmentFilters["assessmentPresence"] = [
      "all", "assessed", "not_assessed",
    ].includes(requestedPresence)
      ? requestedPresence as AdaptationAssessmentFilters["assessmentPresence"] : "all";
    const requestedReassessment = typeof query.reassessment === "string"
      ? query.reassessment : "all";
    const reassessmentStatus: AdaptationAssessmentFilters["reassessmentStatus"] = [
      "all", "due", "upcoming",
    ].includes(requestedReassessment)
      ? requestedReassessment as AdaptationAssessmentFilters["reassessmentStatus"] : "all";
    const requestedAdaptation = typeof query.adaptation === "string"
      ? query.adaptation : "";
    const adaptationStatus = ADAPTATION_STATUSES.includes(
      requestedAdaptation as AdaptationStatus,
    ) ? requestedAdaptation as AdaptationStatus : null;
    const requestedFollowUp = typeof query.follow === "string" ? query.follow : "all";
    const followUpFilter: AdaptationAssessmentFilters["followUpFilter"] = [
      "all", "needs_follow_up", "no_follow_up", "open", "overdue",
    ].includes(requestedFollowUp)
      ? requestedFollowUp as AdaptationAssessmentFilters["followUpFilter"] : "all";
    const filters: AdaptationAssessmentFilters = {
      clientId: uuidPattern.test(requestedClient)
        ? requestedClient.toLowerCase() : null,
      serviceStatus,
      assessmentPresence,
      reassessmentStatus,
      adaptationStatus,
      followUpFilter,
    };
    const canManage = !context.demo && context.scopes.includes("clients.read") &&
      context.scopes.includes("social_work_records.read") &&
      context.scopes.includes("social_work_records.manage");
    const canSign = !context.demo && context.scopes.includes("clients.read") &&
      context.scopes.includes("social_work_records.read") &&
      context.scopes.includes("social_work_records.sign");
    let snapshot = null;
    let recentAal2 = false;
    let loadError = false;
    try {
      [snapshot, recentAal2] = await Promise.all([
        loadAdaptationAssessmentSnapshot(context, filters),
        canSign ? hasRecentAal2() : Promise.resolve(false),
      ]);
    } catch (error) {
      if (!(error instanceof AdaptationAssessmentSnapshotError)) throw error;
      loadError = true;
    }
    return <AdaptationAssessmentsWorkspace canManage={canManage} canSign={canSign}
      filters={filters} hasRecentAal2={recentAal2} loadError={loadError}
      page={page} snapshot={snapshot} />;
  }

  if (page.number === 33) {
    const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
    const requestedClient = typeof query.client === "string" ? query.client : "";
    const requestedTherapist = typeof query.therapist === "string"
      ? query.therapist : "";
    const requestedService = typeof query.service === "string" ? query.service : "";
    const serviceStatus = OCCUPATIONAL_THERAPY_CLIENT_SERVICE_STATUSES.includes(
      requestedService as OccupationalTherapyClientServiceStatus,
    ) ? requestedService as OccupationalTherapyClientServiceStatus : null;
    const requestedDue = typeof query.due === "string" ? query.due : "all";
    const dueStatus: OccupationalTherapyAssessmentFilters["dueStatus"] = [
      "all", "due", "upcoming", "not_assessed",
    ].includes(requestedDue)
      ? requestedDue as OccupationalTherapyAssessmentFilters["dueStatus"] : "all";
    const filters: OccupationalTherapyAssessmentFilters = {
      clientId: uuidPattern.test(requestedClient)
        ? requestedClient.toLowerCase() : null,
      therapistUserId: uuidPattern.test(requestedTherapist)
        ? requestedTherapist.toLowerCase() : null,
      serviceStatus,
      dueStatus,
    };
    const isProfessional = context.roles.includes("professional");
    const canManage = !context.demo && isProfessional &&
      context.scopes.includes("clients.read") &&
      context.scopes.includes("occupational_therapy_assessments.read") &&
      context.scopes.includes("occupational_therapy_assessments.manage");
    const canSign = !context.demo && isProfessional &&
      context.scopes.includes("clients.read") &&
      context.scopes.includes("occupational_therapy_assessments.read") &&
      context.scopes.includes("occupational_therapy_assessments.sign");
    let snapshot = null;
    let recentAal2 = false;
    let loadError = false;
    try {
      [snapshot, recentAal2] = await Promise.all([
        loadOccupationalTherapyAssessmentSnapshot(context, filters),
        canSign ? hasRecentAal2() : Promise.resolve(false),
      ]);
    } catch (error) {
      if (!(error instanceof OccupationalTherapyAssessmentSnapshotError)) throw error;
      loadError = true;
    }
    return <OccupationalTherapyAssessmentsWorkspace
      canManage={canManage}
      canSign={canSign}
      filters={filters}
      hasRecentAal2={recentAal2}
      loadError={loadError}
      page={page}
      snapshot={snapshot}
    />;
  }

  if (page.number === 34) {
    const { filters, invalid: invalidFilters } =
      parsePhysicalTherapyAssessmentFilters(query);
    const isProfessional = context.roles.includes("professional");
    const canManage = !context.demo && isProfessional &&
      context.scopes.includes("clients.read") &&
      context.scopes.includes("physical_therapy_assessments.read") &&
      context.scopes.includes("physical_therapy_assessments.manage");
    const canSign = !context.demo && isProfessional &&
      context.scopes.includes("clients.read") &&
      context.scopes.includes("physical_therapy_assessments.read") &&
      context.scopes.includes("physical_therapy_assessments.sign");
    let snapshot = null;
    let recentAal2 = false;
    let loadError = invalidFilters;
    if (!invalidFilters) {
      try {
        [snapshot, recentAal2] = await Promise.all([
          loadPhysicalTherapyAssessmentSnapshot(context, filters),
          canManage || canSign ? hasRecentAal2() : Promise.resolve(false),
        ]);
      } catch (error) {
        if (!(error instanceof PhysicalTherapyAssessmentSnapshotError)) throw error;
        loadError = true;
      }
    }
    return <PhysicalTherapyAssessmentsWorkspace
      canManage={canManage}
      canSign={canSign}
      filters={filters}
      hasRecentAal2={recentAal2}
      loadError={loadError}
      page={page}
      snapshot={snapshot}
    />;
  }

  if (page.number === 40) {
    let filters: PhysicalTherapyServiceFilters = {
      dateFrom: null,
      dateTo: null,
      clientId: null,
      therapistUserId: null,
      recordState: null,
      keyword: null,
    };
    let invalidFilters = false;
    try {
      filters = parsePhysicalTherapyServiceQuery(query);
    } catch {
      invalidFilters = true;
    }
    const isProfessional = context.roles.includes("professional");
    const canManage = !context.demo && isProfessional &&
      context.scopes.includes("clients.read") &&
      context.scopes.includes("physical_therapy_services.read") &&
      context.scopes.includes("physical_therapy_services.manage");
    const canSign = !context.demo && isProfessional &&
      context.scopes.includes("clients.read") &&
      context.scopes.includes("physical_therapy_services.read") &&
      context.scopes.includes("physical_therapy_services.sign");
    let snapshot = null;
    let recentAal2 = false;
    let loadError = invalidFilters;
    if (!invalidFilters) {
      try {
        [snapshot, recentAal2] = await Promise.all([
          loadPhysicalTherapyServiceSnapshot(context, filters),
          canSign ? hasRecentAal2() : Promise.resolve(false),
        ]);
      } catch (error) {
        if (!(error instanceof PhysicalTherapyServiceSnapshotError)) throw error;
        loadError = true;
      }
    }
    return <PhysicalTherapyServicesWorkspace
      canManage={canManage}
      canSign={canSign}
      filters={filters}
      hasRecentAal2={recentAal2}
      loadError={loadError}
      page={page}
      snapshot={snapshot}
    />;
  }

  if (page.number === 41) {
    let filters: OccupationalTherapyServiceFilters = {
      dateFrom: null,
      dateTo: null,
      clientId: null,
      therapistUserId: null,
      recordState: null,
      keyword: null,
    };
    let invalidFilters = false;
    try {
      filters = parseOccupationalTherapyServiceQuery(query);
    } catch {
      invalidFilters = true;
    }
    const isProfessional = context.roles.includes("professional");
    const canManage = !context.demo && isProfessional &&
      context.scopes.includes("clients.read") &&
      context.scopes.includes("occupational_therapy_services.read") &&
      context.scopes.includes("occupational_therapy_services.manage");
    const canSign = !context.demo && isProfessional &&
      context.scopes.includes("clients.read") &&
      context.scopes.includes("occupational_therapy_services.read") &&
      context.scopes.includes("occupational_therapy_services.sign");
    let snapshot = null;
    let recentAal2 = false;
    let loadError = invalidFilters;
    if (!invalidFilters) {
      try {
        [snapshot, recentAal2] = await Promise.all([
          loadOccupationalTherapyServiceSnapshot(context, filters),
          canSign ? hasRecentAal2() : Promise.resolve(false),
        ]);
      } catch (error) {
        if (!(error instanceof OccupationalTherapyServiceSnapshotError)) throw error;
        loadError = true;
      }
    }
    return <OccupationalTherapyServicesWorkspace
      canManage={canManage}
      canSign={canSign}
      filters={filters}
      hasRecentAal2={recentAal2}
      loadError={loadError}
      page={page}
      snapshot={snapshot}
    />;
  }

  if (page.number === 42) {
    const { filters, invalid: invalidFilters } =
      parseProfessionalServiceSummaryQuery(query);
    const canExport = context.demo || (
      context.scopes.includes("clients.read") &&
      context.scopes.includes("professional_service_summary.read") &&
      context.scopes.includes("professional_service_summary.export")
    );
    let snapshot = null;
    let recentAal2 = context.demo;
    let loadError = invalidFilters;
    if (!invalidFilters) {
      try {
        [snapshot, recentAal2] = await Promise.all([
          loadProfessionalServiceSummarySnapshot(context, filters),
          canExport ? hasRecentAal2() : Promise.resolve(false),
        ]);
      } catch (error) {
        if (!(error instanceof ProfessionalServiceSummarySnapshotError)) {
          throw error;
        }
        loadError = true;
      }
    }
    return <ProfessionalServiceSummaryWorkspace
      canExport={canExport}
      filters={filters}
      hasRecentAal2={recentAal2}
      loadError={loadError}
      page={page}
      snapshot={snapshot}
    />;
  }

  if (page.number === 35) {
    const { filters, invalidFilters } = parseChewingAssessmentFilters(query);
    const canManage = !context.demo && context.roles.includes("professional") &&
      context.scopes.includes("clients.read") &&
      context.scopes.includes("chewing_assessments.read") &&
      context.scopes.includes("chewing_assessments.manage");
    let snapshot = null;
    let recentAal2 = false;
    let loadError = invalidFilters;
    if (!invalidFilters) {
      try {
        [snapshot, recentAal2] = await Promise.all([
          loadChewingAssessmentSnapshot(context, filters),
          canManage ? hasRecentAal2() : Promise.resolve(false),
        ]);
      } catch (error) {
        if (!(error instanceof ChewingAssessmentSnapshotError)) throw error;
        loadError = true;
      }
    }
    return <ChewingAssessmentsWorkspace canManage={canManage}
      filters={filters} hasRecentAal2={recentAal2} loadError={loadError}
      page={page} snapshot={snapshot} />;
  }

  if (page.number === 36) {
    const { filters, invalidFilters } = parseMnaAssessmentFilters(query);
    const canManage = !context.demo && context.roles.includes("professional") &&
      context.scopes.includes("clients.read") &&
      context.scopes.includes("mna_assessments.read") &&
      context.scopes.includes("mna_assessments.manage");
    let snapshot = null;
    let recentAal2 = false;
    let loadError = invalidFilters;
    if (!invalidFilters) {
      try {
        [snapshot, recentAal2] = await Promise.all([
          loadMnaAssessmentSnapshot(context, filters),
          canManage ? hasRecentAal2() : Promise.resolve(false),
        ]);
      } catch (error) {
        if (!(error instanceof MnaAssessmentSnapshotError)) throw error;
        loadError = true;
      }
    }
    return <MnaAssessmentsWorkspace canManage={canManage}
      filters={filters} hasRecentAal2={recentAal2} loadError={loadError}
      page={page} snapshot={snapshot} />;
  }

  if (page.number === 61) {
    // Invalid or unavailable deep links must not silently target another client.
    const requestedClientId = typeof query.client === "string" ? query.client.toLowerCase() : query.client ? "invalid" : null;
    const clientId = requestedClientId && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u.test(requestedClientId) ? requestedClientId : requestedClientId ? "invalid" : null;
    const requestedStatus =
      typeof query.status === "string" ? query.status : "all";
    const status: ClientLifecycleStatusFilter =
      requestedStatus === "pending_admission" ||
      (requestedStatus !== "all" &&
        CLIENT_LIFECYCLE_STATUSES.includes(
          requestedStatus as ClientLifecycleStatus,
        ))
        ? (requestedStatus as ClientLifecycleStatusFilter)
        : "all";
    const requestedEvent =
      typeof query.event === "string" ? query.event : "all";
    const eventKind: "all" | ClientTransitionKind =
      requestedEvent !== "all" &&
      CLIENT_TRANSITION_KINDS.includes(requestedEvent as ClientTransitionKind)
        ? (requestedEvent as ClientTransitionKind)
        : "all";
    const requestedDate =
      typeof query.date === "string" ? query.date : undefined;
    const effectiveOn =
      requestedDate &&
      parseServiceDate(requestedDate, new Date("2000-01-01T00:00:00Z")) ===
        requestedDate
        ? requestedDate
        : null;
    const historyPage =
      typeof query.page === "string" && /^\d{1,4}$/u.test(query.page)
        ? Math.min(200, Math.max(1, Number(query.page)))
        : 1;
    const searchQuery =
      typeof query.q === "string" ? query.q.slice(0, 120) : "";
    const canManage =
      !context.demo && context.scopes.includes("clients.manage");
    let snapshot = null;
    let recentAal2 = false;
    let loadError = false;
    try {
      [snapshot, recentAal2] = await Promise.all([
        loadClientLifecycleSnapshot(context, {
          clientId,
          query: searchQuery,
          status,
          eventKind,
          effectiveOn,
          page: historyPage,
        }),
        canManage ? hasRecentAal2() : Promise.resolve(false),
      ]);
    } catch (error) {
      if (!(error instanceof ClientLifecycleSnapshotError)) throw error;
      loadError = true;
    }
    return (
      <ClientLifecycleWorkspace
        key={JSON.stringify([context.organizationId, context.branchId, context.userId, [...context.scopes].sort(), clientId])}
        selectedClientId={clientId}
        canRoutineAdmit={await canUseRoutineCompletion(context, "admission.create", clientId === "all" ? null : clientId)}
        canOpenIntake={context.demo || ["clients.read", "clients.demographics.read"].every((scope) => context.scopes.includes(scope))}
        canManage={canManage}
        effectiveOn={effectiveOn}
        eventKind={eventKind}
        hasRecentAal2={recentAal2}
        loadError={loadError}
        page={page}
        query={searchQuery}
        snapshot={snapshot}
        status={status}
      />
    );
  }

  if (page.number === 62) {
    const { filters, invalid: invalidFilters } =
      parseDocumentPrintingFilters(query);
    const canManage = !context.demo && context.assuranceLevel === "aal2" &&
      ["clients.read", "document_printing.read", "document_printing.manage"]
        .every((scope) => context.scopes.includes(scope));
    const canAccess = !context.demo && context.assuranceLevel === "aal2" &&
      ["clients.read", "document_printing.read", "document_printing.access"]
        .every((scope) => context.scopes.includes(scope));
    let snapshot = null;
    let recentAal2 = context.demo;
    let loadError = invalidFilters;
    if (!loadError) {
      try {
        recentAal2 = canManage || canAccess ? await hasRecentAal2() : false;
        snapshot = await loadDocumentPrintingSnapshot(
          context,
          filters,
          canAccess && recentAal2,
        );
      } catch (error) {
        if (!(error instanceof DocumentPrintingSnapshotError)) throw error;
        loadError = true;
      }
    }
    return <DocumentPrintingWorkspace canManage={canManage}
      filters={filters} hasRecentAal2={recentAal2} loadError={loadError}
      page={page} snapshot={snapshot} />;
  }

  if (page.number === 63) {
    const { filters, invalid: invalidFilters } = parseStaffSchedulingFilters(query);
    const hasScopes = (...required: string[]) =>
      required.every((scope) => context.scopes.includes(scope));
    const baseAuthority = !context.demo && context.assuranceLevel === "aal2" &&
      hasScopes("staff_scheduling.read", "staff_certificates.read");
    const canManage = baseAuthority && hasScopes("staff_scheduling.manage");
    const canApprove = baseAuthority && hasScopes("staff_scheduling.approve");
    const canOverride = canApprove && hasScopes("staff_scheduling.override");
    let snapshot = null;
    let recentAal2 = false;
    let loadError = invalidFilters;
    if (!loadError) {
      try {
        [snapshot, recentAal2] = await Promise.all([
          loadStaffSchedulingSnapshot(context, filters),
          canManage || canApprove || canOverride
            ? hasRecentAal2() : Promise.resolve(false),
        ]);
      } catch (error) {
        if (!(error instanceof StaffSchedulingSnapshotError)) throw error;
        loadError = true;
      }
    }
    return <StaffSchedulingWorkspace canApprove={canApprove}
      canManage={canManage} canOverride={canOverride}
      currentUserId={context.userId} filters={filters}
      hasRecentAal2={recentAal2} loadError={loadError}
      page={page} snapshot={snapshot} />;
  }

  if (page.number === 64) {
    const { filters, invalid: invalidFilters } = parseBillingManagementFilters(query);
    const baseAuthority = !context.demo && context.assuranceLevel === "aal2" &&
      context.scopes.includes("billing.read");
    const canManage = baseAuthority && context.scopes.includes("billing.manage");
    const canAdjust = baseAuthority && context.scopes.includes("billing.adjust");
    const canReconcile = baseAuthority && context.scopes.includes("billing.reconcile");
    let snapshot = null;
    let recentAal2 = context.demo;
    let loadError = invalidFilters;
    if (!loadError) {
      try {
        [snapshot, recentAal2] = await Promise.all([
          loadBillingManagementSnapshot(context, filters),
          canManage || canAdjust || canReconcile ? hasRecentAal2() : Promise.resolve(false),
        ]);
      } catch (error) {
        if (!(error instanceof BillingManagementSnapshotError)) throw error;
        loadError = true;
      }
    }
    return <BillingManagementWorkspace canAdjust={canAdjust}
      canManage={canManage} canReconcile={canReconcile}
      filters={filters} hasRecentAal2={recentAal2}
      loadError={loadError} page={page} snapshot={snapshot} />;
  }

  if (page.number === 45) {
    const requestedStatus =
      typeof query.status === "string" ? query.status : "all";
    const status: PushNotificationHistoryStatusFilter =
      PUSH_NOTIFICATION_HISTORY_STATUS_FILTERS.includes(
        requestedStatus as PushNotificationHistoryStatusFilter,
      )
        ? (requestedStatus as PushNotificationHistoryStatusFilter)
        : "all";
    const requestedDate = typeof query.date === "string" ? query.date : null;
    const date =
      requestedDate &&
      parseServiceDate(requestedDate, new Date("2000-01-01T00:00:00Z")) ===
        requestedDate
        ? requestedDate
        : null;
    const filters = {
      query: typeof query.q === "string" ? query.q.slice(0, 120) : "",
      category:
        typeof query.category === "string" && query.category.length <= 80
          ? query.category
          : "all",
      status,
      date,
    };
    let snapshot = null;
    let recentAal2 = context.demo;
    let loadError = false;
    try {
      [snapshot, recentAal2] = await Promise.all([
        loadPushNotificationManagementSnapshot(context),
        context.demo ? Promise.resolve(true) : hasRecentAal2(),
      ]);
    } catch (error) {
      if (!(error instanceof PushNotificationManagementSnapshotError)) throw error;
      loadError = true;
    }
    return (
      <PushNotificationsWorkspace
        filters={filters}
        hasRecentAal2={recentAal2}
        loadError={loadError}
        page={page}
        snapshot={snapshot}
      />
    );
  }

  if (page.number === 67) {
    const requestedStatus =
      typeof query.status === "string" ? query.status : "all";
    const status: NotificationCenterStatusFilter =
      NOTIFICATION_CENTER_STATUS_FILTERS.includes(
        requestedStatus as NotificationCenterStatusFilter,
      )
        ? (requestedStatus as NotificationCenterStatusFilter)
        : "all";
    const requestedPriority =
      typeof query.priority === "string" ? query.priority : "all";
    const priority: NotificationCenterPriorityFilter = [
      "all",
      "0",
      "1",
      "2",
      "3",
    ].includes(requestedPriority)
      ? (requestedPriority as NotificationCenterPriorityFilter)
      : "all";
    const requestedDate = typeof query.date === "string" ? query.date : null;
    const date =
      requestedDate &&
      parseServiceDate(requestedDate, new Date("2000-01-01T00:00:00Z")) ===
        requestedDate
        ? requestedDate
        : null;
    const filters = {
      query: typeof query.q === "string" ? query.q.slice(0, 120) : "",
      status,
      category:
        typeof query.category === "string" && query.category.length <= 80
          ? query.category
          : "all",
      priority,
      date,
    };
    let snapshot = null;
    let loadError = false;
    try {
      snapshot = filterNotificationCenterSnapshot(
        await loadNotificationCenterSnapshot(context),
        filters,
      );
    } catch (error) {
      if (!(error instanceof NotificationCenterSnapshotError)) throw error;
      loadError = true;
    }
    return (
      <NotificationCenterWorkspace
        canAcknowledge={
          !context.demo && context.scopes.includes("notifications.read")
        }
        filters={filters}
        loadError={loadError}
        page={page}
        snapshot={snapshot}
      />
    );
  }

  if (page.number === 65) {
    const validDate = (value: unknown) => typeof value === "string" &&
      isExternalHealthDate(value) ? value : null;
    const dateFrom = validDate(query.from);
    const dateTo = validDate(query.to);
    const invalidRange = dateFrom !== null && dateTo !== null && dateFrom > dateTo;
    const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
    const validUuid = (value: unknown) => typeof value === "string" &&
      uuidPattern.test(value) ? value.toLowerCase() : null;
    const requestedMatch = typeof query.matchStatus === "string"
      ? query.matchStatus : "all";
    const matchStatus: ExternalHealthMatchStatus = EXTERNAL_HEALTH_MATCH_STATUSES.includes(
      requestedMatch as ExternalHealthMatchStatus,
    ) ? requestedMatch as ExternalHealthMatchStatus : "all";
    const requestedDeviceStatus = typeof query.deviceStatus === "string"
      ? query.deviceStatus : "all";
    const deviceStatus: ExternalHealthDeviceStatus = EXTERNAL_HEALTH_DEVICE_STATUSES.includes(
      requestedDeviceStatus as ExternalHealthDeviceStatus,
    ) ? requestedDeviceStatus as ExternalHealthDeviceStatus : "all";
    const requestedMetric = typeof query.metric === "string" ? query.metric.trim() : "";
    const metricCode = requestedMetric && requestedMetric !== "all" &&
      requestedMetric.length <= 120 && !/[\u0000-\u001f\u007f]/u.test(requestedMetric)
      ? requestedMetric : null;
    const filters: ExternalHealthDeviceFilters = {
      dateFrom, dateTo, clientId: validUuid(query.client),
      deviceId: validUuid(query.device), matchStatus, deviceStatus, metricCode,
    };
    const canManage = !context.demo &&
      context.scopes.includes("external_health_devices.read") &&
      context.scopes.includes("external_health_devices.manage");
    let snapshot = null;
    let loadError = invalidRange;
    if (!invalidRange) {
      try {
        snapshot = await loadExternalHealthDeviceSnapshot(context, filters);
      } catch (error) {
        if (!(error instanceof ExternalHealthDeviceSnapshotError)) throw error;
        loadError = true;
      }
    }
    return <ExternalHealthDevicesWorkspace canManage={canManage} filters={filters}
      loadError={loadError} page={page} snapshot={snapshot} />;
  }

  if (page.number === 66) {
    const validDate = (value: unknown) => typeof value === "string" &&
      isHandHygieneCalendarDate(value) ? value : null;
    const dateFrom = validDate(query.from);
    const dateTo = validDate(query.to);
    const invalidRange = dateFrom !== null && dateTo !== null && dateFrom > dateTo;
    const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
    const requestedStaff = typeof query.staff === "string" ? query.staff : "all";
    const staffMembershipId = uuidPattern.test(requestedStaff)
      ? requestedStaff.toLowerCase() : null;
    const cleanText = (value: unknown, max: number) => typeof value === "string" &&
      value.length <= max && !/[\u0000-\u001f\u007f]/u.test(value)
      ? value.trim() : "";
    const requestedDevice = cleanText(query.device, 120);
    const requestedStatus = typeof query.status === "string" ? query.status : "all";
    const matchStatus: HandHygieneMatchStatus = HAND_HYGIENE_MATCH_STATUSES.includes(
      requestedStatus as HandHygieneMatchStatus,
    ) ? requestedStatus as HandHygieneMatchStatus : "all";
    const requestedKind = typeof query.kind === "string" ? query.kind : "all";
    const eventKind: HandHygieneEventKind = HAND_HYGIENE_EVENT_KINDS.includes(
      requestedKind as HandHygieneEventKind,
    ) ? requestedKind as HandHygieneEventKind : "all";
    const filters: HandHygieneFilters = {
      dateFrom,
      dateTo,
      staffMembershipId,
      deviceCode: requestedDevice && requestedDevice !== "all" ? requestedDevice : null,
      matchStatus,
      eventKind,
    };
    const canManage = !context.demo && context.scopes.includes("hand_hygiene.read") &&
      context.scopes.includes("hand_hygiene.manage");
    let snapshot = null;
    let loadError = invalidRange;
    if (!invalidRange) {
      try {
        snapshot = await loadHandHygieneSnapshot(context, filters);
      } catch (error) {
        if (!(error instanceof HandHygieneSnapshotError)) throw error;
        loadError = true;
      }
    }
    return <HandHygieneWorkspace canManage={canManage} filters={filters}
      loadError={loadError} page={page} snapshot={snapshot} />;
  }

  if (page.number === 68) {
    const requestedStatus = typeof query.status === "string" ? query.status : "all";
    const status: StaffAnnouncementStatusFilter =
      requestedStatus === "all" || STAFF_ANNOUNCEMENT_LIFECYCLES.includes(
        requestedStatus as (typeof STAFF_ANNOUNCEMENT_LIFECYCLES)[number],
      ) ? requestedStatus as StaffAnnouncementStatusFilter : "all";
    const selectedRelease = typeof query.release === "string" &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(query.release)
      ? query.release.toLowerCase() : null;
    const filters = {
      query: typeof query.q === "string" ? query.q.slice(0, 120) : "",
      status,
    };
    const canPublish = !context.demo &&
      context.scopes.includes("announcements.manage") &&
      context.scopes.includes("announcements.publish");
    let snapshot = null;
    let recentAal2 = false;
    let loadError = false;
    try {
      const [unfiltered, aal2] = await Promise.all([
        loadStaffAnnouncementSnapshot(context, selectedRelease),
        canPublish ? hasRecentAal2() : Promise.resolve(false),
      ]);
      snapshot = filterStaffAnnouncementSnapshot(unfiltered, filters);
      recentAal2 = aal2;
    } catch (error) {
      if (!(error instanceof StaffAnnouncementSnapshotError)) throw error;
      loadError = true;
    }
    return <StaffAnnouncementsWorkspace
      canPublish={canPublish}
      canRead={!context.demo && context.scopes.includes("announcements.read")}
      filters={filters}
      hasRecentAal2={recentAal2}
      loadError={loadError}
      page={page}
      snapshot={snapshot}
    />;
  }

  if (page.number === 69) {
    const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
    const cleanText = (value: unknown, max: number) => typeof value === "string" &&
      value.length <= max && !/[\u0000-\u001f\u007f]/u.test(value)
      ? value.trim() : "";
    const requestedStaff = typeof query.staff === "string" ? query.staff : "all";
    const staffMembershipId = uuidPattern.test(requestedStaff)
      ? requestedStaff.toLowerCase() : null;
    const requestedType = typeof query.type === "string" ? query.type : "all";
    const cleanType = cleanText(requestedType, 120);
    const measurementType = cleanType && cleanType !== "all" ? cleanType : null;
    const requestedState = typeof query.state === "string" ? query.state : "all";
    const stateStatus: StaffVitalSignStateFilter =
      STAFF_VITAL_SIGN_STATE_FILTERS.includes(
        requestedState as StaffVitalSignStateFilter,
      ) ? requestedState as StaffVitalSignStateFilter : "all";
    const requestedFrom = typeof query.from === "string" ? query.from : "";
    const requestedTo = typeof query.to === "string" ? query.to : "";
    const dateFrom = requestedFrom && isStaffVitalSignDate(requestedFrom)
      ? requestedFrom : null;
    const dateTo = requestedTo && isStaffVitalSignDate(requestedTo)
      ? requestedTo : null;
    const requestedQuery = typeof query.q === "string" ? query.q : "";
    const filters: StaffVitalSignFilters = {
      staffMembershipId, measurementType, stateStatus, dateFrom, dateTo,
      query: cleanText(requestedQuery, 120),
    };
    const invalidFilters =
      (requestedStaff !== "all" && staffMembershipId === null) ||
      (requestedType !== "all" && measurementType === null) ||
      !STAFF_VITAL_SIGN_STATE_FILTERS.includes(
        requestedState as StaffVitalSignStateFilter,
      ) || (requestedFrom !== "" && dateFrom === null) ||
      (requestedTo !== "" && dateTo === null) ||
      (dateFrom !== null && dateTo !== null && dateTo < dateFrom) ||
      requestedQuery.length > 120 || /[\u0000-\u001f\u007f]/u.test(requestedQuery);
    const canManage = !context.demo && context.assuranceLevel === "aal2" &&
      context.scopes.includes("staff_health.read") &&
      context.scopes.includes("staff_health.manage");
    const recentAal2 = context.demo ? true : await hasRecentAal2();
    let snapshot = null;
    let loadError = invalidFilters;
    if (!loadError && recentAal2) {
      try {
        snapshot = await loadStaffVitalSignSnapshot(context, filters, recentAal2);
      } catch (error) {
        if (!(error instanceof StaffVitalSignSnapshotError)) throw error;
        loadError = true;
      }
    }
    return <StaffVitalSignsWorkspace canManage={canManage} filters={filters}
      hasRecentAal2={recentAal2} loadError={loadError}
      page={page} snapshot={snapshot} />;
  }

  if (page.number === 71) {
    const validDate = (value: unknown) =>
      typeof value === "string" && isStaffTrainingCalendarDate(value) ? value : null;
    const dateFrom = validDate(query.from);
    const dateTo = validDate(query.to);
    const invalidRange = dateFrom !== null && dateTo !== null && dateFrom > dateTo;
    const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
    const requestedStaff = typeof query.staff === "string" ? query.staff : "all";
    const staffMembershipId = uuidPattern.test(requestedStaff)
      ? requestedStaff.toLowerCase()
      : null;
    const requestedStatus = typeof query.status === "string" ? query.status : "all";
    const status: StaffTrainingStatusFilter = STAFF_TRAINING_STATUSES.includes(
      requestedStatus as StaffTrainingStatusFilter,
    ) ? requestedStatus as StaffTrainingStatusFilter : "all";
    const cleanText = (value: unknown, max: number) => typeof value === "string" &&
      value.length <= max && !/[\u0000-\u001f\u007f]/u.test(value)
      ? value.trim() : "";
    const requestedType = cleanText(query.type, 120);
    const filters: StaffTrainingFilters = {
      dateFrom, dateTo, staffMembershipId,
      courseType: requestedType && requestedType !== "all" ? requestedType : null,
      status, query: cleanText(query.q, 120),
    };
    const canManage = !context.demo &&
      context.scopes.includes("staff_training.read") &&
      context.scopes.includes("staff_training.manage");
    const canRules = !context.demo &&
      context.scopes.includes("staff_training.read") &&
      context.scopes.includes("staff_training.rules");
    let snapshot = null;
    let recentAal2 = false;
    let loadError = invalidRange;
    if (!invalidRange) {
      try {
        [snapshot, recentAal2] = await Promise.all([
          loadStaffTrainingSnapshot(context, filters),
          canRules ? hasRecentAal2() : Promise.resolve(false),
        ]);
      } catch (error) {
        if (!(error instanceof StaffTrainingSnapshotError)) throw error;
        loadError = true;
      }
    }
    return <StaffTrainingWorkspace canManage={canManage} canRules={canRules}
      filters={filters} hasRecentAal2={recentAal2} loadError={loadError}
      page={page} snapshot={snapshot} />;
  }

  if (page.number === 72) {
    const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
    const requestedStaff = typeof query.staff === "string" ? query.staff : "all";
    const staffMembershipId = uuidPattern.test(requestedStaff)
      ? requestedStaff.toLowerCase() : null;
    const requestedStatus = typeof query.status === "string" ? query.status : "all";
    const status: StaffCertificateStatusFilter = STAFF_CERTIFICATE_STATUS_FILTERS.includes(
      requestedStatus as StaffCertificateStatusFilter,
    ) ? requestedStatus as StaffCertificateStatusFilter : "all";
    const cleanText = (value: unknown, max: number) => typeof value === "string" &&
      value.length <= max && !/[\u0000-\u001f\u007f]/u.test(value)
      ? value.trim() : "";
    const requestedType = cleanText(query.type, 120);
    const filters: StaffCertificateFilters = {
      staffMembershipId,
      certificateType: requestedType && requestedType !== "all" ? requestedType : null,
      status, query: cleanText(query.q, 120),
    };
    const canManage = !context.demo &&
      context.scopes.includes("staff_certificates.read") &&
      context.scopes.includes("staff_certificates.manage");
    const canExceptions = !context.demo &&
      context.scopes.includes("staff_certificates.read") &&
      context.scopes.includes("staff_certificates.exceptions");
    let snapshot = null;
    let recentAal2 = false;
    let loadError = false;
    try {
      [snapshot, recentAal2] = await Promise.all([
        loadStaffCertificateSnapshot(context, filters),
        canExceptions ? hasRecentAal2() : Promise.resolve(false),
      ]);
    } catch (error) {
      if (!(error instanceof StaffCertificateSnapshotError)) throw error;
      loadError = true;
    }
    return <StaffCertificatesWorkspace canExceptions={canExceptions}
      canManage={canManage} filters={filters} hasRecentAal2={recentAal2}
      loadError={loadError} page={page} snapshot={snapshot} />;
  }

  if (page.number === 73) {
    const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
    const cleanText = (value: unknown, max: number) => typeof value === "string" &&
      value.length <= max && !/[\u0000-\u001f\u007f]/u.test(value)
      ? value.trim() : "";
    const requestedStaff = typeof query.staff === "string" ? query.staff : "all";
    const staffMembershipId = uuidPattern.test(requestedStaff)
      ? requestedStaff.toLowerCase() : null;
    const requestedStatus = typeof query.status === "string" ? query.status : "all";
    const status: StaffVaccinationStatusFilter = STAFF_VACCINATION_STATUS_FILTERS.includes(
      requestedStatus as StaffVaccinationStatusFilter,
    ) ? requestedStatus as StaffVaccinationStatusFilter : "all";
    const requestedVaccine = cleanText(query.vaccine, 160);
    const requestedDose = cleanText(query.dose, 80);
    const requestedFrom = cleanText(query.from, 10);
    const requestedTo = cleanText(query.to, 10);
    const dateFrom = requestedFrom && isStaffVaccinationDate(requestedFrom)
      ? requestedFrom : null;
    const dateTo = requestedTo && isStaffVaccinationDate(requestedTo)
      ? requestedTo : null;
    const invalidRange = dateFrom !== null && dateTo !== null && dateTo < dateFrom;
    const filters: StaffVaccinationFilters = {
      staffMembershipId,
      vaccineName: requestedVaccine && requestedVaccine !== "all" ? requestedVaccine : null,
      doseNumber: requestedDose && requestedDose !== "all" ? requestedDose : null,
      dateFrom, dateTo, status, query: cleanText(query.q, 120),
    };
    const canManage = !context.demo && context.assuranceLevel === "aal2" &&
      context.scopes.includes("staff_health.read") &&
      context.scopes.includes("staff_health.manage");
    let snapshot = null;
    let loadError = invalidRange;
    if (!invalidRange) {
      try {
        snapshot = await loadStaffVaccinationSnapshot(context, filters);
      } catch (error) {
        if (!(error instanceof StaffVaccinationSnapshotError)) throw error;
        loadError = true;
      }
    }
    return <StaffVaccinationsWorkspace canManage={canManage} filters={filters}
      loadError={loadError} page={page} snapshot={snapshot} />;
  }

  if (page.number === 74) {
    const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
    const cleanText = (value: unknown, max: number) => typeof value === "string" &&
      value.length <= max && !/[\u0000-\u001f\u007f]/u.test(value)
      ? value.trim() : "";
    const requestedStaff = typeof query.staff === "string" ? query.staff : "all";
    const staffMembershipId = uuidPattern.test(requestedStaff)
      ? requestedStaff.toLowerCase() : null;
    const requestedValidity = typeof query.validity === "string" ? query.validity : "all";
    const validityStatus: StaffToccValidityFilter = STAFF_TOCC_VALIDITY_FILTERS.includes(
      requestedValidity as StaffToccValidityFilter,
    ) ? requestedValidity as StaffToccValidityFilter : "all";
    const requestedAttention = typeof query.attention === "string" ? query.attention : "all";
    const attentionStatus: StaffToccAttentionFilter = STAFF_TOCC_ATTENTION_FILTERS.includes(
      requestedAttention as StaffToccAttentionFilter,
    ) ? requestedAttention as StaffToccAttentionFilter : "all";
    const requestedDisposition = typeof query.disposition === "string"
      ? query.disposition : "all";
    const dispositionStatus: StaffToccDispositionFilter =
      STAFF_TOCC_DISPOSITION_FILTERS.includes(
        requestedDisposition as StaffToccDispositionFilter,
      ) ? requestedDisposition as StaffToccDispositionFilter : "all";
    const requestedFrom = cleanText(query.from, 10);
    const requestedTo = cleanText(query.to, 10);
    const dateFrom = requestedFrom && isStaffToccDate(requestedFrom)
      ? requestedFrom : null;
    const dateTo = requestedTo && isStaffToccDate(requestedTo)
      ? requestedTo : null;
    const invalidRange = dateFrom !== null && dateTo !== null && dateTo < dateFrom;
    const filters: StaffToccFilters = {
      staffMembershipId, validityStatus, attentionStatus, dispositionStatus,
      dateFrom, dateTo, query: cleanText(query.q, 120),
    };
    const canManage = !context.demo && context.assuranceLevel === "aal2" &&
      context.scopes.includes("staff_tocc.read") &&
      context.scopes.includes("staff_tocc.manage");
    let snapshot = null;
    let loadError = invalidRange;
    if (!invalidRange) {
      try {
        snapshot = await loadStaffToccSnapshot(context, filters);
      } catch (error) {
        if (!(error instanceof StaffToccSnapshotError)) throw error;
        loadError = true;
      }
    }
    return <StaffToccWorkspace canManage={canManage} filters={filters}
      loadError={loadError} page={page} snapshot={snapshot} />;
  }

  if (page.number === 75) {
    const requestedStatus = typeof query.status === "string" ? query.status : "all";
    const status: MeetingStatusFilter = [
      "all", "open", "overdue", "completed", "cancelled",
    ].includes(requestedStatus)
      ? requestedStatus as MeetingStatusFilter
      : "all";
    const requestedDate = typeof query.date === "string" ? query.date : null;
    const requestedType = typeof query.type === "string" ? query.type.trim() : "all";
    const filters: MeetingFilters = {
      query: typeof query.q === "string" ? query.q.slice(0, 120) : "",
      meetingType: requestedType.length > 0 && requestedType.length <= 120 &&
        !/[\u0000-\u001f\u007f]/u.test(requestedType) ? requestedType : "all",
      status,
      date: requestedDate && isMeetingCalendarDate(requestedDate) ? requestedDate : null,
    };
    const canManage = !context.demo &&
      context.scopes.includes("meetings.read") &&
      context.scopes.includes("meetings.manage");
    const canSign = canManage && context.scopes.includes("meetings.sign");
    let snapshot = null;
    let recentAal2 = false;
    let loadError = false;
    try {
      const [loaded, recent] = await Promise.all([
        loadMeetingManagementSnapshot(context),
        canSign ? hasRecentAal2() : Promise.resolve(false),
      ]);
      snapshot = filterMeetingManagementSnapshot(loaded, filters);
      recentAal2 = recent;
    } catch (error) {
      if (!(error instanceof MeetingManagementSnapshotError)) throw error;
      loadError = true;
    }
    return <MeetingManagementWorkspace
      canManage={canManage}
      canSign={canSign}
      filters={filters}
      hasRecentAal2={recentAal2}
      loadError={loadError}
      page={page}
      snapshot={snapshot}
    />;
  }

  if (page.number === 37) {
    const allowedQueryKeys = new Set([
      "client", "requester", "assignee", "discipline", "urgency", "status",
      "deadline", "from", "to", "q",
    ]);
    const invalidQueryShape = Object.entries(query).some(([key, value]) =>
      !allowedQueryKeys.has(key) || Array.isArray(value)
    );
    const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
    const validDate = (value: unknown) => {
      if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/u.test(value)) return null;
      const parsed = new Date(`${value}T00:00:00.000Z`);
      return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value
        ? value : null;
    };
    const requestedClient = typeof query.client === "string" ? query.client : "all";
    const clientId = uuidPattern.test(requestedClient) ? requestedClient.toLowerCase() : null;
    const requestedRequester = typeof query.requester === "string" ? query.requester : "all";
    const requesterUserId = uuidPattern.test(requestedRequester) ? requestedRequester.toLowerCase() : null;
    const requestedAssignee = typeof query.assignee === "string" ? query.assignee : "all";
    const assigneeUserId = uuidPattern.test(requestedAssignee) ? requestedAssignee.toLowerCase() : null;
    const assigneeMode = assigneeUserId !== null ? "specific" as const
      : requestedAssignee === "assigned" ? "assigned" as const
        : requestedAssignee === "unassigned" ? "unassigned" as const : "all" as const;
    const requestedDiscipline = typeof query.discipline === "string" ? query.discipline : "all";
    const disciplineCode = requestedDiscipline !== "all" &&
      /^[A-Za-z0-9][A-Za-z0-9._-]{0,39}$/u.test(requestedDiscipline)
      ? requestedDiscipline : null;
    const requestedUrgency = typeof query.urgency === "string" ? query.urgency : "all";
    const urgency: "all" | ConsultationUrgency = requestedUrgency === "all" ||
      CONSULTATION_URGENCIES.includes(requestedUrgency as ConsultationUrgency)
      ? requestedUrgency as "all" | ConsultationUrgency : "all";
    const requestedStatus = typeof query.status === "string" ? query.status : "all";
    const status: "all" | ConsultationStatus = requestedStatus === "all" ||
      CONSULTATION_STATUSES.includes(requestedStatus as ConsultationStatus)
      ? requestedStatus as "all" | ConsultationStatus : "all";
    const requestedDeadline = typeof query.deadline === "string" ? query.deadline : "all";
    const deadlineFilter: ConsultationDeadlineFilter = CONSULTATION_DEADLINE_FILTERS.includes(
      requestedDeadline as ConsultationDeadlineFilter,
    ) ? requestedDeadline as ConsultationDeadlineFilter : "all";
    const requestedFrom = typeof query.from === "string" ? query.from : "";
    const requestedTo = typeof query.to === "string" ? query.to : "";
    const dueFrom = requestedFrom === "" ? null : validDate(requestedFrom);
    const dueTo = requestedTo === "" ? null : validDate(requestedTo);
    const requestedQuery = typeof query.q === "string" ? query.q : "";
    const cleanQuery = requestedQuery.length <= 120 &&
      !/[\u0000-\u001f\u007f]/u.test(requestedQuery) ? requestedQuery.trim() : "";
    const invalidFilters =
      invalidQueryShape ||
      (requestedClient !== "all" && clientId === null) ||
      (requestedRequester !== "all" && requesterUserId === null) ||
      (!["all", "assigned", "unassigned"].includes(requestedAssignee) && assigneeUserId === null) ||
      (requestedDiscipline !== "all" && disciplineCode === null) ||
      !(requestedUrgency === "all" || CONSULTATION_URGENCIES.includes(requestedUrgency as ConsultationUrgency)) ||
      !(requestedStatus === "all" || CONSULTATION_STATUSES.includes(requestedStatus as ConsultationStatus)) ||
      !CONSULTATION_DEADLINE_FILTERS.includes(requestedDeadline as ConsultationDeadlineFilter) ||
      (requestedFrom !== "" && dueFrom === null) || (requestedTo !== "" && dueTo === null) ||
      (dueFrom !== null && dueTo !== null && dueFrom > dueTo) ||
      requestedQuery.length > 120 || /[\u0000-\u001f\u007f]/u.test(requestedQuery);
    const filters: InterprofessionalConsultationFilters = {
      clientId, requesterUserId, assigneeMode, assigneeUserId, disciplineCode,
      urgency, status, deadlineFilter, dueFrom, dueTo, query: cleanQuery,
    };
    const recentAal2 = await hasRecentAal2();
    let snapshot = null;
    let loadError = invalidFilters;
    if (!loadError) {
      try {
        snapshot = await loadInterprofessionalConsultationSnapshot(context, filters, recentAal2);
      } catch (error) {
        if (!(error instanceof InterprofessionalConsultationSnapshotError)) throw error;
        loadError = true;
      }
    }
    return <InterprofessionalConsultationsWorkspace filters={filters}
      loadError={loadError} page={page} snapshot={snapshot} />;
  }

  if (page.number === 38) {
    const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
    const validDate = (value: unknown) => {
      if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/u.test(value)) return null;
      const parsed = new Date(`${value}T00:00:00.000Z`);
      return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value
        ? value : null;
    };
    const requestedClient = typeof query.client === "string" ? query.client : "all";
    const clientId = uuidPattern.test(requestedClient) ? requestedClient.toLowerCase() : null;
    const requestedResponsible = typeof query.responsible === "string" ? query.responsible : "all";
    const responsibleUserId = uuidPattern.test(requestedResponsible)
      ? requestedResponsible.toLowerCase() : null;
    const requestedStatus = typeof query.status === "string" ? query.status : "all";
    const status: "all" | CaseConferenceStatus = requestedStatus === "all" ||
      CASE_CONFERENCE_STATUSES.includes(requestedStatus as CaseConferenceStatus)
      ? requestedStatus as "all" | CaseConferenceStatus : "all";
    const requestedAction = typeof query.action === "string" ? query.action : "all";
    const actionStatus: "all" | CaseConferenceActionStatus | "overdue" =
      requestedAction === "all" || requestedAction === "overdue" ||
      CASE_CONFERENCE_ACTION_STATUSES.includes(requestedAction as CaseConferenceActionStatus)
        ? requestedAction as "all" | CaseConferenceActionStatus | "overdue" : "all";
    const requestedFrom = typeof query.from === "string" ? query.from : "";
    const requestedTo = typeof query.to === "string" ? query.to : "";
    const meetingFrom = requestedFrom === "" ? null : validDate(requestedFrom);
    const meetingTo = requestedTo === "" ? null : validDate(requestedTo);
    const requestedQuery = typeof query.q === "string" ? query.q : "";
    const cleanQuery = requestedQuery.length <= 120 &&
      !/[\u0000-\u001f\u007f]/u.test(requestedQuery) ? requestedQuery.trim() : "";
    const validStatus = requestedStatus === "all" ||
      CASE_CONFERENCE_STATUSES.includes(requestedStatus as CaseConferenceStatus);
    const validAction = requestedAction === "all" || requestedAction === "overdue" ||
      CASE_CONFERENCE_ACTION_STATUSES.includes(requestedAction as CaseConferenceActionStatus);
    const invalidFilters =
      (requestedClient !== "all" && clientId === null) ||
      (requestedResponsible !== "all" && responsibleUserId === null) ||
      !validStatus || !validAction ||
      (requestedFrom !== "" && meetingFrom === null) ||
      (requestedTo !== "" && meetingTo === null) ||
      (meetingFrom !== null && meetingTo !== null && meetingFrom > meetingTo) ||
      requestedQuery.length > 120 || /[\u0000-\u001f\u007f]/u.test(requestedQuery);
    const filters: CaseConferenceFilters = {
      clientId, status, responsibleUserId, actionStatus,
      meetingFrom, meetingTo, query: cleanQuery,
    };
    const recentAal2 = await hasRecentAal2();
    let snapshot = null;
    let loadError = invalidFilters;
    if (!loadError) {
      try {
        snapshot = await loadCaseConferenceSnapshot(context, filters, recentAal2);
      } catch (error) {
        if (!(error instanceof CaseConferenceSnapshotError)) throw error;
        loadError = true;
      }
    }
    return <CaseConferencesWorkspace filters={filters}
      loadError={loadError} page={page} snapshot={snapshot} />;
  }

  if (page.number === 39) {
    const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
    const validDate = (value: unknown) => {
      if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/u.test(value)) return null;
      const parsed = new Date(`${value}T00:00:00.000Z`);
      return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value
        ? value : null;
    };
    const requestedClient = typeof query.client === "string" ? query.client : "all";
    const clientId = uuidPattern.test(requestedClient) ? requestedClient.toLowerCase() : null;
    const requestedUnit = typeof query.unit === "string" ? query.unit : "all";
    const receivingUnitCode = /^[A-Za-z0-9][A-Za-z0-9._-]{0,39}$/u.test(requestedUnit) &&
      !REFERRAL_RECEIVING_UNIT_MODES.includes(requestedUnit as ReferralReceivingUnitMode)
      ? requestedUnit : null;
    const receivingUnitMode: ReferralReceivingUnitMode = receivingUnitCode !== null
      ? "specific"
      : REFERRAL_RECEIVING_UNIT_MODES.includes(requestedUnit as ReferralReceivingUnitMode) &&
          requestedUnit !== "specific"
        ? requestedUnit as Exclude<ReferralReceivingUnitMode, "specific">
        : "all";
    const requestedStatus = typeof query.status === "string" ? query.status : "all";
    const status: "all" | ReferralStatus = requestedStatus === "all" ||
      REFERRAL_STATUSES.includes(requestedStatus as ReferralStatus)
      ? requestedStatus as "all" | ReferralStatus : "all";
    const requestedFrom = typeof query.from === "string" ? query.from : "";
    const requestedTo = typeof query.to === "string" ? query.to : "";
    const recentFrom = requestedFrom === "" ? null : validDate(requestedFrom);
    const recentTo = requestedTo === "" ? null : validDate(requestedTo);
    const requestedQuery = typeof query.q === "string" ? query.q : "";
    const cleanQuery = requestedQuery.length <= 120 &&
      !/[\u0000-\u001f\u007f]/u.test(requestedQuery) ? requestedQuery.trim() : "";
    const validUnit = requestedUnit === "all" || requestedUnit === "manual_unstandardized" ||
      requestedUnit === "missing" || requestedUnit === "not_applicable" ||
      receivingUnitCode !== null;
    const invalidFilters =
      (requestedClient !== "all" && clientId === null) || !validUnit ||
      !(requestedStatus === "all" || REFERRAL_STATUSES.includes(requestedStatus as ReferralStatus)) ||
      (requestedFrom !== "" && recentFrom === null) ||
      (requestedTo !== "" && recentTo === null) ||
      (recentFrom !== null && recentTo !== null && recentFrom > recentTo) ||
      requestedQuery.length > 120 || /[\u0000-\u001f\u007f]/u.test(requestedQuery);
    const filters: ReferralManagementFilters = {
      clientId,
      receivingUnitMode,
      receivingUnitCode,
      status,
      recentFrom,
      recentTo,
      query: cleanQuery,
    };
    const recentAal2 = await hasRecentAal2();
    let snapshot = null;
    let loadError = invalidFilters;
    if (!loadError) {
      try {
        snapshot = await loadReferralManagementSnapshot(context, filters, recentAal2);
      } catch (error) {
        if (!(error instanceof ReferralManagementSnapshotError)) throw error;
        loadError = true;
      }
    }
    return <ReferralManagementWorkspace filters={filters}
      loadError={loadError} page={page} snapshot={snapshot} />;
  }

  if (page.number === 43) {
    const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
    const validDate = (value: unknown) => {
      if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/u.test(value)) {
        return null;
      }
      const parsed = new Date(`${value}T00:00:00.000Z`);
      return Number.isFinite(parsed.getTime()) &&
        parsed.toISOString().slice(0, 10) === value ? value : null;
    };
    const requestedClient = typeof query.client === "string" ? query.client : "";
    const clientId = uuidPattern.test(requestedClient)
      ? requestedClient.toLowerCase() : null;
    const requestedAuthor = typeof query.author === "string" ? query.author : "";
    const authorUserId = uuidPattern.test(requestedAuthor)
      ? requestedAuthor.toLowerCase() : null;
    const requestedFrom = typeof query.from === "string" ? query.from : "";
    const requestedTo = typeof query.to === "string" ? query.to : "";
    const dateFrom = validDate(requestedFrom);
    const dateTo = validDate(requestedTo);
    const requestedDelivery = typeof query.delivery === "string"
      ? query.delivery : "all";
    const deliveryStatus: CareCommunicationDeliveryFilter =
      CARE_COMMUNICATION_DELIVERY_FILTERS.includes(
        requestedDelivery as CareCommunicationDeliveryFilter,
      ) ? requestedDelivery as CareCommunicationDeliveryFilter : "all";
    const requestedConfirmation = typeof query.confirmation === "string"
      ? query.confirmation : "all";
    const confirmationStatus: CareCommunicationConfirmationFilter =
      CARE_COMMUNICATION_CONFIRMATION_FILTERS.includes(
        requestedConfirmation as CareCommunicationConfirmationFilter,
      ) ? requestedConfirmation as CareCommunicationConfirmationFilter : "all";
    const requestedQuery = typeof query.q === "string" ? query.q : "";
    const cleanQuery = requestedQuery.length <= 120 &&
      !/[\u0000-\u001f\u007f]/u.test(requestedQuery)
      ? requestedQuery.trim() : "";
    const invalidFilters =
      (requestedClient !== "" && clientId === null) ||
      (requestedAuthor !== "" && authorUserId === null) ||
      (requestedFrom !== "" && dateFrom === null) ||
      (requestedTo !== "" && dateTo === null) ||
      !CARE_COMMUNICATION_DELIVERY_FILTERS.includes(
        requestedDelivery as CareCommunicationDeliveryFilter,
      ) ||
      !CARE_COMMUNICATION_CONFIRMATION_FILTERS.includes(
        requestedConfirmation as CareCommunicationConfirmationFilter,
      ) ||
      requestedQuery.length > 120 ||
      /[\u0000-\u001f\u007f]/u.test(requestedQuery) ||
      (dateFrom !== null && dateTo !== null && dateFrom > dateTo);
    const filters: CareCommunicationFilters = {
      clientId,
      dateFrom,
      dateTo,
      authorUserId,
      deliveryStatus,
      confirmationStatus,
      query: cleanQuery,
    };
    const recentAal2 = await hasRecentAal2();
    let snapshot = null;
    let loadError = invalidFilters;
    if (!loadError) {
      try {
        snapshot = await loadCareCommunicationSnapshot(
          context,
          filters,
          recentAal2,
        );
      } catch (error) {
        if (!(error instanceof CareCommunicationSnapshotError)) throw error;
        loadError = true;
      }
    }
    return <CareCommunicationsWorkspace
      filters={filters}
      hasRecentAal2={recentAal2}
      loadError={loadError}
      page={page}
      snapshot={snapshot}
    />;
  }

  if (page.number === 44) {
    const currentMonth = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Taipei", year: "numeric", month: "2-digit",
    }).format(new Date());
    const requestedMonth = typeof query.month === "string" ? query.month : currentMonth;
    const month = /^\d{4}-\d{2}$/u.test(requestedMonth) &&
      Number(requestedMonth.slice(0, 4)) >= 2000 &&
      Number(requestedMonth.slice(0, 4)) <= 2200 &&
      Number(requestedMonth.slice(5, 7)) >= 1 &&
      Number(requestedMonth.slice(5, 7)) <= 12 ? requestedMonth : currentMonth;
    const requestedOrganization = typeof query.organization === "string"
      ? query.organization.toLowerCase() : context.organizationId;
    const requestedCategory = typeof query.category === "string" ? query.category : "all";
    const category: ReassuranceCalendarCategory | null =
      REASSURANCE_CALENDAR_CATEGORIES.includes(
        requestedCategory as ReassuranceCalendarCategory,
      ) ? requestedCategory as ReassuranceCalendarCategory : null;
    const requestedStatus = typeof query.status === "string" ? query.status : "all";
    const status: ReassuranceCalendarStatusFilter = requestedStatus === "all" ||
      REASSURANCE_CALENDAR_STATUSES.includes(
        requestedStatus as (typeof REASSURANCE_CALENDAR_STATUSES)[number],
      ) ? requestedStatus as ReassuranceCalendarStatusFilter : "all";
    const requestedToday = typeof query.today === "string" ? query.today : "";
    const requestedQuery = typeof query.q === "string" ? query.q : "";
    const cleanQuery = requestedQuery.length <= 120 &&
      !/[\u0000-\u001f\u007f]/u.test(requestedQuery) ? requestedQuery.trim() : "";
    const invalidFilters = month !== requestedMonth ||
      requestedOrganization !== context.organizationId ||
      !["all", ...REASSURANCE_CALENDAR_CATEGORIES].includes(requestedCategory) ||
      !["all", ...REASSURANCE_CALENDAR_STATUSES].includes(requestedStatus) ||
      !["", "1"].includes(requestedToday) ||
      requestedQuery.length > 120 || /[\u0000-\u001f\u007f]/u.test(requestedQuery);
    const filters: ReassuranceCalendarFilters = {
      month, organizationId: context.organizationId, category,
      status, todayOnly: requestedToday === "1", query: cleanQuery,
    };
    const recentAal2 = await hasRecentAal2();
    let snapshot = null;
    let loadError = invalidFilters;
    if (!loadError) {
      try {
        snapshot = await loadReassuranceCalendarSnapshot(context, filters, recentAal2);
      } catch (error) {
        if (!(error instanceof ReassuranceCalendarSnapshotError)) throw error;
        loadError = true;
      }
    }
    return <ReassuranceCalendarWorkspace filters={filters}
      hasRecentAal2={recentAal2} loadError={loadError}
      page={page} snapshot={snapshot} />;
  }

  if (page.number === 76) {
    const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
    const validDate = (value: unknown) => {
      if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/u.test(value)) {
        return null;
      }
      const parsed = new Date(`${value}T00:00:00.000Z`);
      return Number.isFinite(parsed.getTime()) &&
        parsed.toISOString().slice(0, 10) === value ? value : null;
    };
    const cleanQuery = (value: unknown) => typeof value === "string" &&
      value.length <= 120 && !/[\u0000-\u001f\u007f]/u.test(value)
      ? value.trim() : "";
    const requestedConsultant = typeof query.consultant === "string"
      ? query.consultant : "";
    const consultantUserId = uuidPattern.test(requestedConsultant)
      ? requestedConsultant.toLowerCase() : null;
    const dateFrom = validDate(query.from);
    const dateTo = validDate(query.to);
    const requestedStatus = typeof query.status === "string" ? query.status : "all";
    const status: ConsultantMessageStatus = CONSULTANT_MESSAGE_STATUSES.includes(
      requestedStatus as ConsultantMessageStatus,
    ) ? requestedStatus as ConsultantMessageStatus : "all";
    const canManage = !context.demo &&
      context.scopes.includes("consultant_messages.read") &&
      context.scopes.includes("consultant_messages.manage");
    const invalidRange = dateFrom !== null && dateTo !== null && dateFrom > dateTo;
    const invalidRecipientFilter = !context.demo && !canManage &&
      consultantUserId !== null && consultantUserId !== context.userId;
    const filters: ConsultantMessageFilters = {
      consultantUserId,
      dateFrom,
      dateTo,
      status,
      query: cleanQuery(query.q),
    };
    let snapshot = null;
    let loadError = invalidRange || invalidRecipientFilter;
    if (!loadError) {
      try {
        snapshot = await loadConsultantMessageSnapshot(context, filters);
      } catch (error) {
        if (!(error instanceof ConsultantMessageSnapshotError)) throw error;
        loadError = true;
      }
    }
    return <ConsultantMessagesWorkspace
      canReceive={!context.demo &&
        context.scopes.includes("consultant_messages.read") &&
        context.scopes.includes("consultant_messages.receive")}
      filters={filters}
      loadError={loadError}
      page={page}
      snapshot={snapshot}
    />;
  }

  if (page.number === 77) {
    const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
    const requestedItem = typeof query.item === "string" ? query.item : "all";
    const itemId = uuidPattern.test(requestedItem) ? requestedItem.toLowerCase() : null;
    const requestedExpiry = typeof query.expiry === "string" ? query.expiry : "all";
    const expiryStatus: InventoryExpiryFilter = INVENTORY_EXPIRY_FILTERS.includes(
      requestedExpiry as InventoryExpiryFilter,
    ) ? requestedExpiry as InventoryExpiryFilter : "all";
    const requestedMovement = typeof query.movement === "string" ? query.movement : "all";
    const movementType: InventoryMovementFilter = requestedMovement === "all" ||
      INVENTORY_MOVEMENT_TYPES.includes(requestedMovement as (typeof INVENTORY_MOVEMENT_TYPES)[number])
      ? requestedMovement as InventoryMovementFilter : "all";
    const cleanQuery = (value: unknown) => typeof value === "string" &&
      value.length <= 100 && !/[\u0000-\u001f\u007f]/u.test(value)
      ? value.trim() : "";
    const filters: InventoryFilters = {
      itemId, query: cleanQuery(query.q), batchQuery: cleanQuery(query.batch),
      expiryStatus, movementType,
    };
    const canManage = !context.demo && context.scopes.includes("inventory.read") &&
      context.scopes.includes("inventory.manage");
    const canAdjust = canManage && context.scopes.includes("inventory.adjust");
    let snapshot = null;
    let recentAal2 = false;
    let loadError = false;
    try {
      [snapshot, recentAal2] = await Promise.all([
        loadInventoryManagementSnapshot(context, filters),
        canAdjust ? hasRecentAal2() : Promise.resolve(false),
      ]);
    } catch (error) {
      if (!(error instanceof InventoryManagementSnapshotError)) throw error;
      loadError = true;
    }
    return <InventoryManagementWorkspace canAdjust={canAdjust}
      canManage={canManage} filters={filters} hasRecentAal2={recentAal2}
      loadError={loadError} page={page} snapshot={snapshot} />;
  }

  if (page.number === 55) {
    let filters = defaultAuthorizedCarePlanFilters();
    let snapshot = null;
    let loadError = false;
    const parameters = new URLSearchParams();
    for (const [key, value] of Object.entries(query)) {
      if (typeof value === "string") parameters.append(key, value);
      else if (Array.isArray(value)) for (const item of value) parameters.append(key, item);
    }
    try { filters = parseAuthorizedCarePlanFilters(parameters); }
    catch { loadError = true; }
    if (!loadError) {
      try { snapshot = await loadAuthorizedCarePlanViewSnapshot(context, filters); }
      catch (error) {
        if (!(error instanceof AuthorizedCarePlanViewSnapshotError)) throw error;
        loadError = true;
      }
    }
    return <AuthorizedCarePlanViewWorkspace page={page} filters={filters}
      snapshot={snapshot} loadError={loadError} />;
  }

  if (page.number === 50) {
    let filters = emptyCaseServiceRecordFilters();
    let snapshot = null;
    let loadError = false;
    let recentAal2 = false;
    const parameters = new URLSearchParams();
    for (const [key, value] of Object.entries(query)) {
      if (typeof value === "string") parameters.append(key, value);
      else if (Array.isArray(value)) for (const item of value) parameters.append(key, item);
    }
    try { filters = parseCaseServiceRecordFilters(parameters); }
    catch { loadError = true; }
    const canRead = !context.demo && context.assuranceLevel === "aal2" &&
      ["clients.read", "case_service_records.read"].every((scope) => context.scopes.includes(scope));
    const canManage = canRead && context.scopes.includes("case_service_records.manage");
    const canSign = canRead && context.scopes.includes("case_service_records.sign");
    if (!context.demo && !canRead) loadError = true;
    if (!loadError) {
      try {
        [snapshot, recentAal2] = await Promise.all([
          loadCaseServiceRecordSnapshot(context, filters),
          canSign ? hasRecentAal2() : Promise.resolve(false),
        ]);
      } catch (error) {
        if (!(error instanceof CaseServiceRecordSnapshotError)) throw error;
        loadError = true;
      }
    }
    return <CaseServiceRecordsWorkspace page={page} filters={filters} snapshot={snapshot}
      loadError={loadError} actorUserId={context.userId} canManage={canManage}
      canSign={canSign} hasRecentAal2={recentAal2} />;
  }

  if (page.number === 52) {
    let filters = emptyClientServicePlanFilters();
    let snapshot = null;
    let loadError = false;
    let recentAal2 = false;
    const parameters = new URLSearchParams();
    for (const [key, value] of Object.entries(query)) {
      if (typeof value === "string") parameters.append(key, value);
      else if (Array.isArray(value)) for (const item of value) parameters.append(key, item);
    }
    try { filters = parseClientServicePlanFilters(parameters); }
    catch { loadError = true; }
    const canManage = !context.demo && context.assuranceLevel === "aal2" &&
      ["clients.read", "care_plans.read", "care_plans.write"].every((scope) => context.scopes.includes(scope));
    if (!loadError) {
      try {
        [snapshot, recentAal2] = await Promise.all([
          loadClientServicePlanSnapshot(context, filters),
          canManage ? hasRecentAal2() : Promise.resolve(false),
        ]);
      } catch (error) {
        if (!(error instanceof ClientServicePlanSnapshotError)) throw error;
        loadError = true;
      }
    }
    return <ClientServicePlanWorkspace page={page} filters={filters}
      snapshot={snapshot} loadError={loadError} canManage={canManage} hasRecentAal2={recentAal2}
      canApprove={canManage && context.scopes.includes("care_plans.approve")}
      canSign={canManage && context.scopes.includes("care_plans.sign")} />;
  }

  if (page.number === 53) {
    const serviceDate = parseServiceDate(
      typeof query.date === "string" ? query.date : undefined,
    );
    let snapshot = null;
    const canComplete =
      context.demo ||
      (context.scopes.includes("services.write") &&
        context.scopes.includes("services.sign"));
    let recentAal2 = context.demo;
    let loadError = false;
    try {
      [snapshot, recentAal2] = await Promise.all([
        loadServiceUsageSnapshot(context, serviceDate),
        context.demo
          ? Promise.resolve(true)
          : canComplete
            ? hasRecentAal2()
            : Promise.resolve(false),
      ]);
    } catch (error) {
      if (!(error instanceof ServiceManagementSnapshotError)) throw error;
      loadError = true;
    }
    const requestedStatus =
      typeof query.status === "string" ? query.status : "all";
    const status: "all" | ServiceEventStatus = [
      "planned",
      "in_progress",
      "completed",
      "cancelled",
      "voided",
    ].includes(requestedStatus)
      ? (requestedStatus as ServiceEventStatus)
      : "all";
    return (
      <ServiceUsageWorkspace
        canComplete={canComplete}
        hasRecentAal2={recentAal2}
        loadError={loadError}
        page={page}
        query={typeof query.q === "string" ? query.q.slice(0, 120) : ""}
        serviceDate={serviceDate}
        snapshot={snapshot}
        status={status}
      />
    );
  }

  if (page.number === 49) {
    let snapshot = null;
    let loadError = false;
    try {
      snapshot = await loadClaimReadSnapshot(context);
    } catch (error) {
      if (!(error instanceof ServiceManagementSnapshotError)) throw error;
      loadError = true;
    }
    const requestedStatus =
      typeof query.status === "string" ? query.status : "all";
    const status: "all" | ClaimStatus = [
      "draft",
      "validated",
      "exported",
      "submitted",
      "accepted",
      "rejected",
      "reconciled",
      "voided",
    ].includes(requestedStatus)
      ? (requestedStatus as ClaimStatus)
      : "all";
    const canValidate =
      context.demo || context.scopes.includes("claims.manage");
    const recentAal2 =
      context.demo || (canValidate ? await hasRecentAal2() : false);
    return (
      <ClaimsWorkspace
        canValidate={canValidate}
        hasRecentAal2={recentAal2}
        loadError={loadError}
        page={page}
        query={typeof query.q === "string" ? query.q.slice(0, 120) : ""}
        snapshot={snapshot}
        status={status}
      />
    );
  }

  if (page.number === 78) {
    const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
    const cleanText = (value: unknown, max: number) => typeof value === "string" &&
      value.length <= max && !/[\u0000-\u001f\u007f]/u.test(value)
      ? value.trim() : "";
    const requestedStaff = typeof query.staff === "string" ? query.staff : "all";
    const staffMembershipId = uuidPattern.test(requestedStaff)
      ? requestedStaff.toLowerCase() : null;
    const requestedType = typeof query.type === "string" ? query.type : "all";
    const cleanType = cleanText(requestedType, 160);
    const reportType = cleanType && cleanType !== "all" ? cleanType : null;
    const requestedValidity = typeof query.validity === "string"
      ? query.validity : "all";
    const validityStatus: StaffLabReportValidityFilter =
      STAFF_LAB_REPORT_VALIDITY_FILTERS.includes(
        requestedValidity as StaffLabReportValidityFilter,
      ) ? requestedValidity as StaffLabReportValidityFilter : "all";
    const requestedDuplicate = typeof query.duplicate === "string"
      ? query.duplicate : "all";
    const duplicateStatus: StaffLabReportDuplicateFilter =
      STAFF_LAB_REPORT_DUPLICATE_FILTERS.includes(
        requestedDuplicate as StaffLabReportDuplicateFilter,
      ) ? requestedDuplicate as StaffLabReportDuplicateFilter : "all";
    const requestedEvidence = typeof query.evidence === "string"
      ? query.evidence : "all";
    const evidenceStatus: StaffLabReportEvidenceFilter =
      STAFF_LAB_REPORT_EVIDENCE_FILTERS.includes(
        requestedEvidence as StaffLabReportEvidenceFilter,
      ) ? requestedEvidence as StaffLabReportEvidenceFilter : "all";
    const requestedFrom = typeof query.from === "string" ? query.from : "";
    const requestedTo = typeof query.to === "string" ? query.to : "";
    const dateFrom = requestedFrom && isStaffLabReportDate(requestedFrom)
      ? requestedFrom : null;
    const dateTo = requestedTo && isStaffLabReportDate(requestedTo)
      ? requestedTo : null;
    const requestedQuery = typeof query.q === "string" ? query.q : "";
    const filters: StaffLabReportFilters = {
      staffMembershipId, reportType, validityStatus, duplicateStatus,
      evidenceStatus, dateFrom, dateTo, query: cleanText(requestedQuery, 120),
    };
    const invalidFilters =
      (requestedStaff !== "all" && staffMembershipId === null) ||
      (requestedType !== "all" && reportType === null) ||
      !STAFF_LAB_REPORT_VALIDITY_FILTERS.includes(
        requestedValidity as StaffLabReportValidityFilter,
      ) || !STAFF_LAB_REPORT_DUPLICATE_FILTERS.includes(
        requestedDuplicate as StaffLabReportDuplicateFilter,
      ) || !STAFF_LAB_REPORT_EVIDENCE_FILTERS.includes(
        requestedEvidence as StaffLabReportEvidenceFilter,
      ) || (requestedFrom !== "" && dateFrom === null) ||
      (requestedTo !== "" && dateTo === null) ||
      (dateFrom !== null && dateTo !== null && dateTo < dateFrom) ||
      requestedQuery.length > 120 || /[\u0000-\u001f\u007f]/u.test(requestedQuery);
    const canManage = !context.demo && context.assuranceLevel === "aal2" &&
      context.scopes.includes("staff_health.read") &&
      context.scopes.includes("staff_health.manage");
    const recentAal2 = context.demo ? true : await hasRecentAal2();
    let snapshot = null;
    let loadError = invalidFilters;
    if (!loadError && recentAal2) {
      try {
        snapshot = await loadStaffLabReportSnapshot(context, filters, recentAal2);
      } catch (error) {
        if (!(error instanceof StaffLabReportSnapshotError)) throw error;
        loadError = true;
      }
    }
    return <StaffLabReportsWorkspace canManage={canManage} filters={filters}
      hasRecentAal2={recentAal2} loadError={loadError}
      page={page} snapshot={snapshot} />;
  }

  if (page.number === 80) {
    if (isSyntheticPreviewMode()) return <SyntheticImportPreview />;
    return <ImportWorkspace />;
  }

  if (page.number === 81) {
    let snapshot = null;
    let loadError = false;
    try {
      snapshot = await loadRoleGovernanceSnapshot(context);
    } catch (error) {
      if (!(error instanceof RoleGovernanceSnapshotError)) throw error;
      loadError = true;
    }
    const canManage = context.demo || context.scopes.includes("roles.manage");
    const recentAal2 =
      context.demo || (canManage ? await hasRecentAal2() : false);
    return (
      <RoleGovernanceWorkspace
        canManage={canManage}
        hasRecentAal2={recentAal2}
        loadError={loadError}
        page={page}
        snapshot={snapshot}
      />
    );
  }

  if (page.number === 82) {
    const requestedStatus =
      typeof query.status === "string" ? query.status : "all";
    const status: FormGovernanceStatusFilter = [
      "all",
      "draft",
      "pending",
      "published",
      "retired",
    ].includes(requestedStatus)
      ? (requestedStatus as FormGovernanceStatusFilter)
      : "all";
    const requestedScope =
      typeof query.scope === "string" ? query.scope : "all";
    const scope: FormGovernanceScopeFilter = [
      "all",
      "tenant",
      "official",
    ].includes(requestedScope)
      ? (requestedScope as FormGovernanceScopeFilter)
      : "all";
    const filters = {
      query: typeof query.q === "string" ? query.q.slice(0, 120) : "",
      status,
      scope,
      category:
        typeof query.category === "string" && query.category.length <= 120
          ? query.category
          : "all",
    };
    let snapshot = null;
    let loadError = false;
    try {
      snapshot = await loadFormGovernanceSnapshot(context);
    } catch (error) {
      if (!(error instanceof FormGovernanceSnapshotError)) throw error;
      loadError = true;
    }
    const canManage = context.demo || context.scopes.includes("forms.manage");
    const recentAal2 =
      context.demo || (canManage ? await hasCustomFormGovernanceAccess(context, true) : false);
    return (
      <FormRuleVersionsWorkspace
        key={[context.organizationId, context.branchId, context.userId,
          [...context.roles].sort().join(","), [...context.scopes].sort().join(","),
          context.assuranceLevel, String(recentAal2)].join(":")}
        canManage={canManage}
        filters={filters}
        hasRecentAal2={recentAal2}
        loadError={loadError}
        page={page}
        snapshot={snapshot}
      />
    );
  }

  if (page.number === 19) {
    const parameters = new URLSearchParams();
    for (const [key, value] of Object.entries(query)) {
      if (Array.isArray(value)) value.forEach((item) => parameters.append(key, item));
      else if (typeof value === "string") parameters.append(key, value);
    }
    let filters;
    try { filters = parseBodyAssessmentFilters(parameters); }
    catch {
      return <section className="empty-card" role="alert"><h1>身體評估查詢條件無效</h1>
        <p>請使用有效個案與紀錄狀態；不接受重複或額外條件。</p>
        <a className="button button--secondary" href="?">重設查詢</a></section>;
    }
    let snapshot;
    try { snapshot = await loadBodyAssessmentSnapshot(context, filters); }
    catch (error) {
      if (!(error instanceof BodyAssessmentSnapshotError)) throw error;
      return <section className="empty-card" role="alert"><h1>身體評估暫時無法載入</h1>
        <p>資料未取得；不會以展示資料或其他分支補位。</p>
        <a className="button button--secondary" href="?">重新載入</a></section>;
    }
    const recentAal2 = !context.demo && await hasRecentAal2();
    return <BodyAssessmentsWorkspace page={page} snapshot={snapshot} actorUserId={context.userId}
      canManage={!context.demo && context.scopes.includes("body_assessments.manage")}
      canSign={recentAal2 && context.scopes.includes("body_assessments.sign")} />;
  }

  if (page.number === 51) {
    const requestedClient = typeof query.client === "string" ? query.client : "";
    const selectedClientId = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(requestedClient)
      ? requestedClient.toLowerCase() : null;
    let snapshot = null;
    let loadError = false;
    try { snapshot = await loadNursingAssessmentSnapshot(context); }
    catch { loadError = true; }
    const recentAal2 = !context.demo && await hasRecentAal2();
    const authorizedNurse = !context.demo && context.roles.includes("nurse");
    return <NursingAssessmentsWorkspace snapshot={snapshot} loadError={loadError}
      initialClientId={selectedClientId}
      actorUserId={context.userId} hasRecentAal2={recentAal2}
      canManage={authorizedNurse && context.scopes.includes("nursing_assessments.manage")}
      canSign={authorizedNurse && context.scopes.includes("nursing_assessments.sign")} />;
  }

  if (page.number === 70) {
    const { periods, invalid } = parseReportPeriods(query);
    return <ReportsWorkspace demo={context.demo} invalid={invalid} periods={periods}
      operationalLinks={invalid ? [] : buildOperationalReportLinks(context, periods, await canReadStoreOverview(context))}
      entries={invalid ? [] : buildReportEntries(context, periods)} />;
  }

  if (page.number === 83) {
    const parameters = new URLSearchParams();
    for (const [key, value] of Object.entries(query)) {
      if (Array.isArray(value)) value.forEach((item) => parameters.append(key, item));
      else if (typeof value === "string") parameters.append(key, value);
    }
    let filters = defaultIntegrationsAuditFilters();
    let loadError = false;
    try { filters = parseIntegrationsAuditQuery(parameters); }
    catch { loadError = true; }
    const recentAal2 = context.demo || await hasRecentAal2();
    let snapshot = null;
    let dataInventorySnapshot: DataInventorySnapshot | null = null;
    let dataInventoryError = false;
    const canReadInventory = context.demo || (context.scopes.includes("audit.view") &&
      context.roles.some((role) => role === "organization_manager" || role === "branch_supervisor"));
    if (!loadError && recentAal2) {
      const [auditResult, inventoryResult] = await Promise.all([
        (async () => {
          try { return { value: await loadIntegrationsAuditSnapshot(context, filters, recentAal2), failed: false }; }
          catch (error) {
            if (!(error instanceof IntegrationsAuditSnapshotError)) throw error;
            return { value: null, failed: true };
          }
        })(),
        (async () => {
          if (!canReadInventory) return { value: null, failed: false };
          try { return { value: await loadDataInventorySnapshot(context), failed: false }; }
          catch { return { value: null, failed: true }; }
        })(),
      ]);
      snapshot = auditResult.value;
      loadError = auditResult.failed;
      dataInventorySnapshot = inventoryResult.value;
      dataInventoryError = inventoryResult.failed;
    }
    return <IntegrationsAuditWorkspace filters={filters} hasRecentAal2={recentAal2}
      loadError={loadError} page={page} snapshot={snapshot}
      financeConfiguration={snapshot && !loadError && recentAal2 && canReadInventory ?
        <FinanceConfigurationPanel
          check={inspectFinanceConfiguration(isSyntheticReadMode() ? {} : env, context)}
          canOpenOverview={await canReadStoreOverview(context)} /> : null}
      dataInventory={canReadInventory ? <DataInventoryWorkspace snapshot={dataInventorySnapshot}
        canManage={!context.demo && recentAal2} canReview={!context.demo && recentAal2}
        hasRecentAal2={recentAal2} actorUserId={context.userId} loadError={dataInventoryError} /> :
        <section id="data-inventory" className="callout" role="note"><h2>資料盤點與缺漏追蹤</h2>
          <p>資料盤點僅限具有稽核查閱權限的管理員；目前沒有權限，未讀取盤點資料。</p></section>} />;
  }

  return (
    <OperationalWorkspace
      demo={isSyntheticReadMode()}
      initialRecords={isSyntheticReadMode() ? buildDemoRecords(page) : []}
      moduleTitle={getModule(page.moduleId).title}
      page={page}
    />
  );
}
