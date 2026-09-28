"use client";

import { FormEvent, MouseEvent, useMemo, useRef, useState } from "react";
import {
  ArrowRight,
  CheckCircle2,
  ChevronRight,
  CircleAlert,
  Plus,
  Search,
  ShieldCheck,
  X,
} from "lucide-react";

import type { PageCatalogEntry } from "@/lib/catalog";
import type { DemoRecord } from "@/lib/demo/fixtures";
import { DailyFieldError, DailyValidationSummary, useDailyFormValidation } from "@/components/core-care/daily-form-validation";
import { GovernanceDialog } from "@/components/ui/governance-dialog";
import { StatusPill } from "@/components/ui/status-pill";
import styles from "./operational-workspace.module.css";

function taipeiDateTimeLocal(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  })
    .formatToParts(date)
    .reduce<Record<string, string>>((result, part) => {
      result[part.type] = part.value;
      return result;
    }, {});

  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
}

export function OperationalWorkspace({
  page,
  moduleTitle,
  initialRecords,
  demo,
}: {
  page: PageCatalogEntry;
  moduleTitle: string;
  initialRecords: DemoRecord[];
  demo: boolean;
}) {
  const [records, setRecords] = useState(initialRecords);
  const [query, setQuery] = useState("");
  const [selectedStatus, setSelectedStatus] = useState("全部");
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [selectedRecord, setSelectedRecord] = useState<DemoRecord | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const drawerTrigger = useRef<HTMLButtonElement | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const visibleRecords = useMemo(
    () =>
      records.filter((record) => {
        const matchesQuery = `${record.primary} ${record.secondary} ${record.owner}`
          .toLowerCase()
          .includes(query.toLowerCase());
        const matchesStatus =
          selectedStatus === "全部" || record.status === selectedStatus;
        return matchesQuery && matchesStatus;
      }),
    [query, records, selectedStatus],
  );

  function openCreate(event: MouseEvent<HTMLButtonElement>) {
    if (!demo) {
      setNotice("本頁尚未開放新增紀錄，請先使用機構現行紀錄流程。");
      return;
    }
    drawerTrigger.current = event.currentTarget;
    setSelectedRecord(null);
    setDrawerOpen(true);
  }

  function openRecord(record: DemoRecord, trigger: HTMLButtonElement) {
    drawerTrigger.current = trigger;
    setSelectedRecord(record);
    setDrawerOpen(true);
  }

  function closeDrawer() {
    setDrawerOpen(false);
  }

  async function createRecord(data: {
    clientRef: string;
    occurredAt: string;
    note: string;
  }) {
    if (!demo) {
      throw new Error("PRODUCTION_FORM_NOT_CONNECTED");
    }
    const idempotencyKey = crypto.randomUUID();

    const record: DemoRecord = {
      id: idempotencyKey,
      primary: data.clientRef,
      secondary: data.note || `新增${page.title}`,
      status: "草稿",
      owner: "目前使用者",
      occurredAt: data.occurredAt.slice(11, 16) || "現在",
      values: page.columns.map((column) =>
        column.includes("個案") ? data.clientRef : column.includes("狀態") ? "草稿" : "待補齊",
      ),
    };
    setRecords((current) => [record, ...current]);
    closeDrawer();
    setNotice("展示草稿已加入本頁；重新整理後會復原。");
  }

  return (
    <>
      <nav className="context-bar" aria-label="所在位置">
        <span>工作台</span><ChevronRight aria-hidden="true" /><span>{moduleTitle}</span><ChevronRight aria-hidden="true" /><span aria-current="page" className="context-bar__crumb">{page.title}</span>
      </nav>
      <header className="page-heading">
        <div>
          <p className="eyebrow">{page.moduleId === "assessments" ? "評估量表" : moduleTitle}</p>
          <h1>{page.title}</h1>
          <p className="page-heading__description">{page.description}</p>
        </div>
        {demo ? <div className="page-heading__actions">
          <button className="button button--primary" onClick={openCreate} type="button"><Plus aria-hidden="true" />{page.primaryActions[0] ?? "新增展示紀錄"}</button>
        </div> : null}
      </header>

      {demo ? (
        <div className="callout" role="note"><CircleAlert aria-hidden="true" /><span>展示模式：以下為合成示範紀錄，僅供操作練習，不代表真實個案、正式評估結果或機構統計；新增內容重新整理後會復原。</span></div>
      ) : null}

      {demo && notice ? (
        <div className="callout" role="status"><CheckCircle2 aria-hidden="true" /><span>{notice}</span></div>
      ) : null}

      {demo ? <section className="metric-grid" aria-label="展示清單摘要">
        {[{ label: "展示紀錄", count: records.length }, ...["待處理", "需留意", "已完成"].map((status) => ({
          label: `展示${status}`,
          count: records.filter((record) => record.status === status).length,
        }))].map((metric) => (
          <article className="metric-card" key={metric.label}>
            <div className="metric-card__top"><span>{metric.label}</span><span className="metric-card__icon"><CheckCircle2 aria-hidden="true" /></span></div>
            <div className="metric-card__value"><strong>{metric.count}</strong><span>筆</span></div>
            <p className="metric-card__foot">依本頁全部展示紀錄計算</p>
          </article>
        ))}
      </section> : null}

      <section className={demo ? "content-grid" : "content-grid content-grid--single"}>
        <div className="panel">
          <div className="panel__header">
            <div className="panel__title"><h2>工作清單</h2><p>{demo ? `${visibleRecords.length} 筆展示紀錄符合目前條件` : "紀錄與統計尚未提供"}</p></div>
          </div>
          {demo ? <div className="filter-bar">
            <div className={`filter-search ${styles.filterSearch}`}><Search aria-hidden="true" /><label className="sr-only" htmlFor="demo-record-search">搜尋本頁紀錄</label><input id="demo-record-search" onChange={(event) => setQuery(event.target.value)} placeholder="搜尋個案或負責人…" ref={searchRef} type="search" value={query} />
              {query ? <button aria-label="清除搜尋" className={styles.clearSearch} onClick={() => { setQuery(""); searchRef.current?.focus(); }} type="button"><X aria-hidden="true" /></button> : null}
            </div>
            {["全部", "待處理", "需留意", "已完成"].map((status) => (
              <button aria-pressed={selectedStatus === status} className="filter-chip" key={status} onClick={() => setSelectedStatus(status)} style={{ minHeight: 44 }} type="button">{status}</button>
            ))}
          </div> : null}
          {!demo ? (
            <div className="panel__body">
              <section className="empty-card" role="status" aria-labelledby="workspace-unavailable-title">
                <CircleAlert aria-hidden="true" />
                <h2 id="workspace-unavailable-title">此功能尚未啟用</h2>
                <p>請先使用機構核准的既有表單；此頁尚未啟用。</p>
              </section>
            </div>
          ) : visibleRecords.length ? (
            <>
              <div className="table-wrap">
                <table className="data-table">
                  <thead><tr>{page.columns.slice(0, 5).map((column) => <th key={column} scope="col">{column}</th>)}<th scope="col"><span className="sr-only">動作</span></th></tr></thead>
                  <tbody>
                    {visibleRecords.map((record) => (
                      <tr key={record.id}>
                        {page.columns.slice(0, 5).map((column, index) => (
                          <td key={column}>{index === 0 ? <span className="data-table__primary"><span className="avatar" aria-hidden="true">{record.primary.slice(0, 1)}</span><span>{record.primary}<small className="data-table__secondary">{record.secondary}</small></span></span> : /狀態|風險|異常/.test(column) ? <StatusPill status={record.status} /> : record.values[index] ?? "—"}</td>
                        ))}
                        <td><button aria-label={`查看 ${record.primary}`} className="icon-button" onClick={(event) => openRecord(record, event.currentTarget)} type="button"><ArrowRight /></button></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="mobile-records">
                {visibleRecords.map((record) => (
                  <article className="record-card" key={record.id}>
                    <div className="record-card__top"><div><h3>{record.primary}</h3><span className="data-table__secondary">{record.secondary}</span></div><StatusPill status={record.status} /></div>
                    <div className="record-card__meta"><div><span>負責人</span><strong>{record.owner}</strong></div><div><span>更新時間</span><strong>{record.occurredAt}</strong></div></div>
                    <button className="record-card__action" onClick={(event) => openRecord(record, event.currentTarget)} type="button">查看紀錄<ArrowRight aria-hidden="true" /></button>
                  </article>
                ))}
              </div>
            </>
          ) : (
            <div className="panel__body">
              <section className="empty-card"><Search aria-hidden="true" /><h2>沒有符合條件的展示紀錄</h2><p>清除篩選，或新增一筆展示草稿練習操作；不會建立正式紀錄。</p><button className="button button--secondary" onClick={() => { setQuery(""); setSelectedStatus("全部"); searchRef.current?.focus(); }} type="button">清除篩選</button></section>
            </div>
          )}
        </div>
        {demo ? <aside className="panel" aria-label="使用提醒">
          <div className="panel__header"><div className="panel__title"><h2>使用提醒</h2><p>請勿以此頁取代正式紀錄</p></div><ShieldCheck aria-hidden="true" /></div>
          <div className="panel__body">
            <div className="callout"><CircleAlert aria-hidden="true" /><span>{demo ? "展示草稿僅保留在目前頁面，重新整理後會復原。請勿輸入真實個案資料。" : "本頁尚未開放離線紀錄，也不會自動補存您在其他地方填寫的資料。"}</span></div>
            <details>
              <summary className="button button--quiet">管理參考：預定功能與驗收項目</summary>
              <p>以下為建置目標，不代表功能已完成。</p>
              <h3>驗收重點</h3>
              <ul className="acceptance-list">{page.acceptance.map((item) => <li key={item}>{item}</li>)}</ul>
              <h3>預定支援的篩選</h3>
              <div className="filter-bar">{page.filters.map((filter) => <span className="filter-chip" key={filter}>{filter}</span>)}</div>
              <h3>預定離線範圍</h3>
              <p>{page.offline.note}</p>
            </details>
          </div>
        </aside> : null}
      </section>

      {demo && drawerOpen ? (
        <RecordDrawer page={page} record={selectedRecord} returnFocusRef={drawerTrigger} onClose={closeDrawer} onCreate={createRecord} />
      ) : null}
    </>
  );
}

function RecordDrawer({
  page,
  record,
  returnFocusRef,
  onClose,
  onCreate,
}: {
  page: PageCatalogEntry;
  record: DemoRecord | null;
  returnFocusRef: React.RefObject<HTMLButtonElement | null>;
  onClose: () => void;
  onCreate: (data: { clientRef: string; occurredAt: string; note: string }) => Promise<void>;
}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pendingRef = useRef(false);
  const validation = useDailyFormValidation();

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pendingRef.current || validation.composing.current || !validation.validate(event.currentTarget)) return;
    pendingRef.current = true;
    setPending(true);
    setError(null);
    const formData = new FormData(event.currentTarget);
    try {
      await onCreate({
        clientRef: String(formData.get("clientRef") ?? ""),
        occurredAt: String(formData.get("occurredAt") ?? ""),
        note: String(formData.get("note") ?? ""),
      });
    } catch {
      setError("儲存失敗，您輸入的內容仍保留在畫面上。請稍後再試。");
      pendingRef.current = false;
      setPending(false);
    }
  }

  return (
    <GovernanceDialog open title={record ? record.primary : page.primaryActions[0] ?? page.title}
      busy={pending} onRequestClose={onClose} returnFocusRef={returnFocusRef}>
      {record ? (
        <div className={styles.recordBody}><p>去識別化展示紀錄，非正式個案資料。</p>
          <dl>{page.columns.slice(0, 6).map((column, index) => <div className="field" key={column}><dt>{column}</dt><dd>{record.values[index] ?? "—"}</dd></div>)}</dl>
        </div>
      ) : (
        <form className={styles.demoForm} id="record-form" noValidate onCompositionStart={validation.onCompositionStart}
          onCompositionEnd={validation.onCompositionEnd} onKeyDown={validation.onKeyDown}
          onChange={(event) => { validation.clearChanged(event.target); setError(null); }} onSubmit={submit}>
          <p>僅保留在本頁，不會寫入正式紀錄。</p>
          <fieldset className={styles.fields} disabled={pending}>
            <label className="field"><span id={validation.labelId("clientRef")}>個案 *</span><select defaultValue="" name="clientRef" required {...validation.field("clientRef") }><option value="">請選擇個案</option><option>陳O華</option><option>林O英</option><option>黃O生</option></select><DailyFieldError validation={validation} name="clientRef" /></label>
            <label className="field"><span id={validation.labelId("occurredAt")}>發生日期與時間 *</span><input defaultValue={taipeiDateTimeLocal()} name="occurredAt" required type="datetime-local" {...validation.field("occurredAt") } /><DailyFieldError validation={validation} name="occurredAt" /></label>
            <label className="field"><span id={validation.labelId("note")}>紀錄摘要</span><textarea className={`${styles.demoTextarea} resize-none`} name="note" placeholder="記錄必要觀察與後續行動，不輸入無關個資。" rows={5} {...validation.field("note") } /></label>
          </fieldset>
          <DailyValidationSummary validation={validation} />
          {error ? <p className="form-error" role="alert">{error}</p> : null}
          <div className={styles.actions}><button className="button button--primary" aria-busy={pending} disabled={pending} type="submit">{pending ? "儲存中…" : "儲存草稿"}</button></div>
        </form>
      )}
    </GovernanceDialog>
  );
}
