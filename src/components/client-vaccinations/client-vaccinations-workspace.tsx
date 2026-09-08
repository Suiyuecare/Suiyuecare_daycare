import { CalendarDays, FileCheck2, FileWarning, ShieldCheck, Siren,
  Syringe } from "lucide-react";
import Link from "next/link";

import type { PageCatalogEntry } from "@/lib/catalog";
import type { ClientVaccinationFilters, ClientVaccinationRecord,
  ClientVaccinationSnapshot } from "@/lib/client-vaccinations/types";

import { ClientVaccinationBatchForm, ClientVaccinationCreateForm,
  ClientVaccinationFreshness, ClientVaccinationRevisionForm } from "./client-vaccination-actions";
import styles from "./client-vaccinations.module.css";

const evidenceLabels = { provided: "已有可信證明中繼資料",
  missing: "缺證明", not_applicable: "證明不適用" } as const;
const sourceLabels = { manual_entry: "人工登錄", central_html_import: "中央 HTML 匯入",
  legacy_migration: "舊系統移轉" } as const;

function formatTaipei(value: string) {
  return new Intl.DateTimeFormat("zh-TW", { timeZone: "Asia/Taipei",
    year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit",
    minute: "2-digit", hourCycle: "h23" }).format(new Date(value));
}

function Evidence({ record }: { record: ClientVaccinationRecord }) {
  if (record.evidenceStatus !== "provided") return <>{evidenceLabels[record.evidenceStatus]}</>;
  return <>{evidenceLabels.provided}<br /><small>{record.evidenceFileName}<br />
    SHA-256 {record.evidenceSha256?.slice(0, 12)}…</small></>;
}

export function ClientVaccinationsWorkspace({
  canManage, filters, hasRecentAal2, loadError = false, page, snapshot,
}: {
  canManage: boolean;
  filters: ClientVaccinationFilters;
  hasRecentAal2: boolean;
  loadError?: boolean;
  page: PageCatalogEntry;
  snapshot: ClientVaccinationSnapshot | null;
}) {
  if (loadError || !snapshot) return <section className="empty-card core-care-state"
    role="alert"><span className="empty-card__icon empty-card__icon--warning">
      <FileWarning aria-hidden="true" /></span><h1>{page.title}暫時無法載入</h1>
    <p>篩選條件無效，或正式疫苗快照不可用；系統不會用其他分支、未指派個案或展示資料補位。</p>
    <Link className="button button--secondary" href="?">清除篩選並重試</Link>
  </section>;
  const duplicates = snapshot.records.filter((record) => record.duplicateWarning);
  const path = `/app/${page.slug}`;
  return <div className={styles.workspace}>
    <header className={styles.hero}><div><p className="eyebrow">評估量表・Page 23</p>
      <h1>{page.title}</h1><p>{page.description}</p>
      <p>每筆只保存來源事實；系統不判定疫苗適用性、保護力、禁忌或下一劑。</p></div>
      <div className={styles.snapshotMeta}><strong>分支限定不可變快照</strong>
        <span>更新：{formatTaipei(snapshot.generatedAt)}</span>
        <span>日期口徑：{snapshot.snapshotDate}（Asia/Taipei）</span>
        <span>離線：未配置</span></div></header>
    <ClientVaccinationFreshness staleAfter={snapshot.staleAfter} demo={snapshot.demo} />

    {snapshot.demo ? <div className={styles.notice} role="status"><strong>展示模式：</strong>
      目前只顯示合成、唯讀資料；不會保存、匯入或上傳任何真實個案資料。</div> :
      <div className={styles.notice} role="status"><strong>資料隔離：</strong>
        只讀取目前機構、分支及被指派個案；寫入時由資料庫再次驗證權限與在案範圍。</div>}
    <div className={styles.warning} role="note"><strong>目前外部邊界：</strong>
      附件上傳、掃毒、短效下載、提醒排程與 24 小時離線快取尚未配置，均 fail closed。
      已移轉證明只顯示可信中繼資料，不會接受瀏覽器任意附件參照。</div>

    <section className={styles.metrics} aria-label="個案疫苗統計">
      <article><ShieldCheck aria-hidden="true" /><span>接種終端紀錄</span>
        <strong>{snapshot.recordTotal}</strong></article>
      <article><FileWarning aria-hidden="true" /><span>缺證明</span>
        <strong>{snapshot.missingEvidenceTotal}</strong></article>
      <article><Siren aria-hidden="true" /><span>重複警示</span>
        <strong>{snapshot.duplicateWarningTotal}</strong></article>
      <article><CalendarDays aria-hidden="true" /><span>本月接種日期</span>
        <strong>{snapshot.currentMonthTotal}</strong></article>
    </section>

    <ClientVaccinationCreateForm canManage={canManage} snapshot={snapshot} />
    <ClientVaccinationBatchForm canManage={canManage} hasRecentAal2={hasRecentAal2} snapshot={snapshot} />
    <ClientVaccinationRevisionForm canManage={canManage}
      hasRecentAal2={hasRecentAal2} snapshot={snapshot} />

    <form className={styles.filters} method="get" aria-label="篩選個案疫苗">
      <label><span>個案</span><select name="client" defaultValue={filters.clientId ?? "all"}>
        <option value="all">全部已授權個案</option>{snapshot.clientOptions.map((client) =>
          <option key={client.clientId} value={client.clientId}>{client.clientCode} · {
            client.displayName}</option>)}</select></label>
      <label><span>疫苗名稱</span><select name="vaccine" defaultValue={filters.vaccineName ?? "all"}>
        <option value="all">全部名稱</option>{snapshot.vaccineOptions.map((option) =>
          <option key={option.value} value={option.value}>{option.value}（{option.recordCount}）</option>)}</select></label>
      <label><span>劑次</span><select name="dose" defaultValue={filters.doseNumber ?? "all"}>
        <option value="all">全部劑次</option>{snapshot.doseOptions.map((option) =>
          <option key={option.value} value={option.value}>{option.value}（{option.recordCount}）</option>)}</select></label>
      <label><span>接種日起</span><input name="from" type="date" min="1900-01-01"
        max={snapshot.snapshotDate} defaultValue={filters.dateFrom ?? ""} /></label>
      <label><span>接種日至</span><input name="to" type="date" min="1900-01-01"
        max={snapshot.snapshotDate} defaultValue={filters.dateTo ?? ""} /></label>
      <label><span>狀態</span><select name="status" defaultValue={filters.status}>
        <option value="all">全部</option><option value="active">有效終端版本</option>
        <option value="voided">作廢終端版本</option>
        <option value="missing_evidence">缺證明</option>
        <option value="duplicate_warning">重複警示</option></select></label>
      <label><span>搜尋</span><input name="q" defaultValue={filters.query}
        maxLength={120} placeholder="個案、疫苗、劑次、批號或院所" /></label>
      <button className="button button--secondary" type="submit">套用篩選</button>
      <Link className="button button--quiet" href={path}>清除</Link>
    </form>

    <div className={styles.resultHeader}><p>顯示 {snapshot.records.length} / {
      snapshot.recordTotal} 筆終端版本。</p>{snapshot.recordsTruncated ? <p role="status">
      明細上限 200 筆；統計仍取自完整符合集合，請縮小篩選。</p> : null}</div>

    <section className={styles.records} aria-labelledby="client-vaccination-records">
      <h2 id="client-vaccination-records">個案疫苗終端版本</h2>
      {!snapshot.records.length ? <div className="empty-card"><span className="empty-card__icon">
        <Syringe aria-hidden="true" /></span><h3>沒有符合條件的疫苗紀錄</h3>
        <p>請調整個案、疫苗、劑次、日期、狀態或搜尋條件。</p></div> : <>
        <div className={styles.tableWrap} role="region" tabIndex={0}
          aria-label="可水平捲動的個案疫苗終端版本表格"><table className={styles.table}>
          <thead><tr><th>個案</th><th>疫苗／劑次</th><th>日期／批號</th>
            <th>院所／證明</th><th>來源</th><th>重複比對</th><th>版本／狀態</th></tr></thead>
          <tbody>{snapshot.records.map((record) => <tr key={record.recordVersionId}>
            <td>{record.clientCode} · {record.clientDisplayName}</td>
            <td>{record.vaccineName}<br /><small>{record.doseNumber}</small></td>
            <td>{record.vaccinatedOn}<br /><small>{record.lotNumber ?? "批號未提供"}</small></td>
            <td>{record.providerName}<br /><small><Evidence record={record} /></small></td>
            <td>{sourceLabels[record.sourceSystem]}<br /><small>{record.sourceRecordId ?? "本系統建立"}</small></td>
            <td>{record.duplicateWarning ? `另有 ${record.duplicateCount} 筆，未合併` : "未找到同鍵其他紀錄"}</td>
            <td>v{record.version} · {record.recordStatus === "voided" ? "已作廢" : "有效終端"}<br />
              <small>醫療判定：未評估</small></td></tr>)}</tbody></table></div>
        <div className={styles.mobileCards}>{snapshot.records.map((record) => <article
          key={record.recordVersionId}><h3>{record.vaccineName}</h3>
          <p>{record.clientCode} · {record.clientDisplayName}</p><dl>
            <div><dt>劑次</dt><dd>{record.doseNumber}</dd></div>
            <div><dt>日期／批號</dt><dd>{record.vaccinatedOn}<br />{record.lotNumber ?? "未提供"}</dd></div>
            <div><dt>院所／證明</dt><dd>{record.providerName}<br /><Evidence record={record} /></dd></div>
            <div><dt>來源</dt><dd>{sourceLabels[record.sourceSystem]}</dd></div>
            <div><dt>重複比對</dt><dd>{record.duplicateWarning ? `另有 ${record.duplicateCount} 筆，未合併` : "無"}</dd></div>
            <div><dt>版本／狀態</dt><dd>v{record.version} · {record.recordStatus === "voided" ? "已作廢" : "有效終端"}</dd></div>
          </dl></article>)}</div></>}
    </section>

    <section className={styles.duplicates} aria-labelledby="client-vaccination-duplicates">
      <h2 id="client-vaccination-duplicates">重複警示人工核對</h2>
      <p>比對固定為同一個案，且疫苗名稱與劑次去除前後空白、連續空白統一並忽略大小寫後相同；日期、批號或院所不同仍保留不同紀錄。</p>
      {!duplicates.length ? <p>目前篩選結果沒有重複警示。</p> :
        <div className={styles.duplicateGrid}>{duplicates.map((record) => <article
          key={record.recordVersionId}><h3>{record.clientDisplayName} · {record.vaccineName}</h3>
          <dl><div><dt>劑次</dt><dd>{record.doseNumber}</dd></div>
            <div><dt>本筆日期</dt><dd>{record.vaccinatedOn}</dd></div>
            <div><dt>其他筆數</dt><dd>{record.duplicateCount}</dd></div></dl>
          <ul>{record.duplicateMatches.map((match) => <li key={match.vaccinationKey}>
            另一筆接種日期 {match.vaccinatedOn}（保持獨立）</li>)}</ul>
          {record.duplicateMatchesTruncated ? <p role="status">僅列前 200 筆；完整數量為 {
            record.duplicateCount}。</p> : null}</article>)}</div>}
    </section>

    <section className={styles.history} aria-labelledby="client-vaccination-history">
      <h2 id="client-vaccination-history">不可變版本歷程</h2>
      <p>顯示 {snapshot.history.length} / {snapshot.historyTotal} 個版本；既有版本不能直接修改或刪除。</p>
      {snapshot.historyTruncated ? <p role="status">歷程上限 500 筆，請縮小篩選。</p> : null}
      <div className={styles.historyGrid}>{snapshot.history.map((record) => <article
        key={record.recordVersionId}><h3>{record.vaccineName} · {record.doseNumber} · v{record.version}</h3>
        <p>{record.vaccinatedOn} · {record.providerName}</p><dl>
          <div><dt>批號</dt><dd>{record.lotNumber ?? "未提供"}</dd></div>
          <div><dt>證明</dt><dd>{evidenceLabels[record.evidenceStatus]}</dd></div>
          <div><dt>來源</dt><dd>{sourceLabels[record.sourceSystem]}</dd></div>
          <div><dt>狀態</dt><dd>{record.recordStatus === "voided" ? "作廢終端" : "有效於當時"}</dd></div>
          <div><dt>保存</dt><dd>{formatTaipei(record.recordedAt)} · {record.recordedByDisplayName}</dd></div>
          <div><dt>理由</dt><dd>{record.correctionReason ?? "原始版本"}</dd></div>
          <div><dt>內容雜湊</dt><dd>{record.contentHash.slice(0, 12)}…</dd></div>
        </dl></article>)}</div>
    </section>
    <div className={styles.notice} role="note"><FileCheck2 aria-hidden="true" />
      單筆與批次共用相同伺服器驗證；批次最多 {snapshot.batchMaximumItems} 筆並逐筆回報建立、重播或拒絕，不會把失敗筆偽裝成完成。</div>
  </div>;
}
