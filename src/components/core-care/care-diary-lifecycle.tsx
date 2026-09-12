"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { z } from "zod";
import { fetchWithTimeout } from "@/lib/api/client-fetch";
import { careDiaryDataSchema, diaryRecordSchema, observationsFromForm, type DiaryRecord } from "@/lib/care-diary/schema";
import { DiaryObservationsFields } from "./diary-observations";
import { useCoreDraftGuard } from "./client-continuation";

const statusLabels = { draft: "草稿", submitted: "待簽署", signed: "正式完成", corrected: "更正版已完成" } as const;
const snapshotSchema = z.object({ status: z.literal("ok"), requestId: z.string().min(1), data: z.object({
  records: z.array(diaryRecordSchema), demo: z.boolean(), persisted: z.boolean(),
  history: z.array(z.object({ id: z.uuid(), record_key: z.uuid(), version: z.number(), status: z.string(), correction_reason: z.string().nullable() })),
}) });
const receiptSchema = z.object({ status: z.literal("ok"), requestId: z.string().min(1), errors: z.array(z.never()).length(0), data: z.object({ record: diaryRecordSchema, replayed: z.boolean(), demo: z.literal(false), persisted: z.literal(true) }) });

function DiaryEditor({ record, pending, onSave, onCancel }: { record: DiaryRecord; pending: boolean; onSave: (fields: unknown) => Promise<boolean>; onCancel: () => void }) {
  const draft = useCoreDraftGuard();
  const [error, setError] = useState<string | null>(null);
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!draft.begin()) return;
    try {
      const form = new FormData(event.currentTarget);
      const fields = careDiaryDataSchema.safeParse({ shift: form.get("shift"), care_item: form.get("care_item"), note: form.get("note"), follow_up: form.get("follow_up"), abnormal: form.get("abnormal") === "on", observations: observationsFromForm(form) });
      if (!fields.success) { setError("請確認照顧項目與本次觀察結果，內容尚未送出。"); return; }
      setError(null);
      if (await onSave(fields.data)) draft.saved();
    } catch { setError("請檢查本次觀察結果，內容仍保留在畫面，尚未送出。");
    } finally { draft.finish(); }
  }
  return <form data-core-care-draft onChange={draft.changed} onSubmit={save}><fieldset disabled={pending} className="core-dialog__fields">
    <legend>繼續編輯這筆草稿</legend>
    <label className="field"><span>班別</span><select name="shift" defaultValue={record.fields.shift}><option value="morning">上午</option><option value="afternoon">下午</option><option value="full_day">全日</option></select></label>
    <label className="field"><span>照顧項目</span><input name="care_item" required maxLength={120} defaultValue={record.fields.care_item} /></label>
    <DiaryObservationsFields initial={record.fields.observations} />
    <label className="field"><span>紀錄摘要</span><textarea name="note" maxLength={2000} defaultValue={record.fields.note} /></label>
    <label className="field"><span>後續行動</span><textarea name="follow_up" maxLength={1000} defaultValue={record.fields.follow_up} /></label>
    <label className="check-field"><input name="abnormal" type="checkbox" defaultChecked={record.fields.abnormal} />標記為需留意</label>
    <button type="submit" className="button button--primary">{pending ? "儲存中…" : "儲存草稿修訂"}</button>
    <button type="button" className="button button--secondary" onClick={() => { if (draft.discard()) onCancel(); }}>取消編輯</button>
    {error ? <p role="alert">{error}</p> : null}
  </fieldset></form>;
}

type LifecycleProps = { clientId?: string; readEnabled?: boolean; enabled: boolean; canSign: boolean; demo: boolean };
export function CareDiaryLifecycle(props: LifecycleProps) {
  if (props.readEnabled === false) return <section className="panel" aria-labelledby="diary-read-mode-title">
    <h2 id="diary-read-mode-title">日誌操作目前為查看模式</h2>
    <p>可在下方查看既有日誌摘要；編輯、提交與簽署需要對應權限及身分驗證。</p>
  </section>;
  return <CareDiaryClientLifecycle key={`${props.clientId ?? "none"}:${props.demo}`} {...props} />;
}

function CareDiaryClientLifecycle({ clientId, enabled, canSign, demo }: LifecycleProps) {
  const router = useRouter();
  const [records, setRecords] = useState<DiaryRecord[]>([]);
  const [history, setHistory] = useState<z.infer<typeof snapshotSchema>["data"]["history"]>([]);
  const [loading, setLoading] = useState(Boolean(clientId));
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const [editingId, setEditingId] = useState<string | null>(null);
  const requestKey = useRef<{ payload: string; key: string } | null>(null);
  const inFlight = useRef(false);
  const activeClient = useRef(clientId);

  useEffect(() => {
    let current = true;
    activeClient.current = clientId;
    if (!clientId) return;
    void fetchWithTimeout(`/api/records?client=${encodeURIComponent(clientId)}`, { cache: "no-store" }).then(async (response) => {
      const data = snapshotSchema.safeParse(await response.json());
      if (!response.ok || !data.success || data.data.data.demo !== demo || data.data.data.persisted === demo) throw new Error("LOAD_FAILED");
      if (data.data.data.records.some((record) => record.client_id !== clientId)
        || data.data.data.history.some((entry) => !data.data.data.records.some((record) => record.record_key === entry.record_key))) throw new Error("CLIENT_MISMATCH");
      if (current) { setRecords(data.data.data.records); setHistory(data.data.data.history); }
    }).catch(() => { if (current) setError("目前無法載入日誌，請檢查連線或重新登入後重試。這不代表沒有紀錄。"); }).finally(() => { if (current) setLoading(false); });
    return () => { current = false; activeClient.current = undefined; };
  }, [clientId, reload, demo]);

  async function action(record: DiaryRecord, kind: "edit" | "submit" | "sign" | "correct" | "reopen", extra: Record<string, unknown> = {}) {
    if (inFlight.current || demo || !clientId || record.client_id !== clientId) return false;
    if ((kind === "sign" ? !canSign : !enabled)) return false;
    if (kind !== "edit" && !window.confirm(kind === "sign" ? "我已閱讀這個版本，確認是本次實際觀察與處置，並以本人身分簽署。" : kind === "correct" ? "建立同一事件的更正草稿？原簽署版本會完整保留，更正內容須重新確認與簽署。" : kind === "reopen" ? "退回草稿修訂？這個提交版本與退回理由會保留在歷程。" : "提交這個已儲存的版本？提交後不可直接修改，仍須本人確認簽署才算完成。")) return false;
    const body = JSON.stringify({ action: kind, base_version: record.version, ...extra, ...(kind === "sign" ? { confirmed: true } : {}) });
    const payload = `${record.id}:${body}`;
    if (requestKey.current?.payload !== payload) requestKey.current = { payload, key: crypto.randomUUID() };
    inFlight.current = true; setPending(true); setError(null); setNotice(null);
    try {
      const response = await fetchWithTimeout(`/api/records/${record.id}/actions`, { method: "POST", cache: "no-store", headers: { "Content-Type": "application/json", "Idempotency-Key": requestKey.current.key }, body });
      const raw: unknown = await response.json();
      if (activeClient.current !== clientId) return false;
      const parsed = receiptSchema.safeParse(raw);
      if (!response.ok || !parsed.success) {
        const failure = z.object({ errors: z.array(z.object({ message: z.string() })) }).safeParse(raw);
        throw new Error(failure.success && failure.data.errors.length ? failure.data.errors[0]!.message : "回覆不完整；請保留內容並重試同一次操作。");
      }
      const receipt = parsed.data.data;
      const expectedStatus = kind === "edit" || kind === "correct" || kind === "reopen" ? "draft" : kind === "submit" ? "submitted" : record.correction_source_id ? "corrected" : "signed";
      if (receipt.record.client_id !== clientId || receipt.record.record_key !== record.record_key || receipt.record.version !== record.version + 1 || receipt.record.previous_version_id !== record.id || receipt.record.status !== expectedStatus || response.status !== (receipt.replayed ? 200 : 201) || (kind === "correct" && receipt.record.correction_source_id !== record.id)) throw new Error("回覆版本或簽署狀態不一致，請保留內容並重新確認。");
      setNotice(kind === "sign" ? "這個版本已完成正式簽署。" : kind === "submit" ? "已提交，仍待簽署，不會計為正式完成。" : kind === "correct" ? "已建立更正草稿。請逐項檢查同一事件的內容，再提交簽署。" : "草稿修訂已儲存；尚未正式完成。");
      requestKey.current = null; setLoading(true); setRecords([]); setHistory([]); setEditingId(null); setReload((value) => value + 1); router.refresh(); return true;
    } catch (caught) { if (activeClient.current === clientId) setError(caught instanceof Error ? caught.message : "尚未確認完成，請保留內容並重試。"); return false; }
    finally { inFlight.current = false; setPending(false); }
  }

  return <section className="panel" aria-labelledby="diary-lifecycle-title"><div className="panel__header"><div><p className="eyebrow">草稿 → 確認 → 簽署</p><h2 id="diary-lifecycle-title">接續完成照顧日誌</h2></div><button type="button" className="button button--secondary" disabled={loading || pending || !clientId || editingId !== null} onClick={() => { setLoading(true); setError(null); setRecords([]); setHistory([]); setReload((value) => value + 1); }}>重新讀取</button></div>
    {!clientId ? <p>請先選擇一位個案，查看與接續完成他的日誌。</p> : null}
    {loading ? <p role="status">正在讀取日誌…</p> : null}{error ? <p role="alert">{error}</p> : null}{notice ? <p role="status">{notice}</p> : null}
    {clientId && !loading && !error && records.length === 0 ? <p>{demo ? "展示模式不保存日誌或簽署。正式登入並選擇個案後，這裡會顯示可接續的草稿。" : "這位個案目前沒有日誌。可從上方新增日誌草稿。"}</p> : null}
    {records.map((record) => <article key={record.id} className="today-work-card"><header><h3>{record.fields.care_item}</h3><p>{new Date(record.occurred_at).toLocaleString("zh-TW", { timeZone: "Asia/Taipei" })} · 第 {record.version} 版 · {statusLabels[record.status]}</p></header>
      <p>{record.fields.note || "未填寫文字摘要，請確認本次快速紀錄。"}</p>
      {record.fields.abnormal ? <p>需留意：{record.fields.follow_up || "請補充後續行動"}</p> : null}
      {record.fields.observations ? <details><summary>查看本次快速紀錄</summary><DiaryObservationSummary observations={record.fields.observations} /></details> : null}
      {record.signed_at ? <p>簽署時間：{new Date(record.signed_at).toLocaleString("zh-TW", { timeZone: "Asia/Taipei" })}。原內容不可覆寫。</p> : null}
      {editingId === record.id ? <DiaryEditor key={record.id} record={record} pending={pending} onSave={(fields) => action(record, "edit", { data: fields })} onCancel={() => setEditingId(null)} /> : null}
      <div className="action-row">{record.status === "draft" ? <><button className="button button--secondary" disabled={pending || !enabled || demo || editingId !== null} onClick={() => setEditingId(record.id)} type="button">繼續編輯草稿</button><button className="button button--primary" disabled={pending || !enabled || demo || editingId !== null} onClick={() => void action(record, "submit")} type="button">提交已儲存版本</button></> : record.status === "submitted" ? <><button className="button button--primary" disabled={pending || !canSign || demo || editingId !== null} onClick={() => void action(record, "sign")} type="button">確認內容並簽署</button><form onSubmit={(event) => { event.preventDefault(); void action(record, "reopen", { reason: String(new FormData(event.currentTarget).get("reason") ?? "") }); }}><label className="field"><span>退回理由</span><input name="reason" required maxLength={1000} disabled={pending || !enabled || demo} /></label><button className="button button--secondary" disabled={pending || !enabled || demo || editingId !== null} type="submit">退回草稿修訂</button></form></> : <form onSubmit={(event) => { event.preventDefault(); void action(record, "correct", { reason: String(new FormData(event.currentTarget).get("reason") ?? "") }); }}><label className="field"><span>更正理由</span><input name="reason" required maxLength={1000} disabled={pending || !enabled || demo} /></label><button className="button button--secondary" disabled={pending || !enabled || demo || editingId !== null} type="submit">建立更正草稿</button></form>}</div>
      <details><summary>版本與更正歷程</summary><ol>{history.filter((item) => item.record_key === record.record_key).map((item) => <li key={item.id}>第 {item.version} 版 · {statusLabels[item.status as keyof typeof statusLabels] ?? item.status}{item.correction_reason ? ` · ${item.correction_reason}` : ""}</li>)}</ol></details>
    </article>)}
  </section>;
}

function DiaryObservationSummary({ observations }: { observations: NonNullable<DiaryRecord["fields"]["observations"]> }) {
  const labels = { meal: "本次進食量", water: "本次飲水量", toileting: "本次如廁", activity: "本次活動參與" };
  const values: Record<string, string> = { none: "未進食", quarter: "約四分之一", half: "約一半", three_quarters: "約四分之三", all: "全部", independent: "自行完成", assisted: "協助完成", not_needed: "當時無需求", concern: "需留意", participated: "參與", partial: "部分參與", declined: "婉拒", resting: "休息" };
  return <dl>{Object.entries(observations).map(([key, entry]) => <div key={key}><dt>{labels[key as keyof typeof labels]}</dt><dd>{entry.state === "unknown" ? "尚未觀察／不清楚" : entry.state === "not_applicable" ? "本次不適用" : key === "water" ? `${entry.value} 毫升` : values[String(entry.value)]}</dd></div>)}</dl>;
}
