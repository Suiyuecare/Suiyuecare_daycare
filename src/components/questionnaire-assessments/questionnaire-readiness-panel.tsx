"use client";

import { useLayoutEffect, useRef, useState } from "react";
import type { TenantContext } from "@/lib/domain/types";
import { tryAcquirePendingRecoveryRead, usePendingOperations, useViewTransitionPending } from "@/lib/navigation/pending-operation-lock";
import { canReadQuestionnaireView, getQuestionnaireViewState, questionnaireViewAuthority, quarantineQuestionnaireView, useQuestionnaireViewState } from "@/lib/questionnaire-assessments/readiness-view";
import { QuestionnaireReadinessReadError, readQuestionnaireReadiness, type QuestionnaireReadinessReport } from "@/lib/questionnaire-assessments/readiness-client";
import type { QuestionnaireDraft, QuestionnaireFormDefinition } from "@/lib/questionnaire-assessments/types";
import styles from "./questionnaire-readiness.module.css";

interface Attempt { token: symbol; controller: AbortController; release: () => void; epoch: number; binding: string }
interface PanelState { binding: string; result: QuestionnaireReadinessReport | null; error: string; busy: boolean; expired: boolean }
const emptyPanel = (binding: string): PanelState => ({ binding, result: null, error: "", busy: false, expired: false });

/** Exact saved-version inspection only. It cannot save, settle an unknown
 * write, replace a baseline, acknowledge a risk or authorize a signature. */
export function QuestionnaireReadinessPanel({ context, form, clientId, draft, sourceKey, blockedReason }: {
  context: TenantContext; form: QuestionnaireFormDefinition; clientId: string;
  draft: QuestionnaireDraft | null; sourceKey: string; blockedReason: string;
}) {
  const view = useQuestionnaireViewState();
  const authority = questionnaireViewAuthority(context);
  const pendingWork = usePendingOperations(), changingView = useViewTransitionPending();
  const pureDraft: QuestionnaireDraft | null = draft ? {
    assessmentKey: draft.assessmentKey, versionId: draft.versionId, version: draft.version,
    formVersion: draft.formVersion, assessedOn: draft.assessedOn, answers: draft.answers, context: draft.context,
    authorDisplayName: draft.authorDisplayName, createdAt: draft.createdAt, contentHash: draft.contentHash,
  } : null;
  const binding = JSON.stringify([authority, view.epoch, sourceKey, clientId, form.key, pureDraft, blockedReason]);
  const [panel, setPanel] = useState(() => emptyPanel(binding));
  // Adjust this component's own state before committing a different source.
  // Clearing here prevents a later A→B→A render from reviving A's old report.
  if (panel.binding !== binding) setPanel(emptyPanel(binding));
  const active = panel.binding === binding ? panel : emptyPanel(binding);
  const busy = active.busy;
  const attempt = useRef<Attempt | null>(null);
  const life = useRef({ mounted: false, binding, epoch: 0 });
  const live = useRef({ binding, pureDraft, blockedReason });
  useLayoutEffect(() => {
    live.current = { binding, pureDraft, blockedReason };
    const lifecycle = life.current;
    lifecycle.binding = binding; lifecycle.epoch++;
    lifecycle.mounted = true;
    return () => {
      lifecycle.mounted = false; lifecycle.epoch++;
      const owned = attempt.current;
      if (owned) { attempt.current = null; owned.controller.abort(); owned.release(); }
    };
    // Binding includes all source fields; a source/authority ABA invalidates
    // callbacks even when a later render returns to the same field values.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [binding]);
  const report = !blockedReason && !active.expired ? active.result : null;
  useLayoutEffect(() => {
    if (!report) return;
    const timer = setTimeout(() => setPanel(current => current.binding === binding && current.result === report ?
      { ...current, expired: true } : current), Math.max(0, Date.parse(report.generatedAt) + 60_000 - Date.now()));
    return () => clearTimeout(timer);
  }, [report, binding]);

  async function check() {
    if (attempt.current || !live.current.pureDraft || live.current.blockedReason || !canReadQuestionnaireView(context, form.key) ||
      getQuestionnaireViewState().signature !== authority || getQuestionnaireViewState().epoch !== view.epoch) return;
    const release = tryAcquirePendingRecoveryRead();
    if (!release) return;
    const owned: Attempt = { token: Symbol(), controller: new AbortController(), release, epoch: life.current.epoch, binding };
    attempt.current = owned;
    const current = () => attempt.current === owned && life.current.mounted && !owned.controller.signal.aborted &&
      life.current.epoch === owned.epoch && life.current.binding === owned.binding && live.current.binding === owned.binding &&
      getQuestionnaireViewState().signature === authority && getQuestionnaireViewState().epoch === view.epoch;
    setPanel({ ...emptyPanel(binding), busy: true });
    try {
      const found = await readQuestionnaireReadiness({ organizationId: context.organizationId, branchId: context.branchId,
        actorUserId: context.userId, formKey: form.key, clientId, readNonce: crypto.randomUUID(),
        draft: structuredClone(live.current.pureDraft) }, owned.controller.signal);
      if (current()) setPanel(previous => ({ ...previous, result: found }));
    } catch (failure) {
      if (!current()) return;
      if (failure instanceof QuestionnaireReadinessReadError &&
        (failure.status === 401 || failure.status === 403 || failure.code === "INVALID_RESPONSE")) {
        quarantineQuestionnaireView(authority);
        return;
      }
      setPanel(previous => ({ ...previous, error: failure instanceof QuestionnaireReadinessReadError && failure.status === 409
        ? "評估版本已變更，請先重新讀取紀錄。" : "暫時無法檢查；請確認連線後再試一次。" }));
    } finally {
      if (current()) setPanel(previous => ({ ...previous, busy: false }));
      if (attempt.current === owned) attempt.current = null;
      owned.release();
    }
  }
  const visibleError = active.error;
  const unavailable = blockedReason || (!canReadQuestionnaireView(context, form.key) ? "目前帳號沒有這份量表的查閱權限。" :
    !draft ? "請先保存評估，再檢查已保存版本。" : "");
  const disabled = !!unavailable || busy || pendingWork || changingView || context.demo;
  const issueLabel = (path: string) => {
    const question = form.questions.find(item => path === `answers.${item.id}` || path.startsWith(`answers.${item.id}.`));
    if (question) return question.prompt;
    const key = path.replace(/^context\./u, "");
    return form.contextFields?.find(item => item.key === key)?.label ?? form.measurementFields?.find(item => item.key === key)?.label ??
      (key === "qualitative_note" ? "補充觀察" : "評估內容");
  };
  return <section className={styles.panel} aria-label="已保存評估完成檢查" aria-busy={busy}>
    <div className={styles.heading}>
      <div><h2>完成檢查</h2><p>{draft ? `已保存 v${draft.version}・${draft.assessedOn}` : "尚未保存"}</p></div>
      <button className="button button--secondary" type="button" disabled={disabled}
        aria-describedby="questionnaire-readiness-status" onClick={() => { void check(); }}>檢查已保存評估</button>
    </div>
    <div className={styles.status} id="questionnaire-readiness-status" role="status" aria-live="polite">
      {busy ? "正在檢查已保存版本…" : unavailable || (active.expired ? "檢查結果已過期，請重新檢查。" :
        report ? report.candidate.status === "complete" ? "題目已填齊" : report.candidate.status === "invalid" ? "有欄位需要修正" : "還有題目或必要資料未填" : "只檢查已保存的內容，不會保存或簽署。")}
    </div>
    {visibleError ? <p className={styles.error} role="alert">{visibleError}</p> : null}
    {report ? <>
      {report.blockers.includes("version_superseded") ? <p className={styles.warning}>這份評估已有較新版本；目前仍顯示您選擇的舊版本。</p> : null}
      {report.candidate.alerts.map(alert => <p className={styles.warning} role="alert" key={alert.code}>{alert.message}・請由授權人員處理。</p>)}
      {report.candidate.issues.length ? <ul className={styles.issues}>{report.candidate.issues.map((issue, index) => <li key={`${issue.code}-${issue.path}-${index}`}>
        <span>{issueLabel(issue.path)}</span><strong>{issue.category === "invalid" ? "請修正內容" : issue.code === "NOT_APPLICABLE_ANSWER" ? "需確認適用性" : "請補填或核對"}</strong>
      </li>)}</ul> : null}
      {report.candidate.score ? <p>候選試算：{report.candidate.score.adjusted ?? report.candidate.score.raw} {report.candidate.score.unit === "errors" ? "題錯誤" : "分"}（非正式分數）</p> : null}
      <p className={styles.warning}>尚不可正式簽署；這次檢查不會建立正式分數或照顧決策。</p>
      <details className={styles.details}><summary>查看待完成設定</summary>
        <ul><li>量表來源證據封存</li><li>完整規則版本的人工核准</li><li>簽署職務及風險處理規則</li><li>正式簽署與更正流程</li></ul>
        <p>檢查時間：{new Intl.DateTimeFormat("zh-TW", { timeZone: "Asia/Taipei", dateStyle: "medium", timeStyle: "short" }).format(new Date(report.generatedAt))}。清單不會自動更新。</p>
      </details>
    </> : null}
  </section>;
}
