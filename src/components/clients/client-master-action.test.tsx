// @vitest-environment jsdom

import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import type { ClientMasterItem } from "@/lib/clients/master-types";
import { ClientFetchTimeoutError } from "@/lib/api/client-fetch";
import { hasPendingOperations, tryAcquireViewTransition } from "@/lib/navigation/pending-operation-lock";

import { ClientMasterAction } from "./client-master-action";

const operationLocks = vi.hoisted(() => ({ releases: [] as (() => void)[] }));
vi.mock("@/lib/navigation/pending-operation-lock", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/navigation/pending-operation-lock")>();
  return {
    ...actual,
    tryAcquirePendingOperation: () => {
      const release = actual.tryAcquirePendingOperation();
      if (release) operationLocks.releases.push(release);
      return release;
    },
  };
});

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

const localClient: ClientMasterItem = {
  id: "60000000-0000-4000-8000-000000000001",
  clientCode: "LOCAL-001",
  displayName: "王O安",
  dateOfBirth: "1948-03-12",
  status: "active",
  serviceState: "active",
  admittedOn: "2026-01-08",
  endedOn: null,
  sourceSystem: "local",
  sourceAuthority: "local",
  sourceUpdatedAt: null,
  rowVersion: 3,
  updatedAt: "2026-09-01T03:00:00.000Z",
  editable: true,
  editBlockReason: null,
};

beforeAll(() => {
  Object.defineProperty(HTMLDialogElement.prototype, "showModal", {
    configurable: true,
    value() {
      this.setAttribute("open", "");
    },
  });
  Object.defineProperty(HTMLDialogElement.prototype, "close", {
    configurable: true,
    value() {
      this.removeAttribute("open");
      this.dispatchEvent(new Event("close"));
    },
  });
});

afterEach(() => {
  cleanup();
  for (const release of operationLocks.releases.splice(0)) release();
  vi.unstubAllGlobals();
});

describe("client master action accessibility boundaries", () => {
  it("keeps synthetic demo actions visibly read-only", () => {
    render(
      <ClientMasterAction
        canManage
        demo
        hasRecentAal2
        instance="demo"
        kind="create"
        today="2026-09-01"
      />,
    );
    const button = screen.getByRole("button", {
      name: /新增本機個案：展示模式不寫入任何資料/u,
    });
    expect((button as HTMLButtonElement).disabled).toBe(true);
  });

  it("explains and blocks central authority edits", () => {
    render(
      <ClientMasterAction
        canManage
        client={{
          ...localClient,
          sourceSystem: "central_html",
          sourceAuthority: "central",
          editable: false,
          editBlockReason: "central_authority",
        }}
        demo={false}
        hasRecentAal2
        instance="central"
        kind="edit"
        today="2026-09-01"
      />,
    );
    const button = screen.getByRole("button", {
      name: /中央主權欄位只能經受治理的中央匯入更新/u,
    });
    expect((button as HTMLButtonElement).disabled).toBe(true);
  });

  it("blocks create without view-all while preserving an authorized edit", () => {
    const { rerender } = render(
      <ClientMasterAction
        canCreate={false}
        canManage
        demo={false}
        hasRecentAal2
        instance="create-scope"
        kind="create"
        today="2026-09-01"
      />,
    );
    expect(screen.getByRole("button", { name: /clients.view_all/u })).toHaveProperty(
      "disabled",
      true,
    );
    rerender(
      <ClientMasterAction
        canCreate={false}
        canManage
        client={localClient}
        demo={false}
        hasRecentAal2
        instance="edit-scope"
        kind="edit"
        today="2026-09-01"
      />,
    );
    expect(screen.getByRole("button", { name: "編輯本機欄位" })).toHaveProperty(
      "disabled",
      false,
    );
  });

  it("explains that the combined form is disabled without demographic field authority", () => {
    render(
      <ClientMasterAction
        canManage={false}
        client={localClient}
        demo={false}
        hasRecentAal2
        instance="no-demographics"
        kind="edit"
        today="2026-09-01"
      />,
    );
    expect(
      screen.getByRole("button", {
        name: /此表單包含生日欄位.*clients\.demographics\.read/u,
      }),
    ).toHaveProperty("disabled", true);
  });

  it("opens the local-field dialog with an explicit server-owned boundary", () => {
    render(
      <ClientMasterAction
        canManage
        client={localClient}
        demo={false}
        hasRecentAal2
        instance="local"
        kind="edit"
        today="2026-09-01"
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "編輯本機欄位" }));
    const dialog = screen.getByRole("dialog", { name: "編輯本機欄位" });
    expect(dialog.hasAttribute("open")).toBe(true);
    expect(screen.getByText(/機構、分支、建立人、來源、服務狀態、密文識別碼與資料版本均由伺服器決定/u)).toBeTruthy();
    expect(screen.getByLabelText(/個案代碼/u)).toHaveProperty("value", "LOCAL-001");
  });

  it("keeps empty and invalid fields in the dialog with inline errors and no request", () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    render(<ClientMasterAction canManage demo={false} hasRecentAal2 instance="validation" kind="create" today="2026-09-28" />);
    fireEvent.click(screen.getByRole("button", { name: "新增本機個案" }));
    const form = screen.getByRole("dialog").querySelector("form")!;
    expect(form.noValidate).toBe(true);
    fireEvent.submit(form);
    const code = screen.getByLabelText<HTMLInputElement>(/個案代碼/u);
    expect(code.getAttribute("aria-invalid")).toBe("true");
    expect(document.activeElement).toBe(code);
    expect(fetchMock).not.toHaveBeenCalled();

    fireEvent.change(code, { target: { value: "LOCAL-NEW" } });
    fireEvent.change(screen.getByLabelText("顯示姓名 *"), { target: { value: "合成新個案" } });
    fireEvent.change(screen.getByLabelText("出生日期"), { target: { value: "2026-09-29" } });
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.submit(form);
    const date = screen.getByLabelText<HTMLInputElement>("出生日期");
    expect(date.getAttribute("aria-invalid")).toBe("true");
    expect(document.activeElement).toBe(date);
    expect(code.value).toBe("LOCAL-NEW");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("restores focus to the exact trigger after the dialog closes", () => {
    render(
      <ClientMasterAction
        canManage
        client={localClient}
        demo={false}
        hasRecentAal2
        instance="focus-return"
        kind="edit"
        today="2026-09-01"
      />,
    );
    const trigger = screen.getByRole("button", { name: "編輯本機欄位" });
    trigger.focus();
    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole("button", { name: "關閉" }));
    expect(document.activeElement).toBe(trigger);
  });

  it("keeps a malformed 2xx open, pins the original body and key, and cannot edit into a new write", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          requestId: "60000000-0000-4000-8000-000000000010",
          status: "ok",
          data: {
            operationId: "60000000-0000-4000-8000-000000000011",
            clientId: crypto.randomUUID(),
            rowVersion: 4,
            replayed: false,
            persisted: true,
            demo: false,
          },
          errors: [],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);
    render(
      <ClientMasterAction
        canManage
        client={localClient}
        demo={false}
        hasRecentAal2
        instance="malformed"
        kind="edit"
        today="2026-09-01"
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "編輯本機欄位" }));
    const dialog = screen.getByRole("dialog", { name: "編輯本機欄位" });
    const form = dialog.querySelector("form");
    expect(form).not.toBeNull();
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.submit(form!);
    expect((await screen.findByRole("alert")).textContent).toMatch(
      /伺服器回覆不完整/u,
    );
    expect(dialog.hasAttribute("open")).toBe(true);
    const firstKey = new Headers(fetchMock.mock.calls[0]?.[1]?.headers).get(
      "Idempotency-Key",
    );
    expect(firstKey).toMatch(/^[0-9a-f-]{36}$/u);

    fireEvent.submit(form!);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    const retryKey = new Headers(fetchMock.mock.calls[1]?.[1]?.headers).get(
      "Idempotency-Key",
    );
    expect(retryKey).toBe(firstKey);

    fireEvent.change(screen.getByLabelText(/顯示姓名/u), {
      target: { value: "王O安（更正）" },
    });
    fireEvent.submit(form!);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
    const editedKey = new Headers(fetchMock.mock.calls[2]?.[1]?.headers).get(
      "Idempotency-Key",
    );
    expect(editedKey).toBe(firstKey);
    expect(fetchMock.mock.calls[2]?.[1]?.body).toBe(fetchMock.mock.calls[0]?.[1]?.body);
    expect(screen.getByLabelText(/顯示姓名/u).matches(":disabled")).toBe(true);
    expect(screen.getByRole("button", { name: "取消" })).toHaveProperty("disabled", true);
    const unload = new Event("beforeunload", { cancelable: true });
    fireEvent(window, unload);
    expect(unload.defaultPrevented).toBe(true);
  });

  it("prevents Escape, backdrop, and buttons from closing while a request is pending", async () => {
    const fetchMock = vi.fn(
      () => new Promise<Response>(() => undefined),
    );
    vi.stubGlobal("fetch", fetchMock);
    render(
      <ClientMasterAction
        canManage
        client={localClient}
        demo={false}
        hasRecentAal2
        instance="pending"
        kind="edit"
        today="2026-09-01"
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "編輯本機欄位" }));
    const dialog = screen.getByRole("dialog", { name: "編輯本機欄位" });
    const form = dialog.querySelector("form");
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.submit(form!);
    fireEvent.submit(form!);
    await screen.findByRole("button", { name: "確認中…" });
    expect(fetchMock).toHaveBeenCalledOnce();

    const cancelEvent = new Event("cancel", {
      bubbles: true,
      cancelable: true,
    });
    dialog.dispatchEvent(cancelEvent);
    expect(cancelEvent.defaultPrevented).toBe(true);
    fireEvent.click(dialog);
    expect(dialog.hasAttribute("open")).toBe(true);
    expect(screen.getByRole("button", { name: "取消" })).toHaveProperty(
      "disabled",
      true,
    );
    expect(screen.getByRole("button", { name: "關閉" })).toHaveProperty(
      "disabled",
      true,
    );
  });

  it("treats a stalled response body as unknown without changing the original operation", async () => {
    vi.useFakeTimers();
    try {
      const response = new Response("{}", { status: 200 });
      vi.spyOn(response, "json").mockImplementation(() => new Promise<unknown>(() => undefined));
      const fetchMock = vi.fn().mockResolvedValue(response);
      vi.stubGlobal("fetch", fetchMock);
      render(<ClientMasterAction canManage client={localClient} demo={false} hasRecentAal2 instance="body-timeout" kind="edit" today="2026-09-28" />);
      fireEvent.click(screen.getByRole("button", { name: "編輯本機欄位" }));
      const form = screen.getByRole("dialog").querySelector("form")!;
      fireEvent.click(screen.getByRole("checkbox"));
      fireEvent.submit(form);
      await act(async () => { await vi.advanceTimersByTimeAsync(20_000); });
      expect(screen.getByRole("alert").textContent).toContain("原操作結果仍不明");
      expect(screen.getByRole("button", { name: "重試確認原操作" })).toBeTruthy();
      expect(screen.getByRole("button", { name: "取消" })).toHaveProperty("disabled", true);
      expect(hasPendingOperations()).toBe(true);
      expect(fetchMock).toHaveBeenCalledOnce();
    } finally {
      vi.useRealTimers();
    }
  });

  it("unlocks only a structured first-attempt rejection so a corrected draft gets a new key", async () => {
    const firstRejection = Response.json({
      requestId: "60000000-0000-4000-8000-000000000010",
      status: "error",
      data: null,
      errors: [{ code: "INVALID_CLIENT_MASTER", message: "請修正個案代碼。" }],
    }, { status: 400 });
    const secondRejection = Response.json({
      requestId: "60000000-0000-4000-8000-000000000011",
      status: "error",
      data: null,
      errors: [{ code: "INVALID_CLIENT_MASTER", message: "仍需核對個案代碼。" }],
    }, { status: 400 });
    const fetchMock = vi.fn().mockResolvedValueOnce(firstRejection).mockResolvedValueOnce(secondRejection);
    vi.stubGlobal("fetch", fetchMock);
    render(<ClientMasterAction canManage demo={false} hasRecentAal2 instance="known-rejection" kind="create" today="2026-09-28" />);
    fireEvent.click(screen.getByRole("button", { name: "新增本機個案" }));
    const form = screen.getByRole("dialog").querySelector("form")!;
    fireEvent.change(screen.getByLabelText("個案代碼 *"), { target: { value: "LOCAL-DRAFT" } });
    fireEvent.change(screen.getByLabelText("顯示姓名 *"), { target: { value: "合成新個案" } });
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.submit(form);
    expect((await screen.findByRole("alert")).textContent).toContain("請修正個案代碼");
    expect(hasPendingOperations()).toBe(false);
    const code = screen.getByLabelText<HTMLInputElement>("個案代碼 *");
    expect(code.matches(":disabled")).toBe(false);
    expect(code.value).toBe("LOCAL-DRAFT");
    const firstKey = new Headers(fetchMock.mock.calls[0]?.[1]?.headers).get("Idempotency-Key");

    fireEvent.change(code, { target: { value: "LOCAL-CORRECTED" } });
    fireEvent.submit(form);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(new Headers(fetchMock.mock.calls[1]?.[1]?.headers).get("Idempotency-Key")).not.toBe(firstKey);
    expect(JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body)).client_code).toBe("LOCAL-CORRECTED");
    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(hasPendingOperations()).toBe(false);
  });

  it("keeps the original operation after timeout, 409, and 403; another client and the shared view lock cannot create a new write", async () => {
    const rejected = (status: number, code: string) => Response.json({
      requestId: "60000000-0000-4000-8000-000000000010",
      status: "error",
      data: null,
      errors: [{ code, message: "請核對原操作。" }],
    }, { status });
    const fetchMock = vi.fn()
      .mockRejectedValueOnce(new ClientFetchTimeoutError(20_000))
      .mockResolvedValueOnce(rejected(409, "CLIENT_MASTER_VERSION_CONFLICT"))
      .mockResolvedValueOnce(rejected(403, "AAL2_REQUIRED"));
    vi.stubGlobal("fetch", fetchMock);
    const { rerender } = render(<ClientMasterAction canManage client={localClient} demo={false} hasRecentAal2 instance="unknown" kind="edit" today="2026-09-28" />);
    fireEvent.click(screen.getByRole("button", { name: "編輯本機欄位" }));
    const form = screen.getByRole("dialog").querySelector("form")!;
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.submit(form);
    await screen.findByRole("button", { name: "重試確認原操作" });
    expect(hasPendingOperations()).toBe(true);
    expect(tryAcquireViewTransition()).toBeNull();
    const originalBody = fetchMock.mock.calls[0]?.[1]?.body;
    const originalKey = new Headers(fetchMock.mock.calls[0]?.[1]?.headers).get("Idempotency-Key");

    rerender(<ClientMasterAction canManage client={{ ...localClient, id: crypto.randomUUID() }} demo={false} hasRecentAal2 instance="unknown" kind="edit" today="2026-09-28" />);
    fireEvent.submit(form);
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(await screen.findByText(/原個案範圍已變更/u)).toBeTruthy();

    rerender(<ClientMasterAction canManage client={localClient} demo={false} hasRecentAal2 instance="unknown" kind="edit" today="2026-09-28" />);
    fireEvent.submit(form);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    fireEvent.submit(form);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
    expect(fetchMock.mock.calls.every((call) => call[1]?.body === originalBody)).toBe(true);
    expect(fetchMock.mock.calls.every((call) => new Headers(call[1]?.headers).get("Idempotency-Key") === originalKey)).toBe(true);
    expect(hasPendingOperations()).toBe(true);
    expect(screen.getByRole("link", { name: /重新完成雙因素驗證/u }).getAttribute("target")).toBe("_blank");
  });
});
