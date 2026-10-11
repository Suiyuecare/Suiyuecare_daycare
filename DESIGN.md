---
version: alpha
name: "歲悅日照管理"
description: "對齊歲悅 APM／Finance CIS，以當班照顧工作為核心的繁體中文產品介面。"
colors:
  primary: "#ea880c"
  primaryStrong: "#b45309"
  primaryActionHover: "#92400e"
  ink: "#2f2a26"
  muted: "#6e6259"
  paper: "#f7f3ec"
  surface: "#ffffff"
  soft: "#fff4e4"
  line: "#f1cfa8"
  danger: "#8a1010"
  warning: "#7a4500"
  success: "#2a6010"
typography:
  sans:
    fontFamily: 'Noto Sans TC, PingFang TC, Microsoft JhengHei, system-ui, sans-serif'
rounded:
  DEFAULT: "8px"
  sm: "8px"
  md: "10px"
  lg: "10px"
spacing:
  sidebarDesktop: "300px"
  headerDesktop: "82px"
  headerMobile: "64px"
  contentDesktop: "32px"
components:
  button: {}
  panel: {}
  navigation: {}
---

# 歲悅日照管理 Design System

## Overview

### Creative North Star

像值班交接板一樣，一眼看出「今天要照顧誰、下一步做什麼」；外框對齊公司 APM 與 Finance 的暖白頁底、橘色導覽、Noto Sans TC 與細框線，不讓 89 個頁面入口壓過當班工作。這是共用的歲悅 CIS，不是新的品牌提案。

- **使用者與場景：** 萬華日照機構的照服員、護理、社工與主管；桌機查核，手機當班快速搜尋個案與接續紀錄。家屬端有獨立外框。
- **市場／語言：** 臺灣機構，介面使用繁體中文；業務日期以 `Asia/Taipei` 判定。機構全銜與授權分支來自正式情境，不以展示名稱覆寫。
- **產品辨識點：** 今日工作以待處理名單、個案狀態和直接動作作為首頁重點；狀態要有文字，不能只靠顏色或圖示。
- **克制範圍：** 臨床紀錄、身分、金額和權限必須保留可辨識的來源、狀態與確認步驟；「文字少」不等於省略風險、缺值或錯誤原因。
- **避免：** 以整份 89 頁目錄當員工首頁、堆疊工程欄位說明、無功能的裝飾卡、只有橘色而無文字的警示。
- **權威來源：** 本檔鏡像既有 `src/app/globals.css`，該檔的 `:root` 變數為執行時權威；`src/components/app/app-shell.tsx`、今日工作與個案中心消費這些變數。本檔不產生 CSS；改全域值時須同一變更更新 CSS、此檔與對比／畫面驗證。

## Colors

色票對齊 APM 的現行執行時基線。`primary` 是識別橘，`primaryStrong` 用於深色文字／選取狀態；`paper` 是 `#f7f3ec` 外框底，`surface` 是資料面，`line` 定義細框，`ink`／`muted` 區分主要與次要資訊。`danger`、`warning`、`success` 只作語意，必須搭配文字與圖示。

| 本檔 | 執行時來源 | 使用處 |
|---|---|---|
| `colors.primary` / `primaryStrong` / `primaryActionHover` | `--admin-orange` / `--admin-orange-dark` / `--admin-orange-action-hover` → `--brand` / `--brand-strong` | 品牌識別、主要動作與其 hover、導覽、焦點與選取 |
| `colors.ink` / `muted` | `--admin-brown` / `--admin-muted` → `--ink` / `--ink-muted` | 本文與次要資訊 |
| `colors.paper` / `surface` / `soft` / `line` | `--admin-paper` / `--admin-surface` / `--admin-soft` / `--admin-line` | 外框、卡片與邊界 |
| `colors.danger` / `warning` / `success` | `--danger` / `--warning` / `--success` | 異常、留意與完成狀態 |

原本 `.button--primary` 的 `#ea880c` 底加白字約 **2.62:1**，低於一般文字 WCAG AA 的 4.5:1。本輪把共用主要按鈕改用 Finance 既有的深橘 `#b45309`（白字約 5.02:1），hover 用 `#92400e`；照顧提示文字改用 `warning` 深棕。其他模組仍須逐頁檢查，不能由這項修正推論全站對比已合格。

## Typography

字型家族鏡像 APM 的 `next/font` Noto Sans TC 與 `--font-sans` 堆疊，優先支援繁體中文字形。員工頁以個案中心為主標題基準：`.page-heading h1` 為 28–36px、700 字重、`-.025em` 字距、1.2 行高；說明文字為 14px、1.55 行高。執行時由 `globals.css :root` 的 `--page-title-*` 與 `--page-description-*` 擁有這組數值；共用 `.main-stage h1` 提供同樣的字型／字重／字距／行高基線，但不強制特殊頁標題的字級。新業務頁及個案建檔應優先重用 `.page-heading`，避免局部標題退回細字。基礎本文與輸入欄位為 16px，按鈕約 14px；個案姓名、動作、錯誤原因優先清楚完整，代碼、日期與次要摘要才使用較小字級。不得為了壓成一行而裁切關鍵健康或權限資訊。

## Layout

1181px 以上使用與 APM 相同的 300px 側欄、82px 單列頂列與 44px 頂列操作目標，內容內距 32px；`main-stage` 是主要垂直捲動容器。761–1180px 保留日照的較窄側欄與 96px 雙列頂列，讓頁名、操作和帳號狀態都保持可見；760px 以下使用 APM 的 64px 頂列，保留日照現行的覆蓋式側欄與底部常用功能列，內容需避開安全區。今日工作手機先呈現搜尋與清單，進階篩選可展開；個案中心桌機用表格、手機用卡片，兩者必須保留相同個案身分、狀態及動作。這些是目前切片的布局約定，不表示所有 89 頁已完成響應式驗收。

## Elevation & Depth

主要層級靠紙色、白色資料面和細邊框；共用 Panel 與指標卡使用 APM 的 `0 2px 8px rgb(180 83 9 / 4%)` 輕陰影，不額外堆出重浮卡。選單、抽屜和正在載入的覆蓋層可有有限陰影，但不能遮住焦點或讓工作結果看起來已完成。

## Shapes

共用控制依 APM 為 8px、卡片為 10px 圓角；側欄選取項及少數圖示容器目前有 12–18px 的既有例外，屬需要逐步收斂的現況，不將任意新弧度視為設計規範。按鈕與關鍵觸控目標至少 44px 高。

## Components

- **狀態：** 導覽有文字、當前頁與可見焦點；待處理、受限、無資料、載入失敗及資料尚未更新各有不同文案。已簽署／已完成不能只因橘色或動畫被推定。
- **動作：** 既有 `.button` 為 44px 最小高度、8px 標準圓角；一個工作區以單一明確主要動作為主。高風險操作的審核與防重送以業務契約為準。
- **導覽：** `AppShell` 擁有 Finance 對齊的側欄／頂列；`NavigationLink` 擁有路由待載入回饋。不要在單頁重新做一套框架或假進度動畫。
- **資料：** `panel`、`metric-card`、`status-pill` 只濃縮資訊；詳細資料仍可下鑽。手機卡片不得隱藏桌機可執行的核心操作。
- **輸入與覆蓋層：** 搜尋須有明確清除與鍵盤焦點；原生選單是目前實作，開啟後的跨平台外觀尚未作為 Finance 像素對齊驗收。對話框及抽屜沿用共用層級。
- **圖示與動態：** 既有圖示使用 `lucide-react`，圖示不能取代關鍵動作文字。轉場只表示真正載入或狀態切換；尊重 `prefers-reduced-motion`，避免每次重繪都播放進場動畫。
- **文案：** 用「待處理、開始當日工作、查看當日紀錄」等現場詞彙；工程細節留在治理頁。顯示的總數、來源、日期及完成狀態必須能被核對。

## Do's and Don'ts

- **Do：** 新畫面沿用 `globals.css` 色票、`AppShell` 外框和共用狀態元件，再在手機檢查可見第一步。
- **Do：** 保留病人安全、權限與資料完整性的必要文字，並用可操作空狀態引導下一步。
- **Don't：** 把候選量表、唯讀預覽或未設定整合包裝為已完成正式營運功能。
- **Don't：** 為追求 Finance 顏色完全相同而保留不達標的文字對比；目前亮橘白字是待修缺口。

## 2026-10-11 照服員任務入口

純照服員的預設視覺層級是「今日照顧 → 個案卡 → 該個案可執行工作」。桌機側欄只把今日照顧與個案放在第一層；「更多功能」只列已授權的日常量測、用藥、日誌、出勤與接送頁，不列收案、評估或財務入口。手機保留可帶入已選個案的量測入口。卡片沿用共用色票、10px 圓角、細邊框與 44px 以上觸控目標；圖示伴隨文字，不能單獨表示完成。管理統計與進階篩選不應占用照服員首屏。這是角色專用導覽，不改其他角色的 CIS 或授權。
