// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { TenantContext } from "@/lib/domain/types";
import type { ReminderSnapshot } from "@/lib/care-reminders/contracts";
import { loadCareReminders } from "@/lib/care-reminders/server";
import { CareReminderCard } from "./care-reminder-card";

vi.mock("@/lib/care-reminders/server", () => ({ loadCareReminders: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

const clientId = "fa000000-0000-4000-8000-000000000001";
const context: TenantContext = {
  organizationId: "fa000000-0000-4000-8000-000000000002",
  organizationName: "合成機構",
  branchId: "fa000000-0000-4000-8000-000000000003",
  branchName: "合成分支",
  userId: "fa000000-0000-4000-8000-000000000004",
  displayName: "合成照服員",
  roles: ["care_worker"],
  scopes: ["clients.read", "health.read", "care_records.read"],
  assuranceLevel: "aal1",
  recentAal2At: null,
  demo: false,
};
const emptySnapshot: ReminderSnapshot = {
  client_id: clientId,
  client_version: 1,
  reviewer: false,
  generated_at: "2026-09-12T00:00:00Z",
  formally_imported: false,
  sources: [],
  reminders: [],
};

async function renderCard(snapshot: ReminderSnapshot | null, actor = context) {
  if (snapshot) vi.mocked(loadCareReminders).mockResolvedValue(snapshot);
  else vi.mocked(loadCareReminders).mockRejectedValue(new Error("synthetic read failure"));
  return render(await CareReminderCard({ context: actor, clientId }));
}

afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe("care reminder card empty state", () => {
  it("keeps the risk warning and source time in one compact staff state", async () => {
    await renderCard(emptySnapshot);
    expect(screen.getByRole("heading", { name: "個案照顧提醒" })).toBeVisible();
    expect(screen.getByRole("status")).toHaveTextContent("沒有已核對提醒，不等於沒有風險");
    expect(screen.getByRole("status")).toHaveTextContent("請核對照顧計畫");
    expect(screen.getByText(/提醒更新：2026\/09\/12 08:00:00（臺北時間）/u)).toBeVisible();
    expect(screen.getByRole("button", { name: "重新載入提醒" })).toBeVisible();
    expect(screen.queryByRole("link", { name: "查詢核定照顧計畫" })).not.toBeInTheDocument();
    expect(screen.queryByText("管理核對：從中央暫存來源建立提醒")).not.toBeInTheDocument();
  });

  it("offers an exact-client plan link only to an actor who can read it", async () => {
    await renderCard(emptySnapshot, { ...context, assuranceLevel: "aal2", scopes: [...context.scopes, "care_plans.read"] });
    expect(screen.getByRole("link", { name: "查詢核定照顧計畫" })).toHaveAttribute("href", `/app/staff/service-management/approved-care-plans?client=${clientId}`);
  });

  it("keeps demo data visibly separate from real care guidance", async () => {
    await renderCard(emptySnapshot, { ...context, demo: true });
    expect(screen.getByText(/展示資料，非真實個案提醒/u)).toBeVisible();
    expect(screen.queryByRole("button", { name: "重新載入提醒" })).not.toBeInTheDocument();
  });

  it("retains all reviewer source and confirmation controls when there are no reminders", async () => {
    await renderCard({ ...emptySnapshot, reviewer: true });
    expect(screen.getByText("管理核對：從中央暫存來源建立提醒")).toBeInTheDocument();
    expect(screen.getByLabelText(/核對理由/u)).toBeInTheDocument();
  });

  it("keeps confirmed high-risk reminders and their source warning in the original panel", async () => {
    await renderCard({ ...emptySnapshot, reminders: [{
      id: clientId, batch_id: clientId, client_id: clientId,
      rule_id: "cms.explicit_transfer_assistance", rule_version: "cms-explicit-attention@1",
      title: "移位協助需確認", text: "請依現行照顧計畫確認協助方式。",
      status: "confirmed", source_changed: true, source_kind: "trusted_staging",
      imported_at: "2026-09-12T00:00:00Z", reviewed_at: "2026-09-12T01:00:00Z", reviewed_by: clientId,
      source: { fieldId: "field_synthetic", sectionCode: "ASSESSMENT_E", label: "移位", parentPath: "ASSESSMENT_E/table", targetPath: "central.assessment_e.synthetic", mappingKey: "synthetic", sourceValue: "需要協助" },
    }] });
    expect(screen.getByText("移位協助需確認")).toBeVisible();
    expect(screen.getByText(/已有新版中央來源/u)).toBeVisible();
    expect(screen.getByText(/核對時間：2026\/09\/12 09:00:00/u)).toBeVisible();
  });

  it("does not show an empty result when reminder data is unavailable or restricted", async () => {
    await renderCard(null);
    expect(screen.getByRole("status")).toHaveTextContent("無法取得提醒或您尚無查閱權限");
    expect(screen.queryByText(/沒有已核對提醒/u)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "重新載入提醒" })).toBeVisible();
  });
});
