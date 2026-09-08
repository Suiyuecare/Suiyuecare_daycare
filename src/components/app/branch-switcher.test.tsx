// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ClientFetchTimeoutError } from "@/lib/api/client-fetch";

import { BranchSwitcher } from "./branch-switcher";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("BranchSwitcher request boundaries", () => {
  const branchA = "22000000-0000-4000-8000-000000000001";
  const branchB = "22000000-0000-4000-8000-000000000002";
  const requestId = "22000000-0000-4000-8000-000000000003";

  it("keeps the synthetic preview branch fixed without requesting the blocked API", () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    render(<BranchSwitcher currentBranchId={branchA} currentBranchName="合成分支" organizationName="合成機構" readOnly />);
    const trigger = screen.getByRole("button", { name: /目前分支/u });
    expect(trigger).toHaveProperty("disabled", true);
    fireEvent.click(trigger);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.getByText("固定合成分支 · 不切換真實機構")).toBeDefined();
  });

  it("leaves the trigger usable after a failed branch-list request", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    render(<BranchSwitcher currentBranchId={branchA} currentBranchName="甲分支" organizationName="測試機構" />);

    const trigger = screen.getByRole("button", { name: /目前分支/u });
    fireEvent.click(trigger);
    expect((await screen.findByRole("alert")).textContent).toContain("無法讀取分支");
    expect(trigger).toHaveProperty("disabled", false);
  });

  it("reports an unknown switch outcome and keeps the old label on timeout", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        requestId, status: "ok", errors: [],
        data: {
          branches: [{ id: branchA, name: "甲分支" }, { id: branchB, name: "乙分支" }],
          currentBranchId: branchA,
        },
      }), { status: 200, headers: { "Content-Type": "application/json" } }))
      .mockRejectedValueOnce(new ClientFetchTimeoutError(20_000));
    vi.stubGlobal("fetch", fetchMock);
    render(<BranchSwitcher currentBranchId={branchA} currentBranchName="甲分支" organizationName="測試機構" />);

    fireEvent.click(screen.getByRole("button", { name: /目前分支/u }));
    fireEvent.click(await screen.findByRole("button", { name: "乙分支" }));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("結果未知"));
    const trigger = screen.getByRole("button", { name: /目前分支/u });
    expect(trigger.textContent).toContain("甲分支");
    expect(trigger).toHaveProperty("disabled", false);
  });

  it("does not change the visible branch for an uncorrelated success receipt", async () => {
    const list = {
      requestId, status: "ok", errors: [],
      data: {
        branches: [{ id: branchA, name: "甲分支" }, { id: branchB, name: "乙分支" }],
        currentBranchId: branchA,
      },
    };
    const forgedSwitch = {
      requestId, status: "ok", errors: [],
      data: { branch: { id: branchB, name: "遭竄改的名稱" }, demo: false },
    };
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(list), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(forgedSwitch), { status: 200 })));
    render(<BranchSwitcher currentBranchId={branchA} currentBranchName="甲分支" organizationName="測試機構" />);

    fireEvent.click(screen.getByRole("button", { name: /目前分支/u }));
    fireEvent.click(await screen.findByRole("button", { name: "乙分支" }));
    await screen.findByRole("alert");
    expect(screen.getByRole("button", { name: /目前分支/u }).textContent).toContain("甲分支");
  });
});
