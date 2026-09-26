import "server-only";

import { createHash } from "node:crypto";
import { z } from "zod";
import { parseClaimExportRequest, parseClaimReconciliationRequest,
  type ClaimExportRequest, type ClaimReconciliationRequest } from "@/lib/integrations/claims";

const scopeSchema = z.object({ organizationId: z.uuid(), branchId: z.uuid() });
type Scope = z.input<typeof scopeSchema>;

/** Exact, deliberately limited PostgreSQL jsonb text contracts used by the
 * existing atomic claim functions. Do not use this as a general JSON encoder:
 * jsonb orders keys by UTF-8 byte length then byte value, includes separator
 * spaces and preserves numeric(14,2) scale. JS JSON.stringify alone differs.
 * Amounts stay decimal text; no floating point conversion is involved. */
function scopeFields(scope: Scope) {
  const parsed = scopeSchema.parse(scope);
  return { organizationId: parsed.organizationId.toLowerCase(),
    branchId: parsed.branchId.toLowerCase() };
}
const quoted = (value: string | null) => JSON.stringify(value);
const digest = (text: string) => createHash("sha256").update(text, "utf8").digest("hex");

export function hashClaimExportRequest(input: ClaimExportRequest, scope: Scope) {
  const request = parseClaimExportRequest({ idempotency_key: input.idempotencyKey,
    claim_batch_id: input.claimBatchId, expected_total_amount: input.expectedTotalAmount });
  const { organizationId, branchId } = scopeFields(scope);
  return digest(`{"branch_id": ${quoted(branchId)}, "operation": "claim_export", "claim_batch_id": ${quoted(request.claimBatchId)}, "organization_id": ${quoted(organizationId)}, "expected_total_amount": ${request.expectedTotalAmount}}`);
}

export function hashClaimReconciliationRequest(input: ClaimReconciliationRequest, scope: Scope) {
  const request = parseClaimReconciliationRequest({ idempotency_key: input.idempotencyKey,
    claim_batch_id: input.claimBatchId, expected_total_amount: input.expectedTotalAmount,
    results: input.results.map((result) => ({ claim_item_id: result.claimItemId,
      outcome: result.outcome, response_code: result.responseCode, response_message: result.responseMessage })) });
  const { organizationId, branchId } = scopeFields(scope);
  const results = [...request.results].sort((left, right) =>
    left.claimItemId < right.claimItemId ? -1 : left.claimItemId > right.claimItemId ? 1 : 0)
    .map((result) => `{"outcome": ${quoted(result.outcome)}, "claim_item_id": ${quoted(result.claimItemId)}, "response_code": ${quoted(result.responseCode)}, "response_message": ${quoted(result.responseMessage === "" ? null : result.responseMessage)}}`)
    .join(", ");
  return digest(`{"results": [${results}], "branch_id": ${quoted(branchId)}, "operation": "claim_reconciliation", "claim_batch_id": ${quoted(request.claimBatchId)}, "organization_id": ${quoted(organizationId)}, "expected_total_amount": ${request.expectedTotalAmount}}`);
}
