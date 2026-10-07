// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { buildDemoMedicationAdministrationSnapshot } from "@/lib/medications/demo";

import { MedicationAction, taipeiLocalToIso } from "./medication-action";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

const serviceDate = "2026-09-01";
const snapshot = buildDemoMedicationAdministrationSnapshot(serviceDate);
const scheduled = snapshot.rows.find(
  (row) => row.finalizationState === "scheduled",
)!;
const awaitingVerification = snapshot.rows.find(
  (row) => row.finalizationState === "pending_verification",
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

function renderScheduled(demo = false) {
  return render(
    <MedicationAction
      canRecord
      canVerify
      currentUserId="f1111111-1111-4111-8111-111111111111"
      demo={demo}
      hasRecentAal2
      instance="desktop"
      row={scheduled}
      serviceDate={serviceDate}
    />,
  );
}

describe("medication action browser boundary", () => {
  it("round-trips Taipei local time and rejects normalized impossible dates", () => {
    expect(taipeiLocalToIso("2026-02-28T08:30")).toBe(
      "2026-02-28T00:30:00.000Z",
    );
    expect(() => taipeiLocalToIso("2026-02-31T08:30")).toThrow(
      "INVALID_LOCAL_DATETIME",
    );
  });

  it("keeps demo signing visibly read-only", () => {
    renderScheduled(true);
    const button = screen.getByRole("button", {
      name: /記錄並簽署：展示模式只讀/u,
    }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
  });

  it("keeps the dialog open when a 2xx receipt belongs to another slot", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(async (_url: string, init: RequestInit) => {
        const body = JSON.parse(String(init.body)) as { occurred_at: string };
        return new Response(
          JSON.stringify({
            requestId: "11111111-1111-4111-8111-111111111111",
            status: "ok",
            data: {
              operationId: "22222222-2222-4222-8222-222222222222",
              medicationAdministrationId:
                "33333333-3333-4333-8333-333333333333",
              status: "administered",
              occurredAt: body.occurred_at,
              requiresSecondVerification: false,
              finalizationState: "signed",
              signedAt: body.occurred_at,
              replayed: false,
              persisted: true,
              demo: false,
            },
            errors: [],
          }),
          { status: 201, headers: { "Content-Type": "application/json" } },
        );
      }),
    );
    renderScheduled();
    fireEvent.click(screen.getByRole("button", { name: "記錄並簽署" }));
    fireEvent.click(
      screen.getByRole("checkbox", { name: /我確認以上執行結果正確/u }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "確認執行並簽署" }),
    );
    await waitFor(() => {
      expect(screen.getByRole("alert").textContent).toMatch(
        /回覆不完整.*11111111-1111-4111-8111-111111111111/u,
      );
    });
    expect(
      screen
        .getByRole("dialog", { name: "記錄並簽署用藥結果" })
        .hasAttribute("open"),
    ).toBe(true);
    expect(
      (screen.getByRole("button", { name: "取消" }) as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(screen.getByRole("button", { name: "重試同一次簽署" })).toBeTruthy();
  });

  it("closes a confirmed success and restores focus to its trigger", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(async (_url: string, init: RequestInit) => {
        const body = JSON.parse(String(init.body)) as { occurred_at: string };
        return new Response(
          JSON.stringify({
            requestId: "11111111-1111-4111-8111-111111111111",
            status: "ok",
            data: {
              operationId: "22222222-2222-4222-8222-222222222222",
              medicationAdministrationId: scheduled.id,
              status: "administered",
              occurredAt: body.occurred_at,
              requiresSecondVerification: false,
              finalizationState: "signed",
              signedAt: body.occurred_at,
              replayed: false,
              persisted: true,
              demo: false,
            },
            errors: [],
          }),
          { status: 201, headers: { "Content-Type": "application/json" } },
        );
      }),
    );
    renderScheduled();
    const trigger = screen.getByRole("button", { name: "記錄並簽署" });
    fireEvent.click(trigger);
    const dialog = screen.getByRole("dialog", {
      name: "記錄並簽署用藥結果",
    });
    fireEvent.click(
      screen.getByRole("checkbox", { name: /我確認以上執行結果正確/u }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "確認執行並簽署" }),
    );

    await waitFor(() => expect(dialog.hasAttribute("open")).toBe(false));
    expect(document.activeElement).toBe(trigger);
    expect(screen.getByRole("status").textContent).toMatch(/完成簽署/u);
  });

  it("prevents Escape cancellation while the signature request is pending", async () => {
    let resolveResponse: ((response: Response) => void) | undefined;
    vi.stubGlobal(
      "fetch",
      vi.fn().mockReturnValue(
        new Promise<Response>((resolve) => {
          resolveResponse = resolve;
        }),
      ),
    );
    renderScheduled();
    fireEvent.click(screen.getByRole("button", { name: "記錄並簽署" }));
    fireEvent.click(
      screen.getByRole("checkbox", { name: /我確認以上執行結果正確/u }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "確認執行並簽署" }),
    );
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "簽署中…" })).toBeTruthy(),
    );
    const dialog = screen.getByRole("dialog", {
      name: "記錄並簽署用藥結果",
    });
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

  it("keeps the exact key and body after an unknown result, then accepts a replay receipt", async () => {
    const calls: Array<{ url: string; body: string; key: string }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(async (url: string, init: RequestInit) => {
        calls.push({
          url,
          body: String(init.body),
          key: String((init.headers as Record<string, string>)["Idempotency-Key"]),
        });
        if (calls.length === 1) throw new TypeError("network response lost");
        const payload = JSON.parse(String(init.body)) as { occurred_at: string };
        return new Response(
          JSON.stringify({
            requestId: "11111111-1111-4111-8111-111111111111",
            status: "ok",
            data: {
              operationId: "22222222-2222-4222-8222-222222222222",
              medicationAdministrationId: scheduled.id,
              status: "administered",
              occurredAt: payload.occurred_at,
              requiresSecondVerification: false,
              finalizationState: "signed",
              signedAt: payload.occurred_at,
              replayed: true,
              persisted: true,
              demo: false,
            },
            errors: [],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }),
    );

    renderScheduled();
    fireEvent.click(screen.getByRole("button", { name: "記錄並簽署" }));
    fireEvent.click(
      screen.getByRole("checkbox", { name: /我確認以上執行結果正確/u }),
    );
    fireEvent.click(screen.getByRole("button", { name: "確認執行並簽署" }));

    const dialog = screen.getByRole("dialog", { name: "記錄並簽署用藥結果" });
    await waitFor(() => expect(screen.getByRole("button", { name: "重試同一次簽署" })).toBeTruthy());
    expect(dialog.hasAttribute("open")).toBe(true);
    expect((screen.getByRole("button", { name: "取消" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("combobox", { name: /執行狀態/u }) as HTMLSelectElement).disabled).toBe(true);
    const cancel = new Event("cancel", { cancelable: true });
    expect(dialog.dispatchEvent(cancel)).toBe(false);

    fireEvent.click(screen.getByRole("button", { name: "重試同一次簽署" }));
    await waitFor(() => expect(dialog.hasAttribute("open")).toBe(false));
    expect(calls).toHaveLength(2);
    expect(calls[1]).toEqual(calls[0]);
    expect(screen.getByRole("status").textContent).toMatch(/先前相同簽署收據/u);
  });

  it("does not create an operation when the local confirmation is missing", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    renderScheduled();
    fireEvent.click(screen.getByRole("button", { name: "記錄並簽署" }));
    fireEvent.click(screen.getByRole("button", { name: "確認執行並簽署" }));
    expect(screen.getByRole("alert").textContent).toMatch(/勾選簽署確認/u);
    expect(fetchMock).not.toHaveBeenCalled();
    expect((screen.getByRole("button", { name: "取消" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("allows correction after a validated first-attempt 400 with no commit", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            requestId: "11111111-1111-4111-8111-111111111111",
            status: "error",
            data: null,
            errors: [{
              code: "INVALID_MEDICATION_ADMINISTRATION",
              message: "實際時間未通過驗證。",
            }],
          }),
          { status: 400, headers: { "Content-Type": "application/json" } },
        ),
      ),
    );
    renderScheduled();
    fireEvent.click(screen.getByRole("button", { name: "記錄並簽署" }));
    fireEvent.click(screen.getByRole("checkbox", { name: /我確認以上執行結果正確/u }));
    fireEvent.click(screen.getByRole("button", { name: "確認執行並簽署" }));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toMatch(/實際時間未通過驗證/u));
    expect((screen.getByRole("button", { name: "取消" }) as HTMLButtonElement).disabled).toBe(false);
    expect(screen.queryByRole("button", { name: "重試同一次簽署" })).toBeNull();
  });

  it("retries an uncertain second-person verification with the same operation", async () => {
    const calls: Array<{ url: string; body: string; key: string }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(async (url: string, init: RequestInit) => {
        calls.push({
          url,
          body: String(init.body),
          key: String((init.headers as Record<string, string>)["Idempotency-Key"]),
        });
        if (calls.length === 1) {
          return new Response("not a receipt", { status: 200 });
        }
        return new Response(
          JSON.stringify({
            requestId: "11111111-1111-4111-8111-111111111111",
            status: "ok",
            data: {
              operationId: "22222222-2222-4222-8222-222222222222",
              medicationAdministrationId: awaitingVerification.id,
              status: awaitingVerification.status,
              occurredAt: awaitingVerification.occurredAt,
              requiresSecondVerification: true,
              finalizationState: "signed",
              signedAt: awaitingVerification.executionSignedAt,
              replayed: true,
              persisted: true,
              demo: false,
            },
            errors: [],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }),
    );
    render(
      <MedicationAction
        canRecord
        canVerify
        currentUserId="f1111111-1111-4111-8111-111111111111"
        demo={false}
        hasRecentAal2
        instance="desktop"
        row={awaitingVerification}
        serviceDate={serviceDate}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "獨立覆核" }));
    const dialog = screen.getByRole("dialog", { name: "第二人獨立覆核" });
    fireEvent.click(screen.getByRole("checkbox", { name: /我已獨立核對排程/u }));
    fireEvent.click(screen.getByRole("button", { name: "完成獨立覆核" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "重試同一次簽署" })).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "重試同一次簽署" }));
    await waitFor(() => expect(dialog.hasAttribute("open")).toBe(false));
    expect(calls).toHaveLength(2);
    expect(calls[0]).toEqual(calls[1]);
    expect(calls[0]?.url).toBe("/api/medications/administrations/verify");
  });
});
