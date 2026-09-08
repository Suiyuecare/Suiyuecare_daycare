// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { buildDemoMeetingManagementSnapshot } from "@/lib/meetings/demo";
import type { MeetingActionItem, MeetingMinute } from "@/lib/meetings/types";

import { MeetingActionUpdateForm, NewMeetingForm } from "./meeting-actions";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

const ORG = "75000000-0000-4000-8000-000000000001";
const BRANCH = "75000000-0000-4000-8000-000000000002";
const MEETING = "75000000-0000-4000-8000-000000000003";
const MINUTE = "75000000-0000-4000-8000-000000000004";
const ACTION = "75000000-0000-4000-8000-000000000005";
const UPDATE = "75000000-0000-4000-8000-000000000006";
const REQUEST = "75000000-0000-4000-8000-000000000007";

const action: MeetingActionItem = {
  actionId: ACTION, itemOrder: 1, action: "完成追蹤",
  responsibleUserId: ORG, responsibleDisplayName: "主管", dueDate: "2026-09-02",
  progressStatus: "not_started", latestUpdateId: null, updateSequence: 0,
  progressNote: null, progressRecordedAt: null, isOverdue: false,
  localWorkItem: false, externalNotificationSent: false,
};
const meeting: MeetingMinute = {
  minuteVersionId: MINUTE, meetingKey: MEETING, minuteVersion: 1,
  previousVersionId: null, correctionReason: null, meetingType: "機構自訂會議",
  title: "測試會議", startsAt: "2026-09-01T08:00:00+08:00",
  endsAt: "2026-09-01T09:00:00+08:00",
  staffAttendees: [], externalAttendees: [], agendaItems: [], decisions: [],
  actionItems: [action], signedAt: "2026-09-01T09:05:00+08:00",
  signerDisplayName: "主管", signerRoleKeys: ["branch_supervisor"],
  signaturePurpose: "會議紀錄簽署",
};

function headerKey(call: unknown[]) {
  return ((call[1] as RequestInit).headers as Record<string, string>)["idempotency-key"];
}

function actionResponse() {
  return new Response(JSON.stringify({
    requestId: REQUEST, status: "ok", data: {
      receipt: {
        actionUpdateId: UPDATE, meetingKey: MEETING, minuteVersionId: MINUTE,
        actionId: ACTION, previousUpdateId: null, updateSequence: 1,
        progressStatus: "not_started", recordedAt: "2026-09-01T10:00:00+08:00",
        replayed: false, persisted: true, demo: false,
      }, persisted: true, demo: false,
    }, errors: [],
  }), { status: 201, headers: { "content-type": "application/json" } });
}

describe("meeting action forms", () => {
  beforeEach(() => {
    refresh.mockReset();
    let sequence = 20;
    vi.stubGlobal("crypto", { randomUUID: vi.fn(() =>
      `75000000-0000-4000-8000-${String(sequence++).padStart(12, "0")}`) });
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("keeps the same operation key for an unchanged uncertain retry and rotates after editing", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error("fetch failed"));
    vi.stubGlobal("fetch", fetchMock);
    render(<MeetingActionUpdateForm action={action} canManage meeting={meeting} />);

    fireEvent.click(screen.getByRole("button", { name: "追加進度" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    await screen.findByText("網路中斷，尚未確認寫入；請保留畫面後重試。");
    const firstKey = headerKey(fetchMock.mock.calls[0]!);

    fireEvent.click(screen.getByRole("button", { name: "追加進度" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(headerKey(fetchMock.mock.calls[1]!)).toBe(firstKey);

    fireEvent.change(screen.getByLabelText("進度備註（選填）"), {
      target: { value: "內容已調整" },
    });
    fireEvent.click(screen.getByRole("button", { name: "追加進度" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
    expect(headerKey(fetchMock.mock.calls[2]!)).not.toBe(firstKey);
  });

  it("disables the complete action fieldset while a request is pending", async () => {
    let finish!: (response: Response) => void;
    vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>((resolve) => {
      finish = resolve;
    })));
    render(<MeetingActionUpdateForm action={action} canManage meeting={meeting} />);
    fireEvent.click(screen.getByRole("button", { name: "追加進度" }));
    const fieldset = screen.getByLabelText("行動狀態").closest("fieldset");
    await waitFor(() => expect((fieldset as HTMLFieldSetElement).disabled).toBe(true));
    finish(actionResponse());
    await screen.findByText("進度已追加保存；原會議紀錄沒有被改寫。");
    expect((fieldset as HTMLFieldSetElement).disabled).toBe(false);
  });

  it("locks every new-minute control while signing is pending", async () => {
    let finish!: (response: Response) => void;
    vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>((resolve) => {
      finish = resolve;
    })));
    const snapshot = buildDemoMeetingManagementSnapshot({
      organizationId: ORG, branchId: BRANCH,
    });
    render(<NewMeetingForm canSign hasRecentAal2 snapshot={snapshot} />);
    fireEvent.change(screen.getByLabelText("機構自訂會議類型"), {
      target: { value: "機構自訂會議" },
    });
    fireEvent.change(screen.getByLabelText("會議標題"), {
      target: { value: "新增測試會議" },
    });
    fireEvent.change(screen.getByLabelText("議程"), {
      target: { value: "測試議程" },
    });
    fireEvent.click(screen.getByRole("button", { name: "簽署會議紀錄" }));
    const fieldset = screen.getByLabelText("機構自訂會議類型").closest("fieldset");
    await waitFor(() => expect((fieldset as HTMLFieldSetElement).disabled).toBe(true));
    finish(new Response(JSON.stringify({
      requestId: REQUEST, status: "ok", data: {
        receipt: {
          minuteVersionId: MINUTE, meetingKey: MEETING, minuteVersion: 1,
          previousVersionId: null, signedAt: "2026-09-01T10:31:00+08:00",
          replayed: false, persisted: true, demo: false,
        }, persisted: true, demo: false,
      }, errors: [],
    }), { status: 201, headers: { "content-type": "application/json" } }));
    await screen.findByText("會議紀錄已簽署保存。");
    expect((fieldset as HTMLFieldSetElement).disabled).toBe(false);
  });
});
