// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { buildDemoPhysicalTherapyServiceSnapshot } from "@/lib/physical-therapy-services/demo";

import {
  PhysicalTherapyServiceCreateAction,
  PhysicalTherapyServiceFreshness,
  PhysicalTherapyServiceRecordActions,
} from "./physical-therapy-service-actions";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

const demo = buildDemoPhysicalTherapyServiceSnapshot();
const formal = { ...demo, demo: false as const };
const client = formal.clientOptions[0]!;
const draft = formal.records.find((item) => item.recordState === "draft")!;

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

function responseForRequest(init: RequestInit, overrides: Record<string, unknown> = {}) {
  const body = JSON.parse(String(init.body)) as Record<string, unknown>;
  return new Response(JSON.stringify({
    requestId: "34800000-0000-4000-8000-000000000099",
    status: "ok",
    data: {
      action: "create_draft",
      operationId: "34700000-0000-4000-8000-000000000091",
      organizationId: formal.organizationId,
      branchId: formal.branchId,
      clientId: body.clientId,
      recordKey: "34500000-0000-4000-8000-000000000091",
      versionId: "34600000-0000-4000-8000-000000000091",
      recordVersion: 1,
      recordState: "draft",
      occurredAt: body.occurredAt,
      therapistUserId: "34400000-0000-4000-8000-000000000091",
      serviceStatusAtOccurrence: "active",
      assessmentReferenceVersionId: null,
      committedAt: new Date().toISOString(),
      replayed: false,
      persisted: true,
      demo: false,
      ...overrides,
    },
    errors: [],
  }), { status: 201, headers: { "Content-Type": "application/json" } });
}

function renderCreate() {
  return render(<PhysicalTherapyServiceCreateAction
    canManage
    canSign
    hasRecentAal2
    snapshot={formal}
  />);
}

function openAndFillCreate() {
  fireEvent.click(screen.getByText("新增服務草稿", { selector: "summary" }));
  fireEvent.change(screen.getByLabelText("指派個案"), {
    target: { value: client.clientId },
  });
  fireEvent.change(screen.getByLabelText("服務內容內容"), {
    target: { value: "合成服務內容" },
  });
  fireEvent.change(screen.getByLabelText("缺值理由"), {
    target: { value: "合成示例：本次未取得反應" },
  });
  fireEvent.change(screen.getByLabelText("不適用理由"), {
    target: { value: "合成示例：本次沒有新建議" },
  });
}

function submitCreate() {
  fireEvent.click(screen.getByRole("button", { name: "新增服務草稿" }));
}

function idempotencyKey(call: unknown[]) {
  const headers = (call[1] as RequestInit).headers as Record<string, string>;
  return headers["idempotency-key"];
}

describe("physical therapy service client boundary", () => {
  it("keeps synthetic create and record actions visibly disabled", () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    render(<>
      <PhysicalTherapyServiceCreateAction
        canManage canSign hasRecentAal2 snapshot={demo}
      />
      <PhysicalTherapyServiceRecordActions
        canManage canSign hasRecentAal2
        record={demo.records[0]!}
        snapshot={demo}
      />
    </>);
    expect(screen.getAllByRole("button", { name: /展示唯讀/u }))
      .toHaveLength(2);
    expect(screen.getAllByRole("button", { name: /展示唯讀/u })
      .every((button) => button.hasAttribute("disabled"))).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("sends exact explicit values without a browser-selected assessment", async () => {
    const fetchMock = vi.fn().mockImplementation(
      (_input: RequestInfo | URL, init: RequestInit) =>
        Promise.resolve(responseForRequest(init)),
    );
    vi.stubGlobal("fetch", fetchMock);
    renderCreate();
    openAndFillCreate();
    submitCreate();
    await screen.findByText(/已確認完成/u);
    const init = fetchMock.mock.calls[0]![1] as RequestInit;
    const body = JSON.parse(String(init.body));
    expect(body).toMatchObject({
      action: "create_draft",
      clientId: client.clientId,
      serviceContent: {
        state: "recorded", text: "合成服務內容", reason: null,
      },
      clientReaction: {
        state: "missing", text: null, reason: "合成示例：本次未取得反應",
      },
      recommendation: {
        state: "not_applicable", text: null,
        reason: "合成示例：本次沒有新建議",
      },
    });
    expect(body).not.toHaveProperty("assessmentReferenceVersionId");
    expect(body).not.toHaveProperty("attachmentUrl");
    expect(init.headers).toMatchObject({
      "x-physical-therapy-service-operation": "create_draft",
    });
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("changes value editors between recorded missing and not applicable", () => {
    renderCreate();
    fireEvent.click(screen.getByText("新增服務草稿", { selector: "summary" }));
    const stateEditors = screen.getAllByLabelText("資料狀態");
    fireEvent.change(stateEditors[0]!, { target: { value: "missing" } });
    expect(screen.getAllByLabelText("缺值理由")).toHaveLength(2);
    fireEvent.change(stateEditors[0]!, {
      target: { value: "not_applicable" },
    });
    expect(screen.getAllByLabelText("不適用理由")).toHaveLength(2);
  });

  it("reuses the same key after an unknown network result", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error("offline"));
    vi.stubGlobal("fetch", fetchMock);
    renderCreate();
    openAndFillCreate();
    submitCreate();
    await screen.findByText(/結果未知/u);
    submitCreate();
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(idempotencyKey(fetchMock.mock.calls[1]!))
      .toBe(idempotencyKey(fetchMock.mock.calls[0]!));
  });

  it("also preserves the key after a 5xx unknown result", async () => {
    const failure = {
      requestId: "34800000-0000-4000-8000-000000000099",
      status: "error",
      data: null,
      errors: [{
        code: "PHYSICAL_THERAPY_SERVICE_SAVE_FAILED",
        message: "系統尚未確認操作結果",
      }],
    };
    const fetchMock = vi.fn().mockResolvedValue(new Response(
      JSON.stringify(failure),
      { status: 503, headers: { "Content-Type": "application/json" } },
    ));
    vi.stubGlobal("fetch", fetchMock);
    renderCreate();
    openAndFillCreate();
    submitCreate();
    await screen.findByText(/結果未知/u);
    submitCreate();
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(idempotencyKey(fetchMock.mock.calls[1]!))
      .toBe(idempotencyKey(fetchMock.mock.calls[0]!));
  });

  it("rotates the key when content changes after uncertainty", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error("offline"));
    vi.stubGlobal("fetch", fetchMock);
    renderCreate();
    openAndFillCreate();
    submitCreate();
    await screen.findByText(/結果未知/u);
    fireEvent.change(screen.getByLabelText("服務內容內容"), {
      target: { value: "合成服務內容修訂" },
    });
    submitCreate();
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(idempotencyKey(fetchMock.mock.calls[1]!))
      .not.toBe(idempotencyKey(fetchMock.mock.calls[0]!));
  });

  it("does not accept a widened or cross-tenant receipt as success", async () => {
    vi.stubGlobal("fetch", vi.fn().mockImplementation(
      (_input: RequestInfo | URL, init: RequestInit) => Promise.resolve(
        responseForRequest(init, {
          organizationId: "34000000-0000-4000-8000-000000000099",
          diagnosis: "forged",
        }),
      ),
    ));
    renderCreate();
    openAndFillCreate();
    submitCreate();
    await screen.findByText(/結果未知/u);
    expect(screen.queryByText(/已確認完成/u)).toBeNull();
    expect(refresh).not.toHaveBeenCalled();
  });

  it("disables signing until recent same-session AAL2 exists", () => {
    render(<PhysicalTherapyServiceRecordActions
      canManage canSign hasRecentAal2={false}
      record={draft}
      snapshot={formal}
    />);
    fireEvent.click(screen.getByText("簽署服務紀錄", { selector: "summary" }));
    expect(screen.getByRole("button", { name: "簽署服務紀錄" }))
      .toHaveProperty("disabled", true);
    expect(screen.getByRole("alert").textContent).toMatch(/最近 15 分鐘/u);
  });

  it("announces stale data and resets for a newer snapshot", async () => {
    const { rerender } = render(<PhysicalTherapyServiceFreshness
      demo={false}
      staleAfter={new Date(Date.now() - 1_000).toISOString()}
    />);
    await screen.findByRole("status");
    rerender(<PhysicalTherapyServiceFreshness
      demo={false}
      staleAfter={new Date(Date.now() + 60_000).toISOString()}
    />);
    await waitFor(() => expect(screen.queryByRole("status")).toBeNull());
    expect(screen.getByText("資料為目前快照")).toBeDefined();
  });
});
