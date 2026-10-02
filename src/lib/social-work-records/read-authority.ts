import { z } from "zod";
import type { TenantContext } from "@/lib/domain/types";

export const socialWorkReadUuid = z.uuid().transform(value => value.toLowerCase());
export const socialWorkReadScopeSchema = z.object({ organizationId: socialWorkReadUuid, branchId: socialWorkReadUuid, userId: socialWorkReadUuid }).strict();
export type SocialWorkReadScope = z.input<typeof socialWorkReadScopeSchema>;
export const socialWorkReadCapabilitiesSchema = z.object({ canManage: z.boolean(), canSign: z.boolean(), hasRecentAal2: z.boolean() }).strict();
export type SocialWorkReadCapabilities = z.infer<typeof socialWorkReadCapabilitiesSchema>;
const names = z.array(z.string().min(1).max(120).refine(value => !/[\u0000-\u001f\u007f]/u.test(value))).max(512);
const signatureSchema = z.tuple([z.tuple([socialWorkReadUuid, socialWorkReadUuid, socialWorkReadUuid, z.literal(false)]), names, names, z.literal("aal2")]);

/** Pure canonical tuple; identical to pages28/29 journals, not a browser authority. */
export function socialWorkReadAuthoritySignature(context: TenantContext) {
 return JSON.stringify([[context.organizationId.toLowerCase(), context.branchId.toLowerCase(), context.userId.toLowerCase(), context.demo],
  [...new Set(context.roles)].sort(), [...new Set(context.scopes)].sort(), context.assuranceLevel]);
}
export function validateSocialWorkReadAuthority(signature: string, scope: SocialWorkReadScope, capabilities: SocialWorkReadCapabilities) {
 const expected = socialWorkReadScopeSchema.parse(scope);
 const tuple = signatureSchema.parse(JSON.parse(signature));
 const canonical = JSON.stringify([tuple[0], [...new Set(tuple[1])].sort(), [...new Set(tuple[2])].sort(), tuple[3]]);
 if (signature !== canonical || JSON.stringify(tuple[0]) !== JSON.stringify([expected.organizationId, expected.branchId, expected.userId, false]) ||
  !["clients.read","social_work_records.read"].every(value => tuple[2].includes(value)) ||
  capabilities.canManage !== tuple[2].includes("social_work_records.manage") ||
  capabilities.canSign !== tuple[2].includes("social_work_records.sign") ||
  capabilities.hasRecentAal2 && !capabilities.canSign) throw new Error("INVALID_SOCIAL_WORK_READ_AUTHORITY");
}
/** Contains no response content or credentials; consumers can redact on401/403. */
export class SnapshotReadError extends Error {
 constructor(readonly status: number | null, readonly code: "UNAVAILABLE" | "INVALID_RESPONSE" | "ABORTED") {
  super(`SNAPSHOT_READ_${code}`); this.name = "SnapshotReadError";
 }
}

