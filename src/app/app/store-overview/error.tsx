"use client";

export default function StoreOverviewError({ reset }: { reset: () => void }) {
  return <section className="panel" role="alert">
    <h1>出勤與收支暫時無法開啟</h1>
    <p>請檢查網路後重試；若仍無法讀取，請聯絡系統管理員。</p>
    <button type="button" className="button button--secondary" onClick={reset}>重新讀取</button>
  </section>;
}
