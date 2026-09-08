// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { buildDemoStaffTrainingSnapshot } from "@/lib/staff-training/demo";

import {
  StaffTrainingRecordCreateForm,
  StaffTrainingRuleForms,
} from "./staff-training-actions";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

const ORG = "71000000-0000-4000-8000-000000000001";
const BRANCH = "71000000-0000-4000-8000-000000000002";
const KEY_A = "71000000-0000-4000-8000-000000000010";
const KEY_B = "71000000-0000-4000-8000-000000000011";
const VERSION = "71000000-0000-4000-8000-000000000012";
const REQUEST = "71000000-0000-4000-8000-000000000013";
const snapshot = buildDemoStaffTrainingSnapshot({ organizationId: ORG, branchId: BRANCH,
  filters: { dateFrom: null, dateTo: null, staffMembershipId: null,
    courseType: null, status: "all", query: "" } });

function fillForm() {
  fireEvent.change(screen.getByLabelText("員工（穩定人員識別）"), {
    target: { value: snapshot.staffOptions[0]!.staffMembershipId },
  });
  fireEvent.change(screen.getByLabelText("課程名稱"), { target: { value: "新訓練" } });
  fireEvent.change(screen.getByLabelText("課程類型（機構命名）"), { target: { value: "內訓" } });
  fireEvent.change(screen.getByLabelText("辦理單位"), { target: { value: "本機構" } });
  fireEvent.change(screen.getByLabelText("開始時間（台北）"), {
    target: { value: "2026-08-20T09:00" },
  });
  fireEvent.change(screen.getByLabelText("結束時間（台北）"), {
    target: { value: "2026-08-20T10:00" },
  });
  fireEvent.change(screen.getByLabelText("時數（最多四位小數）"), {
    target: { value: "1.0000" },
  });
}

function response(trainingKey = KEY_A) {
  return new Response(JSON.stringify({ requestId: REQUEST, status: "ok", data: {
    receipt: { organizationId: ORG, branchId: BRANCH, trainingKey,
      recordVersionId: VERSION, version: 1, previousVersionId: null,
      recordStatus: "active", staffMembershipId: snapshot.staffOptions[0]!.staffMembershipId,
      contentHash: "a".repeat(64), recordedAt: "2026-08-20T10:01:00+08:00",
      replayed: false, persisted: true, demo: false },
    persisted: true, demo: false,
  }, errors: [] }), { status: 201, headers: { "content-type": "application/json" } });
}

function headerKey(call: unknown[]) {
  return ((call[1] as RequestInit).headers as Record<string, string>)["idempotency-key"];
}

describe("staff training forms", () => {
  beforeEach(() => {
    refresh.mockReset();
    const sequence = [KEY_A, KEY_B];
    vi.stubGlobal("crypto", { randomUUID: vi.fn(() => sequence.shift() ?? KEY_B) });
  });
  afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

  it("keeps one idempotency key for unchanged uncertainty and rotates after editing", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error("fetch failed"));
    vi.stubGlobal("fetch", fetchMock);
    render(<StaffTrainingRecordCreateForm canManage snapshot={snapshot} />);
    fillForm();
    fireEvent.click(screen.getByRole("button", { name: "追加訓練紀錄" }));
    await screen.findByText("網路中斷，操作結果未知；內容未修改時請使用原操作鍵重試。");
    const first = headerKey(fetchMock.mock.calls[0]!);
    fireEvent.click(screen.getByRole("button", { name: "追加訓練紀錄" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(headerKey(fetchMock.mock.calls[1]!)).toBe(first);
    fireEvent.change(screen.getByLabelText("課程名稱"), { target: { value: "內容已改" } });
    fireEvent.click(screen.getByRole("button", { name: "追加訓練紀錄" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
    expect(headerKey(fetchMock.mock.calls[2]!)).not.toBe(first);
  });

  it("locks every field while pending and accepts only a correlated persisted receipt", async () => {
    let finish!: (value: Response) => void;
    vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>((resolve) => { finish = resolve; })));
    render(<StaffTrainingRecordCreateForm canManage snapshot={snapshot} />);
    fillForm();
    fireEvent.click(screen.getByRole("button", { name: "追加訓練紀錄" }));
    const fieldset = screen.getByLabelText("課程名稱").closest("fieldset") as HTMLFieldSetElement;
    await waitFor(() => expect(fieldset.disabled).toBe(true));
    finish(response());
    await screen.findByText("教育訓練紀錄已追加保存。");
    expect(fieldset.disabled).toBe(false);
    expect(refresh).toHaveBeenCalled();
  });

  it("keeps an unchanged rule retry key and rotates it when rule content changes", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error("fetch failed"));
    vi.stubGlobal("fetch", fetchMock);
    render(<StaffTrainingRuleForms canRules hasRecentAal2 snapshot={snapshot} />);
    fireEvent.change(screen.getByLabelText("生效日"), { target: { value: "2027-01-01" } });
    fireEvent.change(screen.getByLabelText("滾動視窗年數"), { target: { value: "6" } });
    fireEvent.change(screen.getByLabelText("機構要求積分"), { target: { value: "120" } });
    fireEvent.change(screen.getByLabelText("到期提醒天數"), { target: { value: "30" } });
    fireEvent.click(screen.getByRole("button", { name: "建立規則提案" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const first = headerKey(fetchMock.mock.calls[0]!);
    fireEvent.click(screen.getByRole("button", { name: "建立規則提案" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(headerKey(fetchMock.mock.calls[1]!)).toBe(first);
    fireEvent.change(screen.getByLabelText("機構要求積分"), { target: { value: "121" } });
    fireEvent.click(screen.getByRole("button", { name: "建立規則提案" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
    expect(headerKey(fetchMock.mock.calls[2]!)).not.toBe(first);
  });
});
