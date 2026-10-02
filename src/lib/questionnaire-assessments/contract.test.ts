import { describe, expect, it } from "vitest";

import { parseQuestionnaireAssessmentDatePage, parseQuestionnaireAssessmentPage, parseQuestionnaireHistoryPage, parseQuestionnaireSnapshot } from "./contract";

const clientId = "10000000-0000-4000-8000-000000000001";
const assessmentKey = "20000000-0000-4000-8000-000000000001";
const stamp = "2026-09-25T01:00:00Z";
const draft = (version = 1) => ({ assessmentKey, versionId: `30000000-0000-4000-8000-${String(version).padStart(12, "0")}`,
  version, formVersion: "test-v1", assessedOn: "2026-09-25", answers: {}, context: {},
  recordState: "draft", authorDisplayName: "測試人員", createdAt: stamp, contentHash: "a".repeat(64) });
const page = () => ({ formKey: "spmsq", clientId, assessments: [{ ...draft(), assessmentCreatedAt: stamp }], total: 1, nextCursor: null });
const datePage = () => ({ formKey: "spmsq", clientId, assessedOn: "2026-09-25", assessments: [{ assessmentKey,
  versionId: draft().versionId, version: 1, assessedOn: "2026-09-25", savedAt: stamp, recordState: "draft",
  assessmentCreatedAt: stamp }], total: 1, nextCursor: null });
const history = () => ({ formKey: "spmsq", clientId, assessmentKey, versions: [draft(2), draft()], total: 2, nextBeforeVersion: null });

describe("questionnaire scoped read contracts", () => {
  it("accepts separate draft chains and immutable descending version pages", () => {
    expect(parseQuestionnaireAssessmentPage(page(), "spmsq", clientId).total).toBe(1);
    expect(parseQuestionnaireHistoryPage(history(), "spmsq", clientId, assessmentKey).versions.map((v) => v.version)).toEqual([2, 1]);
  });
  it("accepts a date-bound metadata-only page without answers, context or hashes", () => {
    expect(parseQuestionnaireAssessmentDatePage(datePage(), "spmsq", clientId, "2026-09-25").assessments[0]).toEqual({
      assessmentKey, versionId: draft().versionId, version: 1, assessedOn: "2026-09-25",
      savedAt: stamp, recordState: "draft", assessmentCreatedAt: stamp,
    });
  });
  it("accepts the database's highest stored assessment version but rejects an out-of-range version", () => {
    const value = datePage();
    const atDatabaseLimit = { ...value, assessments: [{ ...value.assessments[0], version: 1_000_001 }] };
    expect(parseQuestionnaireAssessmentDatePage(atDatabaseLimit, "spmsq", clientId, "2026-09-25").assessments[0]?.version).toBe(1_000_001);
    const aboveDatabaseLimit = { ...value, assessments: [{ ...value.assessments[0], version: 1_000_002 }] };
    expect(() => parseQuestionnaireAssessmentDatePage(aboveDatabaseLimit, "spmsq", clientId, "2026-09-25")).toThrow();
  });
  it.each(["client", "form", "date", "rowDate", "duplicate", "answers", "cursor", "earlySave", "unbounded"])(
    "rejects invalid %s date lookup without leaking content", (kind) => {
      const value = datePage();
      const malformed = kind === "client" ? { ...value, clientId: assessmentKey }
        : kind === "form" ? { ...value, formKey: "gds_15" }
        : kind === "date" ? { ...value, assessedOn: "2026-09-24" }
        : kind === "rowDate" ? { ...value, assessments: [{ ...value.assessments[0], assessedOn: "2026-09-24" }] }
        : kind === "duplicate" ? { ...value, assessments: [value.assessments[0], value.assessments[0]], total: 2 }
        : kind === "answers" ? { ...value, assessments: [{ ...value.assessments[0], answers: {} }] }
        : kind === "cursor" ? { ...value, nextCursor: { createdAt: stamp, assessmentKey: clientId } }
        : kind === "earlySave" ? { ...value, assessments: [{ ...value.assessments[0], savedAt: "2026-09-24T01:00:00Z" }] }
        : { ...value, assessments: Array.from({ length: 21 }, () => value.assessments[0]), total: 21 };
      expect(() => parseQuestionnaireAssessmentDatePage(malformed, "spmsq", clientId, "2026-09-25")).toThrow();
    });
  it.each(["form", "client", "signed", "duplicate", "cursor", "unbounded"])("rejects invalid %s assessment page", (kind) => {
    const value = page();
    const malformed = kind === "form" ? { ...value, formKey: "gds_15" }
      : kind === "client" ? { ...value, clientId: assessmentKey }
      : kind === "signed" ? { ...value, assessments: [{ ...value.assessments[0], recordState: "signed" }] }
      : kind === "duplicate" ? { ...value, assessments: [value.assessments[0], value.assessments[0]], total: 2 }
      : kind === "cursor" ? { ...value, nextCursor: { createdAt: stamp, assessmentKey: clientId } }
      : { ...value, assessments: Array.from({ length: 21 }, () => value.assessments[0]), total: 21 };
    expect(() => parseQuestionnaireAssessmentPage(malformed, "spmsq", clientId)).toThrow();
  });
  it.each(["scope", "ascending", "duplicate", "cursor", "signed"])("rejects invalid %s history", (kind) => {
    const value = history();
    const malformed = kind === "scope" ? { ...value, versions: [{ ...draft(), assessmentKey: clientId }] }
      : kind === "ascending" ? { ...value, versions: [draft(), draft(2)] }
      : kind === "duplicate" ? { ...value, versions: [draft(), draft()] }
      : kind === "cursor" ? { ...value, nextBeforeVersion: 2 }
      : { ...value, versions: [{ ...draft(), recordState: "signed" }] };
    expect(() => parseQuestionnaireHistoryPage(malformed, "spmsq", clientId, assessmentKey)).toThrow();
  });
  it("never substitutes another selected client or duplicated client in a snapshot", () => {
    const client = { clientId, displayName: "合成個案", serviceStatus: "active", latest: draft(), assessments: [], assessmentTotal: 1, nextAssessmentCursor: null };
    const value = { formKey: "spmsq", generatedAt: stamp, matchingTotal: 1, clients: [client] };
    expect(parseQuestionnaireSnapshot(value, "spmsq", clientId).clients).toHaveLength(1);
    expect(() => parseQuestionnaireSnapshot(value, "spmsq", assessmentKey)).toThrow();
    expect(() => parseQuestionnaireSnapshot({ ...value, clients: [client, client] }, "spmsq")).toThrow();
  });
});
