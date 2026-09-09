// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ComponentProps } from "react";
import type Link from "next/link";
import { buildDemoDailySnapshot } from "@/lib/core-care/demo";
import { ClientContinuation, useCoreDraftGuard } from "./client-continuation";
import { NavigationLink } from "@/components/app/navigation-link";

vi.mock("next/link", () => ({
  default: ({ children, href, ...props }: ComponentProps<typeof Link>) => <a href={String(href)} aria-current={props["aria-current"]} onClick={props.onClick}>{children}</a>,
  useLinkStatus: () => ({ pending: false }),
}));
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
const snapshot = buildDemoDailySnapshot("2026-09-10");
const second = snapshot.clients[1]!;
function continuation(overrides: Partial<ComponentProps<typeof ClientContinuation>> = {}) {
  return <ClientContinuation page={46} serviceDate={snapshot.serviceDate} clients={snapshot.clients}
    sourceAccess={snapshot.sourceAccess} {...overrides} />;
}

describe("select once and continue the authorized daily workflow", () => {
  it("requires an explicit choice and carries the second person into the current page", () => {
    render(continuation());
    expect(screen.getByRole("combobox", { name: "選擇個案" })).toHaveValue("");
    expect(screen.queryByRole("link", { name: "選定這位個案" })).not.toBeInTheDocument();
    fireEvent.change(screen.getByRole("combobox", { name: "選擇個案" }), { target: { value: second.clientId } });
    expect(screen.getByRole("link", { name: "選定這位個案" })).toHaveAttribute("href", `/app/staff/service-management/attendance?date=2026-09-10&client=${second.clientId}`);
  });
  it("preserves the selected person/date through all three steps and changing person", () => {
    render(continuation({ selectedClientId: second.clientId }));
    expect(screen.getByRole("heading", { name: `${second.displayName}的接續工作` })).toBeVisible();
    const steps = within(screen.getByRole("navigation", { name: "個案照顧三步驟" })).getAllByRole("link");
    expect(steps).toHaveLength(3);
    for (const link of steps) expect(link.getAttribute("href")).toContain(`?date=2026-09-10&client=${second.clientId}`);
    expect(steps[0]).toHaveAttribute("aria-current", "step");
    expect(screen.getByRole("link", { name: "更換個案" })).toHaveAttribute("href", "/app/staff/service-management/attendance?date=2026-09-10");
  });
  it("does not call a draft completed or signed", () => {
    const client = { ...second, careDiary: { id: "synthetic", occurredAt: "2026-09-10T10:00:00+08:00", status: "draft" as const, hasAbnormalFlag: false } };
    render(continuation({ selectedClientId: second.clientId, clients: [client], page: 6 }));
    expect(screen.getByRole("link", { name: /3\. 日誌/u })).toHaveTextContent("已有草稿・未簽署");
  });
  it("does not expose unavailable source status or an actionable link", () => {
    render(continuation({ selectedClientId: second.clientId, sourceAccess: { ...snapshot.sourceAccess, measurements: false } }));
    expect(screen.queryByRole("link", { name: /2\. 量測/u })).not.toBeInTheDocument();
    expect(screen.getByText("無查閱權限")).toBeVisible();
    expect(screen.queryByText("已有量測")).not.toBeInTheDocument();
  });
  it("does not expose client labels when source access is absent", () => {
    const { container } = render(continuation({ selectedClientId: second.clientId, sourceAccess: { ...snapshot.sourceAccess, clients: false } }));
    expect(container.textContent).not.toContain(second.displayName);
    expect(container.textContent).not.toContain(second.clientCode);
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("不表示今天沒有個案");
  });
  it.each(["a9999999-9999-4999-8999-999999999999", "javascript:alert(1)", ""])("does not fall back to another person for invalid selection %s", (selectedClientId) => {
    const { container } = render(continuation({ selectedClientId }));
    expect(screen.getByRole("alert")).toHaveTextContent("不會自動改用其他人");
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
    expect(container.textContent).not.toContain(second.displayName);
    expect(screen.getAllByRole("link")).toHaveLength(1);
  });
});

function GuardHarness() {
  const draft = useCoreDraftGuard();
  return <><button onClick={draft.changed}>編輯</button><button onClick={draft.begin}>開始儲存</button>
    <button onClick={() => { draft.finish(); draft.saved(); }}>確認儲存</button>
    <NavigationLink href="/app/dashboard" loadingLabel="工作台" onClick={(event) => event.preventDefault()}>前往工作台</NavigationLink>
    <form method="get" onSubmit={(event) => event.preventDefault()}><button>套用日期</button></form></>;
}
describe("unsent draft navigation guard", () => {
  it("cancels link navigation and document unload while preserving the draft", () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    render(<GuardHarness />);
    fireEvent.click(screen.getByRole("button", { name: "編輯" }));
    fireEvent.click(screen.getByRole("link"));
    expect(confirm).toHaveBeenCalledOnce();
    const event = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
  });
  it("blocks pending navigation without discard and stops blocking after confirmed success", () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    render(<GuardHarness />);
    fireEvent.click(screen.getByRole("button", { name: "開始儲存" }));
    fireEvent.click(screen.getByRole("link"));
    expect(confirm).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "確認儲存" }));
    const event = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
  });
  it("keeps a draft when date navigation is cancelled, and confirms discard only once when accepted", () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    render(<GuardHarness />);
    fireEvent.click(screen.getByRole("button", { name: "編輯" }));
    fireEvent.click(screen.getByRole("button", { name: "套用日期" }));
    expect(confirm).toHaveBeenCalledOnce();
    confirm.mockReturnValue(true);
    fireEvent.click(screen.getByRole("link"));
    expect(confirm).toHaveBeenCalledTimes(2);
    const event = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
  });
});
