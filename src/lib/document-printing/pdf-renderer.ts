import fontkit from "@pdf-lib/fontkit";
import {
  degrees,
  PDFDocument,
  rgb,
  type PDFFont,
  type PDFPage,
} from "pdf-lib";

import { parseDocumentRenderModel } from "./parser";
import type { DocumentRenderModel, DocumentRenderRow } from "./types";

const PAGE_WIDTH = 595.28;
const PAGE_HEIGHT = 841.89;
const MARGIN_X = 48;
const TOP = 52;
const MIN_CONTENT_BOTTOM = 48;
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN_X * 2;

function linesFor(text: string, font: PDFFont, size: number, width: number) {
  const source = text.replace(/\r\n?/gu, "\n");
  const lines: string[] = [];
  for (const paragraph of source.split("\n")) {
    if (!paragraph) {
      lines.push("");
      continue;
    }
    let current = "";
    for (const character of Array.from(paragraph)) {
      const candidate = current + character;
      if (current && font.widthOfTextAtSize(candidate, size) > width) {
        lines.push(current);
        current = character;
      } else {
        current = candidate;
      }
    }
    lines.push(current);
  }
  return lines;
}

function stateValue(row: DocumentRenderRow) {
  if (row.state === "missing") return "未提供";
  if (row.state === "not_applicable") return "不適用";
  return row.value ?? "";
}

function assertFontCoverage(model: DocumentRenderModel, fontBytes: Uint8Array, features?: Record<string, boolean>) {
  let sourceFont: ReturnType<typeof fontkit.create>;
  try {
    sourceFont = fontkit.create(fontBytes);
  } catch {
    throw new Error("DOCUMENT_FONT_ASSET_UNSUPPORTED");
  }
  const text = [
    model.title,
    model.watermark,
    model.footerNote,
    model.organization.organizationName,
    model.organization.branchName,
    model.client.displayName,
    model.client.clientCode ?? "",
    model.documentDate,
    ...model.sections.flatMap((section) => [
      section.heading,
      ...section.rows.flatMap((row) => [row.label, stateValue(row)]),
    ]),
    "個案：文件日期：未提供不適用／（）",
  ].join("");
  const unsupported = Array.from(new Set(Array.from(text)
    .map((character) => character.codePointAt(0)!)
    .filter((codePoint) => !/\s/u.test(String.fromCodePoint(codePoint)) &&
      !sourceFont.hasGlyphForCodePoint(codePoint))));
  if (unsupported.length > 0) {
    throw new Error(`DOCUMENT_FONT_GLYPH_MISSING:${unsupported.slice(0, 12)
      .map((codePoint) => `U+${codePoint.toString(16).toUpperCase()}`)
      .join(",")}`);
  }
  if (features) {
    // pdf-lib's complete-font width map is derived from the font character set.
    // A shaping-only glyph outside that map receives a default PDF width, which
    // can make a line overflow despite passing widthOfTextAtSize during layout.
    const widthMapped = new Set(sourceFont.characterSet.map(code => sourceFont.glyphForCodePoint(code).id));
    if (sourceFont.layout(text.replace(/\s/gu, " "), { ...features }).glyphs.some(glyph => !widthMapped.has(glyph.id))) {
      throw new Error("DOCUMENT_FONT_SHAPING_WIDTH_UNMAPPED");
    }
  }
}

function addWatermark(page: PDFPage, font: PDFFont, text: string) {
  const naturalWidth = font.widthOfTextAtSize(text, 44);
  const size = naturalWidth > CONTENT_WIDTH * 0.82
    ? Math.max(12, 44 * CONTENT_WIDTH * 0.82 / naturalWidth)
    : 44;
  const width = font.widthOfTextAtSize(text, size);
  page.drawText(text, {
    x: (PAGE_WIDTH - width) / 2,
    y: PAGE_HEIGHT / 2 - 20,
    size,
    font,
    color: rgb(0.84, 0.87, 0.88),
    opacity: 0.22,
    rotate: degrees(32),
  });
}

function footerLayout(font: PDFFont, note: string) {
  const lines = linesFor(note, font, 7.5, CONTENT_WIDTH - 45);
  const textTop = 18 + Math.max(0, lines.length - 1) * 9;
  const ruleY = textTop + 13;
  return {
    contentBottom: Math.max(MIN_CONTENT_BOTTOM, ruleY + 14),
    lines,
    ruleY,
    textTop,
  };
}

function drawFooter(
  page: PDFPage,
  font: PDFFont,
  layout: ReturnType<typeof footerLayout>,
  pageNumber: number,
) {
  page.drawLine({
    start: { x: MARGIN_X, y: layout.ruleY },
    end: { x: PAGE_WIDTH - MARGIN_X, y: layout.ruleY },
    thickness: 0.5,
    color: rgb(0.75, 0.78, 0.8),
  });
  layout.lines.forEach((line, index) => page.drawText(line, {
    x: MARGIN_X,
    y: layout.textTop - index * 9,
    size: 7.5,
    font,
    color: rgb(0.35, 0.39, 0.42),
  }));
  page.drawText(String(pageNumber), {
    x: PAGE_WIDTH - MARGIN_X - 18,
    y: 18,
    size: 8,
    font,
    color: rgb(0.35, 0.39, 0.42),
  });
}

function drawHeader(page: PDFPage, font: PDFFont, model: DocumentRenderModel) {
  let y = PAGE_HEIGHT - TOP;
  for (const line of linesFor(model.title, font, 18, CONTENT_WIDTH)) {
    page.drawText(line, { x: MARGIN_X, y, size: 18, font,
      color: rgb(0.08, 0.2, 0.22) });
    y -= 22;
  }
  y -= 4;
  const organization = `${model.organization.organizationName}／${model.organization.branchName}`;
  for (const line of linesFor(organization, font, 10, CONTENT_WIDTH)) {
    page.drawText(line, { x: MARGIN_X, y, size: 10, font,
      color: rgb(0.2, 0.28, 0.3) });
    y -= 14;
  }
  const client = `個案：${model.client.displayName}${model.client.clientCode ? `（${model.client.clientCode}）` : ""}　文件日期：${model.documentDate}`;
  for (const line of linesFor(client, font, 10, CONTENT_WIDTH)) {
    page.drawText(line, { x: MARGIN_X, y, size: 10, font,
      color: rgb(0.2, 0.28, 0.3) });
    y -= 14;
  }
  y -= 4;
  page.drawLine({
    start: { x: MARGIN_X, y },
    end: { x: PAGE_WIDTH - MARGIN_X, y },
    thickness: 1,
    color: rgb(0.23, 0.55, 0.53),
  });
  return y - 18;
}

export async function renderDocumentPdf(input: {
  model: unknown;
  fontBytes: Uint8Array;
  /** Opt-in only after a governed font has passed visual CJK subset QA. */
  subsetFont?: boolean;
  /** Opt-in shaping profile for a pinned font with verified PDF glyph metrics. */
  fontFeatures?: Record<string, boolean>;
  /** Opt-in: keep a short table row together when it fits on a fresh page. */
  keepShortRowsTogether?: boolean;
}) {
  const model = parseDocumentRenderModel(input.model);
  if (input.fontBytes.byteLength < 1024) {
    throw new Error("DOCUMENT_FONT_ASSET_INVALID");
  }
  assertFontCoverage(model, input.fontBytes, input.fontFeatures);
  const document = await PDFDocument.create();
  document.registerFontkit(fontkit);
  const font = await document.embedFont(input.fontBytes, {
    // pdf-lib/fontkit subsetting can silently corrupt composite CJK glyph maps
    // for otherwise valid fonts. Approved assets therefore embed completely
    // until that exact font SHA has a separately verified subset profile.
    subset: input.subsetFont ?? false,
    features: input.fontFeatures ? { ...input.fontFeatures } : undefined,
  });
  const createdAt = new Date(model.generatedAt);
  document.setTitle(model.title);
  document.setAuthor(model.organization.organizationName);
  document.setSubject(model.template.title);
  document.setProducer("Daycare Management System governed document renderer");
  document.setCreator("Daycare Management System");
  document.setCreationDate(createdAt);
  document.setModificationDate(createdAt);
  const footer = footerLayout(font, model.footerNote);

  const pages: PDFPage[] = [];
  let page = document.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  pages.push(page);
  addWatermark(page, font, model.watermark);
  let y = drawHeader(page, font, model);

  const newPage = () => {
    page = document.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
    pages.push(page);
    addWatermark(page, font, model.watermark);
    y = PAGE_HEIGHT - TOP;
    for (const line of linesFor(model.title, font, 12, CONTENT_WIDTH)) {
      page.drawText(line, { x: MARGIN_X, y, size: 12, font,
        color: rgb(0.08, 0.2, 0.22) });
      y -= 16;
    }
    y -= 8;
  };

  for (const section of model.sections) {
    if (y < footer.contentBottom + 55) newPage();
    page.drawRectangle({
      x: MARGIN_X,
      y: y - 5,
      width: CONTENT_WIDTH,
      height: 22,
      color: rgb(0.91, 0.96, 0.95),
    });
    page.drawText(section.heading, {
      x: MARGIN_X + 8,
      y,
      size: 11,
      font,
      color: rgb(0.08, 0.28, 0.28),
    });
    y -= 28;

    for (const row of section.rows) {
      const labelLines = linesFor(row.label, font, 9, 128);
      const valueLines = linesFor(stateValue(row), font, 9, CONTENT_WIDTH - 158);
      const wholeRowHeight = Math.max(24, Math.max(labelLines.length, valueLines.length) * 13 + 10);
      if (input.keepShortRowsTogether && wholeRowHeight <= PAGE_HEIGHT - TOP - 48 - footer.contentBottom && y - wholeRowHeight < footer.contentBottom) newPage();
      let labelOffset = 0;
      let valueOffset = 0;
      let continuation = false;
      while (labelOffset < labelLines.length || valueOffset < valueLines.length) {
        const availableLines = Math.floor(
          (y - footer.contentBottom - 10) / 13,
        );
        if (availableLines < 1) {
          newPage();
          continue;
        }
        const remaining = Math.max(
          labelLines.length - labelOffset,
          valueLines.length - valueOffset,
        );
        const take = Math.min(availableLines, remaining);
        let labelChunk = labelLines.slice(labelOffset, labelOffset + take);
        const valueChunk = valueLines.slice(valueOffset, valueOffset + take);
        if (continuation && labelChunk.length === 0) {
          labelChunk = labelLines.slice(0, Math.min(labelLines.length, take));
        }
        const lineCount = Math.max(labelChunk.length, valueChunk.length, 1);
        const height = Math.max(24, lineCount * 13 + 10);
        page.drawRectangle({
          x: MARGIN_X,
          y: y - height + 7,
          width: CONTENT_WIDTH,
          height,
          borderWidth: 0.5,
          borderColor: rgb(0.78, 0.81, 0.82),
          color: rgb(1, 1, 1),
        });
        page.drawLine({
          start: { x: MARGIN_X + 145, y: y + 7 },
          end: { x: MARGIN_X + 145, y: y - height + 7 },
          thickness: 0.5,
          color: rgb(0.78, 0.81, 0.82),
        });
        labelChunk.forEach((line, index) => page.drawText(line, {
          x: MARGIN_X + 7,
          y: y - 12 - index * 13,
          size: 9,
          font,
          color: rgb(0.16, 0.2, 0.22),
        }));
        valueChunk.forEach((line, index) => page.drawText(line, {
          x: MARGIN_X + 153,
          y: y - 12 - index * 13,
          size: 9,
          font,
          color: row.state === "recorded"
            ? rgb(0.1, 0.14, 0.15) : rgb(0.42, 0.46, 0.48),
        }));
        labelOffset += Math.min(take, labelLines.length - labelOffset);
        valueOffset += Math.min(take, valueLines.length - valueOffset);
        continuation = true;
        y -= height;
      }
    }
    y -= 12;
  }

  pages.forEach((item, index) =>
    drawFooter(item, font, footer, index + 1));
  return document.save({
    useObjectStreams: false,
    addDefaultPage: false,
    objectsPerTick: 50,
  });
}
