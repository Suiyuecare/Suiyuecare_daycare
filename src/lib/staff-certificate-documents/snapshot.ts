import "server-only";
import { z } from "zod";
import type { TenantContext } from "@/lib/domain/types";
import { IntegrationError } from "@/lib/integrations/errors";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { sourcesSnapshotSchema, type StaffCertificateDocumentSourcesSnapshot } from "./recovery-schema";
import { documentsSnapshotSchema, type StaffCertificateDocumentsSnapshot } from "./schema";

export type StaffCertificateDocumentSourceRow = StaffCertificateDocumentSourcesSnapshot["rows"][number];

const unavailable = () => new IntegrationError("STAFF_DOCUMENT_READ_UNAVAILABLE", "員工證照資料尚未完整核對，請稍後重試。", 503);
const forbidden = () => new IntegrationError("STAFF_DOCUMENT_READ_FORBIDDEN", "目前無法查看這份員工證照資料，請重新確認授權範圍。", 403);
const invalid = () => new IntegrationError("INVALID_STAFF_DOCUMENT_QUERY", "請重新選擇員工與證照版本。", 400);

/** Preserve PostgreSQL microseconds at the freshness boundary. */
function timestampMicros(value: string): bigint | null {
  const match = /^(.*?)(?:\.(\d{1,6}))?(Z|[+-]\d{2}:\d{2})$/u.exec(value);
  if (!match) return null;
  const millis = Date.parse(`${match[1]}${match[3]}`);
  if (!Number.isSafeInteger(millis)) return null;
  return BigInt(millis) * BigInt(1000) + BigInt((match[2] ?? "").padEnd(6, "0"));
}
export function isStaffCertificateDocumentReadFresh(value: string, now = Date.now()) {
  const micros = timestampMicros(value);
  if (micros === null || !Number.isSafeInteger(now)) return false;
  const observed = BigInt(now) * BigInt(1000);
  return micros >= observed - BigInt(60000000) && micros <= observed + BigInt(1000000);
}
export function isStaffCertificateDocumentReadAtOrAfter(value: string, source: string) {
  const current = timestampMicros(value), previous = timestampMicros(source);
  return current !== null && previous !== null && current >= previous;
}

function safeReadFailure(error: unknown) {
  if (error instanceof IntegrationError && error.httpStatus === 400) return invalid();
  if (error instanceof IntegrationError && (error.httpStatus === 401 || error.httpStatus === 403)) return forbidden();
  return unavailable();
}

/** One bound for the entire user-scoped read, including admission, both RPCs
 * and projection. Capture caller context before awaiting; no refreshed actor,
 * recent-MFA inference, privileged client or automatic retry is introduced. */
export async function staffCertificateDocumentRead<T>(context: TenantContext, signal: AbortSignal | undefined,
  operation: (actor: TenantContext, signal: AbortSignal) => Promise<T>): Promise<T> {
  let stopped = false;
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let abort: (() => void) | undefined;
  try {
    const identity = z.object({ organizationId: z.uuid(), branchId: z.uuid(), userId: z.uuid() }).safeParse(context);
    if (!identity.success || context.demo || context.assuranceLevel !== "aal2" || !context.scopes.includes("staff_certificates.read")) throw forbidden();
    const actor: TenantContext = { ...context, scopes: [...context.scopes], roles: [...context.roles] };
    const active = () => { if (stopped || signal?.aborted) throw unavailable(); };
    const bound = new Promise<never>((_, reject) => {
      abort = () => { stopped = true; controller.abort(); reject(unavailable()); };
      if (signal?.aborted) { abort(); return; }
      signal?.addEventListener("abort", abort, { once: true });
      timer = setTimeout(abort, 20000);
    });
    return await Promise.race([(async () => {
      active(); const value = await operation(actor, controller.signal); active(); return value;
    })(), bound]);
  } catch (error) { throw safeReadFailure(error); }
  finally {
    stopped = true; clearTimeout(timer); controller.abort();
    if (abort) signal?.removeEventListener("abort", abort);
  }
}

/** Selected-source-only document history. This is not a download, scanner,
 * upload configuration check or expansion of the legacy certificate writer. */
export async function loadStaffCertificateDocumentsSnapshot(context: TenantContext, selected: StaffCertificateDocumentSourceRow,
  signal?: AbortSignal): Promise<StaffCertificateDocumentsSnapshot> {
  // Use the same compiled row validator as the source page, without accepting
  // an arbitrary record pointer or inventing certificate metadata.
  const parsed = sourcesSnapshotSchema.shape.rows.element.safeParse(selected);
  if (!parsed.success) throw invalid();
  const row = parsed.data;
  return staffCertificateDocumentRead(context, signal, async (actor, readSignal) => {
    if (row.staffUserId !== actor.userId && !actor.scopes.includes("staff_certificates.manage")) throw forbidden();
    const server = await createServerSupabaseClient();
    if (readSignal.aborted || !server) throw unavailable();
    const { data, error } = await server.rpc("staff_certificate_documents_snapshot", {
      p_org: actor.organizationId, p_branch: actor.branchId,
      p_certificate_key: row.certificateKey, p_record_version_id: row.recordVersionId,
    }).abortSignal(readSignal).maybeSingle<{ payload: unknown }>();
    if (readSignal.aborted) throw unavailable();
    if (error) { if (error.code === "42501") throw forbidden(); throw unavailable(); }
    const proof = documentsSnapshotSchema.safeParse(data?.payload);
    if (!proof.success || proof.data.organizationId !== actor.organizationId || proof.data.branchId !== actor.branchId ||
      proof.data.actorUserId !== actor.userId || proof.data.staffMembershipId !== row.staffMembershipId ||
      proof.data.staffUserId !== row.staffUserId || proof.data.certificateKey !== row.certificateKey ||
      proof.data.recordVersionId !== row.recordVersionId || proof.data.recordContentHash !== row.recordContentHash ||
      !isStaffCertificateDocumentReadFresh(proof.data.generatedAt)) throw unavailable();
    return proof.data;
  });
}
