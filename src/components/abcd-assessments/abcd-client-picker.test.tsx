// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { emptyAbcdAssessmentFilters } from "@/lib/abcd-assessments/query";

import { AbcdClientPicker } from "./abcd-client-picker";

const organizationId = "21800000-0000-4000-8000-000000000001";
const branchId = "21800000-0000-4000-8000-000000000002";
const clientId = "21810000-0000-4000-8000-000000000201";
const otherClientId = "21810000-0000-4000-8000-000000000202";
const clients = [{ clientId, displayName: "合成個案甲" },
  { clientId: otherClientId, displayName: "合成個案乙" }];
const filters = emptyAbcdAssessmentFilters();
const props = { basePath: "/app/staff/assessments/abcd", filters,
  organizationId, branchId, demoClients: clients, selectedClientName: null };
const result = (found = clients[0]!) => ({ requestId: "21820000-0000-4000-8000-000000000001",
  status: "ok", data: { organizationId, branchId, hasMore: false,
    clients: [{ ...found, clientCode: "SYN-201", clientCodeTruncated: false }] }, errors: [] });
const response = (value: unknown = result(), status = 200) =>
  new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json" } });

describe("ABCD authorized client picker", () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.useRealTimers(); });

  it("uses local synthetic options only in demo and keeps the chosen client in the URL", () => {
    const fetchMock = vi.fn(); vi.stubGlobal("fetch", fetchMock);
    render(<AbcdClientPicker {...props} demo filters={{ ...filters,
      assessmentYear: 2026, assessmentType: "B", clientId }} selectedClientName="合成個案甲" />);
    fireEvent.change(screen.getByPlaceholderText("搜尋展示個案姓名"), { target: { value: "合成" } });
    expect(screen.getByText("目前：合成個案甲")).toBeVisible();
    expect(screen.getByRole("list", { name: "符合條件的個案" })).toBeVisible();
    expect(screen.getByRole("link", { name: "合成個案乙" }).getAttribute("href"))
      .toBe(`/app/staff/assessments/abcd?client=${otherClientId}&year=2026&type=B`);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("debounces private server search and clears results without storage", async () => {
    const fetchMock = vi.fn().mockResolvedValue(response()); vi.stubGlobal("fetch", fetchMock);
    render(<AbcdClientPicker {...props} demo={false} />);
    const input = screen.getByPlaceholderText("搜尋姓名或個案代碼");
    fireEvent.change(input, { target: { value: "合成" } });
    expect(fetchMock).not.toHaveBeenCalled();
    await act(async () => { await vi.advanceTimersByTimeAsync(301); });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]![0]).toBe("/api/abcd-assessments/client-search");
    const init = fetchMock.mock.calls[0]![1] as RequestInit;
    expect(init.method).toBe("POST");
    expect(init.cache).toBe("no-store");
    expect(JSON.parse(String(init.body))).toEqual({ query: "合成" });
    expect(screen.getByRole("link", { name: "合成個案甲，個案代碼 SYN-201" })).toHaveAttribute("href",
      `/app/staff/assessments/abcd?client=${clientId}`);
    fireEvent.click(screen.getByRole("button", { name: "清除評估個案" }));
    expect(input).toHaveFocus();
    expect(screen.queryByText("合成個案甲")).not.toBeInTheDocument();
  });

  it("does not search during IME composition and ignores an older late reply", async () => {
    let resolveFirst!: (value: Response) => void;
    const first = new Promise<Response>((resolve) => { resolveFirst = resolve; });
    const fetchMock = vi.fn().mockReturnValueOnce(first).mockResolvedValueOnce(response(result(clients[1])));
    vi.stubGlobal("fetch", fetchMock);
    render(<AbcdClientPicker {...props} demo={false} />);
    const input = screen.getByPlaceholderText("搜尋姓名或個案代碼");
    fireEvent.compositionStart(input);
    fireEvent.change(input, { target: { value: "合成" } });
    await act(async () => { await vi.advanceTimersByTimeAsync(350); });
    expect(fetchMock).not.toHaveBeenCalled();
    fireEvent.compositionEnd(input);
    await act(async () => { await vi.advanceTimersByTimeAsync(301); });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    fireEvent.change(input, { target: { value: "乙乙" } });
    await act(async () => { await vi.advanceTimersByTimeAsync(301); });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await act(async () => { resolveFirst(response()); await first; });
    expect(screen.queryByRole("link", { name: "合成個案甲，個案代碼 SYN-201" })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "合成個案乙，個案代碼 SYN-201" })).toBeVisible();
  });

  it("fails closed on permission loss and a forged cross-branch payload", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(response({ errors: [] }, 403)).mockResolvedValueOnce(
      response({ ...result(), data: { ...result().data, branchId: organizationId } }));
    vi.stubGlobal("fetch", fetchMock);
    render(<AbcdClientPicker {...props} demo={false} />);
    const input = screen.getByPlaceholderText("搜尋姓名或個案代碼");
    fireEvent.change(input, { target: { value: "合成" } });
    await act(async () => { await vi.advanceTimersByTimeAsync(301); });
    expect(screen.getByRole("alert")).toHaveTextContent("權限無法搜尋");
    expect(screen.queryByRole("link", { name: /合成個案甲/u })).not.toBeInTheDocument();
    fireEvent.change(input, { target: { value: "合成甲" } });
    await act(async () => { await vi.advanceTimersByTimeAsync(301); });
    expect(screen.getByRole("alert")).toHaveTextContent("無法搜尋最新名單");
    expect(screen.queryByRole("link", { name: /合成個案甲/u })).not.toBeInTheDocument();
  });

  it("keeps keyboard Enter inside the picker and focuses the first result", async () => {
    const fetchMock = vi.fn().mockResolvedValue(response()); vi.stubGlobal("fetch", fetchMock);
    const onSubmit = vi.fn((event: { preventDefault: () => void }) => event.preventDefault());
    render(<form onSubmit={onSubmit}><AbcdClientPicker {...props} demo={false} /></form>);
    const input = screen.getByPlaceholderText("搜尋姓名或個案代碼");
    fireEvent.change(input, { target: { value: "合成" } });
    await act(async () => { await vi.advanceTimersByTimeAsync(301); });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(screen.getByRole("link", { name: "合成個案甲，個案代碼 SYN-201" })).toHaveFocus();
    expect(onSubmit).not.toHaveBeenCalled();
  });
});
