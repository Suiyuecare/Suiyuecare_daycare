import { ShieldX } from "lucide-react";
import Link from "next/link";

export function StaffAccessDenied() {
  return (
    <section
      aria-labelledby="access-denied-title"
      className="empty-card"
      style={{ margin: "clamp(32px, 8vw, 96px) auto" }}
    >
      <span className="empty-card__icon empty-card__icon--warning">
        <ShieldX aria-hidden="true" />
      </span>
      <p className="eyebrow">無權限</p>
      <h1 id="access-denied-title">這個功能不在您的資料範圍內</h1>
      <p>系統未載入此頁資料。若工作需要使用，請由機構管理員調整角色與有效範圍。</p>
      <Link className="button button--secondary" href="/app/staff/workspace/dashboard">
        返回工作儀表板
      </Link>
    </section>
  );
}
