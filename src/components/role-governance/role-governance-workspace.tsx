import {
  CheckCircle2,
  ChevronRight,
  CircleAlert,
  Clock3,
  FileLock2,
  KeyRound,
  Layers3,
  ShieldCheck,
  UserRoundCog,
  UsersRound,
} from "lucide-react";
import Link from "next/link";

import type { PageCatalogEntry } from "@/lib/catalog";
import type {
  ProfileKind,
  RoleGovernanceRequest,
  RoleGovernanceRole,
  RoleGovernanceSnapshot,
} from "@/lib/role-governance/types";

import {
  RoleGovernanceApproveAction,
  RoleGovernanceRequestAction,
} from "./role-governance-actions";
import styles from "./role-governance.module.css";

const operationLabels: Record<RoleGovernanceRequest["operation"], string> = {
  create_role: "建立角色",
  grant_permission: "授予權限",
  revoke_permission: "撤銷權限",
  assign_role: "指派角色",
  revoke_role: "撤銷角色",
  deactivate_role: "停用角色",
};
const profileKindLabels: Record<ProfileKind, string> = {
  platform: "平台維運",
  staff: "一般員工",
  professional: "專業人員",
  driver: "交通／駕駛",
  finance: "財務／申報",
  family: "家屬／關係人",
};
const membershipStatusLabels = {
  invited: "已邀請",
  active: "有效",
  suspended: "暫停",
  ended: "已結束",
} as const;

function formatDateTime(value: string | null) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("zh-TW", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(new Date(value));
}

function RequestSummary({
  request,
  rolesById,
  membersById,
}: {
  request: RoleGovernanceRequest;
  rolesById: ReadonlyMap<string, RoleGovernanceRole>;
  membersById: ReadonlyMap<string, { displayName: string }>;
}) {
  const role = rolesById.get(request.targetRoleId);
  if (request.operation === "create_role") {
    return <><strong>{request.roleName}</strong><small>代碼 {request.roleKey}</small></>;
  }
  if (request.operation === "grant_permission" || request.operation === "revoke_permission") {
    return <><strong>{role?.name}</strong><small>{request.targetPermissionKey}</small></>;
  }
  if (request.operation === "assign_role" || request.operation === "revoke_role") {
    return <><strong>{membersById.get(request.targetMembershipId ?? "")?.displayName}</strong><small>{role?.name}</small></>;
  }
  return <strong>{role?.name}</strong>;
}

export function RoleGovernanceWorkspace({
  page,
  snapshot,
  canManage,
  hasRecentAal2,
  loadError = false,
}: {
  page: PageCatalogEntry;
  snapshot: RoleGovernanceSnapshot | null;
  canManage: boolean;
  hasRecentAal2: boolean;
  loadError?: boolean;
}) {
  if (loadError || !snapshot) {
    return (
      <section className="empty-card core-care-state" role="alert">
        <span className="empty-card__icon empty-card__icon--warning"><CircleAlert aria-hidden="true" /></span>
        <h1>角色治理資料暫時無法載入</h1>
        <p>系統不會改查其他機構、其他分支、管理員密鑰或展示資料來補值。</p>
        <Link className="button button--secondary" href="/app/staff/governance/roles-data-scopes">重新載入</Link>
      </section>
    );
  }

  const rolesById = new Map(snapshot.roles.map((role) => [role.id, role]));
  const membersById = new Map(snapshot.memberships.map((membership) => [membership.id, membership]));
  const highRiskPermissions = snapshot.permissions.filter((permission) => permission.riskLevel === 3).length;
  const enabled = canManage && hasRecentAal2 && !snapshot.demo;
  const disabledReason = snapshot.demo
    ? "展示模式只讀，不會建立或核准任何申請"
    : !canManage
      ? "目前角色沒有 roles.manage 權限"
      : !hasRecentAal2
        ? "需完成最近 15 分鐘雙因素重新驗證"
        : undefined;

  return (
    <>
      <nav aria-label="所在位置" className="context-bar"><span>工作台</span><ChevronRight aria-hidden="true" /><span>系統治理與中央 HTML 匯入</span><ChevronRight aria-hidden="true" /><span aria-current="page" className="context-bar__crumb">{page.title}</span></nav>
      <header className="page-heading">
        <div><p className="eyebrow">正式權限治理・頁面 81</p><h1>{page.title}</h1><p className="page-heading__description">檢視角色權限與目前成員指派，並透過申請人與獨立核准人的雙人流程變更既有支援範圍。</p></div>
        <div className="page-heading__actions"><RoleGovernanceRequestAction disabledReason={disabledReason} enabled={enabled} memberships={snapshot.memberships} permissions={snapshot.permissions} roles={snapshot.roles} /></div>
      </header>

      <div className={`callout ${styles.boundaryCallout}`}>
        <FileLock2 aria-hidden="true" />
        <span><strong>本垂直切片只涵蓋：</strong>建立機構角色、授予／撤銷權限、指派／撤銷成員角色、停用機構角色及雙人核准。權限期限、委派、個案層級資料範圍尚未建模，未達第 81 頁完整驗收。</span>
      </div>
      {snapshot.demo ? (
        <div className={`callout ${styles.demoCallout}`} role="status"><CircleAlert aria-hidden="true" /><span>目前為唯讀展示模式：姓名、角色、權限與申請皆為合成資料；建立申請與核准按鈕已停用，永不呼叫寫入 API。</span></div>
      ) : !hasRecentAal2 ? (
        <div className={`callout ${styles.reauthCallout}`} role="status"><ShieldCheck aria-hidden="true" /><span>建立申請與核准都需要最近 15 分鐘內的雙因素重新驗證；API 與資料庫仍會再次核對不可變證據。</span><Link className="button button--secondary" href="/mfa?audience=staff&purpose=sensitive-action">立即重新驗證</Link></div>
      ) : null}

      <section aria-label="角色治理摘要" className={`metric-grid ${styles.metrics}`}>
        {[
          { label: "有效角色", value: snapshot.roles.filter((role) => role.active).length, foot: "系統模板＋機構角色", Icon: Layers3 },
          { label: "目前成員", value: snapshot.memberships.length, foot: "本分支＋機構層級", Icon: UsersRound },
          { label: "待第二人核准", value: snapshot.pendingTotal, foot: "待核准優先載入", Icon: Clock3 },
          { label: "高風險權限", value: highRiskPermissions, foot: "風險等級 3", Icon: KeyRound },
        ].map(({ label, value, foot, Icon }) => <article className="metric-card" key={label}><div className="metric-card__top"><span>{label}</span><span className="metric-card__icon"><Icon aria-hidden="true" /></span></div><div className="metric-card__value"><strong>{value}</strong><span>筆</span></div><p className="metric-card__foot">{foot}</p></article>)}
      </section>

      <section className="panel">
        <div className="panel__header"><div className="panel__title"><h2>角色與權限現況矩陣</h2><p>{snapshot.roles.length} 個角色・{snapshot.permissions.length} 項權限・更新 {formatDateTime(snapshot.generatedAt)}</p></div><span className={`status-pill ${snapshot.demo ? "status-pill--warning" : "status-pill--success"}`}>{snapshot.demo ? "展示未持久化" : "正式受限快照"}</span></div>
        <div className={`table-wrap ${styles.tableWrap}`}><table className={`data-table ${styles.roleTable}`}><thead><tr><th scope="col">角色</th><th scope="col">來源</th><th scope="col">權限</th><th scope="col">狀態</th></tr></thead><tbody>{snapshot.roles.map((role) => <tr key={role.id}><td><span className={styles.stack}><strong>{role.name}</strong><small>{role.roleKey}</small></span></td><td>{role.system ? "系統模板（不可改）" : "機構自訂"}</td><td><span className={styles.chips}>{role.permissionKeys.length ? role.permissionKeys.map((permission) => <code key={permission}>{permission}</code>) : <small>未授予一般權限</small>}</span></td><td><span className={`status-pill ${role.active ? "status-pill--success" : ""}`}>{role.active ? "有效" : "已停用"}</span></td></tr>)}</tbody></table></div>
        <div className={styles.mobileCards}>
          {snapshot.roles.map((role) => (
            <article className={styles.mobileCard} key={`${role.id}-mobile`}>
              <div className={styles.cardTop}>
                <div><strong>{role.name}</strong><p className={styles.cardCode}>{role.roleKey}</p></div>
                <span className={`status-pill ${role.active ? "status-pill--success" : ""}`}>{role.active ? "有效" : "已停用"}</span>
              </div>
              <dl>
                <div><dt>來源</dt><dd>{role.system ? "系統模板（不可改）" : "機構自訂"}</dd></div>
                <div><dt>權限數</dt><dd>{role.permissionKeys.length} 項</dd></div>
              </dl>
              <div><p className={styles.cardLabel}>目前權限</p><span className={styles.chips}>{role.permissionKeys.length ? role.permissionKeys.map((permission) => <code key={permission}>{permission}</code>) : <small>未授予一般權限</small>}</span></div>
            </article>
          ))}
        </div>
      </section>

      <section className="panel">
        <div className="panel__header"><div className="panel__title"><h2>成員目前角色</h2><p>只顯示目前機構層級及所選分支成員；身分類型相容性由資料庫強制執行。</p></div><UserRoundCog aria-hidden="true" /></div>
        <div className={`table-wrap ${styles.tableWrap}`}><table className={`data-table ${styles.memberTable}`}><thead><tr><th scope="col">成員</th><th scope="col">身分類型</th><th scope="col">層級</th><th scope="col">目前角色</th><th scope="col">狀態</th></tr></thead><tbody>{snapshot.memberships.map((membership) => <tr key={membership.id}><td><strong>{membership.displayName}{membership.currentActor ? "（本人）" : ""}</strong></td><td>{profileKindLabels[membership.profileKind]}</td><td>{membership.branchId ? "目前分支" : "機構層級"}</td><td><span className={styles.chips}>{membership.roleIds.length ? membership.roleIds.map((roleId) => <span key={roleId}>{rolesById.get(roleId)?.name}</span>) : <small>尚無角色</small>}</span></td><td><span className={`status-pill ${membership.status === "active" ? "status-pill--success" : "status-pill--warning"}`}>{membershipStatusLabels[membership.status]}</span></td></tr>)}</tbody></table></div>
        <div className={styles.mobileCards}>
          {snapshot.memberships.map((membership) => (
            <article className={styles.mobileCard} key={`${membership.id}-mobile`}>
              <div className={styles.cardTop}>
                <strong>{membership.displayName}{membership.currentActor ? "（本人）" : ""}</strong>
                <span className={`status-pill ${membership.status === "active" ? "status-pill--success" : "status-pill--warning"}`}>{membershipStatusLabels[membership.status]}</span>
              </div>
              <dl>
                <div><dt>身分類型</dt><dd>{profileKindLabels[membership.profileKind]}</dd></div>
                <div><dt>資料層級</dt><dd>{membership.branchId ? "目前分支" : "機構層級"}</dd></div>
              </dl>
              <div><p className={styles.cardLabel}>目前角色</p><span className={styles.chips}>{membership.roleIds.length ? membership.roleIds.map((roleId) => <span key={roleId}>{rolesById.get(roleId)?.name}</span>) : <small>尚無角色</small>}</span></div>
            </article>
          ))}
        </div>
      </section>

      <section className="panel">
        <div className="panel__header"><div className="panel__title"><h2>申請與獨立核准佇列</h2><p>已載入 {snapshot.requests.length}／{snapshot.requestTotal} 筆；待核准會排在核准歷史前方。</p></div><ShieldCheck aria-hidden="true" /></div>
        {snapshot.requestsTruncated ? <div className={`callout ${styles.truncatedCallout}`} role="status"><CircleAlert aria-hidden="true" /><span>佇列已達單次 200 筆上限，尚有 {snapshot.requestTotal - snapshot.requests.length} 筆未載入。已優先載入待核准項目；若待核准本身超過上限，仍需後續分頁才能達完整驗收。</span></div> : null}
        {snapshot.requests.length ? <><div className={`table-wrap ${styles.tableWrap}`}><table className={`data-table ${styles.queueTable}`}><thead><tr><th scope="col">操作</th><th scope="col">變更對象</th><th scope="col">申請人／時間</th><th scope="col">狀態</th><th scope="col">下一步</th></tr></thead><tbody>{snapshot.requests.map((request) => <tr key={request.id}><td><strong>{operationLabels[request.operation]}</strong></td><td><span className={styles.stack}><RequestSummary membersById={membersById} request={request} rolesById={rolesById} /></span></td><td><span className={styles.stack}><strong>{request.requesterLabel}</strong><small>{formatDateTime(request.requestedAt)}</small>{request.approverLabel ? <small>{request.approverLabel}・{formatDateTime(request.approvedAt)}</small> : null}</span></td><td><span className={`status-pill ${request.status === "pending" ? "status-pill--warning" : "status-pill--success"}`}>{request.status === "pending" ? "待第二人核准" : "已核准套用"}</span></td><td>{request.status === "approved" ? <span className={styles.locked}><CheckCircle2 aria-hidden="true" />已完成</span> : request.requestedByCurrentActor ? <span className={styles.locked}><FileLock2 aria-hidden="true" />申請人不可自批</span> : <RoleGovernanceApproveAction disabledReason={disabledReason} enabled={enabled} instance="desktop" request={request} />}</td></tr>)}</tbody></table></div><div className={styles.mobileCards}>{snapshot.requests.map((request) => <article className={styles.mobileCard} key={`${request.id}-mobile`}><div className={styles.cardTop}><div><p className="eyebrow">{operationLabels[request.operation]}</p><RequestSummary membersById={membersById} request={request} rolesById={rolesById} /></div><span className={`status-pill ${request.status === "pending" ? "status-pill--warning" : "status-pill--success"}`}>{request.status === "pending" ? "待核准" : "已完成"}</span></div><dl><div><dt>申請人</dt><dd>{request.requesterLabel}</dd></div><div><dt>申請時間</dt><dd>{formatDateTime(request.requestedAt)}</dd></div></dl>{request.status === "approved" ? <span className={styles.locked}><CheckCircle2 aria-hidden="true" />已核准套用</span> : request.requestedByCurrentActor ? <span className={styles.locked}><FileLock2 aria-hidden="true" />申請人不可自批</span> : <RoleGovernanceApproveAction disabledReason={disabledReason} enabled={enabled} instance="mobile" request={request} />}</article>)}</div></> : <div className="empty-card"><span className="empty-card__icon"><ShieldCheck aria-hidden="true" /></span><h2>目前沒有治理申請</h2><p>建立申請後，另一位具權限人員會在此獨立覆核。</p></div>}
      </section>
    </>
  );
}
