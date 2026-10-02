import clsx from "clsx";

export type StatusPillTone = "success" | "warning" | "danger" | "info" | "neutral";

function inferredTone(status: string): StatusPillTone {
  if (status.includes("留意") || status.includes("逾期") || status.includes("異常")) return "danger";
  if (status.includes("待") || status.includes("未完成")) return "warning";
  if (status.includes("完成") || status.includes("有效") || status.includes("正常")) return "success";
  if (status.includes("草稿")) return "info";
  return "neutral";
}

export function StatusPill({ status, tone }: { status: string; tone?: StatusPillTone }) {
  const resolvedTone = tone ?? inferredTone(status);

  return (
    <span className={clsx("status-pill", `status-pill--${resolvedTone}`)}>
      {status}
    </span>
  );
}
