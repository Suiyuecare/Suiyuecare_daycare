import type { OfflineMode, PageCatalogEntry } from "./types";

type FamilyPageInput = Omit<
  PageCatalogEntry,
  | "number"
  | "slug"
  | "moduleId"
  | "surface"
  | "origin"
  | "offline"
  | "requiredPermissions"
> & {
  offlineMode: Exclude<OfflineMode, "online-only"> | "online-only";
  offlineNote: string;
};

function familyPage(
  number: number,
  segment: string,
  input: FamilyPageInput,
): PageCatalogEntry {
  return {
    number,
    slug: `family/${segment}`,
    moduleId: "family-portal",
    surface: "family",
    origin: "family",
    title: input.title,
    description: input.description,
    primaryActions: input.primaryActions,
    filters: input.filters,
    metrics: input.metrics,
    columns: input.columns,
    acceptance: input.acceptance,
    requiredPermissions: [],
    riskLevel: input.riskLevel,
    offline: { mode: input.offlineMode, note: input.offlineNote },
  };
}

export const familyPages = [
  familyPage(84, "home", {
    title: "家屬首頁",
    description: "顯示經授權個案的當日照顧、交通、行程與未讀摘要。",
    primaryActions: ["查看照顧摘要", "查看接送", "查看下次行程", "查看未讀"],
    filters: ["授權個案", "日期"],
    metrics: ["今日出勤", "交通狀態", "照顧摘要", "未讀通知"],
    columns: ["更新時間", "出勤", "交通", "照顧摘要", "下次行程", "未讀"],
    acceptance: ["每張摘要卡連到同一筆來源資料，標示更新時間且不得顯示未授權個案。"],
    riskLevel: "high",
    offlineMode: "read-cache-24h",
    offlineNote: "只快取已授權個案的最小摘要，最長 24 小時；登出立即清除。",
  }),
  familyPage(85, "communication", {
    title: "家屬溝通",
    description: "與機構交換訊息、附件並追蹤傳送與已讀狀態。",
    primaryActions: ["新增訊息", "儲存草稿", "上傳附件", "確認訊息"],
    filters: ["授權個案", "日期", "訊息狀態"],
    metrics: ["未讀訊息", "待確認", "草稿", "傳送失敗"],
    columns: ["時間", "發送者", "訊息", "附件", "傳送狀態", "確認狀態"],
    acceptance: ["訊息按時間排列，離線草稿冪等同步且家屬間資料完全隔離。"],
    riskLevel: "high",
    offlineMode: "draft-sync-24h",
    offlineNote: "只保存未送出的加密草稿，最長 24 小時；附件送出必須連線。",
  }),
  familyPage(86, "care-summary", {
    title: "健康與照顧摘要",
    description: "查看機構核准公開的健康量測、用藥與照顧摘要。",
    primaryActions: ["查看量測趨勢", "查看用藥完成", "查看照顧摘要", "查看評估摘要"],
    filters: ["授權個案", "日期區間", "資料類型"],
    metrics: ["最新量測", "用藥完成狀態", "照顧更新", "已公開評估"],
    columns: ["日期時間", "資料類型", "摘要", "來源", "公開時間", "狀態"],
    acceptance: ["只呈現機構核准公開內容並標示時間與來源，畫面不得產生診斷性文字。"],
    riskLevel: "high",
    offlineMode: "read-cache-24h",
    offlineNote: "只快取經公開且已授權的摘要，最長 24 小時；不快取附件與完整病歷。",
  }),
  familyPage(87, "schedule", {
    title: "行程／活動／交通",
    description: "以月曆或列表查看個案行程、活動與接送狀態。",
    primaryActions: ["切換月曆／列表", "查看行程", "查看接送", "加入裝置行事曆"],
    filters: ["授權個案", "月份", "類型", "狀態"],
    metrics: ["本月行程", "今日行程", "即將接送", "已取消"],
    columns: ["日期時間", "類型", "行程／活動", "地點", "交通狀態", "取消原因"],
    acceptance: ["月曆與列表內容一致，並與機構端相同版本的行程、接送及取消狀態一致。"],
    riskLevel: "sensitive",
    offlineMode: "read-cache-24h",
    offlineNote: "可快取未來 30 日最小行程資料 24 小時；狀態過期時明確提示需連線更新。",
  }),
  familyPage(88, "billing-documents", {
    title: "帳單與文件",
    description: "查看帳單、收據、付款狀態及已核准公開文件。",
    primaryActions: ["查看帳單", "查看收據", "下載文件"],
    filters: ["授權個案", "帳務期間", "付款狀態", "文件類型"],
    metrics: ["本期應付", "已付款", "未付款", "可下載文件"],
    columns: ["期間／文件", "明細", "總額", "付款狀態", "發布日期", "下載"],
    acceptance: ["帳單明細加總等於總額，只有已發布文件可下載且每次下載均留下稽核。"],
    riskLevel: "high",
    offlineMode: "online-only",
    offlineNote: "財務、收據與正式文件只能在線上查看或下載，不寫入離線快取。",
  }),
  familyPage(89, "notifications-settings", {
    title: "通知與設定",
    description: "管理未讀通知、聯絡方式、推播、安靜時段及 LINE 綁定。",
    primaryActions: ["查看通知", "設定偏好", "綁定／解除 LINE", "登出"],
    filters: ["授權個案", "未讀狀態", "通知分類"],
    metrics: ["未讀通知", "重大通知", "已啟用分類", "綁定狀態"],
    columns: ["時間", "分類", "主旨", "個案", "已讀狀態", "通知管道"],
    acceptance: ["未讀數與通知清單一致，偏好可持久保存且登出後清除全部本機快取。"],
    riskLevel: "high",
    offlineMode: "read-cache-24h",
    offlineNote: "只快取最近通知標題與偏好 24 小時；登出或解除個案授權即清除。",
  }),
] as const;
