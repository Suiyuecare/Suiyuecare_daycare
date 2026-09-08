// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { buildDemoSocialResourceSnapshot } from "@/lib/social-resources/demo";

import { SocialResourceAction, SocialResourceFreshness } from "./social-resource-action";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

const resource = buildDemoSocialResourceSnapshot().items[0]!;

beforeAll(() => {
  Object.defineProperty(HTMLDialogElement.prototype, "showModal", {
    configurable: true,
    value() { this.setAttribute("open", ""); },
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

function successEnvelope(overrides: Record<string, unknown> = {}) {
  return {
    requestId: "31000000-0000-4000-8000-000000000030",
    status: "ok",
    data: {
      operationId: "31000000-0000-4000-8000-000000000031",
      resourceId: resource.id,
      rowVersion: resource.rowVersion + 1,
      status: "active",
      lastConfirmedOn: "2026-09-01",
      replayed: false,
      persisted: true,
      demo: false,
      ...overrides,
    },
    errors: [],
  };
}

describe("social resource action browser boundary", () => {
  it("keeps demo actions visibly disabled and never calls fetch", () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    render(<SocialResourceAction canManage defaultYear={2026} demo instance="demo" kind="confirm" resource={resource} />);
    const button = screen.getByRole("button", { name: /更新確認日：展示模式/u });
    expect(button).toHaveProperty("disabled", true);
    fireEvent.click(button);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("keeps a forged 2xx receipt open instead of accepting another resource", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify(
      successEnvelope({ resourceId: "31000000-0000-4000-8000-000000000099" }),
    ), { status: 200, headers: { "Content-Type": "application/json" } })));
    render(<SocialResourceAction canManage defaultYear={2026} demo={false} instance="forged" kind="confirm" resource={resource} />);
    fireEvent.click(screen.getByRole("button", { name: "更新確認日" }));
    const dialog = screen.getByRole("dialog", { name: "更新確認日" });
    fireEvent.click(within(dialog).getByRole("checkbox"));
    fireEvent.click(within(dialog).getByRole("button", { name: "更新確認日" }));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toMatch(/伺服器回覆不完整/u));
    expect(dialog.hasAttribute("open")).toBe(true);
  });

  it("closes an exact persisted confirmation and restores focus", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(successEnvelope()), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }));
    vi.stubGlobal("fetch", fetchMock);
    render(<SocialResourceAction canManage defaultYear={2026} demo={false} instance="success" kind="confirm" resource={resource} />);
    const trigger = screen.getByRole("button", { name: "更新確認日" });
    fireEvent.click(trigger);
    const dialog = screen.getByRole("dialog", { name: "更新確認日" });
    fireEvent.click(within(dialog).getByRole("checkbox"));
    fireEvent.click(within(dialog).getByRole("button", { name: "更新確認日" }));
    await waitFor(() => expect(dialog.hasAttribute("open")).toBe(false));
    await waitFor(() => expect(document.activeElement).toBe(trigger));
    expect(screen.getByRole("status").textContent).toMatch(/最後確認日/u);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("blocks cancel and disables close controls while a write is pending", async () => {
    vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>(() => undefined)));
    render(<SocialResourceAction canManage defaultYear={2026} demo={false} instance="pending" kind="confirm" resource={resource} />);
    fireEvent.click(screen.getByRole("button", { name: "更新確認日" }));
    const dialog = screen.getByRole("dialog", { name: "更新確認日" });
    fireEvent.click(within(dialog).getByRole("checkbox"));
    fireEvent.click(within(dialog).getByRole("button", { name: "更新確認日" }));
    await within(dialog).findByRole("button", { name: "確認中…" });
    const cancel = new Event("cancel", { cancelable: true });
    expect(dialog.dispatchEvent(cancel)).toBe(false);
    expect(within(dialog).getByRole("button", { name: "關閉" })).toHaveProperty("disabled", true);
    expect(within(dialog).getByRole("button", { name: "取消" })).toHaveProperty("disabled", true);
  });

  it("announces an expired snapshot and clears that state for a newer boundary", async () => {
    const expired = new Date(Date.now() - 1_000).toISOString();
    const fresh = new Date(Date.now() + 60_000).toISOString();
    const { rerender } = render(<SocialResourceFreshness demo={false} staleAfter={expired} />);

    await waitFor(() => expect(screen.getByRole("status").textContent).toMatch(/資料已過期/u));

    rerender(<SocialResourceFreshness demo={false} staleAfter={fresh} />);
    expect(screen.queryByRole("status")).toBeNull();
    expect(screen.getByText("資料為目前快照")).toBeDefined();
  });
});
