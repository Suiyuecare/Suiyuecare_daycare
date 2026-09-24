import type { RoleKey } from "./types";

export type RoleCategoryScope = "organization" | "branch" | "assigned" | "consent" | "platform";

/** Human-facing standard categories, not an authorization or qualification rule.
 * Existing keys stay stable for records, API contracts and membership history.
 * Only use these labels for system templates; custom and historic names survive. */
export const DEFAULT_ROLE_CATEGORIES = [
  { key: "organization_manager", label: "全機構管理員（多點管理）", scope: "organization",
    summary: "管理獲授權機構內的多個據點，不跨越未授權機構。" },
  { key: "branch_supervisor", label: "機構管理員（單點管理）", scope: "branch",
    summary: "管理指定的單一據點，必須明確設定據點範圍。" },
  { key: "branch_director", label: "機構主任", scope: "branch",
    summary: "負責指定據點的日常工作追蹤；兼任護理或社工須另外核准相應角色與資格。" },
  { key: "nurse", label: "護理人員", scope: "assigned",
    summary: "處理授權個案的護理工作；用藥與簽署另依資格及動作權限確認。" },
  { key: "case_manager_social_worker", label: "社工人員", scope: "assigned",
    summary: "處理授權個案的社工服務、評估與聯繫工作。" },
  { key: "care_worker", label: "照顧服務員", scope: "assigned",
    summary: "處理當班或指派個案的出勤、量測及照顧紀錄。" },
  { key: "transport_driver", label: "駕駛人員", scope: "assigned",
    summary: "處理指派接送工作，只查看必要的接送資訊。" },
  { key: "professional", label: "專業人員", scope: "assigned",
    summary: "依專業資格處理授權的物理治療、職能治療、營養等服務。" },
  { key: "finance_claims", label: "財務人員", scope: "branch",
    summary: "依授權處理指定據點的帳務、申報與對帳，不因職稱取得全部臨床資料。" },
  { key: "platform_ops", label: "系統維護人員", scope: "platform",
    summary: "處理系統維護，預設不查看明文個案資料。" },
  { key: "family", label: "家屬／關係人", scope: "consent",
    summary: "依關係、同意、資料類別及期限查看已授權個案。" },
] as const satisfies readonly {
  key: RoleKey;
  label: string;
  scope: RoleCategoryScope;
  summary: string;
}[];

/** Possible separately approved additional roles, never automatically assigned. */
export const directorConcurrentRoleKeys = ["nurse", "case_manager_social_worker"] as const satisfies readonly RoleKey[];

export function roleDisplayName(roleKey: string, fallback = "未辨識角色"): string {
  return DEFAULT_ROLE_CATEGORIES.find((category) => category.key === roleKey)?.label ?? fallback;
}

const scopeLabels: Record<RoleCategoryScope, string> = {
  organization: "授權機構內・多點", branch: "指定據點", assigned: "指派個案／工作",
  consent: "個案同意授權", platform: "維運範圍",
};

export function roleScopeLabel(roleKey: string): string {
  const category = DEFAULT_ROLE_CATEGORIES.find((entry) => entry.key === roleKey);
  return category ? scopeLabels[category.scope] : "依個別核准範圍";
}
