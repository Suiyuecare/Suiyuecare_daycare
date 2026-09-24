import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ demo: true, getTenantContext: vi.fn(), hasRecentAal2: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/env", () => ({ isDemoMode: () => state.demo, hasSupabaseConfiguration: () => true }));
vi.mock("@/lib/auth/context", () => ({ getTenantContext: state.getTenantContext, hasRecentAal2: state.hasRecentAal2 }));

import { POST as upload } from "./html/route";
import { GET as preview } from "./[id]/preview/route";
import { POST as approve } from "./[id]/approve/route";
import { POST as reparse } from "./[id]/reparse/route";
import { registerProductionImportStorage } from "@/lib/imports/storage";
import { CURRENT_MAPPING_VERSION } from "@/lib/imports/types";

const ORG = "00000000-0000-4000-8000-000000000001";
const BRANCH = "00000000-0000-4000-8000-000000000002";
const USER = "00000000-0000-4000-8000-000000000003";
const context = { organizationId: ORG, branchId: BRANCH, userId: USER,
  scopes: ["imports.manage", "imports.approve"], assuranceLevel: "aal2" };
const html = "<!doctype html><meta charset=utf-8><h5>需要服務者基本資料</h5><table><tr><th>個案姓名</th><td>合成個案不可外洩</td></tr></table>";
function uploadRequest(key = "upload") {
  const body = new FormData();
  body.set("file", new File([html], "synthetic.html", { type: "text/html" }));
  body.set("idempotency_key", key);
  return new Request("http://localhost/api/imports/html", { method: "POST", headers: { "idempotency-key": key }, body });
}
function jsonRequest(id: string, action: string, key: string, extra = {}) {
  return new Request("http://localhost/api/imports/" + id + "/" + action, {
    method: "POST", headers: { "content-type": "application/json", "idempotency-key": key },
    body: JSON.stringify({ idempotency_key: key, ...extra }),
  });
}
const params = (id: string) => ({ params: Promise.resolve({ id }) });

describe("central HTML route integration with synthetic in-memory records", () => {
  beforeEach(() => {
    state.demo = true;
    vi.clearAllMocks();
    state.getTenantContext.mockResolvedValue(context);
    state.hasRecentAal2.mockResolvedValue(true);
    delete (globalThis as { __daycareDemoImportRepository?: unknown }).__daycareDemoImportRepository;
  });

  it("uploads, previews, freezes staging and returns no formal-import receipt", async () => {
    const uploaded = await upload(uploadRequest());
    expect(uploaded.status).toBe(201);
    const id = (await uploaded.json()).data.batch.id;
    const view = await preview(new Request("http://localhost/api/imports/" + id + "/preview"), params(id));
    expect(view.status).toBe(200);
    expect(view.headers.get("cache-control")).toContain("no-store");
    expect(await view.text()).not.toContain("合成個案不可外洩");
    const approved = await approve(jsonRequest(id, "approve", "approve"), params(id));
    expect(approved.status).toBe(200);
    const receipt = await approved.json();
    expect(receipt).toMatchObject({ status: "ok", errors: [], data: {
      staging_only: true, formally_imported: false, batch: { id, status: "ready_for_approval", version: 2 },
    } });
    expect(receipt.requestId).toMatch(/^[a-f0-9-]{36}$/);
    const replay = await approve(jsonRequest(id, "approve", "approve"), params(id));
    expect((await replay.json()).data).toEqual(receipt.data);
    const frozen = await reparse(jsonRequest(id, "reparse", "new-reparse", { mapping_version: CURRENT_MAPPING_VERSION }), params(id));
    expect(frozen.status).toBe(409);
    expect((await frozen.json()).errors[0].code).toBe("IMMUTABLE_IMPORT");
  });

  it("rejects cross-branch preview and cross-operation replay", async () => {
    const uploaded = await upload(uploadRequest());
    const id = (await uploaded.json()).data.batch.id;
    const otherBranch = new Request("http://localhost/api/imports/" + id + "/preview", { headers: { "x-demo-branch-id": "00000000-0000-4000-8000-000000000099" } });
    expect((await preview(otherBranch, params(id))).status).toBe(404);
    const mismatch = await approve(jsonRequest(id, "approve", "upload"), params(id));
    expect(mismatch.status).toBe(409);
    expect((await mismatch.json()).errors[0].code).toBe("IDEMPOTENCY_KEY_REUSED");
  });

  it.each([
    { actor: null, recent: true, status: 401 },
    { actor: { ...context, scopes: [] }, recent: true, status: 403 },
    { actor: { ...context, assuranceLevel: "aal1" }, recent: true, status: 403 },
    { actor: context, recent: false, status: 403 },
  ])("rejects real requests before reading a file when authorization is insufficient %#", async ({ actor, recent, status }) => {
    state.demo = false;
    state.getTenantContext.mockResolvedValue(actor);
    state.hasRecentAal2.mockResolvedValue(recent);
    const request = uploadRequest();
    const readBody = vi.spyOn(request, "formData");
    const response = await upload(request);
    expect(response.status).toBe(status);
    expect(readBody).not.toHaveBeenCalled();
    expect(response.headers.get("cache-control")).toContain("no-store");
  });

  it("keeps production fail-closed without a registered durable repository", async () => {
    state.demo = false;
    // This test must never register a repository, even if server configuration exists.
    expect(registerProductionImportStorage).toBeTypeOf("function");
    const response = await upload(uploadRequest());
    expect(response.status).toBe(503);
    expect((await response.json()).errors[0].code).toBe("IMPORT_STORAGE_NOT_CONFIGURED");
  });

  it("redacts an unexpected authorization failure instead of echoing secrets", async () => {
    state.demo = false;
    state.getTenantContext.mockRejectedValue(new Error("synthetic-secret-and-client-content"));
    const response = await upload(uploadRequest());
    expect(response.status).toBe(500);
    const text = await response.text();
    expect(text).not.toContain("synthetic-secret-and-client-content");
    expect(text).toContain("IMPORT_INTERNAL_ERROR");
  });
});
