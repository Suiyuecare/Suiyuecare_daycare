// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import type { ClientToccOption } from "@/lib/client-tocc/types";

import { ClientToccComposer } from "./client-tocc-composer";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

const clients: ClientToccOption[] = [
  {
    id: "a1111111-1111-4111-8111-111111111111",
    code: "C-001",
    name: "王O安",
    clientStatus: "active",
    admittedOn: "2026-01-01",
    endedOn: null,
    canRecord: true,
  },
  {
    id: "a2222222-2222-4222-8222-222222222222",
    code: "C-002",
    name: "林O心",
    clientStatus: "active",
    admittedOn: null,
    endedOn: null,
    canRecord: false,
  },
];

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

describe("client TOCC composer boundaries", () => {
  it("keeps demo single and batch writes visibly disabled", () => {
    render(
      <ClientToccComposer clients={clients} demo enabled today="2026-09-01" />,
    );
    expect(
      (screen.getByRole("button", { name: /新增 TOCC：展示模式只讀/u }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    expect(
      (screen.getByRole("button", { name: /批次登錄：展示模式只讀/u }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
  });

  it("opens the batch flow with per-row fields and disables pending admission", () => {
    render(
      <ClientToccComposer clients={clients} demo={false} enabled today="2026-09-01" />,
    );
    fireEvent.click(screen.getByRole("button", { name: "批次登錄" }));
    expect(
      screen
        .getByRole("dialog", { name: "批次登錄個案 TOCC" })
        .hasAttribute("open"),
    ).toBe(true);
    const options = screen.getAllByRole("option", { name: /目前不可新增/u });
    expect(options.length).toBeGreaterThan(0);
    expect(options.every((option) => (option as HTMLOptionElement).disabled)).toBe(true);
    expect(screen.getByText(/不會自動診斷或改變照顧決策/u)).toBeTruthy();
  });

  it("starts a one-client batch with one row instead of a duplicate", () => {
    render(
      <ClientToccComposer clients={[clients[0]!]} demo={false} enabled today="2026-09-01" />,
    );
    fireEvent.click(screen.getByRole("button", { name: "批次登錄" }));
    expect(screen.getByText("第 1 筆")).toBeTruthy();
    expect(screen.queryByText("第 2 筆")).toBeNull();
  });

  it("keeps the dialog open when a 2xx single result is malformed", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            requestId: "request-1",
            status: "ok",
            data: { persisted: true, demo: false },
            errors: [],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      ),
    );
    render(
      <ClientToccComposer clients={[clients[0]!]} demo={false} enabled today="2026-09-01" />,
    );
    fireEvent.click(screen.getByRole("button", { name: "新增 TOCC" }));
    fireEvent.click(screen.getByRole("button", { name: "簽署並建立版本" }));
    await waitFor(() => {
      expect(screen.getByRole("alert").textContent).toMatch(/API 回應未完整確認/u);
    });
    expect(
      screen.getByRole("dialog", { name: "新增個案 TOCC" }).hasAttribute("open"),
    ).toBe(true);
  });

  it("prevents Escape cancellation while a signed request is pending", async () => {
    let resolveResponse: ((response: Response) => void) | undefined;
    vi.stubGlobal(
      "fetch",
      vi.fn().mockReturnValue(
        new Promise<Response>((resolve) => {
          resolveResponse = resolve;
        }),
      ),
    );
    render(
      <ClientToccComposer clients={[clients[0]!]} demo={false} enabled today="2026-09-01" />,
    );
    fireEvent.click(screen.getByRole("button", { name: "新增 TOCC" }));
    fireEvent.click(screen.getByRole("button", { name: "簽署並建立版本" }));
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "送出中…" })).toBeTruthy();
    });
    const dialog = screen.getByRole("dialog", { name: "新增個案 TOCC" });
    const cancel = new Event("cancel", { cancelable: true });
    expect(dialog.dispatchEvent(cancel)).toBe(false);
    expect(dialog.hasAttribute("open")).toBe(true);
    resolveResponse?.(
      new Response(
        JSON.stringify({ status: "error", data: null, errors: [] }),
        { status: 409, headers: { "Content-Type": "application/json" } },
      ),
    );
    await waitFor(() => expect(screen.getByRole("alert")).toBeTruthy());
  });

  it("keeps keyboard focus inside the modal dialog", () => {
    render(
      <ClientToccComposer clients={[clients[0]!]} demo={false} enabled today="2026-09-01" />,
    );
    fireEvent.click(screen.getByRole("button", { name: "新增 TOCC" }));
    const dialog = screen.getByRole("dialog", { name: "新增個案 TOCC" });
    const close = screen.getByRole("button", { name: "關閉" });
    const submit = screen.getByRole("button", { name: "簽署並建立版本" });

    close.focus();
    fireEvent.keyDown(dialog, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(submit);

    fireEvent.keyDown(dialog, { key: "Tab" });
    expect(document.activeElement).toBe(close);
  });

  it("accepts 207 partial and shows a localized next action with request ID", async () => {
    const requestId = "e1111111-1111-4111-8111-111111111111";
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(async (_url: string, init: RequestInit) => {
        const request = JSON.parse(String(init.body)) as {
          items: Array<{ idempotency_key: string }>;
        };
        return new Response(
          JSON.stringify({
            requestId,
            status: "partial",
            data: {
              items: [
                {
                  itemIndex: 1,
                  itemIdempotencyKey: request.items[0]!.idempotency_key,
                  status: "failed",
                  assessmentId: null,
                  assessmentVersion: null,
                  validThrough: null,
                  itemReplayed: false,
                  batchReplayed: false,
                  error: {
                    code: "internal_error",
                    sqlstate: "XX000",
                    retryable: false,
                  },
                },
              ],
              counts: { total: 1, success: 0, failed: 1 },
              persisted: true,
              demo: false,
            },
            errors: [
              {
                code: "CLIENT_TOCC_ITEM_INTERNAL_ERROR",
                message: "此項目未確認完成，未回傳敏感錯誤內容。",
                field: "items.0",
              },
            ],
          }),
          { status: 207, headers: { "Content-Type": "application/json" } },
        );
      }),
    );
    render(
      <ClientToccComposer clients={[clients[0]!]} demo={false} enabled today="2026-09-01" />,
    );
    fireEvent.click(screen.getByRole("button", { name: "批次登錄" }));
    fireEvent.click(screen.getByRole("button", { name: "送出 1 筆" }));
    await waitFor(() => {
      expect(screen.getByText(new RegExp(requestId, "u")).textContent).toMatch(
        /結果未確認，請保留內容並提供請求識別碼/u,
      );
    });
    expect(screen.getByRole("button", { name: "重試未完成 1 筆" })).toBeTruthy();
  });
});
