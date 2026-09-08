import { AlertTriangle, CalendarDays, CheckCircle2, Clock3, FileClock, Users } from "lucide-react";
import Link from "next/link";

import type { PageCatalogEntry } from "@/lib/catalog";
import type {
  MeetingActionStatus,
  MeetingFilters,
  MeetingManagementSnapshot,
} from "@/lib/meetings/types";

import {
  MeetingActionUpdateForm,
  MeetingCorrectionForm,
  NewMeetingForm,
} from "./meeting-actions";
import styles from "./meetings.module.css";

const statusLabels: Record<MeetingActionStatus, string> = {
  not_started: "尚未開始",
  in_progress: "進行中",
  completed: "已完成",
  cancelled: "已取消",
};

function formatTaipei(value: string) {
  return new Intl.DateTimeFormat("zh-TW", {
    timeZone: "Asia/Taipei", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).format(new Date(value));
}

export function MeetingManagementWorkspace({
  canManage,
  canSign,
  filters,
  hasRecentAal2,
  loadError,
  page,
  snapshot,
}: {
  canManage: boolean;
  canSign: boolean;
  filters: MeetingFilters;
  hasRecentAal2: boolean;
  loadError: boolean;
  page: PageCatalogEntry;
  snapshot: MeetingManagementSnapshot | null;
}) {
  if (loadError || !snapshot) return (
    <section className="empty-card" aria-labelledby="meeting-load-error">
      <span className="empty-card__icon empty-card__icon--warning"><AlertTriangle aria-hidden="true" /></span>
      <p className="eyebrow">載入失敗</p>
      <h1 id="meeting-load-error">無法取得會議管理快照</h1>
      <p>系統沒有顯示未經驗證的局部資料。請確認網路與分支後重新整理。</p>
      <Link className="button button--secondary" href="/app/staff/operations/meetings">重新載入</Link>
    </section>
  );

  const meetingTypes = [...new Set(snapshot.meetings.map((meeting) => meeting.meetingType))]
    .sort((a, b) => a.localeCompare(b, "zh-TW"));
  return (
    <main className={styles.workspace}>
      <header className={styles.hero}>
        <div>
          <p className="eyebrow">第 {page.number} 頁 · 機構營運管理</p>
          <h1>{page.title}</h1>
          <p>{page.description} 所有畫面均為已簽署的終端版本；更正不覆寫原紀錄。</p>
        </div>
        <div className={styles.snapshotMeta}>
          <span>台北快照日 {snapshot.snapshotDate}</span>
          <time dateTime={snapshot.generatedAt}>更新 {formatTaipei(snapshot.generatedAt)}</time>
          <span>資料超過 60 秒時請重新載入</span>
        </div>
      </header>

      {snapshot.demo ? <div className={styles.notice} role="status">
        展示模式：以下為合成資料，只能檢視，不會簽署或寫入行動進度。
      </div> : null}
      <div className={styles.notice} role="note">
        會議類型、保存年限與逾期升級頻率由機構自訂，目前尚未設定。逾期僅形成本頁待辦，沒有送出 LINE、簡訊或其他外部通知。
      </div>

      <section className={styles.metrics} aria-label="會議統計">
        <article><CalendarDays aria-hidden="true" /><span>會議終端版本</span><strong>{snapshot.meetingAvailableTotal}</strong></article>
        <article><FileClock aria-hidden="true" /><span>更正版</span><strong>{snapshot.correctionTotal}</strong></article>
        <article><Clock3 aria-hidden="true" /><span>行動待辦</span><strong>{snapshot.openActionTotal}</strong></article>
        <article className={snapshot.overdueActionTotal ? styles.metricWarning : undefined}><AlertTriangle aria-hidden="true" /><span>逾期行動</span><strong>{snapshot.overdueActionTotal}</strong></article>
      </section>

      <NewMeetingForm canSign={canSign && !snapshot.demo} hasRecentAal2={hasRecentAal2} snapshot={snapshot} />

      <form className={styles.filters} method="get" aria-label="篩選會議">
        <label><span>搜尋</span><input name="q" defaultValue={filters.query} maxLength={120} placeholder="標題、議程或簽署人" /></label>
        <label><span>日期</span><input type="date" name="date" defaultValue={filters.date ?? ""} /></label>
        <label><span>會議類型</span><select name="type" defaultValue={filters.meetingType}><option value="all">全部類型</option>{meetingTypes.map((type) => <option key={type} value={type}>{type}</option>)}</select></label>
        <label><span>行動狀態</span><select name="status" defaultValue={filters.status}>
          <option value="all">全部</option><option value="open">有待辦</option>
          <option value="overdue">有逾期</option><option value="completed">有已完成</option>
          <option value="cancelled">有已取消</option>
        </select></label>
        <button className="button button--secondary" type="submit">套用篩選</button>
        <Link className="button button--ghost" href="/app/staff/operations/meetings">清除</Link>
      </form>

      <div className={styles.resultHeader}>
        <p>顯示 {snapshot.meetings.length} / {snapshot.meetingAvailableTotal} 筆會議</p>
        {snapshot.meetingsTruncated ? <p role="status">明細上限 100 筆；統計仍涵蓋全部終端版本。</p> : null}
        {snapshot.staffTruncated ? <p role="status">人員選項顯示 {snapshot.staffOptions.length} / {snapshot.staffTotal} 人。</p> : null}
      </div>

      {snapshot.meetings.length === 0 ? <section className="empty-card" aria-labelledby="meeting-empty">
        <span className="empty-card__icon"><CalendarDays aria-hidden="true" /></span>
        <h2 id="meeting-empty">沒有符合條件的會議</h2>
        <p>請調整日期、類型、狀態或搜尋文字。若尚未建立紀錄，可由具簽署權限者新增。</p>
      </section> : <section className={styles.cards} aria-label="會議明細">
        {snapshot.meetings.map((meeting) => {
          const open = meeting.actionItems.filter((action) =>
            !["completed", "cancelled"].includes(action.progressStatus)).length;
          const overdue = meeting.actionItems.filter((action) => action.isOverdue).length;
          return <article className={styles.card} key={meeting.minuteVersionId}>
            <header className={styles.cardHeader}>
              <div><p className="eyebrow">{meeting.meetingType}</p><h2>{meeting.title}</h2>
                <p>{formatTaipei(meeting.startsAt)}–{formatTaipei(meeting.endsAt).split(" ").at(-1)}</p></div>
              <div className={styles.badges}>
                <span>版本 {meeting.minuteVersion}</span>
                {meeting.correctionReason ? <span>更正版</span> : <span>原始版</span>}
                {overdue ? <span className={styles.danger}>{overdue} 項逾期</span> : open ? <span>{open} 項待辦</span> : <span className={styles.success}>無逾期待辦</span>}
              </div>
            </header>
            {meeting.correctionReason ? <p className={styles.reason}><strong>更正理由：</strong>{meeting.correctionReason}</p> : null}
            <div className={styles.summaryGrid}>
              <section><h3><Users aria-hidden="true" /> 出席</h3><p>{meeting.staffAttendees.map((item) => item.displayName).join("、")}</p>
                {meeting.externalAttendees.length ? <p>外部人員：{meeting.externalAttendees.map((item) => item.name).join("、")}</p> : null}</section>
              <section><h3>議程</h3><ol>{meeting.agendaItems.map((item) => <li key={item.itemId}>{item.topic}</li>)}</ol></section>
              <section><h3>決議</h3>{meeting.decisions.length ? <ol>{meeting.decisions.map((item) => <li key={item.decisionId}>{item.decision}</li>)}</ol> : <p>未記載決議</p>}</section>
              <section><h3><CheckCircle2 aria-hidden="true" /> 簽署證據</h3><p>{meeting.signerDisplayName} · {meeting.signerRoleKeys.join("、")}</p><p>{meeting.signaturePurpose} · {formatTaipei(meeting.signedAt)}</p></section>
            </div>
            <section className={styles.actions}><h3>行動項目</h3>
              {meeting.actionItems.length === 0 ? <p>本次會議沒有行動項目。</p> : meeting.actionItems.map((action) => <article className={styles.action} key={action.actionId}>
                <div><strong>{action.action}</strong><p>負責：{action.responsibleDisplayName} · 期限 {action.dueDate}</p></div>
                <span className={action.isOverdue ? styles.danger : action.progressStatus === "completed" ? styles.success : undefined}>
                  {action.isOverdue ? `逾期 · ${statusLabels[action.progressStatus]}` : statusLabels[action.progressStatus]}
                </span>
                <MeetingActionUpdateForm action={action} canManage={canManage && !snapshot.demo} meeting={meeting} />
              </article>)}
            </section>
            <MeetingCorrectionForm canSign={canSign && !snapshot.demo} hasRecentAal2={hasRecentAal2} meeting={meeting} />
          </article>;
        })}
      </section>}
    </main>
  );
}
