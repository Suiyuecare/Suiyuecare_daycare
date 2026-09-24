import Link from "next/link";
import type { FinanceConfigurationCheck, FinanceConfigurationField } from "@/lib/store-overview/finance-configuration";
import { STORE_OVERVIEW_PATH } from "@/lib/store-overview/types";
import styles from "./integrations-audit.module.css";

const labels: Record<FinanceConfigurationField, string> = {
  FINANCE_STORE_SUMMARY_URL: "Finance 唯讀摘要連線",
  FINANCE_STORE_SUMMARY_TOKEN: "專用連線憑證",
  FINANCE_STORE_ORGANIZATION_ID: "日照機構對應",
  FINANCE_STORE_BRANCH_ID: "日照分支對應",
  FINANCE_STORE_ENTITY_ID: "Finance 店別／法人對應",
};
const states = {
  missing: "尚缺連線設定", invalid: "設定格式需修正",
  scope_mismatch: "設定與目前分支不符", configured_unverified: "設定格式通過，待實際連線驗收",
};

export function FinanceConfigurationPanel({ check, canOpenOverview = false }: {
  check: FinanceConfigurationCheck; canOpenOverview?: boolean;
}) {
  return <section className="panel" aria-labelledby="finance-configuration-heading">
    <div className="panel__header"><div className="panel__title"><h2 id="finance-configuration-heading">Finance 串接檢查</h2>
      <p>只讀取這間店的每月收入、支出，不在日照系統新增或修改會計帳。</p></div></div>
    <div className="panel__body">
      <p role="status"><strong>{states[check.status]}</strong></p>
      {check.missing.length > 0 && <div><h3>待完成設定</h3><ul>{check.missing.map((key) => <li key={key}>{labels[key]}</li>)}</ul></div>}
      {check.invalid.length > 0 && <div><h3>需修正設定</h3><ul>{check.invalid.map((key) => <li key={key}>{labels[key]}</li>)}</ul></div>}
      {check.status === "scope_mismatch" && <p>目前設定不是這個分支；請管理員核對店別，不會讀取或顯示其他店的金額。</p>}
      <details className={styles.details}><summary>管理員接通與驗收步驟</summary>
        <ol>
          <li>由 Finance 管理員確認法人與店別，開通專用的唯讀月摘要及連線憑證。</li>
          <li>在伺服器設定連線與店別對應；不要將憑證貼入此頁、訊息或個案備註。</li>
          <li>由有權限的執行長開啟單店總覽，確認收到同店、同月份的實際收入與支出。</li>
          <li>與 Finance 核對一般月份、無紀錄月份及沖銷情境；斷線時應顯示無法讀取，不得補成 0 元。</li>
        </ol>
      </details>
      <p className={styles.muted}>這裡只檢查設定是否完整、格式與分支是否相符，不發送連線請求、不顯示金鑰，也不代表已連通或完成財務對帳。</p>
      {canOpenOverview && <Link className="button button--secondary" prefetch={false} href={STORE_OVERVIEW_PATH}>開啟單店出勤與收支</Link>}
    </div>
  </section>;
}
