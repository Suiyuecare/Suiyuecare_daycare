import { describe, expect, it } from "vitest";
import { isRecoveryTimeOrdered, trustedRecoveryEnvelopeSchema, trustedRecoveryInputSchema } from "./recovery-model";

const uuid = (n: number) => `10000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const base = {
  schema_version: 1, recovery_id: uuid(1), recovery_operation_id: uuid(2), original_operation_id: uuid(3), reservation_id: uuid(4),
  organization_id: uuid(5), branch_id: uuid(6), actor_user_id: uuid(7), mode: "general", file_sha256: "a".repeat(64),
  file_name: "synthetic.html", mime_type: "text/html", file_size_bytes: 10, mapping_version: "central-care-plan-html@1",
  created_at: "2026-09-01T00:00:00.000001Z", recovery_created_at: "2026-09-28T00:00:00Z", expires_at: "2026-09-28T00:15:00Z",
  status: "queued", receipt: null, replayed: false, staging_only: true, formally_imported: false,
};
const receipt = { reservation_id: uuid(4), status: "completed", staging_only: true, formally_imported: false,
  file_sha256: "a".repeat(64), content_fingerprint: "b".repeat(64), mapping_version: "central-care-plan-html@1", payload_sha256: "c".repeat(64),
  section_count: 1, field_count: 1, completed_at: "2026-09-02T00:00:00Z", replayed: false };

describe("immutable trusted upload recovery model", () => {
  it("keeps original timestamp spelling and completed history earlier than the new attempt", () => {
    expect(trustedRecoveryEnvelopeSchema.parse({ ...base, status: "completed", receipt })).toEqual({ ...base, status: "completed", receipt });
  });
  it("allows an observed expired queued attempt without granting a write", () => {
    expect(trustedRecoveryEnvelopeSchema.safeParse(base).success).toBe(true);
  });
  it("keeps an arbitrary original key exact, while a new recovery key must be canonical UUID", () => {
    const input = { reservationId: uuid(4), originalOperationKey: " original browser key ", recoveryOperationKey: uuid(2) };
    expect(trustedRecoveryInputSchema.parse(input)).toEqual(input);
  });
  it.each(["", " ", "a".repeat(201), "key\n", "key\u0000"])("rejects invalid original operation key %j", originalOperationKey => {
    expect(trustedRecoveryInputSchema.safeParse({ reservationId: uuid(4), originalOperationKey, recoveryOperationKey: uuid(2) }).success).toBe(false);
  });
  it.each([
    { schema_version: 2 }, { formally_imported: true }, { staging_only: false }, { status: "not_found" }, { mode: "legacy" },
    { recovery_operation_id: uuid(3) }, { file_sha256: "A".repeat(64) }, { file_name: "../source.html" }, { file_name: "source.txt" },
    { mime_type: "text/plain" }, { file_size_bytes: 0 }, { file_size_bytes: 25 * 1024 * 1024 + 1 }, { mapping_version: "future@2" },
    { created_at: "2026-02-30T00:00:00Z" }, { created_at: "invalid" }, { recovery_created_at: "invalid" }, { expires_at: "invalid" },
    { expires_at: "2026-09-28T00:15:00.000001Z" }, { expires_at: "2026-09-28T00:00:00Z" },
    { created_at: "2026-09-28T00:00:00.000001Z" }, { mode: "routine-intake", file_size_bytes: 4 * 1024 * 1024 + 1 },
    { receipt }, { rawBytes: "not allowed" },
  ])("rejects inconsistent or widened proof %j without throwing", change => {
    expect(() => trustedRecoveryEnvelopeSchema.safeParse({ ...base, ...change })).not.toThrow();
    expect(trustedRecoveryEnvelopeSchema.safeParse({ ...base, ...change }).success).toBe(false);
  });
  it.each([
    null, { ...receipt, reservation_id: uuid(9) }, { ...receipt, file_sha256: "d".repeat(64) },
    { ...receipt, completed_at: "2026-09-01T00:00:00.000000Z" }, { ...receipt, section_count: -1 },
    { ...receipt, formally_imported: true }, { ...receipt, secret: "not allowed" },
  ])("requires exact original completed receipt %j", value => {
    expect(trustedRecoveryEnvelopeSchema.safeParse({ ...base, status: "completed", receipt: value }).success).toBe(false);
  });
  it("compares microseconds and offset instants without normalizing the original spelling", () => {
    expect(isRecoveryTimeOrdered("2026-09-01T08:00:00.000001+08:00", base.created_at)).toBe(true);
    expect(isRecoveryTimeOrdered("2026-09-01T00:00:00.000002Z", base.created_at)).toBe(false);
    expect(isRecoveryTimeOrdered("invalid", base.created_at)).toBe(false);
  });
});
