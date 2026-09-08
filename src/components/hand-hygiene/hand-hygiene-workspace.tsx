import { Calculator, CircleAlert, Droplets, Link2Off } from "lucide-react";
import Link from "next/link";

import type { PageCatalogEntry } from "@/lib/catalog";
import type {
  HandHygieneEvent,
  HandHygieneFilters,
  HandHygieneSnapshot,
} from "@/lib/hand-hygiene/types";

import { HandHygieneMatchAction } from "./hand-hygiene-action";
import styles from "./hand-hygiene.module.css";

const matchLabels = {
  matched: "已配對",
  unmatched: "未配對",
  excluded: "已排除",
} as const;
const kindLabels = {
  hygiene_performed: "洗手執行事件",
  opportunity: "觀測機會事件",
} as const;

function dateTime(value: string) {
  return new Intl.DateTimeFormat("zh-TW", {
    timeZone: "Asia/Taipei",
    dateStyle: "medium",
    timeStyle: "short",
    hourCycle: "h23",
  }).format(new Date(value));
}

function EventFacts({ event }: { event: HandHygieneEvent }) {
  return <dl>
    <div><dt>事件</dt><dd>{kindLabels[event.eventKind]}</dd></div>
    <div><dt>設備</dt><dd>{event.deviceCode}</dd></div>
    <div><dt>發生時間</dt><dd><time dateTime={event.occurredAt}>{dateTime(event.occurredAt)}</time></dd></div>
    <div><dt>員工</dt><dd>{event.staffDisplayName ?? "尚未配對"}</dd></div>
    <div><dt>狀態</dt><dd>{matchLabels[event.matchStatus]}</dd></div>
    <div><dt>來源</dt><dd>{event.sourceProvider} · {event.sourceEventId}</dd></div>
    <div><dt>修正序號</dt><dd>{event.correctionSequence}</dd></div>
    {event.correctionReason ? <div><dt>最近修正</dt><dd>{event.correctionReason}</dd></div> : null}
  </dl>;
}

export function HandHygieneWorkspace({
  canManage,
  filters,
  loadError,
  page,
  snapshot,
}: {
  canManage: boolean;
  filters: HandHygieneFilters;
  loadError: boolean;
  page: PageCatalogEntry;
  snapshot: HandHygieneSnapshot | null;
}) {
  if (loadError || !snapshot) return <main className={styles.workspace}>
    <header className={styles.hero}><div><p className="eyebrow">機構營運管理</p>
      <h1>{page.title}</h1><p>{page.description}</p></div></header>
    <section className={styles.error} role="alert">
      <h2>目前無法載入洗手事件</h2>
      <p>可能是無權限、分支情境失效、資料逾時或服務未設定；系統不會用空數字取代失敗結果。</p>
      <Link className="button button--secondary" href="/app/staff/operations/hand-hygiene">重新載入</Link>
    </section>
  </main>;

  return <main className={styles.workspace}>
    <header className={styles.hero}>
      <div><p className="eyebrow">機構營運管理 · 第 66 頁</p>
        <h1>{page.title}</h1><p>{page.description}</p></div>
      <aside className={styles.snapshotMeta} aria-label="資料快照">
        <strong>{snapshot.demo ? "去識別合成展示" : "正式分支資料"}</strong>
        <span>更新：<time dateTime={snapshot.generatedAt}>{dateTime(snapshot.generatedAt)}</time></span>
        <span>時區：Asia/Taipei</span>
        <span>離線：不開放</span>
      </aside>
    </header>

    {snapshot.demo ? <p className={styles.notice} role="status">
      本頁只顯示合成事件；配對修正、匯出及外部設備寫入不會執行。
    </p> : null}
    <p className={styles.warning} role="note">
      達成率分母規則尚未由機構發布，因此系統只列出可稽核候選事件，不計算或顯示臆測百分比。
    </p>

    <section className={styles.metrics} aria-label="事件統計">
      <article><Droplets aria-hidden="true" /><span>洗手執行事件</span>
        <strong>{snapshot.metrics.performedEventTotal}</strong>
        <small>排除狀態不列入</small></article>
      <article><Link2Off aria-hidden="true" /><span>未配對事件</span>
        <strong>{snapshot.metrics.unmatchedTotal}</strong>
        <small>可由授權人員追加修正</small></article>
      <article><Calculator aria-hidden="true" /><span>應執行次數</span>
        <strong>尚未設定</strong><small>不是 0，也不納入比率</small></article>
      <article><CircleAlert aria-hidden="true" /><span>達成率</span>
        <strong>—</strong><small>待分母規則與來源簽核</small></article>
    </section>

    <section className={styles.formula} aria-labelledby="formula-title">
      <div><p className="eyebrow">公式與排除規則</p><h2 id="formula-title">目前可公開查明的計算口徑</h2></div>
      <ol>
        <li>來源去重鍵為「機構＋分支＋來源供應者＋來源事件 ID」；完全相同重送只回傳原事件。</li>
        <li>分子候選為篩選期間內、終端配對狀態為「已配對」的不同洗手執行事件。</li>
        <li>終端狀態為「已排除」的事件不列入洗手或觀測機會候選計數；修正只追加，不改寫來源事件。</li>
        <li>分母、適用班別／角色、排除期間與正式達成率尚未發布；在此之前固定顯示「尚未設定」。</li>
      </ol>
      <p>目前另觀測到 {snapshot.metrics.observedOpportunityEventTotal} 筆機會事件、其中洗手分子候選 {snapshot.metrics.matchedPerformedTotal} 筆；兩者不可直接相除。</p>
      <button className="button button--secondary" disabled title="正式匯出格式尚未設定" type="button">匯出（尚未設定）</button>
    </section>

    <form className={styles.filters} method="get">
      <label><span>起日</span><input defaultValue={filters.dateFrom ?? ""} name="from" type="date" /></label>
      <label><span>迄日</span><input defaultValue={filters.dateTo ?? ""} name="to" type="date" /></label>
      <label><span>員工</span><select defaultValue={filters.staffMembershipId ?? "all"} name="staff">
        <option value="all">全部</option>{snapshot.staffOptions.map((staff) =>
          <option key={staff.staffMembershipId} value={staff.staffMembershipId}>
            {staff.employeeCode ? `${staff.employeeCode} · ` : ""}{staff.displayName}
          </option>)}</select></label>
      <label><span>設備</span><select defaultValue={filters.deviceCode ?? "all"} name="device">
        <option value="all">全部</option>{snapshot.deviceOptions.map((device) =>
          <option key={device.deviceCode} value={device.deviceCode}>{device.deviceCode}（{device.eventCount}）</option>)}</select></label>
      <label><span>配對狀態</span><select defaultValue={filters.matchStatus} name="status">
        <option value="all">全部</option><option value="matched">已配對</option>
        <option value="unmatched">未配對</option><option value="excluded">已排除</option>
      </select></label>
      <label><span>事件類型</span><select defaultValue={filters.eventKind} name="kind">
        <option value="all">全部</option><option value="hygiene_performed">洗手執行</option>
        <option value="opportunity">觀測機會</option>
      </select></label>
      <div className={styles.filterActions}><button className="button button--primary" type="submit">套用篩選</button>
        <Link className="button button--ghost" href="/app/staff/operations/hand-hygiene">清除</Link></div>
    </form>

    <section className={styles.records} aria-labelledby="events-title">
      <div className={styles.resultHeader}><div><p className="eyebrow">來源事件與終端配對</p>
        <h2 id="events-title">事件明細</h2></div><p>符合 {snapshot.eventTotal} 筆</p></div>
      {snapshot.eventsTruncated ? <p className={styles.warning} role="alert">
        明細只顯示前 200 筆；統計仍以完整篩選集合計算。請縮小期間再修正。
      </p> : null}
      {snapshot.events.length === 0 ? <div className={styles.empty}>
        <h3>目前篩選沒有事件</h3><p>請清除篩選或確認設備整合是否已提供事件。</p>
      </div> : <>
        <div className={styles.tableWrap}><table className={styles.table}>
          <thead><tr><th>員工／狀態</th><th>設備／類型</th><th>發生／接收</th><th>來源事件</th><th>修正</th></tr></thead>
          <tbody>{snapshot.events.map((event) => <tr key={event.eventId}>
            <td><strong>{event.staffDisplayName ?? "尚未配對"}</strong><br />
              <small>{event.staffEmployeeCode ?? matchLabels[event.matchStatus]}</small></td>
            <td>{event.deviceCode}<br /><small>{kindLabels[event.eventKind]}</small></td>
            <td><time dateTime={event.occurredAt}>{dateTime(event.occurredAt)}</time><br />
              <small>接收 {dateTime(event.receivedAt)}</small></td>
            <td>{event.sourceProvider}<br /><small>{event.sourceEventId}</small></td>
            <td><span>{event.correctionSequence === 0 ? "未修正" : `第 ${event.correctionSequence} 次`}</span>
              <HandHygieneMatchAction canManage={canManage && !snapshot.eventsTruncated}
                event={event} snapshot={snapshot} /></td>
          </tr>)}</tbody>
        </table></div>
        <div className={styles.mobileCards}>{snapshot.events.map((event) => <article key={event.eventId}>
          <h3>{event.staffDisplayName ?? "尚未配對"}</h3><EventFacts event={event} />
          <HandHygieneMatchAction canManage={canManage && !snapshot.eventsTruncated}
            event={event} snapshot={snapshot} />
        </article>)}</div>
      </>}
    </section>
  </main>;
}
