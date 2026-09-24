"use client";
export default function QualificationError({ reset }: { reset: () => void }) {
  return <section className="panel" role="alert"><h1>證照待辦暫時無法確認</h1><p>請檢查網路後重新讀取；這不代表沒有待辦，也不代表服務資格已通過。</p><button type="button" className="button button--secondary" onClick={reset}>重新讀取</button></section>;
}
