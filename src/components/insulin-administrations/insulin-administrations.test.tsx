// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { staffPages } from "@/lib/catalog";
import { buildDemoInsulinAdministrationSnapshot } from "@/lib/insulin-administrations/demo";
import type { InsulinFilters } from "@/lib/insulin-administrations/types";

import {
  InsulinAdministrationActions,
  InsulinMutationProvider,
} from "./insulin-administration-actions";
import { InsulinAdministrationsWorkspace } from "./insulin-administrations-workspace";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

const filters: InsulinFilters = {
  serviceDate: "2026-09-02", shift: "all", clientId: null, state: "all",
};
const snapshot = buildDemoInsulinAdministrationSnapshot(filters);
const page = staffPages.find((entry) => entry.number === 5)!;
const renderActions = (children: ReactNode) => render(
  <InsulinMutationProvider>{children}</InsulinMutationProvider>,
);

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
    renderActions(<InsulinAdministrationActions item={snapshot.items[1]!} snapshot={snapshot} />);
    expect(screen.getByText("合成唯讀，不送出")).toBeInTheDocument();
    cleanup();
    renderActions(<InsulinAdministrationActions item={snapshot.items[1]!}
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

  it("labels a restricted Google read-only plan without claiming no plan exists", () => {
    render(<InsulinAdministrationsWorkspace filters={filters} loadError={false} page={page}
      snapshot={{ ...snapshot, demo: false, planDesignationStatus: "restricted" }} />);
    expect(screen.getByText("僅供查看；施打與覆核未授權")).toBeInTheDocument();
    expect(screen.getByText(/胰島素計畫指定 依個案授權顯示/u)).toBeInTheDocument();
    expect(screen.queryByText(/胰島素計畫指定 not_configured/u)).not.toBeInTheDocument();
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
    renderActions(<InsulinAdministrationActions item={snapshot.items[1]!}
      snapshot={{ ...snapshot, demo: false, governanceStatus: "published",
        planDesignationStatus: "published", qualificationStatus: "published",
        doseRuleStatus: "published", lateEntryRuleStatus: "published",
        canReview: true }} />);
    const button = screen.getByRole("button", { name: "獨立覆核" });
    fireEvent.click(button);
    await screen.findByText(/結果未知/u);
    expect(button).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "同一操作重試" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    const first = fetchMock.mock.calls[0]![1] as RequestInit;
    const second = fetchMock.mock.calls[1]![1] as RequestInit;
    expect(second.body).toBe(first.body);
    expect((second.headers as Record<string, string>)["idempotency-key"])
      .toBe((first.headers as Record<string, string>)["idempotency-key"]);
    expect((second.headers as Record<string, string>)["x-insulin-operation"])
      .toBe("review");
  });

  it("shares an uncertain slot across simultaneously mounted desktop and mobile actions", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error("offline"));
    vi.stubGlobal("fetch", fetchMock);
    const live = { ...snapshot, demo: false, canReview: true };
    const item = snapshot.items[1]!;
    renderActions(<><InsulinAdministrationActions item={item} snapshot={live} />
      <InsulinAdministrationActions item={item} snapshot={live} /></>);
    fireEvent.click(screen.getAllByRole("button", { name: "獨立覆核" })[0]!);
    await waitFor(() => expect(screen.getAllByRole("button", { name: "獨立覆核" })
      .every((button) => button.hasAttribute("disabled"))).toBe(true));
    await screen.findAllByText(/結果未知/u);
    expect(screen.getAllByRole("button", { name: "同一操作重試" })).toHaveLength(2);
    fireEvent.click(screen.getAllByRole("button", { name: "同一操作重試" })[1]!);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    const first = fetchMock.mock.calls[0]![1] as RequestInit;
    const second = fetchMock.mock.calls[1]![1] as RequestInit;
    expect(second.body).toBe(first.body);
    expect((second.headers as Record<string, string>)["idempotency-key"])
      .toBe((first.headers as Record<string, string>)["idempotency-key"]);
  });

  it("freezes a late reason after an uncertain timeout and never sends an edited attempt", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error("timeout"));
    vi.stubGlobal("fetch", fetchMock);
    const item = { ...snapshot.items[0]!, isLate: true };
    const { container } = renderActions(<InsulinAdministrationActions item={item}
      snapshot={{ ...snapshot, demo: false, canAuthorizeLate: true }} />);
    const reason = screen.getByLabelText("補登授權理由");
    fireEvent.change(reason, { target: { value: "合成逾時原因，待主管核對" } });
    fireEvent.click(screen.getByRole("button", { name: "主管授權補登" }));
    await screen.findByText(/結果未知/u);
    expect(reason).toBeDisabled();
    expect(screen.getByRole("button", { name: "主管授權補登" })).toBeDisabled();
    // Even a synthetic submit that bypasses the disabled button cannot create a new attempt.
    fireEvent.submit(container.querySelector("form")!);
    expect(fetchMock).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole("button", { name: "同一操作重試" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    const first = fetchMock.mock.calls[0]![1] as RequestInit;
    const second = fetchMock.mock.calls[1]![1] as RequestInit;
    expect(second.body).toBe(first.body);
    expect((second.headers as Record<string, string>)["idempotency-key"])
      .toBe((first.headers as Record<string, string>)["idempotency-key"]);
  });

  it("uses the app validation message and focuses an empty late-authorization reason", () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const item = { ...snapshot.items[0]!, isLate: true };
    const { container } = renderActions(<InsulinAdministrationActions item={item}
      snapshot={{ ...snapshot, demo: false, canAuthorizeLate: true }} />);
    const reason = screen.getByLabelText("補登授權理由");
    expect(container.querySelector("form")).toHaveAttribute("novalidate");
    fireEvent.click(screen.getByRole("button", { name: "主管授權補登" }));
    expect(screen.getByRole("alert")).toHaveTextContent("請填寫 2 至 1000 字的補登授權理由。");
    expect(reason).toHaveAttribute("aria-invalid", "true");
    expect(reason).toHaveFocus();
    expect(fetchMock).not.toHaveBeenCalled();
    fireEvent.change(reason, { target: { value: "合成逾時原因，待主管核對" } });
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("allows a corrected new attempt only after a strict pre-write validation rejection", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: false, status: 400, json: async () => ({
        requestId: "05a00000-0000-4000-8000-000000000201", status: "error", data: null,
        errors: [{ code: "INVALID_INSULIN_ADMINISTRATION", message: "理由未通過驗證。" }],
      }) })
      .mockRejectedValueOnce(new Error("offline"));
    vi.stubGlobal("fetch", fetchMock);
    const item = { ...snapshot.items[0]!, isLate: true };
    renderActions(<InsulinAdministrationActions item={item}
      snapshot={{ ...snapshot, demo: false, canAuthorizeLate: true }} />);
    const reason = screen.getByLabelText("補登授權理由");
    fireEvent.change(reason, { target: { value: "合成理由一，待主管核對" } });
    fireEvent.click(screen.getByRole("button", { name: "主管授權補登" }));
    await screen.findByText("理由未通過驗證。");
    expect(reason).toBeEnabled();
    expect(screen.queryByRole("button", { name: "同一操作重試" })).not.toBeInTheDocument();
    fireEvent.change(reason, { target: { value: "合成理由二，已完成主管核對" } });
    fireEvent.click(screen.getByRole("button", { name: "主管授權補登" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    const first = fetchMock.mock.calls[0]![1] as RequestInit;
    const second = fetchMock.mock.calls[1]![1] as RequestInit;
    expect(second.body).not.toBe(first.body);
    expect((second.headers as Record<string, string>)["idempotency-key"])
      .not.toBe((first.headers as Record<string, string>)["idempotency-key"]);
  });

  it("treats a verified stale-version conflict as not written and requires a fresh snapshot", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 409, json: async () => ({
      requestId: "05a00000-0000-4000-8000-000000000201", status: "error", data: null,
      errors: [{ code: "INSULIN_VERSION_CONFLICT", message: "施打紀錄已有較新的事件。" }],
    }) });
    vi.stubGlobal("fetch", fetchMock);
    renderActions(<InsulinAdministrationActions item={snapshot.items[1]!}
      snapshot={{ ...snapshot, demo: false, canReview: true }} />);
    fireEvent.click(screen.getByRole("button", { name: "獨立覆核" }));
    await screen.findByText(/本次未寫入/u);
    expect(screen.getByRole("button", { name: "獨立覆核" })).toBeDisabled();
    expect(screen.queryByRole("button", { name: "同一操作重試" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "重新載入正式紀錄" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "獨立覆核" }));
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("keeps a malformed success locked until an exact replay returns a correlated receipt", async () => {
    const item = { ...snapshot.items[0]!, isLate: true };
    const receipt = {
      requestId: "05a00000-0000-4000-8000-000000000201", status: "ok", errors: [],
      data: {
        organizationId: snapshot.organizationId, branchId: snapshot.branchId,
        operationId: "05600000-0000-4000-8000-000000000201",
        operationKind: "authorize_late", administrationKey: "05700000-0000-4000-8000-000000000201",
        eventId: "05800000-0000-4000-8000-000000000201", eventSequence: 1,
        previousEventId: null, state: "late_authorized", medicationPlanId: item.medicationPlanId,
        governanceVersionId: "05900000-0000-4000-8000-000000000201",
        scheduledFor: item.scheduledFor, executedAt: null, reviewedAt: null,
        contentHash: "a".repeat(64), qualificationStatus: "published",
        doseRuleStatus: "published", lateEntryRuleStatus: "published",
        completionStatus: "pending_independent_review", offlineStatus: "not_configured",
        committedAt: "2026-09-02T02:01:01.000Z", replayed: true,
        persisted: true, demo: false,
      },
    };
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, status: 201, json: async () => ({ malformed: true }) })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => receipt });
    vi.stubGlobal("fetch", fetchMock);
    renderActions(<InsulinAdministrationActions item={item}
      snapshot={{ ...snapshot, demo: false, canAuthorizeLate: true }} />);
    fireEvent.change(screen.getByLabelText("補登授權理由"), {
      target: { value: "合成逾時原因，待主管核對" },
    });
    fireEvent.click(screen.getByRole("button", { name: "主管授權補登" }));
    await screen.findByText(/回覆未通過核對/u);
    expect(screen.getByLabelText("補登授權理由")).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "同一操作重試" }));
    await screen.findByText(/已新增不可變事件/u);
    expect(screen.queryByRole("button", { name: "同一操作重試" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "主管授權補登" })).toBeDisabled();
    const first = fetchMock.mock.calls[0]![1] as RequestInit;
    const second = fetchMock.mock.calls[1]![1] as RequestInit;
    expect(second.body).toBe(first.body);
    expect((second.headers as Record<string, string>)["idempotency-key"])
      .toBe((first.headers as Record<string, string>)["idempotency-key"]);
  });

  it("derives the injection-site text from the selected code", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error("offline"));
    vi.stubGlobal("fetch", fetchMock);
    renderActions(<InsulinAdministrationActions item={snapshot.items[0]!}
      snapshot={{ ...snapshot, demo: false, canExecute: true }} />);
    fireEvent.click(screen.getByText("記錄施打"));
    expect(screen.queryByLabelText("部位文字")).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("施打部位"), { target: { value: "RIGHT_ARM" } });
    fireEvent.click(screen.getByRole("button", { name: "簽署施打並送覆核" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    expect(JSON.parse(String((fetchMock.mock.calls[0]![1] as RequestInit).body)))
      .toMatchObject({ siteCode: "RIGHT_ARM", siteText: "右上臂" });
  });

  it("sends only the strict late-authorization wire fields", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error("offline"));
    vi.stubGlobal("fetch", fetchMock);
    const item = { ...snapshot.items[0]!, isLate: true };
    renderActions(<InsulinAdministrationActions item={item}
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
