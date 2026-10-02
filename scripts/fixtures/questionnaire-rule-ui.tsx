// Local synthetic browser fixture only. This is not an application route and
// grants no real account, MFA, SQL, or deployed-system permissions.
import { createRoot } from "react-dom/client";
import { QuestionnaireRuleWorkspace } from "@/components/questionnaire-rule-governance/questionnaire-rule-workspace";

const uuid = (number: number) => `a0000000-0000-4000-8000-${String(number).padStart(12, "0")}`;
const scope = { organizationId: uuid(1), branchId: uuid(2), userId: uuid(3) };

createRoot(document.getElementById("fixture-root")!).render(
  <main style={{ padding: "16px", width: "100%", minWidth: 0 }}>
    <aside className="callout" aria-label="本機測試範圍">
      本機合成資料測試 · 非正式系統 · 未連接 Supabase。管理權限與驗證狀態僅為測試 props；
      不證明正式登入、路由、資料庫授權或核准結果。
    </aside>
    <button type="button" id="fixture-background-focus">背景焦點測試</button>
    <QuestionnaireRuleWorkspace scope={scope} canManage hasRecentAal2 demo={false} today="2026-09-26" />
  </main>,
);
