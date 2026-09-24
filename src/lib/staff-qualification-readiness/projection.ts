import { isStaffCertificateDate, staffCertificateTaipeiDate } from "@/lib/staff-certificates/date";
import type { StaffCertificateSnapshot } from "@/lib/staff-certificates/types";
import { QUALIFICATION_ISSUES, type QualificationFilters, type QualificationIssue, type QualificationReport, type QualificationRow } from "./model";

const DAY = 86_400_000;
function dateValue(day: string) {
  if (!isStaffCertificateDate(day)) throw new Error("QUALIFICATION_DATE_INVALID");
  return Date.parse(`${day}T00:00:00Z`);
}
export function qualificationDaysBetween(from: string, through: string) {
  return (dateValue(through) - dateValue(from)) / DAY;
}

export function projectQualificationReport(source: StaffCertificateSnapshot, scope: {
  organizationId: string; branchId: string; branchName: string;
}, filters: QualificationFilters): QualificationReport {
  // Only consume the all-status/all-type audited snapshot. A filtered source must
  // never be interpreted as evidence that a member has no certificate.
  if (source.organizationId !== scope.organizationId || source.branchId !== scope.branchId ||
    source.filters.status !== "all" || source.filters.certificateType !== null || source.filters.query !== "" ||
    source.filters.staffMembershipId !== filters.staff ||
    staffCertificateTaipeiDate(source.generatedAt) !== source.snapshotDate) {
    throw new Error("QUALIFICATION_SOURCE_INVALID");
  }
  const today = dateValue(source.snapshotDate);
  const currentStaff = source.staffOptions.filter((staff) => staff.isCurrent && (!filters.staff || staff.staffMembershipId === filters.staff));
  const currentIds = new Set(currentStaff.map((staff) => staff.staffMembershipId));
  const currentById = new Map(currentStaff.map((staff) => [staff.staffMembershipId, staff]));
  const records = source.records.filter((record) => record.recordStatus === "active" && currentIds.has(record.staffMembershipId));
  const rows: QualificationRow[] = records.map((record) => {
    const issues: QualificationIssue[] = [];
    const days = record.expiresOn === null ? null : qualificationDaysBetween(source.snapshotDate, record.expiresOn);
    if (days === null) issues.push("unknown_expiry");
    else if (days < 0) issues.push("expired");
    else if (days <= 30) issues.push("due_soon");
    if (record.registrationStatus === "pending" || record.registrationStatus === "suspended") issues.push("registration");
    if (record.verificationStatus !== "verified") issues.push("verification");
    if (record.evidenceStatus === "missing") issues.push("evidence");
    if (dateValue(record.effectiveOn) > today) issues.push("not_effective");
    const member = currentById.get(record.staffMembershipId)!;
    return { key: record.certificateKey, staffMembershipId: record.staffMembershipId,
      staffName: member.displayName, employeeCode: member.employeeCode,
      certificateType: record.certificateType, certificateVersion: record.version,
      effectiveOn: record.effectiveOn, expiresOn: record.expiresOn, daysToExpiry: days, issues,
      actionHref: `/app/staff/operations/staff-certificates?${new URLSearchParams({ staff: record.staffMembershipId, type: record.certificateType })}` };
  });
  if (!source.recordsTruncated) {
    const withRecord = new Set(records.map((record) => record.staffMembershipId));
    for (const staff of currentStaff) if (!withRecord.has(staff.staffMembershipId)) rows.push({
      key: `missing:${staff.staffMembershipId}`, staffMembershipId: staff.staffMembershipId,
      staffName: staff.displayName, employeeCode: staff.employeeCode,
      certificateType: null, certificateVersion: null, effectiveOn: null, expiresOn: null,
      daysToExpiry: null, issues: ["missing_record"],
      actionHref: `/app/staff/operations/staff-certificates?${new URLSearchParams({ staff: staff.staffMembershipId })}`,
    });
  }
  const rank = (row: QualificationRow) => row.issues.length === 0 ? 99 : Math.min(...row.issues.map((issue) => QUALIFICATION_ISSUES.indexOf(issue)));
  rows.sort((a, b) => rank(a) - rank(b) || (a.daysToExpiry ?? Infinity) - (b.daysToExpiry ?? Infinity) || a.staffName.localeCompare(b.staffName, "zh-TW") || a.key.localeCompare(b.key));
  const query = filters.query.toLocaleLowerCase("zh-TW");
  const selectedRows = rows.filter((row) => !query || [row.staffName, row.employeeCode, row.certificateType]
    .join(" ").toLocaleLowerCase("zh-TW").includes(query));
  const counts = Object.fromEntries(QUALIFICATION_ISSUES.map((issue) => [issue, selectedRows.filter((row) => row.issues.includes(issue)).length])) as QualificationReport["counts"];
  return { organizationId: scope.organizationId, branchId: scope.branchId, branchName: scope.branchName,
    generatedAt: source.generatedAt, snapshotDate: source.snapshotDate,
    staleAfter: source.staleAfter, dueThrough: new Date(today + 30 * DAY).toISOString().slice(0, 10), filters,
    rows: selectedRows.filter((row) => filters.issue === "all" || row.issues.includes(filters.issue)),
    totalRows: selectedRows.length, counts, visibleCurrentStaff: currentStaff.length,
    incomplete: source.recordsTruncated || source.staffTruncated,
    missingRecordsKnown: !source.recordsTruncated && !source.staffTruncated,
    sourceRecordTotal: source.recordTotal, sourceRecordCount: source.records.length,
    staffOptions: source.staffOptions.filter((staff) => staff.isCurrent).map((staff) => ({ id: staff.staffMembershipId, name: staff.displayName })),
    serviceEligibility: "not_evaluated", demo: source.demo };
}
