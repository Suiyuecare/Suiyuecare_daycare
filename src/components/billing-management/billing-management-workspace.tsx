import { AlertTriangle, Banknote, BookOpenCheck, CircleDollarSign,
  ReceiptText, RotateCcw } from "lucide-react";
import Link from "next/link";

import type { BillingInvoice, BillingManagementSnapshot } from
  "@/lib/billing-management/types";
import type { PageCatalogEntry } from "@/lib/catalog";

import { BillingEntryForm, BillingInvoiceForm, BillingReceiptForm,
  BillingReconciliationForm } from "./billing-management-actions";
import styles from "./billing-management.module.css";

const STATUS = { unpaid: "未付款", partial: "部分付款", paid: "已結清" } as const;
const ENTRY = { invoice_charge: "帳單應收", payment: "離線付款", refund: "退款",
  adjustment_debit: "增加應收調整", adjustment_credit: "減少應收調整" } as const;
const TAX = { explicitly_included_in_unit_price: "稅務已明示含於單價",
  explicitly_exempt: "已明示免稅", explicitly_not_applicable: "已明示不適用稅務" } as const;
const PAYMENT = { cash: "現金", bank_transfer: "銀行轉帳", offline_other: "其他離線方式" } as const;

function money(value: string) {
  const negative = value.startsWith("-");
  const [integer, fraction = ""] = (negative ? value.slice(1) : value).split(".");
  const grouped = integer!.replace(/\B(?=(\d{3})+(?!\d))/gu, ",");
  return `${negative ? "-" : ""}NT$${grouped}.${`${fraction}00`.slice(0, 2)}`;
}
function taipei(value: string) {
  return new Intl.DateTimeFormat("zh-TW", { timeZone: "Asia/Taipei", year: "numeric",
    month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit",
    hourCycle: "h23" }).format(new Date(value));
}

function InvoiceDetails({ invoice }: { invoice: BillingInvoice }) {
  return <div className={styles.invoiceDetails}>
    <section aria-label={`${invoice.invoiceNumber} 核准費目明細`}><h4>核准費目明細</h4>
      <ol className={styles.detailList}>{invoice.lines.map((line) => <li key={line.lineId}>
        <div><strong>{line.feeCode} · {line.feeName}</strong><span>{line.serviceDate}</span></div>
        <p>{line.quantity} {line.unitLabel} × {money(line.unitPrice)} = <strong>{money(line.amount)}</strong></p>
        <small>{TAX[line.taxHandling]} · 費目版本 {line.feeItemVersionId.slice(0, 8)}…</small>
      </li>)}</ol>
    </section>
    <section aria-label={`${invoice.invoiceNumber} 不可變流水`}><h4>不可變流水</h4>
      <ol className={styles.timeline}>{invoice.entries.map((entry) => <li key={entry.entryId}>
        <div><strong>v{entry.invoiceLedgerVersion} · {ENTRY[entry.entryKind]}</strong>
          <span className={entry.signedAmount.startsWith("-") ? styles.negative : styles.positive}>
            {entry.signedAmount.startsWith("-") ? "" : "+"}{money(entry.signedAmount)}</span></div>
        <p>餘額 {money(entry.balanceAfter)} · {taipei(entry.occurredAt)}</p>
        <small>{entry.paymentMethod ? `${PAYMENT[entry.paymentMethod]} · ` : ""}
          {entry.sourceChannel === "staff_recorded_offline" ? "人員登記離線事實" : "內部帳務流水"}
          {entry.note ? ` · ${entry.note}` : ""}</small>
      </li>)}</ol>
      {invoice.entriesTruncated ? <p role="status">只顯示最近 200 筆流水，請縮小查詢範圍。</p> : null}
    </section>
    <section aria-label={`${invoice.invoiceNumber} 內部收據紀錄`}><h4>內部收據紀錄</h4>
      {invoice.receipts.length ? <ul className={styles.receipts}>{invoice.receipts.map((receipt) => <li key={receipt.receiptId}>
        <strong>{receipt.receiptNumber}</strong><span>{money(receipt.amount)} · {taipei(receipt.issuedAt)}</span>
        <small>內部非稅務紀錄 · 法定文件 {receipt.documentStatus}</small>
      </li>)}</ul> : <p>尚無內部收據紀錄。</p>}
    </section>
    <dl className={styles.auditGrid}><div><dt>帳單內容雜湊</dt><dd>{invoice.contentHash.slice(0, 16)}…</dd></div>
      <div><dt>帳單流水版本</dt><dd>{invoice.invoiceLedgerVersion}</dd></div>
      <div><dt>最新流水</dt><dd>{taipei(invoice.latestEntryAt)}</dd></div></dl>
  </div>;
}

export function BillingManagementWorkspace({ canAdjust, canManage, canReconcile,
  filters, hasRecentAal2, loadError, page, snapshot }: {
  canAdjust: boolean; canManage: boolean; canReconcile: boolean;
  filters: BillingManagementSnapshot["filters"]; hasRecentAal2: boolean;
  loadError: boolean; page: PageCatalogEntry; snapshot: BillingManagementSnapshot | null;
}) {
  const basePath = "/app/staff/operations/billing";
  if (loadError || !snapshot) return <section className="empty-card"
    aria-labelledby="billing-management-load-error"><span className="empty-card__icon empty-card__icon--warning">
      <AlertTriangle aria-hidden="true" /></span><p className="eyebrow">載入失敗、無權限或篩選無效</p>
    <h1 id="billing-management-load-error">無法取得一致帳務快照</h1>
    <p>系統不會顯示未通過機構、分支、近期同工作階段 AAL2 與 billing.read 驗證的局部財務資料。</p>
    <div><Link className="button button--primary" href="/mfa?audience=staff">重新完成雙重驗證</Link>{" "}
      <Link className="button button--secondary" href={basePath}>重新載入</Link></div></section>;

  return <div className={styles.workspace}>
    <header className={styles.hero}><div><p className="eyebrow">第 {page.number} 頁 · 機構營運管理</p>
      <h1>{page.title}</h1><p>用核准生效費目建立內部帳單，逐筆登記離線付款、退款、調整與欠款，並以同一快照每日核對明細及不可變流水。</p>
    </div><div className={styles.snapshotMeta}><span>帳務期間 {filters.periodStart} ～ {filters.periodEnd}</span>
      <time dateTime={snapshot.generatedAt}>更新 {taipei(snapshot.generatedAt)}</time>
      <span>分支流水版本 {snapshot.branchLedgerVersion}</span><span>快照 60 秒後視為過期</span></div></header>

    {snapshot.demo ? <div className={styles.notice} role="status">展示模式：個案、費目、帳單、付款與收據皆為合成資料，只能檢視。</div> : null}
    <div className={styles.boundary} role="note"><strong>第一版線上付款停用。</strong>
      <span>本頁不收卡號、不串接金流、不自動扣款；付款只記錄已在系統外完成的現金、轉帳或其他離線事實。</span></div>
    <div className={styles.warning} role="note"><strong>法定文件與稅務計算不臆測。</strong>
      <span>帳單與收據僅為內部非稅務參考；官方編號、發票、法定收據與匯出規則均為 not_configured。單價及稅務狀態只沿用核准費目快照。</span></div>
    {snapshot.feeConfigurationStatus === "not_configured" ? <div className={styles.warning} role="alert">
      <strong>核准費目 not_configured。</strong><span>沒有期間唯一的已核准費目版本，建立帳單 fail closed；既有帳務仍可在權限範圍內核對。</span>
    </div> : null}

    <section className={styles.metrics} aria-label="帳務快照統計">
      <article><CircleDollarSign aria-hidden="true" /><span>應收</span><strong>{money(snapshot.metrics.receivableTotal)}</strong></article>
      <article><Banknote aria-hidden="true" /><span>已收淨額</span><strong>{money(snapshot.metrics.collectedTotal)}</strong></article>
      <article><ReceiptText aria-hidden="true" /><span>欠款</span><strong>{money(snapshot.metrics.outstandingTotal)}</strong></article>
      <article><RotateCcw aria-hidden="true" /><span>退款</span><strong>{money(snapshot.metrics.refundTotal)}</strong></article>
      <article className={snapshot.latestReconciliationStatus === "mismatch" ? styles.metricDanger : undefined}>
        <BookOpenCheck aria-hidden="true" /><span>最近對帳差異</span><strong>{snapshot.latestReconciliationDifference === null ? "尚未執行" : money(snapshot.latestReconciliationDifference)}</strong>
        <small>{snapshot.latestReconciliationStatus === "matched" ? "完全一致" : snapshot.latestReconciliationStatus === "mismatch" ? "需人工查明" : "not_run"}</small></article>
    </section>

    {!snapshot.demo ? <section className={styles.actions} aria-label="受治理帳務操作">
      <BillingInvoiceForm canManage={canManage} hasRecentAal2={hasRecentAal2} snapshot={snapshot} />
      <BillingEntryForm canAdjust={canAdjust} canManage={canManage} hasRecentAal2={hasRecentAal2} snapshot={snapshot} />
      <BillingReceiptForm canManage={canManage} hasRecentAal2={hasRecentAal2} snapshot={snapshot} />
      <BillingReconciliationForm canReconcile={canReconcile} hasRecentAal2={hasRecentAal2} snapshot={snapshot} />
    </section> : null}

    <form className={styles.filters} method="get" aria-label="篩選帳務資料">
      <label><span>帳務起日</span><input name="from" type="date" defaultValue={filters.periodStart} required /></label>
      <label><span>帳務迄日（最多 367 日）</span><input name="to" type="date" defaultValue={filters.periodEnd} required /></label>
      <label><span>個案</span><select name="client" defaultValue={filters.clientId ?? "all"}><option value="all">全部個案</option>
        {snapshot.clients.map((client) => <option key={client.clientId} value={client.clientId}>{client.displayName} · {client.clientCode}</option>)}</select></label>
      <label><span>付款狀態</span><select name="status" defaultValue={filters.paymentStatus}><option value="all">全部</option>
        <option value="unpaid">未付款</option><option value="partial">部分付款</option><option value="paid">已結清</option></select></label>
      <button className="button button--secondary" type="submit">套用篩選</button>
      <Link className="button button--ghost" href={basePath}>清除</Link>
    </form>

    <section className={styles.panel} aria-labelledby="billing-fee-heading"><div className={styles.sectionHeading}><div>
      <p className="eyebrow">核准與生效版本</p><h2 id="billing-fee-heading">可用費目</h2></div><p>{snapshot.feeItems.length} / {snapshot.feeItemTotal} 個版本</p></div>
      {snapshot.feeItems.length ? <div className={styles.feeGrid}>{snapshot.feeItems.map((fee) => <article key={fee.feeItemVersionId}>
        <div><strong>{fee.feeCode} · {fee.feeName}</strong><span>v{fee.version}</span></div>
        <p>{money(fee.unitPrice)}／{fee.unitLabel}</p><small>{TAX[fee.taxHandling]}<br />生效 {fee.effectiveFrom} ～ {fee.effectiveTo ?? "持續有效"}<br />核准 {taipei(fee.approvedAt)}</small>
      </article>)}</div> : <div className="empty-card"><h3>沒有可用核准費目</h3><p>正式規則尚未發布時維持 not_configured，不會建立零元或猜測費率帳單。</p></div>}
    </section>

    <section className={styles.panel} aria-labelledby="billing-invoices-heading"><div className={styles.sectionHeading}><div>
      <p className="eyebrow">同一不可變快照</p><h2 id="billing-invoices-heading">帳單、付款、退款、調整與收據</h2></div>
      <p>{snapshot.invoices.length} / {snapshot.matchingInvoiceTotal} 筆帳單</p></div>
      {snapshot.invoicesTruncated ? <p role="status">帳單上限 200 筆，請縮小期間、個案或付款狀態。</p> : null}
      {snapshot.invoices.length === 0 ? <div className="empty-card"><h3>沒有符合條件的帳單</h3><p>可清除篩選，或由具權限人員使用核准費目建立帳單。</p></div> : <>
        <div className={styles.tableWrap} role="region" tabIndex={0} aria-label="可水平捲動的帳務明細表"><table className={styles.table}>
          <thead><tr><th>個案／帳單</th><th>期間／到期</th><th>應收</th><th>已收淨額</th><th>退款／調整</th><th>餘額／狀態</th><th>完整明細</th></tr></thead>
          <tbody>{snapshot.invoices.map((invoice) => <tr key={invoice.invoiceId}><td><strong>{invoice.clientDisplayName}</strong><br /><small>{invoice.clientCode}<br />{invoice.invoiceNumber}</small></td>
            <td>{invoice.periodStart} ～ {invoice.periodEnd}<br /><small>到期 {invoice.dueOn}</small></td><td>{money(invoice.invoiceTotal)}</td>
            <td>{money(invoice.netCollected)}</td><td>退款 {money(invoice.refundTotal)}<br /><small>加 {money(invoice.adjustmentDebitTotal)}／減 {money(invoice.adjustmentCreditTotal)}</small></td>
            <td><strong>{money(invoice.balance)}</strong><br /><span className={`${styles.pill} ${styles[`pill_${invoice.paymentStatus}`]}`}>{STATUS[invoice.paymentStatus]}</span></td>
            <td><details className={styles.inlineDetails}><summary>展開逐筆證據</summary><InvoiceDetails invoice={invoice} /></details></td></tr>)}</tbody>
        </table></div>
        <div className={styles.mobileCards}>{snapshot.invoices.map((invoice) => <article key={invoice.invoiceId}><div className={styles.cardHeading}><div><h3>{invoice.clientDisplayName}</h3><small>{invoice.invoiceNumber}</small></div><span className={`${styles.pill} ${styles[`pill_${invoice.paymentStatus}`]}`}>{STATUS[invoice.paymentStatus]}</span></div>
          <dl className={styles.mobileTotals}><div><dt>應收</dt><dd>{money(invoice.invoiceTotal)}</dd></div><div><dt>已收淨額</dt><dd>{money(invoice.netCollected)}</dd></div><div><dt>餘額</dt><dd>{money(invoice.balance)}</dd></div></dl>
          <p>{invoice.periodStart} ～ {invoice.periodEnd} · 到期 {invoice.dueOn}</p><details className={styles.inlineDetails}><summary>展開逐筆證據</summary><InvoiceDetails invoice={invoice} /></details>
        </article>)}</div></>}
    </section>

    <section className={styles.panel} aria-labelledby="billing-reconciliation-heading"><div className={styles.sectionHeading}><div>
      <p className="eyebrow">每日與明細完全一致</p><h2 id="billing-reconciliation-heading">對帳快照</h2></div><p>{snapshot.reconciliations.length} / {snapshot.matchingReconciliationTotal} 筆</p></div>
      {snapshot.reconciliations.length ? <ol className={styles.reconciliations}>{snapshot.reconciliations.map((item) => <li key={item.reconciliationId}>
        <div><strong>{item.reconciliationDate} · {item.reconciliationStatus === "matched" ? "完全一致" : "有差異"}</strong><span>分支版本 {item.expectedBranchLedgerVersion}</span></div>
        <dl><div><dt>帳單明細餘額</dt><dd>{money(item.detailBalance)}</dd></div><div><dt>流水餘額</dt><dd>{money(item.ledgerBalance)}</dd></div><div><dt>差異</dt><dd>{money(item.difference)}</dd></div><div><dt>來源流水</dt><dd>{item.sourceEntryCount} 筆</dd></div></dl>
        <small>來源雜湊 {item.sourceHash.slice(0, 16)}… · {taipei(item.reconciledAt)}</small>
      </li>)}</ol> : <p>尚未執行每日對帳；不會以假定的零差異取代正式核對。</p>}
    </section>
  </div>;
}
