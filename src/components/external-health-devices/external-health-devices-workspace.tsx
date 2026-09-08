import { Activity, Ban, Cpu, Link2Off } from "lucide-react";
import Link from "next/link";

import type { PageCatalogEntry } from "@/lib/catalog";
import type {
  ExternalHealthDevice,
  ExternalHealthDeviceFilters,
  ExternalHealthDeviceSnapshot,
  ExternalHealthMeasurement,
} from "@/lib/external-health-devices/types";

import {
  ExternalHealthDeviceAction,
  ExternalHealthMeasurementMatchAction,
} from "./external-health-device-action";
import styles from "./external-health-devices.module.css";

const matchLabels = { matched: "已配對", unmatched: "未配對", excluded: "已排除" } as const;
const deviceLabels = { active: "啟用", disabled: "停用" } as const;

function dateTime(value: string) {
  return new Intl.DateTimeFormat("zh-TW", { timeZone: "Asia/Taipei",
    dateStyle: "medium", timeStyle: "short", hourCycle: "h23" })
    .format(new Date(value));
}

function DeviceFacts({ device }: { device: ExternalHealthDevice }) {
  return <dl>
    <div><dt>設備</dt><dd>{device.deviceCode}</dd></div>
    <div><dt>類型</dt><dd>{device.deviceType}</dd></div>
    <div><dt>狀態</dt><dd>{deviceLabels[device.operationalStatus]}</dd></div>
    <div><dt>個案</dt><dd>{device.assignedClientDisplayName ?? "尚未配對"}</dd></div>
    <div><dt>最近接收</dt><dd>{device.lastMeasurementReceivedAt
      ? dateTime(device.lastMeasurementReceivedAt) : "尚無資料"}</dd></div>
    <div><dt>狀態序號</dt><dd>{device.stateSequence}</dd></div>
  </dl>;
}

function MeasurementFacts({ measurement }: { measurement: ExternalHealthMeasurement }) {
  return <dl>
    <div><dt>設備</dt><dd>{measurement.deviceCode}</dd></div>
    <div><dt>量測</dt><dd>{measurement.metricCode}</dd></div>
    <div><dt>數值</dt><dd>{measurement.numericValue} {measurement.unit}</dd></div>
    <div><dt>來源時間</dt><dd>{dateTime(measurement.measuredAt)}</dd></div>
    <div><dt>接收時間</dt><dd>{dateTime(measurement.receivedAt)}</dd></div>
    <div><dt>個案／狀態</dt><dd>{measurement.clientDisplayName ?? matchLabels[measurement.matchStatus]}</dd></div>
  </dl>;
}

export function ExternalHealthDevicesWorkspace({
  canManage, filters, loadError, page, snapshot,
}: {
  canManage: boolean;
  filters: ExternalHealthDeviceFilters;
  loadError: boolean;
  page: PageCatalogEntry;
  snapshot: ExternalHealthDeviceSnapshot | null;
}) {
  if (loadError || !snapshot) return <main className={styles.workspace}>
    <header className={styles.hero}><div><p className="eyebrow">機構營運管理</p>
      <h1>{page.title}</h1><p>{page.description}</p></div></header>
    <section className={styles.error} role="alert"><h2>目前無法載入外部健康設備</h2>
      <p>可能是無權限、分支情境失效、日期錯誤、資料逾時或服務未設定；系統不會用空數字取代失敗結果。</p>
      <Link className="button button--secondary"
        href="/app/staff/operations/external-health-devices">重新載入</Link>
    </section>
  </main>;

  const actionEnabled = canManage && !snapshot.clientsTruncated;
  return <main className={styles.workspace}>
    <header className={styles.hero}>
      <div><p className="eyebrow">機構營運管理 · 第 65 頁</p>
        <h1>{page.title}</h1><p>{page.description}</p></div>
      <aside className={styles.snapshotMeta} aria-label="資料快照">
        <strong>{snapshot.demo ? "去識別合成展示" : "正式分支資料"}</strong>
        <span>更新：<time dateTime={snapshot.generatedAt}>{dateTime(snapshot.generatedAt)}</time></span>
        <span>時區：Asia/Taipei</span><span>離線：不開放</span>
      </aside>
    </header>

    {snapshot.demo ? <p className={styles.notice} role="status">
      本頁只顯示合成設備與量測；設備配對、停用、資料修正與來源寫入都不會執行。
    </p> : null}
    <p className={styles.warning} role="note">
      供應商心跳與斷線門檻尚未設定，因此系統不會把「最近接收時間」推論成已連線或斷線；所有設備的連線狀態均明示尚未設定。
    </p>

    <section className={styles.metrics} aria-label="設備與資料統計">
      <article><Cpu aria-hidden="true" /><span>符合設備</span>
        <strong>{snapshot.deviceTotal}</strong><small>啟用 {snapshot.activeDeviceTotal}／停用 {snapshot.disabledDeviceTotal}</small></article>
      <article><Activity aria-hidden="true" /><span>符合量測</span>
        <strong>{snapshot.measurementTotal}</strong><small>來源與接收時間分開保存</small></article>
      <article><Link2Off aria-hidden="true" /><span>未配對資料</span>
        <strong>{snapshot.unmatchedMeasurementTotal}</strong><small>可受控追加配對修正</small></article>
      <article><Ban aria-hidden="true" /><span>重複來源資料</span>
        <strong>不另新增</strong><small>相同去重鍵同內容只重播；不同內容衝突</small></article>
    </section>

    <section className={styles.boundary} aria-labelledby="source-boundary-title">
      <div><p className="eyebrow">來源與去重邊界</p>
        <h2 id="source-boundary-title">目前可查明的設備資料契約</h2></div>
      <ol>
        <li>量測去重鍵固定為「機構＋分支＋來源供應者＋來源量測 ID」。</li>
        <li>相同去重鍵與相同內容只回傳原量測；相同鍵但內容不同會阻擋，不靜默覆寫。</li>
        <li>來源時間與系統接收時間分欄保存；配對修正與設備狀態只追加版本。</li>
        <li>目前僅完成 service-role 資料庫契約，未宣稱已連接任何設備供應商或完成斷線偵測。</li>
      </ol>
      <button className="button button--secondary" disabled type="button"
        title="正式匯出格式尚未設定">匯出（尚未設定）</button>
    </section>

    <form className={styles.filters} method="get">
      <label><span>起日</span><input defaultValue={filters.dateFrom ?? ""} name="from" type="date" /></label>
      <label><span>迄日</span><input defaultValue={filters.dateTo ?? ""} name="to" type="date" /></label>
      <label><span>個案</span><select defaultValue={filters.clientId ?? "all"} name="client">
        <option value="all">全部</option>{snapshot.clientOptions.map((client) =>
          <option key={client.clientId} value={client.clientId}>{client.clientCode} · {client.displayName}</option>)}</select></label>
      <label><span>設備</span><select defaultValue={filters.deviceId ?? "all"} name="device">
        <option value="all">全部</option>{snapshot.devices.map((device) =>
          <option key={device.deviceId} value={device.deviceId}>{device.deviceCode} · {device.deviceType}</option>)}</select></label>
      <label><span>設備狀態</span><select defaultValue={filters.deviceStatus} name="deviceStatus">
        <option value="all">全部</option><option value="active">啟用</option><option value="disabled">停用</option>
      </select></label>
      <label><span>資料配對</span><select defaultValue={filters.matchStatus} name="matchStatus">
        <option value="all">全部</option><option value="matched">已配對</option>
        <option value="unmatched">未配對</option><option value="excluded">已排除</option>
      </select></label>
      <label><span>量測類型</span><select defaultValue={filters.metricCode ?? "all"} name="metric">
        <option value="all">全部</option>{snapshot.metricOptions.map((metric) =>
          <option key={`${metric.metricCode}:${metric.unit}`} value={metric.metricCode}>
            {metric.metricCode} · {metric.unit}（{metric.measurementCount}）</option>)}</select></label>
      <div className={styles.filterActions}><button className="button button--primary" type="submit">套用篩選</button>
        <Link className="button button--ghost" href="/app/staff/operations/external-health-devices">清除</Link></div>
    </form>

    <section className={styles.records} aria-labelledby="devices-title">
      <div className={styles.resultHeader}><div><p className="eyebrow">設備登錄與終端狀態</p>
        <h2 id="devices-title">設備清單</h2></div><p>符合 {snapshot.deviceTotal} 台</p></div>
      {snapshot.devicesTruncated || snapshot.clientsTruncated ? <p className={styles.warning} role="alert">
        設備或個案選項只顯示有界清單；請縮小篩選後再操作，避免對不完整集合做配對。
      </p> : null}
      {snapshot.devices.length === 0 ? <div className={styles.empty}><h3>目前篩選沒有設備</h3>
        <p>請清除篩選，或確認來源整合是否已註冊設備。</p></div> : <>
        <div className={styles.tableWrap}><table className={styles.table}>
          <thead><tr><th>設備／來源</th><th>狀態／個案</th><th>最近接收／筆數</th><th>連線判定</th><th>操作</th></tr></thead>
          <tbody>{snapshot.devices.map((device) => <tr key={device.deviceId}>
            <td><strong>{device.deviceCode}</strong><br /><small>{device.deviceType} · {device.sourceProvider}</small></td>
            <td>{deviceLabels[device.operationalStatus]}<br /><small>{device.assignedClientDisplayName ?? "尚未配對"}</small></td>
            <td>{device.lastMeasurementReceivedAt ? dateTime(device.lastMeasurementReceivedAt) : "尚無資料"}<br />
              <small>{device.measurementCount} 筆</small></td>
            <td>尚未設定<br /><small>不可推論斷線</small></td>
            <td><ExternalHealthDeviceAction canManage={actionEnabled && !snapshot.devicesTruncated}
              device={device} snapshot={snapshot} /></td>
          </tr>)}</tbody>
        </table></div>
        <div className={styles.mobileCards}>{snapshot.devices.map((device) => <article key={device.deviceId}>
          <h3>{device.deviceCode}</h3><DeviceFacts device={device} />
          <ExternalHealthDeviceAction canManage={actionEnabled && !snapshot.devicesTruncated}
            device={device} snapshot={snapshot} />
        </article>)}</div>
      </>}
    </section>

    <section className={styles.records} aria-labelledby="measurements-title">
      <div className={styles.resultHeader}><div><p className="eyebrow">不可變來源量測與終端配對</p>
        <h2 id="measurements-title">量測明細</h2></div><p>符合 {snapshot.measurementTotal} 筆</p></div>
      {snapshot.measurementsTruncated || snapshot.clientsTruncated ? <p className={styles.warning} role="alert">
        量測或個案選項只顯示有界清單；請縮小日期後再修正，統計仍使用完整篩選集合。
      </p> : null}
      {snapshot.measurements.length === 0 ? <div className={styles.empty}><h3>目前篩選沒有量測</h3>
        <p>請清除篩選或確認來源設備是否已提供資料。</p></div> : <>
        <div className={styles.tableWrap}><table className={styles.table}>
          <thead><tr><th>設備／量測</th><th>來源／接收時間</th><th>數值／單位</th><th>個案／配對</th><th>修正</th></tr></thead>
          <tbody>{snapshot.measurements.map((measurement) => <tr key={measurement.measurementId}>
            <td><strong>{measurement.deviceCode}</strong><br /><small>{measurement.metricCode}</small></td>
            <td><time dateTime={measurement.measuredAt}>{dateTime(measurement.measuredAt)}</time><br />
              <small>接收 {dateTime(measurement.receivedAt)}</small></td>
            <td>{measurement.numericValue} {measurement.unit}</td>
            <td>{measurement.clientDisplayName ?? "尚未配對"}<br /><small>{matchLabels[measurement.matchStatus]}</small></td>
            <td>{measurement.correctionSequence === 0 ? "未修正" : `第 ${measurement.correctionSequence} 次`}
              <ExternalHealthMeasurementMatchAction
                canManage={actionEnabled && !snapshot.measurementsTruncated}
                measurement={measurement} snapshot={snapshot} /></td>
          </tr>)}</tbody>
        </table></div>
        <div className={styles.mobileCards}>{snapshot.measurements.map((measurement) => <article key={measurement.measurementId}>
          <h3>{measurement.metricCode} · {measurement.numericValue} {measurement.unit}</h3>
          <MeasurementFacts measurement={measurement} />
          <ExternalHealthMeasurementMatchAction
            canManage={actionEnabled && !snapshot.measurementsTruncated}
            measurement={measurement} snapshot={snapshot} />
        </article>)}</div>
      </>}
    </section>
  </main>;
}
