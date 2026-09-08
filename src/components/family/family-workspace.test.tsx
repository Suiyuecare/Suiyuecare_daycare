// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { getPageBySlug } from "@/lib/catalog";
import type { FamilyPortalSnapshot } from "@/lib/family/snapshot";

import { FamilyWorkspace } from "./family-workspace";

const clientId = "84000000-0000-4000-8000-000000000001";
const readySnapshot: FamilyPortalSnapshot = {
  state: "ready",
  authorizedClients: [{ clientId, clientName: "合成個案" }],
  clientId,
  clientName: "合成個案",
  attendance: null,
  latestMeasurement: null,
  todayCompletedServices: null,
  latestCareSummary: null,
  updatedAt: null,
  publicationStatus: "not_configured",
};

const unconfiguredPages = [
  ["family/communication", "訊息"],
  ["family/care-summary", "健康與照顧摘要"],
  ["family/schedule", "行程、活動與交通"],
  ["family/billing-documents", "帳務與核准文件"],
  ["family/notifications-settings", "通知與設定"],
] as const;

afterEach(cleanup);

describe("FamilyWorkspace authorization truthfulness", () => {
  it("does not claim a valid authorization when no governed client grant exists", () => {
    const page = getPageBySlug("family/billing-documents")!;
    render(<FamilyWorkspace demo={false} page={page} snapshot={null} />);

    expect(screen.getByRole("heading", { name: "目前沒有可顯示的授權個案" })).toBeTruthy();
    expect(screen.queryByText("有效")).toBeNull();
  });

  it.each(unconfiguredPages)(
    "%s identifies its page-specific data category as unconfigured",
    (slug, categoryLabel) => {
      const page = getPageBySlug(slug)!;
      render(<FamilyWorkspace demo={false} page={page} snapshot={readySnapshot} />);

      expect(screen.getByRole("heading", { name: `資料類別授權：${categoryLabel}` })).toBeTruthy();
      expect(screen.getByText("未配置")).toBeTruthy();
      expect(screen.getByText(`${categoryLabel}的授權與機構發布流程尚未配置；目前僅確認個案識別授權。`)).toBeTruthy();
      expect(screen.queryByText("有效")).toBeNull();
      expect(screen.queryByText(/2026/u)).toBeNull();
    },
  );

  it("keeps multiple authorized clients separate until one is selected", () => {
    const page = getPageBySlug("family/communication")!;
    render(<FamilyWorkspace demo={false} page={page} snapshot={{
      state: "selection_required",
      authorizedClients: [
        { clientId, clientName: "合成個案甲" },
        { clientId: "84000000-0000-4000-8000-000000000002", clientName: "合成個案乙" },
      ],
    }} />);

    expect(screen.getByRole("heading", { name: "請選擇要查看的個案" })).toBeTruthy();
    expect(screen.getAllByRole("link")).toHaveLength(2);
    expect(screen.queryByText("未配置")).toBeNull();
  });
});
