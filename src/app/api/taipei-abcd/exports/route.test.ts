import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { TAIPEI_ABCD_TEMPLATE } from "@/lib/taipei-abcd/catalog";
import { emptyWorkflow } from "@/lib/taipei-abcd/workflow";
import { IntegrationError } from "@/lib/integrations/errors";
const mocks = vi.hoisted(() => ({ actor: vi.fn(), aal2: vi.fn(), read: vi.fn(), client: vi.fn(), rpc: vi.fn(), render: vi.fn(), file: vi.fn() }));
vi.mock("node:fs/promises", () => ({ readFile: mocks.file }));
vi.mock("@/lib/supabase/server", () => ({ createServerSupabaseClient: mocks.client }));
vi.mock("@/lib/document-printing/pdf-renderer", () => ({ renderDocumentPdf: mocks.render }));
vi.mock("@/lib/integrations/http", () => ({ authorizeStaffRequest: mocks.actor, requireRecentAal2: mocks.aal2, readJsonObject: mocks.read, handleIntegrationRoute: async (op: () => Promise<Response>) => { try { return await op(); } catch (cause) { const e = cause as { code?: string; message?: string; httpStatus?: number }; return Response.json({ errors: [{ code: e.code, message: e.message }] }, { status: e.httpStatus ?? 500 }); } } }));
import { POST, preferredRegion } from "./route";
const org = "bd010000-0000-4000-8000-000000000001", branch = "bd010000-0000-4000-8000-000000000002", client = "bd010000-0000-4000-8000-000000000003", id = "bd010000-0000-4000-8000-000000000004", key = "bd010000-0000-4000-8000-000000000005";
const actor = { organizationId: org, branchId: branch, assuranceLevel: "aal2", demo: false, scopes: ["clients.read", "abcd_assessments.read", "document_printing.read", "document_printing.manage", "document_printing.access"] };
const payload = { clientId: client, draftId: id, contentHash: "a".repeat(64), expectedSequence: 0, idempotency_key: key };
const result = { id: key, snapshotHash: "b".repeat(64), fontAssetKey: "taipei-crosswalk-font-v1", snapshot: {
  sourceRevision: "114.11", sourceSha256: TAIPEI_ABCD_TEMPLATE.sourceSha256, templateKey: TAIPEI_ABCD_TEMPLATE.key, rendererVersion: "taipei-crosswalk-v1", fontAssetKey: "taipei-crosswalk-font-v1", isElectronicSignature: false, isOfficialComplete: false, generatedAt: "2026-09-14T03:00:00Z", workflow: emptyWorkflow,
  organization: { organizationId: org, organizationName: "合成", branchId: branch, branchName: "合成" }, client: { clientId: client, displayName: "合成", clientCode: null },
  draft: { id, organizationId: org, branchId: branch, clientId: client, form: "A", usageYear: 115, month: 0, version: 1, previousVersionId: null, contentHash: "a".repeat(64), answers: {}, sourceSnapshot: null, createdAt: "2026-09-14T03:00:00Z", state: "draft", publicationStatus: "pending_approval" },
} };
const font = new Uint8Array(readFileSync("assets/fonts/NotoSansTC-Regular.ttf")); const bytes = new TextEncoder().encode("%PDF-1.7 synthetic route response");
const request = () => new Request("https://example.invalid/api/taipei-abcd/exports", { method: "POST", headers: { "idempotency-key": key }, body: "{}" });
describe("Taipei private immutable PDF API", () => {
  beforeEach(() => { vi.clearAllMocks(); mocks.actor.mockResolvedValue(actor); mocks.aal2.mockResolvedValue(undefined); mocks.read.mockResolvedValue(payload); mocks.client.mockResolvedValue({ rpc: mocks.rpc }); mocks.rpc.mockResolvedValue({ data: result, error: null }); mocks.file.mockResolvedValue(font); mocks.render.mockResolvedValue(bytes); });
  it("uses Tokyo and denies missing permission before reading contents", async () => { expect(preferredRegion).toBe("hnd1"); mocks.actor.mockResolvedValue({ ...actor, scopes: actor.scopes.filter(s => s !== "document_printing.read") }); expect((await POST(request())).status).toBe(403); expect(mocks.read).not.toHaveBeenCalled(); });
  it("requires actual recent AAL2 before consuming input", async () => { mocks.aal2.mockRejectedValue(new IntegrationError("REAUTH_REQUIRED", "需要本人驗證", 403)); expect((await POST(request())).status).toBe(403); expect(mocks.read).not.toHaveBeenCalled(); expect(mocks.rpc).not.toHaveBeenCalled(); });
  it("streams exact same PDF bytes with private headers and snapshot identity", async () => { const r = await POST(request()); expect(r.status).toBe(200); expect(new Uint8Array(await r.arrayBuffer())).toEqual(bytes); expect(r.headers.get("cache-control")).toContain("no-store"); expect(r.headers.get("content-security-policy")).toBe("sandbox"); expect(r.headers.get("x-pdf-sha256")).toBe(createHash("sha256").update(bytes).digest("hex")); expect(r.headers.get("x-taipei-snapshot-id")).toBe(key); expect(r.headers.get("x-taipei-snapshot-hash")).toBe(result.snapshotHash); expect(mocks.rpc.mock.calls[0][1].p_expected_organization_id).toBe(org); expect(mocks.file.mock.calls[0][0]).toContain("assets/fonts/NotoSansTC-Regular.ttf"); });
  it.each([{ organization: { ...result.snapshot.organization, organizationId: key } }, { client: { ...result.snapshot.client, clientId: key } }, { draft: { ...result.snapshot.draft, contentHash: "c".repeat(64) } }, { workflow: { ...emptyWorkflow, sequence: 1 } }])("rejects cross-scope/stale snapshot %j", async delta => { mocks.rpc.mockResolvedValue({ data: { ...result, snapshot: { ...result.snapshot, ...delta } }, error: null }); expect((await POST(request())).status).toBe(502); expect(mocks.file).not.toHaveBeenCalled(); expect(mocks.render).not.toHaveBeenCalled(); });
  it("rejects modified font before rendering and never returns partial output", async () => { mocks.file.mockResolvedValue(new Uint8Array([1, 2, 3])); expect((await POST(request())).status).toBe(409); expect(mocks.render).not.toHaveBeenCalled(); });
  it("fails closed when complete text cannot render", async () => { mocks.render.mockRejectedValue(new Error("MISSING_GLYPH_PRIVATE")); const r = await POST(request()); expect(r.status).toBe(409); expect(await r.text()).not.toContain("MISSING_GLYPH_PRIVATE"); });
  it("maps server permissions without leaking database details", async () => { mocks.rpc.mockResolvedValue({ data: null, error: { code: "42501", message: "PRIVATE_DATABASE" } }); const r = await POST(request()); expect(r.status).toBe(403); expect(await r.text()).not.toContain("PRIVATE_DATABASE"); expect(mocks.file).not.toHaveBeenCalled(); });
});
