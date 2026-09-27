import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { originalOperationKeySchema, trustedUploadOperationEnvelopeSchema, uploadOperationLocatorResultSchema } from "./operation-locator-model";
const uuid = (n: number) => `10000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const base = { schema_version: 1, original_operation_id: uuid(1), reservation_id: uuid(2), organization_id: uuid(3), branch_id: uuid(4),
  actor_user_id: uuid(5), mode: "general", file_sha256: "a".repeat(64), file_name: "synthetic.html", mime_type: "text/html", file_size_bytes: 10,
  mapping_version: "central-care-plan-html@1", created_at: "2026-09-01T08:00:00.000001+08:00", expires_at: "2026-09-01T00:15:00.000001Z",
  status: "queued", receipt: null, staging_only: true, formally_imported: false };
const receipt = { reservation_id: uuid(2), status: "completed", staging_only: true, formally_imported: false, file_sha256: "a".repeat(64),
  content_fingerprint: "b".repeat(64), mapping_version: "central-care-plan-html@1", payload_sha256: "c".repeat(64),
  section_count: 1, field_count: 1, completed_at: "2026-09-02T00:00:00Z", replayed: false };
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date("2026-09-28T00:00:00Z")); });
afterEach(() => vi.useRealTimers());
describe("original upload operation locator model", () => {
  it("preserves expired queued history and completed source receipt exactly", () => {
    expect(trustedUploadOperationEnvelopeSchema.parse(base)).toEqual(base);
    expect(trustedUploadOperationEnvelopeSchema.parse({ ...base, status: "completed", receipt })).toEqual({ ...base, status: "completed", receipt });
  });
  it("retains existing non-UUID original keys without trimming", () => {
    expect(originalOperationKeySchema.parse(" exact original key ")).toBe(" exact original key ");
  });
  it.each(["", " ", "a".repeat(201), "key\n", "key\u0000"])("rejects malformed original key %j", key => {
    expect(originalOperationKeySchema.safeParse(key).success).toBe(false);
  });
  it.each([
    { schema_version: 2 }, { original_operation_id: "bad" }, { reservation_id: "bad" }, { organization_id: "bad" }, { branch_id: "bad" }, { actor_user_id: "bad" },
    { file_sha256: "A".repeat(64) }, { file_name: "../source.html" }, { file_name: "source.txt" }, { mime_type: "text/plain" }, { file_size_bytes: 0 },
    { file_size_bytes: 25 * 1024 * 1024 + 1 }, { mapping_version: "future@2" }, { created_at: "invalid" }, { created_at: "2026-02-30T00:00:00Z" },
    { created_at: "2026-09-28T00:00:00.000001Z", expires_at: "2026-09-28T00:15:00.000001Z" }, { expires_at: "invalid" },
    { expires_at: "2026-09-01T00:00:00.000001Z" }, { expires_at: "2026-09-01T00:15:00.000002Z" }, { expires_at: "2026-09-01T00:00:00Z" },
    { mode: "unknown" }, { mode: "routine-intake", file_size_bytes: 4 * 1024 * 1024 + 1 }, { status: "approved" }, { receipt },
    { staging_only: false }, { formally_imported: true }, { replayed: false }, { recovery_id: uuid(9) }, { session_id: uuid(9) }, { authorization_claims: {} },
    { archive_reference: {} }, { parsed_payload: {} }, { raw_file: "private" },
  ])("fails widened or inconsistent source envelope %j without throwing", change => {
    expect(() => trustedUploadOperationEnvelopeSchema.safeParse({ ...base, ...change })).not.toThrow();
    expect(trustedUploadOperationEnvelopeSchema.safeParse({ ...base, ...change }).success).toBe(false);
  });
  it.each([null, { ...receipt, reservation_id: uuid(9) }, { ...receipt, file_sha256: "d".repeat(64) }, { ...receipt, mapping_version: "future@2" },
    { ...receipt, replayed: true }, { ...receipt, completed_at: "2026-09-01T00:00:00Z" }, { ...receipt, completed_at: "2026-09-28T00:00:00.000001Z" },
    { ...receipt, section_count: -1 }, { ...receipt, payload_sha256: "bad" }, { ...receipt, formally_imported: true }, { ...receipt, private_data: "private" },
  ])("fails inconsistent immutable completion %j", value => {
    expect(trustedUploadOperationEnvelopeSchema.safeParse({ ...base, status: "completed", receipt: value }).success).toBe(false);
  });
  it("requires exact found/operation agreement with no repository preview claims", () => {
    expect(uploadOperationLocatorResultSchema.parse({ found: false, operation: null })).toEqual({ found: false, operation: null });
    expect(uploadOperationLocatorResultSchema.safeParse({ found: true, operation: base }).success).toBe(true);
    for (const value of [{ found: true, operation: null }, { found: false, operation: base }, { found: false, operation: null, ready_for_approval: true }])
      expect(uploadOperationLocatorResultSchema.safeParse(value).success).toBe(false);
  });
});
