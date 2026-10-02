"use client";

import { useContext, useEffect, useId, useRef, useState, type ReactNode } from "react";

import { DailyNavigationRegistrationContext, type DailyNavigationScope } from "@/components/app/daily-navigation-context";
import { NavigationLink } from "@/components/app/navigation-link";
import { DAILY_WORKFLOW_STEPS, dailyWorkflowHref, type DailyWorkflowPage, type DailyWorkflowShift } from "@/lib/core-care/workflow-links";
import type { DailyCareSnapshot, DailyClientSummary } from "@/lib/core-care/types";

const discardMessage = "還有尚未確認儲存的內容。確定要離開並放棄這次填寫嗎？";

type DraftGuardState = { dirty: boolean; busy: boolean };

// Several forms can be mounted on one page. A single document listener must
// inspect every guard before asking to leave, or an earlier guard may discard
// its draft before a later busy guard cancels the navigation.
const activeDraftGuards = new Set<DraftGuardState>();
function anyBusy() {
  for (const guard of activeDraftGuards) if (guard.busy) return true;
  return false;
}
function anyDirty() {
  for (const guard of activeDraftGuards) if (guard.dirty) return true;
  return false;
}

function mayLeavePage() {
  if (anyBusy()) return false;
  if (anyDirty() && !window.confirm(discardMessage)) return false;
  // Do not clear dirty here. A Link/onSubmit handler later in the event path
  // can still cancel navigation; unmount or a confirmed save owns cleanup.
  return true;
}

function guardUnload(event: BeforeUnloadEvent) {
  if (!anyDirty() && !anyBusy()) return;
  event.preventDefault();
  event.returnValue = "";
}

function guardLinkClick(event: MouseEvent) {
  if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
  const link = event.target instanceof Element ? event.target.closest<HTMLAnchorElement>("a[href]") : null;
  if (!link || link.target === "_blank" || link.hasAttribute("download")) return;
  if (new URL(link.href, window.location.href).href === window.location.href) return;
  if (!mayLeavePage()) { event.preventDefault(); event.stopPropagation(); }
}

function guardGetSubmit(event: SubmitEvent) {
  const form = event.target;
  if (!(form instanceof HTMLFormElement) || form.hasAttribute("data-core-care-draft") || form.method.toLowerCase() !== "get") return;
  if (!mayLeavePage()) { event.preventDefault(); event.stopPropagation(); }
}

function registerDraftGuard(guard: DraftGuardState) {
  if (activeDraftGuards.size === 0) {
    window.addEventListener("beforeunload", guardUnload);
    document.addEventListener("click", guardLinkClick, true);
    document.addEventListener("submit", guardGetSubmit, true);
  }
  activeDraftGuards.add(guard);
  return () => {
    activeDraftGuards.delete(guard);
    if (activeDraftGuards.size > 0) return;
    window.removeEventListener("beforeunload", guardUnload);
    document.removeEventListener("click", guardLinkClick, true);
    document.removeEventListener("submit", guardGetSubmit, true);
  };
}

/** Protect modal cancellation, link/GET navigation and full-document unloads. */
export function useCoreDraftGuard() {
  const guard = useRef<DraftGuardState>({ dirty: false, busy: false });
  useEffect(() => registerDraftGuard(guard.current), []);
  return {
    changed() { guard.current.dirty = true; },
    begin() { if (guard.current.busy) return false; guard.current.busy = true; guard.current.dirty = true; return true; },
    finish() { guard.current.busy = false; },
    saved() { guard.current.dirty = false; },
    discard() {
      if (anyBusy() || (guard.current.dirty && !window.confirm(discardMessage))) return false;
      guard.current.dirty = false;
      return true;
    },
  };
}

function stepStatus(page: DailyWorkflowPage, client: DailyClientSummary, shift?: DailyWorkflowShift) {
  const existing = page === 46 ? client.attendance : page === 3 ? client.vitalSigns : client.careDiary;
  const applicability = page === 46 ? client.applicability?.attendance : client.applicability?.care;
  if (!existing && applicability === "not_expected") return "本日不列待填";
  if (!existing && applicability === "unknown") return "適用性待確認";
  if (page === 46) return !client.attendance || client.attendance.status === "cancelled" ? "待登錄"
    : client.attendance.status === "leave" ? "已請假" : client.attendance.status === "absent" ? "已登記未到"
      : client.attendance.checkedOutAt ? "已簽退" : "已簽到";
  // The daily snapshot is not shift-scoped evidence. Do not let a morning
  // measurement/signature look like completion of an afternoon task.
  if (shift && page === 3) return client.vitalSigns ? "當日有量測・請核對班別" : "待量測";
  if (shift && page === 6 && client.careDiary && ["signed", "corrected"].includes(client.careDiary.status)) return "當日有簽署・請核對班別";
  if (page === 3) return client.vitalSigns ? "已有量測" : "待量測";
  return !client.careDiary || client.careDiary.status === "voided" ? "待登錄"
    : client.careDiary.status === "signed" || client.careDiary.status === "corrected" ? "已簽署"
      : client.careDiary.status === "draft" ? "已有草稿・未簽署" : "待簽署";
}

export function ClientContinuation({ page, serviceDate, selectedClientId, selectedShift, validatedScope, clients, sourceAccess, action }: {
  page: DailyWorkflowPage;
  serviceDate: string;
  selectedClientId?: string;
  selectedShift?: DailyWorkflowShift;
  validatedScope?: DailyNavigationScope;
  clients: readonly DailyClientSummary[];
  sourceAccess: DailyCareSnapshot["sourceAccess"];
  action?: ReactNode;
}) {
  const selectId = useId();
  const [choice, setChoice] = useState("");
  const allowedClients = sourceAccess.clients ? clients : [];
  const selected = allowedClients.find((client) => client.clientId === selectedClientId);
  const chosen = allowedClients.find((client) => client.clientId === choice);
  const registerDailyNavigation = useContext(DailyNavigationRegistrationContext);
  const pageSource = page === 3 ? "measurements" : page === 6 ? "careDiaries" : "attendance";
  const registerClientId = sourceAccess[pageSource] && sourceAccess.measurements &&
    selected?.sourceAccess?.[pageSource] !== false && selected?.sourceAccess?.measurements !== false
      ? selected?.clientId : undefined;
  const organizationId = validatedScope?.organizationId;
  const branchId = validatedScope?.branchId;
  const userId = validatedScope?.userId;

  useEffect(() => {
    if (!registerDailyNavigation || !registerClientId || !organizationId || !branchId || !userId) return;
    return registerDailyNavigation({ page, serviceDate, clientId: registerClientId, shift: selectedShift,
      scope: { organizationId, branchId, userId } });
  }, [registerDailyNavigation, registerClientId, page, serviceDate, selectedShift, organizationId, branchId, userId]);

  if (!sourceAccess.clients) return <section className="callout core-care-callout" role="status">
    <p>目前沒有個案名單查看權限。請聯絡主管確認授權；這不表示今天沒有個案。</p>
  </section>;

  if (selectedClientId !== undefined && !selected) return <section className="callout core-care-callout" role="alert">
    <p>無法使用指定個案。請重新選擇目前授權的個案，系統不會自動改用其他人。</p>
    <NavigationLink className="button button--secondary" href={dailyWorkflowHref(page, serviceDate, undefined, selectedShift)} loadingLabel="個案選擇" prefetch={false}>重新選擇個案</NavigationLink>
  </section>;

  return <section className={`panel core-client-continuation${selected ? " core-client-continuation--selected" : ""}`} aria-labelledby={`${selectId}-heading`}>
    <div className="panel__header">
      <div className="panel__title"><h2 id={`${selectId}-heading`}>{selected ? `${selected.displayName}的接續工作` : "先選定個案，再接續記錄"}</h2>
        <p>{serviceDate}（臺北時間）{selectedShift ? ` · ${{ morning: "上午", afternoon: "下午", full_day: "全日" }[selectedShift]}` : ""}{selected ? ` · ${selected.clientCode}` : " · 出勤、量測、日誌沿用同一位個案與日期"}</p></div>
      {selected ? <NavigationLink className="button button--secondary" href={dailyWorkflowHref(page, serviceDate, undefined, selectedShift)} loadingLabel="個案選擇" prefetch={false}>更換個案</NavigationLink> : null}
    </div>
    <div className="panel__body">
      {!selected ? allowedClients.length ? <div className="core-client-picker">
        <label className="field" htmlFor={selectId}><span>選擇個案</span><select id={selectId} value={chosen?.clientId ?? ""} onChange={(event) => setChoice(event.target.value)}>
          <option value="">請選擇目前要照顧的個案</option>
          {allowedClients.map((client) => <option key={client.clientId} value={client.clientId}>{client.displayName}（{client.clientCode}）</option>)}
        </select></label>
        {chosen ? <NavigationLink className="button button--primary" href={dailyWorkflowHref(page, serviceDate, chosen.clientId, selectedShift)} loadingLabel={`${chosen.displayName}的工作清單`} prefetch={false}>選定這位個案</NavigationLink>
          : <button className="button button--primary" type="button" disabled>請先選擇個案</button>}
      </div> : <p>這個日期沒有可存取個案。請確認服務日期、分支與個案指派。</p> : null}
      {selected ? action : null}
      <nav aria-label="個案照顧三步驟"><ol className="core-workflow-steps">
        {DAILY_WORKFLOW_STEPS.map((step, index) => <li key={step.page}>
          {selected && sourceAccess[step.source] && selected.sourceAccess?.[step.source] !== false ? <NavigationLink
            className={`button ${step.page === page ? "button--primary" : "button--secondary"}`}
            aria-current={step.page === page ? "step" : undefined}
            href={dailyWorkflowHref(step.page, serviceDate, selected.clientId, selectedShift)} loadingLabel={step.label} prefetch={false}>
            <span>{index + 1}. {step.label}</span><small>{stepStatus(step.page, selected, selectedShift)}</small>
          </NavigationLink> : <span className="button button--secondary" aria-disabled="true">
            <span>{index + 1}. {step.label}</span><small>{sourceAccess[step.source] && selected?.sourceAccess?.[step.source] !== false ? "先選定個案" : "無查閱權限"}</small>
          </span>}
        </li>)}
      </ol></nav>
      {selected && sourceAccess.careDiaries && selected.sourceAccess?.careDiaries !== false ? <NavigationLink
        className="button button--secondary" href={`/app/client-forms?client=${selected.clientId}`} loadingLabel="個案表單填答" prefetch={false}>
        此個案的機構自訂表單
      </NavigationLink> : null}
      <p className="muted">切換步驟不會自動儲存或簽署；日誌草稿不等於完成照顧紀錄。</p>
    </div>
  </section>;
}
