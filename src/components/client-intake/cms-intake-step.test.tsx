// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CmsIntakeStep } from "./cms-intake-step";

const batchId = "c1600000-0000-4000-8000-000000000001";
const preview = {
  batchId, payloadSha256: "a".repeat(64), mappingVersion: "central-care-plan-html@1",
  fields: [["displayName", "姓名", "合成個案"], ["identityNumber", "身分識別", "X123456789"]].map(([intakeTarget, label, value], index) => ({
    id: `field-${index}`, intakeTarget, normalizedValue: value, rawValue: value, warnings: [],
    source: { sectionCode: "CLIENT_BASIC", sectionTitle: "合成基本資料", label, parentPath: "CLIENT_BASIC/table/tr" },
  })),
  sections: [{ code: "CLIENT_BASIC", title: "合成基本資料" }], warnings: [], conflicts: [],
  current: null, imported: false, importReceipt: null,
};
const receipt = Response.json({ status: "ok", data: { reservation_id: batchId, status: "completed" } });
const fileA = () => new File(["<h5>合成甲</h5>"], "synthetic-a.html", { type: "text/html" });
const fileB = () => new File(["<h5>合成乙</h5>"], "synthetic-b.html", { type: "text/html" });
const props = () => ({ current: null, canImport: true, canApprove: true, archiveConfigured: true, demo: false,
  onSaved: vi.fn().mockResolvedValue(undefined), onManual: vi.fn(), onDirty: vi.fn(), onUnknown: vi.fn() });

afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("CMS upload uncertainty", () => {
  it("locks the original file after an unknown POST and retries that file with the same key", async () => {
    const retryRejection = Response.json({ status: "error", data: null, requestId: "synthetic-retry", errors: [{ code: "NOT_AUTHORIZED", message: "暫時無權限" }] }, { status: 403 });
    const fetch = vi.fn().mockRejectedValueOnce(new TypeError("synthetic dropped connection"))
      .mockResolvedValueOnce(retryRejection).mockResolvedValueOnce(receipt)
      .mockResolvedValueOnce(Response.json({ status: "ok", data: preview }));
    vi.stubGlobal("fetch", fetch);
    const callbacks = props();
    render(<CmsIntakeStep {...callbacks} />);
    const input = screen.getByLabelText(/CMS HTML/u);
    fireEvent.change(input, { target: { files: [fileA()] } });
    fireEvent.click(screen.getByRole("button", { name: "上傳並核對資料" }));
    expect(await screen.findByRole("status")).toHaveTextContent("上傳結果尚未確認");
    expect(input).toBeDisabled();
    expect(callbacks.onUnknown).toHaveBeenLastCalledWith(true);
    fireEvent.change(input, { target: { files: [fileB()] } });
    fireEvent.click(screen.getByRole("button", { name: "用原檔重試並核對" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("暫時無權限");
    expect(input).toBeDisabled();
    expect(callbacks.onUnknown).toHaveBeenLastCalledWith(true);
    fireEvent.click(screen.getByRole("button", { name: "用原檔重試並核對" }));
    await screen.findByRole("heading", { name: "逐欄核對後，才會寫入個案資料" });
    expect(fetch.mock.calls[0]![1].headers["idempotency-key"]).toBe(fetch.mock.calls[1]![1].headers["idempotency-key"]);
    expect(fetch.mock.calls[0]![1].headers["idempotency-key"]).toBe(fetch.mock.calls[2]![1].headers["idempotency-key"]);
    expect((fetch.mock.calls[2]![1].body as FormData).get("file")).toHaveProperty("name", "synthetic-a.html");
    expect(input).toBeEnabled();
    expect(callbacks.onUnknown).toHaveBeenLastCalledWith(false);
  });

  it("permits a new file and key only after a validated definite rejection", async () => {
    const rejection = Response.json({ status: "error", data: null, requestId: "synthetic-request", errors: [{ code: "INVALID_FILE", message: "檔案無效" }] }, { status: 400 });
    const fetch = vi.fn().mockResolvedValueOnce(rejection)
      .mockResolvedValueOnce(Response.json({ status: "ok", data: { reservation_id: batchId, status: "completed" } }))
      .mockResolvedValueOnce(Response.json({ status: "ok", data: preview }));
    vi.stubGlobal("fetch", fetch);
    const callbacks = props();
    render(<CmsIntakeStep {...callbacks} />);
    const input = screen.getByLabelText(/CMS HTML/u);
    fireEvent.change(input, { target: { files: [fileA()] } });
    fireEvent.click(screen.getByRole("button", { name: "上傳並核對資料" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("檔案無效");
    expect(input).toBeEnabled();
    expect(callbacks.onUnknown).toHaveBeenLastCalledWith(false);
    fireEvent.change(input, { target: { files: [fileB()] } });
    fireEvent.click(screen.getByRole("button", { name: "上傳並核對資料" }));
    await screen.findByRole("heading", { name: "逐欄核對後，才會寫入個案資料" });
    expect(fetch.mock.calls[0]![1].headers["idempotency-key"]).not.toBe(fetch.mock.calls[1]![1].headers["idempotency-key"]);
    expect((fetch.mock.calls[1]![1].body as FormData).get("file")).toHaveProperty("name", "synthetic-b.html");
  });

  it("freezes decisions after an unknown commit and retries the identical operation", async () => {
    const fetch = vi.fn().mockResolvedValueOnce(Response.json({ status: "ok", data: { reservation_id: batchId, status: "completed" } }))
      .mockResolvedValueOnce(Response.json({ status: "ok", data: preview }))
      .mockRejectedValueOnce(new TypeError("synthetic dropped connection"))
      .mockResolvedValueOnce(Response.json({ status: "ok", data: { clientId: batchId, persisted: true, formallyImported: true } }));
    vi.stubGlobal("fetch", fetch);
    const callbacks = props();
    render(<CmsIntakeStep {...callbacks} />);
    const input = screen.getByLabelText(/CMS HTML/u);
    fireEvent.change(input, { target: { files: [fileA()] } });
    fireEvent.click(screen.getByRole("button", { name: "上傳並核對資料" }));
    await screen.findByRole("heading", { name: "逐欄核對後，才會寫入個案資料" });
    fireEvent.change(screen.getByLabelText("機構個案編號（必填）"), { target: { value: "SYNTHETIC-01" } });
    for (const label of ["姓名", "身分識別"]) {
      const card = screen.getByRole("heading", { name: label }).closest("article")!;
      fireEvent.change(within(card).getByLabelText("這一欄如何處理"), { target: { value: "use_source" } });
    }
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: "確認建立待收案個案" }));
    expect(await screen.findByRole("status")).toHaveTextContent("建檔結果尚未確認");
    expect(input).toBeDisabled();
    expect(screen.getByLabelText("機構個案編號（必填）")).toBeDisabled();
    expect(screen.getByRole("checkbox")).toBeDisabled();
    expect(callbacks.onUnknown).toHaveBeenLastCalledWith(true);
    fireEvent.change(screen.getByLabelText("機構個案編號（必填）"), { target: { value: "SHOULD-NOT-REPLACE" } });
    fireEvent.click(screen.getByRole("button", { name: "用原操作重試確認" }));
    await waitFor(() => expect(callbacks.onSaved).toHaveBeenCalledWith(batchId));
    expect(fetch.mock.calls[2]![1].body).toBe(fetch.mock.calls[3]![1].body);
    expect(callbacks.onUnknown).toHaveBeenLastCalledWith(false);
  });
});
