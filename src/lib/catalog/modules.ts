import type { CatalogModule } from "./types";

export const catalogModules = [
  {
    id: "workspace",
    title: "共用工作入口",
    description: "跨模組工作總覽與個案入口。",
    surface: "staff",
    order: 1,
  },
  {
    id: "daily-care",
    title: "日常照顧",
    description: "當日量測、用藥、照顧與個別化服務。",
    surface: "staff",
    order: 2,
  },
  {
    id: "assessments",
    title: "評估量表",
    description: "具版本、計分、簽署與複評期限的專業評估。",
    surface: "staff",
    order: 3,
  },
  {
    id: "quality",
    title: "品質與異常指標",
    description: "事件追蹤、品質指標與改善閉環。",
    surface: "staff",
    order: 4,
  },
  {
    id: "social-work",
    title: "社工服務",
    description: "心理社會、資源、活動與適應服務。",
    surface: "staff",
    order: 5,
  },
  {
    id: "professional-care",
    title: "專業服務",
    description: "跨專業評估、照會、轉介及治療紀錄。",
    surface: "staff",
    order: 6,
  },
  {
    id: "communication",
    title: "安心照顧與溝通",
    description: "機構、個案與家屬間的訊息、行程及推播。",
    surface: "staff",
    order: 7,
  },
  {
    id: "service-management",
    title: "服務管理",
    description: "出勤、交通、服務、照顧計畫與申報。",
    surface: "staff",
    order: 8,
  },
  {
    id: "operations",
    title: "機構營運管理",
    description: "機構、人員、財務、物資、文件與評鑑。",
    surface: "staff",
    order: 9,
  },
  {
    id: "governance",
    title: "系統治理與中央匯入",
    description: "安全匯入、權限、規則版本及稽核整合。",
    surface: "staff",
    order: 10,
  },
  {
    id: "family-portal",
    title: "家屬服務",
    description: "經授權的照顧摘要、溝通、行程、帳單與設定。",
    surface: "family",
    order: 11,
  },
] as const satisfies readonly CatalogModule[];

