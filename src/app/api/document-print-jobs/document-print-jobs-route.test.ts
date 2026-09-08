import { beforeEach, describe, expect, it, vi } from "vitest";

import { deterministicUuid } from "@/lib/integrations/security";

const stubs = vi.hoisted(() => ({
  authorizeStaffRequest: vi.fn(),
  requireRecentAal2: vi.fn(),
  readJsonObject: vi.fn(),
  createServerSupabaseClient: vi.fn(),
  rpc: vi.fn(),
  maybeSingle: vi.fn(),
}));

vi.mock("@/lib/integrations/http", () => ({
  authorizeStaffRequest: stubs.authorizeStaffRequest,
  requireRecentAal2: stubs.requireRecentAal2,
  readJsonObject: stubs.readJsonObject,
  databaseFailure: (code: string, message: string, httpStatus = 500) =>
    Object.assign(new Error(message), { code, httpStatus }),
  handleIntegrationRoute: async (operation: (requestId: string) => Promise<Response>) => {
    const requestId = "62000000-0000-4000-8000-000000000099";
    try { return await operation(requestId); } catch (error) {
      const value = error as { code?: unknown; message?: unknown; httpStatus?: unknown };
      return Response.json({ requestId, status: "error", data: null, errors: [{
        code: typeof value.code === "string" ? value.code : "ERROR",
        message: typeof value.message === "string" ? value.message : "error",
      }] }, { status: typeof value.httpStatus === "number" ? value.httpStatus : 500 });
    }
  },
}));
vi.mock("@/lib/supabase/server", () => ({
  createServerSupabaseClient: stubs.createServerSupabaseClient,
}));

import { POST } from "./route";

const ORG = "62000000-0000-4000-8000-000000000001";
const BRANCH = "62000000-0000-4000-8000-000000000002";
const ACTOR = "62000000-0000-4000-8000-000000000003";
const TEMPLATE = "62000000-0000-4000-8000-000000000004";
const CLIENT = "62000000-0000-4000-8000-000000000005";
const KEY = "62000000-0000-4000-8000-000000000006";
const OPERATION = "62000000-0000-4000-8000-000000000007";
const JOB = "62000000-0000-4000-8000-000000000008";
const HASH = "a".repeat(64);
const scopes = ["clients.read", "document_printing.read",
  "document_printing.manage", "document_printing.access"];
const actor = { organizationId: ORG, organizationName: "合成機構",
  branchId: BRANCH, branchName: "合成分支", userId: ACTOR,
  displayName: "合成主管", roles: ["branch_supervisor"], scopes,
  assuranceLevel: "aal2", recentAal2At: "2026-09-02T08:00:00.000Z",
  demo: false };
const body = { action: "create_job", templateVersionId: TEMPLATE,
  clientId: CLIENT, documentDate: "2026-09-02" };

function request(operation = "create_job") {
  const headers: Record<string, string> = {
    "content-type": "application/json",
    "idempotency-key": KEY,
  };
  if (operation) headers["x-document-print-operation"] = operation;
  return new Request("https://example.invalid/api/document-print-jobs", {
    method: "POST", headers, body: "{}",
  });
}

function result(override: Record<string, unknown> = {}) {
  return { data: { operation_id: OPERATION, job_id: JOB,
    template_version_id: TEMPLATE, client_id: CLIENT,
    document_date: "2026-09-02", render_model_hash: HASH,
    committed_at: "2026-09-02T08:00:00.000Z", replayed: false,
    ...override }, error: null };
}

describe("Page-62 document print job API boundary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    stubs.authorizeStaffRequest.mockResolvedValue(actor);
    stubs.requireRecentAal2.mockResolvedValue(undefined);
    stubs.readJsonObject.mockResolvedValue(body);
    stubs.createServerSupabaseClient.mockResolvedValue({ rpc: stubs.rpc });
    stubs.rpc.mockReturnValue({ maybeSingle: stubs.maybeSingle });
    stubs.maybeSingle.mockResolvedValue(result());
  });

  it.each([
    { ...actor, scopes: scopes.filter((scope) => scope !== "clients.read") },
    { ...actor, scopes: scopes.filter((scope) => scope !== "document_printing.read") },
    { ...actor, scopes: scopes.filter((scope) => scope !== "document_printing.manage") },
    { ...actor, assuranceLevel: "aal1" },
    { ...actor, demo: true },
  ])("rejects insufficient authority before reading document selection %#", async (value) => {
    stubs.authorizeStaffRequest.mockResolvedValue(value);
    expect((await POST(request())).status).toBe(403);
    expect(stubs.requireRecentAal2).not.toHaveBeenCalled();
    expect(stubs.readJsonObject).not.toHaveBeenCalled();
  });

  it("requires recent same-session AAL2 before parsing the body", async () => {
    stubs.requireRecentAal2.mockRejectedValue(Object.assign(
      new Error("請重新驗證"), { code: "AAL2_REQUIRED", httpStatus: 403 },
    ));
    expect((await POST(request())).status).toBe(403);
    expect(stubs.readJsonObject).not.toHaveBeenCalled();
  });

  it("requires the governed operation header before parsing the body", async () => {
    const response = await POST(request(""));
    expect(response.status).toBe(400);
    expect(stubs.readJsonObject).not.toHaveBeenCalled();
    expect((await response.json()).errors[0].code)
      .toBe("DOCUMENT_PRINT_ACTION_REQUIRED");
  });

  it("binds tenant, actor, selection, and idempotency key to one RPC", async () => {
    const response = await POST(request());
    expect(response.status).toBe(201);
    expect(stubs.rpc).toHaveBeenCalledWith("create_document_print_job", {
      p_expected_organization_id: ORG,
      p_expected_branch_id: BRANCH,
      p_template_version_id: TEMPLATE,
      p_client_id: CLIENT,
      p_document_date: "2026-09-02",
      p_idempotency_key: deterministicUuid(
        "page62-document-print-job", ORG, ACTOR, KEY,
      ),
    });
    expect((await response.json()).data.receipt).toMatchObject({
      action: "create_job", jobId: JOB, renderModelHash: HASH,
      persisted: true, demo: false, replayed: false,
    });
  });

  it("uses 200 only for an exact replay receipt", async () => {
    stubs.maybeSingle.mockResolvedValue(result({ replayed: true }));
    const response = await POST(request());
    expect(response.status).toBe(200);
    expect((await response.json()).data.receipt.replayed).toBe(true);
  });

  it("rejects unknown client-controlled font or output fields before persistence", async () => {
    stubs.readJsonObject.mockResolvedValue({ ...body,
      fontObjectPath: "private/font.ttf", output: "html" });
    expect((await POST(request())).status).toBe(400);
    expect(stubs.createServerSupabaseClient).not.toHaveBeenCalled();
  });

  it.each([
    { template_version_id: ACTOR },
    { client_id: ACTOR },
    { document_date: "2026-09-01" },
    { render_model_hash: "not-a-hash" },
  ])("fails closed on mismatched or malformed DB receipts %#", async (override) => {
    stubs.maybeSingle.mockResolvedValue(result(override));
    expect((await POST(request())).status).toBe(502);
  });

  it("does not expose private database content on failure", async () => {
    stubs.maybeSingle.mockResolvedValue({ data: null,
      error: { code: "42501", message: "合成個案與私有字型路徑不可洩漏" } });
    const response = await POST(request());
    expect(response.status).toBe(403);
    expect(JSON.stringify(await response.json()))
      .not.toContain("合成個案與私有字型路徑");
  });
});
