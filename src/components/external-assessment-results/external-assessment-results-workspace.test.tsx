// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ExternalAssessmentResultsWorkspace } from "./external-assessment-results-workspace";

const clientId = "d9500000-0000-4000-8000-000000000001";
const key = "d9600000-0000-4000-8000-000000000001";
const record = {
  id: "d9700000-0000-4000-8000-000000000001", clientId, instrumentKey: "barthel_adl",
  externalVersion: "paper-v1", assessedOn: "2026-09-25", score: null, maximumScore: null,
  externalResult: "外部評估摘要", performedBy: "合成評估者", source: "合成機構",
  followUpDueOn: null, followUpNote: null, actorId: "d8100000-0000-4000-8000-000000000001",
  createdAt: "2026-09-25T00:00:00Z",
};

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("external assessment results workspace", () => {
  it("loads the exact client's history and saves an external result without questionnaire answers", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: { snapshot: {
        clientId, records: [], total: 0, hasMore: false, generatedAt: "2026-09-25T00:00:00Z",
      } } }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: { record, replayed: false, persisted: true, demo: false } }), { status: 201 }));
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("crypto", { randomUUID: () => key });
    render(<ExternalAssessmentResultsWorkspace clientId={clientId} initialInstrument="barthel_adl"
      readableInstruments={["barthel_adl"]} writableInstruments={["barthel_adl"]} />);
    await screen.findByText("尚無登錄紀錄");
    expect(fetchMock.mock.calls[0]?.[0]).toContain(`clientId=${clientId}&instrumentKey=barthel_adl`);
    fireEvent.change(screen.getByLabelText("外部題本／版本"), { target: { value: "paper-v1" } });
    fireEvent.change(screen.getByLabelText("評估日期"), { target: { value: "2026-09-25" } });
    fireEvent.change(screen.getByLabelText("原量表結果／判讀摘要"), { target: { value: "外部評估摘要" } });
    fireEvent.change(screen.getByLabelText("執行者"), { target: { value: "合成評估者" } });
    fireEvent.change(screen.getByLabelText("來源／機構"), { target: { value: "合成機構" } });
    fireEvent.click(screen.getByRole("button", { name: "儲存結果" }));
    await screen.findByRole("status");
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    const [, options] = fetchMock.mock.calls[1] as [string, RequestInit];
    const payload = JSON.parse(String(options.body)) as { input: Record<string, unknown>; clientId: string };
    expect(payload.clientId).toBe(clientId);
    expect(payload.input).toMatchObject({ instrumentKey: "barthel_adl", externalVersion: "paper-v1", score: null, maximumScore: null });
    expect(payload.input).not.toHaveProperty("answers");
    expect(screen.getByText(/已保存外部量表結果/u)).toBeVisible();
    expect(screen.getByText(/外部評估摘要/u)).toBeVisible();
  });

  it("does not offer a write form to a read-only account", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: { snapshot: {
      clientId, records: [], total: 0, hasMore: false, generatedAt: "2026-09-25T00:00:00Z",
    } } }), { status: 200 })));
    render(<ExternalAssessmentResultsWorkspace clientId={clientId} initialInstrument={null}
      readableInstruments={["barthel_adl"]} writableInstruments={[]} />);
    await screen.findByText("尚無登錄紀錄");
    expect(screen.queryByRole("button", { name: "儲存結果" })).not.toBeInTheDocument();
    expect(screen.getByText(/只有查閱權限/u)).toBeVisible();
  });

  it("offers only entitled instruments, including read-only choices", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: { snapshot: {
      clientId, records: [], total: 0, hasMore: false, generatedAt: "2026-09-25T00:00:00Z",
    } } }), { status: 200 })));
    render(<ExternalAssessmentResultsWorkspace clientId={clientId} initialInstrument="swallowing"
      readableInstruments={["swallowing", "barthel_adl"]} writableInstruments={["barthel_adl"]} />);
    const select = screen.getByRole("combobox", { name: "量表／評估工具" });
    expect(select).toHaveValue("swallowing");
    expect(screen.queryByRole("option", { name: "GDS 老人憂鬱量表" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "儲存結果" })).not.toBeInTheDocument();
    fireEvent.change(select, { target: { value: "barthel_adl" } });
    expect(screen.getByRole("button", { name: "儲存結果" })).toBeEnabled();
  });

  it("retries the exact frozen payload and operation key after an uncertain response", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: { snapshot: {
        clientId, records: [], total: 0, hasMore: false, generatedAt: "2026-09-25T00:00:00Z",
      } } }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: { success: true } }), { status: 201 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: {
        record, replayed: true, persisted: true, demo: false,
      } }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("crypto", { randomUUID: () => key });
    render(<ExternalAssessmentResultsWorkspace clientId={clientId} initialInstrument="barthel_adl"
      readableInstruments={["barthel_adl"]} writableInstruments={["barthel_adl"]} />);
    await screen.findByText("尚無登錄紀錄");
    fireEvent.change(screen.getByLabelText("外部題本／版本"), { target: { value: "paper-v1" } });
    fireEvent.change(screen.getByLabelText("評估日期"), { target: { value: "2026-09-25" } });
    fireEvent.change(screen.getByLabelText("原量表結果／判讀摘要"), { target: { value: "外部評估摘要" } });
    fireEvent.change(screen.getByLabelText("執行者"), { target: { value: "合成評估者" } });
    fireEvent.change(screen.getByLabelText("來源／機構"), { target: { value: "合成機構" } });
    fireEvent.click(screen.getByRole("button", { name: "儲存結果" }));
    const retry = await screen.findByRole("button", { name: "以原操作重試" });
    expect(screen.getByLabelText("外部題本／版本")).toBeDisabled();
    expect(screen.getByRole("button", { name: "儲存結果" })).toBeDisabled();
    fireEvent.click(retry);
    await screen.findByText(/已保存外部量表結果/u);
    const first = fetchMock.mock.calls[1] as [string, RequestInit];
    const second = fetchMock.mock.calls[2] as [string, RequestInit];
    expect(first[1].headers).toEqual(second[1].headers);
    expect(first[1].body).toBe(second[1].body);
    expect(screen.queryByRole("button", { name: "以原操作重試" })).not.toBeInTheDocument();
  });

  it("ignores an older client's late read after switching context", async () => {
    const otherClientId = "d9500000-0000-4000-8000-000000000002";
    let resolveOld!: (response: Response) => void;
    const oldRead = new Promise<Response>((resolve) => { resolveOld = resolve; });
    const fetchMock = vi.fn().mockReturnValueOnce(oldRead)
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: { snapshot: {
        clientId: otherClientId, records: [{ ...record, clientId: otherClientId, externalResult: "第二位個案結果" }],
        total: 1, hasMore: false, generatedAt: "2026-09-25T00:00:00Z",
      } } }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const view = render(<ExternalAssessmentResultsWorkspace clientId={clientId} initialInstrument="barthel_adl"
      readableInstruments={["barthel_adl"]} writableInstruments={[]} />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    view.rerender(<ExternalAssessmentResultsWorkspace clientId={otherClientId} initialInstrument="barthel_adl"
      readableInstruments={["barthel_adl"]} writableInstruments={[]} />);
    await screen.findByText(/第二位個案結果/u);
    resolveOld(new Response(JSON.stringify({ data: { snapshot: {
      clientId, records: [record], total: 1, hasMore: false, generatedAt: "2026-09-25T00:00:00Z",
    } } }), { status: 200 }));
    await Promise.resolve();
    expect(screen.queryByText(/外部評估摘要/u)).not.toBeInTheDocument();
    expect(screen.getByText(/第二位個案結果/u)).toBeVisible();
  });
});
