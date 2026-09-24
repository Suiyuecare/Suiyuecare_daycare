import {
  AlertTriangle,
  Clock3,
  ShieldAlert,
  UserRoundX,
  UsersRound,
} from "lucide-react";
import Link from "next/link";

import { NavigationLink } from "@/components/app/navigation-link";
import type { PageCatalogEntry } from "@/lib/catalog";
import type {
  StaffManagementEmployee,
  StaffManagementFilters,
  StaffManagementSnapshot,
  StaffRoleOption,
} from "@/lib/staff-management/types";

import {
  StaffEmploymentProposalForm,
  StaffProposalDecisionForm,
  StaffRoleApprovalForm,
  StaffRoleChangeForm,
  StaffTerminationProposalForm,
} from "./staff-management-actions";
import styles from "./staff-management.module.css";
import { currentStaffRoleName, staffRoleOptionName } from "./role-labels";

const statusLabels = {
  invited: "受邀中", active: "在職", suspended: "暫停", ended: "已離職",
};
const proposalLabels = {
  onboard: "到職", employment_change: "聘僱／職務異動", terminate: "離職停用",
};
const proposalStatusLabels = { pending: "待審", approved: "已核准", rejected: "已駁回" };

function formatTaipei(value: string) {
  return new Intl.DateTimeFormat("zh-TW", { timeZone: "Asia/Taipei",
    year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit",
    minute: "2-digit", hourCycle: "h23" }).format(new Date(value));
}

function employeeDetails(
  employee: StaffManagementEmployee,
  roleOptions: ReadonlyMap<string, StaffRoleOption>,
) {
  return <dl className={styles.details}>
    <div><dt>聘僱類型</dt><dd>{employee.employmentTypeText ?? "尚未建立受治理版本"}</dd></div>
    <div><dt>職務</dt><dd>{employee.jobTitleText ?? "尚未建立受治理版本"}</dd></div>
    <div><dt>登錄狀態</dt><dd>{employee.registrationStatusText ?? "尚未建立受治理版本"}</dd></div>
    <div><dt>到職／迄日</dt><dd>{employee.membershipStartsOn} ～ {employee.membershipEndsOn ?? "未設定"}</dd></div>
    <div><dt>角色</dt><dd>{employee.roles.length ? employee.roles.map((role) => currentStaffRoleName(role, roleOptions)).join("、") : "未指派"}</dd></div>
    <div><dt>帳號狀態</dt><dd>{employee.membershipStatus === "ended" ?
      "本系統已離職；遠端工作階段未驗證" : statusLabels[employee.membershipStatus]}</dd></div>
  </dl>;
}

function qualificationText(employee: StaffManagementEmployee) {
  if (employee.expiredCertificateTotal > 0) {
    return `${employee.expiredCertificateTotal} 筆已明確過期；服務資格未評估`;
  }
  if (employee.certificateTotal === 0) return "無終端證照紀錄；服務資格未評估";
  return `${employee.certificateTotal} 筆終端證照；服務資格未評估`;
}

export function StaffManagementWorkspace({
  canApproveEmployment, canApproveRoles, canApproveTermination,
  canManageEmployment, canManageRoles, canTerminate, currentUserId,
  filters, hasRecentAal2, loadError, page, snapshot,
}: {
  canApproveEmployment: boolean;
  canApproveRoles: boolean;
  canApproveTermination: boolean;
  canManageEmployment: boolean;
  canManageRoles: boolean;
  canTerminate: boolean;
  currentUserId: string;
  filters: StaffManagementFilters;
  hasRecentAal2: boolean;
  loadError: boolean;
  page: PageCatalogEntry;
  snapshot: StaffManagementSnapshot | null;
}) {
  if (loadError || !snapshot) return <section className="empty-card"
    aria-labelledby="staff-management-load-error">
    <span className="empty-card__icon empty-card__icon--warning">
      <AlertTriangle aria-hidden="true" />
    </span>
    <p className="eyebrow">載入失敗、無權限或篩選有誤</p>
    <h1 id="staff-management-load-error">無法取得員工管理快照</h1>
    <p>系統不會顯示未完成機構、分支、身分、聘僱、角色與資格權限核對的局部資料。</p>
    <Link className="button button--secondary" href="/app/staff/operations/staff">
      重新載入
    </Link>
  </section>;

  const roleOptionsById = new Map(snapshot.roleOptions.map((role) => [role.roleId, role]));

  return <div className={styles.workspace}>
    <header className={styles.hero}><div>
      <p className="eyebrow">第 {page.number} 頁 · 機構營運管理</p>
      <h1>{page.title}</h1>
      <p>以既有 profiles、memberships 與角色治理為唯一身分及權限來源；聘僱、角色與離職都保留不可變提案、預期版本與獨立審核。</p>
    </div><div className={styles.snapshotMeta}>
      <span>台北快照日 {snapshot.snapshotDate}</span>
      <time dateTime={snapshot.generatedAt}>更新 {formatTaipei(snapshot.generatedAt)}</time>
      <span>超過 5 分鐘請重新載入後再審核</span>
    </div></header>

    <div className={styles.notice} role="note">
      <strong>職稱與權限分開設定。</strong>機構主任可兼任護理或社工，但須分別核准對應角色並核對專業資格，不會自動取得兼任權限。
      {snapshot.demo || canManageRoles ? <NavigationLink className={styles.roleGuideLink}
        href="/app/staff/governance/roles-data-scopes#role-categories-heading"
        loadingLabel="角色與資料範圍">查看 11 種標準職務與管理範圍</NavigationLink> : null}
    </div>

    {snapshot.demo ? <div className={styles.notice} role="status">
      展示模式：以下姓名、員編、職務、資格與撤銷回執均為合成資料，只能檢視。
    </div> : null}
    <div className={styles.warning} role="alert">
      新增員工候選／邀請來源與 Auth 帳號建立尚未設定，因此不會掃描或顯示全域人員，也不提供到職建立。正式來源完成組織範圍治理前，API 與資料庫均拒絕 onboarding。
    </div>
    <div className={styles.notice} role="note">
      證照只引用第 72 頁終端版本的明確有效／過期事實。資格到期前 30 日提醒與受限制服務規則尚未發布，目前不計算「即將到期」，也不宣稱已阻擋任何服務。
    </div>
    <div className={styles.warning} role="note">
      本系統離職核准會立即把 membership 設為離職並建立 5 分鐘期限的撤銷工作；Supabase Auth Admin 撤銷供應商目前未設定，所有遠端工作階段狀態仍是「未驗證」，不得視為已撤銷。
    </div>

    <section className={styles.metrics} aria-label="員工管理統計">
      <article><UsersRound aria-hidden="true" /><span>目前在職</span>
        <strong>{snapshot.activeEmployeeTotal}</strong></article>
      <article><ShieldAlert aria-hidden="true" /><span>有明確過期證照</span>
        <strong>{snapshot.expiredQualificationMembershipTotal}</strong></article>
      <article><UserRoundX aria-hidden="true" /><span>非啟用帳號</span>
        <strong>{snapshot.disabledAccountTotal}</strong></article>
      <article><Clock3 aria-hidden="true" /><span>待審員工／角色異動</span>
        <strong>{snapshot.pendingProposalTotal + snapshot.pendingRoleRequestTotal}</strong></article>
    </section>

    {!snapshot.demo ? <section className={styles.actions} aria-label="受治理員工作業">
      <StaffEmploymentProposalForm canManage={canManageEmployment}
        hasRecentAal2={hasRecentAal2} snapshot={snapshot} />
      <StaffTerminationProposalForm canTerminate={canTerminate}
        hasRecentAal2={hasRecentAal2} snapshot={snapshot} />
      <StaffProposalDecisionForm canApproveEmployment={canApproveEmployment}
        canApproveTermination={canApproveTermination} currentUserId={currentUserId}
        hasRecentAal2={hasRecentAal2} snapshot={snapshot} />
      <StaffRoleChangeForm canManageRoles={canManageRoles}
        hasRecentAal2={hasRecentAal2} snapshot={snapshot} />
      <StaffRoleApprovalForm canApproveRoles={canApproveRoles}
        currentUserId={currentUserId} hasRecentAal2={hasRecentAal2}
        snapshot={snapshot} />
    </section> : null}

    <form className={styles.filters} method="get" aria-label="篩選員工管理">
      <label><span>聘僱狀態</span><select name="status" defaultValue={filters.status}>
        <option value="all">全部</option><option value="active">在職</option>
        <option value="suspended">暫停</option><option value="ended">已離職</option>
        <option value="invited">受邀中</option>
      </select></label>
      <label><span>角色</span><select name="role" defaultValue={filters.roleId ?? "all"}>
        <option value="all">全部角色</option>{snapshot.roleOptions.map((role) =>
          <option key={role.roleId} value={role.roleId}>{staffRoleOptionName(role)}</option>)}</select></label>
      <label><span>證照事實</span><select name="qualification"
        defaultValue={filters.qualification}>
        <option value="all">全部</option><option value="has_expired">有明確過期</option>
        <option value="no_certificates">無終端證照</option>
        <option value="not_evaluated">服務資格未評估</option>
      </select></label>
      <label><span>搜尋</span><input name="q" maxLength={120} defaultValue={filters.query}
        placeholder="姓名、員編、職務或角色" /></label>
      <button className="button button--secondary" type="submit">套用篩選</button>
      <Link className="button button--ghost" href="/app/staff/operations/staff">清除</Link>
    </form>

    <section className={styles.records} aria-labelledby="staff-list-heading">
      <div className={styles.sectionHeading}><div><p className="eyebrow">同一快照</p>
        <h2 id="staff-list-heading">員工清單</h2></div>
        <p>{snapshot.employees.length} / {snapshot.employeeTotal} 位</p></div>
      {snapshot.employeesTruncated ? <p role="status">清單上限 200 位，請縮小篩選。</p> : null}
      {snapshot.employees.length === 0 ? <div className="empty-card">
        <span className="empty-card__icon"><UsersRound aria-hidden="true" /></span>
        <h3>沒有符合條件的員工</h3><p>可清除狀態、角色、證照事實或搜尋條件。</p>
      </div> : <>
        <div className={styles.tableWrap} role="region" tabIndex={0}
          aria-label="可水平捲動的員工管理表格">
          <table className={styles.table}><thead><tr><th>員工／版本</th><th>職務</th>
            <th>角色</th><th>證照事實</th><th>到職</th><th>帳號／撤銷</th></tr></thead>
          <tbody>{snapshot.employees.map((employee) => <tr key={employee.membershipId}>
            <td><strong>{employee.displayName}</strong><br />
              <small>{employee.employeeCode ?? "未提供員編"} · v{employee.membershipVersion}</small></td>
            <td>{employee.jobTitleText ?? "未建立聘僱版本"}<br />
              <small>{employee.registrationStatusText ?? "無登錄狀態版本"}</small></td>
            <td>{employee.roles.length ? employee.roles.map((role) => currentStaffRoleName(role, roleOptionsById)).join("、") : "未指派"}</td>
            <td>{qualificationText(employee)}<br /><Link
              className={styles.certificateLink}
              href={`/app/staff/operations/staff-certificates?staff=${employee.membershipId}`}>
              查看第 72 頁證照
            </Link></td>
            <td>{employee.membershipStartsOn}</td>
            <td><span className={`${styles.pill} ${styles[`pill_${employee.membershipStatus}`]}`}>
              {statusLabels[employee.membershipStatus]}</span><br />
              <small>{employee.revocationJobId ? "供應商未設定／撤銷未驗證" : "無撤銷工作"}</small></td>
          </tr>)}</tbody></table>
        </div>
        <div className={styles.mobileCards}>{snapshot.employees.map((employee) =>
          <article key={employee.membershipId}><div className={styles.cardHeading}>
            <div><h3>{employee.displayName}</h3><small>{employee.employeeCode ?? "未提供員編"} · v{employee.membershipVersion}</small></div>
            <span className={`${styles.pill} ${styles[`pill_${employee.membershipStatus}`]}`}>
              {statusLabels[employee.membershipStatus]}</span></div>
            {employeeDetails(employee, roleOptionsById)}
            <p><strong>證照：</strong>{qualificationText(employee)}</p>
            <Link className={styles.certificateLink}
              href={`/app/staff/operations/staff-certificates?staff=${employee.membershipId}`}>
              查看第 72 頁證照
            </Link>
          </article>)}</div>
      </>}
    </section>

    <section className={styles.records} aria-labelledby="staff-proposals-heading">
      <div className={styles.sectionHeading}><div><p className="eyebrow">不可變提案</p>
        <h2 id="staff-proposals-heading">聘僱與離職異動</h2></div>
        <p>{snapshot.proposals.length} / {snapshot.proposalTotal} 筆</p></div>
      {snapshot.proposals.length === 0 ? <p>尚無員工異動提案。</p> :
        <div className={styles.cardGrid}>{snapshot.proposals.map((proposal) =>
          <article key={proposal.proposalId}><div className={styles.cardHeading}><div>
            <p className="eyebrow">提案 #{proposal.proposalNumber}</p>
            <h3>{proposal.targetDisplayName}</h3></div>
            <span className={`${styles.pill} ${styles[`pill_${proposal.status}`]}`}>
              {proposalStatusLabels[proposal.status]}</span></div>
            <p><strong>{proposalLabels[proposal.action]}</strong> · 預期員工 v{proposal.expectedMembershipVersion}</p>
            <p>{proposal.action === "terminate" ?
              `離職日 ${proposal.terminationEffectiveOn}` :
              `${proposal.jobTitleText} · ${proposal.targetMembershipStatus === "active" ? "在職" : "暫停"}`}</p>
            <p><strong>理由：</strong>{proposal.changeReason}</p>
            <small>{proposal.requestedByDisplayName} · {formatTaipei(proposal.requestedAt)} · 雜湊 {proposal.contentHash.slice(0, 12)}…</small>
            {proposal.decisionReason ? <p><strong>決議：</strong>{proposal.decisionReason}</p> : null}
          </article>)}</div>}
    </section>

    <section className={styles.records} aria-labelledby="staff-role-requests-heading">
      <div className={styles.sectionHeading}><div><p className="eyebrow">沿用第 81 頁角色治理</p>
        <h2 id="staff-role-requests-heading">角色異動</h2></div>
        <p>{snapshot.roleRequests.length} / {snapshot.roleRequestTotal} 筆</p></div>
      {snapshot.roleRequests.length === 0 ? <p>尚無角色異動。</p> :
        <div className={styles.cardGrid}>{snapshot.roleRequests.map((request) =>
          <article key={request.requestId}><div className={styles.cardHeading}>
            <h3>{request.roleName}</h3><span className={`${styles.pill} ${styles[`pill_${request.status}`]}`}>
              {request.status === "pending" ? "待獨立核准" : "已核准"}</span></div>
            <p>{request.operation === "assign_role" ? "指派" : "撤銷"} · 員工版本 v{request.expectedMembershipVersion}</p>
            <small>{request.requestedByDisplayName} · {formatTaipei(request.requestedAt)}</small>
          </article>)}</div>}
    </section>

    <section className={styles.records} aria-labelledby="revocation-jobs-heading">
      <div className={styles.sectionHeading}><div><p className="eyebrow">Fail closed</p>
        <h2 id="revocation-jobs-heading">工作階段撤銷回執</h2></div>
        <p>{snapshot.revocationJobs.length} / {snapshot.revocationJobTotal} 筆</p></div>
      {snapshot.revocationJobs.length === 0 ? <p>尚無離職撤銷工作。</p> :
        <ul className={styles.timeline}>{snapshot.revocationJobs.map((job) => <li key={job.jobId}>
          <div><strong>{job.slaStatus === "overdue_not_verified" ? "已逾 5 分鐘，仍未驗證" : "5 分鐘期限內，仍未驗證"}</strong>
            <span>供應商：未設定</span></div>
          <p>排入 {formatTaipei(job.queuedAt)} · 期限 {formatTaipei(job.deadlineAt)}</p>
          <small>這是待處理回執，不是遠端工作階段已撤銷的證明。</small>
        </li>)}</ul>}
    </section>

    <section className={styles.records} aria-labelledby="staff-history-heading">
      <div className={styles.sectionHeading}><div><p className="eyebrow">不可覆寫</p>
        <h2 id="staff-history-heading">聘僱版本歷程</h2></div>
        <p>{snapshot.employmentHistory.length} / {snapshot.employmentHistoryTotal} 筆</p></div>
      {snapshot.employmentHistory.length === 0 ? <p>尚無已核准聘僱版本。</p> :
        <ol className={styles.timeline}>{snapshot.employmentHistory.map((history) =>
          <li key={history.employmentVersionId}><div><strong>v{history.version} · {proposalLabels[history.action]}</strong>
            <span>員工版本 v{history.membershipVersion}</span></div>
            <p>{history.jobTitleText ?? "離職版本"} · {history.changeReason}</p>
            <small>{history.approvedByDisplayName} · {formatTaipei(history.approvedAt)} · 雜湊 {history.contentHash.slice(0, 12)}…</small>
          </li>)}</ol>}
    </section>

    <div className={styles.notice} role="note">
      正式附件／掃毒、匯出與離線皆停用；本頁不包含薪資、人資全套 ERP，也不建立任何醫療或資格判斷。
    </div>
  </div>;
}
