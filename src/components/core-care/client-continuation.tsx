"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";

import { NavigationLink } from "@/components/app/navigation-link";
import { DAILY_WORKFLOW_STEPS, dailyWorkflowHref, type DailyWorkflowPage } from "@/lib/core-care/workflow-links";
import type { DailyCareSnapshot, DailyClientSummary } from "@/lib/core-care/types";

const discardMessage = "還有尚未確認儲存的內容。確定要離開並放棄這次填寫嗎？";

/** Protect modal cancellation, link/GET navigation and full-document unloads. */
export function useCoreDraftGuard() {
  const dirty = useRef(false);
  const busy = useRef(false);
  useEffect(() => {
    function mayLeave() {
      if (busy.current) return false;
      if (dirty.current && !window.confirm(discardMessage)) return false;
      dirty.current = false;
      return true;
    }
    function unload(event: BeforeUnloadEvent) {
      if (!dirty.current && !busy.current) return;
      event.preventDefault();
      event.returnValue = "";
    }
    function click(event: MouseEvent) {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const link = event.target instanceof Element ? event.target.closest<HTMLAnchorElement>("a[href]") : null;
      if (!link || link.target === "_blank" || link.hasAttribute("download")) return;
      if (new URL(link.href, window.location.href).href === window.location.href) return;
      if (!mayLeave()) { event.preventDefault(); event.stopPropagation(); }
    }
    function submit(event: SubmitEvent) {
      const form = event.target;
      if (!(form instanceof HTMLFormElement) || form.hasAttribute("data-core-care-draft") || form.method.toLowerCase() !== "get") return;
      if (!mayLeave()) { event.preventDefault(); event.stopPropagation(); }
    }
    window.addEventListener("beforeunload", unload);
    document.addEventListener("click", click, true);
    document.addEventListener("submit", submit, true);
    return () => {
      window.removeEventListener("beforeunload", unload);
      document.removeEventListener("click", click, true);
      document.removeEventListener("submit", submit, true);
    };
  }, []);
  return {
    changed() { dirty.current = true; },
    begin() { if (busy.current) return false; busy.current = true; dirty.current = true; return true; },
    finish() { busy.current = false; },
    saved() { dirty.current = false; },
    discard() {
      if (busy.current || (dirty.current && !window.confirm(discardMessage))) return false;
      dirty.current = false;
      return true;
    },
  };
}

function stepStatus(page: DailyWorkflowPage, client: DailyClientSummary) {
  if (page === 46) return !client.attendance || client.attendance.status === "cancelled" ? "待登錄"
    : client.attendance.status === "leave" ? "已請假" : client.attendance.status === "absent" ? "已登記未到"
      : client.attendance.checkedOutAt ? "已簽退" : "已簽到";
  if (page === 3) return client.vitalSigns ? "已有量測" : "待量測";
  return !client.careDiary || client.careDiary.status === "voided" ? "待登錄"
    : client.careDiary.status === "signed" || client.careDiary.status === "corrected" ? "已簽署"
      : client.careDiary.status === "draft" ? "已有草稿・未簽署" : "待簽署";
}

export function ClientContinuation({ page, serviceDate, selectedClientId, clients, sourceAccess, action }: {
  page: DailyWorkflowPage;
  serviceDate: string;
  selectedClientId?: string;
  clients: readonly DailyClientSummary[];
  sourceAccess: DailyCareSnapshot["sourceAccess"];
  action?: ReactNode;
}) {
  const selectId = useId();
  const [choice, setChoice] = useState("");
  const allowedClients = sourceAccess.clients ? clients : [];
  const selected = allowedClients.find((client) => client.clientId === selectedClientId);
  const chosen = allowedClients.find((client) => client.clientId === choice);

  if (!sourceAccess.clients) return <section className="callout core-care-callout" role="status">
    <p>目前沒有個案名單查看權限。請聯絡主管確認授權；這不表示今天沒有個案。</p>
  </section>;

  if (selectedClientId !== undefined && !selected) return <section className="callout core-care-callout" role="alert">
    <p>無法使用指定個案。請重新選擇目前授權的個案，系統不會自動改用其他人。</p>
    <NavigationLink className="button button--secondary" href={dailyWorkflowHref(page, serviceDate)} loadingLabel="個案選擇" prefetch={false}>重新選擇個案</NavigationLink>
  </section>;

  return <section className="panel core-client-continuation" aria-labelledby={`${selectId}-heading`}>
    <div className="panel__header">
      <div className="panel__title"><h2 id={`${selectId}-heading`}>{selected ? `${selected.displayName}的接續工作` : "先選定個案，再接續記錄"}</h2>
        <p>{serviceDate}（臺北時間）{selected ? ` · ${selected.clientCode}` : " · 出勤、量測、日誌沿用同一位個案與日期"}</p></div>
      {selected ? <NavigationLink className="button button--secondary" href={dailyWorkflowHref(page, serviceDate)} loadingLabel="個案選擇" prefetch={false}>更換個案</NavigationLink> : null}
    </div>
    <div className="panel__body">
      {!selected ? allowedClients.length ? <div className="core-client-picker">
        <label className="field" htmlFor={selectId}><span>選擇個案</span><select id={selectId} value={chosen?.clientId ?? ""} onChange={(event) => setChoice(event.target.value)}>
          <option value="">請選擇目前要照顧的個案</option>
          {allowedClients.map((client) => <option key={client.clientId} value={client.clientId}>{client.displayName}（{client.clientCode}）</option>)}
        </select></label>
        {chosen ? <NavigationLink className="button button--primary" href={dailyWorkflowHref(page, serviceDate, chosen.clientId)} loadingLabel={`${chosen.displayName}的工作清單`} prefetch={false}>選定這位個案</NavigationLink>
          : <button className="button button--primary" type="button" disabled>請先選擇個案</button>}
      </div> : <p>這個日期沒有可存取個案。請確認服務日期、分支與個案指派。</p> : null}
      <nav aria-label="個案照顧三步驟"><ol className="core-workflow-steps">
        {DAILY_WORKFLOW_STEPS.map((step, index) => <li key={step.page}>
          {selected && sourceAccess[step.source] ? <NavigationLink
            className={`button ${step.page === page ? "button--primary" : "button--secondary"}`}
            aria-current={step.page === page ? "step" : undefined}
            href={dailyWorkflowHref(step.page, serviceDate, selected.clientId)} loadingLabel={step.label} prefetch={false}>
            <span>{index + 1}. {step.label}</span><small>{stepStatus(step.page, selected)}</small>
          </NavigationLink> : <span className="button button--secondary" aria-disabled="true">
            <span>{index + 1}. {step.label}</span><small>{sourceAccess[step.source] ? "先選定個案" : "無查閱權限"}</small>
          </span>}
        </li>)}
      </ol></nav>
      {selected ? action : null}
      <p className="muted">切換步驟不會自動儲存或簽署；日誌草稿不等於完成照顧紀錄。</p>
    </div>
  </section>;
}
