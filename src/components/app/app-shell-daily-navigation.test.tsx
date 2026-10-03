// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ComponentProps } from "react";
import type Link from "next/link";

import { getNavigationGroups } from "@/lib/catalog";
import { buildDemoDailySnapshot } from "@/lib/core-care/demo";
import { dailyWorkflowHref } from "@/lib/core-care/workflow-links";
import type { TenantContext } from "@/lib/domain/types";
import { ClientContinuation } from "@/components/core-care/client-continuation";
import type { DailyNavigationScope } from "./daily-navigation-context";

const mocks = vi.hoisted(() => ({ pathname: "/app/staff/daily-care/care-diary", query: "", clear: vi.fn(), inspect: vi.fn(), checkedClear: vi.fn(),
  fetch: vi.fn(), signOut: vi.fn(), replace: vi.fn(), refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ usePathname: () => mocks.pathname,
  useSearchParams: () => new URLSearchParams(mocks.query),
  useRouter: () => ({ replace: mocks.replace, refresh: mocks.refresh }) }));
vi.mock("next/link", () => ({
  default: ({ children, href, ...props }: ComponentProps<typeof Link>) => <a href={String(href)}
    aria-label={props["aria-label"]} aria-current={props["aria-current"]} onClick={props.onClick}>{children}</a>,
  useLinkStatus: () => ({ pending: false }),
}));
vi.mock("@/lib/offline/draft-store", () => ({ clearOfflineDrafts: mocks.clear, inspectOfflineDraftsForLogout: mocks.inspect, clearOfflineDraftsIfUnchanged: mocks.checkedClear }));
vi.mock("@/lib/api/client-fetch", () => ({ fetchWithTimeout: mocks.fetch }));
vi.mock("@/lib/supabase/browser", () => ({ createBrowserSupabaseClient: () => ({ auth: { signOut: mocks.signOut } }) }));
vi.mock("./branch-switcher", () => ({ BranchSwitcher: () => <span>合成分支選單</span> }));

import { AppShell } from "./app-shell";

const snapshot = buildDemoDailySnapshot("2026-09-10");
const client = snapshot.clients[1]!;
const actor: TenantContext = { organizationId: "org-a", branchId: "branch-a", userId: "user-a",
  organizationName: "合成機構", branchName: "合成分支", displayName: "合成員工", roles: ["care_worker"],
  scopes: [], assuranceLevel: "aal2", recentAal2At: null, demo: false };
const scope: DailyNavigationScope = { organizationId: actor.organizationId, branchId: actor.branchId, userId: actor.userId };
const navigation = getNavigationGroups("staff");
const readableClientSources = { attendance: true, measurements: true, careDiaries: true, serviceEvents: true };
beforeAll(() => {
  Object.defineProperty(HTMLDialogElement.prototype, "showModal", { configurable: true, value() { this.setAttribute("open", ""); } });
  Object.defineProperty(HTMLDialogElement.prototype, "close", { configurable: true, value() { this.removeAttribute("open"); this.dispatchEvent(new Event("close")); } });
});

function shell({ context = actor, validatedScope = scope, clientId = client.clientId, sourceAccess = snapshot.sourceAccess,
  clientSourceAccess = client.sourceAccess, shift }: {
  context?: TenantContext; validatedScope?: DailyNavigationScope; clientId?: string;
  sourceAccess?: typeof snapshot.sourceAccess; clientSourceAccess?: typeof client.sourceAccess; shift?: "morning";
} = {}) {
  return <AppShell context={context} navigation={navigation}>
    <ClientContinuation page={6} serviceDate={snapshot.serviceDate} selectedClientId={clientId} selectedShift={shift}
      validatedScope={validatedScope} clients={[{ ...client, sourceAccess: clientSourceAccess }]} sourceAccess={sourceAccess} />
  </AppShell>;
}

function mobileMeasureLink() {
  return within(screen.getByRole("navigation", { name: "常用功能" })).getByRole("link", { name: /生命徵象紀錄/u });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.pathname = "/app/staff/daily-care/care-diary";
  mocks.query = `date=2026-09-10&client=${client.clientId}`;
  mocks.clear.mockResolvedValue(undefined);
  mocks.inspect.mockResolvedValue({ generation: "g1", revision: "r1", count: 0 });
  mocks.checkedClear.mockResolvedValue("cleared");
  mocks.signOut.mockResolvedValue({ error: null });
  mocks.fetch.mockResolvedValue(Response.json({ status: "ok", data: { cleared: true } }));
  window.matchMedia = vi.fn().mockReturnValue({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe("mobile daily navigation uses only a server-validated current selection", () => {
  it("keeps the selected person, service date and shift in the bottom measurement link", async () => {
    mocks.query += "&shift=morning";
    render(shell({ shift: "morning" }));
    await waitFor(() => expect(mobileMeasureLink()).toHaveAttribute("href", dailyWorkflowHref(3, snapshot.serviceDate, client.clientId, "morning")));
  });

  it("drops context immediately when the same-route query changes, repeats or the route changes", async () => {
    const view = render(shell());
    await waitFor(() => expect(mobileMeasureLink()).toHaveAttribute("href", dailyWorkflowHref(3, snapshot.serviceDate, client.clientId)));
    for (const query of [
      `date=2026-09-11&client=${client.clientId}`,
      `date=2026-09-10&client=a9999999-9999-4999-8999-999999999999`,
      `date=2026-09-10&date=2026-09-10&client=${client.clientId}`,
      `date=2026-09-10&client=${client.clientId}&client=${client.clientId}`,
      `date=2026-09-10&client=${client.clientId}&shift=morning&shift=afternoon`,
    ]) {
      mocks.query = query;
      view.rerender(shell());
      expect(mobileMeasureLink()).toHaveAttribute("href", "/app/staff/daily-care/vital-signs");
    }
    mocks.query = `date=2026-09-10&client=${client.clientId}`;
    mocks.pathname = "/app/staff/workspace/dashboard";
    view.rerender(shell());
    expect(mobileMeasureLink()).toHaveAttribute("href", "/app/staff/daily-care/vital-signs");
  });

  it("rejects an old server scope after branch or actor changes", async () => {
    const view = render(shell());
    await waitFor(() => expect(mobileMeasureLink()).toHaveAttribute("href", dailyWorkflowHref(3, snapshot.serviceDate, client.clientId)));
    const otherBranch = { ...actor, branchId: "branch-b" };
    view.rerender(shell({ context: otherBranch }));
    expect(mobileMeasureLink()).toHaveAttribute("href", "/app/staff/daily-care/vital-signs");
    await waitFor(() => expect(mobileMeasureLink()).toHaveAttribute("href", "/app/staff/daily-care/vital-signs"));
    const otherActor = { ...actor, userId: "user-b" };
    view.rerender(shell({ context: otherActor }));
    expect(mobileMeasureLink()).toHaveAttribute("href", "/app/staff/daily-care/vital-signs");
  });

  it("keeps the ordinary entrance for unverified clients or unreadable measurement sources", async () => {
    const view = render(shell({ clientId: "a9999999-9999-4999-8999-999999999999" }));
    expect(mobileMeasureLink()).toHaveAttribute("href", "/app/staff/daily-care/vital-signs");
    view.rerender(shell({ clientId: client.clientId, clientSourceAccess: readableClientSources }));
    await waitFor(() => expect(mobileMeasureLink()).toHaveAttribute("href", dailyWorkflowHref(3, snapshot.serviceDate, client.clientId)));
    view.rerender(shell({ clientId: client.clientId, sourceAccess: { ...snapshot.sourceAccess, measurements: false },
      clientSourceAccess: readableClientSources }));
    expect(mobileMeasureLink()).toHaveAttribute("href", "/app/staff/daily-care/vital-signs");
    view.rerender(shell({ clientId: client.clientId, clientSourceAccess: readableClientSources }));
    await waitFor(() => expect(mobileMeasureLink()).toHaveAttribute("href", dailyWorkflowHref(3, snapshot.serviceDate, client.clientId)));
    view.rerender(shell({ clientId: client.clientId, clientSourceAccess: { ...readableClientSources, measurements: false } }));
    expect(mobileMeasureLink()).toHaveAttribute("href", "/app/staff/daily-care/vital-signs");
    view.rerender(shell({ clientId: client.clientId, clientSourceAccess: readableClientSources }));
    await waitFor(() => expect(mobileMeasureLink()).toHaveAttribute("href", dailyWorkflowHref(3, snapshot.serviceDate, client.clientId)));
    view.rerender(shell({ clientId: client.clientId, clientSourceAccess: readableClientSources,
      validatedScope: { ...scope, branchId: "other" } }));
    expect(mobileMeasureLink()).toHaveAttribute("href", "/app/staff/daily-care/vital-signs");
  });

  it("removes the selected navigation and patient view as soon as logout begins", async () => {
    render(shell());
    await waitFor(() => expect(mobileMeasureLink()).toHaveAttribute("href", dailyWorkflowHref(3, snapshot.serviceDate, client.clientId)));
    expect(screen.getByRole("heading", { name: `${client.displayName}的接續工作` })).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole("button", { name: "登出" })[0]);
    await waitFor(() => expect(screen.queryByRole("navigation", { name: "常用功能" })).not.toBeInTheDocument());
    expect(screen.queryByRole("heading", { name: `${client.displayName}的接續工作` })).not.toBeInTheDocument();
    await waitFor(() => expect(mocks.replace).toHaveBeenCalledWith("/login"));
  });
});
