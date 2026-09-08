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
});
