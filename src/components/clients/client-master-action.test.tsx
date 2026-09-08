// @vitest-environment jsdom

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import type { ClientMasterItem } from "@/lib/clients/master-types";

import { ClientMasterAction } from "./client-master-action";

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

  it("keeps a malformed 2xx open, reuses the retry key, and rotates it only after an edit", async () => {
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
    expect(editedKey).not.toBe(firstKey);
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
    await screen.findByRole("button", { name: "確認中…" });

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
});
