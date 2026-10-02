import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
const mocks = vi.hoisted(() => ({ routine: vi.fn(), general: vi.fn(), user: vi.fn(), rpc: vi.fn(), worker: vi.fn(), demo: false, configured: true }));
vi.mock("@/lib/env", () => ({ isDemoMode: () => mocks.demo, hasSupabaseConfiguration: () => mocks.configured }));
vi.mock("@/lib/auth/routine-intake", () => ({ authorizeRoutineIntake: mocks.routine }));
vi.mock("@/lib/imports/http", async original => ({ ...await original<typeof import("@/lib/imports/http")>(), authorizeImportRequest: mocks.general }));
vi.mock("@/lib/supabase/server", () => ({ createServerSupabaseClient: mocks.user }));
vi.mock("@/lib/supabase/admin", () => ({ createSupabaseAdminClient: mocks.worker }));
import { GET } from "./route";
import { IntegrationError } from "@/lib/integrations/errors";
import { trustedUploadOperationId } from "@/lib/imports/trusted-staging";
const context = { organizationId: "10000000-0000-4000-8000-000000000001", branchId: "20000000-0000-4000-8000-000000000001",
  userId: "30000000-0000-4000-8000-000000000001", assuranceLevel: "aal1" as const, demo: false, scopes: ["imports.manage"] };
const key = "50000000-0000-4000-8000-000000000001";
const operation = { schema_version: 1, original_operation_id: trustedUploadOperationId({ ...context, recentAal2At: null }, key),
  reservation_id: "40000000-0000-4000-8000-000000000001", organization_id: context.organizationId, branch_id: context.branchId,
  actor_user_id: context.userId, mode: "routine-intake", file_sha256: "a".repeat(64), file_name: "synthetic.html", mime_type: "text/html",
  file_size_bytes: 10, mapping_version: "central-care-plan-html@1", created_at: "2026-09-01T00:00:00Z", expires_at: "2026-09-01T00:15:00Z",
  status: "queued", receipt: null, staging_only: true, formally_imported: false };
const request = (suffix = "", operationKey = key) => new Request(`https://example.invalid/api/client-intake/imports/operations${suffix}`,
  { headers: { "idempotency-key": operationKey } });
beforeEach(() => { vi.resetAllMocks(); mocks.demo = false; mocks.configured = true; mocks.routine.mockResolvedValue(context);
  mocks.user.mockResolvedValue({ rpc: mocks.rpc }); mocks.rpc.mockResolvedValue({ data: operation, error: null }); });
describe("routine intake locator route with request user-client stub (not live authentication proof)", () => {
  it("uses current cms.preview action at actual AAL1 without general authenticator authority", async () => {
    const response = await GET(request()); expect(response.status).toBe(200); expect((await response.json()).data).toEqual({ found: true, operation });
    expect(mocks.routine).toHaveBeenCalledTimes(3); expect(mocks.routine).toHaveBeenCalledWith("cms.preview");
    expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith("import_upload_operation_receipt", {
      p_org: context.organizationId, p_branch: context.branchId, p_original_operation: operation.original_operation_id, p_mode: "routine-intake" });
    expect(mocks.general).not.toHaveBeenCalled(); expect(mocks.worker).not.toHaveBeenCalled(); expect(response.headers.get("cache-control")).toContain("private, no-store");
  });
  it("missing operation remains an observational null", async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: null }); expect((await (await GET(request())).json()).data).toEqual({ found: false, operation: null });
  });
  it.each(["demo", "unconfigured"])("%s does not authorize or read", async kind => {
    mocks.demo = kind === "demo"; mocks.configured = kind !== "unconfigured";
    expect((await GET(request())).status).toBe(kind === "demo" ? 403 : 503); expect(mocks.routine).not.toHaveBeenCalled(); expect(mocks.user).not.toHaveBeenCalled();
  });
  it.each(["demo", "scope", "branch"])("refuses current context %s", async kind => {
    mocks.routine.mockResolvedValue({ ...context, ...(kind === "demo" ? { demo: true } : kind === "branch" ? { branchId: null } : { scopes: [] }) });
    expect((await GET(request())).status).toBe(403); expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("unauthenticated routine account does not reach source data", async () => {
    mocks.routine.mockRejectedValue(new IntegrationError("AUTH_REQUIRED", "PRIVATE_TOKEN", 401)); const response = await GET(request());
    expect(response.status).toBe(401); expect(await response.text()).not.toContain("PRIVATE_TOKEN"); expect(mocks.user).not.toHaveBeenCalled();
  });
  it.each([["?key=raw", key], ["?actor=other", key], ["?", key], ["", ""], ["", "key, key"]])("rejects query or invalid header %# before authorization", async (suffix, value) => {
    expect((await GET(request(suffix, value))).status).toBe(400); expect(mocks.routine).not.toHaveBeenCalled(); expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("current approved action revocation after RPC refuses disclosure", async () => {
    mocks.routine.mockResolvedValueOnce(context).mockResolvedValueOnce(context).mockRejectedValueOnce(new IntegrationError("INTAKE_NOT_AUTHORIZED", "PRIVATE_TOKEN", 403));
    const response = await GET(request()); expect(response.status).toBe(403); expect(await response.text()).not.toContain("PRIVATE_TOKEN");
  });
  it("general mode source cannot cross the routine endpoint", async () => {
    mocks.rpc.mockResolvedValue({ data: { ...operation, mode: "general" }, error: null }); expect((await GET(request())).status).toBe(502);
  });
});
