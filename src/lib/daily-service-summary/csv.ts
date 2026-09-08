import type { DailyServiceSummarySnapshot } from "./types";

function csvCell(value: string | number | null) {
  const content = value === null ? "" : String(value);
  const safe = /^[=+\-@]/u.test(content) ? `'${content}` : content;
  return /[",\r\n]/u.test(safe) ? `"${safe.replaceAll('"', '""')}"` : safe;
}

export function dailyServiceSummaryCsv(snapshot: DailyServiceSummarySnapshot) {
  const rows: Array<Array<string | number | null>> = [
    ["快照識別", snapshot.snapshotId],
    ["快照雜湊", snapshot.snapshotHash],
    ["服務日", snapshot.filters.serviceDate],
    ["產生時間", snapshot.generatedAt],
    ["一致性", "單一資料庫陳述式快照"],
    ["離線快取", "未設定"],
    ["符合個案", snapshot.matchingRowTotal],
    [],
    ["個案代碼", "個案", "服務狀態", "來源", "來源頁", "授權狀態",
      "證據狀態", "紀錄數", "完成數", "待完成數", "例外數", "狀態說明",
      "來源紀錄識別", "來源雜湊", "完整度"],
  ];
  for (const row of snapshot.rows) {
    for (const cell of row.cells) {
      rows.push([row.clientCode, row.displayName, row.serviceStatus,
        cell.sourceLabel, cell.sourcePage,
        cell.accessStatus === "authorized" ? "可讀" :
          cell.accessStatus === "not_authorized" ? "未授權（未知）" : "未配置（未知）",
        cell.evidenceStatus === "recorded" ? "有紀錄" :
          cell.evidenceStatus === "no_record" ? "已查詢無紀錄" : "未知",
        cell.recordCount, cell.completedCount, cell.pendingCount,
        cell.exceptionCount, cell.statusText, cell.sourceRecordIds.join(" "),
        cell.sourceHash, row.completenessPercent === null ? null : `${row.completenessPercent}%`]);
    }
  }
  return `\ufeff${rows.map((row) => row.map(csvCell).join(",")).join("\r\n")}\r\n`;
}
