"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { type FormEvent, useRef, useState } from "react";
import { z } from "zod";

import { fetchWithTimeout, isClientFetchTimeoutError } from "@/lib/api/client-fetch";
import { parseClientServicePlanApiEnvelope, parseClientServicePlanMutation } from
  "@/lib/client-service-plan-workflow/parser";
import type { ClientServicePlan, ClientServicePlanAction,
  ClientServicePlanGoalInput, ClientServicePlanMeasureInput,
  ClientServicePlanMutationInput, ClientServicePlanSnapshot } from
  "@/lib/client-service-plan-workflow/types";

import styles from "./client-service-plans.module.css";

type ResultState = { kind: "idle" | "working" | "success" | "error" | "unknown"; message: string };
type EditableGoal = ClientServicePlanGoalInput;
type EditableMeasure = ClientServicePlanMeasureInput;
type FrozenOperation = { input: ClientServicePlanMutationInput; organizationId: string; branchId: string };

class ConfirmedFailure extends Error {}
class OutcomeUnknown extends Error {}

function errorText(error: unknown) {
  if (isClientFetchTimeoutError(error) || error instanceof TypeError) {
    return "連線中斷或逾時，保存結果未知；請勿修改內容，使用相同操作鍵重試。";
  }
  return error instanceof Error ? error.message : "個案服務計畫操作未完成。";
}

async function knownError(response: Response) {
  const payload: unknown = await response.json().catch(() => null);
  if (response.ok) return payload;
  const parsed = z.object({ requestId: z.uuid(), status: z.literal("error"), data: z.null(),
    errors: z.array(z.object({ code: z.string(), message: z.string().max(500),
      field: z.string().max(120).optional() }).strict()).min(1).max(20) }).strict().safeParse(payload);
  const codes: Record<number, string[]> = {
    400: ["INVALID_CLIENT_SERVICE_PLAN_OPERATION", "INVALID_JSON", "INVALID_IDEMPOTENCY_KEY"],
    401: ["AUTH_REQUIRED"],
    403: ["CLIENT_SERVICE_PLAN_NOT_AUTHORIZED", "DEMO_READ_ONLY", "AAL2_REQUIRED"],
    409: ["CLIENT_SERVICE_PLAN_VERSION_CONFLICT", "CLIENT_SERVICE_PLAN_IDEMPOTENCY_CONFLICT", "CLIENT_SERVICE_PLAN_STATE_CONFLICT"],
    413: ["REQUEST_TOO_LARGE"], 503: ["SERVICE_NOT_CONFIGURED"],
  };
  if (parsed.success && parsed.data.errors.every((item) => codes[response.status]?.includes(item.code))) {
    throw new ConfirmedFailure(parsed.data.errors[0]!.message);
  }
  throw new OutcomeUnknown("回覆無法證明原操作已回滾；保存結果仍待核對，請保留原內容與操作鍵重試。");
}

function PendingResolution({ pending, state, allowed, onRetry, label }: {
  pending: FrozenOperation; state: ResultState; allowed: boolean;
  onRetry: () => void; label: string;
}) {
  return <section aria-label="原操作結果待核對" className={styles.reauth}>
    <p>原操作結果待核對；保留原始{pending.input.action === "create_draft" ? "建立" : "版本"}請求，
      不會改送目前清單中的其他版本。</p>
    <p role="status">{state.message}</p>
    {state.kind === "unknown" ? <button className="button button--primary" disabled={!allowed}
      onClick={onRetry} type="button">{label}</button> : null}
    {!allowed ? <p>請回到原機構／分支並恢復這項操作所需的權限與重新驗證，才能核對原結果。</p> : null}
  </section>;
}

async function sendAndParse(input: ClientServicePlanMutationInput,
  expectedOrganizationId: string, expectedBranchId: string) {
  let response: Response;
  try {
    response = await fetchWithTimeout("/api/client-service-plans", { method: "POST",
      cache: "no-store", headers: { "content-type": "application/json",
        "idempotency-key": input.idempotencyKey,
        "x-client-service-plan-operation": input.action },
      body: JSON.stringify(clientServicePlanMutationBody(input)) });
  } catch (error) {
    throw new OutcomeUnknown(errorText(error));
  }
  const payload = await knownError(response);
  if (!response.ok) {
    throw new ConfirmedFailure("個案服務計畫操作已被拒絕。");
  }
  try {
    return parseClientServicePlanApiEnvelope(payload, response.status, input,
      expectedOrganizationId, expectedBranchId);
  } catch {
    throw new OutcomeUnknown("成功回應無法與原操作完整核對；表單已凍結，請使用相同操作鍵精確重試。");
  }
}

export function clientServicePlanMutationBody(input: ClientServicePlanMutationInput) {
  const base = { action: input.action, client_id: input.clientId, plan_key: input.planKey,
    expected_terminal_id: input.expectedTerminalId,
    expected_terminal_version: input.expectedTerminalVersion,
    expected_terminal_payload_hash: input.expectedTerminalPayloadHash,
    expected_authorized_care_plan_id: input.expectedAuthorizedCarePlanId,
    expected_authorized_content_hash: input.expectedAuthorizedContentHash,
    reason: input.reason };
  if (input.action !== "create_draft" && input.action !== "revise_draft") return {
    ...base, effective_from: null, effective_to: null, review_due_on: null,
    responsible_user_id: null, goals: null, planned_services: null };
  return { ...base, effective_from: input.effectiveFrom, effective_to: input.effectiveTo,
    review_due_on: input.reviewDueOn, responsible_user_id: input.responsibleUserId,
    goals: input.goals.map((item) => ({ goal_id: item.goalId, item_order: item.itemOrder,
      goal: item.goal, target_outcome: item.targetOutcome })),
    planned_services: input.plannedServices.map((item) => ({ measure_id: item.measureId,
      item_order: item.itemOrder, goal_id: item.goalId, measure: item.measure,
      frequency: item.frequency, responsible_user_id: item.responsibleUserId })) };
}

function blankGoal(order: number): EditableGoal { return { goalId: crypto.randomUUID(), itemOrder: order,
  goal: "", targetOutcome: "" }; }
function blankMeasure(order: number, goalId: string, responsibleUserId: string): EditableMeasure {
  return { measureId: crypto.randomUUID(), itemOrder: order, goalId, measure: "", frequency: "",
    responsibleUserId };
}

function PlanFields({ snapshot, initial, selectedClientId, onClient }: {
  snapshot: ClientServicePlanSnapshot;
  initial?: ClientServicePlan;
  selectedClientId: string;
  onClient?: (clientId: string) => void;
}) {
  const [firstGoalId] = useState(() => initial?.contentMappingStatus === "configured" && initial.goals[0] ?
    initial.goals[0].goalId : crypto.randomUUID());
  const [initialResponsible] = useState(() => initial?.responsibleUserId ?? snapshot.staff[0]?.userId ?? "");
  const [responsibleId, setResponsibleId] = useState(initialResponsible);
  const [goals, setGoals] = useState<EditableGoal[]>(() =>
      initial?.contentMappingStatus === "configured" && initial.goals.length ?
      initial.goals.map((item) => ({ ...item })) : [{ goalId: firstGoalId,
        itemOrder: 1, goal: "", targetOutcome: "" }]);
  const [measures, setMeasures] = useState<EditableMeasure[]>(() =>
    initial?.contentMappingStatus === "configured" && initial.plannedServices.length ?
      initial.plannedServices.map((item) => ({ measureId: item.measureId,
        itemOrder: item.itemOrder, goalId: item.goalId, measure: item.measure,
        frequency: item.frequency, responsibleUserId: item.responsibleUserId })) :
      [blankMeasure(1, firstGoalId, initialResponsible)]);
  const authorizations = snapshot.authorizations.filter((item) => item.clientId === selectedClientId);
  return <>
    {!initial ? <label><span>個案</span><select name="client_id" required value={selectedClientId}
      onChange={(event) => onClient?.(event.target.value)}>{snapshot.clients.filter((item) => item.canManage)
        .map((item) => <option key={item.clientId} value={item.clientId}>{item.displayName}（{item.clientCode}）</option>)}</select></label> : null}
    <label><span>核定照顧計畫（檢視日期的精確版本）</span><select key={selectedClientId} name="authorization_id" required
      defaultValue={authorizations.some((item) => item.authorizedCarePlanId === initial?.authorizedCarePlanId) ?
        initial?.authorizedCarePlanId : authorizations[0]?.authorizedCarePlanId}>{authorizations.map((item) =>
        <option key={item.authorizedCarePlanId} value={item.authorizedCarePlanId}>v{item.version}・{item.effectiveFrom}～{item.effectiveTo}・{item.sourceSystem}</option>)}</select>
      <small>依檢視日期 {snapshot.filters.asOf} 提供有效已簽版本；建立未來計畫前請先切換檢視日期。送出時仍核對完整服務期間。</small>
      {!authorizations.length ? <small role="alert">此個案在檢視日期沒有可用的已簽核定版本，無法建立或修訂。</small> : null}</label>
    <label><span>生效日</span><input defaultValue={initial?.effectiveFrom ?? ""} name="effective_from" required type="date" /></label>
    <label><span>結束日</span><input defaultValue={initial?.effectiveTo ?? ""} name="effective_to" required type="date" /></label>
    <label><span>檢討日</span><input defaultValue={initial?.reviewDueOn ?? ""} name="review_due_on" required type="date" /></label>
    <label><span>主要負責人</span><select value={responsibleId} onChange={(event) => setResponsibleId(event.target.value)}
      name="responsible_user_id" required>
      {!snapshot.staff.some((item) => item.userId === responsibleId) ?
        <option disabled value={responsibleId}>原負責人已不可選，請重新指定</option> : null}
      {snapshot.staff.map((item) => <option key={item.userId} value={item.userId}>{item.displayName}（有效任用）</option>)}</select></label>
    <fieldset className={styles.fieldGroup}><legend>服務目標</legend>{goals.map((goal, index) =>
      <div className={styles.repeatRow} key={goal.goalId}><label><span>順序</span><input readOnly value={index + 1} /></label>
        <label><span>目標</span><textarea maxLength={1000} required value={goal.goal} onChange={(event) =>
          setGoals((items) => items.map((item) => item.goalId === goal.goalId ? { ...item, goal: event.target.value } : item))} /></label>
        <label><span>預期成果</span><textarea maxLength={1000} required value={goal.targetOutcome} onChange={(event) =>
          setGoals((items) => items.map((item) => item.goalId === goal.goalId ? { ...item, targetOutcome: event.target.value } : item))} /></label>
        <button aria-label={`移除第 ${index + 1} 個目標`} className={styles.iconButton} disabled={goals.length === 1}
          onClick={() => { setGoals((items) => items.filter((item) => item.goalId !== goal.goalId)
            .map((item, itemIndex) => ({ ...item, itemOrder: itemIndex + 1 })));
            setMeasures((items) => items.filter((item) => item.goalId !== goal.goalId)
              .map((item, itemIndex) => ({ ...item, itemOrder: itemIndex + 1 }))); }} type="button">移除</button></div>)}
      <button className="button button--secondary" disabled={goals.length >= 50} onClick={() =>
        setGoals((items) => [...items, blankGoal(items.length + 1)])} type="button">新增目標</button></fieldset>
    <fieldset className={styles.fieldGroup}><legend>服務措施、頻率與負責人</legend>{measures.map((measure, index) =>
      <div className={`${styles.repeatRow} ${styles.measureRow}`} key={measure.measureId}><label><span>順序</span><input readOnly value={index + 1} /></label>
        <label><span>對應目標</span><select required value={measure.goalId} onChange={(event) => setMeasures((items) =>
          items.map((item) => item.measureId === measure.measureId ? { ...item, goalId: event.target.value } : item))}>
          {goals.map((item, goalIndex) => <option key={item.goalId} value={item.goalId}>目標 {goalIndex + 1}</option>)}</select></label>
        <label><span>措施</span><textarea maxLength={2000} required value={measure.measure} onChange={(event) => setMeasures((items) =>
          items.map((item) => item.measureId === measure.measureId ? { ...item, measure: event.target.value } : item))} /></label>
        <label><span>頻率</span><textarea maxLength={500} required value={measure.frequency} onChange={(event) => setMeasures((items) =>
          items.map((item) => item.measureId === measure.measureId ? { ...item, frequency: event.target.value } : item))} /></label>
        <label><span>負責人</span><select required value={measure.responsibleUserId} onChange={(event) => setMeasures((items) =>
          items.map((item) => item.measureId === measure.measureId ? { ...item, responsibleUserId: event.target.value } : item))}>
          {!snapshot.staff.some((item) => item.userId === measure.responsibleUserId) ?
            <option disabled value={measure.responsibleUserId}>原負責人已不可選，請重新指定</option> : null}
          {snapshot.staff.map((item) => <option key={item.userId} value={item.userId}>{item.displayName}</option>)}</select></label>
        <button aria-label={`移除第 ${index + 1} 個措施`} className={styles.iconButton} disabled={measures.length === 1}
          onClick={() => setMeasures((items) => items.filter((item) => item.measureId !== measure.measureId)
            .map((item, itemIndex) => ({ ...item, itemOrder: itemIndex + 1 })))} type="button">移除</button></div>)}
      <button className="button button--secondary" disabled={measures.length >= 100 || !goals.length}
        onClick={() => setMeasures((items) => [...items,
          blankMeasure(items.length + 1, goals[0]!.goalId, responsibleId)])} type="button">新增措施</button>
      <input name="structured_goals" type="hidden" value={JSON.stringify(goals.map((item, index) => ({
        goal_id: item.goalId, item_order: index + 1, goal: item.goal,
        target_outcome: item.targetOutcome })))} />
      <input name="structured_measures" type="hidden" value={JSON.stringify(measures.map((item, index) => ({
        measure_id: item.measureId, item_order: index + 1, goal_id: item.goalId,
        measure: item.measure, frequency: item.frequency,
        responsible_user_id: item.responsibleUserId })))} />
    </fieldset>
  </>;
}

function contentFrom(data: FormData) {
  return { effective_from: String(data.get("effective_from") ?? ""),
    effective_to: String(data.get("effective_to") ?? ""), review_due_on: String(data.get("review_due_on") ?? ""),
    responsible_user_id: String(data.get("responsible_user_id") ?? ""),
    goals: JSON.parse(String(data.get("structured_goals") ?? "[]")),
    planned_services: JSON.parse(String(data.get("structured_measures") ?? "[]")) };
}

export function CreateClientServicePlan({ snapshot, canManage }: {
  snapshot: ClientServicePlanSnapshot; canManage: boolean;
}) {
  const router = useRouter(); const idempotency = useRef<string | null>(null);
  const planKey = useRef<string | null>(null); const failed = useRef(false);
  const inFlight = useRef(false);
  const [pending, setPending] = useState<FrozenOperation | null>(null);
  const clients = snapshot.clients.filter((item) => item.canManage && snapshot.authorizations.some(
    (authorization) => authorization.clientId === item.clientId));
  const [clientId, setClientId] = useState(clients[0]?.clientId ?? "");
  const effectiveClientId = clients.some((item) => item.clientId === clientId) ? clientId : clients[0]?.clientId ?? "";
  const [state, setState] = useState<ResultState>({ kind: "idle", message: "" });
  const writable = canManage && !snapshot.demo && clients.length > 0 && snapshot.staff.length > 0;
  const retryAllowed = canManage && !snapshot.demo && pending?.organizationId === snapshot.organizationId &&
    pending?.branchId === snapshot.branchId;
  if (!writable && !pending) return null;
  function changed() { if (failed.current) idempotency.current = null;
    failed.current = false; if (state.kind === "error") setState({ kind: "idle", message: "" }); }
  async function execute(operation: FrozenOperation) {
    if (inFlight.current) return; inFlight.current = true;
    const wasUnconfirmed = pending !== null;
    const { input } = operation; setPending(operation);
    setState({ kind: "working", message: "正在鎖定個案、核定來源、目標與措施…" });
    try {
      const receipt = await sendAndParse(input, operation.organizationId, operation.branchId);
      idempotency.current = null; planKey.current = null; setPending(null); failed.current = false;
      setState({ kind: "success", message: `草稿 v${receipt.version} 已建立；尚未核准或簽署。` });
      router.refresh();
    } catch (error) {
      if (error instanceof OutcomeUnknown || wasUnconfirmed) { failed.current = false;
        setState({ kind: "unknown", message: `${errorText(error)} 原操作仍待核對，尚未解除凍結。` }); }
      else { setPending(null); failed.current = true;
        setState({ kind: "error", message: errorText(error) }); }
    } finally { inFlight.current = false; }
  }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (inFlight.current || pending || !writable) return;
    idempotency.current ??= crypto.randomUUID(); planKey.current ??= crypto.randomUUID();
    try {
      const data = new FormData(event.currentTarget);
      const authorization = snapshot.authorizations.find((item) =>
        item.authorizedCarePlanId === String(data.get("authorization_id")) && item.clientId === effectiveClientId);
      if (!authorization) throw new Error("核定版本已不在此個案的可用清單，請重新載入。");
      const input = parseClientServicePlanMutation({ action: "create_draft", client_id: effectiveClientId,
        plan_key: planKey.current, expected_terminal_id: null, expected_terminal_version: 0,
        expected_terminal_payload_hash: null,
        expected_authorized_care_plan_id: authorization.authorizedCarePlanId,
        expected_authorized_content_hash: authorization.contentHash,
        ...contentFrom(data), reason: "建立個案服務計畫初稿" }, idempotency.current);
      await execute({ input, organizationId: snapshot.organizationId, branchId: snapshot.branchId });
    } catch (error) { failed.current = true;
      setState({ kind: "error", message: errorText(error) }); }
  }
  return <section aria-label="新增個案服務計畫" className={styles.actions}><details className={styles.action}>
    <summary>建立個案服務計畫草稿</summary><form onInput={changed} onSubmit={submit}>
      <fieldset className={styles.formGrid} hidden={Boolean(pending) || !writable}
        disabled={Boolean(pending) || !writable}>
        <PlanFields key={effectiveClientId} snapshot={snapshot} selectedClientId={effectiveClientId} onClient={setClientId} />
        <button className="button button--primary" type="submit">建立不可變草稿版本</button>
      </fieldset>{pending ? <PendingResolution pending={pending} state={state} allowed={retryAllowed}
        onRetry={() => { if (retryAllowed) void execute(pending); }} label="以完全相同內容與操作鍵重試" /> : null}
      {!pending && state.kind !== "idle" ? <p className={state.kind === "error" || state.kind === "unknown" ? styles.error : styles.message}
        role="status">{state.message}</p> : null}</form></details></section>;
}

export function ClientServicePlanActions({ plan, snapshot, canManage, canApprove, canSign, hasRecentAal2 }: {
  plan: ClientServicePlan; snapshot: ClientServicePlanSnapshot;
  canManage: boolean; canApprove: boolean; canSign: boolean; hasRecentAal2: boolean;
}) {
  const router = useRouter(); const idempotency = useRef<string | null>(null); const failed = useRef(false);
  const inFlight = useRef(false);
  const [pending, setPending] = useState<FrozenOperation | null>(null);
  const options: ClientServicePlanAction[] = plan.status === "voided" ? [] : [
    ...(snapshot.authorizations.some((item) => item.clientId === plan.clientId) ? ["revise_draft" as const] : []),
    ...(canApprove && plan.status === "draft" && plan.contentMappingStatus === "configured" &&
      plan.authorizationStatus === "current" ? ["approve" as const] : []),
    ...(canSign && plan.status === "approved" && plan.contentMappingStatus === "configured" &&
      plan.authorizationStatus === "current" ? ["sign" as const] : []),
    ...(canApprove && canSign ? ["void" as const] : [])];
  const [operation, setOperation] = useState<ClientServicePlanAction>(options[0] ?? "void");
  const [state, setState] = useState<ResultState>({ kind: "idle", message: "" });
  if ((!canManage || snapshot.demo) && !pending) return <span className={styles.noAction}>{snapshot.demo ?
    "合成展示唯讀" : "無版本操作權限"}</span>;
  if (!options.length && !pending) return <span className={styles.noAction}>{plan.status === "voided" ?
    "此版本鏈已終止" : "目前沒有可執行的版本操作；請確認核定來源與權限。"}</span>;
  const effectiveOperation = options.includes(operation) ? operation : options[0] ?? operation;
  const contentAction = effectiveOperation === "revise_draft";
  const needsRecent = ["approve","sign","void"].includes(effectiveOperation);
  const retryAction = pending?.input.action;
  const retryAllowed = canManage && !snapshot.demo && pending?.organizationId === snapshot.organizationId &&
    pending?.branchId === snapshot.branchId &&
    (!(retryAction === "approve" || retryAction === "void") || canApprove) &&
    (!(retryAction === "sign" || retryAction === "void") || canSign) &&
    (!retryAction || !["approve","sign","void"].includes(retryAction) || hasRecentAal2);
  function changed() { if (failed.current) idempotency.current = null; failed.current = false;
    if (state.kind === "error") setState({ kind: "idle", message: "" }); }
  async function execute(operation: FrozenOperation) {
    if (inFlight.current) return; inFlight.current = true;
    const wasUnconfirmed = pending !== null;
    const { input } = operation; setPending(operation);
    setState({ kind: "working", message: "正在鎖定最新終端版本、內容指紋與核定來源…" });
    try {
      const receipt = await sendAndParse(input, operation.organizationId, operation.branchId);
      idempotency.current = null; setPending(null); failed.current = false;
      setState({ kind: "success", message: `${input.action === "approve" ? "已核准" : input.action === "sign" ?
        "已簽署" : input.action === "void" ? "已作廢" : "新草稿已建立"}（v${receipt.version}）。` });
      router.refresh();
    } catch (error) {
      if (error instanceof OutcomeUnknown || wasUnconfirmed) { failed.current = false;
        setState({ kind: "unknown", message: `${errorText(error)} 原操作仍待核對，尚未解除凍結。` }); }
      else { setPending(null); failed.current = true;
        setState({ kind: "error", message: errorText(error) }); }
    } finally { inFlight.current = false; }
  }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (inFlight.current || pending || !canManage || snapshot.demo ||
      !options.length || (needsRecent && !hasRecentAal2)) return;
    idempotency.current ??= crypto.randomUUID();
    try {
      const data = new FormData(event.currentTarget); let authorization = snapshot.authorizations.find((item) =>
        item.authorizedCarePlanId === String(data.get("authorization_id")) && item.clientId === plan.clientId);
      if (!contentAction) authorization = { authorizedCarePlanId: plan.authorizedCarePlanId,
        clientId: plan.clientId, planKey: plan.authorizedPlanKey, version: plan.authorizedVersion,
        contentHash: plan.authorizedContentHash, effectiveFrom: plan.effectiveFrom,
        effectiveTo: plan.effectiveTo, sourceSystem: plan.authorizedSourceSystem,
        sourceRecordId: plan.authorizedSourceRecordId, status: "current" };
      if (!authorization) throw new Error("核定版本已改變，請重新載入。");
      const base = { action: effectiveOperation, client_id: plan.clientId, plan_key: plan.planKey,
        expected_terminal_id: plan.planId, expected_terminal_version: plan.version,
        expected_terminal_payload_hash: plan.payloadHash,
        expected_authorized_care_plan_id: authorization.authorizedCarePlanId,
        expected_authorized_content_hash: authorization.contentHash,
        reason: String(data.get("reason") ?? "").trim() };
      const input = parseClientServicePlanMutation(contentAction ? { ...base, ...contentFrom(data) } : {
        ...base, effective_from: null, effective_to: null, review_due_on: null,
        responsible_user_id: null, goals: null, planned_services: null }, idempotency.current);
      await execute({ input, organizationId: snapshot.organizationId, branchId: snapshot.branchId });
    } catch (error) { failed.current = true; setState({ kind: "error", message: errorText(error) }); }
  }
  return <details className={styles.rowAction}><summary>版本操作</summary><form onInput={changed} onSubmit={submit}>
    <fieldset className={styles.formGrid} hidden={Boolean(pending)}
      disabled={Boolean(pending) || !canManage || snapshot.demo || (needsRecent && !hasRecentAal2)}>
      <label><span>操作</span><select value={effectiveOperation} onChange={(event) => {
        setOperation(event.target.value as ClientServicePlanAction); changed(); }}>{options.map((item) =>
        <option key={item} value={item}>{item === "revise_draft" ? "建立修訂草稿" : item === "approve" ?
          "核准草稿" : item === "sign" ? "簽署核准版本" : "作廢此版本鏈"}</option>)}</select></label>
      {contentAction ? <><p className={styles.comparison}><strong>修訂基準：</strong>v{plan.version}・{plan.status}・
        內容指紋 {plan.payloadHash.slice(0, 12)}…。請逐欄確認後建立新草稿；舊版不會被覆寫。</p>
        <PlanFields key={`${plan.planId}:${effectiveOperation}`} snapshot={snapshot}
          initial={plan} selectedClientId={plan.clientId} /></> :
        <p className={styles.comparison}><strong>凍結版本：</strong>v{plan.version}・內容指紋 {plan.payloadHash.slice(0, 12)}…。
          此操作不接受瀏覽器提供簽章、核准雜湊或簽署時間。</p>}
      <label className={styles.wide}><span>{effectiveOperation === "void" ? "作廢理由" : effectiveOperation === "sign" ?
        "簽署目的／理由" : effectiveOperation === "approve" ? "核准理由" : "修訂理由"}（至少 8 字）</span>
        <textarea maxLength={1000} minLength={8} name="reason" required rows={3} /></label>
      <button className="button button--primary" disabled={state.kind === "working" || (needsRecent && !hasRecentAal2)} type="submit">鎖定版本並送出</button>
    </fieldset>{pending ? <PendingResolution pending={pending} state={state} allowed={retryAllowed}
      onRetry={() => { if (retryAllowed) void execute(pending); }} label="以完全相同版本、內容與操作鍵重試" /> : null}
    {needsRecent && !hasRecentAal2 ? <p className={styles.reauth}>核准、簽署與作廢需同一工作階段最近 15 分鐘 AAL2。 <Link href="/mfa?audience=staff">重新驗證</Link></p> : null}
    {!pending && state.kind !== "idle" ? <p className={state.kind === "error" || state.kind === "unknown" ? styles.error : styles.message}
      role="status">{state.message}</p> : null}</form></details>;
}
