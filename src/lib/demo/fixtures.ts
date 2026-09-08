import type { PageCatalogEntry } from "@/lib/catalog";

export type DemoRecord = {
  id: string;
  primary: string;
  secondary: string;
  status: "已完成" | "待處理" | "需留意" | "草稿";
  owner: string;
  occurredAt: string;
  values: readonly string[];
};

const people = ["陳O華", "林O英", "黃O生", "吳O美", "張O德", "李O芳"];
const owners = ["林督導", "王護理師", "陳社工", "蔡照服員"];
const statuses: DemoRecord["status"][] = ["已完成", "待處理", "需留意", "草稿"];

export function buildDemoRecords(page: PageCatalogEntry): DemoRecord[] {
  return people.map((person, index) => ({
    id: `DEMO-${page.number}-${index + 1}`,
    primary: person,
    secondary: `個案編號 HX-${String(index + 21).padStart(3, "0")}`,
    status: statuses[(page.number + index) % statuses.length],
    owner: owners[(page.number + index) % owners.length],
    occurredAt: `09:${String(8 + index * 7).padStart(2, "0")}`,
    values: page.columns.map((column, columnIndex) =>
      buildCellValue(page, column, index, columnIndex),
    ),
  }));
}

function buildCellValue(
  page: PageCatalogEntry,
  column: string,
  rowIndex: number,
  columnIndex: number,
) {
  if (/個案|員工|對象/.test(column)) return people[rowIndex];
  if (/時間|日期/.test(column)) return `09:${String(8 + rowIndex * 7).padStart(2, "0")}`;
  if (/狀態|風險|異常/.test(column)) return statuses[(page.number + rowIndex) % statuses.length];
  if (/負責|執行|紀錄人|治療師/.test(column)) return owners[(page.number + rowIndex) % owners.length];
  if (/分數/.test(column)) return String(4 + ((page.number + rowIndex) % 12));
  if (/版本/.test(column)) return `v${1 + (rowIndex % 3)}.${columnIndex}`;
  return `${column} ${rowIndex + 1}`;
}

export const dashboardMetrics = [
  { label: "今日出勤", value: "36", unit: "人", foot: "預計 38 人，2 人請假" },
  { label: "量測完成", value: "91", unit: "%", foot: "3 位個案尚未完成" },
  { label: "交通待辦", value: "4", unit: "趟", foot: "下午 16:00 起陸續發車" },
  { label: "需留意", value: "3", unit: "件", foot: "均已指定負責人" },
] as const;

export const todayTasks = [
  { title: "王護理師覆核胰島素紀錄", meta: "陳O華・高風險用藥", time: "10:30" },
  { title: "完成跌倒事件追蹤", meta: "黃O生・今日到期", time: "12:00" },
  { title: "確認下午接送異動", meta: "2 位個案・家屬已通知", time: "15:30" },
] as const;
