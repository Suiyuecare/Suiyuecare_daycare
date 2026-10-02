import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({ createServerSupabaseClient: async () => null }));
import { getGeneralImportRecentAal2At, revalidateGeneralImportActor, type EvidenceClient } from "./reauth";
import type { TenantContext } from "@/lib/domain/types";
import type { ImportActor } from "./types";

const now = "2026-09-27T12:00:00.000Z";
const scope = { organizationId: "00000000-0000-4000-8000-000000000001", branchId: "00000000-0000-4000-8000-000000000002" };
const actor: ImportActor = { ...scope, userId: "00000000-0000-4000-8000-000000000003", assuranceLevel: "aal2", recentAal2At: now };
const tenant: TenantContext = { ...actor, organizationName: "合成機構", branchName: "合成分支", displayName: "合成人員", roles: ["organization_manager"], scopes: ["imports.manage", "imports.approve"], demo: false };
const evidence = { ...scope, actorUserId: actor.userId, verifiedAt: "2026-09-27T11:53:00.000Z" };
const client = (data: unknown, error: unknown = null) => ({ rpc: vi.fn().mockResolvedValue({ data, error }) }) satisfies EvidenceClient;
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(now); });
afterEach(() => { vi.useRealTimers(); });

describe("general import actual reauthentication evidence", () => {
  it("preserves the verified challenge time rather than inventing a current time", async () => {
    const provider = client(evidence);
    expect(await getGeneralImportRecentAal2At(tenant, provider)).toBe(evidence.verifiedAt);
    expect(provider.rpc).toHaveBeenCalledWith("general_import_recent_aal2_evidence", { p_org: scope.organizationId, p_branch: scope.branchId });
  });
  it.each([null, true, { ...evidence, extra: "not-allowed" }, { ...evidence, actorUserId: scope.branchId },
    { ...evidence, branchId: scope.organizationId }, { ...evidence, organizationId: scope.branchId },
    { ...evidence, verifiedAt: "2026-09-27T11:44:59Z" }, { ...evidence, verifiedAt: "2026-09-27T12:00:01Z" },
    { ...evidence, verifiedAt: "2026-02-30T12:00:00Z" }, { ...evidence, verifiedAt: "2026-09-27 11:53:00" }])("denies malformed, mismatched or stale evidence %#", async data => {
    expect(await getGeneralImportRecentAal2At(tenant, client(data))).toBeNull();
  });
  it.each([{ ...tenant, demo: true }, { ...tenant, assuranceLevel: "aal1" as const }, { ...tenant, branchId: "" }, { ...tenant, scopes: [] }])("does not request evidence for an ineligible actor %#", async value => {
    const provider = client(evidence); expect(await getGeneralImportRecentAal2At(value, provider)).toBeNull(); expect(provider.rpc).not.toHaveBeenCalled();
  });
  it("does not borrow a cached nursing proof or provider error", async () => {
    expect(await getGeneralImportRecentAal2At(tenant, client(null, { code: "42501", message: "SYNTHETIC_SECRET" }))).toBeNull();
    expect(await getGeneralImportRecentAal2At(tenant)).toBeNull();
  });
  it("captures evidence scope before waiting for the provider", async () => {
    const changed = { ...tenant }; let release!: (value: { data: unknown; error: null }) => void;
    const promise = getGeneralImportRecentAal2At(changed, { rpc: () => new Promise(resolve => { release = resolve; }) });
    changed.branchId = scope.organizationId;
    release({ data: evidence, error: null }); expect(await promise).toBe(evidence.verifiedAt);
  });
  it("does not request evidence with malformed scope IDs", async () => {
    const provider = client(evidence);
    expect(await getGeneralImportRecentAal2At({ ...tenant, branchId: "bad-scope" }, provider)).toBeNull();
    expect(provider.rpc).not.toHaveBeenCalled();
  });
});

describe("live general import reauthorization", () => {
  it("reads without recent MFA but demands live AAL2 and exact read proof", async () => {
    const provider = client({ ...evidence, assuranceLevel: "aal2", verifiedAt: null });
    const result = await revalidateGeneralImportActor(actor, "read", provider);
    expect(result).toEqual({ ...actor, recentAal2At: null }); expect(result).not.toBe(actor);
    expect(provider.rpc).toHaveBeenCalledWith("general_import_repository_authorize", { p_org: scope.organizationId, p_branch: scope.branchId, p_action: "read" });
  });
  it.each(["write", "approve"] as const)("uses %s actual evidence without mutating the actor", async action => {
    const result = await revalidateGeneralImportActor(actor, action, client({ ...evidence, assuranceLevel: "aal2" }));
    expect(result.recentAal2At).toBe(evidence.verifiedAt); expect(actor.recentAal2At).toBe(now);
  });
  it.each([null, { ...evidence, assuranceLevel: "aal1" }, { ...evidence, assuranceLevel: "aal2", extra: true }])("rejects malformed live authority %#", async data => {
    await expect(revalidateGeneralImportActor(actor, "write", client(data))).rejects.toMatchObject({ code: "IMPORT_AUTH_INVALID_RECEIPT", httpStatus: 502 });
  });
  it.each([{ ...evidence, actorUserId: scope.branchId }, { ...evidence, branchId: scope.organizationId },
    { ...evidence, verifiedAt: null }, { ...evidence, verifiedAt: "2026-09-27T11:44:59Z" }, { ...evidence, verifiedAt: "2026-09-27T12:00:01Z" }])("rejects revoked scope or invalid recent proof %#", async proof => {
    await expect(revalidateGeneralImportActor(actor, "write", client({ ...proof, assuranceLevel: "aal2" }))).rejects.toMatchObject({ code: "IMPORT_PERMISSION_DENIED", httpStatus: 403 });
  });
  it("rejects a non-null read timestamp instead of silently weakening the contract", async () => {
    await expect(revalidateGeneralImportActor(actor, "read", client({ ...evidence, assuranceLevel: "aal2" }))).rejects.toMatchObject({ httpStatus: 403 });
  });
  it.each(["42501", "XX000"])("redacts provider %s errors", async code => {
    await expect(revalidateGeneralImportActor(actor, "write", client(null, { code, message: "SYNTHETIC_SECRET" })))
      .rejects.toMatchObject({ httpStatus: code === "42501" ? 403 : 503, message: expect.not.stringContaining("SYNTHETIC_SECRET") });
  });
  it("captures scope before asynchronous authorization", async () => {
    const changed = { ...actor }; let release!: (value: { data: unknown; error: null }) => void;
    const provider = { rpc: () => new Promise<{ data: unknown; error: null }>(resolve => { release = resolve; }) };
    const promise = revalidateGeneralImportActor(changed, "write", provider);
    changed.branchId = scope.organizationId;
    release({ data: { ...evidence, assuranceLevel: "aal2" }, error: null });
    expect((await promise).branchId).toBe(scope.branchId);
  });
  it("bounds a hanging provider and ignores its later response", async () => {
    let release!: (value: { data: unknown; error: null }) => void;
    const provider = { rpc: vi.fn(() => new Promise<{ data: unknown; error: null }>(resolve => { release = resolve; })) };
    const promise = revalidateGeneralImportActor(actor, "write", provider);
    const rejection = expect(promise).rejects.toMatchObject({ code: "IMPORT_AUTH_TIMEOUT", httpStatus: 503 });
    await vi.advanceTimersByTimeAsync(10_000); await rejection;
    release({ data: { ...evidence, assuranceLevel: "aal2" }, error: null });
    expect(provider.rpc).toHaveBeenCalledOnce(); expect(vi.getTimerCount()).toBe(0);
  });
  it("does not admit malformed actors or a missing current user client", async () => {
    const provider = client(null);
    await expect(revalidateGeneralImportActor({ ...actor, userId: "forged" }, "write", provider)).rejects.toMatchObject({ httpStatus: 403 });
    expect(provider.rpc).not.toHaveBeenCalled();
    await expect(revalidateGeneralImportActor(actor)).rejects.toMatchObject({ httpStatus: 503 });
  });
});
