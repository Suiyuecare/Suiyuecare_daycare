import {
  CalendarDays,
  CheckCircle2,
  ChevronRight,
  CircleAlert,
  Clock3,
  Database,
  HeartPulse,
  ShieldCheck,
} from "lucide-react";

import { AttendanceComposer } from "@/components/core-care/attendance-composer";
import { CareDiaryComposer } from "@/components/core-care/care-diary-composer";
import { VitalSignComposer } from "@/components/core-care/vital-sign-composer";
import { StatusPill } from "@/components/ui/status-pill";
import type { PageCatalogEntry } from "@/lib/catalog";
import type {
  DailyCareSnapshot,
  DailyClientSummary,
} from "@/lib/core-care/types";

type Metric = { label: string; value: string; unit: string; foot: string };

function formatTime(value: string | null) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("zh-TW", {
    timeZone: "Asia/Taipei",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(new Date(value));
}

function attendanceLabel(client: DailyClientSummary) {
  if (!client.attendance) return "尚無紀錄";
  return {
    present: client.attendance.checkedOutAt ? "已簽退" : "已簽到",
    absent: "未到",
    leave: "請假",
    cancelled: "已取消",
  }[client.attendance.status];
}

function attendanceSourceLabel(source: string | undefined) {
  if (!source) return "—";
  if (source === "staff_backfill") return "補登";
  if (source === "staff") return "即時";
  return source;
}

function attendanceDuration(client: DailyClientSummary) {
  const checkedInAt = client.attendance?.checkedInAt;
  const checkedOutAt = client.attendance?.checkedOutAt;
  if (!checkedInAt || !checkedOutAt) return "—";
  const minutes = Math.floor(
    (new Date(checkedOutAt).getTime() - new Date(checkedInAt).getTime()) /
      60_000,
  );
  if (minutes < 0) return "資料錯誤";
  return `${Math.floor(minutes / 60)} 小時 ${minutes % 60} 分`;
}

function diaryLabel(client: DailyClientSummary) {
  if (!client.careDiary) return "尚無日誌";
  if (client.careDiary.hasAbnormalFlag) return "需留意";
  return {
    draft: "草稿",
    submitted: "待簽署",
    signed: "已完成",
    corrected: "已更正",
    voided: "已作廢",
  }[client.careDiary.status];
}

function metricsForPage(page: PageCatalogEntry, snapshot: DailyCareSnapshot): Metric[] {
  const clients = snapshot.clients;
  if (page.number === 3) {
    const measured = clients.filter((client) => client.vitalSigns).length;
    return [
      { label: "在案個案", value: String(clients.length), unit: "人", foot: "目前分支與日期快照" },
      { label: "已有量測", value: String(measured), unit: "人", foot: "至少一筆核准量測種類" },
      { label: "尚無量測", value: String(clients.length - measured), unit: "人", foot: "缺測不會計為 0" },
      { label: "異常判定", value: "—", unit: "", foot: "待機構發布門檻版本" },
    ];
  }
  if (page.number === 6) {
    const diaries = clients.filter((client) => client.careDiary);
    return [
      { label: "今日有日誌", value: String(diaries.length), unit: "人", foot: "以發生時間計入" },
      { label: "尚無日誌", value: String(clients.length - diaries.length), unit: "人", foot: "不以空白代替完成" },
      { label: "需留意", value: String(diaries.filter((client) => client.careDiary?.hasAbnormalFlag).length), unit: "件", foot: "來自已保存異常旗標" },
      { label: "草稿", value: String(diaries.filter((client) => client.careDiary?.status === "draft").length), unit: "件", foot: "草稿不等於已簽署" },
    ];
  }
  if (page.number === 46) {
    const attendance = clients.filter((client) => client.attendance);
    return [
      { label: "目前個案", value: String(clients.length), unit: "人", foot: "尚未接排程適用分母" },
      { label: "已到", value: String(attendance.filter((client) => client.attendance?.status === "present").length), unit: "人", foot: "包含尚未簽退" },
      { label: "請假／未到", value: String(attendance.filter((client) => ["leave", "absent"].includes(client.attendance?.status ?? "")).length), unit: "人", foot: "依正式出勤狀態" },
      { label: "尚無紀錄", value: String(clients.length - attendance.length), unit: "人", foot: "不自動判定缺勤" },
    ];
  }
  return [
    { label: "出勤來源", value: String(snapshot.sourceCounts.attendanceRecords), unit: "筆", foot: "attendance_records" },
    { label: "量測個案", value: String(snapshot.sourceCounts.clientsWithMeasurements), unit: "人", foot: "measurements" },
    { label: "照顧日誌", value: String(snapshot.sourceCounts.careDiaryRecords), unit: "筆", foot: "care_records" },
    { label: "完成服務", value: String(snapshot.sourceCounts.completedServiceEvents), unit: "筆", foot: "service_events" },
  ];
}

function VitalCells({ client }: { client: DailyClientSummary }) {
  const vital = client.vitalSigns;
  return (
    <>
      <td>{vital ? `${vital.systolic ?? "—"}/${vital.diastolic ?? "—"}` : "—"}</td>
      <td>{vital?.pulse ?? "—"}</td>
      <td>{vital?.temperature == null ? "—" : vital.temperature.toFixed(1)}</td>
      <td>{vital?.oxygenSaturation ?? "—"}</td>
      <td>{formatTime(vital?.measuredAt ?? null)}</td>
      <td><StatusPill status={vital ? "已有量測" : "尚無量測"} /></td>
    </>
  );
}

function DesktopRows({ page, clients }: { page: PageCatalogEntry; clients: readonly DailyClientSummary[] }) {
  return clients.map((client) => (
    <tr key={client.clientId}>
      <td><span className="data-table__primary"><span className="avatar" aria-hidden="true">{client.displayName.slice(0, 1)}</span><span>{client.displayName}<small className="data-table__secondary">{client.clientCode}</small></span></span></td>
      {page.number === 3 ? <VitalCells client={client} /> : null}
      {page.number === 6 ? <><td>{formatTime(client.careDiary?.occurredAt ?? null)}</td><td><StatusPill status={diaryLabel(client)} /></td><td>{client.careDiary?.hasAbnormalFlag ? "是，待處理" : "否"}</td><td>{client.careDiary?.status === "signed" ? "已簽署" : "—"}</td></> : null}
      {page.number === 46 ? <><td>{formatTime(client.attendance?.checkedInAt ?? null)}</td><td>{formatTime(client.attendance?.checkedOutAt ?? null)}</td><td>{attendanceDuration(client)}</td><td>{attendanceSourceLabel(client.attendance?.source)}</td><td><StatusPill status={attendanceLabel(client)} /></td></> : null}
      {page.number === 54 ? <><td><StatusPill status={attendanceLabel(client)} /></td><td>{client.vitalSigns ? "已有量測" : "尚無量測"}</td><td>{diaryLabel(client)}</td><td>{client.completedServiceCount} 筆</td><td>{client.sourceCoverage}/4</td></> : null}
    </tr>
  ));
}

function tableHeadings(page: PageCatalogEntry) {
  if (page.number === 3) return ["個案", "血壓 mmHg", "脈搏 bpm", "體溫 °C", "血氧 %", "最近時間", "資料狀態"];
  if (page.number === 6) return ["個案", "最近日誌", "狀態", "異常旗標", "簽署"];
  if (page.number === 46) return ["個案", "簽到", "簽退", "服務時數", "登錄方式", "狀態"];
  return ["個案", "出勤", "生命徵象", "照顧日誌", "完成服務", "來源完整度"];
}

export function CoreDailyWorkspace({
  page,
  moduleTitle,
  serviceDate,
  selectedClientId,
  canWrite,
  snapshot,
  loadError = false,
}: {
  page: PageCatalogEntry;
  moduleTitle: string;
  serviceDate: string;
  selectedClientId?: string;
  canWrite: boolean;
  snapshot: DailyCareSnapshot | null;
  loadError?: boolean;
}) {
  const metrics = snapshot ? metricsForPage(page, snapshot) : [];
  const generatedAt = snapshot ? formatTime(snapshot.generatedAt) : "—";

  return (
    <>
      <nav aria-label="所在位置" className="context-bar">
        <span>工作台</span><ChevronRight aria-hidden="true" /><span>{moduleTitle}</span><ChevronRight aria-hidden="true" /><span aria-current="page" className="context-bar__crumb">{page.title}</span>
      </nav>
      <header className="page-heading core-care-heading">
        <div>
          <p className="eyebrow">專用工作流程・頁面 {page.number}</p>
          <h1>{page.title}</h1>
          <p className="page-heading__description">{page.description}</p>
        </div>
        <form className="core-date-filter" method="get">
          {selectedClientId ? <input name="client" type="hidden" value={selectedClientId} /> : null}
          <label className="field"><span>服務日期</span><input defaultValue={serviceDate} name="date" type="date" /></label>
          <button className="button button--secondary" type="submit"><CalendarDays aria-hidden="true" />套用日期</button>
        </form>
      </header>

      {loadError ? (
        <section className="empty-card core-care-state" role="alert">
          <span className="empty-card__icon empty-card__icon--warning"><CircleAlert aria-hidden="true" /></span>
          <h2>目前無法取得同一資料快照</h2>
          <p>系統沒有改用舊資料或展示資料代替。請稍後重新整理，並以請求紀錄追查資料服務。</p>
          <a className="button button--secondary" href={`?date=${serviceDate}${selectedClientId ? `&client=${selectedClientId}` : ""}`}>重新載入</a>
        </section>
      ) : snapshot ? (
        <>
          <div className="callout core-care-callout"><ShieldCheck aria-hidden="true" /><span>本頁的出勤、量測、日誌與服務數量來自同一個服務日快照，更新時間 {generatedAt}。尚未發布的適用分母或異常門檻不會由系統自行猜測。</span></div>

          <section aria-label="本頁摘要" className="metric-grid core-care-metrics">
            {metrics.map((metric, index) => (
              <article className="metric-card" key={metric.label}>
                <div className="metric-card__top"><span>{metric.label}</span><span className="metric-card__icon">{index === 0 ? <Database aria-hidden="true" /> : index === 1 ? <HeartPulse aria-hidden="true" /> : index === 2 ? <Clock3 aria-hidden="true" /> : <CheckCircle2 aria-hidden="true" />}</span></div>
                <div className="metric-card__value"><strong>{metric.value}</strong><span>{metric.unit}</span></div>
                <p className="metric-card__foot">{metric.foot}</p>
              </article>
            ))}
          </section>

          <section className="panel">
            <div className="panel__header">
              <div className="panel__title"><h2>{snapshot.serviceDate} 個案工作清單</h2><p>{snapshot.clients.length} 位在案個案・穩定 ID 去重</p></div>
              {page.number === 3 ? (
                <VitalSignComposer
                  clients={snapshot.clients.map((client) => ({ id: client.clientId, name: client.displayName, code: client.clientCode }))}
                  demo={snapshot.demo}
                  enabled={canWrite}
                  serviceDate={snapshot.serviceDate}
                />
              ) : page.number === 6 ? (
                <CareDiaryComposer
                  clients={snapshot.clients.map((client) => ({ id: client.clientId, name: client.displayName, code: client.clientCode }))}
                  demo={snapshot.demo}
                  enabled={canWrite}
                  serviceDate={snapshot.serviceDate}
                />
              ) : page.number === 46 ? (
                <AttendanceComposer
                  clients={snapshot.clients.map((client) => ({
                    id: client.clientId,
                    name: client.displayName,
                    code: client.clientCode,
                    attendance: client.attendance
                      ? {
                          status: client.attendance.status,
                          checkedOutAt: client.attendance.checkedOutAt,
                        }
                      : null,
                  }))}
                  demo={snapshot.demo}
                  enabled={canWrite}
                  serviceDate={snapshot.serviceDate}
                />
              ) : (
                <button className="button button--primary" disabled title="待專用交易 API 與簽署流程完成" type="button">{page.primaryActions[0]}</button>
              )}
            </div>
            {snapshot.clients.length ? (
              <>
                <div className="table-wrap core-care-table">
                  <table className="data-table"><thead><tr>{tableHeadings(page).map((heading) => <th key={heading} scope="col">{heading}</th>)}</tr></thead><tbody><DesktopRows clients={snapshot.clients} page={page} /></tbody></table>
                </div>
                <div className="mobile-records core-care-mobile">
                  {snapshot.clients.map((client) => (
                    <article className="record-card" key={client.clientId}>
                      <div className="record-card__top"><div><h3>{client.displayName}</h3><span className="data-table__secondary">{client.clientCode}</span></div><StatusPill status={page.number === 46 ? attendanceLabel(client) : page.number === 6 ? diaryLabel(client) : client.sourceCoverage === 4 ? "資料完整" : "待補資料"} /></div>
                      {page.number === 46 ? (
                        <dl className="core-care-card-grid">
                          <div><dt>簽到</dt><dd>{formatTime(client.attendance?.checkedInAt ?? null)}</dd></div>
                          <div><dt>簽退</dt><dd>{formatTime(client.attendance?.checkedOutAt ?? null)}</dd></div>
                          <div><dt>服務時數</dt><dd>{attendanceDuration(client)}</dd></div>
                          <div><dt>登錄方式</dt><dd>{attendanceSourceLabel(client.attendance?.source)}</dd></div>
                        </dl>
                      ) : (
                        <dl className="core-care-card-grid">
                          <div><dt>簽到</dt><dd>{formatTime(client.attendance?.checkedInAt ?? null)}</dd></div>
                          <div><dt>最近量測</dt><dd>{formatTime(client.vitalSigns?.measuredAt ?? null)}</dd></div>
                          <div><dt>照顧日誌</dt><dd>{diaryLabel(client)}</dd></div>
                          <div><dt>完成服務</dt><dd>{client.completedServiceCount} 筆</dd></div>
                        </dl>
                      )}
                    </article>
                  ))}
                </div>
              </>
            ) : (
              <div className="panel__body"><section className="empty-card core-care-state"><Database aria-hidden="true" /><h2>這個服務日沒有可存取個案</h2><p>請確認分支、指派範圍與收案狀態；系統不會自動改查其他分支。</p></section></div>
            )}
          </section>
        </>
      ) : null}
    </>
  );
}
