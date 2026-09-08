// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ImportWorkspace } from "./import-workspace";

const batch = {
  id: "80000000-0000-4000-8000-000000000001",
  version: 1,
  status: "parsed",
  fileName: "sample.html",
  byteLength: 31,
  fileSha256: "a".repeat(64),
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

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("ImportWorkspace retry boundary", () => {
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
