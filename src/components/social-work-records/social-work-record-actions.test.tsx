// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { buildDemoSocialWorkRecordSnapshot } from "@/lib/social-work-records/demo";

import {
  NewSocialWorkRecordForm,
  SocialWorkRecordActions,
  SocialWorkRecordFreshness,
} from "./social-work-record-actions";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

const demo = buildDemoSocialWorkRecordSnapshot();
const formal = { ...demo, demo: false as const };

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function fillCreate() {
  fireEvent.click(screen.getByText("新增服務草稿", { selector: "summary" }));
  fireEvent.change(screen.getByLabelText("個案"), {
    target: { value: formal.clientOptions[0]!.clientId },
  });
  fireEvent.change(screen.getByLabelText("服務類型"), {
    target: { value: "家庭支持" },
  });
  fireEvent.change(screen.getByLabelText("服務內容"), {
    target: { value: "合成服務內容" },
  });
  fireEvent.change(screen.getByLabelText("服務結果"), {
    target: { value: "合成服務結果" },
  });
}

function submitCreate() {
  fireEvent.click(screen.getByRole("button", { name: "新增服務草稿" }));
}

function idempotencyHeader(call: unknown[]) {
  const headers = (call[1] as RequestInit).headers as Record<string, string>;
  return headers["idempotency-key"];
}

function successEnvelope(overrides: Record<string, unknown> = {}) {
  return {
    requestId: "29800000-0000-4000-8000-000000000099",
    status: "ok",
    data: {
      receiptKind: "record",
      action: "create_draft",
      operationId: "29800000-0000-4000-8000-000000000001",
      recordKey: "29700000-0000-4000-8000-000000000001",
      versionId: "29710000-0000-4000-8000-000000000001",
      recordVersion: 1,
      recordState: "draft",
      committedAt: "2026-09-02T01:15:00Z",
      replayed: false,
      persisted: true,
      demo: false,
      ...overrides,
    },
    errors: [],
  };
}

describe("social-work record client write boundary", () => {
  it("keeps the synthetic demo action visibly disabled", () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    render(<NewSocialWorkRecordForm canManage snapshot={demo} />);
    expect(screen.getByRole("button", { name: /展示唯讀/u }))
      .toHaveProperty("disabled", true);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("reuses the same idempotency key after an unknown network result", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error("offline"));
    vi.stubGlobal("fetch", fetchMock);
    render(<NewSocialWorkRecordForm canManage snapshot={formal} />);
    fillCreate();
    submitCreate();
    await screen.findByText(/操作結果未知/u);
    submitCreate();
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(idempotencyHeader(fetchMock.mock.calls[1]!))
      .toBe(idempotencyHeader(fetchMock.mock.calls[0]!));
  });

  it("rotates the idempotency key after editing uncertain content", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error("offline"));
    vi.stubGlobal("fetch", fetchMock);
    render(<NewSocialWorkRecordForm canManage snapshot={formal} />);
    fillCreate();
    submitCreate();
    await screen.findByText(/操作結果未知/u);
    fireEvent.change(screen.getByLabelText("服務結果"), {
      target: { value: "修改後的合成結果" },
    });
    submitCreate();
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(idempotencyHeader(fetchMock.mock.calls[1]!))
      .not.toBe(idempotencyHeader(fetchMock.mock.calls[0]!));
  });

  it("does not accept a forged 2xx receipt as success", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(
      JSON.stringify(successEnvelope({ recordVersion: 2 })),
      { status: 201, headers: { "Content-Type": "application/json" } },
    )));
    render(<NewSocialWorkRecordForm canManage snapshot={formal} />);
    fillCreate();
    submitCreate();
    await screen.findByText(/操作結果未知/u);
    expect(screen.queryByText(/已確認完成/u)).toBeNull();
  });

  it("disables signing until a recent AAL2 reauthentication exists", () => {
    const draft = formal.records.find((record) => record.recordState === "draft")!;
    render(<SocialWorkRecordActions canManage canSign hasRecentAal2={false}
      record={draft} snapshot={formal} />);
    fireEvent.click(screen.getByText("簽署紀錄", { selector: "summary" }));
    expect(screen.getByRole("button", { name: "簽署紀錄" }))
      .toHaveProperty("disabled", true);
    expect(screen.getByRole("alert").textContent).toMatch(/最近 15 分鐘/u);
  });

  it("announces staleness and resets for a newer snapshot boundary", async () => {
    const { rerender } = render(<SocialWorkRecordFreshness demo={false}
      staleAfter={new Date(Date.now() - 1_000).toISOString()} />);
    await screen.findByRole("status");
    rerender(<SocialWorkRecordFreshness demo={false}
      staleAfter={new Date(Date.now() + 60_000).toISOString()} />);
    await waitFor(() => expect(screen.queryByRole("status")).toBeNull());
    expect(screen.getByText("資料為目前快照")).toBeDefined();
  });
});
