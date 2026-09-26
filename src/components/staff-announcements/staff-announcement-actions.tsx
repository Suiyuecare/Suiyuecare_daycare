"use client";

import { useId } from "react";
import { defaultTaipeiLocal } from "@/lib/staff-announcements/date";
import type { StaffAnnouncementAudienceRole, StaffAnnouncementAudienceStaff, StaffAnnouncementItem } from "@/lib/staff-announcements/types";
import { useStaffAnnouncementController } from "./staff-announcement-controller";
import styles from "./staff-announcements.module.css";

type Action = "draft" | "publish" | "withdraw" | "read";
function Trigger({ action, item, label, reason = "" }: { action: Action; item?: StaffAnnouncementItem; label: string; reason?: string }) {
  const controller = useStaffAnnouncementController();
  const id = useId();
  const unavailable = reason || (controller ? controller.disabledReason(action, item) : "公告操作尚未就緒，請重新載入。");
  return <span className={styles.actionBox}>
    <button aria-describedby={unavailable ? id : undefined} className="button button--secondary" disabled={!!unavailable}
      onClick={(event) => controller?.open(action, item, event.currentTarget)} type="button">{label}</button>
    {unavailable && <small className={reason ? undefined : "sr-only"} id={id}>{unavailable}</small>}
  </span>;
}
export function StaffAnnouncementDraftAction({ item, canManage, demo }: {
  item?: StaffAnnouncementItem; staff: readonly StaffAnnouncementAudienceStaff[]; roles: readonly StaffAnnouncementAudienceRole[];
  canManage: boolean; demo: boolean;
}) {
  return <Trigger action="draft" item={item} label={item ? "建立新版" : "建立公告"}
    reason={demo ? "展示模式不會寫入公告。" : !canManage ? "需要公告管理權限。" : ""} />;
}
export function StaffAnnouncementPublishAction({ item, canPublish, hasRecentAal2, demo }: {
  item: StaffAnnouncementItem; canPublish: boolean; hasRecentAal2: boolean; demo: boolean; generatedAt: string;
}) {
  return <Trigger action="publish" item={item} label="發布公告" reason={demo ? "展示模式不會發布公告。"
    : !canPublish ? "需要公告發布權限。" : !hasRecentAal2 ? "請先完成最近 15 分鐘內的重新驗證。"
      : item.versionState !== "draft" ? "只有草稿可以發布。" : ""} />;
}
export function StaffAnnouncementWithdrawAction({ item, canPublish, hasRecentAal2, demo }: {
  item: StaffAnnouncementItem; canPublish: boolean; hasRecentAal2: boolean; demo: boolean; generatedAt: string;
}) {
  return <Trigger action="withdraw" item={item} label="撤回公告" reason={demo ? "展示模式不會撤回公告。"
    : !canPublish ? "需要公告發布權限。" : !hasRecentAal2 ? "請先完成最近 15 分鐘內的重新驗證。"
      : !item.activeReleaseVersionId || item.lifecycle === "withdrawn" ? "沒有可撤回的發布版本。" : ""} />;
}
export function StaffAnnouncementReadAction({ item, enabled, demo }: { item: StaffAnnouncementItem; enabled: boolean; demo: boolean }) {
  if (item.actorReadAt) return <span className="status-pill status-pill--success">已讀</span>;
  return <Trigger action="read" item={item} label={item.lifecycle === "expired" ? "補記歷史已讀" : "標為已讀"}
    reason={demo ? "展示模式不會寫入已讀紀錄。" : !enabled || !item.actorIsRecipient || !item.activeReleaseVersionId
      ? "僅公告收件人可以標為已讀。" : ""} />;
}
export const staffAnnouncementDefaultTaipeiLocal = defaultTaipeiLocal;
export type { StaffAnnouncementMutationInput } from "@/lib/staff-announcements/types";
