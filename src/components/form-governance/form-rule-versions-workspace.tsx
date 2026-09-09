import {
  CalendarClock,
  CheckCircle2,
  ChevronRight,
  CircleAlert,
  FileClock,
  FileLock2,
  Files,
  LockKeyhole,
  Search,
  ShieldCheck,
  TriangleAlert,
} from "lucide-react";
import Link from "next/link";

import type { PageCatalogEntry } from "@/lib/catalog";
import {
  filterFormGovernanceVersions,
  formGovernanceCategories,
} from "@/lib/form-governance/projection";
import type {
  FormGovernanceFilters,
  FormGovernanceSnapshot,
  FormGovernanceVersion,
} from "@/lib/form-governance/types";

import { FormPublicationAction } from "./form-publication-action";
import styles from "./form-rule-versions.module.css";

const statusLabels: Record<FormGovernanceVersion["status"], string> = {
  draft: "草稿",
  published: "已發布",
  retired: "已停用",
};

function displayStatus(version: FormGovernanceVersion) {
  return version.publication?.status === "pending"
    ? "待第二人核准"
    : statusLabels[version.status];
}

function formatDate(value: string | null) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("zh-TW", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(`${value}T00:00:00+08:00`));
}

function formatDateTime(value: string | null) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("zh-TW", {
    timeZone: "Asia/Taipei",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(new Date(value));
}

function period(version: FormGovernanceVersion) {
  if (!version.effectiveFrom) return "尚未設定";
  return `${formatDate(version.effectiveFrom)} ～ ${version.effectiveTo ? formatDate(version.effectiveTo) : "持續有效"}`;
}

function PublicationEvidence({ version }: { version: FormGovernanceVersion }) {
  if (!version.publication) return <span className="muted">尚未送審</span>;
  return (
    <span className={styles.evidence}>
      <strong>{version.publication.requesterLabel}</strong>
      <small>{formatDateTime(version.publication.requestedAt)}</small>
      {version.publication.approverLabel ? (
        <small>{version.publication.approverLabel}・{formatDateTime(version.publication.approvedAt)}</small>
      ) : (
        <small>等待獨立核准</small>
      )}
    </span>
  );
}

function Action({
  version,
  canManage,
  hasRecentAal2,
  instance,
  blockedReason,
}: {
  version: FormGovernanceVersion;
  canManage: boolean;
  hasRecentAal2: boolean;
  instance: "desktop" | "mobile";
  blockedReason?: string;
}) {
  if (version.official) {
    return <span className={styles.lockedAction}><LockKeyhole aria-hidden="true" />官方版本唯讀</span>;
  }
  if (version.status === "published") {
    return <span className={styles.lockedAction}><CheckCircle2 aria-hidden="true" />已發布鎖定</span>;
  }
  if (version.status === "retired") {
    return <span className={styles.lockedAction}><FileLock2 aria-hidden="true" />歷史版本鎖定</span>;
  }
  if (!version.effectiveFrom) {
    return <span className={styles.lockedAction}><CalendarClock aria-hidden="true" />缺少生效日</span>;
  }
  if (version.publication?.status === "pending") {
    if (version.publication.requestedByCurrentUser) {
      return <span className={styles.lockedAction}><ShieldCheck aria-hidden="true" />申請人不可自批</span>;
    }
    const enabled = canManage && hasRecentAal2 && !blockedReason;
    const disabledReason = blockedReason ?? (!canManage
      ? "目前角色沒有 forms.manage 權限"
      : "需完成最近 15 分鐘雙因素重新驗證");
    return (
      <FormPublicationAction
        disabledReason={!enabled ? disabledReason : undefined}
        enabled={enabled}
        instance={instance}
        kind="approve"
        version={version}
      />
    );
  }
  const enabled = canManage && hasRecentAal2 && !blockedReason;
  const disabledReason = blockedReason ?? (!canManage
    ? "目前角色沒有 forms.manage 權限"
    : "需完成最近 15 分鐘雙因素重新驗證");
  return (
    <FormPublicationAction
      disabledReason={!enabled ? disabledReason : undefined}
      enabled={enabled}
      instance={instance}
      kind="request"
      version={version}
    />
  );
}

export function FormRuleVersionsWorkspace({
  page,
  snapshot,
  filters,
  canManage,
  hasRecentAal2,
  loadError = false,
}: {
  page: PageCatalogEntry;
  snapshot: FormGovernanceSnapshot | null;
  filters: FormGovernanceFilters;
  canManage: boolean;
  hasRecentAal2: boolean;
  loadError?: boolean;
}) {
  if (loadError || !snapshot) {
    return (
      <section className="empty-card core-care-state" role="alert">
        <span className="empty-card__icon empty-card__icon--warning"><CircleAlert aria-hidden="true" /></span>
        <h1>表單與規則版本暫時無法載入</h1>
        <p>系統不會改查其他機構、其他分支、管理員密鑰或展示資料來補值。</p>
        <Link className="button button--secondary" href="/app/staff/governance/form-rule-versions">重新載入</Link>
      </section>
    );
  }

  const versions = filterFormGovernanceVersions(snapshot, filters);
  const categories = formGovernanceCategories(snapshot);
  const hasFilters = Boolean(
    filters.query ||
    filters.status !== "all" ||
    filters.scope !== "all" ||
    filters.category !== "all",
  );
  const updatedAt = formatDateTime(snapshot.generatedAt);
  const partialVersionMetric = snapshot.versionsTruncated;
  const blockedReason = snapshot.demo
    ? "展示模式為唯讀，送審與核准均停用"
    : snapshot.incomplete
      ? "治理清單未完整載入，為避免錯誤結論已停用送審與核准"
      : undefined;

  return (
    <>
      <nav aria-label="所在位置" className="context-bar">
        <span>工作台</span><ChevronRight aria-hidden="true" />
        <span>系統治理與中央 HTML 匯入</span><ChevronRight aria-hidden="true" />
        <span aria-current="page" className="context-bar__crumb">{page.title}</span>
      </nav>
      <header className="page-heading">
        <div>
          <p className="eyebrow">版本發布治理・頁面 82</p>
          <h1>{page.title}</h1>
          <p className="page-heading__description">
            核對名稱、欄位、公式與生效期間後送審；由第二位具權限人員核准，成功發布的內容不可回溯改寫。
          </p>
        </div>
        <div className="page-heading__actions">
          <button className="button button--secondary" disabled title="草稿建立與編輯 RPC 尚未開放" type="button">
            <LockKeyhole aria-hidden="true" />建立草稿（尚未開放）
          </button>
        </div>
      </header>

      <div className={`callout ${styles.boundaryCallout}`}>
        <FileLock2 aria-hidden="true" />
        <span>本階段只交付既有草稿的送審與獨立核准。表單版本的建立、編輯、測試及停用尚未交付，也不會透過頁面或管理員密鑰直接改寫資料；因此第 82 頁仍屬部分完成。</span>
      </div>
      {snapshot.demo ? (
        <div className={`callout ${styles.demoCallout}`} role="status">
          <CircleAlert aria-hidden="true" />
          <span>目前為展示唯讀模式：以下姓名、表單、狀態與時間皆為合成資料；送審與核准已停用，API 也不會模擬成功。</span>
        </div>
      ) : !hasRecentAal2 ? (
        <div className={`callout ${styles.reauthCallout}`} role="status">
          <ShieldCheck aria-hidden="true" />
          <span>送審與核准需要最近 15 分鐘內的雙因素重新驗證，且資料庫會再核對不可變驗證證據。</span>
          <Link className="button button--secondary" href="/mfa?audience=staff&purpose=sensitive-action">立即重新驗證</Link>
        </div>
      ) : null}
      {snapshot.incomplete ? (
        <div className={`callout ${styles.reauthCallout}`} role="alert">
          <TriangleAlert aria-hidden="true" />
          <span>
            治理快照已達安全載入上限：表單 {snapshot.definitionLoaded}／{snapshot.definitionTotal}、版本 {snapshot.versionLoaded}／{snapshot.versionTotal}、發布申請 {snapshot.publicationLoaded}／{snapshot.publicationTotal}。待核准共 {snapshot.pendingTotal} 筆並優先載入；清單完整前已停用送審與核准，不能用目前畫面判定全部狀態。
          </span>
        </div>
      ) : null}

      <section aria-label="版本治理摘要" className={`metric-grid ${styles.metrics}`}>
        {[
          { label: "目前有效", value: partialVersionMetric ? `至少 ${snapshot.metrics.active}` : snapshot.metrics.active, foot: partialVersionMetric ? "已載入部分，非總數" : `台北日期 ${snapshot.today}`, Icon: CheckCircle2 },
          { label: "草稿", value: partialVersionMetric ? `至少 ${snapshot.metrics.drafts}` : snapshot.metrics.drafts, foot: partialVersionMetric ? "已載入部分，非總數" : "不代表已發布", Icon: Files },
          { label: "待核准", value: snapshot.pendingTotal, foot: "目前分支總數・優先載入", Icon: FileClock },
          { label: "30 日內生效", value: partialVersionMetric ? `至少 ${snapshot.metrics.upcoming}` : snapshot.metrics.upcoming, foot: partialVersionMetric ? "已載入部分，非總數" : "已發布的未來版本", Icon: CalendarClock },
          { label: "期間重疊", value: partialVersionMetric ? `至少 ${snapshot.metrics.overlapWarnings}` : snapshot.metrics.overlapWarnings, foot: partialVersionMetric ? "已載入部分，非總數" : "發布及歷史版本", Icon: TriangleAlert },
        ].map(({ label, value, foot, Icon }) => (
          <article className="metric-card" key={label}>
            <div className="metric-card__top"><span>{label}</span><span className="metric-card__icon"><Icon aria-hidden="true" /></span></div>
            <div className="metric-card__value"><strong>{value}</strong><span>筆</span></div>
            <p className="metric-card__foot">{foot}</p>
          </article>
        ))}
      </section>

      <section className="panel">
        <div className="panel__header">
          <div className="panel__title">
            <h2>版本與發布證據</h2>
            <p>{versions.length} 筆符合條件・已載入 {snapshot.versionLoaded}／{snapshot.versionTotal} 個版本・更新 {updatedAt}・Asia/Taipei</p>
          </div>
          <span className={`status-pill ${snapshot.demo ? "status-pill--warning" : "status-pill--success"}`}>
            {snapshot.demo ? "展示唯讀資料" : "經稽核資料快照"}
          </span>
        </div>
        <form className={`filter-bar ${styles.filters}`} method="get">
          <label className={`filter-search ${styles.searchField}`}>
            <Search aria-hidden="true" />
            <span className="sr-only">搜尋表單、命名空間或類型</span>
            <input defaultValue={filters.query} maxLength={120} name="q" placeholder="搜尋表單、命名空間或類型" type="search" />
          </label>
          <label className="field field--compact"><span>狀態</span><select defaultValue={filters.status} name="status"><option value="all">全部狀態</option><option value="draft">草稿</option><option value="pending">待第二人核准</option><option value="published">已發布</option><option value="retired">已停用</option></select></label>
          <label className="field field--compact"><span>範圍</span><select defaultValue={filters.scope} name="scope"><option value="all">全部範圍</option><option value="tenant">機構自訂</option><option value="official">官方唯讀</option></select></label>
          <label className="field field--compact"><span>類型</span><select defaultValue={filters.category} name="category"><option value="all">全部類型</option>{categories.map((category) => <option key={category} value={category}>{category}</option>)}</select></label>
          <button className="button button--secondary" type="submit">套用篩選</button>
          {hasFilters ? <Link className="button button--quiet" href="/app/staff/governance/form-rule-versions">清除</Link> : null}
        </form>

        {versions.length ? (
          <>
            <div
              aria-label="表單與規則版本表格"
              className={`table-wrap ${styles.tableWrap}`}
              role="region"
              tabIndex={0}
            >
              <table className={`data-table ${styles.table}`}>
                <thead><tr><th scope="col">表單／規則</th><th scope="col">範圍／類型</th><th scope="col">版本</th><th scope="col">生效期間</th><th scope="col">內容摘要</th><th scope="col">送審／核准證據</th><th scope="col">狀態</th><th scope="col">下一步</th></tr></thead>
                <tbody>{versions.map((version) => (
                  <tr key={version.id}>
                    <td><span className={styles.definition}><strong>{version.name}</strong><code>{version.formKey}</code></span></td>
                    <td><strong>{version.official ? "官方唯讀" : "機構自訂"}</strong><small className="data-table__secondary">{version.category}</small></td>
                    <td><strong>v{version.version}</strong></td>
                    <td className={styles.period}>{period(version)}</td>
                    <td><span className={styles.contentSummary}><strong>{version.schemaFieldCount} 欄位</strong><small>{version.scoringRuleCount} 項計分／規則</small>{version.contentHash ? <code title={version.contentHash}>雜湊 {version.contentHash.slice(0, 10)}…</code> : null}</span></td>
                    <td><PublicationEvidence version={version} /></td>
                    <td><span className={`status-pill ${version.publication?.status === "pending" ? "status-pill--warning" : version.status === "published" ? "status-pill--success" : version.status === "draft" ? "status-pill--info" : ""}`}>{displayStatus(version)}</span></td>
                    <td><Action blockedReason={blockedReason} canManage={canManage} hasRecentAal2={hasRecentAal2} instance="desktop" version={version} /></td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
            <div className={styles.mobileCards}>
              {versions.map((version) => (
                <article className={styles.mobileCard} key={`${version.id}-mobile`}>
                  <div className={styles.cardTop}>
                    <div><h3>{version.name}</h3><code>{version.formKey}・v{version.version}</code></div>
                    <span className={`status-pill ${version.publication?.status === "pending" ? "status-pill--warning" : version.status === "published" ? "status-pill--success" : version.status === "draft" ? "status-pill--info" : ""}`}>{displayStatus(version)}</span>
                  </div>
                  <dl className={styles.cardGrid}>
                    <div><dt>範圍／類型</dt><dd>{version.official ? "官方唯讀" : "機構自訂"}<small>{version.category}</small></dd></div>
                    <div><dt>生效期間</dt><dd>{period(version)}</dd></div>
                    <div><dt>內容摘要</dt><dd>{version.schemaFieldCount} 欄位・{version.scoringRuleCount} 項規則</dd></div>
                    <div><dt>發布時間</dt><dd>{formatDateTime(version.publishedAt)}</dd></div>
                    <div className={styles.cardWide}><dt>送審／核准證據</dt><dd><PublicationEvidence version={version} /></dd></div>
                  </dl>
                  <Action blockedReason={blockedReason} canManage={canManage} hasRecentAal2={hasRecentAal2} instance="mobile" version={version} />
                </article>
              ))}
            </div>
          </>
        ) : (
          <div className="empty-card core-care-state">
            <span className="empty-card__icon"><Files aria-hidden="true" /></span>
            <h2>沒有符合條件的版本</h2>
            <p>{hasFilters ? "請清除部分篩選條件；系統不會用其他機構或展示資料補值。" : "目前尚無可檢視的官方或機構自訂版本。"}</p>
            {hasFilters ? <Link className="button button--secondary" href="/app/staff/governance/form-rule-versions">清除篩選</Link> : null}
          </div>
        )}
      </section>
    </>
  );
}
