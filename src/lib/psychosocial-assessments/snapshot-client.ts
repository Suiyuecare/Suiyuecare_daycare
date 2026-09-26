import { z } from "zod";
import { fetchWithTimeout } from "@/lib/api/client-fetch";
import { normalizePsychosocialSnapshot } from "./snapshot-contract";
import { filterDemoPsychosocialAssessmentSnapshot } from "./projection";
import type { PsychosocialAssessmentFilters, PsychosocialAssessmentSnapshot } from "./types";
import { CLIENT_SERVICE_STATUSES } from "./types";
import { socialWorkReadUuid as uuid, socialWorkReadScopeSchema, socialWorkReadCapabilitiesSchema, validateSocialWorkReadAuthority, SnapshotReadError,
 type SocialWorkReadScope, type SocialWorkReadCapabilities } from "@/lib/social-work-records/read-authority";
export { SnapshotReadError } from "@/lib/social-work-records/read-authority";
export const psychosocialReadFiltersSchema = z.object({
 clientId: uuid.nullable(), responsibleUserId: uuid.nullable(), serviceStatus: z.enum(CLIENT_SERVICE_STATUSES).nullable(),
 dueStatus: z.enum(["all","due","upcoming","not_assessed"]),
}).strict();
const envelope = z.object({ requestId: uuid, status: z.literal("ok"), errors: z.tuple([]),
 data: z.object({ schemaVersion: z.literal(1), organizationId: uuid, branchId: uuid, actorUserId: uuid, nonce: uuid,
 filters: psychosocialReadFiltersSchema, snapshot: z.unknown(), capabilities: socialWorkReadCapabilitiesSchema,
 authoritySignature: z.string().min(1).max(131072), demo: z.literal(false) }).strict(),
}).strict();
export type PsychosocialReadResult = { snapshot: PsychosocialAssessmentSnapshot; capabilities: SocialWorkReadCapabilities; authoritySignature: string };
export function serializePsychosocialReadFilters(value: PsychosocialAssessmentFilters) {
 return encodeURIComponent(JSON.stringify(psychosocialReadFiltersSchema.parse(value)));
}
export function parsePsychosocialReadFilters(header: string | null): PsychosocialAssessmentFilters {
 if (!header || header.length > 4096) throw new Error("INVALID_PSYCHOSOCIAL_READ_FILTERS");
 try { return psychosocialReadFiltersSchema.parse(JSON.parse(decodeURIComponent(header))); }
 catch { throw new Error("INVALID_PSYCHOSOCIAL_READ_FILTERS"); }
}
export function parsePsychosocialSnapshotEnvelope(raw: unknown, scope: SocialWorkReadScope, filters: PsychosocialAssessmentFilters,
 nonce: string, now: number): PsychosocialReadResult {
 const expected = socialWorkReadScopeSchema.parse(scope), expectedFilters = psychosocialReadFiltersSchema.parse(filters), proof = envelope.parse(raw).data;
 if (!Number.isFinite(now) || proof.nonce !== uuid.parse(nonce) || proof.organizationId !== expected.organizationId ||
  proof.branchId !== expected.branchId || proof.actorUserId !== expected.userId ||
  JSON.stringify(proof.filters) !== JSON.stringify(expectedFilters)) throw new Error("INVALID_PSYCHOSOCIAL_READ_BINDING");
 validateSocialWorkReadAuthority(proof.authoritySignature, expected, proof.capabilities);
 const snapshot = normalizePsychosocialSnapshot(proof.snapshot as PsychosocialAssessmentSnapshot, expected);
 if (filterDemoPsychosocialAssessmentSnapshot(snapshot, expectedFilters).items.length !== snapshot.items.length) throw new Error("INVALID_PSYCHOSOCIAL_READ_FILTER_EVIDENCE");
 if (snapshot.demo || now < Date.parse(snapshot.generatedAt) || now >= Date.parse(snapshot.staleAfter)) throw new Error("INVALID_PSYCHOSOCIAL_READ_FRESHNESS");
 return { snapshot, capabilities: proof.capabilities, authoritySignature: proof.authoritySignature };
}
/** Explicit manual no-store read only. Owner must fence authority/unmount/ABA
 * and compare returned canonical signature with its live context. No mutation,
 * operation replay, MFA acquisition, navigation or clinical browser storage. */
export async function readPsychosocialSnapshot(scope: SocialWorkReadScope, filters: PsychosocialAssessmentFilters,
 signal?: AbortSignal): Promise<PsychosocialReadResult> {
 const expected = socialWorkReadScopeSchema.parse(scope), normalizedFilters = psychosocialReadFiltersSchema.parse(filters), nonce = crypto.randomUUID();
 let response: Response;
 try {
  response = await fetchWithTimeout("/api/psychosocial-assessments/snapshot", { method: "GET", cache: "no-store", credentials: "same-origin", redirect: "error", signal,
   headers: { accept: "application/json", "x-organization-id": expected.organizationId, "x-branch-id": expected.branchId,
    "x-psychosocial-read-nonce": nonce, "x-psychosocial-read-filters": serializePsychosocialReadFilters(normalizedFilters) } });
 } catch { throw new SnapshotReadError(null, signal?.aborted ? "ABORTED" : "UNAVAILABLE"); }
 if (response.status !== 200) throw new SnapshotReadError(response.status, "UNAVAILABLE");
 try {
  const raw: unknown = await response.json();
  if (signal?.aborted) throw new SnapshotReadError(null, "ABORTED");
  return parsePsychosocialSnapshotEnvelope(raw, expected, normalizedFilters, nonce, Date.now());
 }
 catch (error) { if (error instanceof SnapshotReadError) throw error; throw new SnapshotReadError(200, "INVALID_RESPONSE"); }
}
