import type { MnaAssessmentListItem, MnaAssessmentSnapshot } from
  "@/lib/mna-assessments/types";

import styles from "./mna-assessments.module.css";

export function MnaAssessmentActions({
  canManage,
  hasRecentAal2,
  item,
  snapshot,
}: {
  canManage: boolean;
  hasRecentAal2: boolean;
  item: MnaAssessmentListItem;
  snapshot: MnaAssessmentSnapshot;
}) {
  const reason = snapshot.demo
    ? "合成展示唯讀"
    : !canManage
      ? "目前只有查看權限"
      : !hasRecentAal2
        ? "需最近 15 分鐘 AAL2"
        : "授權與電子實作未配置";
  return <div className={styles.actions} aria-label={`${item.clientDisplayName}操作`}
    role="group">
    <button className="button button--quiet" disabled type="button">
      建立草稿（{reason}）
    </button>
    <button className="button button--quiet" disabled type="button">
      正式簽署（授權未配置）
    </button>
    <button className="button button--quiet" disabled type="button">
      建立更正版（授權未配置）
    </button>
  </div>;
}
