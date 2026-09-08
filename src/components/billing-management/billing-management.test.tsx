// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { staffPages } from "@/lib/catalog";
import { buildDemoBillingManagementSnapshot } from "@/lib/billing-management/demo";

import { BillingEntryForm, BillingInvoiceForm } from "./billing-management-actions";
import { BillingManagementWorkspace } from "./billing-management-workspace";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

const ORG = "64000000-0000-4000-8000-000000000101";
const BRANCH = "64000000-0000-4000-8000-000000000102";
const filters = { periodStart: "2026-09-01", periodEnd: "2026-09-07",
  clientId: null, paymentStatus: "all" as const };
const demoSnapshot = buildDemoBillingManagementSnapshot({ organizationId: ORG,
  branchId: BRANCH, filters, now: new Date("2026-09-07T05:00:00.000Z") });
const liveSnapshot = { ...demoSnapshot, demo: false };
const page = staffPages.find((entry) => entry.number === 64)!;

function sent(call: unknown[]) {
  const init = call[1] as RequestInit; const headers = new Headers(init.headers);
  return { action: headers.get("x-billing-management-action"),
    key: headers.get("idempotency-key"), body: JSON.parse(String(init.body)) as Record<string, unknown> };
}

function fillInvoice() {
  fireEvent.change(screen.getByLabelText("個案"), { target: { value: liveSnapshot.clients[0]!.clientId } });
  fireEvent.change(screen.getByLabelText("核准費目版本"), { target: { value: liveSnapshot.feeItems[0]!.feeItemVersionId } });
}

describe("Page 64 billing management UI boundary", () => {
  beforeEach(() => {
    refresh.mockReset(); let sequence = 300;
    vi.stubGlobal("crypto", { randomUUID: vi.fn(() =>
      `64000000-0000-4000-8000-${String(sequence++).padStart(12, "0")}`) });
  });
  afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

  it("fails closed without one authorized consistent snapshot", () => {
    render(<BillingManagementWorkspace canAdjust={false} canManage={false}
      canReconcile={false} filters={filters} hasRecentAal2={false} loadError
      page={page} snapshot={null} />);
    expect(screen.getByRole("heading", { name: "無法取得一致帳務快照" })).toBeInTheDocument();
    expect(screen.queryByText("合成個案甲")).not.toBeInTheDocument();
  });

  it("labels synthetic data and all non-configured safety boundaries", () => {
    render(<BillingManagementWorkspace canAdjust canManage canReconcile filters={filters}
      hasRecentAal2 loadError={false} page={page} snapshot={demoSnapshot} />);
    expect(screen.getByRole("heading", { name: "帳務管理" })).toBeInTheDocument();
    expect(screen.getByText(/展示模式.*皆為合成資料/u)).toBeInTheDocument();
    expect(screen.getByText(/第一版線上付款停用/u)).toBeInTheDocument();
    expect(screen.getByText(/法定文件與稅務計算不臆測/u)).toBeInTheDocument();
    expect(screen.getByText(/官方編號、發票、法定收據與匯出規則均為 not_configured/u)).toBeInTheDocument();
    expect(screen.queryByText("建立帳單（單一核准費目）")).not.toBeInTheDocument();
  });

  it("renders equivalent desktop table and mobile card evidence", () => {
    render(<BillingManagementWorkspace canAdjust={false} canManage={false}
      canReconcile={false} filters={filters} hasRecentAal2={false} loadError={false}
      page={page} snapshot={demoSnapshot} />);
    const table = screen.getByRole("table");
    expect(within(table).getByText("合成個案甲")).toBeInTheDocument();
    expect(table).toHaveTextContent("SYS-BILL-640000000001");
    expect(screen.getAllByText("合成個案甲")).toHaveLength(2);
    expect(document.body).toHaveTextContent("SYS-BILL-640000000001");
    expect(screen.getAllByText("部分付款").length).toBeGreaterThanOrEqual(2);
  });

  it("shows the exact approved fee versions, arithmetic and daily reconciliation", () => {
    render(<BillingManagementWorkspace canAdjust={false} canManage={false}
      canReconcile={false} filters={filters} hasRecentAal2={false} loadError={false}
      page={page} snapshot={demoSnapshot} />);
    const fees = screen.getByRole("heading", { name: "可用費目" }).closest("section")!;
    expect(within(fees).getByText(/DAY-SYN · 合成日照服務/u)).toBeInTheDocument();
    expect(within(fees).getByText(/稅務已明示含於單價/u)).toBeInTheDocument();
    const reconciliation = screen.getByRole("heading", { name: "對帳快照" }).closest("section")!;
    expect(within(reconciliation).getByText(/2026-09-07 · 完全一致/u)).toBeInTheDocument();
    expect(within(reconciliation).getAllByText("NT$224.99")).toHaveLength(2);
    expect(within(reconciliation).getByText("NT$0.00")).toBeInTheDocument();
  });

  it("fails invoice creation closed when approved fee rules are not configured", () => {
    const unavailable = { ...liveSnapshot, feeConfigurationStatus: "not_configured" as const,
      feeItems: [], feeItemTotal: 0 };
    render(<BillingInvoiceForm canManage hasRecentAal2 snapshot={unavailable} />);
    expect(screen.getByRole("heading", { name: "核准費目尚未配置，停止建立帳單" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "建立帳單" })).not.toBeInTheDocument();
  });

  it("requires recent same-session AAL2 before any write form", () => {
    render(<BillingInvoiceForm canManage hasRecentAal2={false} snapshot={liveSnapshot} />);
    expect(screen.getByRole("heading", { name: "建立帳單前需重新驗證" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "前往雙重驗證" })).toHaveAttribute("href", "/mfa?audience=staff");
  });

  it("retains exact operation and invoice keys after an unknown network result", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error("fetch failed"));
    vi.stubGlobal("fetch", fetchMock);
    render(<BillingInvoiceForm canManage hasRecentAal2 snapshot={liveSnapshot} />); fillInvoice();
    fireEvent.click(screen.getByRole("button", { name: "建立帳單" }));
    await screen.findByText(/結果未知.*相同操作鍵重試/u);
    const first = sent(fetchMock.mock.calls[0]!);
    expect(first.action).toBe("create_invoice");
    fireEvent.click(screen.getByRole("button", { name: "建立帳單" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    const second = sent(fetchMock.mock.calls[1]!);
    expect(second.key).toBe(first.key); expect(second.body.invoice_key).toBe(first.body.invoice_key);
    fireEvent.input(screen.getByLabelText("明細備註（選填）"), { target: { value: "不同內容" } });
    fireEvent.click(screen.getByRole("button", { name: "建立帳單" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
    const third = sent(fetchMock.mock.calls[2]!);
    expect(third.key).not.toBe(first.key); expect(third.body.invoice_key).not.toBe(first.body.invoice_key);
  });

  it("accepts only an exact 201 persisted browser receipt before declaring success", async () => {
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body)) as Record<string, unknown>;
      return Response.json({ requestId: "64000000-0000-4000-8000-000000000390",
        status: "ok", data: { persisted: true, demo: false, receipt: {
          organizationId: ORG, branchId: BRANCH, clientId: liveSnapshot.clients[0]!.clientId,
          invoiceId: "64000000-0000-4000-8000-000000000391",
          invoiceKey: body.invoice_key, invoiceNumber: "SYS-BILL-640000000300",
          invoiceVersion: 1, invoiceLedgerVersion: 1, branchLedgerVersion: 7,
          invoiceTotal: "100.00", balanceAfter: "100.00", lineCount: 1,
          paymentStatus: "unpaid", committedAt: "2026-09-07T05:01:00.000Z",
          replayed: false, persisted: true, demo: false } }, errors: [] }, { status: 201 });
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<BillingInvoiceForm canManage hasRecentAal2 snapshot={liveSnapshot} />); fillInvoice();
    fireEvent.click(screen.getByRole("button", { name: "建立帳單" }));
    expect(await screen.findByText(/帳單與第一筆不可變應收流水/u)).toBeInTheDocument();
    expect(refresh).toHaveBeenCalledOnce();
  });

  it("sends only staff-recorded offline payment facts with exact versions", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error("fetch failed")); vi.stubGlobal("fetch", fetchMock);
    render(<BillingEntryForm canAdjust canManage hasRecentAal2 snapshot={liveSnapshot} />);
    fireEvent.change(screen.getByLabelText("金額（TWD）"), { target: { value: "12.34" } });
    fireEvent.change(screen.getByLabelText("實際離線付款方式"), { target: { value: "bank_transfer" } });
    expect(screen.queryByRole("option", { name: /信用卡|線上付款/u })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "寫入不可變流水" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    const request = sent(fetchMock.mock.calls[0]!);
    expect(request.action).toBe("record_payment");
    expect(request.body).toMatchObject({ entry_kind: "payment", amount: "12.34",
      payment_method: "bank_transfer", expected_invoice_ledger_version: 4,
      expected_branch_ledger_version: 6 });
  });

  it("freezes dedicated permissions and forbids online-payment claims in the catalog", () => {
    expect(page.requiredPermissions).toEqual(["billing.read"]);
    expect(page.primaryActions).toContain("登記離線付款");
    expect(page.acceptance.join(" ")).toMatch(/not_configured fail closed/u);
    expect(page.acceptance.join(" ")).toMatch(/actor-scoped.*15 分鐘 AAL2/u);
    expect(page.acceptance.join(" ")).toMatch(/第一版線上付款.*停用/u);
  });
});
