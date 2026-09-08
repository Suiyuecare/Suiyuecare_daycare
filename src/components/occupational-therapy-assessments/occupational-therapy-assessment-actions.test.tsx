// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { buildDemoOccupationalTherapyAssessmentSnapshot } from "@/lib/occupational-therapy-assessments/demo";

import {
  OccupationalTherapyAssessmentActions,
  OccupationalTherapyAssessmentFreshness,
} from "./occupational-therapy-assessment-actions";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

const demo = buildDemoOccupationalTherapyAssessmentSnapshot();
const formal = { ...demo, demo: false as const };
const unassessed = formal.items.find((item) => item.versionId === null)!;
const signed = formal.items.find((item) => item.recordState === "signed")!;
const draft = {
  ...signed,
  recordState: "draft" as const,
  signedAt: null,
  signerDisplayName: null,
  assessmentVersion: 1,
};

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

function openAndFillCreate() {
  fireEvent.click(screen.getByText("開始新評估草稿", { selector: "summary" }));
  fireEvent.change(screen.getByLabelText("人工輸入複評期限"), {
    target: { value: "2200-01-01" },
  });
  fireEvent.change(screen.getByLabelText("期限來源／依據"), {
    target: { value: "人工排定：合成會議紀錄" },
  });
  fireEvent.change(screen.getByLabelText("項目名稱"), {
    target: { value: "桌面活動持續時間" },
  });
  fireEvent.change(screen.getByLabelText("資料狀態"), {
    target: { value: "numeric" },
  });
  fireEvent.change(screen.getByLabelText("精確數值"), {
    target: { value: "12.50" },
  });
  fireEvent.change(screen.getByLabelText("單位"), {
    target: { value: "分鐘" },
  });
  fireEvent.change(screen.getByLabelText("功能觀察"), {
    target: { value: "合成人工功能觀察" },
  });
  fireEvent.change(screen.getByLabelText("人工設定目標"), {
    target: { value: "合成人工目標" },
  });
  fireEvent.change(screen.getByLabelText("專業建議"), {
    target: { value: "合成人工專業建議" },
  });
  fireEvent.change(screen.getByLabelText("追蹤計畫"), {
    target: { value: "合成人工追蹤計畫" },
  });
}

function submitCreate() {
  fireEvent.click(screen.getByRole("button", { name: "開始新評估草稿" }));
}

function idempotencyHeader(call: unknown[]) {
  const headers = (call[1] as RequestInit).headers as Record<string, string>;
  return headers["idempotency-key"];
}

function successEnvelope(overrides: Record<string, unknown> = {}) {
  return {
    requestId: "28900000-0000-4000-8000-000000000099",
    status: "ok",
    data: {
      action: "create_draft",
      operationId: "28700000-0000-4000-8000-000000000091",
      clientId: unassessed.clientId,
      assessmentKey: "28500000-0000-4000-8000-000000000091",
      versionId: "28600000-0000-4000-8000-000000000091",
      assessmentVersion: 1,
      recordState: "draft",
      assessedOn: currentTaipeiDate(),
      therapistUserId: "28280000-0000-4000-8000-000000000001",
      serviceStatusAtAssessment: "suspended",
      reassessmentDueOn: "2200-01-01",
      formVersionReference: "manual-occupational-therapy-v1",
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
  return render(<OccupationalTherapyAssessmentActions
    canManage
    canSign
    hasRecentAal2
    item={unassessed}
    snapshot={formal}
  />);
}

describe("occupational therapy assessment client write boundary", () => {
  it("keeps every synthetic action visibly disabled", () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    render(<OccupationalTherapyAssessmentActions
      canManage
      canSign
      hasRecentAal2
      item={demo.items[0]!}
      snapshot={demo}
    />);
    expect(screen.getByRole("button", { name: /展示唯讀/u }))
      .toHaveProperty("disabled", true);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("locks create to the exact row client and sends all manual fields", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(
      JSON.stringify(successEnvelope()),
      { status: 201, headers: { "Content-Type": "application/json" } },
    ));
    vi.stubGlobal("fetch", fetchMock);
    renderUnassessed();
    openAndFillCreate();
    expect(screen.getByText(/已鎖定個案/u).closest("p")?.textContent)
      .toContain(unassessed.clientDisplayName);
    submitCreate();
    await screen.findByText(/已確認完成/u);
    const requestBody = JSON.parse(String(
      (fetchMock.mock.calls[0]![1] as RequestInit).body,
    ));
    expect(requestBody).toEqual({
      action: "create_draft",
      clientId: unassessed.clientId,
      assessedOn: currentTaipeiDate(),
      reassessmentDueOn: "2200-01-01",
      dueBasis: "人工排定：合成會議紀錄",
      measurements: [{
        name: "桌面活動持續時間",
        state: "numeric",
        value: "12.50",
        unit: "分鐘",
        reason: null,
      }],
      functionalObservation: "合成人工功能觀察",
      goals: "合成人工目標",
      recommendations: "合成人工專業建議",
      followUpPlan: "合成人工追蹤計畫",
      formVersionReference: "manual-occupational-therapy-v1",
    });
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("expresses missing separately and requires a reason field in the UI", () => {
    renderUnassessed();
    fireEvent.click(screen.getByText("開始新評估草稿", { selector: "summary" }));
    fireEvent.change(screen.getByLabelText("資料狀態"), {
      target: { value: "missing" },
    });
    expect(screen.getByLabelText("缺值理由")).toHaveProperty("required", true);
    expect(screen.queryByLabelText("精確數值")).toBeNull();
  });

  it("reuses the same idempotency key after an unknown network result", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error("fetch offline"));
    vi.stubGlobal("fetch", fetchMock);
    renderUnassessed();
    openAndFillCreate();
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
    renderUnassessed();
    openAndFillCreate();
    submitCreate();
    await screen.findByText(/結果未知/u);
    fireEvent.change(screen.getByLabelText("功能觀察"), {
      target: { value: "修改後合成人工功能觀察" },
    });
    submitCreate();
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(idempotencyHeader(fetchMock.mock.calls[1]!))
      .not.toBe(idempotencyHeader(fetchMock.mock.calls[0]!));
  });

  it("does not accept a forged client or widened receipt as success", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(
      JSON.stringify(successEnvelope({
        clientId: "28300000-0000-4000-8000-000000000099",
        clinicalScore: 9,
      })),
      { status: 201, headers: { "Content-Type": "application/json" } },
    )));
    renderUnassessed();
    openAndFillCreate();
    submitCreate();
    await screen.findByText(/操作結果未知/u);
    expect(screen.queryByText(/已確認完成/u)).toBeNull();
    expect(refresh).not.toHaveBeenCalled();
  });

  it("disables signing until recent AAL2 exists", () => {
    render(<OccupationalTherapyAssessmentActions
      canManage
      canSign
      hasRecentAal2={false}
      item={draft}
      snapshot={formal}
    />);
    fireEvent.click(screen.getByText("簽署評估", { selector: "summary" }));
    expect(screen.getByRole("button", { name: "簽署評估" }))
      .toHaveProperty("disabled", true);
    expect(screen.getByRole("alert").textContent).toMatch(/最近 15 分鐘/u);
  });

  it("announces stale data and resets for a newer snapshot", async () => {
    const { rerender } = render(<OccupationalTherapyAssessmentFreshness
      demo={false}
      staleAfter={new Date(Date.now() - 1_000).toISOString()}
    />);
    await screen.findByRole("status");
    rerender(<OccupationalTherapyAssessmentFreshness
      demo={false}
      staleAfter={new Date(Date.now() + 60_000).toISOString()}
    />);
    await waitFor(() => expect(screen.queryByRole("status")).toBeNull());
    expect(screen.getByText("資料為目前快照")).toBeDefined();
  });
});
