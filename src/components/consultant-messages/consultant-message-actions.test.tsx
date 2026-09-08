// @vitest-environment jsdom

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
  ConsultantMessageItem,
  ConsultantRecipientOption,
} from "@/lib/consultant-messages/types";

import {
  ConsultantMessageCreateAction,
  ConsultantMessageReceiptAction,
} from "./consultant-message-actions";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

const recipientId = "76200000-0000-4000-8000-000000000001";
const messageId = "76200000-0000-4000-8000-000000000002";
const requestId = "76200000-0000-4000-8000-000000000003";
const operationId = "76200000-0000-4000-8000-000000000004";
const keyA = "76200000-0000-4000-8000-000000000005";
const keyB = "76200000-0000-4000-8000-000000000006";

const recipients: ConsultantRecipientOption[] = [{
  userId: recipientId,
  displayName: "範例顧問",
  employeeCode: "DEMO-PRO",
  profileKind: "professional",
  roleNames: ["專業顧問"],
}];

const message: ConsultantMessageItem = {
  messageId,
  category: "consultant",
  subject: "顧問討論",
  body: "請於系統內確認。",
  occurredAt: "2026-09-02T01:00:00.000Z",
  publishedAt: "2026-09-02T01:01:00.000Z",
  authorDisplayName: "範例社工",
  authorProfileKind: "staff",
  recipientCount: 1,
  readCount: 0,
  confirmedCount: 0,
  actorIsRecipient: true,
  actorReadAt: null,
  actorConfirmedAt: null,
  attachmentCount: 0,
  recipients: [{
    ...recipients[0]!,
    readAt: null,
    confirmedAt: null,
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

function renderCreate(overrides: Partial<Parameters<typeof ConsultantMessageCreateAction>[0]> = {}) {
  return render(
    <ConsultantMessageCreateAction
      canManage
      demo={false}
      recipients={recipients}
      {...overrides}
    />,
  );
}

function fillCreate(dialog: HTMLElement) {
  fireEvent.change(within(dialog).getByLabelText("主旨 *"), {
    target: { value: "顧問討論" },
  });
  fireEvent.change(within(dialog).getByLabelText("發生時間（台北）*"), {
    target: { value: "2026-09-02T09:00" },
  });
  fireEvent.change(within(dialog).getByLabelText("訊息內容 *"), {
    target: { value: "請登入系統查看。" },
  });
  fireEvent.click(within(dialog).getByRole("checkbox", { name: /範例顧問/u }));
}

function createSuccess() {
  return new Response(JSON.stringify({
    requestId,
    status: "ok",
    data: {
      action: "create",
      operationId,
      messageId,
      category: "consultant",
      recipientCount: 1,
      publishedAt: "2026-09-02T01:01:00.000Z",
      persisted: true,
      demo: false,
      replayed: false,
    },
    errors: [],
  }), { status: 201, headers: { "content-type": "application/json" } });
}

describe("consultant message create UI boundary", () => {
  it("keeps demo read-only and exposes no file, path, or URL attachment input", () => {
    const { container } = renderCreate({ demo: true, canManage: false });
    const button = screen.getByRole("button", { name: /新增顧問訊息：展示模式/u });
    expect(button).toHaveProperty("disabled", true);
    expect(button.getAttribute("title")).toContain("展示模式");
    expect(container.querySelector('input[type="file"]')).toBeNull();
    expect(container.querySelector('input[type="url"]')).toBeNull();
    expect(screen.getByText(/不提供檔案、網址或裝置路徑欄位/u)).toBeDefined();
  });

  it("locks editable fields while a request is pending", async () => {
    vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>(() => undefined)));
    renderCreate();
    fireEvent.click(screen.getByRole("button", { name: "新增顧問訊息" }));
    const dialog = screen.getByRole("dialog", { name: "新增顧問訊息" });
    fillCreate(dialog);
    fireEvent.click(within(dialog).getByRole("button", { name: "建立訊息" }));
    await screen.findByRole("button", { name: "建立中…" });
    expect(dialog.querySelector("fieldset")).toHaveProperty("disabled", true);
    expect(within(dialog).getByRole("button", { name: "取消" }))
      .toHaveProperty("disabled", true);
  });

  it("reuses the operation key for an unchanged unknown result and rotates after editing", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error("offline"));
    vi.stubGlobal("fetch", fetchMock);
    renderCreate();
    fireEvent.click(screen.getByRole("button", { name: "新增顧問訊息" }));
    const dialog = screen.getByRole("dialog", { name: "新增顧問訊息" });
    fillCreate(dialog);
    const submit = within(dialog).getByRole("button", { name: "建立訊息" });
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
      target: { value: "顧問討論更新" },
    });
    fireEvent.click(submit);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
    const third = new Headers((fetchMock.mock.calls[2]![1] as RequestInit).headers)
      .get("Idempotency-Key");
    expect(third).toBe(keyB);
  });

  it("closes only after an exact persisted receipt and restores focus", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(createSuccess()));
    renderCreate();
    const trigger = screen.getByRole("button", { name: "新增顧問訊息" });
    fireEvent.click(trigger);
    const dialog = screen.getByRole("dialog", { name: "新增顧問訊息" });
    fillCreate(dialog);
    fireEvent.click(within(dialog).getByRole("button", { name: "建立訊息" }));
    await waitFor(() => expect(dialog.hasAttribute("open")).toBe(false));
    expect(document.activeElement).toBe(trigger);
    expect(screen.getByRole("status").textContent).toContain(requestId);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("keeps the dialog open and shows request correlation for a forged 2xx", async () => {
    const forged = createSuccess();
    const body = await forged.json();
    body.data.recipientCount = 2;
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(
      JSON.stringify(body),
      { status: 201, headers: { "content-type": "application/json" } },
    )));
    renderCreate();
    fireEvent.click(screen.getByRole("button", { name: "新增顧問訊息" }));
    const dialog = screen.getByRole("dialog", { name: "新增顧問訊息" });
    fillCreate(dialog);
    fireEvent.click(within(dialog).getByRole("button", { name: "建立訊息" }));
    await waitFor(() => expect(within(dialog).getByRole("alert").textContent)
      .toContain(requestId));
    expect(dialog.hasAttribute("open")).toBe(true);
    expect(refresh).not.toHaveBeenCalled();
  });
});

describe("consultant message receipt UI boundary", () => {
  it("shows an honest permission reason and never calls fetch", () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    render(<ConsultantMessageReceiptAction
      action="read" canReceive={false} demo={false} message={message}
    />);
    const button = screen.getByRole("button", { name: /沒有 consultant_messages.receive/u });
    expect(button).toHaveProperty("disabled", true);
    fireEvent.click(button);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("accepts only a correlated in-app confirmation receipt", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      requestId,
      status: "ok",
      data: {
        operationId,
        messageId,
        category: "consultant",
        action: "confirm",
        readAt: "2026-09-02T01:02:00.000Z",
        confirmedAt: "2026-09-02T01:02:00.000Z",
        persisted: true,
        demo: false,
        replayed: false,
      },
      errors: [],
    }), { status: 200, headers: { "content-type": "application/json" } })));
    render(<ConsultantMessageReceiptAction
      action="confirm" canReceive demo={false} message={message}
    />);
    fireEvent.click(screen.getByRole("button", { name: "確認訊息" }));
    await waitFor(() => expect(screen.getByRole("status").textContent)
      .toContain(requestId));
    expect(refresh).toHaveBeenCalledTimes(1);
  });
});
