// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ClaimValidationComposer } from "./claim-validation-composer";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
const BATCH = "49000000-0000-4000-8000-000000000001";
const NEXT = "49000000-0000-4000-8000-000000000002";
const batches = [{ id: BATCH, periodLabel: "合成九月", itemCount: 2, totalAmount: "1200.10" },
  { id: NEXT, periodLabel: "合成十月", itemCount: 3, totalAmount: "300.00" }];
const props = { batches, enabled: true, hasRecentAal2: true, demo: false };
function open() { fireEvent.click(screen.getByRole("button", { name: "驗證草稿" }));
  fireEvent.click(screen.getByRole("checkbox")); }
function success(init: RequestInit) {
  const body = JSON.parse(String(init.body));
  return Response.json({ requestId: BATCH, status: "ok", errors: [], data: {
    claimBatchId: body.claim_batch_id, itemCount: 2, totalAmount: body.expected_total_amount,
    status: "validated", replayed: false, demo: false, persisted: true,
    idempotencyKey: (init.headers as Record<string, string>)["Idempotency-Key"],
  } });
}
describe("claim validation confirmation and uncertain outcomes", () => {
  beforeEach(() => {
    refresh.mockReset(); let counter = 10;
    vi.stubGlobal("crypto", { randomUUID: () => `49000000-0000-4000-8000-${String(counter++).padStart(12, "0")}` });
    HTMLDialogElement.prototype.showModal = function () { this.setAttribute("open", ""); };
    HTMLDialogElement.prototype.close = function () { this.removeAttribute("open"); };
  });
  afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

  it("only reports success after the exact persisted receipt", async () => {
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => success(init)); vi.stubGlobal("fetch", fetchMock);
    render(<ClaimValidationComposer {...props} />); open();
    fireEvent.click(screen.getByRole("button", { name: "確認驗證並凍結" }));
    await screen.findByText(/申報草稿已驗證並凍結明細/u);
    expect(fetchMock).toHaveBeenCalledOnce(); expect(refresh).toHaveBeenCalledOnce();
  });
  it("freezes and exactly retries an uncertain request across close/reopen and changed props", async () => {
    const fetchMock = vi.fn().mockRejectedValueOnce(new TypeError("network"))
      .mockImplementationOnce(async (_url: string, init: RequestInit) => success(init));
    vi.stubGlobal("fetch", fetchMock);
    const { rerender } = render(<ClaimValidationComposer {...props} />); open();
    fireEvent.click(screen.getByRole("button", { name: "確認驗證並凍結" }));
    await screen.findByText(/上次結果未知/u);
    expect((screen.getByRole("combobox") as HTMLSelectElement).disabled).toBe(true);
    rerender(<ClaimValidationComposer {...props} batches={[{ ...batches[0]!, totalAmount: "9000.00" }, batches[1]!]} />);
    expect((screen.getByRole("combobox") as HTMLSelectElement).selectedOptions[0]?.textContent).toContain("1,200.10");
    expect(screen.queryByText(/9,000/u)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "取消" }));
    rerender(<ClaimValidationComposer {...props} batches={[batches[1]!]} />);
    fireEvent.click(screen.getByRole("button", { name: "核對上次申報驗證" }));
    expect((screen.getByRole("combobox") as HTMLSelectElement).value).toBe(BATCH);
    fireEvent.click(screen.getByRole("button", { name: "核對原請求結果" }));
    await screen.findByText(/申報草稿已驗證並凍結明細/u);
    const original = fetchMock.mock.calls[0]![1] as RequestInit;
    const retried = fetchMock.mock.calls[1]![1] as RequestInit;
    expect(retried.body).toBe(original.body);
    expect(retried.headers).toEqual(original.headers);
  });
  it.each([{}, { requestId: BATCH, status: "ok", errors: [], data: { persisted: false } }])("never treats HTTP200 alone as successful %j", async (body) => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json(body)));
    render(<ClaimValidationComposer {...props} />); open();
    fireEvent.click(screen.getByRole("button", { name: "確認驗證並凍結" }));
    await screen.findByText(/上次結果未知/u);
    expect(refresh).not.toHaveBeenCalled(); expect(screen.queryByText(/申報草稿已驗證並凍結明細/u)).toBeNull();
  });
  it("prevents duplicate submits while pending and permits no unconfirmed submit", async () => {
    let resolve!: (value: Response) => void;
    const fetchMock = vi.fn(() => new Promise<Response>((done) => { resolve = done; })); vi.stubGlobal("fetch", fetchMock);
    const { container } = render(<ClaimValidationComposer {...props} />);
    fireEvent.click(screen.getByRole("button", { name: "驗證草稿" }));
    fireEvent.submit(container.querySelector("form")!); expect(fetchMock).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.submit(container.querySelector("form")!); fireEvent.submit(container.querySelector("form")!);
    expect(fetchMock).toHaveBeenCalledOnce();
    expect((screen.getByRole("button", { name: "取消" }) as HTMLButtonElement).disabled).toBe(true);
    resolve(Response.json({})); await screen.findByText(/上次結果未知/u);
  });
  it("keeps a confirmed rejection editable but an earlier uncertain operation locked", async () => {
    const rejected = () => Response.json({ requestId: BATCH, status: "error", data: null,
      errors: [{ code: "CLAIM_VALIDATION_REJECTED", message: "not eligible" }] }, { status: 422 });
    const fetchMock = vi.fn().mockResolvedValueOnce(rejected()).mockRejectedValueOnce(new TypeError("network"))
      .mockResolvedValueOnce(rejected()); vi.stubGlobal("fetch", fetchMock);
    render(<ClaimValidationComposer {...props} />); open();
    fireEvent.click(screen.getByRole("button", { name: "確認驗證並凍結" }));
    await screen.findByText(/批次未確認完成驗證/u);
    expect((screen.getByRole("combobox") as HTMLSelectElement).disabled).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "確認驗證並凍結" }));
    await screen.findByText(/上次結果未知/u);
    fireEvent.click(screen.getByRole("button", { name: "核對原請求結果" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
    expect((screen.getByRole("combobox") as HTMLSelectElement).disabled).toBe(true);
  });
  it("requires recent MFA and clears consent when another batch is selected", () => {
    const fetchMock = vi.fn(); vi.stubGlobal("fetch", fetchMock);
    const { rerender, container } = render(<ClaimValidationComposer {...props} />); open();
    fireEvent.change(screen.getByRole("combobox"), { target: { value: NEXT } });
    expect((screen.getByRole("checkbox") as HTMLInputElement).checked).toBe(false);
    fireEvent.click(screen.getByRole("checkbox"));
    rerender(<ClaimValidationComposer {...props} hasRecentAal2={false} />);
    fireEvent.submit(container.querySelector("form")!); expect(fetchMock).not.toHaveBeenCalled();
  });
  it.each([{ totalAmount: "9000.00" }, { itemCount: 9 }, { periodLabel: "已更正期間" }])(
    "requires new consent when a refreshed batch changes its confirmed tuple %j", (patch) => {
      const fetchMock = vi.fn(); vi.stubGlobal("fetch", fetchMock);
      const { rerender, container } = render(<ClaimValidationComposer {...props} />); open();
      rerender(<ClaimValidationComposer {...props} batches={[{ ...batches[0]!, ...patch }, batches[1]!]} />);
      expect((screen.getByRole("checkbox") as HTMLInputElement).checked).toBe(false);
      fireEvent.submit(container.querySelector("form")!); expect(fetchMock).not.toHaveBeenCalled();
    });
  it("requires new consent on a mode change before sending", () => {
    vi.stubGlobal("fetch", vi.fn());
    const { rerender } = render(<ClaimValidationComposer {...props} />); open();
    rerender(<ClaimValidationComposer {...props} demo />);
    expect((screen.getByRole("checkbox") as HTMLInputElement).checked).toBe(false);
  });
  it("uses the frozen request mode for success and refresh on an unknown retry", async () => {
    const fetchMock = vi.fn().mockRejectedValueOnce(new TypeError("network"))
      .mockImplementationOnce(async (_url: string, init: RequestInit) => success(init));
    vi.stubGlobal("fetch", fetchMock);
    const { rerender } = render(<ClaimValidationComposer {...props} />); open();
    fireEvent.click(screen.getByRole("button", { name: "確認驗證並凍結" }));
    await screen.findByText(/上次結果未知/u);
    rerender(<ClaimValidationComposer {...props} demo />);
    fireEvent.click(screen.getByRole("button", { name: "核對原請求結果" }));
    await screen.findByText(/申報草稿已驗證並凍結明細/u);
    expect(screen.queryByText(/展示請求已通過相同欄位驗證/u)).toBeNull();
    expect(refresh).toHaveBeenCalledOnce();
  });
});
