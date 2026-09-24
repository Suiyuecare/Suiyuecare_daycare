import { beforeEach, describe, expect, it, vi } from "vitest";
import { emptyPlan, previewWeeklyPlan } from "./schema";
const mocks = vi.hoisted(() => ({ actor: vi.fn(), authorize: vi.fn(), recent: vi.fn(), client: vi.fn(), rpc: vi.fn(), single: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth/context", () => ({ getTenantContext: mocks.actor, hasRecentAal2: vi.fn() }));
vi.mock("@/lib/auth/routine-intake", () => ({ authorizeRoutineIntake: mocks.authorize }));
vi.mock("@/lib/integrations/http", async () => {
  const actual = await vi.importActual<typeof import("@/lib/integrations/http")>("@/lib/integrations/http");
  return { ...actual, authorizeStaffRequest: mocks.authorize, requireRecentAal2: mocks.recent };
});
vi.mock("@/lib/supabase/server", () => ({ createServerSupabaseClient: mocks.client }));
import { GET, POST } from "@/app/api/client-weekly/route";
const clientId = "c1600000-0000-4000-8000-000000000001";
const today = "2026-09-14";
const actor = { organizationId: "a1600000-0000-4000-8000-000000000001", branchId: "b1600000-0000-4000-8000-000000000001", scopes: ["clients.read", "staff_scheduling.manage"], demo: false };
const plan = { ...emptyPlan(today), reason: "已確認合成安排" };
const input = { action: "save_plan", clientId, plan, expectedVersion: 0, idempotency_key: "c1800000-0000-4000-8000-000000000001" };
const read = () => new Request(`https://example.invalid/api/client-weekly?client=${clientId}&from=${today}`);
const post = (body: unknown = input) => new Request("https://example.invalid/api/client-weekly", { method: "POST", headers: { "content-type": "application/json", "x-client-weekly-action": "save" }, body: JSON.stringify(body) });
beforeEach(() => { vi.resetAllMocks(); mocks.actor.mockResolvedValue(actor); mocks.authorize.mockResolvedValue(actor); mocks.recent.mockResolvedValue(undefined); mocks.client.mockResolvedValue({ rpc: mocks.rpc }); mocks.rpc.mockReturnValue({ maybeSingle: mocks.single }); });
describe("weekly route authorization and truthful receipts", () => {
  it("refuses anonymous read and has private no-store errors", async () => {
    mocks.actor.mockResolvedValue(null);
    const response = await GET(read()); expect(response.status).toBe(401); expect(response.headers.get("cache-control")).toContain("no-store"); expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("uses server organization and branch and validates bounded snapshot", async () => {
    mocks.single.mockResolvedValue({ error: null, data: { payload: { clientId, from: today, generatedAt: `${today}T00:00:00Z`, version: 0, plan: null, exceptions: [], days: previewWeeklyPlan(plan, today) } } });
    const response = await GET(read()); expect(response.status).toBe(200);
    expect(mocks.rpc).toHaveBeenCalledWith("client_weekly_snapshot", { p_organization_id: actor.organizationId, p_branch_id: actor.branchId, p_client_id: clientId, p_from: today });
  });
  it("rejects incomplete persisted snapshots", async () => {
    mocks.single.mockResolvedValue({ error: null, data: { payload: {} } }); expect((await GET(read())).status).toBe(502);
  });
  it("blocks demo and missing management scopes without writing", async () => {
    mocks.authorize.mockResolvedValue({ ...actor, demo: true }); expect((await POST(post())).status).toBe(403);
    mocks.authorize.mockResolvedValue({ ...actor, scopes: ["clients.read"] }); expect((await POST(post())).status).toBe(403);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("validates server-side data before RPC and rejects unknown tenant injection", async () => {
    expect((await POST(post({ ...input, organizationId: "other" }))).status).toBe(400); expect(mocks.rpc).not.toHaveBeenCalled(); expect(mocks.authorize).not.toHaveBeenCalled();
  });
  it("returns a validated persistent receipt and safe replay", async () => {
    const receipt = { id: "c1900000-0000-4000-8000-000000000001", clientId, action: "save_plan", version: 1, replayed: false, persisted: true };
    mocks.single.mockResolvedValue({ error: null, data: { receipt } }); const response = await POST(post()); expect(response.status).toBe(201); expect((await response.json()).data.receipt.persisted).toBe(true);
    expect(mocks.authorize).toHaveBeenCalledWith("weekly.write", clientId); expect(mocks.recent).not.toHaveBeenCalled();
    mocks.single.mockResolvedValue({ error: null, data: { receipt: { ...receipt, replayed: true } } }); expect((await POST(post())).status).toBe(200);
  });
  it("never claims saved when scope, version, or receipt checks fail", async () => {
    mocks.single.mockResolvedValue({ error: { code: "42501", message: "private details" }, data: null }); const denied = await POST(post()); expect(denied.status).toBe(403); expect(await denied.text()).not.toContain("private details");
    mocks.single.mockResolvedValue({ error: { code: "40001" }, data: null }); expect((await POST(post())).status).toBe(409);
    mocks.single.mockResolvedValue({ error: null, data: { receipt: { id: "c1900000-0000-4000-8000-000000000001", clientId, action: "save_plan", version: 5, replayed: false, persisted: true } } }); expect((await POST(post())).status).toBe(503);
  });
  it.each(["08006", "57014", "55P03", "unknown", ""])("does not classify %s as a confirmed noncommit conflict", async (code) => {
    mocks.single.mockResolvedValue({ data: null, error: { code, message: "PRIVATE_DATABASE_DETAIL" } });
    const response = await POST(post());
    expect(response.status).toBe(503);
    const result = await response.json();
    expect(result.errors[0].code).toBe("WEEKLY_RESULT_UNCERTAIN");
    expect(JSON.stringify(result)).not.toContain("PRIVATE_DATABASE_DETAIL");
    expect(response.headers.get("cache-control")).toContain("no-store");
  });
  it.each(["40001", "23505"])("only sends %s to explicit conflict review", async (code) => {
    mocks.single.mockResolvedValue({ data: null, error: { code } });
    const response = await POST(post()); expect(response.status).toBe(409);
    expect((await response.json()).errors[0].code).toBe("WEEKLY_CONFLICT");
  });
  it.each(["22023", "23514", "22007", "22008"])("keeps %s validation rejections distinct from unknown writes", async (code) => {
    mocks.single.mockResolvedValue({ data: null, error: { code } });
    const response = await POST(post()); expect(response.status).toBe(400);
    expect((await response.json()).errors[0].code).toBe("INVALID_WEEKLY_INPUT");
  });
  it("returns 503 for thrown transport errors and incomplete receipts without exposing details", async () => {
    mocks.single.mockRejectedValueOnce(new Error("PRIVATE_TRANSPORT_DETAIL"));
    const response = await POST(post()); expect(response.status).toBe(503);
    expect(await response.text()).not.toContain("PRIVATE_TRANSPORT_DETAIL");
    mocks.single.mockResolvedValue({ data: null, error: null });
    const malformed = await POST(post()); expect(malformed.status).toBe(503);
    expect((await malformed.json()).errors[0].code).toBe("WEEKLY_RESULT_UNCERTAIN");
  });
  it("also preserves uncertainty if preparing the RPC throws synchronously", async () => {
    mocks.rpc.mockImplementationOnce(() => { throw new Error("PRIVATE_CONNECTION_DETAIL"); });
    const response = await POST(post()); expect(response.status).toBe(503);
    const result = await response.json(); expect(result.errors[0].code).toBe("WEEKLY_RESULT_UNCERTAIN");
    expect(JSON.stringify(result)).not.toContain("PRIVATE_CONNECTION_DETAIL");
  });
});
