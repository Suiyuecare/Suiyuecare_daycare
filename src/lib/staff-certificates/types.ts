export const STAFF_CERTIFICATE_STATUS_FILTERS = [
  "all", "active", "upcoming", "expired", "pending_verification",
  "registration_not_active", "voided",
] as const;
export type StaffCertificateStatusFilter =
  (typeof STAFF_CERTIFICATE_STATUS_FILTERS)[number];

export type StaffCertificateFilters = {
  staffMembershipId: string | null;
  certificateType: string | null;
  status: StaffCertificateStatusFilter;
  query: string;
};

export type StaffCertificateRecord = {
  recordVersionId: string;
  certificateKey: string;
  version: number;
  previousVersionId: string | null;
  recordStatus: "active" | "voided";
  correctionReason: string | null;
  staffMembershipId: string;
  staffUserId: string;
  staffDisplayName: string;
  staffEmployeeCode: string | null;
  certificateType: string;
  certificateNumber: string;
  effectiveOn: string;
  expiresOn: string | null;
  registrationStatus: "pending" | "registered" | "not_required" | "suspended";
  verificationStatus: "pending" | "verified" | "rejected";
  evidenceStatus: "provided" | "missing" | "not_applicable";
  validityStatus: Exclude<StaffCertificateStatusFilter, "all">;
  hasActiveException: boolean;
  approvalCount: number;
  serviceEligibilityStatus: "not_evaluated";
  recordedBy: string;
  recordedByDisplayName: string;
  recordedAt: string;
  contentHash: string;
};

export type StaffCertificateHistory = Pick<StaffCertificateRecord,
  "recordVersionId" | "certificateKey" | "version" | "previousVersionId" |
  "recordStatus" | "correctionReason" | "certificateType" |
  "certificateNumber" | "effectiveOn" | "expiresOn" | "registrationStatus" |
  "verificationStatus" | "evidenceStatus" | "recordedByDisplayName" |
  "recordedAt" | "contentHash">;

export type StaffCertificateStaffOption = {
  staffMembershipId: string;
  staffUserId: string;
  displayName: string;
  employeeCode: string | null;
  isCurrent: boolean;
};

export type StaffCertificateTypeOption = {
  certificateType: string;
  recordCount: number;
};

export type StaffCertificateExceptionApproval = {
  approvalNumber: 1 | 2;
  approvedBy: string;
  approverDisplayName: string;
  approvedAt: string;
};

export type StaffCertificateExceptionRequest = {
  requestId: string;
  certificateKey: string;
  certificateVersionId: string;
  expectedCertificateVersion: number;
  validFrom: string;
  validThrough: string;
  reason: string;
  requestedBy: string;
  requesterDisplayName: string;
  requestedAt: string;
  approvalCount: number;
  exceptionStatus: "pending" | "approved" | "expired";
  approvals: readonly StaffCertificateExceptionApproval[];
};

export type StaffCertificateSnapshot = {
  organizationId: string;
  branchId: string;
  generatedAt: string;
  snapshotDate: string;
  staleAfter: string;
  filters: StaffCertificateFilters;
  records: readonly StaffCertificateRecord[];
  recordTotal: number;
  recordsTruncated: boolean;
  validTotal: number;
  expiredTotal: number;
  pendingVerificationTotal: number;
  history: readonly StaffCertificateHistory[];
  historyTotal: number;
  historyTruncated: boolean;
  staffOptions: readonly StaffCertificateStaffOption[];
  staffTotal: number;
  staffTruncated: boolean;
  certificateTypeOptions: readonly StaffCertificateTypeOption[];
  certificateTypeTotal: number;
  certificateTypesTruncated: boolean;
  exceptionRequests: readonly StaffCertificateExceptionRequest[];
  exceptionRequestTotal: number;
  exceptionRequestsTruncated: boolean;
  expiryReminderPolicyStatus: "not_configured";
  expiryNoticeDays: null;
  expiringTotal: null;
  restrictedServicePolicyStatus: "not_configured";
  serviceEligibilityScope: "not_evaluated";
  attachmentPipelineStatus: "not_configured";
  attachmentScanStatus: "not_configured";
  demo: boolean;
};

export type StaffCertificateRecordInput =
  | {
    action: "create" | "correct";
    certificateKey: string;
    previousVersionId: string | null;
    expectedBaseVersion: number;
    staffMembershipId: string;
    certificateType: string;
    certificateNumber: string;
    effectiveOn: string;
    expiresOn: string | null;
    registrationStatus: "pending" | "registered" | "not_required" | "suspended";
    verificationStatus: "pending" | "verified" | "rejected";
    evidenceStatus: "missing" | "not_applicable";
    attachmentReference: null;
    attachmentSha256: null;
    correctionReason: string | null;
    idempotencyKey: string;
  }
  | {
    action: "void";
    certificateKey: string;
    previousVersionId: string;
    expectedBaseVersion: number;
    staffMembershipId: string;
    certificateType: null;
    certificateNumber: null;
    effectiveOn: null;
    expiresOn: null;
    registrationStatus: null;
    verificationStatus: null;
    evidenceStatus: null;
    attachmentReference: null;
    attachmentSha256: null;
    correctionReason: string;
    idempotencyKey: string;
  };

export type StaffCertificateRecordReceipt = {
  organizationId: string;
  branchId: string;
  certificateKey: string;
  recordVersionId: string;
  version: number;
  previousVersionId: string | null;
  recordStatus: "active" | "voided";
  staffMembershipId: string;
  contentHash: string;
  recordedAt: string;
  replayed: boolean;
  persisted: true;
  demo: false;
};

export type StaffCertificateExceptionInput =
  | {
    action: "request";
    certificateKey: string;
    certificateVersionId: string;
    expectedCertificateVersion: number;
    validFrom: string;
    validThrough: string;
    reason: string;
    requestId: null;
    expectedApprovalCount: null;
    idempotencyKey: string;
  }
  | {
    action: "approve";
    requestId: string;
    expectedCertificateVersion: number;
    expectedApprovalCount: 0 | 1;
    certificateKey: string;
    certificateVersionId: string;
    validFrom: null;
    validThrough: null;
    reason: null;
    idempotencyKey: string;
  };

export type StaffCertificateExceptionReceipt = {
  organizationId: string;
  branchId: string;
  action: "request" | "approve";
  requestId: string;
  certificateKey: string;
  certificateVersionId: string;
  expectedCertificateVersion: number;
  approvalId: string | null;
  approvalCount: 0 | 1 | 2;
  exceptionStatus: "pending" | "approved";
  validFrom: string;
  validThrough: string;
  committedAt: string;
  replayed: boolean;
  persisted: true;
  demo: false;
};
