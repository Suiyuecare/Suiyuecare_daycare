import { z } from "zod";
import { fetchWithTimeout } from "@/lib/api/client-fetch";
import { normalizeReferralSnapshot } from "./snapshot-contract";
import { REFERRAL_RECEIVING_UNIT_MODES, REFERRAL_STATUSES, type ReferralManagementFilters, type ReferralManagementSnapshot } from "./types";

const uuid = z.uuid().transform(value => value.toLowerCase());
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/u).refine(value => {
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(+parsed) && parsed.toISOString().slice(0, 10) === value;
});
export const referralReadFiltersSchema = z.object({
  clientId: uuid.nullable(), receivingUnitMode: z.enum(REFERRAL_RECEIVING_UNIT_MODES),
  receivingUnitCode: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,39}$/u).nullable(),
  status: z.union([z.literal("all"), z.enum(REFERRAL_STATUSES)]),
  recentFrom: date.nullable(), recentTo: date.nullable(),
  query: z.string().max(120).refine(value => !/[\u0000-\u001f\u007f]/u.test(value)),
}).strict().refine(value => value.receivingUnitMode === "specific"
  ? value.receivingUnitCode !== null && !REFERRAL_RECEIVING_UNIT_MODES.includes(value.receivingUnitCode as typeof REFERRAL_RECEIVING_UNIT_MODES[number])
  : value.receivingUnitCode === null).refine(value => value.recentFrom === null || value.recentTo === null || value.recentFrom <= value.recentTo);
export const referralReadScopeSchema = z.object({ organizationId: uuid, branchId: uuid, userId: uuid }).strict();
export type ReferralReadScope = z.input<typeof referralReadScopeSchema>;
const envelope = z.object({ requestId: uuid, status: z.literal("ok"), errors: z.tuple([]),
  data: z.object({ schemaVersion: z.literal(1), organizationId: uuid, branchId: uuid, actorUserId: uuid,
    nonce: uuid, filters: referralReadFiltersSchema, snapshot: z.unknown(), demo: z.literal(false) }).strict(),
}).strict();

export function serializeReferralReadFilters(value: ReferralManagementFilters) {
  return encodeURIComponent(JSON.stringify(referralReadFiltersSchema.parse(value)));
}
export function parseReferralReadFilters(header: string | null) {
  if (!header || header.length > 4096) throw new Error("INVALID_REFERRAL_READ_FILTERS");
  try { return referralReadFiltersSchema.parse(JSON.parse(decodeURIComponent(header))); }
  catch { throw new Error("INVALID_REFERRAL_READ_FILTERS"); }
}
export function parseReferralSnapshotEnvelope(raw: unknown, scope: ReferralReadScope, filters: ReferralManagementFilters,
  nonce: string, now: number): ReferralManagementSnapshot {
  const expected = referralReadScopeSchema.parse(scope), expectedFilters = referralReadFiltersSchema.parse(filters);
  const proof = envelope.parse(raw).data;
  if (!Number.isFinite(now) || proof.nonce !== uuid.parse(nonce) || proof.organizationId !== expected.organizationId ||
    proof.branchId !== expected.branchId || proof.actorUserId !== expected.userId ||
    JSON.stringify(proof.filters) !== JSON.stringify(expectedFilters)) throw new Error("INVALID_REFERRAL_READ_BINDING");
  const snapshot = normalizeReferralSnapshot(proof.snapshot, expected);
  if (snapshot.demo || now < Date.parse(snapshot.generatedAt) || now >= Date.parse(snapshot.staleAfter)) {
    throw new Error("INVALID_REFERRAL_READ_FRESHNESS");
  }
  return snapshot;
}
/** Explicit manual read only. No operation key/body, navigation, replay or
 * storage. Owner must additionally fence actor/authority/unmount epochs. */
export async function readReferralSnapshot(scope: ReferralReadScope, filters: ReferralManagementFilters,
  signal?: AbortSignal): Promise<ReferralManagementSnapshot> {
  const expected = referralReadScopeSchema.parse(scope), nonce = crypto.randomUUID();
  const response = await fetchWithTimeout("/api/referrals/snapshot", { method: "GET", cache: "no-store", credentials: "same-origin", redirect: "error", signal,
    headers: { accept: "application/json", "x-organization-id": expected.organizationId, "x-branch-id": expected.branchId,
      "x-referral-read-nonce": nonce, "x-referral-read-filters": serializeReferralReadFilters(filters) } });
  if (response.status !== 200) throw new Error("REFERRAL_SNAPSHOT_READ_UNAVAILABLE");
  return parseReferralSnapshotEnvelope(await response.json(), expected, filters, nonce, Date.now());
}
