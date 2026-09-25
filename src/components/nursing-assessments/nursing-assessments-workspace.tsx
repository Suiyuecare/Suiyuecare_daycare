"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { blankNursingContent } from "@/lib/nursing-assessments/demo";
import { parseNursingActionSuccess, parseNursingRequest } from "@/lib/nursing-assessments/parser";
import { NURSING_DOMAIN_LABELS, type NursingAssessmentSnapshot, type NursingContent,
  type NursingDomainKey, type NursingRequest, type NursingVersion } from "@/lib/nursing-assessments/types";
import styles from "./nursing-assessments.module.css";

const keys = Object.keys(NURSING_DOMAIN_LABELS) as NursingDomainKey[];
const stateLabels = { recorded: "已記錄", missing: "缺值／尚未取得", not_applicable: "不適用" };
const recordLabels = { draft: "草稿待簽", signed: "已簽署", corrected: "已簽更正版" };
function fieldText(field: NursingContent["domains"][NursingDomainKey]) {
  return `${stateLabels[field.state]}：${field.detail ?? field.reason ?? "—"}`;
}
function dateText(value: string) {
  return new Intl.DateTimeFormat("zh-TW", { timeZone: "Asia/Taipei", dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}
function NursingContentView({ content }: { content: NursingContent }) {
  return <dl className={styles.domain}>
    <dt>評估日期</dt><dd>{content.assessedOn}</dd>
    {keys.map((key) => <div key={key}><dt>{NURSING_DOMAIN_LABELS[key]}</dt><dd>{fieldText(content.domains[key])}</dd></div>)}
    <dt>人工複評安排</dt><dd>{stateLabels[content.reassessment.state]}{content.reassessment.dueOn ? ` · ${content.reassessment.dueOn}` : ""}：{content.reassessment.reason}</dd>
  </dl>;
}
export function NursingVersionDifferences({ previous, current }: { previous: NursingVersion; current: NursingVersion }) {
  const differences = [
    { label: "評估日期", before: previous.content.assessedOn, after: current.content.assessedOn },
    ...keys.map((key) => ({ label: NURSING_DOMAIN_LABELS[key], before: fieldText(previous.content.domains[key]), after: fieldText(current.content.domains[key]) })),
    { label: "複評安排", before: `${stateLabels[previous.content.reassessment.state]} ${previous.content.reassessment.dueOn ?? "—"}：${previous.content.reassessment.reason}`,
      after: `${stateLabels[current.content.reassessment.state]} ${current.content.reassessment.dueOn ?? "—"}：${current.content.reassessment.reason}` },
  ].filter((item) => item.before !== item.after);
  return <section aria-label="前後版差異">
    <h3>v{previous.version} → v{current.version} 差異</h3>
    <p>狀態：{recordLabels[previous.state]} → {recordLabels[current.state]}</p>
    {differences.length === 0 ? <p>護理內容未變更；此版追加簽署或版本紀錄。</p> : differences.map((item) => <div key={item.label}>
      <h4>{item.label}</h4><div className={styles.difference}><div><strong>前版</strong><p>{item.before}</p></div><div><strong>本版</strong><p>{item.after}</p></div></div>
    </div>)}
  </section>;
}
type PendingOperation = { request: NursingRequest; idempotencyKey: string };
export function NursingAssessmentsWorkspace({ snapshot, canManage, canSign, hasRecentAal2,
  actorUserId, initialClientId = null, loadError = false }: {
  snapshot: NursingAssessmentSnapshot | null; canManage: boolean; canSign: boolean;
  hasRecentAal2: boolean; actorUserId?: string; initialClientId?: string | null; loadError?: boolean;
}) {
  const router = useRouter();
  const [clientId, setClientId] = useState(() => initialClientId ?? "");
  const [versionId, setVersionId] = useState("");
  const [mode, setMode] = useState<"create_draft" | "revise_draft" | "correct" | null>(null);
  const [editingSnapshotAt, setEditingSnapshotAt] = useState<string | null>(null);
  const [content, setContent] = useState<NursingContent>(() => blankNursingContent());
  const [reason, setReason] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<PendingOperation | null>(null);
  const [stale, setStale] = useState(false);
  const [offline, setOffline] = useState(false);
  const inFlight = useRef(false);
  useEffect(() => {
    const check = () => { setStale(snapshot ? Date.now() >= new Date(snapshot.staleAfter).getTime() : true); setOffline(!navigator.onLine); };
    check(); const timer = window.setInterval(check, 10000);
    window.addEventListener("online", check); window.addEventListener("offline", check);
    return () => { window.clearInterval(timer); window.removeEventListener("online", check); window.removeEventListener("offline", check); };
  }, [snapshot]);
  if (loadError || !snapshot) return <section className={styles.card} role="alert"><h1>護理評估暫時無法載入</h1><p>請確認目前機構、分支與護理評估權限後重新載入。</p><button className="button button--secondary" onClick={() => router.refresh()}>重新載入</button></section>;
  const client = clientId
    ? snapshot.clients.find((item) => item.clientId === clientId)
    : snapshot.clients[0];
  const latest = client?.versions[0];
  const selected = client?.versions.find((version) => version.versionId === versionId) ?? latest;
  const previous = client?.versions.find((version) => version.versionId === selected?.previousVersionId);
  const unavailable = snapshot.demo || stale || offline || !actorUserId || busy || pending !== null;
  const existing = latest && client ? { clientId: client.clientId, assessmentKey: latest.assessmentKey,
    previousVersionId: latest.versionId, expectedVersion: latest.version, expectedContentHash: latest.contentHash } : null;

  function start(nextMode: NonNullable<typeof mode>) {
    setMode(nextMode); setReason(""); setError(""); setMessage("");
    setEditingSnapshotAt(snapshot!.generatedAt);
    setContent(nextMode === "create_draft" || !latest ? blankNursingContent() : structuredClone(latest.content));
  }
  async function execute(operation: PendingOperation) {
    if (inFlight.current || snapshot!.demo || !actorUserId || offline) return;
    inFlight.current = true; setBusy(true); setError(""); setMessage(""); setPending(operation);
    const controller = new AbortController(); const timeout = window.setTimeout(() => controller.abort(), 20000);
    try {
      const response = await fetch("/api/nursing-assessments", { method: operation.request.action === "create_draft" ? "POST" : "PATCH",
        headers: { "content-type": "application/json", "idempotency-key": operation.idempotencyKey,
          "x-nursing-operation": operation.request.action }, body: JSON.stringify(operation.request), signal: controller.signal });
      const body: unknown = await response.json();
      if (!response.ok) {
        if ([400, 401, 403, 409, 413].includes(response.status)) {
          setPending(null);
          throw new Error(response.status === 409 ? "版本或操作狀態已改變。請保留內容並重新載入。"
            : response.status === 403 ? "目前護理權限、個案指派或近期雙因素驗證未通過。"
              : "內容或登入狀態未通過驗證，尚未完成操作。");
        }
        throw new Error("尚未收到有效完成憑證，請以相同內容重試。");
      }
      parseNursingActionSuccess(body, { ...operation, actorUserId, organizationId: snapshot!.organizationId,
        branchId: snapshot!.branchId }, response.status);
      setPending(null); setMode(null); setStale(true); setMessage("護理紀錄已儲存，正在載入新版本。"); router.refresh();
    } catch (caught) { setError(caught instanceof Error ? caught.message : "尚未確認儲存完成，請重試。"); }
    finally { clearTimeout(timeout); setBusy(false); inFlight.current = false; }
  }
  function submit(event: FormEvent) {
    event.preventDefault(); if (!client || !mode || unavailable) return;
    if (editingSnapshotAt !== snapshot!.generatedAt) {
      setError("畫面版本已更新。請保留內容、取消編輯後重新開啟最新紀錄核對。"); return;
    }
    try {
      const request: NursingRequest = mode === "create_draft" ? { action: mode, clientId: client.clientId, content }
        : mode === "correct" ? { ...existing!, action: mode, content, correctionReason: reason }
          : { ...existing!, action: mode, content };
      void execute(parseNursingRequest(request, crypto.randomUUID()));
    } catch (caught) { setError(caught instanceof Error ? caught.message : "請檢查輸入內容。"); }
  }
  return <div className={styles.workspace}>
    <header className="page-heading"><div><p className="eyebrow">護理服務 · 頁面 51</p><h1>護理評估</h1><p>整理護理觀察、問題、措施與反應，檢視每次人工評估的版本與追蹤安排。</p></div></header>
    <div className={styles.notice}><strong>人工、非標準化紀錄</strong><p>本表未宣稱為官方或授權量表，不計分、不自動判定風險。複評日期與依據由護理人員填寫。</p></div>
    {snapshot.demo ? <p className={styles.notice} role="status">展示模式：以下均為合成示例，儲存、簽署及更正維持唯讀。</p> : null}
    <p className={styles.metadata}>官方量表計分、附件、匯出、通知與離線同步：尚未設定。</p>
    {(stale || offline) ? <p className={styles.error} role="status">{offline ? "目前離線，無法儲存；內容僅留在此畫面。" : "資料已到期或剛完成儲存，請重新載入後再操作。"}</p> : null}
    {error ? <p className={styles.error} role="alert">{error}</p> : null}
    {message ? <p className={styles.status} role="status">{message}</p> : null}
    {pending ? <div className={styles.notice}><p>本次操作內容已固定，重試使用相同識別碼。請先確認結果，再開始另一筆操作。</p><button className="button button--primary" disabled={busy || offline} onClick={() => void execute(pending)}>{busy ? "確認中…" : "以相同內容重試"}</button></div> : null}
    {clientId && !client ? <p className={styles.error} role="alert">所選個案不在目前可查看範圍，請從個案中心重新選擇。</p> : null}
    <div className={styles.toolbar}><label>個案<select value={client?.clientId ?? ""} disabled={busy || pending !== null || mode !== null}
      onChange={(event) => { setClientId(event.target.value); setVersionId(""); setMessage(""); setError(""); }}>
      {!client ? <option value="">目前個案無法查看</option> : null}
      {snapshot.clients.map((item) => <option key={item.clientId} value={item.clientId}>{item.displayName} · {item.versionsTotal ? `${item.versionsTotal} 個版本` : "尚未評估"}</option>)}</select></label>
      <button className="button button--secondary" disabled={busy || pending !== null} onClick={() => router.refresh()}>重新載入</button></div>
    {snapshot.clientsTruncated ? <p role="status">目前顯示前 {snapshot.clients.length} 位／共 {snapshot.clientTotal} 位可查看個案；尚未提供後續分頁。</p> : null}
    {client ? <section className={styles.card}><h2>{client.displayName}</h2>
      <div className={styles.actions}><button className="button button--primary" disabled={unavailable || !canManage || mode !== null} onClick={() => start("create_draft")}>新增護理評估</button>
        {latest?.state === "draft" ? <><button className="button button--secondary" disabled={unavailable || !canManage || mode !== null} onClick={() => start("revise_draft")}>修訂最新草稿</button>
          <button className="button button--primary" disabled={unavailable || !canSign || !hasRecentAal2 || mode !== null || selected?.versionId !== latest.versionId}
            onClick={() => { if (existing) void execute({ request: { ...existing, action: "sign" }, idempotencyKey: crypto.randomUUID() }); }}>簽署目前草稿</button></>
          : latest ? <button className="button button--secondary" disabled={unavailable || !canSign || !hasRecentAal2 || mode !== null} onClick={() => start("correct")}>追加更正版</button> : null}</div>
      {!snapshot.demo && !hasRecentAal2 ? <p>簽署與更正需最近 15 分鐘完成雙因素驗證。<Link href="/mfa?audience=staff&purpose=sensitive-action">前往重新驗證</Link></p> : null}
      {mode ? <form className={styles.form} onSubmit={submit}><h3>{mode === "create_draft" ? "新增人工護理評估" : mode === "revise_draft" ? "修訂草稿（追加版本）" : "更正已簽紀錄（追加簽署版本）"}</h3>
        <fieldset disabled={busy || pending !== null}><legend>評估內容</legend><label className={styles.field}>評估日期<input type="date" value={content.assessedOn} required onChange={(event) => setContent({ ...content, assessedOn: event.target.value })}/></label>
          {keys.map((key) => <fieldset key={key}><legend>{NURSING_DOMAIN_LABELS[key]}</legend><label className={styles.field}>紀錄狀態<select value={content.domains[key].state} onChange={(event) => {
            const state = event.target.value as NursingContent["domains"][NursingDomainKey]["state"];
            setContent({ ...content, domains: { ...content.domains, [key]: { state, detail: state === "recorded" ? "" : null, reason: state === "recorded" ? null : "" } } });
          }}>{Object.entries(stateLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
            <label className={styles.field}>{content.domains[key].state === "recorded" ? "人工觀察與處置內容" : "缺值或不適用理由"}<textarea required maxLength={content.domains[key].state === "recorded" ? 5000 : 1000}
              value={content.domains[key].detail ?? content.domains[key].reason ?? ""} onChange={(event) => setContent({ ...content, domains: { ...content.domains,
                [key]: { ...content.domains[key], [content.domains[key].state === "recorded" ? "detail" : "reason"]: event.target.value } } })}/></label></fieldset>)}
        </fieldset>
        <fieldset disabled={busy || pending !== null}><legend>人工複評安排</legend><div className={styles.grid}>
          <label className={styles.field}>安排狀態<select value={content.reassessment.state} onChange={(event) => setContent({ ...content, reassessment: {
            ...content.reassessment, state: event.target.value as NursingContent["reassessment"]["state"], dueOn: null } })}>
            <option value="recorded">已排定日期</option><option value="missing">尚未排定／缺值</option><option value="not_applicable">不適用</option></select></label>
          {content.reassessment.state === "recorded" ? <label className={styles.field}>複評日期<input type="date" required min={content.assessedOn} value={content.reassessment.dueOn ?? ""}
            onChange={(event) => setContent({ ...content, reassessment: { ...content.reassessment, dueOn: event.target.value || null } })}/></label> : null}</div>
          <label className={styles.field}>日期依據、缺值或不適用理由<textarea required maxLength={1000} value={content.reassessment.reason}
            onChange={(event) => setContent({ ...content, reassessment: { ...content.reassessment, reason: event.target.value } })}/></label></fieldset>
        {mode === "correct" ? <label className={styles.field}>更正理由<textarea required maxLength={1000} value={reason} disabled={busy || pending !== null} onChange={(event) => setReason(event.target.value)}/></label> : null}
        <div className={styles.actions}><button className="button button--primary" type="submit" disabled={unavailable || (mode === "correct" && !hasRecentAal2)}>{mode === "correct" ? "簽署並追加更正版" : "儲存草稿"}</button>
          <button className="button button--secondary" type="button" disabled={busy || pending !== null} onClick={() => setMode(null)}>取消編輯</button></div>
      </form> : null}
    </section> : null}
    {selected ? <section className={styles.card}><h2>評估版本與內容</h2><label className={styles.field}>查看版本<select value={selected.versionId} onChange={(event) => setVersionId(event.target.value)}>
      {client!.versions.map((version) => <option key={version.versionId} value={version.versionId}>{version.content.assessedOn} · v{version.version} · {recordLabels[version.state]} · {dateText(version.createdAt)}</option>)}</select></label>
      <p className={styles.metadata}>表單版本：{selected.content.formVersionReference}（人工非標準化，未宣稱官方發布）</p>
      <p>{recordLabels[selected.state]} · 記錄者：{selected.recorderDisplayName} · {dateText(selected.createdAt)}</p>
      <NursingContentView content={selected.content}/>
      {selected.signedAt ? <p>已由：{selected.signerDisplayName} · {dateText(selected.signedAt)} · {selected.signaturePurpose}</p> : <p>尚未簽署</p>}
      {selected.correctionReason ? <p><strong>更正理由：</strong>{selected.correctionReason}</p> : null}
      <details><summary>版本與簽署證據</summary><p className={styles.metadata}>版本 ID：{selected.versionId}<br/>內容雜湊：{selected.contentHash}<br/>前版雜湊：{selected.previousContentHash ?? "首版"}<br/>近期驗證證據：{selected.signatureChallengeId ?? "尚未簽署"}</p></details>
      {previous ? <NursingVersionDifferences previous={previous} current={selected}/> : selected.previousVersionId ? <p>前版未包含於本次有界清單，暫不顯示差異；完整版本仍保留。</p> : null}
      {client!.versionsTruncated ? <p role="status">目前顯示最近 50 個版本；全部 {client!.versionsTotal} 個版本均保留，較早版本查詢尚未設定。</p> : null}
    </section> : client ? <section className={styles.card}><h2>尚未建立護理評估</h2><p>可由具權限且已指派的護理人員新增人工評估草稿。</p></section> : null}
  </div>;
}
