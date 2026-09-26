// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ClaimValidationComposer } from "./claim-validation-composer";
import { clearClaimValidationPendingOnLogout, getClaimValidationPending } from "@/lib/service-management/claim-validation-pending";
import { hasPendingOperations, tryAcquirePendingOperation, tryAcquireViewTransition } from "@/lib/navigation/pending-operation-lock";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
const BATCH = "49000000-0000-4000-8000-000000000001";
const NEXT = "49000000-0000-4000-8000-000000000002";
const batches = [{ id: BATCH, periodLabel: "合成九月", itemCount: 2, totalAmount: "1200.10" },
  { id: NEXT, periodLabel: "合成十月", itemCount: 3, totalAmount: "300.00" }];
const scope = { organizationId: "49000000-0000-4000-8000-000000000003", branchId: "49000000-0000-4000-8000-000000000004", userId: "49000000-0000-4000-8000-000000000005" };
const props = { batches, enabled: true, hasRecentAal2: true, demo: false, scope };
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
    clearClaimValidationPendingOnLogout();
    refresh.mockReset(); let counter = 10;
    vi.stubGlobal("crypto", { randomUUID: () => `49000000-0000-4000-8000-${String(counter++).padStart(12, "0")}` });
    HTMLDialogElement.prototype.showModal = function () { this.setAttribute("open", ""); };
    HTMLDialogElement.prototype.close = function () { this.removeAttribute("open"); };
  });
  afterEach(() => { cleanup(); clearClaimValidationPendingOnLogout(); vi.unstubAllGlobals(); });

  it("only reports success after the exact persisted receipt", async () => {
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => success(init)); vi.stubGlobal("fetch", fetchMock);
    render(<ClaimValidationComposer {...props} />); open();
    fireEvent.click(screen.getByRole("button", { name: "確認驗證並凍結" }));
    await screen.findByText(/申報草稿已驗證並凍結明細/u);
    expect(fetchMock).toHaveBeenCalledOnce(); expect(refresh).toHaveBeenCalledOnce();
  });
  it.each(["before", "after"])("disables fresh claim work when another journal acquires its lease %s render", (when) => {
    let releaseOther: (() => void) | null = null;
    const fetchMock = vi.fn(); vi.stubGlobal("fetch", fetchMock); const random = vi.spyOn(crypto, "randomUUID");
    try {
      if (when === "before") releaseOther = tryAcquirePendingOperation()!;
      render(<ClaimValidationComposer {...props} />);
      if (when === "after") { open(); act(() => { releaseOther = tryAcquirePendingOperation()!; }); }
      const trigger = screen.getByRole("button", { name: "驗證草稿" }) as HTMLButtonElement;
      expect(trigger.disabled).toBe(true); expect(screen.getByRole("status").textContent).toContain("其他作業尚待確認");
      fireEvent.click(trigger);
      if (when === "after") {
        expect((screen.getByRole("button", { name: "確認驗證並凍結" }) as HTMLButtonElement).disabled).toBe(true);
        fireEvent.submit(screen.getByRole("dialog").querySelector("form")!);
      } else expect(screen.queryByRole("dialog")).toBeNull();
      expect(fetchMock).not.toHaveBeenCalled(); expect(random).not.toHaveBeenCalled();
      expect(getClaimValidationPending().operation).toBeNull();
      act(() => clearClaimValidationPendingOnLogout()); expect(hasPendingOperations()).toBe(true);
      act(() => { releaseOther?.(); releaseOther = null; }); expect(trigger.disabled).toBe(false);
    } finally { act(() => releaseOther?.()); random.mockRestore(); }
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
    expect(screen.queryByRole("checkbox")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "驗證草稿" }));
    expect((screen.getByRole("checkbox") as HTMLInputElement).checked).toBe(false);
  });
  it("hides original financial details and refuses retry after a mode change", async () => {
    const fetchMock = vi.fn().mockRejectedValueOnce(new TypeError("network"))
      .mockImplementationOnce(async (_url: string, init: RequestInit) => success(init));
    vi.stubGlobal("fetch", fetchMock);
    const { rerender } = render(<ClaimValidationComposer {...props} />); open();
    fireEvent.click(screen.getByRole("button", { name: "確認驗證並凍結" }));
    await screen.findByText(/上次結果未知/u);
    rerender(<ClaimValidationComposer {...props} demo />);
    expect(screen.queryByRole("button", { name: "核對原請求結果" })).toBeNull();
    expect(screen.queryByText(/1,200.10/u)).toBeNull();
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(screen.queryByText(/展示請求已通過相同欄位驗證/u)).toBeNull();
    expect(refresh).not.toHaveBeenCalled();
  });
  it("retains the exact operation across unmount/remount without automatic POST", async () => {
    const fetchMock = vi.fn().mockRejectedValueOnce(new TypeError("network")).mockImplementationOnce(async (_url: string, init: RequestInit) => success(init));
    vi.stubGlobal("fetch", fetchMock);
    const first = render(<ClaimValidationComposer {...props} />); open(); fireEvent.click(screen.getByRole("button", { name: "確認驗證並凍結" }));
    await screen.findByText(/上次結果未知/u); first.unmount(); expect(hasPendingOperations()).toBe(true);
    render(<ClaimValidationComposer {...props} batches={[{ ...batches[0]!, totalAmount: "9000.00" }]} />);
    expect(fetchMock).toHaveBeenCalledOnce(); fireEvent.click(screen.getByRole("button", { name: "核對上次申報驗證" }));
    expect(screen.queryByText(/9,000/u)).toBeNull(); fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: "核對原請求結果" })); await screen.findByText(/申報草稿已驗證並凍結明細/u);
    expect(fetchMock.mock.calls[1]![1].body).toBe(fetchMock.mock.calls[0]![1].body);
    expect(fetchMock.mock.calls[1]![1].headers).toEqual(fetchMock.mock.calls[0]![1].headers);
  });
  it.each(["branchId", "userId", "organizationId"] as const)("hides unknown details in another %s", async (field) => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("network")));
    const { rerender } = render(<ClaimValidationComposer {...props} />); open(); fireEvent.click(screen.getByRole("button", { name: "確認驗證並凍結" }));
    await screen.findByText(/上次結果未知/u);
    rerender(<ClaimValidationComposer {...props} scope={{ ...scope, [field]: NEXT }} />);
    expect(screen.queryByRole("combobox")).toBeNull(); expect(screen.queryByText(/1,200.10/u)).toBeNull();
    expect(screen.queryByRole("button", { name: "核對原請求結果" })).toBeNull(); expect(hasPendingOperations()).toBe(true);
  });
  it.each(["scope", "permission", "aal"])("ignores late success after ABA %s changes", async (change) => {
    let done!: (response: Response) => void;
    const fetchMock = vi.fn<(url: string, init: RequestInit) => Promise<Response>>(() => new Promise<Response>((resolve) => { done = resolve; })); vi.stubGlobal("fetch", fetchMock);
    const { rerender } = render(<ClaimValidationComposer {...props} />); open(); fireEvent.click(screen.getByRole("button", { name: "確認驗證並凍結" }));
    rerender(<ClaimValidationComposer {...props} {...(change === "scope" ? { scope: { ...scope, branchId: NEXT } } : change === "permission" ? { enabled: false } : { hasRecentAal2: false })} />);
    rerender(<ClaimValidationComposer {...props} />);
    await act(async () => { done(success(fetchMock.mock.calls[0]![1] as RequestInit)); });
    expect(refresh).not.toHaveBeenCalled(); expect(screen.queryByText(/申報草稿已驗證並凍結明細/u)).toBeNull();
    expect(getClaimValidationPending().operation?.phase).toBe("unknown"); expect(hasPendingOperations()).toBe(true);
  });
  it("never releases an unmounted in-flight operation on a late successful response", async () => {
    let done!: (response: Response) => void;
    const fetchMock = vi.fn<(url: string, init: RequestInit) => Promise<Response>>(() => new Promise<Response>((resolve) => { done = resolve; })); vi.stubGlobal("fetch", fetchMock);
    const first = render(<ClaimValidationComposer {...props} />); open(); fireEvent.click(screen.getByRole("button", { name: "確認驗證並凍結" })); first.unmount();
    render(<ClaimValidationComposer {...props} />); expect((screen.getByRole("button", { name: "核對上次申報驗證" }) as HTMLButtonElement).disabled).toBe(true);
    await act(async () => { done(success(fetchMock.mock.calls[0]![1] as RequestInit)); });
    expect(refresh).not.toHaveBeenCalled(); expect(getClaimValidationPending().operation?.phase).toBe("unknown");
  });
  it.each([[403, "CLAIM_VALIDATION_NOT_AUTHORIZED"], [409, "CLAIM_VALIDATION_ALREADY_COMPLETED"]] as const)(
    "keeps the original key after unknown followed by %s", async (status, code) => {
      const denied = Response.json({ requestId: BATCH, status: "error", data: null, errors: [{ code, message: "synthetic-denial" }] }, { status });
      const fetchMock = vi.fn().mockRejectedValueOnce(new TypeError("network")).mockResolvedValueOnce(denied);
      vi.stubGlobal("fetch", fetchMock); render(<ClaimValidationComposer {...props} />); open();
      fireEvent.click(screen.getByRole("button", { name: "確認驗證並凍結" })); await screen.findByText(/上次結果未知/u);
      const key = getClaimValidationPending().operation!.expected.idempotencyKey;
      fireEvent.click(screen.getByRole("button", { name: "核對原請求結果" }));
      await screen.findByText(/原操作結果仍未確認/u);
      expect(getClaimValidationPending().operation!.expected.idempotencyKey).toBe(key); expect(hasPendingOperations()).toBe(true);
    });
  it("safe logout discards old callbacks without clearing a subsequently started operation", async () => {
    let oldDone!: (response: Response) => void;
    const fetchMock = vi.fn().mockImplementationOnce(() => new Promise<Response>((resolve) => { oldDone = resolve; }))
      .mockRejectedValueOnce(new TypeError("network")); vi.stubGlobal("fetch", fetchMock);
    const first = render(<ClaimValidationComposer {...props} />); open(); fireEvent.click(screen.getByRole("button", { name: "確認驗證並凍結" }));
    act(() => clearClaimValidationPendingOnLogout()); first.unmount();
    render(<ClaimValidationComposer {...props} />); open(); fireEvent.click(screen.getByRole("button", { name: "確認驗證並凍結" }));
    await screen.findByText(/上次結果未知/u); const token = getClaimValidationPending().operation!.token;
    await act(async () => { oldDone(success(fetchMock.mock.calls[0]![1] as RequestInit)); });
    expect(getClaimValidationPending().operation!.token).toBe(token); expect(hasPendingOperations()).toBe(true); expect(refresh).not.toHaveBeenCalled();
  });
  it("coordinates two composers and prevents a fresh write during a view transition", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("network")));
    const release = tryAcquireViewTransition()!;
    const { rerender } = render(<><ClaimValidationComposer {...props} /><ClaimValidationComposer {...props} /></>);
    for (const button of screen.getAllByRole("button", { name: "驗證草稿" })) expect((button as HTMLButtonElement).disabled).toBe(true);
    act(() => release());
    fireEvent.click(screen.getAllByRole("button", { name: "驗證草稿" })[0]!); fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: "確認驗證並凍結" })); await screen.findAllByText(/上次結果未知/u);
    rerender(<ClaimValidationComposer {...props} />); expect(getClaimValidationPending().operation).not.toBeNull();
    expect(vi.mocked(fetch)).toHaveBeenCalledOnce();
  });
  it("retains a confirmed marker until fresh server props remove its draft", async () => {
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => success(init)); vi.stubGlobal("fetch", fetchMock);
    const { rerender } = render(<ClaimValidationComposer {...props} batches={[batches[0]!]} />); open(); fireEvent.click(screen.getByRole("button", { name: "確認驗證並凍結" }));
    await screen.findByText(/申報草稿已驗證並凍結明細/u); fireEvent.click(screen.getByRole("button", { name: "重新載入清單" }));
    expect(refresh).toHaveBeenCalledTimes(2); expect(fetchMock).toHaveBeenCalledOnce();
    expect(screen.getByText(/清單尚未確認更新/u)).not.toBeNull();
    rerender(<ClaimValidationComposer {...props} batches={[{ ...batches[0]! }]} />);
    expect((screen.getByRole("button", { name: "驗證草稿" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(/清單尚未確認更新/u)).not.toBeNull();
    rerender(<ClaimValidationComposer {...props} batches={[]} />);
    await waitFor(() => expect(getClaimValidationPending().confirmed).toHaveLength(0));
    expect(screen.queryByText(/清單尚未確認更新/u)).toBeNull();
    expect(screen.queryByRole("button", { name: "重新載入清單" })).toBeNull();
    expect(fetchMock).toHaveBeenCalledOnce();
  });
  it("rejects IME submission and uses canonical least-destructive focus", () => {
    vi.stubGlobal("fetch", vi.fn()); const { container } = render(<ClaimValidationComposer {...props} />); open();
    const form = container.querySelector("form")!; expect(form.noValidate).toBe(true);
    fireEvent.compositionStart(form); fireEvent.submit(form); expect(fetch).not.toHaveBeenCalled();
    fireEvent.compositionEnd(form); fireEvent.click(screen.getByRole("button", { name: "取消" }));
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "驗證草稿" }));
  });
  it.each(["permission", "close"])("does not retain an orphan IME flag after %s resets the dialog", (reset) => {
    const fetchMock = vi.fn(() => new Promise<Response>(() => {})); vi.stubGlobal("fetch", fetchMock);
    const { container, rerender } = render(<ClaimValidationComposer {...props} />); open();
    fireEvent.compositionStart(container.querySelector("form")!);
    if (reset === "permission") {
      rerender(<ClaimValidationComposer {...props} enabled={false} />); rerender(<ClaimValidationComposer {...props} />);
      fireEvent.click(screen.getByRole("checkbox"));
    } else {
      fireEvent.click(screen.getByRole("button", { name: "取消" })); open();
    }
    fireEvent.submit(container.querySelector("form")!); expect(fetchMock).toHaveBeenCalledOnce();
  });
});
