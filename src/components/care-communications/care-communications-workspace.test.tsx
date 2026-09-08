// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { getPageBySlug } from "@/lib/catalog";
import { buildDemoCareCommunicationSnapshot } from "@/lib/care-communications/demo";
import type { CareCommunicationFilters } from "@/lib/care-communications/types";

import { CareCommunicationsWorkspace } from "./care-communications-workspace";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

const organizationId = "43100000-0000-4000-8000-000000000001";
const branchId = "43200000-0000-4000-8000-000000000001";
const page = getPageBySlug("staff/communication/care-communication")!;
const filters: CareCommunicationFilters = {
  clientId: null,
  dateFrom: null,
  dateTo: null,
  authorUserId: null,
  deliveryStatus: "all",
  confirmationStatus: "all",
  query: "",
};

afterEach(cleanup);

describe("care communication dedicated workspace", () => {
  it("freezes the catalog permission, action and honest integration boundary", () => {
    expect(page.requiredPermissions).toEqual(["care_communications.read"]);
    expect(page.primaryActions).toEqual(["新增待送紀錄", "建立更正"]);
    expect(page.primaryActions).not.toContain("上傳附件");
    expect(page.offline.mode).toBe("online-only");
    expect(page.acceptance.join(" ")).toMatch(
      /care_communication.*顧問訊息.*messages\.read.*not_configured.*queued/u,
    );
  });

  it("renders version history, six reconciled metrics and no fake receipt actions", () => {
    const snapshot = buildDemoCareCommunicationSnapshot({
      organizationId,
      branchId,
      filters,
    });
    render(<CareCommunicationsWorkspace
      filters={filters}
      hasRecentAal2
      page={page}
      snapshot={snapshot}
    />);

    expect(screen.getByRole("heading", { level: 1, name: "溝通紀錄" }))
      .toBeInTheDocument();
    const metrics = within(screen.getByRole("region", { name: "溝通紀錄摘要" }));
    for (const label of [
      "符合版本", "訊息主線", "更正版", "目前待送", "今日建立", "可信附件",
    ]) expect(metrics.getByText(label)).toBeInTheDocument();
    expect(screen.getAllByText("今日活動摘要（更正）")).toHaveLength(2);
    expect(screen.getByText(/傳遞邊界：/u).closest('[role="status"]'))
      .toHaveTextContent("家屬端收件、provider worker 與離線 consumer 均未設定");
    expect(screen.getByText(/附件三態：/u).closest('[role="status"]'))
      .toHaveTextContent("無附件");
    expect(screen.getByRole("button", { name: /新增待送紀錄：展示模式唯讀/u }))
      .toBeDisabled();
    expect(screen.queryByRole("button", { name: /標示已讀/u }))
      .not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /確認訊息/u }))
      .not.toBeInTheDocument();
    expect(screen.queryByLabelText(/上傳/u)).not.toBeInTheDocument();
  });

  it("fails visibly without falling back to consultant or unscoped messages", () => {
    render(<CareCommunicationsWorkspace
      filters={filters}
      hasRecentAal2={false}
      loadError
      page={page}
      snapshot={null}
    />);
    expect(screen.getByRole("alert"))
      .toHaveTextContent("溝通紀錄暫時無法載入");
    expect(screen.getByRole("alert"))
      .toHaveTextContent("不會改查顧問訊息、其他分支、未指派個案");
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });
});
