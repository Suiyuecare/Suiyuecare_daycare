// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import type {
  CareCommunicationClientOption,
  CareCommunicationItem,
} from "@/lib/care-communications/types";

import {
  CareCommunicationCorrectionAction,
  CareCommunicationCreateAction,
} from "./care-communication-actions";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

const clientId = "43400000-0000-4000-8000-000000000001";
const communicationKey = "43c00000-0000-4000-8000-000000000001";
const versionId = "43b00000-0000-4000-8000-000000000001";
const correctedVersionId = "43b00000-0000-4000-8000-000000000002";
const requestId = "43800000-0000-4000-8000-000000000001";
const operationId = "43700000-0000-4000-8000-000000000001";
const keyA = "43900000-0000-4000-8000-000000000001";
const keyB = "43900000-0000-4000-8000-000000000002";

const clients: CareCommunicationClientOption[] = [{
  clientId,
  displayName: "合成個案甲",
  clientCode: "CARE-43-A",
  authorizedFamilyCount: 1,
}];

const item: CareCommunicationItem = {
  versionId,
  communicationKey,
  version: 1,
  previousVersionId: null,
  recordKind: "original",
  category: "care_communication",
  direction: "staff_to_family",
  clientId,
  clientDisplayName: "合成個案甲",
  clientCode: "CARE-43-A",
  subject: "今日照顧摘要",
  body: "請登入系統查看。",
  occurredAt: "2026-09-02T01:00:00.000Z",
  submittedAt: "2026-09-02T01:01:00.000Z",
  authorDisplayName: "範例社工",
  authorProfileKind: "staff",
  correctionReason: null,
  attachmentState: "none",
  recipientCount: 1,
  deliveryStatus: "queued",
  readStatus: "not_configured",
  familyConfirmationStatus: "not_configured",
  current: true,
  recipients: [{
    displayName: "範例家屬",
    profileKind: "family",
    relationship: "主要聯絡人",
    consentDocumentVersion: "CARE43-v1",
    consentScopes: ["messages.read"],
    consentedAt: "2026-08-01T01:00:00.000Z",
    consentExpiresAt: "2027-08-01T01:00:00.000Z",
  }],
  deliveryEvents: [{
    eventKind: "queued",
    channel: "family_pwa",
    providerWorkerStatus: "not_configured",
    familyConsumerStatus: "not_configured",
    offlineConsumerStatus: "not_configured",
    occurredAt: "2026-09-02T01:01:00.000Z",
  }],
};

beforeAll(() => {
  Object.defineProperty(HTMLDialogElement.prototype, "showModal", {
    configurable: true,
    value() { this.setAttribute("open", ""); },
  });
  Object.defineProperty(HTMLDialogElement.prototype, "close", {
    configurable: true,
    value() {
      this.removeAttribute("open");
      this.dispatchEvent(new Event("close"));
    },
  });
});

beforeEach(() => {
  const sequence = [keyA, keyB];
  vi.stubGlobal("crypto", {
    randomUUID: vi.fn(() => sequence.shift() ?? keyB),
  });
});

afterEach(() => {
  cleanup();
  refresh.mockClear();
  vi.unstubAllGlobals();
});

function renderCreate(
  overrides: Partial<Parameters<typeof CareCommunicationCreateAction>[0]> = {},
) {
  return render(<CareCommunicationCreateAction
    canManage
    clients={clients}
    demo={false}
    hasRecentAal2
    {...overrides}
  />);
}

function fillCreate(dialog: HTMLElement) {
  fireEvent.change(within(dialog).getByLabelText("個案 *"), {
    target: { value: clientId },
  });
  fireEvent.change(within(dialog).getByLabelText("主旨 *"), {
    target: { value: "今日照顧摘要" },
  });
  fireEvent.change(within(dialog).getByLabelText("發生時間（台北）*"), {
    target: { value: "2026-09-02T09:00" },
  });
  fireEvent.change(within(dialog).getByLabelText("訊息內容 *"), {
    target: { value: "請登入系統查看。" },
  });
}

function successData(overrides: Record<string, unknown> = {}) {
  return {
    requestId,
    status: "ok",
    data: {
      action: "create",
      operationId,
      communicationKey,
      versionId,
      communicationVersion: 1,
      previousVersionId: null,
      recordKind: "original",
      clientId,
      recipientCount: 1,
      deliveryStatus: "queued",
      readStatus: "not_configured",
      familyConfirmationStatus: "not_configured",
      attachmentState: "none",
      submittedAt: "2026-09-02T01:01:00.000Z",
      persisted: true,
      demo: false,
      replayed: false,
      ...overrides,
    },
    errors: [],
  };
}

describe("care communication create UI boundary", () => {
  it("keeps demo and missing-consent states read-only with no attachment input", () => {
    const { container, rerender } = renderCreate({ demo: true });
    expect(screen.getByRole("button", { name: /新增待送紀錄：展示模式唯讀/u }))
      .toBeDisabled();
    expect(container.querySelector('input[type="file"]')).toBeNull();
    expect(container.querySelector('input[type="url"]')).toBeNull();
    expect(screen.getByText(/不提供檔案、網址或裝置路徑欄位/u))
      .toBeInTheDocument();

    rerender(<CareCommunicationCreateAction
      canManage
      clients={[{ ...clients[0]!, authorizedFamilyCount: 0 }]}
      demo={false}
      hasRecentAal2
    />);
    expect(screen.getByRole("button", { name: /沒有具 messages\.read 授權/u }))
      .toBeDisabled();
  });

  it("locks fields while a write result is pending", async () => {
    vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>(() => undefined)));
    renderCreate();
    fireEvent.click(screen.getByRole("button", { name: "新增待送紀錄" }));
    const dialog = screen.getByRole("dialog", { name: "新增照顧溝通紀錄" });
    fillCreate(dialog);
    fireEvent.click(within(dialog).getByRole("button", { name: "建立待送紀錄" }));
    await screen.findByRole("button", { name: "建立中…" });
    expect(dialog.querySelector("fieldset")).toBeDisabled();
    expect(within(dialog).getByRole("button", { name: "取消" })).toBeDisabled();
  });

  it("reuses the operation key for an unchanged unknown result and rotates after editing", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error("offline"));
    vi.stubGlobal("fetch", fetchMock);
    renderCreate();
    fireEvent.click(screen.getByRole("button", { name: "新增待送紀錄" }));
    const dialog = screen.getByRole("dialog", { name: "新增照顧溝通紀錄" });
    fillCreate(dialog);
    const submit = within(dialog).getByRole("button", { name: "建立待送紀錄" });
    fireEvent.click(submit);
    await screen.findByText(/網路結果不明/u);
    fireEvent.click(submit);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    const first = new Headers((fetchMock.mock.calls[0]![1] as RequestInit).headers)
      .get("Idempotency-Key");
    const second = new Headers((fetchMock.mock.calls[1]![1] as RequestInit).headers)
      .get("Idempotency-Key");
    expect(first).toBe(keyA);
    expect(second).toBe(first);
    fireEvent.change(within(dialog).getByLabelText("主旨 *"), {
      target: { value: "今日照顧摘要更新" },
    });
    fireEvent.click(submit);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
    const third = new Headers((fetchMock.mock.calls[2]![1] as RequestInit).headers)
      .get("Idempotency-Key");
    expect(third).toBe(keyB);
  });

  it("closes only after an exact queued receipt and names the unproven states", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(
      JSON.stringify(successData()),
      { status: 201, headers: { "content-type": "application/json" } },
    )));
    renderCreate();
    const trigger = screen.getByRole("button", { name: "新增待送紀錄" });
    fireEvent.click(trigger);
    const dialog = screen.getByRole("dialog", { name: "新增照顧溝通紀錄" });
    fillCreate(dialog);
    fireEvent.click(within(dialog).getByRole("button", { name: "建立待送紀錄" }));
    await waitFor(() => expect(dialog.hasAttribute("open")).toBe(false));
    expect(document.activeElement).toBe(trigger);
    expect(screen.getByRole("status")).toHaveTextContent("尚未送達、已讀或確認");
    expect(screen.getByRole("status")).toHaveTextContent(requestId);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("keeps the dialog open for a forged delivered 2xx receipt", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(
      JSON.stringify(successData({ deliveryStatus: "delivered" })),
      { status: 201, headers: { "content-type": "application/json" } },
    )));
    renderCreate();
    fireEvent.click(screen.getByRole("button", { name: "新增待送紀錄" }));
    const dialog = screen.getByRole("dialog", { name: "新增照顧溝通紀錄" });
    fillCreate(dialog);
    fireEvent.click(within(dialog).getByRole("button", { name: "建立待送紀錄" }));
    await waitFor(() => expect(within(dialog).getByRole("alert"))
      .toHaveTextContent(requestId));
    expect(dialog).toHaveAttribute("open");
    expect(refresh).not.toHaveBeenCalled();
  });
});

describe("care communication correction UI boundary", () => {
  it("submits an exact current-version correction and preserves lineage", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(
      JSON.stringify(successData({
        action: "correct",
        versionId: correctedVersionId,
        communicationVersion: 2,
        previousVersionId: versionId,
        recordKind: "correction",
      })),
      { status: 201, headers: { "content-type": "application/json" } },
    )));
    render(<CareCommunicationCorrectionAction
      canCorrect demo={false} hasRecentAal2 item={item}
    />);
    fireEvent.click(screen.getByRole("button", { name: /為 今日照顧摘要 建立更正/u }));
    const dialog = screen.getByRole("dialog", { name: "建立第 2 版更正" });
    fireEvent.change(within(dialog).getByLabelText("訊息內容 *"), {
      target: { value: "補充活動地點。" },
    });
    fireEvent.change(within(dialog).getByLabelText("更正理由 *"), {
      target: { value: "補充活動地點" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "建立更正版" }));
    await waitFor(() => expect(dialog.hasAttribute("open")).toBe(false));
    const fetchMock = vi.mocked(fetch);
    const request = JSON.parse(String(fetchMock.mock.calls[0]![1]?.body));
    expect(request).toMatchObject({
      action: "correct",
      clientId,
      communicationKey,
      previousVersionId: versionId,
      expectedVersion: 1,
      correctionReason: "補充活動地點",
      attachments: [],
    });
    expect(screen.getByRole("status")).toHaveTextContent("原紀錄仍保留");
  });
});
