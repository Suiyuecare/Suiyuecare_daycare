import { PGlite } from "@electric-sql/pglite";
import { afterAll, describe, expect, it, vi } from "vitest";
import { parseClaimExportRequest, parseClaimReconciliationRequest } from "@/lib/integrations/claims";

vi.mock("server-only", () => ({}));
import { hashClaimExportRequest, hashClaimReconciliationRequest } from "./claim-request-hash";

const ORG = "490abc00-0000-4000-8000-000000000001";
const BRANCH = "490abc00-0000-4000-8000-000000000002";
const BATCH = "490abc00-0000-4000-8000-000000000003";
const FIRST = "490abc00-0000-4000-8000-000000000004";
const SECOND = "490abc00-0000-4000-8000-000000000005";
const scope = { organizationId: ORG, branchId: BRANCH };
const database = new PGlite();
afterAll(async () => { await database.close(); });

describe("claim request fingerprint matches PostgreSQL, not generic JS JSON", () => {
  it.each(["0", "0.1", "1200.10", "999999999999.99"])("matches numeric scale exactly for export %s", async (amount) => {
    const request = parseClaimExportRequest({ claim_batch_id: BATCH.toUpperCase(),
      expected_total_amount: amount }, "synthetic-export-key");
    const { rows } = await database.query<{ hash: string }>(`select encode(sha256(convert_to(
      jsonb_build_object('operation','claim_export','organization_id',$1::uuid,'branch_id',$2::uuid,
        'claim_batch_id',$3::uuid,'expected_total_amount',$4::numeric)::text,'UTF8')),'hex') as hash`,
    [ORG, BRANCH, BATCH, request.expectedTotalAmount]);
    expect(hashClaimExportRequest(request, scope)).toBe(rows[0]!.hash);
    expect(hashClaimExportRequest(request, { organizationId: ORG.toUpperCase(), branchId: BRANCH.toUpperCase() }))
      .toBe(rows[0]!.hash);
  });

  it.each([null, "", "核定😀", '回覆："通過"\\測試', "𠮷佳泰", "tab-free\u2028段落"])(
    "matches ordered individual response JSON including UTF8 and escaping %j", async (message) => {
      const request = parseClaimReconciliationRequest({ claim_batch_id: BATCH.toUpperCase(),
        expected_total_amount: "999999999999.99", results: [
          { claim_item_id: SECOND.toUpperCase(), outcome: "rejected", response_code: " R01 ", response_message: message },
          { claim_item_id: FIRST, outcome: "accepted", response_code: "OK" },
        ] }, "synthetic-reconciliation-key");
      const normalizedResults = request.results.map((result) => ({ claim_item_id: result.claimItemId,
        outcome: result.outcome, response_code: result.responseCode, response_message: result.responseMessage }));
      const { rows } = await database.query<{ hash: string }>(`with normalized as (
        select jsonb_agg(jsonb_build_object('claim_item_id',(item->>'claim_item_id')::uuid,
          'outcome',item->>'outcome','response_code',btrim(item->>'response_code'),
          'response_message',nullif(btrim(item->>'response_message'),''))
          order by (item->>'claim_item_id')::uuid) as results
        from jsonb_array_elements($5::jsonb) item)
        select encode(sha256(convert_to(jsonb_build_object('operation','claim_reconciliation',
          'organization_id',$1::uuid,'branch_id',$2::uuid,'claim_batch_id',$3::uuid,
          'expected_total_amount',$4::numeric,'results',normalized.results)::text,'UTF8')),'hex') as hash from normalized`,
      [ORG, BRANCH, BATCH, request.expectedTotalAmount, JSON.stringify(normalizedResults)]);
      expect(hashClaimReconciliationRequest(request, scope)).toBe(rows[0]!.hash);
      expect(hashClaimReconciliationRequest({ ...request, results: [...request.results].reverse() }, scope))
        .toBe(rows[0]!.hash);
      const swapped = request.results.map((result) => ({ ...result,
        outcome: result.outcome === "accepted" ? "rejected" as const : "accepted" as const }));
      expect(hashClaimReconciliationRequest({ ...request, results: swapped }, scope)).not.toBe(rows[0]!.hash);
      expect(hashClaimReconciliationRequest({ ...request, results: request.results.map((result) => ({
        ...result, responseCode: "OTHER" })) }, scope)).not.toBe(rows[0]!.hash);
    });

  it("binds scope and body while raw retry keys are not part of the existing database hash", () => {
    const request = parseClaimExportRequest({ claim_batch_id: BATCH, expected_total_amount: "30" }, "synthetic-original-key");
    const hash = hashClaimExportRequest(request, scope);
    expect(hashClaimExportRequest({ ...request, idempotencyKey: "synthetic-different-key" }, scope)).toBe(hash);
    expect(hashClaimExportRequest(request, { ...scope, branchId: FIRST })).not.toBe(hash);
    expect(hashClaimExportRequest(request, { ...scope, organizationId: FIRST })).not.toBe(hash);
    expect(hashClaimExportRequest({ ...request, claimBatchId: FIRST }, scope)).not.toBe(hash);
    expect(hashClaimExportRequest({ ...request, expectedTotalAmount: "30.01" }, scope)).not.toBe(hash);
  });

  it("canonicalizes identity before duplicate detection", () => {
    expect(() => parseClaimReconciliationRequest({ claim_batch_id: BATCH,
      expected_total_amount: "30", results: [
        { claim_item_id: FIRST, outcome: "accepted", response_code: "OK" },
        { claim_item_id: FIRST.toUpperCase(), outcome: "rejected", response_code: "R01" },
      ] }, "synthetic-duplicate-key")).toThrow("同一申報明細不得出現兩次");
  });

  it("normalizes null and empty response text to the same persisted SQL representation", () => {
    const request = parseClaimReconciliationRequest({ claim_batch_id: BATCH,
      expected_total_amount: "30", results: [
        { claim_item_id: FIRST, outcome: "accepted", response_code: "OK", response_message: "  " },
      ] }, "synthetic-empty-message-key");
    expect(hashClaimReconciliationRequest(request, scope)).toBe(hashClaimReconciliationRequest({ ...request,
      results: request.results.map((result) => ({ ...result, responseMessage: null })) }, scope));
  });
});
