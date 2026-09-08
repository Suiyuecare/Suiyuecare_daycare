// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { buildDemoPushNotificationManagementSnapshot } from "@/lib/push-notifications/demo";

import { PushNotificationComposer } from "./push-notification-composer";

const routerRefresh = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: routerRefresh }),
}));

const snapshot = buildDemoPushNotificationManagementSnapshot(
  new Date("2026-09-01T02:00:00.000Z"),
);

describe("PushNotificationComposer", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    routerRefresh.mockReset();
  });

  afterEach(() => cleanup());

  it("shows unsupported providers and family recipients as disabled with no fake retry", () => {
    render(
      <PushNotificationComposer
        demo
        previewEnabled
        queueEnabled={false}
        recipients={snapshot.recipients}
      />,
    );
    expect(screen.getByRole("checkbox", { name: /PWA 推播/u })).toBeDisabled();
    expect(screen.getByRole("checkbox", { name: /LINE/u })).toBeDisabled();
    expect(screen.getByRole("checkbox", { name: /簡訊/u })).toBeDisabled();
    expect(screen.getByRole("checkbox", { name: /家屬收件/u })).toBeDisabled();
    expect(
      screen.queryByRole("button", { name: /重試失敗/u }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "確認建立站內通知" }),
    ).toBeDisabled();
  });

  it("renders a server-verified demo preview but keeps queue disabled", async () => {
    const recipient = snapshot.recipients[0]!;
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          requestId: "45c00000-0000-4000-8000-000000000001",
          status: "ok",
          data: {
            mode: "preview",
            preview: {
              organizationId: snapshot.organizationId,
              branchId: snapshot.branchId,
              generatedAt: snapshot.generatedAt,
              recipients: [
                {
                  userId: recipient.userId,
                  displayName: recipient.displayName,
                  profileKind: recipient.profileKind,
                },
              ],
              recipientCount: 1,
              channel: "in_app",
              deliveryCount: 1,
              scheduled: false,
              persisted: false,
              demo: true,
            },
            queued: false,
            persisted: false,
            demo: true,
          },
          errors: [],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );
    render(
      <PushNotificationComposer
        demo
        previewEnabled
        queueEnabled={false}
        recipients={snapshot.recipients}
      />,
    );

    fireEvent.change(screen.getByLabelText("主旨"), {
      target: { value: "工作安排已更新" },
    });
    fireEvent.change(screen.getByLabelText(/^內容/u), {
      target: { value: "請登入系統查看最新內容。" },
    });
    fireEvent.click(screen.getByRole("checkbox", { name: new RegExp(recipient.displayName, "u") }));
    fireEvent.click(screen.getByRole("button", { name: "預覽實際收件者" }));

    await waitFor(() => {
      expect(screen.getByText("實際收件者 1 人・站內佇列 1 筆")).toBeInTheDocument();
    });
    expect(screen.getAllByText(recipient.displayName).length).toBeGreaterThan(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toMatchObject({
      mode: "preview",
      channels: ["in_app"],
      recipient_user_ids: [recipient.userId],
    });
    expect(
      screen.getByRole("button", { name: "確認建立站內通知" }),
    ).toBeDisabled();
    expect(screen.queryByText(/已持久化建立/u)).not.toBeInTheDocument();
  });

  it("fails closed on a malformed success envelope", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          requestId: "45c00000-0000-4000-8000-000000000001",
          status: "ok",
          data: { queued: true, persisted: true },
          errors: [],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );
    render(
      <PushNotificationComposer
        demo={false}
        previewEnabled
        queueEnabled
        recipients={snapshot.recipients}
      />,
    );
    fireEvent.change(screen.getByLabelText("主旨"), {
      target: { value: "工作安排已更新" },
    });
    fireEvent.change(screen.getByLabelText(/^內容/u), {
      target: { value: "請登入系統查看最新內容。" },
    });
    fireEvent.click(
      screen.getByRole("checkbox", {
        name: new RegExp(snapshot.recipients[0]!.displayName, "u"),
      }),
    );
    fireEvent.click(screen.getByRole("button", { name: "預覽實際收件者" }));
    await waitFor(() => {
      expect(
        screen.getByText("無法完成預覽；系統未建立通知。"),
      ).toBeInTheDocument();
    });
    expect(screen.queryByText(/已持久化建立/u)).not.toBeInTheDocument();
  });

  it("locks an uncertain queue and retries with the exact idempotency key", async () => {
    const recipient = snapshot.recipients[0]!;
    const previewResponse = () =>
      new Response(
        JSON.stringify({
          requestId: "45c00000-0000-4000-8000-000000000001",
          status: "ok",
          data: {
            mode: "preview",
            preview: {
              organizationId: snapshot.organizationId,
              branchId: snapshot.branchId,
              generatedAt: snapshot.generatedAt,
              recipients: [
                {
                  userId: recipient.userId,
                  displayName: recipient.displayName,
                  profileKind: recipient.profileKind,
                },
              ],
              recipientCount: 1,
              channel: "in_app",
              deliveryCount: 1,
              scheduled: false,
              persisted: false,
              demo: false,
            },
            queued: false,
            persisted: false,
            demo: false,
          },
          errors: [],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    const uncertainResponse = () =>
      new Response(
        JSON.stringify({
          requestId: "45c00000-0000-4000-8000-000000000002",
          status: "error",
          data: null,
          errors: [
            {
              code: "PUSH_NOTIFICATION_QUEUE_FAILED",
              message: "通知與站內收件佇列未確認完成；請保留相同冪等鍵重試。",
            },
          ],
        }),
        { status: 409, headers: { "Content-Type": "application/json" } },
      );
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(previewResponse())
      .mockResolvedValueOnce(uncertainResponse())
      .mockResolvedValueOnce(uncertainResponse());

    render(
      <PushNotificationComposer
        demo={false}
        previewEnabled
        queueEnabled
        recipients={snapshot.recipients}
      />,
    );
    fireEvent.change(screen.getByLabelText("主旨"), {
      target: { value: "工作安排已更新" },
    });
    fireEvent.change(screen.getByLabelText(/^內容/u), {
      target: { value: "請登入系統查看最新內容。" },
    });
    fireEvent.click(
      screen.getByRole("checkbox", {
        name: new RegExp(recipient.displayName, "u"),
      }),
    );
    fireEvent.click(screen.getByRole("button", { name: "預覽實際收件者" }));
    await screen.findByText("實際收件者 1 人・站內佇列 1 筆");
    fireEvent.click(
      screen.getByRole("checkbox", { name: /我確認收件者/u }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "確認建立站內通知" }),
    );

    const retry = await screen.findByRole("button", {
      name: "以相同內容與冪等鍵重試",
    });
    expect(screen.getByLabelText("主旨")).toBeDisabled();
    const firstQueueHeaders = fetchMock.mock.calls[1]?.[1]?.headers as Record<
      string,
      string
    >;
    fireEvent.click(retry);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
    const retryHeaders = fetchMock.mock.calls[2]?.[1]?.headers as Record<
      string,
      string
    >;
    expect(retryHeaders["Idempotency-Key"]).toBe(
      firstQueueHeaders["Idempotency-Key"],
    );
  });
});
