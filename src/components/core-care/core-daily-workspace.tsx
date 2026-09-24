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
import { ClientContinuation } from "@/components/core-care/client-continuation";
import { NavigationLink } from "@/components/app/navigation-link";
import { StatusPill } from "@/components/ui/status-pill";
import type { PageCatalogEntry } from "@/lib/catalog";
import type {
  DailyCareSnapshot,
  DailyClientSummary,
} from "@/lib/core-care/types";
import { dailyWorkflowHref, type DailyWorkflowPage, type DailyWorkflowShift } from "@/lib/core-care/workflow-links";
import type { ReactNode } from "react";

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
  if (client.sourceAccess?.attendance === false) return "無查閱權限";
  if (!client.attendance) return client.applicability?.attendance === "not_expected" ? "本日未排服務" : client.applicability?.attendance === "unknown" ? "安排待確認" : "尚無紀錄";
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
  if (client.sourceAccess?.careDiaries === false) return "無查閱權限";
  if (!client.careDiary) return client.applicability?.care === "not_expected" ? "不列入待填" : client.applicability?.care === "unknown" ? "適用性待確認" : "尚無日誌";
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
  const key = page.number === 46 ? "attendance" : "care";
  const permission = page.number === 3 ? "measurements" : page.number === 6 ? "careDiaries" : "attendance";
  const applicable = clients.filter(client => client.applicability?.[key] === "expected" && client.sourceAccess?.[permission] !== false);
  const unknown = clients.filter(client => !client.applicability || client.applicability[key] === "unknown" || client.sourceAccess?.[permission] === false).length;
  const count = (value: number) => unknown ? `${value}（已確認）` : String(value);
  if (page.number === 3) {
    const measured = applicable.filter((client) => client.vitalSigns).length;
    return [
      { label: "本日服務名單", value: count(applicable.length), unit: "人", foot: "本日安排或實到；排除請假／未到" },
      { label: "名單已有量測", value: count(measured), unit: "人", foot: "至少一筆量測，不等於全部當班項目完成" },
      { label: "名單尚無量測", value: count(applicable.length - measured), unit: "人", foot: "未排服務者不列漏填；異常依核准門檻" },
      { label: "適用性待確認", value: String(unknown), unit: "人", foot: "缺安排或來源權限，不當成 0 筆待辦" },
    ];
  }
  if (page.number === 6) {
    const signed = applicable.filter((client) => client.careDiary?.status === "signed").length;
    return [
      { label: "本日服務名單", value: count(applicable.length), unit: "人", foot: "本日安排或實到；排除請假／未到" },
      { label: "名單日誌已簽署", value: count(signed), unit: "人", foot: "依最新日誌，不代表所有班別完成" },
      { label: "名單日誌待簽或未填", value: count(applicable.length - signed), unit: "人", foot: "草稿、待簽及未填均不算正式完成" },
      { label: "適用性待確認", value: String(unknown), unit: "人", foot: "缺安排或來源權限，不當成完成" },
    ];
  }
  if (page.number === 46) {
    const attendance = applicable.filter((client) => client.attendance);
    return [
      { label: "應核對出勤", value: count(applicable.length), unit: "人", foot: "本日安排或臨時實到，同一資料快照" },
      { label: "已到", value: String(attendance.filter((client) => client.attendance?.status === "present").length), unit: "人", foot: "包含尚未簽退" },
      { label: "名單尚無出勤", value: count(applicable.filter(client => !client.attendance).length), unit: "人", foot: "請假與未到已記錄；未排服務不列漏填" },
      { label: "適用性待確認", value: String(unknown), unit: "人", foot: "未建立或已過期週表，不推定缺勤" },
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
      <td><StatusPill status={vitalLabel(client)} /></td>
    </>
  );
}

function vitalLabel(client: DailyClientSummary) {
  return client.sourceAccess?.measurements === false ? "無查閱權限" : client.vitalSigns ? "已有量測" : client.applicability?.care === "not_expected" ? "不列入待填" : client.applicability?.care === "unknown" ? "適用性待確認" : "尚無量測";
}

function applicabilityLabel(client: DailyClientSummary) {
  const labels = { scheduled: "本日已安排", arrived: "本日已實到", leave_or_absent: "請假／未到，不列照顧待填", not_scheduled: "本日未排服務", history_only: "當日不適用，保留紀錄", unknown: "安排或出勤權限待確認" };
  return labels[client.applicability?.reason ?? "unknown"];
}

function DesktopRows({ page, clients, sourceAccess }: { page: PageCatalogEntry; clients: readonly DailyClientSummary[]; sourceAccess: DailyCareSnapshot["sourceAccess"] }) {
  return clients.map((client) => (
    <tr key={client.clientId}>
      <td><span className="data-table__primary"><span className="avatar" aria-hidden="true">{client.displayName.slice(0, 1)}</span><span>{client.displayName}<small className="data-table__secondary">{client.clientCode} · {applicabilityLabel(client)}</small></span></span></td>
      {page.number === 3 ? <VitalCells client={client} /> : null}
      {page.number === 6 ? <><td>{formatTime(client.careDiary?.occurredAt ?? null)}</td><td><StatusPill status={diaryLabel(client)} /></td><td>{client.careDiary ? client.careDiary.hasAbnormalFlag ? "是，待處理" : "未標記異常" : "尚無日誌"}</td><td>{client.careDiary?.status === "signed" ? "已簽署" : "—"}</td></> : null}
      {page.number === 46 ? <><td>{formatTime(client.attendance?.checkedInAt ?? null)}</td><td>{formatTime(client.attendance?.checkedOutAt ?? null)}</td><td>{attendanceDuration(client)}</td><td>{attendanceSourceLabel(client.attendance?.source)}</td><td><StatusPill status={attendanceLabel(client)} /></td></> : null}
      {page.number === 54 ? <><td>{sourceAccess.attendance ? attendanceLabel(client) : "無查閱權限"}</td><td>{sourceAccess.measurements ? client.vitalSigns ? "已有量測" : "尚無量測" : "無查閱權限"}</td><td>{sourceAccess.careDiaries ? diaryLabel(client) : "無查閱權限"}</td><td>{sourceAccess.serviceEvents ? `${client.completedServiceCount} 筆` : "無查閱權限"}</td><td>{Object.values(sourceAccess).every(Boolean) ? `${client.sourceCoverage}/4` : "部分來源未授權"}</td></> : null}
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
  selectedShift,
  canWrite,
  snapshot,
  loadError = false,
  canViewManagementDetails = false,
  clientAttention,
  diaryLifecycle,
}: {
  page: PageCatalogEntry;
  moduleTitle: string;
  serviceDate: string;
  selectedClientId?: string;
  selectedShift?: DailyWorkflowShift;
  canWrite: boolean;
  snapshot: DailyCareSnapshot | null;
  loadError?: boolean;
  canViewManagementDetails?: boolean;
  clientAttention?: ReactNode;
  diaryLifecycle?: ReactNode;
}) {
  const workflowPage = page.number as DailyWorkflowPage;
  const visibleClients = snapshot?.sourceAccess.clients ? snapshot.clients.map((client) => ({
    ...client,
    attendance: snapshot.sourceAccess.attendance && client.sourceAccess?.attendance !== false ? client.attendance : null,
    vitalSigns: snapshot.sourceAccess.measurements && client.sourceAccess?.measurements !== false ? client.vitalSigns : null,
    careDiary: snapshot.sourceAccess.careDiaries && client.sourceAccess?.careDiaries !== false ? client.careDiary : null,
    completedServiceCount: snapshot.sourceAccess.serviceEvents && client.sourceAccess?.serviceEvents !== false ? client.completedServiceCount : 0,
    sourceCoverage: Object.values(snapshot.sourceAccess).every(Boolean) ? client.sourceCoverage : 0,
  })) : [];
  const selectedClient = visibleClients.find((client) => client.clientId === selectedClientId);
  const recordClients = selectedClient ? [selectedClient] : visibleClients;
  const invalidSelection = selectedClientId !== undefined && !selectedClient;
  const pageSourceAllowed = snapshot?.sourceAccess.clients && (
    page.number === 3 ? snapshot.sourceAccess.measurements : page.number === 6
      ? snapshot.sourceAccess.careDiaries : page.number === 46 ? snapshot.sourceAccess.attendance
        : Object.values(snapshot.sourceAccess).every(Boolean)
  );
  const metrics = snapshot && pageSourceAllowed && !invalidSelection && !selectedClient ? metricsForPage(page, snapshot) : [];
  const generatedAt = snapshot ? formatTime(snapshot.generatedAt) : "—";
  const composerClients = selectedClient ? [{
    id: selectedClient.clientId, name: selectedClient.displayName, code: selectedClient.clientCode,
    attendance: selectedClient.attendance ? {
      status: selectedClient.attendance.status, checkedOutAt: selectedClient.attendance.checkedOutAt,
    } : null,
  }] : [];
  const selectedSourceAllowed = selectedClient?.sourceAccess?.[page.number === 3 ? "measurements" : page.number === 6 ? "careDiaries" : "attendance"] !== false;
  const composer = snapshot && selectedClient && selectedClient.applicability?.eligible !== false && pageSourceAllowed && selectedSourceAllowed ? (
    page.number === 3 ? <VitalSignComposer key={`${snapshot.serviceDate}:${selectedClient.clientId}:${selectedShift ?? "none"}`} clients={composerClients} demo={snapshot.demo} enabled={canWrite}
      serviceDate={snapshot.serviceDate} selectedClientId={selectedClient.clientId} />
      : page.number === 6 ? <CareDiaryComposer key={`${snapshot.serviceDate}:${selectedClient.clientId}:${selectedShift ?? "none"}`} clients={composerClients} demo={snapshot.demo} enabled={canWrite}
        serviceDate={snapshot.serviceDate} selectedClientId={selectedClient.clientId} selectedShift={selectedShift} />
        : page.number === 46 ? <AttendanceComposer key={`${snapshot.serviceDate}:${selectedClient.clientId}:${selectedShift ?? "none"}`} clients={composerClients} demo={snapshot.demo} enabled={canWrite}
          serviceDate={snapshot.serviceDate} selectedClientId={selectedClient.clientId} /> : null
  ) : null;

  return (
    <>
      <nav aria-label="所在位置" className="context-bar">
        <span>工作台</span><ChevronRight aria-hidden="true" /><span>{moduleTitle}</span><ChevronRight aria-hidden="true" /><span aria-current="page" className="context-bar__crumb">{page.title}</span>
      </nav>
      <header className="page-heading core-care-heading">
        <div>
          <p className="eyebrow">每日照顧工作</p>
          <h1>{page.title}</h1>
          <p className="page-heading__description">先確認個案與日期，再接續出勤、量測和照顧日誌。</p>
        </div>
        <form className="core-date-filter" method="get">
          {selectedClient ? <input name="client" type="hidden" value={selectedClient.clientId} /> : null}
          {selectedShift ? <input name="shift" type="hidden" value={selectedShift} /> : null}
          <label className="field"><span>服務日期</span><input defaultValue={serviceDate} name="date" type="date" /></label>
          <button className="button button--secondary" type="submit"><CalendarDays aria-hidden="true" />套用日期</button>
        </form>
      </header>

      {loadError ? (
        <section className="empty-card core-care-state" role="alert">
          <span className="empty-card__icon empty-card__icon--warning"><CircleAlert aria-hidden="true" /></span>
          <h2>暫時無法載入當日工作</h2>
          <p>請重新載入後再記錄；畫面不會用舊資料或展示資料代替。</p>
          <NavigationLink className="button button--secondary" href={dailyWorkflowHref(workflowPage, serviceDate, selectedClientId, selectedShift)} loadingLabel="當日工作" prefetch={false}>重新載入</NavigationLink>
        </section>
      ) : snapshot ? (
        <>
          <ClientContinuation key={`${serviceDate}:${selectedClientId ?? "none"}:${selectedShift ?? "none"}`} page={workflowPage}
            clients={visibleClients} selectedClientId={selectedClientId} selectedShift={selectedShift} serviceDate={snapshot.serviceDate} sourceAccess={snapshot.sourceAccess} action={composer} />
          {selectedClient && pageSourceAllowed ? clientAttention : null}
          {selectedClient && page.number === 6 && pageSourceAllowed && selectedSourceAllowed ? diaryLifecycle : null}
          <div className="callout core-care-callout"><ShieldCheck aria-hidden="true" /><span>更新於 {generatedAt}；週表、單日調整與實到共同決定本日名單。請假、未到或未排服務不列照顧待填；既有紀錄仍保留。缺少安排時列待確認，當班項目請看「今日工作」。</span></div>
          {!canWrite ? <p className="callout core-care-callout" role="status">目前僅可查看；新增紀錄需要對應權限及身分驗證。補登與簽署另有驗證及覆核要求。</p> : null}

          {metrics.length ? <section aria-label="本頁摘要" className="metric-grid core-care-metrics">
            {metrics.map((metric, index) => (
              <article className="metric-card" key={metric.label}>
                <div className="metric-card__top"><span>{metric.label}</span><span className="metric-card__icon">{index === 0 ? <Database aria-hidden="true" /> : index === 1 ? <HeartPulse aria-hidden="true" /> : index === 2 ? <Clock3 aria-hidden="true" /> : <CheckCircle2 aria-hidden="true" />}</span></div>
                <div className="metric-card__value"><strong>{metric.value}</strong><span>{metric.unit}</span></div>
                <p className="metric-card__foot">{metric.foot}</p>
              </article>
            ))}
          </section> : null}

          {!invalidSelection && pageSourceAllowed ? <section className="panel">
            <div className="panel__header">
              <div className="panel__title"><h2>{selectedClient ? `${selectedClient.displayName}的${page.number === 3 ? "量測" : page.number === 6 ? "日誌" : "出勤"}紀錄` : "當日個案工作清單"}</h2><p>{snapshot.serviceDate} · {recordClients.length} 位{selectedClient ? "已選定" : "可存取"}個案{selectedShift ? " · 下方為當日紀錄，班別完成狀態請回今日工作確認" : ""}</p></div>
              {!selectedClient ? <p>請先在上方選定個案，再新增紀錄。</p> : null}
            </div>
            {recordClients.length ? (
              <>
                <div className="table-wrap core-care-table">
                  <table className="data-table"><thead><tr>{tableHeadings(page).map((heading) => <th key={heading} scope="col">{heading}</th>)}</tr></thead><tbody><DesktopRows clients={recordClients} page={page} sourceAccess={snapshot.sourceAccess} /></tbody></table>
                </div>
                <div className="mobile-records core-care-mobile">
                  {recordClients.map((client) => (
                    <article className="record-card" key={client.clientId}>
                      <div className="record-card__top"><div><h3>{client.displayName}</h3><span className="data-table__secondary">{client.clientCode} · {applicabilityLabel(client)}</span></div><StatusPill status={page.number === 46 ? attendanceLabel(client) : page.number === 6 ? diaryLabel(client) : vitalLabel(client)} /></div>
                      {page.number === 46 ? (
                        <dl className="core-care-card-grid">
                          <div><dt>簽到</dt><dd>{formatTime(client.attendance?.checkedInAt ?? null)}</dd></div>
                          <div><dt>簽退</dt><dd>{formatTime(client.attendance?.checkedOutAt ?? null)}</dd></div>
                          <div><dt>服務時數</dt><dd>{attendanceDuration(client)}</dd></div>
                          <div><dt>登錄方式</dt><dd>{attendanceSourceLabel(client.attendance?.source)}</dd></div>
                        </dl>
                      ) : page.number === 3 ? (
                        <dl className="core-care-card-grid">
                          <div><dt>血壓 mmHg</dt><dd>{client.vitalSigns ? `${client.vitalSigns.systolic ?? "—"}/${client.vitalSigns.diastolic ?? "—"}` : "—"}</dd></div>
                          <div><dt>脈搏 bpm</dt><dd>{client.vitalSigns?.pulse ?? "—"}</dd></div>
                          <div><dt>體溫 °C</dt><dd>{client.vitalSigns?.temperature?.toFixed(1) ?? "—"}</dd></div>
                          <div><dt>血氧 %</dt><dd>{client.vitalSigns?.oxygenSaturation ?? "—"}</dd></div>
                          <div><dt>最近量測</dt><dd>{formatTime(client.vitalSigns?.measuredAt ?? null)}</dd></div>
                        </dl>
                      ) : (
                        <dl className="core-care-card-grid">
                          <div><dt>簽到</dt><dd>{snapshot.sourceAccess.attendance ? formatTime(client.attendance?.checkedInAt ?? null) : "無查閱權限"}</dd></div>
                          <div><dt>最近量測</dt><dd>{snapshot.sourceAccess.measurements ? formatTime(client.vitalSigns?.measuredAt ?? null) : "無查閱權限"}</dd></div>
                          <div><dt>照顧日誌</dt><dd>{diaryLabel(client)}</dd></div>
                          <div><dt>完成服務</dt><dd>{snapshot.sourceAccess.serviceEvents ? `${client.completedServiceCount} 筆` : "無查閱權限"}</dd></div>
                        </dl>
                      )}
                    </article>
                  ))}
                </div>
              </>
            ) : (
              <div className="panel__body"><section className="empty-card core-care-state"><Database aria-hidden="true" /><h2>這個服務日沒有可存取個案</h2><p>請確認分支、指派範圍與收案狀態；系統不會自動改查其他分支。</p></section></div>
            )}
          </section> : !invalidSelection && snapshot.sourceAccess.clients ? <section className="empty-card core-care-state" role="status"><ShieldCheck aria-hidden="true" /><h2>目前沒有本頁資料查看權限</h2><p>請聯絡主管確認權限。未取得的資料不會顯示成 0 或標示完成。</p></section> : null}
          <details className="panel"><summary>查看身分驗證與資料規則</summary><div className="panel__body"><p>新增仍須具備對應寫入權限及身分驗證；補登、簽署等重要操作另須最近 15 分鐘重新驗證與適用覆核。無查閱權限不代表沒有紀錄，尚未發布的分母或異常門檻不會自行推算。</p>
            {canViewManagementDetails ? <><p>{page.description}</p><p>來源更新時間：{snapshot.generatedAt}；同一服務日資料不等於已完成簽署或正式申報。</p></> : null}
          </div></details>
        </>
      ) : null}
    </>
  );
}
