// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { getPageBySlug } from "@/lib/catalog";
import { buildDemoSpmsqAssessmentSnapshot } from "@/lib/spmsq-assessments/demo";

import {
  SpmsqAssessmentActions,
  SpmsqAssessmentFreshness,
} from "./spmsq-assessment-actions";
import { SpmsqAssessmentsWorkspace } from "./spmsq-assessments-workspace";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

const demo = buildDemoSpmsqAssessmentSnapshot();
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

function renderCreate() {
  return render(<SpmsqAssessmentActions
    canManage
    item={unassessed}
    snapshot={formal}
  />);
}

function openCreate() {
  fireEvent.click(screen.getByText("開始候選草稿", { selector: "summary" }));
}

function submitCreate() {
  fireEvent.click(screen.getByRole("button", { name: "儲存候選草稿" }));
}

function idempotencyHeader(call: unknown[]) {
  const headers = (call[1] as RequestInit).headers as Record<string, string>;
  return headers["idempotency-key"];
}

function successEnvelope(overrides: Record<string, unknown> = {}) {
  return {
    requestId: "11900000-0000-4000-8000-000000000099",
    status: "ok",
    data: {
      action: "create_draft",
      operationId: "11700000-0000-4000-8000-000000000091",
      clientId: unassessed.clientId,
      assessmentKey: "11500000-0000-4000-8000-000000000091",
      versionId: "11600000-0000-4000-8000-000000000091",
      assessmentVersion: 1,
      recordState: "draft_preview",
      assessedOn: currentTaipeiDate(),
      authorUserId: "11400000-0000-4000-8000-000000000091",
      serviceStatusAtAssessment: "suspended",
      ruleVersionId: "spmsq-pfeiffer-10-education-adjusted-v1",
      governanceStatus: "candidate_unactivated",
      previewStatus: "incomplete",
      previewRawErrors: null,
      previewAdjustedErrors: null,
      previewBandKey: null,
      committedAt: new Date().toISOString(),
      replayed: false,
      persisted: true,
      demo: false,
      ...overrides,
    },
    errors: [],
  };
}

describe("SPMSQ assessment client boundary", () => {
  it("keeps synthetic actions visibly read-only", () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    render(<SpmsqAssessmentActions
      canManage
      item={demo.items[0]!}
      snapshot={demo}
    />);
    expect(screen.getByRole("button", { name: /展示唯讀/u }))
      .toHaveProperty("disabled", true);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("renders the candidate-only governance and unavailable boundaries", () => {
    const page = getPageBySlug("staff/assessments/spmsq")!;
    render(<SpmsqAssessmentsWorkspace
      canManage={false}
      filters={{ clientId: null, previewStatus: "all", educationState: "all" }}
      page={page}
      snapshot={demo}
    />);
    expect(screen.getByRole("heading", { level: 1, name: "SPMSQ 評估" }))
      .toBeDefined();
    expect(screen.getByText(/candidate_unactivated/u)).toBeDefined();
    expect(screen.getByText(/不是官方分數、診斷或照顧決策/u)).toBeDefined();
    expect(screen.getByText(/附件、匯出與離線同步/u)).toBeDefined();
    expect(screen.getAllByText(/正式簽署/u).length).toBeGreaterThan(0);
  });

  it("locks create to the exact row client and preserves explicit missing states", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(
      JSON.stringify(successEnvelope()),
      { status: 201, headers: { "Content-Type": "application/json" } },
    ));
    vi.stubGlobal("fetch", fetchMock);
    renderCreate();
    openCreate();
    expect(screen.getByText(/已鎖定個案/u).closest("p")?.textContent)
      .toContain(unassessed.clientDisplayName);
    submitCreate();
    await screen.findByText(/已確認保存/u);
    const body = JSON.parse(String(
      (fetchMock.mock.calls[0]![1] as RequestInit).body,
    ));
    expect(body.clientId).toBe(unassessed.clientId);
    expect(body.assessedOn).toBe(currentTaipeiDate());
    expect(body.educationContext).toEqual({ state: "missing" });
    expect(body.culturalContext).toEqual({ state: "missing" });
    expect(Object.values(body.answers)).toEqual(
      Array.from({ length: 10 }, () => ({ state: "missing" })),
    );
    expect(body).not.toHaveProperty("officialScore");
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
    fireEvent.change(screen.getByLabelText("題位 1 答案狀態"), {
      target: { value: "not_applicable" },
    });
    const reason = screen.getByLabelText("題位 1 不適用理由");
    expect(reason).toHaveProperty("required", true);
    fireEvent.change(reason, { target: { value: "合成測試：本次不適用。" } });
    submitCreate();
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const body = JSON.parse(String(
      (fetchMock.mock.calls[0]![1] as RequestInit).body,
    ));
    expect(body.answers.spmsq_01).toEqual({
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

  it("rotates the idempotency key after uncertain content changes", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error("fetch offline"));
    vi.stubGlobal("fetch", fetchMock);
    renderCreate();
    openCreate();
    submitCreate();
    await screen.findByText(/結果未知/u);
    fireEvent.change(screen.getByLabelText("文化／語言脈絡狀態"), {
      target: { value: "recorded" },
    });
    fireEvent.change(screen.getByLabelText(/^文化／語言脈絡說明/u), {
      target: { value: "合成測試：內容變更。" },
    });
    submitCreate();
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(idempotencyHeader(fetchMock.mock.calls[1]!))
      .not.toBe(idempotencyHeader(fetchMock.mock.calls[0]!));
  });

  it("does not accept a forged official or cross-client receipt as success", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(
      JSON.stringify(successEnvelope({
        clientId: "11300000-0000-4000-8000-000000000099",
        officialScore: 3,
      })),
      { status: 201, headers: { "Content-Type": "application/json" } },
    )));
    renderCreate();
    openCreate();
    submitCreate();
    await screen.findByText(/操作結果未知/u);
    expect(screen.queryByText(/已確認保存/u)).toBeNull();
    expect(refresh).not.toHaveBeenCalled();
  });

  it("allows an unsigned candidate draft without second-factor reauthentication", () => {
    renderCreate();
    openCreate();
    expect(screen.getByRole("button", { name: "儲存候選草稿" }))
      .toHaveProperty("disabled", false);
    expect(screen.queryByText(/最近 15 分鐘/u)).toBeNull();
  });

  it("keeps formal signing visibly disabled even with recent AAL2", () => {
    const versioned = formal.items.find((item) => item.versionId !== null)!;
    render(<SpmsqAssessmentActions
      canManage
      item={versioned}
      snapshot={formal}
    />);
    expect(screen.getByRole("button", { name: "正式簽署未開放" }))
      .toHaveProperty("disabled", true);
  });

  it("announces stale data and resets for a newer snapshot", async () => {
    const { rerender } = render(<SpmsqAssessmentFreshness
      demo={false}
      staleAfter={new Date(Date.now() - 1_000).toISOString()}
    />);
    await screen.findByRole("status");
    rerender(<SpmsqAssessmentFreshness
      demo={false}
      staleAfter={new Date(Date.now() + 60_000).toISOString()}
    />);
    await waitFor(() => expect(screen.queryByRole("status")).toBeNull());
    expect(screen.getByText("資料為目前快照")).toBeDefined();
  });
});
