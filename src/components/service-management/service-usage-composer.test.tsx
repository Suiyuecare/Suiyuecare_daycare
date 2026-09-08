// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { ServiceUsageComposer } from "./service-usage-composer";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

const client = {
  id: "52000000-0000-4000-8000-000000000001",
  code: "D001",
  name: "合成個案",
  status: "active" as const,
  admittedOn: "2026-01-01",
  endedOn: null,
};

beforeAll(() => {
  Object.defineProperty(HTMLDialogElement.prototype, "showModal", {
    configurable: true,
    value() { this.setAttribute("open", ""); },
  });
  Object.defineProperty(HTMLDialogElement.prototype, "close", {
    configurable: true,
    value() { this.removeAttribute("open"); this.dispatchEvent(new Event("close")); },
  });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function openAndFill() {
  render(
    <ServiceUsageComposer
      canComplete
      clients={[client]}
      demo={false}
      hasRecentAal2
      serviceDate="2026-09-01"
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "完成並簽署服務" }));
  const dialog = screen.getByRole("dialog", { name: "完成並簽署服務" });
  fireEvent.change(within(dialog).getByRole("textbox", { name: /服務代碼/u }), {
    target: { value: "ba/01" },
  });
  fireEvent.change(within(dialog).getByRole("textbox", { name: /執行結果/u }), {
    target: { value: "已完成合成測試服務" },
  });
  fireEvent.click(within(dialog).getByRole("checkbox"));
  return dialog;
}

function successFor(init?: RequestInit, clientId = client.id) {
  const request = JSON.parse(String(init?.body)) as {
    service_code: string;
    started_at: string;
    ended_at: string;
  };
  return new Response(JSON.stringify({
    requestId: "52000000-0000-4000-8000-000000000002",
    status: "ok",
    data: {
      serviceEvent: {
        id: "52000000-0000-4000-8000-000000000003",
        clientId,
        authorizedCarePlanId: "52000000-0000-4000-8000-000000000004",
        clientServicePlanId: "52000000-0000-4000-8000-000000000005",
        serviceCode: request.service_code,
        status: "completed",
        startedAt: request.started_at,
        endedAt: request.ended_at,
        signedAt: "2026-09-01T12:00:00.000Z",
        signedBy: "52000000-0000-4000-8000-000000000006",
        signaturePurpose: "完成服務與執行證據簽署",
        signatureReauthChallengeId: "52000000-0000-4000-8000-000000000007",
      },
      operationId: "52000000-0000-4000-8000-000000000008",
      replayed: false,
      persisted: true,
      demo: false,
    },
    errors: [],
  }), { status: 201, headers: { "Content-Type": "application/json" } });
}

describe("service usage completion browser boundary", () => {
  it("does not claim success for a forged receipt and reuses the same key", async () => {
    const fetchMock = vi.fn((_input: RequestInfo | URL, init?: RequestInit) =>
      Promise.resolve(successFor(init, "52000000-0000-4000-8000-000000000099")));
    vi.stubGlobal("fetch", fetchMock);
    const dialog = openAndFill();

    fireEvent.click(within(dialog).getByRole("button", { name: "確認完成並簽署" }));
    await within(dialog).findByRole("alert");
    expect(dialog.hasAttribute("open")).toBe(true);
    fireEvent.click(within(dialog).getByRole("button", { name: "確認完成並簽署" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    const first = (fetchMock.mock.calls[0]![1] as RequestInit).headers as Record<string, string>;
    const second = (fetchMock.mock.calls[1]![1] as RequestInit).headers as Record<string, string>;
    expect(second["Idempotency-Key"]).toBe(first["Idempotency-Key"]);
  });

  it("closes only after a fully correlated signed receipt", async () => {
    const fetchMock = vi.fn((_input: RequestInfo | URL, init?: RequestInit) =>
      Promise.resolve(successFor(init)));
    vi.stubGlobal("fetch", fetchMock);
    const dialog = openAndFill();

    fireEvent.click(within(dialog).getByRole("button", { name: "確認完成並簽署" }));
    await screen.findByText(/服務已完成並簽署/u);
    expect(dialog.hasAttribute("open")).toBe(false);
  });
});
