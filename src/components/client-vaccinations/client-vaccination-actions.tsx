"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { type FormEvent, useEffect, useRef, useState, useTransition } from "react";

import { fetchWithTimeout, isClientFetchTimeoutError } from "@/lib/api/client-fetch";
import { parseClientVaccinationBatchApiEnvelope,
  parseClientVaccinationBatchInput, parseClientVaccinationRecordApiEnvelope,
  parseClientVaccinationRecordInput } from "@/lib/client-vaccinations/parser";
import type { ClientVaccinationBatchItemResult, ClientVaccinationRecord,
  ClientVaccinationRecordInput,
  ClientVaccinationSnapshot } from "@/lib/client-vaccinations/types";

import styles from "./client-vaccinations.module.css";

export function ClientVaccinationFreshness({ staleAfter, demo }: {
  staleAfter: string; demo: boolean;
}) {
  const router = useRouter();
  const [observedAt, setObservedAt] = useState(0);
  const [online, setOnline] = useState(true);
  const [refreshing, startRefresh] = useTransition();
  useEffect(() => {
    if (demo) return;
    const observe = () => { setObservedAt(Date.now()); setOnline(navigator.onLine); };
    const initial = window.setTimeout(observe, 0);
    const expiry = window.setTimeout(observe, Math.max(0, Date.parse(staleAfter) - Date.now()));
    window.addEventListener("online", observe); window.addEventListener("offline", observe);
    document.addEventListener("visibilitychange", observe);
    return () => {
      window.clearTimeout(initial); window.clearTimeout(expiry);
      window.removeEventListener("online", observe); window.removeEventListener("offline", observe);
      document.removeEventListener("visibilitychange", observe);
    };
  }, [demo, staleAfter]);
  if (demo) return <span>合成展示資料</span>;
  const stale = observedAt >= Date.parse(staleAfter);
  return <span role="status">
    {!online ? "目前離線；不能同步或確認保存結果。" :
      stale ? "資料已超過一分鐘，請更新後核對最新紀錄。" : "目前資料已更新。"}
    <button className="button button--quiet" type="button" disabled={!online || refreshing}
      onClick={() => startRefresh(() => router.refresh())}>{refreshing ? "更新中…" : "更新疫苗清單"}</button>
  </span>;
}

function safeMessage(error: unknown) {
  if (isClientFetchTimeoutError(error) || error instanceof TypeError) {
    return "連線中斷或逾時，結果未知；內容未修改時請保留相同操作鍵重試。";
  }
  return error instanceof Error && error.message
    ? error.message
    : "疫苗操作未確認完成；請重新載入核對。";
}

async function safeJson(response: Response) {
  return response.json().catch(() => null) as Promise<unknown>;
}

function responseError(value: unknown, fallback: string) {
  if (!value || typeof value !== "object") return fallback;
  const errors = Array.isArray((value as { errors?: unknown }).errors)
    ? (value as { errors: Array<{ message?: unknown }> }).errors : [];
  const message = errors[0]?.message;
  return typeof message === "string" && message.trim() ? message : fallback;
}

function isConfirmedBatchRejection(value: unknown, status: number) {
  if (!value || typeof value !== "object") return false;
  const envelope = value as { status?: unknown; data?: unknown; errors?: unknown };
  if (envelope.status !== "error" || envelope.data !== null || !Array.isArray(envelope.errors) ||
    envelope.errors.length !== 1) return false;
  const error = envelope.errors[0] as { code?: unknown } | null;
  const allowed: Record<number, readonly string[]> = {
    400: ["INVALID_CLIENT_VACCINATION_RECORD", "INVALID_JSON", "INVALID_REQUEST", "INVALID_CONTENT_TYPE"],
    401: ["AUTHENTICATION_REQUIRED", "UNAUTHENTICATED"],
    403: ["CLIENT_VACCINATION_NOT_AUTHORIZED", "DEMO_READ_ONLY", "AAL2_REQUIRED"],
    409: ["CLIENT_VACCINATION_IDEMPOTENCY_CONFLICT", "CLIENT_VACCINATION_VERSION_CONFLICT"],
    503: ["SERVICE_NOT_CONFIGURED"],
  };
  return typeof error?.code === "string" && (allowed[status]?.includes(error.code) ?? false);
}

function useOperationKey() {
  const key = useRef<string | null>(null);
  const failed = useRef(false);
  return {
    getOrCreate() { key.current ??= crypto.randomUUID(); return key.current; },
    markFailed() { failed.current = true; },
    markSucceeded() { key.current = null; failed.current = false; },
    rotateIfFailed(clear: () => void) {
      if (!failed.current) return false;
      key.current = null; failed.current = false; clear(); return true;
    },
  };
}

function requestBody(input: ClientVaccinationRecordInput) {
  if (input.action === "void") return {
    action: input.action, vaccination_key: input.vaccinationKey,
    previous_version_id: input.previousVersionId,
    expected_base_version: input.expectedBaseVersion,
    client_id: input.clientId, correction_reason: input.correctionReason,
  };
  return {
    action: input.action, vaccination_key: input.vaccinationKey,
    previous_version_id: input.previousVersionId,
    expected_base_version: input.expectedBaseVersion,
    client_id: input.clientId, vaccine_name: input.vaccineName,
    dose_number: input.doseNumber, vaccinated_on: input.vaccinatedOn,
    lot_number: input.lotNumber, provider_name: input.providerName,
    evidence_status: input.evidenceStatus, evidence_reference_id: null,
    evidence_sha256: null, evidence_file_name: null,
    source_system: "manual_entry", source_record_id: null,
    correction_reason: input.correctionReason,
  };
}

async function sendRecord(input: ClientVaccinationRecordInput,
  snapshot: ClientVaccinationSnapshot) {
  const response = await fetchWithTimeout("/api/client-vaccinations", {
    method: "POST", cache: "no-store", headers: {
      "content-type": "application/json", "idempotency-key": input.idempotencyKey,
      "x-client-vaccination-operation": input.action,
    }, body: JSON.stringify(requestBody(input)),
  });
  const payload = await safeJson(response);
  if (!response.ok) throw new Error(responseError(payload,
    "疫苗紀錄未確認完成；請保留相同操作鍵重試。"));
  return parseClientVaccinationRecordApiEnvelope(payload, input,
    snapshot.organizationId, snapshot.branchId, response.status);
}

function VaccinationFields({ record, snapshot }: {
  record?: ClientVaccinationRecord;
  snapshot: ClientVaccinationSnapshot;
}) {
  return <>
    <label><span>疫苗名稱（依來源照錄）</span><input name="vaccineName"
      maxLength={160} defaultValue={record?.vaccineName ?? ""} required /></label>
    <label><span>劑次（依來源照錄）</span><input name="doseNumber"
      maxLength={80} defaultValue={record?.doseNumber ?? ""} required /></label>
    <label><span>接種日期</span><input name="vaccinatedOn" type="date"
      min="1900-01-01" max={snapshot.snapshotDate}
      defaultValue={record?.vaccinatedOn ?? snapshot.snapshotDate} required /></label>
    <label><span>批號（未提供可留空）</span><input name="lotNumber"
      maxLength={160} autoComplete="off" defaultValue={record?.lotNumber ?? ""} /></label>
    <label><span>接種院所</span><input name="providerName" maxLength={200}
      defaultValue={record?.providerName ?? ""} required /></label>
    <label><span>證明狀態</span><select name="evidenceStatus"
      defaultValue={record?.evidenceStatus === "not_applicable" ? "not_applicable" : "missing"}
      required><option value="missing">缺證明</option>
      <option value="not_applicable">不適用</option></select></label>
  </>;
}

function parseCreateForm(data: FormData, vaccinationKey: string, operationKey: string) {
  return parseClientVaccinationRecordInput({
    action: "create", vaccination_key: vaccinationKey, previous_version_id: null,
    expected_base_version: 0, client_id: data.get("clientId"),
    vaccine_name: data.get("vaccineName"), dose_number: data.get("doseNumber"),
    vaccinated_on: data.get("vaccinatedOn"),
    lot_number: String(data.get("lotNumber") ?? "").trim() || null,
    provider_name: data.get("providerName"),
    evidence_status: data.get("evidenceStatus"), evidence_reference_id: null,
    evidence_sha256: null, evidence_file_name: null,
    source_system: "manual_entry", source_record_id: null,
    correction_reason: null,
  }, operationKey);
}

function successText(receipt: Awaited<ReturnType<typeof sendRecord>>, action: string) {
  const base = action === "create" ? "疫苗原始版本已追加保存。" :
    action === "correct" ? "已追加更正版；原版本未被覆寫。" :
      "已追加作廢版本；原紀錄完整保留。";
  return receipt.duplicateWarning
    ? `${base} 另有 ${receipt.duplicateCount} 筆同一個案、疫苗名稱與劑次相同的終端紀錄；各筆保持獨立，未自動合併。`
    : base;
}

export function ClientVaccinationCreateForm({ canManage, snapshot }: {
  canManage: boolean; snapshot: ClientVaccinationSnapshot;
}) {
  const router = useRouter(); const operation = useOperationKey();
  const vaccinationKey = useRef(crypto.randomUUID());
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const clients = snapshot.clientOptions.filter((client) => client.canRecord);
  if (!canManage || snapshot.demo || !clients.length) return null;
  return <details className={styles.composer} open><summary>新增個案疫苗紀錄</summary>
    <form onChange={() => operation.rotateIfFailed(() => setMessage(null))}
      onSubmit={async (event) => {
        event.preventDefault(); setPending(true); setMessage(null);
        const form = event.currentTarget; const key = operation.getOrCreate();
        try {
          const input = parseCreateForm(new FormData(form), vaccinationKey.current, key);
          const receipt = await sendRecord(input, snapshot);
          operation.markSucceeded(); vaccinationKey.current = crypto.randomUUID(); form.reset();
          setMessage(successText(receipt, input.action)); router.refresh();
        } catch (error) { operation.markFailed(); setMessage(safeMessage(error)); }
        finally { setPending(false); }
      }}><fieldset className={styles.formGrid} disabled={pending}>
      <label><span>個案（穩定識別）</span><select name="clientId" defaultValue="" required>
        <option value="">請選擇在案且已授權個案</option>{clients.map((client) =>
          <option key={client.clientId} value={client.clientId}>
            {client.clientCode} · {client.displayName}</option>)}</select></label>
      <VaccinationFields snapshot={snapshot} />
      <p className={styles.wide} role="note">只保存人工照錄的接種事實，不判定適用性、效力或下一劑。附件上傳／掃毒尚未配置，因此瀏覽器不得提供附件 ID、路徑或雜湊。</p>
      <button className="button button--primary" disabled={pending} type="submit">
        {pending ? "保存中…" : "追加疫苗版本"}</button>
    </fieldset>{message ? <p className={styles.formMessage} role="status">{message}</p> : null}
    </form></details>;
}

type BatchDraft = { rowId: string; rowNumber: number; itemKey: string; vaccinationKey: string;
  clientId: string; vaccineName: string; doseNumber: string; vaccinatedOn: string;
  lotNumber: string; providerName: string; evidenceStatus: "missing" | "not_applicable" };

function newBatchDraft(clientId: string, date: string, rowNumber = 1): BatchDraft {
  return { rowId: crypto.randomUUID(), rowNumber, itemKey: crypto.randomUUID(),
    vaccinationKey: crypto.randomUUID(), clientId, vaccineName: "", doseNumber: "",
    vaccinatedOn: date, lotNumber: "", providerName: "", evidenceStatus: "missing" };
}

function batchRecord(row: BatchDraft) {
  return { action: "create", vaccination_key: row.vaccinationKey,
    previous_version_id: null, expected_base_version: 0, client_id: row.clientId,
    vaccine_name: row.vaccineName, dose_number: row.doseNumber,
    vaccinated_on: row.vaccinatedOn, lot_number: row.lotNumber.trim() || null,
    provider_name: row.providerName, evidence_status: row.evidenceStatus,
    evidence_reference_id: null, evidence_sha256: null, evidence_file_name: null,
    source_system: "manual_entry", source_record_id: null, correction_reason: null };
}

function batchResultText(results: readonly ClientVaccinationBatchItemResult[], rows: readonly BatchDraft[]) {
  return results.map((item) => item.status === "rejected"
    ? `第 ${rows[item.index]!.rowNumber} 筆：未登錄－${item.error?.message ?? "未確認"}`
    : `第 ${rows[item.index]!.rowNumber} 筆：${item.status === "replayed" ? "已核對原紀錄" : "已登錄"}${
      item.receipt?.duplicateWarning ? `，另有 ${item.receipt.duplicateCount} 筆重複警示` : ""}`);
}

export function ClientVaccinationBatchForm({ canManage, hasRecentAal2, snapshot }: {
  canManage: boolean; hasRecentAal2: boolean; snapshot: ClientVaccinationSnapshot;
}) {
  const router = useRouter(); const outerKey = useRef<string | null>(null);
  const inFlight = useRef(false);
  const [outcomeUnknown, setOutcomeUnknown] = useState(false);
  const [reauthRejectedSnapshot, setReauthRejectedSnapshot] = useState<string | null>(null);
  const recentVerification = hasRecentAal2 && reauthRejectedSnapshot !== snapshot.generatedAt;
  const clients = snapshot.clientOptions.filter((client) => client.canRecord);
  const [rows, setRows] = useState<BatchDraft[]>(() => [
    newBatchDraft(clients[0]?.clientId ?? "", snapshot.snapshotDate),
  ]);
  const [pending, setPending] = useState(false);
  const [messages, setMessages] = useState<string[]>([]);
  if (!canManage || snapshot.demo || !clients.length) return null;
  function update(index: number, field: keyof BatchDraft, value: string) {
    if (inFlight.current || outcomeUnknown) return;
    setMessages([]);
    setRows((current) => current.map((row, itemIndex) =>
      itemIndex === index ? { ...row, [field]: value } : row));
  }
  return <details className={styles.composer}><summary>批次登錄（逐筆回報，最多 20 筆）</summary>
    <form onSubmit={async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      if (inFlight.current || !recentVerification) return;
      inFlight.current = true; setPending(true); setMessages([]);
      outerKey.current ??= crypto.randomUUID();
      let sent = false;
      try {
        const input = parseClientVaccinationBatchInput({ items: rows.map((row) => ({
          idempotency_key: row.itemKey, record: batchRecord(row),
        })) }, outerKey.current);
        sent = true;
        const response = await fetchWithTimeout("/api/client-vaccinations/batch", {
          method: "POST", cache: "no-store", headers: { "content-type": "application/json",
            "idempotency-key": input.batchIdempotencyKey },
          body: JSON.stringify({ items: rows.map((row) => ({
            idempotency_key: row.itemKey, record: batchRecord(row),
          })) }),
        });
        const payload = await safeJson(response);
        if (!response.ok) {
          if (isConfirmedBatchRejection(payload, response.status)) {
            sent = false; outerKey.current = null;
            if ((payload as { errors: { code: string }[] }).errors[0]?.code === "AAL2_REQUIRED") {
              setReauthRejectedSnapshot(snapshot.generatedAt);
            }
            setRows((current) => current.map((row) => ({ ...row, itemKey: crypto.randomUUID() })));
          }
          throw new Error(responseError(payload,
            "批次結果未知；內容未修改時請保留相同操作鍵重試。"));
        }
        const receipt = parseClientVaccinationBatchApiEnvelope(payload, input,
          snapshot.organizationId, snapshot.branchId, response.status);
        const resultMessages = batchResultText(receipt.results, rows);
        const rejected = receipt.results.filter((item) => item.status === "rejected")
          .map((item) => rows[item.index]!).filter(Boolean);
        outerKey.current = null; setOutcomeUnknown(false); setMessages(resultMessages);
        setRows(rejected.length ? rejected.map((row) => ({ ...row,
          itemKey: crypto.randomUUID() })) : [
          newBatchDraft(clients[0]!.clientId, snapshot.snapshotDate),
        ]);
        router.refresh();
      } catch (error) { setOutcomeUnknown(sent); setMessages([safeMessage(error)]); }
      finally { inFlight.current = false; setPending(false); }
    }}>
      {!recentVerification ? <p className={styles.reauth}>
        批次登錄需要最近 15 分鐘內完成雙因素驗證，草稿暫不送出。
        <Link href="/mfa?audience=staff" target="_blank" rel="noopener noreferrer">另開分頁重新驗證</Link>
        <button className="button button--quiet" type="button" onClick={() => router.refresh()}>更新驗證狀態</button>
      </p> : null}
      {outcomeUnknown ? <p className={styles.warning} role="alert">
        上次送出結果尚未確認，已保留原資料並暫停編輯。請按「核對上次送出結果」，確認後才可調整失敗項目；不要另建相同紀錄。
      </p> : null}
      <div className={styles.batchList}>{rows.map((row, index) => <fieldset
        className={styles.batchRow} disabled={pending || outcomeUnknown} key={row.rowId}>
        <legend>第 {row.rowNumber} 筆</legend>
        <label><span>個案</span><select value={row.clientId}
          onChange={(event) => update(index, "clientId", event.target.value)} required>
          {clients.map((client) => <option key={client.clientId} value={client.clientId}>
            {client.clientCode} · {client.displayName}</option>)}</select></label>
        <label><span>疫苗</span><input value={row.vaccineName} maxLength={160}
          onChange={(event) => update(index, "vaccineName", event.target.value)} required /></label>
        <label><span>劑次</span><input value={row.doseNumber} maxLength={80}
          onChange={(event) => update(index, "doseNumber", event.target.value)} required /></label>
        <label><span>接種日期</span><input value={row.vaccinatedOn} type="date"
          min="1900-01-01" max={snapshot.snapshotDate}
          onChange={(event) => update(index, "vaccinatedOn", event.target.value)} required /></label>
        <label><span>批號</span><input value={row.lotNumber} maxLength={160}
          onChange={(event) => update(index, "lotNumber", event.target.value)} /></label>
        <label><span>院所</span><input value={row.providerName} maxLength={200}
          onChange={(event) => update(index, "providerName", event.target.value)} required /></label>
        <label><span>證明</span><select value={row.evidenceStatus}
          onChange={(event) => update(index, "evidenceStatus", event.target.value)}>
          <option value="missing">缺證明</option><option value="not_applicable">不適用</option>
        </select></label>
        <button className="button button--quiet" disabled={rows.length === 1}
          onClick={() => { if (inFlight.current || outcomeUnknown) return; outerKey.current = null;
            setMessages([]); setRows((current) => current.filter((_, item) => item !== index)); }}
          type="button">移除此筆</button>
      </fieldset>)}</div>
      <div className={styles.batchActions}><button className="button button--secondary"
        disabled={pending || outcomeUnknown || rows.length >= snapshot.batchMaximumItems} type="button"
        onClick={() => { if (inFlight.current || outcomeUnknown) return; outerKey.current = null; setMessages([]);
          setRows((current) => [...current,
            newBatchDraft(clients[0]!.clientId, snapshot.snapshotDate,
              Math.max(...current.map((item) => item.rowNumber)) + 1)]); }}>
        新增一筆</button><button className="button button--primary"
          disabled={pending || !recentVerification} type="submit">{pending ? "逐筆處理中…" :
            outcomeUnknown ? "核對上次送出結果" : "批次送出"}</button></div>
      {messages.length ? <section aria-label="上次送出結果" aria-live="polite">
        <h3>上次送出結果</h3><ol className={styles.batchResults}>
          {messages.map((message, index) => <li key={`${index}:${message}`}>{message}</li>)}</ol></section> : null}
    </form></details>;
}

export function ClientVaccinationRevisionForm({
  canManage, hasRecentAal2, snapshot,
}: { canManage: boolean; hasRecentAal2: boolean; snapshot: ClientVaccinationSnapshot }) {
  const router = useRouter(); const operation = useOperationKey();
  const active = snapshot.records.filter((record) => record.recordStatus === "active");
  const [selected, setSelected] = useState(active[0]?.vaccinationKey ?? "");
  const [action, setAction] = useState<"correct" | "void">("correct");
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const record = active.find((item) => item.vaccinationKey === selected) ?? active[0] ?? null;
  if (!canManage || snapshot.demo || !record) return null;
  const protectedSource = record.evidenceStatus === "provided" || record.sourceSystem !== "manual_entry";
  const correctionBlocked = action === "correct" && protectedSource;
  return <details className={styles.composer}><summary>建立更正版或作廢版本</summary>
    {!hasRecentAal2 ? <p className={styles.reauth}>更正與作廢需要同一工作階段最近 15 分鐘 AAL2。 <Link href="/mfa?audience=staff">重新驗證</Link></p> : null}
    <label className={styles.topControl}><span>目前終端版本</span><select
      disabled={pending} value={record.vaccinationKey} onChange={(event) => {
        setSelected(event.target.value); operation.rotateIfFailed(() => setMessage(null));
      }}>{active.map((item) => <option key={item.vaccinationKey} value={item.vaccinationKey}>
        {item.clientDisplayName} · {item.vaccineName} · {item.doseNumber} · v{item.version}
      </option>)}</select></label>
    <form key={`${record.recordVersionId}:${action}`}
      onChange={() => operation.rotateIfFailed(() => setMessage(null))}
      onSubmit={async (event) => {
        event.preventDefault();
        if (pending || !hasRecentAal2 || correctionBlocked) return;
        setPending(true); setMessage(null);
        const data = new FormData(event.currentTarget); const key = operation.getOrCreate();
        try {
          const input = parseClientVaccinationRecordInput(action === "void" ? {
            action, vaccination_key: record.vaccinationKey,
            previous_version_id: record.recordVersionId,
            expected_base_version: record.version, client_id: record.clientId,
            correction_reason: data.get("reason"),
          } : { action, vaccination_key: record.vaccinationKey,
            previous_version_id: record.recordVersionId,
            expected_base_version: record.version, client_id: record.clientId,
            vaccine_name: data.get("vaccineName"), dose_number: data.get("doseNumber"),
            vaccinated_on: data.get("vaccinatedOn"),
            lot_number: String(data.get("lotNumber") ?? "").trim() || null,
            provider_name: data.get("providerName"),
            evidence_status: data.get("evidenceStatus"), evidence_reference_id: null,
            evidence_sha256: null, evidence_file_name: null,
            source_system: "manual_entry", source_record_id: null,
            correction_reason: data.get("reason") }, key);
          const receipt = await sendRecord(input, snapshot);
          operation.markSucceeded(); setMessage(successText(receipt, input.action));
          router.refresh();
        } catch (error) { operation.markFailed(); setMessage(safeMessage(error)); }
        finally { setPending(false); }
      }}><fieldset className={styles.formGrid}
        disabled={pending || !hasRecentAal2}>
        <label><span>操作</span><select value={action}
          onChange={(event) => setAction(event.target.value as "correct" | "void")}>
          <option value="correct">建立更正版</option><option value="void">追加作廢版本</option>
        </select></label>
        {correctionBlocked ? <p className={styles.wide} role="note">
          此筆含移轉來源或已核對證明。目前尚未啟用此類更正流程，不能將原證明改成缺件；必要時可附理由建立作廢版本，原證明與來源仍會保留。
        </p> : action === "correct" ? <VaccinationFields record={record} snapshot={snapshot} /> : null}
        <label className={styles.wide}><span>更正／作廢理由（至少 8 字）</span>
          <textarea name="reason" rows={3} minLength={8} maxLength={1_000} required /></label>
        <button className="button button--secondary" disabled={pending || !hasRecentAal2 || correctionBlocked}
          type="submit">{pending ? "保存中…" : action === "void" ? "追加作廢版本" : "追加更正版"}</button>
      </fieldset>{message ? <p className={styles.formMessage} role="status">{message}</p> : null}
    </form></details>;
}
