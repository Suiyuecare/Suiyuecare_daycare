import {
  AlertTriangle,
  CheckCircle2,
  ChevronRight,
  CircleAlert,
  ClipboardList,
  Search,
  ShieldCheck,
  Utensils,
} from "lucide-react";
import Link from "next/link";

import type { PageCatalogEntry } from "@/lib/catalog/types";
import type {
  MealAssignment,
  MealKind,
  MealManagementFilters,
  MealManagementSnapshot,
  MealPlan,
} from "@/lib/meal-management/types";

import { MealManagementActions } from "./meal-management-actions";
import styles from "./meal-management.module.css";

const MEAL_LABELS: Record<MealKind, string> = {
  breakfast: "早餐",
  morning_snack: "上午點心",
  lunch: "午餐",
  afternoon_snack: "下午點心",
  dinner: "晚餐",
};

function formatTimestamp(value: string) {
  return new Intl.DateTimeFormat("zh-TW", {
    timeZone: "Asia/Taipei", dateStyle: "short", timeStyle: "medium",
  }).format(new Date(value));
}

function textureText(assignment: MealAssignment) {
  if (assignment.textureState === "recorded") return assignment.textureLabel;
  if (assignment.textureState === "missing") return "尚未確認";
  if (assignment.textureState === "not_applicable") return "不適用";
  return "尚未設定需求";
}

function disclosureText(
  status: MealAssignment["allergyStatus"],
  labels: readonly string[],
) {
  if (status === "recorded") return labels.join("、");
  if (status === "none_declared") return "已確認無申報項目";
  if (status === "unknown") return "尚未確認";
  return "尚未設定需求";
}

function ResolutionPill({ assignment }: { assignment: MealAssignment }) {
  const labels = {
    not_required: "無衝突",
    pending: "待人工處置",
    resolved: "已人工處置",
  };
  return <span className={`status-pill ${assignment.resolutionStatus === "pending"
    ? "status-pill--warning" : "status-pill--neutral"}`}>
    {labels[assignment.resolutionStatus]}
  </span>;
}

function AssignmentDetails({ plan }: { plan: MealPlan }) {
  return <details className={styles.details}>
    <summary>逐人出勤與餐食需求（{plan.assignments.length} 人）</summary>
    <div className={styles.assignmentGrid}>
      {plan.assignments.map((assignment) => <article
        className={styles.assignment} key={assignment.clientId}>
        <div className={styles.assignmentHeading}>
          <div><strong>{assignment.clientDisplayName}</strong>
            <small>{assignment.clientCode}</small></div>
          <ResolutionPill assignment={assignment} />
        </div>
        <dl>
          <div><dt>質地</dt><dd>{textureText(assignment)}</dd></div>
          <div><dt>預計／實際</dt><dd>{assignment.plannedPortions}／{assignment.actualPortions ?? "待填"} 份</dd></div>
          <div><dt>過敏</dt><dd>{disclosureText(
            assignment.allergyStatus, assignment.allergenLabels,
          )}</dd></div>
          <div><dt>禁忌</dt><dd>{disclosureText(
            assignment.contraindicationStatus,
            assignment.contraindicationLabels,
          )}</dd></div>
        </dl>
        {assignment.conflicts.length ? <ul className={styles.conflicts}>
          {assignment.conflicts.map((conflict) =>
            <li key={conflict.key}><AlertTriangle aria-hidden="true" />
              <span>{conflict.label}<small>{conflict.itemCode
                ? `精確代碼：${conflict.itemCode}` : "需人工確認"}</small></span>
            </li>)}
        </ul> : <p className={styles.clear}><CheckCircle2 aria-hidden="true" />未偵測到結構化衝突</p>}
      </article>)}
    </div>
  </details>;
}

function PlanStatus({ plan }: { plan: MealPlan }) {
  return <div className={styles.statusStack}>
    <span className={`status-pill ${plan.status === "prepared"
      ? "status-pill--success" : "status-pill--warning"}`}>
      {plan.status === "prepared" ? "備餐已完成" : "待衝突確認"}
    </span>
    <small>v{plan.version}・{plan.createdByDisplayName}</small>
  </div>;
}

export function MealManagementWorkspace({
  canConfirm,
  canManage,
  filters,
  hasRecentAal2,
  loadError = false,
  page,
  snapshot,
}: {
  canConfirm: boolean;
  canManage: boolean;
  filters: MealManagementFilters;
  hasRecentAal2: boolean;
  loadError?: boolean;
  page: PageCatalogEntry;
  snapshot: MealManagementSnapshot | null;
}) {
  if (loadError || !snapshot) return <section
    className="empty-card core-care-state" role="alert">
    <span className="empty-card__icon empty-card__icon--warning">
      <CircleAlert aria-hidden="true" />
    </span>
    <h1>餐食管理暫時無法載入</h1>
    <p>正式快照採失敗即關閉；系統沒有擴大機構、分支或個案範圍，也沒有改用展示資料。</p>
    <a className="button button--secondary" href="?">重新載入</a>
  </section>;

  return <>
    <nav aria-label="所在位置" className="context-bar">
      <span>工作台</span><ChevronRight aria-hidden="true" />
      <span>服務管理</span><ChevronRight aria-hidden="true" />
      <span aria-current="page" className="context-bar__crumb">{page.title}</span>
    </nav>
    <header className="page-heading core-care-heading">
      <div><p className="eyebrow">出勤逐人對帳・頁面 {page.number}</p>
        <h1>{page.title}</h1>
        <p className="page-heading__description">
          將當日出勤、餐食需求、精確食材代碼、衝突處置及實際份數凍結在同一版次，不以姓名或模糊文字自動判斷。
        </p></div>
    </header>

    {snapshot.demo ? <div className={`callout ${styles.demo}`} role="status">
      <CircleAlert aria-hidden="true" />
      <span><strong>展示模式：</strong>個案、菜單、過敏、禁忌、衝突與份數皆為合成資料；所有寫入按鈕維持唯讀。</span>
    </div> : <div className={`callout ${styles.security}`} role="status">
      <ShieldCheck aria-hidden="true" />
      <span>只載入目前機構、分支與可存取個案；每次寫入均需完整餐食／出勤／健康權限與最近 15 分鐘 AAL2。</span>
    </div>}
    <div className={`callout ${styles.governance}`} role="note">
      <ClipboardList aria-hidden="true" />
      <span><strong>規則邊界：</strong>正式質地代碼表尚未發布，因此「特殊質地」總數不臆測；過敏與禁忌只做精確代碼比對，所有警示都要由人員確認。</span>
    </div>
    <div className={`callout ${styles.offline}`} role="status">
      <ShieldCheck aria-hidden="true" />
      <span><strong>尚未設定：</strong>離線快取與餐食匯出目前停用；不得把本頁資料保存到離線裝置。</span>
    </div>

    <section aria-label="餐食摘要" className="metric-grid">
      {[
        ["預計份數", snapshot.expectedPortionTotal, "份", "含出勤人數與額外預備", <Utensils key="expected" aria-hidden="true" />],
        ["實際份數", snapshot.actualPortionTotal, "份", "只計已完成備餐的版本", <CheckCircle2 key="actual" aria-hidden="true" />],
        ["特殊質地", snapshot.specialTextureTotal ?? "—", "", "正式質地規則未發布", <ClipboardList key="texture" aria-hidden="true" />],
        ["餐食衝突", snapshot.conflictTotal, "項", "逐項人工處置，不自動決策", <AlertTriangle key="conflict" aria-hidden="true" />],
      ].map(([label, value, unit, foot, icon]) => <article
        className="metric-card" key={String(label)}>
        <div className="metric-card__top"><span>{label}</span>
          <span className="metric-card__icon">{icon}</span></div>
        <div className="metric-card__value"><strong>{value}</strong><span>{unit}</span></div>
        <p className="metric-card__foot">{foot}</p>
      </article>)}
    </section>

    <section className="panel">
      <div className="panel__header"><div className="panel__title">
        <h2>日期、餐別與衝突篩選</h2>
        <p>快照 {formatTimestamp(snapshot.generatedAt)}・逾時點 {formatTimestamp(snapshot.staleAfter)}</p>
      </div></div>
      <form className={`filter-bar ${styles.filters}`} method="get">
        <label className="field field--compact"><span>日期</span>
          <input defaultValue={filters.serviceDate} name="date" type="date" /></label>
        <label className="field field--compact"><span>餐別</span>
          <select defaultValue={filters.mealKind} name="meal">
            <option value="all">全部餐別</option>
            {Object.entries(MEAL_LABELS).map(([value, label]) =>
              <option key={value} value={value}>{label}</option>)}
          </select></label>
        <label className="field field--compact"><span>質地文字</span>
          <input defaultValue={filters.textureQuery} maxLength={80}
            name="texture" placeholder="例如：軟質" /></label>
        <label className="field field--compact"><span>衝突</span>
          <select defaultValue={filters.conflict} name="conflict">
            <option value="all">全部</option>
            <option value="with_conflicts">有衝突</option>
            <option value="clear">無衝突</option>
          </select></label>
        <button className="button button--secondary" type="submit">套用篩選</button>
        <Link className="button button--quiet" href={`?date=${filters.serviceDate}`}>清除</Link>
      </form>
    </section>

    <MealManagementActions canConfirm={canConfirm} canManage={canManage}
      hasRecentAal2={hasRecentAal2} snapshot={snapshot} />

    <section className="panel">
      <div className="panel__header"><div className="panel__title">
        <h2>菜單與逐人份數</h2>
        <p>{snapshot.matchingPlanTotal} 份符合條件的菜單版本</p>
      </div></div>
      {snapshot.plansTruncated ? <div className="callout" role="status">
        <CircleAlert aria-hidden="true" /><span>結果超過 100 份；摘要仍由完整集合計算，畫面只顯示前 100 份。</span>
      </div> : null}
      {snapshot.plans.length ? <>
        <div aria-label="餐食菜單清單，可左右捲動"
          className={`table-wrap ${styles.table}`} role="region" tabIndex={0}>
          <table className="data-table"><thead><tr>{[
            "餐別／菜單", "食材", "出勤與份數", "衝突", "狀態", "逐人明細",
          ].map((heading) => <th key={heading} scope="col">{heading}</th>)}</tr></thead>
          <tbody>{snapshot.plans.map((plan) => <tr key={plan.planVersionId}>
            <td><strong>{MEAL_LABELS[plan.mealKind]}</strong><small
              className="data-table__secondary">{plan.menuTitle}</small></td>
            <td>{plan.ingredients.map(({ label }) => label).join("、")}</td>
            <td>{plan.attendanceCount} 人・預計 {plan.plannedPortionTotal} 份
              <small className="data-table__secondary">實際 {plan.actualPortionTotal ?? "待完成"}</small></td>
            <td>{plan.conflictCount} 項</td><td><PlanStatus plan={plan} /></td>
            <td><AssignmentDetails plan={plan} /></td>
          </tr>)}</tbody></table>
        </div>
        <div className={`mobile-records ${styles.mobile}`}>
          {snapshot.plans.map((plan) => <article className="record-card"
            key={plan.planVersionId}>
            <div className="record-card__top"><div><h3>{MEAL_LABELS[plan.mealKind]}</h3>
              <span>{plan.menuTitle}</span></div><PlanStatus plan={plan} /></div>
            <dl><div><dt>食材</dt><dd>{plan.ingredients.map(({ label }) => label).join("、")}</dd></div>
              <div><dt>出勤</dt><dd>{plan.attendanceCount} 人</dd></div>
              <div><dt>預計／實際</dt><dd>{plan.plannedPortionTotal}／{plan.actualPortionTotal ?? "待完成"} 份</dd></div>
              <div><dt>衝突</dt><dd>{plan.conflictCount} 項</dd></div></dl>
            <AssignmentDetails plan={plan} />
          </article>)}
        </div>
      </> : <div className="panel__body"><section className="empty-card">
        <Search aria-hidden="true" /><h2>沒有符合條件的菜單</h2>
        <p>請調整日期、餐別、質地或衝突篩選；系統不會擴大到其他分支。</p>
        <Link className="button button--secondary" href={`?date=${filters.serviceDate}`}>清除篩選</Link>
      </section></div>}
    </section>
  </>;
}
