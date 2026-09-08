// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { buildDemoNotificationCenterSnapshot } from "@/lib/notification-center/demo";

import { NotificationAcknowledgementAction } from "./notification-acknowledgement-action";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

const snapshot = buildDemoNotificationCenterSnapshot(
  new Date("2026-09-01T10:00:00.000Z"),
);
const confirmationItem = snapshot.items.find(
  (item) => item.requiresConfirmation && item.confirmedAt === null,
)!;
const readItem = snapshot.items.find(
  (item) => !item.requiresConfirmation && item.status === "queued",
)!;

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

function successEnvelope(replayed = false) {
  return {
    requestId: "67c00000-0000-4000-8000-000000000001",
    status: "ok",
    data: {
      operationId: "67c00000-0000-4000-8000-000000000002",
      deliveryId: confirmationItem.deliveryId,
      notificationId: confirmationItem.notificationId,
      status: "confirmed",
      readAt: "2026-09-01T10:00:00.000Z",
      confirmedAt: "2026-09-01T10:00:00.000Z",
      acknowledgedAt: "2026-09-01T10:00:00.000Z",
      replayed,
      persisted: true,
      demo: false,
    },
    errors: [],
  };
}

describe("notification acknowledgement browser boundary", () => {
  it("keeps demo notification actions visibly read-only and never calls fetch", () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    render(
      <NotificationAcknowledgementAction
        disabledReason="展示模式只讀，不會寫入已讀或確認狀態"
        enabled={false}
        instance="desktop"
        item={readItem}
      />,
    );

    const button = screen.getByRole("button", {
      name: /標示已讀：展示模式只讀/u,
    });
    expect(button).toHaveProperty("disabled", true);
    expect(button.getAttribute("title")).toContain("展示模式只讀");
    fireEvent.click(button);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("keeps a malformed 2xx confirmation open and reports its request id", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            ...successEnvelope(),
            data: {
              ...successEnvelope().data,
              deliveryId: "67c00000-0000-4000-8000-000000000099",
            },
          }),
          { status: 201, headers: { "Content-Type": "application/json" } },
        ),
      ),
    );
    render(
      <NotificationAcknowledgementAction
        enabled
        instance="desktop"
        item={confirmationItem}
      />,
    );
    fireEvent.click(
      screen.getByRole("button", { name: "確認最高優先通知" }),
    );
    const dialog = screen.getByRole("dialog", {
      name: "確認最高優先通知",
    });
    fireEvent.click(
      screen.getByRole("button", { name: "確認並留下收據" }),
    );

    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toMatch(
        /伺服器回覆不完整.*67c00000-0000-4000-8000-000000000001/u,
      ),
    );
    expect(dialog.hasAttribute("open")).toBe(true);
  });

  it("closes an exact persisted confirmation and restores focus", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(successEnvelope()), {
        status: 201,
        headers: { "Content-Type": "application/json" },
      }),
    );
    vi.stubGlobal(
      "fetch",
      fetchMock,
    );
    render(
      <NotificationAcknowledgementAction
        enabled
        instance="desktop"
        item={confirmationItem}
      />,
    );
    const trigger = screen.getByRole("button", {
      name: "確認最高優先通知",
    });
    fireEvent.click(trigger);
    const dialog = screen.getByRole("dialog", {
      name: "確認最高優先通知",
    });
    fireEvent.click(
      screen.getByRole("button", { name: "確認並留下收據" }),
    );

    await waitFor(() => expect(dialog.hasAttribute("open")).toBe(false));
    await waitFor(() => expect(document.activeElement).toBe(trigger));
    expect(screen.getByRole("status").textContent).toBe("已確認通知。");
    expect(trigger.getAttribute("aria-disabled")).toBe("true");
    fireEvent.click(trigger);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("keeps a valid request id visible when an error envelope is malformed", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            requestId: "67c00000-0000-4000-8000-000000000009",
            status: "error",
            data: null,
            errors: [],
          }),
          { status: 409, headers: { "Content-Type": "application/json" } },
        ),
      ),
    );
    render(
      <NotificationAcknowledgementAction
        enabled
        instance="desktop"
        item={readItem}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "標示已讀" }));
    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toMatch(
        /67c00000-0000-4000-8000-000000000009/u,
      ),
    );
  });

  it("locks confirmation controls and blocks cancellation while pending", async () => {
    vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>(() => undefined)));
    render(
      <NotificationAcknowledgementAction
        enabled
        instance="desktop"
        item={confirmationItem}
      />,
    );
    fireEvent.click(
      screen.getByRole("button", { name: "確認最高優先通知" }),
    );
    const dialog = screen.getByRole("dialog", {
      name: "確認最高優先通知",
    });
    fireEvent.click(
      screen.getByRole("button", { name: "確認並留下收據" }),
    );
    await screen.findByRole("button", { name: "確認中…" });

    const cancel = new Event("cancel", { cancelable: true });
    expect(dialog.dispatchEvent(cancel)).toBe(false);
    expect(dialog.hasAttribute("open")).toBe(true);
    expect(screen.getByRole("button", { name: "關閉" })).toHaveProperty(
      "disabled",
      true,
    );
    expect(screen.getByRole("button", { name: "返回" })).toHaveProperty(
      "disabled",
      true,
    );
  });
});
