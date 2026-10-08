import { createHash } from "node:crypto";

import { strToU8, zipSync } from "fflate";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { planJuboImport } from "./planner";
import {
  JuboXlsxReadError, MAX_JUBO_XLSX_BYTES, parseHashVerifiedJuboXlsx, readApprovedJuboXlsx,
  type JuboWorkbookKind,
} from "./xlsx-reader";

const MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const ORG = "00000000-0000-4000-8000-000000000001";
const BRANCH = "00000000-0000-4000-8000-000000000002";
const SECRET = "synthetic secret with at least 32 bytes for tests";

function columnName(index: number) {
  let number = index + 1;
  let result = "";
  while (number > 0) { number -= 1; result = String.fromCharCode(65 + number % 26) + result; number = Math.floor(number / 26); }
  return result;
}

function escaped(value: string) {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}

function textCell(column: number, row: number, value: string) {
  return `<c r="${columnName(column)}${row}" t="inlineStr"><is><t>${escaped(value)}</t></is></c>`;
}

function numberCell(column: number, row: number, value: number, style = 0) {
  return `<c r="${columnName(column)}${row}" s="${style}"><v>${value}</v></c>`;
}

function excelSerial(year: number, month: number, day: number) {
  return Math.round((Date.UTC(year, month - 1, day) - Date.UTC(1899, 11, 30)) / 86_400_000);
}

const masterLabels: Record<number, string> = {
  2: "姓名", 3: "性別", 8: "開案日期", 9: "首次服務日期", 11: "結案日期", 15: "狀態",
  23: "生日", 25: "身分證字號", 32: "戶籍地址", 35: "居住地址", 48: "CMS等級",
  54: "身心障礙證明/手冊", 78: "主要聯絡人", 79: "主要聯絡人聯絡方式",
  80: "代理人", 81: "代理人聯絡方式",
};

function syntheticWorkbook(kind: JuboWorkbookKind, options: {
  extraWorksheet?: string;
  extraRelationship?: string;
  extraPart?: { name: string; content: string };
  dateSerial?: number;
  definedNames?: string;
  extraRows?: string;
} = {}) {
  const master = kind === "master";
  const width = master ? 95 : 191;
  const headerRow = master ? 5 : 4;
  const dataRow = headerRow + 1;
  const sheetName = master ? "個案檔案總表＿自訂表單欄位" : "日照個案總表_202610";
  const headers = Array.from({ length: width }, (_, index) =>
    master ? masterLabels[index] ?? (index < 2 ? "重複欄" : `備用欄${index + 1}`) : index === 3 ? "狀態" : index === 7 ? "姓名" : index === 29 ? "身分證字號" : index < 2 ? "重複欄" : `備用欄${index + 1}`);
  const headerCells = headers.map((label, index) => textCell(index, headerRow, label)).join("");
  const dataCells = master ? [
    textCell(0, dataRow, "來源原值"), numberCell(1, dataRow, 0),
    textCell(2, dataRow, "合成測試個案"), textCell(3, dataRow, "女性"),
    numberCell(8, dataRow, options.dateSerial ?? excelSerial(2026, 1, 2), 1),
    numberCell(9, dataRow, excelSerial(2026, 1, 5), 1),
    textCell(15, dataRow, "服務中"), numberCell(23, dataRow, excelSerial(1950, 3, 4), 1),
    textCell(25, dataRow, "ZZ00000001"), textCell(32, dataRow, "虛構戶籍地址"),
    textCell(35, dataRow, "虛構居住地址"), textCell(48, dataRow, "第 3 級"),
    textCell(54, dataRow, "虛構證明"), textCell(78, dataRow, "合成聯絡人"),
    textCell(79, dataRow, "0000000000"),
  ].join("") : [textCell(3, dataRow, "服務中"), textCell(7, dataRow, "合成測試個案"), textCell(29, dataRow, "ZZ00000001")].join("");
  const worksheet = `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="${headerRow}">${headerCells}</row><row r="${dataRow}">${dataCells}${options.extraWorksheet ?? ""}</row>${options.extraRows ?? ""}</sheetData></worksheet>`;
  const workbook = `<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="${sheetName}" sheetId="1" r:id="rId1"/></sheets>${options.definedNames ?? "<definedNames/>"}</workbook>`;
  const relationship = `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>${options.extraRelationship ?? ""}</Relationships>`;
  const types = `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/></Types>`;
  const styles = `<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><numFmts count="1"><numFmt numFmtId="164" formatCode="yyyy/mm/dd"/></numFmts><cellXfs count="2"><xf numFmtId="0"/><xf numFmtId="164"/></cellXfs></styleSheet>`;
  const parts: Record<string, Uint8Array> = {
    "[Content_Types].xml": strToU8(types),
    "xl/workbook.xml": strToU8(workbook),
    "xl/_rels/workbook.xml.rels": strToU8(relationship),
    "xl/styles.xml": strToU8(styles),
    "xl/worksheets/sheet1.xml": strToU8(worksheet),
  };
  if (options.extraPart) parts[options.extraPart.name] = strToU8(options.extraPart.content);
  return zipSync(parts);
}

function read(kind: JuboWorkbookKind, bytes: Uint8Array) {
  return parseHashVerifiedJuboXlsx({
    kind, fileName: `synthetic-${kind}.xlsx`, mimeType: MIME, bytes,
    trustedExpectedSha256: createHash("sha256").update(bytes).digest("hex"),
  });
}

function code(action: () => unknown) {
  try { action(); }
  catch (error) {
    expect(error).toBeInstanceOf(JuboXlsxReadError);
    return (error as JuboXlsxReadError).code;
  }
  throw new Error("Expected XLSX to be rejected");
}

describe("bounded, hash-verified Jubo XLSX reader (synthetic files only)", () => {
  it("produces planner-compatible 95/191 arrays while retaining duplicate headers, date serials and OOXML types", () => {
    const masterBytes = syntheticWorkbook("master");
    const summaryBytes = syntheticWorkbook("monthlySummary");
    const master = read("master", masterBytes).sheet;
    const monthlySummary = read("monthlySummary", summaryBytes).sheet;
    expect(master.headers).toHaveLength(95);
    expect(monthlySummary.headers).toHaveLength(191);
    expect(master.headers.slice(0, 2)).toEqual(["重複欄", "重複欄"]);
    expect(master.rows[0][8]).toBe("2026-01-02");
    expect(master.rawRows?.[0][8]).toBe(excelSerial(2026, 1, 2));
    expect(master.rawCellTypes?.[0][8]).toBe("n");
    const plan = planJuboImport({ organizationId: ORG, branchId: BRANCH, hmacSecret: SECRET, master, monthlySummary, expectedCounts: { master: 1, monthlySummary: 1 } });
    expect(plan.matchedSummaryRowCount).toBe(1);
    expect(plan.clients[0].profile.dateOfBirth).toBe("1950-03-04");
    expect(plan.clients[0].dates.sourceOpenedOn).toBe("2026-01-02");
    expect(plan.clients[0].dates.admittedOn).toBeNull();
    expect(plan.clients[0].master.columns[8]).toMatchObject({ index: 8, columnNumber: 9, value: excelSerial(2026, 1, 2), sourceCellType: "n" });
    expect(plan.clients[0].master.columns[0].header).toBe(plan.clients[0].master.columns[1].header);
  });

  it("requires the formal allowlisted source hash and validates extension, MIME, bytes and size", () => {
    const bytes = syntheticWorkbook("master");
    expect(code(() => readApprovedJuboXlsx({ kind: "master", fileName: "synthetic.xlsx", mimeType: MIME, bytes }))).toBe("HASH_MISMATCH");
    expect(code(() => parseHashVerifiedJuboXlsx({ kind: "master", fileName: "synthetic.xls", mimeType: MIME, bytes, trustedExpectedSha256: createHash("sha256").update(bytes).digest("hex") }))).toBe("INVALID_FILE");
    expect(code(() => parseHashVerifiedJuboXlsx({ kind: "master", fileName: "synthetic.xlsx", mimeType: "application/octet-stream", bytes, trustedExpectedSha256: createHash("sha256").update(bytes).digest("hex") }))).toBe("INVALID_MIME");
    expect(code(() => parseHashVerifiedJuboXlsx({ kind: "master", fileName: "synthetic.xlsx", mimeType: MIME, bytes: new Uint8Array(MAX_JUBO_XLSX_BYTES + 1), trustedExpectedSha256: "a".repeat(64) }))).toBe("FILE_TOO_LARGE");
    expect(code(() => parseHashVerifiedJuboXlsx({ kind: "master", fileName: "synthetic.xlsx", mimeType: MIME, bytes, trustedExpectedSha256: "a".repeat(64) }))).toBe("HASH_MISMATCH");
  });

  it("rejects formulas, external relationships and unknown active parts before mapping", () => {
    const formula = syntheticWorkbook("master", { extraWorksheet: `<c r="BE6"><f>SUM(A1:A2)</f><v>0</v></c>` });
    expect(code(() => read("master", formula))).toBe("FORMULA");
    const external = syntheticWorkbook("master", { extraRelationship: `<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="https://example.invalid" TargetMode="External"/>` });
    expect(code(() => read("master", external))).toBe("EXTERNAL_LINK");
    const macro = syntheticWorkbook("master", { extraPart: { name: "xl/vbaProject.bin", content: "synthetic-only" } });
    expect(code(() => read("master", macro))).toBe("UNSAFE_PART");
    const namedFormula = syntheticWorkbook("master", { definedNames: `<definedNames><definedName name="unsafe">SUM(A1:A2)</definedName></definedNames>` });
    expect(code(() => read("master", namedFormula))).toBe("EXTERNAL_LINK");
  });

  it("rejects compressed payload bombs and encrypted ZIP metadata before decompression", () => {
    const bomb = syntheticWorkbook("master", { extraPart: { name: "docProps/custom.xml", content: "A".repeat(8 * 1024 * 1024 + 1) } });
    expect(code(() => read("master", bomb))).toBe("ZIP_LIMIT");
    const encrypted = Buffer.from(syntheticWorkbook("master"));
    const signature = encrypted.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
    expect(signature).toBeGreaterThan(0);
    encrypted.writeUInt16LE(encrypted.readUInt16LE(signature + 8) | 1, signature + 8);
    expect(code(() => read("master", encrypted))).toBe("INVALID_ZIP");
  });

  it("fails on invalid Excel date serials without guessing a care date", () => {
    expect(code(() => read("master", syntheticWorkbook("master", { dateSerial: 60 })))).toBe("INVALID_DATE");
  });

  it("retains a sparse source footer outside client records, but rejects missing identities and client-like trailing data", () => {
    const footer = syntheticWorkbook("master", { extraRows: `<row r="8">${textCell(0, 8, "合成來源註記")}</row><row r="9"><c r="A9" s="1"/></row>` });
    const sheet = read("master", footer).sheet;
    expect(sheet.rows).toHaveLength(1);
    expect(sheet.nonRecordRows).toHaveLength(1);
    expect(sheet.nonRecordRows?.[0]).toMatchObject({ sheetRow: 8 });
    expect(sheet.nonRecordRows?.[0].rawValues[0]).toBe("合成來源註記");
    const missingIdentity = syntheticWorkbook("master", { extraRows: `<row r="8">${textCell(25, 8, "ZZ00000002")}</row>` });
    expect(code(() => read("master", missingIdentity))).toBe("INVALID_SHEET");
    const clientLikeFooter = syntheticWorkbook("master", { extraRows: `<row r="8">${textCell(2, 8, "合成個案")}</row>` });
    expect(code(() => read("master", clientLikeFooter))).toBe("INVALID_SHEET");
  });
});
