"use client";

import { TriangleAlert } from "lucide-react";

export default function ErrorPage({ reset }: { reset: () => void }) {
  return (
    <main className="centered-page" id="main-content">
      <section className="empty-card" role="alert">
        <span className="empty-card__icon empty-card__icon--warning" aria-hidden="true">
          <TriangleAlert />
        </span>
        <p className="eyebrow">載入失敗</p>
        <h1>資料沒有被送出</h1>
        <p>請保留畫面並重試。如果問題持續發生，請將畫面上的請求編號交給系統管理員。</p>
        <button className="button button--primary" onClick={reset} type="button">
          再試一次
        </button>
      </section>
    </main>
  );
}
