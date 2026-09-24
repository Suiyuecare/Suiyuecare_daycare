"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ROSTER_TASK_LABELS, type CareRosterSnapshot, type CareRosterAssignment, type RosterTaskKind, type RosterShift } from "@/lib/care-roster/types";
import type { DailyCareSnapshot } from "@/lib/core-care/types";
import styles from "./care-roster.module.css";
import { useCoreDraftGuard } from "@/components/core-care/client-continuation";
import { fetchWithTimeout } from "@/lib/api/client-fetch";
import { rosterInputSchema, type RosterInput } from "@/lib/care-roster/parser";
import { parseRosterWriteOutcome } from "@/lib/care-roster/write-contract";
import { tryAcquirePendingOperation, tryAcquireViewTransition } from "@/lib/navigation/pending-operation-lock";

type PendingOperation = { input: RosterInput; body: string; hadUnknown: boolean };
const eligibilityLabel = (row: CareRosterAssignment) => row.serviceEligibility === "not_admitted" ? "未正式收案" : "當日不在服務期間";

export function RosterComposer({ roster, clients, serviceDate }: {
  roster: CareRosterSnapshot; clients: DailyCareSnapshot["clients"]; serviceDate: string;
}) {
  const router = useRouter();
  const draftGuard = useCoreDraftGuard();
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
  const [refreshPending, startRefreshTransition] = useTransition();
  const [refreshAttempt, setRefreshAttempt] = useState(0);
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
  if (!roster.manager) return null;
  const locked = busy || Boolean(operation?.hadUnknown) || needsReload || confirmed;
  const blocked = previous && !previous.isServiceEligible;
  const cannotCreate = Boolean(clientId && !previous && !clients.some((client) => client.clientId === clientId));
  const blockedAssignments = roster.assignments.filter((row) => row.state === "scheduled" && !row.isServiceEligible);
  const choices = new Map(clients.map((client) => [client.clientId, { id: client.clientId, displayName: client.displayName, clientCode: client.clientCode }]));
  for (const row of blockedAssignments) if (!choices.has(row.clientId) && row.clientIdentity) {
    choices.set(row.clientId, { id: row.clientId, ...row.clientIdentity });
  }
  function selectAssignment(row: CareRosterAssignment) {
    if (locked || !choices.has(row.clientId) || !draftGuard.discard()) return;
    setClientId(row.clientId); setShift(row.shift); setPrevious(row); setMessage(""); setNeedsReauth(false);
  }
  return <details className={`panel today-management ${styles.composer}`}><summary>主管：安排／調整每日照顧分工</summary>
    <p>已核准的主管 Google 帳號可依已確認的照顧計畫安排上午／下午工作。儲存時重新核對分支、主管權限與人員的個案授權；分工不取代人員資格與工時排班審核。</p>
    {blockedAssignments.length > 0 && <section className={styles.blocked} aria-label="不適用服務的既有分工">
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
    <form data-core-care-draft onChange={() => draftGuard.changed()} onSubmit={async (event) => {
      event.preventDefault();
      if (lock.current || confirmed || needsReload || roster.demo || !clientId || cannotCreate) return;
      let pending = operation;
      if (!pending) {
        operationLease.current = tryAcquirePendingOperation();
        if (!operationLease.current) {
          setMessage("清單正在更新或分支正在切換，請完成後再送出；尚未建立本筆操作。"); return;
        }
        try {
          const form = new FormData(event.currentTarget);
          const rawInput = { clientId, serviceDate, shift, staffUserId: blocked ? null : String(form.get("staffUserId") || "") || null,
            expectedVersion: previous?.version ?? 0, state: form.get("state"), sourceNote: String(form.get("sourceNote") || "").trim(),
            tasks: blocked ? previous.tasks.map((task) => task.kind) : form.getAll("task"), approved: form.get("approved") === "on",
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
      lock.current = true; draftGuard.begin(); setBusy(true); setMessage(""); setNeedsReauth(false);
      try {
        const response = await fetchWithTimeout("/api/care-roster", { method: "POST", cache: "no-store", headers: { "Content-Type": "application/json", "x-care-roster-action": "approve_assignment" }, body: pending.body });
        const outcome = parseRosterWriteOutcome(await response.json().catch(() => null), response.status, pending.input);
        if (outcome.kind === "success") {
          releaseKnownOperation();
          if (!mounted.current) return;
          setOperation(null); draftGuard.saved(); setConfirmed(true);
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
        <label className="field"><span>個案</span><select required value={clientId} disabled={locked} onChange={(e) => { if (!locked && draftGuard.discard()) { setClientId(e.target.value); setPrevious(roster.assignments.find((row) => row.clientId === e.target.value && row.shift === shift) ?? null); setMessage(""); } e.stopPropagation(); }}><option value="">選擇個案</option>{Array.from(choices.values()).map((client) => <option key={client.id} value={client.id}>{client.displayName}（{client.clientCode}）</option>)}</select></label>
        <label className="field"><span>班別</span><select value={shift} disabled={locked} onChange={(e) => { if (!locked && draftGuard.discard()) { setShift(e.target.value as RosterShift); setPrevious(roster.assignments.find((row) => row.clientId === clientId && row.shift === e.target.value) ?? null); setMessage(""); } e.stopPropagation(); }}><option value="morning">上午（00:00–12:00）</option><option value="afternoon">下午（12:00–24:00）</option></select></label>
      </div>
      {cannotCreate && <p role="alert">此個案尚不可安排當日服務，這個班別也沒有可取消的既有分工。請先確認正式收案與服務期間。</p>}
      <fieldset key={`${clientId}:${shift}:${previous?.version ?? 0}`} disabled={locked || !clientId || cannotCreate} className="form-grid">
        <legend>{previous ? `調整第 ${previous.version} 版，儲存後保留歷史` : "建立每日分工"}</legend>
        {blocked ? <p>{eligibilityLabel(previous)}：只可取消這筆既有安排，不會改寫過往人員與照顧紀錄，也不會自動正式收案。</p>
          : <label className="field"><span>負責人</span><select name="staffUserId" defaultValue={previous?.staffUserId ?? ""}><option value="">待指派（主管需後續安排）</option>{roster.staffOptions.map((staff) => <option key={staff.userId} value={staff.userId}>{staff.name}</option>)}</select></label>}
        <label className="field"><span>服務安排</span><select required name="state" defaultValue={blocked ? "" : previous?.state ?? "scheduled"}>{blocked ? <option value="">請選擇取消安排</option> : <option value="scheduled">安排服務</option>}<option value="cancelled">取消安排</option></select></label>
        {!blocked && <fieldset><legend>此班別應記錄項目（依個案需要勾選）</legend>{(Object.keys(ROSTER_TASK_LABELS) as RosterTaskKind[]).map((kind) => <label key={kind} className="checkbox-field"><input type="checkbox" name="task" value={kind} defaultChecked={previous?.tasks.some((task) => task.kind === kind) ?? false} />{ROSTER_TASK_LABELS[kind]}</label>)}</fieldset>}
        <label className="field"><span>安排依據／異動理由</span><input name="sourceNote" minLength={3} maxLength={300} required defaultValue={previous?.sourceNote ?? ""} placeholder="例如：已核准計畫日期、工作需要；異動請說明" /></label>
        <label className="checkbox-field"><input type="checkbox" name="approved" required />我已確認照顧計畫、個案需要及人員安排；不是直接採用自動建議。</label>
      </fieldset>
      <button className="button button--primary" type="submit" disabled={busy || roster.demo || !clientId || needsReload || confirmed || cannotCreate}>{busy ? "儲存中…" : roster.demo ? "合成展示，不寫入資料" : operation?.hadUnknown ? "以原內容重試確認" : "確認並儲存分工"}</button>
      {message && <p role="status">{message}</p>}
      {(needsReload || confirmed) && <button className="button button--secondary" type="button" disabled={refreshPending} onClick={reloadRoster}>{confirmed ? "讀取最新分工清單" : "重新載入並人工核對"}</button>}
      {needsReauth && <Link href="/mfa?audience=staff&purpose=sensitive-action">完成近期身分確認後再操作</Link>}
    </form>
  </details>;
}
