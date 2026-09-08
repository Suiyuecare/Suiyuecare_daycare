import { pilotProfile, pilotReadinessRequirements } from "@/lib/config/pilot-profile";
import { pilotSources } from "@/lib/config/pilot-sources";

import styles from "./pilot-configuration-summary.module.css";

/** Only rendered inside an already authorized demo snapshot; never overrides tenant data. */
export function PilotConfigurationSummary({ demo }: { demo: boolean }) {
  if (!demo) return null;

  return <section className={styles.panel} aria-labelledby="pilot-configuration-heading">
    <div className={styles.heading}>
      <div>
        <p className="eyebrow">首間試辦 · 身分設定</p>
        <h2 id="pilot-configuration-heading">{pilotProfile.legalName}</h2>
      </div>
      <span className={styles.status}>名稱已確認 · 正式環境未建立</span>
    </div>
    <dl className={styles.facts}>
      <div><dt>所在縣市</dt><dd>{pilotProfile.municipality}</dd></div>
      <div><dt>規劃服務</dt><dd>社區式日間照顧（許可待查驗）</dd></div>
      <div><dt>確認來源</dt><dd>使用者確認 · {pilotProfile.confirmation.confirmedOn}</dd></div>
    </dl>
    <p className={styles.boundary}>
      此處只記錄試辦名稱與縣市，不代表已建立正式帳號或核准上線。
      下方示範許可、容量、費率及聯絡資料均為合成資料，不屬於本機構的核定資料。
    </p>
    <details className={styles.details}>
      <summary>查看正式設定待辦（{pilotReadinessRequirements.length} 類）</summary>
      <ul>{pilotReadinessRequirements.map((item) => <li key={item.id}>
        {item.label}<span>待提供／審查</span>
      </li>)}</ul>
      <p>機構代碼、許可字號、契約、容量與規則版次目前皆未綁定；不從名冊列序或名稱推算。</p>
    </details>
    <details className={styles.details}>
      <summary>官方來源清單（{pilotSources.length} 筆，全部待審查、未啟用）</summary>
      <p>查證日期：2026-09-08。以下是來源索引，不是可執行規則；發布與更新日期不等於適用或生效日期。</p>
      <ul className={styles.sources}>{pilotSources.map((source) => <li key={source.id}>
        <h3><a href={source.sourceUrl} target="_blank" rel="noopener noreferrer">
          {source.title}<span className="sr-only">（另開官方網站）</span>
        </a></h3>
        <p>{source.authority} · {source.version}</p>
        <ul>{source.dates.map((date) => <li key={date.label}>{date.label}：{date.value}</li>)}</ul>
        <p>{source.caution}</p>
        <span className={styles.status}>待審查 · 未啟用</span>
      </li>)}</ul>
    </details>
  </section>;
}
