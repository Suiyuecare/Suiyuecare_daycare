import type { ProfessionalServiceSummarySnapshot } from "./types";

function cell(value: string | number | null) {
  const content = value === null ? "" : String(value);
  const spreadsheetSafe = /^[=+\-@]/u.test(content) ? `'${content}` : content;
  return /[",\r\n]/u.test(spreadsheetSafe)
    ? `"${spreadsheetSafe.replaceAll('"', '""')}"`
    : spreadsheetSafe;
}

function statusText(item: ProfessionalServiceSummarySnapshot["items"][number]) {
  const frequencyMissing = item.expectationStatus ===
    "existing_records_only_frequency_not_configured";
  return {
    completed: frequencyMissing ? "既有紀錄已完成（頻率未設定）" : "已完成",
    pending: frequencyMissing ? "既有草稿待完成（頻率未設定）" : "待完成",
    overdue: "逾期",
    not_configured: "規則未設定",
  }[item.summaryStatus];
}

export function professionalServiceSummaryCsv(
  snapshot: ProfessionalServiceSummarySnapshot,
) {
  const rows: Array<Array<string | number | null>> = [
    ["快照識別", snapshot.snapshotId],
    ["快照雜湊", snapshot.snapshotHash],
    ["月份", snapshot.month],
    ["產生時間", snapshot.generatedAt],
    ["符合項目", snapshot.matchingTotal],
    ["顯示／匯出明細", snapshot.items.length],
    ["明細是否截斷", snapshot.itemsTruncated ? "是" : "否"],
    ["應完成", snapshot.metrics.expected],
    ["已完成", snapshot.metrics.completed],
    ["待完成", snapshot.metrics.pending],
    ["逾期", snapshot.metrics.overdue],
    [],
    [
      "項目識別", "個案", "專業別", "來源頁", "來源名稱", "狀態",
      "狀態說明", "應完成數", "已完成數", "待完成數", "逾期數",
      "服務筆數", "最近日期", "下次期限", "來源版本", "來源雜湊",
    ],
    ...snapshot.items.map((item) => [
      item.itemId,
      item.clientDisplayName,
      item.professionalLabel,
      item.sourcePage,
      item.sourcePageTitle,
      statusText(item),
      item.statusReason,
      item.expectedCount,
      item.completedCount,
      item.pendingCount,
      item.overdueCount,
      item.serviceCount,
      item.latestOn,
      item.nextDueOn,
      item.sourceVersion,
      item.sourceHash,
    ]),
  ];
  return `\ufeff${rows.map((row) => row.map(cell).join(",")).join("\r\n")}\r\n`;
}
