import {
  AlertTriangle, BusFront, CheckCircle2, ChevronRight, CircleAlert,
  Clock3, Link2, Route, UsersRound,
} from "lucide-react";
import Link from "next/link";

import type { PageCatalogEntry } from "@/lib/catalog";
import type {
  TransportExecutionFilters,
  TransportExecutionSnapshot,
  TransportExecutionTrip,
} from "@/lib/transport-execution/types";

import { TransportExecutionActions } from "./transport-execution-actions";
import styles from "./transport-execution.module.css";

const STATUS = { not_started: "待執行", in_progress: "進行中", completed: "已完成" };
const DIRECTION = { pickup: "到中心接入", dropoff: "由中心送回" };
const PAIRING = { pending: "尚未配對", onboard: "已上車／待下車",
  paired: "上下車已配對", resolved_exception: "例外已人工處置" };
const EVENT = { trip_started: "開始趟次", passenger_boarded: "個案上車",
  passenger_alighted: "個案下車", exception_recorded: "登記例外",
  trip_completed: "完成趟次" };

function taipei(value: string) {
  return new Intl.DateTimeFormat("zh-TW", { timeZone: "Asia/Taipei",
    year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit",
    minute: "2-digit", hourCycle: "h23" }).format(new Date(value));
}

function TripDetails({ trip }: { trip: TransportExecutionTrip }) {
  return <div className={styles.detailsBody}><dl>
    <div><dt>原計畫版本</dt><dd>v{trip.planVersion}・{trip.planDecision}・
      {trip.planContentHash.slice(0, 10)}…</dd></div>
    <div><dt>路線</dt><dd>{trip.pickupLabel} → {trip.dropoffLabel}</dd></div>
    <div><dt>實際開始</dt><dd>{trip.actualStartedAt ? taipei(trip.actualStartedAt) : "尚未開始"}</dd></div>
    <div><dt>實際完成</dt><dd>{trip.actualCompletedAt ? taipei(trip.actualCompletedAt) : "尚未完成"}</dd></div>
    <div><dt>例外</dt><dd>{trip.exceptionCount} 項</dd></div>
    <div><dt>未配對</dt><dd>{trip.unmatchedPassengerCount} 人</dd></div>
  </dl><section aria-label="逐人上下車配對" className={styles.passengers}>
    {trip.passengers.map((item) => <article key={item.clientId}>
      <strong>{item.displayName}</strong><small>{item.clientCode}</small>
      <span className={styles[`state_${item.pairingStatus}`]}>{PAIRING[item.pairingStatus]}</span>
      <span>預計上車點：{item.pickupLabel}</span><span>預計下車點：{item.dropoffLabel}</span>
      <span>實際上車：{item.boardedAt ? taipei(item.boardedAt) : "—"}</span>
      <span>實際下車：{item.alightedAt ? taipei(item.alightedAt) : "—"}</span>
      {item.resolutionNote ? <span>人工處置：{item.resolutionNote}</span> : null}
    </article>)}
  </section>{trip.events.length ? <ol aria-label="不可變接送事件時間軸"
    className={styles.timeline}>{trip.events.map((item) => <li key={item.eventId}>
      <strong>#{item.sequence} {EVENT[item.eventType]}</strong>・{taipei(item.occurredAt)}
      <small>{item.actorDisplayName}{item.note ? `・${item.note}` : ""}</small>
    </li>)}</ol> : <p>尚無實際執行事件。</p>}
    {trip.eventsTruncated ? <p role="status">只顯示最近 300 個事件；完整稽核仍保留。</p> : null}
  </div>;
}

export function TransportExecutionWorkspace({ canComplete, canManageAny, canRecord,
  canRecordException, currentUserId, filters, hasRecentAal2, loadError = false,
  page, snapshot }: {
  canComplete: boolean; canManageAny: boolean; canRecord: boolean;
  canRecordException: boolean; currentUserId: string; filters: TransportExecutionFilters;
  hasRecentAal2: boolean; loadError?: boolean; page: PageCatalogEntry;
  snapshot: TransportExecutionSnapshot | null;
}) {
  const basePath = "/app/staff/service-management/transport-execution";
  if (loadError || !snapshot) return <section className="empty-card core-care-state"
    role="alert"><span className="empty-card__icon empty-card__icon--warning">
      <CircleAlert aria-hidden="true" /></span><h1>接送執行紀錄暫時無法載入</h1>
    <p>正式快照採失敗即關閉；沒有擴大分支、駕駛或個案範圍，也沒有改用展示資料。</p>
    <Link className="button button--secondary" href={basePath}>重新載入</Link></section>;

  return <div className={styles.workspace}><nav aria-label="所在位置" className="context-bar">
    <span>工作台</span><ChevronRight aria-hidden="true" /><span>服務管理</span>
    <ChevronRight aria-hidden="true" /><span aria-current="page"
      className="context-bar__crumb">{page.title}</span></nav>
    <header className={styles.hero}><div><p className="eyebrow">頁面 {page.number}・原計畫連結與不可變事件</p>
      <h1>{page.title}</h1><p>實際開始、逐人上下車、例外與完成都連到精確已發布計畫版本；
        未完成、遲到與未配對由同一事件快照計算。</p></div>
      <div className={styles.snapshotMeta}><span>服務日 {filters.serviceDate}</span>
        <time dateTime={snapshot.generatedAt}>更新 {taipei(snapshot.generatedAt)}</time>
        <span>60 秒後視為過期</span></div></header>
    {snapshot.demo ? <div className={styles.notice} role="status">
      展示模式：計畫、車輛、駕駛、個案與實際事件均為合成資料，只能檢視。
    </div> : null}
    <div className={styles.notice} role="note">「遲到」採可重現定義：實際開始晚於原計畫開始即計入，
      不套用尚未發布的寬限分鐘數。</div>
    <div className={styles.warning} role="note">24 小時離線草稿同步、外部通知與匯出尚未配置；
      `not_configured` 不會冒充已同步、已送達或可下載。</div>

    <section aria-label="接送執行摘要" className={styles.metrics}>
      <article><Clock3 aria-hidden="true" /><span>待執行</span><strong>{snapshot.pendingTotal}</strong></article>
      <article><BusFront aria-hidden="true" /><span>進行中</span><strong>{snapshot.inProgressTotal}</strong></article>
      <article><CheckCircle2 aria-hidden="true" /><span>已完成</span><strong>{snapshot.completedTotal}</strong></article>
      <article><AlertTriangle aria-hidden="true" /><span>遲到</span><strong>{snapshot.lateTotal}</strong></article>
      <article><Link2 aria-hidden="true" /><span>未配對</span><strong>{snapshot.unmatchedTripTotal}</strong></article>
    </section>

    {!snapshot.demo ? <TransportExecutionActions canComplete={canComplete}
      canManageAny={canManageAny} canRecord={canRecord}
      canRecordException={canRecordException} currentUserId={currentUserId}
      hasRecentAal2={hasRecentAal2} snapshot={snapshot} /> : null}

    <form aria-label="篩選接送執行紀錄" className={styles.filters} method="get">
      <label><span>日期</span><input defaultValue={filters.serviceDate} name="date" required type="date" /></label>
      <label><span>車輛</span><input defaultValue={filters.vehicleQuery} maxLength={80} name="vehicle" placeholder="代碼或名稱" /></label>
      <label><span>駕駛</span><input defaultValue={filters.driverQuery} maxLength={80} name="driver" placeholder="駕駛姓名" /></label>
      <label><span>完成狀態</span><select defaultValue={filters.completionStatus} name="status">
        <option value="all">全部</option><option value="not_started">待執行</option>
        <option value="in_progress">進行中</option><option value="completed">已完成</option>
      </select></label><label><span>例外／配對</span><select defaultValue={filters.exceptionStatus} name="exception">
        <option value="all">全部</option><option value="with_exception">有例外</option>
        <option value="without_exception">無例外</option><option value="late">遲到</option>
        <option value="unmatched">未配對</option></select></label>
      <button className="button button--secondary" type="submit">套用篩選</button>
      <Link className="button button--quiet" href={`${basePath}?date=${filters.serviceDate}`}>清除</Link>
    </form>

    <section aria-labelledby="transport-execution-list-heading" className={styles.records}>
      <div className={styles.sectionHeading}><div><p className="eyebrow">同一快照</p>
        <h2 id="transport-execution-list-heading">原計畫、實際時間與逐人配對</h2></div>
        <p>{snapshot.trips.length} / {snapshot.matchingTripTotal} 筆</p></div>
      {snapshot.tripsTruncated ? <p role="status">清單上限 100 筆，請縮小篩選。</p> : null}
      {!snapshot.trips.length ? <section className="empty-card"><Route aria-hidden="true" />
        <h3>沒有符合條件的已發布趟次</h3><p>請調整日期、車輛、駕駛、完成或例外條件。</p></section> : <>
        <div aria-label="可水平捲動的接送執行表格" className={styles.tableWrap} role="region" tabIndex={0}>
          <table className={styles.table}><thead><tr><th>原計畫</th><th>車輛／駕駛</th>
            <th>預計時間</th><th>實際時間</th><th>個案配對</th><th>例外／遲到</th><th>完整依據</th>
          </tr></thead><tbody>{snapshot.trips.map((trip) => <tr key={trip.planVersionId}>
            <td><strong>{DIRECTION[trip.direction]}・v{trip.planVersion}</strong>
              <small>{trip.planDecision}・{trip.planContentHash.slice(0, 8)}…</small></td>
            <td>{trip.vehicleName}<small>{trip.vehicleCode}・{trip.driverDisplayName}</small></td>
            <td>{taipei(trip.plannedStartsAt)}<small>至 {taipei(trip.plannedEndsAt)}</small></td>
            <td><span className={`${styles.pill} ${styles[`pill_${trip.status}`]}`}>{STATUS[trip.status]}</span>
              <small>{trip.actualStartedAt ? taipei(trip.actualStartedAt) : "尚未開始"}</small></td>
            <td>{trip.passengers.length - trip.unmatchedPassengerCount} / {trip.passengers.length}
              <small>{trip.unmatchedPassengerCount} 人未配對</small></td>
            <td>{trip.exceptionCount} 項{(trip.lateSeconds ?? 0) > 0 ? <small className={styles.late}>
              晚 {Math.ceil((trip.lateSeconds ?? 0) / 60)} 分鐘開始</small> : <small>未晚於原計畫開始</small>}</td>
            <td><details className={styles.details}><summary>展開完整依據</summary><TripDetails trip={trip} /></details></td>
          </tr>)}</tbody></table></div>
        <div className={styles.mobileCards}>{snapshot.trips.map((trip) => <article key={trip.planVersionId}>
          <div className={styles.cardHeading}><div><h3>{DIRECTION[trip.direction]}・v{trip.planVersion}</h3>
            <small>{trip.vehicleName}・{trip.driverDisplayName}</small></div>
            <span className={`${styles.pill} ${styles[`pill_${trip.status}`]}`}>{STATUS[trip.status]}</span></div>
          <p><strong>預計：</strong>{taipei(trip.plannedStartsAt)} ～ {taipei(trip.plannedEndsAt)}</p>
          <p><strong>實際：</strong>{trip.actualStartedAt ? taipei(trip.actualStartedAt) : "尚未開始"}</p>
          <p><UsersRound aria-hidden="true" /> {trip.passengers.length} 人・
            {trip.unmatchedPassengerCount} 人未配對・{trip.exceptionCount} 項例外</p>
          <details className={styles.details}><summary>展開完整依據</summary><TripDetails trip={trip} /></details>
        </article>)}</div></>}
    </section>
  </div>;
}
