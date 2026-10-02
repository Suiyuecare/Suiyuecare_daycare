// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildDemoStaffAnnouncementSnapshot } from "@/lib/staff-announcements/demo";
import { DEFAULT_STAFF_ANNOUNCEMENT_FILTERS } from "@/lib/staff-announcements/query";
import type { PageCatalogEntry } from "@/lib/catalog";
import type { TenantContext } from "@/lib/domain/types";
import type { StaffAnnouncementSnapshot } from "@/lib/staff-announcements/types";
import { StaffAnnouncementsWorkspace } from "./staff-announcements-workspace";
import { staffAnnouncementHref } from "./query-links";
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("next/link", () => ({ useLinkStatus: () => ({ pending: false }), default: ({ children, prefetch, ...props }: React.ComponentProps<"a"> & { prefetch?: boolean }) => { void prefetch; return <a {...props}>{children}</a>; } }));
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
const release = "68111111-1111-4111-8111-111111111112";
const page = { title: "公告管理", number: 68 } as PageCatalogEntry;
const context: TenantContext = { organizationId: "11111111-1111-4111-8111-111111111111", branchId: "22222222-2222-4222-8222-222222222222", userId: "33333333-3333-4333-8333-333333333333", organizationName: "合成機構", branchName: "合成分支", displayName: "合成員工", roles: ["branch_director"], scopes: [], assuranceLevel: "aal2", recentAal2At: null, demo: true };
function fixture(overrides: Partial<StaffAnnouncementSnapshot> = {}): StaffAnnouncementSnapshot {
  return { ...buildDemoStaffAnnouncementSnapshot({ organizationId: "11111111-1111-4111-8111-111111111111", branchId: "22222222-2222-4222-8222-222222222222", selectedReleaseId: null }), ...overrides };
}
function mount(snapshot: StaffAnnouncementSnapshot | null = fixture(), extras: { loadError?: boolean; invalidFilters?: boolean } = {}) {
  return render(<StaffAnnouncementsWorkspace context={context} page={page} snapshot={snapshot} filters={snapshot?.filters ?? DEFAULT_STAFF_ANNOUNCEMENT_FILTERS} canPublish={false} hasRecentAal2={false} canRead={false} {...extras} />);
}
describe("server-paged announcement workspace", () => {
  it("does not render a snapshot from another branch or mode", () => {
    const source = fixture();
    const first = mount({ ...source, branchId: "99999999-9999-4999-8999-999999999999" });
    expect(screen.getByRole("heading", { name: "公告管理暫時無法載入" })).toBeInTheDocument();
    expect(screen.queryByText(source.items[0].body)).not.toBeInTheDocument();
    first.unmount();
    mount({ ...source, demo: false });
    expect(screen.getByRole("heading", { name: "公告管理暫時無法載入" })).toBeInTheDocument();
    expect(screen.queryByText(source.items[0].title)).not.toBeInTheDocument();
  });
  it("uses server total/range and clamped page, not loaded array length", () => {
    mount(fixture({ pagination: { page: 13, pageSize: 20, totalPages: 13, matchingTotal: 250, rangeStart: 241, rangeEnd: 250 }, filters: { ...DEFAULT_STAFF_ANNOUNCEMENT_FILTERS, page: 13 } }));
    expect(screen.getByText(/顯示 241–250／符合 250 則/u)).toBeInTheDocument();
    const paging = within(screen.getByRole("navigation", { name: "公告分頁" }));
    expect(paging.getByText("第 13／13 頁")).toBeInTheDocument();
    expect(paging.getByRole("button", { name: "下一頁" })).toBeDisabled();
    expect(paging.getByRole("link", { name: "上一頁" })).toHaveAttribute("href", "/app/staff/operations/announcements?page=12&pageSize=20");
    expect(screen.queryByText(/篩選只作用於目前已載入列/u)).not.toBeInTheDocument();
  });
  it("preserves query, status, size and selected detail in page links", () => {
    mount(fixture({ selectedReleaseId: release, selectedAnnouncement: fixture().items[0], filters: { query: "交班&晚班", status: "published", page: 2, pageSize: 50 }, pagination: { page: 2, pageSize: 50, totalPages: 5, matchingTotal: 250, rangeStart: 51, rangeEnd: 100 } }));
    const paging = within(screen.getByRole("navigation", { name: "公告分頁" }));
    const url = new URL(paging.getByRole("link", { name: "下一頁" }).getAttribute("href")!, "https://example.invalid");
    expect(Object.fromEntries(url.searchParams)).toEqual({ q: "交班&晚班", status: "published", page: "3", pageSize: "50", release });
    const close = new URL(screen.getByRole("link", { name: "關閉明細" }).getAttribute("href")!, "https://example.invalid");
    expect(close.searchParams.has("release")).toBe(false); expect(close.searchParams.get("page")).toBe("2");
  });
  it("uses independent selected owner when its row is outside the page", () => {
    const base = fixture(); const owner = base.items.find((item) => item.activeReleaseVersionId === release)!;
    mount(fixture({ selectedReleaseId: release, selectedAnnouncement: owner, items: base.items.filter((item) => item !== owner) }));
    expect(screen.getByRole("heading", { name: "發布版收件與實際已讀明細" })).toBeInTheDocument();
    expect(screen.getByText(/九月家訪交接・發布 v2/u)).toBeInTheDocument();
  });
  it("shows no-match without pretending all branch totals are zero", () => {
    mount(fixture({ items: [], filters: { ...DEFAULT_STAFF_ANNOUNCEMENT_FILTERS, query: "找不到" }, pagination: { page: 1, pageSize: 20, totalPages: 1, matchingTotal: 0, rangeStart: 0, rangeEnd: 0 } }));
    expect(screen.getByRole("heading", { name: "沒有符合條件的公告" })).toBeInTheDocument();
    expect(screen.getByRole("navigation", { name: "公告分頁" })).toHaveTextContent("第 1／1 頁");
    expect(screen.getAllByText("本分支全部授權公告")).toHaveLength(6);
    expect(screen.getByRole("searchbox", { name: "搜尋公告" })).toHaveValue("找不到");
  });
  it("distinguishes invalid filter, unavailable and authorized empty states", () => {
    const first = mount(null, { invalidFilters: true }); expect(screen.getByRole("heading", { name: "公告篩選條件不正確" })).toBeInTheDocument(); first.unmount();
    const second = mount(null, { loadError: true }); expect(screen.getByRole("heading", { name: "公告管理暫時無法載入" })).toBeInTheDocument(); second.unmount();
    mount(fixture({ items: [], availableTotal: 0, pagination: { page: 1, pageSize: 20, totalPages: 1, matchingTotal: 0, rangeStart: 0, rangeEnd: 0 } }));
    expect(screen.getByRole("heading", { name: "目前沒有可查看的公告" })).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
  it("GET apply resets page and drops detail; clear search keeps status and page size", () => {
    const submit = vi.spyOn(HTMLFormElement.prototype, "requestSubmit").mockImplementation(() => {});
    mount(fixture({ filters: { query: "交班", status: "published", page: 5, pageSize: 50 } }));
    const input = screen.getByRole("searchbox"); const form = input.closest("form")!;
    expect(form).toHaveAttribute("method", "get"); expect(form).toHaveAttribute("novalidate");
    fireEvent.click(screen.getByRole("button", { name: "清除搜尋公告" }));
    expect(Object.fromEntries(new FormData(form))).toEqual({ q: "", status: "published", pageSize: "50", page: "1" });
    expect(submit).toHaveBeenCalledOnce(); expect(input).toHaveFocus();
  });
  it("does not submit while composing and has no network on typing", () => {
    mount(); const input = screen.getByRole("searchbox"); const form = input.closest("form")!;
    fireEvent.compositionStart(input); expect(fireEvent.submit(form)).toBe(false);
    fireEvent.compositionEnd(input); expect(fireEvent.submit(form)).toBe(true);
  });
  it("encodes literal query without letting it become a new URL or extra parameter", () => {
    const href = staffAnnouncementHref({ query: "javascript:alert(1)&page=99#fragment", status: "all", page: 1, pageSize: 20 });
    const url = new URL(href, "https://example.invalid"); expect(url.pathname).toBe("/app/staff/operations/announcements");
    expect(url.searchParams.get("page")).toBe("1"); expect(url.searchParams.get("q")).toBe("javascript:alert(1)&page=99#fragment"); expect(url.hash).toBe("");
  });
});
