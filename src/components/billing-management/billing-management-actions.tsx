"use client";

import Link from "next/link";
import { useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import { fetchWithTimeout, isClientFetchTimeoutError } from "@/lib/api/client-fetch";
import { BILLING_ACTION_HEADER, parseBillingEntryApiEnvelope,
  parseBillingInvoiceApiEnvelope, parseBillingReceiptApiEnvelope,
  parseBillingReconciliationApiEnvelope, parseCreateBillingInvoiceInput,
  parseIssueBillingReceiptInput, parseRecordBillingEntryInput,
  parseRunBillingReconciliationInput } from "@/lib/billing-management/parser";
import type { BillingManagementSnapshot, BillingTransactionKind } from
  "@/lib/billing-management/types";

import styles from "./billing-management.module.css";

function unknownResult(error: unknown) {
  if (isClientFetchTimeoutError(error) || error instanceof Error &&
    /fetch|request failed|回執/u.test(error.message)) {
    return "連線中斷、逾時或回執無法核對，結果未知；內容未修改時請保留相同操作鍵重試。";
  }
  return error instanceof Error && error.message ? error.message :
    "帳務操作未完成；請重新核對輸入與最新版本。";
}

function useOperationKeys() {
  const operation = useRef<string | null>(null);
  const entity = useRef<string | null>(null);
  const failed = useRef(false);
  return {
    operation() { operation.current ??= crypto.randomUUID(); return operation.current; },
    entity() { entity.current ??= crypto.randomUUID(); return entity.current; },
    failed() { failed.current = true; },
    succeeded() { operation.current = null; entity.current = null; failed.current = false; },
    changed(clear: () => void) {
      if (!failed.current) return;
      operation.current = null; entity.current = null; failed.current = false; clear();
    },
  };
}

async function submitBilling(method: "POST" | "PATCH", action: string,
  idempotencyKey: string, body: Record<string, unknown>) {
  const response = await fetchWithTimeout("/api/billing-management", {
    method, cache: "no-store", headers: { "content-type": "application/json",
      "idempotency-key": idempotencyKey, [BILLING_ACTION_HEADER]: action },
    body: JSON.stringify(body),
  });
  const envelope: unknown = await response.json();
  if (!response.ok) {
    const message = typeof envelope === "object" && envelope !== null &&
      "errors" in envelope && Array.isArray(envelope.errors) &&
      typeof envelope.errors[0]?.message === "string" ? envelope.errors[0].message :
      "帳務要求被拒絕。";
    throw new Error(message);
  }
  return { envelope, httpStatus: response.status };
}

function Reauth({ title }: { title: string }) {
  return <section className={styles.reauth}><h2>{title}</h2>
    <p>帳單、付款、退款、調整、收據與對帳都要使用同一工作階段最近 15 分鐘內的雙重驗證。</p>
    <Link className="button button--secondary" href="/mfa?audience=staff&purpose=sensitive-action">前往雙重驗證</Link>
  </section>;
}

export function BillingInvoiceForm({ canManage, hasRecentAal2, snapshot }: {
  canManage: boolean; hasRecentAal2: boolean; snapshot: BillingManagementSnapshot;
}) {
  const router = useRouter(); const keys = useOperationKeys();
  const [pending, setPending] = useState(false); const [message, setMessage] = useState<string | null>(null);
  if (!canManage || snapshot.demo) return null;
  if (snapshot.feeConfigurationStatus === "not_configured") return <section
    className={styles.blocked} role="alert"><h2>核准費目尚未配置，停止建立帳單</h2>
    <p>必須先發布期間唯一的費目版本、精確單價及稅務處理；系統不會猜測費率或稅額。</p>
  </section>;
  if (!hasRecentAal2) return <Reauth title="建立帳單前需重新驗證" />;
  return <details className={styles.composer}><summary>建立帳單（單一核准費目）</summary>
    <form onInput={() => keys.changed(() => setMessage(null))} onSubmit={async (event) => {
      event.preventDefault(); setPending(true); setMessage(null);
      try {
        const data = new FormData(event.currentTarget);
        const input = parseCreateBillingInvoiceInput({ action: "create_invoice",
          client_id: data.get("client"), invoice_key: keys.entity(),
          period_start: data.get("periodStart"), period_end: data.get("periodEnd"),
          issued_on: data.get("issuedOn"), due_on: data.get("dueOn"),
          lines: [{ fee_item_version_id: data.get("fee"), service_date: data.get("serviceDate"),
            quantity: data.get("quantity"), line_note: data.get("lineNote") || null }],
          expected_invoice_version: 0,
          expected_branch_ledger_version: snapshot.branchLedgerVersion,
        }, keys.operation());
        const result = await submitBilling("POST", "create_invoice", input.idempotencyKey, {
          action: input.action, client_id: input.clientId, invoice_key: input.invoiceKey,
          period_start: input.periodStart, period_end: input.periodEnd,
          issued_on: input.issuedOn, due_on: input.dueOn,
          lines: input.lines.map((line) => ({ fee_item_version_id: line.feeItemVersionId,
            service_date: line.serviceDate, quantity: line.quantity, line_note: line.lineNote })),
          expected_invoice_version: input.expectedInvoiceVersion,
          expected_branch_ledger_version: input.expectedBranchLedgerVersion,
        });
        parseBillingInvoiceApiEnvelope(result.envelope, input, snapshot.organizationId,
          snapshot.branchId, result.httpStatus);
        keys.succeeded(); setMessage("帳單與第一筆不可變應收流水已以同一交易建立。"); router.refresh();
      } catch (error) { keys.failed(); setMessage(unknownResult(error)); }
      finally { setPending(false); }
    }}><fieldset className={styles.formGrid} disabled={pending}>
      <label><span>個案</span><select name="client" required defaultValue=""><option value="" disabled>選擇個案</option>
        {snapshot.clients.map((client) => <option key={client.clientId} value={client.clientId}>
          {client.displayName} · {client.clientCode}</option>)}</select></label>
      <label><span>核准費目版本</span><select name="fee" required defaultValue=""><option value="" disabled>選擇有效費目</option>
        {snapshot.feeItems.map((fee) => <option key={fee.feeItemVersionId} value={fee.feeItemVersionId}>
          {fee.feeCode} · {fee.feeName} · {fee.unitPrice} TWD／{fee.unitLabel}</option>)}</select></label>
      <label><span>帳務起日</span><input name="periodStart" type="date" defaultValue={snapshot.filters.periodStart} required /></label>
      <label><span>帳務迄日</span><input name="periodEnd" type="date" defaultValue={snapshot.filters.periodEnd} required /></label>
      <label><span>服務日期</span><input name="serviceDate" type="date" defaultValue={snapshot.filters.periodEnd} required /></label>
      <label><span>數量（最多四位小數）</span><input name="quantity" inputMode="decimal" pattern="(?:0|[1-9][0-9]{0,7})(?:\.[0-9]{1,4})?" defaultValue="1.0000" required /></label>
      <label><span>內部開立日</span><input name="issuedOn" type="date" defaultValue={snapshot.filters.periodEnd} required /></label>
      <label><span>到期日</span><input name="dueOn" type="date" defaultValue={snapshot.filters.periodEnd} required /></label>
      <label className={styles.wide}><span>明細備註（選填）</span><textarea name="lineNote" maxLength={500} /></label>
      <p className={styles.wide}>單價與稅務處理只從已核准生效版本快照帶入，送出內容不能自行指定。</p>
      <button className="button button--primary" type="submit">{pending ? "建立中…" : "建立帳單"}</button>
    </fieldset>{message ? <p className={styles.formMessage} role="status">{message}</p> : null}</form>
  </details>;
}

function toLocalDatetime(value: string) {
  const date = new Date(value); const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Taipei",
    year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit",
    hourCycle: "h23" }).formatToParts(date);
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}`;
}

export function BillingEntryForm({ canAdjust, canManage, hasRecentAal2, snapshot }: {
  canAdjust: boolean; canManage: boolean; hasRecentAal2: boolean; snapshot: BillingManagementSnapshot;
}) {
  const router = useRouter(); const keys = useOperationKeys();
  const [kind, setKind] = useState<BillingTransactionKind>("payment");
  const [invoiceId, setInvoiceId] = useState(snapshot.invoices[0]?.invoiceId ?? "");
  const [pending, setPending] = useState(false); const [message, setMessage] = useState<string | null>(null);
  const invoice = snapshot.invoices.find((item) => item.invoiceId === invoiceId) ?? snapshot.invoices[0];
  const refundable = invoice?.entries.filter((entry) => entry.entryKind === "payment") ?? [];
  if (!canManage || snapshot.demo || snapshot.invoices.length === 0) return null;
  if (!hasRecentAal2) return <Reauth title="登記付款或調整前需重新驗證" />;
  return <details className={styles.composer}><summary>登記離線付款、退款或人工調整</summary>
    <form onInput={() => keys.changed(() => setMessage(null))} onSubmit={async (event) => {
      event.preventDefault(); if (!invoice) return; setPending(true); setMessage(null);
      try {
        const data = new FormData(event.currentTarget); const rawTime = String(data.get("occurredAt"));
        const input = parseRecordBillingEntryInput({ action: "record_entry", invoice_id: invoice.invoiceId,
          entry_kind: kind, amount: data.get("amount"), original_entry_id: kind === "refund" ? data.get("originalEntry") : null,
          payment_method: kind === "payment" ? data.get("paymentMethod") : null,
          occurred_at: new Date(`${rawTime}:00+08:00`).toISOString(), note: data.get("note") || null,
          expected_invoice_ledger_version: invoice.invoiceLedgerVersion,
          expected_branch_ledger_version: snapshot.branchLedgerVersion,
        }, keys.operation());
        const result = await submitBilling("PATCH", `record_${input.entryKind}`, input.idempotencyKey, {
          action: input.action, invoice_id: input.invoiceId, entry_kind: input.entryKind,
          amount: input.amount, original_entry_id: input.originalEntryId,
          payment_method: input.paymentMethod, occurred_at: input.occurredAt, note: input.note,
          expected_invoice_ledger_version: input.expectedInvoiceLedgerVersion,
          expected_branch_ledger_version: input.expectedBranchLedgerVersion,
        });
        parseBillingEntryApiEnvelope(result.envelope, input, snapshot.organizationId,
          snapshot.branchId, result.httpStatus);
        keys.succeeded(); setMessage(kind === "payment" ? "離線付款已登記；未向任何金流送出扣款。" :
          kind === "refund" ? "退款已連結原付款並寫入不可變流水。" : "調整與理由已寫入不可變流水。");
        router.refresh();
      } catch (error) { keys.failed(); setMessage(unknownResult(error)); }
      finally { setPending(false); }
    }}><fieldset className={styles.formGrid} disabled={pending}>
      <label><span>帳單</span><select value={invoice?.invoiceId ?? ""} onChange={(event) => setInvoiceId(event.target.value)}>
        {snapshot.invoices.map((item) => <option key={item.invoiceId} value={item.invoiceId}>{item.invoiceNumber} · {item.clientDisplayName} · 餘額 {item.balance}</option>)}</select></label>
      <label><span>操作</span><select name="kind" value={kind} onChange={(event) => setKind(event.target.value as BillingTransactionKind)}>
        <option value="payment">登記離線付款</option>{canAdjust ? <><option value="refund">退款</option>
          <option value="adjustment_debit">增加應收調整</option><option value="adjustment_credit">減少應收調整</option></> : null}</select></label>
      <label><span>金額（TWD）</span><input name="amount" inputMode="decimal" pattern="(?:0|[1-9][0-9]{0,15})(?:\.[0-9]{1,2})?" required /></label>
      <label><span>發生時間（台北）</span><input name="occurredAt" type="datetime-local" defaultValue={toLocalDatetime(snapshot.generatedAt)} required /></label>
      {kind === "payment" ? <label><span>實際離線付款方式</span><select name="paymentMethod" required>
        <option value="cash">現金</option><option value="bank_transfer">銀行轉帳</option><option value="offline_other">其他離線方式</option>
      </select></label> : null}
      {kind === "refund" ? <label><span>原付款流水</span><select name="originalEntry" required defaultValue=""><option value="" disabled>選擇原付款</option>
        {refundable.map((entry) => <option key={entry.entryId} value={entry.entryId}>{entry.amount} TWD · {toLocalDatetime(entry.occurredAt)}</option>)}</select></label> : null}
      <label className={styles.wide}><span>{kind === "payment" ? "備註（選填）" : "退款／調整理由（至少兩字）"}</span>
        <textarea name="note" minLength={kind === "payment" ? undefined : 2} maxLength={1000} required={kind !== "payment"} /></label>
      <p className={styles.wide}>線上付款停用；本操作只登記已在系統外完成的付款事實。</p>
      <button className="button button--primary" type="submit">{pending ? "寫入中…" : "寫入不可變流水"}</button>
    </fieldset>{message ? <p className={styles.formMessage} role="status">{message}</p> : null}</form>
  </details>;
}

export function BillingReceiptForm({ canManage, hasRecentAal2, snapshot }: {
  canManage: boolean; hasRecentAal2: boolean; snapshot: BillingManagementSnapshot;
}) {
  const router = useRouter(); const keys = useOperationKeys();
  const candidates = useMemo(() => snapshot.invoices.flatMap((invoice) => {
    const recorded = new Set(invoice.receipts.map((receipt) => receipt.paymentEntryId));
    return invoice.entries.filter((entry) => entry.entryKind === "payment" && !recorded.has(entry.entryId))
      .map((entry) => ({ invoice, entry }));
  }), [snapshot]);
  const [pending, setPending] = useState(false); const [message, setMessage] = useState<string | null>(null);
  if (!canManage || snapshot.demo || candidates.length === 0) return null;
  if (!hasRecentAal2) return <Reauth title="建立內部收據紀錄前需重新驗證" />;
  return <details className={styles.composer}><summary>建立內部非稅務收據紀錄</summary>
    <form onInput={() => keys.changed(() => setMessage(null))} onSubmit={async (event) => {
      event.preventDefault(); setPending(true); setMessage(null);
      try {
        const selected = candidates.find((item) => item.entry.entryId === new FormData(event.currentTarget).get("payment"));
        if (!selected) throw new Error("請選擇尚未建立收據紀錄的付款。");
        const input = parseIssueBillingReceiptInput({ action: "issue_receipt",
          invoice_id: selected.invoice.invoiceId, payment_entry_id: selected.entry.entryId,
          receipt_key: keys.entity(), expected_invoice_ledger_version: selected.invoice.invoiceLedgerVersion,
        }, keys.operation());
        const result = await submitBilling("PATCH", "issue_receipt", input.idempotencyKey, {
          action: input.action, invoice_id: input.invoiceId, payment_entry_id: input.paymentEntryId,
          receipt_key: input.receiptKey, expected_invoice_ledger_version: input.expectedInvoiceLedgerVersion,
        });
        parseBillingReceiptApiEnvelope(result.envelope, input, snapshot.organizationId,
          snapshot.branchId, result.httpStatus);
        keys.succeeded(); setMessage("已建立內部付款收據紀錄；法定憑證輸出仍維持 not_configured。"); router.refresh();
      } catch (error) { keys.failed(); setMessage(unknownResult(error)); }
      finally { setPending(false); }
    }}><fieldset className={styles.formGrid} disabled={pending}>
      <label className={styles.wide}><span>付款流水</span><select name="payment" required defaultValue=""><option value="" disabled>選擇未建收據紀錄的付款</option>
        {candidates.map(({ invoice, entry }) => <option key={entry.entryId} value={entry.entryId}>{invoice.invoiceNumber} · {invoice.clientDisplayName} · {entry.amount} TWD</option>)}</select></label>
      <p className={styles.wide}>這是內部非稅務參考紀錄；在官方編號與法定格式核准前，不產生發票或法定收據。</p>
      <button className="button button--primary" type="submit">{pending ? "建立中…" : "建立內部收據紀錄"}</button>
    </fieldset>{message ? <p className={styles.formMessage} role="status">{message}</p> : null}</form>
  </details>;
}

export function BillingReconciliationForm({ canReconcile, hasRecentAal2, snapshot }: {
  canReconcile: boolean; hasRecentAal2: boolean; snapshot: BillingManagementSnapshot;
}) {
  const router = useRouter(); const keys = useOperationKeys();
  const [pending, setPending] = useState(false); const [message, setMessage] = useState<string | null>(null);
  if (!canReconcile || snapshot.demo) return null;
  if (!hasRecentAal2) return <Reauth title="每日對帳前需重新驗證" />;
  return <details className={styles.composer}><summary>執行每日明細與流水對帳</summary>
    <form onInput={() => keys.changed(() => setMessage(null))} onSubmit={async (event) => {
      event.preventDefault(); setPending(true); setMessage(null);
      try {
        const input = parseRunBillingReconciliationInput({ action: "run_reconciliation",
          reconciliation_date: new FormData(event.currentTarget).get("date"),
          expected_branch_ledger_version: snapshot.branchLedgerVersion,
        }, keys.operation());
        const result = await submitBilling("PATCH", "run_reconciliation", input.idempotencyKey, {
          action: input.action, reconciliation_date: input.reconciliationDate,
          expected_branch_ledger_version: input.expectedBranchLedgerVersion,
        });
        parseBillingReconciliationApiEnvelope(result.envelope, input, snapshot.organizationId,
          snapshot.branchId, result.httpStatus);
        keys.succeeded(); setMessage("已固定本分支流水版本並完成每日明細對帳。"); router.refresh();
      } catch (error) { keys.failed(); setMessage(unknownResult(error)); }
      finally { setPending(false); }
    }}><fieldset className={styles.formGrid} disabled={pending}>
      <label><span>對帳日（台北）</span><input name="date" type="date" defaultValue={snapshot.filters.periodEnd} required /></label>
      <p>將核對帳單明細餘額與不可變流水餘額；差異不會被自動調整。</p>
      <button className="button button--primary" type="submit">{pending ? "對帳中…" : "執行每日對帳"}</button>
    </fieldset>{message ? <p className={styles.formMessage} role="status">{message}</p> : null}</form>
  </details>;
}
