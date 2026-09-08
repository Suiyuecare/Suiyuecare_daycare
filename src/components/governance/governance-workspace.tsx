import {
  CircleAlert,
  Clock3,
  Database,
  FileLock2,
  KeyRound,
  Network,
  ShieldCheck,
  UsersRound,
} from "lucide-react";

import type { PageCatalogEntry } from "@/lib/catalog";
import { env, hasSupabaseAdminConfiguration, hasSupabaseConfiguration } from "@/lib/env";

const roleTemplates = [
  ["機構管理員", "跨分支管理", "雙人核准"],
  ["分支主管", "所屬分支", "可覆核例外"],
  ["個管／社工", "指派個案", "照顧與社工"],
  ["護理人員", "指派個案", "健康與用藥"],
  ["照顧服務員", "當班個案", "日常紀錄"],
  ["專業人員", "指派個案", "專業評估"],
  ["交通／駕駛", "當日趟次", "最小必要資料"],
  ["財務／申報", "所屬分支", "帳務與申報"],
  ["家屬／關係人", "授權個案", "授權資料類別"],
] as const;

const ruleVersions = [
  ["SPMSQ 官方量表", "候選版本", "待法遵核定", "—", "待指派"],
  ["長照申報代碼", "待匯入", "待主管機關格式", "—", "待指派"],
  ["高風險用藥清單", "待匯入", "待護理核定", "—", "待指派"],
  ["機構自訂照顧日誌", "tenant 草稿", "尚未發布", "—", "待指派"],
] as const;

function Heading({ page }: { page: PageCatalogEntry }) {
  return (
    <>
      <nav aria-label="所在位置" className="context-bar"><span>工作台</span><span aria-hidden="true">／</span><span>系統治理與中央 HTML 匯入</span><span aria-hidden="true">／</span><span aria-current="page" className="context-bar__crumb">{page.title}</span></nav>
      <header className="page-heading">
        <div><p className="eyebrow">治理頁面 {page.number}</p><h1>{page.title}</h1><p className="page-heading__description">{page.description}</p></div>
        <div className="page-heading__actions"><span className="status-pill status-pill--warning"><FileLock2 aria-hidden="true" />所有變更須稽核</span></div>
      </header>
    </>
  );
}

function RolesWorkspace({ page }: { page: PageCatalogEntry }) {
  return (
    <><Heading page={page} /><div className="callout"><CircleAlert aria-hidden="true" /><span>此頁目前顯示預設治理範本，不代表正式環境已完成角色指派或雙人核准。</span></div><section className="content-grid"><div className="panel"><div className="panel__header"><div className="panel__title"><h2>角色與資料範圍矩陣</h2><p>頁面、動作、欄位與資料範圍分開授權</p></div><UsersRound aria-hidden="true" /></div><div className="table-wrap governance-table"><table className="data-table"><thead><tr><th>角色模板</th><th>預設資料範圍</th><th>高風險條件</th><th>狀態</th></tr></thead><tbody>{roleTemplates.map(([role, scope, control]) => <tr key={role}><td><strong>{role}</strong></td><td>{scope}</td><td>{control}</td><td><span className="status-pill status-pill--warning">規劃範本</span></td></tr>)}</tbody></table></div></div><aside className="panel"><div className="panel__header"><div className="panel__title"><h2>擴權核准</h2><p>第二人核准與有效期限</p></div><KeyRound aria-hidden="true" /></div><div className="panel__body"><div className="callout"><ShieldCheck aria-hidden="true" /><span>新增或擴大頁面、欄位、分支、個案範圍時，必須由另一名具權限人員核准。</span></div><ul className="acceptance-list"><li>最近 15 分鐘 AAL2</li><li>核准人不得等於申請人</li><li>到期自動撤權並通知主管</li><li>停用員工 5 分鐘內撤銷工作階段</li></ul></div></aside></section></>
  );
}

function RulesWorkspace({ page }: { page: PageCatalogEntry }) {
  return (
    <><Heading page={page} /><div className="callout"><CircleAlert aria-hidden="true" /><span>以下為待治理清單，不是已生效規則；正式發布前必須完成來源、版本、生效日、負責人與雙人核准。</span></div><section className="panel"><div className="panel__header"><div className="panel__title"><h2>版本治理清單</h2><p>官方與機構自訂規則使用不同命名空間</p></div><FileLock2 aria-hidden="true" /></div><div className="table-wrap governance-table"><table className="data-table"><thead><tr><th>表單／規則</th><th>版本</th><th>狀態</th><th>生效日</th><th>負責人</th></tr></thead><tbody>{ruleVersions.map(([name, version, status, date, owner]) => <tr key={name}><td><strong>{name}</strong></td><td><code>{version}</code></td><td><span className="status-pill status-pill--warning">{status}</span></td><td>{date}</td><td>{owner}</td></tr>)}</tbody></table></div><div className="panel__body"><div className="callout"><CircleAlert aria-hidden="true" /><span>發布前檢查期間不得重疊；發布後不回溯改分，歷史紀錄仍用當時版本重現。</span></div></div></section></>
  );
}

function IntegrationWorkspace({ page }: { page: PageCatalogEntry }) {
  const integrations = [
    ["Supabase", "登入、資料庫、一般附件", hasSupabaseConfiguration(), "東京 ap-northeast-1 需於專案建立時確認"],
    ["敏感後端", "伺服器端管理操作", hasSupabaseAdminConfiguration(), "Secret 僅限伺服器"],
    ["原始 HTML 封存", "加密、七年、WORM", Boolean(env.HTML_ARCHIVE_BUCKET && env.AWS_KMS_KEY_ID && env.AWS_REGION === "ap-northeast-1"), "S3 Object Lock Compliance"],
    ["LINE Messaging API", "非敏感通知與綁定", Boolean(env.LINE_CHANNEL_SECRET && env.LINE_CHANNEL_ACCESS_TOKEN), "公司 Provider 與雙管理員"],
    ["緊急簡訊", "可替換供應商介面", env.SMS_PROVIDER !== "mock", "正式試辦前仍停用"],
  ] as const;

  return (
    <><Heading page={page} /><div className="callout"><CircleAlert aria-hidden="true" /><span>設定值存在只代表環境變數已提供，不代表區域、DPA、權限、WORM 或端到端連線已驗收。</span></div><section className="integration-grid">{integrations.map(([name, purpose, ready, note]) => <article className="panel integration-card" key={name}><div className="metric-card__top"><span className="metric-card__icon">{name === "Supabase" ? <Database /> : <Network />}</span><span className="status-pill status-pill--warning"><Clock3 />{ready ? "待連線驗收" : "待設定"}</span></div><h2>{name}</h2><p>{purpose}</p><small>{note}</small></article>)}</section><section className="content-grid"><div className="panel"><div className="panel__header"><div className="panel__title"><h2>失敗與對帳佇列</h2><p>依相關 ID 與冪等鍵追蹤，不顯示敏感內容</p></div></div><div className="panel__body"><section className="empty-card"><Clock3 aria-hidden="true" /><h2>正式整合尚未啟用</h2><p>啟用並完成連線驗收後，部分失敗才會在這裡個別重試；已成功項目不得重送。</p></section></div></div><aside className="panel"><div className="panel__header"><div className="panel__title"><h2>稽核連線狀態</h2><p>Asia/Taipei</p></div></div><div className="panel__body"><ul className="acceptance-list"><li>正式稽核資料：尚未連線驗收</li><li>查閱與搜尋稽核：尚未實作完整</li><li>權限雙人核准：尚未完成流程</li><li>紀錄檔敏感內容掃描：尚未啟用正式環境</li></ul></div></aside></section></>
  );
}

export function GovernanceWorkspace({ page }: { page: PageCatalogEntry }) {
  if (page.number === 81) return <RolesWorkspace page={page} />;
  if (page.number === 82) return <RulesWorkspace page={page} />;
  return <IntegrationWorkspace page={page} />;
}
