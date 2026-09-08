// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import type { ClientLifecycleClient } from "@/lib/clients/types";

import { ClientTransitionComposer } from "./client-transition-composer";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

const client: ClientLifecycleClient = {
  id: "61000000-0000-4000-8000-000000000001",
  clientCode: "C-001",
  displayName: "王O安",
  status: "active",
  serviceState: "active",
  admittedOn: "2026-01-08",
  endedOn: null,
  rowVersion: 3,
  updatedAt: "2026-09-02T01:00:00.000Z",
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

describe("client transition composer browser boundaries", () => {
  it("keeps a mismatched 2xx open and reuses its key until the user edits", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      requestId: "61000000-0000-4000-8000-000000000002",
      status: "ok",
      data: {
        transition: {
          id: "61000000-0000-4000-8000-000000000003",
          clientId: "61000000-0000-4000-8000-000000000099",
          eventKind: "suspend",
          effectiveOn: "2026-09-02",
          fromStatus: "active",
          toStatus: "suspended",
          baseRowVersion: 3,
          resultingRowVersion: 4,
        },
        replayed: false,
        persisted: true,
        demo: false,
      },
      errors: [],
    }), { status: 201, headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);

    render(
      <ClientTransitionComposer
        canManage
        clients={[client]}
        demo={false}
        hasRecentAal2
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "建立個案異動" }));
    const dialog = screen.getByRole("dialog", { name: "建立個案異動" });
    const form = dialog.querySelector("form");
    expect(form).not.toBeNull();
    fireEvent.change(screen.getByLabelText("生效日期 *"), {
      target: { value: "2026-09-02" },
    });
    fireEvent.change(screen.getByLabelText("異動理由 *"), {
      target: { value: "暫停服務測試" },
    });
    fireEvent.submit(form!);
    expect((await screen.findByRole("alert")).textContent).toMatch(/回覆不完整/u);
    expect(dialog.hasAttribute("open")).toBe(true);
    const firstKey = new Headers(fetchMock.mock.calls[0]?.[1]?.headers).get("Idempotency-Key");

    fireEvent.submit(form!);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    const retryKey = new Headers(fetchMock.mock.calls[1]?.[1]?.headers).get("Idempotency-Key");
    expect(retryKey).toBe(firstKey);

    fireEvent.change(screen.getByLabelText("異動理由 *"), {
      target: { value: "暫停服務測試（更正）" },
    });
    fireEvent.submit(form!);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
    const editedKey = new Headers(fetchMock.mock.calls[2]?.[1]?.headers).get("Idempotency-Key");
    expect(editedKey).not.toBe(firstKey);
  });

  it("locks fields and prevents closing while the outcome is pending", async () => {
    vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>(() => undefined)));
    render(
      <ClientTransitionComposer
        canManage
        clients={[client]}
        demo={false}
        hasRecentAal2
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "建立個案異動" }));
    const dialog = screen.getByRole("dialog", { name: "建立個案異動" });
    const form = dialog.querySelector("form");
    fireEvent.submit(form!);
    await screen.findByRole("button", { name: "建立中…" });

    expect(dialog.querySelector("fieldset")).toHaveProperty("disabled", true);
    const cancel = new Event("cancel", { cancelable: true });
    expect(dialog.dispatchEvent(cancel)).toBe(false);
    expect(screen.getByRole("button", { name: "取消" })).toHaveProperty("disabled", true);
    expect(screen.getByRole("button", { name: "關閉" })).toHaveProperty("disabled", true);
  });

  it("keeps keyboard focus inside the modal", () => {
    render(
      <ClientTransitionComposer
        canManage
        clients={[client]}
        demo={false}
        hasRecentAal2
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "建立個案異動" }));
    const dialog = screen.getByRole("dialog", { name: "建立個案異動" });
    const close = screen.getByRole("button", { name: "關閉" });
    const submit = screen.getByRole("button", { name: "確認暫停服務" });

    close.focus();
    fireEvent.keyDown(dialog, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(submit);
    fireEvent.keyDown(dialog, { key: "Tab" });
    expect(document.activeElement).toBe(close);
  });
});
