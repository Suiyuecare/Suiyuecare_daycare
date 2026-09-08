import Image from "next/image";

/** Finance's indeterminate auth-loading bar; never invent a completion percentage. */
export function ModuleLoading({
  title = "正在載入日照管理",
  transition = false,
}: {
  title?: string;
  transition?: boolean;
}) {
  return (
    <div className={`module-loading${transition ? " module-loading--transition" : ""}`} role="status" aria-live="polite" aria-busy="true">
      <div className="module-loading__card">
        <Image className="module-loading__logo" src="/suiyue-logo-transparent.png" alt="" width={54} height={54} unoptimized />
        <strong>{title}</strong>
        <span>正在讀取日照管理的系統功能，完成後會直接開啟你的工作頁面。</span>
        <div className="module-loading__bar" role="progressbar" aria-label="系統功能載入中"><b /></div>
      </div>
    </div>
  );
}
