// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { staffPages } from "@/lib/catalog";
import { buildDemoReferralManagementSnapshot } from "@/lib/referral-management/demo";
import type { ReferralManagementFilters } from "@/lib/referral-management/types";

import {
  ReferralCorrectionForm,
  ReferralCreateForm,
  ReferralTransitionForm,
} from "./referral-actions";
import { ReferralManagementWorkspace } from "./referral-management-workspace";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

const organizationId = "39000000-0000-4000-8000-000000000040";
const branchId = "39000000-0000-4000-8000-000000000041";
const filters: ReferralManagementFilters = {
  clientId: null, receivingUnitMode: "all", receivingUnitCode: null,
  status: "all", recentFrom: null, recentTo: null, query: "",
};
const snapshot = buildDemoReferralManagementSnapshot({ organizationId, branchId, filters });
const page = staffPages.find((entry) => entry.number === 39)!;

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("Page 39 referral workspace and actions", () => {
  it("renders identical referral identities in desktop rows and mobile cards", () => {
    const { container } = render(<ReferralManagementWorkspace
      filters={filters} loadError={false} page={page} snapshot={snapshot} />);
    const rows = new Set([...container.querySelectorAll("[data-referral-row]")]
      .map((node) => node.getAttribute("data-referral-row")));
    const cards = new Set([...container.querySelectorAll("[data-referral-card]")]
      .map((node) => node.getAttribute("data-referral-card")));
    expect(rows).toEqual(cards);
    expect(rows.size).toBe(snapshot.items.length);
    expect(screen.getByText(/全部為合成資料/u)).toBeInTheDocument();
    expect(screen.getAllByText(/not_configured/u).length).toBeGreaterThan(0);
    expect(screen.getAllByText("缺值").length).toBeGreaterThan(0);
    expect(screen.getAllByText("不適用").length).toBeGreaterThan(0);
  });

  it("fails closed without a complete server snapshot", () => {
    render(<ReferralManagementWorkspace filters={filters}
      loadError page={page} snapshot={null} />);
    expect(screen.getByRole("heading", { name: "無法取得轉介管理快照" }))
      .toBeInTheDocument();
  });

  it("keeps synthetic demo create disabled", () => {
    const { container } = render(<ReferralCreateForm branchId={branchId}
      canCreate={false} clients={snapshot.clientOptions} organizationId={organizationId}
      referenceTime={snapshot.generatedAt} />);
    expect(container.querySelector("form > fieldset")).toHaveProperty("disabled", true);
    expect(screen.getByText(/最近 15 分鐘 AAL2/u)).toBeInTheDocument();
  });

  it("keeps narrow correction disabled without fresh authority", () => {
    const item = snapshot.items.find((entry) => entry.status === "closed")!;
    render(<ReferralCorrectionForm item={item}
      snapshot={{ ...snapshot, canCorrect: false, demo: false }} />);
    expect(screen.getByRole("button", { name: "建立更正事件", hidden: true })
      .closest("fieldset")).toHaveProperty("disabled", true);
    expect(screen.getByText(/原事件與目前狀態不會被修改/u)).toBeInTheDocument();
  });

  it("reuses the actor operation key after an unknown response result", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error("offline"));
    vi.stubGlobal("fetch", fetchMock);
    const item = snapshot.items.find((entry) => entry.status === "received")!;
    render(<ReferralTransitionForm item={item}
      snapshot={{ ...snapshot, canRespond: true, demo: false }} />);
    fireEvent.click(screen.getByText("登記回覆"));
    fireEvent.change(screen.getByRole("textbox", { name: "登記回覆內容" }), {
      target: { value: "合成外部單位回覆內容" },
    });
    fireEvent.click(screen.getByRole("button", { name: "建立登記回覆事件" }));
    await screen.findByText(/完成狀態未知/u);
    fireEvent.click(screen.getByRole("button", { name: "建立登記回覆事件" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    const first = (fetchMock.mock.calls[0]![1] as RequestInit).headers as Record<string, string>;
    const second = (fetchMock.mock.calls[1]![1] as RequestInit).headers as Record<string, string>;
    expect(second["idempotency-key"]).toBe(first["idempotency-key"]);
  });
});
