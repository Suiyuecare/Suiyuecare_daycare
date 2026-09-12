"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ROSTER_TASK_LABELS, type CareRosterSnapshot, type CareRosterAssignment, type RosterTaskKind, type RosterShift } from "@/lib/care-roster/types";
import type { DailyCareSnapshot } from "@/lib/core-care/types";
import styles from "./care-roster.module.css";
import { useCoreDraftGuard } from "@/components/core-care/client-continuation";

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
  const operation = useRef<{ signature: string; key: string } | null>(null);
  const lock = useRef(false);
  if (!roster.manager) return null;
  return <details className={`panel today-management ${styles.composer}`}><summary>主管：安排／調整每日照顧分工</summary>
    <p>依已確認的照顧計畫安排上午／下午工作。分工不會開啟個案權限，也不取代人員資格與工時排班審核。</p>
    <form data-core-care-draft onChange={() => draftGuard.changed()} onSubmit={async (event) => {
      event.preventDefault();
      if (lock.current) return;
      const form = new FormData(event.currentTarget);
      const input = { clientId, serviceDate, shift, staffUserId: String(form.get("staffUserId") || "") || null,
        expectedVersion: previous?.version ?? 0, state: form.get("state"), sourceNote: String(form.get("sourceNote") || "").trim(),
        tasks: form.getAll("task"), approved: form.get("approved") === "on" };
      const signature = JSON.stringify(input);
      if (operation.current?.signature !== signature) operation.current = { signature, key: crypto.randomUUID() };
      lock.current = true; draftGuard.begin(); setBusy(true); setMessage("");
      try {
        const response = await fetch("/api/care-roster", { method: "POST", headers: { "Content-Type": "application/json", "x-care-roster-action": "approve_assignment" },
          body: JSON.stringify({ ...input, idempotency_key: operation.current.key }) });
        const result = await response.json();
        const receipt = result?.data?.receipt;
        if (!response.ok || result.status !== "ok" || result.data?.persisted !== true || result.data?.demo !== false || receipt?.clientId !== clientId || receipt?.shift !== shift || receipt?.serviceDate !== serviceDate || receipt?.version !== input.expectedVersion + 1) {
          setMessage(response.ok ? "尚無法確認已儲存，請保留內容並重試。" : result.errors?.[0]?.message || "儲存未完成，請稍後重試。"); return;
        }
        operation.current = null; draftGuard.saved(); setClientId(""); setPrevious(null); setMessage("每日分工已儲存；清單將更新。這不代表工作已執行。"); router.refresh();
      } catch { setMessage("連線中斷，尚無法確認儲存結果。請保留內容並重試。"); }
      finally { lock.current = false; draftGuard.finish(); setBusy(false); }
    }}>
      <div className="form-grid">
        <label className="field"><span>個案</span><select required value={clientId} disabled={busy} onChange={(e) => { if (draftGuard.discard()) { setClientId(e.target.value); setPrevious(roster.assignments.find((row) => row.clientId === e.target.value && row.shift === shift) ?? null); setMessage(""); } e.stopPropagation(); }}><option value="">選擇個案</option>{clients.map((client) => <option key={client.clientId} value={client.clientId}>{client.displayName}（{client.clientCode}）</option>)}</select></label>
        <label className="field"><span>班別</span><select value={shift} disabled={busy} onChange={(e) => { if (draftGuard.discard()) { setShift(e.target.value as RosterShift); setPrevious(roster.assignments.find((row) => row.clientId === clientId && row.shift === e.target.value) ?? null); setMessage(""); } e.stopPropagation(); }}><option value="morning">上午（00:00–12:00）</option><option value="afternoon">下午（12:00–24:00）</option></select></label>
      </div>
      <fieldset key={`${clientId}:${shift}:${previous?.version ?? 0}`} disabled={busy || !clientId} className="form-grid">
        <legend>{previous ? `調整第 ${previous.version} 版，儲存後保留歷史` : "建立每日分工"}</legend>
        <label className="field"><span>負責人</span><select name="staffUserId" defaultValue={previous?.staffUserId ?? ""}><option value="">待指派（主管需後續安排）</option>{roster.staffOptions.map((staff) => <option key={staff.userId} value={staff.userId}>{staff.name}</option>)}</select></label>
        <label className="field"><span>服務安排</span><select name="state" defaultValue={previous?.state ?? "scheduled"}><option value="scheduled">安排服務</option><option value="cancelled">取消安排</option></select></label>
        <fieldset><legend>此班別應記錄項目（依個案需要勾選）</legend>{(Object.keys(ROSTER_TASK_LABELS) as RosterTaskKind[]).map((kind) => <label key={kind} className="checkbox-field"><input type="checkbox" name="task" value={kind} defaultChecked={previous?.tasks.some((task) => task.kind === kind) ?? false} />{ROSTER_TASK_LABELS[kind]}</label>)}</fieldset>
        <label className="field"><span>安排依據／異動理由</span><input name="sourceNote" minLength={3} maxLength={300} required defaultValue={previous?.sourceNote ?? ""} placeholder="例如：已核准計畫日期、工作需要；異動請說明" /></label>
        <label className="checkbox-field"><input type="checkbox" name="approved" required />我已確認照顧計畫、個案需要及人員安排；不是直接採用自動建議。</label>
        <button className="button button--primary" type="submit" disabled={roster.demo}>{busy ? "儲存中…" : roster.demo ? "合成展示，不寫入資料" : "確認並儲存分工"}</button>
      </fieldset>
      {message && <p role="status">{message}</p>}
    </form>
  </details>;
}
