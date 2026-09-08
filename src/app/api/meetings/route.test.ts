import { beforeEach, describe, expect, it, vi } from "vitest";

import { deterministicUuid } from "@/lib/integrations/security";

const stubs = vi.hoisted(() => ({
  authorizeStaffRequest: vi.fn(), requireRecentAal2: vi.fn(),
  readJsonObject: vi.fn(), createServerSupabaseClient: vi.fn(),
  rpc: vi.fn(), maybeSingle: vi.fn(),
}));

vi.mock("@/lib/integrations/http", () => ({
  authorizeStaffRequest: stubs.authorizeStaffRequest,
  requireRecentAal2: stubs.requireRecentAal2,
  readJsonObject: stubs.readJsonObject,
  databaseFailure: (code: string, message: string, httpStatus = 500) =>
    Object.assign(new Error(message), { code, httpStatus }),
  handleIntegrationRoute: async (operation: (requestId: string) => Promise<Response>) => {
    const requestId = "75000000-0000-4000-8000-000000000099";
    try { return await operation(requestId); } catch (error) {
      const value = error as { code?: unknown; message?: unknown; httpStatus?: unknown };
      return Response.json({ requestId, status: "error", data: null, errors: [{
        code: typeof value.code === "string" ? value.code : "ERROR",
        message: typeof value.message === "string" ? value.message : "error",
      }] }, { status: typeof value.httpStatus === "number" ? value.httpStatus : 500,
        headers: { "Cache-Control": "private, no-store, max-age=0" } });
    }
  },
}));
vi.mock("@/lib/supabase/server", () => ({
  createServerSupabaseClient: stubs.createServerSupabaseClient,
}));

import { POST as updateAction } from "./actions/route";
import { POST as saveMinute } from "./minutes/route";

const ORG = "75000000-0000-4000-8000-000000000001";
const BRANCH = "75000000-0000-4000-8000-000000000002";
const ACTOR = "75000000-0000-4000-8000-000000000003";
const MEETING = "75000000-0000-4000-8000-000000000004";
const MINUTE = "75000000-0000-4000-8000-000000000005";
const ACTION = "75000000-0000-4000-8000-000000000006";
const UPDATE = "75000000-0000-4000-8000-000000000007";
const KEY = "75000000-0000-4000-8000-000000000008";
const actor = {
  organizationId: ORG, organizationName: "機構", branchId: BRANCH,
  branchName: "分支", userId: ACTOR, displayName: "主管",
  roles: ["branch_supervisor"],
  scopes: ["meetings.read", "meetings.manage", "meetings.sign"],
  assuranceLevel: "aal2", recentAal2At: new Date().toISOString(), demo: false,
};
const minuteBody = {
  meeting_key: null, previous_version_id: null, correction_reason: null,
  meeting_type: "機構自訂會議", title: "測試會議",
  starts_at: "2026-09-01T08:00:00+08:00",
  ends_at: "2026-09-01T09:00:00+08:00",
  staff_attendee_user_ids: [ACTOR], external_attendee_names: [],
  agenda_items: [{ item_id: UPDATE, item_order: 1, topic: "議程" }],
  decisions: [], action_items: [],
};
const actionBody = {
  meeting_key: MEETING, minute_version_id: MINUTE, action_id: ACTION,
  expected_previous_update_id: UPDATE, progress_status: "completed",
  progress_note: "完成",
};
function request(path: string) {
  return new Request(`https://example.invalid${path}`, { method: "POST",
    headers: { "Content-Type": "application/json", "Idempotency-Key": KEY },
    body: "{}" });
}

describe("page-75 meeting API boundaries", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    stubs.authorizeStaffRequest.mockResolvedValue(actor);
    stubs.requireRecentAal2.mockResolvedValue(undefined);
    stubs.createServerSupabaseClient.mockResolvedValue({ rpc: stubs.rpc });
    stubs.rpc.mockReturnValue({ maybeSingle: stubs.maybeSingle });
  });

  it("rejects missing sign authority before AAL2 and body parsing", async () => {
    stubs.authorizeStaffRequest.mockResolvedValue({ ...actor,
      scopes: ["meetings.read", "meetings.manage"] });
    const response = await saveMinute(request("/api/meetings/minutes"));
    expect(response.status).toBe(403);
    expect(stubs.requireRecentAal2).not.toHaveBeenCalled();
    expect(stubs.readJsonObject).not.toHaveBeenCalled();
  });

  it("requires recent AAL2 before reading a minute body", async () => {
    stubs.requireRecentAal2.mockRejectedValue(Object.assign(new Error("重新驗證"), {
      code: "AAL2_REQUIRED", httpStatus: 403,
    }));
    const response = await saveMinute(request("/api/meetings/minutes"));
    expect(response.status).toBe(403);
    expect(stubs.readJsonObject).not.toHaveBeenCalled();
  });

  it("binds actor scope/idempotency and returns strict new/replay receipts", async () => {
    stubs.readJsonObject.mockResolvedValue(minuteBody);
    const receipt = { minute_version_id: MINUTE, meeting_key: MEETING,
      minute_version: 1, previous_version_id: null,
      signed_at: "2026-09-01T09:05:00+08:00", replayed: false };
    stubs.maybeSingle.mockResolvedValue({ data: receipt, error: null });
    let response = await saveMinute(request("/api/meetings/minutes"));
    expect(response.status).toBe(201);
    expect((await response.json()).data.receipt).toMatchObject({
      meetingKey: MEETING, previousVersionId: null, persisted: true, demo: false,
    });
    expect(stubs.rpc).toHaveBeenCalledWith("record_signed_meeting_minutes",
      expect.objectContaining({
        p_expected_organization_id: ORG, p_expected_branch_id: BRANCH,
        p_idempotency_key: deterministicUuid(
          "page75-meeting-minute", ORG, ACTOR, KEY,
        ),
      }));
    stubs.maybeSingle.mockResolvedValue({ data: { ...receipt, replayed: true }, error: null });
    response = await saveMinute(request("/api/meetings/minutes"));
    expect(response.status).toBe(200);
  });

  it("fails closed on malformed/cross-version minute receipts and sanitizes DB detail", async () => {
    stubs.readJsonObject.mockResolvedValue({ ...minuteBody, meeting_key: MEETING,
      previous_version_id: MINUTE, correction_reason: "補充" });
    stubs.maybeSingle.mockResolvedValue({ data: {
      minute_version_id: UPDATE, meeting_key: MEETING, minute_version: 2,
      previous_version_id: null, signed_at: "2026-09-01T09:05:00+08:00",
      replayed: false, secret: "do-not-leak",
    }, error: null });
    let response = await saveMinute(request("/api/meetings/minutes"));
    expect(response.status).toBe(409);
    expect(JSON.stringify(await response.json())).not.toContain("do-not-leak");
    stubs.maybeSingle.mockResolvedValue({ data: null,
      error: { code: "42501", message: "private tenant row" } });
    response = await saveMinute(request("/api/meetings/minutes"));
    expect(response.status).toBe(403);
    expect(JSON.stringify(await response.json())).not.toContain("private tenant row");
  });

  it("rejects demo action updates before body parsing", async () => {
    stubs.authorizeStaffRequest.mockResolvedValue({ ...actor, demo: true });
    const response = await updateAction(request("/api/meetings/actions"));
    expect(response.status).toBe(403);
    expect(stubs.readJsonObject).not.toHaveBeenCalled();
  });

  it("binds an action update to meeting, minute, base update and actor key", async () => {
    stubs.readJsonObject.mockResolvedValue(actionBody);
    stubs.maybeSingle.mockResolvedValue({ data: {
      action_update_id: ORG, meeting_key: MEETING, minute_version_id: MINUTE,
      action_id: ACTION, previous_update_id: UPDATE, update_sequence: 2,
      progress_status: "completed", recorded_at: "2026-09-01T10:00:00+08:00",
      replayed: false,
    }, error: null });
    const response = await updateAction(request("/api/meetings/actions"));
    expect(response.status).toBe(201);
    expect((await response.json()).data.receipt).toMatchObject({
      meetingKey: MEETING, minuteVersionId: MINUTE, previousUpdateId: UPDATE,
    });
    expect(stubs.rpc).toHaveBeenCalledWith("append_meeting_action_update",
      expect.objectContaining({
        p_meeting_key: MEETING, p_minute_version_id: MINUTE,
        p_expected_previous_update_id: UPDATE,
        p_idempotency_key: deterministicUuid(
          "page75-meeting-action", ORG, ACTOR, KEY,
        ),
      }));
  });

  it.each([
    null,
    { action_update_id: ORG, meeting_key: BRANCH, minute_version_id: MINUTE,
      action_id: ACTION, previous_update_id: UPDATE, update_sequence: 2,
      progress_status: "completed", recorded_at: "2026-09-01T10:00:00+08:00",
      replayed: false },
    { action_update_id: ORG, meeting_key: MEETING, minute_version_id: MINUTE,
      action_id: ACTION, previous_update_id: null, update_sequence: 2,
      progress_status: "completed", recorded_at: "2026-09-01T10:00:00+08:00",
      replayed: false },
  ])("fails closed on a malicious action receipt %#", async (data) => {
    stubs.readJsonObject.mockResolvedValue(actionBody);
    stubs.maybeSingle.mockResolvedValue({ data, error: null });
    const response = await updateAction(request("/api/meetings/actions"));
    expect(response.status).toBe(409);
  });
});
