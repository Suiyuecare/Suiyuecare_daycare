import { AlertTriangle, ChevronRight, Database, FileSearch, ShieldCheck } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";

import { SnapshotFreshness } from "@/components/ui/snapshot-freshness";
import type { PageCatalogEntry } from "@/lib/catalog";
import { INTEGRATIONS_AUDIT_SOURCE_PATHS } from "@/lib/integrations-audit/types";
import type { IntegrationsAuditFilters, IntegrationsAuditSnapshot } from "@/lib/integrations-audit/types";

import styles from "./integrations-audit.module.css";

const actions: Record<string, string> = {
  select: "查閱／搜尋", insert: "新增", update: "修改", delete: "刪除",
  export: "匯出", print: "列印", sign: "簽署", correct: "更正",
  permission_change: "權限變更", rule_change: "規則變更", integration: "整合事件",
};
const activities = { observed: "此期間有紀錄", attention: "此期間有待處理紀錄", no_activity: "此期間無紀錄" };
const integrationNames: Record<string, string> = {
  central_html_import: "中央 HTML 匯入", notification_delivery: "通知傳遞", pwa_sync: "離線同步",
  claims: "申報與對帳", consultation_notification_outbox: "跨專業照會通知", referral_notification_outbox: "轉介通知",
  family_communication_delivery: "照顧溝通傳遞",
};
const states = {
  completed: "來源流程已處理", pending: "待處理", failed: "失敗", conflict: "版本衝突",
  rejected: "已拒絕", suppressed: "已抑制", queued_unconfigured: "佇列中／外部傳送未配置",
};
const resources: Record<string, string> = {
  governance: "系統治理", import: "中央匯入", notification: "通知", sync: "離線同步",
  claim: "申報", communication: "溝通", professional_service: "專業服務", client: "個案主檔",
  staff: "員工", care: "照顧紀錄", billing: "帳務", operations: "機構營運", other: "其他已遮罩資源",
};
const errors = {
  import_mapping_required: "匯入欄位待映射", import_validation_failed: "匯入驗證未通過",
  notification_delivery_failed: "通知傳遞失敗", sync_conflict: "同步版本衝突", sync_rejected: "同步已拒絕",
  claim_rejected: "申報已拒絕", external_delivery_not_configured: "外部傳送尚未配置",
};

function formatTimestamp(value: string | null) {
  if (!value) return "此期間無紀錄";
  return new Intl.DateTimeFormat("zh-TW", {
    timeZone: "Asia/Taipei", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
  }).format(new Date(value));
}

function FilterForm({ filters, snapshot }: { filters: IntegrationsAuditFilters; snapshot: IntegrationsAuditSnapshot }) {
  return <form method="get" aria-label="整合與稽核篩選">
    <div className={styles.filters}>
      <label>起日（含當日）<input name="from" type="date" defaultValue={filters.startDate} required /></label>
      <label>迄日（含當日）<input name="to" type="date" defaultValue={filters.endDate} required /></label>
      <label>整合來源<select name="integration" defaultValue={filters.integrationKey}>
        <option value="all">全部可見來源</option>
        {snapshot.options.integrationKeys.filter((key) => key !== "all").map((key) => <option key={key} value={key}>{integrationNames[key] ?? key}</option>)}
      </select></label>
      <label>來源活動<select name="state" defaultValue={filters.activityState}>
        <option value="all">全部活動狀態</option>
        {snapshot.options.activityStates.filter((key) => key !== "all").map((key) => <option key={key} value={key}>{activities[key]}</option>)}
      </select></label>
      <label>稽核動作<select name="action" defaultValue={filters.auditAction}>
        <option value="all">全部稽核動作</option>
        {snapshot.options.auditActions.filter((key) => key !== "all").map((key) => <option key={key} value={key}>{actions[key] ?? key}</option>)}
      </select></label>
      <label>稽核資源<select name="resource" defaultValue={filters.resourceCategory}>
        <option value="all">全部可見資源</option>
        {snapshot.options.resourceCategories.filter((key) => key !== "all").map((key) => <option key={key} value={key}>{resources[key] ?? key}</option>)}
      </select></label>
    </div>
    <details className={styles.details} open={Boolean(filters.actorUserId || filters.correlationId)}>
      <summary>以人員或相關 ID 精確查詢</summary>
      <p className={styles.muted}>只接受系統 UUID；請勿輸入姓名、電話、身分證字號或通知內容。</p>
      <div className={styles.filters}>
        <label>操作者 UUID<input name="actor" autoComplete="off" maxLength={36} defaultValue={filters.actorUserId ?? ""} /></label>
        <label>相關 UUID<input name="correlation" autoComplete="off" maxLength={36} defaultValue={filters.correlationId ?? ""} /></label>
      </div>
    </details>
    <p className={styles.muted}>日期與相關 ID 同時套用到兩份清單；整合來源／來源活動只篩選整合事件，稽核動作／資源／操作者只篩選稽核紀錄。相關 ID 依來源的追蹤編號、稽核的請求或冪等 UUID 精確核對，不以個案或紀錄 ID 模糊查找。</p>
    <p className={styles.muted}>日期以台北時區計算，單次最多 90 日。來源活動與稽核動作分開顯示，不以「無紀錄」推定整合已停用或正常。</p>
    <div className={styles.filterActions}>
      <button type="submit" className="button button--primary">查詢紀錄</button>
      <a className="button button--secondary" href="?">清除篩選</a>
    </div>
  </form>;
}

function SourceLink({ path }: { path: string | null }) {
  const allowed = path !== null && Object.values(INTEGRATIONS_AUDIT_SOURCE_PATHS).some((value) => value === path);
  return allowed ? <Link href={path} prefetch={false} className="button button--secondary">開啟來源工作頁</Link> : <span className={styles.muted}>來源工作頁未配置</span>;
}

function Inventory({ snapshot }: { snapshot: IntegrationsAuditSnapshot }) {
  return <section className="panel" aria-labelledby="integration-inventory-heading">
    <div className="panel__header"><div className="panel__title"><h2 id="integration-inventory-heading">整合來源活動</h2>
      <p>來自既有業務資料，不是正式供應商清冊或連線健康檢查。</p></div></div>
    <div className="panel__body">
      {snapshot.inventory.length === 0 ? <div className="empty-card"><h3>沒有符合條件的來源</h3><p>請調整來源活動篩選；不代表正式整合全部停用。</p></div>
        : <ul className={styles.registry}>{snapshot.inventory.map((item) => <li className={styles.card} key={item.integrationKey}>
          <div className={styles.cardHeader}><h3>{integrationNames[item.integrationKey] ?? item.integrationKey}</h3>
            <span className="status-pill status-pill--warning">{activities[item.activityState]}</span></div>
          <dl className={styles.metadata}>
            <div><dt>期間紀錄</dt><dd>{item.recordTotal} 筆</dd></div>
            <div><dt>待處理紀錄</dt><dd>{item.attentionTotal} 筆</dd></div>
            <div><dt>尚待執行</dt><dd>{item.pendingTotal} 筆</dd></div>
            <div><dt>最近活動（台北）</dt><dd>{formatTimestamp(item.latestActivityAt)}</dd></div>
            <div><dt>正式治理清冊</dt><dd>尚未配置</dd></div>
            <div><dt>供應商／區域／負責人</dt><dd>尚待正式登錄與審查</dd></div>
          </dl>
          <p><SourceLink path={item.sourcePath} /></p>
          <p className={styles.muted}>來源頁需重新選擇日期與紀錄；本頁不提供跨系統重送。</p>
        </li>)}</ul>}
    </div>
  </section>;
}

function Signals({ snapshot }: { snapshot: IntegrationsAuditSnapshot }) {
  return <section className="panel" aria-labelledby="integration-events-heading">
    <div className="panel__header"><div className="panel__title"><h2 id="integration-events-heading">整合事件</h2>
      <p>符合 {snapshot.signalMatchingTotal} 筆，顯示 {snapshot.signals.length} 筆；流程分類不代表外部送達，詳細狀態請至來源頁核對。</p></div></div>
    <div className="panel__body">
      {snapshot.signalsTruncated ? <p role="status" className={styles.limitations}>清單已達筆數上限，未顯示全部結果。請縮小日期或來源範圍後繼續查詢。</p> : null}
      {snapshot.signals.length === 0 ? <div className="empty-card"><h3>此範圍沒有整合事件</h3><p>請核對日期與相關 ID；本頁不會將無資料解讀為送達成功。</p></div>
        : <ol className={styles.events}>{snapshot.signals.map((item) => <li className={styles.card} key={item.signalId}>
          <div className={styles.cardHeader}><h3>{integrationNames[item.integrationKey] ?? item.integrationKey}</h3>
            <time className={styles.eventTime} dateTime={item.occurredAt}>{formatTimestamp(item.occurredAt)}</time></div>
          <span className="status-pill status-pill--warning">{states[item.state] ?? item.state}</span>
          <dl className={styles.metadata}>
            <div><dt>相關 ID</dt><dd><code>{item.correlationId ?? "未提供或已遮罩"}</code></dd></div>
            <div><dt>安全錯誤分類</dt><dd>{item.errorCodeStatus === "available" && item.errorCategory ? errors[item.errorCategory]
              : item.errorCodeStatus === "redacted" ? "已遮罩；不顯示原始錯誤內容" : "不適用"}</dd></div>
          </dl>
        </li>)}</ol>}
    </div>
  </section>;
}

function AuditEvents({ snapshot }: { snapshot: IntegrationsAuditSnapshot }) {
  return <section className="panel" aria-labelledby="audit-events-heading">
    <div className="panel__header"><div className="panel__title"><h2 id="audit-events-heading">稽核紀錄</h2>
      <p>符合 {snapshot.auditMatchingTotal} 筆，顯示 {snapshot.auditEvents.length} 筆；不包含原始資料內容或變更前後值。</p></div></div>
    <div className="panel__body">
      {snapshot.auditEventsTruncated ? <p role="status" className={styles.limitations}>稽核清單已截斷。請縮小日期、動作或相關 ID 範圍；符合筆數不是已顯示筆數。</p> : null}
      {snapshot.auditEvents.length === 0 ? <div className="empty-card"><h3>此範圍沒有稽核紀錄</h3><p>可清除動作或資源篩選後再查詢，系統不擴大分支權限。</p></div>
        : <ol className={styles.events}>{snapshot.auditEvents.map((item) => <li className={styles.card} key={item.auditEventId}>
          <div className={styles.cardHeader}><h3>{actions[item.action] ?? item.action} · {resources[item.resourceCategory]}</h3>
            <time className={styles.eventTime} dateTime={item.occurredAt}>{formatTimestamp(item.occurredAt)}</time></div>
          <p>稽核編號 <code>{item.auditEventId}</code></p>
          <details className={styles.details}>
            <summary>查看去敏感識別資訊</summary>
            <dl className={styles.metadata}>
              <div><dt>操作者 UUID</dt><dd><code>{item.actorUserId ?? "未提供"}</code></dd></div>
              <div><dt>紀錄 ID</dt><dd><code>{item.recordId?.value ?? "未提供或已遮罩"}</code></dd></div>
              <div><dt>請求 UUID</dt><dd><code>{item.requestId ?? "未提供或已遮罩"}</code></dd></div>
              <div><dt>冪等 UUID</dt><dd><code>{item.idempotencyKey ?? "未提供"}</code></dd></div>
            </dl>
          </details>
        </li>)}</ol>}
    </div>
  </section>;
}

export function IntegrationsAuditWorkspace({ page, filters, snapshot, hasRecentAal2, loadError = false, dataInventory }: {
  page: PageCatalogEntry;
  filters: IntegrationsAuditFilters;
  snapshot: IntegrationsAuditSnapshot | null;
  hasRecentAal2: boolean;
  loadError?: boolean;
  dataInventory?: ReactNode;
}) {
  if (!hasRecentAal2) return <section className="empty-card core-care-state" role="alert">
    <ShieldCheck aria-hidden="true" /><h1>整合與稽核中心需要重新驗證</h1>
    <p>稽核查詢需要最近 15 分鐘、同一工作階段的雙因素驗證。驗證完成前不讀取或顯示稽核紀錄。</p>
    <Link className="button button--primary" href="/mfa?audience=staff&purpose=sensitive-action">立即重新驗證</Link>
  </section>;
  if (loadError || !snapshot) return <section className="empty-card core-care-state" role="alert">
    <AlertTriangle aria-hidden="true" /><h1>整合與稽核中心暫時無法載入</h1>
    <p>請確認查詢日期、UUID 與權限後重試；重複或不合法的篩選不會自動放寬，也不會改用展示資料。</p>
    <a className="button button--secondary" href="?">清除篩選並重新載入</a>
  </section>;
  return <>
    <nav aria-label="所在位置" className="context-bar"><span>工作台</span><ChevronRight aria-hidden="true" />
      <span>系統治理</span><ChevronRight aria-hidden="true" /><span aria-current="page" className="context-bar__crumb">{page.title}</span></nav>
    <header className="page-heading"><div><p className="eyebrow">有界唯讀查詢 · 頁面 {page.number}</p><h1>{page.title}</h1>
      <p className="page-heading__description">追蹤資料盤點與缺漏，核對來源活動及稽核識別資訊；不在清冊填寫個案內容或機密。</p>
      {dataInventory ? <a className="button button--secondary" href="#data-inventory">前往資料盤點與缺漏追蹤</a> : null}</div>
      <span className="status-pill status-pill--warning"><FileSearch aria-hidden="true" />唯讀查詢</span></header>
    {snapshot.demo ? <div className={`callout ${styles.notice}`} role="status"><Database aria-hidden="true" />
      <span>展示模式：以下全部是合成紀錄，不代表正式連線、送達或合規驗收。</span></div> : null}
    <SnapshotFreshness expiresAt={snapshot.staleAfter} demo={snapshot.demo} />
    {dataInventory}
    <div className="metric-grid">
      {[ ["符合條件的來源", snapshot.inventoryMatchingTotal], ["整合事件", snapshot.signalMatchingTotal], ["稽核紀錄", snapshot.auditMatchingTotal] ].map(([label, total]) =>
        <article className="metric-card" key={label}><div className="metric-card__top">{label}</div>
          <div className="metric-card__value"><strong>{total}</strong><span>筆</span></div>
          <div className="metric-card__foot">同一查詢快照，不含未授權分支</div></article>)}
    </div>
    <section className="panel"><div className="panel__header"><div className="panel__title"><h2>查詢條件</h2>
      <p>{snapshot.window.startDate} 至 {snapshot.window.endDate} · Asia/Taipei · 更新於 {formatTimestamp(snapshot.generatedAt)}</p></div></div>
      <div className="panel__body"><FilterForm filters={filters} snapshot={snapshot} />
        <details className={styles.details}><summary>查詢快照識別資訊</summary>
          <p className={styles.snapshotId}>快照 ID：<code>{snapshot.snapshotId}</code></p>
          <p className={styles.snapshotId}>內容雜湊：<code>{snapshot.snapshotHash}</code></p>
          <p className={styles.muted}>{snapshot.demo ? "合成展示快照；不代表正式資料庫紀錄。" : "本次資料來自同一資料庫查詢快照；不同時間重查會產生新快照。"}</p>
        </details>
      </div></section>
    <Inventory snapshot={snapshot} /><Signals snapshot={snapshot} /><AuditEvents snapshot={snapshot} />
    <section className={styles.limitations} aria-labelledby="integration-limits-heading">
      <h2 id="integration-limits-heading">尚未開放的正式操作</h2>
      <ul><li>正式整合清冊的目的、欄位、方向、頻率、供應商、區域、負責人與停用治理尚待配置。</li>
        <li>重試、停用及每日對帳命令尚未開放；有紀錄不代表已驗收，佇列中不代表已送達。</li>
        <li>不顯示原始 payload、metadata、Token、個案姓名或附件；尚無批次匯出與離線快取。</li></ul>
    </section>
  </>;
}
