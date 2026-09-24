import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { PDFDocument } from "pdf-lib";
import { describe, expect, it } from "vitest";

import { parseDocumentRenderModel } from "@/lib/document-printing/parser";
import { renderDocumentPdf } from "@/lib/document-printing/pdf-renderer";
import { TAIPEI_PDF_FONT_FEATURES } from "@/lib/taipei-abcd/pdf-font";
import type { ResponseRecord } from "./contract";
import type { CustomResponsePrintJob } from "./print-contract";
import { customResponsePrintModel } from "./print-model";

const id = (n: number) => `cf110000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const now = "2026-09-22T17:30:00.000Z";

function syntheticJob(): CustomResponsePrintJob {
  const response: ResponseRecord = {
    id: id(1), recordKey: id(2), revision: 1, previousId: null, correctionSourceId: null,
    clientId: id(3), formVersionId: id(4), serviceDate: "2026-09-22", status: "draft",
    schema: { builder: "tenant-custom.v1", fields: [
      { key: "note", label: "本次服務重點", type: "text", required: true, maxLength: 4000 },
      { key: "count", label: "參與次數", type: "number", required: true, minimum: 0, maximum: 10 },
      { key: "confirmed", label: "是否完成交班", type: "boolean", required: true },
      { key: "follow_up", label: "下次確認日期", type: "date", required: false },
      { key: "mode", label: "聯絡方式", type: "select", required: false, options: ["電話", "當面"] },
    ] },
    // Insertion order intentionally differs from schema order.
    answers: {
      mode: { state: "not_applicable", reason: "本次為合成資料測試，沒有聯絡真人。" },
      confirmed: { state: "answered", value: false }, count: { state: "answered", value: 0 },
      note: { state: "answered", value: "合成紀錄：確認今日安排及交班事項。" },
      follow_up: { state: "missing" },
    },
    reason: null, signatureEvidence: null, contentHash: "a".repeat(64), actorId: id(5),
    createdAt: "2026-09-22T08:00:00.000Z",
  };
  return {
    jobId: id(6), responseId: response.id, clientId: response.clientId, actorId: id(7),
    organizationId: id(8), branchId: id(9), createdAt: now, expiresAt: "2026-09-22T17:35:00.000Z",
    snapshotHash: "b".repeat(64), replayed: false,
    snapshot: { response, organizationName: "合成歲悅日照機構（非真實資料）", branchName: "合成分支",
      clientCode: "SYNTHETIC-001", clientName: "合成個案", formName: "合成服務確認表", formKey: "tenant.custom.synthetic_service",
      formVersion: 3, preparedByName: "合成製表人" },
  };
}

function signedJob(): CustomResponsePrintJob {
  const job = syntheticJob();
  const response = job.snapshot.response;
  response.revision = 2;
  response.previousId = id(10);
  response.status = "signed";
  response.signatureEvidence = {
    signerId: response.actorId, signedAt: response.createdAt, challengeId: id(11),
    roles: ["nurse", "機構自訂歷史角色"], aal: "aal2", purpose: "本人確認此機構自訂表單填答",
  };
  return job;
}

function longJob(): CustomResponsePrintJob {
  const job = syntheticJob();
  const response = job.snapshot.response;
  response.answers.note = { state: "answered", value: "合成長文字：逐項確認當日服務安排、照顧紀錄與交班事項；只使用保存版本，不將缺值視為零。".repeat(70) };
  response.answers.mode = { state: "not_applicable", reason: "合成原因：本次情境不適用此題，保留原因供後續核對。".repeat(10) };
  for (let n = 6; n <= 40; n += 1) {
    const key = `field_${n}`;
    response.schema.fields.push({ key, label: `合成題目 ${n}：服務執行與交班事項確認`, type: "text", required: false, maxLength: 4000 });
    response.answers[key] = { state: "answered", value: `合成填答 ${n}：此段驗證繁體中文字型、欄位順序、長句換行、分頁及頁尾。保存時的紀錄不得因為表單改版而重新計分或改寫。` };
  }
  return job;
}

describe("custom response frozen print model", () => {
  it("uses saved schema order and preserves false, zero, missing, and NA reason distinctly", () => {
    const source = syntheticJob();
    const before = structuredClone(source);
    const model = customResponsePrintModel(source);
    expect(parseDocumentRenderModel(model)).toEqual(model);
    expect(model.sections[1].rows.map((row) => row.label)).toEqual([
      "1. 本次服務重點（必填）", "2. 參與次數（必填）", "3. 是否完成交班（必填）", "4. 下次確認日期", "5. 聯絡方式",
    ]);
    expect(model.sections[1].rows.map((row) => row.value)).toEqual([
      "合成紀錄：確認今日安排及交班事項。", "0", "否", "未填／待補", "不適用；原因：本次為合成資料測試，沒有聯絡真人。",
    ]);
    expect(source).toEqual(before);
    expect(model.watermark).toBe("草稿・未簽署");
    expect(model.sections[2].rows[0].value).toContain("尚未簽署");
  });

  it("keeps omitted answer missing, never turns it into an empty value or false", () => {
    const source = syntheticJob();
    delete source.snapshot.response.answers.follow_up;
    expect(customResponsePrintModel(source).sections[1].rows[3].value).toBe("未填／待補");
  });

  it("uses immutable version/IDs/hash and Taipei time, independent of current time", () => {
    const source = syntheticJob();
    const model = customResponsePrintModel(source);
    const rows = model.sections.flatMap((section) => section.rows);
    expect(model.generatedAt).toBe(now);
    expect(model.documentDate).toBe("2026-09-22");
    expect(model.template.version).toBe(3);
    expect(rows.find((row) => row.label === "表單代碼")?.value).toBe(source.snapshot.formKey);
    expect(rows.find((row) => row.label === "紀錄版本與狀態")?.value).toBe("第 1 版；草稿／尚未簽署");
    expect(rows.find((row) => row.label === "快照建立時間")?.value).toBe("2026-09-23 01:30:00（臺北時間）");
    expect(rows.find((row) => row.label === "紀錄內容 SHA-256")?.value).toBe("a".repeat(64));
    expect(rows.find((row) => row.label === "列印快照 SHA-256")?.value).toBe("b".repeat(64));
    expect(rows.find((row) => row.label === "列印快照 ID")?.value).toBe(source.jobId);
    expect(model.sections[0].rows[0].value).toContain("未重新計分");
  });

  it("displays saved signature evidence without asserting a certificate-based PDF signature", () => {
    const source = signedJob();
    const model = customResponsePrintModel(source);
    const rows = model.sections[2].rows;
    expect(model.watermark).toBe("已簽署紀錄副本");
    expect(rows.find((row) => row.label === "簽署人 ID")?.value).toBe(source.snapshot.response.actorId);
    expect(rows.find((row) => row.label === "簽署時角色")?.value).toBe("護理人員、機構自訂歷史角色");
    expect(rows.find((row) => row.label === "簽署時間")?.value).toBe("2026-09-22 16:00:00（臺北時間）");
    expect(rows.find((row) => row.label === "簽署目的")?.value).toBe("本人確認此機構自訂表單填答");
    expect(rows.find((row) => row.label === "證據用途")?.value).toContain("並非憑證式 PDF 數位簽章");
  });

  it("marks corrections with original version and reason, not the source signature", () => {
    const source = syntheticJob();
    Object.assign(source.snapshot.response, { revision: 3, previousId: id(10), correctionSourceId: id(10), reason: "合成更正：補充服務說明" });
    const model = customResponsePrintModel(source);
    expect(model.watermark).toBe("更正草稿・未簽署");
    expect(model.sections[0].rows).toContainEqual({ label: "更正原紀錄 ID", value: id(10), state: "recorded" });
    expect(model.sections[0].rows).toContainEqual({ label: "更正原因", value: "合成更正：補充服務說明", state: "recorded" });
    expect(model.sections[2].rows).toHaveLength(1);
  });

  it.each(["clientId", "responseId"] as const)("fails closed on a mismatched %s", (field) => {
    const source = syntheticJob();
    source[field] = id(99);
    expect(() => customResponsePrintModel(source)).toThrow("CUSTOM_RESPONSE_PRINT_MODEL_INVALID");
  });

  it("does not silently drop extra fields or render invalid saved answer types", () => {
    const source = syntheticJob();
    source.snapshot.response.answers.extra = { state: "answered", value: "不得忽略" };
    expect(() => customResponsePrintModel(source)).toThrow("CUSTOM_RESPONSE_PRINT_MODEL_INVALID");
    delete source.snapshot.response.answers.extra;
    source.snapshot.response.answers.count = { state: "answered", value: "0" };
    expect(() => customResponsePrintModel(source)).toThrow("CUSTOM_RESPONSE_PRINT_MODEL_INVALID");
  });

  it("will not portray an incomplete record as signed", () => {
    const source = signedJob();
    source.snapshot.response.answers.note = { state: "missing" };
    expect(() => customResponsePrintModel(source)).toThrow("CUSTOM_RESPONSE_PRINT_MODEL_INVALID");
  });

  it("renders deterministic CJK PDFs, reopening all pages of a forty-field long-answer sample", async () => {
    const fontBytes = new Uint8Array(await readFile(join(process.cwd(), "assets/fonts/NotoSansTC-Regular.ttf")));
    expect(createHash("sha256").update(fontBytes).digest("hex")).toBe("b4ebe30cc77de66e271483b41f5d7ee60baa070054a0b938f87c88491b5d1b91");
    const samples = [["draft-long", longJob()], ["signed", signedJob()]] as const;
    for (const [name, source] of samples) {
      const model = customResponsePrintModel(source);
      expect(model.sections[1].rows).toHaveLength(name === "draft-long" ? 40 : 5);
      expect(new Set(model.sections[1].rows.map((row) => row.label)).size).toBe(name === "draft-long" ? 40 : 5);
      const render = () => renderDocumentPdf({ model, fontBytes, fontFeatures: { ...TAIPEI_PDF_FONT_FEATURES }, keepShortRowsTogether: true });
      const bytes = await render();
      const repeated = await render();
      expect(createHash("sha256").update(bytes).digest("hex")).toBe(createHash("sha256").update(repeated).digest("hex"));
      const reopened = await PDFDocument.load(bytes);
      expect(reopened.getTitle()).toBe(model.title);
      expect(reopened.getPageCount()).toBeGreaterThanOrEqual(name === "draft-long" ? 4 : 2);
      for (const page of reopened.getPages()) {
        expect(page.getWidth()).toBeCloseTo(595.28, 1);
        expect(page.getHeight()).toBeCloseTo(841.89, 1);
      }
      if (process.env.CUSTOM_RESPONSE_PDF_QA_DIR) {
        await mkdir(process.env.CUSTOM_RESPONSE_PDF_QA_DIR, { recursive: true });
        await writeFile(join(process.env.CUSTOM_RESPONSE_PDF_QA_DIR, `custom-response-${name}-synthetic.pdf`), bytes);
      }
    }
  }, 60000);

  it("fails instead of silently discarding a saved glyph absent from the locked font", async () => {
    const source = syntheticJob();
    source.snapshot.response.answers.note = { state: "answered", value: "合成缺字測試\u{10FFFF}" };
    const fontBytes = new Uint8Array(await readFile(join(process.cwd(), "assets/fonts/NotoSansTC-Regular.ttf")));
    await expect(renderDocumentPdf({ model: customResponsePrintModel(source), fontBytes,
      fontFeatures: { ...TAIPEI_PDF_FONT_FEATURES }, keepShortRowsTogether: true }))
      .rejects.toThrow("DOCUMENT_FONT_GLYPH_MISSING:U+10FFFF");
  });
});
