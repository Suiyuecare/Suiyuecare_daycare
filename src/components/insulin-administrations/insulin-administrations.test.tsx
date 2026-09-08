// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { staffPages } from "@/lib/catalog";
import { buildDemoInsulinAdministrationSnapshot } from "@/lib/insulin-administrations/demo";
import type { InsulinFilters } from "@/lib/insulin-administrations/types";

import { InsulinAdministrationActions } from "./insulin-administration-actions";
import { InsulinAdministrationsWorkspace } from "./insulin-administrations-workspace";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

const filters: InsulinFilters = {
  serviceDate: "2026-09-02", shift: "all", clientId: null, state: "all",
};
const snapshot = buildDemoInsulinAdministrationSnapshot(filters);
const page = staffPages.find((entry) => entry.number === 5)!;

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("Page 5 insulin workspace and actions", () => {
  it("renders identical plan-slot identities in desktop rows and mobile cards", () => {
    const { container } = render(<InsulinAdministrationsWorkspace
      filters={filters} loadError={false} page={page} snapshot={snapshot} />);
    const rows = new Set([...container.querySelectorAll("[data-insulin-row]")]
      .map((node) => node.getAttribute("data-insulin-row")));
    const cards = new Set([...container.querySelectorAll("[data-insulin-card]")]
      .map((node) => node.getAttribute("data-insulin-card")));
    expect(rows).toEqual(cards);
    expect(rows.size).toBe(snapshot.items.length);
    expect(screen.getByText(/全為合成唯讀流程範例/u)).toBeInTheDocument();
    expect(screen.getAllByText(/not_configured/u).length).toBeGreaterThan(0);
  });

  it("keeps demo and unconfigured production actions fail closed", () => {
    render(<InsulinAdministrationActions item={snapshot.items[1]!} snapshot={snapshot} />);
    expect(screen.getByText("合成唯讀，不送出")).toBeInTheDocument();
    cleanup();
    render(<InsulinAdministrationActions item={snapshot.items[1]!}
      snapshot={{ ...snapshot, demo: false }} />);
    expect(screen.getByText(/需另一位具有效資格/u)).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("fails closed without a complete server snapshot", () => {
    render(<InsulinAdministrationsWorkspace filters={filters} loadError page={page}
      snapshot={null} />);
    expect(screen.getByRole("heading", { name: "無法取得胰島素施打快照" }))
      .toBeInTheDocument();
  });

  it("shows exact Page-8 evidence and immutable history", () => {
    render(<InsulinAdministrationsWorkspace filters={filters} loadError={false}
      page={page} snapshot={snapshot} />);
    expect(screen.queryAllByText(/計畫劑量：/u)).toHaveLength(0);
    expect(screen.getAllByText(/合成長效胰島素 B/u).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/不可變歷程/u).length).toBe(snapshot.items.length * 2);
    expect(screen.getAllByText(/合成獨立覆核護理師/u).length).toBeGreaterThan(0);
  });

  it("reuses the actor operation key after an unknown result", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error("offline"));
    vi.stubGlobal("fetch", fetchMock);
    render(<InsulinAdministrationActions item={snapshot.items[1]!}
      snapshot={{ ...snapshot, demo: false, governanceStatus: "published",
        planDesignationStatus: "published", qualificationStatus: "published",
        doseRuleStatus: "published", lateEntryRuleStatus: "published",
        canReview: true }} />);
    const button = screen.getByRole("button", { name: "獨立覆核" });
    fireEvent.click(button);
    await screen.findByText(/結果未知/u);
    fireEvent.click(button);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    const first = (fetchMock.mock.calls[0]![1] as RequestInit).headers as Record<string, string>;
    const second = (fetchMock.mock.calls[1]![1] as RequestInit).headers as Record<string, string>;
    expect(second["idempotency-key"]).toBe(first["idempotency-key"]);
    expect(second["x-insulin-operation"]).toBe("review");
  });

  it("sends only the strict late-authorization wire fields", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error("offline"));
    vi.stubGlobal("fetch", fetchMock);
    const item = { ...snapshot.items[0]!, isLate: true };
    render(<InsulinAdministrationActions item={item}
      snapshot={{ ...snapshot, demo: false, governanceStatus: "published",
        planDesignationStatus: "published", qualificationStatus: "published",
        doseRuleStatus: "published", lateEntryRuleStatus: "published",
        canAuthorizeLate: true }} />);
    fireEvent.change(screen.getByLabelText("補登授權理由"), {
      target: { value: "合成逾時原因，交由主管人工確認" },
    });
    fireEvent.click(screen.getByRole("button", { name: "主管授權補登" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    const options = fetchMock.mock.calls[0]![1] as RequestInit;
    expect(JSON.parse(String(options.body))).toEqual({
      action: "authorize_late",
      medicationPlanId: item.medicationPlanId,
      scheduledFor: item.scheduledFor,
      lateReason: "合成逾時原因，交由主管人工確認",
    });
  });
});
