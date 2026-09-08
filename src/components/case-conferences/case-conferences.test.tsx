// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { staffPages } from "@/lib/catalog";
import { buildDemoCaseConferenceSnapshot } from "@/lib/case-conferences/demo";
import type { CaseConferenceFilters } from "@/lib/case-conferences/types";

import { CaseConferenceCreateForm } from "./case-conference-actions";
import { CaseConferencesWorkspace } from "./case-conferences-workspace";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

const organizationId = "38100000-0000-4000-8000-000000000040";
const branchId = "38200000-0000-4000-8000-000000000041";
const filters: CaseConferenceFilters = {
  clientId: null, status: "all", responsibleUserId: null, actionStatus: "all",
  meetingFrom: null, meetingTo: null, query: "",
};
const snapshot = buildDemoCaseConferenceSnapshot({ organizationId, branchId, filters });
const page = staffPages.find((entry) => entry.number === 38)!;

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("Page 38 case conference workspace and actions", () => {
  it("renders identical meeting identities in desktop rows and mobile cards", () => {
    const { container } = render(<CaseConferencesWorkspace
      filters={filters} loadError={false} page={page} snapshot={snapshot} />);
    const rows = new Set([...container.querySelectorAll("[data-case-conference-row]")]
      .map((node) => node.getAttribute("data-case-conference-row")));
    const cards = new Set([...container.querySelectorAll("[data-case-conference-card]")]
      .map((node) => node.getAttribute("data-case-conference-card")));
    expect(rows).toEqual(cards);
    expect(rows.size).toBe(snapshot.items.length);
    expect(screen.getByText(/全部為合成資料/u)).toBeInTheDocument();
    expect(screen.getAllByText(/not_configured/u).length).toBeGreaterThan(0);
    expect(screen.getAllByText("缺值").length).toBeGreaterThan(0);
    expect(screen.getAllByText("不適用").length).toBeGreaterThan(0);
  });

  it("fails closed without a complete server snapshot", () => {
    render(<CaseConferencesWorkspace filters={filters} loadError page={page} snapshot={null} />);
    expect(screen.getByRole("heading", { name: "無法取得個案研討快照" }))
      .toBeInTheDocument();
  });

  it("disables writes without server-confirmed capability", () => {
    const { container } = render(<CaseConferenceCreateForm
      snapshot={{ ...snapshot, demo: false, canManage: false }} />);
    expect(container.querySelector("form > fieldset")).toHaveProperty("disabled", true);
    expect(screen.getByText(/目前唯讀/u)).toBeInTheDocument();
  });

  it("reuses the actor operation key after an unknown result", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error("offline"));
    vi.stubGlobal("fetch", fetchMock);
    render(<CaseConferenceCreateForm snapshot={{ ...snapshot, demo: false, canManage: true }} />);
    fireEvent.click(screen.getByText("建立會議草稿"));
    fireEvent.change(screen.getByRole("combobox", { name: "個案" }), {
      target: { value: snapshot.clientOptions[0]!.clientId },
    });
    fireEvent.change(screen.getByRole("textbox", { name: "問題" }), {
      target: { value: "合成個案問題需共同研討" },
    });
    fireEvent.change(screen.getByRole("textbox", { name: "決議" }), {
      target: { value: "建立人工追蹤並保留不可變版本" },
    });
    fireEvent.change(screen.getByRole("textbox", { name: "內容" }), {
      target: { value: "完成合成觀察摘要" },
    });
    const submit = screen.getByRole("button", { name: "建立不可變草稿" });
    fireEvent.click(submit);
    await screen.findByText(/完成狀態未知/u);
    fireEvent.click(submit);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    const first = (fetchMock.mock.calls[0]![1] as RequestInit).headers as Record<string, string>;
    const second = (fetchMock.mock.calls[1]![1] as RequestInit).headers as Record<string, string>;
    expect(second["idempotency-key"]).toBe(first["idempotency-key"]);
  });
});
