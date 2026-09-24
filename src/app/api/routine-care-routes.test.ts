import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TenantContext } from "@/lib/domain/types";

const stubs = vi.hoisted(() => ({ authorize: vi.fn(), rpc: vi.fn(), client: vi.fn(), single: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/integrations/http", () => ({
  authorizeStaffRequest: stubs.authorize,
  readJsonObject: (request: Request) => request.json(),
  databaseFailure: (code: string, message: string, httpStatus = 503) => Object.assign(new Error(message), { code, httpStatus }),
  handleIntegrationRoute: async (run: (id: string) => Promise<Response>) => {
    try { return await run("synthetic-request"); }
    catch (error) {
      const failure = error as { code: string; httpStatus: number };
      return Response.json({ error: failure.code }, { status: failure.httpStatus ?? 500 });
    }
  },
}));
vi.mock("@/lib/supabase/server", () => ({ createServerSupabaseClient: stubs.client }));

import { POST as attendance } from "./attendance/route";
import { POST as measurements } from "./measurements/route";
import { POST as records } from "./records/route";

const id = "c0100000-0000-4000-8000-000000000001";
const clientId = "c0100000-0000-4000-8000-000000000002";
const branchId = "c0100000-0000-4000-8000-000000000003";
const now = "2026-09-13T01:30:00.000Z";
const actor: TenantContext = {
  userId: id, organizationId: id, organizationName: "合成機構", branchId, branchName: "合成分支",
  displayName: "合成照服員", roles: ["care_worker"], assuranceLevel: "aal1", recentAal2At: null, demo: false,
  scopes: ["attendance.write", "health.write", "care_records.write"],
};
const diaryFields = { shift: "morning", care_item: "合成照顧項目", note: "合成觀察", abnormal: false };
const cases = [
  { name: "attendance", handler: attendance, permission: "attendance.write", rpc: "record_attendance_event",
    body: { client_id: clientId, event_kind: "check_in", occurred_at: now } },
  { name: "measurements", handler: measurements, permission: "health.write", rpc: "record_vital_set",
    body: { client_id: clientId, measured_at: now, values: { pulse: 75 } } },
  { name: "records", handler: records, permission: "care_records.write", rpc: "record_care_diary_quick_draft",
    body: { client_id: clientId, page_slug: "staff/daily-care/care-diary", occurred_at: now, data: diaryFields } },
] as const;

function request(path: string, body: unknown, headers: Record<string, string> = {}) {
  return new Request(`https://example.invalid/api/${path}`, { method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": id, ...headers }, body: JSON.stringify(body) });
}
function success(name: typeof cases[number]["name"]) {
  if (name === "measurements") {
    stubs.rpc.mockResolvedValue({ data: [{ id, measurement_kind: "pulse", replayed: false }], error: null });
  } else {
    stubs.rpc.mockReturnValue({ maybeSingle: stubs.single });
    stubs.single.mockResolvedValue({ error: null, data: name === "attendance" ? {
      operation_id: id, attendance_id: id, service_date: "2026-09-13", status: "present",
      checked_in_at: now, checked_out_at: null, source: "staff", replayed: false,
    } : { id, version: 1, status: "draft", replayed: false } });
  }
}

beforeEach(() => {
  vi.resetAllMocks(); vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date(now));
  stubs.authorize.mockResolvedValue(actor); stubs.client.mockResolvedValue({ rpc: stubs.rpc });
});
afterEach(() => vi.useRealTimers());

describe.each(cases)("$name routine-care POST boundary", (spec) => {
  it("opts in to exactly its own permission and allows authorized AAL1 input through the real parser to RPC", async () => {
    success(spec.name);
    const response = await spec.handler(request(spec.name, spec.body));
    expect(response.status).toBe(201);
    expect(stubs.authorize).toHaveBeenCalledExactlyOnceWith({ routinePermission: spec.permission });
    expect(stubs.rpc).toHaveBeenCalledExactlyOnceWith(spec.rpc, expect.objectContaining({
      p_expected_organization_id: actor.organizationId, p_expected_branch_id: actor.branchId, p_client_id: clientId,
    }));
    expect((await response.json()).data).toMatchObject({ persisted: true, demo: false, replayed: false });
    expect(actor.assuranceLevel).toBe("aal1");
  });
  it("does not treat AAL1 opt-in as permission to write without the page scope", async () => {
    stubs.authorize.mockResolvedValue({ ...actor, scopes: actor.scopes.filter((permission) => permission !== spec.permission) });
    const response = await spec.handler(request(spec.name, spec.body));
    expect(response.status).toBe(403);
    expect(stubs.authorize).toHaveBeenCalledExactlyOnceWith({ routinePermission: spec.permission });
    expect(stubs.client).not.toHaveBeenCalled(); expect(stubs.rpc).not.toHaveBeenCalled();
  });
  it("rejects a stale offline identity instead of sending the old draft to the current branch", async () => {
    const response = await spec.handler(request(spec.name, spec.body, { "x-care-organization": actor.organizationId, "x-care-branch": id, "x-care-user": actor.userId }));
    expect(response.status).toBe(409); expect(await response.json()).toEqual({ error: "OFFLINE_SCOPE_CHANGED" });
    expect(stubs.rpc).not.toHaveBeenCalled();
  });
  it("preserves a database-level authorization rejection even after the routine route opted in", async () => {
    const failure = { data: null, error: { code: "42501" } };
    if (spec.name === "measurements") stubs.rpc.mockResolvedValue(failure);
    else { stubs.rpc.mockReturnValue({ maybeSingle: stubs.single }); stubs.single.mockResolvedValue(failure); }
    const response = await spec.handler(request(spec.name, spec.body));
    expect(response.status).toBe(403); expect(stubs.rpc).toHaveBeenCalledOnce();
    expect((await response.json()).error).toMatch(/NOT_AUTHORIZED$/);
  });
});

describe("attendance backfill remains protected", () => {
  it("rejects a new AAL1 backfill through the database rules even when a reason is supplied", async () => {
    stubs.rpc.mockReturnValue({ maybeSingle: stubs.single }); stubs.single.mockResolvedValue({ data: null, error: { code: "42501" } });
    const response = await attendance(request("attendance", { client_id: clientId, event_kind: "check_in", occurred_at: "2026-09-13T01:14:59.000Z", reason: "合成補登理由" }));
    expect(response.status).toBe(403); expect(await response.json()).toEqual({ error: "ATTENDANCE_NOT_AUTHORIZED" });
    expect(stubs.authorize).toHaveBeenCalledExactlyOnceWith({ routinePermission: "attendance.write" });
    expect(stubs.rpc).toHaveBeenCalledExactlyOnceWith("record_attendance_event", expect.objectContaining({ p_occurred_at: "2026-09-13T01:14:59.000Z", p_reason: "合成補登理由" }));
  });
  it("lets the original AAL1 retry reach its committed receipt after the new-write time window expires", async () => {
    const row = { operation_id: id, attendance_id: id, service_date: "2026-09-13", status: "present", checked_in_at: now, checked_out_at: null, source: "staff" };
    stubs.rpc.mockReturnValue({ maybeSingle: stubs.single });
    stubs.single.mockResolvedValueOnce({ data: { ...row, replayed: false }, error: null })
      .mockResolvedValueOnce({ data: { ...row, replayed: true }, error: null });
    const body = { client_id: clientId, event_kind: "check_in", occurred_at: now };
    expect((await attendance(request("attendance", body))).status).toBe(201);
    vi.setSystemTime(new Date("2026-09-13T01:46:00.000Z"));
    const replay = await attendance(request("attendance", body));
    expect(replay.status).toBe(200); expect((await replay.json()).data).toMatchObject({ replayed: true, persisted: true, demo: false });
    expect(stubs.rpc).toHaveBeenCalledTimes(2);
    expect(stubs.rpc.mock.calls[1]).toEqual(stubs.rpc.mock.calls[0]);
    expect(stubs.authorize).toHaveBeenNthCalledWith(2, { routinePermission: "attendance.write" });
  });
  it("does not mistake an ordinary within-window AAL1 attendance event for backfill", async () => {
    success("attendance");
    const response = await attendance(request("attendance", { client_id: clientId, event_kind: "check_in", occurred_at: "2026-09-13T01:15:00.000Z" }));
    expect(response.status).toBe(201); expect(stubs.rpc).toHaveBeenCalledOnce();
    expect(stubs.rpc).toHaveBeenCalledWith("record_attendance_event", expect.objectContaining({ p_occurred_at: "2026-09-13T01:15:00.000Z", p_reason: null }));
  });
  it("lets AAL2 backfill reach its database review rules but does not override their refusal", async () => {
    stubs.authorize.mockResolvedValue({ ...actor, assuranceLevel: "aal2", recentAal2At: now });
    stubs.rpc.mockReturnValue({ maybeSingle: stubs.single }); stubs.single.mockResolvedValue({ data: null, error: { code: "42501" } });
    const response = await attendance(request("attendance", { client_id: clientId, event_kind: "check_in", occurred_at: "2026-09-13T01:00:00.000Z", reason: "合成補登理由" }));
    expect(response.status).toBe(403); expect(await response.json()).toEqual({ error: "ATTENDANCE_NOT_AUTHORIZED" });
    expect(stubs.rpc).toHaveBeenCalledExactlyOnceWith("record_attendance_event", expect.objectContaining({ p_reason: "合成補登理由" }));
  });
});
