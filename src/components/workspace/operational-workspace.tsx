"use client";

import { FormEvent, MouseEvent, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowRight,
  CheckCircle2,
  ChevronRight,
  CircleAlert,
  Download,
  Plus,
  Search,
  ShieldCheck,
  X,
} from "lucide-react";

import type { PageCatalogEntry } from "@/lib/catalog";
import type { DemoRecord } from "@/lib/demo/fixtures";
import { StatusPill } from "@/components/ui/status-pill";

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
    requestAnimationFrame(() => drawerTrigger.current?.focus());
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
          <p className="eyebrow">頁面 {String(page.number).padStart(2, "0")}・{page.riskLevel === "high" ? "高敏感資料" : "工作頁面"}</p>
          <h1>{page.title}</h1>
          <p className="page-heading__description">{page.description}</p>
        </div>
        <div className="page-heading__actions">
          <button className="button button--secondary" disabled title="本頁尚未開放匯出" type="button"><Download aria-hidden="true" />匯出（未開放）</button>
          <button className="button button--primary" disabled={!demo} onClick={openCreate} title={demo ? undefined : "本頁尚未開放新增紀錄"} type="button"><Plus aria-hidden="true" />{demo ? page.primaryActions[0] ?? "新增紀錄" : "新增紀錄（未開放）"}</button>
        </div>
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

      <section className="content-grid">
        <div className="panel">
          <div className="panel__header">
            <div className="panel__title"><h2>工作清單</h2><p>{demo ? `${visibleRecords.length} 筆展示紀錄符合目前條件` : "紀錄與統計尚未提供"}</p></div>
          </div>
          {demo ? <div className="filter-bar">
            <label className="filter-search"><Search aria-hidden="true" /><span className="sr-only">搜尋本頁紀錄</span><input onChange={(event) => setQuery(event.target.value)} placeholder="搜尋個案或負責人…" type="search" value={query} /></label>
            {["全部", "待處理", "需留意", "已完成"].map((status) => (
              <button aria-pressed={selectedStatus === status} className="filter-chip" key={status} onClick={() => setSelectedStatus(status)} style={{ minHeight: 44 }} type="button">{status}</button>
            ))}
          </div> : null}
          {!demo ? (
            <div className="panel__body">
              <section className="empty-card" role="status" aria-labelledby="workspace-unavailable-title">
                <CircleAlert aria-hidden="true" />
                <h2 id="workspace-unavailable-title">本頁尚未開放使用</h2>
                <p>目前無法查看、新增或匯出紀錄，請先使用機構現行紀錄流程；需要協助時請聯絡主管。</p>
                <p>尚未提供統計，不能據此判斷是否有待辦或已完成的紀錄。</p>
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
              <section className="empty-card"><Search aria-hidden="true" /><h2>沒有符合條件的展示紀錄</h2><p>清除篩選，或新增一筆展示草稿練習操作；不會建立正式紀錄。</p><button className="button button--secondary" onClick={() => { setQuery(""); setSelectedStatus("全部"); }} type="button">清除篩選</button></section>
            </div>
          )}
        </div>
        <aside className="panel" aria-label="使用提醒">
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
        </aside>
      </section>

      {demo && drawerOpen ? (
        <RecordDrawer page={page} record={selectedRecord} onClose={closeDrawer} onCreate={createRecord} />
      ) : null}
    </>
  );
}

function RecordDrawer({
  page,
  record,
  onClose,
  onCreate,
}: {
  page: PageCatalogEntry;
  record: DemoRecord | null;
  onClose: () => void;
  onCreate: (data: { clientRef: string; occurredAt: string; note: string }) => Promise<void>;
}) {
  const closeButton = useRef<HTMLButtonElement>(null);
  const dialog = useRef<HTMLElement>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    closeButton.current?.focus();
    function handleKey(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
      if (event.key !== "Tab") return;
      const focusable = Array.from(
        dialog.current?.querySelectorAll<HTMLElement>(
          'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])',
        ) ?? [],
      );
      const first = focusable[0];
      const last = focusable.at(-1);
      if (!first || !last) return;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [onClose]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
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
      setPending(false);
    }
  }

  return (
    <div className="drawer-backdrop" role="presentation">
      <section aria-labelledby="drawer-heading" aria-modal="true" className="drawer" ref={dialog} role="dialog">
        <header className="drawer__header"><div><p className="eyebrow">{record ? "展示紀錄明細" : "建立展示草稿"}</p><h2 id="drawer-heading">{record ? record.primary : page.primaryActions[0] ?? page.title}</h2><p>{page.title}・僅保留在本頁，不會寫入正式紀錄</p></div><button aria-label="關閉" className="icon-button" onClick={onClose} ref={closeButton} type="button"><X /></button></header>
        {record ? (
          <div className="drawer__body"><div className="callout"><ShieldCheck aria-hidden="true" /><span>此為去識別化展示紀錄。正式簽署紀錄只能建立更正版，不能直接覆寫。</span></div><dl>{page.columns.slice(0, 6).map((column, index) => <div className="field" key={column}><dt>{column}</dt><dd>{record.values[index] ?? "—"}</dd></div>)}</dl></div>
        ) : (
          <form className="drawer__form" id="record-form" onSubmit={submit}>
            <div className="drawer__body"><div className="drawer__form"><label className="field"><span>個案 *</span><select defaultValue="陳O華" name="clientRef" required><option>陳O華</option><option>林O英</option><option>黃O生</option></select></label><label className="field"><span>發生日期與時間 *</span><input defaultValue={taipeiDateTimeLocal()} name="occurredAt" required type="datetime-local" /></label><label className="field"><span>紀錄摘要</span><textarea name="note" placeholder="記錄必要觀察與後續行動，不輸入無關個資。" /></label>{error ? <p className="form-error" role="alert">{error}</p> : null}</div></div>
            <footer className="drawer__footer"><button className="button button--secondary" onClick={onClose} type="button">取消</button><button className="button button--primary" disabled={pending} type="submit">{pending ? "儲存中…" : "儲存草稿"}</button></footer>
          </form>
        )}
      </section>
    </div>
  );
}
