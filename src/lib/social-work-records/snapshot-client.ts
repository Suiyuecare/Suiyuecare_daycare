import { z } from "zod";
import { fetchWithTimeout } from "@/lib/api/client-fetch";
import { normalizeSocialWorkSnapshot } from "./snapshot-contract";
import { filterDemoSocialWorkRecordSnapshot } from "./projection";
import type { SocialWorkRecordFilters, SocialWorkRecordSnapshot } from "./types";
import { socialWorkReadUuid as uuid, socialWorkReadScopeSchema, socialWorkReadCapabilitiesSchema, validateSocialWorkReadAuthority, SnapshotReadError,
 type SocialWorkReadScope, type SocialWorkReadCapabilities } from "@/lib/social-work-records/read-authority";
export { SnapshotReadError } from "@/lib/social-work-records/read-authority";
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/u).refine(value => {
 const parsed = new Date(`${value}T00:00:00.000Z`);
 return value.slice(0,4) !== "0000" && Number.isFinite(+parsed) && parsed.toISOString().slice(0,10) === value;
});
export const socialWorkReadFiltersSchema = z.object({
 dateFrom: date.nullable(), dateTo: date.nullable(), clientId: uuid.nullable(), authorUserId: uuid.nullable(),
 serviceType: z.string().min(1).max(120).refine(value => value === value.trim() && !/[\u0000-\u001f\u007f]/u.test(value)).nullable(),
}).strict().refine(value => value.dateFrom === null || value.dateTo === null || value.dateFrom <= value.dateTo);
const envelope = z.object({ requestId: uuid, status: z.literal("ok"), errors: z.tuple([]),
 data: z.object({ schemaVersion: z.literal(1), organizationId: uuid, branchId: uuid, actorUserId: uuid, nonce: uuid,
 filters: socialWorkReadFiltersSchema, snapshot: z.unknown(), capabilities: socialWorkReadCapabilitiesSchema,
 authoritySignature: z.string().min(1).max(131072), demo: z.literal(false) }).strict(),
}).strict();
export type SocialWorkReadResult = { snapshot: SocialWorkRecordSnapshot; capabilities: SocialWorkReadCapabilities; authoritySignature: string };
export function serializeSocialWorkReadFilters(value: SocialWorkRecordFilters) {
 return encodeURIComponent(JSON.stringify(socialWorkReadFiltersSchema.parse(value)));
}
export function parseSocialWorkReadFilters(header: string | null): SocialWorkRecordFilters {
 if (!header || header.length > 4096) throw new Error("INVALID_SOCIALWORK_READ_FILTERS");
 try { return socialWorkReadFiltersSchema.parse(JSON.parse(decodeURIComponent(header))); }
 catch { throw new Error("INVALID_SOCIALWORK_READ_FILTERS"); }
}
export function parseSocialWorkSnapshotEnvelope(raw: unknown, scope: SocialWorkReadScope, filters: SocialWorkRecordFilters,
 nonce: string, now: number): SocialWorkReadResult {
 const expected = socialWorkReadScopeSchema.parse(scope), expectedFilters = socialWorkReadFiltersSchema.parse(filters), proof = envelope.parse(raw).data;
 if (!Number.isFinite(now) || proof.nonce !== uuid.parse(nonce) || proof.organizationId !== expected.organizationId ||
  proof.branchId !== expected.branchId || proof.actorUserId !== expected.userId ||
  JSON.stringify(proof.filters) !== JSON.stringify(expectedFilters)) throw new Error("INVALID_SOCIALWORK_READ_BINDING");
 validateSocialWorkReadAuthority(proof.authoritySignature, expected, proof.capabilities);
 const snapshot = normalizeSocialWorkSnapshot(proof.snapshot as SocialWorkRecordSnapshot, expected);
 if (filterDemoSocialWorkRecordSnapshot(snapshot, expectedFilters).records.length !== snapshot.records.length) throw new Error("INVALID_SOCIALWORK_READ_FILTER_EVIDENCE");
 if (snapshot.demo || now < Date.parse(snapshot.generatedAt) || now >= Date.parse(snapshot.staleAfter)) throw new Error("INVALID_SOCIALWORK_READ_FRESHNESS");
 return { snapshot, capabilities: proof.capabilities, authoritySignature: proof.authoritySignature };
}
/** Explicit manual no-store read only. Owner must fence authority/unmount/ABA
 * and compare returned canonical signature with its live context. No mutation,
 * operation replay, MFA acquisition, navigation or clinical browser storage. */
export async function readSocialWorkSnapshot(scope: SocialWorkReadScope, filters: SocialWorkRecordFilters,
 signal?: AbortSignal): Promise<SocialWorkReadResult> {
 const expected = socialWorkReadScopeSchema.parse(scope), normalizedFilters = socialWorkReadFiltersSchema.parse(filters), nonce = crypto.randomUUID();
 let response: Response;
 try {
  response = await fetchWithTimeout("/api/social-work-records/snapshot", { method: "GET", cache: "no-store", credentials: "same-origin", redirect: "error", signal,
   headers: { accept: "application/json", "x-organization-id": expected.organizationId, "x-branch-id": expected.branchId,
    "x-social-work-read-nonce": nonce, "x-social-work-read-filters": serializeSocialWorkReadFilters(normalizedFilters) } });
 } catch { throw new SnapshotReadError(null, signal?.aborted ? "ABORTED" : "UNAVAILABLE"); }
 if (response.status !== 200) throw new SnapshotReadError(response.status, "UNAVAILABLE");
 try {
  const raw: unknown = await response.json();
  if (signal?.aborted) throw new SnapshotReadError(null, "ABORTED");
  return parseSocialWorkSnapshotEnvelope(raw, expected, normalizedFilters, nonce, Date.now());
 }
 catch (error) { if (error instanceof SnapshotReadError) throw error; throw new SnapshotReadError(200, "INVALID_RESPONSE"); }
}
