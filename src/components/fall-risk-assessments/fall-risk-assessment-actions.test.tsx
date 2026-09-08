// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { getPageBySlug } from "@/lib/catalog";
import { buildDemoFallRiskAssessmentSnapshot } from "@/lib/fall-risk-assessments/demo";

import { FallRiskAssessmentActions } from "./fall-risk-assessment-actions";
import { FallRiskAssessmentsWorkspace } from "./fall-risk-assessments-workspace";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

const demo = buildDemoFallRiskAssessmentSnapshot();
const formal = { ...demo, demo: false as const };
const unassessed = formal.items.find((item) => item.versionId === null)!;

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

function currentTaipeiDate() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(formal.generatedAt));
}

function renderCreate(hasRecentAal2 = true) {
  return render(<FallRiskAssessmentActions
    canManage
    hasRecentAal2={hasRecentAal2}
    item={unassessed}
    snapshot={formal}
  />);
}

function openCreate() {
  fireEvent.click(screen.getByText("開始候選草稿", { selector: "summary" }));
}

function submitCreate() {
  fireEvent.click(screen.getByRole("button", { name: "保存候選草稿" }));
}

function idempotencyHeader(call: unknown[]) {
  const headers = (call[1] as RequestInit).headers as Record<string, string>;
  return headers["idempotency-key"];
}

function successEnvelope(overrides: Record<string, unknown> = {}) {
  return {
    requestId: "12900000-0000-4000-8000-000000000099",
    status: "ok",
    data: {
      action: "create_draft",
      operationId: "12700000-0000-4000-8000-000000000091",
      clientId: unassessed.clientId,
      assessmentKey: "12500000-0000-4000-8000-000000000091",
      versionId: "12600000-0000-4000-8000-000000000091",
      assessmentVersion: 1,
      recordState: "draft_preview",
      assessedOn: currentTaipeiDate(),
      authorUserId: "12400000-0000-4000-8000-000000000091",
      serviceStatusAtAssessment: "suspended",
      ruleVersionId: "fall-risk-manual-factors-candidate-v1",
      governanceStatus: "candidate_unactivated",
      previewStatus: "incomplete",
      previewCandidatePoints: null,
      previewBandKey: null,
      contentHash: "a".repeat(64),
      committedAt: new Date().toISOString(),
      replayed: false,
      persisted: true,
      demo: false,
      ...overrides,
    },
    errors: [],
  };
}

describe("fall-risk candidate assessment client boundary", () => {
  it("keeps synthetic actions visibly read-only", () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    render(<FallRiskAssessmentActions canManage hasRecentAal2
      item={demo.items[0]!} snapshot={demo} />);
    expect(screen.getByRole("button", { name: "展示唯讀" }))
      .toHaveProperty("disabled", true);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("renders candidate governance and unavailable boundaries", () => {
    const page = getPageBySlug("staff/assessments/fall-risk")!;
    render(<FallRiskAssessmentsWorkspace
      canManage={false}
      filters={{ clientId: null, previewStatus: "all", answerState: "all" }}
      hasRecentAal2={false}
      page={page}
      snapshot={demo}
    />);
    expect(screen.getByRole("heading", { level: 1, name: "跌倒風險評估" }))
      .toBeDefined();
    expect(screen.getByText(/仍待雙人核准/u)).toBeDefined();
    expect(screen.getByText(/正式簽署、風險分類與照顧決策/u)).toBeDefined();
    expect(screen.getByText(/待辦建議規則、附件、匯出/u)).toBeDefined();
    expect(screen.getAllByText(/不是正式風險分級/u).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/未建立、自動生效或通知任何待辦/u).length)
      .toBeGreaterThan(0);
  });

  it("locks create to the exact row client and starts with six missing states", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(
      JSON.stringify(successEnvelope()),
      { status: 201, headers: { "Content-Type": "application/json" } },
    ));
    vi.stubGlobal("fetch", fetchMock);
    renderCreate();
    openCreate();
    expect(screen.getByText(/已鎖定個案/u).closest("p")?.textContent)
      .toContain(unassessed.clientDisplayName);
    expect(screen.getAllByRole("combobox", { name: /人工觀察：.+答案狀態/u }))
      .toHaveLength(6);
    submitCreate();
    await screen.findByText(/已確認保存/u);
    const body = JSON.parse(String(
      (fetchMock.mock.calls[0]![1] as RequestInit).body,
    ));
    expect(body.clientId).toBe(unassessed.clientId);
    expect(body.assessedOn).toBe(currentTaipeiDate());
    expect(Object.values(body.answers)).toEqual(
      Array.from({ length: 6 }, () => ({ state: "missing" })),
    );
    expect(body).not.toHaveProperty("formalRisk");
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("shows and sends a separate not-applicable reason", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(
      JSON.stringify(successEnvelope()),
      { status: 201, headers: { "Content-Type": "application/json" } },
    ));
    vi.stubGlobal("fetch", fetchMock);
    renderCreate();
    openCreate();
    fireEvent.change(screen.getByLabelText("人工觀察：近期跌倒或近跌事件答案狀態"), {
      target: { value: "not_applicable" },
    });
    const reason = screen.getByLabelText(
      "人工觀察：近期跌倒或近跌事件不適用理由",
    );
    fireEvent.change(reason, { target: { value: "合成測試：本次不適用。" } });
    submitCreate();
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const body = JSON.parse(String(
      (fetchMock.mock.calls[0]![1] as RequestInit).body,
    ));
    expect(body.answers.fall_factor_01).toEqual({
      state: "not_applicable",
      reason: "合成測試：本次不適用。",
    });
  });

  it("reuses one idempotency key after an unknown network result", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error("fetch offline"));
    vi.stubGlobal("fetch", fetchMock);
    renderCreate();
    openCreate();
    submitCreate();
    await screen.findByText(/結果未知/u);
    submitCreate();
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(idempotencyHeader(fetchMock.mock.calls[1]!))
      .toBe(idempotencyHeader(fetchMock.mock.calls[0]!));
  });

  it("rotates idempotency after uncertain content changes", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error("fetch offline"));
    vi.stubGlobal("fetch", fetchMock);
    renderCreate();
    openCreate();
    submitCreate();
    await screen.findByText(/結果未知/u);
    fireEvent.change(screen.getByLabelText("人工觀察：近期跌倒或近跌事件答案狀態"), {
      target: { value: "present" },
    });
    submitCreate();
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(idempotencyHeader(fetchMock.mock.calls[1]!))
      .not.toBe(idempotencyHeader(fetchMock.mock.calls[0]!));
  });

  it("keeps the same key after a structured 502 until the content changes", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      requestId: "12900000-0000-4000-8000-000000000098",
      status: "error",
      data: null,
      errors: [{
        code: "FALL_RISK_SAVE_FAILED",
        message: "結果尚未確認；請保留內容並以相同冪等鍵重試。",
      }],
    }), {
      status: 502,
      headers: { "Content-Type": "application/json" },
    }));
    vi.stubGlobal("fetch", fetchMock);
    renderCreate();
    openCreate();

    submitCreate();
    await screen.findByText(/結果尚未確認/u);
    submitCreate();
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(idempotencyHeader(fetchMock.mock.calls[1]!))
      .toBe(idempotencyHeader(fetchMock.mock.calls[0]!));

    fireEvent.change(screen.getByLabelText("人工觀察：近期跌倒或近跌事件答案狀態"), {
      target: { value: "present" },
    });
    submitCreate();
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
    expect(idempotencyHeader(fetchMock.mock.calls[2]!))
      .not.toBe(idempotencyHeader(fetchMock.mock.calls[1]!));
  });

  it("does not accept a forged cross-client or formal receipt", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(
      JSON.stringify(successEnvelope({
        clientId: "12300000-0000-4000-8000-000000000099",
        formalRisk: "invented",
      })),
      { status: 201, headers: { "Content-Type": "application/json" } },
    )));
    renderCreate();
    openCreate();
    submitCreate();
    await screen.findByText(/操作結果未知/u);
    expect(refresh).not.toHaveBeenCalled();
  });

  it("disables writes without recent AAL2 and always disables signing", () => {
    renderCreate(false);
    openCreate();
    expect(screen.getByRole("button", { name: "保存候選草稿" }))
      .toHaveProperty("disabled", true);
    expect(screen.getByRole("alert").textContent).toMatch(/最近 15 分鐘/u);
    expect(screen.getByRole("button", { name: /正式簽署/u }))
      .toHaveProperty("disabled", true);
  });
});
