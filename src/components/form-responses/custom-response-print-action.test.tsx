// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";

import * as leases from "@/lib/navigation/pending-operation-lock";
import { buildDemoFormResponses } from "@/lib/custom-form-responses/demo";
import type { CustomResponsePrintJob } from "@/lib/custom-form-responses/print-contract";
import { CustomResponsePrintAction, type PrintActor } from "./custom-response-print-action";

const id = (n: number) => `cf440000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const record = buildDemoFormResponses("2026-09-22").records[0];
const actor: PrintActor = { actorId: id(1), organizationId: id(2), branchId: id(3) };
const clock = Date.parse("2026-09-22T08:00:00.000Z");
const props = { record, actor, canPrint: true, blocked: false, dirty: false, demo: false };
const originalAcquire = leases.tryAcquirePendingOperation;
const releases: Mock<() => void>[] = [];

function job(overrides: Partial<CustomResponsePrintJob> = {}): CustomResponsePrintJob {
  return { jobId: id(4), responseId: record.id, clientId: record.clientId, ...actor,
    createdAt: new Date(clock).toISOString(), expiresAt: new Date(clock + 300_000).toISOString(), snapshotHash: "b".repeat(64), replayed: false,
    snapshot: { response: structuredClone(record), organizationName: "合成機構", branchName: "合成日照分支", clientCode: "SYNTHETIC-001", clientName: "合成個案",
      formName: "合成保存表單", formKey: "tenant.custom.synthetic", formVersion: 1, preparedByName: "合成製表人" }, ...overrides };
}
const url = (value: CustomResponsePrintJob) => `/api/forms/responses/prints/${value.jobId}/pdf?token=synthetic.signed`;
const reply = (value = job(), status = value.replayed ? 200 : 201, downloadUrl = url(value)) => Response.json({
  requestId: id(5), status: "ok", errors: [], data: { job: value, downloadUrl, persisted: true, demo: false },
}, { status });
const failure = (status: number, code = "CUSTOM_PRINT_FORBIDDEN") => Response.json({
  requestId: id(5), status: "error", data: null, errors: [{ code, message: "合成拒絕，請重新核對" }],
}, { status });
const clickPrepare = () => fireEvent.click(screen.getByRole("button", { name: "預覽／準備 PDF" }));
function externalLink() {
  const link = document.createElement("a"); link.href = "/app/other"; document.body.append(link);
  const event = new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 });
  link.dispatchEvent(event); link.remove(); return event;
}
function open(fetchMock: ReturnType<typeof vi.fn>, extra: Partial<React.ComponentProps<typeof CustomResponsePrintAction>> = {}) {
  vi.stubGlobal("fetch", fetchMock);
  const busy = vi.fn();
  const view = render(<CustomResponsePrintAction {...props} onBusyChange={busy} {...extra} />);
  return { ...view, busy };
}

beforeEach(() => {
  vi.spyOn(Date, "now").mockReturnValue(clock);
  vi.spyOn(window, "confirm").mockReturnValue(false);
  vi.spyOn(leases, "tryAcquirePendingOperation").mockImplementation(() => {
    const release = originalAcquire(); if (!release) return null;
    const tracked = vi.fn(release); releases.push(tracked); return tracked;
  });
});
afterEach(() => {
  cleanup(); releases.splice(0).forEach((release) => release());
  vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers();
});

describe("saved custom response print interaction", () => {
  it("prepares only saved IDs and previews the exact frozen record including zero and false", async () => {
    const source = job();
    const fetchMock = vi.fn().mockResolvedValueOnce(reply(source));
    const view = open(fetchMock); clickPrepare();
    const preview = await screen.findByLabelText("已保存文件預覽");
    expect(within(preview).getByText("合成保存表單 - 填答副本")).toBeVisible();
    expect(within(preview).getByText("0")).toBeVisible();
    expect(within(preview).getByText("否")).toBeVisible();
    expect(within(preview).getByText("不適用；原因：合成展示，未聯絡真人。")).toBeVisible();
    const download = screen.getByRole("link", { name: "下載此版本 PDF" });
    expect(download).toHaveAttribute("href", url(source));
    expect(download).toHaveAttribute("referrerpolicy", "no-referrer");
    expect(download).toHaveAttribute("rel", "noreferrer");
    const [endpoint, request] = fetchMock.mock.calls[0];
    expect(endpoint).toBe("/api/forms/responses/prints");
    expect(JSON.parse(request.body)).toEqual({ clientId: record.clientId, responseId: record.id });
    expect(request.headers["Idempotency-Key"]).toMatch(/^[0-9a-f-]{36}$/u);
    expect(view.busy.mock.calls).toEqual([[true], [false]]);
    expect(leases.hasPendingOperations()).toBe(false); expect(releases[0]).toHaveBeenCalledOnce();
  });

  it.each(["actorId", "organizationId", "branchId", "clientId", "responseId", "answer", "schema", "status", "replayStatus"] as const)("keeps the operation unknown for inconsistent %s", async (mismatch) => {
    const wrong = job();
    if (["actorId", "organizationId", "branchId", "clientId", "responseId"].includes(mismatch)) {
      Object.assign(wrong, { [mismatch]: id(99) });
    }
    if (mismatch === "answer") wrong.snapshot.response.answers.count = { state: "answered", value: 4 };
    if (mismatch === "schema") wrong.snapshot.response.schema.fields[0].label = "不是保存版本的題目";
    if (mismatch === "replayStatus") wrong.replayed = true;
    const fetchMock = vi.fn().mockResolvedValueOnce(reply(wrong, mismatch === "status" ? 200 : 201));
    open(fetchMock); clickPrepare();
    await screen.findByRole("button", { name: "核對並重試原列印操作" });
    expect(screen.queryByLabelText("已保存文件預覽")).toBeNull();
    expect(screen.queryByRole("link", { name: "下載此版本 PDF" })).toBeNull();
    expect(leases.hasPendingOperations()).toBe(true); expect(releases[0]).not.toHaveBeenCalled();
  });

  it.each([
    "https://attacker.invalid/download", "/api/forms/responses/prints/wrong/pdf?token=a.b",
    `/api/forms/responses/prints/${id(4)}/pdf?token=a.b&redirect=x`,
    `/api/forms/responses/prints/${id(4)}/pdf?token=a.b&token=c.d`,
    `/api/forms/responses/prints/${id(4)}/pdf?token=a.b#fragment`,
    `/api/forms/responses/prints/${id(4)}/pdf?token=not-signed`,
  ])("rejects an unrelated or malformed download URL", async (downloadUrl) => {
    open(vi.fn().mockResolvedValueOnce(reply(job(), 201, downloadUrl))); clickPrepare();
    await screen.findByRole("button", { name: "核對並重試原列印操作" });
    expect(screen.queryByRole("link", { name: "下載此版本 PDF" })).toBeNull();
    expect(leases.hasPendingOperations()).toBe(true);
  });

  it("retains original key/body/lease through unknown 500 then 403 and resolves only matching replay", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(failure(500, "CUSTOM_PRINT_UNAVAILABLE"))
      .mockResolvedValueOnce(failure(403)).mockResolvedValueOnce(reply(job({ replayed: true })));
    const view = open(fetchMock); clickPrepare();
    const retry = await screen.findByRole("button", { name: "核對並重試原列印操作" });
    expect(leases.hasPendingOperations()).toBe(true); expect(leases.tryAcquireViewTransition()).toBeNull();
    expect(externalLink().defaultPrevented).toBe(true); expect(window.confirm).not.toHaveBeenCalled();
    fireEvent.click(retry);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(retry).toBeEnabled());
    expect(releases[0]).not.toHaveBeenCalled(); expect(leases.hasPendingOperations()).toBe(true);
    expect(fetchMock.mock.calls[1][1].body).toBe(fetchMock.mock.calls[0][1].body);
    expect(fetchMock.mock.calls[1][1].headers).toEqual(fetchMock.mock.calls[0][1].headers);
    expect(view.busy).not.toHaveBeenCalledWith(false);
    fireEvent.click(retry); await screen.findByLabelText("已保存文件預覽");
    expect(fetchMock.mock.calls[2][1].body).toBe(fetchMock.mock.calls[0][1].body);
    expect(fetchMock.mock.calls[2][1].headers).toEqual(fetchMock.mock.calls[0][1].headers);
    expect(releases[0]).toHaveBeenCalledOnce(); expect(leases.hasPendingOperations()).toBe(false);
    expect(view.busy).toHaveBeenLastCalledWith(false);
  });

  it("treats correlated 410 as terminal even after an unknown result", async () => {
    const fetchMock = vi.fn().mockRejectedValueOnce(new Error("network"))
      .mockResolvedValueOnce(failure(410, "CUSTOM_PRINT_EXPIRED"));
    const view = open(fetchMock); clickPrepare();
    fireEvent.click(await screen.findByRole("button", { name: "核對並重試原列印操作" }));
    await screen.findByText("合成拒絕，請重新核對");
    expect(screen.getByRole("button", { name: "預覽／準備 PDF" })).toBeEnabled();
    expect(releases[0]).toHaveBeenCalledOnce(); expect(leases.hasPendingOperations()).toBe(false);
    expect(view.busy).toHaveBeenLastCalledWith(false);
    expect(fetchMock.mock.calls[1][1].body).toBe(fetchMock.mock.calls[0][1].body);
  });

  it("releases an initial definite denial without claiming a prepared snapshot", async () => {
    open(vi.fn().mockResolvedValueOnce(failure(403))); clickPrepare();
    await screen.findByRole("alert");
    expect(leases.hasPendingOperations()).toBe(false); expect(releases[0]).toHaveBeenCalledOnce();
    expect(screen.queryByLabelText("已保存文件預覽")).toBeNull();
  });

  it.each([
    { dirty: true }, { blocked: true }, { canPrint: false }, { demo: true }, { actor: undefined },
  ])("never sends while disabled: %j", (extra) => {
    const fetchMock = vi.fn(); open(fetchMock, extra);
    expect(screen.getByRole("button", { name: "預覽／準備 PDF" })).toBeDisabled();
    clickPrepare(); expect(fetchMock).not.toHaveBeenCalled(); expect(releases).toHaveLength(0);
  });

  it("does not create a key or send during a branch transition", () => {
    const transition = leases.tryAcquireViewTransition()!;
    try {
      const fetchMock = vi.fn(); const random = vi.spyOn(crypto, "randomUUID");
      open(fetchMock); clickPrepare();
      expect(screen.getByRole("alert")).toHaveTextContent("畫面正在更新或切換分支");
      expect(fetchMock).not.toHaveBeenCalled(); expect(random).not.toHaveBeenCalled();
    } finally { transition(); }
  });

  it("ignores repeated clicks while the exact first operation is in flight", async () => {
    let resolve!: (value: Response) => void;
    const pending = new Promise<Response>((r) => { resolve = r; });
    const fetchMock = vi.fn().mockReturnValueOnce(pending); open(fetchMock); clickPrepare();
    const busyButton = screen.getByRole("button", { name: "正在準備列印…" });
    expect(busyButton).toBeDisabled(); fireEvent.click(busyButton); expect(fetchMock).toHaveBeenCalledOnce();
    await act(async () => { resolve(reply()); await pending; });
    await screen.findByLabelText("已保存文件預覽"); expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("preserves an unresolved lease through unmount", async () => {
    const view = open(vi.fn().mockRejectedValueOnce(new Error("network"))); clickPrepare();
    await screen.findByRole("button", { name: "核對並重試原列印操作" });
    view.unmount(); expect(leases.hasPendingOperations()).toBe(true); expect(releases[0]).not.toHaveBeenCalled();
  });

  it.each(["success", "denial"] as const)("settles a late definite %s without updating another page", async (outcome) => {
    let resolve!: (value: Response) => void;
    const pending = new Promise<Response>((r) => { resolve = r; });
    const view = open(vi.fn().mockReturnValueOnce(pending)); clickPrepare();
    view.unmount(); expect(leases.hasPendingOperations()).toBe(true);
    await act(async () => { resolve(outcome === "success" ? reply() : failure(403)); await pending; });
    await waitFor(() => expect(leases.hasPendingOperations()).toBe(false));
    expect(releases[0]).toHaveBeenCalledOnce(); expect(view.busy.mock.calls).toEqual([[true]]);
    expect(screen.queryByLabelText("已保存文件預覽")).toBeNull();
  });

  it("shows a frozen snapshot but removes an already expired download link", async () => {
    const expired = job({ createdAt: new Date(clock - 301_000).toISOString(), expiresAt: new Date(clock - 1000).toISOString(), replayed: true });
    open(vi.fn().mockResolvedValueOnce(reply(expired))); clickPrepare();
    const preview = await screen.findByLabelText("已保存文件預覽");
    expect(within(preview).getByRole("status")).toHaveTextContent("下載連結已過期，請重新準備");
    expect(screen.queryByRole("link", { name: "下載此版本 PDF" })).toBeNull();
    expect(screen.getByRole("button", { name: "重新準備列印快照" })).toBeEnabled();
    expect(leases.hasPendingOperations()).toBe(false);
  });

  it("removes the download link when a prepared snapshot reaches its five-minute deadline", async () => {
    vi.useFakeTimers();
    open(vi.fn().mockResolvedValueOnce(reply()));
    await act(async () => { clickPrepare(); });
    expect(screen.getByRole("link", { name: "下載此版本 PDF" })).toBeVisible();
    await act(async () => { await vi.advanceTimersByTimeAsync(299_999); });
    expect(screen.getByRole("link", { name: "下載此版本 PDF" })).toBeVisible();
    await act(async () => { await vi.advanceTimersByTimeAsync(1); });
    expect(screen.queryByRole("link", { name: "下載此版本 PDF" })).toBeNull();
    expect(within(screen.getByLabelText("已保存文件預覽")).getByRole("status")).toHaveTextContent("下載連結已過期");
  });
});
