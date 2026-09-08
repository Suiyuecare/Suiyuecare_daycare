import {
  AlertTriangle, BusFront, ChevronRight, CircleAlert, Clock3,
  ShieldCheck, UsersRound,
} from "lucide-react";
import Link from "next/link";

import type { PageCatalogEntry } from "@/lib/catalog";
import type {
  TransportPlanFilters,
  TransportPlanSnapshot,
  TransportTripPlan,
} from "@/lib/transport-plans/types";

import { TransportTripComposer, TransportTripDecision } from "./transport-plan-actions";
import styles from "./transport-plans.module.css";

const STATUS = {
  draft_ready: "待發布／無衝突", draft_conflicted: "待發布／有衝突",
  published: "已發布", rejected: "已駁回",
};
const DIRECTION = { pickup: "到中心接入", dropoff: "由中心送回" };

function taipei(value: string) {
  return new Intl.DateTimeFormat("zh-TW", { timeZone: "Asia/Taipei",
    year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit",
    minute: "2-digit", hourCycle: "h23" }).format(new Date(value));
}

function TripDetails({ trip }: { trip: TransportTripPlan }) {
  return <div className={styles.detailsBody}>
    <dl><div><dt>趟次起點</dt><dd>{trip.pickupLabel}</dd></div>
      <div><dt>趟次終點</dt><dd>{trip.dropoffLabel}</dd></div>
      <div><dt>駕駛授權證據</dt><dd>{trip.driver.authorizationLabel}</dd></div>
      <div><dt>機構規則</dt><dd>人工未標準化・{trip.ruleVersionId.slice(0, 8)}…</dd></div>
      <div><dt>建立／修訂理由</dt><dd>{trip.revisionReason}</dd></div>
      <div><dt>通知</dt><dd>尚未配置外部供應商</dd></div></dl>
    <section aria-label="逐人上下車點" className={styles.passengerCards}>
      {trip.passengers.map((item) => <article key={item.clientId}>
        <strong>{item.displayName}</strong><small>{item.clientCode}</small>
        <span>上車：{item.pickupLabel}</span><span>下車：{item.dropoffLabel}</span>
      </article>)}
    </section>
    {trip.conflicts.length ? <div className={styles.conflicts}><h4>可解釋衝突</h4>
      <ul>{trip.conflicts.map((item) => <li key={item.key}>
        <AlertTriangle aria-hidden="true" /><span><strong>{item.message}</strong>
          <small>{item.code}・{item.resourceType}:{item.resourceKey}</small></span>
      </li>)}</ul></div> : <p className={styles.clear}>
      <ShieldCheck aria-hidden="true" />此版本未偵測到結構化衝突；仍須獨立核准。
    </p>}
    {trip.reviewedAt ? <p className={styles.review}>審核：{trip.reviewerDisplayName}・
      {taipei(trip.reviewedAt)}・{trip.reviewReason}</p> : null}
  </div>;
}

export function TransportPlansWorkspace({ canApprove, canManage, canOverride,
  currentUserId, filters, hasRecentAal2, loadError = false, page, snapshot }: {
  canApprove: boolean; canManage: boolean; canOverride: boolean;
  currentUserId: string; filters: TransportPlanFilters; hasRecentAal2: boolean;
  loadError?: boolean; page: PageCatalogEntry; snapshot: TransportPlanSnapshot | null;
}) {
  const basePath = "/app/staff/service-management/transport-plans";
  if (loadError || !snapshot) return <section className="empty-card core-care-state"
    role="alert"><span className="empty-card__icon empty-card__icon--warning">
      <CircleAlert aria-hidden="true" /></span><h1>交通趟次計畫暫時無法載入</h1>
    <p>正式快照採失敗即關閉；沒有擴大機構、分支、駕駛或個案範圍，也沒有改用展示資料。</p>
    <Link className="button button--secondary" href={basePath}>重新載入</Link>
  </section>;

  return <div className={styles.workspace}>
    <nav aria-label="所在位置" className="context-bar"><span>工作台</span>
      <ChevronRight aria-hidden="true" /><span>服務管理</span>
      <ChevronRight aria-hidden="true" /><span aria-current="page"
        className="context-bar__crumb">{page.title}</span></nav>
    <header className={styles.hero}><div><p className="eyebrow">
      頁面 {page.number}・不可變交通規劃</p><h1>{page.title}</h1>
      <p>車輛、駕駛、乘員、時間與容量使用同一規則快照檢查；衝突不會被隱藏，也不會自動發布。</p>
    </div><div className={styles.snapshotMeta}><span>服務日 {filters.serviceDate}</span>
      <time dateTime={snapshot.generatedAt}>更新 {taipei(snapshot.generatedAt)}</time>
      <span>60 秒後視為過期</span></div></header>

    {snapshot.demo ? <div className={styles.notice} role="status">
      展示模式：車輛、駕駛、個案、地址與衝突均為合成資料，只能檢視。
    </div> : null}
    {snapshot.policyStatus === "manual_unstandardized" ? <div
      className={styles.notice} role="note">已載入機構人工未標準化交通資源規則
      v{snapshot.policyVersion}；它不是官方車籍或駕照驗證。</div> : <div
      className={styles.warning} role="alert">所選日期沒有唯一有效的車輛容量與駕駛授權版本；所有建立、修訂與發布操作維持 fail closed。</div>}
    <div className={styles.warning} role="note">外部通知、匯出與 24 小時唯讀快取尚未配置；
      `not_configured` 不會被顯示成已通知、已下載或可離線。</div>

    <section aria-label="交通計畫摘要" className={styles.metrics}>
      <article><BusFront aria-hidden="true" /><span>趟次數</span>
        <strong>{snapshot.matchingTripTotal}</strong></article>
      <article><UsersRound aria-hidden="true" /><span>乘客數</span>
        <strong>{snapshot.passengerTotal}</strong></article>
      <article><AlertTriangle aria-hidden="true" /><span>容量衝突</span>
        <strong>{snapshot.capacityConflictTotal}</strong></article>
      <article><Clock3 aria-hidden="true" /><span>待發布</span>
        <strong>{snapshot.pendingPublicationTotal}</strong></article>
    </section>

    {!snapshot.demo ? <section aria-label="受治理交通計畫操作"
      className={styles.actions}><TransportTripComposer canManage={canManage}
        hasRecentAal2={hasRecentAal2} snapshot={snapshot} />
      <TransportTripDecision canApprove={canApprove} canOverride={canOverride}
        currentUserId={currentUserId} hasRecentAal2={hasRecentAal2}
        snapshot={snapshot} /></section> : null}

    <form aria-label="篩選交通趟次" className={styles.filters} method="get">
      <label><span>日期</span><input defaultValue={filters.serviceDate}
        name="date" required type="date" /></label>
      <label><span>方向</span><select defaultValue={filters.direction} name="direction">
        <option value="all">全部</option><option value="pickup">到中心接入</option>
        <option value="dropoff">由中心送回</option></select></label>
      <label><span>車輛</span><input defaultValue={filters.vehicleQuery}
        maxLength={80} name="vehicle" placeholder="代碼或名稱" /></label>
      <label><span>駕駛</span><input defaultValue={filters.driverQuery}
        maxLength={80} name="driver" placeholder="姓名或員編" /></label>
      <label><span>狀態</span><select defaultValue={filters.status} name="status">
        <option value="all">全部</option><option value="draft_ready">待發布／無衝突</option>
        <option value="draft_conflicted">待發布／有衝突</option>
        <option value="published">已發布</option><option value="rejected">已駁回</option>
      </select></label><button className="button button--secondary" type="submit">套用篩選</button>
      <Link className="button button--quiet" href={`${basePath}?date=${filters.serviceDate}`}>
        清除</Link></form>

    <section className={styles.records} aria-labelledby="transport-plan-list-heading">
      <div className={styles.sectionHeading}><div><p className="eyebrow">同一快照</p>
        <h2 id="transport-plan-list-heading">趟次、資源與逐人地點</h2></div>
        <p>{snapshot.trips.length} / {snapshot.matchingTripTotal} 筆</p></div>
      {snapshot.tripsTruncated ? <p role="status">清單上限 100 筆，請縮小篩選。</p> : null}
      {!snapshot.trips.length ? <section className="empty-card"><BusFront aria-hidden="true" />
        <h3>沒有符合條件的趟次</h3><p>請調整日期、方向、車輛、駕駛或狀態。</p></section> : <>
        <div aria-label="可水平捲動的交通趟次表格" className={styles.tableWrap}
          role="region" tabIndex={0}><table className={styles.table}><thead><tr>
            <th>趟次／方向</th><th>車輛／駕駛</th><th>乘員</th><th>預計時間</th>
            <th>狀態</th><th>衝突</th><th>完整依據</th></tr></thead><tbody>
          {snapshot.trips.map((trip) => <tr key={trip.tripVersionId}>
            <td><strong>v{trip.version}・{DIRECTION[trip.direction]}</strong>
              <small>{trip.pickupLabel} → {trip.dropoffLabel}</small></td>
            <td>{trip.vehicle.name}<small>{trip.vehicle.code}・容量 {trip.vehicle.capacity}</small>
              <br />{trip.driver.displayName}</td><td>{trip.passengers.length} 人</td>
            <td>{taipei(trip.startsAt)}<small>至 {taipei(trip.endsAt)}</small></td>
            <td><span className={`${styles.pill} ${styles[`pill_${trip.status}`]}`}>
              {STATUS[trip.status]}</span></td><td>{trip.conflicts.length} 項</td>
            <td><details className={styles.details}><summary>展開完整依據</summary>
              <TripDetails trip={trip} /></details></td></tr>)}</tbody></table></div>
        <div className={styles.mobileCards}>{snapshot.trips.map((trip) => <article
          key={trip.tripVersionId}><div className={styles.cardHeading}><div>
            <h3>{DIRECTION[trip.direction]}・v{trip.version}</h3>
            <small>{trip.vehicle.name}・{trip.driver.displayName}</small></div>
            <span className={`${styles.pill} ${styles[`pill_${trip.status}`]}`}>
              {STATUS[trip.status]}</span></div>
          <p><strong>時間：</strong>{taipei(trip.startsAt)} ～ {taipei(trip.endsAt)}</p>
          <p><strong>乘員：</strong>{trip.passengers.length} 人・{trip.conflicts.length} 項衝突</p>
          <details className={styles.details}><summary>展開完整依據</summary>
            <TripDetails trip={trip} /></details></article>)}</div>
      </>}
    </section>
  </div>;
}
