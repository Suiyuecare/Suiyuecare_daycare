// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TenantContext } from "@/lib/domain/types";

const mocks = vi.hoisted(() => ({ tenant: vi.fn(), legacyLoad: vi.fn(), legacyView: vi.fn(), documentView: vi.fn(),
  recent: vi.fn(), SnapshotError: class StaffCertificateSnapshotError extends Error {} }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth/context", () => ({ requireTenantContext: mocks.tenant, hasRecentAal2: mocks.recent }));
vi.mock("@/lib/staff-certificates/snapshot", () => ({ loadStaffCertificateSnapshot: mocks.legacyLoad,
  StaffCertificateSnapshotError: mocks.SnapshotError }));
vi.mock("@/components/staff-certificates/staff-certificates-workspace", () => ({
  StaffCertificatesWorkspace: (props: unknown) => { mocks.legacyView(props); return <p>原證照管理入口</p>; },
}));
vi.mock("@/components/staff-certificates/staff-certificate-documents-workspace", () => ({
  StaffCertificateDocumentsWorkspace: (props: unknown) => { mocks.documentView(props); return <p>授權附件查閱入口</p>; },
}));
import StaffCatalogPage from "./page";

const actor: TenantContext = { organizationId: "72000000-0000-4000-8000-000000000001",
  branchId: "72000000-0000-4000-8000-000000000002", userId: "72000000-0000-4000-8000-000000000003",
  organizationName: "合成機構", branchName: "合成分支", displayName: "合成員工", roles: ["nurse"],
  scopes: ["staff_certificates.read"], assuranceLevel: "aal2", recentAal2At: null, demo: false };
const page = (query: Record<string, string | string[] | undefined> = {}) => StaffCatalogPage({
  params: Promise.resolve({ slug: ["staff", "operations", "staff-certificates"] }), searchParams: Promise.resolve(query),
});
afterEach(cleanup);
beforeEach(() => { vi.clearAllMocks(); mocks.tenant.mockResolvedValue(actor); mocks.recent.mockResolvedValue(false);
  mocks.legacyLoad.mockResolvedValue({ demo: false, source: "legacy" }); });

describe("page72 independent document read dispatch (not Next RSC/browser proof)", () => {
  it("keeps the existing authenticated guard", async () => {
    mocks.tenant.mockRejectedValue(new Error("LOGIN_REDIRECT"));
    await expect(page({ view: "documents" })).rejects.toThrow("LOGIN_REDIRECT");
    expect(mocks.legacyLoad).not.toHaveBeenCalled(); expect(mocks.documentView).not.toHaveBeenCalled();
  });
  it("rejects missing read before either workspace or RPC", async () => {
    mocks.tenant.mockResolvedValue({ ...actor, scopes: [] }); render(await page({ view: "documents" }));
    expect(screen.getByRole("heading", { name: "這個功能不在您的資料範圍內" })).toBeTruthy();
    expect(mocks.legacyLoad).not.toHaveBeenCalled(); expect(mocks.documentView).not.toHaveBeenCalled();
  });
  it("explicit documents bypasses legacy read and old writer entirely", async () => {
    const query = { view: "documents", page: "2" }; render(await page(query));
    expect(screen.getByText("授權附件查閱入口")).toBeTruthy();
    expect(mocks.documentView.mock.calls[0][0]).toMatchObject({ context: actor, query, page: { number: 72 } });
    expect(mocks.legacyLoad).not.toHaveBeenCalled(); expect(mocks.legacyView).not.toHaveBeenCalled();
    expect(mocks.recent).not.toHaveBeenCalled();
  });
  it("preserves successful legacy projection and its independent permissions", async () => {
    render(await page()); expect(screen.getByText("原證照管理入口")).toBeTruthy();
    expect(mocks.legacyView.mock.calls[0][0]).toMatchObject({ canManage: false, canExceptions: false, loadError: false });
    expect(mocks.documentView).not.toHaveBeenCalled();
  });
  it("a denied legacy source does not block the independent authorized document source", async () => {
    mocks.legacyLoad.mockRejectedValue(new mocks.SnapshotError()); render(await page());
    expect(screen.getByText("授權附件查閱入口")).toBeTruthy();
    expect(mocks.documentView.mock.calls[0][0]).toMatchObject({ context: actor, query: {} });
    expect(mocks.legacyView).not.toHaveBeenCalled();
  });
  it("does not reinterpret legacy filters as new filters on fallback", async () => {
    const query = { q: "合成字串", status: "active" }; mocks.legacyLoad.mockRejectedValue(new mocks.SnapshotError());
    render(await page(query)); expect(mocks.documentView.mock.calls[0][0]).toMatchObject({ query });
    expect(mocks.legacyView).not.toHaveBeenCalled(); // The real document helper rejects these exact unknown fields.
  });
  it("preserves demo legacy behavior without fetching real document sources", async () => {
    mocks.tenant.mockResolvedValue({ ...actor, demo: true }); mocks.legacyLoad.mockRejectedValue(new mocks.SnapshotError());
    render(await page()); expect(mocks.legacyView.mock.calls[0][0]).toMatchObject({ loadError: true, snapshot: null });
    expect(mocks.documentView).not.toHaveBeenCalled();
  });
  it("does not hide unexpected programmer errors as data-permission fallback", async () => {
    mocks.legacyLoad.mockRejectedValue(new Error("SYNTHETIC_BUG")); await expect(page()).rejects.toThrow("SYNTHETIC_BUG");
    expect(mocks.documentView).not.toHaveBeenCalled();
  });
  it.each(["wrong", "", ["documents", "documents"]])("passes invalid view unchanged to the strict new query boundary %j", async view => {
    const query = { view }; render(await page(query)); expect(mocks.documentView.mock.calls[0][0]).toMatchObject({ query });
    expect(mocks.legacyLoad).not.toHaveBeenCalled();
  });
});
