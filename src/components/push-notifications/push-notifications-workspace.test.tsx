// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { getPageBySlug } from "@/lib/catalog";
import { buildDemoPushNotificationManagementSnapshot } from "@/lib/push-notifications/demo";

import { PushNotificationsWorkspace } from "./push-notifications-workspace";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

describe("PushNotificationsWorkspace snapshot time", () => {
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("keeps filter and desktop/mobile status frozen at generatedAt", () => {
    const generatedAt = new Date("2026-09-01T02:00:00.000Z");
    const snapshot = buildDemoPushNotificationManagementSnapshot(generatedAt);
    const page = getPageBySlug("staff/communication/push-notifications");
    expect(page).toBeDefined();

    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-01T06:00:00.000Z"));
    render(
      <PushNotificationsWorkspace
        filters={{
          query: "明日工作安排",
          category: "all",
          status: "scheduled",
          date: null,
        }}
        hasRecentAal2={false}
        page={page!}
        snapshot={snapshot}
      />,
    );

    expect(screen.queryByText("沒有符合條件的建立紀錄")).not.toBeInTheDocument();
    expect(screen.getAllByText("明日工作安排已更新")).toHaveLength(2);
    expect(screen.getAllByText("排程中")).toHaveLength(2);
  });
});
