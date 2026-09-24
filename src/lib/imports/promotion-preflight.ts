import "server-only";

import { createHash } from "node:crypto";

import { z } from "zod";

import { MAX_IMPORT_FIELD_CHARACTERS, MAX_IMPORT_FIELDS, MAX_IMPORT_SECTIONS } from "./parser";
import type { ImportStagingField, ParsedHtmlImport } from "./types";

/** These are the existing basic-client columns, not an official source map. */
export const PROMOTION_PREFLIGHT_DESTINATIONS = Object.freeze([
  "clients.display_name",
  "clients.date_of_birth",
] as const);

const scopeSchema = z.object({
  organizationId: z.string().min(1),
  branchId: z.string().min(1),
});
const selectorSchema = z.object({
  sectionCode: z.string().min(1),
  label: z.string().min(1),
  parentPath: z.string().min(1),
  controlName: z.string().nullable(),
});
const ruleSchema = z.object({
  source: selectorSchema,
  destination: z.enum(PROMOTION_PREFLIGHT_DESTINATIONS),
  owner: z.enum(["central", "local"]),
  required: z.boolean(),
  /** Exact normalized source tokens. No built-in official blank/NA codes. */
  missingValues: z.array(z.string()),
  clearValues: z.array(z.string()),
  notApplicableValues: z.array(z.string()),
});
const mappingSchema = z.object({
  version: z.string().min(1),
  sourceMappingVersion: z.string().min(1),
  responsibleOwnerId: z.string().min(1),
  /** A reference for later server lookup, NEVER evidence of approval here. */
  governanceReceiptReference: z.string().min(1).nullable(),
  identity: z.object({
    source: selectorSchema,
    namespace: z.string().min(1),
  }),
  fields: z.array(ruleSchema).min(1).max(2),
});
const sourceFieldSchema = z.object({
  id: z.string().min(1),
  mappingKey: z.string(),
  mappingVersion: z.string(),
  mappingState: z.enum(["mapped", "unknown", "conflict"]),
  targetPath: z.string().nullable(),
  source: selectorSchema.extend({ sectionTitle: z.string() }),
  rawValue: z.string().max(MAX_IMPORT_FIELD_CHARACTERS),
  normalizedValue: z.string().max(MAX_IMPORT_FIELD_CHARACTERS),
  sensitive: z.boolean(),
  warnings: z.array(z.string()),
});
const parsedSchema = z.object({
  mappingVersion: z.string().min(1),
  contentFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  fields: z.array(sourceFieldSchema).max(MAX_IMPORT_FIELDS),
  sections: z.array(z.object({
    id: z.string(), index: z.number().int().nonnegative(), code: z.string(),
    title: z.string(), sourceHeadingId: z.string().nullable(), recognized: z.boolean(),
  })).max(MAX_IMPORT_SECTIONS),
  warnings: z.array(z.object({
    id: z.string(), code: z.string(), severity: z.enum(["info", "warning", "error"]),
    message: z.string(), sectionCode: z.string().optional(), fieldId: z.string().optional(),
  })),
  conflicts: z.array(z.object({
    id: z.string(), mappingKey: z.string(), sectionCode: z.string(), label: z.string(),
    candidates: z.array(z.object({ fieldId: z.string(), value: z.string() })),
    reason: z.enum(["multiple_source_values", "existing_value_differs"]),
  })),
  security: z.object({
    parser: z.literal("cheerio-static"),
    scriptElementsBlocked: z.number().int().nonnegative(),
    formElementsNeutralized: z.number().int().nonnegative(),
    redirectElementsBlocked: z.number().int().nonnegative(),
    activeElementsBlocked: z.number().int().nonnegative(),
    inlineEventHandlersBlocked: z.number().int().nonnegative(),
    externalReferencesBlocked: z.number().int().nonnegative(),
    externalRequestCount: z.literal(0),
  }),
});
const targetSchema = z.object({
  id: z.string().min(1),
  scope: scopeSchema,
  rowVersion: z.number().int().positive(),
  identifiers: z.array(z.object({ namespace: z.string().min(1), value: z.string().min(1) })),
  displayName: z.string(),
  dateOfBirth: z.string().nullable(),
  sourceAuthority: z.enum(["central", "local"]),
});
const inputSchema = z.object({
  source: z.object({
    batchId: z.string().min(1),
    version: z.number().int().positive(),
    scope: scopeSchema,
    fileSha256: z.string().regex(/^[a-f0-9]{64}$/),
    parsed: parsedSchema,
  }),
  /** Must eventually come from server reads. This pure function authenticates nobody. */
  comparison: z.object({
    scope: scopeSchema,
    asOfDate: z.string(),
    expectedSourceVersion: z.number().int().positive(),
    expectedClient: z.object({ id: z.string().min(1), rowVersion: z.number().int().positive() }).nullable(),
  }),
  mapping: mappingSchema,
  targets: z.array(targetSchema),
});

export type PromotionMappingDraft = z.infer<typeof mappingSchema>;
export type PromotionTargetSnapshot = z.infer<typeof targetSchema>;
export type PromotionPreflightInput = Omit<z.infer<typeof inputSchema>, "source"> & {
  source: Omit<z.infer<typeof inputSchema>["source"], "parsed"> & { parsed: ParsedHtmlImport };
};

export type PromotionPreflightIssueCode =
  | "INVALID_INPUT" | "INVALID_COMPARISON_DATE" | "SOURCE_SCOPE_MISMATCH"
  | "SOURCE_VERSION_STALE" | "SOURCE_MAPPING_VERSION_MISMATCH" | "INVALID_MAPPING_CONTRACT"
  | "SOURCE_FIELD_IDS_DUPLICATED" | "SOURCE_REVIEW_REQUIRED"
  | "IDENTIFIER_MISSING" | "IDENTIFIER_AMBIGUOUS" | "IDENTIFIER_UNUSABLE"
  | "TARGET_NOT_FOUND" | "TARGET_AMBIGUOUS" | "TARGET_BASELINE_REQUIRED"
  | "TARGET_BASELINE_MISMATCH" | "TARGET_BASELINE_STALE"
  | "SOURCE_SELECTION_AMBIGUOUS" | "FIELD_REQUIRED" | "FIELD_VALUE_INVALID"
  | "NOT_APPLICABLE_UNSUPPORTED" | "FIELD_REVIEW_REQUIRED" | "LOCAL_AUTHORITY_PROTECTED"
  | "UNKNOWN_FIELDS_PENDING"
  | "MAPPING_APPROVAL_RECEIPT_REQUIRED" | "MAPPING_APPROVAL_VERIFICATION_REQUIRED"
  | "SERVER_AUTHORIZATION_VERIFICATION_REQUIRED" | "ARCHIVE_AND_ATTACHMENT_VERIFICATION_REQUIRED"
  | "ATOMIC_PROMOTION_TRANSACTION_REQUIRED";

/** Codes and numeric positions only: safe for diagnostics without copying PHI. */
export type PromotionPreflightIssue = {
  code: PromotionPreflightIssueCode;
  ruleIndex?: number;
};
export type PromotionProposedChange = {
  ruleIndex: number;
  destination: (typeof PROMOTION_PREFLIGHT_DESTINATIONS)[number];
  owner: "central" | "local";
  oldSourceAuthority: "central" | "local";
  oldValue: string | null;
  newValue: string | null;
  valueState: "value" | "missing" | "clear" | "not_applicable" | "invalid";
  action: "preserve" | "unchanged" | "propose_set" | "propose_clear" | "blocked";
  sourceField: ImportStagingField | null;
  conflict: "existing_value_differs" | "clear_requires_review" | "local_authority" | null;
};
type DeepReadonly<T> = T extends object ? { readonly [K in keyof T]: DeepReadonly<T[K]> } : T;
export type PromotionPreflightProposal = DeepReadonly<{
  kind: "central_client_promotion_draft";
  status: "draft_dry_run";
  executable: false;
  /** Opaque integrity digest, not a signature, permission, or public telemetry value. */
  proposalHash: string;
  mappingVersion: string | null;
  sourceBatchId: string | null;
  sourceVersion: number | null;
  target: { id: string; rowVersion: number } | null;
  changes: PromotionProposedChange[];
  pendingFields: ImportStagingField[];
  issues: PromotionPreflightIssue[];
}>;

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.entries(value).filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
      .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function freeze<T>(value: T): DeepReadonly<T> {
  if (value !== null && typeof value === "object") {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value as DeepReadonly<T>;
}

function sameScope(left: z.infer<typeof scopeSchema>, right: z.infer<typeof scopeSchema>) {
  return left.organizationId === right.organizationId && left.branchId === right.branchId;
}

function selectorKey(selector: z.infer<typeof selectorSchema>) {
  return JSON.stringify([selector.sectionCode, selector.label, selector.parentPath, selector.controlName]);
}

function validDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function valueState(value: string | undefined, rule: PromotionMappingDraft["fields"][number]) {
  if (value === undefined || rule.missingValues.includes(value)) return "missing" as const;
  if (rule.clearValues.includes(value)) return "clear" as const;
  if (rule.notApplicableValues.includes(value)) return "not_applicable" as const;
  // Unspecified empty values never become destructive clear instructions.
  if (!value.trim()) return "missing" as const;
  return "value" as const;
}

/**
 * PURE, server-only comparison aid. No API, storage, database, clock, or network calls.
 * Call only with server-controlled mapping/target snapshots after permission filtering.
 * Its output contains personal data and MUST NOT be logged or sent as unfiltered client props.
 * Even a perfect comparison always has blocking governance/transaction gates. Do not use
 * `changes` as executable writes or treat a supplied receipt reference as verified approval.
 */
export function buildPromotionPreflight(input: PromotionPreflightInput): PromotionPreflightProposal {
  const issues: PromotionPreflightIssue[] = [
    { code: "SERVER_AUTHORIZATION_VERIFICATION_REQUIRED" },
    { code: "MAPPING_APPROVAL_VERIFICATION_REQUIRED" },
    { code: "ARCHIVE_AND_ATTACHMENT_VERIFICATION_REQUIRED" },
    { code: "ATOMIC_PROMOTION_TRANSACTION_REQUIRED" },
  ];
  const checked = inputSchema.safeParse(input);
  const data = checked.success ? checked.data : null;
  const changes: PromotionProposedChange[] = [];
  let target: { id: string; rowVersion: number } | null = null;
  const usedFieldIndices = new Set<number>();

  function finish(): PromotionPreflightProposal {
    const pendingFields = data?.source.parsed.fields.filter((_, index) => !usedFieldIndices.has(index)) ?? [];
    if (pendingFields.length) issues.push({ code: "UNKNOWN_FIELDS_PENDING" });
    const result = {
      kind: "central_client_promotion_draft" as const,
      status: "draft_dry_run" as const,
      executable: false as const,
      mappingVersion: data?.mapping.version ?? null,
      sourceBatchId: data?.source.batchId ?? null,
      sourceVersion: data?.source.version ?? null,
      target, changes, pendingFields, issues,
    };
    // Hash the complete validated source and reviewed-rule candidate, not just displayed
    // changes. Unmapped values and baseline changes must invalidate the draft digest too.
    const proposalHash = createHash("sha256").update(canonical({ input: data, result })).digest("hex");
    return freeze({ ...result, proposalHash });
  }

  if (!data) {
    issues.push({ code: "INVALID_INPUT" });
    return finish();
  }
  const { source, mapping, comparison } = data;
  if (!mapping.governanceReceiptReference) issues.push({ code: "MAPPING_APPROVAL_RECEIPT_REQUIRED" });
  if (!sameScope(source.scope, comparison.scope)) {
    issues.push({ code: "SOURCE_SCOPE_MISMATCH" });
    // Do not return source contents from a mismatched scope, even as pending fields.
    data.source.parsed.fields = [];
    return finish();
  }
  if (!validDate(comparison.asOfDate)) {
    issues.push({ code: "INVALID_COMPARISON_DATE" });
    return finish();
  }
  if (source.version !== comparison.expectedSourceVersion) {
    issues.push({ code: "SOURCE_VERSION_STALE" });
    return finish();
  }
  if (mapping.sourceMappingVersion !== source.parsed.mappingVersion ||
    source.parsed.fields.some((field) => field.mappingVersion !== source.parsed.mappingVersion)) {
    issues.push({ code: "SOURCE_MAPPING_VERSION_MISMATCH" });
    return finish();
  }
  if (new Set(source.parsed.fields.map((field) => field.id)).size !== source.parsed.fields.length) {
    issues.push({ code: "SOURCE_FIELD_IDS_DUPLICATED" });
    return finish();
  }
  const identityKey = selectorKey(mapping.identity.source);
  const ruleKeys = mapping.fields.map((rule) => selectorKey(rule.source));
  const invalidTokens = mapping.fields.some((rule) => {
    const tokens = [...rule.missingValues, ...rule.clearValues, ...rule.notApplicableValues];
    return new Set(tokens).size !== tokens.length;
  });
  if (invalidTokens || new Set(ruleKeys).size !== ruleKeys.length || ruleKeys.includes(identityKey) ||
    new Set(mapping.fields.map((rule) => rule.destination)).size !== mapping.fields.length) {
    issues.push({ code: "INVALID_MAPPING_CONTRACT" });
    return finish();
  }
  if (source.parsed.sections.some((section) => !section.recognized) || source.parsed.conflicts.length ||
    source.parsed.warnings.some((warning) => warning.severity !== "info") ||
    source.parsed.fields.some((field) => field.mappingState === "conflict" || field.warnings.length)) {
    issues.push({ code: "SOURCE_REVIEW_REQUIRED" });
  }
  const identityFields = source.parsed.fields.map((field, index) => ({ field, index }))
    .filter(({ field }) => selectorKey(field.source) === identityKey);
  if (identityFields.length !== 1) {
    issues.push({ code: identityFields.length ? "IDENTIFIER_AMBIGUOUS" : "IDENTIFIER_MISSING" });
    return finish();
  }
  const identity = identityFields[0];
  const hasSourceConflict = (field: ImportStagingField) => field.mappingState === "conflict" ||
    source.parsed.conflicts.some((conflict) => conflict.mappingKey === field.mappingKey ||
      conflict.candidates.some((candidate) => candidate.fieldId === field.id));
  if (!identity.field.normalizedValue.trim() || hasSourceConflict(identity.field) || identity.field.warnings.length) {
    issues.push({ code: "IDENTIFIER_UNUSABLE" });
    return finish();
  }
  const candidates = data.targets.filter((candidate) => sameScope(candidate.scope, comparison.scope) &&
    candidate.identifiers.some((identifier) => identifier.namespace === mapping.identity.namespace &&
      identifier.value === identity.field.normalizedValue));
  if (candidates.length !== 1) {
    issues.push({ code: candidates.length ? "TARGET_AMBIGUOUS" : "TARGET_NOT_FOUND" });
    return finish();
  }
  const client = candidates[0];
  target = { id: client.id, rowVersion: client.rowVersion };
  if (!comparison.expectedClient) {
    issues.push({ code: "TARGET_BASELINE_REQUIRED" });
    return finish();
  }
  if (comparison.expectedClient.id !== client.id) {
    issues.push({ code: "TARGET_BASELINE_MISMATCH" });
    return finish();
  }
  if (comparison.expectedClient.rowVersion !== client.rowVersion) {
    issues.push({ code: "TARGET_BASELINE_STALE" });
    return finish();
  }
  usedFieldIndices.add(identity.index);
  mapping.fields.forEach((rule, ruleIndex) => {
    const matches = source.parsed.fields.map((field, index) => ({ field, index }))
      .filter(({ field }) => selectorKey(field.source) === selectorKey(rule.source));
    if (matches.length > 1) {
      issues.push({ code: "SOURCE_SELECTION_AMBIGUOUS", ruleIndex });
      return;
    }
    const match = matches[0];
    if (match) usedFieldIndices.add(match.index);
    const oldValue = rule.destination === "clients.display_name" ? client.displayName : client.dateOfBirth;
    const state = valueState(match?.field.normalizedValue, rule);
    const change: PromotionProposedChange = {
      ruleIndex, destination: rule.destination, owner: rule.owner, oldSourceAuthority: client.sourceAuthority,
      oldValue, newValue: state === "value" ? match!.field.normalizedValue : null,
      valueState: state, action: "preserve", sourceField: match?.field ?? null, conflict: null,
    };
    changes.push(change);
    if (state === "missing") {
      if (rule.required) issues.push({ code: "FIELD_REQUIRED", ruleIndex });
      return;
    }
    if (state === "clear" && rule.required) {
      change.action = "blocked";
      issues.push({ code: "FIELD_REQUIRED", ruleIndex });
      return;
    }
    if (state === "not_applicable") {
      change.action = "blocked";
      issues.push({ code: "NOT_APPLICABLE_UNSUPPORTED", ruleIndex });
      return;
    }
    const value = change.newValue;
    const invalid = rule.destination === "clients.display_name"
      ? value === null || value.trim() !== value || !value.length || [...value].length > 120 || /[\u0000-\u001f\u007f]/u.test(value)
      // Match the existing client-master write constraint, not a medical inference.
      : value !== null && (!validDate(value) || value < "1900-01-01" || value > comparison.asOfDate);
    if (invalid) {
      change.valueState = "invalid";
      change.action = "blocked";
      issues.push({ code: "FIELD_VALUE_INVALID", ruleIndex });
      return;
    }
    if (match && (hasSourceConflict(match.field) || match.field.warnings.length)) {
      change.action = "blocked";
      return;
    }
    if (value === oldValue) {
      change.action = "unchanged";
      return;
    }
    if (rule.owner === "local") {
      change.conflict = "local_authority";
      issues.push({ code: "LOCAL_AUTHORITY_PROTECTED", ruleIndex });
      return;
    }
    change.action = state === "clear" ? "propose_clear" : "propose_set";
    if (state === "clear" || oldValue !== null) {
      change.conflict = state === "clear" ? "clear_requires_review" : "existing_value_differs";
      issues.push({ code: "FIELD_REVIEW_REQUIRED", ruleIndex });
    }
  });
  return finish();
}
