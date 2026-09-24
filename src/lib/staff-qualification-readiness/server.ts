import "server-only";
import type { TenantContext } from "@/lib/domain/types";
import { IntegrationError } from "@/lib/integrations/errors";
import { loadStaffCertificateSnapshot } from "@/lib/staff-certificates/snapshot";
import type { QualificationFilters } from "./model";
import { projectQualificationReport } from "./projection";

export function canReadQualificationReport(context: TenantContext) {
  return context.demo || (context.assuranceLevel === "aal2" && context.scopes.includes("staff_certificates.read"));
}

export async function loadQualificationReport(context: TenantContext, filters: QualificationFilters) {
  if (!canReadQualificationReport(context)) throw new IntegrationError("QUALIFICATION_NOT_AUTHORIZED", "目前帳號沒有員工證照查閱權限，或尚未符合既有身分確認要求。", 403);
  try {
    // Existing RPC performs branch/member authorization and transactional read
    // auditing. Never use a privileged client or load employee health records.
    const source = await loadStaffCertificateSnapshot(context, {
      staffMembershipId: filters.staff, certificateType: null, status: "all", query: "",
    });
    return projectQualificationReport(source, context, filters);
  } catch {
    throw new IntegrationError("QUALIFICATION_SOURCE_UNAVAILABLE", "員工證照資料暫時無法確認；請重新讀取，不要將此狀態當成沒有待辦。", 503);
  }
}
