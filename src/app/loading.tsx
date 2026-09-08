export default function Loading() {
  return (
    <main className="centered-page" aria-live="polite" aria-busy="true">
      <div className="loading-card">
        <span className="loading-spinner" aria-hidden="true" />
        <div>
          <strong>正在載入照顧資料</strong>
          <p>請稍候，系統不會清除您已輸入的內容。</p>
        </div>
      </div>
    </main>
  );
}
