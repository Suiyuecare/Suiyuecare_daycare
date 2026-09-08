import { createHash } from "node:crypto";

import { ImportError, assertImport } from "./errors";
import type { HtmlImportFile, ValidatedHtmlImport } from "./types";
import { MAX_HTML_IMPORT_BYTES } from "./types";

const ALLOWED_MIME_TYPES = new Set(["text/html", "application/xhtml+xml"]);
const HTML_FILE_NAME = /\.html?$/iu;
const HTML_SIGNATURE = /<(?:!doctype\s+html|html|head|body)(?:\s|>)/iu;
const META_CHARSET =
  /<meta\b[^>]*(?:charset\s*=\s*["']?\s*([\w-]+)|content\s*=\s*["'][^"']*charset\s*=\s*([\w-]+))/iu;
const XML_CHARSET = /<\?xml\b[^>]*encoding\s*=\s*["']\s*([\w-]+)/iu;

function sha256(value: Uint8Array | string) {
  return createHash("sha256").update(value).digest("hex");
}

function detectDeclaredCharset(textPrefix: string) {
  const match = META_CHARSET.exec(textPrefix);
  const xmlMatch = XML_CHARSET.exec(textPrefix);
  return (match?.[1] ?? match?.[2] ?? xmlMatch?.[1] ?? "utf-8").toLowerCase();
}

export function validateHtmlImportFile(
  file: HtmlImportFile,
): ValidatedHtmlImport {
  assertImport(
    file.fileName.length > 0 &&
      file.fileName.length <= 255 &&
      !/[\\/\u0000-\u001F\u007F]/u.test(file.fileName),
    "INVALID_FILE_NAME",
    "檔名格式不符合安全規則。",
    400,
    "file",
  );
  assertImport(
    HTML_FILE_NAME.test(file.fileName),
    "INVALID_FILE_EXTENSION",
    "只接受 .html 或 .htm 檔案。",
    415,
    "file",
  );

  const normalizedMime = file.mimeType.split(";", 1)[0]?.trim().toLowerCase();
  assertImport(
    normalizedMime && ALLOWED_MIME_TYPES.has(normalizedMime),
    "INVALID_MIME_TYPE",
    "檔案內容類型必須是 HTML。",
    415,
    "file",
  );

  assertImport(
    file.bytes.byteLength > 0,
    "EMPTY_FILE",
    "上傳的 HTML 檔案是空的。",
    422,
    "file",
  );
  assertImport(
    file.bytes.byteLength <= MAX_HTML_IMPORT_BYTES,
    "FILE_TOO_LARGE",
    "HTML 檔案不得超過 25MB。",
    413,
    "file",
  );

  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(file.bytes);
  } catch {
    throw new ImportError(
      "INVALID_ENCODING",
      "HTML 必須使用有效的 UTF-8 編碼。",
      415,
      "file",
    );
  }

  assertImport(
    !text.includes("\u0000"),
    "INVALID_ENCODING",
    "HTML 含有不允許的空字元。",
    415,
    "file",
  );

  const declaredCharset = detectDeclaredCharset(text.slice(0, 8192));
  assertImport(
    declaredCharset === "utf-8" || declaredCharset === "utf8",
    "UNSUPPORTED_ENCODING",
    `不支援的 HTML 編碼：${declaredCharset}。請轉為 UTF-8。`,
    415,
    "file",
  );

  assertImport(
    HTML_SIGNATURE.test(text.slice(0, 65_536)),
    "INVALID_HTML_SIGNATURE",
    "檔案內容不是可辨識的 HTML 文件。",
    422,
    "file",
  );

  return {
    ...file,
    mimeType: normalizedMime,
    charset: "utf-8",
    text: text.replace(/^\uFEFF/u, ""),
    sha256: sha256(file.bytes),
  };
}

export function hashCanonicalImport(value: string) {
  return sha256(value.normalize("NFKC"));
}
