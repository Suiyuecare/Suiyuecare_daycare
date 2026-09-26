// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { staffPages } from "@/lib/catalog";
import { buildDemoReferralManagementSnapshot } from "@/lib/referral-management/demo";
import type { ReferralManagementFilters } from "@/lib/referral-management/types";
import type { TenantContext } from "@/lib/domain/types";
import { clearReferralPendingOnLogout } from "@/lib/referral-management/pending";

import {
  ReferralCorrectionForm,
  ReferralCreateForm,
  ReferralTransitionForm,
  ReferralController,
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
const context: TenantContext = { organizationId, branchId, organizationName: "合成機構", branchName: "合成分支", userId: "39000000-0000-4000-8000-000000000042", displayName: "合成社工", roles: ["case_manager_social_worker"], scopes: ["clients.read", "referral_management.read", "referral_management.create", "referral_management.respond", "referral_management.correct"], assuranceLevel: "aal2", recentAal2At: null, demo: true };
function liveSnapshot() { const generatedAt = new Date().toISOString(); return { ...snapshot, generatedAt, staleAfter: new Date(Date.now() + 60_000).toISOString(), canRespond: true, demo: false }; }

beforeEach(() => {
  Object.defineProperty(HTMLDialogElement.prototype, "showModal", { configurable: true, value(this: HTMLDialogElement) { this.open = true; } });
  Object.defineProperty(HTMLDialogElement.prototype, "close", { configurable: true, value(this: HTMLDialogElement) { this.open = false; } });
});
afterEach(() => { cleanup(); clearReferralPendingOnLogout(); vi.unstubAllGlobals(); });

describe("Page 39 referral workspace and actions", () => {
  it("renders identical referral identities in desktop rows and mobile cards", () => {
    const { container } = render(<ReferralManagementWorkspace
      context={context} filters={filters} loadError={false} page={page} snapshot={snapshot} />);
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
    render(<ReferralManagementWorkspace context={context} filters={filters}
      loadError page={page} snapshot={null} />);
    expect(screen.getByRole("heading", { name: "無法取得轉介管理快照" }))
      .toBeInTheDocument();
  });

  it("uses canonical ASCII Taipei dates regardless of runtime locale separator", () => {
    const original = Intl.DateTimeFormat;
    const spy = vi.spyOn(Intl, "DateTimeFormat").mockImplementation(function (...args) {
      const formatter = new original(...args);
      return { format: () => "2026/09/26\u200921:20", formatToParts: formatter.formatToParts.bind(formatter) } as Intl.DateTimeFormat;
    });
    const { container } = render(<ReferralManagementWorkspace context={context} filters={filters} loadError={false} page={page} snapshot={snapshot}/>);
    const expected = new original("zh-TW", { timeZone: "Asia/Taipei", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date(snapshot.generatedAt));
    const part = (type: string) => expected.find((entry) => entry.type === type)!.value;
    expect(container).toHaveTextContent(`${part("year")}/${part("month")}/${part("day")} ${part("hour")}:${part("minute")}`);
    expect(container.textContent).not.toContain("\u2009"); spy.mockRestore();
  });

  it("keeps synthetic demo create disabled", () => {
    const { container } = render(<ReferralCreateForm branchId={branchId}
      canCreate={false} clients={snapshot.clientOptions} organizationId={organizationId}
      referenceTime={snapshot.generatedAt} />);
    expect(container.querySelector("button")).toHaveProperty("disabled", true);
    expect(screen.getByText(/最近 15 分鐘 AAL2/u)).toBeInTheDocument();
  });

  it("keeps narrow correction disabled without fresh authority", () => {
    const item = snapshot.items.find((entry) => entry.status === "closed")!;
    render(<ReferralCorrectionForm item={item}
      snapshot={{ ...snapshot, canCorrect: false, demo: false }} />);
    expect(screen.getByRole("button", { name: "狹義更正" })).toBeDisabled();
  });

  it("reuses the actor operation key after an unknown response result", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error("offline"));
    vi.stubGlobal("fetch", fetchMock);
    const item = snapshot.items.find((entry) => entry.status === "received")!;
    const data = liveSnapshot();
    render(<ReferralController context={{ ...context, demo: false }} filters={filters} snapshot={data}><ReferralTransitionForm item={item} snapshot={data}/></ReferralController>);
    fireEvent.click(screen.getByText("登記回覆"));
    fireEvent.change(screen.getByRole("textbox", { name: "登記回覆內容" }), {
      target: { value: "合成外部單位回覆內容" },
    });
    fireEvent.click(screen.getByRole("button", { name: "建立登記回覆事件" }));
    await screen.findByText(/原操作結果尚未確認/u);
    fireEvent.click(screen.getByRole("button", { name: "重試同一轉介操作" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    const first = (fetchMock.mock.calls[0]![1] as RequestInit).headers as Record<string, string>;
    const second = (fetchMock.mock.calls[1]![1] as RequestInit).headers as Record<string, string>;
    expect(second["idempotency-key"]).toBe(first["idempotency-key"]);
  });

  it("does not change the original key when an unknown operation is edited then restored", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error("offline"));
    vi.stubGlobal("fetch", fetchMock);
    const item = snapshot.items.find((entry) => entry.status === "received")!;
    const data = liveSnapshot();
    render(<ReferralController context={{ ...context, demo: false }} filters={filters} snapshot={data}><ReferralTransitionForm item={item} snapshot={data}/></ReferralController>);
    fireEvent.click(screen.getByText("登記回覆"));
    const field = screen.getByRole("textbox", { name: "登記回覆內容" });
    fireEvent.input(field, { target: { value: "合成原操作內容" } });
    fireEvent.click(screen.getByRole("button", { name: "建立登記回覆事件" }));
    await screen.findByText(/原操作結果尚未確認/u);
    expect(field).toBeDisabled();
    fireEvent.input(field, { target: { value: "修改後內容" } });
    fireEvent.input(field, { target: { value: "合成原操作內容" } });
    fireEvent.click(screen.getByRole("button", { name: "重試同一轉介操作" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect((fetchMock.mock.calls[1]![1] as RequestInit).body).toBe((fetchMock.mock.calls[0]![1] as RequestInit).body);
    expect((fetchMock.mock.calls[1]![1] as RequestInit).headers).toEqual((fetchMock.mock.calls[0]![1] as RequestInit).headers);
  });
});
