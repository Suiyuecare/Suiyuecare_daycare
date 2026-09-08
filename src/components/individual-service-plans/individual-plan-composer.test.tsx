// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import type { IndividualPlanClient, IndividualPlanResponsible } from "@/lib/individual-service-plans/types";

import { IndividualPlanComposer } from "./individual-plan-composer";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

beforeAll(() => {
  Object.defineProperty(HTMLDialogElement.prototype, "showModal", { configurable: true, value() { this.setAttribute("open", ""); } });
  Object.defineProperty(HTMLDialogElement.prototype, "close", { configurable: true, value() { this.removeAttribute("open"); this.dispatchEvent(new Event("close")); } });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); refresh.mockClear(); });

const client: IndividualPlanClient = {
  clientId: "a1111111-1111-4111-8111-111111111111",
  clientCode: "HX-021",
  displayName: "陳O華",
  clientStatus: "active",
  admittedOn: "2025-01-01",
  endedOn: null,
  canPlanMonth: true,
  latestPlan: null,
};
const responsible: IndividualPlanResponsible = {
  userId: "b1111111-1111-4111-8111-111111111111",
  displayName: "王社工",
};

function renderComposer(overrides: Partial<Parameters<typeof IndividualPlanComposer>[0]> = {}) {
  return render(<IndividualPlanComposer clients={[client]} responsibles={[responsible]} planMonth="2026-09" canWrite hasRecentAal2 demo={false} {...overrides} />);
}
function completeForm(dialog: HTMLElement) {
  fireEvent.change(within(dialog).getByLabelText("目標 *"), { target: { value: "維持活動" } });
  fireEvent.change(within(dialog).getByLabelText("活動 *"), { target: { value: "團體活動" } });
  fireEvent.change(within(dialog).getByLabelText("頻率（人工文字）*"), { target: { value: "每週二次" } });
}

describe("individual service plan composer", () => {
  it("keeps demo explicitly read-only", () => {
    renderComposer({ demo: true, canWrite: false });
    const button = screen.getByRole("button", { name: /展示模式唯讀/u });
    expect(button.hasAttribute("disabled")).toBe(true);
  });

  it("closes after a correlated success and restores focus to the trigger", async () => {
    const response = new Response(JSON.stringify({
      requestId: "c1111111-1111-4111-8111-111111111111",
      status: "ok",
      data: {
        planId: "d1111111-1111-4111-8111-111111111111",
        clientId: client.clientId,
        planMonth: "2026-09",
        planVersion: 1,
        previousPlanId: null,
        signedAt: "2026-09-01T01:00:00Z",
        replayed: false,
        persisted: true,
        demo: false,
      },
      errors: [],
    }), { status: 201, headers: { "Content-Type": "application/json" } });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response));
    renderComposer();
    const trigger = screen.getByRole("button", { name: "建立或更新計畫" });
    fireEvent.click(trigger);
    const dialog = screen.getByRole("dialog", { name: "2026-09 個別化服務計畫" });
    completeForm(dialog);
    fireEvent.click(within(dialog).getByRole("button", { name: "簽署第一版" }));
    await waitFor(() => expect(dialog.hasAttribute("open")).toBe(false));
    expect(document.activeElement).toBe(trigger);
    expect(screen.getByRole("status").textContent).toContain("c1111111");
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("keeps the modal open and shows request ID for a malicious 2xx correlation", async () => {
    const response = new Response(JSON.stringify({
      requestId: "c2222222-2222-4222-8222-222222222222",
      status: "ok",
      data: {
        planId: "d1111111-1111-4111-8111-111111111111",
        clientId: "a2222222-2222-4222-8222-222222222222",
        planMonth: "2026-09", planVersion: 1, previousPlanId: null,
        signedAt: "2026-09-01T01:00:00Z", replayed: false, persisted: true, demo: false,
      },
      errors: [],
    }), { status: 200, headers: { "Content-Type": "application/json" } });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response));
    renderComposer();
    fireEvent.click(screen.getByRole("button", { name: "建立或更新計畫" }));
    const dialog = screen.getByRole("dialog", { name: "2026-09 個別化服務計畫" });
    completeForm(dialog);
    fireEvent.click(within(dialog).getByRole("button", { name: "簽署第一版" }));
    await waitFor(() => expect(within(dialog).getByRole("alert").textContent).toContain("c2222222"));
    expect(dialog.hasAttribute("open")).toBe(true);
    expect(refresh).not.toHaveBeenCalled();
  });
});
