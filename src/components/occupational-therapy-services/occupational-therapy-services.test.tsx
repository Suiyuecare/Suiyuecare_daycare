// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { staffPages } from "@/lib/catalog";
import { buildDemoOccupationalTherapyServiceSnapshot } from "@/lib/occupational-therapy-services/demo";
import type { OccupationalTherapyServiceFilters } from "@/lib/occupational-therapy-services/types";

import {
  OccupationalTherapyServiceCreateAction,
  OccupationalTherapyServiceRecordActions,
} from "./occupational-therapy-service-actions";
import { OccupationalTherapyServicesWorkspace } from "./occupational-therapy-services-workspace";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

const page = staffPages.find((entry) => entry.number === 41)!;
const filters: OccupationalTherapyServiceFilters = {
  dateFrom: null, dateTo: null, clientId: null, therapistUserId: null,
  recordState: null, keyword: null,
};

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  refresh.mockReset();
});

describe("Page 41 occupational therapy service workspace", () => {
  it("renders identical stable record identities in desktop rows and mobile cards", () => {
    const snapshot = buildDemoOccupationalTherapyServiceSnapshot();
    const { container } = render(<OccupationalTherapyServicesWorkspace
      canManage={false} canSign={false} filters={filters} hasRecentAal2={false}
      page={page} snapshot={snapshot} />);
    const rows = new Set([...container.querySelectorAll("[data-service-row]")]
      .map((node) => node.getAttribute("data-service-row")));
    const cards = new Set([...container.querySelectorAll("[data-service-card]")]
      .map((node) => node.getAttribute("data-service-card")));
    expect(rows).toEqual(cards);
    expect(rows.size).toBe(snapshot.records.length);
    expect(screen.getByRole("heading", { level: 1, name: "職能治療服務紀錄" }))
      .toBeInTheDocument();
    expect(screen.getByText(/第 33 頁最近已簽/u)).toBeInTheDocument();
  });

  it("keeps every synthetic action disabled and labels all data as demo", () => {
    render(<OccupationalTherapyServicesWorkspace
      canManage canSign filters={filters} hasRecentAal2 page={page}
      snapshot={buildDemoOccupationalTherapyServiceSnapshot()} />);
    expect(screen.getByText(/所有個案、治療師、內容與評估連結皆為合成示例/u))
      .toBeInTheDocument();
    for (const button of screen.getAllByRole("button")) {
      if (button.textContent?.includes("展示唯讀")) expect(button).toBeDisabled();
    }
  });

  it("fails closed when the server snapshot is unavailable", () => {
    render(<OccupationalTherapyServicesWorkspace
      canManage={false} canSign={false} filters={filters} hasRecentAal2={false}
      loadError page={page} snapshot={null} />);
    expect(screen.getByRole("heading", { name: "職能治療服務紀錄暫時無法載入" }))
      .toBeInTheDocument();
    expect(screen.getByText(/不會擴大到其他分支、未指派個案或展示資料/u))
      .toBeInTheDocument();
  });

  it("shows an actionable empty state without broadening filters", () => {
    const snapshot = buildDemoOccupationalTherapyServiceSnapshot({
      ...filters, keyword: "不存在的合成關鍵字",
    });
    render(<OccupationalTherapyServicesWorkspace
      canManage={false} canSign={false} filters={{ ...filters, keyword: "不存在的合成關鍵字" }}
      hasRecentAal2={false} page={page} snapshot={snapshot} />);
    expect(screen.getByRole("heading", { name: "沒有符合條件的服務紀錄" }))
      .toBeInTheDocument();
    expect(screen.getByRole("link", { name: "清除篩選" })).toHaveAttribute("href", "?");
  });

  it("blocks signing without recent same-session AAL2", () => {
    const snapshot = { ...buildDemoOccupationalTherapyServiceSnapshot(), demo: false };
    const draft = snapshot.records.find((record) => record.recordState === "draft")!;
    render(<OccupationalTherapyServiceRecordActions canManage canSign
      hasRecentAal2={false} record={draft} snapshot={snapshot} />);
    expect(screen.getByRole("button", { name: "簽署服務紀錄" })).toBeDisabled();
    expect(screen.getByRole("alert")).toHaveTextContent(/最近 15 分鐘/u);
  });

  it("keeps the same operation key after structured 5xx and rotates it only after edits", async () => {
    const response = () => Response.json({
      requestId: "41000000-0000-4000-8000-000000000299",
      status: "error", data: null,
      errors: [{ code: "SERVICE_NOT_CONFIGURED", message: "正式服務未設定" }],
    }, { status: 503 });
    const fetchMock = vi.fn().mockImplementation(async () => response());
    vi.stubGlobal("fetch", fetchMock);
    const snapshot = { ...buildDemoOccupationalTherapyServiceSnapshot(), demo: false };
    const { container } = render(<OccupationalTherapyServiceCreateAction
      canManage canSign={false} hasRecentAal2={false} snapshot={snapshot} />);
    fireEvent.click(container.querySelector("summary")!);
    fireEvent.change(screen.getByLabelText("指派個案"), {
      target: { value: snapshot.clientOptions[0]!.clientId },
    });
    fireEvent.change(screen.getByLabelText("服務內容內容"), {
      target: { value: "合成職能治療服務內容" },
    });
    fireEvent.change(screen.getByLabelText("缺值理由"), {
      target: { value: "本次尚未取得可記錄反應" },
    });
    fireEvent.change(screen.getByLabelText("不適用理由"), {
      target: { value: "本次沒有新增人工建議" },
    });
    fireEvent.click(screen.getByRole("button", { name: "新增服務草稿" }));
    await screen.findByText(/結果未知/u);
    fireEvent.click(screen.getByRole("button", { name: "新增服務草稿" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    const firstHeaders = (fetchMock.mock.calls[0]![1] as RequestInit)
      .headers as Record<string, string>;
    const secondHeaders = (fetchMock.mock.calls[1]![1] as RequestInit)
      .headers as Record<string, string>;
    expect(firstHeaders["x-occupational-therapy-service-operation"])
      .toBe("create_draft");
    expect(secondHeaders["idempotency-key"]).toBe(firstHeaders["idempotency-key"]);

    fireEvent.change(screen.getByLabelText("服務內容內容"), {
      target: { value: "使用者修改後的合成服務內容" },
    });
    fireEvent.click(screen.getByRole("button", { name: "新增服務草稿" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
    const thirdHeaders = (fetchMock.mock.calls[2]![1] as RequestInit)
      .headers as Record<string, string>;
    expect(thirdHeaders["idempotency-key"]).not.toBe(firstHeaders["idempotency-key"]);
  });
});
