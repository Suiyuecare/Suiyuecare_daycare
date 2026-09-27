"use client";

import { TriangleAlert } from "lucide-react";

export default function ErrorPage({ reset }: { reset: () => void }) {
  return (
    <main className="centered-page route-error" id="main-content">
      <section className="empty-card" role="alert">
        <span className="empty-card__icon empty-card__icon--warning" aria-hidden="true">
          <TriangleAlert />
        </span>
        <p className="eyebrow">載入失敗</p>
        <h1>目前無法載入</h1>
        <p>請再試一次。若剛才已送出紀錄，請先核對原筆保存結果，不要重新建一筆。</p>
        <button className="button button--primary" onClick={reset} type="button">
          再試一次
        </button>
      </section>
    </main>
  );
}
