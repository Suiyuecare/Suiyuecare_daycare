"use client";

import { useEffect, useId, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, CheckCircle2, ClipboardList, RefreshCw, ShieldCheck } from "lucide-react";
import type { OpeningReadinessSnapshot, OpeningReadinessStatus } from "@/lib/opening-readiness/types";
import { formatCareTaipeiTime } from "@/lib/core-care/date";
import { NavigationLink } from "@/components/app/navigation-link";
import styles from "./opening-readiness.module.css";

const labels: Record<OpeningReadinessStatus, string> = {
  ready: "已核對基本資料", needs_attention: "需要補齊", unavailable: "目前無法核對", manual_review: "待負責人核對",
};

export function OpeningReadinessWorkspace({ snapshot, compact = false }: {
  snapshot: OpeningReadinessSnapshot;
  compact?: boolean;
}) {
  const headingId = useId();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [offline, setOffline] = useState(false);
  const [stale, setStale] = useState(false);
  const deadline = snapshot.status === "forbidden" ? null : snapshot.staleAfter;
  useEffect(() => {
    const update = () => { setOffline(!navigator.onLine); setStale(Boolean(deadline && Date.parse(deadline) <= Date.now())); };
    update();
    const timer = window.setInterval(update, 5_000);
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => { window.clearInterval(timer); window.removeEventListener("online", update); window.removeEventListener("offline", update); };
  }, [deadline]);

  if (snapshot.status === "forbidden") return <section className={styles.workspace} aria-labelledby={headingId}>
    <h2 id={headingId}>準備清單限獲授權的管理員查看</h2>
    <p>未載入機構、員工或個案準備資料。請回到自己的今日工作。</p>
    <NavigationLink href="/app/staff/workspace/dashboard" loadingLabel="今日工作" className="button button--secondary">返回今日工作</NavigationLink>
  </section>;

  const next = snapshot.items.find((item) => item.status === "needs_attention") ??
    snapshot.items.find((item) => item.status === "unavailable") ?? snapshot.items.find((item) => item.status === "manual_review");
  const refresh = () => startTransition(() => router.refresh());
  const remaining = snapshot.counts.needs_attention + snapshot.counts.unavailable + snapshot.counts.manual_review;
  return <section className={styles.workspace} aria-labelledby={headingId} aria-busy={pending}>
    <header className={styles.header}>
      <div><p className="eyebrow">主管準備清單</p><h2 id={headingId}>今天開始服務前，先把缺項補齊</h2>
        <p>{snapshot.scope.branchName} · {snapshot.serviceDate}（台北日期）</p></div>
      <button type="button" onClick={refresh} disabled={pending || offline} className="button button--secondary">
        <RefreshCw size={18} aria-hidden="true" />{pending ? "正在重新核對" : "重新檢查"}
      </button>
    </header>
    {snapshot.demo ? <p className={styles.notice} role="note">展示模式：以下為合成資料，只示範準備流程，不是正式資料或上線驗收結果。</p> : null}
    <p className={styles.safety} role="note"><ShieldCheck size={20} aria-hidden="true" />
      尚未核准完整上線或新增真實資料。基本資料齊全，不代表資格、安全審查與備援已驗收。</p>
    <div className={styles.feedback} role="status" aria-live="polite">
      {offline ? "目前離線：保留上次檢查結果，不能視為最新；連線後請重新檢查。" : pending ? "正在核對目前分支資料，請稍候。" : stale ? "檢查結果已超過一分鐘，請重新檢查後再安排工作。" : snapshot.status === "unavailable" ? "部分資料目前無法核對；不會把讀取失敗當成零筆資料或已完成。" : `還有 ${remaining} 項需要處理或確認。`}
    </div>
    <dl className={styles.metrics} aria-label="準備狀態統計">
      {(Object.keys(labels) as OpeningReadinessStatus[]).map((status) => <div key={status}>
        <dt>{labels[status]}</dt><dd>{snapshot.counts[status]} 項</dd>
      </div>)}
    </dl>
    {compact ? <div className={styles.next}>
      <ClipboardList size={22} aria-hidden="true" /><div><h3>接下來：{next?.title ?? "確認準備證據"}</h3>
        <p>{next?.summary}</p><NavigationLink className="button button--secondary" loadingLabel="完整準備清單" href={`/app/staff/operations/organization?effectiveOn=${snapshot.serviceDate}#opening-readiness`}>查看完整準備清單</NavigationLink>
      </div>
    </div> : <ol className={styles.list}>
      {snapshot.items.map((item, index) => <li key={item.id} className={styles.item}>
        <div className={styles.number} aria-hidden="true">{String(index + 1).padStart(2, "0")}</div>
        <div className={styles.content}><div className={styles.itemHeading}><h3>{item.title}</h3>
          <span className={styles.badge} data-status={item.status}>
            {item.status === "ready" ? <CheckCircle2 size={16} aria-hidden="true" /> : <AlertTriangle size={16} aria-hidden="true" />}{labels[item.status]}</span>
        </div><p>{item.summary}</p><p className={styles.owner}>負責：{item.owner}</p>
          <details><summary>這項檢查的依據</summary><p>{item.sourceLabel}。目前僅列出可核對的事實；沒有勾選即可通過的捷徑。</p></details>
        </div>
        <NavigationLink href={item.href} loadingLabel={item.title} className="button button--secondary">{item.actionLabel}</NavigationLink>
      </li>)}
    </ol>}
    <footer className={styles.footer}><time dateTime={snapshot.generatedAt}>檢查時間：{formatCareTaipeiTime(snapshot.generatedAt)}</time>
      <span>範圍固定為目前分支；切換分支後須重新核對。</span></footer>
  </section>;
}
