// @vitest-environment jsdom
// Awaiting the async function tests its server output contract, not Next's RSC
// runtime. Real browser/SSR and user-scoped RPC evidence are separate gates.
import { createElement } from "react";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getPageBySlug } from "@/lib/catalog";
import type { TenantContext } from "@/lib/domain/types";
import { IntegrationError } from "@/lib/integrations/errors";
import { sourcesSnapshotSchema, type StaffCertificateDocumentSourcesSnapshot } from "@/lib/staff-certificate-documents/recovery-schema";
import { documentsSnapshotSchema } from "@/lib/staff-certificate-documents/schema";

const mocks = vi.hoisted(() => ({ load: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/staff-certificate-documents/workspace-source", () => ({ loadStaffCertificateDocumentWorkspace: mocks.load }));
vi.mock("next/link", () => ({ default: ({ children, href, ...props }: { children: React.ReactNode; href: string }) => createElement("a", { ...props, href }, children) }));
import { StaffCertificateDocumentsWorkspace } from "./staff-certificate-documents-workspace";

const id = (n: number) => `da72000b-0000-4000-8000-${String(n).padStart(12, "0")}`;
const stamp = "2026-09-27T06:00:00.000Z", baseRoute = "/app/staff/operations/staff-certificates";
const context: TenantContext = { organizationId: id(1), branchId: id(2), userId: id(9), displayName: "合成主任", organizationName: "合成機構",
  branchName: "合成分支", roles: ["branch_director"], scopes: ["staff_certificates.read", "staff_certificates.manage"], assuranceLevel: "aal2", recentAal2At: null, demo: false };
const page = getPageBySlug("staff/operations/staff-certificates")!;
const row = (n = 1): StaffCertificateDocumentSourcesSnapshot["rows"][number] => ({ staffMembershipId: id(3), staffUserId: id(4), displayName: `合成員工${n}`, certificateKey: id(100 + n), recordVersionId: id(200 + n),
  recordContentHash: "a".repeat(64), version: n, recordStatus: "active" as const, certificateType: "合成護理證照", effectiveOn: "2026-01-01", expiresOn: "2027-01-01", canUpload: true });
const sources = (rows = [row()], overrides: Record<string, unknown> = {}) => sourcesSnapshotSchema.parse({ organizationId: id(1), branchId: id(2), actorUserId: id(9),
  staffMembershipId: null, generatedAt: stamp, page: 1, pageSize: 50, rows, total: rows.length, hasMore: false, canManageDocuments: true,
  serviceEligibility: "not_evaluated", signable: false, demo: false, ...overrides });
const document = () => ({ documentId: id(7), organizationId: id(1), branchId: id(2), staffMembershipId: id(3), staffUserId: id(4), certificateKey: row().certificateKey,
  recordVersionId: row().recordVersionId, recordContentHash: row().recordContentHash, sha256: "b".repeat(64), mimeType: "application/pdf" as const, fileSizeBytes: 1500,
  uploadedBy: id(8), uploadedAt: "2026-09-27T04:00:00.123456Z", scanStatus: "clean" as const, persisted: true as const,
  serviceEligibility: "not_evaluated" as const, signable: false as const, demo: false as const });
const review = (decision: "verified" | "rejected" = "verified") => ({ ...document(), reviewId: id(10), reviewedBy: id(9), reviewedAt: "2026-09-27T05:00:00.123456Z",
  decision, reason: "合成獨立核對理由", replayed: false });
const history = (records: unknown[] = [{ ...document(), review: null, canDownload: true }], overrides: Record<string, unknown> = {}) => documentsSnapshotSchema.parse({
  organizationId: id(1), branchId: id(2), actorUserId: id(9), staffMembershipId: id(3), staffUserId: id(4), certificateKey: row().certificateKey,
  recordVersionId: row().recordVersionId, recordContentHash: row().recordContentHash, generatedAt: stamp, documents: records, total: records.length, truncated: false,
  serviceEligibility: "not_evaluated", signable: false, demo: false, ...overrides });
const selectedResult = (documents = history()) => ({ sources: sources(), selected: row(), documents });
const deniedActors: [TenantContext, string, string][] = [
  [{ ...context, demo: true }, "展示模式不讀取員工附件", "回員工證照"],
  [{ ...context, scopes: [] }, "沒有員工證照查閱權限", "回今日工作"],
  [{ ...context, branchId: "" }, "沒有員工證照查閱權限", "回今日工作"],
  [{ ...context, assuranceLevel: "aal1" }, "請先確認身分", "確認身分"],
];
async function show(actor = context, query: Record<string, string | string[] | undefined> = {}) {
  return render(await StaffCertificateDocumentsWorkspace({ context: actor, query, page }));
}
function expectReadOnly(container: HTMLElement) {
  expect(container.querySelectorAll('form[method="post"],input[type="file"],textarea,[data-questionnaire-write]')).toHaveLength(0);
  expect(container.querySelectorAll('a[download],a[href*="/api/"],iframe,script')).toHaveLength(0);
  expect(screen.queryByRole("button", { name: /上傳|核驗|下載|簽署|核准|例外/u })).toBeNull();
  expect(fetch).not.toHaveBeenCalled();
}
beforeEach(() => {
  mocks.load.mockReset().mockResolvedValue({ sources: sources(), selected: null, documents: null });
  vi.stubGlobal("fetch", vi.fn());
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("staff certificate document-only SSR output", () => {
  it.each(deniedActors)("denies before loading documents: %s", async (actor, heading, action) => {
    const { container } = await show(actor);
    expect(screen.getByRole("heading", { name: heading })).toBeTruthy(); expect(screen.getByRole("link", { name: action })).toBeTruthy();
    expect(mocks.load).not.toHaveBeenCalled(); expect(container.textContent).not.toContain("合成員工"); expectReadOnly(container);
  });
  it("uses the actual context/query and does not auto-select or read any attachment", async () => {
    const query = { view: "documents", staff: id(3), page: "1" };
    const { container } = await show(context, query);
    expect(mocks.load).toHaveBeenCalledExactlyOnceWith(context, query);
    expect(screen.getByRole("heading", { level: 1, name: "員工證照" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "先選擇一份證照" })).toBeTruthy();
    expect(screen.getByText("目前授權分支的證照 · 共 1 筆")).toBeTruthy();
    expect((screen.getByRole("combobox", { name: "員工與證照" }) as HTMLSelectElement).value).toBe("");
    expect(screen.queryByText("檔案檢查通過")).toBeNull(); expectReadOnly(container);
  });
  it("uses one labelled GET selector with immutable version identity and shared form controls", async () => {
    mocks.load.mockResolvedValue({ sources: sources([row(), row(2)]), selected: row(2), documents: null });
    const { container } = await show();
    const select = screen.getByRole("combobox", { name: "員工與證照" }) as HTMLSelectElement;
    expect(select.value).toBe(row(2).recordVersionId); expect(select.name).toBe("version");
    const form = select.closest("form")!;
    expect(form.getAttribute("method")).toBe("get"); expect(form.getAttribute("action")).toBe(baseRoute); expect(form.noValidate).toBe(true);
    expect(new FormData(form).get("view")).toBe("documents"); expect(new FormData(form).get("page")).toBe("1");
    expect(screen.getByRole("button", { name: "查看附件" }).className).toContain("button--primary");
    fireEvent.change(select, { target: { value: row().recordVersionId } });
    expect(new FormData(form).get("version")).toBe(row().recordVersionId);
    expect(mocks.load).toHaveBeenCalledTimes(1); expectReadOnly(container);
  });
  it("keeps staff filter but drops old selected version when paging a bounded 50-row list", async () => {
    const rows = Array.from({ length: 50 }, (_, n) => row(n + 1));
    mocks.load.mockResolvedValue({ sources: sources(rows, { total: 101, hasMore: true, staffMembershipId: id(3), page: 2 }), selected: null, documents: null });
    const { container } = await show(context, { view: "documents", staff: id(3), page: "2" });
    const nav = screen.getByRole("navigation", { name: "證照清單分頁" });
    expect(within(nav).getByText("第 2 頁 · 本頁 50 筆").getAttribute("aria-current")).toBe("page");
    for (const [name, target] of [["上一頁", "1"], ["下一頁", "3"]]) {
      const link = within(nav).getByRole("link", { name }); const url = new URL(link.getAttribute("href")!, "https://synthetic.invalid");
      expect(url.pathname).toBe(baseRoute); expect(url.searchParams.get("page")).toBe(target); expect(url.searchParams.get("staff")).toBe(id(3));
      expect(url.searchParams.get("view")).toBe("documents"); expect(url.searchParams.has("version")).toBe(false);
    }
    expect(container.querySelectorAll("select option")).toHaveLength(51); expectReadOnly(container);
  });
  it("disables pagination boundaries rather than offering false links", async () => {
    await show(); const nav = screen.getByRole("navigation", { name: "證照清單分頁" });
    expect((within(nav).getByRole("button", { name: "上一頁" }) as HTMLButtonElement).disabled).toBe(true);
    expect((within(nav).getByRole("button", { name: "下一頁" }) as HTMLButtonElement).disabled).toBe(true);
    expect(within(nav).queryAllByRole("link")).toHaveLength(0);
  });
  it("makes read-only self access explicit, without promoting canUpload to a browser action", async () => {
    mocks.load.mockResolvedValue({ sources: sources([{ ...row(), staffUserId: context.userId, canUpload: false }], { canManageDocuments: false }), selected: null, documents: null });
    const { container } = await show({ ...context, scopes: ["staff_certificates.read"] });
    expect(screen.getByText("本人可見的證照 · 共 1 筆")).toBeTruthy(); expectReadOnly(container);
  });
  it("distinguishes zero visible records from an out-of-range page", async () => {
    mocks.load.mockResolvedValue({ sources: sources([]), selected: null, documents: null });
    const first = await show(); expect(screen.getByRole("status").textContent).toContain("目前沒有可見的證照紀錄"); expect(screen.queryByRole("combobox")).toBeNull(); first.unmount();
    mocks.load.mockResolvedValue({ sources: sources([], { page: 2, total: 1 }), selected: null, documents: null });
    await show(context, { page: "2" }); expect(screen.getByRole("status").textContent).toContain("這一頁沒有證照");
    expect(screen.getByRole("link", { name: "上一頁" }).getAttribute("href")).toContain("page=1");
  });
  it("returns an out-of-range page10000 to visible records in one GET, preserving staff but not version", async () => {
    mocks.load.mockResolvedValue({ sources: sources([], { page: 10000, total: 1, staffMembershipId: id(3) }), selected: null, documents: null });
    const { container } = await show(context, { view: "documents", page: "10000", staff: id(3) });
    const link = screen.getByRole("link", { name: "回第一頁" });
    const href = new URL(link.getAttribute("href")!, "https://synthetic.invalid");
    expect(href.pathname).toBe(baseRoute); expect(href.searchParams.get("view")).toBe("documents");
    expect(href.searchParams.get("page")).toBe("1"); expect(href.searchParams.get("staff")).toBe(id(3));
    expect(href.searchParams.has("version")).toBe(false); expectReadOnly(container);
  });
  it.each([
    ["reserved", "上傳待確認", "尚未核驗"], ["clean", "檔案檢查通過", "待第二人核驗"],
    ["infected", "檔案檢查未通過", "尚未核驗"], ["failed", "檔案檢查失敗", "尚未核驗"],
  ] as const)("renders exact %s scan state without claiming human verification", async (scanStatus, label, reviewLabel) => {
    const documents = history([{ ...document(), scanStatus, review: null, canDownload: scanStatus === "clean" }]);
    mocks.load.mockResolvedValue(selectedResult(documents)); const { container } = await show();
    expect(screen.getByRole("heading", { name: label })).toBeTruthy(); expect(screen.getByText(reviewLabel)).toBeTruthy();
    expect(screen.getByText(/附件狀態不代表已核准服務資格/u)).toBeTruthy();
    expect(screen.queryByText("已由獨立人員核驗")).toBeNull();
    if (scanStatus === "reserved") expect(screen.getByText(/尚未確認原檔已保存或檢查完成/u)).toBeTruthy();
    expectReadOnly(container);
  });
  it.each([["verified", "已由獨立人員核驗"], ["rejected", "人工核驗不通過"]] as const)("renders existing %s review honestly, with no new approval/download", async (decision, label) => {
    mocks.load.mockResolvedValue(selectedResult(history([{ ...document(), review: review(decision), canDownload: decision === "verified" }])));
    const { container } = await show(); expect(screen.getByText(label)).toBeTruthy(); expect(screen.getByText(/核驗時間/u)).toBeTruthy();
    expect(screen.getByText(/不提供上傳、核驗或下載/u)).toBeTruthy(); expectReadOnly(container);
  });
  it("marks selected voided source and missing expiry without inventing current eligibility", async () => {
    const selected = { ...row(), recordStatus: "voided" as const, expiresOn: null, canUpload: false };
    mocks.load.mockResolvedValue({ sources: sources([selected]), selected, documents: history() });
    const { container } = await show(); expect(screen.getByText("第 1 版 · 已作廢")).toBeTruthy();
    expect(screen.getByText("未填，請洽主管確認")).toBeTruthy(); expect(screen.getByRole("option", { name: /已作廢/u })).toBeTruthy(); expectReadOnly(container);
  });
  it("shows real total/truncation and original version, never an invented full history", async () => {
    const records = Array.from({ length: 50 }, (_, n) => ({ ...document(), documentId: id(400 + n), review: null, canDownload: true }));
    mocks.load.mockResolvedValue(selectedResult(history(records, { total: 51, truncated: true })));
    const { container } = await show(); expect(screen.getByText("附件共 51 份，僅顯示最近 50 份，不代表完整歷程。")).toBeTruthy();
    expect(container.querySelectorAll("li")).toHaveLength(50); expectReadOnly(container);
  });
  it("distinguishes empty exact-version attachment history from missing source selection", async () => {
    mocks.load.mockResolvedValue(selectedResult(history([]))); await show();
    expect(screen.getByText("這個版本尚無附件紀錄。")).toBeTruthy(); expect(screen.queryByText("先選擇一份證照")).toBeNull();
  });
  it("renders Taipei times without exposing hashes, uploader IDs or qualitative review reasons", async () => {
    mocks.load.mockResolvedValue(selectedResult(history([{ ...document(), review: review(), canDownload: true }])));
    const { container } = await show();
    expect(container.textContent).toMatch(/2026\/09\/27\s14:00/u); expect(container.textContent).toMatch(/2026\/09\/27\s12:00/u);
    for (const privateValue of [document().sha256, document().recordContentHash, document().uploadedBy, review().reason, review().reviewedBy]) expect(container.textContent).not.toContain(privateValue);
    expect(container.querySelector('time[datetime="2026-09-27T04:00:00.123456Z"]')).toBeTruthy(); expectReadOnly(container);
  });
  it.each([[400, "請重新選擇證照"], [403, "目前無法查看這份資料"], [503, "員工證照資料暫時無法載入"]] as const)("gives %s safe recovery without provider/source leakage", async (status, heading) => {
    mocks.load.mockRejectedValue(new IntegrationError("SYNTHETIC_PRIVATE_CODE", "SYNTHETIC_PRIVATE_PROVIDER_SECRET", status));
    const { container } = await show(context, { version: row().recordVersionId });
    expect(screen.getByRole("alert")).toBeTruthy(); expect(screen.getByRole("heading", { name: heading })).toBeTruthy();
    expect(screen.getByRole("link", { name: "清除篩選並重試" }).getAttribute("href")).toBe(`${baseRoute}?view=documents`);
    expect(container.textContent).not.toContain("SYNTHETIC_PRIVATE"); expect(container.textContent).not.toContain("合成員工");
    expect(screen.queryByRole("combobox")).toBeNull(); expectReadOnly(container);
  });
  it("treats unknown failure as unavailable, not empty successful records", async () => {
    mocks.load.mockRejectedValue(new Error("SYNTHETIC_PRIVATE_PROVIDER_SECRET")); const { container } = await show();
    expect(screen.getByRole("heading", { name: "員工證照資料暫時無法載入" })).toBeTruthy();
    expect(screen.queryByText(/目前沒有可見的證照/u)).toBeNull(); expect(container.textContent).not.toContain("SYNTHETIC_PRIVATE"); expectReadOnly(container);
  });
});
