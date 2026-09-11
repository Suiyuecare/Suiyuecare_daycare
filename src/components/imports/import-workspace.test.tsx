// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { createHash, webcrypto } from "node:crypto";

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ImportWorkspace } from "./import-workspace";

const batch = {
  id: "80000000-0000-4000-8000-000000000001",
  version: 1,
  status: "parsed",
  fileName: "sample.html",
  byteLength: 31,
  fileSha256: createHash("sha256").update(`<html>${"x".repeat(18)}</html>`).digest("hex"),
  contentFingerprint: "b".repeat(64),
  mappingVersion: "central-care-plan-html@1",
  createdAt: "2026-09-01T00:00:00.000Z",
  updatedAt: "2026-09-01T00:00:00.000Z",
  sectionCount: 0,
  fieldCount: 0,
  warningCount: 0,
  conflictCount: 0,
  security: {
    parser: "cheerio-static",
    scriptElementsBlocked: 0,
    formElementsNeutralized: 0,
    redirectElementsBlocked: 0,
    activeElementsBlocked: 0,
    inlineEventHandlersBlocked: 0,
    externalReferencesBlocked: 0,
    externalRequestCount: 0,
  },
} as const;

function envelope(data: unknown) {
  return { requestId: "80000000-0000-4000-8000-000000000002", status: "ok", data, errors: [] };
}

beforeEach(() => {
  vi.stubGlobal("crypto", webcrypto);
  // jsdom's File lacks arrayBuffer; use its real FileReader, not fake content bytes.
  vi.stubGlobal("File", class extends File {
    override arrayBuffer(): Promise<ArrayBuffer> {
      return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(new Uint8Array(reader.result as ArrayBuffer).buffer);
        reader.onerror = () => reject(reader.error);
        reader.readAsArrayBuffer(this);
      });
    }
  });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("ImportWorkspace retry boundary", () => {
  it("rejects a same-name, same-size upload receipt with different bytes before requesting its preview", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify(envelope({
      status: "parsed", duplicate: false, replayed: false, batch: { ...batch, fileSha256: "c".repeat(64) },
    })), { status: 201 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(envelope({
        status: "parsed", duplicate: false, replayed: true, batch,
      })), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(envelope({
        batch, sections: [], fields: [], warnings: [], conflicts: [],
      })), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    render(<ImportWorkspace />);
    fireEvent.change(screen.getByLabelText(/選擇或拖放 HTML 檔案/u), {
      target: { files: [new File([`<html>${"x".repeat(18)}</html>`], "sample.html", { type: "text/html" })] },
    });
    fireEvent.click(screen.getByRole("button", { name: "上傳並預覽" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("請勿視為完成");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("heading", { name: "2. 解析預覽" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "上傳並預覽" }));
    expect(await screen.findByRole("heading", { name: "2. 解析預覽" })).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock.mock.calls[1]![1]!.headers["Idempotency-Key"]).toBe(fetchMock.mock.calls[0]![1]!.headers["Idempotency-Key"]);
  });

  it("accepts a renamed duplicate replay only after hashing the selected file", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(envelope({
        status: "duplicate", duplicate: true, replayed: true, batch: { ...batch, status: "duplicate" },
      })), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(envelope({
        batch, sections: [], fields: [], warnings: [], conflicts: [],
      })), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    render(<ImportWorkspace />);
    fireEvent.change(screen.getByLabelText(/選擇或拖放 HTML 檔案/u), {
      target: { files: [new File([`<html>${"x".repeat(18)}</html>`], "renamed.html", { type: "text/html" })] },
    });
    fireEvent.click(screen.getByRole("button", { name: "上傳並預覽" }));
    expect(await screen.findByRole("heading", { name: "2. 解析預覽" })).toBeInTheDocument();
    expect(screen.getByText(/已找到相同檔案，未建立重複批次/u)).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("blocks file replacement and duplicate submissions while an upload is unresolved", async () => {
    let resolveResponse!: (response: Response) => void;
    const fetchMock = vi.fn().mockImplementation(() => new Promise<Response>((resolve) => { resolveResponse = resolve; }));
    vi.stubGlobal("fetch", fetchMock);
    render(<ImportWorkspace />);
    const input = screen.getByLabelText(/選擇或拖放 HTML 檔案/u);
    fireEvent.change(input, {
      target: { files: [new File([`<html>${"x".repeat(18)}</html>`], "sample.html", { type: "text/html" })] },
    });
    const upload = screen.getByRole("button", { name: "上傳並預覽" });
    fireEvent.click(upload);
    fireEvent.click(upload);
    expect(input).toBeDisabled();
    fireEvent.change(input, { target: { files: [new File(["other bytes"], "other.html", { type: "text/html" })] } });
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(screen.getByText("sample.html")).toBeInTheDocument();
    expect(screen.queryByText("other.html")).not.toBeInTheDocument();
    resolveResponse(new Response("{}", { status: 200 }));
    expect(await screen.findByRole("alert")).toHaveTextContent("請勿視為完成");
    expect(input).toBeEnabled();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("describes all three stages before upload without adding a promotion action", () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    render(<ImportWorkspace />);
    expect(screen.getByText("等待解析")).toBeInTheDocument();
    expect(screen.getByText("待核對／暫存核准")).toBeInTheDocument();
    expect(screen.getByText("正式入檔尚未完成")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /核准|正式入檔/u })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "前往資料盤點與缺漏追蹤" })).not.toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("offers a safe frontline 503 message and collapses configuration details without leaking raw errors", async () => {
    const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(new Response(JSON.stringify({
      requestId: "80000000-0000-4000-8000-000000000002", status: "error", data: null,
      errors: [{ code: "IMPORT_STORAGE_NOT_CONFIGURED", message: "internal-provider-detail-must-not-render" }],
    }), { status: 503, headers: { "Content-Type": "application/json" } })));
    vi.stubGlobal("fetch", fetchMock);
    render(<ImportWorkspace />);
    fireEvent.change(screen.getByLabelText(/選擇或拖放 HTML 檔案/u), {
      target: { files: [new File(["synthetic"], "sample.html", { type: "text/html" })] },
    });
    const upload = screen.getByRole("button", { name: "上傳並預覽" });
    fireEvent.click(upload);
    expect(await screen.findByRole("alert")).toHaveTextContent("暫時無法上傳，請聯絡管理員完成匯入服務設定");
    expect(screen.getByText("管理檢查明細：匯入服務設定").closest("details")).not.toHaveAttribute("open");
    expect(screen.queryByText(/internal-provider-detail-must-not-render/u)).not.toBeInTheDocument();
    expect(screen.queryByText("已解析")).not.toBeInTheDocument();
    fireEvent.click(upload);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect((fetchMock.mock.calls[1]![1]!.headers as Record<string, string>)["Idempotency-Key"])
      .toBe((fetchMock.mock.calls[0]![1]!.headers as Record<string, string>)["Idempotency-Key"]);
  });

  it("does not present an imported staging receipt or duplicate as formal client entry", async () => {
    const stagedBatch = { ...batch, status: "imported" };
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(envelope({
        status: "duplicate", duplicate: true, replayed: false, batch: { ...stagedBatch, status: "duplicate" },
      })), { status: 200, headers: { "Content-Type": "application/json" } }))
      .mockResolvedValueOnce(new Response(JSON.stringify(envelope({
        batch: stagedBatch, sections: [], fields: [], warnings: [], conflicts: [],
      })), { status: 200, headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);
    render(<ImportWorkspace />);
    fireEvent.change(screen.getByLabelText(/選擇或拖放 HTML 檔案/u), {
      target: { files: [new File([`<html>${"x".repeat(18)}</html>`], "sample.html", { type: "text/html" })] },
    });
    fireEvent.click(screen.getByRole("button", { name: "上傳並預覽" }));
    expect(await screen.findByText("已解析")).toBeInTheDocument();
    expect(screen.getByText(/已找到相同檔案，未建立重複批次；僅載入解析預覽，正式入檔尚未完成/u)).toBeInTheDocument();
    expect(screen.queryByText("已匯入")).not.toBeInTheDocument();
    expect(screen.getByText("imported").closest("details")).not.toHaveAttribute("open");
    expect(screen.getByText(batch.fileSha256).closest("details")).not.toHaveAttribute("open");
    expect(screen.queryByRole("button", { name: /核准|正式入檔/u })).not.toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it.each(["preview", "reparse", "refresh"] as const)("does not expose a %s 503 error or mark its uncertain result complete", async (phase) => {
    const response = (data: unknown, status = 200) => new Response(JSON.stringify(envelope(data)), {
      status, headers: { "Content-Type": "application/json" },
    });
    const unavailable = () => new Response(JSON.stringify({
      requestId: "80000000-0000-4000-8000-000000000002", status: "error", data: null,
      errors: [{ code: "IMPORT_STORAGE_NOT_CONFIGURED", message: "internal-provider-detail-must-not-render" }],
    }), { status: 503 });
    const fetchMock = vi.fn().mockResolvedValueOnce(response({
      status: "parsed", duplicate: false, replayed: false, batch,
    }, 201));
    if (phase === "preview") fetchMock.mockResolvedValueOnce(unavailable());
    else {
      fetchMock.mockResolvedValueOnce(response({ batch, sections: [], fields: [], warnings: [], conflicts: [] }));
      if (phase === "reparse") fetchMock.mockResolvedValueOnce(unavailable());
      else fetchMock.mockResolvedValueOnce(response({ ...batch, version: 2 })).mockResolvedValueOnce(unavailable());
    }
    vi.stubGlobal("fetch", fetchMock);
    render(<ImportWorkspace />);
    fireEvent.change(screen.getByLabelText(/選擇或拖放 HTML 檔案/u), {
      target: { files: [new File([`<html>${"x".repeat(18)}</html>`], "sample.html", { type: "text/html" })] },
    });
    fireEvent.click(screen.getByRole("button", { name: "上傳並預覽" }));
    if (phase !== "preview") {
      await screen.findByRole("heading", { name: "2. 解析預覽" });
      fireEvent.click(screen.getByRole("button", { name: "重新解析" }));
    }
    expect(await screen.findByRole("alert")).toHaveTextContent("請聯絡管理員完成匯入服務設定");
    expect(screen.getByRole("alert")).toHaveTextContent("尚未確認");
    expect(screen.queryByText(/internal-provider-detail-must-not-render/u)).not.toBeInTheDocument();
    expect(screen.queryByText(/已使用相同映射版本重新解析並刷新預覽/u)).not.toBeInTheDocument();
    expect(screen.getByText("正式入檔尚未完成")).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(phase === "preview" ? 2 : phase === "reparse" ? 3 : 4);
  });

  it("reuses the upload idempotency key after an unknown network result", async () => {
    const fetchMock = vi.fn()
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce(new Response(JSON.stringify(envelope({
        status: "parsed", duplicate: false, replayed: false, batch,
      })), { status: 201, headers: { "Content-Type": "application/json" } }))
      .mockResolvedValueOnce(new Response(JSON.stringify(envelope({
        batch, sections: [], fields: [], warnings: [], conflicts: [],
      })), { status: 200, headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);
    render(<ImportWorkspace />);

    const input = screen.getByLabelText(/選擇或拖放 HTML 檔案/u);
    fireEvent.change(input, { target: { files: [new File([`<html>${"x".repeat(18)}</html>`], "sample.html", { type: "text/html" })] } });
    const upload = screen.getByRole("button", { name: "上傳並預覽" });
    fireEvent.click(upload);
    expect((await screen.findByRole("alert")).textContent).toContain("offline");
    fireEvent.click(upload);
    expect(await screen.findByRole("heading", { name: "2. 解析預覽" })).toBeTruthy();
    expect(screen.getByText("已解析，可開始核對。正式入檔尚未完成，個案資料未更新。")).toBeInTheDocument();

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
    const firstHeaders = fetchMock.mock.calls[0]![1]!.headers as Record<string, string>;
    const retryHeaders = fetchMock.mock.calls[1]![1]!.headers as Record<string, string>;
    expect(retryHeaders["Idempotency-Key"]).toBe(firstHeaders["Idempotency-Key"]);
  });

  it("replays a timed-out reparse with the same key and verifies the refreshed snapshot", async () => {
    const nextBatch = { ...batch, version: 2, updatedAt: "2026-09-01T00:01:00.000Z" };
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(envelope({
        status: "parsed", duplicate: false, replayed: false, batch,
      })), { status: 201, headers: { "Content-Type": "application/json" } }))
      .mockResolvedValueOnce(new Response(JSON.stringify(envelope({
        batch, sections: [], fields: [], warnings: [], conflicts: [],
      })), { status: 200, headers: { "Content-Type": "application/json" } }))
      .mockRejectedValueOnce(new Error("offline reparse"))
      .mockResolvedValueOnce(new Response(JSON.stringify(envelope(nextBatch)), {
        status: 200, headers: { "Content-Type": "application/json" },
      }))
      .mockResolvedValueOnce(new Response(JSON.stringify(envelope({
        batch: nextBatch, sections: [], fields: [], warnings: [], conflicts: [],
      })), { status: 200, headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);
    render(<ImportWorkspace />);

    fireEvent.change(screen.getByLabelText(/選擇或拖放 HTML 檔案/u), {
      target: { files: [new File([`<html>${"x".repeat(18)}</html>`], "sample.html", { type: "text/html" })] },
    });
    fireEvent.click(screen.getByRole("button", { name: "上傳並預覽" }));
    await screen.findByRole("heading", { name: "2. 解析預覽" });

    const reparse = screen.getByRole("button", { name: "重新解析" });
    fireEvent.click(reparse);
    expect((await screen.findByRole("alert")).textContent).toContain("offline reparse");
    fireEvent.click(reparse);
    await screen.findByText(/重新解析並刷新預覽/u);

    const firstHeaders = fetchMock.mock.calls[2]![1]!.headers as Record<string, string>;
    const retryHeaders = fetchMock.mock.calls[3]![1]!.headers as Record<string, string>;
    expect(retryHeaders["Idempotency-Key"]).toBe(firstHeaders["Idempotency-Key"]);
    expect(fetchMock.mock.calls[4]![0]).toBe(`/api/imports/${batch.id}/preview`);
  });
});
