// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { ComponentProps } from "react";
import type Link from "next/link";
import { pageCatalog } from "@/lib/catalog";
import { buildDemoDailySnapshot } from "@/lib/core-care/demo";
import { CoreDailyWorkspace } from "./core-daily-workspace";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("next/link", () => ({
  default: ({ children, href, ...props }: ComponentProps<typeof Link>) => <a href={String(href)} aria-current={props["aria-current"]}>{children}</a>,
  useLinkStatus: () => ({ pending: false }),
}));
beforeAll(() => {
  Object.defineProperty(HTMLDialogElement.prototype, "showModal", { configurable: true, value() { this.setAttribute("open", ""); } });
  Object.defineProperty(HTMLDialogElement.prototype, "close", { configurable: true, value() { this.removeAttribute("open"); } });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
const snapshot = buildDemoDailySnapshot("2026-09-10");
const selected = snapshot.clients[1]!;
function workspace(page: number, overrides: Partial<ComponentProps<typeof CoreDailyWorkspace>> = {}) {
  return <CoreDailyWorkspace page={pageCatalog.find((item) => item.number === page)!} moduleTitle="每日照顧"
    serviceDate={snapshot.serviceDate} snapshot={snapshot} canWrite {...overrides} />;
}

describe("daily care selected-client handoff and source boundaries", () => {
  it.each([
    [46, "登錄出勤", "簽到、簽退或登記未到"],
    [3, "新增量測", "新增生命徵象"],
    [6, "新增日誌草稿", "新增照顧日誌"],
  ] as const)("passes the selected second client into the real page %s composer", (page, trigger, title) => {
    render(workspace(page, { selectedClientId: selected.clientId }));
    expect(screen.queryByRole("region", { name: "本頁摘要" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: trigger }).closest(".core-client-continuation")).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: trigger }));
    const clientInput = within(screen.getByRole("dialog", { name: title })).getByLabelText("個案 *");
    expect(clientInput).toHaveValue(selected.clientId);
    expect(within(clientInput).getAllByRole("option")).toHaveLength(2);
  });
  it.each([46, 3, 6])("requires selection in the continuation before opening page %s composer", (page) => {
    render(workspace(page));
    expect(screen.getByRole("combobox", { name: "選擇個案" })).toHaveValue("");
    expect(screen.queryByRole("dialog", { hidden: true })).not.toBeInTheDocument();
    expect(screen.getByText("請先在上方選定個案，再新增紀錄。")).toBeVisible();
  });
  it("retains the selected client and day on a failed-load retry", () => {
    render(workspace(3, { selectedClientId: selected.clientId, snapshot: null, loadError: true }));
    expect(screen.getByRole("link", { name: "重新載入" })).toHaveAttribute("href", `/app/staff/daily-care/vital-signs?date=2026-09-10&client=${selected.clientId}`);
  });
  it.each([46, 3, 6])("does not let an invalid page %s selection fall back to any other composer", (page) => {
    render(workspace(page, { selectedClientId: "a9999999-9999-4999-8999-999999999999" }));
    expect(screen.getByRole("alert")).toHaveTextContent("不會自動改用其他人");
    expect(screen.queryByRole("dialog", { hidden: true })).not.toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });
  it("does not expose client identities or zero totals when client access is false", () => {
    const { container } = render(workspace(3, { snapshot: { ...snapshot, sourceAccess: { ...snapshot.sourceAccess, clients: false } } }));
    expect(container.textContent).not.toContain(selected.displayName);
    expect(container.textContent).not.toContain(selected.clientCode);
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "本頁摘要" })).not.toBeInTheDocument();
  });
  it.each([[46, "attendance"], [3, "measurements"], [6, "careDiaries"]] as const)("does not render a page %s record list when its source is unauthorized", (page, source) => {
    render(workspace(page, { snapshot: { ...snapshot, sourceAccess: { ...snapshot.sourceAccess, [source]: false } } }));
    expect(screen.getByRole("heading", { name: "目前沒有本頁資料查看權限" })).toBeVisible();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "本頁摘要" })).not.toBeInTheDocument();
    expect(screen.queryByRole("dialog", { hidden: true })).not.toBeInTheDocument();
  });
  it("marks unauthorized secondary sources instead of absence, zero or complete", () => {
    const { container } = render(workspace(6, { selectedClientId: selected.clientId,
      snapshot: { ...snapshot, clients: [selected], sourceAccess: { ...snapshot.sourceAccess, attendance: false, measurements: false, serviceEvents: false } } }));
    expect(screen.getAllByText("無查閱權限").length).toBeGreaterThan(2);
    expect(container.textContent).not.toContain("0 筆");
    expect(container.textContent).not.toContain("資料完整");
    expect(container.textContent).not.toContain("已有量測");
  });
  it("keeps actual permission and verification rules while disabling write actions", () => {
    render(workspace(6, { canWrite: false, selectedClientId: selected.clientId }));
    expect(screen.getByRole("button", { name: "新增日誌草稿" })).toBeDisabled();
    expect(screen.getByText(/新增紀錄需要對應權限及身分驗證/u)).toBeVisible();
    const rules = screen.getByText("查看身分驗證與資料規則").closest("details")!;
    expect(rules.textContent).toContain("身分驗證");
    expect(rules.textContent).not.toContain("AAL2");
    expect(rules.textContent).toContain("最近 15 分鐘");
  });
});
