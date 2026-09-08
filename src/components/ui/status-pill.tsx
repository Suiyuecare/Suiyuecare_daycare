import clsx from "clsx";

export function StatusPill({ status }: { status: string }) {
  const tone =
    status.includes("完成") || status.includes("有效") || status.includes("正常")
      ? "success"
      : status.includes("留意") || status.includes("逾期") || status.includes("異常")
        ? "danger"
        : status.includes("待")
          ? "warning"
          : status.includes("草稿")
            ? "info"
            : "neutral";

  return (
    <span className={clsx("status-pill", `status-pill--${tone}`)}>
      {status}
    </span>
  );
}
