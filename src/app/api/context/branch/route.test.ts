import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ context: vi.fn(), client: vi.fn(), demo: vi.fn(), from: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth/context", () => ({ getTenantContext: mocks.context }));
vi.mock("@/lib/supabase/server", () => ({ createServerSupabaseClient: mocks.client }));
vi.mock("@/lib/env", () => ({ isDemoMode: mocks.demo }));

import { SERVER_WORKSPACE_READ_TIMEOUT_MS } from "@/lib/api/server-read-deadline";
import { IntegrationError } from "@/lib/integrations/errors";
import { DELETE, GET, POST } from "./route";

const ORG = "59100000-0000-4000-8000-000000000001";
const BRANCH = "59100000-0000-4000-8000-000000000002";
const OTHER = "59100000-0000-4000-8000-000000000003";
const branches = [{ id: BRANCH, name: "合成甲分支" }, { id: OTHER, name: "合成乙分支" }];
const actor = { organizationId: ORG, branchId: BRANCH, userId: "59100000-0000-4000-8000-000000000004",
  organizationName: "合成機構", branchName: branches[0].name, displayName: "合成主管", roles: ["branch_supervisor"],
  scopes: ["clients.read"], assuranceLevel: "aal2", recentAal2At: null, demo: false };
function builder() {
  return { select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), order: vi.fn().mockReturnThis(),
    abortSignal: vi.fn().mockReturnThis(), returns: vi.fn().mockResolvedValue({ data: branches, error: null }) };
}
let query: ReturnType<typeof builder>;
const db = { from: mocks.from };
function switchRequest(branchId: unknown = OTHER) {
  return new Request("https://synthetic.invalid/api/context/branch", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ branchId }),
  });
}
function invoke(method: "GET" | "POST") { return method === "GET" ? GET() : POST(switchRequest()); }
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((settle) => { resolve = settle; });
  return { promise, resolve };
}
async function expectFailure(response: Response, status: number, code: string) {
  expect(response.status).toBe(status);
  expect(response.headers.get("cache-control")).toBe("private, no-store, max-age=0");
  expect(response.headers.get("x-content-type-options")).toBe("nosniff");
  expect(response.headers.get("set-cookie")).toBeNull();
  const body = await response.json();
  expect(body).toMatchObject({ status: "error", data: null, errors: [{ code }] });
  expect(body.requestId).toMatch(/^[0-9a-f-]{36}$/u);
  expect(JSON.stringify(body)).not.toContain("private authority details");
  expect(body.errors[0]).not.toHaveProperty("stack");
}
beforeEach(() => {
  vi.resetAllMocks(); vi.useFakeTimers();
  mocks.context.mockResolvedValue(actor); mocks.demo.mockReturnValue(false);
  query = builder(); mocks.from.mockReturnValue(query); mocks.client.mockResolvedValue(db);
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); });

describe("branch route availability, ownership and cookie contract", () => {
  it("keeps exact organization and active-branch filters and one shared read signal", async () => {
    const response = await GET();
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ status: "ok", data: { branches, currentBranchId: BRANCH }, errors: [] });
    expect(mocks.context).toHaveBeenCalledExactlyOnceWith("staff");
    expect(mocks.from).toHaveBeenCalledExactlyOnceWith("branches");
    expect(query.select).toHaveBeenCalledExactlyOnceWith("id, name");
    expect(query.eq.mock.calls).toEqual([["organization_id", ORG], ["is_active", true]]);
    expect(query.order).toHaveBeenCalledExactlyOnceWith("code");
    const signal = mocks.client.mock.calls[0][0].signal as AbortSignal;
    expect(query.abortSignal).toHaveBeenCalledExactlyOnceWith(signal);
    expect(query.order.mock.invocationCallOrder[0]).toBeLessThan(query.abortSignal.mock.invocationCallOrder[0]);
    expect(query.abortSignal.mock.invocationCallOrder[0]).toBeLessThan(query.returns.mock.invocationCallOrder[0]);
    expect(signal.aborted).toBe(true);
    expect(response.headers.get("set-cookie")).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each([false, true])("keeps successful live switching cookie options unchanged (production=%s)", async (production) => {
    vi.stubEnv("NODE_ENV", production ? "production" : "test");
    const response = await POST(switchRequest());
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ data: { branch: branches[1], demo: false }, errors: [] });
    expect(response.cookies.getAll()).toHaveLength(1);
    expect(response.cookies.get("daycare_branch")).toMatchObject({ name: "daycare_branch", value: OTHER,
      httpOnly: true, sameSite: "strict", secure: production, path: "/", maxAge: 8 * 60 * 60 });
  });

  it.each(["GET", "POST"] as const)("maps only known authentication unavailability to a safe503 envelope for %s", async (method) => {
    mocks.context.mockRejectedValue(new IntegrationError("AUTH_CONTEXT_UNAVAILABLE", "private authority details", 503));
    await expectFailure(await invoke(method), 503, "AUTH_CONTEXT_UNAVAILABLE");
    expect(mocks.client).not.toHaveBeenCalled(); expect(mocks.from).not.toHaveBeenCalled();
  });

  it.each([
    new Error("private authority details"),
    new IntegrationError("DIFFERENT_FAILURE", "private authority details", 503),
    new IntegrationError("AUTH_CONTEXT_UNAVAILABLE", "private authority details", 403),
    Object.assign(new Error("private authority details"), { code: "AUTH_CONTEXT_UNAVAILABLE", httpStatus: 503 }),
  ])("does not relabel other authority failures", async (error) => {
    mocks.context.mockRejectedValue(error);
    await expect(GET()).rejects.toBe(error);
    await expect(POST(switchRequest())).rejects.toBe(error);
    expect(mocks.client).not.toHaveBeenCalled();
  });

  it.each(["GET", "POST"] as const)("preserves missing-session401 and AAL1 403 for %s before any branch read", async (method) => {
    mocks.context.mockResolvedValue(null);
    await expectFailure(await invoke(method), 401, "AUTH_REQUIRED");
    mocks.context.mockResolvedValue({ ...actor, assuranceLevel: "aal1" });
    await expectFailure(await invoke(method), 403, "AAL2_REQUIRED");
    expect(mocks.client).not.toHaveBeenCalled(); expect(mocks.from).not.toHaveBeenCalled();
  });

  it.each(["GET", "POST"] as const)("reports absent backend503 without branch substitution for %s", async (method) => {
    mocks.client.mockResolvedValue(null);
    await expectFailure(await invoke(method), 503, "SERVICE_NOT_CONFIGURED");
    expect(mocks.from).not.toHaveBeenCalled(); expect(vi.getTimerCount()).toBe(0);
  });

  it.each(["GET", "POST"] as const)("reports failed/missing branch list503 rather than branch denial for %s", async (method) => {
    query.returns.mockResolvedValue({ data: branches, error: { message: "private authority details" } });
    await expectFailure(await invoke(method), 503, "BRANCH_LOOKUP_FAILED");
    query.returns.mockResolvedValue({ data: null, error: null });
    await expectFailure(await invoke(method), 503, "BRANCH_LOOKUP_FAILED");
  });

  it.each(["GET", "POST"] as const)("safely reports thrown lookup errors for %s", async (method) => {
    query.returns.mockRejectedValue(new Error("private authority details"));
    await expectFailure(await invoke(method), 503, "BRANCH_LOOKUP_FAILED");
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each([{ data: [] }, { data: [branches[0]] }])("preserves genuine branch denial from a successfully read list", async ({ data }) => {
    query.returns.mockResolvedValue({ data, error: null });
    await expectFailure(await POST(switchRequest()), 403, "BRANCH_NOT_ACCESSIBLE");
  });

  it.each(["GET", "POST"] as const)("bounds a stalled factory and prevents late branch reads for %s", async (method) => {
    const late = deferred<typeof db>(); mocks.client.mockReturnValue(late.promise);
    const result = invoke(method); await vi.advanceTimersByTimeAsync(0);
    const signal = mocks.client.mock.calls[0][0].signal as AbortSignal;
    await vi.advanceTimersByTimeAsync(SERVER_WORKSPACE_READ_TIMEOUT_MS - 1);
    expect(signal.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await expectFailure(await result, 503, "BRANCH_LOOKUP_FAILED");
    expect(signal.aborted).toBe(true);
    late.resolve(db); await vi.advanceTimersByTimeAsync(0);
    expect(mocks.from).not.toHaveBeenCalled(); expect(vi.getTimerCount()).toBe(0);
  });

  it.each(["GET", "POST"] as const)("discards a late branch list and never issues a switch cookie for %s", async (method) => {
    const late = deferred<unknown>(); query.returns.mockReturnValue(late.promise);
    const result = invoke(method); await vi.advanceTimersByTimeAsync(0);
    const signal = query.abortSignal.mock.calls[0][0] as AbortSignal;
    await vi.advanceTimersByTimeAsync(SERVER_WORKSPACE_READ_TIMEOUT_MS);
    const response = await result;
    await expectFailure(response, 503, "BRANCH_LOOKUP_FAILED");
    expect(signal.aborted).toBe(true);
    late.resolve({ data: branches, error: null }); await vi.advanceTimersByTimeAsync(0);
    expect(response.headers.get("set-cookie")).toBeNull();
    expect(mocks.from).toHaveBeenCalledTimes(1); expect(vi.getTimerCount()).toBe(0);
  });

  it("keeps marked demo branches and performs no live lookup or switching cookie", async () => {
    mocks.demo.mockReturnValue(true);
    const list = await GET(); const body = await list.json();
    expect(list.status).toBe(200); expect(body.data.branches).toHaveLength(2);
    const response = await POST(switchRequest(body.data.branches[1].id));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ data: { branch: body.data.branches[1], demo: true } });
    expect(response.headers.get("set-cookie")).toBeNull(); expect(mocks.client).not.toHaveBeenCalled();
  });

  it.each(["bad", null, 123])("keeps invalid switch identifiers rejected before authority reads (%s)", async (branchId) => {
    await expectFailure(await POST(switchRequest(branchId)), 400, "INVALID_BRANCH_ID");
    expect(mocks.context).not.toHaveBeenCalled();
  });

  it("keeps malformed switch body rejected before authority reads", async () => {
    const request = new Request("https://synthetic.invalid/api/context/branch", { method: "POST", body: "{" });
    await expectFailure(await POST(request), 400, "INVALID_REQUEST");
    expect(mocks.context).not.toHaveBeenCalled();
  });

  it("does not alter DELETE clearing behavior or add authorization reads", async () => {
    const response = await DELETE();
    expect(response.status).toBe(200); expect(await response.json()).toMatchObject({ data: { cleared: true } });
    expect(response.cookies.getAll()).toHaveLength(2);
    for (const name of ["daycare_branch", "daycare_organization"]) {
      expect(response.cookies.get(name)).toMatchObject({ name, value: "", httpOnly: true, sameSite: "strict", path: "/", maxAge: 0 });
    }
    expect(mocks.context).not.toHaveBeenCalled(); expect(mocks.client).not.toHaveBeenCalled();
  });
});
