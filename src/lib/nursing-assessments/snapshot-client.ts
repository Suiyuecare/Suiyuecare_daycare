import { z } from "zod";
import { CLIENT_WRITE_TIMEOUT_MS, fetchWithTimeout } from "@/lib/api/client-fetch";
import { projectNursingAssessmentSnapshot } from "./parser";
import { NursingSnapshotReadError, nursingReadCapabilitiesSchema, nursingReadScopeSchema, nursingReadUuid,
  validateNursingReadAuthority, type NursingReadCapabilities, type NursingReadScope } from "./read-authority";
import type { NursingAssessmentSnapshot } from "./types";
export { NursingSnapshotReadError } from "./read-authority";

const envelope = z.object({ requestId: nursingReadUuid, status: z.literal("ok"), errors: z.tuple([]),
  data: z.object({ schemaVersion: z.literal(1), organizationId: nursingReadUuid, branchId: nursingReadUuid,
    actorUserId: nursingReadUuid, nonce: nursingReadUuid, snapshot: z.unknown(),
    capabilities: nursingReadCapabilitiesSchema, authoritySignature: z.string().min(1).max(20_000), demo: z.literal(false),
  }).strict(),
}).strict();
export type NursingSnapshotReadResult = {
  snapshot: NursingAssessmentSnapshot; capabilities: NursingReadCapabilities; authoritySignature: string;
};

export function parseNursingSnapshotEnvelope(raw: unknown, scope: NursingReadScope, nonce: string, now: number): NursingSnapshotReadResult {
  const expected = nursingReadScopeSchema.parse(scope), proof = envelope.parse(raw).data;
  if (!Number.isFinite(now) || proof.nonce !== nursingReadUuid.parse(nonce) ||
    proof.organizationId !== expected.organizationId || proof.branchId !== expected.branchId || proof.actorUserId !== expected.userId) {
    throw new Error("INVALID_NURSING_READ_BINDING");
  }
  validateNursingReadAuthority(proof.authoritySignature, expected, proof.capabilities, now);
  const snapshot = projectNursingAssessmentSnapshot(proof.snapshot, expected.organizationId, expected.branchId);
  if (now < Date.parse(snapshot.generatedAt) || now >= Date.parse(snapshot.staleAfter)) throw new Error("INVALID_NURSING_READ_FRESHNESS");
  return { snapshot, capabilities: proof.capabilities, authoritySignature: proof.authoritySignature };
}

/** Explicit manual read only. Its owner fences scope/authority/unmount/ABA.
 * No automatic read, write replay, MFA, navigation or browser persistence. */
export async function readNursingSnapshot(scope: NursingReadScope, signal?: AbortSignal): Promise<NursingSnapshotReadResult> {
  const expected = nursingReadScopeSchema.parse(scope);
  if (signal?.aborted) throw new NursingSnapshotReadError(null, "ABORTED");
  const nonce = crypto.randomUUID(), controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), CLIENT_WRITE_TIMEOUT_MS);
  const bounded = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal;
  let removeAbort = () => {};
  const aborted = new Promise<never>((_resolve, reject) => {
    const onAbort = () => reject(new NursingSnapshotReadError(null, signal?.aborted ? "ABORTED" : "UNAVAILABLE"));
    bounded.addEventListener("abort", onAbort, { once: true });
    removeAbort = () => bounded.removeEventListener("abort", onAbort);
    if (bounded.aborted) onAbort();
  });
  try {
    const operation = (async () => {
      let response: Response;
      try {
        response = await fetchWithTimeout("/api/nursing-assessments/snapshot", {
          method: "GET", cache: "no-store", credentials: "same-origin", redirect: "error", signal: bounded,
          headers: { accept: "application/json", "x-organization-id": expected.organizationId,
            "x-branch-id": expected.branchId, "x-nursing-read-nonce": nonce },
        });
      } catch { throw new NursingSnapshotReadError(null, signal?.aborted ? "ABORTED" : "UNAVAILABLE"); }
      if (bounded.aborted) throw new NursingSnapshotReadError(null, signal?.aborted ? "ABORTED" : "UNAVAILABLE");
      if (response.status !== 200) throw new NursingSnapshotReadError(response.status, "UNAVAILABLE");
      try {
        const raw: unknown = await response.json();
        if (bounded.aborted) throw new NursingSnapshotReadError(null, signal?.aborted ? "ABORTED" : "UNAVAILABLE");
        return parseNursingSnapshotEnvelope(raw, expected, nonce, Date.now());
      } catch (error) {
        if (error instanceof NursingSnapshotReadError) throw error;
        throw new NursingSnapshotReadError(200, "INVALID_RESPONSE");
      }
    })();
    return await Promise.race([operation, aborted]);
  } finally { clearTimeout(timer); removeAbort(); }
}
