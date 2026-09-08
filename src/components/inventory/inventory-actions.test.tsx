// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ClientFetchTimeoutError } from "@/lib/api/client-fetch";
import { buildDemoInventoryManagementSnapshot } from "@/lib/inventory/demo";

import { InventoryItemCreateForm, InventoryMovementForm } from "./inventory-actions";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

const ORG = "77000000-0000-4000-8000-000000000001";
const BRANCH = "77000000-0000-4000-8000-000000000002";
const ITEM = "77000000-0000-4000-8000-000000000001";
const BATCH = "77000000-0000-4000-8000-000000000002";
const MOVEMENT = "77000000-0000-4000-8000-000000000009";
const REQUEST = "77000000-0000-4000-8000-000000000008";

const snapshot = buildDemoInventoryManagementSnapshot({
  organizationId: ORG, branchId: BRANCH,
  filters: { itemId: null, query: "", batchQuery: "",
    expiryStatus: "all", movementType: "all" },
});
function headerKey(call: unknown[]) {
  return ((call[1] as RequestInit).headers as Record<string, string>)["idempotency-key"];
}
function fillReceipt() {
  fireEvent.change(screen.getByLabelText("品項"), { target: { value: ITEM } });
  fireEvent.change(screen.getByLabelText("批次"), { target: { value: BATCH } });
  fireEvent.change(screen.getByLabelText("數量（最多四位小數）"), {
    target: { value: "1.0000" },
  });
}

describe("inventory mutation forms", () => {
  beforeEach(() => {
    refresh.mockReset();
    let sequence = 20;
    vi.stubGlobal("crypto", { randomUUID: vi.fn(() =>
      `77000000-0000-4000-8000-${String(sequence++).padStart(12, "0")}`) });
  });
  afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

  it("keeps an unchanged uncertain movement key and rotates it after editing", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error("fetch failed"));
    vi.stubGlobal("fetch", fetchMock);
    render(<InventoryMovementForm canAdjust canManage hasRecentAal2 snapshot={snapshot} />);
    fillReceipt();
    fireEvent.click(screen.getByRole("button", { name: "追加異動" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    await screen.findByText("網路中斷，操作結果未知；請保留內容，未修改時可使用原操作鍵重試。");
    const firstKey = headerKey(fetchMock.mock.calls[0]!);
    fireEvent.click(screen.getByRole("button", { name: "追加異動" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(headerKey(fetchMock.mock.calls[1]!)).toBe(firstKey);
    fireEvent.change(screen.getByLabelText("數量（最多四位小數）"), {
      target: { value: "2.0000" },
    });
    fireEvent.click(screen.getByRole("button", { name: "追加異動" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
    expect(headerKey(fetchMock.mock.calls[2]!)).not.toBe(firstKey);
  });

  it("labels a bounded timeout as an unknown result and keeps the retry key", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new ClientFetchTimeoutError(20_000));
    vi.stubGlobal("fetch", fetchMock);
    render(<InventoryMovementForm canAdjust canManage hasRecentAal2 snapshot={snapshot} />);
    fillReceipt();
    fireEvent.click(screen.getByRole("button", { name: "追加異動" }));
    await screen.findByText(
      "連線逾時，操作結果未知；請保留內容，未修改時可使用原操作鍵重試。",
    );
    const firstKey = headerKey(fetchMock.mock.calls[0]!);
    fireEvent.click(screen.getByRole("button", { name: "追加異動" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(headerKey(fetchMock.mock.calls[1]!)).toBe(firstKey);
  });

  it("locks the complete movement fieldset while persistence is pending", async () => {
    let finish!: (response: Response) => void;
    const fetchMock = vi.fn((...args: [RequestInfo | URL, RequestInit?]) => {
      void args;
      return new Promise<Response>((resolve) => { finish = resolve; });
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<InventoryMovementForm canAdjust canManage hasRecentAal2 snapshot={snapshot} />);
    fillReceipt();
    fireEvent.click(screen.getByRole("button", { name: "追加異動" }));
    const fieldset = screen.getByLabelText("異動類型").closest("fieldset") as HTMLFieldSetElement;
    await waitFor(() => expect(fieldset.disabled).toBe(true));
    const body = JSON.parse((fetchMock.mock.calls[0]![1] as RequestInit).body as string) as {
      occurred_at: string;
    };
    finish(new Response(JSON.stringify({ requestId: REQUEST, status: "ok", data: {
      receipt: { organizationId: ORG, branchId: BRANCH, itemId: ITEM, batchId: BATCH,
        movementId: MOVEMENT, movementType: "receipt", ledgerVersion: 2,
        quantity: "1.0000", quantityDelta: "1.0000", balanceAfter: "9.0000",
        occurredAt: body.occurred_at, replayed: false, persisted: true, demo: false },
      persisted: true, demo: false }, errors: [] }), { status: 201 }));
    await screen.findByText("異動已追加保存；批次與歷史紀錄未被覆寫。");
    expect(fieldset.disabled).toBe(false);
  });

  it("disables adjustment and stocktake without both permission and recent AAL2", () => {
    render(<InventoryMovementForm canAdjust canManage hasRecentAal2={false} snapshot={snapshot} />);
    fireEvent.change(screen.getByLabelText("異動類型"), { target: { value: "stocktake" } });
    expect((screen.getByRole("button", { name: "追加異動" }) as HTMLButtonElement).disabled)
      .toBe(true);
    expect(screen.getByRole("alert").textContent).toContain("15 分鐘內");
  });

  it("limits batches to the selected item and requires governed new-batch fields", () => {
    const OTHER_ITEM = "77000000-0000-4000-8000-000000000010";
    const OTHER_BATCH = "77000000-0000-4000-8000-000000000011";
    const expanded = { ...snapshot,
      itemOptions: [...snapshot.itemOptions, { ...snapshot.itemOptions[0]!,
        itemId: OTHER_ITEM, itemCode: "OTHER", itemName: "其他品項" }],
      batches: [...snapshot.batches, { ...snapshot.batches[0]!,
        itemId: OTHER_ITEM, batchId: OTHER_BATCH, itemCode: "OTHER",
        itemName: "其他品項", batchNumber: "OTHER-LOT" }],
    };
    render(<InventoryMovementForm canAdjust canManage hasRecentAal2 snapshot={expanded} />);
    fireEvent.change(screen.getByLabelText("品項"), { target: { value: ITEM } });
    const batchSelect = screen.getByLabelText("批次") as HTMLSelectElement;
    expect([...batchSelect.options].map((option) => option.textContent)).not.toContain(
      "其他品項 · OTHER-LOT · 餘 8.0000 盒",
    );
    fireEvent.change(batchSelect, { target: { value: "new" } });
    expect((screen.getByLabelText("新批號（選新批次時填）") as HTMLInputElement).required)
      .toBe(true);
    expect((screen.getByLabelText("新批次效期") as HTMLInputElement).min)
      .toBe(snapshot.snapshotDate);
    expect((screen.getByLabelText("發生時間（台北）") as HTMLInputElement).max)
      .not.toBe("");
  });

  it("locks all item-master inputs while creation is pending", async () => {
    vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>(() => undefined)));
    render(<InventoryItemCreateForm canManage snapshot={snapshot} />);
    fireEvent.change(screen.getByLabelText("品項代碼"), { target: { value: "NEW" } });
    fireEvent.change(screen.getByLabelText("品項名稱"), { target: { value: "新品" } });
    fireEvent.change(screen.getByLabelText("固定單位"), { target: { value: "包" } });
    fireEvent.click(screen.getByRole("button", { name: "建立品項" }));
    const fieldset = screen.getByLabelText("品項代碼").closest("fieldset") as HTMLFieldSetElement;
    await waitFor(() => expect(fieldset.disabled).toBe(true));
  });
});
