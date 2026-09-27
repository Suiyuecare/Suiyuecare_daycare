import "server-only";
import { z } from "zod";
import type { TenantContext } from "@/lib/domain/types";
import { IntegrationError } from "@/lib/integrations/errors";
import { sourcesSnapshotSchema, type StaffCertificateDocumentSourcesSnapshot } from "./recovery-schema";
import type { StaffCertificateDocumentsSnapshot } from "./schema";
import { loadStaffCertificateDocumentSources } from "./sources";
import { isStaffCertificateDocumentReadAtOrAfter, isStaffCertificateDocumentReadFresh, loadStaffCertificateDocumentsSnapshot, staffCertificateDocumentRead, type StaffCertificateDocumentSourceRow } from "./snapshot";

export type StaffCertificateDocumentsWorkspaceQuery = Record<string, string | string[] | undefined>;
export interface StaffCertificateDocumentsWorkspaceSelection {
  view: "documents";
  staffMembershipId: string | null;
  page: number;
  versionId: string | null;
}
export interface StaffCertificateDocumentWorkspaceSource {
  sources: StaffCertificateDocumentSourcesSnapshot;
  selected: StaffCertificateDocumentSourceRow | null;
  documents: StaffCertificateDocumentsSnapshot | null;
}
const invalid = () => new IntegrationError("INVALID_STAFF_DOCUMENT_QUERY", "請重新選擇員工、清單頁數與證照版本。", 400);
const uncertain = () => new IntegrationError("STAFF_DOCUMENT_READ_UNAVAILABLE", "員工證照資料尚未完整核對，請稍後重試。", 503);
const uuid = z.uuid().transform(value => value.toLowerCase());

/** Reject legacy metadata filters and duplicates rather than quietly widening
 * their meaning to every employee. Missing view is only the read-only fallback. */
export function parseStaffCertificateDocumentsWorkspaceQuery(query: StaffCertificateDocumentsWorkspaceQuery): StaffCertificateDocumentsWorkspaceSelection {
  const allowed = new Set(["view", "staff", "page", "version"]);
  let values: StaffCertificateDocumentsWorkspaceQuery;
  try {
    if (!query || typeof query !== "object" || Array.isArray(query) ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(query)) || Object.getOwnPropertySymbols(query).length) throw invalid();
    const descriptors = Object.getOwnPropertyDescriptors(query);
    if (Object.entries(descriptors).some(([key, descriptor]) => !allowed.has(key) || !Object.hasOwn(descriptor, "value") ||
      (descriptor.value !== undefined && (typeof descriptor.value !== "string" || descriptor.value.length === 0)))) throw invalid();
    values = Object.fromEntries(Object.entries(descriptors).map(([key, descriptor]) => [key, descriptor.value]));
  } catch { throw invalid(); }
  if (values.view !== undefined && values.view !== "documents") throw invalid();
  const staff = values.staff === undefined || values.staff === "all" ? null : uuid.safeParse(values.staff);
  const version = values.version === undefined ? null : uuid.safeParse(values.version);
  if ((staff !== null && !staff.success) || (version !== null && !version.success)) throw invalid();
  const page = values.page === undefined ? 1 : typeof values.page === "string" && /^[1-9]\d{0,4}$/u.test(values.page) ? Number(values.page) : 0;
  if (page < 1 || page > 10000) throw invalid();
  return { view: "documents", staffMembershipId: staff === null ? null : staff.data,
    page, versionId: version === null ? null : version.data };
}

/** Page-72 document-only SSR projection. A record pointer is usable only if it
 * appears in this authorized source page; no implicit first-row selection. */
export async function loadStaffCertificateDocumentWorkspace(context: TenantContext, query: StaffCertificateDocumentsWorkspaceQuery,
  signal?: AbortSignal): Promise<StaffCertificateDocumentWorkspaceSource> {
  const selection = parseStaffCertificateDocumentsWorkspaceQuery(query);
  return staffCertificateDocumentRead(context, signal, async (actor, readSignal) => {
    const raw = await loadStaffCertificateDocumentSources(actor, {
      staffMembershipId: selection.staffMembershipId, page: selection.page,
    }, undefined, readSignal);
    if (readSignal.aborted) throw uncertain();
    const proof = sourcesSnapshotSchema.safeParse(raw);
    if (!proof.success || proof.data.organizationId !== actor.organizationId || proof.data.branchId !== actor.branchId ||
      proof.data.actorUserId !== actor.userId || proof.data.staffMembershipId !== selection.staffMembershipId ||
      proof.data.page !== selection.page || !isStaffCertificateDocumentReadFresh(proof.data.generatedAt) ||
      (proof.data.canManageDocuments && !actor.scopes.includes("staff_certificates.manage"))) throw uncertain();
    const sources = proof.data;
    if (selection.versionId === null) return { sources, selected: null, documents: null };
    const selected = sources.rows.find(row => row.recordVersionId === selection.versionId);
    if (!selected) throw invalid();
    const documents = await loadStaffCertificateDocumentsSnapshot(actor, selected, readSignal);
    if (readSignal.aborted || !isStaffCertificateDocumentReadFresh(sources.generatedAt) ||
      !isStaffCertificateDocumentReadFresh(documents.generatedAt) ||
      !isStaffCertificateDocumentReadAtOrAfter(documents.generatedAt, sources.generatedAt)) throw uncertain();
    return { sources, selected, documents };
  });
}
