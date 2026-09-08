import { ArrowRight, Bus, CalendarDays, CheckCircle2, FileText, HeartHandshake, HeartPulse, MessageCircleMore } from "lucide-react";
import Link from "next/link";

import type { FamilyPortalSnapshot } from "@/lib/family/snapshot";

const cards = [
  { title: "今天已到中心", description: "08:17 完成簽到・上午活動進行中", href: "/family/schedule", icon: CheckCircle2 },
  { title: "返家接送", description: "預計 16:20 發車・第 2 趟車", href: "/family/schedule", icon: Bus },
  { title: "今日照顧摘要", description: "上午生命徵象已量測，用藥已完成", href: "/family/care-summary", icon: HeartPulse },
  { title: "機構新訊息", description: "1 則訊息待您確認", href: "/family/communication", icon: MessageCircleMore },
  { title: "下次活動", description: "9 月 3 日・懷舊音樂活動", href: "/family/schedule", icon: CalendarDays },
  { title: "帳單與文件", description: "8 月帳單已發布・目前無逾期", href: "/family/billing-documents", icon: FileText },
] as const;

export function FamilyHome({ branchName, demo, snapshot }: { branchName: string; demo: boolean; snapshot: FamilyPortalSnapshot | null }) {
  const today = new Intl.DateTimeFormat("zh-TW", { timeZone: "Asia/Taipei", day: "numeric" }).format(new Date());
  const monthAndWeekday = new Intl.DateTimeFormat("zh-TW", { timeZone: "Asia/Taipei", month: "short", weekday: "short" }).format(new Date());
  if (!demo && !snapshot) {
    return <section className="empty-card"><HeartHandshake aria-hidden="true" /><h1>目前沒有可顯示的授權個案</h1><p>請由機構確認個案關係、資料類別與授權有效期限；系統不會顯示未授權資料。</p></section>;
  }
  if (!demo && snapshot?.state === "selection_required") {
    return <section className="empty-card"><HeartHandshake aria-hidden="true" /><h1>請選擇要查看的個案</h1><p>您的帳號獲授權查看多位個案；系統不會自行猜測或混合資料。</p><div className="page-heading__actions">{snapshot.authorizedClients.map((client) => <Link className="button button--secondary" href={`/family/home?client=${encodeURIComponent(client.clientId)}`} key={client.clientId}>{client.clientName}</Link>)}</div></section>;
  }
  const ready = !demo && snapshot?.state === "ready" ? snapshot : null;
  const clientName = demo ? "陳O華" : ready!.clientName;
  const attendanceText = demo
    ? "08:17 完成簽到・上午活動進行中"
    : "今日尚無已公開出勤資料";
  const careText = demo
    ? "上午生命徵象已量測，用藥已完成"
    : "照顧資料公開流程尚未配置；目前沒有經核准公開的摘要";
  const visibleCards = cards.map((card) =>
    card.title === "今天已到中心"
      ? { ...card, title: demo ? card.title : "今日出勤", icon: demo ? card.icon : CalendarDays, description: attendanceText }
      : card.title === "今日照顧摘要"
        ? { ...card, description: careText }
        : demo
          ? card
          : { ...card, description: "目前沒有經核准公開的新資料" },
  ).map((card) => ready
    ? { ...card, href: `${card.href}?client=${encodeURIComponent(ready.clientId)}` }
    : card);
  return (
    <>
      <section className="family-hero"><div><p className="eyebrow eyebrow--light">{clientName}的今日照顧</p><h1>{demo ? "今天一切平安，下午會再更新返家時間。" : "照顧資料公開流程尚未配置，這裡尚無照顧摘要。"}</h1><p>{demo ? "最近更新：上午 10:24" : "目前僅確認個案識別授權；尚無已發布資料更新時間"}・機構：{branchName}</p></div><span className="family-hero__date"><strong>{today}</strong><span>{monthAndWeekday}</span></span></section>
      <section className="family-grid" aria-label="今日摘要">
        {visibleCards.map(({ title, description, href, icon: Icon }) => <Link className="family-card" href={href} prefetch={false} key={title}><span className="metric-card__icon"><Icon aria-hidden="true" /></span><h2>{title}</h2><p>{description}</p><span className="record-card__action">查看詳情<ArrowRight aria-hidden="true" /></span></Link>)}
      </section>
    </>
  );
}
