import type { DailyCareSnapshot } from "./types";

export type WorkFilter = "pending" | "all" | "attendance" | "measurements" | "diary" | "attention";
export type WorkTask = Exclude<WorkFilter, "pending" | "all">;
export type TodayWorkRow = {
  id: string; code: string; name: string;
  attendance: string; measurements: string; diary: string;
  tasks: WorkTask[]; nextPage: 46 | 3 | 6 | null; nextLabel: string;
};

/** Review queue, not a schedule, diagnosis, or proof of completed service. */
export function buildTodayWorkRows(snapshot: DailyCareSnapshot): TodayWorkRow[] {
  const access = snapshot.sourceAccess;
  if (!access.clients) return [];
  return snapshot.clients.map((client): TodayWorkRow => {
    const attendance = access.attendance ? client.attendance : null;
    const vital = access.measurements ? client.vitalSigns : null;
    const diary = access.careDiaries ? client.careDiary : null;
    const offDay = attendance && ["leave", "absent", "cancelled"].includes(attendance.status);
    const tasks: WorkTask[] = [];
    if (access.careDiaries && diary?.hasAbnormalFlag) tasks.push("attention");
    if (access.attendance && !attendance) tasks.push("attendance");
    if (access.measurements && !vital && !offDay) tasks.push("measurements");
    if (access.careDiaries && ((!diary && !offDay) || (diary && ["draft", "submitted", "voided"].includes(diary.status)))) tasks.push("diary");
    const first = tasks[0];
    const nextPage = first === "attention" || first === "diary" ? 6
      : first === "attendance" ? 46 : first === "measurements" ? 3
        : access.attendance ? 46 : access.measurements ? 3 : access.careDiaries ? 6 : null;
    return {
      id: client.clientId, code: client.clientCode, name: client.displayName, tasks, nextPage,
      nextLabel: first === "attention" ? "查看需留意紀錄" : first === "attendance" ? "確認出勤"
        : first === "measurements" ? "前往量測" : first === "diary" ? "接續照顧日誌" : "查看紀錄",
      attendance: !access.attendance ? "無查閱權限" : !attendance ? "尚無出勤"
        : attendance.status === "present" ? attendance.checkedOutAt ? "已簽退" : "已簽到"
          : { absent: "未到", leave: "請假", cancelled: "已取消" }[attendance.status],
      measurements: !access.measurements ? "無查閱權限" : vital ? "已有量測" : offDay ? "未到／請假，無量測" : "尚無量測",
      diary: !access.careDiaries ? "無查閱權限" : !diary ? offDay ? "未到／請假，無日誌" : "尚無日誌"
        : { draft: "草稿待完成", submitted: "待簽署", signed: "已簽署", corrected: "已更正", voided: "已作廢" }[diary.status],
    };
  }).sort((a, b) => Number(b.tasks.includes("attention")) - Number(a.tasks.includes("attention"))
    || Number(b.tasks.length > 0) - Number(a.tasks.length > 0) || a.code.localeCompare(b.code));
}

export function filterTodayWorkRows(rows: readonly TodayWorkRow[], filter: WorkFilter, search = "") {
  const query = search.trim().toLocaleLowerCase("zh-TW");
  return rows.filter((row) => (filter === "all" || (filter === "pending" ? row.tasks.length > 0 : row.tasks.includes(filter)))
    && (!query || `${row.name} ${row.code}`.toLocaleLowerCase("zh-TW").includes(query)));
}

export function todayWorkAction(row: TodayWorkRow, filter: WorkFilter) {
  if (filter === "attendance") return { page: 46 as const, label: "確認出勤" };
  if (filter === "measurements") return { page: 3 as const, label: "前往量測" };
  if (filter === "diary") return { page: 6 as const, label: "接續照顧日誌" };
  if (filter === "attention") return { page: 6 as const, label: "查看需留意紀錄" };
  return { page: row.nextPage, label: row.nextLabel };
}
