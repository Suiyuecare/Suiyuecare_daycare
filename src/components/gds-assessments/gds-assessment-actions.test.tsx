// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { getPageBySlug } from "@/lib/catalog";
import { buildDemoGdsAssessmentSnapshot } from "@/lib/gds-assessments/demo";
import { GDS_QUESTIONS, GDS_QUESTION_SOURCE } from "@/lib/gds-assessments/types";

import { GdsAssessmentActions } from "./gds-assessment-actions";
import { GdsAssessmentsWorkspace } from "./gds-assessments-workspace";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

const demo = buildDemoGdsAssessmentSnapshot();
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
  return render(<GdsAssessmentActions
    canManage
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
      ruleVersionId: "gds-15-strict-complete-v1",
      governanceStatus: "candidate_unactivated",
      previewStatus: "incomplete",
      previewCandidatePoints: null,
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

describe("GDS assessment client boundary", () => {
  it("keeps synthetic actions visibly read-only", () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    render(<GdsAssessmentActions canManage
      item={demo.items[0]!} snapshot={demo} />);
    expect(screen.getByRole("button", { name: "展示唯讀" }))
      .toHaveProperty("disabled", true);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("renders candidate governance and unavailable boundaries", () => {
    const page = getPageBySlug("staff/assessments/gds")!;
    render(<GdsAssessmentsWorkspace
      canManage={false}
      filters={{ clientId: null, previewStatus: "all", answerState: "all" }}
      page={page}
      snapshot={demo}
    />);
    expect(screen.getByRole("heading", { level: 1, name: "GDS 老人憂鬱量表" }))
      .toBeDefined();
    expect(screen.getByText(/仍待雙人核准/u)).toBeDefined();
    expect(screen.getByText(/正式簽署、風險分類與照顧決策/u)).toBeDefined();
    expect(screen.getByText(/附件、匯出、離線同步與通知/u)).toBeDefined();
    expect(screen.getAllByText(/不是正式風險分類/u).length).toBeGreaterThan(0);
  });

  it("shows all fifteen source questions and starts with unanswered states", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(
      JSON.stringify(successEnvelope()),
      { status: 201, headers: { "Content-Type": "application/json" } },
    ));
    vi.stubGlobal("fetch", fetchMock);
    renderCreate();
    openCreate();
    expect(screen.getByText(/已鎖定個案/u).closest("p")?.textContent)
      .toContain(unassessed.clientDisplayName);
    expect(screen.getAllByRole("combobox", { name: /第 \d+ 題回答/u }))
      .toHaveLength(15);
    for (const question of GDS_QUESTIONS) expect(screen.getByText(question)).toBeDefined();
    expect(screen.getByText(new RegExp(GDS_QUESTION_SOURCE, "u"))).toBeDefined();
    expect(screen.getAllByRole("option", { name: "是" })).toHaveLength(15);
    expect(screen.getAllByRole("option", { name: "否" })).toHaveLength(15);
    expect(screen.queryByRole("option", { name: "不適用" })).toBeNull();
    submitCreate();
    await screen.findByText(/已確認保存/u);
    const body = JSON.parse(String(
      (fetchMock.mock.calls[0]![1] as RequestInit).body,
    ));
    expect(body.clientId).toBe(unassessed.clientId);
    expect(body.assessedOn).toBe(currentTaipeiDate());
    expect(Object.values(body.answers)).toEqual(
      Array.from({ length: 15 }, () => ({ state: "missing" })),
    );
    expect(body).not.toHaveProperty("formalRisk");
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("allows only standard yes/no answers plus the unanswered state", () => {
    renderCreate();
    openCreate();
    expect(screen.getByLabelText(/第 1 題回答/u)).toHaveProperty("value", "missing");
    expect(screen.queryByRole("option", { name: "不適用" })).toBeNull();
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
    fireEvent.change(screen.getByLabelText(/第 1 題回答/u), {
      target: { value: "yes" },
    });
    submitCreate();
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(idempotencyHeader(fetchMock.mock.calls[1]!))
      .not.toBe(idempotencyHeader(fetchMock.mock.calls[0]!));
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

  it("allows an unsigned candidate draft without second-factor reauthentication", () => {
    renderCreate();
    openCreate();
    expect(screen.getByRole("button", { name: "保存候選草稿" }))
      .toHaveProperty("disabled", false);
    expect(screen.queryByText(/最近 15 分鐘/u)).toBeNull();
    expect(screen.getByRole("button", { name: /正式簽署/u }))
      .toHaveProperty("disabled", true);
  });
});
