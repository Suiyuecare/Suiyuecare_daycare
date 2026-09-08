// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { buildDemoAdaptationAssessmentSnapshot } from "@/lib/adaptation-assessments/demo";

import {
  AdaptationAssessmentActions,
  AdaptationAssessmentFreshness,
} from "./adaptation-assessment-actions";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

const demo = buildDemoAdaptationAssessmentSnapshot();
const formal = { ...demo, demo: false as const };
const unassessed = formal.items.find((item) => item.versionId === null)!;
const draft = formal.items.find((item) => item.recordState === "draft")!;

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

function currentTaipeiDate() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date(formal.generatedAt));
}

function fillQuickCreate() {
  fireEvent.click(screen.getByText("快速新增評估草稿", { selector: "summary" }));
  fireEvent.change(screen.getByLabelText("人工適應狀態"), {
    target: { value: "adjusting" },
  });
  fireEvent.change(screen.getByLabelText("人工評估摘要"), {
    target: { value: "合成人工評估摘要" },
  });
  fireEvent.change(screen.getByLabelText("人工輸入複評期限"), {
    target: { value: "2200-01-01" },
  });
}

function submitQuickCreate() {
  fireEvent.click(screen.getByRole("button", { name: "快速新增評估草稿" }));
}

function idempotencyHeader(call: unknown[]) {
  const headers = (call[1] as RequestInit).headers as Record<string, string>;
  return headers["idempotency-key"];
}

function successEnvelope(overrides: Record<string, unknown> = {}) {
  return {
    requestId: "32900000-0000-4000-8000-000000000099",
    status: "ok",
    data: {
      receiptKind: "assessment",
      action: "create_draft",
      operationId: "32700000-0000-4000-8000-000000000091",
      clientId: unassessed.clientId,
      assessmentKey: "32500000-0000-4000-8000-000000000091",
      versionId: "32600000-0000-4000-8000-000000000091",
      assessmentVersion: 1,
      recordState: "draft",
      assessedOn: currentTaipeiDate(),
      adaptationStatus: "adjusting",
      reassessmentDueOn: "2200-01-01",
      needsFollowUp: false,
      formVersionReference: "manual-adaptation-v1",
      committedAt: new Date().toISOString(),
      replayed: false,
      persisted: true,
      demo: false,
      ...overrides,
    },
    errors: [],
  };
}

function renderUnassessed() {
  return render(<AdaptationAssessmentActions canManage canSign
    hasRecentAal2 item={unassessed} snapshot={formal} />);
}

describe("adaptation assessment client write boundary", () => {
  it("keeps every synthetic quick-add action visibly disabled", () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    render(<AdaptationAssessmentActions canManage canSign hasRecentAal2
      item={demo.items[0]!} snapshot={demo} />);
    expect(screen.getByRole("button", { name: /展示唯讀/u }))
      .toHaveProperty("disabled", true);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("locks quick-add to the exact list-row client ID", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(
      JSON.stringify(successEnvelope()),
      { status: 201, headers: { "Content-Type": "application/json" } },
    ));
    vi.stubGlobal("fetch", fetchMock);
    renderUnassessed();
    fillQuickCreate();
    expect(screen.getByText(/已鎖定個案/u).closest("p")?.textContent)
      .toContain(unassessed.clientDisplayName);
    submitQuickCreate();
    await screen.findByText(/已確認完成/u);
    const request = JSON.parse(String((fetchMock.mock.calls[0]![1] as RequestInit).body));
    expect(request).toMatchObject({
      clientId: unassessed.clientId,
      formVersionReference: "manual-adaptation-v1",
    });
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("reuses the same idempotency key after an unknown network result", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error("offline"));
    vi.stubGlobal("fetch", fetchMock);
    renderUnassessed();
    fillQuickCreate();
    submitQuickCreate();
    await screen.findByText(/操作結果未知/u);
    submitQuickCreate();
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(idempotencyHeader(fetchMock.mock.calls[1]!))
      .toBe(idempotencyHeader(fetchMock.mock.calls[0]!));
  });

  it("rotates the idempotency key after editing uncertain content", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error("offline"));
    vi.stubGlobal("fetch", fetchMock);
    renderUnassessed();
    fillQuickCreate();
    submitQuickCreate();
    await screen.findByText(/操作結果未知/u);
    fireEvent.change(screen.getByLabelText("人工評估摘要"), {
      target: { value: "修改後的合成人工摘要" },
    });
    submitQuickCreate();
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(idempotencyHeader(fetchMock.mock.calls[1]!))
      .not.toBe(idempotencyHeader(fetchMock.mock.calls[0]!));
  });

  it("does not accept a forged client receipt as success", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(
      JSON.stringify(successEnvelope({
        clientId: "32300000-0000-4000-8000-000000000099",
      })),
      { status: 201, headers: { "Content-Type": "application/json" } },
    )));
    renderUnassessed();
    fillQuickCreate();
    submitQuickCreate();
    await screen.findByText(/操作結果未知/u);
    expect(screen.queryByText(/已確認完成/u)).toBeNull();
  });

  it("disables signing until recent AAL2 reauthentication exists", () => {
    render(<AdaptationAssessmentActions canManage canSign hasRecentAal2={false}
      item={draft} snapshot={formal} />);
    fireEvent.click(screen.getByText("簽署評估", { selector: "summary" }));
    expect(screen.getByRole("button", { name: "簽署評估" }))
      .toHaveProperty("disabled", true);
    expect(screen.getByRole("alert").textContent).toMatch(/最近 15 分鐘/u);
  });

  it("announces staleness and resets for a newer snapshot boundary", async () => {
    const { rerender } = render(<AdaptationAssessmentFreshness demo={false}
      staleAfter={new Date(Date.now() - 1_000).toISOString()} />);
    await screen.findByRole("status");
    rerender(<AdaptationAssessmentFreshness demo={false}
      staleAfter={new Date(Date.now() + 60_000).toISOString()} />);
    await waitFor(() => expect(screen.queryByRole("status")).toBeNull());
    expect(screen.getByText("資料為目前快照")).toBeDefined();
  });
});
