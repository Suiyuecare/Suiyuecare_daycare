"use client";

import { useRouter } from "next/navigation";
import { type FormEvent, useRef, useState } from "react";

import type {
  MealClientOption,
  MealKind,
  MealManagementSnapshot,
  MealReferenceItem,
} from "@/lib/meal-management/types";

import styles from "./meal-management.module.css";

type ActionState = { kind: "idle" | "working" | "success" | "error"; text: string };

function references(value: FormDataEntryValue | null): MealReferenceItem[] {
  const lines = String(value ?? "").split(/\r?\n/u).map((line) => line.trim())
    .filter(Boolean);
  const items = lines.map((line) => {
    const separator = line.indexOf("|");
    const code = separator < 0 ? "" : line.slice(0, separator).trim();
    const label = separator < 0 ? "" : line.slice(separator + 1).trim();
    if (!/^[a-z0-9][a-z0-9_-]{1,63}$/u.test(code) || !label || label.length > 120) {
      throw new Error("每行請使用「小寫代碼|顯示名稱」，例如 peanut|花生。");
    }
    return { code, label };
  });
  if (new Set(items.map(({ code }) => code)).size !== items.length) {
    throw new Error("同一清單的食材代碼不得重複。");
  }
  return items;
}

function clientVersion(client: MealClientOption) {
  return {
    previous_version_id: client.requirementVersionId,
    expected_version: client.requirementVersion ?? 0,
  };
}

export function MealManagementActions({
  canConfirm,
  canManage,
  hasRecentAal2,
  snapshot,
}: {
  canConfirm: boolean;
  canManage: boolean;
  hasRecentAal2: boolean;
  snapshot: MealManagementSnapshot;
}) {
  const router = useRouter();
  const keys = useRef(new Map<string, string>());
  const [state, setState] = useState<ActionState>({ kind: "idle", text: "" });

  async function submit(operation: string, method: "POST" | "PATCH", body: object) {
    const key = keys.current.get(operation) ?? crypto.randomUUID();
    keys.current.set(operation, key);
    setState({ kind: "working", text: "正在以不可重複操作鍵送出…" });
    try {
      const response = await fetch("/api/meal-management", {
        method,
        headers: { "content-type": "application/json", "idempotency-key": key,
          "x-meal-operation": operation },
        body: JSON.stringify(body),
      });
      const payload = await response.json().catch(() => null) as {
        error?: { message?: string };
      } | null;
      if (!response.ok) throw new Error(payload?.error?.message ?? "餐食操作未完成，請保留內容後重試。");
      keys.current.delete(operation);
      setState({ kind: "success", text: "操作已由資料庫確認並建立不可變版本。" });
      router.refresh();
    } catch (error) {
      setState({ kind: "error", text: error instanceof Error ? error.message : "餐食操作未完成。" });
    }
  }

  function onRequirement(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    try {
      const data = new FormData(event.currentTarget);
      const client = snapshot.clients.find(({ clientId }) =>
        clientId === data.get("client_id"));
      if (!client) throw new Error("請選擇目前快照內的個案。");
      const textureState = String(data.get("texture_state"));
      const allergyStatus = String(data.get("allergy_status"));
      const contraindicationStatus = String(data.get("contraindication_status"));
      const allergens = allergyStatus === "recorded" ? references(data.get("allergens")) : [];
      const contraindications = contraindicationStatus === "recorded"
        ? references(data.get("contraindications")) : [];
      if (allergyStatus === "recorded" && allergens.length === 0 ||
        contraindicationStatus === "recorded" && contraindications.length === 0) {
        throw new Error("選擇「已申報」時至少需要一筆精確代碼。");
      }
      void submit("set_requirement", "POST", {
        action: "set_requirement", client_id: client.clientId,
        ...clientVersion(client), effective_from: String(data.get("effective_from")),
        texture_state: textureState,
        texture_label: textureState === "recorded"
          ? String(data.get("texture_label") ?? "").trim() || null : null,
        allergy_status: allergyStatus, allergens,
        contraindication_status: contraindicationStatus, contraindications,
        note: String(data.get("note") ?? "").trim() || null,
      });
    } catch (error) {
      setState({ kind: "error", text: error instanceof Error ? error.message : "餐食需求格式無效。" });
    }
  }

  function onPlan(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    try {
      const data = new FormData(event.currentTarget);
      const mealKind = String(data.get("meal_kind")) as MealKind;
      const existing = snapshot.plans.find((plan) =>
        plan.serviceDate === snapshot.filters.serviceDate && plan.mealKind === mealKind);
      if (existing?.status === "prepared") throw new Error("已完成備餐的菜單不可覆寫，請改用新的餐別或日期。");
      void submit("save_plan", "POST", {
        action: "save_plan", previous_version_id: existing?.planVersionId ?? null,
        expected_version: existing?.version ?? 0,
        service_date: snapshot.filters.serviceDate, meal_kind: mealKind,
        menu_title: String(data.get("menu_title") ?? "").trim(),
        ingredients: references(data.get("ingredients")),
        extra_portions: Number(data.get("extra_portions")),
      });
    } catch (error) {
      setState({ kind: "error", text: error instanceof Error ? error.message : "菜單格式無效。" });
    }
  }

  function onComplete(event: FormEvent<HTMLFormElement>, planId: string) {
    event.preventDefault();
    try {
      const plan = snapshot.plans.find(({ planVersionId }) => planVersionId === planId);
      if (!plan || plan.status !== "review") throw new Error("菜單版本已改變，請重新載入。");
      const data = new FormData(event.currentTarget);
      const resolutions = plan.assignments.flatMap(({ conflicts }) => conflicts.map((conflict) => ({
        conflict_key: conflict.key,
        disposition: String(data.get(`resolution:${conflict.key}:disposition`)),
        note: String(data.get(`resolution:${conflict.key}:note`) ?? "").trim(),
      })));
      const actualPortions = plan.assignments.map((assignment) => ({
        client_id: assignment.clientId,
        portions: Number(data.get(`actual:${assignment.clientId}`)),
      }));
      const actualTotal = actualPortions.reduce((total, item) => total + item.portions, 0) +
        Number(data.get("extra_actual_portions"));
      const varianceReason = String(data.get("variance_reason") ?? "").trim() || null;
      if (actualTotal !== plan.attendanceCount && !varianceReason) {
        throw new Error("實際總份數與出勤人數不同時，必須填寫差異原因。");
      }
      void submit("complete_plan", "PATCH", {
        action: "complete_plan", plan_version_id: plan.planVersionId,
        expected_version: plan.version, resolutions,
        actual_portions: actualPortions,
        extra_actual_portions: Number(data.get("extra_actual_portions")),
        variance_reason: actualTotal === plan.attendanceCount ? null : varianceReason,
      });
    } catch (error) {
      setState({ kind: "error", text: error instanceof Error ? error.message : "備餐資料格式無效。" });
    }
  }

  const writable = !snapshot.demo && hasRecentAal2;
  return <section className="panel">
    <div className="panel__header"><div className="panel__title">
      <h2>餐食作業</h2><p>正式操作皆建立新版本，不覆寫需求或菜單歷史。</p>
    </div></div>
    <div className="panel__body">
      {state.kind !== "idle" ? <p aria-live="polite" className={`callout ${
        state.kind === "error" ? styles.actionError : styles.actionStatus}`}>
        {state.text}</p> : null}
      {snapshot.demo ? <p className="callout" role="status">展示資料唯讀；以下表單只呈現正式工作流程，不會送出。</p> :
        !hasRecentAal2 ? <p className="callout" role="status">最近 15 分鐘 AAL2 驗證已失效；重新驗證後才可送出。</p> : null}
      <div className={styles.actionGrid}>
        <details className={styles.actionCard}>
          <summary>設定個案餐食需求</summary>
          <form onSubmit={onRequirement}>
            <label className="field"><span>個案</span><select disabled={!canManage || !writable} name="client_id" required>
              {snapshot.clients.map((client) => <option key={client.clientId} value={client.clientId}>{client.displayName}・目前 v{client.requirementVersion ?? 0}</option>)}
            </select></label>
            <label className="field"><span>生效日</span><input defaultValue={snapshot.filters.serviceDate} disabled={!canManage || !writable} name="effective_from" required type="date" /></label>
            <label className="field"><span>質地狀態</span><select defaultValue="recorded" disabled={!canManage || !writable} name="texture_state"><option value="recorded">已記錄</option><option value="missing">缺值</option><option value="not_applicable">不適用</option></select></label>
            <label className="field"><span>質地文字（狀態為已記錄時必填）</span><input disabled={!canManage || !writable} maxLength={120} name="texture_label" placeholder="例如：軟質" /></label>
            <label className="field"><span>過敏狀態</span><select defaultValue="unknown" disabled={!canManage || !writable} name="allergy_status"><option value="unknown">尚未確認</option><option value="none_declared">已確認無申報</option><option value="recorded">已申報</option></select></label>
            <label className="field"><span>過敏代碼（每行：代碼|名稱）</span><textarea disabled={!canManage || !writable} name="allergens" placeholder="peanut|花生" rows={3} /></label>
            <label className="field"><span>禁忌狀態</span><select defaultValue="unknown" disabled={!canManage || !writable} name="contraindication_status"><option value="unknown">尚未確認</option><option value="none_declared">已確認無申報</option><option value="recorded">已申報</option></select></label>
            <label className="field"><span>禁忌代碼（每行：代碼|名稱）</span><textarea disabled={!canManage || !writable} name="contraindications" placeholder="raw_food|生食" rows={3} /></label>
            <label className="field"><span>備註</span><textarea disabled={!canManage || !writable} maxLength={1000} name="note" rows={3} /></label>
            <button className="button button--primary" disabled={!canManage || !writable || state.kind === "working"} type="submit">建立需求新版本</button>
          </form>
        </details>
        <details className={styles.actionCard}>
          <summary>建立或修訂當日菜單</summary>
          <form onSubmit={onPlan}>
            <label className="field"><span>服務日期</span><input disabled readOnly value={snapshot.filters.serviceDate} /></label>
            <label className="field"><span>餐別</span><select defaultValue="lunch" disabled={!canManage || !writable} name="meal_kind"><option value="breakfast">早餐</option><option value="morning_snack">上午點心</option><option value="lunch">午餐</option><option value="afternoon_snack">下午點心</option><option value="dinner">晚餐</option></select></label>
            <label className="field"><span>菜單名稱</span><input disabled={!canManage || !writable} maxLength={160} name="menu_title" required /></label>
            <label className="field"><span>食材（每行：代碼|名稱）</span><textarea disabled={!canManage || !writable} name="ingredients" placeholder={"rice|米\nsoy|黃豆"} required rows={5} /></label>
            <label className="field"><span>額外預備份數</span><input defaultValue={0} disabled={!canManage || !writable} max={100} min={0} name="extra_portions" required type="number" /></label>
            <button className="button button--primary" disabled={!canManage || !writable || state.kind === "working"} type="submit">凍結出勤與菜單版本</button>
          </form>
        </details>
      </div>
      {snapshot.plans.filter(({ status }) => status === "review").map((plan) =>
        <details className={`${styles.actionCard} ${styles.completion}`} key={plan.planVersionId}>
          <summary>完成備餐：{plan.menuTitle}（{plan.conflictCount} 項衝突）</summary>
          <form onSubmit={(event) => onComplete(event, plan.planVersionId)}>
            {plan.assignments.map((assignment) => <fieldset key={assignment.clientId}>
              <legend>{assignment.clientDisplayName}</legend>
              <label className="field"><span>實際份數</span><input defaultValue={1} disabled={!canConfirm || !writable} max={5} min={0} name={`actual:${assignment.clientId}`} required type="number" /></label>
              {assignment.conflicts.map((conflict) => <div className={styles.resolution} key={conflict.key}>
                <strong>{conflict.label}</strong>
                <label className="field"><span>人工處置</span><select defaultValue="substituted" disabled={!canConfirm || !writable} name={`resolution:${conflict.key}:disposition`}><option value="verified_safe">確認安全</option><option value="substituted">已替代</option><option value="excluded">已排除</option></select></label>
                <label className="field"><span>處置證據／理由</span><textarea disabled={!canConfirm || !writable} maxLength={1000} name={`resolution:${conflict.key}:note`} required rows={2} /></label>
              </div>)}
            </fieldset>)}
            <label className="field"><span>額外實際份數</span><input defaultValue={0} disabled={!canConfirm || !writable} max={100} min={0} name="extra_actual_portions" required type="number" /></label>
            <label className="field"><span>與出勤不同的差異原因</span><textarea disabled={!canConfirm || !writable} maxLength={1000} name="variance_reason" rows={3} /></label>
            <button className="button button--primary" disabled={!canConfirm || !writable || state.kind === "working"} type="submit">確認衝突並完成備餐</button>
          </form>
        </details>)}
    </div>
  </section>;
}
