import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  buildPromotionPreflight,
  type PromotionPreflightInput,
} from "./promotion-preflight";
import { CURRENT_MAPPING_VERSION, type ImportStagingField } from "./types";

const scope = { organizationId: "synthetic-org", branchId: "synthetic-branch" };

function field(id: string, label: string, value: string): ImportStagingField {
  return {
    id, mappingKey: `synthetic.${label}`, mappingVersion: CURRENT_MAPPING_VERSION,
    mappingState: "mapped", targetPath: `central.synthetic.${label}`,
    source: { sectionCode: "SYNTHETIC", sectionTitle: "Synthetic only", label, parentPath: "SYNTHETIC/basic", controlName: null },
    rawValue: value, normalizedValue: value, sensitive: true, warnings: [],
  };
}

function fixture(): PromotionPreflightInput {
  const fields = [field("id-1", "synthetic-id", "EXACT-SYNTHETIC-ID"), field("name-1", "synthetic-name", "合成新名稱"), field("dob-1", "synthetic-date", "1950-02-03")];
  return {
    source: {
      batchId: "synthetic-batch", version: 2, scope: { ...scope }, fileSha256: "a".repeat(64),
      parsed: {
        mappingVersion: CURRENT_MAPPING_VERSION, contentFingerprint: "b".repeat(64), fields,
        sections: [], warnings: [], conflicts: [],
        security: { parser: "cheerio-static", scriptElementsBlocked: 0, formElementsNeutralized: 0, redirectElementsBlocked: 0,
          activeElementsBlocked: 0, inlineEventHandlersBlocked: 0, externalReferencesBlocked: 0, externalRequestCount: 0 },
      },
    },
    comparison: { scope: { ...scope }, asOfDate: "2026-09-11", expectedSourceVersion: 2, expectedClient: { id: "synthetic-client", rowVersion: 3 } },
    mapping: {
      version: "synthetic-basic-draft@1", sourceMappingVersion: CURRENT_MAPPING_VERSION,
      responsibleOwnerId: "synthetic-data-owner", governanceReceiptReference: null,
      identity: { source: { ...fields[0].source }, namespace: "synthetic-registry" },
      fields: [
        { source: { ...fields[1].source }, destination: "clients.display_name", owner: "central", required: false, missingValues: [], clearValues: [], notApplicableValues: [] },
        { source: { ...fields[2].source }, destination: "clients.date_of_birth", owner: "central", required: false, missingValues: [], clearValues: [""], notApplicableValues: ["SYNTHETIC_NA"] },
      ],
    },
    targets: [{
      id: "synthetic-client", scope: { ...scope }, rowVersion: 3,
      identifiers: [{ namespace: "synthetic-registry", value: "EXACT-SYNTHETIC-ID" }],
      displayName: "合成舊名稱", dateOfBirth: null, sourceAuthority: "local",
    }],
  };
}

function codes(input: PromotionPreflightInput) {
  return buildPromotionPreflight(input).issues.map((issue) => issue.code);
}

describe("central basic-client promotion dry-run preflight", () => {
  it("compares explicit mapped fields with old/new/owner/source and leaves every production gate blocked", () => {
    const result = buildPromotionPreflight(fixture());
    expect(result).toMatchObject({ kind: "central_client_promotion_draft", status: "draft_dry_run", executable: false,
      target: { id: "synthetic-client", rowVersion: 3 } });
    expect(result.changes[0]).toMatchObject({ destination: "clients.display_name", oldValue: "合成舊名稱", newValue: "合成新名稱",
      owner: "central", oldSourceAuthority: "local", action: "propose_set", conflict: "existing_value_differs",
      sourceField: { rawValue: "合成新名稱", source: { parentPath: "SYNTHETIC/basic" } } });
    expect(result.changes[1]).toMatchObject({ oldValue: null, newValue: "1950-02-03", action: "propose_set", conflict: null });
    expect(result.issues.map((issue) => issue.code)).toEqual(expect.arrayContaining([
      "MAPPING_APPROVAL_RECEIPT_REQUIRED", "MAPPING_APPROVAL_VERIFICATION_REQUIRED",
      "SERVER_AUTHORIZATION_VERIFICATION_REQUIRED", "ARCHIVE_AND_ATTACHMENT_VERIFICATION_REQUIRED",
      "ATOMIC_PROMOTION_TRANSACTION_REQUIRED", "FIELD_REVIEW_REQUIRED",
    ]));
    expect(result.pendingFields).toEqual([]);
  });

  it("does not accept caller-supplied receipt references, approval booleans or AAL values as authorization", () => {
    const input = fixture();
    input.mapping.governanceReceiptReference = "caller-claims-approved";
    Object.assign(input, { approved: true, executable: true, aal: "aal2", status: "imported" });
    const result = buildPromotionPreflight(input);
    expect(result.executable).toBe(false);
    expect(result.status).toBe("draft_dry_run");
    expect(result.issues.map((issue) => issue.code)).toContain("MAPPING_APPROVAL_VERIFICATION_REQUIRED");
    expect(result.issues.map((issue) => issue.code)).toContain("SERVER_AUTHORIZATION_VERIFICATION_REQUIRED");
  });

  it("matches stable identifiers exactly, never by name, case folding or trimming", () => {
    for (const value of ["WRONG-ID", "exact-synthetic-id", " EXACT-SYNTHETIC-ID "]) {
      const input = fixture();
      input.targets[0].identifiers[0].value = value;
      input.targets[0].displayName = input.source.parsed.fields[1].normalizedValue;
      expect(codes(input)).toContain("TARGET_NOT_FOUND");
      expect(buildPromotionPreflight(input).changes).toEqual([]);
    }
  });

  it("never selects out-of-scope clients and never returns their values", () => {
    for (const part of ["organizationId", "branchId"] as const) {
      const input = fixture();
      input.targets[0].scope[part] = "other-scope";
      input.targets[0].displayName = "OUT_OF_SCOPE_SECRET";
      const result = buildPromotionPreflight(input);
      expect(result.issues.map((issue) => issue.code)).toContain("TARGET_NOT_FOUND");
      expect(JSON.stringify(result)).not.toContain("OUT_OF_SCOPE_SECRET");
    }
  });

  it("rejects source scope mismatch without exposing its pending fields", () => {
    const input = fixture();
    input.source.scope.branchId = "other-branch";
    const result = buildPromotionPreflight(input);
    expect(result.issues.map((issue) => issue.code)).toContain("SOURCE_SCOPE_MISMATCH");
    expect(result.pendingFields).toEqual([]);
    expect(JSON.stringify(result)).not.toContain("合成新名稱");
  });

  it("blocks zero/multiple source identifiers and zero/multiple matched clients", () => {
    const missing = fixture();
    missing.source.parsed.fields.shift();
    expect(codes(missing)).toContain("IDENTIFIER_MISSING");
    const duplicateSource = fixture();
    duplicateSource.source.parsed.fields.push({ ...duplicateSource.source.parsed.fields[0], id: "id-2" });
    expect(codes(duplicateSource)).toContain("IDENTIFIER_AMBIGUOUS");
    const duplicateTarget = fixture();
    duplicateTarget.targets.push({ ...duplicateTarget.targets[0], id: "other-client" });
    expect(codes(duplicateTarget)).toContain("TARGET_AMBIGUOUS");
  });

  it("blocks caller-selected wrong client, missing/stale target baseline and stale source version", () => {
    const cases: Array<[string, (input: PromotionPreflightInput) => void]> = [
      ["TARGET_BASELINE_MISMATCH", (input) => { input.comparison.expectedClient!.id = "caller-wrong-client"; }],
      ["TARGET_BASELINE_REQUIRED", (input) => { input.comparison.expectedClient = null; }],
      ["TARGET_BASELINE_STALE", (input) => { input.targets[0].rowVersion = 4; }],
      ["SOURCE_VERSION_STALE", (input) => { input.comparison.expectedSourceVersion = 1; }],
    ];
    for (const [code, mutate] of cases) {
      const input = fixture(); mutate(input);
      const result = buildPromotionPreflight(input);
      expect(result.issues.map((issue) => issue.code)).toContain(code);
      expect(result.changes).toEqual([]);
    }
  });

  it("keeps every unknown field with exact raw values, source locations and warnings", () => {
    const input = fixture();
    const unknown = { ...field("unknown-1", "unreviewed", "  原始合成資料  "), normalizedValue: "原始合成資料", mappingState: "unknown" as const, warnings: ["synthetic warning"] };
    input.source.parsed.fields.push(unknown);
    const result = buildPromotionPreflight(input);
    expect(result.pendingFields).toEqual([unknown]);
    expect(result.issues.map((issue) => issue.code)).toContain("UNKNOWN_FIELDS_PENDING");
    expect(result.issues.map((issue) => issue.code)).toContain("SOURCE_REVIEW_REQUIRED");
  });

  it("distinguishes absent, explicit empty clear, NA and unmapped empty values", () => {
    const missing = fixture();
    missing.source.parsed.fields.pop();
    expect(buildPromotionPreflight(missing).changes[1]).toMatchObject({ valueState: "missing", action: "preserve", sourceField: null });
    const blank = fixture();
    blank.targets[0].dateOfBirth = "1951-02-03";
    blank.source.parsed.fields[2].normalizedValue = "";
    expect(buildPromotionPreflight(blank).changes[1]).toMatchObject({ valueState: "clear", action: "propose_clear", newValue: null, conflict: "clear_requires_review" });
    const na = fixture();
    na.source.parsed.fields[2].normalizedValue = "SYNTHETIC_NA";
    expect(buildPromotionPreflight(na).changes[1]).toMatchObject({ valueState: "not_applicable", action: "blocked" });
    expect(codes(na)).toContain("NOT_APPLICABLE_UNSUPPORTED");
    const unspecifiedBlank = fixture();
    unspecifiedBlank.source.parsed.fields[1].normalizedValue = "";
    expect(buildPromotionPreflight(unspecifiedBlank).changes[0]).toMatchObject({ valueState: "missing", action: "preserve" });
  });

  it("requires missing required fields and rejects clearing a non-nullable display name", () => {
    const input = fixture();
    input.source.parsed.fields[1].normalizedValue = "";
    input.mapping.fields[0].required = true;
    expect(codes(input)).toContain("FIELD_REQUIRED");
    input.mapping.fields[0].clearValues = [""];
    input.mapping.fields[0].required = false;
    expect(codes(input)).toContain("FIELD_VALUE_INVALID");
    expect(buildPromotionPreflight(input).changes[0].action).toBe("blocked");
  });

  it("does not let an explicit blank clear bypass a required birth-date rule", () => {
    const input = fixture();
    input.mapping.fields[1].required = true;
    input.source.parsed.fields[2].normalizedValue = "";
    input.targets[0].dateOfBirth = "1951-01-01";
    const result = buildPromotionPreflight(input);
    expect(result.changes[1]).toMatchObject({ valueState: "clear", action: "blocked", oldValue: "1951-01-01", newValue: null });
    expect(result.issues).toContainEqual({ code: "FIELD_REQUIRED", ruleIndex: 1 });
  });

  it("keeps unrecognized source sections under review even when they contain no extracted fields", () => {
    const input = fixture();
    input.source.parsed.sections.push({ id: "section-1", index: 1, code: "UNKNOWN", title: "Synthetic unknown section",
      sourceHeadingId: null, recognized: false });
    expect(codes(input)).toContain("SOURCE_REVIEW_REQUIRED");
  });

  it("enforces existing parser field and section size bounds before comparing", () => {
    const input = fixture();
    input.source.parsed.fields[1].rawValue = "x".repeat(250_001);
    expect(codes(input)).toContain("INVALID_INPUT");
    const sections = fixture();
    sections.source.parsed.sections = Array.from({ length: 501 }, (_, index) => ({ id: `section-${index}`, index,
      code: "SYNTHETIC", title: "Synthetic section", sourceHeadingId: null, recognized: true }));
    expect(codes(sections)).toContain("INVALID_INPUT");
  });

  it("protects locally owned values and distinguishes unchanged values", () => {
    const input = fixture();
    input.mapping.fields[0].owner = "local";
    expect(buildPromotionPreflight(input).changes[0]).toMatchObject({ action: "preserve", conflict: "local_authority" });
    expect(codes(input)).toContain("LOCAL_AUTHORITY_PROTECTED");
    input.source.parsed.fields[1].normalizedValue = input.targets[0].displayName;
    expect(buildPromotionPreflight(input).changes[0]).toMatchObject({ action: "unchanged", conflict: null });
  });

  it("rejects impossible, ambiguous and out-of-range dates without leaking values into issues", () => {
    for (const value of ["1950-02-30", "26/09/11", "2027-01-01", "1899-12-31", "1950-2-3", "SECRET_INVALID_DATE"]) {
      const input = fixture();
      input.source.parsed.fields[2].normalizedValue = value;
      const result = buildPromotionPreflight(input);
      expect(result.changes[1].action).toBe("blocked");
      expect(result.issues).toContainEqual({ code: "FIELD_VALUE_INVALID", ruleIndex: 1 });
      expect(JSON.stringify(result.issues)).not.toContain(value);
    }
    const leap = fixture(); leap.source.parsed.fields[2].normalizedValue = "1952-02-29";
    expect(buildPromotionPreflight(leap).changes[1].action).toBe("propose_set");
  });

  it("rejects unknown ownership enums and dangerous or unsupported destinations", () => {
    for (const destination of ["__proto__", "constructor.prototype.polluted", "clients.sex", "clients.status", "care_records.signed_at"]) {
      const input = fixture();
      Object.assign(input.mapping.fields[0], { destination });
      expect(codes(input)).toContain("INVALID_INPUT");
      expect(buildPromotionPreflight(input).changes).toEqual([]);
    }
    const input = fixture(); Object.assign(input.mapping.fields[0], { owner: "guessed" });
    expect(codes(input)).toContain("INVALID_INPUT");
    expect(Object.prototype).not.toHaveProperty("polluted");
  });

  it("rejects duplicate source selectors, duplicate destinations and overlapping semantic tokens", () => {
    const cases: Array<(input: PromotionPreflightInput) => void> = [
      (input) => { input.mapping.fields[1].source = { ...input.mapping.fields[0].source }; },
      (input) => { input.mapping.fields[1].destination = input.mapping.fields[0].destination; },
      (input) => { input.mapping.fields[1].missingValues = [""]; },
      (input) => { input.mapping.fields[0].source = { ...input.mapping.identity.source }; },
    ];
    for (const mutate of cases) {
      const input = fixture(); mutate(input);
      expect(codes(input)).toContain("INVALID_MAPPING_CONTRACT");
      expect(buildPromotionPreflight(input).changes).toEqual([]);
    }
  });

  it("keeps ambiguous same-locator fields pending even when their values match", () => {
    const input = fixture();
    const duplicated = { ...input.source.parsed.fields[1], id: "name-2" };
    input.source.parsed.fields.push(duplicated);
    const result = buildPromotionPreflight(input);
    expect(result.issues).toContainEqual({ code: "SOURCE_SELECTION_AMBIGUOUS", ruleIndex: 0 });
    expect(result.changes).toHaveLength(1);
    expect(result.pendingFields.map((item) => item.id)).toEqual(["name-1", "name-2"]);
  });

  it("rejects duplicate field IDs, mismatched mapping versions and unsafe parser evidence", () => {
    const duplicate = fixture(); duplicate.source.parsed.fields[1].id = duplicate.source.parsed.fields[0].id;
    expect(codes(duplicate)).toContain("SOURCE_FIELD_IDS_DUPLICATED");
    const mismatched = fixture(); mismatched.source.parsed.fields[1].mappingVersion = "other-version";
    expect(codes(mismatched)).toContain("SOURCE_MAPPING_VERSION_MISMATCH");
    const unsafe = fixture(); Object.assign(unsafe.source.parsed.security, { externalRequestCount: 1 });
    expect(codes(unsafe)).toContain("INVALID_INPUT");
    const invalidDate = fixture(); invalidDate.comparison.asOfDate = "2026-02-30";
    expect(codes(invalidDate)).toContain("INVALID_COMPARISON_DATE");
  });

  it("blocks source conflict values and never hides unresolved parser conflicts", () => {
    const input = fixture();
    input.source.parsed.fields[1].mappingState = "conflict";
    input.source.parsed.conflicts.push({ id: "conflict-1", mappingKey: "synthetic.synthetic-name", sectionCode: "SYNTHETIC", label: "synthetic-name",
      candidates: [{ fieldId: "name-1", value: "合成新名稱" }], reason: "multiple_source_values" });
    const result = buildPromotionPreflight(input);
    expect(result.issues.map((issue) => issue.code)).toContain("SOURCE_REVIEW_REQUIRED");
    expect(result.changes[0].action).toBe("blocked");
  });

  it("rejects an identifier named in parser conflict metadata even if its field is marked mapped", () => {
    const input = fixture();
    input.source.parsed.conflicts.push({ id: "identity-conflict", mappingKey: input.source.parsed.fields[0].mappingKey,
      sectionCode: "SYNTHETIC", label: "synthetic-id", candidates: [{ fieldId: "id-1", value: "EXACT-SYNTHETIC-ID" }],
      reason: "multiple_source_values" });
    const result = buildPromotionPreflight(input);
    expect(result.issues.map((issue) => issue.code)).toContain("IDENTIFIER_UNUSABLE");
    expect(result.target).toBeNull();
    expect(result.changes).toEqual([]);
  });

  it("produces deterministic frozen proposals without mutating or freezing its input", () => {
    const input = fixture();
    const before = JSON.stringify(input);
    const first = buildPromotionPreflight(input);
    const second = buildPromotionPreflight(fixture());
    expect(first.proposalHash).toMatch(/^[a-f0-9]{64}$/);
    expect(first.proposalHash).toBe(second.proposalHash);
    expect(JSON.stringify(input)).toBe(before);
    expect(Object.isFrozen(input)).toBe(false);
    expect(Object.isFrozen(first)).toBe(true);
    expect(Object.isFrozen(first.changes)).toBe(true);
    expect(Object.isFrozen(first.changes[0].sourceField?.source)).toBe(true);
    input.source.parsed.fields[1].normalizedValue = "later input mutation";
    expect(first.changes[0].newValue).toBe("合成新名稱");
    expect(buildPromotionPreflight(input).proposalHash).not.toBe(first.proposalHash);
  });

  it("binds hash to unknown raw values, rule versions, receipts and current target snapshots", () => {
    const base = buildPromotionPreflight(fixture()).proposalHash;
    const cases: Array<(input: PromotionPreflightInput) => void> = [
      (input) => { input.source.parsed.fields.push(field("unknown", "unknown", "synthetic-unknown")); },
      (input) => { input.source.parsed.fields[1].rawValue = " raw whitespace "; },
      (input) => { input.mapping.version = "synthetic-basic-draft@2"; },
      (input) => { input.mapping.governanceReceiptReference = "unverified-reference"; },
      (input) => { input.targets[0].dateOfBirth = "1960-01-01"; },
    ];
    for (const mutate of cases) {
      const input = fixture(); mutate(input);
      expect(buildPromotionPreflight(input).proposalHash).not.toBe(base);
    }
  });
});
