import { beforeEach, describe, expect, it, vi } from "vitest";
import { reviewHistory, reviewIds as ids, reviewInput, reviewReceipt } from "@/lib/form-governance/publication-review.test-fixtures";
import { IntegrationError } from "@/lib/integrations/errors";
const mocks = vi.hoisted(() => ({ authorize: vi.fn(), reauth: vi.fn(), db: vi.fn(), rpc: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/integrations/http", async original => ({ ...await original<typeof import("@/lib/integrations/http")>(), authorizeStaffRequest: mocks.authorize }));
vi.mock("@/lib/form-governance/lifecycle-auth", () => ({ requireCustomFormAal2: mocks.reauth }));
vi.mock("@/lib/supabase/server", () => ({ createServerSupabaseClient: mocks.db }));
import { GET, POST } from "./route";
const actor = { organizationId: ids.other, branchId: ids.branch, userId: ids.actor, scopes: ["forms.manage"], demo: false };
const url = "https://example.invalid/api/forms/publications/review";
function post(body: unknown = reviewInput()) { return new Request(url, { method: "POST", headers: { "Idempotency-Key": ids.other }, body: JSON.stringify(body) }); }
describe("publication review API", () => {
  beforeEach(() => { vi.clearAllMocks(); mocks.authorize.mockResolvedValue(actor); mocks.reauth.mockResolvedValue(undefined);
    mocks.db.mockResolvedValue({ rpc: (...args: unknown[]) => ({ abortSignal: () => mocks.rpc(...args) }) }); mocks.rpc.mockResolvedValue({ data: reviewReceipt(), error: null }); });
  it("uses authenticated tenant and binds mutation receipt", async () => {
    const response = await POST(post()); expect(response.status).toBe(201);
    expect(mocks.rpc).toHaveBeenCalledWith("write_custom_form_publication_v2", { p_org: ids.other, p_branch: ids.branch, p_key: ids.other, p_input: reviewInput() });
    expect(response.headers.get("cache-control")).toContain("private, no-store"); expect(mocks.reauth).toHaveBeenCalledWith(actor);
  });
  it("authorizes before malformed body and before query parsing", async () => {
    mocks.authorize.mockRejectedValue(new IntegrationError("AUTH_REQUIRED", "請先登入。", 401));
    expect((await POST(new Request(url, { method: "POST", body: "{" }))).status).toBe(401);
    expect((await GET(new Request(url))).status).toBe(401); expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it.each([{ ...actor, demo: true }, { ...actor, scopes: [] }])("denies unauthorized actor before DB %#", async value => {
    mocks.authorize.mockResolvedValue(value); expect((await POST(post())).status).toBe(403); expect(mocks.db).not.toHaveBeenCalled();
  });
  it("requires real recent reauthentication only for write", async () => {
    mocks.reauth.mockRejectedValue(new IntegrationError("AAL2_REQUIRED", "重新驗證", 403));
    expect((await POST(post())).status).toBe(403); expect(mocks.rpc).not.toHaveBeenCalled();
    mocks.rpc.mockResolvedValue({ data: reviewHistory(), error: null }); mocks.reauth.mockClear();
    expect((await GET(new Request(`${url}?version=${ids.version}`))).status).toBe(200); expect(mocks.reauth).not.toHaveBeenCalled();
  });
  it("retains existing staff AAL2 session admission even for read-only history", async () => {
    mocks.authorize.mockRejectedValue(new IntegrationError("AAL2_REQUIRED", "需要既有驗證工作階段", 403));
    expect((await GET(new Request(`${url}?version=${ids.version}`))).status).toBe(403);
    expect(mocks.rpc).not.toHaveBeenCalled(); expect(mocks.reauth).not.toHaveBeenCalled();
  });
  it.each([`${url}?version=${ids.version}&version=${ids.version}`, `${url}?version=${ids.version}&org=${ids.other}`, url])("strict read query %s", async value => {
    expect((await GET(new Request(value))).status).toBe(400); expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("rejects overposting and wrong actor receipt", async () => {
    expect((await POST(post({ ...reviewInput(), organizationId: ids.other }))).status).toBe(400);
    mocks.rpc.mockResolvedValue({ data: { ...reviewReceipt(), event: { ...reviewReceipt().event, actorId: ids.other } }, error: null });
    expect((await POST(post())).status).toBe(409);
  });
  it.each([["42501", 403], ["22023", 400], ["23514", 409], ["23505", 409], ["40001", 409], ["55000", 409], ["XX000", 503]])("safe SQL failure %s", async (code, status) => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code, message: "SECRET_PII" } }); const response = await POST(post());
    expect(response.status).toBe(status); expect(await response.text()).not.toContain("SECRET_PII");
  });
  it("retains original closed request on replay", async () => {
    mocks.rpc.mockResolvedValue({ data: { ...reviewReceipt(), requestStatus: "withdrawn", replayed: true }, error: null });
    const response = await POST(post()); expect(response.status).toBe(200); expect((await response.json()).data.receipt.requestStatus).toBe("withdrawn");
  });
  it("keeps original approval branch evidence when reviewer selects another authorized branch", async () => {
    mocks.authorize.mockResolvedValue({ ...actor, branchId: ids.other });
    mocks.rpc.mockResolvedValue({ data: reviewReceipt("approve"), error: null });
    const response = await POST(post(reviewInput("approve")));
    expect(response.status).toBe(201); expect((await response.json()).data.receipt.event.branchId).toBe(ids.branch);
    expect(mocks.rpc).toHaveBeenCalledWith("write_custom_form_publication_v2", expect.objectContaining({ p_branch: ids.other }));
  });
});
