"use client";

import { useEffect, useState } from "react";
import type { SocialWorkRecordSnapshot, SocialWorkServiceRecord } from "@/lib/social-work-records/types";
import { socialWorkLabels, useSocialWorkController, type SocialWorkAction } from "./social-work-record-controller";
import styles from "./social-work-records.module.css";

export function SocialWorkRecordFreshness({ demo, staleAfter }: { demo: boolean; staleAfter: string }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const timer = window.setInterval(() => setNow(Date.now()), 1000); return () => window.clearInterval(timer); }, []);
  return <span className={now >= Date.parse(staleAfter) ? styles.stale : undefined}>{demo ? "展示資料" : now >= Date.parse(staleAfter) ? "快照已過期，請重新載入" : "正式快照"}</span>;
}
export function NewSocialWorkRecordForm({ canManage, snapshot }: { canManage: boolean; snapshot: SocialWorkRecordSnapshot }) {
  const controller = useSocialWorkController();
  return <button className="button button--primary" disabled={!canManage || snapshot.demo || !controller || controller.unavailable("create_draft")} onClick={(event) => controller?.open("create_draft", undefined, event.currentTarget)}>新增服務草稿</button>;
}
export function SocialWorkRecordActions({ canManage, canSign, hasRecentAal2, record, snapshot }: { canManage: boolean; canSign: boolean; hasRecentAal2: boolean; record: SocialWorkServiceRecord; snapshot: SocialWorkRecordSnapshot }) {
  const controller = useSocialWorkController(); const actions: SocialWorkAction[] = [];
  if (record.recordState === "draft") { if (canManage) actions.push("revise_draft"); if (canSign) actions.push("sign"); }
  else { if (canSign) actions.push("correct"); if (canManage) { if (record.followUpStatus === "pending") actions.push("complete_follow_up", "cancel_follow_up"); else actions.push("track"); } }
  return <div className={styles.actions}>
    {actions.map((action) => <button className="button button--secondary" key={action} disabled={snapshot.demo || !controller || controller.unavailable(action, record)} onClick={(event) => controller?.open(action, record, event.currentTarget)}>{socialWorkLabels[action]}</button>)}
    {!canManage && !canSign && <span className={styles.readOnly}>目前唯讀</span>}
    {canSign && !hasRecentAal2 && <small className={styles.readOnly}>簽署與更正須先完成近期身分驗證。</small>}
  </div>;
}
