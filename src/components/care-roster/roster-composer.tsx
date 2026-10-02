"use client";

import { useEffect, useLayoutEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ROSTER_TASK_LABELS, type CareRosterSnapshot, type CareRosterAssignment, type RosterTaskKind, type RosterShift } from "@/lib/care-roster/types";
import type { DailyCareSnapshot } from "@/lib/core-care/types";
import styles from "./care-roster.module.css";
import { CoreDraftConfirmation, useCoreDraftGuard } from "@/components/core-care/client-continuation";
import { fetchWithTimeout } from "@/lib/api/client-fetch";
import { rosterInputSchema, type RosterInput } from "@/lib/care-roster/parser";
import { parseRosterWriteOutcome, type RosterReceipt } from "@/lib/care-roster/write-contract";
import { tryAcquirePendingOperation, tryAcquireViewTransition } from "@/lib/navigation/pending-operation-lock";

type PendingOperation = { input: RosterInput; body: string; hadUnknown: boolean };
const eligibilityLabel = (row: CareRosterAssignment) => row.serviceEligibility === "not_admitted" ? "未正式收案" : "當日不在服務期間";

/** Read-only shortcut; the existing composer remains mounted below the daily list. */
export function RosterExceptionEntry({ blockedCount, unassignedCount, canOpenComposer, previewOnly = false }: {
  blockedCount: number; unassignedCount: number; canOpenComposer: boolean; previewOnly?: boolean;
}) {
  function openException(sectionId: string) {
    const composer = document.getElementById("today-roster-composer");
    if (!(composer instanceof HTMLDetailsElement)) return;
    composer.open = true;
    const section = document.getElementById(sectionId);
    const target = section instanceof HTMLElement ? section : composer.querySelector<HTMLElement>("summary");
    target?.focus({ preventScroll: true });
    target?.scrollIntoView?.({ behavior: "smooth", block: "start" });
  }
  if (!blockedCount && !unassignedCount) return null;
  return <section className={styles.exceptionEntry} aria-label="主管分工待處理">
    <strong>分工待處理</strong>
    {blockedCount > 0 && (canOpenComposer ? <button className="button button--secondary" type="button" onClick={() => openException("today-roster-blocked")}>不適用待核對 {blockedCount} 班</button>
      : <span>不適用待核對 {blockedCount} 班</span>)}
    {unassignedCount > 0 && (canOpenComposer ? <button className="button button--secondary" type="button" onClick={() => openException("today-roster-unassigned")}>待指派 {unassignedCount} 班</button>
      : <span>待指派 {unassignedCount} 班</span>)}
    {previewOnly ? <small>合成展示・不寫入</small> : !canOpenComposer ? <small>請由具排班權限的主管處理。</small> : null}
  </section>;
}

export function RosterComposer({ roster, clients, serviceDate, canWriteRoster, authorityKey }: {
  roster?: CareRosterSnapshot; clients: DailyCareSnapshot["clients"]; serviceDate: string;
  canWriteRoster: boolean; authorityKey?: string;
}) {
  const sourceUnavailable = !roster || roster.status === "unavailable";
  const sourceReady = Boolean(roster?.manager && (roster.status === "ready" || roster.status === "empty"));
  const [cached, setCached] = useState(() => ({ observed: roster, retained: sourceReady ? roster : undefined }));
  if (cached.observed !== roster) {
    // Retain a draft only through an unknown read. An authoritative nonmanager
    // snapshot must drop previously visible client details immediately.
    setCached({ observed: roster, retained: sourceReady ? roster : sourceUnavailable ? cached.retained : undefined });
  }
  const editorRoster = sourceReady ? roster : sourceUnavailable ? cached.retained : undefined;
  if (!editorRoster || (!canWriteRoster && !editorRoster.demo)) return null;
  return <RosterEditor roster={editorRoster} liveRoster={roster} sourceReady={sourceReady}
    canWriteRoster={canWriteRoster} authorityKey={authorityKey} clients={clients} serviceDate={serviceDate} />;
}

function RosterEditor({ roster, liveRoster, sourceReady, canWriteRoster, authorityKey, clients, serviceDate }: {
  roster: CareRosterSnapshot; liveRoster?: CareRosterSnapshot; sourceReady: boolean;
  canWriteRoster: boolean; authorityKey?: string;
  clients: DailyCareSnapshot["clients"]; serviceDate: string;
}) {
  const router = useRouter();
  const [clientId, setClientId] = useState("");
  const [shift, setShift] = useState<RosterShift>("morning");
  // Keep the version the supervisor actually opened; background refresh must
  // not silently replace typed content or upgrade its optimistic-lock baseline.
  const [previous, setPrevious] = useState<CareRosterAssignment | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [operation, setOperation] = useState<PendingOperation | null>(null);
  const [needsReload, setNeedsReload] = useState(false);
  const [needsReauth, setNeedsReauth] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [savedReceipt, setSavedReceipt] = useState<RosterReceipt | null>(null);
  const [refreshPending, startRefreshTransition] = useTransition();
  const [refreshAttempt, setRefreshAttempt] = useState(0);
  const [focusRequest, setFocusRequest] = useState<{ id: string } | null>(null);
  const focusedRequest = useRef<typeof focusRequest>(null);
  const readBack = sourceReady && confirmed && savedReceipt && serviceDate === savedReceipt.serviceDate && !roster.demo && liveRoster?.manager
    ? liveRoster.assignments.find((row) => row.id === savedReceipt.id && row.clientId === savedReceipt.clientId
      && row.shift === savedReceipt.shift && row.version === savedReceipt.version) ?? null : null;
  const awaitingReadBack = confirmed && !readBack;
  const currentPrevious = readBack && readBack.clientId === clientId && readBack.shift === shift ? readBack : previous;
  const currentSource = useRef({ roster: liveRoster, serviceDate });
  const clientSelectRef = useRef<HTMLSelectElement>(null);
  useLayoutEffect(() => { currentSource.current = { roster: liveRoster, serviceDate }; });
  const draftGuard = useCoreDraftGuard({
    scopeKey: `roster:${serviceDate}:${authorityKey ?? "direct"}`,
    isBlocked: () => busy || Boolean(operation?.hadUnknown),
    onDiscard: () => { setPrevious(null); setMessage(""); },
  });
  useEffect(() => {
    if (!focusRequest || focusedRequest.current === focusRequest || draftGuard.open || previous?.id !== focusRequest.id) return;
    // The discard dialog must finish closing/restoring focus before we move
    // keyboard users into the already-selected editor.
    clientSelectRef.current?.focus({ preventScroll: true });
    clientSelectRef.current?.scrollIntoView?.({ block: "nearest" });
    focusedRequest.current = focusRequest;
  }, [focusRequest, draftGuard.open, previous]);
  const mounted = useRef(true);
  const lock = useRef(false);
  const operationLease = useRef<(() => void) | null>(null);
  const viewLease = useRef<(() => void) | null>(null);
  const unresolvedOperation = useRef(false);
  function releaseKnownOperation() {
    operationLease.current?.(); operationLease.current = null;
    unresolvedOperation.current = false;
  }
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      // An unmounted request may already have committed. Its opaque shared lock
      // must not silently disappear before a definite result is received.
      if (!unresolvedOperation.current) {
        operationLease.current?.(); operationLease.current = null;
      }
      viewLease.current?.(); viewLease.current = null;
    };
  }, []);
  useEffect(() => {
    if (!refreshPending && viewLease.current) { viewLease.current(); viewLease.current = null; }
  }, [refreshPending, refreshAttempt]);
  function refreshSavedRoster() {
    if (!mounted.current) return;
    const release = tryAcquireViewTransition();
    if (!release) {
      setMessage("每日分工已確認儲存；另有操作尚待確認或畫面正在更新，請完成後再讀取最新分工清單，不要重送本筆。"); return;
    }
    viewLease.current = release;
    setRefreshAttempt((attempt) => attempt + 1);
    startRefreshTransition(() => {
      try { return router.refresh(); } catch {
        release(); viewLease.current = null;
        setMessage("每日分工已確認儲存，但最新清單尚未讀回。請讀取最新分工清單，不要重送本筆。");
      }
    });
  }
  function reloadRoster() {
    if (!mounted.current) return;
    const release = tryAcquireViewTransition();
    if (!release) {
      setMessage(confirmed ? "每日分工已確認儲存；另有操作尚待確認或畫面正在更新，請完成後再讀取最新分工清單，不要重送本筆。"
        : "另有操作尚待確認或畫面正在更新，請完成後再重新載入並人工核對。"); return;
    }
    viewLease.current = release;
    try { draftGuard.saved(); window.location.reload(); } catch {
      release(); viewLease.current = null;
      setMessage(confirmed ? "每日分工已確認儲存，但最新清單尚未讀回。請讀取最新分工清單，不要重送本筆。" : "清單未能重新載入，請稍後再人工核對；不要直接重送分工。");
    }
  }
  const canEdit = sourceReady && (canWriteRoster || roster.demo);
  const locked = !canEdit || busy || refreshPending || Boolean(operation?.hadUnknown) || needsReload || awaitingReadBack;
  const blocked = currentPrevious && !currentPrevious.isServiceEligible;
  const cannotCreate = Boolean(clientId && !currentPrevious && !clients.some((client) => client.clientId === clientId));
  const blockedAssignments = sourceReady && roster.status === "ready" ? roster.assignments.filter((row) => row.state === "scheduled" && !row.isServiceEligible) : [];
  const unassignedAssignments = sourceReady && roster.status === "ready" ? roster.assignments.filter((row) => row.state === "scheduled" && row.isServiceEligible && !row.staffUserId) : [];
  const choices = new Map(clients.map((client) => [client.clientId, { id: client.clientId, displayName: client.displayName, clientCode: client.clientCode }]));
  for (const row of blockedAssignments) if (!choices.has(row.clientId) && row.clientIdentity) {
    choices.set(row.clientId, { id: row.clientId, ...row.clientIdentity });
  }
  function selectAssignment(row: CareRosterAssignment) {
    if (locked || !choices.has(row.clientId)) return;
    if (currentPrevious?.id === row.id && currentPrevious.version === row.version && clientId === row.clientId && shift === row.shift) {
      clientSelectRef.current?.focus({ preventScroll: true });
      clientSelectRef.current?.scrollIntoView?.({ block: "nearest" });
      return;
    }
    draftGuard.requestDiscard(() => {
      const source = currentSource.current;
      if (!mounted.current || !source.roster?.manager || source.roster.status !== "ready" || source.serviceDate !== serviceDate ||
          !source.roster.assignments.some((current) => current.id === row.id && current.version === row.version)) {
        setMessage("分工來源已更新，請重新選擇要處理的個案。"); return;
      }
      setClientId(row.clientId); setShift(row.shift); setPrevious(row); setMessage(""); setNeedsReauth(false);
      setFocusRequest({ id: row.id });
    });
  }
  return <><details className={`panel today-management ${styles.composer}`} id="today-roster-composer"><summary>
    <span className={styles.summaryLine}><strong>主管每日分工</strong><span>{!sourceReady ? "來源待更新・草稿保留" : blockedAssignments.length || unassignedAssignments.length
      ? [blockedAssignments.length ? `不適用待核對 ${blockedAssignments.length} 班` : null,
        unassignedAssignments.length ? `待指派 ${unassignedAssignments.length} 班` : null].filter(Boolean).join("・") : "安排／調整分工"}</span></span>
  </summary>
    {!sourceReady && <p role="status">每日分工暫時無法確認，已保留未送草稿；請更新清單後再核對，現在不能儲存。</p>}
    <p>已核准的主管 Google 帳號可依已確認的照顧計畫安排上午／下午工作。儲存時重新核對分支、主管權限與人員的個案授權；分工不取代人員資格與工時排班審核。</p>
    {blockedAssignments.length > 0 && <section className={styles.blocked} id="today-roster-blocked" tabIndex={-1} aria-label="不適用服務的既有分工">
      <h3>先處理不適用的既有分工</h3><p>以下分工仍保留原安排，沒有自動取消；不列入今日待辦，也不顯示照顧紀錄。請核對個案後，填寫理由取消安排。</p>
      <ul>{blockedAssignments.map((row) => {
        const identity = choices.get(row.clientId);
        return <li key={row.id}><div><strong>{identity ? `${identity.displayName}（${identity.clientCode}）` : "個案識別暫無法確認"}</strong>
          <p>{row.serviceDate}・{row.shift === "morning" ? "上午" : "下午"}・{eligibilityLabel(row)}・原安排尚未取消</p></div>
          {identity ? <button className="button button--secondary" type="button" disabled={locked} onClick={() => selectAssignment(row)}
            aria-label={`檢查並取消 ${identity.displayName} ${row.shift === "morning" ? "上午" : "下午"}分工`}>檢查並取消</button>
            : <p>請先由管理員確認個案查閱權限；不可僅憑分工代號取消。</p>}</li>;
      })}</ul>
    </section>}
    {unassignedAssignments.length > 0 && <section className={styles.unassigned} id="today-roster-unassigned" tabIndex={-1} aria-label="待指派的既有分工">
      <h3>待指派班別</h3><p>這些班別已有安排，但尚未指定負責人；請選擇原分工核對後儲存。</p>
      <ul>{unassignedAssignments.map((row) => {
        const identity = choices.get(row.clientId);
        return <li key={row.id}><div><strong>{identity ? `${identity.displayName}（${identity.clientCode}）` : "個案識別暫無法確認"}</strong>
          <p>{row.serviceDate}・{row.shift === "morning" ? "上午" : "下午"}・尚未指派負責人</p></div>
          {identity ? <button className="button button--secondary" type="button" disabled={locked} onClick={() => selectAssignment(row)}
            aria-label={`指派 ${identity.displayName} ${row.shift === "morning" ? "上午" : "下午"}分工的負責人`}>選擇負責人</button>
            : <p>請先由管理員確認個案查閱權限；不可僅憑分工代號指派。</p>}</li>;
      })}</ul>
    </section>}
    <form data-core-care-draft noValidate onChange={() => draftGuard.changed()} onSubmit={async (event) => {
      event.preventDefault();
      if (lock.current || !sourceReady || !canWriteRoster || refreshPending || awaitingReadBack || needsReload || roster.demo || !clientId || cannotCreate) return;
      let pending = operation;
      if (pending && pending.input.serviceDate !== serviceDate) {
        setMessage("目前日期與尚待確認的原分工不同；請先回原日期核對，不可在新日期重送。"); return;
      }
      if (!pending) {
        operationLease.current = tryAcquirePendingOperation();
        if (!operationLease.current) {
          setMessage("清單正在更新或分支正在切換，請完成後再送出；尚未建立本筆操作。"); return;
        }
        try {
          const form = new FormData(event.currentTarget);
          const rawInput = { clientId, serviceDate, shift, staffUserId: blocked ? null : String(form.get("staffUserId") || "") || null,
            expectedVersion: currentPrevious?.version ?? 0, state: form.get("state"), sourceNote: String(form.get("sourceNote") || "").trim(),
            tasks: blocked ? currentPrevious.tasks.map((task) => task.kind) : form.getAll("task"), approved: form.get("approved") === "on",
            idempotency_key: crypto.randomUUID() };
          const parsed = rosterInputSchema.safeParse(rawInput);
          if (!parsed.success || (blocked && parsed.data.state !== "cancelled")) {
            releaseKnownOperation(); setMessage("請核對個案、取消安排、具體理由與確認勾選。"); return;
          }
          pending = { input: parsed.data, body: JSON.stringify(parsed.data), hadUnknown: false };
        } catch {
          releaseKnownOperation(); setMessage("無法建立本筆操作，尚未送出。請核對輸入後再試。"); return;
        }
      }
      unresolvedOperation.current = true;
      setOperation(pending);
      if (!draftGuard.begin()) { releaseKnownOperation(); return; }
      lock.current = true; setBusy(true); setMessage(""); setNeedsReauth(false);
      try {
        const response = await fetchWithTimeout("/api/care-roster", { method: "POST", cache: "no-store", headers: { "Content-Type": "application/json", "x-care-roster-action": "approve_assignment" }, body: pending.body });
        const outcome = parseRosterWriteOutcome(await response.json().catch(() => null), response.status, pending.input);
        if (outcome.kind === "success") {
          releaseKnownOperation();
          if (!mounted.current) return;
          setOperation(null); draftGuard.saved(); setSavedReceipt(outcome.receipt); setConfirmed(true);
          setMessage("每日分工已確認儲存。請讀取最新清單後再進行下一筆；不要重送本筆。這不代表工作已執行。");
          refreshSavedRoster();
          return;
        }
        if (outcome.kind === "rejected" && !pending.hadUnknown) {
          releaseKnownOperation();
          if (!mounted.current) return;
          setOperation(null); setNeedsReload(outcome.needsReload); setNeedsReauth(outcome.needsReauth); setMessage(outcome.message); return;
        }
        if (!mounted.current) return;
        setOperation({ ...pending, hadUnknown: true });
        setMessage("儲存結果仍未知，輸入已鎖定。請以原內容重試確認，不要改選個案、班別或另建分工。後續拒絕也不代表前一次未完成。");
      } catch {
        if (!mounted.current) return;
        setOperation({ ...pending, hadUnknown: true });
        setMessage("連線中斷，儲存結果未知。輸入已鎖定，請以原內容重試確認。");
      }
      finally { lock.current = false; if (mounted.current) { draftGuard.finish(); setBusy(false); } }
    }}>
      <div className="form-grid">
        <label className="field"><span>個案</span><select ref={clientSelectRef} required value={clientId} disabled={locked} onChange={(e) => {
          e.stopPropagation();
          if (locked) return;
          const nextClientId = e.target.value;
          const expected = roster.assignments.find((row) => row.clientId === nextClientId && row.shift === shift) ?? null;
          draftGuard.requestDiscard(() => {
            if (!mounted.current) return;
            const source = currentSource.current;
            const latest = source.roster?.assignments.find((row) => row.clientId === nextClientId && row.shift === shift) ?? null;
            if (!source.roster?.manager || source.roster.status !== "ready" || source.serviceDate !== serviceDate || latest?.id !== expected?.id || latest?.version !== expected?.version) {
              setMessage("分工來源已更新，請重新選擇要處理的個案。"); return;
            }
            setClientId(nextClientId);
            setPrevious(latest);
            setMessage("");
          });
        }}><option value="">選擇個案</option>{Array.from(choices.values()).map((client) => <option key={client.id} value={client.id}>{client.displayName}（{client.clientCode}）</option>)}</select></label>
        <label className="field"><span>班別</span><select value={shift} disabled={locked} onChange={(e) => {
          e.stopPropagation();
          if (locked) return;
          const nextShift = e.target.value as RosterShift;
          const expected = roster.assignments.find((row) => row.clientId === clientId && row.shift === nextShift) ?? null;
          draftGuard.requestDiscard(() => {
            if (!mounted.current) return;
            const source = currentSource.current;
            const latest = source.roster?.assignments.find((row) => row.clientId === clientId && row.shift === nextShift) ?? null;
            if (!source.roster?.manager || source.roster.status !== "ready" || source.serviceDate !== serviceDate || latest?.id !== expected?.id || latest?.version !== expected?.version) {
              setMessage("分工來源已更新，請重新選擇要處理的班別。"); return;
            }
            setShift(nextShift);
            setPrevious(latest);
            setMessage("");
          });
        }}><option value="morning">上午（00:00–12:00）</option><option value="afternoon">下午（12:00–24:00）</option></select></label>
      </div>
      {cannotCreate && <p role="alert">此個案尚不可安排當日服務，這個班別也沒有可取消的既有分工。請先確認正式收案與服務期間。</p>}
      <fieldset key={`${clientId}:${shift}:${currentPrevious?.version ?? 0}`} disabled={locked || !clientId || cannotCreate} className="form-grid">
        <legend>{currentPrevious ? `調整第 ${currentPrevious.version} 版，儲存後保留歷史` : "建立每日分工"}</legend>
        {blocked ? <p>{eligibilityLabel(currentPrevious)}：只可取消這筆既有安排，不會改寫過往人員與照顧紀錄，也不會自動正式收案。</p>
          : <label className="field"><span>負責人</span><select name="staffUserId" defaultValue={currentPrevious?.staffUserId ?? ""}><option value="">待指派（主管需後續安排）</option>{roster.staffOptions.map((staff) => <option key={staff.userId} value={staff.userId}>{staff.name}</option>)}</select></label>}
        <label className="field"><span>服務安排</span><select required name="state" defaultValue={blocked ? "" : currentPrevious?.state ?? "scheduled"}>{blocked ? <option value="">請選擇取消安排</option> : <option value="scheduled">安排服務</option>}<option value="cancelled">取消安排</option></select></label>
        {!blocked && <fieldset><legend>此班別應記錄項目（依個案需要勾選）</legend>{(Object.keys(ROSTER_TASK_LABELS) as RosterTaskKind[]).map((kind) => <label key={kind} className="checkbox-field"><input type="checkbox" name="task" value={kind} defaultChecked={currentPrevious?.tasks.some((task) => task.kind === kind) ?? false} />{ROSTER_TASK_LABELS[kind]}</label>)}</fieldset>}
        <label className="field"><span>安排依據／異動理由</span><input name="sourceNote" minLength={3} maxLength={300} required defaultValue={currentPrevious?.sourceNote ?? ""} placeholder="例如：已核准計畫日期、工作需要；異動請說明" /></label>
        <label className="checkbox-field"><input type="checkbox" name="approved" required />我已確認照顧計畫、個案需要及人員安排；不是直接採用自動建議。</label>
      </fieldset>
      <button className="button button--primary" type="submit" disabled={!sourceReady || !canWriteRoster || busy || refreshPending || roster.demo || !clientId || needsReload || awaitingReadBack || cannotCreate}>{busy ? "儲存中…" : roster.demo ? "合成展示，不寫入資料" : operation?.hadUnknown ? "以原內容重試確認" : "確認並儲存分工"}</button>
      {(message || readBack) && <p role="status">{readBack ? "已讀取最新分工，可繼續安排下一筆。" : message}</p>}
      {(needsReload || awaitingReadBack) && <button className="button button--secondary" type="button" disabled={refreshPending} onClick={() => {
        if (awaitingReadBack) refreshSavedRoster();
        else draftGuard.requestDiscard(reloadRoster);
      }}>{confirmed ? "讀取最新分工清單" : "重新載入並人工核對"}</button>}
      {needsReauth && <Link href="/mfa?audience=staff&purpose=sensitive-action">完成近期身分確認後再操作</Link>}
    </form>
  </details><CoreDraftConfirmation draft={draftGuard} /></>;
}
