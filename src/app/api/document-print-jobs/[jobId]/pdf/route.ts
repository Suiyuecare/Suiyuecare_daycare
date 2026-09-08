import { z } from "zod";

import {
  verifyDocumentAccessToken,
} from "@/lib/document-printing/download-token";
import { parseDocumentPrintAccessResult } from "@/lib/document-printing/parser";
import { renderDocumentPdf } from "@/lib/document-printing/pdf-renderer";
import {
  authorizeStaffRequest,
  databaseFailure,
  handleIntegrationRoute,
  requireRecentAal2,
} from "@/lib/integrations/http";
import { IntegrationError } from "@/lib/integrations/errors";
import { sha256Hex } from "@/lib/integrations/security";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const uuid = z.uuid().transform((value) => value.toLowerCase());
const MAX_FONT_BYTES = 25 * 1024 * 1024;
const PDF_STREAM_CHUNK_BYTES = 64 * 1024;

function streamPdf(bytes: Uint8Array) {
  let offset = 0;
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (offset >= bytes.byteLength) {
        controller.close();
        return;
      }
      const end = Math.min(offset + PDF_STREAM_CHUNK_BYTES, bytes.byteLength);
      controller.enqueue(bytes.slice(offset, end));
      offset = end;
    },
  });
}

function accessFailure(code: string | undefined) {
  if (code === "42501") return databaseFailure(
    "DOCUMENT_ACCESS_NOT_AUTHORIZED",
    "目前角色、個案範圍或近期雙重驗證不允許存取文件。",
    403,
  );
  if (code === "55000") return databaseFailure(
    "DOCUMENT_INTEGRITY_FAILED",
    "不可變文件快照未通過完整性核對。",
    409,
  );
  return databaseFailure(
    "DOCUMENT_ACCESS_UNCERTAIN",
    "文件存取尚未確認完成；請重新載入文件清單後再試。",
    409,
  );
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ jobId: string }> },
) {
  return handleIntegrationRoute(async () => {
    const actor = await authorizeStaffRequest();
    if (actor.demo) throw new IntegrationError(
      "DEMO_READ_ONLY",
      "合成展示文件不提供正式 PDF 存取網址。",
      403,
    );
    const required = ["clients.read", "document_printing.read",
      "document_printing.access"];
    if (actor.assuranceLevel !== "aal2" ||
      !required.every((scope) => actor.scopes.includes(scope))) {
      throw new IntegrationError(
        "DOCUMENT_ACCESS_NOT_AUTHORIZED",
        "目前登入保證等級或工作範圍不允許存取文件。",
        403,
      );
    }
    await requireRecentAal2(actor);

    const job = uuid.safeParse((await params).jobId);
    const url = new URL(request.url);
    const modeValues = url.searchParams.getAll("mode");
    const tokenValues = url.searchParams.getAll("token");
    const keys = [...new Set(url.searchParams.keys())];
    const mode = modeValues[0];
    const token = tokenValues[0];
    if (!job.success || modeValues.length !== 1 || tokenValues.length !== 1 ||
      keys.length !== 2 || !keys.includes("mode") || !keys.includes("token") ||
      (mode !== "preview" && mode !== "download") || !token || token.length > 2_000) {
      throw new IntegrationError(
        "INVALID_DOCUMENT_ACCESS_REQUEST",
        "文件識別、存取方式或短效網址格式錯誤。",
        400,
      );
    }
    try {
      verifyDocumentAccessToken({
        token,
        expectedJobId: job.data,
        expectedUserId: actor.userId,
        expectedMode: mode,
      });
    } catch (error) {
      if (error instanceof Error &&
        error.message === "DOCUMENT_DOWNLOAD_SIGNING_NOT_CONFIGURED") {
        throw new IntegrationError(
          "DOCUMENT_DOWNLOAD_SIGNING_NOT_CONFIGURED",
          "短效文件網址簽章尚未設定。",
          503,
        );
      }
      throw new IntegrationError(
        "DOCUMENT_ACCESS_TOKEN_INVALID",
        "短效文件網址無效、已過期或不屬於目前使用者。",
        403,
      );
    }

    const supabase = await createServerSupabaseClient();
    if (!supabase) throw databaseFailure(
      "SERVICE_NOT_CONFIGURED", "正式文件資料服務尚未設定。", 503,
    );
    const { data, error } = await supabase.rpc("access_document_print_job", {
      p_expected_organization_id: actor.organizationId,
      p_expected_branch_id: actor.branchId,
      p_job_id: job.data,
      p_action: mode,
    }).maybeSingle();
    if (error || !data) throw accessFailure(error?.code);
    const access = parseDocumentPrintAccessResult(data, {
      jobId: job.data,
      organizationId: actor.organizationId,
      branchId: actor.branchId,
    });

    // The privileged storage client is created only after user-scoped DB
    // authorization and immutable access evidence have succeeded.
    const admin = createSupabaseAdminClient();
    if (!admin) throw databaseFailure(
      "DOCUMENT_FONT_STORAGE_NOT_CONFIGURED",
      "私有中文字型儲存服務尚未設定。",
      503,
    );
    const downloaded = await admin.storage
      .from(access.fontBucket)
      .download(access.fontObjectPath);
    if (downloaded.error || !downloaded.data || downloaded.data.size < 1_024 ||
      downloaded.data.size > MAX_FONT_BYTES) {
      throw databaseFailure(
        "DOCUMENT_FONT_ASSET_UNAVAILABLE",
        "核准範本的私有中文字型不存在或大小不符合限制。",
        503,
      );
    }
    const fontBytes = new Uint8Array(await downloaded.data.arrayBuffer());
    if (sha256Hex(fontBytes) !== access.fontSha256) {
      throw databaseFailure(
        "DOCUMENT_FONT_INTEGRITY_FAILED",
        "核准範本的中文字型未通過雜湊核對。",
        409,
      );
    }
    let pdf: Uint8Array;
    try {
      pdf = await renderDocumentPdf({
        model: access.renderModel,
        fontBytes,
      });
    } catch {
      throw databaseFailure(
        "DOCUMENT_PDF_RENDER_FAILED",
        "文件內容或中文字型無法安全產生 PDF。",
        409,
      );
    }
    const disposition = mode === "preview" ? "inline" : "attachment";
    // A governed Traditional-Chinese font alone can put a correct PDF close to
    // Vercel's buffered Function response limit. Stream every PDF so longer
    // approved documents do not fail only because their payload exceeds it.
    return new Response(streamPdf(pdf), {
      status: 200,
      headers: {
        "Cache-Control": "private, no-store, max-age=0",
        "Content-Disposition": `${disposition}; filename="document-${job.data}.pdf"`,
        "Content-Security-Policy": "sandbox",
        "Content-Type": "application/pdf",
        "Cross-Origin-Resource-Policy": "same-origin",
        "Referrer-Policy": "no-referrer",
        "X-Content-Type-Options": "nosniff",
      },
    });
  });
}
