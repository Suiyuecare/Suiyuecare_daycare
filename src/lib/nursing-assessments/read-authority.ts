import { z } from "zod";
import type { TenantContext } from "@/lib/domain/types";
import { isStrictOffsetDateTime } from "@/lib/integrations/datetime";

export const nursingReadUuid = z.uuid().transform((value) => value.toLowerCase());
export const nursingReadScopeSchema = z.object({
  organizationId: nursingReadUuid, branchId: nursingReadUuid, userId: nursingReadUuid,
}).strict();
export type NursingReadScope = z.input<typeof nursingReadScopeSchema>;
export const nursingReadCapabilitiesSchema = z.object({
  canManage: z.boolean(), canSign: z.boolean(), hasRecentAal2: z.boolean(),
}).strict();
export type NursingReadCapabilities = z.infer<typeof nursingReadCapabilitiesSchema>;
const timestamp = z.string().max(64).refine((value) => isStrictOffsetDateTime(value) && Number.isFinite(Date.parse(value)))
  .transform((value) => new Date(value).toISOString());
const names = z.array(z.string().min(1).max(120).refine((value) => !/[\u0000-\u001f\u007f]/u.test(value))).max(512);
const signatureSchema = z.tuple([
  z.tuple([nursingReadUuid, nursingReadUuid, nursingReadUuid, z.literal(false)]),
  names, names, z.literal("aal2"), timestamp.nullable(),
]);

/** Pure five-part tuple shared with the nursing journal. This encodes supplied
 * server authority; it does not acquire reauthentication or grant any scope. */
export function nursingReadAuthoritySignature(context: TenantContext) {
  return JSON.stringify([[context.organizationId.toLowerCase(), context.branchId.toLowerCase(), context.userId.toLowerCase(), context.demo],
    [...new Set(context.roles)].sort(), [...new Set(context.scopes)].sort(), context.assuranceLevel,
    context.recentAal2At === null ? null : timestamp.parse(context.recentAal2At)]);
}

export function validateNursingReadAuthority(signature: string, scope: NursingReadScope,
  capabilities: NursingReadCapabilities, now = Date.now()) {
  if (!signature || signature.length > 20_000 || !Number.isFinite(now)) throw new Error("INVALID_NURSING_READ_AUTHORITY");
  const expected = nursingReadScopeSchema.parse(scope), flags = nursingReadCapabilitiesSchema.parse(capabilities);
  const tuple = signatureSchema.parse(JSON.parse(signature));
  const canonical = JSON.stringify([tuple[0], [...new Set(tuple[1])].sort(), [...new Set(tuple[2])].sort(), tuple[3], tuple[4]]);
  const nurse = tuple[1].includes("nurse");
  const canManage = nurse && tuple[2].includes("nursing_assessments.manage");
  const canSign = nurse && tuple[2].includes("nursing_assessments.sign");
  const age = tuple[4] === null ? Infinity : now - Date.parse(tuple[4]);
  if (signature !== canonical || JSON.stringify(tuple[0]) !== JSON.stringify([expected.organizationId, expected.branchId, expected.userId, false]) ||
    !["clients.read", "nursing_assessments.read"].every((name) => tuple[2].includes(name)) ||
    flags.canManage !== canManage || flags.canSign !== canSign ||
    tuple[4] !== null && (!canSign || age < 0) || flags.hasRecentAal2 !== (canSign && age >= 0 && age <= 15 * 60_000)) {
    throw new Error("INVALID_NURSING_READ_AUTHORITY");
  }
}

/** Safe transport metadata only: never retains a clinical body or credential. */
export class NursingSnapshotReadError extends Error {
  constructor(readonly status: number | null, readonly code: "UNAVAILABLE" | "INVALID_RESPONSE" | "ABORTED") {
    super(`NURSING_SNAPSHOT_READ_${code}`); this.name = "NursingSnapshotReadError";
  }
}
