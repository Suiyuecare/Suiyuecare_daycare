"use client";

export default function ClientFormsError({ reset }: { reset: () => void }) {
  return <section className="panel" role="alert"><h1>個案表單暫時無法載入</h1><p>請確認網路後重試。若先前儲存結果未確認，請先核對歷史紀錄，勿重新建立同一筆。</p><button className="button button--secondary" onClick={reset}>重新載入</button></section>;
}
