import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { PDFDocument } from "pdf-lib";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { documentRenderModelHash } from "./hash";
import { parseDocumentRenderModel } from "./parser";
import { renderDocumentPdf } from "./pdf-renderer";

const PAGE_WIDTH_FOR_TEST = 595.28;
const PAGE_HEIGHT_FOR_TEST = 841.89;

const fontFixturePath = path.join(
  process.cwd(),
  "tests/fixtures/fonts/NotoSansTC-TestSubset.ttf.base64",
);

async function fixtureFont() {
  if (process.env.DOCUMENT_PDF_FONT_PATH) {
    return new Uint8Array(await readFile(process.env.DOCUMENT_PDF_FONT_PATH));
  }
  return new Uint8Array(Buffer.from(
    (await readFile(fontFixturePath, "utf8")).trim(),
    "base64",
  ));
}

const model = {
  schemaVersion: 1,
  locale: "zh-TW",
  timezone: "Asia/Taipei",
  template: {
    versionId: "11111111-1111-4111-8111-111111111111",
    templateKey: "demo-care-summary",
    version: 1,
    title: "合成照顧摘要",
    contentHash: "a".repeat(64),
  },
  organization: {
    organizationId: "22222222-2222-4222-8222-222222222222",
    organizationName: "合成日照中心",
    branchId: "33333333-3333-4333-8333-333333333333",
    branchName: "合成分支",
  },
  client: {
    clientId: "44444444-4444-4444-8444-444444444444",
    displayName: "示範個案",
    clientCode: "DEMO-001",
  },
  documentDate: "2026-09-02",
  generatedAt: "2026-09-02T08:00:00.000Z",
  title: "個案照顧摘要",
  watermark: "合成測試資料",
  sections: [
    {
      heading: "基本資料",
      rows: [
        { label: "服務狀態", value: "使用中", state: "recorded" },
        { label: "未提供欄位", value: null, state: "missing" },
        { label: "不適用欄位", value: null, state: "not_applicable" },
      ],
    },
    {
      heading: "照顧摘要",
      rows: Array.from({ length: 32 }, (_, index) => ({
        label: `紀錄 ${index + 1}`,
        value: "這是用來驗證中文字型、換行、分頁、表格邊界與頁尾的合成內容。".repeat(2),
        state: "recorded",
      })),
    },
  ],
  footerNote: "此文件由不可變資料快照產生；合成測試資料不得作為正式照顧紀錄。",
} as const;

describe("governed document PDF renderer", () => {
  it("strictly validates and hashes the immutable render model", () => {
    expect(parseDocumentRenderModel(model)).toEqual(model);
    expect(documentRenderModelHash(model)).toMatch(/^[a-f0-9]{64}$/u);
    expect(() => parseDocumentRenderModel({ ...model, timezone: "UTC" }))
      .toThrow("INVALID_DOCUMENT_RENDER_MODEL");
    expect(() => parseDocumentRenderModel({
      ...model,
      sections: [{ heading: "錯誤", rows: [
        { label: "缺值", value: "不可夾帶", state: "missing" },
      ] }],
    })).toThrow("INVALID_DOCUMENT_RENDER_MODEL");
  });

  it("produces a reopenable multi-page PDF with one governed model", async () => {
    const bytes = await renderDocumentPdf({ model, fontBytes: await fixtureFont() });
    expect(bytes.subarray(0, 5)).toEqual(new TextEncoder().encode("%PDF-"));
    const reopened = await PDFDocument.load(bytes);
    expect(reopened.getPageCount()).toBeGreaterThan(1);
    expect(reopened.getTitle()).toBe(model.title);
    expect(reopened.getAuthor()).toBe(model.organization.organizationName);
    if (process.env.DOCUMENT_PDF_SAMPLE_OUTPUT) {
      const output = path.resolve(process.env.DOCUMENT_PDF_SAMPLE_OUTPUT);
      await mkdir(path.dirname(output), { recursive: true });
      await writeFile(output, bytes);
    }
  });

  it("rejects a font that cannot render every frozen glyph", async () => {
    const fontBytes = new Uint8Array(await readFile(path.join(
      process.cwd(),
      "node_modules/next/dist/compiled/@vercel/og/Geist-Regular.ttf",
    )));
    await expect(renderDocumentPdf({ model, fontBytes }))
      .rejects.toThrow("DOCUMENT_FONT_GLYPH_MISSING");
  });

  it("paginates one long value and a wrapped footer without clipping a row", async () => {
    const bytes = await renderDocumentPdf({
      model: {
        ...model,
        footerNote: "此文件由不可變資料快照產生".repeat(25),
        sections: [{ heading: "照顧摘要", rows: [{
          label: "紀錄",
          value: "這".repeat(5_000),
          state: "recorded",
        }] }],
      },
      fontBytes: await fixtureFont(),
    });
    const reopened = await PDFDocument.load(bytes);
    expect(reopened.getPageCount()).toBeGreaterThan(2);
    for (const page of reopened.getPages()) {
      expect(page.getWidth()).toBeCloseTo(PAGE_WIDTH_FOR_TEST, 1);
      expect(page.getHeight()).toBeCloseTo(PAGE_HEIGHT_FOR_TEST, 1);
    }
  });

  it("fails closed when a configured font asset is not usable", async () => {
    await expect(renderDocumentPdf({
      model,
      fontBytes: new Uint8Array([1, 2, 3]),
    })).rejects.toThrow("DOCUMENT_FONT_ASSET_INVALID");
  });
});
