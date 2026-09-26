---
version: alpha
name: "歲悅日照管理"
description: "沿用歲悅 Finance 的暖色工作台，讓現場與管理人員清楚完成下一項工作。"
colors:
  primary: "#ea880c"
  primary-text: "#b45309"
  background: "#fff9f2"
  surface: "#ffffff"
  soft: "#fff4e4"
  ink: "#2f2a26"
  muted: "#6e6259"
  border: "#f1cfa8"
  danger: "#8a1010"
  success: "#2a6010"
typography:
  sans:
    fontFamily: '"PingFang TC", "Microsoft JhengHei", "Noto Sans TC", sans-serif'
  utility:
    fontFamily: "ui-monospace, monospace"
rounded:
  DEFAULT: "10px"
  sm: "8px"
  md: "10px"
spacing:
  page-padding: "32px"
  control-height: "44px"
components:
  button:
    rounded: "10px"
  card:
    rounded: "10px"
  input:
    rounded: "10px"
---

# 歲悅日照管理設計依據

## Overview

使用者指定的 Finance 畫面為視覺依據，不另作品牌改造。既有 `src/app/globals.css` 是 runtime token 的唯一來源；本文件採 Model B，記錄已實作值，不產生第二套 CSS。

本次範圍包含頁面 82 的題目式量表規則審核入口、頁面 49 的申報驗證安全重試、頁面 19 的人工身體觀察原筆回查，以及單店出勤與收支的有界定時讀取；不代表重新驗收全部 89 頁。使用者為臺灣日照機構主任及授權管理者；繁體中文、`zh-TW`、`Asia/Taipei`，非日本市場。主要工作是核對版本、送審、獨立核准、查閱退休歷程、確認申報草稿與查閱當店收支。

保留熟悉的左側欄與頂部 frame；畫面辨識特徵是暖橘選中狀態與奶油色篩選區。不要大型宣傳標題、裝飾圖表、密集工程警告或另一套 header。安全限制不能因簡化文字而隱藏。

## Colors

`--brand`／`--brand-strong` 用於行動與可讀文字，`--ink`／`--ink-muted` 用於正文及說明，`--surface`／`--surface-soft` 區分內容與篩選區，`--line` 作邊界。成功、危險均須文字，不只靠顏色。新元件引用 CSS 變數，不複製色碼。

淺色是目前已實作主題；不宣稱已驗收深色。forced-colors 保留系統色與可操作捲軸。

## Typography

沿用 Finance 字型堆疊；標題、正文及控制項以字級與 600–700 粗細分層，不新增 display 字型。主頁標題沿用 `.page-heading` 的 28–36px，新管理區段標題 20px，正文 15px、表單輸入至少 16px。雜湊只放進預設收起的技術詳情，長值可換行，不做需要 hover 才看得到的截斷。

## Layout

既有 `--sidebar: 300px`、`--header-height: 82px`、`--content-padding: 32px` 與 AppShell 不變。新區段自然高度、沿用既有內容捲動者；不將整頁固定到 viewport。窄螢幕分成單欄，控制項與主要觸控目標至少 44px，不產生頁面水平溢位。

篩選只有一個量表選擇；歷程最多每批 20 件，明示載入筆數及總數，以「載入更多」取真正游標，不假裝任意頁碼。原頁 82 自訂表單工作區仍保留。

## Elevation & Depth

沿用 `--admin-shadow` 的低陰影與細邊框。不要逐卡強烈浮起；模態確認沿用 `.core-dialog` 與原生 dialog top layer，不自建任意 z-index。

## Shapes

一般卡片／控制項採現有 10px，44px 控制高度。既有 client selection 的 18px 與 sidebar pill 是具業務名稱的既有例外，不因此套到所有卡片。

## Components

| 角色 | 唯一 runtime owner | 本次 consumers |
|---|---|---|
| 文字／色彩／邊框／圓角 | `src/app/globals.css` | 全部新規則管理元件 |
| Header／sidebar | `src/components/app/app-shell.tsx` | 原 page 82，不另造 frame |
| Button／field／dialog surface | `.button`／`.field`／`.core-dialog` | 管理區段及確認視窗 |
| 模態確認行為 | `src/components/ui/governance-dialog.tsx` | 採用／退休／申報驗證共用確認入口 |
| 有界請求／範圍回執 | `client-fetch.ts`／`rule-governance-client.ts` | 讀取、寫入及原操作重試 |

Native select 的關閉外觀沿用 `.control`，開啟選單接受作業系統幾何與鍵盤行為，不宣称其 popup 和 Finance 完全相同。日期採有格式提示的 YYYY-MM-DD 文字欄位與正式 schema 驗證，不自製 calendar。文字欄位明確標籤；textarea 不可拖曳改變佈局，保留充分高度和內部捲動。

店務摘要是已存在的 Finance 篩選具名例外：沿用原生 date／month 控制；人工身體觀察保留既有 native datetime-local，以台北時間轉成帶偏移的正式 schema。兩者接受瀏覽器／作業系統選單、語系及幾何；不是規則治理的 typed 日期欄位，也不宣稱 popup 與 Finance 像素相同。表單關閉原生驗證氣泡，由日期／月份／觀察 input 契約驗證並顯示可操作的錯誤。

pending 按鈕保持原尺寸並標示忙碌；成功只在完整回執確認後出現。錯誤不消失、不展示原始資料庫文字。審核理由、期限與正式啟用後果始終可見；題庫原文、公式和雜湊在詳情中。

申報驗證沿用既有欄位、筆數與總額摘要，不另建 frame；結果未知時只提供原筆回查。店務頁不新增圖表或更改財務口徑，定時讀取不等於成功取得新資料；未更新及離線提示保持可見。

高風險確認視窗的主要按鈕使用既有 `--brand-strong` 配白字，以符合一般文字 AA 對比；只限 `.core-dialog`，不更改 Finance header／sidebar 的既有 token、位置或圓角。此具名無障礙例外來自 Chrome／axe 實測，而非另一套品牌配色。

取消／繼續填寫使用既有 secondary，捨棄未保存內容使用 danger-soft／danger。由 `.core-dialog` 統一擁有語意樣式，不能被工作區的泛用 button 規則改成主要橘色。視窗標題列的取消按鈕不收縮、不拆字；390px 仍須至少 44px 高度並可見。身體觀察的離頁與分支切換確認沿用同一 owner，前一視窗關閉後才開下一個，不疊加兩層確認。

圖示沿用 lucide-react，decorative 圖示 aria-hidden。新區段不另加進場動畫；共同 reduced-motion 保護與 focus-visible 生效。捲軸為全域 application 基線，幾何可局部穩定 gutter，不使用 opt-in class 才有色彩。

題目式量表的 ADL／IADL 草稿狀態修正延用原題卡、radio與 notes 欄位，不增加另一種 frame。不適用原因與日期／測量／條件輸入由既有 questionnaire module 統一16px，避免繼承 compact label 的14.4px；標籤、卡片、Finance header／sidebar不改。狀態使用短文字而非只靠顏色，欄位錯誤可讀且關聯輸入，readonly保留原內容。

## Do's and Don'ts

頁68公告讀取沿用同一 AppShell、metric／panel／filter-bar／table／mobile-records，未變更 Finance frame token或幾何。搜尋採共用 `ui/search-field.tsx` 的明確套用與44px X清除；手機整行搜尋，下方狀態／筆數自然排列。頁尾只有起訖／頁碼與前後頁，不新增裝飾圖表或第二套分頁器。一般畫面縮短工程解釋；全量統計與篩選筆數、目前發布版／草稿及安全／展示限制保持清楚。此輪僅讀取頁，舊公告寫入對話框的未保存／未知結果／textarea規範尚未完整遷移，不能用 scoped audit替它們宣稱通過。

- 送審成功不是正式評估已完成；已採用也不等於臨床簽署能力已開放。
- 待審不能顯示「已由」；僅真人完成的核准事件才是核准證據。
- 不把別的分支、展示資料或資料庫服務密鑰拿來補載入失敗。
- 既有畫面存在 native confirm／validation bubbles 等差異，列為後續 migration，未以文件替它們宣稱合規；本次新區段不用這些模式。
