import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
const mocks = vi.hoisted(() => ({ authorize: vi.fn(), user: vi.fn(), rpc: vi.fn(), worker: vi.fn(), repository: vi.fn(), demo: false, configured: true }));
vi.mock("@/lib/env", () => ({ isDemoMode: () => mocks.demo, hasSupabaseConfiguration: () => mocks.configured }));
vi.mock("@/lib/imports/http", async original => ({ ...await original<typeof import("@/lib/imports/http")>(), authorizeImportRequest: mocks.authorize }));
vi.mock("@/lib/supabase/server", () => ({ createServerSupabaseClient: mocks.user }));
vi.mock("@/lib/supabase/admin", () => ({ createSupabaseAdminClient: mocks.worker }));
vi.mock("@/lib/imports/production-repository", () => ({ createProductionImportRepository: mocks.repository }));
import { GET } from "./route";
import { ImportError } from "@/lib/imports/errors";
import { trustedUploadOperationId } from "@/lib/imports/trusted-staging";
const actor = { organizationId: "10000000-0000-4000-8000-000000000001", branchId: "20000000-0000-4000-8000-000000000001",
  userId: "30000000-0000-4000-8000-000000000001", assuranceLevel: "aal2" as const, recentAal2At: null };
const key = "legacy browser operation", reservation = "40000000-0000-4000-8000-000000000001";
const envelope = { schema_version: 1, original_operation_id: trustedUploadOperationId(actor, key), reservation_id: reservation,
  organization_id: actor.organizationId, branch_id: actor.branchId, actor_user_id: actor.userId, mode: "general", file_sha256: "a".repeat(64),
  file_name: "synthetic.html", mime_type: "text/html", file_size_bytes: 10, mapping_version: "central-care-plan-html@1",
  created_at: "2026-09-01T00:00:00Z", expires_at: "2026-09-01T00:15:00Z", status: "queued", receipt: null,
  staging_only: true, formally_imported: false };
const request = (suffix = "", operationKey = key) => new Request(`https://example.invalid/api/imports/operations${suffix}`,
  { headers: { "idempotency-key": operationKey } });
beforeEach(() => { vi.resetAllMocks(); mocks.demo = false; mocks.configured = true;
  mocks.authorize.mockResolvedValue(actor); mocks.user.mockResolvedValue({ rpc: mocks.rpc }); mocks.rpc.mockResolvedValue({ data: envelope, error: null }); });
describe("general original upload locator route with request user-client stub (not live authentication proof)", () => {
  it("requires current preview authority around RPC and returns only strict source observation", async () => {
    const req = request(); const response = await GET(req); expect(response.status).toBe(200);
    expect((await response.json()).data).toEqual({ found: true, operation: envelope });
    expect(mocks.authorize).toHaveBeenCalledTimes(3); expect(mocks.authorize).toHaveBeenCalledWith(req, "preview");
    expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith("import_upload_operation_receipt", {
      p_org: actor.organizationId, p_branch: actor.branchId, p_original_operation: envelope.original_operation_id, p_mode: "general" });
    expect(mocks.worker).not.toHaveBeenCalled(); expect(mocks.repository).not.toHaveBeenCalled();
    expect(response.headers.get("cache-control")).toContain("private, no-store");
  });
  it("null only means operation not found", async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: null }); const response = await GET(request());
    expect((await response.json()).data).toEqual({ found: false, operation: null });
  });
  it("completed source staging does not pretend repository preview is ready", async () => {
    const operation = { ...envelope, status: "completed", receipt: { reservation_id: reservation, status: "completed", staging_only: true,
      formally_imported: false, file_sha256: "a".repeat(64), content_fingerprint: "b".repeat(64), mapping_version: "central-care-plan-html@1",
      payload_sha256: "c".repeat(64), section_count: 1, field_count: 1, completed_at: "2026-09-02T00:00:00Z", replayed: false } };
    mocks.rpc.mockResolvedValue({ data: operation, error: null }); const body = await (await GET(request())).json();
    expect(body.data).toEqual({ found: true, operation }); expect(body.data).not.toHaveProperty("batch"); expect(mocks.repository).not.toHaveBeenCalled();
  });
  it.each(["demo", "unconfigured"])("%s does not authorize or create clients", async kind => {
    mocks.demo = kind === "demo"; mocks.configured = kind !== "unconfigured";
    expect((await GET(request())).status).toBe(kind === "demo" ? 403 : 503); expect(mocks.authorize).not.toHaveBeenCalled(); expect(mocks.user).not.toHaveBeenCalled();
  });
  it("unauthenticated authority is safe and does not access database", async () => {
    mocks.authorize.mockRejectedValue(new ImportError("UPSTREAM", "PRIVATE_TOKEN", 401)); const response = await GET(request());
    expect(response.status).toBe(401); expect(await response.text()).not.toContain("PRIVATE_TOKEN"); expect(mocks.user).not.toHaveBeenCalled();
  });
  it.each([["?key=raw", key], ["?mode=routine-intake", key], ["?", key], ["", ""], ["", "key, key"], ["", "x".repeat(201)]])("rejects query or invalid header %# before authority", async (suffix, value) => {
    expect((await GET(request(suffix, value))).status).toBe(400); expect(mocks.authorize).not.toHaveBeenCalled(); expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("rechecks revocation after read before disclosure", async () => {
    mocks.authorize.mockResolvedValueOnce(actor).mockResolvedValueOnce(actor).mockRejectedValueOnce(new ImportError("REVOKED", "PRIVATE_TOKEN", 403));
    const response = await GET(request()); expect(response.status).toBe(403); expect(await response.text()).not.toContain("PRIVATE_TOKEN");
  });
  it("bad scope envelope never discloses source data", async () => {
    mocks.rpc.mockResolvedValue({ data: { ...envelope, actor_user_id: reservation }, error: null });
    const response = await GET(request()); expect(response.status).toBe(502); expect((await response.json()).data).toBeNull();
  });
  it("provider exceptions remain secret-safe", async () => {
    mocks.rpc.mockRejectedValue(new Error("PRIVATE_TOKEN")); const response = await GET(request());
    expect(response.status).toBe(503); expect(await response.text()).not.toContain("PRIVATE_TOKEN");
  });
});
