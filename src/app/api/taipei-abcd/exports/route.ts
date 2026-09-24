import { z } from "zod";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { authorizeStaffRequest, handleIntegrationRoute, readJsonObject, requireRecentAal2 } from "@/lib/integrations/http";
import { IntegrationError } from "@/lib/integrations/errors";
import { sha256Hex } from "@/lib/integrations/security";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { exportInputSchema, exportSnapshotSchema, taipeiExportModel } from "@/lib/taipei-abcd/export";
import { renderDocumentPdf } from "@/lib/document-printing/pdf-renderer";
import { TAIPEI_PDF_FONT_FEATURES } from "@/lib/taipei-abcd/pdf-font";
export const runtime = "nodejs";
export const preferredRegion = "hnd1";
export const dynamic = "force-dynamic";
const resultSchema = z.object({ id: z.uuid(), snapshot: exportSnapshotSchema, snapshotHash: z.string().regex(/^[a-f0-9]{64}$/),
  fontAssetKey: z.literal("taipei-crosswalk-font-v1") });
const FONT_SHA256 = "b4ebe30cc77de66e271483b41f5d7ee60baa070054a0b938f87c88491b5d1b91";
export async function POST(request: Request) {
  return handleIntegrationRoute(async () => {
    const actor = await authorizeStaffRequest();
    if (actor.demo || !["clients.read", "abcd_assessments.read", "document_printing.read", "document_printing.manage", "document_printing.access"].every(scope => actor.scopes.includes(scope))) throw new IntegrationError("TAIPEI_EXPORT_DENIED", "目前帳號沒有此表單的單份文件輸出權限。", 403);
    await requireRecentAal2(actor);
    const input = exportInputSchema.safeParse(await readJsonObject(request, 4096));
    if (!input.success || input.data.idempotency_key !== request.headers.get("idempotency-key")) throw new IntegrationError("TAIPEI_EXPORT_INVALID", "請先選擇已保存的表單版本。", 400);
    const server = await createServerSupabaseClient(); if (!server) throw new IntegrationError("TAIPEI_EXPORT_UNAVAILABLE", "文件資料服務尚未設定。", 503);
    const { data, error } = await server.rpc("taipei_abcd_export", { p_expected_organization_id: actor.organizationId, p_expected_branch_id: actor.branchId, p_input: input.data });
    if (error) throw new IntegrationError("TAIPEI_EXPORT_UNAVAILABLE", error.code === "42501" ? "資料類別、個案範圍或近期身分驗證不允許輸出。" : "表單或審核版本已變更，請重新載入核對。", error.code === "42501" ? 403 : 409);
    const result = resultSchema.parse(data); const draft = result.snapshot.draft as { id?: string; contentHash?: string };
    if (result.snapshot.organization.organizationId !== actor.organizationId || result.snapshot.organization.branchId !== actor.branchId || result.snapshot.client.clientId !== input.data.clientId || draft.id !== input.data.draftId || draft.contentHash !== input.data.contentHash || result.snapshot.workflow.sequence !== input.data.expectedSequence) throw new IntegrationError("TAIPEI_EXPORT_MISMATCH", "文件快照與所選版本不同，已停止輸出。", 502);
    const model = taipeiExportModel(result.snapshot, result.id, result.snapshotHash);
    // OFL font is a fixed server asset, not a fabricated approved clinical template.
    const fontBytes = new Uint8Array(await readFile(join(process.cwd(), "assets/fonts/NotoSansTC-Regular.ttf")));
    if (sha256Hex(fontBytes) !== FONT_SHA256) throw new IntegrationError("TAIPEI_FONT_MISMATCH", "中文字型雜湊核對失敗，已停止輸出。", 409);
    let pdf: Uint8Array;
    try { pdf = await renderDocumentPdf({ model, fontBytes, fontFeatures: { ...TAIPEI_PDF_FONT_FEATURES }, keepShortRowsTogether: true }); } catch { throw new IntegrationError("TAIPEI_PDF_FAILED", "此份資料或中文字型無法完整輸出，已停止產生 PDF，不會略過欄位。", 409); }
    let offset = 0;
    return new Response(new ReadableStream<Uint8Array>({ pull(controller) { if (offset >= pdf.length) { controller.close(); return; } const end = Math.min(offset + 65536, pdf.length); controller.enqueue(pdf.slice(offset, end)); offset = end; } }), {
      headers: { "Content-Type": "application/pdf", "Content-Disposition": `inline; filename="taipei-${result.id}.pdf"`, "Cache-Control": "private, no-store, max-age=0", "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "sandbox", "Referrer-Policy": "no-referrer", "Cross-Origin-Resource-Policy": "same-origin", "X-Pdf-Sha256": sha256Hex(pdf), "X-Taipei-Snapshot-Id": result.id, "X-Taipei-Snapshot-Hash": result.snapshotHash },
    });
  });
}
