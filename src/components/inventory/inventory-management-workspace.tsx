import {
  AlertTriangle, Boxes, CalendarClock, History, PackageOpen,
} from "lucide-react";
import Link from "next/link";

import type { PageCatalogEntry } from "@/lib/catalog";
import type {
  InventoryFilters,
  InventoryManagementSnapshot,
  InventoryMovementType,
} from "@/lib/inventory/types";

import {
  InventoryItemCreateForm,
  InventoryItemStatusForm,
  InventoryMovementForm,
} from "./inventory-actions";
import styles from "./inventory.module.css";

const movementLabels: Record<InventoryMovementType, string> = {
  receipt: "入庫", issue: "一般出庫", return: "退回", adjustment: "庫存調整",
  client_issue: "個案領用", stocktake: "盤點",
};
const expiryLabels = { valid: "有效", near_expiry: "近效期", expired: "已過期" };

function formatTaipei(value: string) {
  return new Intl.DateTimeFormat("zh-TW", {
    timeZone: "Asia/Taipei", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).format(new Date(value));
}

export function InventoryManagementWorkspace({
  canAdjust, canManage, filters, hasRecentAal2, loadError, page, snapshot,
}: {
  canAdjust: boolean;
  canManage: boolean;
  filters: InventoryFilters;
  hasRecentAal2: boolean;
  loadError: boolean;
  page: PageCatalogEntry;
  snapshot: InventoryManagementSnapshot | null;
}) {
  if (loadError || !snapshot) return <section className="empty-card"
    aria-labelledby="inventory-load-error">
    <span className="empty-card__icon empty-card__icon--warning"><AlertTriangle aria-hidden="true" /></span>
    <p className="eyebrow">載入失敗</p><h1 id="inventory-load-error">無法取得庫存快照</h1>
    <p>系統沒有顯示未經驗證的局部庫存。請確認網路、分支與權限後重試。</p>
    <Link className="button button--secondary" href="/app/staff/operations/inventory">重新載入</Link>
  </section>;

  return <div className={styles.workspace}>
    <header className={styles.hero}><div>
      <p className="eyebrow">第 {page.number} 頁 · 機構營運管理</p>
      <h1>{page.title}</h1><p>{page.description} 每一筆已承諾資料都以不可變紀錄保存。</p>
    </div><div className={styles.snapshotMeta}>
      <span>台北快照日 {snapshot.snapshotDate}</span>
      <time dateTime={snapshot.generatedAt}>更新 {formatTaipei(snapshot.generatedAt)}</time>
      <span>資料超過 60 秒時請重新載入</span>
    </div></header>

    {snapshot.demo ? <div className={styles.notice} role="status">
      展示模式：以下為合成資料，只能檢視，不會建立品項、批次或異動。
    </div> : null}
    <div className={styles.notice} role="note">
      安全量、近效期天數與盤點週期尚未經機構雙人治理發布，因此顯示「未設定」，不會猜測門檻。
      供應商採購、藥品醫囑與財務自動化也尚未串接。
    </div>

    <section className={styles.metrics} aria-label="庫存統計">
      <article><Boxes aria-hidden="true" /><span>庫存品項</span><strong>{snapshot.itemTotal}</strong></article>
      <article><PackageOpen aria-hidden="true" /><span>符合批次</span><strong>{snapshot.matchingBatchTotal}</strong></article>
      <article><AlertTriangle aria-hidden="true" /><span>持有已過期</span><strong>{snapshot.expiredBatchTotal}</strong></article>
      <article><CalendarClock aria-hidden="true" /><span>低庫存／近效期／待盤點</span>
        <strong>{snapshot.policyStatus === "not_configured" ? "未設定" :
          `${snapshot.lowStockTotal}/${snapshot.nearExpiryTotal}/${snapshot.stocktakeDueTotal}`}</strong></article>
    </section>

    <InventoryItemCreateForm canManage={canManage && !snapshot.demo} snapshot={snapshot} />
    <InventoryMovementForm canAdjust={canAdjust && !snapshot.demo}
      canManage={canManage && !snapshot.demo} hasRecentAal2={hasRecentAal2}
      snapshot={snapshot} />

    <form className={styles.filters} method="get" aria-label="篩選庫存">
      <label><span>搜尋品項</span><input name="q" defaultValue={filters.query}
        maxLength={100} placeholder="代碼或名稱" /></label>
      <label><span>品項</span><select name="item" defaultValue={filters.itemId ?? "all"}>
        <option value="all">全部品項</option>{snapshot.itemOptions.map((item) =>
          <option key={item.itemId} value={item.itemId}>{item.itemCode} · {item.itemName}</option>)}</select></label>
      <label><span>批號</span><input name="batch" defaultValue={filters.batchQuery}
        maxLength={100} /></label>
      <label><span>效期狀態</span><select name="expiry" defaultValue={filters.expiryStatus}>
        <option value="all">全部</option><option value="valid">有效</option>
        {snapshot.policyStatus === "published" ? <option value="near_expiry">近效期</option> : null}
        <option value="expired">已過期</option></select></label>
      <label><span>異動類型</span><select name="movement" defaultValue={filters.movementType}>
        <option value="all">全部</option>{Object.entries(movementLabels).map(([value, label]) =>
          <option key={value} value={value}>{label}</option>)}</select></label>
      <button className="button button--secondary" type="submit">套用篩選</button>
      <Link className="button button--ghost" href="/app/staff/operations/inventory">清除</Link>
    </form>

    <div className={styles.resultHeader}>
      <p>批次顯示 {snapshot.batches.length} / {snapshot.matchingBatchTotal}；全分支共 {snapshot.batchTotal}</p>
      {snapshot.batchesTruncated ? <p role="status">批次明細上限 200 筆；統計仍涵蓋全部符合資料。</p> : null}
      {snapshot.itemsTruncated ? <p role="status">品項選項顯示 {snapshot.itemOptions.length} / {snapshot.itemTotal}。</p> : null}
    </div>

    {snapshot.batches.length === 0 ? <section className="empty-card" aria-labelledby="inventory-empty">
      <span className="empty-card__icon"><Boxes aria-hidden="true" /></span>
      <h2 id="inventory-empty">沒有符合條件的批次</h2>
      <p>請調整品項、批號、效期或異動類型；具管理權限者也可建立品項並入庫新批次。</p>
    </section> : <section className={styles.cards} aria-label="庫存批次明細">
      {snapshot.batches.map((batch) => <article className={styles.card} key={batch.batchId}>
        <header><div><p className="eyebrow">{batch.itemCode}</p><h2>{batch.itemName}</h2>
          <p>批號 {batch.batchNumber} · 效期 {batch.expiryDate}</p></div>
          <div className={styles.badges}><span>{expiryLabels[batch.expiryStatus]}</span>
            <span>{batch.itemStatus === "active" ? "品項啟用" : "品項停用"}</span></div></header>
        <dl><div><dt>批次餘額</dt><dd>{batch.balance} {batch.unit}</dd></div>
          <div><dt>品項總量</dt><dd>{batch.itemTotalBalance} {batch.unit}</dd></div>
          <div><dt>流水版本</dt><dd>{batch.ledgerVersion}</dd></div>
          <div><dt>最近異動</dt><dd>{batch.latestMovementOccurredAt ?
            `${movementLabels[batch.latestMovementType!]} · ${formatTaipei(batch.latestMovementOccurredAt)}` : "尚無異動"}</dd></div></dl>
      </article>)}
    </section>}

    <section className={styles.itemSection} aria-labelledby="inventory-items-heading">
      <h2 id="inventory-items-heading">品項狀態</h2>
      <div className={styles.itemCards}>{snapshot.itemOptions.map((item) => <article key={item.itemId}>
        <header><strong>{item.itemCode} · {item.itemName}</strong><span>{item.status === "active" ? "啟用" : "停用"}</span></header>
        <p>總量 {item.totalBalance} {item.unit} · {item.batchCount} 批</p>
        <InventoryItemStatusForm canManage={canManage && !snapshot.demo} item={item} snapshot={snapshot} />
      </article>)}</div>
    </section>

    <section className={styles.ledger} aria-labelledby="inventory-ledger-heading">
      <header><div><p className="eyebrow">可稽核明細</p><h2 id="inventory-ledger-heading">庫存異動流水</h2></div>
        <History aria-hidden="true" /></header>
      <p>顯示 {snapshot.movements.length} / {snapshot.matchingMovementTotal} 筆。</p>
      {snapshot.movementsTruncated ? <p role="status">異動明細上限 200 筆；請使用伺服器篩選縮小範圍。</p> : null}
      {snapshot.movements.length === 0 ? <p>沒有符合條件的異動。</p> :
        <div className={styles.ledgerRows}>{snapshot.movements.map((movement) => <article key={movement.movementId}>
          <header><strong>{movementLabels[movement.movementType]} · {movement.itemName}</strong>
            <time dateTime={movement.occurredAt}>{formatTaipei(movement.occurredAt)}</time></header>
          <p>批號 {movement.batchNumber} · 數量 {movement.quantity} · 增減 {movement.quantityDelta} · 結餘 {movement.balanceAfter} {movement.unit}</p>
          {movement.movementType === "client_issue" ||
            (movement.movementType === "return" && movement.clientId !== null) ?
            movement.clientScopeVisible ? <p>個案 {movement.clientCode} · {movement.clientDisplayName}；指示／參照：{movement.instructionReference}</p>
              : <p className={styles.redacted}>個案追溯資料因目前資料範圍未授權而遮蔽。</p> : null}
          {movement.purpose ? <p>用途：{movement.purpose}；去向：{movement.destinationUnit}</p> : null}
          {movement.reason ? <p>理由：{movement.reason}</p> : null}
          <p>記錄人 {movement.recordedByDisplayName} · 流水版本 {movement.ledgerVersion}</p>
        </article>)}</div>}
    </section>
  </div>;
}
