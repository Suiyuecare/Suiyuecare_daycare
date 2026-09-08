"use client";

import { FormEvent, MouseEvent, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowRight,
  CheckCircle2,
  ChevronRight,
  CircleAlert,
  Download,
  Filter,
  Plus,
  Search,
  ShieldCheck,
  X,
} from "lucide-react";

import type { PageCatalogEntry } from "@/lib/catalog";
import type { DemoRecord } from "@/lib/demo/fixtures";
import { StatusPill } from "@/components/ui/status-pill";

function metricValue(index: number, total: number) {
  if (index === 0) return String(total);
  if (index === 1) return String(Math.max(1, total - 2));
  if (index === 2) return "2";
  return index % 2 === 0 ? "1" : "3";
}

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
      setNotice("此頁的正式專用表單與個案資料來源尚未接線，因此維持唯讀，避免建立不完整紀錄。");
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
          <button className="button button--secondary" disabled={!demo} title={demo ? undefined : "正式匯出尚未接線"} type="button"><Download aria-hidden="true" />匯出</button>
          <button className="button button--primary" disabled={!demo} onClick={openCreate} title={demo ? undefined : "正式專用表單尚未接線"} type="button"><Plus aria-hidden="true" />{demo ? page.primaryActions[0] ?? "新增紀錄" : "正式表單尚未接線"}</button>
        </div>
      </header>

      {!demo ? (
        <div className="callout" role="status"><CircleAlert aria-hidden="true" /><span>目前完成路由、權限與唯讀工作框架；本頁專用欄位、狀態機及正式寫入尚未驗收，因此不開放新增或匯出。</span></div>
      ) : null}

      {notice ? (
        <div className="callout" role="status"><CheckCircle2 aria-hidden="true" /><span>{notice}</span></div>
      ) : null}

      <section className="metric-grid" aria-label="本頁摘要">
        {page.metrics.slice(0, 4).map((metric, index) => (
          <article className="metric-card" key={metric}>
            <div className="metric-card__top"><span>{metric}</span><span className="metric-card__icon"><CheckCircle2 aria-hidden="true" /></span></div>
            <div className="metric-card__value"><strong>{metricValue(index, records.length)}</strong><span>{index === 0 ? "筆" : "件"}</span></div>
            <p className="metric-card__foot">更新時間：今天 10:24</p>
          </article>
        ))}
      </section>

      <section className="content-grid">
        <div className="panel">
          <div className="panel__header">
            <div className="panel__title"><h2>工作清單</h2><p>{visibleRecords.length} 筆符合目前條件</p></div>
            <button className="button button--quiet" type="button"><Filter aria-hidden="true" />更多篩選</button>
          </div>
          <div className="filter-bar">
            <label className="filter-search"><Search aria-hidden="true" /><span className="sr-only">搜尋本頁紀錄</span><input onChange={(event) => setQuery(event.target.value)} placeholder="搜尋個案或負責人…" type="search" value={query} /></label>
            {["全部", "待處理", "需留意", "已完成"].map((status) => (
              <button aria-pressed={selectedStatus === status} className="filter-chip" key={status} onClick={() => setSelectedStatus(status)} type="button">{status}</button>
            ))}
          </div>
          {visibleRecords.length ? (
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
              <section className="empty-card"><Search aria-hidden="true" /><h2>沒有符合條件的紀錄</h2><p>清除篩選，或使用主要動作建立第一筆紀錄。</p><button className="button button--secondary" onClick={() => { setQuery(""); setSelectedStatus("全部"); }} type="button">清除篩選</button></section>
            </div>
          )}
        </div>
        <aside className="panel" aria-label="頁面規則">
          <div className="panel__header"><div className="panel__title"><h2>工作規則</h2><p>提交前的必要確認</p></div><ShieldCheck aria-hidden="true" /></div>
          <div className="panel__body">
            <div className="callout"><CircleAlert aria-hidden="true" /><span>{page.offline.note}</span></div>
            <h3>驗收重點</h3>
            <ul className="acceptance-list">{page.acceptance.map((item) => <li key={item}>{item}</li>)}</ul>
            <h3>本頁可用篩選</h3>
            <div className="filter-bar">{page.filters.map((filter) => <span className="filter-chip" key={filter}>{filter}</span>)}</div>
          </div>
        </aside>
      </section>

      {drawerOpen ? (
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
        <header className="drawer__header"><div><p className="eyebrow">{record ? "紀錄明細" : "建立草稿"}</p><h2 id="drawer-heading">{record ? record.primary : page.primaryActions[0] ?? page.title}</h2><p>{page.title}・伺服器時間將在送出時寫入</p></div><button aria-label="關閉" className="icon-button" onClick={onClose} ref={closeButton} type="button"><X /></button></header>
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
