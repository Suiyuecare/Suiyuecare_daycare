import {
  CalendarDays,
  CheckCircle2,
  ChevronRight,
  CircleAlert,
  Clock3,
  Pill,
  ShieldAlert,
  TriangleAlert,
} from "lucide-react";
import Link from "next/link";

import { MedicationAction } from "@/components/medications/medication-action";
import { StatusPill } from "@/components/ui/status-pill";
import type { PageCatalogEntry } from "@/lib/catalog";
import type {
  MedicationAdministrationRecord,
  MedicationAdministrationSnapshot,
  MedicationClientOption,
  MedicationStatusFilter,
} from "@/lib/medications/types";

const statusLabels: Record<MedicationAdministrationRecord["status"], string> = {
  scheduled: "待執行",
  administered: "已服用",
  refused: "拒絕服用",
  held: "暫停服用",
  missed: "漏服",
};

const filterLabels: Record<MedicationStatusFilter, string> = {
  all: "全部狀態",
  scheduled: "待執行",
  pending_verification: "待第二人覆核",
  administered: "已服用",
  refused: "拒絕服用",
  held: "暫停服用",
  missed: "漏服",
};

function formatDateTime(value: string | null) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("zh-TW", {
    timeZone: "Asia/Taipei",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(new Date(value));
}

function formatTime(value: string | null) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("zh-TW", {
    timeZone: "Asia/Taipei",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(new Date(value));
}

function finalizationLabel(row: MedicationAdministrationRecord) {
  if (row.finalizationState === "signed") return "已完成簽署";
  if (row.finalizationState === "pending_verification") return "待第二人覆核";
  return "待處理";
}

function ExecutionSummary({ row }: { row: MedicationAdministrationRecord }) {
  if (!row.executor) return <>—</>;
  return (
    <span className="medication-person">
      <strong>{row.executor.displayName}</strong>
      <small>執行 {formatDateTime(row.occurredAt)}</small>
      <small>簽署 {formatDateTime(row.executionSignedAt)}</small>
      {row.lateEntry ? <small>逾時補登</small> : null}
    </span>
  );
}

function VerificationSummary({ row }: { row: MedicationAdministrationRecord }) {
  if (row.finalizationState === "pending_verification") {
    return <StatusPill status="待第二人覆核" />;
  }
  if (!row.verifier) return <span>不適用</span>;
  return (
    <span className="medication-person">
      <strong>{row.verifier.displayName}</strong>
      <small>{formatDateTime(row.secondVerifiedAt)}</small>
    </span>
  );
}

export function MedicationRecordsWorkspace({
  page,
  snapshot,
  allClients,
  serviceDate,
  selectedClientId,
  status,
  canRecord,
  canVerify,
  hasRecentAal2,
  currentUserId,
  loadError = false,
}: {
  page: PageCatalogEntry;
  snapshot: MedicationAdministrationSnapshot | null;
  allClients: readonly MedicationClientOption[];
  serviceDate: string;
  selectedClientId?: string;
  status: MedicationStatusFilter;
  canRecord: boolean;
  canVerify: boolean;
  hasRecentAal2: boolean;
  currentUserId: string;
  loadError?: boolean;
}) {
  if (loadError || !snapshot) {
    return (
      <section className="empty-card core-care-state" role="alert">
        <span className="empty-card__icon empty-card__icon--warning"><CircleAlert aria-hidden="true" /></span>
        <h1>用藥紀錄暫時無法載入</h1>
        <p>系統不會改查其他分支、使用過期快取或以展示資料補值。</p>
        <a className="button button--secondary" href={`?date=${serviceDate}`}>重新載入</a>
      </section>
    );
  }

  const hasFilters = Boolean(selectedClientId || status !== "all");
  const generatedAt = formatTime(snapshot.generatedAt);

  return (
    <>
      <nav aria-label="所在位置" className="context-bar">
        <span>工作台</span><ChevronRight aria-hidden="true" /><span>日常照顧</span>
        <ChevronRight aria-hidden="true" />
        <span aria-current="page" className="context-bar__crumb">{page.title}</span>
      </nav>
      <header className="page-heading core-care-heading">
        <div>
          <p className="eyebrow">專用用藥簽署流程・頁面 7</p>
          <h1>{page.title}</h1>
          <p className="page-heading__description">
            只對既有排程與當時唯一有效、已簽署的用藥計畫記錄結果；待第二人覆核不列為完成。
          </p>
        </div>
        <form className="core-date-filter" method="get">
          {selectedClientId ? <input name="client" type="hidden" value={selectedClientId} /> : null}
          <input name="status" type="hidden" value={status} />
          <label className="field"><span>服務日期</span><input defaultValue={serviceDate} name="date" type="date" /></label>
          <button className="button button--secondary" type="submit"><CalendarDays aria-hidden="true" />套用日期</button>
        </form>
      </header>

      <div className="callout core-care-callout medication-rule-callout">
        <ShieldAlert aria-hidden="true" />
        <span>
          第一版採保守技術規則：高風險藥、既有覆核標記，或排程／實際時間超過 60 分鐘的補登，一律要求第二位不同人員覆核；60 分鐘門檻尚未納入版本化治理，啟用正式機構前須由業務與法遵核准。劑量差異目前直接阻擋。本頁只做紀錄，不提供診斷。快照更新時間 {generatedAt}。
        </span>
      </div>

      {!snapshot.demo && (canRecord || canVerify) && !hasRecentAal2 ? (
        <div className="callout medication-reauth-callout" role="status">
          <ShieldAlert aria-hidden="true" />
          <span>簽署與獨立覆核須在最近 15 分鐘內完成雙因素重新驗證。</span>
          <Link className="button button--secondary" href="/mfa?audience=staff">立即重新驗證</Link>
        </div>
      ) : null}

      <section aria-label="用藥紀錄摘要" className="metric-grid core-care-metrics">
        {[
          { label: "應給藥", value: snapshot.counts.due, foot: "目前篩選內的既有排程", Icon: Pill },
          { label: "已完成", value: snapshot.counts.completed, foot: "僅計最終簽署", Icon: CheckCircle2 },
          { label: "待處理", value: snapshot.counts.pending, foot: "含待執行及待第二人覆核", Icon: Clock3 },
          { label: "例外", value: snapshot.counts.exceptions, foot: "拒絕、暫停或漏服", Icon: TriangleAlert },
        ].map(({ label, value, foot, Icon }) => (
          <article className="metric-card" key={label}>
            <div className="metric-card__top"><span>{label}</span><span className="metric-card__icon"><Icon aria-hidden="true" /></span></div>
            <div className="metric-card__value"><strong>{value}</strong><span>筆</span></div>
            <p className="metric-card__foot">{foot}</p>
          </article>
        ))}
      </section>

      <section className="panel">
        <div className="panel__header">
          <div className="panel__title">
            <h2>{serviceDate} 用藥排程</h2>
            <p>{snapshot.rows.length} 筆符合目前篩選・所有時間均為 Asia/Taipei</p>
          </div>
        </div>
        <form className="filter-bar" method="get">
          <input name="date" type="hidden" value={serviceDate} />
          <label className="field field--compact">
            <span>個案</span>
            <select defaultValue={selectedClientId ?? "all"} name="client">
              <option value="all">全部個案</option>
              {allClients.map((client) => <option key={client.id} value={client.id}>{client.displayName}（{client.code}）</option>)}
            </select>
          </label>
          <label className="field field--compact">
            <span>狀態</span>
            <select defaultValue={status} name="status">
              {Object.entries(filterLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </label>
          <button className="button button--secondary" type="submit">套用篩選</button>
          {hasFilters ? <a className="button button--ghost" href={`/app/staff/daily-care/medication-records?date=${serviceDate}`}>清除篩選</a> : null}
        </form>

        {snapshot.rows.length ? (
          <>
            <div
              aria-label={`${serviceDate} 用藥排程表，可左右捲動`}
              className="table-wrap core-care-table medication-table"
              role="region"
              tabIndex={0}
            >
              <table className="data-table">
                <thead><tr><th scope="col">個案</th><th scope="col">時間</th><th scope="col">藥物／計畫劑量</th><th scope="col">執行狀態</th><th scope="col">原因</th><th scope="col">執行簽署</th><th scope="col">第二人覆核</th><th scope="col">操作</th></tr></thead>
                <tbody>
                  {snapshot.rows.map((row) => (
                    <tr key={row.id}>
                      <td><span className="data-table__primary"><span className="avatar" aria-hidden="true">{row.clientDisplayName.slice(0, 1)}</span><span>{row.clientDisplayName}<small className="data-table__secondary">{row.clientCode}</small></span></span></td>
                      <td><strong>{formatTime(row.scheduledFor)}</strong><small className="data-table__secondary">實際 {formatTime(row.occurredAt)}</small></td>
                      <td className="medication-copy"><strong>{row.medicationName}</strong><small className="data-table__secondary">{row.plannedDose} {row.doseUnit}・{row.route}{row.highRisk ? "・高風險" : ""}</small></td>
                      <td><strong>{statusLabels[row.status]}</strong><small className="data-table__secondary"><StatusPill status={finalizationLabel(row)} /></small></td>
                      <td className="medication-copy">{row.reason ?? "—"}</td>
                      <td><ExecutionSummary row={row} /></td>
                      <td><VerificationSummary row={row} /></td>
                      <td><MedicationAction canRecord={canRecord} canVerify={canVerify} currentUserId={currentUserId} demo={snapshot.demo} hasRecentAal2={hasRecentAal2} instance="desktop" row={row} serviceDate={serviceDate} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="mobile-records core-care-mobile">
              {snapshot.rows.map((row) => (
                <article className="record-card medication-card" key={`${row.id}-mobile`}>
                  <div className="record-card__top"><div><h3>{row.clientDisplayName}</h3><span className="data-table__secondary">{row.clientCode}・排程 {formatTime(row.scheduledFor)}</span></div><StatusPill status={finalizationLabel(row)} /></div>
                  <div className="medication-card__medicine"><strong>{row.medicationName}</strong><span>{row.plannedDose} {row.doseUnit}・{row.route}{row.highRisk ? "・高風險" : ""}</span></div>
                  <dl className="core-care-card-grid">
                    <div><dt>執行狀態</dt><dd>{statusLabels[row.status]}</dd></div>
                    <div><dt>實際時間</dt><dd>{formatTime(row.occurredAt)}</dd></div>
                    <div className="medication-card-wide"><dt>原因</dt><dd>{row.reason ?? "—"}</dd></div>
                    <div><dt>執行人</dt><dd>{row.executor?.displayName ?? "—"}<small className="data-table__secondary">簽署 {formatDateTime(row.executionSignedAt)}</small></dd></div>
                    <div><dt>覆核人</dt><dd>{row.finalizationState === "pending_verification" ? "待第二人" : row.verifier?.displayName ?? "不適用"}</dd></div>
                    <div className="medication-card-wide"><dt>最終簽署時間</dt><dd>{formatDateTime(row.signedAt)}</dd></div>
                  </dl>
                  <MedicationAction canRecord={canRecord} canVerify={canVerify} currentUserId={currentUserId} demo={snapshot.demo} hasRecentAal2={hasRecentAal2} instance="mobile" row={row} serviceDate={serviceDate} />
                </article>
              ))}
            </div>
          </>
        ) : (
          <div className="empty-card core-care-state">
            <span className="empty-card__icon"><Pill aria-hidden="true" /></span>
            <h2>沒有符合條件的用藥排程</h2>
            <p>{hasFilters ? "可清除篩選查看本服務日其他紀錄。" : "本服務日沒有已建立的用藥時點；系統不會自行產生或猜測排程。"}</p>
            {hasFilters ? <a className="button button--secondary" href={`/app/staff/daily-care/medication-records?date=${serviceDate}`}>清除篩選</a> : null}
          </div>
        )}
      </section>
    </>
  );
}
