import { describe, expect, it } from "vitest";
import { buildDemoFormResponses } from "./demo";
import { parsePrintJob, printJobSchema, printRequestSchema, type CustomResponsePrintJob } from "./print-contract";

const id = (n: number) => `cf220000-0000-4000-8000-${String(n).padStart(12, "0")}`;
function job(): CustomResponsePrintJob {
  const response = buildDemoFormResponses("2026-09-22").records[0];
  return {
    jobId: id(1), responseId: response.id, clientId: response.clientId, actorId: id(2), organizationId: id(3), branchId: id(4),
    createdAt: "2026-09-22T07:00:00.000Z", expiresAt: "2026-09-22T07:05:00.000Z", snapshotHash: "a".repeat(64), replayed: false,
    snapshot: { response, organizationName: "合成機構", branchName: "合成分支", clientCode: "SYNTHETIC-001", clientName: "合成個案",
      formName: "合成自訂表單", formKey: "tenant.custom.synthetic", formVersion: 1, preparedByName: "合成製表人" },
  };
}

describe("custom response print snapshot contract", () => {
  it("binds every returned identity and hash to the requested immutable record", () => {
    const source = job();
    const expected = { jobId: source.jobId, responseId: source.responseId, clientId: source.clientId, actorId: source.actorId,
      organizationId: source.organizationId, branchId: source.branchId, snapshotHash: source.snapshotHash };
    expect(parsePrintJob(source, expected, source.snapshot.response)).toEqual(source);
  });

  it.each(["jobId", "responseId", "clientId", "actorId", "organizationId", "branchId", "snapshotHash"] as const)("rejects a wrong expected %s", (field) => {
    const source = job();
    expect(() => parsePrintJob(source, { [field]: field === "snapshotHash" ? "b".repeat(64) : id(99) })).toThrow("列印快照與所選紀錄版本不一致");
  });

  it.each(["clientId", "responseId"] as const)("rejects a returned %s that differs from its nested response", (field) => {
    const source = job();
    source[field] = id(99);
    expect(printJobSchema.safeParse(source).success).toBe(false);
    expect(() => parsePrintJob(source, {})).toThrow();
  });

  it.each(["answers", "schema", "contentHash", "serviceDate", "actorId"] as const)("rejects altered record %s even when IDs and print hash match", (field) => {
    const source = job();
    const original = structuredClone(source.snapshot.response);
    const response = source.snapshot.response;
    if (field === "answers") response.answers.count = { state: "answered", value: 2 };
    if (field === "schema") response.schema.fields[0].label = "遭竄改題目";
    if (field === "contentHash") response.contentHash = "c".repeat(64);
    if (field === "serviceDate") response.serviceDate = "2026-09-21";
    if (field === "actorId") response.actorId = id(99);
    expect(() => parsePrintJob(source, { snapshotHash: source.snapshotHash }, original)).toThrow();
  });

  it("ignores object key ordering, but preserves field array ordering", () => {
    const source = job();
    const original = structuredClone(source.snapshot.response);
    source.snapshot.response.answers = Object.fromEntries(Object.entries(source.snapshot.response.answers).reverse());
    expect(parsePrintJob(source, {}, original).snapshot.response.answers).toEqual(original.answers);
    source.snapshot.response.schema.fields.reverse();
    expect(() => parsePrintJob(source, {}, original)).toThrow();
  });

  it.each(["2026-09-22T07:04:59.999Z", "2026-09-22T07:05:00.001Z", "2026-09-22T06:59:59.999Z", "2026-09-22T07:05:00"])("requires the exact five-minute lifetime: %s", (expiresAt) => {
    expect(printJobSchema.safeParse({ ...job(), expiresAt }).success).toBe(false);
  });

  it("accepts timezone-equivalent instants without extending expiry", () => {
    expect(printJobSchema.safeParse({ ...job(), expiresAt: "2026-09-22T15:05:00+08:00" }).success).toBe(true);
  });

  it.each([false, true])("preserves replay=%s and still checks the saved response", (replayed) => {
    const source = { ...job(), replayed };
    expect(parsePrintJob(source, {}).replayed).toBe(replayed);
    expect(() => parsePrintJob(source, { actorId: id(99) })).toThrow();
  });

  it.each(["x".repeat(64), "A".repeat(64), "a".repeat(63), "a".repeat(65)])("rejects malformed content hash %s", (snapshotHash) => {
    expect(printJobSchema.safeParse({ ...job(), snapshotHash }).success).toBe(false);
  });

  it("rejects unknown receipt/snapshot fields and unsupported source namespaces", () => {
    const source = job();
    expect(printJobSchema.safeParse({ ...source, permitted: true }).success).toBe(false);
    expect(printJobSchema.safeParse({ ...source, snapshot: { ...source.snapshot, alternateAnswers: {} } }).success).toBe(false);
    expect(printJobSchema.safeParse({ ...source, snapshot: { ...source.snapshot, formKey: "official.adl" } }).success).toBe(false);
  });

  it("requires exactly saved-record references, not answers, names, scopes, or a supplied hash", () => {
    const source = job();
    const request = { clientId: source.clientId, responseId: source.responseId };
    expect(printRequestSchema.parse(request)).toEqual(request);
    for (const extra of [{ answers: {} }, { organizationId: source.organizationId }, { snapshotHash: source.snapshotHash }, { signed: true }]) {
      expect(printRequestSchema.safeParse({ ...request, ...extra }).success).toBe(false);
    }
    expect(printRequestSchema.safeParse({ clientId: source.clientId }).success).toBe(false);
  });
});
