// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildDemoStaffAnnouncementSnapshot } from "@/lib/staff-announcements/demo";
import { StaffAnnouncementDraftAction, StaffAnnouncementPublishAction, StaffAnnouncementReadAction, StaffAnnouncementWithdrawAction,
  staffAnnouncementDefaultTaipeiLocal } from "./staff-announcement-actions";
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
afterEach(cleanup);
const item = buildDemoStaffAnnouncementSnapshot({ organizationId: "68000000-0000-4000-8000-000000000001", branchId: "68000000-0000-4000-8000-000000000002", selectedReleaseId: null }).items[0];
describe("dumb announcement action triggers", () => {
  it("fails closed without its workspace-level provider and never posts", () => {
    const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
    render(<StaffAnnouncementDraftAction staff={[]} roles={[]} canManage demo={false} />);
    const button = screen.getByRole("button", { name: "建立公告" });
    expect(button.hasAttribute("disabled")).toBe(true); fireEvent.click(button);
    expect(fetch).not.toHaveBeenCalled(); expect(screen.queryByRole("dialog")).toBeNull(); vi.unstubAllGlobals();
  });
  it("retains explicit demo and action-specific eligibility descriptions", () => {
    render(<><StaffAnnouncementDraftAction staff={[]} roles={[]} canManage demo />
      <StaffAnnouncementPublishAction item={item} canPublish hasRecentAal2={false} demo={false} generatedAt="2026-09-26T00:00:00Z" />
      <StaffAnnouncementWithdrawAction item={item} canPublish={false} hasRecentAal2 demo={false} generatedAt="2026-09-26T00:00:00Z" /></>);
    expect(screen.getByText("展示模式不會寫入公告。")).toBeTruthy();
    expect(screen.getByText(/最近 15 分鐘/u)).toBeTruthy(); expect(screen.getByText("需要公告發布權限。")).toBeTruthy();
    expect(screen.getAllByRole("button").every((button) => button.hasAttribute("disabled"))).toBe(true);
  });
  it("shows a receipt only for the existing actor's read state", () => {
    render(<StaffAnnouncementReadAction item={{ ...item, actorReadAt: "2026-09-26T00:00:00Z" }} enabled demo={false} />);
    expect(screen.getByText("已讀")).toBeTruthy(); expect(screen.queryByRole("button")).toBeNull();
  });
  it("retains canonical Taipei default time export", () => {
    expect(staffAnnouncementDefaultTaipeiLocal(new Date("2026-09-25T16:30:00Z"))).toBe("2026-09-26T00:30");
  });
});
