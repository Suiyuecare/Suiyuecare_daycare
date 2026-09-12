import type { DailyCareSnapshot } from "./types";
import type { CareRosterSnapshot, CareRosterAssignment, RosterShift } from "@/lib/care-roster/types";

export type WorkFilter = "pending" | "all" | "attendance" | "measurements" | "diary" | "attention";
export type WorkTask = Exclude<WorkFilter, "pending" | "all">;
export type TodayWorkRow = {
  id: string; code: string; name: string;
  attendance: string; measurements: string; diary: string;
  tasks: WorkTask[]; nextPage: 46 | 3 | 6 | null; nextLabel: string;
  plannedShifts?: CareRosterAssignment[];
};

/** Review queue, not a schedule, diagnosis, or proof of completed service. */
export function buildTodayWorkRows(snapshot: DailyCareSnapshot, roster?: CareRosterSnapshot): TodayWorkRow[] {
  const access = snapshot.sourceAccess;
  if (!access.clients) return [];
  const planned = roster?.status === "ready" ? roster.assignments.filter((row) => row.state === "scheduled") : null;
  return snapshot.clients.filter((client) => !planned || planned.some((row) => row.clientId === client.clientId)).map((client): TodayWorkRow => {
    const plannedShifts = planned?.filter((row) => row.clientId === client.clientId).map((slot) => ({ ...slot,
      tasks: slot.tasks.map((task) => (task.kind === "care_diary" ? access.careDiaries : access.measurements)
        ? task : { ...task, status: "restricted" as const, evidenceAt: null }),
    }));
    const attendance = access.attendance ? client.attendance : null;
    const vital = access.measurements ? client.vitalSigns : null;
    const diary = access.careDiaries ? client.careDiary : null;
    const offDay = attendance && ["leave", "absent", "cancelled"].includes(attendance.status);
    const tasks: WorkTask[] = [];
    if (access.careDiaries && diary?.hasAbnormalFlag) tasks.push("attention");
    if (access.attendance && !attendance) tasks.push("attendance");
    const plannedMeasurements = plannedShifts?.flatMap((row) => row.tasks.filter((task) => task.kind !== "care_diary"));
    const plannedDiaries = plannedShifts?.flatMap((row) => row.tasks.filter((task) => task.kind === "care_diary"));
    if (access.measurements && !offDay && (plannedMeasurements ? plannedMeasurements.some((task) => task.status === "pending") : !vital)) tasks.push("measurements");
    if (access.careDiaries && ((!offDay && (plannedDiaries ? plannedDiaries.some((task) => task.status === "pending") : !diary)) || (diary && ["draft", "submitted", "voided"].includes(diary.status)))) tasks.push("diary");
    const first = tasks[0];
    const nextPage = first === "attention" || first === "diary" ? 6
      : first === "attendance" ? 46 : first === "measurements" ? 3
        : access.attendance ? 46 : access.measurements ? 3 : access.careDiaries ? 6 : null;
    return {
      id: client.clientId, code: client.clientCode, name: client.displayName, tasks, nextPage,
      ...(plannedShifts ? { plannedShifts } : {}),
      nextLabel: first === "attention" ? "查看需留意紀錄" : first === "attendance" ? "確認出勤"
        : first === "measurements" ? "前往量測" : first === "diary" ? "接續照顧日誌" : "查看紀錄",
      attendance: !access.attendance ? "無查閱權限" : !attendance ? "尚無出勤"
        : attendance.status === "present" ? attendance.checkedOutAt ? "已簽退" : "已簽到"
          : { absent: "未到", leave: "請假", cancelled: "已取消" }[attendance.status],
      measurements: !access.measurements ? "無查閱權限" : offDay ? "未到／請假，請確認安排" : plannedMeasurements
        ? `${plannedMeasurements.filter((task) => task.status === "recorded").length}／${plannedMeasurements.length} 項已有紀錄`
        : vital ? "已有量測" : "尚無量測",
      diary: !access.careDiaries ? "無查閱權限" : plannedDiaries?.length
        ? `${plannedDiaries.filter((task) => task.status === "recorded").length}／${plannedDiaries.length} 班已簽署${diary?.status === "draft" ? "；有草稿待完成" : diary?.status === "submitted" ? "；有待簽署日誌" : ""}`
        : !diary ? offDay ? "未到／請假，無日誌" : "尚無日誌"
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

/** Time-block filters must use the same task scope for cards, counters and actions. */
export function scopeTodayWorkShift(row: TodayWorkRow, shift: RosterShift | "all"): TodayWorkRow {
  if (!row.plannedShifts || shift === "all") return row;
  const plannedShifts = row.plannedShifts.filter((slot) => slot.shift === shift);
  const measurements = plannedShifts.flatMap((slot) => slot.tasks.filter((task) => task.kind !== "care_diary"));
  const diaries = plannedShifts.flatMap((slot) => slot.tasks.filter((task) => task.kind === "care_diary"));
  const tasks: WorkTask[] = row.tasks.filter((task) => task !== "measurements" && task !== "diary");
  if (row.tasks.includes("measurements") && measurements.some((task) => task.status === "pending")) tasks.push("measurements");
  if (row.tasks.includes("diary") && (diaries.some((task) => task.status === "pending") || row.diary.includes("草稿待完成") || row.diary.includes("待簽署"))) tasks.push("diary");
  const nextPage = tasks[0] === "attention" || tasks[0] === "diary" ? 6 : tasks[0] === "attendance" ? 46 : tasks[0] === "measurements" ? 3 : row.nextPage;
  return { ...row, plannedShifts, tasks, nextPage,
    nextLabel: tasks[0] === "attention" ? "查看需留意紀錄" : tasks[0] === "diary" ? "接續照顧日誌" : tasks[0] === "attendance" ? "確認出勤" : tasks[0] === "measurements" ? "前往量測" : "查看紀錄",
    measurements: row.measurements === "無查閱權限" || row.measurements.startsWith("未到") ? row.measurements : `${measurements.filter((task) => task.status === "recorded").length}／${measurements.length} 項已有紀錄`,
    diary: diaries.length && row.diary !== "無查閱權限" ? `${diaries.filter((task) => task.status === "recorded").length}／${diaries.length} 班已簽署${row.diary.includes("草稿待完成") ? "；有草稿待完成" : row.diary.includes("待簽署") ? "；有待簽署日誌" : ""}` : row.diary };
}
