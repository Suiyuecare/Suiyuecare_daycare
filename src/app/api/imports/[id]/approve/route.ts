import { ok } from "@/lib/api/response";
import { ImportError } from "@/lib/imports/errors";
import {
  assertImportId,
  authorizeImportRequest,
  handleImportRoute,
  readIdempotencyKey,
  readSmallJsonBody,
} from "@/lib/imports/http";
import { approveHtmlImport } from "@/lib/imports/service";
import { getImportRepository } from "@/lib/imports/storage";

function conflictResolutions(value: unknown) {
  if (value === undefined) return {};
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ImportError(
      "INVALID_CONFLICT_RESOLUTIONS",
      "衝突選擇必須是以衝突識別碼為鍵的物件。",
      400,
      "conflict_resolutions",
    );
  }
  const result: Record<string, string> = Object.create(null) as Record<
    string,
    string
  >;
  for (const [key, selectedFieldId] of Object.entries(value)) {
    if (
      !/^conflict_[a-f0-9]{24}$/u.test(key) ||
      typeof selectedFieldId !== "string" ||
      !/^field_[a-f0-9]{24}$/u.test(selectedFieldId)
    ) {
      throw new ImportError(
        "INVALID_CONFLICT_RESOLUTIONS",
        "每一筆衝突必須指定一個來源欄位。",
        400,
        `conflict_resolutions.${key}`,
      );
    }
    result[key] = selectedFieldId;
  }
  return result;
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  return handleImportRoute(async (requestId) => {
    const { id } = await params;
    assertImportId(id);
    const actor = await authorizeImportRequest(request, "approve");
    const body = await readSmallJsonBody(request);
    const result = await approveHtmlImport(getImportRepository(), actor, id, {
      idempotencyKey: readIdempotencyKey(request, body.idempotency_key),
      conflictResolutions: conflictResolutions(body.conflict_resolutions),
    });
    return ok(result, 200, requestId);
  });
}
