import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { handleIntegrationRoute, requireRecentAal2 } from "@/lib/integrations/http";
import { IntegrationError } from "@/lib/integrations/errors";
import { runCustomDraftRpc } from "@/lib/form-governance/draft-http";
import { authorizeCustomPrint, customPrintFailure } from "@/lib/custom-form-responses/print-http";
import { parsePrintJob } from "@/lib/custom-form-responses/print-contract";
import { customResponsePrintModel } from "@/lib/custom-form-responses/print-model";
import { verifyPrintToken } from "@/lib/custom-form-responses/print-token";
import { renderDocumentPdf } from "@/lib/document-printing/pdf-renderer";
import { TAIPEI_PDF_FONT_FEATURES } from "@/lib/taipei-abcd/pdf-font";
import { sha256Hex } from "@/lib/integrations/security";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const FONT_HASH = "b4ebe30cc77de66e271483b41f5d7ee60baa070054a0b938f87c88491b5d1b91";
export async function GET(request: Request, { params }: { params: Promise<{ jobId: string }> }) {
  return handleIntegrationRoute(async (requestId) => {
    const { actor, db } = await authorizeCustomPrint(false);
    const jobId = z.uuid().safeParse((await params).jobId);
    const query = new URL(request.url).searchParams;
    if (!jobId.success || [...query.keys()].length !== 1 || query.getAll("token").length !== 1) throw new IntegrationError("INVALID_CUSTOM_PRINT", "文件連結格式不正確。", 400);
    let token;
    try { token = verifyPrintToken(query.get("token") ?? "", { jobId: jobId.data, actorId: actor.userId, organizationId: actor.organizationId, branchId: actor.branchId }); }
    catch { throw new IntegrationError("CUSTOM_PRINT_TOKEN_INVALID", "連結已失效或不屬於目前帳號，請回表單重新準備。", 403); }
    const read = () => runCustomDraftRpc(db.rpc("read_custom_response_print", { p_org: actor.organizationId, p_branch: actor.branchId, p_job: jobId.data, p_snapshot_hash: token.snapshotHash }));
    const result = await read();
    if (result.error) throw customPrintFailure(result.error.code);
    const expected = { jobId: jobId.data, actorId: actor.userId, organizationId: actor.organizationId, branchId: actor.branchId, snapshotHash: token.snapshotHash };
    const job = parsePrintJob(result.data, expected);
    let pdf: Uint8Array;
    try {
      const fontBytes = new Uint8Array(await readFile(join(process.cwd(), "assets/fonts/NotoSansTC-Regular.ttf")));
      if (sha256Hex(fontBytes) !== FONT_HASH) throw new Error("FONT_INTEGRITY");
      pdf = await renderDocumentPdf({ model: customResponsePrintModel(job), fontBytes, fontFeatures: { ...TAIPEI_PDF_FONT_FEATURES }, keepShortRowsTogether: true });
    } catch { throw new IntegrationError("CUSTOM_PRINT_RENDER_FAILED", "文件或中文字型無法完整輸出，未略過任何欄位；請聯絡管理員。", 503); }
    // Rendering can take time. Recheck expiration, live authorization and the
    // immutable snapshot immediately before any document bytes leave the API.
    await requireRecentAal2(actor);
    try { verifyPrintToken(query.get("token")!, expected); } catch { throw new IntegrationError("CUSTOM_PRINT_TOKEN_INVALID", "文件連結已過期，請重新準備。", 403); }
    const confirmed = await read();
    if (confirmed.error) throw customPrintFailure(confirmed.error.code);
    parsePrintJob(confirmed.data, expected, job.snapshot.response);
    // The last RPC itself can wait on an audit lock. The HMAC deadline is
    // rounded to seconds, so check it once more after the database returns.
    try { verifyPrintToken(query.get("token")!, expected); } catch { throw new IntegrationError("CUSTOM_PRINT_TOKEN_INVALID", "文件連結已過期，請重新準備。", 403); }
    let offset = 0;
    return new Response(new ReadableStream<Uint8Array>({ pull(controller) {
      if (offset >= pdf.length) { controller.close(); return; }
      const end = Math.min(offset + 65536, pdf.length); controller.enqueue(pdf.slice(offset, end)); offset = end;
    } }), { headers: {
      "Cache-Control": "private, no-store, max-age=0", "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="custom-response-${job.jobId}.pdf"`,
      "Content-Security-Policy": "sandbox", "Cross-Origin-Resource-Policy": "same-origin", "Referrer-Policy": "no-referrer", "X-Content-Type-Options": "nosniff", "X-Request-Id": requestId,
    } });
  });
}
