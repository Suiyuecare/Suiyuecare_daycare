import {
  ArrowRight,
  Bus,
  ClipboardCheck,
  HeartPulse,
  TriangleAlert,
  UsersRound,
} from "lucide-react";
import Link from "next/link";

import type { DailyCareSnapshot } from "@/lib/core-care/types";

import { DashboardAutoRefresh } from "./dashboard-auto-refresh";

function formatTime(value: string) {
  return new Intl.DateTimeFormat("zh-TW", {
    timeZone: "Asia/Taipei",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(new Date(value));
}

export function DashboardWorkspace({
  snapshot,
  serviceDate,
  loadError = false,
}: {
  snapshot: DailyCareSnapshot | null;
  serviceDate: string;
  loadError?: boolean;
}) {
  const todayLabel = new Intl.DateTimeFormat("zh-TW", {
    timeZone: "Asia/Taipei",
    month: "long",
    day: "numeric",
    weekday: "long",
  }).format(new Date(`${serviceDate}T12:00:00+08:00`));

  if (loadError || !snapshot) {
    return (
      <section className="empty-card core-care-state" role="alert">
        <span className="empty-card__icon empty-card__icon--warning"><TriangleAlert aria-hidden="true" /></span>
        <p className="eyebrow">資料未替換</p>
        <h1>今日工作快照暫時無法載入</h1>
        <p>系統不會顯示展示數字或過期快取代替正式資料。請稍後重新載入。</p>
        <a className="button button--secondary" href={`?date=${serviceDate}`}>重新載入</a>
      </section>
    );
  }

  const access = snapshot.sourceAccess;
  const abnormalCount = snapshot.clients.filter(
    (client) => client.careDiary?.hasAbnormalFlag,
  ).length;
  const attendanceMissing = access.attendance
    ? snapshot.clients.filter((client) => !client.attendance).length
    : null;
  const measurementMissing = access.measurements
    ? snapshot.clients.filter((client) => !client.vitalSigns).length
    : null;
  const diaryDrafts = access.careDiaries
    ? snapshot.clients.filter((client) => client.careDiary?.status === "draft").length
    : null;

  const metrics = [
    {
      label: "今日出勤",
      value: access.attendance ? String(snapshot.sourceCounts.attendanceRecords) : "—",
      unit: access.attendance ? "筆" : "",
      foot: access.attendance ? `${attendanceMissing} 位尚無紀錄` : "目前角色無出勤查閱權限",
      href: `/app/staff/service-management/attendance?date=${serviceDate}`,
      icon: UsersRound,
    },
    {
      label: "量測個案",
      value: access.measurements ? String(snapshot.sourceCounts.clientsWithMeasurements) : "—",
      unit: access.measurements ? "人" : "",
      foot: access.measurements ? `${measurementMissing} 位尚無量測` : "目前角色無健康資料權限",
      href: `/app/staff/daily-care/vital-signs?date=${serviceDate}`,
      icon: HeartPulse,
    },
    {
      label: "照顧日誌",
      value: access.careDiaries ? String(snapshot.sourceCounts.careDiaryRecords) : "—",
      unit: access.careDiaries ? "筆" : "",
      foot: access.careDiaries ? `${diaryDrafts} 筆仍為草稿` : "目前角色無照顧紀錄權限",
      href: `/app/staff/daily-care/care-diary?date=${serviceDate}`,
      icon: ClipboardCheck,
    },
    {
      label: "需留意",
      value: access.careDiaries ? String(abnormalCount) : "—",
      unit: access.careDiaries ? "件" : "",
      foot: access.careDiaries ? "僅計已保存異常旗標" : "目前角色無照顧紀錄權限",
      href: `/app/staff/service-management/daily-summary?date=${serviceDate}`,
      icon: TriangleAlert,
    },
  ];

  const tasks = [
    attendanceMissing && attendanceMissing > 0
      ? { title: "確認尚無出勤紀錄", meta: `${attendanceMissing} 位個案・不自動判定缺勤`, href: `/app/staff/service-management/attendance?date=${serviceDate}` }
      : null,
    measurementMissing && measurementMissing > 0
      ? { title: "完成尚缺量測", meta: `${measurementMissing} 位個案・缺值不計為 0`, href: `/app/staff/daily-care/vital-signs?date=${serviceDate}` }
      : null,
    diaryDrafts && diaryDrafts > 0
      ? { title: "檢查照顧日誌草稿", meta: `${diaryDrafts} 筆草稿・尚未簽署`, href: `/app/staff/daily-care/care-diary?date=${serviceDate}` }
      : null,
    abnormalCount > 0
      ? { title: "處理照顧異常旗標", meta: `${abnormalCount} 件需留意・請回來源確認`, href: `/app/staff/service-management/daily-summary?date=${serviceDate}` }
      : null,
  ].filter((task): task is NonNullable<typeof task> => Boolean(task));

  return (
    <>
      <nav aria-label="所在位置" className="context-bar"><span>工作台</span><span aria-hidden="true">／</span><span aria-current="page" className="context-bar__crumb">今日總覽</span></nav>
      <header className="page-heading"><div><p className="eyebrow">{todayLabel}・資料快照 {formatTime(snapshot.generatedAt)}</p><h1>今天的照顧工作，一眼掌握。</h1><p className="page-heading__description">每張卡片都連回相同日期與資料來源；沒有權限的來源顯示為無權限，不會以 0 冒充。頁面在前景且連線正常時，會在 60 秒內重新取得資料。</p></div><div className="page-heading__actions"><DashboardAutoRefresh generatedAt={snapshot.generatedAt} key={snapshot.generatedAt} /><Link className="button button--primary" href="/app/staff/workspace/case-center">前往個案中心<ArrowRight aria-hidden="true" /></Link></div></header>
      <section className="metric-grid" aria-label="今日摘要">
        {metrics.map((metric) => { const Icon = metric.icon; return <Link className="metric-card" href={metric.href} key={metric.label}><div className="metric-card__top"><span>{metric.label}</span><span className="metric-card__icon"><Icon aria-hidden="true" /></span></div><div className="metric-card__value"><strong>{metric.value}</strong><span>{metric.unit}</span></div><p className="metric-card__foot">{metric.foot}</p></Link>; })}
      </section>
      <section className="content-grid">
        <div className="panel"><div className="panel__header"><div className="panel__title"><h2>今日工作節奏</h2><p>只顯示目前可查閱來源形成的待辦</p></div><Link className="button button--quiet" href={`/app/staff/service-management/daily-summary?date=${serviceDate}`}>查看彙整</Link></div><div className="panel__body">{tasks.length ? <ul className="task-list">{tasks.map((task, index) => <li className="task-item" key={task.title}><span className="task-item__icon">{index % 2 ? <HeartPulse aria-hidden="true" /> : <ClipboardCheck aria-hidden="true" />}</span><span><strong>{task.title}</strong><small>{task.meta}</small></span><Link aria-label={`前往${task.title}`} className="icon-button" href={task.href}><ArrowRight aria-hidden="true" /></Link></li>)}</ul> : <div className="callout"><ClipboardCheck aria-hidden="true" /><span>目前可查閱的資料來源沒有形成待處理項目；這不代表尚未接入的交通、餐食或規則來源已完成。</span></div>}</div></div>
        <aside className="panel"><div className="panel__header"><div className="panel__title"><h2>來源邊界</h2><p>未接入項目不計入完成率</p></div><Bus aria-hidden="true" /></div><div className="panel__body"><div className="callout"><TriangleAlert aria-hidden="true" /><span>交通、餐食、活動排程及正式異常門檻尚未接入本批次快照，因此不顯示推算數字。</span></div><ul className="acceptance-list"><li>出勤、量測、日誌與每日彙整使用同一服務日</li><li>沒有權限時顯示「—」而不是 0</li><li>草稿與簽署完成狀態分開計算</li></ul></div></aside>
      </section>
    </>
  );
}
