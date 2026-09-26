// Loopback-only UI fixture. In-memory synthetic responses are NOT Auth/RLS,
// production writes, notification delivery, or actual DB replay evidence.
import { createRoot } from "react-dom/client";
import { useEffect, useState } from "react";
import { AppShell } from "@/components/app/app-shell";
import { StaffAnnouncementsWorkspace } from "@/components/staff-announcements/staff-announcements-workspace";
import { buildDemoStaffAnnouncementSnapshot } from "@/lib/staff-announcements/demo";
import type { StaffAnnouncementItem, StaffAnnouncementMutationResult, StaffAnnouncementSnapshot } from "@/lib/staff-announcements/types";
import type { TenantContext } from "@/lib/domain/types";
import { staffPages } from "@/lib/catalog";

const uuid = (n: number) => `68000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const actor: TenantContext = { organizationId: uuid(1), branchId: uuid(2), userId: uuid(3),
  organizationName: "合成測試機構（非正式）", branchName: "合成測試分支", displayName: "合成管理員",
  roles: ["branch_director"], scopes: ["announcements.read", "announcements.manage", "announcements.publish"],
  assuranceLevel: "aal2", recentAal2At: new Date().toISOString(), demo: false };
const base = buildDemoStaffAnnouncementSnapshot({ organizationId: actor.organizationId, branchId: actor.branchId, selectedReleaseId: null });
const now = Date.now();
const initial: StaffAnnouncementSnapshot = { ...base, demo: false, generatedAt: new Date(now - 1_000).toISOString(), staleAfter: new Date(now + 300_000).toISOString(),
  items: [base.items[0]], availableTotal: 1, itemsTruncated: false,
  pagination: { page: 1, pageSize: 20, matchingTotal: 1, totalPages: 1, rangeStart: 1, rangeEnd: 1 } };
type State = { mode: "success" | "unknown" | "invalid" | "wrong-chain" | "denied" | "deferred";
  writes: { action: string; key: string; body: string }[]; refreshes: number; resolve: (() => void) | null;
  remount: () => void; foreign: (value: boolean) => void; allowed: (value: boolean) => void; fresh: () => void;
  offpage: () => void; last: StaffAnnouncementMutationResult | null; branchRequests: string[] };
const state: State = { mode: "success", writes: [], refreshes: 0, resolve: null, remount: () => {}, foreign: () => {}, allowed: () => {},
  fresh: () => {}, offpage: () => {}, last: null, branchRequests: [] };
(window as unknown as Window & { fixture: State }).fixture = state;
const receipts = new Map<string, StaffAnnouncementMutationResult>();
window.fetch = async (input, init) => {
  const url = new URL(String(input), location.href);
  if (url.origin !== location.origin) throw new Error("External fixture requests are blocked");
  if (url.pathname === "/api/context/branch") {
    state.branchRequests.push(init?.method ?? "GET");
    if (init?.method === "DELETE") return Response.json({ status: "ok", data: { cleared: true } });
    return Response.json({ requestId: uuid(91), status: "ok", errors: [], data: { currentBranchId: actor.branchId,
      branches: [{ id: actor.branchId, name: actor.branchName }] } });
  }
  if (url.pathname !== "/api/staff-announcements" || init?.method !== "POST") throw new Error("Only synthetic announcement operations are allowed");
  const headers = new Headers(init.headers); const key = headers.get("idempotency-key") ?? "";
  const action = headers.get("x-announcement-action") ?? ""; const body = String(init.body);
  state.writes.push({ action, key, body }); const mode = state.mode;
  if (mode === "deferred") await new Promise<void>((resolve) => { state.resolve = resolve; });
  if (mode === "denied") return Response.json({ requestId: uuid(90), status: "error", data: null,
    errors: [{ code: "STAFF_ANNOUNCEMENT_NOT_AUTHORIZED", message: "Synthetic rejection" }] }, { status: 403 });
  const request = JSON.parse(body); const replayed = receipts.has(key); const item = initial.items[0];
  const common = { persisted: true as const, demo: false as const, replayed, announcementKey: request.previous_version_id === null ? uuid(200 + receipts.size) : item.announcementKey };
  const prior = receipts.get(key);
  const result: StaffAnnouncementMutationResult = prior ? { ...prior, replayed: true } : action === "draft"
    ? { ...common, action: "draft", versionId: uuid(300 + receipts.size), version: request.previous_version_id ? item.version + 1 : 1,
      previousVersionId: request.previous_version_id, versionState: "draft", publishAt: request.publish_at, expiresAt: request.expires_at }
    : action === "publish" ? { ...common, announcementKey: item.announcementKey, action: "publish", versionId: uuid(300 + receipts.size),
      version: item.version + 1, draftVersionId: request.draft_version_id, lifecycle: "published", publishAt: new Date(item.publishAt).toISOString(), expiresAt: item.expiresAt, recipientCount: 3 }
    : action === "withdraw" ? { ...common, announcementKey: item.announcementKey, action: "withdraw", versionId: uuid(300 + receipts.size),
      version: item.version + 1, previousVersionId: request.expected_latest_version_id, lifecycle: "withdrawn", releaseVersionId: request.release_version_id,
      reason: request.reason, withdrawnAt: new Date().toISOString() }
    : { ...common, announcementKey: item.announcementKey, action: "read", releaseVersionId: request.release_version_id, readAt: new Date().toISOString() };
  receipts.set(key, result); state.last = result;
  if (mode === "unknown") throw new Error("Synthetic lost acknowledgement");
  if (mode === "invalid") return Response.json({});
  return Response.json({ requestId: uuid(90), status: "ok", data: mode === "wrong-chain" ? { ...result, announcementKey: uuid(999) } : result, errors: [] }, { status: replayed ? 200 : 201 });
};
function updatedItem(result: StaffAnnouncementMutationResult): StaffAnnouncementItem {
  const original = initial.items[0];
  if (result.action === "read") return { ...original, actorReadAt: result.readAt };
  return { ...original, announcementKey: result.announcementKey, versionId: result.versionId, version: result.version,
    versionState: result.action === "draft" ? "draft" : result.action === "publish" ? "release" : "withdrawal",
    lifecycle: result.action === "draft" ? "draft" : result.lifecycle,
    title: "合成已保存公告", body: "僅供本機驗證，不是真實保存。",
    activeReleaseVersionId: result.action === "publish" ? result.versionId : original.activeReleaseVersionId };
}
function Fixture() {
  const [epoch, setEpoch] = useState(0); const [foreign, setForeign] = useState(false); const [allowed, setAllowed] = useState(true);
  const [snapshot, setSnapshot] = useState(initial);
  useEffect(() => {
    state.remount = () => setEpoch((value) => value + 1); state.foreign = setForeign; state.allowed = setAllowed;
    state.offpage = () => setSnapshot((old) => ({ ...old, items: [], generatedAt: new Date().toISOString() }));
    state.fresh = () => {
      if (!state.last) return;
      const generated = Date.now();
      setSnapshot({ ...initial, generatedAt: new Date(generated).toISOString(), staleAfter: new Date(generated + 300_000).toISOString(), items: [updatedItem(state.last)] });
    };
  }, []);
  const context = { ...actor, branchId: foreign ? uuid(999) : actor.branchId, scopes: allowed ? actor.scopes : [], assuranceLevel: allowed ? "aal2" as const : "aal1" as const };
  const visible = foreign ? { ...snapshot, branchId: uuid(999), items: [], canManage: false, audienceStaff: [], audienceRoles: [] } : { ...snapshot, canManage: allowed };
  return <AppShell context={context} navigation={[]}>
    <aside className="callout">本機合成操作；不連雲端，不證明正式登入、資料庫保存或通知送達。</aside>
    <StaffAnnouncementsWorkspace key={epoch} context={context} page={staffPages.find((page) => page.number === 68)!}
      snapshot={visible} filters={visible.filters} canPublish={allowed} hasRecentAal2={allowed} canRead={allowed} />
  </AppShell>;
}
createRoot(document.getElementById("fixture-root")!).render(<Fixture />);
