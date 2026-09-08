import { beforeEach, describe, expect, it, vi } from "vitest";

const stubs = vi.hoisted(() => ({
  authorizeStaffRequest: vi.fn(), requireRecentAal2: vi.fn(),
  readJsonObject: vi.fn(), createServerSupabaseClient: vi.fn(), rpc: vi.fn(),
}));

vi.mock("@/lib/integrations/http", () => ({
  authorizeStaffRequest: stubs.authorizeStaffRequest,
  requireRecentAal2: stubs.requireRecentAal2,
  readJsonObject: stubs.readJsonObject,
  databaseFailure: (code: string, message: string, httpStatus = 500) => Object.assign(new Error(message), { code, httpStatus }),
  handleIntegrationRoute: async (operation: (requestId: string) => Promise<Response>) => {
    const requestId = "68000000-0000-4000-8000-000000000010";
    try { return await operation(requestId); } catch (error) {
      const value = error as { code?: unknown; message?: unknown; httpStatus?: unknown };
      return Response.json({ requestId, status: "error", data: null, errors: [{ code: typeof value.code === "string" ? value.code : "ERROR", message: typeof value.message === "string" ? value.message : "error" }] }, { status: typeof value.httpStatus === "number" ? value.httpStatus : 500, headers: { "Cache-Control": "private, no-store, max-age=0" } });
    }
  },
}));
vi.mock("@/lib/supabase/server", () => ({ createServerSupabaseClient: stubs.createServerSupabaseClient }));

import { POST } from "./route";

const org = "68000000-0000-4000-8000-000000000001";
const branch = "68000000-0000-4000-8000-000000000002";
const actorId = "68000000-0000-4000-8000-000000000003";
const key = "68000000-0000-4000-8000-000000000004";
const draftId = "68000000-0000-4000-8000-000000000005";
const announcementKey = "68000000-0000-4000-8000-000000000006";
const actor = {
  organizationId: org, organizationName: "機構", branchId: branch, branchName: "分支",
  userId: actorId, displayName: "主管", roles: ["branch_supervisor"],
  scopes: ["announcements.read", "announcements.manage", "announcements.publish"],
  assuranceLevel: "aal2", recentAal2At: new Date().toISOString(), demo: false,
};
function request(action: string) {
  return new Request("https://example.invalid/api/staff-announcements", {
    method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": key, "X-Announcement-Action": action }, body: "{}",
  });
}

describe("staff announcements API boundary", () => {
  beforeEach(() => {
    vi.clearAllMocks(); stubs.authorizeStaffRequest.mockResolvedValue(actor);
    stubs.requireRecentAal2.mockResolvedValue(undefined);
    stubs.createServerSupabaseClient.mockResolvedValue({ rpc: stubs.rpc });
    stubs.readJsonObject.mockResolvedValue({ draft_version_id: draftId });
    stubs.rpc.mockResolvedValue({ data: [{
      version_id: "68000000-0000-4000-8000-000000000007",
      announcement_key: announcementKey, version: 2, draft_version_id: draftId,
      lifecycle: "scheduled", publish_at: "2026-09-02T00:00:00.000Z",
      expires_at: null, recipient_count: 2, replayed: false,
    }], error: null });
  });

  it("rejects demo before parsing action or body and returns private no-store", async () => {
    stubs.authorizeStaffRequest.mockResolvedValue({ ...actor, demo: true });
    const response = await POST(request("publish"));
    expect(response.status).toBe(403);
    expect(response.headers.get("cache-control")).toBe("private, no-store, max-age=0");
    expect(stubs.readJsonObject).not.toHaveBeenCalled();
    expect(stubs.rpc).not.toHaveBeenCalled();
  });

  it("rejects missing publish permission before recent AAL2 and body parsing", async () => {
    stubs.authorizeStaffRequest.mockResolvedValue({ ...actor, scopes: ["announcements.read", "announcements.manage"] });
    const response = await POST(request("publish"));
    expect(response.status).toBe(403);
    expect(stubs.requireRecentAal2).not.toHaveBeenCalled();
    expect(stubs.readJsonObject).not.toHaveBeenCalled();
  });

  it("requires recent AAL2 for publish before body parsing", async () => {
    stubs.requireRecentAal2.mockRejectedValue(Object.assign(new Error("重新驗證"), { code: "AAL2_REQUIRED", httpStatus: 403 }));
    const response = await POST(request("publish"));
    expect(response.status).toBe(403);
    expect(stubs.readJsonObject).not.toHaveBeenCalled();
  });

  it("does not invent a recent-AAL2 requirement for draft creation", async () => {
    stubs.readJsonObject.mockResolvedValue({
      previous_version_id: null, title: "公告", body: "內容",
      publish_at: "2026-09-02T00:00:00.000Z", expires_at: null,
      audience_user_ids: [actorId], audience_role_ids: [], change_reason: null,
    });
    stubs.rpc.mockResolvedValue({ data: [{
      version_id: draftId, announcement_key: announcementKey, version: 1,
      previous_version_id: null, version_state: "draft",
      publish_at: "2026-09-02T00:00:00.000Z", expires_at: null, replayed: false,
    }], error: null });
    const response = await POST(request("draft"));
    expect(response.status).toBe(201);
    expect(stubs.requireRecentAal2).not.toHaveBeenCalled();
  });

  it("binds tenant scope from the actor and returns first false, replay true", async () => {
    const first = await POST(request("publish"));
    expect(first.status).toBe(201);
    expect((await first.json()).data.replayed).toBe(false);
    expect(stubs.rpc).toHaveBeenLastCalledWith("publish_staff_announcement", expect.objectContaining({ p_expected_organization_id: org, p_expected_branch_id: branch }));
    stubs.rpc.mockResolvedValueOnce({ data: [{
      version_id: "68000000-0000-4000-8000-000000000007",
      announcement_key: announcementKey, version: 2, draft_version_id: draftId,
      lifecycle: "scheduled", publish_at: "2026-09-02T00:00:00.000Z",
      expires_at: null, recipient_count: 2, replayed: true,
    }], error: null });
    const replay = await POST(request("publish"));
    expect(replay.status).toBe(200);
    expect((await replay.json()).data.replayed).toBe(true);
  });

  it("maps expiry that passed during release preparation to a 400", async () => {
    stubs.rpc.mockResolvedValue({ data: null, error: { code: "22023", message: "internal" } });
    const response = await POST(request("publish"));
    const value = await response.json();
    expect(response.status).toBe(400);
    expect(value.errors[0].code).toBe("INVALID_STAFF_ANNOUNCEMENT");
    expect(JSON.stringify(value)).not.toContain("internal");
  });

  it("fails closed when a successful database receipt adds a sensitive field", async () => {
    stubs.rpc.mockResolvedValue({ data: [{
      version_id: "68000000-0000-4000-8000-000000000007",
      announcement_key: announcementKey, version: 2, draft_version_id: draftId,
      lifecycle: "scheduled", publish_at: "2026-09-02T00:00:00.000Z",
      expires_at: null, recipient_count: 2, replayed: false, content_hash: "secret",
    }], error: null });
    const response = await POST(request("publish"));
    expect(response.status).toBe(409);
    expect(JSON.stringify(await response.json())).not.toContain("secret");
  });
});
