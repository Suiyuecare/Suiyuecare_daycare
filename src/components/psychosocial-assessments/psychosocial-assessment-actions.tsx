"use client";

import { useEffect, useState } from "react";
import type { PsychosocialAssessmentListItem, PsychosocialAssessmentSnapshot } from "@/lib/psychosocial-assessments/types";
import { usePsychosocialAssessmentController } from "./psychosocial-assessment-controller";
import styles from "./psychosocial-assessments.module.css";

export function PsychosocialAssessmentActions({ canManage, canSign, hasRecentAal2, item, snapshot }: {
  canManage: boolean; canSign: boolean; hasRecentAal2: boolean;
  item: PsychosocialAssessmentListItem; snapshot: PsychosocialAssessmentSnapshot;
}) {
  const controller = usePsychosocialAssessmentController();
  if (snapshot.demo) return <button className="button button--secondary" disabled type="button">正式操作（展示唯讀）</button>;
  const actions = ["create_draft", ...(item.recordState === "draft" ? ["revise_draft", "sign"] : item.recordState ? ["correct"] : [])] as const;
  const labels = { create_draft: "快速新增評估草稿", revise_draft: "建立草稿新版", sign: "簽署評估", correct: "建立更正版" };
  return <div className={styles.actions}>{actions.map((value) => {
    const action = value as keyof typeof labels;
    const signing = action === "sign" || action === "correct";
    return <button className="button button--secondary" type="button" key={action}
      disabled={!controller || controller.unavailable(action, item) || (signing ? !canSign || !hasRecentAal2 : !canManage)}
      onClick={(event) => controller?.open(action, item, event.currentTarget)}>{labels[action]}</button>;
  })}</div>;
}

export function PsychosocialAssessmentFreshness({ demo, staleAfter }: { demo: boolean; staleAfter: string }) {
  const [observedAt, setObservedAt] = useState(() => Date.now());
  useEffect(() => {
    if (demo) return;
    const timer = window.setTimeout(() => setObservedAt(Date.now()), Math.max(0, Date.parse(staleAfter) - Date.now()));
    return () => window.clearTimeout(timer);
  }, [demo, staleAfter]);
  if (demo) return <span>合成展示快照</span>;
  return observedAt >= Date.parse(staleAfter)
    ? <span className={styles.stale} role="status">資料已過期，請重新載入</span> : <span>資料為目前快照</span>;
}
