import { beforeEach, describe, expect, it, vi } from "vitest";

import { sha256Hex } from "@/lib/integrations/security";

const stubs = vi.hoisted(() => ({
  authorizeStaffRequest: vi.fn(),
  requireRecentAal2: vi.fn(),
  verifyDocumentAccessToken: vi.fn(),
  renderDocumentPdf: vi.fn(),
  createServerSupabaseClient: vi.fn(),
  createSupabaseAdminClient: vi.fn(),
  rpc: vi.fn(),
  maybeSingle: vi.fn(),
  storageFrom: vi.fn(),
  download: vi.fn(),
}));

vi.mock("@/lib/integrations/http", () => ({
  authorizeStaffRequest: stubs.authorizeStaffRequest,
  requireRecentAal2: stubs.requireRecentAal2,
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
vi.mock("@/lib/document-printing/download-token", () => ({
  verifyDocumentAccessToken: stubs.verifyDocumentAccessToken,
}));
vi.mock("@/lib/document-printing/pdf-renderer", () => ({
  renderDocumentPdf: stubs.renderDocumentPdf,
}));
vi.mock("@/lib/supabase/server", () => ({
  createServerSupabaseClient: stubs.createServerSupabaseClient,
}));
vi.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdminClient: stubs.createSupabaseAdminClient,
}));

import { GET } from "./route";

const ORG = "62000000-0000-4000-8000-000000000201";
const BRANCH = "62000000-0000-4000-8000-000000000202";
const ACTOR = "62000000-0000-4000-8000-000000000203";
const TEMPLATE = "62000000-0000-4000-8000-000000000204";
const CLIENT = "62000000-0000-4000-8000-000000000205";
const JOB = "62000000-0000-4000-8000-000000000206";
const HASH = "a".repeat(64);
const fontBytes = new Uint8Array(2_048).fill(7);
const actor = { organizationId: ORG, organizationName: "合成機構",
  branchId: BRANCH, branchName: "合成分支", userId: ACTOR,
  displayName: "合成主管", roles: ["branch_supervisor"],
  scopes: ["clients.read", "document_printing.read", "document_printing.access"],
  assuranceLevel: "aal2", recentAal2At: "2026-09-02T08:00:00.000Z",
  demo: false };
const renderModel = {
  schemaVersion: 1, locale: "zh-TW", timezone: "Asia/Taipei",
  template: { versionId: TEMPLATE, templateKey: "synthetic_summary",
    version: 1, title: "合成摘要", contentHash: HASH },
  organization: { organizationId: ORG, organizationName: "合成機構",
    branchId: BRANCH, branchName: "合成分支" },
  client: { clientId: CLIENT, displayName: "合成個案", clientCode: "P62" },
  documentDate: "2026-09-02", generatedAt: "2026-09-02T08:00:00.000Z",
  title: "合成文件", watermark: "合成測試",
  sections: [{ heading: "合成段落", rows: [
    { label: "欄位", value: "內容", state: "recorded" },
  ] }], footerNote: "合成資料，不是正式表單。",
};

function accessResult(override: Record<string, unknown> = {}) {
  return { data: { job_id: JOB, template_version_id: TEMPLATE,
    client_id: CLIENT, render_model: renderModel, render_model_hash: HASH,
    font_bucket: "private-doc-fonts", font_object_path: "org/font.ttf",
    font_sha256: sha256Hex(fontBytes),
    accessed_at: "2026-09-02T08:01:00.000Z", ...override }, error: null };
}

function request(mode: "preview" | "download" = "preview", suffix = "") {
  return new Request(
    `https://example.invalid/api/document-print-jobs/${JOB}/pdf?mode=${mode}&token=safe-token${suffix}`,
  );
}

function invoke(value = request(), jobId = JOB) {
  return GET(value, { params: Promise.resolve({ jobId }) });
}

describe("Page-62 governed PDF access route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    stubs.authorizeStaffRequest.mockResolvedValue(actor);
    stubs.requireRecentAal2.mockResolvedValue(undefined);
    stubs.verifyDocumentAccessToken.mockReturnValue({});
    stubs.createServerSupabaseClient.mockResolvedValue({ rpc: stubs.rpc });
    stubs.rpc.mockReturnValue({ maybeSingle: stubs.maybeSingle });
    stubs.maybeSingle.mockResolvedValue(accessResult());
    stubs.createSupabaseAdminClient.mockReturnValue({ storage: {
      from: stubs.storageFrom,
    } });
    stubs.storageFrom.mockReturnValue({ download: stubs.download });
    stubs.download.mockResolvedValue({ data: new Blob([fontBytes]), error: null });
    stubs.renderDocumentPdf.mockResolvedValue(
      new TextEncoder().encode("%PDF-1.7\nsynthetic"),
    );
  });

  it.each([
    { ...actor, scopes: actor.scopes.filter((scope) => scope !== "clients.read") },
    { ...actor, scopes: actor.scopes.filter((scope) => scope !== "document_printing.read") },
    { ...actor, scopes: actor.scopes.filter((scope) => scope !== "document_printing.access") },
    { ...actor, assuranceLevel: "aal1" },
    { ...actor, demo: true },
  ])("rejects insufficient authority before reading the short-lived token %#", async (value) => {
    stubs.authorizeStaffRequest.mockResolvedValue(value);
    expect((await invoke()).status).toBe(403);
    expect(stubs.requireRecentAal2).not.toHaveBeenCalled();
    expect(stubs.verifyDocumentAccessToken).not.toHaveBeenCalled();
    expect(stubs.rpc).not.toHaveBeenCalled();
  });

  it("requires recent same-session AAL2 before token verification", async () => {
    stubs.requireRecentAal2.mockRejectedValue(Object.assign(
      new Error("請重新驗證"), { code: "AAL2_REQUIRED", httpStatus: 403 },
    ));
    expect((await invoke()).status).toBe(403);
    expect(stubs.verifyDocumentAccessToken).not.toHaveBeenCalled();
  });

  it("rejects duplicate, extra, or malformed query fields before DB access", async () => {
    for (const value of [
      request("preview", "&token=second"),
      request("preview", "&extra=x"),
      new Request(`https://example.invalid/api/document-print-jobs/${JOB}/pdf?mode=raw&token=x`),
    ]) {
      expect((await invoke(value)).status).toBe(400);
    }
    expect(stubs.rpc).not.toHaveBeenCalled();
  });

  it("binds the token to current user, job, and requested access mode", async () => {
    await invoke(request("download"));
    expect(stubs.verifyDocumentAccessToken).toHaveBeenCalledWith({
      token: "safe-token", expectedJobId: JOB, expectedUserId: ACTOR,
      expectedMode: "download",
    });
  });

  it("stops before DB and storage when the token is invalid", async () => {
    stubs.verifyDocumentAccessToken.mockImplementation(() => {
      throw new Error("DOCUMENT_ACCESS_TOKEN_INVALID");
    });
    const response = await invoke();
    expect(response.status).toBe(403);
    expect(stubs.rpc).not.toHaveBeenCalled();
    expect(stubs.createSupabaseAdminClient).not.toHaveBeenCalled();
  });

  it("authorizes via user RPC before privileged font download and returns no-store PDF", async () => {
    const response = await invoke();
    expect(response.status).toBe(200);
    expect(stubs.rpc).toHaveBeenCalledWith("access_document_print_job", {
      p_expected_organization_id: ORG, p_expected_branch_id: BRANCH,
      p_job_id: JOB, p_action: "preview",
    });
    expect(stubs.rpc.mock.invocationCallOrder[0])
      .toBeLessThan(stubs.createSupabaseAdminClient.mock.invocationCallOrder[0]!);
    expect(stubs.storageFrom).toHaveBeenCalledWith("private-doc-fonts");
    expect(stubs.download).toHaveBeenCalledWith("org/font.ttf");
    expect(stubs.renderDocumentPdf).toHaveBeenCalledWith({
      model: expect.objectContaining({ title: "合成文件" }), fontBytes,
    });
    expect(response.headers.get("content-type")).toBe("application/pdf");
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(response.headers.get("content-disposition")).toContain("inline");
    expect(response.headers.get("content-length")).toBeNull();
    expect(new TextDecoder().decode(await response.arrayBuffer()))
      .toContain("%PDF-");
  });

  it("streams a response larger than the buffered Function payload limit", async () => {
    const largePdf = new Uint8Array(5 * 1024 * 1024);
    largePdf.set(new TextEncoder().encode("%PDF-1.7\n"));
    stubs.renderDocumentPdf.mockResolvedValue(largePdf);
    const response = await invoke();
    expect(response.status).toBe(200);
    expect(response.headers.get("content-length")).toBeNull();
    const received = new Uint8Array(await response.arrayBuffer());
    expect(received.byteLength).toBe(largePdf.byteLength);
    expect(new TextDecoder().decode(received.slice(0, 9))).toBe("%PDF-1.7\n");
  });

  it("uses attachment disposition for download without putting PII in filename", async () => {
    const response = await invoke(request("download"));
    expect(response.headers.get("content-disposition"))
      .toBe(`attachment; filename="document-${JOB}.pdf"`);
    expect(response.headers.get("content-disposition")).not.toContain("合成個案");
  });

  it("fails closed on a cross-scope access receipt before storage", async () => {
    stubs.maybeSingle.mockResolvedValue(accessResult({
      render_model: { ...renderModel, organization: {
        ...renderModel.organization,
        branchId: "62000000-0000-4000-8000-000000000999",
      } },
    }));
    expect((await invoke()).status).toBe(502);
    expect(stubs.createSupabaseAdminClient).not.toHaveBeenCalled();
  });

  it("fails closed when the downloaded font hash differs", async () => {
    stubs.maybeSingle.mockResolvedValue(accessResult({ font_sha256: "f".repeat(64) }));
    const response = await invoke();
    expect(response.status).toBe(409);
    expect(stubs.renderDocumentPdf).not.toHaveBeenCalled();
  });

  it("does not expose storage or renderer failures", async () => {
    stubs.download.mockResolvedValue({ data: null,
      error: { message: "private path and credentials" } });
    const response = await invoke();
    expect(response.status).toBe(503);
    expect(JSON.stringify(await response.json()))
      .not.toContain("private path and credentials");
  });
});
