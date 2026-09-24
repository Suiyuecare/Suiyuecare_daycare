import { describe, expect, it } from "vitest";
import { hasPublicationDraftChanges, parsePublicationReviewHistory, parsePublicationReviewInput, parsePublicationReviewReadResponse, parsePublicationReviewReceipt, parsePublicationReviewWriteResponse } from "./publication-review";
import { reviewEnvelope, reviewHistory, reviewIds as ids, reviewInput, reviewReceipt, reviewRequest } from "./publication-review.test-fixtures";

describe("publication review contracts", () => {
  it.each(["request", "approve", "withdraw", "return"] as const)("accepts exact %s input and bound receipt", action => {
    const input = reviewInput(action); expect(parsePublicationReviewInput(input, ids.other).input).toEqual(input);
    expect(parsePublicationReviewReceipt(reviewReceipt(action), input, ids.actor, ids.branch).event.action).toBe(action);
  });
  it.each([
    { ...reviewInput(), organizationId: ids.actor }, { ...reviewInput(), requestId: ids.request }, { ...reviewInput(), baseRevision: null },
    { ...reviewInput("approve"), reason: "不必要的原因" }, { ...reviewInput("withdraw"), reason: "短" }, { ...reviewInput("return"), reason: "<script>無效原因</script>" },
  ])("rejects overposting or inconsistent action %#", input => { expect(() => parsePublicationReviewInput(input, ids.other)).toThrow(); });
  it("rejects absent idempotency key", () => { expect(() => parsePublicationReviewInput(reviewInput(), null)).toThrow(); });
  it("preserves original request status on a replay, but never on new request", () => {
    for (const requestStatus of ["approved", "returned", "withdrawn"] as const) {
      expect(parsePublicationReviewReceipt({ ...reviewReceipt(), requestStatus, replayed: true }, reviewInput()).requestStatus).toBe(requestStatus);
      expect(() => parsePublicationReviewReceipt({ ...reviewReceipt(), requestStatus }, reviewInput())).toThrow();
    }
  });
  it.each(["actorId", "branchId", "formVersionId", "requestId"] as const)("binds decision %s", key => {
    const value = reviewReceipt("approve"); expect(() => parsePublicationReviewReceipt({ ...value, event: { ...value.event, [key]: ids.other } }, reviewInput("approve"), ids.actor, ids.branch)).toThrow();
  });
  it("rejects malformed envelopes, scope, and HTTP/replay mismatch", () => {
    const receipt = reviewReceipt(); const body = reviewEnvelope({ receipt, persisted: true, demo: false });
    expect(parsePublicationReviewWriteResponse(body, reviewInput(), 201).replayed).toBe(false);
    expect(() => parsePublicationReviewWriteResponse(body, reviewInput(), 200)).toThrow();
    expect(() => parsePublicationReviewWriteResponse({ ...body, token: "not-allowed" }, reviewInput(), 201)).toThrow();
    expect(() => parsePublicationReviewReadResponse(reviewEnvelope({ history: reviewHistory(), demo: false }), ids.other)).toThrow();
  });
  it("reads frozen requests independently of current edited draft", () => {
    const request = reviewRequest(); request.status = "withdrawn";
    request.events.push({ ...request.events[0]!, id: ids.other, action: "withdraw", reason: "合成修改原因說明", createdAt: "2026-09-22T08:01:00Z" });
    const history = reviewHistory([request]); history.currentDraftRevision = 2; history.currentDraft!.schema.fields[0]!.label = "新版已修改欄位";
    const parsed = parsePublicationReviewHistory(history, ids.version);
    expect(parsed.requests[0]!.payload.schema.fields[0]!.label).toBe("當時送審欄位");
    expect(parsed.currentDraft!.schema.fields[0]!.label).toBe("新版已修改欄位");
  });
  it.each([
    { field: "currentStatus", value: "published" }, { field: "currentDraft", value: null }, { field: "total", value: 1 }, { field: "truncated", value: true },
  ])("rejects inconsistent history %s", change => { expect(() => parsePublicationReviewHistory({ ...reviewHistory(), [change.field]: change.value }, ids.version)).toThrow(); });
  it.each(["actor", "time", "branch", "missing", "duplicate", "hash"])("rejects corrupted frozen evidence %s", kind => {
    const request = reviewRequest();
    if (kind === "actor") request.events[0]!.actorId = ids.other;
    if (kind === "time") request.events[0]!.createdAt = "2026-09-22T07:59:00Z";
    if (kind === "branch") request.events[0]!.branchId = ids.other;
    if (kind === "missing") request.events = [];
    if (kind === "duplicate") request.events.push(request.events[0]!);
    if (kind === "hash") request.events[0]!.formContentHash = "b".repeat(64);
    expect(() => parsePublicationReviewHistory(reviewHistory([request]), ids.version)).toThrow();
  });
  it("requires independent reviewer, exact terminal status, and non-backdated decision", () => {
    const request = reviewRequest(); request.status = "returned";
    request.events.push({ ...request.events[0]!, id: ids.other, action: "return", reason: "合成修改原因說明", createdAt: "2026-09-22T08:01:00Z" });
    expect(() => parsePublicationReviewHistory(reviewHistory([request]), ids.version)).toThrow();
    request.events[1]!.actorId = ids.other; request.events[1]!.byCurrentUser = false;
    expect(parsePublicationReviewHistory(reviewHistory([request]), ids.version).requests[0]!.status).toBe("returned");
    request.events[1]!.createdAt = "2026-09-22T07:59:00Z";
    expect(() => parsePublicationReviewHistory(reviewHistory([request]), ids.version)).toThrow();
  });
  it("ignores object property order but retains meaningful field order", () => {
    expect(hasPublicationDraftChanges({ a: 1, b: { x: 2, y: 3 } }, { b: { y: 3, x: 2 }, a: 1 })).toBe(false);
    expect(hasPublicationDraftChanges({ fields: [1, 2] }, { fields: [2, 1] })).toBe(true);
  });
});
