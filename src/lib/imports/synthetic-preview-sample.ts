import { parseCentralCareHtml } from "./parser";
import { validateHtmlImportFile } from "./validation";
import { CURRENT_MAPPING_VERSION } from "./types";

/** Developer-authored synthetic data only; never accepts a file or request input. */
export function buildSyntheticImportPreview() {
  const html = `<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8"></head><body>
    <h5>需要服務者基本資料</h5><table>
      <tr><th>個案姓名</th><td>展示個案（非真人）</td></tr>
      <tr><th>服務狀態</th><td>合成示例，不代表核定</td></tr></table>
    <h5>A.個案基本資料</h5><table><tr><th>資料用途</th><td>僅供靜態解析示範</td></tr></table>
    <h5>待映射示例區段</h5><table><tr><th>尚未識別欄位</th><td>保留待人工確認</td></tr></table>
    </body></html>`;
  const file = validateHtmlImportFile({ fileName: "synthetic-preview.html",
    mimeType: "text/html", bytes: new TextEncoder().encode(html) });
  return parseCentralCareHtml(file, CURRENT_MAPPING_VERSION);
}
