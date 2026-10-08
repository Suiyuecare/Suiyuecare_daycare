import { describe, expect, it } from "vitest";

import { parseQuestionnaireMutationReceipt } from "./receipt";

const clientId = "00000000-0000-4000-8000-000000000015";
const assessmentKey = "00000000-0000-4000-8000-000000000021";
const data = {
  action: "create",
  clientId,
  formKey: "spmsq",
  assessmentKey,
  versionId: "00000000-0000-4000-8000-000000000022",
  version: 1,
  recordState: "draft",
  assessedOn: "2026-10-08",
  contentHash: "a".repeat(64),
  committedAt: "2026-10-08T00:00:00Z",
  replayed: false,
} as const;
const expected = { action: "create", clientId, formKey: "spmsq", assessedOn: "2026-10-08" } as const;

describe("questionnaire mutation receipt", () => {
  it("accepts only a complete receipt for the same create operation, including replay", () => {
    expect(parseQuestionnaireMutationReceipt({ data }, expected)).toMatchObject(data);
    expect(parseQuestionnaireMutationReceipt({ data: { ...data, replayed: true } }, expected)?.replayed).toBe(true);
    expect(parseQuestionnaireMutationReceipt({ data: { recordState: "draft" } }, expected)).toBeNull();
  });

  it.each([
    { clientId: "00000000-0000-4000-8000-000000000016" },
    { formKey: "gds_15" },
    { assessedOn: "2026-10-07" },
    { version: 2 },
    { recordState: "signed" },
    { contentHash: "bad" },
    { committedAt: "invalid" },
    { replayed: "yes" },
  ])("rejects mismatched or incomplete fields: %j", (change) => {
    expect(parseQuestionnaireMutationReceipt({ data: { ...data, ...change } }, expected)).toBeNull();
  });

  it("requires a revision to match its prior assessment and next version", () => {
    const revision = { ...data, action: "revise", version: 3 };
    const baseline = { ...expected, action: "revise", assessmentKey, previousVersion: 2 } as const;
    expect(parseQuestionnaireMutationReceipt({ data: revision }, baseline)).toMatchObject(revision);
    expect(parseQuestionnaireMutationReceipt({ data: { ...revision, assessmentKey: data.versionId } }, baseline)).toBeNull();
    expect(parseQuestionnaireMutationReceipt({ data: { ...revision, version: 4 } }, baseline)).toBeNull();
  });
});
