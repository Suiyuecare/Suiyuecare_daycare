import {
  CalendarDays,
  CheckCircle2,
  ChevronRight,
  CircleAlert,
  Clock3,
  Database,
  Droplets,
  ShieldCheck,
} from "lucide-react";

import { BloodGlucoseComposer } from "@/components/blood-glucose/blood-glucose-composer";
import { StatusPill } from "@/components/ui/status-pill";
import type { PageCatalogEntry } from "@/lib/catalog";
import type { BloodGlucoseMealContext } from "@/lib/blood-glucose/constants";
import type {
  BloodGlucoseClientSummary,
  BloodGlucoseMeasurementStatus,
  BloodGlucoseRecord,
  BloodGlucoseSnapshot,
} from "@/lib/blood-glucose/types";

const mealContextLabels: Record<BloodGlucoseMealContext, string> = {
  fasting: "空腹",
  pre_meal: "餐前",
  post_meal: "餐後",
  random: "隨機",
};

function formatTime(value: string | null) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("zh-TW", {
    timeZone: "Asia/Taipei",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(new Date(value));
}

function sourceLabel(source: string) {
  if (source === "staff") return "人員登錄";
  if (source === "device_import") return "設備匯入";
  if (source === "central_import") return "中央匯入";
  return source;
}

export function BloodGlucoseWorkspace({
  page,
  snapshot,
  allClients,
  serviceDate,
  selectedClientId,
  mealContext,
  measurementStatus,
  canWrite,
  loadError = false,
}: {
  page: PageCatalogEntry;
  snapshot: BloodGlucoseSnapshot | null;
  allClients: readonly BloodGlucoseClientSummary[];
  serviceDate: string;
  selectedClientId?: string;
  mealContext?: BloodGlucoseMealContext;
  measurementStatus: BloodGlucoseMeasurementStatus;
  canWrite: boolean;
  loadError?: boolean;
}) {
  if (loadError || !snapshot) {
    return (
      <section className="empty-card core-care-state" role="alert">
        <span className="empty-card__icon empty-card__icon--warning">
          <CircleAlert aria-hidden="true" />
        </span>
        <h1>血糖紀錄暫時無法載入</h1>
        <p>系統不會改查其他分支、使用舊快取或以展示資料補值。</p>
        <a className="button button--secondary" href={`?date=${serviceDate}`}>
          重新載入
        </a>
      </section>
    );
  }

  const rows = snapshot.clients.flatMap<{
    client: BloodGlucoseClientSummary;
    measurement: BloodGlucoseRecord | null;
  }>((client) =>
    client.measurements.length
      ? client.measurements.map((measurement) => ({ client, measurement }))
      : [{ client, measurement: null }],
  );
  const generatedAt = formatTime(snapshot.generatedAt);
  const hasFilters = Boolean(
    selectedClientId || mealContext || measurementStatus !== "all",
  );

  return (
    <>
      <nav aria-label="所在位置" className="context-bar">
        <span>工作台</span>
        <ChevronRight aria-hidden="true" />
        <span>日常照顧</span>
        <ChevronRight aria-hidden="true" />
        <span aria-current="page" className="context-bar__crumb">
          {page.title}
        </span>
      </nav>
      <header className="page-heading core-care-heading">
        <div>
          <p className="eyebrow">專用量測流程・頁面 4</p>
          <h1>{page.title}</h1>
          <p className="page-heading__description">
            保存量測時間、餐食情境、數值、單位與來源；每筆依實際發生時間排序。
          </p>
        </div>
        <form className="core-date-filter" method="get">
          {selectedClientId ? (
            <input name="client" type="hidden" value={selectedClientId} />
          ) : null}
          {mealContext ? (
            <input name="context" type="hidden" value={mealContext} />
          ) : null}
          <input name="status" type="hidden" value={measurementStatus} />
          <label className="field">
            <span>服務日期</span>
            <input defaultValue={serviceDate} name="date" type="date" />
          </label>
          <button className="button button--secondary" type="submit">
            <CalendarDays aria-hidden="true" />套用日期
          </button>
        </form>
      </header>

      <div className="callout core-care-callout">
        <ShieldCheck aria-hidden="true" />
        <span>
          本頁只做量測紀錄與技術格式驗證，不會自動診斷。機構尚未發布的異常門檻、適用量測排程與確認流程不會由系統自行推定。快照更新時間 {generatedAt}。
        </span>
      </div>

      <section aria-label="血糖紀錄摘要" className="metric-grid core-care-metrics">
        {[
          ["符合個案", snapshot.counts.accessibleClients, "人", "目前分支與篩選，不宣稱應量分母"],
          ["已有量測", snapshot.counts.measuredClients, "人", "至少一筆符合情境的有效量測"],
          ["尚無量測", snapshot.counts.unmeasuredClients, "人", "缺值不會計為 0"],
          ["量測紀錄", snapshot.counts.measurements, "筆", "依發生時間排序"],
        ].map(([label, value, unit, foot], index) => (
          <article className="metric-card" key={String(label)}>
            <div className="metric-card__top">
              <span>{label}</span>
              <span className="metric-card__icon">
                {index === 0 ? (
                  <Database aria-hidden="true" />
                ) : index === 1 ? (
                  <CheckCircle2 aria-hidden="true" />
                ) : index === 2 ? (
                  <Clock3 aria-hidden="true" />
                ) : (
                  <Droplets aria-hidden="true" />
                )}
              </span>
            </div>
            <div className="metric-card__value">
              <strong>{value}</strong><span>{unit}</span>
            </div>
            <p className="metric-card__foot">{foot}</p>
          </article>
        ))}
      </section>

      <section className="panel">
        <div className="panel__header">
          <div className="panel__title">
            <h2>{serviceDate} 血糖紀錄</h2>
            <p>{snapshot.counts.measurements} 筆量測・最新有效時間逐筆標示</p>
          </div>
          <BloodGlucoseComposer
            clients={allClients.map((client) => ({
              id: client.clientId,
              name: client.displayName,
              code: client.clientCode,
            }))}
            demo={snapshot.demo}
            enabled={canWrite}
            serviceDate={serviceDate}
          />
        </div>
        <form className="filter-bar" method="get">
          <input name="date" type="hidden" value={serviceDate} />
          <label className="field field--compact">
            <span>個案</span>
            <select defaultValue={selectedClientId ?? "all"} name="client">
              <option value="all">全部個案</option>
              {allClients.map((client) => (
                <option key={client.clientId} value={client.clientId}>
                  {client.displayName}（{client.clientCode}）
                </option>
              ))}
            </select>
          </label>
          <label className="field field--compact">
            <span>量測情境</span>
            <select defaultValue={mealContext ?? "all"} name="context">
              <option value="all">全部情境</option>
              {Object.entries(mealContextLabels).map(([context, label]) => (
                <option key={context} value={context}>{label}</option>
              ))}
            </select>
          </label>
          <label className="field field--compact">
            <span>量測狀態</span>
            <select defaultValue={measurementStatus} name="status">
              <option value="all">全部狀態</option>
              <option value="measured">已有量測</option>
              <option value="unmeasured">尚無量測</option>
            </select>
          </label>
          <button className="button button--secondary" type="submit">套用篩選</button>
          {hasFilters ? (
            <a
              className="button button--ghost"
              href={`/app/staff/daily-care/blood-glucose?date=${serviceDate}`}
            >
              清除篩選
            </a>
          ) : null}
        </form>

        {rows.length ? (
          <>
            <div className="table-wrap core-care-table">
              <table className="data-table">
                <thead>
                  <tr>
                    <th scope="col">個案</th>
                    <th scope="col">量測時間</th>
                    <th scope="col">情境</th>
                    <th scope="col">數值</th>
                    <th scope="col">單位</th>
                    <th scope="col">來源</th>
                    <th scope="col">資料狀態</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map(({ client, measurement }) => {
                    const isLatest = Boolean(
                      measurement &&
                      measurement.measuredAt === client.latestMeasuredAt,
                    );
                    return (
                      <tr key={measurement?.id ?? `${client.clientId}-none`}>
                        <td>
                          <span className="data-table__primary">
                            <span className="avatar" aria-hidden="true">
                              {client.displayName.slice(0, 1)}
                            </span>
                            <span>
                              {client.displayName}
                              <small className="data-table__secondary">{client.clientCode}</small>
                            </span>
                          </span>
                        </td>
                        <td>{formatTime(measurement?.measuredAt ?? null)}</td>
                        <td>{measurement ? mealContextLabels[measurement.mealContext] : "—"}</td>
                        <td>{measurement?.value ?? "—"}</td>
                        <td>{measurement?.unit ?? "—"}</td>
                        <td>{measurement ? sourceLabel(measurement.source) : "—"}</td>
                        <td>
                          <StatusPill status={isLatest ? "最新有效量測" : measurement ? "較早紀錄" : "尚無量測"} />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="mobile-records core-care-mobile">
              {rows.map(({ client, measurement }) => {
                const isLatest = Boolean(
                  measurement && measurement.measuredAt === client.latestMeasuredAt,
                );
                return (
                  <article className="record-card" key={measurement?.id ?? `${client.clientId}-none-mobile`}>
                    <div className="record-card__top">
                      <div>
                        <h3>{client.displayName}</h3>
                        <span className="data-table__secondary">{client.clientCode}</span>
                      </div>
                      <StatusPill status={isLatest ? "最新有效量測" : measurement ? "較早紀錄" : "尚無量測"} />
                    </div>
                    <dl className="core-care-card-grid">
                      <div><dt>量測時間</dt><dd>{formatTime(measurement?.measuredAt ?? null)}</dd></div>
                      <div><dt>情境</dt><dd>{measurement ? mealContextLabels[measurement.mealContext] : "—"}</dd></div>
                      <div><dt>數值</dt><dd>{measurement ? `${measurement.value} ${measurement.unit}` : "—"}</dd></div>
                      <div><dt>來源</dt><dd>{measurement ? sourceLabel(measurement.source) : "—"}</dd></div>
                    </dl>
                  </article>
                );
              })}
            </div>
          </>
        ) : (
          <div className="panel__body">
            <section className="empty-card core-care-state">
              <Droplets aria-hidden="true" />
              <h2>沒有符合條件的血糖紀錄</h2>
              <p>調整日期、個案、情境或量測狀態；尚無量測不會被顯示成 0。</p>
            </section>
          </div>
        )}
      </section>
    </>
  );
}
