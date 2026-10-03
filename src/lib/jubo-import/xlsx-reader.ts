import "server-only";

import { createHash } from "node:crypto";
import path from "node:path";

import { load } from "cheerio/slim";
import { unzipSync, type UnzipFileInfo } from "fflate";

import type { JuboSheet } from "./planner";

export type JuboWorkbookKind = "master" | "monthlySummary";
export type JuboXlsxReadErrorCode =
  | "INVALID_FILE" | "INVALID_MIME" | "FILE_TOO_LARGE" | "HASH_MISMATCH"
  | "UNAPPROVED_SOURCE" | "INVALID_ZIP" | "ZIP_LIMIT" | "UNSAFE_PART"
  | "EXTERNAL_LINK" | "FORMULA" | "INVALID_XML" | "INVALID_WORKBOOK"
  | "INVALID_CELL" | "INVALID_DATE" | "INVALID_SHEET";

export class JuboXlsxReadError extends Error {
  constructor(public readonly code: JuboXlsxReadErrorCode) {
    // No file names, cell values, source XML or decompression errors in logs.
    super(`Jubo XLSX rejected: ${code}`);
    this.name = "JuboXlsxReadError";
  }
}

/** Existing source files only. New exports require a reviewed hash update. */
export const APPROVED_JUBO_SOURCE_SHA256 = {
  master: "7ddb8c84f7a8e7faa3bc74f147ee82fc3fcf465844c630764a1c4062146e42a7",
  monthlySummary: "aa1e02c2bc1029bc78d8f7e46c68f979fbdfa1d7010a5ec8e29818bc54854ff4",
} as const;

export const MAX_JUBO_XLSX_BYTES = 10 * 1024 * 1024;
const MAX_ZIP_ENTRIES = 64;
const MAX_ENTRY_BYTES = 8 * 1024 * 1024;
const MAX_TOTAL_UNCOMPRESSED_BYTES = 32 * 1024 * 1024;
const MAX_COMPRESSION_RATIO = 250;
const MAX_ROWS = 2_000;
const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const XML_DECODER = new TextDecoder("utf-8", { fatal: true });

export type JuboXlsxInput = {
  readonly kind: JuboWorkbookKind;
  readonly fileName: string;
  readonly mimeType: string;
  readonly bytes: Uint8Array;
};

export type JuboXlsxReadResult = { readonly sha256: string; readonly sheet: JuboSheet };

type ZipEntry = { readonly name: string; readonly compressedSize: number; readonly originalSize: number };

function reject(code: JuboXlsxReadErrorCode): never { throw new JuboXlsxReadError(code); }

function validateEnvelope(input: JuboXlsxInput) {
  if (typeof input.fileName !== "string" || path.basename(input.fileName) !== input.fileName || !/^[^\\/\u0000-\u001f]+\.xlsx$/iu.test(input.fileName)) reject("INVALID_FILE");
  if (typeof input.mimeType !== "string" || input.mimeType.toLowerCase().trim() !== XLSX_MIME) reject("INVALID_MIME");
  if (!(input.bytes instanceof Uint8Array) || input.bytes.byteLength < 22) reject("INVALID_FILE");
  if (input.bytes.byteLength > MAX_JUBO_XLSX_BYTES) reject("FILE_TOO_LARGE");
  if (input.bytes[0] !== 0x50 || input.bytes[1] !== 0x4b) reject("INVALID_FILE");
}

function safePartName(name: string) {
  if (!/^[A-Za-z0-9_./\[\]-]+$/u.test(name) || name.startsWith("/") || name.includes("\\") || name.split("/").includes("..") || name.includes("//")) reject("UNSAFE_PART");
  if (/\.(?:bin|vml|exe|dll|js|html?|svg)$/iu.test(name) || /(?:^|\/)(?:externalLinks|activeX|embeddings|connections|queryTables|customXml)(?:\/|$)/iu.test(name)) reject("UNSAFE_PART");
  if (/(?:^|\/)(?:vbaProject|calcChain|pivotCache|oleObject)/iu.test(name)) reject("UNSAFE_PART");
  const allowed =
    name === "[Content_Types].xml" || name === "_rels/.rels" ||
    /^docProps\/(?:app|core|custom)\.xml$/u.test(name) ||
    name === "xl/workbook.xml" || name === "xl/_rels/workbook.xml.rels" ||
    name === "xl/styles.xml" || name === "xl/sharedStrings.xml" ||
    /^xl\/theme\/theme\d+\.xml$/u.test(name) ||
    /^xl\/drawings\/drawing\d+\.xml$/u.test(name) ||
    name === "xl/persons/person.xml" ||
    /^xl\/worksheets\/sheet\d+\.xml$/u.test(name) ||
    /^xl\/worksheets\/_rels\/sheet\d+\.xml\.rels$/u.test(name);
  if (!allowed) reject("UNSAFE_PART");
}

/** A bounded central-directory check before the mature ZIP library allocates output. */
function inspectZipDirectory(bytes: Uint8Array): Map<string, ZipEntry> {
  const view = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let end = -1;
  for (let cursor = view.length - 22; cursor >= Math.max(0, view.length - 65_557); cursor -= 1) {
    if (view.readUInt32LE(cursor) === 0x06054b50 && cursor + 22 + view.readUInt16LE(cursor + 20) === view.length) { end = cursor; break; }
  }
  if (end < 0 || view.readUInt16LE(end + 4) !== 0 || view.readUInt16LE(end + 6) !== 0) reject("INVALID_ZIP");
  const count = view.readUInt16LE(end + 10);
  const directorySize = view.readUInt32LE(end + 12);
  let cursor = view.readUInt32LE(end + 16);
  if (count < 1 || count > MAX_ZIP_ENTRIES || count === 0xffff || directorySize === 0xffffffff || cursor === 0xffffffff) reject("ZIP_LIMIT");
  if (cursor + directorySize !== end || view.readUInt16LE(end + 8) !== count) reject("INVALID_ZIP");
  const start = cursor;
  const entries = new Map<string, ZipEntry>();
  let total = 0;
  for (let index = 0; index < count; index += 1) {
    if (cursor + 46 > end || view.readUInt32LE(cursor) !== 0x02014b50) reject("INVALID_ZIP");
    const flags = view.readUInt16LE(cursor + 8);
    const compression = view.readUInt16LE(cursor + 10);
    const compressedSize = view.readUInt32LE(cursor + 20);
    const originalSize = view.readUInt32LE(cursor + 24);
    const nameLength = view.readUInt16LE(cursor + 28);
    const extraLength = view.readUInt16LE(cursor + 30);
    const commentLength = view.readUInt16LE(cursor + 32);
    const diskStart = view.readUInt16LE(cursor + 34);
    const localOffset = view.readUInt32LE(cursor + 42);
    const next = cursor + 46 + nameLength + extraLength + commentLength;
    if (next > end || diskStart !== 0 || localOffset + 30 > start || (flags & (1 | 64 | 8192)) !== 0 || ![0, 8].includes(compression)) reject("INVALID_ZIP");
    if (compressedSize === 0xffffffff || originalSize === 0xffffffff || localOffset === 0xffffffff) reject("ZIP_LIMIT");
    if ((compressedSize === 0 && originalSize !== 0) || (compression === 0 && compressedSize !== originalSize)) reject("INVALID_ZIP");
    if (view.readUInt32LE(localOffset) !== 0x04034b50 || view.readUInt16LE(localOffset + 6) !== flags || view.readUInt16LE(localOffset + 8) !== compression) reject("INVALID_ZIP");
    if (originalSize > MAX_ENTRY_BYTES || (compressedSize > 0 && originalSize / compressedSize > MAX_COMPRESSION_RATIO)) reject("ZIP_LIMIT");
    total += originalSize;
    if (total > MAX_TOTAL_UNCOMPRESSED_BYTES) reject("ZIP_LIMIT");
    const name = view.toString("utf8", cursor + 46, cursor + 46 + nameLength);
    safePartName(name);
    const key = name.toLowerCase();
    if (entries.has(key)) reject("INVALID_ZIP");
    entries.set(key, { name, compressedSize, originalSize });
    cursor = next;
  }
  if (cursor !== start + directorySize) reject("INVALID_ZIP");
  return entries;
}

function extractParts(bytes: Uint8Array, directory: Map<string, ZipEntry>): Map<string, string> {
  let extracted: Record<string, Uint8Array>;
  try {
    extracted = unzipSync(bytes, { filter: (info: UnzipFileInfo) => {
      const entry = directory.get(info.name.toLowerCase());
      if (!entry || info.name !== entry.name || info.size !== entry.compressedSize || info.originalSize !== entry.originalSize) reject("INVALID_ZIP");
      return /\.(?:xml|rels)$/iu.test(info.name);
    } });
  } catch (error) {
    if (error instanceof JuboXlsxReadError) throw error;
    reject("INVALID_ZIP");
  }
  const parts = new Map<string, string>();
  for (const [name, content] of Object.entries(extracted)) {
    if (content.byteLength > MAX_ENTRY_BYTES || content.byteLength !== directory.get(name.toLowerCase())?.originalSize) reject("INVALID_ZIP");
    try {
      const xml = XML_DECODER.decode(content);
      if (/<!\s*(?:DOCTYPE|ENTITY)/iu.test(xml)) reject("INVALID_XML");
      parts.set(name, xml);
    } catch (error) {
      if (error instanceof JuboXlsxReadError) throw error;
      reject("INVALID_XML");
    }
  }
  return parts;
}

function requiredPart(parts: Map<string, string>, name: string) {
  const part = parts.get(name);
  if (!part) reject("INVALID_WORKBOOK");
  return part;
}

function safeXml(xml: string) {
  if (/<!\s*(?:DOCTYPE|ENTITY)/iu.test(xml)) reject("INVALID_XML");
  return load(xml, { xmlMode: true });
}

function checkWorkbookParts(parts: Map<string, string>) {
  const types = safeXml(requiredPart(parts, "[Content_Types].xml"));
  const workbookType = types("Override").toArray().some((element) =>
    types(element).attr("PartName") === "/xl/workbook.xml" &&
    types(element).attr("ContentType") === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml");
  if (!workbookType) reject("INVALID_WORKBOOK");
  for (const [name, xml] of parts) {
    if (name.endsWith(".rels")) {
      const relations = safeXml(xml);
      if (relations("Relationship").toArray().some((element) => {
        const attributes = Object.fromEntries(Object.entries(element.attribs).map(([key, value]) => [key.toLowerCase(), value]));
        const target = attributes.target ?? "";
        const type = attributes.type ?? "";
        return attributes.targetmode === "external" || /(?:externalLink|hyperlink)/iu.test(type) || /^(?:[a-z][a-z\d+.-]*:|\/\/)/iu.test(target);
      })) reject("EXTERNAL_LINK");
    }
    if (/^xl\/worksheets\/sheet\d+\.xml$/u.test(name)) {
      const sheet = safeXml(xml);
      if (sheet("f, externalReferences, oleObjects, webPublishItems, ddeLink").length) reject("FORMULA");
      if (sheet("*").toArray().some((element) => /^(?:f|externalreferences|oleobjects|webpublishitems|ddelink)$/u.test(((element as { name?: string }).name?.split(":").at(-1) ?? "").toLowerCase()))) reject("FORMULA");
    }
  }
  const workbook = safeXml(requiredPart(parts, "xl/workbook.xml"));
  // Writers may emit an empty <definedNames/> container. Reject actual named
  // expressions, not the harmless empty container.
  if (workbook("*").toArray().some((element) => /^(?:externalreferences|definedname)$/u.test(((element as { name?: string }).name?.split(":").at(-1) ?? "").toLowerCase()))) reject("EXTERNAL_LINK");
  return workbook;
}

function selectedSheet(parts: Map<string, string>, workbook: ReturnType<typeof safeXml>, kind: JuboWorkbookKind) {
  const expectedName = kind === "master" ? "個案檔案總表＿自訂表單欄位" : "日照個案總表_202610";
  const sheets = workbook("sheets > sheet").toArray();
  if (sheets.length !== 1 || workbook(sheets[0]).attr("name") !== expectedName) reject("INVALID_SHEET");
  const relationId = workbook(sheets[0]).attr("r:id");
  if (!relationId) reject("INVALID_WORKBOOK");
  const relations = safeXml(requiredPart(parts, "xl/_rels/workbook.xml.rels"));
  const matches = relations("Relationship").toArray().filter((element) => relations(element).attr("Id") === relationId);
  if (matches.length !== 1) reject("INVALID_WORKBOOK");
  const target = relations(matches[0]).attr("Target");
  if (!target || /^(?:[a-z][a-z\d+.-]*:|\/\/)/iu.test(target)) reject("EXTERNAL_LINK");
  const resolved = target.startsWith("/") ? target.slice(1) : path.posix.normalize(path.posix.join("xl", target));
  if (!/^xl\/worksheets\/sheet\d+\.xml$/u.test(resolved)) reject("INVALID_SHEET");
  return { sheetName: expectedName, xml: requiredPart(parts, resolved), date1904: workbook("workbookPr").attr("date1904") === "1" };
}

function sharedStrings(parts: Map<string, string>) {
  const xml = parts.get("xl/sharedStrings.xml");
  if (!xml) return [];
  const strings = safeXml(xml);
  return strings("sst > si").toArray().map((item) => strings(item).find("t").toArray().map((text) => strings(text).text()).join(""));
}

function dateStyles(parts: Map<string, string>) {
  const xml = parts.get("xl/styles.xml");
  if (!xml) return new Set<number>();
  const styles = safeXml(xml);
  const formats = new Map<number, string>();
  styles("numFmts > numFmt").each((_, item) => {
    const id = Number(styles(item).attr("numFmtId"));
    const format = styles(item).attr("formatCode");
    if (Number.isInteger(id) && format) formats.set(id, format);
  });
  const result = new Set<number>();
  styles("cellXfs > xf").each((index, item) => {
    const id = Number(styles(item).attr("numFmtId"));
    const format = formats.get(id)?.replace(/"[^"]*"|\\./gu, "").toLowerCase();
    if ([14, 15, 16, 17].includes(id) || (format && /y/u.test(format) && /m/u.test(format) && /d/u.test(format) && !/[hs]/u.test(format))) result.add(index);
  });
  return result;
}

function excelDate(serial: number, date1904: boolean) {
  if (!Number.isInteger(serial) || serial < (date1904 ? 0 : 1) || serial > 2_958_465 || (!date1904 && serial === 60)) reject("INVALID_DATE");
  const origin = date1904 ? Date.UTC(1904, 0, 1) : Date.UTC(1899, 11, serial < 60 ? 31 : 30);
  const date = new Date(origin + serial * 86_400_000);
  const result = date.toISOString().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(result)) reject("INVALID_DATE");
  return result;
}

function columnIndex(reference: string) {
  const match = /^([A-Z]{1,3})([1-9]\d*)$/u.exec(reference);
  if (!match) reject("INVALID_CELL");
  let index = 0;
  for (const character of match[1]) index = index * 26 + character.charCodeAt(0) - 64;
  return { column: index - 1, row: Number(match[2]) };
}

function cellValue(cell: ReturnType<ReturnType<typeof safeXml>>, shared: readonly string[], styles: Set<number>, date1904: boolean): { value: unknown; raw: unknown } {
  const type = cell.attr("t") ?? "n";
  const valueText = cell.children("v").text();
  if (cell.find("f").length) reject("FORMULA");
  if (type === "inlineStr") { const value = cell.children("is").find("t").text(); return { value, raw: value }; }
  if (type === "s") {
    const index = Number(valueText);
    if (!Number.isInteger(index) || index < 0 || index >= shared.length) reject("INVALID_CELL");
    return { value: shared[index], raw: shared[index] };
  }
  if (type === "str") return { value: valueText, raw: valueText };
  if (type === "b") {
    if (valueText !== "0" && valueText !== "1") reject("INVALID_CELL");
    return { value: valueText === "1", raw: valueText === "1" };
  }
  if (type === "d") {
    if (!/^\d{4}-\d{2}-\d{2}$/u.test(valueText)) reject("INVALID_DATE");
    return { value: valueText, raw: valueText };
  }
  if (type !== "n" || !valueText) {
    if (type === "n" && !valueText) return { value: null, raw: null };
    reject("INVALID_CELL");
  }
  const number = Number(valueText);
  if (!Number.isFinite(number)) reject("INVALID_CELL");
  const style = cell.attr("s");
  if (style !== undefined && (!/^\d+$/u.test(style) || Number(style) > 10_000)) reject("INVALID_CELL");
  if (style !== undefined && styles.has(Number(style))) return { value: excelDate(number, date1904), raw: number };
  return { value: number, raw: number };
}

function parseSheet(sheetName: string, xml: string, kind: JuboWorkbookKind, shared: readonly string[], styles: Set<number>, date1904: boolean): JuboSheet {
  const headerRow = kind === "master" ? 5 : 4;
  const firstDataRow = headerRow + 1;
  const width = kind === "master" ? 95 : 191;
  const document = safeXml(xml);
  if (document("worksheet > sheetData").length !== 1) reject("INVALID_SHEET");
  const rows = new Map<number, unknown[]>();
  const rawRows = new Map<number, unknown[]>();
  const cellTypes = new Map<number, (string | null)[]>();
  const seen = new Set<string>();
  let lastIdentityRow = firstDataRow - 1;
  const identityColumn = kind === "master" ? 25 : 29;
  document("sheetData c").each((_, element) => {
    const cell = document(element);
    const reference = cell.attr("r") ?? "";
    const { column, row } = columnIndex(reference);
    if (row > MAX_ROWS || seen.has(reference)) reject("INVALID_CELL");
    seen.add(reference);
    const parsed = cellValue(cell, shared, styles, date1904);
    if (column >= width && parsed.value !== null && parsed.value !== "") reject("INVALID_SHEET");
    if (column >= width || row < headerRow) return;
    const normalizedRow = rows.get(row) ?? Array(width).fill(null);
    const sourceRow = rawRows.get(row) ?? Array(width).fill(null);
    const sourceTypes = cellTypes.get(row) ?? Array(width).fill(null);
    normalizedRow[column] = parsed.value;
    sourceRow[column] = parsed.raw;
    sourceTypes[column] = cell.attr("t") ?? "n";
    rows.set(row, normalizedRow);
    rawRows.set(row, sourceRow);
    cellTypes.set(row, sourceTypes);
    if (row >= firstDataRow && column === identityColumn && parsed.value !== null && parsed.value !== "") lastIdentityRow = Math.max(lastIdentityRow, row);
  });
  const header = rows.get(headerRow);
  if (!header || header.some((value) => value !== null && typeof value !== "string")) reject("INVALID_SHEET");
  if (lastIdentityRow < firstDataRow) reject("INVALID_SHEET");
  for (let row = firstDataRow; row <= lastIdentityRow; row += 1) {
    const identity = rows.get(row)?.[identityColumn];
    if (identity === null || identity === undefined || identity === "") reject("INVALID_SHEET");
  }
  const nonRecordRows = [...rawRows.keys()].filter((row) => row > lastIdentityRow && rows.get(row)?.some((value) => value !== null && value !== "")).sort((a, b) => a - b).map((row) => {
    const normalizedValues = rows.get(row) ?? Array(width).fill(null);
    const rawValues = rawRows.get(row) ?? Array(width).fill(null);
    const rawCellTypes = cellTypes.get(row) ?? Array(width).fill(null);
    // The reviewed master export has one sparse A-column footer. Do not
    // silently classify another client-like row as an ignorable footer.
    if (kind !== "master" || normalizedValues.some((value, index) => index !== 0 && value !== null && value !== "")) reject("INVALID_SHEET");
    return { sheetRow: row, normalizedValues, rawValues, rawCellTypes };
  });
  if (nonRecordRows.length > 1) reject("INVALID_SHEET");
  return {
    sheetName,
    headers: header.map((value) => value ?? "") as string[],
    rows: Array.from({ length: lastIdentityRow - firstDataRow + 1 }, (_, index) => rows.get(firstDataRow + index) ?? Array(width).fill(null)),
    rawRows: Array.from({ length: lastIdentityRow - firstDataRow + 1 }, (_, index) => rawRows.get(firstDataRow + index) ?? Array(width).fill(null)),
    rawCellTypes: Array.from({ length: lastIdentityRow - firstDataRow + 1 }, (_, index) => cellTypes.get(firstDataRow + index) ?? Array(width).fill(null)),
    nonRecordRows,
  };
}

/**
 * Parses a workbook whose hash was supplied by a trusted server-side manifest.
 * It is NOT an import approval function; use readApprovedJuboXlsx for the formal
 * October 2026 migration and never trust a browser-supplied expected hash.
 */
export function parseHashVerifiedJuboXlsx(input: JuboXlsxInput & { readonly trustedExpectedSha256: string }): JuboXlsxReadResult {
  validateEnvelope(input);
  if (!/^[a-f0-9]{64}$/u.test(input.trustedExpectedSha256)) reject("UNAPPROVED_SOURCE");
  const sha256 = createHash("sha256").update(input.bytes).digest("hex");
  if (sha256 !== input.trustedExpectedSha256) reject("HASH_MISMATCH");
  const directory = inspectZipDirectory(input.bytes);
  let parts: Map<string, string>;
  try { parts = extractParts(input.bytes, directory); }
  catch (error) { if (error instanceof JuboXlsxReadError) throw error; reject("INVALID_ZIP"); }
  const workbook = checkWorkbookParts(parts);
  const selected = selectedSheet(parts, workbook, input.kind);
  const sheet = parseSheet(selected.sheetName, selected.xml, input.kind, sharedStrings(parts), dateStyles(parts), selected.date1904);
  return { sha256, sheet };
}

/** Formal path: accepts exactly the reviewed source file hash for each kind. */
export function readApprovedJuboXlsx(input: JuboXlsxInput): JuboXlsxReadResult {
  return parseHashVerifiedJuboXlsx({ ...input, trustedExpectedSha256: APPROVED_JUBO_SOURCE_SHA256[input.kind] });
}
