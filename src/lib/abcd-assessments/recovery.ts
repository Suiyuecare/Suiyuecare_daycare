import { isStrictOffsetDateTime } from "@/lib/integrations/datetime";
import { IntegrationError } from "@/lib/integrations/errors";
import { z } from "zod";

import { parseAbcdAssessmentMutation } from "./parser";
import type { AbcdAssessmentMutationInput } from "./types";

const uuid = z.uuid().transform((value) => value.toLowerCase());
const timestamp = z.string().refine((value) => isStrictOffsetDateTime(value) &&
  Number.isFinite(Date.parse(value))).transform((value) => new Date(value).toISOString());
const operation = z.enum(["create", "revise", "sign", "correct"]);
const source = z.object({ organization_id: uuid, branch_id: uuid,
  client_id: uuid.nullable(), generated_at: timestamp,
  absence_is_final: z.literal(false), truncated: z.boolean(),
  pending_truncated: z.boolean(), operations: z.array(z.object({
    reservation_id: uuid, client_id: uuid, operation,
    assessment_type: z.enum(["A", "B", "C", "D"]),
    assessment_year: z.number().int().min(2000).max(2200),
    baseline_version: z.number().int().min(0).max(1_000_000),
    state: z.enum(["pending", "committed"]), created_at: timestamp,
    committed_at: timestamp.nullable(),
  }).strict()).max(20) }).strict();
const continuation = z.object({ receipt: z.unknown(), request: z.object({
  action: z.enum(["save_assessment", "sign_assessment", "correct_assessment"]),
  payload: z.record(z.string(), z.unknown()), idempotency_key: uuid,
}).strict() }).strict();

export type AbcdRecoverySummary = {
  organizationId: string;
  branchId: string;
  clientId: string | null;
  generatedAt: string;
  absenceIsFinal: false;
  truncated: boolean;
  pendingTruncated: boolean;
  operations: Array<{
    reservationId: string;
    clientId: string;
    operation: "create" | "revise" | "sign" | "correct";
    assessmentType: "A" | "B" | "C" | "D";
    assessmentYear: number;
    baselineVersion: number;
    state: "pending" | "committed";
    createdAt: string;
    committedAt: string | null;
  }>;
};

function invalid(): never {
  throw new IntegrationError("ABCD_ASSESSMENT_RECOVERY_INVALID",
    "ABCD 評估查證結果不完整；請勿以新操作鍵重送。", 502);
}

export function parseAbcdRecoverySummary(value: unknown, organizationId: string,
  branchId: string, clientId: string | null): AbcdRecoverySummary {
  const parsed = source.safeParse(value);
  if (!parsed.success || parsed.data.organization_id !== organizationId ||
    parsed.data.branch_id !== branchId || parsed.data.client_id !== clientId ||
    parsed.data.operations.some((item) => (clientId !== null && item.client_id !== clientId) ||
      (item.state === "committed") !== (item.committed_at !== null))) invalid();
  const row = parsed.data;
  return { organizationId: row.organization_id, branchId: row.branch_id,
    clientId: row.client_id, generatedAt: row.generated_at,
    absenceIsFinal: false, truncated: row.truncated,
    pendingTruncated: row.pending_truncated,
    operations: row.operations.map((item) => ({
      reservationId: item.reservation_id, clientId: item.client_id,
      operation: item.operation, assessmentType: item.assessment_type,
      assessmentYear: item.assessment_year, baselineVersion: item.baseline_version,
      state: item.state, createdAt: item.created_at, committedAt: item.committed_at,
    })) };
}

export function parseAbcdRecoveryContinuation(value: unknown): {
  receipt: unknown; input: AbcdAssessmentMutationInput;
} {
  const parsed = continuation.safeParse(value);
  if (!parsed.success) invalid();
  const { action, payload, idempotency_key: key } = parsed.data.request;
  try {
    const { reason, ...rest } = payload;
    const input = action === "save_assessment" ?
      parseAbcdAssessmentMutation({ ...rest, action, revision_reason: reason }, key) :
      parseAbcdAssessmentMutation({ ...payload, action }, key);
    return { receipt: parsed.data.receipt, input };
  } catch { invalid(); }
}
