"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import Link from "next/link";
import { ClipboardCheck, FileClock, ShieldCheck } from "lucide-react";

import { QUESTIONNAIRE_FORMS } from "@/lib/questionnaire-assessments/forms";
import {
  readRuleReview, readRuleRetirement, RuleGovernanceClientError,
  type RuleGovernanceHistory, type RuleGovernanceScope,
} from "@/lib/questionnaire-assessments/rule-governance-client";
import { ruleReviewFormKeySchema, ruleReviewInputSchema, type RuleReviewInput, type RuleReviewRequest } from "@/lib/questionnaire-assessments/rule-review-contract";
import { ruleRetirementInputSchema, type RuleRetirementHistory, type RuleRetirementInput, type RuleRetirementRequest } from "@/lib/questionnaire-assessments/rule-retirement-shared";
import type { QuestionnaireFormKey } from "@/lib/questionnaire-assessments/types";
import { RuleGovernanceAction } from "./rule-governance-action";

const statuses = { pending: "待第二人核准", approved: "已核准", withdrawn: "已撤回", returned: "已退回" };
const dateTime = (value: string) => new Intl.DateTimeFormat("zh-TW", { timeZone: "Asia/Taipei", dateStyle: "short", timeStyle: "short" }).format(new Date(value));
const message = (error: unknown) => error instanceof RuleGovernanceClientError ? error.message : "暫時無法確認清單，請重試。";

type Props = { scope: RuleGovernanceScope; canManage: boolean; hasRecentAal2: boolean; demo: boolean; today: string };

function DecisionRow({ request, scope, kind, ready, matchesCandidate, onCompleted, onLockChange }: {
  request: RuleReviewRequest | RuleRetirementRequest; scope: RuleGovernanceScope;
  kind: "review" | "retirement"; ready: boolean; matchesCandidate: boolean;
  onCompleted: () => Promise<void>; onLockChange: (locked: boolean) => void;
}) {
  const id = useId();
  const [reason, setReason] = useState("");
  const [locked, setLocked] = useState(false);
  const action = request.byCurrentUser ? "withdraw" : "return";
  const common = { formKey: request.formKey, catalogHash: request.catalogHash, requestId: request.requestId };
  const approval = kind === "review"
    ? { ...common, action: "approve", effectiveFrom: null, effectiveTo: null, reason: null }
    : { ...common, activationId: (request as RuleRetirementRequest).activationId, action: "approve", effectiveThrough: null, reason: null };
  const rejection = kind === "review"
    ? { ...common, action, effectiveFrom: null, effectiveTo: null, reason }
    : { ...common, activationId: (request as RuleRetirementRequest).activationId, action, effectiveThrough: null, reason };
  const schema = kind === "review" ? ruleReviewInputSchema : ruleRetirementInputSchema;
  const checked = schema.safeParse(rejection);
  const lock = (value: boolean) => { setLocked(value); onLockChange(value); };
  return <li className="qrg-history-item">
    <div className="qrg-history-heading"><strong>{statuses[request.status]}</strong><span>{dateTime(request.requestedAt)} · {request.byCurrentUser ? "本人申請" : "另一位授權人員申請"}</span></div>
    <p>{kind === "review" ? `申請期間 ${(request as RuleReviewRequest).effectiveFrom} ～ ${(request as RuleReviewRequest).effectiveTo ?? "未設定截止"}` : `申請截止（含當日）${(request as RuleRetirementRequest).effectiveThrough}`}</p>
    {request.status === "pending" ? <div className="qrg-stack">
      {!matchesCandidate && kind === "review" ? <p className="qrg-warning">此申請不是目前題庫版本；未取得其完整內容前不可核准。</p> : null}
      {!request.byCurrentUser ? <RuleGovernanceAction scope={scope} kind={kind} input={approval as RuleReviewInput | RuleRetirementInput} label="核准" summary={kind === "review" ? "核准此申請的原題庫、規則與期間。" : "核准此版本的截止日；不改寫原採用紀錄。"} enabled={ready && matchesCandidate} disabledReason={!matchesCandidate ? "需核對原題庫" : "請先重新驗證並載入最新清單"} onCompleted={onCompleted} onLockChange={lock} /> : <p className="muted">申請人不能核准自己的申請。</p>}
      <label className="field" htmlFor={id}><span>{action === "withdraw" ? "撤回理由" : "退回理由"}（5–1000 字）</span><textarea id={id} className="control qrg-reason resize-none" rows={3} value={reason} disabled={locked} onChange={(event) => setReason(event.target.value)} /></label>
      <RuleGovernanceAction scope={scope} kind={kind} input={rejection as RuleReviewInput | RuleRetirementInput} label={action === "withdraw" ? "撤回申請" : "退回修改"} summary={action === "withdraw" ? "撤回自己的待審申請，歷程會保留。" : "退回另一人的待審申請，理由會保留。"} enabled={ready && checked.success} disabledReason={!ready ? "請先重新驗證並載入最新清單" : "請填寫有效理由"} onCompleted={onCompleted} onLockChange={lock} />
    </div> : <p>決定時間 {request.decision ? dateTime(request.decision.createdAt) : "—"}{request.decision?.reason ? ` · ${request.decision.reason}` : ""}</p>}
    <details><summary>紀錄識別與版本</summary><dl className="qrg-identifiers"><dt>申請</dt><dd>{request.requestId}</dd><dt>題庫雜湊</dt><dd>{request.catalogHash}</dd></dl></details>
  </li>;
}

export function QuestionnaireRuleWorkspace({ scope, canManage, hasRecentAal2, demo, today }: Props) {
  const id = useId();
  const readable = canManage && !demo;
  const scopeKey = [scope.organizationId, scope.branchId, scope.userId].join(":");
  const [formKey, setFormKey] = useState<QuestionnaireFormKey>("spmsq");
  const [rawHistory, setHistory] = useState<RuleGovernanceHistory | null>(null);
  const [loadedScope, setLoadedScope] = useState<string | null>(null);
  const [older, setOlder] = useState<RuleReviewRequest[]>([]);
  const [nextCursor, setNextCursor] = useState<RuleGovernanceHistory["nextCursor"]>(null);
  const [loading, setLoading] = useState(canManage && !demo);
  const [error, setError] = useState<string | null>(null);
  const [moreError, setMoreError] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [locked, setLocked] = useState(false);
  const [from, setFrom] = useState(today);
  const [to, setTo] = useState("");
  const [activationId, setActivationId] = useState("");
  const [rawRetirement, setRetirement] = useState<RuleRetirementHistory | null>(null);
  const [retirementScope, setRetirementScope] = useState<string | null>(null);
  const [retirementOlder, setRetirementOlder] = useState<RuleRetirementRequest[]>([]);
  const [retirementCursor, setRetirementCursor] = useState<RuleRetirementHistory["nextCursor"]>(null);
  const [retirementError, setRetirementError] = useState<string | null>(null);
  const [retirementLoading, setRetirementLoading] = useState(false);
  const [retirementMoreLoading, setRetirementMoreLoading] = useState(false);
  const [retirementMoreError, setRetirementMoreError] = useState<string | null>(null);
  const [through, setThrough] = useState(today);
  const [retirementReason, setRetirementReason] = useState("");
  const sequence = useRef(0);
  const retirementSequence = useRef(0);
  const readController = useRef<AbortController | null>(null);
  const retireController = useRef<AbortController | null>(null);
  const mounted = useRef(false);
  const selected = QUESTIONNAIRE_FORMS[formKey];
  const history = readable && loadedScope === scopeKey ? rawHistory : null;
  const retirement = readable && retirementScope === scopeKey ? rawRetirement : null;

  const refresh = useCallback(async () => {
    if (!readable || !mounted.current) return;
    const current = ++sequence.current;
    readController.current?.abort();
    const controller = new AbortController(); readController.current = controller;
    setLoading(true); setError(null); setLoadingMore(false);
    try {
      const next = await readRuleReview(scope, formKey, null, controller.signal);
      if (!mounted.current || current !== sequence.current) throw new Error("Discarded stale read");
      setHistory(next); setLoadedScope(scopeKey); setOlder([]); setNextCursor(next.nextCursor); setMoreError(null);
    } catch (caught) {
      if (mounted.current && current === sequence.current) setError(message(caught));
      throw caught;
    } finally { if (mounted.current && current === sequence.current) setLoading(false); }
  }, [readable, scope, scopeKey, formKey]);

  useEffect(() => {
    mounted.current = true;
    const reviewSequence = sequence;
    const retireSequence = retirementSequence;
    const generation = reviewSequence.current;
    void Promise.resolve().then(() => {
      if (mounted.current && reviewSequence.current === generation) return refresh();
    }).catch(() => {});
    return () => { mounted.current = false; reviewSequence.current++; retireSequence.current++; readController.current?.abort(); retireController.current?.abort(); };
  }, [refresh]);

  const requests = history ? [...history.requests, ...older] : [];
  const activations = requests.flatMap((entry) => entry.activation ? [entry.activation] : []);
  const activation = activations.find((entry) => entry.activationId === activationId);
  const activationHash = activation?.catalogHash;
  const activationEffectiveTo = activation?.effectiveTo;

  const refreshRetirement = useCallback(async (boundId: string, boundHash: string | undefined, boundTo: string | null | undefined) => {
    if (!readable || !mounted.current || !boundId || !boundHash || boundTo === undefined) return;
    const current = ++retirementSequence.current;
    retireController.current?.abort();
    const controller = new AbortController(); retireController.current = controller;
    setRetirementLoading(true); setRetirementError(null); setRetirementMoreLoading(false);
    try {
      const next = await readRuleRetirement(scope, boundId, null, controller.signal);
      if (!mounted.current || current !== retirementSequence.current) throw new Error("Discarded stale read");
      if (next.catalogHash !== boundHash || next.formKey !== formKey || next.originalEffectiveTo !== boundTo) throw new Error("Invalid activation binding");
      setRetirement(next); setRetirementScope(scopeKey); setRetirementOlder([]); setRetirementCursor(next.nextCursor); setRetirementMoreError(null);
    } catch (caught) {
      if (mounted.current && current === retirementSequence.current) setRetirementError(message(caught));
      throw caught;
    } finally { if (mounted.current && current === retirementSequence.current) setRetirementLoading(false); }
  }, [readable, scope, scopeKey, formKey]);
  const reloadRetirement = () => refreshRetirement(activationId, activationHash, activationEffectiveTo);
  useEffect(() => {
    const currentSequence = retirementSequence;
    const generation = currentSequence.current;
    void Promise.resolve().then(() => {
      if (mounted.current && currentSequence.current === generation) return refreshRetirement(activationId, activationHash, activationEffectiveTo);
    }).catch(() => {});
    return () => { currentSequence.current++; retireController.current?.abort(); };
  }, [refreshRetirement, activationId, activationHash, activationEffectiveTo]);

  const clearRetirement = () => {
    retirementSequence.current++; retireController.current?.abort();
    setRetirement(null); setRetirementScope(null); setRetirementOlder([]); setRetirementCursor(null); setRetirementLoading(false); setRetirementMoreLoading(false); setRetirementMoreError(null); setRetirementError(null); setRetirementReason(""); setThrough(today);
  };
  const changeForm = (next: QuestionnaireFormKey) => {
    sequence.current++; readController.current?.abort(); clearRetirement();
    setHistory(null); setLoadedScope(null); setOlder([]); setNextCursor(null); setLoading(readable); setLoadingMore(false); setMoreError(null); setError(null); setActivationId(""); setFrom(today); setTo(""); setFormKey(next);
  };

  const loadMore = async () => {
    if (!nextCursor || !history || loadingMore || locked || loading || error) return;
    const current = sequence.current;
    setLoadingMore(true); setMoreError(null);
    try {
      const next = await readRuleReview(scope, formKey, nextCursor, readController.current?.signal);
      if (!mounted.current || current !== sequence.current) return;
      setOlder((previous) => [...previous, ...next.requests.filter((entry) => ![...history.requests, ...previous].some((old) => old.requestId === entry.requestId))]);
      setNextCursor(next.nextCursor);
    } catch (caught) { if (mounted.current && current === sequence.current) { setMoreError(message(caught)); setError("較早紀錄未確認，請重新載入最新清單後再操作。"); } }
    finally { if (mounted.current && current === sequence.current) setLoadingMore(false); }
  };
  const loadRetirementMore = async () => {
    if (!retirementCursor || !retirement || retirementMoreLoading || locked || retirementLoading || retirementError) return;
    const current = retirementSequence.current;
    setRetirementMoreLoading(true); setRetirementMoreError(null);
    try {
      const next = await readRuleRetirement(scope, activationId, retirementCursor, retireController.current?.signal);
      if (!mounted.current || current !== retirementSequence.current) return;
      setRetirementOlder((previous) => [...previous, ...next.requests.filter((entry) => ![...retirement.requests, ...previous].some((old) => old.requestId === entry.requestId))]);
      setRetirementCursor(next.nextCursor);
    } catch (caught) { if (mounted.current && current === retirementSequence.current) { setRetirementMoreError(message(caught)); setRetirementError("較早退休紀錄未確認，請重新載入後再操作。"); } }
    finally { if (mounted.current && current === retirementSequence.current) setRetirementMoreLoading(false); }
  };
  const fresh = Boolean(history && history.formKey === formKey && !loading && !error);
  const canAct = readable && hasRecentAal2 && fresh;
  const pending = requests.some((entry) => entry.status === "pending");
  const input: RuleReviewInput = { action: "request", formKey, catalogHash: history?.candidate.catalogHash ?? "", requestId: null, effectiveFrom: from, effectiveTo: to || null, reason: null };
  const validPeriod = ruleReviewInputSchema.safeParse(input).success && from >= today;
  const retired = Boolean(retirement && retirement.effectiveThrough !== retirement.originalEffectiveTo);
  const retirementBound = Boolean(activation && retirement && retirement.activationId === activationId && retirement.formKey === formKey && retirement.catalogHash === activationHash && retirement.originalEffectiveTo === activationEffectiveTo);
  const retirementFresh = retirementBound && !retirementLoading && !retirementError;
  const retireInput: RuleRetirementInput = { action: "request", formKey, activationId, catalogHash: activation?.catalogHash ?? "", requestId: null, effectiveThrough: through, reason: retirementReason };
  const validCutoff = ruleRetirementInputSchema.safeParse(retireInput).success && through >= today && Boolean(activation && through >= activation.effectiveFrom && (!activation.effectiveTo || through < activation.effectiveTo));

  return <section className="panel qrg-workspace" aria-labelledby={`${id}-title`}>
    <div className="panel__header"><div className="panel__title"><h2 id={`${id}-title`} data-governance-focus-anchor tabIndex={-1}>評估量表規則審核</h2><p>先核對版本，再送交第二位人員核准。</p></div><span className="status-pill status-pill--warning">{demo ? "展示唯讀" : "獨立核准"}</span></div>
    <div className="filter-bar qrg-selector"><label className="field" htmlFor={`${id}-form`}><span>評估量表</span><select className="control" id={`${id}-form`} value={formKey} disabled={locked} onChange={(event) => changeForm(event.target.value as QuestionnaireFormKey)}>{ruleReviewFormKeySchema.options.map((key) => <option key={key} value={key}>{QUESTIONNAIRE_FORMS[key].title}</option>)}</select></label>{readable ? <button className="button button--secondary" type="button" disabled={loading || locked} onClick={() => void refresh().catch(() => {})}>{loading ? "載入中…" : "重新載入"}</button> : null}</div>
    <div className="qrg-content">
      <div className="qrg-summary"><span><ClipboardCheck aria-hidden="true" />{selected.questions.length} 題</span><span><FileClock aria-hidden="true" />{history ? `${history.requests.filter((entry) => entry.status === "pending").length} 件待審（最新一批）` : "尚未確認審核清單"}</span><span><ShieldCheck aria-hidden="true" />{history?.candidate.registered ? "題庫已登錄" : "尚未確認題庫登錄"}</span></div>
      {demo ? <p className="callout">展示模式可核對題目，不會送出正式審核。</p> : !canManage ? <p role="alert" className="callout">此帳號沒有規則管理權限。</p> : null}
      {loading ? <p role="status">正在確認此分支的審核紀錄…</p> : null}
      {error ? <p role="alert" className="qrg-warning">{error} 原清單僅供參考，操作已暫停。</p> : null}
      {!demo && canManage && !hasRecentAal2 ? <p className="callout">可以查閱。送審或處理申請前，請<Link href="/mfa?audience=staff&purpose=sensitive-action">重新確認身分</Link>。</p> : null}
      <details className="qrg-details"><summary>核對完整題目與版本</summary><p>{selected.sourceLabel}</p>{selected.sourceUrl ? <a href={selected.sourceUrl} target="_blank" rel="noreferrer">查看來源</a> : null}<ol className="qrg-question-list">{selected.questions.map((question) => <li key={question.id}><strong>{question.prompt}</strong><p>{question.choices.map((choice) => choice.label).join("／")}</p>{question.helpText ? <p className="muted">{question.helpText}</p> : null}</li>)}</ol>{history ? <><p>{history.candidate.manifest.rules.scoringPolicy}</p><p>{history.candidate.manifest.rules.disclaimer}</p><dl className="qrg-identifiers"><dt>題目版本</dt><dd>{history.candidate.formVersion}</dd><dt>計分版本</dt><dd>{history.candidate.ruleVersion}</dd><dt>題庫雜湊</dt><dd>{history.candidate.catalogHash}</dd></dl><details><summary>公式、來源與驗證案例</summary><pre className="qrg-json">{JSON.stringify(history.candidate.manifest, null, 2)}</pre></details></> : <p className="muted">以上為程式中的候選題目，不代表分支已採用。</p>}</details>
      <p className="muted">規則核准不等於正式評估簽署已開放。</p>
      {history && history.formKey === formKey ? <>
        <form className="qrg-stack" noValidate onSubmit={(event) => event.preventDefault()} aria-label="量表採用期間">
          <div className="qrg-fields"><label className="field" htmlFor={`${id}-from`}><span>生效日（YYYY-MM-DD）</span><input className="control" id={`${id}-from`} type="text" inputMode="numeric" value={from} disabled={locked} onChange={(event) => setFrom(event.target.value)} /></label><label className="field" htmlFor={`${id}-to`}><span>截止日（可留空，YYYY-MM-DD）</span><input className="control" id={`${id}-to`} type="text" inputMode="numeric" value={to} disabled={locked} onChange={(event) => setTo(event.target.value)} /></label></div>
          {!validPeriod ? <p className="qrg-warning" role="status">請填寫有效日期；生效日不得早於今天，截止日不得早於生效日。</p> : null}
          <RuleGovernanceAction scope={scope} kind="review" input={input} label="送交第二人核准" summary={`${selected.title} · ${from} ～ ${to || "未設定截止"}。核准前不啟用此版本。`} enabled={canAct && history!.candidate.registered && !pending && validPeriod} disabledReason={!hasRecentAal2 ? "需要重新確認身分" : pending ? "請先處理待審申請" : !history!.candidate.registered ? "題庫尚未登錄" : "请檢查日期"} onCompleted={refresh} onLockChange={setLocked} />
        </form>
        <h3>採用歷程</h3><p className="muted">已載入 {requests.length}／{history!.total} 件 · 更新 {dateTime(history!.generatedAt)}</p>
        {requests.length === 0 ? <p className="qrg-empty">尚無申請，可設定期間後送審。</p> : <ul className="qrg-history">{requests.map((request) => <DecisionRow key={request.requestId} request={request} scope={scope} kind="review" ready={canAct && history!.requests.some((entry) => entry.requestId === request.requestId)} matchesCandidate={request.catalogHash === history!.candidate.catalogHash} onCompleted={refresh} onLockChange={setLocked} />)}</ul>}
        {moreError && !error ? <p role="alert" className="qrg-warning">{moreError}</p> : null}{nextCursor ? <button type="button" className="button button--secondary" disabled={loadingMore || locked || loading || Boolean(error)} onClick={() => void loadMore()}>{loadingMore ? "載入中…" : "載入較早紀錄"}</button> : null}
        {activations.length ? <div className="qrg-retirement">
          <h3>版本截止與退休</h3>
          <label className="field" htmlFor={`${id}-activation`}><span>核准版本（只列已載入歷程）</span>
            <select className="control" id={`${id}-activation`} disabled={locked} value={activationId}
              onChange={(event) => { clearRetirement(); setActivationId(event.target.value); }}>
              <option value="">選擇核准版本</option>
              {activations.map((entry) => <option key={entry.activationId} value={entry.activationId}>
                {entry.effectiveFrom} ～ {entry.effectiveTo ?? "未設定截止"} · {entry.catalogHash.slice(0, 10)}
              </option>)}
            </select>
          </label>
          {retirementLoading ? <p role="status">正在確認退休紀錄…</p> : null}
          {retirementError ? <><p role="alert" className="qrg-warning">{retirementError} 退休操作已暫停。</p>
            <button type="button" className="button button--secondary" disabled={locked || retirementLoading}
              onClick={() => void reloadRetirement().catch(() => {})}>重新載入退休紀錄</button></> : null}
          {retirementBound ? <>
            <p>原核准截止：{retirement!.originalEffectiveTo ?? "未設定"} · 現行截止（含當日）：{retirement!.effectiveThrough ?? "未設定"}</p>
            {retired ? <p className="callout">已核准新的截止日；不代表今天已停止，也不能再延長或覆寫原紀錄。</p> :
              <form className="qrg-stack" noValidate onSubmit={(event) => event.preventDefault()}>
                <label className="field" htmlFor={`${id}-through`}><span>新截止日（含當日，YYYY-MM-DD）</span>
                  <input className="control" id={`${id}-through`} type="text" inputMode="numeric" value={through}
                    disabled={locked} onChange={(event) => setThrough(event.target.value)} /></label>
                <label className="field" htmlFor={`${id}-retire-reason`}><span>退休理由（5–1000 字）</span>
                  <textarea className="control qrg-reason resize-none" id={`${id}-retire-reason`} rows={3} value={retirementReason}
                    disabled={locked} onChange={(event) => setRetirementReason(event.target.value)} /></label>
                <RuleGovernanceAction scope={scope} kind="retirement" input={retireInput} label="申請版本退休"
                  summary={`原截止 ${activation!.effectiveTo ?? "未設定"}，改為 ${through}（含當日）。須由另一人核准。`}
                  enabled={canAct && retirementFresh && validCutoff && ![...retirement!.requests, ...retirementOlder].some((entry) => entry.status === "pending")}
                  disabledReason="請先完成驗證、有效日期與理由，並處理待審申請"
                  onCompleted={reloadRetirement} onLockChange={setLocked} />
              </form>}
            <p className="muted">已載入 {retirement!.requests.length + retirementOlder.length}／{retirement!.total} 件退休申請</p>
            <ul className="qrg-history">{[...retirement!.requests, ...retirementOlder].map((request) =>
              <DecisionRow key={request.requestId} request={request} scope={scope} kind="retirement"
                ready={canAct && retirementFresh && retirement!.requests.some((entry) => entry.requestId === request.requestId)}
                matchesCandidate onCompleted={reloadRetirement} onLockChange={setLocked} />)}</ul>
            {retirementMoreError && !retirementError ? <p role="alert" className="qrg-warning">{retirementMoreError}</p> : null}
            {retirementCursor ? <button type="button" className="button button--secondary" disabled={retirementMoreLoading || locked || retirementLoading || Boolean(retirementError)}
              onClick={() => void loadRetirementMore()}>{retirementMoreLoading ? "載入中…" : "載入較早退休紀錄"}</button> : null}
          </> : null}
        </div> : null}
      </> : null}
    </div>
  </section>;
}
