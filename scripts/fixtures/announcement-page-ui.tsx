// Fixed loopback-only data. Does not prove real authorization, DB paging or writes.
import { createRoot } from "react-dom/client";
import { AppShell } from "@/components/app/app-shell";
import { StaffAnnouncementsWorkspace } from "@/components/staff-announcements/staff-announcements-workspace";
import { buildDemoStaffAnnouncementSnapshot } from "@/lib/staff-announcements/demo";
import { parseStaffAnnouncementPageQuery } from "@/lib/staff-announcements/query";
import type { StaffAnnouncementItem, StaffAnnouncementSnapshot } from "@/lib/staff-announcements/types";
import type { PageCatalogEntry } from "@/lib/catalog";
import type { TenantContext } from "@/lib/domain/types";

const uuid = (number: number) => `68000000-0000-4000-8000-${String(number).padStart(12, "0")}`;
const context: TenantContext = { organizationId: uuid(1), branchId: uuid(2), userId: uuid(3), organizationName: "合成測試機構", branchName: "合成分支", displayName: "合成公告管理員", roles: ["branch_director"], scopes: [], assuranceLevel: "aal2", recentAal2At: null, demo: true };
const base = buildDemoStaffAnnouncementSnapshot({ organizationId: context.organizationId, branchId: context.branchId, selectedReleaseId: "68111111-1111-4111-8111-111111111112" });
const published = base.items.find((item) => item.activeReleaseVersionId === "68111111-1111-4111-8111-111111111112")!;
const all: StaffAnnouncementItem[] = Array.from({ length: 250 }, (_, index) => {
  const title = `合成公告 ${String(index + 1).padStart(3, "0")}`;
  return { ...published, announcementKey: uuid(10_000 + index), versionId: uuid(20_000 + index), activeReleaseVersionId: uuid(20_000 + index), title, body: "僅供本機分頁測試，不是真實員工公告。", activeReleaseTitle: title, activeReleaseBody: "僅供本機分頁測試，不是真實員工公告。", publishAt: published.activeReleasePublishAt!, expiresAt: published.activeReleaseExpiresAt, version: 2, versionState: "release", hasPendingDraft: false };
});
const params = new URLSearchParams(location.search);
const before = params.get("before") === "1";
const invalid = params.get("fixture") === "invalid";
const unavailable = params.get("fixture") === "error";
let filters = { query: "", status: "all" as const, page: 1, pageSize: 20 as const } as StaffAnnouncementSnapshot["filters"];
let release: string | null = null;
try { ({ filters, selectedReleaseId: release } = parseStaffAnnouncementPageQuery(Object.fromEntries([...params].filter(([key]) => ["q", "status", "page", "pageSize", "release"].includes(key))))); } catch { /* explicit invalid fixture remains separate */ }
const matches = all.filter((item) => (filters.status === "all" || item.lifecycle === filters.status) && [item.title, item.body].join(" ").toLowerCase().includes(filters.query.toLowerCase()));
const pages = Math.max(1, Math.ceil(matches.length / filters.pageSize));
const pageNumber = Math.min(filters.page, pages);
const selected = all.find((item) => item.activeReleaseVersionId === release) ?? null;
const shown = before ? all.slice(0, 100).filter((item) => (filters.status === "all" || item.lifecycle === filters.status) && [item.title, item.body].join(" ").toLowerCase().includes(filters.query.toLowerCase())) : matches.slice((pageNumber - 1) * filters.pageSize, pageNumber * filters.pageSize);
const snapshot: StaffAnnouncementSnapshot = { ...base, filters: { ...filters, page: pageNumber }, items: shown, availableTotal: 250, itemsTruncated: shown.length < 250,
  pagination: { page: pageNumber, pageSize: filters.pageSize, matchingTotal: matches.length, totalPages: pages, rangeStart: matches.length ? (pageNumber - 1) * filters.pageSize + 1 : 0, rangeEnd: matches.length ? Math.min(pageNumber * filters.pageSize, matches.length) : 0 },
  metrics: { drafts: 0, scheduled: 0, published: 250, expired: 0, withdrawn: 0, unreadRecipients: 500 }, selectedReleaseId: selected?.activeReleaseVersionId ?? null, selectedAnnouncement: selected, selectedRecipients: selected ? base.selectedRecipients : [] };
(window as unknown as Window & { fixture: { writes: string[]; refreshes: number } }).fixture = { writes: [], refreshes: 0 };
window.fetch = async () => { throw new Error("This synthetic announcement fixture never calls a network API"); };
createRoot(document.getElementById("fixture-root")!).render(<AppShell context={context} navigation={[]}>
  <aside className="callout">本機合成公告：250 則固定資料；不連雲端，不證明實際權限、資料庫分頁或保存。</aside>
  <StaffAnnouncementsWorkspace context={context} page={{ title: "公告管理", number: 68 } as PageCatalogEntry} snapshot={unavailable || invalid ? null : snapshot}
    filters={filters} canPublish={false} hasRecentAal2={false} canRead={false} invalidFilters={invalid} loadError={unavailable} />
</AppShell>);
