import { ok } from "@/lib/api/response";
import { handleIntegrationRoute } from "@/lib/integrations/http";
import { staffDocumentActorContext, staffDocumentRequestScope, requireStaffDocumentRequestScope,
  requireBodylessStaffDocumentRead } from "@/lib/staff-certificate-documents/access";
import { loadStaffCertificateDocumentSources, staffCertificateDocumentSourceQuery } from "@/lib/staff-certificate-documents/sources";
import { staffDocumentRouteDeadline } from "@/lib/staff-certificate-documents/request";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return handleIntegrationRoute(async requestId => {
    requireBodylessStaffDocumentRead(request);
    const scope = staffDocumentRequestScope(request), query = staffCertificateDocumentSourceQuery(request);
    return staffDocumentRouteDeadline(request, async (active, signal) => {
      const { actor, server } = await staffDocumentActorContext(false, signal); active();
      requireStaffDocumentRequestScope(scope, actor);
      const snapshot = await loadStaffCertificateDocumentSources(actor, query, server, signal); active();
      return ok({ snapshot }, 200, requestId);
    });
  });
}
