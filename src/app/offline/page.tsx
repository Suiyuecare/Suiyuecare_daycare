import { CloudOff } from "lucide-react";

export default function OfflinePage() {
  return (
    <main className="centered-page" id="main-content">
      <section className="empty-card" aria-labelledby="offline-title">
        <span className="empty-card__icon" aria-hidden="true">
          <CloudOff />
        </span>
        <p className="eyebrow">目前離線</p>
        <h1 id="offline-title">已保存的草稿仍在這台裝置</h1>
        <p>
          重新連線後，系統會在 60 秒內開始同步。用藥簽署、申報與正式文件必須連線後才能操作。
        </p>
        <a className="button button--primary" href="">
          重新整理頁面
        </a>
      </section>
    </main>
  );
}
