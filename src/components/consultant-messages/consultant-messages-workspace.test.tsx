// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { getPageBySlug } from "@/lib/catalog";
import { buildDemoConsultantMessageSnapshot } from "@/lib/consultant-messages/demo";
import type { ConsultantMessageFilters } from "@/lib/consultant-messages/types";

import { ConsultantMessagesWorkspace } from "./consultant-messages-workspace";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

const organizationId = "76300000-0000-4000-8000-000000000001";
const branchId = "76300000-0000-4000-8000-000000000002";
const page = getPageBySlug("staff/operations/consultant-messages")!;
const filters: ConsultantMessageFilters = {
  consultantUserId: null,
  dateFrom: null,
  dateTo: null,
  status: "all",
  query: "",
};

afterEach(cleanup);

describe("consultant messages dedicated workspace", () => {
  it("freezes the catalog permission and acceptance boundary", () => {
    expect(page.requiredPermissions).toEqual(["consultant_messages.read"]);
    expect(page.primaryActions).toEqual(["新增訊息", "標示已讀", "確認訊息"]);
    expect(page.primaryActions).not.toContain("上傳附件");
    expect(page.acceptance.join(" ")).toMatch(/consultant.*not_configured.*系統內/u);
  });

  it("renders the consultant-only history, five matching metrics, and honest boundaries", () => {
    const snapshot = buildDemoConsultantMessageSnapshot({
      organizationId,
      branchId,
      filters,
    });
    render(<ConsultantMessagesWorkspace
      canReceive={false}
      filters={filters}
      page={page}
      snapshot={snapshot}
    />);

    expect(screen.getByRole("heading", { level: 1, name: "顧問訊息" }))
      .toBeInTheDocument();
    const metrics = within(screen.getByRole("region", { name: "顧問訊息摘要" }));
    for (const label of ["符合訊息", "實際未讀", "今日訊息", "可信附件", "待確認"]) {
      expect(metrics.getByText(label)).toBeInTheDocument();
    }
    expect(screen.getAllByText("活動輔具配置討論")).toHaveLength(2);
    expect(screen.getAllByText("顧問類別")).toHaveLength(4);
    expect(screen.getByText(/目前僅是系統內訊息與實際回條/u))
      .toHaveTextContent("不代表 LINE、簡訊、Email、PWA 或任何外部送達");
    expect(screen.getByText(/附件管線：未設定/u).closest('[role="status"]'))
      .toHaveTextContent("不接受瀏覽器路徑或外部網址");
    expect(screen.getByRole("button", { name: /展示模式不會寫入資料/u }))
      .toBeDisabled();
  });

  it("fails visibly without falling back to a general-message workspace", () => {
    render(<ConsultantMessagesWorkspace
      canReceive={false}
      filters={filters}
      loadError
      page={page}
      snapshot={null}
    />);
    expect(screen.getByRole("alert")).toHaveTextContent("顧問訊息暫時無法載入");
    expect(screen.getByRole("alert")).toHaveTextContent("不會改查一般訊息、其他分支");
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });
});
