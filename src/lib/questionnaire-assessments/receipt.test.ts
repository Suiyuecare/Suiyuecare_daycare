import { describe, expect, it } from "vitest";
import { readQuestionnaireMutationReceipt, readQuestionnairePublicationReceipt, type QuestionnaireMutationAction } from "./receipt";

const id = "11111111-1111-4111-8111-111111111111";
const previous = "22222222-2222-4222-8222-222222222222";
const expected = { action: "submit" as const, clientId: id, formKey: "spmsq" as const, assessmentKey: id,
  expectedVersion: 2, previousVersionId: previous, assessedOn: "2026-10-10", contentHash: "a".repeat(64) };
const receipt = { action: "submit", clientId: id, formKey: "spmsq", assessmentKey: id,
  versionId: "33333333-3333-4333-8333-333333333333", version: 3, recordState: "submitted", assessedOn: "2026-10-10",
  contentHash: "a".repeat(64), committedAt: "2026-10-12T01:00:00Z", replayed: false };

describe("questionnaire immutable mutation receipts", () => {
  it.each(["create", "revise", "submit", "sign", "return", "correct"] as QuestionnaireMutationAction[])("accepts the exact %s transition and replay", (action) => {
    const data = { ...receipt, action, recordState: action === "sign" ? "signed" : action === "submit" ? "submitted" : "draft",
      version: action === "create" ? 1 : 3 };
    expect(readQuestionnaireMutationReceipt(data, { ...expected, action })).toEqual(data);
    expect(readQuestionnaireMutationReceipt({ ...data, replayed: true }, { ...expected, action })?.replayed).toBe(true);
  });
  it.each([{ action: "sign" }, { clientId: previous }, { formKey: "gds_15" }, { assessmentKey: previous },
    { versionId: previous }, { versionId: "bad" }, { version: 2 }, { recordState: "signed" }, { assessedOn: "2026-10-11" },
    { contentHash: "b".repeat(64) }, { committedAt: "not-a-date" }, { replayed: "false" }, { manufacturedApproval: true }])("rejects a mismatched or malformed receipt: %j", (override) => {
    expect(readQuestionnaireMutationReceipt({ ...receipt, ...override }, expected)).toBeNull();
  });
  it("does not accept IDs alone or a malformed publication proof", () => {
    expect(readQuestionnaireMutationReceipt({ versionId: receipt.versionId, recordState: "submitted" }, expected)).toBeNull();
    expect(readQuestionnairePublicationReceipt({ publicationId: id, status: "approved" }, { action: "approve", publicationId: id })).toBeNull();
    expect(readQuestionnairePublicationReceipt({ publicationId: previous, status: "approved", replayed: false }, { action: "approve", publicationId: id })).toBeNull();
    expect(readQuestionnaireMutationReceipt(receipt, { action: "submit", clientId: id, formKey: "spmsq" })).toBeNull();
  });
  it("compares UUID values independently of their hexadecimal letter case", () => {
    const client = "aa111111-1111-4111-8111-111111111111";
    expect(readQuestionnaireMutationReceipt({ ...receipt, clientId: client, assessmentKey: client },
      { ...expected, clientId: client.toUpperCase(), assessmentKey: client.toUpperCase() })).not.toBeNull();
    expect(readQuestionnairePublicationReceipt({ publicationId: client, status: "approved", replayed: false },
      { action: "approve", publicationId: client.toUpperCase() })).not.toBeNull();
  });
  it("accepts a request replay approved in the meantime, while approval requires that publication and status", () => {
    const data = { publicationId: id, status: "approved", replayed: true };
    expect(readQuestionnairePublicationReceipt(data, { action: "request" })).toEqual(data);
    expect(readQuestionnairePublicationReceipt(data, { action: "approve", publicationId: id })).toEqual(data);
    expect(readQuestionnairePublicationReceipt({ ...data, status: "pending" }, { action: "approve", publicationId: id })).toBeNull();
  });
});
