import { useState } from "react";
import { createRoot } from "react-dom/client";
import { FamilyLiveWorkspace } from "@/components/family/family-live-workspace";
import { StaffFamilyCommunication } from "@/components/family/staff-family-communication";
import { ClinicalAttachments } from "@/components/clinical-attachments/clinical-attachments";
import { TodayWorkList } from "@/components/workspace/today-work-list";
import { buildDemoDailySnapshot } from "@/lib/core-care/demo";
import { buildTodayWorkRows } from "@/lib/core-care/today-work";
import type { FamilyWorkspaceSnapshot } from "@/lib/family/workspace-schema";
import { clearOfflineDrafts, loadOfflineDrafts } from "@/lib/offline/draft-store";
import "@/app/globals.css";

const clientId = "84000000-0000-4000-8000-000000000001";
const sourceId = "84000000-0000-4000-8000-000000000002";
const recipientId = "84000000-0000-4000-8000-000000000003";
const stamp = "2026-10-11T01:00:00Z";
const source = { clientId, sourceId, sourceVersion: 1, sourceKind: "care_diary" as const };
const titles: Record<number, string> = { 85: "家屬溝通", 86: "健康與照顧摘要", 87: "行程／活動／交通", 88: "帳單與文件", 89: "通知與設定" };
const snapshot: FamilyWorkspaceSnapshot = {
  clientId, messageVersion: 1, scopes: ["care.read", "health.summary", "schedule.read", "billing.read", "documents.read", "messages.read"],
  messages: [{ id: sourceId, body: "合成資料：今天參與音樂活動。", direction: "institution_to_family", at: stamp, read: false }],
  publications: ["care", "health", "schedule", "billing", "document"].map((category, index) => ({
    id: `84000000-0000-4000-8000-00000000001${index}`, category: category as FamilyWorkspaceSnapshot["publications"][number]["category"],
    title: ["今日照顧摘要", "健康量測摘要", "合成行程與接送", "合成十月帳單", "合成核准文件"][index],
    summary: "這是本機合成資料，不是個案紀錄。", occurredAt: stamp, publishedAt: stamp, sourceId,
    bill: category === "billing" ? { total: 8000, currency: "TWD", periodFrom: "2026-10-01", periodTo: "2026-10-31", balance: 2000, lines: [{ name: "合成日照費用", quantity: 20, amount: 8000 }], receipts: [{ number: "SYNTH-R001", amount: 6000, at: stamp }] } : null,
  })),
  preferences: { version: 0, pushEnabled: true, categories: ["messages"], quietStart: "21:00", quietEnd: "07:00", contactPhone: null }, unreadCount: 1, updatedAt: stamp,
};
const namespace = { organizationId: "84000000-0000-4000-8000-000000000004", branchId: "84000000-0000-4000-8000-000000000005", userId: recipientId };
const activeSnapshot = new URLSearchParams(location.search).get("view") === "offline" ? { ...snapshot, actorScope: namespace } : snapshot;
type FixtureWindow = Window & { completionScenario?: string; completionRequests?: { url: string; method: string; body: string | null }[]; completionOffline?: { clear: typeof clearOfflineDrafts; load: () => ReturnType<typeof loadOfflineDrafts> } };
const fixture = window as FixtureWindow;
fixture.completionScenario = "success";
fixture.completionRequests = [];
fixture.completionOffline = { clear: clearOfflineDrafts, load: () => loadOfflineDrafts(namespace) };
let attempts = 0;
window.fetch = async (input, init = {}) => {
  const url = new URL(String(input), location.origin);
  if (url.origin !== location.origin || !url.pathname.startsWith("/api/")) throw new Error("Fixture blocks external requests");
  const method = init.method ?? "GET";
  fixture.completionRequests!.push({ url: url.pathname + url.search, method, body: typeof init.body === "string" ? init.body : null });
  if (fixture.completionScenario === "revoked") return Response.json({ error: { code: "FORBIDDEN" } }, { status: 403 });
  if (method === "POST" && fixture.completionScenario === "retry-once" && attempts++ === 0) throw new Error("Synthetic interrupted response");
  if (url.pathname === "/api/clinical-attachments") {
    if (method === "POST") return Response.json({ data: { receipt: { id: recipientId, cancelled: true } } });
    return Response.json({ data: { snapshot: { ...source, clientId: url.searchParams.get("client") ?? clientId, sourceId: url.searchParams.get("source") ?? sourceId, sourceKind: url.searchParams.get("kind") ?? source.sourceKind, canUpload: true, rows: [{ id: recipientId, label: "合成待檢照片", mimeType: "image/png", fileSizeBytes: 64, scanStatus: "reserved", createdAt: stamp, canDownload: false }] }, uploadConfigured: false } });
  }
  if (url.pathname === "/api/family-communication") {
    if (method === "POST") return Response.json({ data: { receipt: { id: sourceId, replayed: attempts > 0, status: "saved" } } });
    return Response.json({ data: { snapshot: { clientId, recipientId: url.searchParams.get("recipient"), recipients: [{ id: recipientId, name: "合成授權家屬" }], messages: [], publications: [], sources: [], canPublish: false, updatedAt: stamp } } });
  }
  if (url.pathname === "/api/family-schedule") {
    const month = url.searchParams.get("month")!;
    return Response.json({ data: { snapshot: { clientId, month, items: [{ id: sourceId, kind: "transport", version: 1, date: `${month}-11`, startsAt: `${month}-11T09:00:00+08:00`, endsAt: `${month}-11T10:00:00+08:00`, direction: "pickup", title: "合成到站接送", status: "boarded", sourceHash: "a".repeat(64) }], snapshotHash: "b".repeat(64), updatedAt: stamp } } });
  }
  if (url.pathname === "/api/family-portal") {
    if (method === "GET") return Response.json({ data: { snapshot: activeSnapshot } });
    const sent = JSON.parse(String(init.body));
    if (sent.action === "read") return Response.json({ data: { confirmed: true } });
    if (sent.action === "download") return Response.json({ error: { code: "SYNTHETIC_DOWNLOAD_DISABLED" } }, { status: 503 });
    return Response.json({ data: { receipt: { id: sourceId, replayed: attempts > 0, ...(sent.action === "message" ? { status: "saved" } : {}) } } });
  }
  throw new Error("Fixture does not implement this API");
};

function Harness() {
  const query = new URLSearchParams(location.search);
  const view = query.get("view") ?? "85";
  const [scenario, setScenario] = useState("success");
  const daily = buildDemoDailySnapshot("2026-10-11");
  return <main id="main-content" style={{ maxWidth: 1280, padding: 16, margin: "auto", minWidth: 0 }}>
    <div className="callout" role="note">本機合成元件驗收：不登入、不連正式 API；僅本機合成訊息草稿可保存，不是正式端到端驗收。</div>
    <label htmlFor="fixture-scenario">合成回應情境<select id="fixture-scenario" value={scenario} onChange={event => { const next = event.target.value; fixture.completionScenario = next; attempts = 0; fixture.completionRequests = []; setScenario(next); }}><option value="success">一般回應</option><option value="retry-once">第一次中斷</option><option value="revoked">授權撤回</option></select></label>
    {view === "caregiver" ? <><h1>今日照顧（合成元件）</h1><TodayWorkList rows={buildTodayWorkRows(daily)} serviceDate={daily.serviceDate} access={daily.sourceAccess} caregiverMode canViewMedication caregiverWrites={{ vitals: true, diary: true, attendance: true, medication: true }} resumeScopeKey="fixture:synthetic" /></>
      : view === "attachments" ? <><h1>照片與附件（合成元件）</h1><ClinicalAttachments source={source} canManage /></>
      : view === "43" ? <><h1>溝通紀錄（合成元件）</h1><StaffFamilyCommunication clients={[{ id: clientId, name: "合成個案甲", code: "SYNTH-001" }]} initialClientId={clientId} /></>
      : <FamilyLiveWorkspace initial={activeSnapshot} pageNumber={view === "offline" ? 85 : Number(view)} title={titles[view === "offline" ? 85 : Number(view)] ?? "家屬頁面"} />}
  </main>;
}
createRoot(document.getElementById("fixture-root")!).render(<Harness />);
