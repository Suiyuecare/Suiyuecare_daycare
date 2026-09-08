import Link from "next/link";

export default function NotFound() {
  return (
    <main className="centered-page" id="main-content">
      <section className="empty-card">
        <p className="eyebrow">404</p>
        <h1>找不到這個頁面</h1>
        <p>頁面可能已移動，或您的角色沒有這個入口。</p>
        <Link className="button button--primary" href="/app/dashboard">
          回工作首頁
        </Link>
      </section>
    </main>
  );
}
