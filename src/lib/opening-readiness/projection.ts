import type { TenantContext } from "@/lib/domain/types";
import { roleDisplayName } from "@/lib/domain/roles";
import type { OrganizationProfileSnapshot } from "@/lib/organization-profile/types";
import type { StaffManagementSnapshot } from "@/lib/staff-management/types";
import type { ClientMasterSnapshot } from "@/lib/clients/master-types";
import type { CareRosterSnapshot } from "@/lib/care-roster/types";
import { taipeiDayBoundsUtc } from "@/lib/core-care/date";
import { canViewOpeningReadiness, type OpeningReadinessItem, type OpeningReadinessSnapshot } from "./types";

export type ReadinessSource<T> = { status: "available"; data: T } | { status: "unavailable" };
export type OpeningReadinessSources = {
  institution: ReadinessSource<OrganizationProfileSnapshot>;
  staff: ReadinessSource<StaffManagementSnapshot>;
  clients: ReadinessSource<ClientMasterSnapshot>;
  roster: ReadinessSource<CareRosterSnapshot>;
};

const route = (slug: string) => `/app/staff/${slug}`;
function fresh(value: { generatedAt: string; staleAfter?: string }, now: Date) {
  const generated = Date.parse(value.generatedAt);
  const deadline = value.staleAfter ? Date.parse(value.staleAfter) : generated + 300_000;
  return Number.isFinite(generated) && Number.isFinite(deadline) && generated <= now.getTime() + 30_000 &&
    generated >= now.getTime() - 300_000 && deadline > now.getTime();
}

/** Only trusted, tenant-checked snapshots enter this server-side projection; no client or staff details leave it. */
export function projectOpeningReadiness({ context, serviceDate, sources, now = new Date() }: {
  context: TenantContext;
  serviceDate: string;
  sources: OpeningReadinessSources;
  now?: Date;
}): OpeningReadinessSnapshot {
  if (!canViewOpeningReadiness(context)) return { status: "forbidden" };
  taipeiDayBoundsUtc(serviceDate);
  const scoped = (value: { organizationId: string; branchId: string; demo: boolean }) =>
    value.organizationId === context.organizationId && value.branchId === context.branchId && value.demo === context.demo;
  const organization = sources.institution.status === "available" && scoped(sources.institution.data) &&
    fresh(sources.institution.data, now) && !sources.institution.data.versionsTruncated ? sources.institution.data : null;
  const staff = sources.staff.status === "available" && scoped(sources.staff.data) && fresh(sources.staff.data, now) &&
    !sources.staff.data.employeesTruncated ? sources.staff.data : null;
  const clients = sources.clients.status === "available" && sources.clients.data.demo === context.demo &&
    fresh(sources.clients.data, now) ? sources.clients.data : null;
  const rawRoster = sources.roster.status === "available" ? sources.roster.data : null;
  const roster = rawRoster && rawRoster.demo === context.demo && rawRoster.status !== "unavailable" && rawRoster.manager &&
    rawRoster.assignments.every((entry) => entry.serviceDate === serviceDate) ? rawRoster : null;
  const activeVersions = organization?.versions.filter((v) => v.effectiveFrom <= serviceDate && (!v.effectiveTo || v.effectiveTo >= serviceDate));
  const validInstitution = activeVersions?.length === 1 && activeVersions.every((v) =>
    v.permitNumber.trim() && v.contactPhone.trim() && v.contactAddress.trim() && v.approvedCapacity > 0 &&
    v.serviceItems.length > 0 && v.permitIssuedOn <= serviceDate && (!v.permitValidThrough || v.permitValidThrough >= serviceDate));
  const activeStaff = staff?.employees.filter((e) => e.membershipStatus === "active" && e.profileIsActive &&
    e.membershipStartsOn <= serviceDate && (!e.membershipEndsOn || e.membershipEndsOn >= serviceDate));
  const unpreparedStaff = activeStaff?.filter((e) => !e.roleCount || e.employmentGovernanceStatus !== "versioned").length ?? 0;
  const activeClients = clients?.clients.filter((c) => c.status === "active" && c.admittedOn && c.admittedOn <= serviceDate &&
    (!c.endedOn || c.endedOn >= serviceDate));
  const pendingClients = clients?.clients.filter((c) => c.status === "active" && !c.admittedOn).length ?? 0;
  const scheduled = roster?.assignments.filter((r) => r.state === "scheduled" && r.isServiceEligible === true && r.serviceEligibility === "eligible");
  const blockedAssignments = roster?.assignments.filter((r) => r.state === "scheduled" && (r.isServiceEligible !== true || r.serviceEligibility !== "eligible")).length ?? 0;
  const staffIds = new Set(activeStaff?.filter((e) => e.roleCount > 0 && e.employmentGovernanceStatus === "versioned").map((e) => e.profileId));
  const clientIds = new Set(activeClients?.map((c) => c.id));
  const rosterMissing = scheduled?.filter((r) => !r.staffUserId || !staffIds.has(r.staffUserId) || !clientIds.has(r.clientId) || r.tasks.length === 0).length ?? 0;
  const expiredCertificates = activeStaff?.filter((s) => s.expiredCertificateTotal > 0).length ?? 0;
  const missingCertificates = activeStaff?.filter((s) => s.certificateTotal === 0).length ?? 0;
  const unavailable = "目前無法核對，請重新檢查或由具權限人員處理；不代表沒有資料。";
  const items: OpeningReadinessItem[] = [
    { id: "institution", title: "機構基本資料", owner: roleDisplayName("branch_supervisor"), sourceLabel: "已核准機構版本",
      status: !organization ? "unavailable" : validInstitution ? "ready" : "needs_attention",
      summary: !organization ? unavailable : validInstitution ? "此日期有一份有效基本資料，已填許可、容量、服務與聯絡資料；法遵適用性仍須人工核對。" : "請補齊此日期適用的核准版本、許可期限、容量、服務及聯絡資料。",
      actionLabel: "檢查機構資料", href: `${route("operations/organization")}?effectiveOn=${serviceDate}` },
    { id: "staff", title: "員工帳號與聘僱", owner: roleDisplayName("branch_supervisor"), sourceLabel: "目前分支員工與聘僱版本",
      status: !staff ? "unavailable" : !activeStaff?.length || unpreparedStaff > 0 ? "needs_attention" : "ready",
      summary: !staff ? unavailable : !activeStaff?.length ? "尚無此日期有效的啟用員工，請安排每人自己的公司帳號與聘僱資料。" : `${activeStaff.length} 位有效員工；${unpreparedStaff} 位需補聘僱版本或角色。帳號可登入仍須由本人實測。`,
      actionLabel: "處理員工資料", href: route("operations/staff") },
    { id: "qualifications", title: "員工證照與服務資格", owner: roleDisplayName("branch_supervisor"), sourceLabel: "目前分支有效員工的證照終端事實；服務資格規則待驗收",
      status: !staff ? "unavailable" : !activeStaff?.length || expiredCertificates > 0 || missingCertificates > 0 ? "needs_attention" : "manual_review",
      summary: !staff ? unavailable : !activeStaff?.length ? "請先建立當班員工，再核對必要證照與可執行服務。" : `目前分支有效員工中，${expiredCertificates} 位有已過期證照，${missingCertificates} 位尚無證照資料。證照存在不等於適用服務資格已通過，須由主管核對當班安排。`,
      actionLabel: "核對員工證照", href: route("operations/staff-certificates") },
    { id: "clients", title: "個案名冊與收案", owner: roleDisplayName("case_manager_social_worker"), sourceLabel: "目前分支個案主檔與收案日期",
      status: !clients ? "unavailable" : !activeClients?.length || pendingClients > 0 ? "needs_attention" : "ready",
      summary: !clients ? unavailable : `${activeClients?.length ?? 0} 位此日期可服務個案；${pendingClients} 位尚未完成收案日期。可人工建檔，不必為了建檔強制匯入 CMS。`,
      actionLabel: pendingClients ? "補齊收案資料" : "檢查個案名冊", href: route(pendingClients ? "operations/client-transitions" : "operations/clients") },
    { id: "contacts", title: "個案緊急聯絡與告知同意", owner: roleDisplayName("case_manager_social_worker"), sourceLabel: "需逐案核對正式文件",
      status: "manual_review", summary: "請逐案確認主要／緊急聯絡人、聯絡方式與告知同意。現有名冊不含這些欄位的完整驗證證據，不能自動判定齊全。",
      actionLabel: "核對個案資料", href: route("operations/clients") },
    { id: "roster", title: "當日個案與照顧分工", owner: roleDisplayName("branch_supervisor"), sourceLabel: "指定日期上午／下午照顧安排",
      status: !roster || !clients || !staff ? "unavailable" : !scheduled?.length || rosterMissing > 0 || blockedAssignments > 0 ? "needs_attention" : "ready",
      summary: !roster || !clients || !staff ? unavailable : (!scheduled?.length ? "尚無此日期的照顧安排；請新增班次，或由主管確認當日沒有服務。" : `${new Set(scheduled.map((r) => r.clientId)).size} 位個案、${scheduled.length} 個班次；${rosterMissing} 個班次需補有效個案、員工或工作項目。這是分工檢查，不是已完成照顧。`) + (blockedAssignments ? `另有 ${blockedAssignments} 個未正式收案或不在服務期間的既有分工，未列入當日班次；請主管核對並取消。` : ""),
      actionLabel: "安排當日工作", href: `${route("workspace/dashboard")}?date=${serviceDate}` },
    { id: "care_basis", title: "照顧依據與交接", owner: `${roleDisplayName("nurse")}／${roleDisplayName("case_manager_social_worker")}`, sourceLabel: "需核對現行計畫與個案需求",
      status: "manual_review", summary: "逐案核對目前有效計畫、醫囑與必要交接；CMS 候選提醒須經確認，不能代替正式照顧指示。",
      actionLabel: "核對照顧計畫", href: route("service-management/client-service-plans") },
    { id: "data_safety", title: "真實資料交付與安全審查", owner: `${roleDisplayName("organization_manager")}／資料保護負責人`, sourceLabel: "需提供核准與安全測試證據",
      status: "manual_review", summary: "確認個資交付途徑、委外／跨境審查、角色隔離及正式驗收。尚未取得證據，不核准新增真實資料或完整上線。",
      actionLabel: "查看準備與稽核", href: route("governance/integrations-audit") },
    { id: "recovery", title: "停機備援與還原演練", owner: `${roleDisplayName("platform_ops")}／${roleDisplayName("branch_supervisor")}`, sourceLabel: "需實際演練紀錄與責任人",
      status: "manual_review", summary: "確認備份能還原、停機時使用的紙本或原系統，以及值班聯絡與回補負責人。沒有演練證據，不視為備援完成。",
      actionLabel: "查看備援待辦", href: route("governance/integrations-audit") },
  ];
  const counts = { ready: 0, needs_attention: 0, unavailable: 0, manual_review: 0 };
  items.forEach((item) => { counts[item.status] += 1; });
  return { status: counts.unavailable ? "unavailable" : counts.needs_attention ? "needs_attention" : "manual_review",
    scope: { organizationId: context.organizationId, organizationName: context.organizationName, branchId: context.branchId, branchName: context.branchName },
    serviceDate, generatedAt: now.toISOString(), staleAfter: new Date(now.getTime() + 60_000).toISOString(), demo: context.demo,
    items, counts, fullLaunchApproved: false, realDataIntakeApproved: false };
}
